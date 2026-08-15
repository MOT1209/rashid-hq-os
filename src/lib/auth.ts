import "server-only";

import { APIError, betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { Pool } from "pg";

import { isOwnerEmail } from "@/lib/owners";

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
    autoSignIn: true,
    minPasswordLength: 12,
  },
  databaseHooks: {
    user: {
      create: {
        /**
         * Single-owner console. `POST /api/auth/sign-up/email` is public by
         * design in Better Auth, so the allowlist is what actually closes the
         * door — it fails closed when OWNER_EMAILS is unset. Seeding the owner
         * still works (scripts/seed-owner.mjs), and re-registering an existing
         * owner is blocked by the unique email constraint.
         */
        before: async (user) => {
          if (!isOwnerEmail(user.email)) {
            throw new APIError("FORBIDDEN", {
              message: "Sign-up is closed on this console.",
            });
          }
        },
      },
    },
  },
  plugins: [bearer()],
});

export type Session = typeof auth.$Infer.Session;
