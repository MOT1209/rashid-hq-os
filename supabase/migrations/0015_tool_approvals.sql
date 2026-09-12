-- Human-approval queue for tool calls the policy gate (src/lib/policy.ts)
-- marks require_approval instead of executing outright — today just
-- delete_project. One row per queued call, linked back to the agent_logs row
-- the executor already wrote with status 'awaiting_approval' (migration 0014).
--
-- args/ctx are stored verbatim (jsonb) so approveToolCall can call the tool's
-- own execute() later, in a completely different request — the closure
-- startActivity returns cannot survive across that gap in a serverless
-- runtime, which is why this exists as a table rather than an in-memory queue.
--
-- Re-runnable: create-if-not-exists throughout.

create table if not exists public.tool_approvals (
  id uuid primary key default gen_random_uuid(),
  log_id uuid not null references public.agent_logs(id) on delete cascade,
  tool_name text not null,
  args jsonb not null,
  ctx jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists tool_approvals_status_idx
  on public.tool_approvals (status, created_at);

alter table public.tool_approvals enable row level security;
revoke all on public.tool_approvals from anon, authenticated;
