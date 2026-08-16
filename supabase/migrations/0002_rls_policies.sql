-- HISTORICAL. Every policy below is dropped again by 0004, which closed
-- anonymous database access after the browser stopped talking to Supabase
-- directly. Kept so the migration history stays honest; a fresh install runs
-- these three statements only to have them removed a moment later.
--
-- Do not add policies here. If anonymous read is ever needed again, add a new
-- migration and say why.

-- These predate the SSE activity feed: the browser held a publishable key and
-- subscribed to agent_logs over Realtime, which required SELECT for anon.
--
-- Postgres has no `create policy if not exists`, so each one is dropped first
-- to keep the file re-runnable.
drop policy if exists "read_projects" on public.projects;
create policy "read_projects" on public.projects for select to anon, authenticated using (true);

drop policy if exists "read_agent_logs" on public.agent_logs;
create policy "read_agent_logs" on public.agent_logs for select to anon, authenticated using (true);

drop policy if exists "read_project_tools" on public.project_tools;
create policy "read_project_tools" on public.project_tools for select to anon, authenticated using (true);
