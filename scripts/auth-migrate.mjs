/**
 * Applies Better Auth's own schema migrations to DATABASE_URL.
 * Equivalent to `npx @better-auth/cli migrate`, but runs from the installed
 * package so it does not depend on a slow npx download.
 *   node --env-file=.env.local scripts/auth-migrate.mjs
 */
import { betterAuth } from "better-auth";
import { bearer, twoFactor } from "better-auth/plugins";
import { getMigrations } from "better-auth/db/migration";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const auth = betterAuth({
  database: new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false } }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:7070",
  emailAndPassword: { enabled: true, autoSignIn: true },
  // Must mirror src/lib/auth.ts, or the generated schema misses the rateLimit
  // table that database-backed throttling needs.
  rateLimit: { enabled: true, storage: "database" },
  plugins: [bearer(), twoFactor({ issuer: "Alking HQ OS" })],
});

const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(auth.options);

if (toBeCreated.length === 0 && toBeAdded.length === 0) {
  console.log("Schema already up to date.");
  process.exit(0);
}

console.log("Creating tables:", toBeCreated.map((t) => t.table).join(", ") || "none");
console.log("Adding columns to:", toBeAdded.map((t) => t.table).join(", ") || "none");

await runMigrations();
console.log("Better Auth migration complete.");
process.exit(0);
