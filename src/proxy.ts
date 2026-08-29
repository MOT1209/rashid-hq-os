import { NextResponse, type NextRequest } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Two jobs, both of which have to happen before a route renders:
 *
 * 1. Security headers, including a nonce-based Content Security Policy. The
 *    dashboard renders agent-supplied strings (tool names, payloads, project
 *    names), so a CSP is the backstop if any of that ever escapes escaping.
 * 2. A sliding-window throttle on the routes where an unbounded caller costs
 *    something real: password guessing on /api/auth, token guessing plus
 *    agent_logs flooding on /api/mcp, model spend on /api/console, and every
 *    Server Action POST under /dashboard.
 *
 * The throttle is backed by Upstash Redis (REST, so it works from any
 * runtime) when KV_REST_API_URL/TOKEN are set — one shared counter across
 * every instance, which is the real requirement once this scales past one.
 * Locally, or in any environment where the integration isn't connected, it
 * falls back to an in-memory counter scoped to this instance: still a brake,
 * just not a cross-instance guarantee. Either way, the auth checks downstream
 * are the actual boundary — this is best-effort shaping in front of them.
 */

type Rule = {
  windowMs: number;
  max: number;
  /** Restricts the rule to these verbs. Omitted means every verb. */
  methods?: string[];
  /** Over-limit body. A page prefix must not answer a navigation with JSON. */
  format?: "json" | "text";
};

const RULES: [prefix: string, rule: Rule][] = [
  ["/api/auth", { windowMs: 60_000, max: 20 }],
  ["/api/mcp", { windowMs: 60_000, max: 120 }],
  ["/api/console", { windowMs: 60_000, max: 20 }],
  // The cron routes fall back to an owner-session check when CRON_SECRET auth
  // fails, and /api/activity/export returns up to 5,000 rows with both jsonb
  // columns. Cron traffic is a handful of hits a day; anything more is abuse.
  ["/api/agent", { windowMs: 60_000, max: 10 }],
  ["/api/maintenance", { windowMs: 60_000, max: 10 }],
  ["/api/activity/export", { windowMs: 60_000, max: 10 }],
  // OAuth connect/callback/test plus API-key saves. A handful per session; a
  // burst is either a retry loop or someone probing the state store.
  ["/api/integrations", { windowMs: 60_000, max: 30 }],
  // Inbound provider webhooks are unauthenticated (signature-verified instead),
  // so cap the volume a forged-signature flood can push through the verifier.
  ["/api/webhooks", { windowMs: 60_000, max: 120, format: "json" }],
  // Server Actions POST to page URLs, not /api/*, so they bypass the rules
  // above. Scoped to POST on purpose: this prefix also covers every page load
  // and every <Link> prefetch, and the sidebar alone fans out one RSC request
  // per nav item, so counting reads here would throttle ordinary browsing —
  // hardest on a host where clientIp() falls back to a single shared bucket.
  ["/dashboard", { windowMs: 60_000, max: 120, methods: ["POST"], format: "text" }],
];

const redis =
  process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
    ? new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN })
    : null;

/** One Ratelimit instance per rule, built lazily and cached by prefix. */
const limiters = new Map<string, Ratelimit>();

function limiterFor(prefix: string, rule: Rule): Ratelimit {
  const cached = limiters.get(prefix);
  if (cached) return cached;

  const limiter = new Ratelimit({
    redis: redis!,
    limiter: Ratelimit.slidingWindow(rule.max, `${rule.windowMs} ms`),
    prefix: `ratelimit:${prefix}`,
    // Every call already crosses the network for the route it is guarding;
    // analytics would be a second Redis round trip for no reader of this
    // single-owner console.
    analytics: false,
  });
  limiters.set(prefix, limiter);
  return limiter;
}

/** In-memory fallback for local dev and any environment without Redis wired up. */
const hits = new Map<string, number[]>();

/**
 * Only headers the platform itself sets are trusted. `x-forwarded-for` is
 * client-supplied unless every hop rewrites it, so keying on its first entry
 * lets an attacker rotate a header and walk straight past the password-guessing
 * brake. Vercel sets `x-vercel-forwarded-for` and `x-real-ip` itself.
 */
function clientIp(request: NextRequest) {
  const trusted =
    request.headers.get("x-vercel-forwarded-for") ?? request.headers.get("x-real-ip");
  if (trusted) return trusted.split(",")[0].trim();

  // Local development and any host that has not been vouched for: fall back to
  // a single bucket rather than to a spoofable value.
  return "unknown";
}

function overLimitInMemory(key: string, rule: Rule) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < rule.windowMs);
  recent.push(now);
  hits.set(key, recent);

  // Opportunistic sweep so an idle instance does not hold keys forever.
  if (hits.size > 5000) {
    for (const [k, times] of hits) {
      if (times.every((t) => now - t >= rule.windowMs)) hits.delete(k);
    }
  }

  return recent.length > rule.max;
}

async function overLimit(key: string, prefix: string, rule: Rule) {
  if (!redis) return overLimitInMemory(key, rule);

  // A Redis hiccup should not take the whole console down: fail open and let
  // the in-memory brake (and the real auth checks) keep covering this request.
  try {
    const { success } = await limiterFor(prefix, rule).limit(key);
    return !success;
  } catch (error) {
    console.error("[proxy] rate limit check failed, falling back:", error);
    return overLimitInMemory(key, rule);
  }
}

function securityHeaders(nonce: string) {
  const isDev = process.env.NODE_ENV === "development";

  // 'unsafe-eval' is required in development only: React uses eval to rebuild
  // server-side error stacks in the browser. Neither React nor Next uses eval
  // in a production build.
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Tailwind ships a stylesheet, but Next injects inline <style> for its dev
    // overlay and for streamed CSS, which a nonce alone does not cover.
    `style-src 'self' 'unsafe-inline'`,
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    // Same-origin only: the CEO console and the SSE feed both go through
    // this app's own API routes, never straight to a third party.
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  return {
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // Nothing here needs a camera, a microphone or a location.
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  };
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const nonce = crypto.randomUUID();
  const headers = securityHeaders(nonce);

  const match = RULES.find(
    ([prefix, rule]) =>
      pathname.startsWith(prefix) && (!rule.methods || rule.methods.includes(request.method)),
  );
  if (match) {
    const [prefix, rule] = match;
    if (await overLimit(`${clientIp(request)}:${prefix}`, prefix, rule)) {
      // Throttled responses get the same headers as every other one.
      const init = {
        status: 429,
        headers: { ...headers, "retry-after": String(Math.ceil(rule.windowMs / 1000)) },
      };
      return rule.format === "text"
        ? new NextResponse("Too many requests. Please wait a moment and try again.", {
            ...init,
            headers: { ...init.headers, "content-type": "text/plain; charset=utf-8" },
          })
        : NextResponse.json(
            { error: "rate_limited", error_description: "Too many requests." },
            init,
          );
    }
  }

  // Next reads the nonce off the request headers and stamps it onto the
  // scripts it injects, which is what makes 'strict-dynamic' workable.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", headers["Content-Security-Policy"]);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
  return response;
}

export const config = {
  matcher: [
    // Everything except Next's own static output, which is immutable and
    // served without needing a per-request nonce, and the Sentry tunnel
    // (next.config.ts `tunnelRoute`), which proxies error reports to Sentry
    // and must not be throttled or wrapped in HTML security headers.
    "/((?!_next/static|_next/image|favicon.ico|monitoring).*)",
  ],
};
