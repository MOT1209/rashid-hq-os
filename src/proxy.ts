import { NextResponse, type NextRequest } from "next/server";

/**
 * In-memory sliding-window throttle.
 *
 * Covers the three routes where an unbounded caller costs something real:
 * password guessing on /api/auth, token guessing plus agent_logs flooding on
 * /api/mcp, and model spend on /api/console.
 *
 * State is per-instance and best-effort — Next may run this on more than one
 * instance, so treat it as a brake, not a guarantee. That is enough for a
 * single-owner console; if this ever scales out, move the counters to a shared
 * store (Vercel KV / Upstash) and keep the auth checks downstream as the real
 * boundary.
 */

type Rule = { windowMs: number; max: number };

const RULES: [prefix: string, rule: Rule][] = [
  ["/api/auth", { windowMs: 60_000, max: 20 }],
  ["/api/mcp", { windowMs: 60_000, max: 120 }],
  ["/api/console", { windowMs: 60_000, max: 20 }],
];

const hits = new Map<string, number[]>();

function clientIp(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
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

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const match = RULES.find(([prefix]) => pathname.startsWith(prefix));
  if (!match) return NextResponse.next();

  const [prefix, rule] = match;
  if (overLimit(`${clientIp(request)}:${prefix}`, rule)) {
    return NextResponse.json(
      { error: "rate_limited", error_description: "Too many requests." },
      {
        status: 429,
        headers: { "retry-after": String(Math.ceil(rule.windowMs / 1000)) },
      },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/auth/:path*", "/api/mcp/:path*", "/api/console/:path*"],
};
