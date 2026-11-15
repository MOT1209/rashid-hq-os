-- Per-agent permission settings for the Social Studio agents.
-- A missing row means "enabled with the agent's default grants". The app clamps
-- `permissions` to the agent's maximum and strips schedule/publish/delete/
-- manage_accounts regardless of what is stored here (defence in depth).
--
-- Rollback: drop table public.social_agent_settings;  Re-runnable.

create table if not exists public.social_agent_settings (
  owner_id text not null,
  agent_key text not null,
  enabled boolean not null default true,
  permissions text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (owner_id, agent_key)
);

alter table public.social_agent_settings enable row level security;
revoke all on public.social_agent_settings from anon, authenticated;
