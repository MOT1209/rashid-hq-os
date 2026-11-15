-- MCP protocol support for project servers.
--
-- projects.mcp_protocol:
--   'hq'  (default) the signed-POST protocol the reference receiver
--         (/api/project-tools) speaks — unchanged behaviour.
--   'mcp' a standard MCP server over Streamable HTTP (initialize, tools/list,
--         tools/call), which also enables tool discovery.
-- mcp_server_credentials: optional bearer token for an 'mcp' server, sealed with
--   INTEGRATIONS_SECRET (AES-256-GCM) like every other secret. Never returned to
--   the browser.
--
-- Rollback: drop table public.mcp_server_credentials;
--           alter table public.projects drop column mcp_protocol;
-- Re-runnable.

alter table public.projects add column if not exists mcp_protocol text not null default 'hq';
alter table public.projects drop constraint if exists projects_mcp_protocol_check;
alter table public.projects add constraint projects_mcp_protocol_check check (mcp_protocol in ('hq', 'mcp'));

create table if not exists public.mcp_server_credentials (
  project_id uuid primary key references public.projects (id) on delete cascade,
  owner_id text not null,
  secret_ciphertext text not null,
  updated_at timestamptz not null default now()
);

alter table public.mcp_server_credentials enable row level security;
revoke all on public.mcp_server_credentials from anon, authenticated;
