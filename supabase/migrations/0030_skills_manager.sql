-- Skills Manager: versioning, schemas, metadata, enable/disable.
--
-- A skill is still a saved prompt template (it never runs a model by itself).
-- New: enabled flag (disabled skills are hidden from the console and from the
-- MCP list_skills/get_skill tools), a monotonically increasing version with
-- full snapshots of previous versions, optional input/output JSON-Schema-like
-- descriptions, tags and free-form metadata.
--
-- Existing skills: enabled, version 1, no schemas. Nothing is deleted.
--
-- Rollback: drop table public.agent_skill_versions;
--   alter table public.agent_skills drop column enabled, version, tags,
--     input_schema, output_schema, metadata, updated_at;
-- Re-runnable.

alter table public.agent_skills add column if not exists enabled boolean not null default true;
alter table public.agent_skills add column if not exists version integer not null default 1;
alter table public.agent_skills add column if not exists tags text[] not null default '{}';
alter table public.agent_skills add column if not exists input_schema jsonb;
alter table public.agent_skills add column if not exists output_schema jsonb;
alter table public.agent_skills add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.agent_skills add column if not exists updated_at timestamptz not null default now();

create table if not exists public.agent_skill_versions (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid not null references public.agent_skills (id) on delete cascade,
  version integer not null,
  name text not null,
  description text,
  prompt text not null,
  tags text[] not null default '{}',
  input_schema jsonb,
  output_schema jsonb,
  metadata jsonb not null default '{}'::jsonb,
  saved_by text,
  saved_at timestamptz not null default now(),
  unique (skill_id, version)
);

create index if not exists agent_skill_versions_skill_idx on public.agent_skill_versions (skill_id, version desc);
create index if not exists agent_skills_tags_idx on public.agent_skills using gin (tags);

alter table public.agent_skill_versions enable row level security;
revoke all on public.agent_skill_versions from anon, authenticated;
