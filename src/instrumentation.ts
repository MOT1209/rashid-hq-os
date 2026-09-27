import * as Sentry from "@sentry/nextjs";
import { resolveRateLimitBackend } from "./lib/env/rate-limit";

/**
 * Server-side registration hook (Next.js file convention). Runs once per server
 * instance before the first request. Loads the runtime-specific Sentry init.
 */
export async function register() {
  // Refuse to serve in production on a per-instance in-memory throttle. Runs
  // ahead of Sentry init on purpose: this is a deploy-time misconfiguration
  // that belongs in the boot log, not an error event.
  //
  // A throw from `register` does not stop Next: the server still reports
  // "Ready" and then answers every request with a 500. That is fail-closed,
  // not fail-fast — so on a self-hosted Node server the process exits, which
  // is what a process manager or orchestrator can actually see and alert on.
  // On Vercel there is no process to exit; the build-time check in
  // next.config.ts is the fail-fast layer there, and this throw is the
  // fail-closed backstop.
  try {
    resolveRateLimitBackend();
  } catch (error) {
    if (process.env.NEXT_RUNTIME === "nodejs" && !process.env.VERCEL) {
      console.error(`[startup] ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
    throw error;
  }

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
