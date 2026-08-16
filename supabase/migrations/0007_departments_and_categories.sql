-- Departments and project categories were two arrays in src/lib/agents.ts, with
-- their display names coupled to dictionary keys. Adding a fifth department, or
-- a new category, meant a code change plus two dictionary edits plus a deploy —
-- in an app that calls itself a command center for *every* project.
--
-- Both move into the database. Names are stored per locale rather than pointing
-- at a dictionary key, so a row added at runtime can be labelled without
-- touching the bundle.

create table if not exists public.departments (
  -- The URL segment (/dashboard/departments/<key>), so it stays stable.
  key text primary key,
  name_ar text not null,
  name_en text not null,
  -- Written into agent_logs.agent_name by the agent itself; never translated.
  agent_name text not null,
  agent_label_ar text not null,
  agent_label_en text not null,
  icon text not null default '📁',
  -- Exactly one row is the catch-all for categories that match nothing.
  is_fallback boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists departments_single_fallback_idx
  on public.departments (is_fallback) where is_fallback;

create table if not exists public.project_categories (
  -- The value stored in projects.category.
  value text primary key,
  label_ar text not null,
  label_en text not null,
  department_key text references public.departments(key) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists project_categories_department_idx
  on public.project_categories (department_key);

-- Seed with exactly what the arrays held, so nothing changes on first deploy.
insert into public.departments
  (key, name_ar, name_en, agent_name, agent_label_ar, agent_label_en, icon, is_fallback, sort_order)
values
  ('dev',    'تطوير البرمجيات', 'Software Development',  'Dev Agent',    'وكيل التطوير',   'Dev Agent',    '💻', false, 1),
  ('store',  'عمليات المتاجر',  'E-Commerce Operations', 'Store Agent',  'وكيل المتاجر',   'Store Agent',  '🛒', false, 2),
  ('media',  'التسويق والإعلام','Marketing & Media',     'Media Agent',  'وكيل الإعلام',   'Media Agent',  '📣', false, 3),
  ('custom', 'مشاريع مخصّصة',   'Custom Projects',       'Custom Agent', 'الوكيل المخصّص', 'Custom Agent', '🚀', true,  4)
on conflict (key) do nothing;

insert into public.project_categories (value, label_ar, label_en, department_key, sort_order)
values
  ('Web App',    'تطبيق ويب',      'Web App',    'dev',   1),
  ('Game',       'لعبة',           'Game',       'dev',   2),
  ('API',        'واجهة برمجية',   'API',        'dev',   3),
  ('Mobile App', 'تطبيق جوال',     'Mobile App', 'dev',   4),
  ('E-Commerce', 'متجر إلكتروني',  'E-Commerce', 'store', 5),
  ('Media',      'إعلام',          'Media',      'media', 6),
  ('Marketing',  'تسويق',          'Marketing',  'media', 7),
  ('Other',      'أخرى',           'Other',      null,    8)
on conflict (value) do nothing;

-- Same posture as every other table: server-only.
alter table public.departments enable row level security;
alter table public.project_categories enable row level security;
revoke all on public.departments from anon, authenticated;
revoke all on public.project_categories from anon, authenticated;
