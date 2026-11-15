# Architecture

RASHID HQ OS is a **single-owner** Next.js 16 (App Router) application on Vercel with one Supabase
Postgres. The browser never talks to the database: every read/write is server-side with the service-role
key, and RLS is enabled with no policies (anon/authenticated are revoked). See
`docs/ARCHITECTURE-CURRENT.md` for the original control-plane description; this page adds Social Studio.

## Planes

```
Browser ──► Server components / server actions (requireSession / requireAdmin)
        ──► Route handlers: /api/console, /api/integrations/*, /api/social/run
External agent ──Bearer──► /api/mcp, /api/mcp-server  ──► runTool() (scope → policy → approval → audit)
Cron (Vercel / GitHub Actions) ──CRON_SECRET──► /api/social/run, /api/maintenance/*, /api/agent/*
```

## Social Studio

```
src/lib/social/
  providers.ts        capability registry (static, browser-safe)
  validation.ts       per-platform variant validation (pure)
  jobs.ts             state machine, backoff, idempotency, timezone parsing (pure)
  store.ts            owner-scoped queries (untyped client; every query filters owner_id)
  engine.ts           processJob (pure orchestration over Deps) + runDueJobs (claim_social_jobs)
  adapters/           youtube.ts · meta.ts (Facebook, Instagram) · tiktok.ts
  analytics-core.ts   cadence + metric rules (pure) · analytics.ts collectors/snapshots
  calendar.ts         date math in the owner's timezone (pure)
  ai-prompts.ts / ai.ts          suggestion-only assistant, usage ledger, daily cap
  agents-core.ts / agents.ts     six agents, 8 permissions, gated real tools
  summary.ts          dashboard counts
src/lib/integrations/providers/  google.ts · meta.ts · tiktok.ts   (OAuth only — one OAuth system)
src/app/dashboard/social-studio/ page.tsx (tabs) · actions.ts (all mutations)
src/app/api/social/run/route.ts  worker: publish due jobs, then collect analytics
```

Key decisions:

- **One OAuth system.** Social platforms are ordinary entries in the integrations registry; tokens live
  encrypted in `integration_connections`. `social_accounts` only records which channel/page a connection posts to.
- **Persistent queue, no in-memory timers.** `social_publish_jobs` + `claim_social_jobs()` (`FOR UPDATE SKIP LOCKED`,
  stale-lock reclaim after 15 min). The worker is any HTTP caller with `CRON_SECRET`.
- **Approval boundary.** Only `confirmPublishAction` creates jobs (owner, role + 2FA policy). AI and agents cannot.
- **Success is confirmed by the platform** (adapter result with an id; also a DB check constraint).
- **Ambiguous failures never auto-retry** (connection lost after bytes may have been accepted).
- **Capability-based providers**: adding a platform = a provider entry, an adapter, and a `case` in the engine.

## Data

See `docs/DATABASE.md` (procedure) and the "Social Studio tables" section there. Migrations 0024–0027.

## Not built

A general automation/workflow engine, Skills Manager import/export/versioning, per-project agents and MCP
tooling UI, a project task board, and authenticated browser E2E flows (only an anonymous smoke test exists). These sections of the original brief remain open.
