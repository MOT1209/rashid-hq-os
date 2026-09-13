-- Cost ledger for model invocations. agent_logs records what a *tool* did;
-- this records what a *model run* cost — one row per console turn, per
-- delegated department run, and per standing-task run (the three places a
-- generateText/streamText call happens). Nothing in the code reads token
-- spend today even though agents spend credit daily; this is what opens that
-- up (dashboards, budgets) without changing anything else.
--
-- `kind` distinguishes the three call sites; a run's own uuid (`id`) doubles
-- as its run id, so there is no separate run_id column.
--
-- Re-runnable: create-if-not-exists throughout.

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,
  kind text not null check (kind in ('console', 'delegation', 'standing_task')),
  tokens_in integer,
  tokens_out integer,
  duration_ms integer not null,
  step_count integer not null,
  status text not null check (status in ('success', 'failed')),
  created_at timestamptz not null default now()
);

create index if not exists agent_runs_created_at_idx on public.agent_runs (created_at desc);
create index if not exists agent_runs_agent_name_idx on public.agent_runs (agent_name, created_at desc);

alter table public.agent_runs enable row level security;
revoke all on public.agent_runs from anon, authenticated;
