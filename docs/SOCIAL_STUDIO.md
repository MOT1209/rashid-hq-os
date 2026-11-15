# KING Social Studio

Route: `/dashboard/social-studio`. Part of RASHID HQ OS, single-owner, no billing.

This document says what is **built and tested**, what is **built but unverified against a live
platform**, and what is **not built**. Nothing here is simulated: if a platform call is not made,
the UI says so.

## Status

"Built" means the code exists and passes automated tests against **mocked** platform APIs.
**No platform adapter has been run against a live account yet.** Every platform also has external
approvals only you can obtain (listed in the UI and below).

| Area | Status |
|---|---|
| Capability registry (YouTube, Facebook, Instagram, TikTok) | Built. Declares auth, scopes, limits, blockers. |
| YouTube: OAuth (`youtube_publish`) + resumable upload adapter | Built. Needs your Google OAuth client; unaudited API projects are forced private. |
| Facebook Pages: OAuth (`meta_publish`) + video/photo/text adapter | Built. Page tokens derived at publish time, never stored. Needs Meta app + review. |
| Instagram: Reels / JPEG via container → status poll → publish | Built. Needs Meta app review and a Business/Creator account linked to a Page. |
| TikTok: Login Kit OAuth (`tiktok_publish`) + chunked Direct Post adapter | Built. Enforces the creator's own privacy options; **unaudited apps can only post private**. |
| Media library (signed-URL upload, preview, tags, archive, delete) | Built. Not tested against live Storage. |
| Content drafts, per-platform variants, validation | Built. |
| Publish now / schedule / cancel / retry / reschedule / history | Built. Persistent Postgres queue; claim, duplicate-key, stale-lock reclaim and success constraint verified on real Postgres 16. |
| Calendar (month / week / day / list) in the owner's timezone, drafts list, reschedule | Built (math unit-tested; UI not browser-tested). |
| AI assistant (10 tasks, suggestions only) | Built. Mocked-model tested. |
| Six agents (Strategist, Writer, Platform Adaptation, Publishing Assistant, Analytics, Media Organizer) with 8 granular permissions | Built. Real owner-scoped tools; schedule/publish/delete/manage_accounts are never grantable and have no tools. |
| Analytics snapshots (YouTube stats; Facebook reactions/comments/shares; Instagram likes/comments) | Built. Unsupported metrics are listed, never zero-filled; no TikTok analytics (needs `video.list`); no cross-platform comparison. |
| Automation | The publishing queue and analytics collection are built in. Social events (`social_job_failed` / `social_job_succeeded`) can trigger general workflows — see `docs/AUTOMATION.md`. |
| Browser end-to-end tests | **Not built** (see `docs/TESTING.md`). |
| Engagement rate | Computed only when a platform returned real `views`. |

## AI assistant guardrails

- Output is text only. There is no code path from the assistant to `confirmPublishAction`; publishing still needs the owner's explicit confirmation.
- Owner text is fenced as data in the prompt (basic prompt-injection resistance, not a guarantee).
- Input capped at 6,000 characters, output at 800 tokens. Daily cap of 100 runs (`SOCIAL_AI_DAILY_RUNS`).
- Every run is recorded in `agent_runs` as kind `social_assist` (migration 0025) and appears in Insights as "Content assistant". If the ledger is unreachable the assistant still works (fail-safe, reported to Sentry).
- Cost: Groq free tier by default; no new paid service.

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

1. Apply migrations: `npm run migrate:apply` (0024 social tables + private `social-media` bucket, 0025 AI usage kind, 0026 analytics snapshots, 0027 agent settings).
2. Meta (Facebook/Instagram): create a Meta app, add redirect URI `https://<host>/api/integrations/meta_publish/callback`, set `META_APP_ID` / `META_APP_SECRET`. Until Meta app review approves `pages_manage_posts` and `instagram_content_publish`, only app admins/testers can publish. Then Integrations → connect **Meta**, and Social Studio → Accounts → **Detect channel** on the Facebook or Instagram card.
2a. TikTok: create a developer app (Login Kit + Content Posting API), add redirect URI `https://<host>/api/integrations/tiktok_publish/callback`, set `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET`. Public posting needs TikTok's audit; until then only private posts from approved test users.
2b. AI assistant: set `GROQ_API_KEY` (already used by the console) and optionally `SOCIAL_AI_DAILY_RUNS`.
2c. Env vars (see `INTEGRATIONS.md` and `.env.example`): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `META_APP_ID`, `META_APP_SECRET`, `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `INTEGRATIONS_SECRET`,
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

## Manual verification checklist — Meta

- [ ] AI assistant: generate a caption in Arabic and English, apply it, confirm the draft shows the AI-assisted badge, and that nothing is queued until you confirm.
- [ ] Connect Meta; Accounts → detect lists your Pages and any linked Instagram business account.
- [ ] Facebook: publish a text-only post; History shows a post id and the link opens it.
- [ ] Facebook: publish an image and a short video; both appear on the Page.
- [ ] Instagram: publish a JPEG, then a short MP4 (appears as a Reel); History shows the permalink.
- [ ] Instagram with a PNG or two attachments is rejected by validation before queueing.
- [ ] Revoke the app in Facebook settings; next job fails as an auth error and is not retried.

## Manual verification checklist — TikTok

- [ ] Connect TikTok; Accounts → detect shows your display name.
- [ ] Upload a short MP4 (< 10 MB first, then > 20 MB to exercise chunking).
- [ ] Publish with privacy **Private**; History shows *Published* once TikTok reports `PUBLISH_COMPLETE`.
- [ ] Choosing a privacy level your account does not offer fails with a clear message before anything is posted.
- [ ] A video longer than your account's limit is rejected.

## Manual verification checklist — agents, calendar, analytics

- [ ] Agents tab: run the Content Writer; a draft appears marked AI-assisted; nothing is queued.
- [ ] Untick *Edit drafts* for the Writer, save, run again: it can no longer update drafts.
- [ ] Calendar: schedule two posts; switch Month/Week/Day/List; reschedule one; times display in `OWNER_TIMEZONE`.
- [ ] Analytics → Refresh after a real post: numbers match the platform's own UI; unavailable metrics are listed, not shown as 0.

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
`tests/social-ai.test.ts` (prompt fencing/limits, daily cap, usage ledger, fail-safes, mocked model),
`tests/social-meta.test.ts` (Facebook/Instagram adapters and error classification, mocked fetch),
`tests/integrations-callback-2fa.test.ts` (OAuth callback security). Mocks are never presented as live integrations.
