-- 0002 granted anon a blanket SELECT on projects, agent_logs and project_tools
-- so Supabase Realtime could reach the browser. That also handed everyone who
-- holds the publishable key (it ships to every browser) full read access to
-- agent_logs.payload, agent_logs.result and project_tools.endpoint.
--
-- The dashboard now streams activity over a server-authenticated SSE route
-- (/api/activity/stream), so the browser never talks to Postgres directly and
-- these policies have no reason to exist.

drop policy if exists "read_projects" on public.projects;
drop policy if exists "read_agent_logs" on public.agent_logs;
drop policy if exists "read_project_tools" on public.project_tools;

-- RLS stays enabled with zero policies: only the service role (which bypasses
-- RLS, server-side only) can read or write. Belt and braces on the grants too,
-- so a future policy cannot accidentally reopen the table.
revoke all on public.projects from anon, authenticated;
revoke all on public.agent_logs from anon, authenticated;
revoke all on public.project_tools from anon, authenticated;
revoke all on public.agent_tokens from anon, authenticated;

-- agent_logs no longer needs to be published for browser Realtime.
-- Guarded so re-running the folder does not fail once it is already dropped.
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'agent_logs'
  ) then
    alter publication supabase_realtime drop table public.agent_logs;
  end if;
end $$;

alter table public.agent_logs replica identity default;

-- Better Auth creates these directly over pg (outside any migration), so they
-- arrive with default grants and no RLS. They hold password hashes and session
-- tokens; nothing but the service role may touch them.
do $$
declare t text;
begin
  foreach t in array array['user', 'session', 'account', 'verification'] loop
    if to_regclass('public.' || quote_ident(t)) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;
