-- All writes go through the server with the service role key (which bypasses RLS).
-- The browser only needs SELECT so Supabase Realtime can stream agent_logs live.
create policy "read_projects" on public.projects for select to anon, authenticated using (true);
create policy "read_agent_logs" on public.agent_logs for select to anon, authenticated using (true);
create policy "read_project_tools" on public.project_tools for select to anon, authenticated using (true);
