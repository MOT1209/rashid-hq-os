# Rashid HQ OS — Roadmap

Migration strategy from the current single-owner console to the Company OS in
`ARCHITECTURE-TARGET.md`, ordered so nothing working breaks. Derived from
`AUDIT-PHASE-0.md`. Priorities: 🔴 P0 · 🟠 P1 · 🟡 P2 · 🔵 P3.

## Phase 0.5 — Stabilise production (before any new features)

Close the operational P0/P1s. No new product surface.

- 🔴 **Verify prod env vars.** Confirm `BETTER_AUTH_SECRET`, `CRON_SECRET`,
  `SENTRY_DSN`, `KV_REST_API_*` set in Vercel Production. Add a boot assertion
  that refuses the Better Auth default secret in production.
- 🔴 **Migration automation.** Add a migrations ledger + a CI job that applies
  `supabase/migrations/*` in order against an ephemeral Postgres, and a deploy
  gate that fails if prod schema ≠ code. This is the fix for the drift that this
  audit caught.
- 🔴 **DB availability.** Move off free-tier auto-pause (or add an uptime
  pinger) so the DB can't pause under production.
- 🟠 **Unify the approval path** through the executor; add `expires_at`; report
  failures to Sentry.
- 🟠 **Trace correlation.** Thread a `run_id` from ctx → `agent_runs` →
  `agent_logs` → `tool_approvals` → Sentry tag.
- 🟠 **Backups scheduled** (not just the on-demand `npm run db:backup`).

Exit criteria: env verified, migration CI green, approval unified, `run_id`
end-to-end, backups scheduled.

## Phase 1 — Foundations for breadth

Introduce the seams the target needs, reusing the executor and registry.

- 🔵 **Model Gateway** behind the existing `languageModel()` seam: multi-provider
  + fallback/retry/timeout + per-model cost table. Feeds real FinOps.
- 🟠 **Budget hardening:** currency via the cost table, calendar periods, atomic
  reservation, console cap.
- 🟡 **Agent Registry** table; make the console and departments registry
  entries (identity, versioned prompt, tools, model, budget, memory scope).
- 🟡 **Versioning** for prompts and policies (diffable, auditable).
- 🟡 **Integration + E2E tests:** MCP transports, auth/RLS, sign-in→tool→
  approval→audit; migration-apply already in CI from Phase 0.5.

## Phase 2 — Memory & orchestration

- **Company Memory:** short-term (run) + project + company knowledge, with
  explicit retrieval, isolation, retention. Exposed as governed tools.
- **Knowledge / RAG** as a tool behind the same policy gate.
- **Workflow engine:** declarative multi-step tasks over the tool registry,
  every step sharing a `run_id`.
- **A2A depth > 1:** typed, budget-propagating, identity-preserving.

## Phase 3 — Intelligence & autonomy (gated on eval + events)

- **Event bus** (domain events → triggers, alerts, workflows).
- **Evaluation harness** (golden tasks scoring agent/prompt/policy changes).
- **Security Center** surface.
- Only then: broader autonomous operation, still human-approved for
  policy/budget/registry changes.

## Sequencing rule

Do not start Phase 1 breadth until Phase 0.5 is done and verified in production.
Every phase keeps the five invariants in `ARCHITECTURE-CURRENT.md` intact.
