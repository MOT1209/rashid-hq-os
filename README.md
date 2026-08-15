# Alking Enterprises — CEO Executive Command Center

Universal command center for every Alking Enterprises project, plus a universal
remote MCP endpoint that agents call to act on those projects. Every tool call is
written to Supabase and streams to the dashboard live.

- **Next.js 16** (App Router) + **TailwindCSS v4**
- **Supabase** — Postgres + Realtime on `agent_logs`
- **Better Auth** — owner sign-in + bearer tokens for agents
- **AI SDK v6** via Vercel AI Gateway — the CEO command console
- Arabic / English, dark / light

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in:
   - `SUPABASE_SERVICE_ROLE_KEY` — Supabase → Project Settings → API keys
   - `DATABASE_URL` — Supabase → Project Settings → Database (session pooler URI)
   - `BETTER_AUTH_SECRET` — `openssl rand -base64 32`
   - `AI_GATEWAY_API_KEY` — Vercel AI Gateway (the console returns 503 without it)
3. Create the Better Auth tables: `npx @better-auth/cli migrate`
4. `npm run dev`, then create the owner account:
   `node scripts/seed-owner.mjs "you@example.com" "strong-password" "Rashid"`

The application tables are already applied to the Supabase project; the SQL lives
in `supabase/migrations/` for rebuilds.

## Universal MCP endpoint

`POST /api/mcp` — JSON-RPC 2.0, `Authorization: Bearer hq_…`.
Issue and revoke tokens at `/dashboard/access`; a revoked token is rejected on its
very next call.

Tools: `list_projects`, `get_project`, `register_project`, `list_recent_logs`,
`call_project_tool` (proxies to a project's own MCP endpoint).

```bash
curl -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer hq_…" -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_projects","arguments":{}}}'
```

## Layout

| Path | Purpose |
| --- | --- |
| `/dashboard` | KPIs, CEO console, recent activity |
| `/dashboard/activity` | Full realtime stream with status LEDs |
| `/dashboard/projects` | Project registry + custom MCP tools |
| `/dashboard/departments/[dev\|store\|media\|custom]` | Per-department views |
| `/dashboard/access` | Issue / revoke agent tokens |

## Security notes

- The service role key is server-only; the browser gets a read-only publishable key.
- Agent tokens are stored as SHA-256 hashes — the plaintext is shown once.
- RLS allows anonymous **SELECT** on `projects`, `agent_logs`, `project_tools` so
  Realtime can reach the browser. Anyone holding the publishable key can read those
  rows, so keep secrets out of tool payloads. Hardening path: mint short-lived
  Supabase JWTs for the signed-in owner and restrict the policies to `authenticated`.
