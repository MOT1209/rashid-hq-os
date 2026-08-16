import "server-only";

import { APIError, betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { Pool } from "pg";

import { isOwnerEmail } from "@/lib/owners";

const connectionString = process.env.DATABASE_URL;
const isDev = process.env.NODE_ENV === "development";

/**
 * Every origin this console is legitimately reached from.
 *
 * Better Auth rejects a request whose Origin is not trusted, and it trusts
 * `baseURL` alone by default. With a single env var that means exactly one
 * working origin: local development, every Vercel preview deployment
 * (`*-git-*.vercel.app`) and any future custom domain would all fail sign-in
 * with INVALID_ORIGIN until the variable was changed to match.
 *
 * VERCEL_URL / VERCEL_BRANCH_URL are set by the platform per deployment and
 * are hostnames without a scheme.
 */
function trustedOrigins() {
  const origins = new Set<string>();

  const configured = process.env.BETTER_AUTH_URL;
  if (configured) origins.add(configured);

  for (const host of [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL]) {
    if (host) origins.add(`https://${host}`);
  }

  // Extra origins for a custom domain, comma separated.
  for (const extra of (process.env.TRUSTED_ORIGINS ?? "").split(",")) {
    const trimmed = extra.trim();
    if (trimmed) origins.add(trimmed);
  }

  if (isDev) {
    origins.add("http://localhost:7070");
    origins.add("http://127.0.0.1:7070");
  }

  return [...origins];
}

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
  baseURL:
    process.env.BETTER_AUTH_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:7070"),
  trustedOrigins: trustedOrigins(),
  /**
   * Counters live in Postgres, not in process memory. The proxy's in-memory
   * throttle cannot accumulate reliably on serverless — each invocation may
   * start cold — which left online password guessing against a single known
   * owner address effectively unthrottled.
   */
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 60,
    customRules: {
      // The endpoints worth guessing against, held far tighter than the rest.
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 3600, max: 5 },
      "/change-password": { window: 3600, max: 10 },
    },
  },
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 12,
  },
  databaseHooks: {
    user: {
      create: {
        /**
         * `POST /api/auth/sign-up/email` is public by design in Better Auth, so
         * this is what actually closes the door. Two ways through: an address in
         * OWNER_EMAILS (fails closed when unset), or one an admin has invited
         * into `members`. Re-registering an existing account is blocked by the
         * unique email constraint.
         */
        before: async (user) => {
          // Invited members can create their account; everyone else cannot.
          // Checked in this order so OWNER_EMAILS never needs the database.
          if (isOwnerEmail(user.email)) return;

          const { resolveRole } = await import("@/lib/members");
          if (await resolveRole(user.email)) return;

          throw new APIError("FORBIDDEN", {
            message: "Sign-up is closed on this console.",
          });
        },
      },
    },
  },
  plugins: [bearer()],
});

export type Session = typeof auth.$Infer.Session;
