# Alking Enterprises — CEO Executive Command Center

Universal command center for every Alking Enterprises project, plus a universal
remote MCP endpoint that agents call to act on those projects. Every tool call is
written to Supabase and streams to the dashboard live.

- **Next.js 16** (App Router) + **TailwindCSS v4**
- **Supabase** — Postgres, read and written only by the server
- **Better Auth** — owner sign-in + bearer tokens for agents
- **AI SDK v7** via Vercel AI Gateway — the CEO command console
- Arabic / English, dark / light

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in:
   - `SUPABASE_SERVICE_ROLE_KEY` — Supabase → Project Settings → API keys
   - `DATABASE_URL` — Supabase → Project Settings → Database (session pooler URI)
   - `BETTER_AUTH_SECRET` — `openssl rand -base64 32`
   - `OWNER_EMAILS` — your email. Nobody else can sign up or sign in.
   - `AI_GATEWAY_API_KEY` — Vercel AI Gateway (the console returns 503 without it)
3. Apply the SQL in `supabase/migrations/` in order. Every file is re-runnable,
   and `0005` carries the Better Auth schema so no separate step is needed.
   (`npm run auth:migrate` regenerates that schema from the installed package if
   you ever upgrade Better Auth.)
4. `npm run dev` — serves on **http://localhost:7070** — then create the owner
   account (password ≥ 12 chars):
   `node scripts/seed-owner.mjs "you@example.com" "a-strong-password" "Rashid"`

The port is set in the `dev` and `start` scripts. `localhost:7070` is trusted
automatically in development, so changing the port means changing both.

## Universal MCP endpoint

`POST /api/mcp` — JSON-RPC 2.0, `Authorization: Bearer hq_…`.
Issue and revoke tokens at `/dashboard/access`; a revoked token is rejected on its
very next call.

Tools and the scope each one needs:

| Tool | Scope |
| --- | --- |
| `list_projects`, `get_project`, `list_recent_logs` | `read` |
| `register_project`, `call_project_tool` | `write` |

A token issued as **read only** is rejected on the `write` tools. A token pinned
to a project can only see and act on that project. Tokens expire — 90 days by
default, and the expiry is shown in the tokens table.

**Everything the owner does is logged too.** Creating, editing and deleting a
project, issuing and revoking a token: all appear in the activity feed under
`CEO Console`, so the trail is not limited to what agents did.

```bash
curl -X POST http://localhost:7070/api/mcp \
  -H "Authorization: Bearer hq_…" -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_projects","arguments":{}}}'
```

## Layout

| Path | Purpose |
| --- | --- |
| `/dashboard` | KPIs, CEO console, recent activity (each panel streams independently) |
| `/dashboard/activity` | Full live stream, filterable by project and status, paginated |
| `/dashboard/projects` | Project registry and MCP tools, both editable inline; each tool has a **Test** button that calls its endpoint and shows the reply |
| `/dashboard/departments/[dev\|store\|media\|custom]` | Per-department views |
| `/dashboard/access` | Issue / revoke agent tokens, with scopes and an expiry |
| `/dashboard/settings` | Change the owner password |

Fully bilingual (Arabic / English, RTL-aware) and usable on small screens — the
sidebar becomes a drawer below `md`.

## Development

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest — the SSRF guard, the owner allowlist, routing and dictionary parity |
| `npm run build` | Production build |

CI runs all five on every push and pull request (`.github/workflows/ci.yml`).

## Security notes

- **Single owner.** Sign-up is closed to everyone outside `OWNER_EMAILS`, enforced
  at account creation and again on every guarded page. An empty `OWNER_EMAILS`
  locks the console rather than opening it.
- **The browser holds no database credentials.** Activity streams over
  `/api/activity/stream` (SSE, owner session required); the service role key never
  leaves the server. Migration `0004` removes the anonymous SELECT policies that
  the old Realtime subscription needed.
- **Outbound calls are guarded.** `call_project_tool` POSTs only to public `https`
  endpoints — private ranges, loopback and cloud metadata (`169.254.169.254`) are
  rejected, DNS results are checked address by address, and redirects are refused.
  Endpoints are validated when stored *and* again before the request, and the
  connection is pinned to the address that was vetted, so a name that changes
  answers between the check and the request cannot reach an internal host.
- Agent tokens are hashed with an HMAC keyed by `TOKEN_PEPPER` (a bare SHA-256
  when it is unset). The plaintext is shown once, scopes are enforced per tool,
  and tokens issued before the pepper existed are re-hashed as they are used.
- **Security headers on every response** (`src/proxy.ts`): a nonce-based
  Content Security Policy — same-origin only, `object-src 'none'`,
  `frame-ancestors 'none'` — plus `nosniff`, a strict referrer policy and a
  locked-down permissions policy. `'unsafe-eval'` is added **in development
  only**, where React uses `eval` to rebuild server-side error stacks; a
  production build needs none.
- **Sign-in is rate-limited in Postgres**, not in process memory: Better Auth
  stores counters in the `rateLimit` table, so the limit holds across serverless
  instances. `/sign-in/email` allows 5 attempts per minute. `src/proxy.ts` adds a
  cheap per-instance throttle in front of `/api/mcp` and `/api/console` — that
  one *is* best-effort and should move to a shared store before scaling out.
- **Every legitimate origin is trusted, not just one.** Preview deployments and
  local development sign in without changing configuration; add a custom domain
  through `TRUSTED_ORIGINS`.
- Database errors are logged server-side and returned as generic messages, so
  schema details never reach a client.

### Retention

`agent_logs` keeps 90 days. A Vercel Cron hits `/api/maintenance/prune` nightly
(`vercel.json`), authenticated by `CRON_SECRET`; the signed-in owner can also
run it by hand. Override the window with `LOG_RETENTION`. Payloads and results
larger than 32 KB are stored truncated, with the original size recorded.

### Known limits

- Rate-limit counters live in memory per instance and key on
  `x-vercel-forwarded-for` / `x-real-ip` only — headers the platform sets.
  Behind a different proxy they collapse to one bucket, so treat the throttle
  as a brake and the auth checks as the real boundary.
- The proxy's throttle on `/api/mcp` and `/api/console` is still per-instance.
  Sign-in is the one that mattered and it now counts in Postgres.

### Before deploying

Set `BETTER_AUTH_URL` to the production origin (sessions break otherwise), set
`OWNER_EMAILS`, and leave `ALLOW_PRIVATE_MCP_ENDPOINTS` unset — it disables the
SSRF guard and exists only for local development.
