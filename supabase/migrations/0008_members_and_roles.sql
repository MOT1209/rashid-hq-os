-- OWNER_EMAILS is a single flat allowlist: everyone on it is equally powerful,
-- and project ownership is per-row, so two people on the list end up with
-- mutually unmanageable projects. Roles move into the database with a real
-- distinction:
--
--   admin  — everything, including managing members
--   viewer — reads the dashboard; every mutation is refused
--
-- OWNER_EMAILS still works and still fails closed. Anyone on it is treated as
-- an admin, so a fresh install needs no seeding and cannot lock itself out.
create table if not exists public.members (
  email text primary key,
  role text not null default 'viewer' check (role in ('admin', 'viewer')),
  invited_by text,
  created_at timestamptz not null default now()
);

alter table public.members enable row level security;
revoke all on public.members from anon, authenticated;
