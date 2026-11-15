# Deployment

Target: Vercel + Supabase (existing). No new paid infrastructure is required.

1. **Backup, then migrate:** `npm run db:backup` then `npm run migrate:apply` (see `docs/DATABASE.md`). Migrations 0024–0027 are
   additive and re-runnable; CI rebuilds the schema from scratch twice (`.github/workflows/migrations.yml`).
2. **Storage:** migration 0024 creates the private `social-media` bucket (also create it in the Supabase dashboard if your project blocks SQL on `storage.buckets`). Check your plan's file-size limit (the bucket is set to 5 GB; the plan may cap lower).
3. **Env vars** in Vercel (see `docs/ENVIRONMENT.md`). Set `BETTER_AUTH_SECRET`, `INTEGRATIONS_SECRET`, `CRON_SECRET`, `KV_*` first.
4. **Platform apps** (Google, Meta, TikTok): register the exact redirect URIs; complete reviews/audits (`docs/SOCIAL_STUDIO.md`).
5. **Scheduler:** set GitHub secrets `APP_URL` and `CRON_SECRET`. `.github/workflows/social-worker.yml` calls `/api/social/run` every 10 min.
   (Vercel Hobby crons are daily-only; on Pro you can add `{ "path": "/api/social/run", "schedule": "*/10 * * * *" }` to `vercel.json`.)
6. **Verify:** `npm run typecheck && npm run lint && npm test && npm run build`; then the manual checklists in `docs/SOCIAL_STUDIO.md`.
7. Large uploads go browser → Supabase directly; publishing streams from Storage, bounded by the worker's `maxDuration` (300 s).

Rollback: migrations have documented rollback notes in their headers; code rollback is a Vercel redeploy.
