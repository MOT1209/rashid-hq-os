import "server-only";

// Set SENTRY_DSN in .env.local to enable Sentry error reporting.
// Format: https://KEY@HOST/PROJECT_ID
// Without it, errors are still logged locally with a reference UUID.

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
 * nothing is sent anywhere. To enable it, create a free project at sentry.io
 * (no Vercel integration needed) and set SENTRY_DSN to the project's DSN.
 */

type Extra = Record<string, unknown>;

/** `at fn (/abs/path/file.ts:12:34)` or `at /abs/path/file.ts:12:34` */
const STACK_FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/;

/**
 * Sentry frames are innermost-last, so the raw stack (innermost-first) is
 * reversed. Only the first lines that parse are kept — the "Error: message"
 * header and any garbled line are dropped rather than sent as noise.
 */
function stackFrames(error: unknown) {
  if (!(error instanceof Error) || !error.stack) return undefined;
  const frames = error.stack
    .split("\n")
    .map((line) => STACK_FRAME.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({
      function: m[1] ?? "?",
      filename: m[2],
      lineno: Number(m[3]),
      colno: Number(m[4]),
      in_app: !m[2].includes("node_modules"),
    }))
    .reverse();
  return frames.length ? { frames } : undefined;
}

function reportToSentry(error: unknown, ref: string, extra: Extra) {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  // Sent as a raw envelope rather than through the SDK: one fetch keeps this
  // module dependency-free. The legacy /store/ endpoint this used before is
  // gone for projects created in the last few years — /envelope/ is current.
  try {
    const match = /^https:\/\/([^@]+)@([^/]+)\/(.+)$/.exec(dsn);
    if (!match) {
      console.error("[errors] SENTRY_DSN is malformed; not reporting");
      return;
    }
    const [, key, host, projectId] = match;
    const eventId = ref.replace(/-/g, "");
    const sentAt = new Date().toISOString();

    const event = {
      event_id: eventId,
      timestamp: Date.now() / 1000,
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
            stacktrace: stackFrames(error),
          },
        ],
      },
      extra: { ref, ...extra },
    };

    const body =
      JSON.stringify({ event_id: eventId, sent_at: sentAt }) +
      "\n" +
      JSON.stringify({ type: "event" }) +
      "\n" +
      JSON.stringify(event);

    void fetch(`https://${host}/api/${projectId}/envelope/`, {
      method: "POST",
      headers: {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${key}, sentry_client=rashid-hq-os/1.0`,
      },
      body,
      signal: AbortSignal.timeout(5000),
    })
      .then((res) => {
        if (!res.ok) console.error(`[errors] Sentry envelope rejected: ${res.status}`);
      })
      .catch((cause) => console.error("[errors] Sentry report failed:", cause));
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
