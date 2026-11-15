-- Automation engine: persistent definitions, a durable run queue and per-step history.
--
-- automations      the definition (trigger + ordered steps). New automations start
--                  PAUSED (enabled = false); only the owner enables them.
-- automation_runs  one row per execution. Steps are persisted after each step, so a
--                  worker crash resumes at the next unfinished step instead of
--                  repeating finished ones. idempotency_key makes duplicate
--                  schedule ticks / duplicate events a no-op.
-- claim_automation_runs()  atomic claim (FOR UPDATE SKIP LOCKED; a 'running' lock older
--                  than 15 minutes is reclaimed), like claim_social_jobs.
--
-- Rollback: drop function claim_automation_runs(integer, text);
--           drop table public.automation_runs, public.automations;
-- Re-runnable.

create table if not exists public.automations (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  name text not null,
  description text not null default '',
  -- paused = false. Resume/pause is just this flag.
  enabled boolean not null default false,
  trigger_type text not null check (trigger_type in ('manual', 'schedule', 'event')),
  schedule_cron text,
  timezone text not null default 'UTC',
  event_type text,
  steps jsonb not null default '[]'::jsonb,
  max_attempts integer not null default 1 check (max_attempts between 1 and 5),
  backoff_seconds integer not null default 60 check (backoff_seconds between 10 and 3600),
  notify_on_failure boolean not null default true,
  -- Next UTC instant a schedule automation is due. Null for manual/event or when paused.
  next_run_at timestamptz,
  last_run_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automations_schedule_has_cron check (trigger_type <> 'schedule' or schedule_cron is not null),
  constraint automations_event_has_type check (trigger_type <> 'event' or event_type is not null)
);

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.automations (id) on delete cascade,
  owner_id text not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  trigger text not null check (trigger in ('manual', 'schedule', 'event')),
  trigger_payload jsonb not null default '{}'::jsonb,
  run_at timestamptz not null default now(),
  current_step integer not null default 0,
  step_results jsonb not null default '[]'::jsonb,
  error text,
  locked_at timestamptz,
  locked_by text,
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index if not exists automations_due_idx on public.automations (next_run_at) where enabled and trigger_type = 'schedule';
create index if not exists automations_event_idx on public.automations (event_type) where enabled and trigger_type = 'event';
create index if not exists automations_owner_idx on public.automations (owner_id, updated_at desc);
create index if not exists automation_runs_due_idx on public.automation_runs (run_at) where status = 'queued';
create index if not exists automation_runs_automation_idx on public.automation_runs (automation_id, created_at desc);

create or replace function public.claim_automation_runs(p_limit integer, p_worker text)
returns setof public.automation_runs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.automation_runs r
     set status = 'running',
         locked_at = now(),
         locked_by = p_worker,
         started_at = coalesce(r.started_at, now())
   where r.id in (
     select id from public.automation_runs
      where (status = 'queued' and run_at <= now())
         or (status = 'running' and locked_at < now() - interval '15 minutes')
      order by run_at
      limit greatest(p_limit, 0)
      for update skip locked
   )
  returning r.*;
end;
$$;

revoke all on function public.claim_automation_runs(integer, text) from public, anon, authenticated;

alter table public.automations enable row level security;
alter table public.automation_runs enable row level security;
revoke all on public.automations, public.automation_runs from anon, authenticated;
