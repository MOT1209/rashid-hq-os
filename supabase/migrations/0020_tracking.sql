-- Monthly follow-up register (ported from monthly_tracking_register.html).
-- The HTML file kept everything in localStorage (key MonthlyRegisterData_v3):
-- one header (school/class/subject/month), N members, 16 toggle cells each
-- (4 weeks x c=توثيق/t=مهام/b=تواصل/h=تسليم, value 0/1/2), 5 quiz scores
-- out of 10, plus overall_grade + notes. This migration gives that same shape
-- a server home so the dashboard page can share it across devices and log who
-- changed what, instead of one browser's localStorage.
--
-- Design notes:
-- - tracking_months.month_key is the dedupe key (e.g. '2026-10' or the Arabic
--   month label the HTML used). One row per evaluated month.
-- - Cells and scores are separate narrow tables (not 21 columns on members)
--   so toggling one cell updates one row and the unique constraints prevent
--   double-writes from two tabs.
-- - Re-runnable: create-if-not-exists throughout.
-- - Apply AFTER 0014/0015/0016/0017/0018 (same pending batch, no dependency
--   between them, but keep numeric order).

create table if not exists public.tracking_months (
  id uuid primary key default gen_random_uuid(),
  school_name text not null default '',
  class_name text not null default '',
  subject text not null default '',
  month_key text not null,
  created_by text,
  created_at timestamptz not null default now(),
  unique (month_key)
);

create table if not exists public.tracking_members (
  id uuid primary key default gen_random_uuid(),
  month_id uuid not null references public.tracking_months (id) on delete cascade,
  name text not null,
  role text not null default '',
  overall_grade text not null default 'ممتاز'
    check (overall_grade in ('ممتاز', 'جيد جداً', 'جيد', 'مقبول', 'بحاجة لتحسين')),
  notes text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists tracking_members_month_idx
  on public.tracking_members (month_id, sort_order);

-- One row per (member, week 1..4, kind c/t/b/h). value: 0 empty, 1 done, 2 missed.
create table if not exists public.tracking_cells (
  member_id uuid not null references public.tracking_members (id) on delete cascade,
  week smallint not null check (week between 1 and 4),
  kind text not null check (kind in ('c', 't', 'b', 'h')),
  value smallint not null default 0 check (value in (0, 1, 2)),
  updated_at timestamptz not null default now(),
  primary key (member_id, week, kind)
);

-- Five quiz scores per member (idx 1..5), each 0..10.
create table if not exists public.tracking_scores (
  member_id uuid not null references public.tracking_members (id) on delete cascade,
  idx smallint not null check (idx between 1 and 5),
  score numeric not null default 0 check (score >= 0 and score <= 10),
  primary key (member_id, idx)
);

alter table public.tracking_months enable row level security;
alter table public.tracking_members enable row level security;
alter table public.tracking_cells enable row level security;
alter table public.tracking_scores enable row level security;
revoke all on public.tracking_months,
  public.tracking_members,
  public.tracking_cells,
  public.tracking_scores
  from anon, authenticated;
