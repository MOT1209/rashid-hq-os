-- Per-tool permission policy for project MCP tools (call_project_tool).
--
-- Before this, call_project_tool was allowed by policy for EVERY registered
-- tool, so a destructive endpoint ran with no gate and no kill switch. Now each
-- tool carries:
--   enabled           kill switch (disabled => denied at queue time AND at approval time)
--   permission        'read' | 'write' | 'dangerous'
--                     dangerous => always requires owner approval, never runs unattended
--   requires_approval explicit owner-approval requirement for any class
-- plus the last connectivity-test result so the owner can see health at a glance.
--
-- Existing rows keep today's behaviour: enabled, permission 'write',
-- requires_approval false. Newly DISCOVERED tools are inserted disabled by the app.
--
-- Rollback: alter table public.project_tools drop column enabled, permission,
--   requires_approval, last_tested_at, last_test_ok, last_test_error, last_latency_ms;
-- Re-runnable.

alter table public.project_tools add column if not exists enabled boolean not null default true;
alter table public.project_tools add column if not exists permission text not null default 'write';
alter table public.project_tools add column if not exists requires_approval boolean not null default false;
alter table public.project_tools add column if not exists last_tested_at timestamptz;
alter table public.project_tools add column if not exists last_test_ok boolean;
alter table public.project_tools add column if not exists last_test_error text;
alter table public.project_tools add column if not exists last_latency_ms integer;

alter table public.project_tools drop constraint if exists project_tools_permission_check;
alter table public.project_tools
  add constraint project_tools_permission_check
  check (permission in ('read', 'write', 'dangerous'));
