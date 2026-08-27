-- Standing tasks: a department agent runs a fixed brief once a day on its own,
-- with no human in the loop. Until now every agent run started because someone
-- typed a command in the console or a tool called delegate_to_department.
--
-- The daily cron (/api/agent/standing-tasks, vercel.json) reads these two
-- columns and nothing else:
--   standing_task          the brief, passed straight to runDepartmentAgent.
--                          Null or empty means nothing is scheduled.
--   standing_task_enabled  the per-department off switch. It keeps the brief
--                          text so a department can be paused without losing
--                          what it was set up to do.
--
-- Cost is bounded on three sides: this flag, a one-run-per-day guard in the
-- cron, and MAX_STEPS inside the executor (src/lib/department-agent.ts).
--
-- Safe to re-run: `if not exists` on both columns.

alter table public.departments
  add column if not exists standing_task text,
  add column if not exists standing_task_enabled boolean not null default true;
