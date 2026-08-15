import "server-only";

import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

/**
 * Better Auth on the same Postgres instance Supabase runs.
 * Owner sign-in is email + password; agents authenticate with bearer tokens
 * issued from /dashboard/access (see src/lib/agent-tokens.ts).
 */
export const auth = betterAuth({
  database: new Pool({
    connectionString,
    ssl: connectionString?.includes("supabase.")
      ? { rejectUnauthorized: false }
      : undefined,
  }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  emailAndPassword: {
    enabled: true,
    // Single-owner console: accounts are seeded deliberately, not self-served.
    autoSignIn: true,
  },
  plugins: [bearer()],
});

export type Session = typeof auth.$Infer.Session;
