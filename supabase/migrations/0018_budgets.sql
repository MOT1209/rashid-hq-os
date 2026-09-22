-- Spend budgets (Phase 1.2). agent_runs (0016) measures what each model run
-- cost; these columns turn the measurement into a guardrail: a department
-- with a budget stops starting new runs at 100% and mails the owners once a
-- day past 80%. NULL budget = unlimited, the behavior before this migration.
--
-- budget_alerted_at throttles the 80% mail to one a day; budget_events keeps
-- the audit trail of alerts and blocks next to agent_logs.
--
-- Re-runnable: column adds guarded, create-if-not-exists throughout.

alter table public.departments
  add column if not exists monthly_token_budget integer;
alter table public.departments
  add column if not exists budget_alerted_at timestamptz;

create table if not exists public.budget_events (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,
  tokens_used integer not null,
  budget integer not null,
  kind text not null check (kind in ('alert', 'blocked')),
  created_at timestamptz not null default now()
);

create index if not exists budget_events_agent_name_idx
  on public.budget_events (agent_name, created_at desc);

alter table public.budget_events enable row level security;
revoke all on public.budget_events from anon, authenticated;
