# Database migrations: apply, back up, roll back

Migrations live in `supabase/migrations/`, numbered and applied in order. There
is no migration runner and no `supabase/config.toml`; each file is plain SQL
applied with `psql` (or pasted into the Supabase SQL editor). Every file is
written to be **re-runnable** (`if not exists`, `on conflict do nothing`), so
applying one twice is safe.

This document covers the production procedure. Locally, just apply the files.

## Why the sensitive tables need care

Some tables decide *who may do what*. Damage to them is a security incident,
not just data loss:

| Table | What goes wrong if a migration damages it |
| --- | --- |
| `policies` | The policy gate falls back to hard-coded rules, or a bad row turns `deny`/`require_approval` into `allow` for every agent. |
| `agent_tokens` | Every external agent loses access (rows dropped), or revoked/expired tokens come back (`revoked_at`/`expires_at` lost). |
| `departments` | Budgets (`monthly_token_budget`) and department prompts disappear; budget caps stop applying. |
| `tool_approvals` | Queued approvals vanish, or become approvable twice. |
| `user`, `session`, `account` (Better Auth) | Owners are locked out, or stale sessions are revived. |

`scripts/pre-migrate-backup.mjs` records row counts for the first five in its
manifest, so a restore can be checked against numbers.

## Procedure

### 1. Back up

```bash
npm run db:backup -- --label 0021
```

Requirements: `pg_dump`/`pg_restore` at least as new as the server's major
version (the script checks and refuses otherwise), and `DATABASE_URL` in
`.env.local` pointing at the **session pooler (port 5432)** or a direct
connection. The transaction pooler (6543) cannot hold pg_dump's snapshot; the
script refuses it.

Output: `backups/<timestamp>-<label>/public.dump` (custom format) and
`manifest.json` (SHA-256, server version, row counts). Both files are `0600`,
the directory `0700`, and `/backups/` is git-ignored.

> **The dump is a secret.** It contains token digests, Better Auth password
> hashes and live sessions, and sealed integration credentials. Move it to
> encrypted storage and delete the local copy when the migration is settled.

Don't lean on Supabase's own backups alone. Whether you get daily backups or
point-in-time recovery, how far back they go, and whether you can download
them all depend on your plan. Check **Database → Backups** in the dashboard.
I haven't verified what the project's current plan includes. The local dump
is the one copy that exists no matter the plan.

### 2. Apply in one transaction

```bash
npm run db:backup -- --label 0021 && \
  psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 \
    -f supabase/migrations/0021_budget_exhausted_alert.sql
```

- `&&`: the migration never runs if the backup failed.
- `--single-transaction` + `ON_ERROR_STOP=1`: Postgres DDL is transactional,
  so an error at any statement rolls back the *whole file*. Nothing is left
  half-applied. This is the first and cheapest rollback layer, and it is
  automatic.
- Exception: statements that cannot run inside a transaction
  (`CREATE INDEX CONCURRENTLY`, `ALTER TYPE … ADD VALUE` on older servers,
  `VACUUM`). A migration that needs one must say so in its header and be
  applied without `--single-transaction`. None of the current files do.

(Passing `DATABASE_URL` as an argument exposes the password to `ps` on a
shared host. On one, export `PGPASSWORD` and pass host/user/db flags instead.
The backup script already does this.)

### 3. Verify

- `select count(*) from public.policies;` etc. against `row_counts` in the
  manifest. A pure additive migration must not change them.
- Load `/dashboard/access` (policies + tokens) and `/dashboard/insights`.
- Run one read tool through the MCP endpoint with a read token
  (see [MCP-INTEGRATION.md](../MCP-INTEGRATION.md)).

## Rollback

Choose the smallest step that fixes the problem, in this order.

### A. The migration failed while applying

Nothing to do. `--single-transaction` already rolled it back. Fix the file and
re-apply.

### B. It applied, but the schema change is wrong

Prefer a **forward fix**: a new numbered migration that corrects the previous
one. The app's code expects the new schema, so going backwards usually means
redeploying old code as well.

If you must revert the schema, write the inverse by hand and apply it the
same way (`--single-transaction`). Example for 0021:

```sql
-- Inverse of 0021_budget_exhausted_alert.sql
alter table public.departments drop column if exists budget_exhausted_alerted_at;
```

(The code tolerates this column missing: the 100% mail then just isn't
throttled, and the failed stamp write is reported to Sentry.)

Dropping a column or table destroys its data. Take a fresh backup **before**
applying an inverse migration too.

### C. Data in a sensitive table was damaged

Restore just those tables from the pre-migration dump. The truncate and the
reload run in one transaction, so a failed restore leaves the table exactly as
it was, never empty:

```bash
DUMP=backups/<timestamp>-0021/public.dump
{ echo 'truncate public.policies, public.agent_tokens;';
  pg_restore --data-only -t policies -t agent_tokens -f - "$DUMP"; } \
  | psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1
```

Then compare counts with the manifest. Caveats:

- Rows written *after* the backup (a token issued, a policy toggled) are lost
  for the restored tables. Check `agent_logs` for anything to redo.
- `truncate` fails if another table has a foreign key into the one you are
  restoring. Add that table to both lists, or use `truncate … cascade` only
  once you have checked what it would empty.
- Restoring `agent_tokens` revives tokens revoked after the backup. Re-revoke
  them from `/dashboard/access` right after.

### D. Everything is wrong

Restore the whole `public` schema into a **new** database first, check it,
then switch `DATABASE_URL` / the Supabase project over. Restoring over the
live database in place is the last resort:

```bash
pg_restore --list "$DUMP" | head          # sanity-check the archive
pg_restore --clean --if-exists --no-owner --single-transaction \
  -d "$TARGET_DATABASE_URL" "$DUMP"
```

`--no-owner` because Supabase roles differ between projects. Grants and
`revoke`s from the migrations are in the dump and come back with it.

## Writing a new migration

- Number it next in sequence. Make it re-runnable.
- In the header comment, say what it changes and why, and how to roll it back
  (the inverse SQL, or "forward-fix only" with the reason).
- Add new tables with `enable row level security` and
  `revoke all … from anon, authenticated`, like every other table here.
- Update `src/types/supabase.ts` in the same commit.
