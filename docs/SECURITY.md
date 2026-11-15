# Security

Single-owner system. Findings below are from reading the code and running `npm audit`; they are not a
penetration test. Earlier audits: `SECURITY-AUDIT-REPORT.md`, `docs/audits/`.

## Systematic entry-point review (latest)

A **code review of every entry point**, not a penetration test (no live exploitation, no fuzzing, no infrastructure testing).

| Check | Result |
|---|---|
| All 70+ server actions | every mutating action calls `requireAdmin()`; the only unguarded are the locale/theme cookie setters; `recordSkillUseAction` uses `requireSession()` (usage-log write) |
| All 20 API routes | each has an authentication/verification step (cron secret, session, integration-owner gate, agent token, signed webhook, project-tool signature, or the auth handler) |
| Rate limiting | **Gap found and fixed:** `/api/social` and `/api/automation` (worker routes) had no rate-limit rule while the older cron routes did; each unauthenticated hit costs a session lookup. Added `10/min` rules |
| Secrets in URLs | **Found and fixed:** Meta token revocation sent the access token in the query string (same class as an earlier fix in the adapters) → `Authorization` header |
| Injection / unsafe APIs | no `eval`, `new Function`, `dangerouslySetInnerHTML` or `child_process`; the two string-built PostgREST filters take server-generated values or a sanitised search term |
| Logging | no token/secret values reach `console.*`; log lines carry ids and subjects only |
| Committed secrets | scan of tracked files for common key formats: none; `.env.example` holds placeholders only |
| Owner scoping | every Social/Automation/Task/MCP action re-checks ownership of the object it touches (verified by reading each action) |

**Permanent guards** (`tests/security-guards.test.ts`, verified to fail when a violation is planted): every server action must call `requireAdmin`/`requireSession` (or be allowlisted);
every API route must contain an authentication step; every cron-authenticated route must sit under a rate-limit rule in `src/proxy.ts`; no URL may embed
`access_token`/`api_key`/`client_secret`/`refresh_token`; no `eval`/`dangerouslySetInnerHTML`/`child_process`.

**Known residual risks (not fixed):** the manual owner path of the cron routes (`authorizeCron`) checks the owner email but not the 2FA policy — it only triggers work that was already approved
(publishing queue items, saved automations, retention); viewer-role members can read all dashboard data by design; storage uploads trust the client-declared MIME type (owner-only, size-verified);
`brace-expansion` (dev tool) advisory remains. A real penetration test of the deployed system is still recommended.

## Fixed in this work

| Issue | Fix |
|---|---|
| OAuth `/callback` checked the admin role but **not** `REQUIRE_2FA`, so the policy applied at `/connect` could be sidestepped at the second leg | Both use `checkIntegrationOwner()` (`src/lib/integrations/route-auth.ts`); tested in `tests/integrations-callback-2fa.test.ts` |
| Direct dependency advisories: `next`, `better-auth`, `@sentry/nextjs`, `undici`, `zod` (3 critical, 8 high) | Upgraded (next 16.4.6, better-auth 1.7.25, sentry 10.78, undici 7.30.2, zod 4.6.7) |
| MCP SDK advisory (one HTTP client's messages delivered to another) | `overrides` → `@modelcontextprotocol/server ^2.3` (resolved 2.4.0) |
| Meta access tokens in GET query strings (leak into logs/errors) | Sent in `Authorization` headers |

Remaining `npm audit`: 15 (1 high: dev-tool `brace-expansion`; 14 moderate, all build/test-time). `vite`, `source-map-js` and `js-yaml` were closed with overrides. Details and why Sentry 11 was not adopted: `docs/PERFORMANCE.md`. Re-run `npm audit` before deploy.

## MCP controls (new)

- Per-tool policy: disabled tools are denied (also at approval time); dangerous tools always need owner approval and never run unattended; policy lookup failure queues for approval.
- The tool "Test" button no longer bypasses approval: it is limited to enabled read-class tools (previously it could execute any registered tool with empty input).
- MCP bearer tokens are sealed at rest and never sent to the browser; outbound MCP calls use the SSRF guard with a pinned address and refuse redirects.

## Dashboard controls (new)

- The health card computes only booleans from environment variables; no secret value reaches the page or the client (covered by a test).
- Every card is read-only and owner-scoped where the table has an owner; a failing card degrades alone.

## Agent governance controls (new)

- Governance only narrows: disabled agents do not run; read-only strips write tools; an allowlist cannot re-enable a tool the run mode forbids (autonomous runs keep their allowlist); project scope refuses calls naming other projects before anything runs.
- The self-test forces read-only tools and a fixed brief, so testing an agent cannot change data.
- Only admins (with the 2FA policy) can change any of it; built-in departments cannot be deleted from the UI; every change is audited.

## Project board controls (new)

- Every task action re-checks the project/task belongs to the signed-in owner and runs behind `requireAdmin`; task and project ids are validated before use; the detail page 404s on a malformed id.
- Archive is non-destructive; only delete cascades (unchanged, still behind the existing confirmation).

## Automation controls (new)

- Unattended by design: same policy actor as the cron (`standing_task_routine`) — writes other than a project's own tools are denied, dangerous tools never run, approvals are never awaited; tool steps limited to an allowlist and validated against the tool's schema before running.
- Created paused; only admins (with the 2FA policy) can create, change, resume or run them; each action is audited.
- Template substitution is text-only (no re-interpretation, prototype keys blocked); stored step output is size-bounded; per-automation hourly run cap; events from unattended runs are not emitted (no self-triggering loops).
- Writes and agent runs are never auto-retried (no duplicated side effects).

## Skills controls (new)

- Imported skills are untrusted prompts: they are inserted **disabled**, validated (size caps, schema shape) and cannot be seen by the console or agents until the owner enables them.
- Disabled skills are filtered out of the MCP read tools server-side.
- Search input is stripped of PostgREST filter metacharacters before use.

## Social Studio controls

- **Authentication/authorization:** pages require a session; every mutation is a server action calling `requireAdmin()` (role + 2FA). Hidden buttons are presentation only.
- **Owner scoping:** every store query filters `owner_id`; job/asset/content ids are re-checked against the owner.
- **Secrets:** OAuth tokens AES-256-GCM encrypted at rest; never sent to the browser; Page tokens derived per publish and not stored; no tokens in URLs or logs.
- **OAuth:** single-use `state` rows bound to owner+provider, PKCE where the platform supports it (Google). Meta and TikTok web flows use `state` only (no PKCE in their web flows).
- **Uploads:** MIME allow-list, size caps (video 5 GB, image 20 MB), private bucket, owner-prefixed paths, signed URLs (upload 2h by Supabase default, preview 10 min, publish 1h), size re-verified after upload.
- **CSP:** `connect/img/media-src` additionally allow only the project's Supabase origin.
- **Rate limiting:** existing `src/proxy.ts` (Upstash in production). Social actions inherit the dashboard limits; the worker route is authenticated by `CRON_SECRET` (constant-time compare) or same-origin owner.
- **AI:** suggestion-only; owner text fenced as data; input/output/daily caps; agents have no publish/schedule/delete/account tools and permissions are clamped server-side.
- **Database:** RLS on, anon/authenticated revoked on all new tables; DB constraints for success-needs-external-id and one-job-per-variant-account.

## Known gaps

- No rate limit specific to expensive social actions (AI run, analytics refresh) beyond daily caps and the global limiter.
- Webhook signature verification exists for GitHub only; no social platform webhooks are consumed.
- Prompt-injection resistance is best-effort.
- Supabase signed upload URLs authorize whoever holds them until expiry; they are issued only to the owner.
- No automated dependency/secret scanning in CI beyond what exists; add `npm audit` to CI if desired.
- Secret rotation for `INTEGRATIONS_SECRET` is manual (ciphertext is versioned; re-seal needed).
