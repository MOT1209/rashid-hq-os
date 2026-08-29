import { requireIntegrationOwner } from "@/lib/integrations/route-auth";
import { getProvider } from "@/lib/integrations/registry";
import {
  deleteConnection,
  getConnection,
  getConnectionWithSecret,
} from "@/lib/integrations/connections";
import { logIntegration } from "@/lib/integrations/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/integrations/:provider — this owner's connection status (no secret). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const auth = await requireIntegrationOwner();
  if ("response" in auth) return auth.response;
  const { provider } = await params;
  const connection = await getConnection(auth.ownerId, provider);
  return Response.json({ connection });
}

/** DELETE /api/integrations/:provider — disconnect and best-effort remote revoke. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const auth = await requireIntegrationOwner();
  if ("response" in auth) return auth.response;

  const { provider: providerId } = await params;
  const impl = getProvider(providerId);

  if (impl?.revoke) {
    const conn = await getConnectionWithSecret(auth.ownerId, providerId);
    if (conn?.secret) {
      try {
        await impl.revoke(conn.secret);
      } catch {
        // best effort; the local row goes regardless
      }
    }
  }

  const removed = await deleteConnection(auth.ownerId, providerId);
  await logIntegration({
    provider: providerId,
    operation: "disconnect",
    status: removed ? "success" : "failed",
  });
  return Response.json({ disconnected: removed });
}
