/**
 * Which backend the request throttle in src/proxy.ts may use.
 *
 * The throttle falls back to an in-memory counter when Upstash is not wired
 * up. On one instance that is a real brake; on Vercel (or any multi-instance
 * host) each instance counts only its own share of the traffic, so the
 * effective limit is `max × instances` and a password-guessing run simply
 * spreads across them. That fallback used to happen silently in production
 * whenever KV_REST_API_URL/TOKEN were missing — this module turns that into a
 * loud failure instead.
 *
 * Deliberately dependency-free and not "server-only": next.config.ts imports
 * it at build time (plain Node, no Next module graph), and src/proxy.ts and
 * src/instrumentation.ts import it at runtime.
 *
 * Checked at three points, earliest first:
 *   1. `next build` on a Vercel production deployment (next.config.ts) — a
 *      failed build leaves the previous deployment serving, which is the only
 *      layer that fails without an outage.
 *   2. Server boot (src/instrumentation.ts `register`) — covers self-hosted
 *      `next start`, where there is no Vercel build step to catch it.
 *   3. Proxy module load (src/proxy.ts) — the backstop: if both of the above
 *      were bypassed, every throttled request errors rather than quietly
 *      running on a per-instance counter.
 */

type Env = Readonly<Record<string, string | undefined>>;

export type RateLimitBackend =
  | { kind: "redis"; url: string; token: string }
  | { kind: "memory"; reason: string };

export class RateLimitConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitConfigError";
  }
}

/**
 * Explicit, auditable escape hatch for a genuinely single-instance production
 * host (one VM running `next start`), where an in-memory counter is exact.
 * Never set it on Vercel.
 */
export const ALLOW_IN_MEMORY_FLAG = "RATE_LIMIT_ALLOW_IN_MEMORY";

/**
 * VERCEL_ENV wins when present: `next build` always sets NODE_ENV=production,
 * so NODE_ENV alone would treat every preview deployment — and every local
 * `npm run build` — as production. Off Vercel, NODE_ENV is all there is.
 */
export function isProductionRuntime(env: Env = process.env): boolean {
  if (env.VERCEL_ENV) return env.VERCEL_ENV === "production";
  return env.NODE_ENV === "production";
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Resolves the backend or throws RateLimitConfigError. Never returns
 * `memory` in production unless the operator opted in by name.
 */
export function resolveRateLimitBackend(env: Env = process.env): RateLimitBackend {
  const url = nonEmpty(env.KV_REST_API_URL);
  const token = nonEmpty(env.KV_REST_API_TOKEN);
  const production = isProductionRuntime(env);

  // Half-configured is always a mistake (a typo, a partially pulled env), in
  // every environment: it would otherwise read as "no Redis" and fall back.
  if (Boolean(url) !== Boolean(token)) {
    throw new RateLimitConfigError(
      `Rate limiting is half-configured: ${url ? "KV_REST_API_TOKEN" : "KV_REST_API_URL"} is missing. ` +
        "Set both (Upstash for Redis integration) or neither.",
    );
  }

  if (url && token) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new RateLimitConfigError("KV_REST_API_URL is not a valid URL.");
    }
    // The token rides in an Authorization header on every request.
    if (production && parsed.protocol !== "https:") {
      throw new RateLimitConfigError("KV_REST_API_URL must use https:// in production.");
    }
    return { kind: "redis", url, token };
  }

  if (!production) {
    return { kind: "memory", reason: "non-production environment" };
  }

  if (env[ALLOW_IN_MEMORY_FLAG] === "1") {
    return { kind: "memory", reason: `${ALLOW_IN_MEMORY_FLAG}=1 (single-instance host)` };
  }

  throw new RateLimitConfigError(
    "Refusing to start in production without a shared rate-limit store: " +
      "KV_REST_API_URL and KV_REST_API_TOKEN are not set. The in-memory fallback " +
      "counts per instance, so on a multi-instance host it does not actually limit. " +
      "Connect Upstash for Redis (`vercel integration add upstash/upstash-kv`), or — only " +
      `on a single-instance host — set ${ALLOW_IN_MEMORY_FLAG}=1.`,
  );
}

/**
 * Build-time gate for next.config.ts. Only a Vercel *production* build is
 * checked: that is the one build whose output is guaranteed to serve
 * production traffic, and the env vars it will run with are present at build
 * time. Local and CI builds (NODE_ENV=production, no VERCEL_ENV) pass through;
 * the boot-time check in src/instrumentation.ts covers them if they are ever
 * started as production.
 */
export function assertRateLimitBackendAtBuild(env: Env = process.env): void {
  if (env.VERCEL_ENV !== "production") return;
  resolveRateLimitBackend(env);
}
