import * as Sentry from "@sentry/nextjs";
import { captureError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * TEMPORARY — verifies the Sentry wiring end to end through the real
 * captureError path (src/lib/errors.ts). Delete once an event has been
 * confirmed in Sentry.
 */
export async function GET() {
  const ref = captureError(
    "sentry-check",
    new Error("Sentry wiring verification — safe to ignore"),
    { deliberate: true },
  );
  // A serverless function can freeze before the event is sent; force it out.
  const flushed = await Sentry.flush(3000);
  return Response.json({ ok: true, ref, flushed, dsn: Boolean(process.env.SENTRY_DSN) });
}
