-- Social analytics snapshots. One row per collection attempt for a published
-- job. `metrics` holds ONLY values the platform API actually returned;
-- `unsupported` lists metrics this integration cannot read (missing scope,
-- API limitation), so the UI never invents or zero-fills a number.
--
-- Rollback: drop table public.social_analytics_snapshots;
-- Re-runnable.

create table if not exists public.social_analytics_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  job_id uuid not null references public.social_publish_jobs (id) on delete cascade,
  platform text not null,
  external_id text not null,
  retrieved_at timestamptz not null default now(),
  metrics jsonb not null default '{}'::jsonb,
  unsupported text[] not null default '{}',
  -- Set when the collection failed; metrics is then empty.
  error text
);

create index if not exists social_snapshots_job_idx
  on public.social_analytics_snapshots (job_id, retrieved_at desc);
create index if not exists social_snapshots_owner_idx
  on public.social_analytics_snapshots (owner_id, retrieved_at desc);

alter table public.social_analytics_snapshots enable row level security;
revoke all on public.social_analytics_snapshots from anon, authenticated;
