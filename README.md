# Alking Enterprises — CEO Executive Command Center

Universal command center for every Alking Enterprises project, plus a universal
remote MCP endpoint that agents call to act on those projects. Every tool call is
written to Supabase and streams to the dashboard live.

- **Next.js 16** (App Router) + **TailwindCSS v4**
- **Supabase** — Postgres, read and written only by the server
- **Better Auth** — owner sign-in + bearer tokens for agents
- **AI SDK v6** via Vercel AI Gateway — the CEO command console
- Arabic / English, dark / light

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in:
   - `SUPABASE_SERVICE_ROLE_KEY` — Supabase → Project Settings → API keys
   - `DATABASE_URL` — Supabase → Project Settings → Database (session pooler URI)
   - `BETTER_AUTH_SECRET` — `openssl rand -base64 32`
   - `OWNER_EMAILS` — your email. Nobody else can sign up or sign in.
   - `AI_GATEWAY_API_KEY` — Vercel AI Gateway (the console returns 503 without it)
3. Create the Better Auth tables: `npx @better-auth/cli migrate`
4. Apply the SQL in `supabase/migrations/` (run `0004` last — it closes anonymous
   database access and must run *after* Better Auth has created its tables).
5. `npm run dev`, then create the owner account (password ≥ 12 chars):
   `node scripts/seed-owner.mjs "you@example.com" "a-strong-password" "Rashid"`

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
to a project can only see and act on that project.

```bash
curl -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer hq_…" -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_projects","arguments":{}}}'
```

## Layout

| Path | Purpose |
| --- | --- |
| `/dashboard` | KPIs, CEO console, recent activity (each panel streams independently) |
| `/dashboard/activity` | Full live stream, filterable by project and status, paginated |
| `/dashboard/projects` | Project registry with inline editing + custom MCP tools |
| `/dashboard/departments/[dev\|store\|media\|custom]` | Per-department views |
| `/dashboard/access` | Issue / revoke agent tokens, with scopes |

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
  Endpoints are validated when stored *and* again before the request.
- Agent tokens are stored as SHA-256 hashes — the plaintext is shown once, and
  scopes are enforced per tool.
- **Security headers on every response** (`src/proxy.ts`): a nonce-based
  Content Security Policy — same-origin only, `object-src 'none'`,
  `frame-ancestors 'none'` — plus `nosniff`, a strict referrer policy and a
  locked-down permissions policy. `'unsafe-eval'` is added **in development
  only**, where React uses `eval` to rebuild server-side error stacks; a
  production build needs none.
- `/api/auth`, `/api/mcp` and `/api/console` are rate-limited in `src/proxy.ts`.
  The counters are per-instance and best effort; move them to a shared store
  before scaling out.
- Database errors are logged server-side and returned as generic messages, so
  schema details never reach a client.

### Before deploying

Set `BETTER_AUTH_URL` to the production origin (sessions break otherwise), set
`OWNER_EMAILS`, and leave `ALLOW_PRIVATE_MCP_ENDPOINTS` unset — it disables the
SSRF guard and exists only for local development.
