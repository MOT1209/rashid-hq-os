# Rashid HQ OS — Current Architecture (as built)

Snapshot of what actually exists at commit `0b1ba33`. Companion to
`AUDIT-PHASE-0.md`. Maturity tags: **EXISTS** · **PARTIAL** · **MISSING** ·
**NEEDS REFACTOR**.

## Runtime shape

- **Framework:** Next.js 16 (App Router, Turbopack), React 19, on Vercel.
- **Data:** one Supabase Postgres. **The browser never connects to it.** All
  access is server-side via the service-role key. RLS is enabled on every table
  with no policies; `anon`/`authenticated` are revoked. (migrations 0002→0004)
- **Auth:** Better Auth (email+password) for the owner; role from `OWNER_EMAILS`
  or `members`. Bearer tokens for external agents (`agent_tokens`).
- **Rate limit + CSP:** `src/proxy.ts` (Upstash Redis in prod — now required —
  else in-memory in dev).
- **Errors:** `@sentry/nextjs` (no-op without DSN) + structured console logs.

## Request planes

```
Browser (React) ──same-origin──► Server (App Router)
   CEO console (useChat)            /api/console  (streamText, all tools)
   dashboard pages (RSC)            server actions (src/app/actions.ts)
   SSE activity                     /api/activity/stream
External agent ──Bearer──►         /api/mcp        (hand-rolled JSON-RPC)
                                    /api/mcp-server (SDK, Streamable HTTP)
Vercel Cron ──CRON_SECRET──►       /api/maintenance/prune
                                    /api/agent/daily-check
                                    /api/agent/standing-tasks
```

Every tool call from any of these converges on **`runTool`**
(`src/lib/mcp/executor.ts`): scope → policy → (approval) → execute → audit.

## Component maturity

| Component | Status | Location / note |
|---|---|---|
| Tool registry (15 tools, zod-inferred) | EXISTS | `src/lib/mcp/tools.ts` |
| Central executor | EXISTS | `src/lib/mcp/executor.ts` — the choke point |
| MCP JSON-RPC transport | EXISTS | `src/app/api/mcp/route.ts` |
| MCP Streamable-HTTP transport | EXISTS | `src/app/api/mcp-server/route.ts` |
| Policy engine (DB + code fallback) | EXISTS | `src/lib/policy.ts`, migration 0017 |
| Approval system | EXISTS / NEEDS REFACTOR | `src/lib/approvals.ts` — bypasses executor, no expiry |
| Agent tokens | EXISTS | `src/lib/agent-tokens.ts` — HMAC digest, scope, expiry |
| CEO console agent | EXISTS | `src/app/api/console/route.ts` |
| Department agent + delegation | EXISTS | `src/lib/department-agent.ts` (depth ≤ 1) |
| Standing-task cron | EXISTS | `src/app/api/agent/standing-tasks` (allowlisted) |
| Budgets | PARTIAL | `src/lib/budgets.ts` — tokens, rolling 30 d, race |
| Cost ledger (agent_runs) | EXISTS | migration 0016 |
| Audit log (agent_logs) | EXISTS | `src/lib/activity.ts`, migration 0014 |
| SSRF guard + pinned dispatcher | EXISTS | `src/lib/net/safe-endpoint.ts` |
| Outbound signing (HMAC) | EXISTS | `call_project_tool` in tools.ts |
| Model layer | PARTIAL | `src/lib/model.ts` — single provider (Groq), one seam |
| Observability | PARTIAL | Sentry + audit; **no trace correlation id** |
| Integrations (OAuth/API keys) | EXISTS | `src/lib/integrations`, migration 0013 |
| Tracking register | EXISTS | migration 0020, `/dashboard/tracking` |
| Memory / RAG | MISSING | only client-held chat context (≤60 msgs) |
| Agent registry | MISSING | agents are code + department rows |
| Workflow engine / event bus / eval | MISSING | — |

## Data model (tables in use)

`projects`, `project_tools`, `project_categories`, `departments`, `members`,
`agent_tokens`, `agent_logs`, `agent_runs`, `policies`, `tool_approvals`,
`budget_events`, `integration_connections`, `integration_oauth_states`,
`webhook_events`, `agent_skills`, `tracking_{months,members,cells,scores}`, and
Better Auth `user/session/account/verification/rateLimit/twoFactor`.

## Key invariants worth preserving

1. **One execution boundary.** Never add a tool path that skips `runTool`
   (the approval path is the current exception to fix, not to copy).
2. **Service-role-only DB access.** Don't add anon/authenticated grants or RLS
   policies without a migration explaining why the browser needs direct access.
3. **Fail-safe policy default.** Unknown read → allow, unknown write → approval;
   DB error → hard-coded fallback (never open, never fully closed).
4. **Delegation depth ≤ 1** and the autonomous allowlist — both guard the
   unattended path.
5. **Every migration re-runnable and additive**; types in `src/types/supabase.ts`
   updated in the same commit.
