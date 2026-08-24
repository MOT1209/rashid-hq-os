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
   - `KV_REST_API_URL` / `KV_REST_API_TOKEN` — optional. Install the Upstash for
     Redis integration (`vercel integration add upstash/upstash-kv`) and
     `vercel env pull` to get these; without them, rate limiting falls back to
     per-instance memory (see Security notes).
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

Two transports onto the same server — same tool registry
(`src/lib/mcp/tools.ts`), same bearer tokens, same activity log. Issue and
revoke tokens at `/dashboard/access`; a revoked token is rejected on its very
next call, on either transport.

- `POST /api/mcp` — a hand-rolled JSON-RPC 2.0 endpoint. `Authorization: Bearer hq_…`.
- `POST/GET/DELETE /api/mcp-server` — a real Streamable HTTP MCP server (via
  [`mcp-handler`](https://www.npmjs.com/package/mcp-handler)), reachable
  directly by any MCP client:
  ```bash
  claude mcp add --transport http alking-hq https://YOUR_DOMAIN/api/mcp-server \
    --header "Authorization: Bearer hq_…"
  ```
  Claude Desktop and other Streamable HTTP clients connect the same way —
  point them at the URL with that header.

Tools and the scope each one needs:

| Tool | Scope |
| --- | --- |
| `list_projects`, `get_project`, `list_recent_logs`, `list_categories` | `read` |
| `register_project`, `update_project`, `delete_project`, `add_project_tool`, `update_project_tool`, `delete_project_tool`, `call_project_tool` | `write` |

Member and token management (`/dashboard/settings`, `/dashboard/access`) are deliberately **not** exposed as tools — those grant access to humans, not to the things an agent should be managing.

A token issued as **read only** is rejected on the `write` tools. A token pinned
to a project can only see and act on that project. Tokens expire — 90 days by
default, and the expiry is shown in the tokens table.

### Verifying a call came from here

`call_project_tool` POSTs `{ tool, input, project_id, issued_at }` and always
sends `x-hq-source: alking-hq`. Set `OUTBOUND_SIGNING_SECRET` and it also sends
`x-hq-signature: sha256=…`, an HMAC of the exact request body. On the receiving
side:

```js
const expected =
  "sha256=" + createHmac("sha256", SHARED_SECRET).update(rawBody).digest("hex");
if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) reject();
// issued_at is inside the signed body — reject anything older than a minute.
```

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
| `/dashboard/settings` | Change the owner password; add and remove project categories |

Departments and categories live in the `departments` and `project_categories`
tables, not in the source. Adding one is a row, and its Arabic and English names
come with it — no code change, no deploy. A project keeps whatever category
string it was saved with, so removing a category never breaks an existing row.

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

- **Closed by invitation, with roles.** Two ways in: an address in
  `OWNER_EMAILS` (always admin, and an empty value locks the console rather than
  opening it), or one an admin invited from `/dashboard/settings`. An **admin**
  can do everything; a **viewer** reads the dashboard and every write is
  refused by `requireAdmin` in `src/lib/session.ts` — hiding the buttons is
  presentation, that check is the boundary.
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
  sliding-window throttle in front of `/api/auth`, `/api/mcp`, `/api/console` and
  every Server Action POST under `/dashboard`, backed by Upstash Redis
  (`KV_REST_API_URL` / `KV_REST_API_TOKEN`, set automatically by the Upstash for
  Redis integration) — one shared counter across every instance. Without those
  variables it falls back to a per-instance in-memory counter, and a live Redis
  hiccup fails open to that same fallback rather than blocking requests.
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

### Password recovery and error tracking

Both are optional integrations that activate the moment their key exists, and
change nothing when it does not.

- **Resend** (`RESEND_API_KEY`) turns on `/forgot-password`. Install it with
  `vercel integration add resend/resend-email`, which sets the variable for you.
  Without it the endpoint still answers — identically for an address that has an
  account and one that does not, so it cannot be used to enumerate users — but
  no mail is sent and the attempt is logged.
- **Sentry** (`SENTRY_DSN`) receives what `src/lib/errors.ts` records. Every
  error gets a reference id that appears in the server log *and* in the message
  the user sees, so a screenshot is enough to find the trace — with or without
  Sentry configured.

### Known limits

- Rate-limit counters key on `x-vercel-forwarded-for` / `x-real-ip` only —
  headers the platform sets. Behind a different proxy they collapse to one
  bucket, so treat the throttle as a brake and the auth checks as the real
  boundary.
- Without the Upstash for Redis integration connected, the proxy throttle
  falls back to per-instance memory. Sign-in doesn't depend on this — it
  counts in Postgres regardless.

### Before deploying

Set `BETTER_AUTH_URL` to the production origin (sessions break otherwise), set
`OWNER_EMAILS`, and leave `ALLOW_PRIVATE_MCP_ENDPOINTS` unset — it disables the
SSRF guard and exists only for local development.
