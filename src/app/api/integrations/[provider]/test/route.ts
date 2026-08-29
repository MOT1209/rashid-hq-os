import { requireIntegrationOwner } from "@/lib/integrations/route-auth";
import { getProvider } from "@/lib/integrations/registry";
import {
  getConnectionWithSecret,
  getFreshAccessToken,
  markConnectionError,
} from "@/lib/integrations/connections";
import { logIntegration } from "@/lib/integrations/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/integrations/:provider/test — prove the connection still works. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const auth = await requireIntegrationOwner();
  if ("response" in auth) return auth.response;

  const { provider: providerId } = await params;
  const impl = getProvider(providerId);
  if (!impl) return Response.json({ error: "Unknown provider." }, { status: 404 });

  const conn = await getConnectionWithSecret(auth.ownerId, providerId);
  if (!conn?.secret) {
    return Response.json({ error: "Not connected." }, { status: 400 });
  }

  try {
    // For OAuth providers this also refreshes an expired access token in place.
    if (impl.meta.authMethod === "oauth2") {
      const token = await getFreshAccessToken(auth.ownerId, providerId);
      conn.secret.access_token = token;
    }
    const { accountLabel } = await impl.testConnection(conn.secret);
    await logIntegration({
      provider: providerId,
      operation: "test",
      status: "success",
      detail: { accountLabel },
    });
    return Response.json({ ok: true, accountLabel });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The test failed.";
    await markConnectionError(auth.ownerId, providerId, message);
    await logIntegration({
      provider: providerId,
      operation: "test",
      status: "failed",
      detail: { message },
    });
    return Response.json({ ok: false, error: message }, { status: 502 });
  }
}
