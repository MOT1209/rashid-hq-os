import * as Sentry from "@sentry/nextjs";

/**
 * Edge runtime init. Loaded by src/instrumentation.ts when
 * NEXT_RUNTIME === "edge" — src/proxy.ts runs here. A no-op without SENTRY_DSN.
 */
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  enableLogs: true,
});
