-- Integrations layer.
--
-- The console already federates external *projects* through project_tools +
-- call_project_tool. This is the other half: the owner's own accounts on
-- third-party platforms (Google, GitHub, Stripe, OpenAI, ...), connected once
-- and reused by the dashboard and the agents.
--
-- Design mirrors the rest of this schema:
--   * every row is scoped by owner_id (text, same as projects.owner_id)
--   * RLS is enabled with no policies — all access is server-side, service role
--   * secrets are never stored in the clear: access/refresh tokens and API keys
--     arrive here already sealed by src/lib/integrations/encryption.ts
--     (AES-256-GCM). The columns hold ciphertext, so a leaked dump is inert
--     without INTEGRATIONS_SECRET.
--
-- Re-runnable: create-if-not-exists throughout, and every column add is guarded.

-- One row per (owner, provider). "provider" is a registry key from
-- src/lib/integrations/registry.ts — "google", "youtube", "github", "openai"…
create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  provider text not null,
  -- connected | disconnected | error | expired
  status text not null default 'disconnected'
    check (status in ('connected', 'disconnected', 'error', 'expired')),
  -- OAuth: sealed token bundle { access_token, refresh_token?, id_token? }.
  -- API-key providers: sealed { api_key, ... }. Null until first connect.
  secret_ciphertext text,
  -- Non-secret metadata safe to read back into the UI: granted scopes, the
  -- external account label (email / login / channel title), expiry, etc.
  metadata jsonb not null default '{}'::jsonb,
  -- When the current access token stops working. Null = no expiry / unknown.
  expires_at timestamptz,
  last_connected_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, provider)
);

-- Short-lived OAuth handshake state. Holds the CSRF token, the PKCE verifier
-- and the return path between /connect and /callback. Rows are single-use and
-- swept after 15 minutes (the console has no scheduled job for this yet; the
-- callback deletes its own row, and stale rows are ignored by the expiry check).
create table if not exists public.integration_oauth_states (
  state text primary key,
  owner_id text not null,
  provider text not null,
  code_verifier text,
  redirect_to text,
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes'
);

-- Inbound webhook deliveries. event_id is the provider's own delivery id; the
-- unique constraint is what makes replay / double-delivery a no-op.
create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text,
  event_type text,
  -- verified | invalid_signature | duplicate | error
  status text not null default 'verified',
  payload jsonb,
  received_at timestamptz not null default now(),
  unique (provider, event_id)
);

create index if not exists integration_connections_owner_idx
  on public.integration_connections (owner_id);
create index if not exists integration_oauth_states_expiry_idx
  on public.integration_oauth_states (expires_at);
create index if not exists webhook_events_provider_idx
  on public.webhook_events (provider, received_at desc);

alter table public.integration_connections enable row level security;
alter table public.integration_oauth_states enable row level security;
alter table public.webhook_events enable row level security;

revoke all on public.integration_connections from anon, authenticated;
revoke all on public.integration_oauth_states from anon, authenticated;
revoke all on public.webhook_events from anon, authenticated;
