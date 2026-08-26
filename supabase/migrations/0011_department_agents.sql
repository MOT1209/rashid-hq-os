-- Department agents were fiction. The console's system prompt told the model to
-- "route work to the right department: Dev Agent, Store Agent, Media Agent",
-- but nothing stood behind those names — there was no executor, so no work was
-- ever routed anywhere. The visible symptom: departments.agent_name exists and
-- every department page filters Live Activity by it, so all of them showed
-- "no activity yet" permanently, because nothing ever logged under those names.
--
-- Giving each department a prompt and a model is what turns the label into a
-- runnable agent. The runtime reads these two columns and nothing else.

alter table public.departments
  -- What this agent is for. Empty means "no instructions beyond the defaults
  -- the runtime supplies", which still runs — it just has no specialism.
  add column if not exists system_prompt text not null default '',
  -- Null falls back to CEO_CONSOLE_MODEL, so an existing deployment needs no
  -- configuration for delegation to start working.
  add column if not exists model text;

-- Seed each existing department with its own scope. Written in English because
-- these are model instructions, not UI copy; the agent replies in whatever
-- language the task arrives in.
update public.departments set system_prompt =
  'You are the Dev Agent for Alking Enterprises, responsible for the software '
  'development department: web apps, games, APIs and mobile apps. Use the tools '
  'to read real project data before answering — never invent project names, ids '
  'or metrics. When a project exposes a registered MCP tool, prefer calling it '
  'over describing what should be done. Report back concisely: what you checked, '
  'what you changed, and anything the CEO needs to decide.'
where key = 'dev' and system_prompt = '';

update public.departments set system_prompt =
  'You are the Store Agent for Alking Enterprises, responsible for e-commerce '
  'operations. Use the tools to read real project data before answering — never '
  'invent project names, ids or metrics. When a store project exposes a '
  'registered MCP tool, prefer calling it over describing what should be done. '
  'Report back concisely: what you checked, what you changed, and anything the '
  'CEO needs to decide.'
where key = 'store' and system_prompt = '';

update public.departments set system_prompt =
  'You are the Media Agent for Alking Enterprises, responsible for marketing and '
  'media projects. Use the tools to read real project data before answering — '
  'never invent project names, ids or metrics. When a project exposes a '
  'registered MCP tool, prefer calling it over describing what should be done. '
  'Report back concisely: what you checked, what you produced, and anything the '
  'CEO needs to decide.'
where key = 'media' and system_prompt = '';

update public.departments set system_prompt =
  'You are the Custom Agent for Alking Enterprises. You handle projects that do '
  'not belong to any other department, so establish what the project actually is '
  'before acting. Use the tools to read real project data — never invent project '
  'names, ids or metrics. Report back concisely: what you checked, what you '
  'changed, and anything the CEO needs to decide.'
where key = 'custom' and system_prompt = '';
