# Fix security-review findings on `main` (2026-09-21)

Execution plan for the findings in `docs/audits/2026-09-21-security-review.md`.
Everything here is implementable and verifiable locally; live-only steps are
called out explicitly and stay on the checklist.

## Baseline (verified)

- `npm run typecheck` ❌ 7 errors — `main` does not build.
- `npm run lint` ✅ 0/8.
- `npm run test` 312/314 (2 timeouts under first-run parallel load — `token-hashing.test.ts`, `members.test.ts`; both pass alone).
- `next build` ❌ — fails for the same type errors.

## Late discovery: uncommitted budgets WIP (compounding B1)

Before execution it surfaced that the working tree carries an uncommitted
budgets feature on top of B1: `supabase/migrations/0018_budgets.sql`,
`src/lib/budgets.ts`, `tests/budgets.test.ts`, plus edits to `actions.ts`,
`dashboard/insights/page.tsx`, `department-agent-manager.tsx`, `agents.ts`,
`department-agent.ts`, `i18n.ts`, and `department-agent.test.ts`. It is the
user's in-flight work — it is **not** reverted or redesigned here; only its
type/lint surface is matched so the build is green again:

- Budget tables/columns (`budget_events`, `departments.monthly_token_budget` + `.budget_alerted_at`) added to `src/types/supabase.ts` from migration 0018.
- `bestEffort(work: PromiseLike<unknown>)` widen in `budgets.ts` (supabase's `.then()` chains are `PromiseLike`, not `Promise`).
- Fixtures: `agents.test.ts`/`standing-tasks.test.ts` `department()` gained the two budget columns; `department-agent.test.ts` `checkDepartmentBudget` mock typed as `BudgetCheck`; `budgets.test.ts` `sendEmail` mock accepts `…args`.

**Consequence:** migration `0018` is already taken by budgets, so the webhook
dedup migration below is `0019_webhook_dedup.sql`, not `0018`.

## Root cause of the build failure (B1)

Commit `9db38a7` (migration `0017_policies.sql` + `src/lib/policy.ts`) queried the
`policies` table without regenerating `src/types/supabase.ts`:
- `src/lib/policy.ts:115,117,153,162` — `policies.enabled` / table missing from `Database`.
- `tests/approvals.test.ts:149` — `"deny"` not assignable to `"require_approval"` (mock's resolved type was inferred from its default return).
- `tests/policies-db.test.ts:126` — `t.name` on `never` (helper `tool()` casts its result `as never`).

`npm run typecheck` was also slow (15–25 min first run, no incremental cache).
Fixed with `"incremental": true` (already set) + a pinned
`"tsBuildInfoFile": "./node_modules/.cache/tsconfig.tsbuildinfo"` in
`tsconfig.json`, so plain `npm run typecheck` reuses the cache.

## Verified facts that narrow scope (decisions)

- **I2 (actorType optional) — already implemented.** `src/lib/mcp/tools.ts:44` makes `actorType` required and the comment says "Required since 1.1". No work.
- **I3 (daily-check pinned-dispatcher) — not a bug.** `daily-check/route.ts:34` passes `pinnedDispatcher(...)` exactly like `call_project_tool`; an `undefined` dispatcher just means "resolve normally". No work.
- **PKCE plumbing already exists** for OAuth (`oauth.ts` stores `code_verifier`, connect/callback routes thread it through). GitHub is the only OAuth provider that does not use it. So GitHub PKCE is a small, isolated change.
- **M3 (encryption KDF) — deferred, not executed here.** The mitigation for a hashed-at-rest key derived from an env secret is rotating `INTEGRATIONS_SECRET` on the live system, not just changing the KDF. Changing the at-rest format with no rotation adds moving parts for zero security gain. The design is spelled out in Phase 8 so it can be done together with rotation.
- **I7 (service.ts surfaces `configured`)** — by design for an admin-only settings surface; does not leak secret values. No work.
- **L8 (prune grant)** — needs a live SQL check; stays on the checklist, not baked into the migration (signature assumptions could break migration 0018 at apply time).

## Scope of this execution

| # | Finding | Change | Files |
|---|---------|--------|-------|
| P0 | B1 | Fix the type errors so `main` builds again | `src/types/supabase.ts`, `tests/policies-db.test.ts`, `tests/approvals.test.ts` |
| P1 | M1 | Escape every interpolated value in the HTML email templates + tests | `src/lib/email.ts`, new `tests/email-escape.test.ts` |
| P2 | M2, L6 | Webhook dedup on signed content (`content_hash`) + `content-length` precheck + migration `0019` (0018 is taken by budgets WIP) + tests | `src/app/api/webhooks/[provider]/route.ts`, `src/types/supabase.ts`, new `supabase/migrations/0019_webhook_dedup.sql`, new `tests/webhook-route.test.ts` |
| P3 | L2 | Body-size cap on both MCP transports (Content-Length precheck) | `src/app/api/mcp/route.ts`, `src/app/api/mcp-server/route.ts` |
| P4 | I6 | HSTS header when the request arrived over `https` | `src/proxy.ts` |
| P4 | L4 | Bound the `vetted` DNS cache in size | `src/lib/net/safe-endpoint.ts` (+ test hook) |
| P4 | L5 | GitHub OAuth: reduce scope to `read:user public_repo` and gate via PKCE (S256) | `src/lib/integrations/providers/github.ts` |
| P4 | L3 | TLS: verify by default; `SUPABASE_SSL_VERIFY_NONE=1` opts in to disabling | `src/lib/auth.ts`, `scripts/auth-migrate.mjs` |
| P4 | I4 | `list_recent_logs`: honor the token's project binding; owner-scope otherwise; refuse with no provenance | `src/lib/mcp/tools.ts` |
| P5 | — | Contract test for `runTool` (every decision is audited with the right `actor_type`) | new `tests/executor.test.ts` |
| P5 | — | De-flake the two timing-out tests (deterministic wait + wider timeout config) | `tests/token-hashing.test.ts`, `vitest.config.mts` (only if needed for `members.test.ts`) |
| P6 | — | Full verification gate: typecheck, lint, full suite, `next build` | — |

### Live-only (not executable locally; lands on the deploy checklist)
- Apply migrations `0013–0019` to the Supabase project; regenerate `src/types/supabase.ts` afterwards.
- Check `has_function_privilege('service_role','public.prune_agent_logs(interval)','EXECUTE')`; grant explicitly if false (L8).
- Rotate `INTEGRATIONS_SECRET`, then Phase 8 (scrypt KDF + `key_id`).
- Verify HSTS is served over https on Vercel.
- Hold-to-arm note: if `SUPABASE_SSL_VERIFY_NONE` is unset and login stops working on the live deployment (Supabase cert chain), the fix is to set `SUPABASE_SSL_VERIFY_NONE=1` — the change is reversible with an env var.

## Phases (TDD where a test is possible)

### Phase 0 — Unblock build (B1) — ✅ DONE
1. Done: `policies` table added to `src/types/supabase.ts` from `0017_policies.sql`; `budget_events` + departments columns added from 0018 (WIP sync); `content_hash` added for 0019.
2. Done: `tests/policies-db.test.ts` `tool()` returns `{ name, requiredScope }` cast `as unknown as ToolDefinition` (the `matchDbPolicy`/`evaluatePolicyAsync` signatures need the real type).
3. Done: `tests/approvals.test.ts` mock type widened.
4. Gate ✅: `npm run typecheck` exit 0 (warmed via `node_modules/.cache/tsconfig.tsbuildinfo`); the 8 affected test files pass (66 tests).

### Phase 1 — M1: escape HTML emails — ✅ DONE
1. Done: `escapeHtml` exported from `src/lib/email.ts`.
2. Done: wrapped `project.name`, `project.endpoint`, `run.department`, `run.summary`, and the `url` in the reset-email (href + footer). Text bodies untouched.
3. Done: `tests/email-escape.test.ts` (`escapeHtml` unit + each sender escapes an injected value via the stubbed `fetch` body with `RESEND_API_KEY` set).
4. Gate ✅: `npm run test -- email-escape` 5 tests pass.

### Phase 2 — M2/L6: webhook integrity dedup + 413 — ✅ DONE
1. Done: `supabase/migrations/0019_webhook_dedup.sql` (0018 is taken by the budgets WIP): `ALTER TABLE` + partial unique index on `(provider, content_hash) WHERE content_hash IS NOT NULL`.
2. Done: `content_hash: string | null` on `webhook_events` Row/Insert/Update.
3. Done: route rejects 413 from `content-length` before reading; measures after (`request.text()`), then hashes; the `23505` branch already answered `{ ok, duplicate: true }`.
4. Done: provider lookup moved ahead of the body read (unknown provider → 404 without buffering).
5. Done: `tests/webhook-route.test.ts` (mock registry + logger + supabase): 404 body-less, 413 pre-buffer, hash stored, 23505 → duplicate, 401 on bad signature.
6. Gate ✅: 5 tests pass.

### Phase 3 — L2: MCP body caps — ✅ DONE
1+2. Done: `MAX_BODY = 512 KiB` on both transports; `/api/mcp` measures the text (empty → 400, over → 413); `/api/mcp-server` guards `POST` and rebuilds the `NextRequest` with the read body so the SDK never buffers unbounded input.
3. Done: `tests/mcp-body-cap.test.ts` — oversize header → 413; lying header / absent header measured → 413; normal payload passes through to auth.
4. Gate ✅: 6 tests pass.

### Phase 4 — P2 hardening — ✅ DONE
1. **HSTS (I6)** — done in `src/proxy.ts`: `Strict-Transport-Security: max-age=63072000; includeSubDomains` emitted in production builds only (browsers only honour HSTS over https; local dev serves http). Also added `/api/activity/page` + `/api/activity/stream` throttle rules (L1) in the same pass.
2. **Vetted cache cap (L4)** — done in `safe-endpoint.ts`: `VETTED_MAX_HOSTS = 1024`; on overflow evict TTL-expired entries, then the oldest by `at`.
3. **GitHub (L5)** — done in `github.ts`: scopes → `["read:user", "public_repo"]`; PKCE S256 in `buildAuthUrl`; `code_verifier` sent on exchange (oauth.ts/connect/callback already forward it).
4. **TLS (L3)** — done in `auth.ts` + `auth-migrate.mjs`: verification is the default; `SUPABASE_SSL_VERIFY_NONE=1` is the documented opt-out (warning logged).
5. **`list_recent_logs` (I4)** — done in `tools.ts`: pinned to `ctx.projectId` when present, else scoped to the owner's `projects`, else refuses (`{ logs: [] }`) when there is no provenance.
6. Gate: pending in Phase 6 (full typecheck run).

### Phase 5 — Audit-contract + flake hardening
1. New `tests/executor.test.ts`, mock `startActivity`/`finishActivity`, `scopeDenialReason`, `evaluatePolicyAsync`, `queueApproval`, and a stub tool. Cases: scope deny → no `execute`, log decision `deny` + actor_type; policy deny → same; `require_approval` → queued + `awaiting_approval` log; allow → `execute` + success; tool throw (non-dbError) → `failed` + `captureError`. Red before green.
2. `tests/token-hashing.test.ts` — replace the fixed 10ms sleeps with `await vi.waitFor(...)` polls on `updates`.
3. `vitest.config.mts` — raise `test.timeout` to 15 s (slow local first-run transpile), if the flake persists.
4. Gate: full `npm run test`.

### Phase 6 — Final verification gate
- `npm run typecheck`
- `npm run lint`
- `npm run test` (full)
- `next build` (expect ~7 min on this machine) — must go green; if it surface unrelated failures, stop and report rather than "fixing" blindly.
- Summarize diffs; update the audit HTML/MD verdicts that are now resolved; append a "fixed 2026-09-21" section with the checklist. No git commit unless the user asks.

### Phase 8 — Deferred: M3 encryption KDF (do with the next `INTEGRATIONS_SECRET` rotation)
- `src/lib/integrations/encryption.ts:35` — replace `createHash("sha256")` key with `scryptSync(secret, SALT, 32)`; add a `key_id`/version byte to the ciphertext envelope; decrypt tries version 1 then falls back to the legacy sha256 scheme; keep the `sha256().slice(0,8)` signature key as-is (it tags a row, not a key).
- Defer because it changes the at-rest format and must ship with a live secret rotation to have any value.

## Checklist for the user (live deployment)

1. Apply `supabase/migrations/0013` … `0019` (0018 = budgets WIP) to the host project; re-run `npm run typecheck` after regenerating `src/types/supabase.ts`.
2. `select has_function_privilege('service_role','public.prune_agent_logs(interval)','EXECUTE');` → grant if false (L8).
3. Rotate `INTEGRATIONS_SECRET` and do Phase 8 by then (M3).
4. Confirm HSTS header on https responses (Vercel) (I6).
5. If `SUPABASE_SSL_VERIFY_NONE` was unset and prod login breaks, set it to `1` and file the cert-chain reason (L3 rollback).