/**
 * Snapshot the `public` schema before applying a migration.
 *
 *   npm run db:backup                       # backups/<timestamp>/
 *   npm run db:backup -- --label 0021       # backups/<timestamp>-0021/
 *   npm run db:backup -- --out /secure/dir
 *
 * Chain it so a failed backup stops the migration (exit code is non-zero on
 * any failure):
 *
 *   npm run db:backup -- --label 0021 && \
 *     psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 \
 *       -f supabase/migrations/0021_budget_exhausted_alert.sql
 *
 * What it does, in order — and why each step is there:
 *   1. Pre-flight over `pg`: server version and row counts of the sensitive
 *      tables (policies, agent_tokens, …). The counts go into the manifest so
 *      a restore can be checked against numbers, not a feeling.
 *   2. Refuses an older pg_dump than the server: pg_dump cannot dump a newer
 *      server, and a half-written dump is worse than none.
 *   3. pg_dump in custom format (-Fc): compressed, and pg_restore can pull a
 *      single table (`-t policies`) out of it, which is the common rollback.
 *   4. Verifies the archive with `pg_restore --list` and checks the sensitive
 *      tables' data is actually in it.
 *   5. Writes manifest.json with a SHA-256 of the archive.
 *
 * Security:
 *   - The dump contains agent_tokens digests, Better Auth password hashes and
 *     live sessions, and sealed integration credentials. Files are written
 *     0600 in a 0700 directory, and /backups is git-ignored. Move it to
 *     encrypted storage; never commit or share it.
 *   - The password goes to pg_dump through PGPASSWORD in its environment,
 *     not on the command line, where `ps` on a shared host would show it.
 *   - pg_dump runs via spawn with an argument array — no shell, so nothing in
 *     DATABASE_URL or --label can be interpreted as a command.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

/** Tables whose loss or corruption changes who can do what. */
const SENSITIVE_TABLES = ["policies", "agent_tokens", "departments", "projects", "tool_approvals"];

function fail(message) {
  console.error(`[backup] ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { out: "backups", label: "" };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--out" && value) {
      args.out = value;
      i++;
    } else if (flag === "--label" && value) {
      args.label = value;
      i++;
    } else {
      fail(`Unknown or incomplete argument: ${flag}`);
    }
  }
  // The label becomes part of a directory name.
  if (args.label && !/^[\w.-]{1,64}$/.test(args.label)) {
    fail("--label may only contain letters, digits, '.', '_' and '-' (max 64).");
  }
  return args;
}

function connectionFromEnv() {
  const raw = process.env.DATABASE_URL;
  if (!raw) fail("DATABASE_URL is not set. Run through `npm run db:backup` (loads .env.local).");
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail("DATABASE_URL is not a valid URL.");
  }
  if (url.port === "6543") {
    // Supabase's transaction pooler cannot hold the long-lived snapshot
    // pg_dump needs; the session pooler (5432) or a direct connection can.
    fail("DATABASE_URL uses the transaction pooler (port 6543). Use the session pooler (5432).");
  }
  const password = decodeURIComponent(url.password);
  if (!password) fail("DATABASE_URL has no password.");
  const isSupabase = url.hostname.includes("supabase.");
  return {
    connectionString: raw,
    host: url.hostname,
    port: url.port || "5432",
    user: decodeURIComponent(url.username),
    password,
    database: decodeURIComponent(url.pathname.replace(/^\//, "")) || "postgres",
    isSupabase,
  };
}

function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) =>
      reject(error.code === "ENOENT" ? new Error(`${command} is not installed or not on PATH.`) : error),
    );
    child.on("close", (code) =>
      code === 0
        ? resolve(stdout)
        : reject(new Error(`${command} exited with ${code}: ${stderr.trim().slice(0, 2000)}`)),
    );
  });
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

async function preflight(conn) {
  // Mirrors scripts/auth-migrate.mjs: verify TLS against Supabase by default.
  const ssl =
    process.env.SUPABASE_SSL_VERIFY_NONE === "1"
      ? { rejectUnauthorized: false }
      : conn.isSupabase
        ? { rejectUnauthorized: true }
        : undefined;
  const client = new pg.Client({ connectionString: conn.connectionString, ssl });
  await client.connect();
  try {
    const { rows } = await client.query("select current_setting('server_version_num')::int as v");
    const serverVersionNum = rows[0].v;
    const rowCounts = {};
    for (const table of SENSITIVE_TABLES) {
      const exists = await client.query("select to_regclass($1) is not null as ok", [`public.${table}`]);
      if (!exists.rows[0].ok) {
        rowCounts[table] = null;
        continue;
      }
      // Identifier comes from the constant list above, never from input.
      const count = await client.query(`select count(*)::int as n from public."${table}"`);
      rowCounts[table] = count.rows[0].n;
    }
    return { serverVersionNum, rowCounts };
  } finally {
    await client.end();
  }
}

async function pgDumpMajor() {
  const out = await run("pg_dump", ["--version"]);
  const match = out.match(/(\d+)(?:\.\d+)?/);
  if (!match) throw new Error(`Could not read pg_dump version from: ${out.trim()}`);
  return { major: Number(match[1]), text: out.trim() };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const conn = connectionFromEnv();

  console.log(`[backup] pre-flight on ${conn.host}:${conn.port}/${conn.database}`);
  const { serverVersionNum, rowCounts } = await preflight(conn);
  const serverMajor = Math.floor(serverVersionNum / 10000);

  const dump = await pgDumpMajor();
  if (dump.major < serverMajor) {
    fail(
      `pg_dump ${dump.major} cannot dump a Postgres ${serverMajor} server. ` +
        `Install postgresql-client-${serverMajor} (or newer) and retry.`,
    );
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.resolve(args.out, args.label ? `${stamp}-${args.label}` : stamp);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const file = path.join(dir, "public.dump");

  const pgEnv = {
    PGPASSWORD: conn.password,
    // libpq's own TLS. `require` encrypts but does not check the certificate
    // chain: Supabase signs with its own CA, which is not in the system store.
    // For verify-full, download the CA from the dashboard and set
    // PGSSLMODE=verify-full PGSSLROOTCERT=/path/to/prod-ca.crt.
    PGSSLMODE: process.env.PGSSLMODE ?? (conn.isSupabase ? "require" : "prefer"),
  };

  console.log(`[backup] pg_dump (${dump.text}) -> ${file}`);
  await run(
    "pg_dump",
    [
      "--host", conn.host,
      "--port", conn.port,
      "--username", conn.user,
      "--dbname", conn.database,
      "--schema", "public",
      "--format", "custom",
      "--file", file,
      "--no-password",
    ],
    pgEnv,
  );
  await chmod(file, 0o600);

  // A dump that pg_restore cannot read, or that silently lacks the tables
  // this exists to protect, must fail here — not during an incident.
  const toc = await run("pg_restore", ["--list", file]);
  const missing = SENSITIVE_TABLES.filter(
    (table) => rowCounts[table] !== null && !new RegExp(`TABLE DATA public ${table} `).test(toc),
  );
  if (missing.length > 0) fail(`Archive is missing table data for: ${missing.join(", ")}`);

  const { size } = await stat(file);
  const manifest = {
    created_at: new Date().toISOString(),
    label: args.label || null,
    host: conn.host,
    database: conn.database,
    server_version_num: serverVersionNum,
    pg_dump: dump.text,
    file: "public.dump",
    bytes: size,
    sha256: await sha256(file),
    row_counts: rowCounts,
  };
  const manifestPath = path.join(dir, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });

  console.log(`[backup] ok — ${(size / 1024).toFixed(1)} KiB, sha256 ${manifest.sha256.slice(0, 16)}…`);
  console.log(`[backup] row counts: ${JSON.stringify(rowCounts)}`);
  console.log(`[backup] restore one table: see docs/DATABASE.md ("Rollback").`);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
