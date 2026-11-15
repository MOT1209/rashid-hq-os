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
| Existing suites (MCP, policy, approvals, budgets, …) | unchanged, still passing |

Database behaviour (claim/SKIP LOCKED, duplicate key, stale-lock reclaim, success constraint, constraint on `agent_runs.kind`)
was verified by hand against a scratch Postgres 16; migrations are rebuilt from scratch in CI. These checks are not yet
automated as a test suite.

## Not covered

- **Browser end-to-end tests** (login, upload, draft, schedule, publish, history) — not implemented; they need a Supabase
  project and seeded owner. A Playwright suite is the recommended next step.
- Server actions are not invoked directly in tests (they depend on Next request context); their logic is covered through the
  pure modules they call.
- UI components have no component tests.
