import { requireIntegrationOwner } from "@/lib/integrations/route-auth";
import { integrationsForOwner } from "@/lib/integrations/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/integrations — every provider joined with this owner's connection. */
export async function GET() {
  const auth = await requireIntegrationOwner();
  if ("response" in auth) return auth.response;

  const integrations = await integrationsForOwner(auth.ownerId);
  return Response.json({ integrations });
}
