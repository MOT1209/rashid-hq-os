-- Adds Better Auth's two-factor plugin schema (src/lib/auth.ts). Transcribed
-- from the plugin's own schema so a clean rebuild stays reproducible from
-- migrations alone, matching how 0005 carries the base Better Auth tables.
--
-- Safe to run against a database that already has these: the column add is
-- guarded, the table create is `if not exists`.

alter table public."user"
  add column if not exists "twoFactorEnabled" boolean not null default false;

create table if not exists public."twoFactor" (
  id text primary key,
  secret text not null,
  "backupCodes" text not null,
  "userId" text not null references public."user"(id) on delete cascade,
  verified boolean not null default true,
  "failedVerificationCount" integer not null default 0,
  "lockedUntil" timestamptz
);

create index if not exists two_factor_user_id_idx on public."twoFactor" ("userId");
create index if not exists two_factor_secret_idx on public."twoFactor" (secret);

-- Same posture as every other Better Auth table: RLS on, no policies, no
-- grants. Only the service role (server-side, bypasses RLS) may read or
-- write. This table holds TOTP secrets and backup codes.
alter table public."twoFactor" enable row level security;
revoke all on public."twoFactor" from anon, authenticated;
