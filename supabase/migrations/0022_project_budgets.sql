-- Project-level token budgets (mirrors 0018/0021, but for public.projects
-- instead of public.departments). agent_runs (0016) still measures what each
-- model run cost; this lets a project cap it too, using the exact same
-- 80%-alert / 100%-block behavior as departments.
--
-- agent_runs.project_id is what makes "how many tokens did project X spend"
-- a well-defined number: a run is attributed to a project only when its tool
-- calls touched exactly one project during that run (see
-- src/lib/department-agent.ts and src/app/api/console/route.ts). A run that
-- touched zero or several projects leaves this NULL rather than guessing.
--
-- budget_events (0018) is reused rather than a new budget_alerts table: same
-- shape (kind, tokens_used, budget), only the subject differs, so a nullable
-- project_id is enough to tell a project's alerts from a department's.
--
-- Re-runnable: guarded column/index adds throughout. Rollback: see docs/DATABASE.md.

alter table public.projects
  add column if not exists monthly_token_budget integer;
alter table public.projects
  add column if not exists budget_alerted_at timestamptz;
alter table public.projects
  add column if not exists budget_exhausted_alerted_at timestamptz;

alter table public.agent_runs
  add column if not exists project_id uuid references public.projects(id) on delete set null;

create index if not exists agent_runs_project_id_idx
  on public.agent_runs (project_id, created_at desc)
  where project_id is not null;

alter table public.budget_events
  add column if not exists project_id uuid references public.projects(id) on delete set null;

create index if not exists budget_events_project_id_idx
  on public.budget_events (project_id, created_at desc)
  where project_id is not null;
