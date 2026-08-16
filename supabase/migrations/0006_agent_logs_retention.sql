-- agent_logs grows without limit: every tool call writes a row, and payload and
-- result are unbounded jsonb. fetchStats already uses `count: "planned"` to
-- avoid walking the table, which is an admission it will get large.
--
-- Retention is 90 days. Rows older than that are activity history nobody reads
-- and cost storage plus index bloat forever.

create index if not exists agent_logs_created_at_desc_idx
  on public.agent_logs (created_at desc);

create or replace function public.prune_agent_logs(older_than interval default '90 days')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.agent_logs
  where created_at < now() - older_than;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.prune_agent_logs(interval) from public, anon, authenticated;

comment on function public.prune_agent_logs(interval) is
  'Deletes agent_logs older than the given interval (default 90 days). Called from /api/maintenance/prune on a schedule.';
