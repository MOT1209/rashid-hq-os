import "server-only";

import { randomUUID } from "node:crypto";
import { after } from "next/server";
import * as Sentry from "@sentry/nextjs";

/**
 * Error reporting.
 *
 * Every failure used to end at console.error, and the digest shown to a user
 * mapped to nothing searchable. Now each one gets an id that appears in the
 * server log, in the message the client sees, and in Sentry (server init in
 * src/sentry.server.config.ts) — so a screenshot is enough to find the trace.
 *
 * Sentry is optional: without SENTRY_DSN the SDK is a no-op, and the id and
 * the log still happen. To enable it, create a project at sentry.io and set
 * SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN.
 */

type Extra = Record<string, unknown>;

/**
 * A readable one-liner for any thrown value. A Postgres/PostgREST error is a
 * plain object with a `message` field, not an Error — `String(it)` on one is
 * "[object Object]", which is what the log and the wrapped Sentry event used
 * to show.
 */
function errorDetail(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string") {
      return [record.message, record.code, record.detail].filter(Boolean).join(" ");
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

/** Records an error and returns the reference shown to the client. */
export function captureError(context: string, error: unknown, extra: Extra = {}): string {
  const ref = randomUUID();
  const detail = errorDetail(error);
  console.error(`[${context}] ref=${ref}: ${detail}`);

  // A non-Error (a string, a Postgres error object) is wrapped so Sentry gets
  // a stack and groups it, rather than recording "Object".
  const err = error instanceof Error ? error : new Error(detail);
  Sentry.captureException(err, {
    tags: { context },
    extra: { ref, ...extra },
  });

  // A plain route handler or server action is not auto-flushed under Turbopack,
  // so the event is queued but the serverless function can freeze before it is
  // sent. `after` runs the flush once the response is out, while Vercel keeps
  // the invocation alive. Outside a request scope (rare here) `after` throws —
  // fall back to a best-effort detached flush.
  try {
    after(() => Sentry.flush(2000));
  } catch {
    void Sentry.flush(2000);
  }

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
