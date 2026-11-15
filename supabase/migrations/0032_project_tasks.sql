-- Project management: priority, description, documentation, archive, and a task board.
--
-- projects.priority / description / documentation / archived_at are new, nullable-or-defaulted
-- columns; existing projects keep every current value (priority 'normal', not archived).
-- Archiving hides a project from default lists and the "active projects" count but keeps all
-- data, tools, tokens and history (unlike delete, which cascades).
--
-- project_tasks: one row per task, owner-scoped, ordered within a status column by `position`.
-- completed_at is stamped by the app when a task enters 'done'.
--
-- Rollback: drop table public.project_tasks;
--   alter table public.projects drop column priority, description, documentation, archived_at;
-- Re-runnable.

alter table public.projects add column if not exists priority text not null default 'normal';
alter table public.projects add column if not exists description text not null default '';
alter table public.projects add column if not exists documentation text not null default '';
alter table public.projects add column if not exists archived_at timestamptz;

alter table public.projects drop constraint if exists projects_priority_check;
alter table public.projects add constraint projects_priority_check check (priority in ('low', 'normal', 'high', 'urgent'));

create table if not exists public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  owner_id text not null,
  title text not null,
  description text not null default '',
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'blocked', 'done')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  due_date date,
  assignee text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists project_tasks_board_idx on public.project_tasks (project_id, status, position);
create index if not exists project_tasks_owner_idx on public.project_tasks (owner_id, due_date);
create index if not exists projects_archived_idx on public.projects (archived_at);

alter table public.project_tasks enable row level security;
revoke all on public.project_tasks from anon, authenticated;
