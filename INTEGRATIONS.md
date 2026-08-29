# Integrations

Connect the owner's accounts on external services to the console. Every secret
is encrypted at rest (`INTEGRATIONS_SECRET`, AES-256-GCM) and never sent to the
browser. Manage everything at **`/dashboard/settings/integrations`** (admin only).

## How it fits together

```
src/lib/integrations/
  encryption.ts   seal() / open() — AES-256-GCM, versioned ciphertext
  types.ts        IntegrationProvider contract + view models
  registry.ts     the one list of providers; add an entry to add a provider
  http.ts         outbound fetch with timeout + backoff on 429/5xx
  oauth.ts        single-use state rows (CSRF token + PKCE verifier)
  connections.ts  owner-scoped CRUD, token refresh, mergeTokens
  service.ts      registry ⨝ this owner's connections → dashboard view
  logger.ts       writes to the same activity feed as agents ("Integrations")
  route-auth.ts   admin + 2FA gate for the route handlers
  providers/
    google.ts     OAuth engine shared by all Google-family entries
    github.ts     OAuth App + webhook signature verification
    api-key.ts    OpenAI / Anthropic / Gemini / Clarity (paste-a-key)

src/app/api/integrations/route.ts                 GET  list
src/app/api/integrations/[provider]/connect       POST start OAuth → { url }
src/app/api/integrations/[provider]/callback      GET  provider redirect target
src/app/api/integrations/[provider]/test          POST prove it still works
src/app/api/integrations/[provider]/refresh       POST force token refresh
src/app/api/integrations/[provider]               GET status · DELETE disconnect
src/app/api/webhooks/[provider]                    POST verified inbound events
src/app/dashboard/settings/integrations/actions.ts  saveApiKey · disconnect
```

Adding a provider = one entry in `registry.ts` + (for real behaviour) a module
under `providers/`. Nothing else changes — routes, UI, the `list_integrations`
agent tool and the database are all generic.

## Connection flow (OAuth)

1. UI `POST /api/integrations/:provider/connect`
2. server mints `state` (+ PKCE verifier), stores it, returns the authorize URL
3. browser redirects to the provider, owner grants the scopes
4. provider redirects to `/api/integrations/:provider/callback?code&state`
5. callback: live admin session? `state` row valid, unexpired, this owner? → delete it
6. exchange `code` → tokens, `seal()` them, `testConnection()` for the account label
7. `integration_connections` upserted, activity logged, browser back to the page

## First-time setup

1. `INTEGRATIONS_SECRET` — `openssl rand -base64 32`, set in Vercel + `.env.local`.
2. Apply `supabase/migrations/0013_integrations.sql`.
3. Per provider below: create the app, get credentials, add the redirect URI,
   set the env vars, redeploy, then click **Connect**.

Redirect URI pattern (one per provider you enable):
`https://YOUR_DOMAIN/api/integrations/<provider>/callback`

---

### Google (google · youtube · gmail · drive · calendar · search_console)

One OAuth client covers all of them.

1. https://console.cloud.google.com/ → create/select a project.
2. **APIs & Services → Library**: enable the APIs you need (YouTube Data API v3,
   Gmail API, Drive API, Calendar API, Search Console API…).
3. **OAuth consent screen**: External, add your email as a test user, add the
   scopes listed for each provider in `registry.ts`.
4. **Credentials → Create OAuth client ID → Web application**. Authorized
   redirect URIs: add one `.../api/integrations/<provider>/callback` per provider.
5. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
6. Docs: https://developers.google.com/identity/protocols/oauth2

Scopes are `*.readonly` by design. Widen a scope in `registry.ts` only when a
feature actually needs write access, and re-consent.

### GitHub

1. https://github.com/settings/developers → **New OAuth App**.
2. Authorization callback URL: `https://YOUR_DOMAIN/api/integrations/github/callback`.
3. Set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`.
4. Webhooks (optional): repo/org **Settings → Webhooks**, payload URL
   `https://YOUR_DOMAIN/api/webhooks/github`, content type `application/json`,
   secret → `GITHUB_WEBHOOK_SECRET`. Deliveries without a valid
   `X-Hub-Signature-256` are rejected.
5. Docs: https://docs.github.com/en/rest

### OpenAI / Anthropic / Gemini (API key)

No env var. Paste the key in the UI — it is tested against a read-only endpoint
(`/models`) and sealed before storage. Only an 8-char fingerprint is ever shown.

- OpenAI: https://platform.openai.com/api-keys
- Anthropic: https://console.anthropic.com/settings/keys
- Gemini: https://aistudio.google.com/apikey

### Microsoft Clarity (config)

Paste the **project ID** (Clarity → Settings → Overview). Stored the same way;
the front-end tracking snippet would read it back. No server API.
Docs: https://learn.microsoft.com/en-us/clarity/

---

## Planned providers

`x`, `discord`, `telegram`, `whatsapp`, `stripe`, `paypal`, `google_adsense`,
`google_search` render in the dashboard as **Coming soon** with connect
disabled. They carry metadata (scopes, docs link, required env) but no runtime
code — the console never claims a capability it does not have. To finish one:
add its module under `providers/`, wire `buildAuthUrl`/`exchangeCode`/`refresh`
(or `testConnection` for API-key), and flip `readiness` to `"available"`.

## Webhooks

`POST /api/webhooks/:provider` is the single entry point. The provider module's
`verifyWebhook()` checks the signature; the route enforces replay protection via
`unique (provider, event_id)` on `webhook_events`, logs to the activity feed,
and returns `200 { duplicate: true }` for a redelivery. Providers without a
verifier get `404` — unsigned events are never stored.

## Security

- Secrets: AES-256-GCM, ciphertext-only columns, tamper-detected on `open()`.
- OAuth: PKCE (S256) even for confidential clients; single-use `state` bound to
  owner + provider + 15-minute expiry; `redirectTo` restricted to same-path.
- Route handlers: admin session + `REQUIRE_2FA` honoured, same bar as the console.
- `list_integrations` (the agent tool) returns provider/status/account only —
  never a token — and is owner-scoped.
- Rate limits: `/api/integrations` 30/min, `/api/webhooks` 120/min (`src/proxy.ts`).
- Nothing secret is logged: `logIntegration` payloads carry scopes, labels and
  status only.
