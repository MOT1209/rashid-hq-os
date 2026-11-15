-- Retention for the tables added with Social Studio and Automations, called by the existing
-- daily cron (/api/maintenance/prune) next to prune_agent_logs. Without it these grow forever.
--
--   prune_automation_runs(older_than)  deletes FINISHED runs (succeeded/failed/cancelled) older than the window.
--                                      Queued/running runs are never touched.
--   prune_social_data(older_than)      deletes analytics snapshots older than the window, and FAILED/CANCELLED
--                                      publish jobs older than the window (their attempts cascade).
--                                      Succeeded jobs (the publishing history) are kept.
--
-- Rollback: drop function public.prune_automation_runs(interval); drop function public.prune_social_data(interval);
-- Re-runnable.

create or replace function public.prune_automation_runs(older_than interval default '90 days')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare removed integer;
begin
  delete from public.automation_runs
   where status in ('succeeded', 'failed', 'cancelled')
     and coalesce(finished_at, created_at) < now() - older_than;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

create or replace function public.prune_social_data(older_than interval default '180 days')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare removed integer := 0; n integer;
begin
  delete from public.social_analytics_snapshots where retrieved_at < now() - older_than;
  get diagnostics n = row_count; removed := removed + n;
  delete from public.social_publish_jobs
   where status in ('failed', 'cancelled')
     and coalesce(completed_at, updated_at) < now() - older_than;
  get diagnostics n = row_count; removed := removed + n;
  return removed;
end;
$$;

revoke all on function public.prune_automation_runs(interval) from public, anon, authenticated;
revoke all on function public.prune_social_data(interval) from public, anon, authenticated;
