import { requireIntegrationOwner } from "@/lib/integrations/route-auth";
import { getProvider } from "@/lib/integrations/registry";
import {
  getConnectionWithSecret,
  mergeTokens,
  saveConnection,
  markConnectionError,
} from "@/lib/integrations/connections";
import { logIntegration } from "@/lib/integrations/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/integrations/:provider/refresh — force an OAuth token refresh. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const auth = await requireIntegrationOwner();
  if ("response" in auth) return auth.response;

  const { provider: providerId } = await params;
  const impl = getProvider(providerId);
  if (!impl?.refresh) {
    return Response.json({ error: "This provider has no refresh flow." }, { status: 400 });
  }

  const conn = await getConnectionWithSecret(auth.ownerId, providerId);
  if (!conn?.secret?.refresh_token) {
    return Response.json({ error: "No refresh token stored." }, { status: 400 });
  }

  try {
    const tokens = await impl.refresh(conn.secret.refresh_token);
    const merged = mergeTokens(conn.secret, tokens);
    await saveConnection({
      ownerId: auth.ownerId,
      provider: providerId,
      secret: merged,
      status: "connected",
      metadata: conn.metadata,
      expiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null,
    });
    await logIntegration({ provider: providerId, operation: "refresh", status: "success" });
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Refresh failed.";
    await markConnectionError(auth.ownerId, providerId, message, "expired");
    await logIntegration({
      provider: providerId,
      operation: "refresh",
      status: "failed",
      detail: { message },
    });
    return Response.json({ ok: false, error: message }, { status: 502 });
  }
}
