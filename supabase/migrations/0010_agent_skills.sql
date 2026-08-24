-- Saved command/prompt templates ("skills"). A skill fills the CEO console's
-- input box when picked (src/components/ceo-console.tsx) and is readable by
-- agents over MCP (list_skills / get_skill in src/lib/mcp/tools.ts) — it does
-- not run a model itself, so picking or fetching one never starts a second
-- agentic loop or an unexpected model call.
--
-- Safe to run against a database that already has this: `if not exists`.

create table if not exists public.agent_skills (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  prompt text not null,
  created_by text references public."user"(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists agent_skills_created_at_idx on public.agent_skills (created_at desc);

-- Same posture as every other table here: RLS on, no policies, no grants.
-- Only the service role (server-side, bypasses RLS) may read or write.
alter table public.agent_skills enable row level security;
revoke all on public.agent_skills from anon, authenticated;
