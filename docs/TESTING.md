# Testing

`npm test` (Vitest) — all external APIs are **mocked**; no test touches a real platform, and mocks are never
evidence that a live integration works.

| Area | Tests |
|---|---|
| OAuth callback security (2FA/role/state) | `integrations-callback-2fa.test.ts` |
| Provider registry, validation, job state machine, backoff, timezones | `social-core.test.ts` |
| Engine branches; YouTube adapter | `social-engine.test.ts` |
| Facebook/Instagram adapters | `social-meta.test.ts` |
| TikTok adapter (chunking, privacy, confirmation) | `social-tiktok.test.ts` |
| Analytics rules/collectors | `social-analytics-core.test.ts`, `social-analytics.test.ts` |
| Calendar math | `social-calendar.test.ts` |
| AI assistant | `social-ai.test.ts` |
| Agent permissions and tools | `social-agents-core.test.ts`, `social-agents.test.ts` |
| Per-tool MCP policy (pure + engine integration, fail-safe) | `project-tool-policy.test.ts` |
| MCP protocol client (JSON/SSE, session, pagination, errors) | `mcp-client.test.ts` |
| MCP call statistics | `mcp-stats.test.ts` |
| Skills rules: validation, schemas, placeholders, render, import/export | `skills-core.test.ts` |
| Skill versioning, optimistic lock, restore | `skills-store.test.ts` |
| Cron parsing, next-run, DST/leap/timezone | `automation-cron.test.ts` |
| Definition validation, templating, conditions, backoff | `automation-definition.test.ts` |
| Run engine: resume, retries, conditions, pause, failure paths | `automation-engine.test.ts` |
| Schedule tick, idempotency, rate limit, events | `automation-store.test.ts` |
| Unattended step executors (allowlist, approval, retry safety, email) | `automation-runtime.test.ts` |
| Task rules: validation, board order, progress, overdue | `tasks-core.test.ts` |
| Task storage: append, completion stamps, reorder, counts | `tasks-store.test.ts` |
| Agent governance rules, validation, performance metrics | `agent-config.test.ts` |
| Agent runtime: disabled, read-only, allowlist, project scope, forced read-only | `department-agent.test.ts` (extended) |
| Agent management actions (self-test forces read-only, built-ins protected) | `agents-actions.test.ts` |
| Dashboard rules: config health, warnings, budget states | `overview-core.test.ts` |
| Dashboard data: per-card isolation, real figures, no secret values | `overview-fetch.test.ts` |
| Batched content relations (constant query count, owner scoping) | `social-relations.test.ts` |
| Retention cron route | `maintenance-prune.test.ts` |
| Schema-lag fallbacks | `schema-compat.test.ts`, `schema-compat-tools.test.ts` |
| Security guards: server-action/route auth, rate-limit coverage, secrets in URLs, unsafe APIs | `security-guards.test.ts` |
| Existing suites (MCP, policy, approvals, budgets, …) | unchanged, still passing |

Database behaviour (claim/SKIP LOCKED, duplicate key, stale-lock reclaim, success constraint, constraint on `agent_runs.kind`)
was verified by hand against a scratch Postgres 16; migrations are rebuilt from scratch in CI. These checks are not yet
automated as a test suite.

## Browser smoke test (real Chromium, anonymous visitor)

`tests/e2e/smoke.mjs` (`npm run test:e2e`) drives a **running production build** with Playwright and checks 11 things: sign-in
renders RTL Arabic with email/password fields; CSP (nonce, frame-ancestors) and nosniff headers; `/dashboard/social-studio`
redirects anonymous visitors to sign-in; `/api/social/run` returns 401 without or with a wrong secret; OAuth `connect` needs a
session; OAuth `callback` without a session redirects with an error. It was run green against a local build with a scratch
Postgres (migrations applied) as `DATABASE_URL`:

```
RATE_LIMIT_ALLOW_IN_MEMORY=1 BETTER_AUTH_SECRET=... BETTER_AUTH_URL=http://localhost:7070 DATABASE_URL=<scratch pg> \
  NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:1 SUPABASE_SERVICE_ROLE_KEY=x OWNER_EMAILS=o@example.com npm start
node tests/e2e/smoke.mjs
```

It is not wired into CI.

## Not covered

- **Authenticated end-to-end flows** (login, media upload, draft, schedule, publish, history, agents, analytics refresh) — not
  implemented; they need a Supabase project (PostgREST + Storage) and a seeded owner. Extending the Playwright smoke test with a
  seeded session is the recommended next step.
- Server actions are not invoked directly in tests (they depend on Next request context); their logic is covered through the
  pure modules they call.
- UI components have no component tests.
