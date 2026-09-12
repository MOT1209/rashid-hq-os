-- Policy gate: every tool call now carries the decision that let it run (or
-- not), and who actually drove it. Before this, a scope denial on either MCP
-- transport touched agent_logs not at all — the call simply never happened as
-- far as the audit trail was concerned.
--
-- decision:        'allow' | 'deny' | 'require_approval' — see src/lib/policy.ts
-- decision_reason: the matched PolicyRule.id, "scope" for a scope denial, or
--                   null when no rule matched (the tool predates the policy).
-- actor_type:       'person' | 'agent_token' | 'department_agent' |
--                   'standing_task_routine' — see src/types/database.ts.
--
-- Re-runnable: every column add and constraint change is guarded.

alter table public.agent_logs add column if not exists decision text;
alter table public.agent_logs add column if not exists decision_reason text;
alter table public.agent_logs add column if not exists actor_type text;

do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'agent_logs_status_check'
  ) then
    alter table public.agent_logs drop constraint agent_logs_status_check;
  end if;
end $$;

alter table public.agent_logs
  add constraint agent_logs_status_check
  check (status in ('success', 'failed', 'pending', 'awaiting_approval'));
