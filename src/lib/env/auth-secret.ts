/**
 * Guards the Better Auth signing secret against the one misconfiguration that
 * is silent, total and unfixable after the fact: running production on the
 * secret the library falls back to when BETTER_AUTH_SECRET is unset.
 *
 * Better Auth's fallback is not random — it is a hard-coded public constant
 * (`better-auth-secret-…`, see better-auth/dist/utils/constants.mjs) baked into
 * every published copy. Signing session cookies with it lets anyone mint a
 * valid session for any user; two-factor never comes into play because the
 * signed session is what the second factor protects, not replaces. Nothing
 * logs, nothing fails — sign-in just works.
 *
 * Mirrors src/lib/env/rate-limit.ts deliberately: dependency-free (no
 * "server-only", no Next module graph) so next.config.ts can import it at
 * build time, and checked at the same three points:
 *   1. `next build` on a Vercel production deployment (next.config.ts) —
 *      a failed build keeps the previous deployment serving.
 *   2. Server boot (src/instrumentation.ts `register`) — covers self-hosted
 *      `next start` and any path that skipped the build gate.
 *   3. (No proxy hook needed: unlike the throttle, this value is only read
 *      through src/lib/auth.ts, which boot always initialises.)
 *
 * Local dev is the intended user of the fallback — Better Auth warns, and a
 * dev secret only signs dev cookies — so nothing below fires outside a
 * production runtime.
 */

/** Better Auth's hard-coded fallback, verbatim from the installed package. */
export const BETTER_AUTH_DEFAULT_SECRET = "better-auth-secret-12345678901234567890";

type Env = Readonly<Record<string, string | undefined>>;

/** Same production test as rate-limit.ts: VERCEL_ENV wins, NODE_ENV is the fallback. */
export function isProductionRuntime(env: Env): boolean {
  if (env.VERCEL_ENV) return env.VERCEL_ENV === "production";
  return env.NODE_ENV === "production";
}

export class AuthSecretConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthSecretConfigError";
  }
}

/**
 * Throws AuthSecretConfigError when a production runtime is about to sign
 * sessions with Better Auth's default secret — unset or set to the literal
 * fallback (an operator who copied it from a tutorial), both are the same
 * public key.
 *
 * CI and local builds pass through: `next build` sets NODE_ENV=production
 * everywhere, and the workflow's placeholder (see .github/workflows/ci.yml)
 * is intentionally not a real secret — VERCEL_ENV is what distinguishes the
 * one build that serves production traffic.
 */
export function assertAuthSecretConfigured(env: Env = process.env): void {
  if (!isProductionRuntime(env)) return;

  const secret = env.BETTER_AUTH_SECRET?.trim();
  if (!secret || secret === BETTER_AUTH_DEFAULT_SECRET) {
    throw new AuthSecretConfigError(
      secret
        ? "BETTER_AUTH_SECRET is set to Better Auth's hard-coded default. That value is public " +
          "and lets anyone mint a valid session cookie for any user. Generate a real secret " +
          "(`openssl rand -base64 32`) and set it in Vercel Production, then redeploy."
        : "BETTER_AUTH_SECRET is not set. Better Auth would silently fall back to its hard-coded " +
          "public default, letting anyone mint a valid session cookie for any user. Generate one " +
          "(`openssl rand -base64 32`) and set it in Vercel Production, then redeploy.",
    );
  }
}

/**
 * Build-time gate for next.config.ts — same contract as
 * assertRateLimitBackendAtBuild: only the Vercel production build is checked,
 * because that is the one build whose env is the env production will run with.
 */
export function assertAuthSecretAtBuild(env: Env = process.env): void {
  if (env.VERCEL_ENV !== "production") return;
  assertAuthSecretConfigured(env);
}
