# Rashid HQ OS — Phase 0 Audit

**Repository:** `MOT1209/rashid-hq-os`
**Audited commit:** `0b1ba33` (branch `main`)
**Date:** 2026-09-27
**Scope:** Audit only. No product behaviour was changed. The only mutations made
during this window were operational fixes explicitly requested by the owner
(applying pending DB migrations, restoring a paused Supabase project) and one
safe correctness fix (making migration 0019 re-runnable); each is logged in
§ Safe Fixes.

Priority legend: 🔴 P0 blocker · 🟠 P1 high · 🟡 P2 important · 🔵 P3 improvement · ⚪ P4 nice-to-have.

---

## 1. Executive summary

Rashid HQ OS is a **single-tenant "CEO console"**: a Next.js 16 (App Router)
app on Vercel, backed by one Supabase Postgres, with Better Auth for owner
sign-in and a bearer-token MCP surface for external agents. Its real, working
core is a **governed tool-execution engine**: every tool call — from the
in-browser console, a delegated department agent, the standing-task cron, or
either MCP transport — funnels through one executor that enforces scope, then
policy, then approval, and writes an audit row. That central boundary is the
strongest part of the system and is genuinely well built.

It is **not yet** the "Company Operating System" the brief envisions. There is
no agent registry, no workflow engine, no company memory or RAG, no model
gateway, no event bus. What exists is a solid **control plane for a small,
fixed set of registry tools** plus a department-agent delegation primitive.

The most serious issues are operational, not architectural:

- 🔴 **Schema drift with no migration automation.** At audit time the
  production database was **five migrations behind** the deployed code
  (0017–0021 unapplied). Features the live code assumed — DB policies,
  budgets, tracking — would have thrown at runtime. Migrations are applied by
  hand, by copy-paste, with nothing in CI or deploy verifying the DB matches
  the code. This *will* recur.
- 🔴 **`BETTER_AUTH_SECRET` default-secret errors in production logs** on the
  cron routes (last seen the day of this audit). Strong signal the secret is
  unset in the Vercel production env, which makes auth insecure/broken.
- 🔴 **Supabase project was paused (INACTIVE)** while production pointed at it —
  a full outage of every DB-backed feature. Free-tier auto-pause is a
  structural availability risk for something called an "OS".

The codebase quality is high: strict TypeScript, 382 passing unit tests,
thoughtful security comments, fail-safe error handling. The gaps are breadth
(most target systems don't exist) and operational hardening (migrations,
env-var verification, integration tests, tracing correlation).

**Overall status: functional single-owner console, NOT production-hardened for
autonomous operation.** Do not describe it as production-ready until the P0s
below are closed and verified.

---

## 2. Current architecture

```
                          RASHID HQ OS  (Next.js 16 on Vercel)
                                     |
        +----------------------------+----------------------------+
        |                            |                            |
   BROWSER (React 19)         CONTROL PLANE (server)        EXECUTION PLANE
   - CEO console (useChat)    - src/proxy.ts (CSP + rate    - runTool()  <-- the
   - dashboard pages            limit, Upstash/in-mem)          single choke point
   - SSE activity stream       - Better Auth (owner)        - tools registry (15 tools)
        |                      - agent tokens (agents)       - call_project_tool ->
        |  same-origin API     - session/role guards            SSRF-guarded fetch
        +--------------------->|                            - delegate_to_department ->
                               |                                department agent (depth<=1)
                               v
                        CENTRAL EXECUTOR (src/lib/mcp/executor.ts: runTool)
                               |
                 +-------------+-------------+-------------+
                 |             |             |             |
              SCOPE          POLICY       APPROVAL       AUDIT
            (token         (DB rows      (tool_        (agent_logs
             scopes)        0017 +        approvals)    via activity)
                            code fallback)
                               |
                               v
                        Supabase Postgres (service-role only; RLS on, no policies)
                               |
                 agent_logs · agent_runs · policies · tool_approvals · budgets
                 departments · projects · project_tools · members · auth tables
                 integrations · webhook_events · tracking_*

   OBSERVABILITY:  Sentry (@sentry/nextjs, no-op without DSN) + console logs
   SCHEDULED:      Vercel Cron -> /api/maintenance/prune, /api/agent/daily-check,
                                  /api/agent/standing-tasks
```

Legend of maturity is in `docs/ARCHITECTURE-CURRENT.md` (per-component
EXISTS / PARTIAL / MISSING / NEEDS REFACTOR).

The one architectural fact that dominates everything: **the browser never talks
to Postgres.** All reads/writes go through server code using the Supabase
service role. RLS is enabled on every table with *zero* policies, and
`anon`/`authenticated` are revoked. This is deliberate and correct for a
single-tenant server-rendered app — see § Database and § Security.

---

## 3. Database audit

Migrations `0001`–`0021`, applied in filename order by hand (no runner, no
`supabase/config.toml`). Every file is written to be re-runnable.

| # | Adds | Notes |
|---|------|-------|
| 0001 | projects, agent_logs, project_tools; realtime publication | base |
| 0002 | anon SELECT policies | **historical** — dropped by 0004 |
| 0003 | agent_tokens | FK to projects |
| 0004 | drops anon policies; revokes anon/auth; RLS on auth tables | the security posture |
| 0005 | Better Auth tables (user/session/account/verification/rateLimit) | |
| 0006 | agent_logs retention | |
| 0007 | departments, project_categories | moved from code |
| 0008 | members + roles | |
| 0009 | twoFactor | |
| 0010 | agent_skills (prompt templates) | |
| 0011 | departments.model | |
| 0012 | departments.standing_task(+enabled) | |
| 0013 | integrations | |
| 0014 | agent_logs.decision columns (policy) | |
| 0015 | tool_approvals | |
| 0016 | agent_runs (cost ledger) | |
| 0017 | policies (DB-driven gate) + 3 seed rows | |
| 0018 | departments budget cols + budget_events | |
| 0019 | webhook_events.content_hash + unique index | was **not** re-runnable; fixed this audit |
| 0020 | tracking_* (4 tables) | |
| 0021 | departments.budget_exhausted_alerted_at | added this audit |

### DATABASE STATUS

**Healthy**
- Consistent security pattern on new tables: `enable row level security` +
  `revoke all … from anon, authenticated`. Verified live: 0 anon/auth grants
  on the six newest tables.
- FKs use `on delete cascade` deliberately (tracking children, budget scope).
- Generated types in `src/types/supabase.ts` match the schema (build + tests
  green against them).

**Warnings** 🟡
- **25 tables report `rls_enabled_no_policy`** (Supabase advisor, INFO). This is
  *by design* (service-role-only access). Documented here so it is never
  "fixed" by adding permissive policies. Do not add anon/authenticated
  policies without a new migration explaining why.
- **No indexes review pass beyond the ones migrations add.** Spot check:
  `agent_runs` is filtered by `agent_name` + `created_at` in `spendForAgent`
  and by time in insights; confirm a composite index exists before volume
  grows (budget_events has one; agent_runs should be checked).
- 0002 is dead-on-arrival (immediately undone by 0004). Kept for honesty;
  fine, but a fresh install runs three throwaway statements.

**Critical** 🔴
- **Schema drift, no automation.** Production ran code from `main` that
  required 0017–0021 while the DB was at 0016. No migration runner, no CI step
  asserting DB == code, no record of applied migrations queryable by the app.
  Applying is manual copy-paste. This is the top database risk.

**Missing**
- A migrations ledger the app can read (which are applied) and a deploy-time
  guard. `docs/DATABASE.md` documents the manual procedure; it needs teeth.

---

## 4. Security audit (most severe first)

🔴 **P0 — `BETTER_AUTH_SECRET` likely unset in production.** Vercel runtime
errors show `BetterAuthError: You are using the default secret` on
`/api/agent/daily-check` and `/api/agent/standing-tasks`, last seen 2026-09-27.
With the default secret, session tokens are signable by anyone. Env vars could
not be read during the audit (Vercel API returned 403). **Action:** verify
`BETTER_AUTH_SECRET` (and `CRON_SECRET`) exist in the Production environment,
then redeploy. Changing the secret invalidates existing sessions.

🔴 **P0 — Supabase project paused under a live deployment.** Total DB outage
until restored. Free-tier auto-pause means this recurs. **Action:** upgrade the
plan, or add an uptime pinger, before treating this as production.

🟠 **P1 — Approval execution bypasses the central executor.**
`approveToolCall` (src/lib/approvals.ts) re-implements execute→finish instead of
routing through `runTool`. It *does* re-check scope and policy against current
rules (good, and it correctly refuses a `deny`/scope failure even on an admin
click). But a failure there is **not** reported to Sentry (the executor's
`captureAgentError` path is skipped), and there is **no approval expiry** — a
pending approval can be actioned arbitrarily far in the future. Approval is
otherwise well bound: user (decided_by), agent/tool/args/project/ctx are stored
and policy+scope are re-evaluated at click time.

🟡 **P2 — Two MCP transports duplicate the auth/size glue.** `/api/mcp`
(hand-rolled JSON-RPC) and `/api/mcp-server` (SDK, Streamable HTTP) both
correctly funnel execution through `runTool`, but each re-implements the 512 KiB
body cap and token→context bridging. Drift risk, not a hole today.

🟡 **P2 — Unauthenticated `ping` on `/api/mcp`.** Intentional (the daily
health check pings project endpoints without creds). Dispatched before auth.
Acceptable; note it as a deliberate unauthenticated surface.

**Boundaries that are correct (verified):**
- SSRF: `assertSafeEndpoint` resolves DNS and rejects private v4/v6 (including
  `::ffff:` mapped and octal/hex literals); `pinnedDispatcher` connects only to
  the vetted address so a rebind between check and fetch can't reach internal
  hosts; outbound `redirect: "manual"`; `call_project_tool` signs the body with
  HMAC + timestamp (`OUTBOUND_SIGNING_SECRET`).
- Tokens: 256-bit random, stored as HMAC digest (pepper) or SHA-256 legacy,
  constant-time compare, revoke/expiry enforced in `verifyAgentToken`.
- Multi-tenant-ish isolation: project-pinned tokens fail on any other
  `project_id`; every mutating tool checks `ownsProject(ownerId)`.
- Body caps (512 KiB) on both MCP transports; email HTML escaped; CSP with
  per-request nonce + `strict-dynamic`.
- Rate limiting now fails-fast in production without a shared store (this
  audit's prior work).

Full request→response security flow is in § MCP audit.

---

## 5. Agent audit

Two agent "kinds", both stateless per invocation:

| | CEO Console | Department agent |
|---|---|---|
| Where | `/api/console` (streamText) | `src/lib/department-agent.ts` (generateText) |
| Trigger | signed-in admin | `delegate_to_department` tool, or standing-task cron |
| Identity | actorType `person`, agentName "CEO Console" | actorType `department_agent` / `standing_task_routine` |
| Tools | all 15 (schema-inferred) | all except `delegate_to_department`; **autonomous** mode = read+`call_project_tool` allowlist |
| Steps | `stepCountIs(8)` | `stepCountIs(6)` |
| Budget | **exempt** (owner-driven) | checked before run (per department) |
| Model | `languageModel()` (Groq) | `languageModel(department.model)` |
| Memory | client-held chat history (≤60 msgs) | none — single task string |

Observations:
- 🟡 Console is exempt from budget, so a runaway console session has no cost
  cap. Documented intent, but a "cost-control" system with an uncapped path is
  a gap.
- 🔵 Department agents are truly stateless: they get one task string and cannot
  see the console conversation (by design; comment says so). No project/agent
  memory.
- Delegation identity/owner propagation is correct.

---

## 6. Delegation audit

`delegate_to_department` → `runDepartmentAgent`. Verified:
- **Depth cap = 1.** A delegated agent runs at `delegationDepth: 1`; the tool
  refuses when depth ≥ 1. `delegate_to_department` is also physically withheld
  from the department agent's toolset. Two independent guards — good.
- Owner id propagated (created resources stay editable).
- Autonomous (cron) runs get a **read + `call_project_tool` allowlist**, so a
  prompt injection in third-party MCP output can't restructure the registry;
  reinforced by the `standing-task-write-guard` policy row. Defence in depth.
- Budget checked before the model call; failure recorded and re-thrown as a
  referenced error (this audit's prior work) so raw provider text stays out of
  the model context.
- 🟡 No cross-agent trace id: a delegated run's `agent_runs` row and its tool
  `agent_logs` rows share only `agent_name`, not a run id.

No privilege-escalation-via-delegation path found.

---

## 7. MCP audit — full flow

```
POST /api/mcp-server (or /api/mcp)
  -> content-length gate + measured 512 KiB cap        [both transports]
  -> verifyAgentToken(Authorization: Bearer)           -> 401 if missing/revoked/expired
  -> (SDK builds AuthInfo.extra = {agentName, projectId, ownerId})
  -> runTool(tool, parsedArgs, ctx)                    [THE choke point]
       -> scopeDenialReason(tool, ctx.scopes)          -> deny + audit
       -> evaluatePolicyAsync(tool, ctx)               -> deny / require_approval / allow
            require_approval -> startActivity(awaiting) -> queueApproval -> return {queued}
       -> startActivity(allow)
       -> tool.execute(args, ctx)
            call_project_tool -> assertSafeEndpoint -> HMAC sign -> fetch (manual redirect, pinned DNS)
       -> finish(success|failed)  [+ captureAgentError on unexpected/timeout]
  -> response (SSE-framed for /api/mcp-server; plain JSON for /api/mcp)
```

Checklist: authentication ✅ · scopes ✅ · token validation/expiry ✅ · replay
protection ⚠️ (bearer tokens are reusable by design; no per-call nonce inbound —
outbound has HMAC+timestamp) · project isolation ✅ · tool allowlist (autonomous)
✅ · policy ✅ · approval ✅ · request size ✅ · timeout handling ✅ (30 s on
outbound; classified in Sentry) · malformed request ✅ (typed method guard,
zod parse) · SSRF ✅ · outbound security ✅ · error leakage ✅ (dbError refs) ·
audit logging ✅.

**No tool-execution path bypasses `runTool`** — except the **approval executor**
(§ Security P1), which re-validates scope+policy but skips Sentry and has no
expiry. That is the one divergence to close.

Documentation for external integrators: `MCP-INTEGRATION.md` (this audit's prior
work), verified against the running route (SSE framing, 406 on missing dual
`Accept`, stateless `tools/call`).

---

## 8. Policy & approval audit

**Policy** (src/lib/policy.ts): DB rows (0017) evaluated first-match-by-priority,
cached 30 s in-process, with the hard-coded `POLICY` array as fallback on any DB
error — so the gate **never fails open or closed**. Default when no rule
matches: read → allow, write → require_approval (fail-safe). Seed rows:
1. `standing-task-write-guard` (deny) — cron may not write beyond `call_project_tool`.
2. `delete-project-needs-approval` (require_approval).
3. `already-guarded-writes` (allow) — the writes already safe behind ownership/SSRF.

Verified live: all three rows present and enabled on production.

🟡 Cache invalidation is only via `clearPolicyCache()` on admin toggle in the
same process; on serverless, other instances keep a stale cache ≤30 s. Bounded
and acceptable, but note it.

**Approval** (src/lib/approvals.ts): bound to user/agent/tool/args/project/ctx;
re-validates scope+policy at approve time against current rules; an admin click
satisfies only `require_approval`, never overrides `deny`/scope. Weaknesses:
no expiry, no Sentry on failure, executes outside `runTool` (§ P1).

---

## 9. Observability audit

- **Errors:** `captureError` → Sentry (no-op without DSN) with a UUID ref shown
  to the client and logged. `captureAgentError` (this audit's prior work) adds
  searchable tags `agent_name/tool_name/project_id/actor_type/delegation_depth/
  failure_kind` on an isolated scope, timeouts as warnings grouped per tool.
- **Audit:** `agent_logs` (per tool call, with decision + actor_type) and
  `agent_runs` (per model run: tokens, duration, steps, status).
- **Live:** `/api/activity/stream` SSE feed to the dashboard.

🟠 **P1 — no correlation id.** `agent_runs`, `agent_logs`, `tool_approvals`, and
Sentry events cannot be stitched into one trace. There is no `run_id`/`trace_id`
threaded through a request. This is the highest-value observability fix and the
prerequisite for any future workflow/eval system.

---

## 10. Cost & budget audit

`agent_runs` is the single source of truth; `spendForAgent` sums tokens over a
**rolling 30-day** window (not a calendar month, despite "monthly" naming).
`checkDepartmentBudget` gates before a department run: ≥80 % mails once/day,
≥100 % blocks + mails once/day (this audit's prior work). Fail-safe: any ledger
error → allowed.

Findings:
- 🟠 **Read-then-check race / overshoot.** Two concurrent runs can both read
  sub-budget and both proceed; a single run can overshoot by its own spend
  (bounded by MAX_STEPS). No atomic reservation. Acceptable for low volume,
  documented in code.
- 🟡 **Console is unbudgeted** (§ Agents).
- 🟡 **Unit is tokens, not currency**; no per-model price. Fine for a guardrail,
  not for real FinOps.
- 🔵 Naming: "monthly" ⇒ rolling 30 d. Rename or switch to calendar month.

No double-counting found (one `recordAgentRun` per run path; failure path
records status=failed with stepCount 0).

---

## 11. Error handling & recovery

Classification today is binary: `dbError`-shaped (already-reported, has a
`Reference:` UUID) vs unexpected (captured). Timeouts are detected
(`isTimeoutError` walks the cause chain) and marked warnings. Tool failures are
returned to the agent as data, never thrown into the loop (so one bad tool call
doesn't abort a run). There is **no retry/fallback/escalate ladder** — by design
for Phase 0. Recoverable vs permanent is not distinguished beyond timeout.

---

## 12. Frontend / UX audit

7 dashboard pages (access, activity, insights, projects, settings, tracking,
home) + 26 components. React 19, server components + a few client islands
(`ceo-console`, `activity-stream`, managers). i18n (ar/en) with RTL. Theming via
`theme.ts`. Loading/skeleton components present.

Verdict: **KEEP / IMPROVE.** The UI is coherent for a single-owner console. It
is **not** structured as a multi-surface "Company OS" (no agents registry view,
no workflow view, no memory/knowledge view, no security center). Those are new
surfaces for later phases, not refactors of what exists. No evidence of a11y or
responsive testing; not audited in depth here (no runtime access to the live UI
from this environment — proxy blocked the deployment URL).

---

## 13. Testing audit

43 test files, **382 unit tests, all passing**. Strong coverage of the security
core: `executor` (audit contract), `policy` / `policies-db`, `approvals`,
`mcp-authorization`, `token-hashing`, `safe-endpoint`, `outbound-signing`,
`delegation`, `budgets`, `revoke-permission`, `mcp-body-cap`, `session-role`.

Gaps (🟠/🟡):
- **No integration tests.** Supabase is mocked everywhere; no test runs against
  a real Postgres, real RLS, or a real HTTP MCP round-trip. Auth, RLS revokes,
  and the two transports are only exercised via mocks (I ran manual probes this
  session; they should be automated).
- **No E2E** (sign-in → console → tool → approval → audit).
- **No migration test** (apply-all-in-order against a fresh DB in CI) — exactly
  the check that would have caught the production drift.
- No security regression suite beyond unit level.

Testing-gap priority list: migration-apply CI check (P0), MCP transport
integration test (P1), auth/RLS integration test (P1), approval-expiry +
Sentry-on-approval-failure tests once fixed (P1), E2E smoke (P2).

---

## 14. Production readiness

| Area | State |
|---|---|
| Build | ✅ `next build` green (incl. new prod rate-limit gate) |
| Typecheck | ✅ `tsc --noEmit` clean |
| Lint | ⚠️ 27 warnings (unused `_` in tests), 0 errors |
| Tests | ✅ 382/382 |
| CI | ⚠️ lint+typecheck+test+build on push/PR; **no DB/migration/integration step** |
| Env vars | 🔴 `BETTER_AUTH_SECRET` likely missing in prod; couldn't verify (403) |
| Rate limiting | ✅ fails-fast in prod without Upstash (this audit's prior work) |
| Migrations | 🔴 manual, drifted 5 behind; now caught up |
| Backups | 🟠 `npm run db:backup` script + `docs/DATABASE.md` exist; not scheduled/automated |
| Monitoring | 🟡 Sentry wired but no-op without DSN; verify DSN set |
| Availability | 🔴 Supabase free-tier pause caused an outage |
| Last deploy | ✅ `dpl_3zjWJR6…` (`0b1ba33`) READY |

**Not production-ready** until the P0s are closed and env/DSN verified.

---

## 15. Technical debt (prioritised)

Each: *issue — location — why — risk — fix — complexity.*

🔴 **P0 Schema drift, no migration automation** — `supabase/migrations/*`, deploy
process — code ships expecting tables that may not exist — runtime 500s / silent
feature breakage — add a migrations ledger + CI apply-all against ephemeral
Postgres + a deploy gate — M.

🔴 **P0 Auth secret in prod** — Vercel env — insecure/broken auth — account
compromise — set `BETTER_AUTH_SECRET`/`CRON_SECRET`, redeploy, add a boot
assertion that refuses the default secret in prod — S.

🔴 **P0 DB availability (pause)** — Supabase plan — outage — total downtime —
upgrade plan or add pinger — S.

🟠 **P1 Approval bypasses executor / no expiry / no Sentry** — `approvals.ts` —
divergent path, blind failures, stale approvals — route approval through a
shared execute+report helper; add `expires_at`; capture failures — M.

🟠 **P1 No trace correlation** — logging/schema — can't reconstruct a request —
blocks eval/workflow — add `run_id` (uuid) threaded ctx→agent_runs→agent_logs→
Sentry tag — M.

🟠 **P1 Budget race/overshoot + console exempt** — `budgets.ts`,
`api/console` — cost overrun — atomic reservation or accept+document; add a
console cap — M.

🟡 **P2 Duplicate MCP glue** — `api/mcp*` — drift — extract shared
auth+bodycap wrapper — S.

🟡 **P2 Policy cache staleness on serverless** — `policy.ts` — ≤30 s stale rule —
accept or move to short-TTL shared store — S.

🟡 **P2 27 lint warnings** — tests — noise — prefix-unused cleanup — S.

🔵 **P3 Single model provider hard-wired** — `model.ts` — no fallback/multi-
provider — introduce a model gateway seam (already half-there via
`languageModel()`) — M.

🔵 **P3 No integration/E2E tests** — `tests/` — regressions in transport/auth —
add Testcontainers/ephemeral Supabase — L.

---

## 16. Architecture gap analysis (target vs current)

| Component | Status |
|---|---|
| Company Core | PARTIAL (single tenant, owner allowlist) |
| Agent Registry | MISSING (agents are code + department rows) |
| Department System | EXISTS (DB-driven) |
| Workflow Engine | MISSING |
| Agent-to-Agent (A2A) | PARTIAL (one-level delegation) |
| Company Memory | MISSING (only client chat context) |
| Knowledge / RAG | MISSING |
| Model Gateway | PARTIAL (single seam `languageModel()`, one provider) |
| Tool Registry | EXISTS (15 tools, schema-inferred, typed) |
| MCP Platform | EXISTS (two transports, governed) |
| Policy Engine | EXISTS (DB + code fallback) |
| Approval System | EXISTS (needs expiry + executor unification) |
| Budget System | PARTIAL (tokens, rolling window, race) |
| Event Bus | MISSING |
| Observability | PARTIAL (Sentry + audit; no correlation) |
| Evaluation | MISSING |
| Versioning | MISSING (prompts/policies not versioned) |
| Security Center | MISSING (as a surface; boundaries exist) |
| Company Intelligence | MISSING |
| Autonomous Operations | PARTIAL (standing-task cron, allowlisted) |

Target architecture and migration strategy: `docs/ARCHITECTURE-TARGET.md` and
`docs/ROADMAP.md`.

---

## 17. Dependency map

Lean and justified. Runtime: `next@16.3.1`, `react@19`, `ai@7` +
`@ai-sdk/react` + `@ai-sdk/groq` (the `ai` override pins one copy across the
useChat boundary — documented in package.json), `better-auth` (+bearer,
twoFactor), `@supabase/supabase-js`, `@upstash/ratelimit`+`redis`,
`mcp-handler`, `pg`, `zod@4`, `@sentry/nextjs`, `undici` (SSRF dispatcher),
`lucide-react`, `server-only`. Dev: eslint/next config, tailwind@4, vitest@4,
types. No duplicated or obviously dead runtime deps found. No auto-upgrades
performed.

---

## 18. Consolidated finding lists

**Security findings:** P0 auth secret; P0 DB pause; P1 approval path; P2 dual
transport glue; P2 unauth ping (accepted); replay = bearer-by-design (accepted).
Correct: SSRF, token hashing, isolation, body caps, CSP, outbound HMAC.

**Database findings:** P0 drift/no automation; P2 index review for `agent_runs`;
INFO rls-no-policy ×25 (by design); 0002 dead-on-arrival (accepted); 0019
re-runnability (fixed).

**Testing gaps:** P0 migration CI; P1 MCP transport + auth/RLS integration; P1
approval expiry/Sentry tests; P2 E2E smoke.

---

## Safe fixes made during this audit window

All owner-requested or clearly safe; none change product behaviour.

1. **Applied migrations 0017–0021 to production** (owner-requested).
   *Problem:* prod DB at 0016, code needs 0021. *Safe because:* all five are
   additive (no drop/alter-type/data change), verified by review; data counts
   unchanged after. *Test:* re-queried schema + advisor; RLS on, 0 anon grants.
   *Result:* schema now matches code.
2. **Restored the paused Supabase project** (owner-requested). *Result:*
   `ACTIVE_HEALTHY`.
3. **Made migration 0019 re-runnable** (commit `0b1ba33`). *Problem:* missing
   `if not exists` → second run fails, contradicting the re-runnable contract
   `docs/DATABASE.md` relies on. *Safe because:* guards only; no semantic
   change. *Test:* applied twice on local Postgres 16 (pass) and once on prod
   (no-op, still one index). *Result:* contract honoured.

(Earlier in the session, before this audit prompt: the prod-readiness feature
set in commit `c68af04` — rate-limit fail-fast, agent-aware Sentry, 100 % budget
alert, backup script, MCP guide. Noted for provenance.)
