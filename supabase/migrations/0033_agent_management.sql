-- General agent management: governance columns on departments (the agents) and project assignment.
--
-- enabled        off switch. A disabled agent refuses delegated runs and its standing task is skipped.
-- allowed_tools  null = every tool the agent's mode allows (today's behaviour); otherwise only these.
-- read_only      true = the agent may only use read-scope tools, whatever allowed_tools says.
-- is_custom      created from the Agents page (only these can be deleted there; built-in departments cannot).
-- agent_projects optional project assignment. An agent with NO rows may act on any project (today's
--                behaviour); with rows, calls naming another project are refused by the runtime.
--
-- Existing agents keep today's behaviour (enabled, all tools, read/write, no assignments).
--
-- Rollback: drop table public.agent_projects;
--   alter table public.departments drop column enabled, allowed_tools, read_only, is_custom;
-- Re-runnable.

alter table public.departments add column if not exists enabled boolean not null default true;
alter table public.departments add column if not exists allowed_tools text[];
alter table public.departments add column if not exists read_only boolean not null default false;
alter table public.departments add column if not exists is_custom boolean not null default false;

create table if not exists public.agent_projects (
  department_key text not null references public.departments (key) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (department_key, project_id)
);

create index if not exists agent_projects_project_idx on public.agent_projects (project_id);

alter table public.agent_projects enable row level security;
revoke all on public.agent_projects from anon, authenticated;
