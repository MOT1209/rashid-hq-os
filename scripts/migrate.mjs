#!/usr/bin/env node
/**
 * Safe, idempotent migration runner for the Supabase Postgres database.
 *
 *   node --env-file=.env.local scripts/migrate.mjs <command>
 *
 * Commands:
 *   status    List migration files vs the schema_migrations table. (read-only)
 *   baseline  Mark 0001..0013 as applied without running them — for a database
 *             whose schema already exists (it was built file-by-file before any
 *             migration ledger existed). Run once, ever.
 *   dry-run   Preview exactly what "apply" would run. (read-only)
 *   apply     Run pending migrations in order: backup -> apply -> validate.
 *   apply --from-scratch
 *             Apply EVERY migration file to an empty database, in order, in
 *             one transaction. Refuses to run when the schema already exists
 *             (public.projects present). This is what the CI workflow runs
 *             against its ephemeral Postgres, and the proof that a fresh
 *             clone can build the schema from the files alone.
 *
 * Safety model:
 *   - All pending files run inside ONE transaction under a Postgres advisory
 *     lock. Any failure rolls the whole batch back — the database is left
 *     exactly as it was.
 *   - A pre-apply backup of every public table is written to backups/ before
 *     anything changes. A failed backup aborts the run.
 *   - Post-apply validation re-checks the objects each pending file was
 *     supposed to create, so a silent no-op cannot pass unnoticed.
 *   - Every migration file is re-runnable by design (create-if-not-exists,
 *     guarded column adds), so recovering from a validation failure never
 *     needs hand-written SQL.
 *
 * Rollback: restore from backups/pre-migrate-*.json (see docs/MIGRATIONS.md)
 * or delete the offending rows from schema_migrations and re-run — the files
 * themselves are safe to replay.
 *
 * Needs DATABASE_URL in .env.local (same connection string auth-migrate.mjs
 * uses).
 */
import pg from "pg";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";
const BASELINE = 13; // 0001..0013 predate this tool; see "baseline" above.
const LEDGER_TABLE = "schema_migrations";
const BACKUP_DIR = "backups";
const ADVISORY_LOCK_KEY = 74291835;

// Post-apply validation: one or more queries per migration file, each of
// which must return ok = true. Keyed by file basename. These run only for
// files applied in the current run, after the transaction has committed.
const CHECKS = {
  "0014_policy_decisions.sql": [
    {
      label: "agent_logs has decision/decision_reason/actor_type",
      sql: `select count(*) = 3 as ok
              from information_schema.columns
             where table_schema = 'public' and table_name = 'agent_logs'
               and column_name in ('decision', 'decision_reason', 'actor_type')`,
    },
    {
      label: "agent_logs status check includes awaiting_approval",
      sql: `select exists(
              select 1 from pg_constraint
               where conname = 'agent_logs_status_check'
                 and pg_get_constraintdef(oid) like '%awaiting_approval%'
            ) as ok`,
    },
  ],
  "0015_tool_approvals.sql": [
    { label: "tool_approvals table exists", sql: `select to_regclass('public.tool_approvals') is not null as ok` },
    {
      label: "tool_approvals RLS enabled",
      sql: `select relrowsecurity as ok from pg_class where oid = 'public.tool_approvals'::regclass`,
    },
  ],
  "0016_agent_runs.sql": [
    { label: "agent_runs table exists", sql: `select to_regclass('public.agent_runs') is not null as ok` },
    {
      label: "agent_runs RLS enabled",
      sql: `select relrowsecurity as ok from pg_class where oid = 'public.agent_runs'::regclass`,
    },
  ],
  "0017_policies.sql": [
    { label: "policies table exists", sql: `select to_regclass('public.policies') is not null as ok` },
    {
      label: "policy seed rows present",
      sql: `select count(*) = 3 as ok from public.policies
             where id in ('standing-task-write-guard', 'delete-project-needs-approval', 'already-guarded-writes')`,
    },
  ],
  "0018_budgets.sql": [
    {
      label: "departments has monthly_token_budget/budget_alerted_at",
      sql: `select count(*) = 2 as ok
              from information_schema.columns
             where table_schema = 'public' and table_name = 'departments'
               and column_name in ('monthly_token_budget', 'budget_alerted_at')`,
    },
    { label: "budget_events table exists", sql: `select to_regclass('public.budget_events') is not null as ok` },
  ],
  "0019_webhook_dedup.sql": [
    {
      label: "webhook_events.content_hash column exists",
      sql: `select exists(
              select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'webhook_events'
                 and column_name = 'content_hash'
            ) as ok`,
    },
    {
      label: "unique (provider, content_hash) partial index exists",
      sql: `select exists(
              select 1 from pg_indexes
               where schemaname = 'public' and tablename = 'webhook_events'
                 and indexname = 'webhook_events_provider_content_hash_key'
            ) as ok`,
    },
  ],
  "0020_tracking.sql": [
    {
      label: "tracking_months/members/cells/scores tables exist",
      sql: `select (to_regclass('public.tracking_months') is not null
                and to_regclass('public.tracking_members') is not null
                and to_regclass('public.tracking_cells') is not null
                and to_regclass('public.tracking_scores') is not null) as ok`,
    },
  ],
  "0021_budget_exhausted_alert.sql": [
    {
      label: "departments has budget_exhausted_alerted_at",
      sql: `select exists(
              select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'departments'
                 and column_name = 'budget_exhausted_alerted_at'
            ) as ok`,
    },
  ],
  "0022_project_budgets.sql": [
    {
      label: "projects has the 3 budget columns",
      sql: `select count(*) = 3 as ok
              from information_schema.columns
             where table_schema = 'public' and table_name = 'projects'
               and column_name in ('monthly_token_budget', 'budget_alerted_at', 'budget_exhausted_alerted_at')`,
    },
    {
      label: "agent_runs.project_id + budget_events.project_id exist",
      sql: `select (exists(
                select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'agent_runs'
                   and column_name = 'project_id'
              ) and exists(
                select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'budget_events'
                   and column_name = 'project_id'
              )) as ok`,
    },
  ],
  "0023_approval_expiry.sql": [
    {
      label: "tool_approvals.expires_at exists",
      sql: `select exists(
              select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'tool_approvals'
                 and column_name = 'expires_at'
            ) as ok`,
    },
    {
      label: "tool_approvals status check allows 'expired'",
      sql: `select exists(
              select 1 from pg_constraint
               where conname = 'tool_approvals_status_check'
                 and pg_get_constraintdef(oid) like '%expired%'
            ) as ok`,
    },
  ],
};

const log = (...a) => console.log(...a);
const fail = (msg) => {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
};

function parseCommand() {
  const args = process.argv.slice(2);
  const fromScratch = args.includes("--from-scratch");
  const [command] = args.filter((a) => !a.startsWith("--"));
  const valid = ["status", "baseline", "dry-run", "apply"];
  if (!valid.includes(command)) {
    log(`Usage: node --env-file=.env.local scripts/migrate.mjs <${valid.join("|")}> [--from-scratch]`);
    log("See docs/MIGRATIONS.md for the full procedure.");
    process.exit(1);
  }
  if (fromScratch && command !== "apply") {
    fail("--from-scratch only makes sense with: apply");
  }
  return { command, fromScratch };
}

/** Numeric-prefix order so 0002 < 0010 < 0014. */
function listMigrationFiles() {
  const dir = path.resolve(MIGRATIONS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
    .map((f) => path.join(MIGRATIONS_DIR, f));
}

/** Leading `--` comment block of a migration file, for dry-run display. */
function headerComment(file) {
  const lines = [];
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (line.startsWith("--")) lines.push(line);
    else if (lines.length > 0 && line.trim() === "") continue; // blank line inside the header
    else break;
    if (lines.length >= 14) break;
  }
  return lines.join("\n");
}

/** Mirrors scripts/auth-migrate.mjs: verify TLS by default, documented opt-out. */
async function connect() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    fail("DATABASE_URL is not set. Add it to .env.local (same string auth-migrate.mjs uses).");
  }
  const noVerify =
    process.env.SUPABASE_SSL_VERIFY_NONE === "1" || process.env.MIGRATE_TLS_VERIFY_NONE === "1";
  const ssl = noVerify
    ? { rejectUnauthorized: false }
    : connectionString.includes("supabase.")
      ? { rejectUnauthorized: true }
      : undefined;
  const client = new pg.Client({ connectionString, ssl });
  await client.connect();
  return client;
}

async function ensureLedger(client) {
  await client.query(
    `create table if not exists public.${LEDGER_TABLE} (
       name text primary key,
       applied_at timestamptz not null default now()
     )`,
  );
}

async function appliedSet(client) {
  const { rows } = await client.query(`select name from public.${LEDGER_TABLE}`);
  return new Set(rows.map((r) => r.name));
}

/** Read-only variant: empty set when the ledger table does not exist yet. */
async function appliedSetIfLedgerExists(client) {
  const { rows } = await client.query(
    `select to_regclass('public.${LEDGER_TABLE}') is not null as ok`,
  );
  return rows[0]?.ok ? await appliedSet(client) : new Set();
}

/** Pending = not in the ledger and newer than the baseline. */
async function pendingMigrations(client) {
  const applied = await appliedSet(client);
  return listMigrationFiles().filter(
    (f) => !applied.has(path.basename(f)) && parseInt(path.basename(f), 10) > BASELINE,
  );
}

/**
 * Dump every public table to backups/pre-migrate-<stamp>.json. Returns the
 * file path. Throws on any error — callers must abort before touching schema.
 */
async function backup(client) {
  await mkdir(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  const file = path.join(BACKUP_DIR, `pre-migrate-${stamp}.json`);
  const { rows: tables } = await client.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name`,
  );
  const dump = {
    generated_at: new Date().toISOString(),
    note: "Pre-migration backup created by scripts/migrate.mjs",
    tables: {},
  };
  const manifest = [];
  for (const { table_name } of tables) {
    const { rows } = await client.query(`select * from public."${table_name}"`);
    dump.tables[table_name] = rows;
    manifest.push({ table: table_name, rows: rows.length });
  }
  await writeFile(file, JSON.stringify(dump, null, 2));
  await writeFile(
    file.replace(/\.json$/, ".manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  log(`Backup: ${file} (${manifest.reduce((n, t) => n + t.rows, 0)} rows across ${manifest.length} tables)`);
  return file;
}

async function runChecks(client, file) {
  const checks = CHECKS[path.basename(file)] ?? [];
  for (const check of checks) {
    const { rows } = await client.query(check.sql);
    const ok = rows[0]?.ok === true;
    log(`  ${ok ? "✓" : "✗"} ${check.label}`);
    if (!ok) return false;
  }
  return true;
}

/* -------------------------------- commands -------------------------------- */

async function cmdStatus(client) {
  // Read-only: check the ledger exists in the catalog instead of creating it.
  const applied = await appliedSetIfLedgerExists(client);
  const files = listMigrationFiles();
  if (files.length === 0) return log(`No .sql files under ${MIGRATIONS_DIR}.`);
  log(`Migration files vs ${LEDGER_TABLE}:\n`);
  for (const f of files) {
    const name = path.basename(f);
    const n = parseInt(name, 10);
    const mark = applied.has(name) ? "✓ applied" : n <= BASELINE ? "· baseline (assumed applied)" : "… pending";
    log(`  ${mark.padEnd(30)} ${name}`);
  }
  const pending = files.filter((f) => !applied.has(path.basename(f)) && parseInt(path.basename(f), 10) > BASELINE);
  log(`\n${pending.length} pending. Preview with: dry-run  ·  Execute with: apply`);
}

async function cmdDryRun(client) {
  // Files first, ledger second: a missing ledger table must not block preview.
  const files = listMigrationFiles();
  if (files.length === 0) return log(`No .sql files under ${MIGRATIONS_DIR}.`);
  const applied = await appliedSetIfLedgerExists(client);
  const pending = files.filter(
    (f) => !applied.has(path.basename(f)) && parseInt(path.basename(f), 10) > BASELINE,
  );
  if (pending.length === 0) return log("Nothing to apply — no pending migrations.");
  log(`Would apply ${pending.length} migration(s) in one transaction:\n`);
  for (const f of pending) {
    log(`── ${path.basename(f)} ${"─".repeat(Math.max(1, 60 - path.basename(f).length))}`);
    log(headerComment(f));
    log("");
  }
  log(`Then: pre-apply backup to ${BACKUP_DIR}/ -> post-apply validation (CHECKS).`);
}

async function cmdBaseline(client) {
  await ensureLedger(client);
  const baselineFiles = listMigrationFiles().filter((f) => parseInt(path.basename(f), 10) <= BASELINE);
  const applied = await appliedSet(client);
  const toMark = baselineFiles.filter((f) => !applied.has(path.basename(f)));
  if (toMark.length === 0) return log("Baseline already recorded — nothing to do.");
  for (const f of toMark) {
    await client.query(`insert into ${LEDGER_TABLE} (name) values ($1) on conflict do nothing`, [
      path.basename(f),
    ]);
    log(`  · marked ${path.basename(f)}`);
  }
  log(`\nBaseline recorded. Verify with: status\nRun ONCE — it marks history, it does not replay it.`);
}

/**
 * from-scratch guard: that mode exists for CI's ephemeral Postgres, where an
 * empty database is the only safe state. Any existing schema means a plain
 * `apply` (ledger-driven) is what was wanted — or a deliberate `drop schema
 * public cascade` first.
 */
async function assertEmptyDatabase(client) {
  const { rows } = await client.query(`select to_regclass('public.projects') is not null as ok`);
  if (rows[0]?.ok === true) {
    fail(
      "from-scratch refuses to run: public.projects already exists, so this is not an empty database.\n" +
        "  For a real database use plain: apply\n" +
        "  If you truly mean to rebuild: drop schema public cascade; create schema public; — then re-run.",
    );
  }
}

async function cmdApply(client, fromScratch = false) {
  await ensureLedger(client);
  let pending;
  if (fromScratch) {
    await assertEmptyDatabase(client);
    pending = listMigrationFiles();
    if (pending.length === 0) return log(`No .sql files under ${MIGRATIONS_DIR} — nothing to build.`);
    log(
      `FROM-SCRATCH: applying all ${pending.length} migration(s) to an empty database, in order, in one transaction.\n`,
    );
  } else {
    pending = await pendingMigrations(client);
    if (pending.length === 0) return log("Nothing to apply — no pending migrations.");
    log(`Pending (${pending.length}):\n${pending.map((f) => `  - ${path.basename(f)}`).join("\n")}\n`);
  }

  const got = await client.query("select pg_try_advisory_lock($1) as ok", [ADVISORY_LOCK_KEY]);
  if (got.rows[0]?.ok !== true) {
    fail("Another migration run holds the advisory lock. Wait for it to finish.");
  }
  try {
    if (fromScratch) {
      log("Skipping backup — from-scratch targets an empty database (nothing to back up yet).");
    } else {
      await backup(client);
    }

    log("\nApplying in one transaction (any failure rolls everything back)…");
    await client.query("begin");
    try {
      for (const f of pending) {
        await client.query(readFileSync(f, "utf8"));
        await client.query(`insert into ${LEDGER_TABLE} (name) values ($1) on conflict do nothing`, [
          path.basename(f),
        ]);
        log(`  → applied ${path.basename(f)}`);
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    }

    log("\nValidating…");
    for (const f of pending) {
      log(` ${path.basename(f)}`);
      const ok = await runChecks(client, f);
      if (!ok) {
        fail(
          `Validation failed after applying ${path.basename(f)}.\n` +
            `  The schema change itself is committed (files are re-runnable, so re-running apply is safe),\n` +
            `  but the expected object is missing or drifted. Inspect the pre-apply backup in ${BACKUP_DIR}/\n` +
            `  and docs/MIGRATIONS.md before retrying.`,
        );
      }
    }
    log("\n✓ All migrations applied and validated.");
    log("  Next: the manual checks in docs/MIGRATIONS.md (post-apply checklist).");
  } finally {
    await client.query("select pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
  }
}

/* ---------------------------------- main ---------------------------------- */

const { command, fromScratch } = parseCommand();
let client;
try {
  client = await connect();
  if (command === "status") await cmdStatus(client);
  else if (command === "dry-run") await cmdDryRun(client);
  else if (command === "baseline") await cmdBaseline(client);
  else if (command === "apply") await cmdApply(client, fromScratch);
} catch (err) {
  fail(err?.message ?? String(err));
} finally {
  if (client) await client.end().catch(() => {});
}
