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
  return Response.json({ ok: true, ref, note: "Check Sentry for this event, then delete this route." });
}
