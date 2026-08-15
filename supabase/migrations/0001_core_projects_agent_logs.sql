create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  url text,
  repository_url text,
  mcp_endpoint text,
  status text not null default 'active' check (status in ('active','idle','maintenance')),
  owner_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.agent_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  agent_name text,
  tool_name text,
  payload jsonb,
  result jsonb,
  status text not null default 'pending' check (status in ('success','failed','pending')),
  created_at timestamptz not null default now()
);

create table if not exists public.project_tools (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  tool_name text not null,
  description text,
  input_schema jsonb,
  endpoint text,
  created_at timestamptz not null default now(),
  unique (project_id, tool_name)
);

create index if not exists agent_logs_created_at_idx on public.agent_logs (created_at desc);
create index if not exists agent_logs_project_id_idx on public.agent_logs (project_id);
create index if not exists project_tools_project_id_idx on public.project_tools (project_id);
create index if not exists projects_category_idx on public.projects (category);

alter table public.projects enable row level security;
alter table public.agent_logs enable row level security;
alter table public.project_tools enable row level security;

-- Realtime streaming for the activity feed
alter table public.agent_logs replica identity full;
alter publication supabase_realtime add table public.agent_logs;
