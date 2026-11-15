-- KING Social Studio (Phase 2–5 core).
--
-- Reuses the existing integrations layer for OAuth: tokens live (sealed) in
-- integration_connections; social_accounts only records WHICH external
-- channel/page a connection publishes to. No second OAuth system.
--
-- Same conventions as the rest of the schema: owner_id text on every row,
-- RLS on with no policies, anon/authenticated revoked, service-role only.
-- Re-runnable: create-if-not-exists / create-or-replace throughout.
--
-- Rollback (manual, destructive — only before real data exists):
--   drop table social_publish_attempts, social_publish_jobs,
--     social_content_media, social_content_variants, social_content,
--     social_media_assets, social_accounts cascade;
--   drop function claim_social_jobs(integer, text);
--
-- NOT in this migration (not built): analytics snapshots, platform events,
-- automation rules. They will arrive with their features, not as empty tables.

create table if not exists public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  platform text not null check (platform in ('youtube', 'tiktok', 'instagram', 'facebook')),
  -- integration_connections.provider that holds this account's tokens.
  connection_provider text not null,
  external_id text not null,
  display_name text not null default '',
  status text not null default 'active' check (status in ('active', 'disabled')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, platform, external_id)
);

create table if not exists public.social_media_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  name text not null,
  kind text not null check (kind in ('video', 'image')),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  duration_seconds numeric,
  width integer,
  height integer,
  -- Object storage (Supabase Storage). Binaries never live in table rows.
  storage_bucket text not null default 'social-media',
  storage_path text not null,
  -- pending: signed upload issued, bytes not yet verified in storage.
  status text not null default 'pending' check (status in ('pending', 'ready', 'archived')),
  tags text[] not null default '{}',
  category text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);

create table if not exists public.social_content (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  title text not null default '',
  description text not null default '',
  caption text not null default '',
  hashtags text[] not null default '{}',
  language text not null default 'ar',
  notes text not null default '',
  tags text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'ready', 'archived')),
  -- true while the text came from the AI assistant and the owner has not edited it.
  ai_generated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.social_content_media (
  content_id uuid not null references public.social_content (id) on delete cascade,
  asset_id uuid not null references public.social_media_assets (id) on delete restrict,
  position smallint not null default 0,
  is_thumbnail boolean not null default false,
  primary key (content_id, asset_id)
);

-- Per-platform override of the shared content. Null column = inherit.
create table if not exists public.social_content_variants (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.social_content (id) on delete cascade,
  platform text not null check (platform in ('youtube', 'tiktok', 'instagram', 'facebook')),
  title text,
  caption text,
  hashtags text[],
  options jsonb not null default '{}'::jsonb, -- e.g. { "privacy": "private" }
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_id, platform)
);

create table if not exists public.social_publish_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  content_id uuid not null references public.social_content (id) on delete restrict,
  variant_id uuid not null references public.social_content_variants (id) on delete restrict,
  account_id uuid not null references public.social_accounts (id) on delete restrict,
  platform text not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  -- UTC instant the job becomes eligible; the owner's timezone is kept for display.
  run_at timestamptz not null default now(),
  timezone text not null default 'UTC',
  -- One job per (variant, account): the duplicate-publish guard.
  idempotency_key text not null unique,
  attempts integer not null default 0,
  error_kind text check (error_kind in ('retryable', 'rate_limited', 'terminal', 'auth')),
  last_error text,
  locked_at timestamptz,
  locked_by text,
  -- Set ONLY from the platform's own response.
  external_id text,
  external_url text,
  -- The owner explicitly confirmed publishing (stamped by the server action).
  approved_by text not null,
  approved_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A succeeded job must carry a platform-confirmed id.
  constraint social_jobs_success_has_external_id
    check (status <> 'succeeded' or external_id is not null)
);

create table if not exists public.social_publish_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.social_publish_jobs (id) on delete cascade,
  attempt_no integer not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  outcome text check (outcome in ('succeeded', 'failed')),
  error_kind text,
  http_status integer,
  error text,
  -- Redacted platform response summary (never tokens).
  response jsonb,
  unique (job_id, attempt_no)
);

create index if not exists social_accounts_owner_idx on public.social_accounts (owner_id);
create index if not exists social_assets_owner_idx
  on public.social_media_assets (owner_id, created_at desc);
create index if not exists social_content_owner_idx
  on public.social_content (owner_id, updated_at desc);
create index if not exists social_jobs_due_idx
  on public.social_publish_jobs (run_at) where status = 'queued';
create index if not exists social_jobs_owner_idx
  on public.social_publish_jobs (owner_id, created_at desc);
create index if not exists social_attempts_job_idx on public.social_publish_attempts (job_id);

-- Atomically claim due jobs. SKIP LOCKED makes concurrent workers safe; a
-- 'running' job whose lock is older than 15 minutes is presumed dead and is
-- reclaimed (the attempt counter still advances, so it cannot loop forever).
create or replace function public.claim_social_jobs(p_limit integer, p_worker text)
returns setof public.social_publish_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.social_publish_jobs j
     set status = 'running',
         locked_at = now(),
         locked_by = p_worker,
         attempts = j.attempts + 1,
         updated_at = now()
   where j.id in (
     select id from public.social_publish_jobs
      where (status = 'queued' and run_at <= now())
         or (status = 'running' and locked_at < now() - interval '15 minutes')
      order by run_at
      limit greatest(p_limit, 0)
      for update skip locked
   )
  returning j.*;
end;
$$;

revoke all on function public.claim_social_jobs(integer, text) from public, anon, authenticated;

alter table public.social_accounts enable row level security;
alter table public.social_media_assets enable row level security;
alter table public.social_content enable row level security;
alter table public.social_content_media enable row level security;
alter table public.social_content_variants enable row level security;
alter table public.social_publish_jobs enable row level security;
alter table public.social_publish_attempts enable row level security;
revoke all on public.social_accounts,
  public.social_media_assets,
  public.social_content,
  public.social_content_media,
  public.social_content_variants,
  public.social_publish_jobs,
  public.social_publish_attempts
  from anon, authenticated;

-- Private bucket for media. Guarded: plain Postgres (CI) has no storage schema.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('social-media', 'social-media', false, 5368709120)
    on conflict (id) do nothing;
  end if;
end $$;
