import { getServiceSupabase } from "@/lib/supabase/server";
import { getProvider } from "@/lib/integrations/registry";
import { logIntegration } from "@/lib/integrations/logger";
import { captureError } from "@/lib/errors";
import type { Json } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/:provider — the one door every provider's events come
 * through. The provider module verifies the signature; this route handles
 * replay protection (unique (provider, event_id)) and logging. Actual event
 * handling is deliberately minimal for now — the record is persisted and the
 * feed is updated, and per-provider processing is added as each provider goes
 * from "planned" to "available".
 *
 * Unauthenticated by design (the provider has no session), so signature
 * verification is the only thing standing between this and a forged event.
 */
const MAX_BODY = 1_000_000;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: providerId } = await params;
  const provider = getProvider(providerId);

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY) {
    return Response.json({ error: "Payload too large." }, { status: 413 });
  }

  if (!provider?.verifyWebhook) {
    // No verifier means we cannot trust anything it sends — refuse rather than
    // store forgeable data.
    return Response.json({ error: "No webhook handler for this provider." }, { status: 404 });
  }

  const verdict = provider.verifyWebhook({ rawBody, headers: request.headers });
  const supabase = getServiceSupabase();

  if (!verdict.valid) {
    await logIntegration({
      provider: providerId,
      operation: "webhook",
      status: "failed",
      detail: { reason: "invalid_signature", eventType: verdict.eventType ?? null },
    });
    return Response.json({ error: "Invalid signature." }, { status: 401 });
  }

  let payload: Json = null;
  try {
    payload = JSON.parse(rawBody) as Json;
  } catch {
    payload = { raw: rawBody.slice(0, 10_000) } as Json;
  }

  const { error } = await supabase.from("webhook_events").insert({
    provider: providerId,
    event_id: verdict.eventId ?? null,
    event_type: verdict.eventType ?? null,
    status: "verified",
    payload,
  });

  // 23505 = unique_violation → this delivery was already processed.
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      await logIntegration({
        provider: providerId,
        operation: "webhook",
        status: "success",
        detail: { duplicate: true, eventType: verdict.eventType ?? null },
      });
      return Response.json({ ok: true, duplicate: true });
    }
    captureError(`webhook:${providerId}`, error);
    return Response.json({ error: "Could not record the event." }, { status: 500 });
  }

  await logIntegration({
    provider: providerId,
    operation: "webhook",
    status: "success",
    detail: { eventType: verdict.eventType ?? null, eventId: verdict.eventId ?? null },
  });

  return Response.json({ ok: true });
}
