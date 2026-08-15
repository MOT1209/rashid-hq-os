create table if not exists public.agent_tokens (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,
  token_hash text not null unique,
  token_prefix text not null,
  scopes text[] not null default array['read','write'],
  project_id uuid references public.projects(id) on delete cascade,
  created_by text,
  last_used_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists agent_tokens_hash_idx on public.agent_tokens (token_hash);
alter table public.agent_tokens enable row level security;
-- No policies: tokens are readable and writable only through the service role.
