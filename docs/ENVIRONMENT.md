# Environment variables

Never commit real values. `.env.example` is the source of truth; this is the map. "Server only" = never prefix with `NEXT_PUBLIC_`.

| Variable | Needed for | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | all DB/Storage | public URL (also allowed in CSP for media) |
| `SUPABASE_SERVICE_ROLE_KEY` | all DB/Storage | server only; bypasses RLS |
| `DATABASE_URL` | migrations | direct Postgres connection |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | auth | secret must be set in production (the build warns if not) |
| `OWNER_EMAILS` | roles | comma-separated owner emails |
| `REQUIRE_2FA` | writes | when set, admins need 2FA for changes, OAuth connect **and** callback |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | rate limit | Upstash; required in production |
| `INTEGRATIONS_SECRET` | OAuth/API-key storage | AES-256-GCM key for tokens at rest |
| `CRON_SECRET` | cron routes | also a GitHub secret for the worker workflow |
| `GROQ_API_KEY`, `GROQ_MODEL` | console, agents, AI assistant | |
| `GOOGLE_CLIENT_ID/SECRET` | YouTube | redirect `/api/integrations/youtube_publish/callback` |
| `META_APP_ID/SECRET` | Facebook, Instagram | redirect `/api/integrations/meta_publish/callback` |
| `TIKTOK_CLIENT_KEY/SECRET` | TikTok | redirect `/api/integrations/tiktok_publish/callback` |
| `OWNER_TIMEZONE` | scheduling/calendar | IANA name, default `UTC` |
| `SOCIAL_AI_DAILY_RUNS` | AI assistant + agents | default 100 per rolling 24h |
| `AUTOMATION_RETENTION` | prune cron | PostgreSQL interval for finished automation runs, default `90 days` |
| `SOCIAL_RETENTION` | prune cron | interval for analytics snapshots and failed/cancelled social jobs, default `180 days` |
| `SENTRY_*`, `RESEND_API_KEY`, `TOKEN_PEPPER`, `OUTBOUND_SIGNING_SECRET` | existing features | see `.env.example` |

GitHub Actions secrets for the worker: `APP_URL`, `CRON_SECRET`.
