import * as Sentry from "@sentry/nextjs";

/**
 * Browser runtime init (Next.js file convention — runs before hydration).
 *
 * No Session Replay: this is a single-owner internal console behind a strict
 * nonce-based CSP (src/proxy.ts), not a user-facing app, so replay would add
 * connect/worker-src surface for little value. Errors and navigation tracing
 * are the baseline that matters here.
 *
 * A no-op without NEXT_PUBLIC_SENTRY_DSN.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  enableLogs: true,
});

// Feeds App Router navigations into Sentry as spans.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
