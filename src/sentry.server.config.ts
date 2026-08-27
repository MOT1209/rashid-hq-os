import * as Sentry from "@sentry/nextjs";

/**
 * Node.js server runtime init. Loaded by src/instrumentation.ts when
 * NEXT_RUNTIME === "nodejs".
 *
 * A no-op without SENTRY_DSN, so this is safe to ship before the project is
 * provisioned — exactly the posture the hand-rolled reporter in
 * src/lib/errors.ts had.
 */
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  // 100% of traces in dev, 10% in production.
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  // Attach local variable values to server stack frames.
  includeLocalVariables: true,
  enableLogs: true,
});
