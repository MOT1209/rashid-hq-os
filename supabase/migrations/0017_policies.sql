-- DB-driven policy gate (Phase 1.1). The three hard-coded rules in
-- src/lib/policy.ts become rows here so an admin can enable/disable them
-- from /dashboard/access without a deploy. Matching semantics mirror the
-- code exactly:
--
--   a row matches when (tool_names is empty OR tool.name = ANY(tool_names))
--   AND (actor_type IS NULL OR ctx.actorType = actor_type)
--   AND (required_scope IS NULL OR tool.requiredScope = required_scope)
--   AND (exclude_tool IS NULL OR tool.name <> exclude_tool)
--
-- First match by priority wins; no match falls back to the fail-safe
-- default (read -> allow, write -> require_approval). If this table is
-- missing or unreadable, src/lib/policy.ts falls back to the hard-coded
-- POLICY — the gate never fails open or closed on a DB error.
--
-- Re-runnable: create-if-not-exists + insert-on-conflict-do-nothing.

create table if not exists public.policies (
  id text primary key,
  description text not null default '',
  tool_names text[] not null default '{}',
  actor_type text,
  required_scope text check (required_scope is null or required_scope in ('read', 'write')),
  exclude_tool text,
  decision text not null check (decision in ('allow', 'deny', 'require_approval')),
  priority integer not null default 100,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.policies
  (id, description, tool_names, actor_type, required_scope, exclude_tool, decision, priority, enabled)
values
  ('standing-task-write-guard',
   'Unattended standing-task cron: no write beyond calling a project tool.',
   '{}', 'standing_task_routine', 'write', 'call_project_tool', 'deny', 10, true),
  ('delete-project-needs-approval',
   'Irreversible cascade to project_tools, agent_tokens and agent_logs.',
   '{delete_project}', null, null, null, 'require_approval', 20, true),
  ('already-guarded-writes',
   'Writes already safe behind ownsProject/assertSafeEndpoint.',
   '{register_project,update_project,add_project_tool,update_project_tool,delete_project_tool,call_project_tool,delegate_to_department}',
   null, null, null, 'allow', 30, true)
on conflict (id) do nothing;

alter table public.policies enable row level security;
revoke all on public.policies from anon, authenticated;
