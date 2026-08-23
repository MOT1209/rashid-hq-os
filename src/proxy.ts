import { NextResponse, type NextRequest } from "next/server";

/**
 * Two jobs, both of which have to happen before a route renders:
 *
 * 1. Security headers, including a nonce-based Content Security Policy. The
 *    dashboard renders agent-supplied strings (tool names, payloads, project
 *    names), so a CSP is the backstop if any of that ever escapes escaping.
 * 2. An in-memory sliding-window throttle on the three routes where an
 *    unbounded caller costs something real: password guessing on /api/auth,
 *    token guessing plus agent_logs flooding on /api/mcp, and model spend on
 *    /api/console.
 *
 * The throttle is per-instance and best-effort — Next may run this on more than
 * one instance, so treat it as a brake, not a guarantee. That is enough for a
 * single-owner console; if this ever scales out, move the counters to a shared
 * store (Vercel KV / Upstash) and keep the auth checks downstream as the real
 * boundary.
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
  // Server Actions POST to page URLs, not /api/*, so they bypass the rules
  // above. Scoped to POST on purpose: this prefix also covers every page load
  // and every <Link> prefetch, and the sidebar alone fans out one RSC request
  // per nav item, so counting reads here would throttle ordinary browsing —
  // hardest on a host where clientIp() falls back to a single shared bucket.
  ["/dashboard", { windowMs: 60_000, max: 120, methods: ["POST"], format: "text" }],
];

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

function overLimit(key: string, rule: Rule) {
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

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const nonce = crypto.randomUUID();
  const headers = securityHeaders(nonce);

  const match = RULES.find(
    ([prefix, rule]) =>
      pathname.startsWith(prefix) && (!rule.methods || rule.methods.includes(request.method)),
  );
  if (match) {
    const [prefix, rule] = match;
    if (overLimit(`${clientIp(request)}:${prefix}`, rule)) {
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
    // served without needing a per-request nonce.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
