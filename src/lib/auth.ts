import "server-only";

import { APIError, betterAuth } from "better-auth";
import { bearer, twoFactor } from "better-auth/plugins";
import { Pool } from "pg";

import { isOwnerEmail } from "@/lib/owners";
import { sendPasswordReset } from "@/lib/email";

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
    /**
     * Without this a forgotten password meant editing the database by hand —
     * on an account with no second owner to fall back on. Sends only when
     * RESEND_API_KEY is set; the endpoint stays enabled either way, and Better
     * Auth's reply is identical whether or not the address exists, so it does
     * not leak who has an account.
     */
    sendResetPassword: async ({ user, url }) => {
      await sendPasswordReset(user.email, url);
    },
    resetPasswordTokenExpiresIn: 3600,
  },
  databaseHooks: {
    session: {
      create: {
        /**
         * A session row is only written once credentials (and the second
         * factor, when enabled) have passed, so this is the sign-in itself.
         *
         * Until now the feed recorded what agents and the owner *did* but
         * never who came in, which is the first thing anyone would want after
         * suspecting a compromised password. Failed attempts are not visible
         * here — Better Auth's Postgres rate limiter counts those — so this
         * answers "when did this account last sign in", not "who is guessing".
         */
        after: async (session) => {
          try {
            const { logActivity } = await import("@/lib/activity");
            await logActivity({
              agentName: "Sign-in",
              toolName: "sign_in",
              // No IP or user agent: they would be the only personal data this
              // console stores about a visitor, and the session row already
              // carries them for Better Auth's own purposes.
              payload: { user_id: session.userId },
              status: "success",
            });
          } catch (cause) {
            // An audit write must never be able to refuse a valid sign-in.
            console.error("[auth] sign-in log failed:", cause);
          }
        },
      },
    },
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
  plugins: [
    bearer(),
    // TOTP + backup codes only — no email/SMS OTP, which would need its own
    // delivery channel this console doesn't have. `enable` only issues the
    // secret; `twoFactorEnabled` flips on after the first verifyTotp, so a
    // scan that's never completed never locks the owner out.
    twoFactor({ issuer: "Alking HQ OS" }),
  ],
});

export type Session = typeof auth.$Infer.Session;
