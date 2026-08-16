import "server-only";

import { randomUUID } from "node:crypto";

/**
 * Error reporting.
 *
 * Every failure used to end at console.error, and the digest shown to a user
 * mapped to nothing searchable. Now each one gets an id that appears in the
 * server log, in the message the client sees, and in Sentry when it is
 * configured — so a screenshot is enough to find the trace.
 *
 * Sentry is optional: without SENTRY_DSN the id and the log still happen, and
 * nothing is sent anywhere.
 */

type Extra = Record<string, unknown>;

function reportToSentry(error: unknown, ref: string, extra: Extra) {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  // Sent through the Sentry "store" endpoint directly: one fetch is cheaper
  // than pulling in the SDK for server-side capture, and it keeps this module
  // dependency-free.
  try {
    const match = /^https:\/\/([^@]+)@([^/]+)\/(.+)$/.exec(dsn);
    if (!match) {
      console.error("[errors] SENTRY_DSN is malformed; not reporting");
      return;
    }
    const [, key, host, projectId] = match;

    void fetch(`https://${host}/api/${projectId}/store/`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${key}, sentry_client=rashid-hq-os/1.0`,
      },
      body: JSON.stringify({
        event_id: ref.replace(/-/g, ""),
        timestamp: new Date().toISOString(),
        platform: "node",
        level: "error",
        environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
        release: process.env.VERCEL_GIT_COMMIT_SHA,
        logger: "rashid-hq-os",
        message: error instanceof Error ? error.message : String(error),
        exception: {
          values: [
            {
              type: error instanceof Error ? error.name : "Error",
              value: error instanceof Error ? error.message : String(error),
              stacktrace: undefined,
            },
          ],
        },
        extra: { ref, ...extra },
      }),
      signal: AbortSignal.timeout(5000),
    }).catch((cause) => console.error("[errors] Sentry report failed:", cause));
  } catch (cause) {
    // Reporting must never be the thing that breaks a request.
    console.error("[errors] Sentry report threw:", cause);
  }
}

/** Records an error and returns the reference shown to the client. */
export function captureError(context: string, error: unknown, extra: Extra = {}): string {
  const ref = randomUUID();
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`[${context}] ref=${ref}: ${detail}`);
  reportToSentry(error, ref, { context, ...extra });
  return ref;
}

/**
 * Postgres errors name tables, columns and constraints — sometimes the values
 * that tripped them. That belongs in the server log, never in a response to an
 * agent or a browser. Log the detail, return a stable generic message carrying
 * only the reference.
 */
export function dbError(context: string, error: unknown): Error {
  const ref = captureError(context, error);
  return new Error(`${context} failed. Reference: ${ref}`);
}

/** Same idea for anything that reaches a client as a plain string. */
export function safeMessage(context: string, error: unknown): string {
  return dbError(context, error).message;
}
