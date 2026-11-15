# Performance & dependency review

Measured, not guessed. Scope: the database queries behind the new pages, application-level query patterns, data growth, and the
dependency audit. Not covered: browser rendering/Web Vitals on a live deployment, and load behaviour under concurrent users (this is a
single-owner system).

## Method

A scratch Postgres 16 with all migrations applied was loaded with a realistic volume — **400,000 `agent_logs`** (90 days, the retention window),
**40,000 `agent_runs`**, 60 projects — and each query the dashboard, agents, MCP, skills, project and Social Studio pages issue was run under
`EXPLAIN ANALYZE`.

## Results

| Query (page) | Time | Plan |
|---|---|---|
| MCP call history, last 7 days, newest 1,000 | 13 ms | index scan on `created_at` + filter |
| Failed calls in 24 h (dashboard count) | 12 ms | bitmap scan on `created_at` |
| Last 5 failures (dashboard) | 0.4 ms | index scan |
| Failures per agent, 7 days (Agents) | 10 ms | index scan on `created_at` |
| Skill usage log (`payload @> {skill_id}`) | 6 ms | index scan + filter |
| Last 20 entries for a project (project page) | 0.3 ms | `created_at` / `project_id` index |
| In-flight tile (`pending`/`awaiting_approval`) | 30 ms | parallel seq scan (existing tile uses planner estimates) |
| Agent runs, 30 days, 5,000 rows (Agents/dashboard) | 4 ms | index scan |
| AI daily-cap count | 1.7 ms | bitmap scan |

**Conclusion: no new database index is needed at this scale.** (A first reading of 216 ms for the project page was a measurement artifact — a
sub-select hides the id from the planner; with the literal id the app sends it is 0.3 ms.)

## Fixed

- **N+1 in Social Studio → Content**: the page ran 3 queries *per draft* (≈300 for 100 drafts). Now `getContentRelations` loads variants and attachments for
  all drafts in **3 queries total**, checks ownership, and returns nothing for foreign ids (`tests/social-relations.test.ts` pins the constant query count).
- **Unbounded growth**: automation runs, analytics snapshots and failed/cancelled social jobs had no retention. Migration `0034_retention.sql` adds
  `prune_automation_runs` (finished runs only, default 90 days, `AUTOMATION_RETENTION`) and `prune_social_data` (analytics snapshots and failed/cancelled jobs,
  default 180 days, `SOCIAL_RETENTION`); the existing daily cron (`/api/maintenance/prune`) calls them. **Succeeded jobs (publishing history) and queued/running runs are never
  deleted.** Verified on real Postgres; a missing function (migration lag) never fails the log prune.
- Existing pages keep working while migrations lag (see `docs/DEPLOYMENT.md`, `src/lib/schema-compat.ts`).

## Checked and left alone

- Dashboard overview: ~20 small queries run in parallel and each degrades alone; `fetchDepartments` is request-cached so it is not repeated.
- Loops that touch the database (analytics collection ≤ 10 jobs, schedule tick ≤ 20, skills import ≤ 50) are bounded per run.
- Task counts and run/tool aggregates are summed in application code over bounded reads (5,000 / 1,000 rows). Fine for one owner; move to SQL aggregation if volume grows 10×.
- Largest client chunks in the build are 352 KB and 288 KB (framework/runtime); no oversized page-specific bundle was found. Not profiled in a browser.

## Dependencies (`npm audit`)

Start of this review: 18 advisories → **15, high 4 → 1, critical 0.**

- Closed with `overrides`: `vite` ^8.3.8, `source-map-js` ^1.2.2, `js-yaml` ^4.3.2 (tests/lint/build re-verified).
- **Remaining high — `brace-expansion`** (dev tool via ESLint's glob matching): CPU denial of service on crafted patterns; no runtime exposure. Not overridden because the
  1.x and 5.x lines are consumed by different packages and a blanket override would break them.
- **Remaining moderate (14)**: `@sentry/nextjs` build plugins (`glob`/`minimatch`), `vitest`/`@vitest/mocker`, `eslint-config-next`/`typescript-eslint`. All build/test-time; none ships in the
  runtime bundle. Fixes are major upgrades: **Sentry 11** was tried and reverted — it removes the `enableLogs` option that the three Sentry config files use, and changing error-tracking
  configuration blindly could silently drop logs. Do it deliberately with Sentry's migration guide. `vitest` 5 and the `eslint-config-next` "fix" (a downgrade) are not worth the churn.

Re-run `npm audit` before each production deploy.

## Manual checks worth doing on the live deployment

- [ ] Open `/dashboard`, `/dashboard/agents`, `/dashboard/mcp`, `/dashboard/social-studio?tab=content` and compare server timings (Vercel logs) with the numbers above.
- [ ] After the first cron run following migration 0034, confirm `/api/maintenance/prune` returns `automationRuns` and `socialData` numbers (not `null`).
- [ ] Check Vercel function duration for `/api/social/run` and `/api/automation/run`; both are capped at 300 s.
