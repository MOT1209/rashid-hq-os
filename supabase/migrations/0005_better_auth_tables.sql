-- Better Auth creates its own tables over a raw pg Pool the first time the app
-- runs, which left them outside this folder entirely: a clean rebuild was not
-- reproducible from migrations alone, and 0004 needed a defensive existence
-- check before it could lock them down.
--
-- This file is that missing schema, transcribed from the live database, plus
-- the `rateLimit` table Better Auth needs now that rate-limit counters are
-- stored in Postgres instead of per-instance memory (src/lib/auth.ts).
--
-- Safe to run against a database that already has them: every statement is
-- `if not exists`.

create table if not exists public."user" (
  id text primary key,
  name text not null,
  email text not null unique,
  "emailVerified" boolean not null default false,
  image text,
  "createdAt" timestamptz not null default current_timestamp,
  "updatedAt" timestamptz not null default current_timestamp
);

create table if not exists public."session" (
  id text primary key,
  "expiresAt" timestamptz not null,
  token text not null unique,
  "createdAt" timestamptz not null default current_timestamp,
  "updatedAt" timestamptz not null,
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null references public."user"(id) on delete cascade
);

create table if not exists public."account" (
  id text primary key,
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null references public."user"(id) on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  scope text,
  password text,
  "createdAt" timestamptz not null default current_timestamp,
  "updatedAt" timestamptz not null
);

create table if not exists public."verification" (
  id text primary key,
  identifier text not null,
  value text not null,
  "expiresAt" timestamptz not null,
  "createdAt" timestamptz not null default current_timestamp,
  "updatedAt" timestamptz not null default current_timestamp
);

-- Rate-limit counters. `key` is Better Auth's own composite of client IP and
-- path; `lastRequest` is epoch milliseconds.
create table if not exists public."rateLimit" (
  id text primary key,
  key text not null,
  count integer not null default 0,
  "lastRequest" bigint not null default 0
);

create index if not exists session_user_id_idx on public."session" ("userId");
create index if not exists account_user_id_idx on public."account" ("userId");
create index if not exists verification_identifier_idx on public."verification" (identifier);
create index if not exists rate_limit_key_idx on public."rateLimit" (key);

-- Same posture as every other table here: RLS on, no policies, no grants.
-- Only the service role (server-side, bypasses RLS) may read or write. These
-- hold password hashes and session tokens, so anonymous access would be a leak.
do $$
declare t text;
begin
  foreach t in array array['user', 'session', 'account', 'verification', 'rateLimit'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
