# KING Social Studio

Route: `/dashboard/social-studio`. Part of RASHID HQ OS, single-owner, no billing.

This document says what is **built and tested**, what is **built but unverified against a live
platform**, and what is **not built**. Nothing here is simulated: if a platform call is not made,
the UI says so.

## Status

| Area | Status |
|---|---|
| Capability registry (YouTube, Facebook, Instagram, TikTok) | Built. Declares auth, scopes, limits, blockers. |
| YouTube OAuth (`youtube_publish`, scope `youtube.upload`) | Built on the existing Integrations engine (PKCE, encrypted tokens, 2FA gate). Needs your Google OAuth client. |
| YouTube publishing adapter | Built, unit-tested against **mocked** HTTP. **Not yet run against a live channel.** |
| Facebook Pages / Instagram / TikTok | **Pending, no adapter.** Capabilities are declared; publishing is refused server-side. Blockers listed in the UI. |
| Media library (upload, preview, archive, delete) | Built. Direct-to-Supabase-Storage via signed URLs; size/MIME validated; size verified after upload. Not tested against live Storage. |
| Content drafts + per-platform variants + validation | Built. |
| Publish now / schedule / cancel / retry / history | Built. Persistent queue in Postgres (migration 0024), verified on real Postgres 16 (claim, duplicate key, stale-lock reclaim, success constraint). |
| Calendar | **List view of queued jobs only.** No month/week/day grid, no drag-reschedule. |
| AI content assistant + the six agents | **Not built.** The UI says so; no AI text is generated or published. |
| Analytics snapshots | **Not built.** No metrics are shown, none are fabricated. |
| Automation rules, agent publish permissions | **Not built.** |
| E2E (browser) tests | **Not built.** Unit + DB-level checks only. |

## How publishing is kept safe

- Jobs are created **only** by `confirmPublishAction`, an explicit owner action behind `requireAdmin`
  (role + `REQUIRE_2FA`). It stamps `approved_by/approved_at`. No agent or AI path can enqueue a job.
- One job per `(variant, account)` — unique `idempotency_key` — so double-clicks and retries cannot double-post.
- Workers claim with `claim_social_jobs` (`FOR UPDATE SKIP LOCKED`); a `running` lock older than 15 min is reclaimed.
- A job becomes `succeeded` only when the adapter returns a platform id; the DB also enforces
  `status <> 'succeeded' or external_id is not null`.
- Retries: exponential backoff 1m→6h, max 5 attempts, honouring rate-limit hints. Auth and terminal errors never auto-retry.
- **Ambiguous failures are terminal.** If the connection drops during the final YouTube upload request,
  the video may exist. The job fails as `terminal` ("outcome unknown — check your channel") and the UI does not offer Retry.
- Scheduling stores UTC; the owner's wall-clock time is interpreted in `OWNER_TIMEZONE` (default `UTC`), DST-aware.
- YouTube privacy defaults to **private**; public/unlisted is an explicit choice.

## Setup

1. Apply migrations: `npm run migrate:apply` (adds migration `0024_social_studio.sql` and the private `social-media` bucket).
2. Env vars (see `INTEGRATIONS.md` and `.env.example`): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `INTEGRATIONS_SECRET`,
   `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, optional `OWNER_TIMEZONE` (e.g. `Asia/Riyadh`).
3. Google Cloud: enable **YouTube Data API v3**; add redirect URI `https://<host>/api/integrations/youtube_publish/callback`.
4. In the app: Integrations → connect **YouTube Publishing**; Social Studio → Accounts → **Detect channel**.
5. Scheduler: set repo secrets `APP_URL` and `CRON_SECRET`; `.github/workflows/social-worker.yml` calls
   `/api/social/run` every 10 minutes (free; Vercel Hobby crons are daily-only). On Vercel Pro you may instead add a cron in `vercel.json`.

CSP note: `src/proxy.ts` now allows your Supabase project origin (and only that) in `connect-src`, `img-src`, `media-src`
so the browser can upload/preview via signed URLs.

## External blockers and costs

- **YouTube:** uploads from an API project that has not passed Google's compliance audit are forced private; each upload costs ~1600 of the default 10,000 daily quota units. Free.
- **Meta (Facebook/Instagram):** app review and business verification; Instagram needs a Business/Creator account linked to a Page and a public media URL. Free.
- **TikTok:** Content Posting API audit required for non-private direct posts. Free.
- **Supabase Storage:** large videos count against your plan's storage/egress. Vercel function time applies to uploads (publishing streams from storage to YouTube; very large files may exceed the function limit — `maxDuration` is 300s).

## Manual verification checklist — YouTube

- [ ] Connect YouTube Publishing; consent screen lists *upload* and *read* scopes only.
- [ ] Accounts → Detect channel shows your channel title.
- [ ] Upload a small MP4; it shows as ready with size/duration; Preview plays.
- [ ] Create a draft, privacy **Private**, Publish now; History shows *Published* with a video id and link that opens in YouTube Studio.
- [ ] Schedule a post 15 min ahead; confirm *Queued*, then published after the worker tick.
- [ ] Cancel a queued job; confirm it never publishes.
- [ ] Revoke access in your Google account; next job fails as auth error and is not retried.
- [ ] Publish the same content to the same account twice: second attempt reports it already exists.

## Tests

`tests/social-core.test.ts` (state machine, backoff, timezone, validation, registry honesty),
`tests/social-engine.test.ts` (engine branches and YouTube adapter against mocked fetch),
`tests/integrations-callback-2fa.test.ts` (OAuth callback security). Mocks are never presented as live integrations.
