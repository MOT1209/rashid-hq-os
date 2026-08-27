import * as Sentry from "@sentry/nextjs";

/**
 * Server-side registration hook (Next.js file convention). Runs once per server
 * instance before the first request. Loads the runtime-specific Sentry init.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

/**
 * Captures every unhandled server-side request error — Server Components, Route
 * Handlers, Server Actions, and proxy. The console's own captureError
 * (src/lib/errors.ts) still handles the errors it catches deliberately and
 * turns into a user-facing reference; this covers everything that gets away.
 */
export const onRequestError = Sentry.captureRequestError;
