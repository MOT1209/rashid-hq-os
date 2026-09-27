-- Approval expiry (follows 0015). A queued tool call (today only delete_project)
-- used to sit in tool_approvals as 'pending' forever: an admin could approve it
-- an arbitrary time later, against whatever the world looked like then. Even
-- though approveToolCall re-checks scope + policy at click time, executing a
-- request a user made weeks ago is a governance smell — the intent is stale.
--
-- expires_at bounds that window. queueApproval stamps it (now + TTL, see
-- src/lib/approvals.ts); approveToolCall refuses an expired row and marks it
-- 'expired' instead of 'approved'. NULL means "no expiry" — the state of every
-- row queued before this migration, so legacy approvals keep their old
-- behavior rather than silently becoming un-actionable.
--
-- The status check is widened to allow 'expired' so the audit trail can tell an
-- expiry apart from an admin rejection.
--
-- Re-runnable: guarded column add + drop/add of the named check constraint.

alter table public.tool_approvals
  add column if not exists expires_at timestamptz;

alter table public.tool_approvals
  drop constraint if exists tool_approvals_status_check;
alter table public.tool_approvals
  add constraint tool_approvals_status_check
  check (status in ('pending', 'approved', 'rejected', 'expired'));

create index if not exists tool_approvals_expires_at_idx
  on public.tool_approvals (expires_at)
  where expires_at is not null;
