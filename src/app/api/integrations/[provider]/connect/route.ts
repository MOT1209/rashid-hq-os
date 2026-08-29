import { requireIntegrationOwner } from "@/lib/integrations/route-auth";
import { getProvider } from "@/lib/integrations/registry";
import { callbackUrl, createOAuthState, sweepExpiredStates } from "@/lib/integrations/oauth";
import { logIntegration } from "@/lib/integrations/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/integrations/:provider/connect
 *
 * Starts an OAuth flow: mints a state row (CSRF token + PKCE verifier), then
 * returns the provider's authorize URL for the client to redirect to. POST,
 * not GET, so a cross-site page cannot kick off a flow with an <img> tag.
 * API-key providers do not use this route — they save through a server action.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const auth = await requireIntegrationOwner();
  if ("response" in auth) return auth.response;

  const { provider: providerId } = await params;
  const provider = getProvider(providerId);
  if (!provider) return Response.json({ error: "Unknown provider." }, { status: 404 });

  if (provider.meta.readiness !== "available" || !provider.buildAuthUrl) {
    return Response.json({ error: "This provider is not available yet." }, { status: 400 });
  }
  if (provider.meta.requiredEnv.some((n) => !process.env[n])) {
    return Response.json(
      { error: `Server is missing configuration for ${provider.meta.name}.` },
      { status: 400 },
    );
  }

  await sweepExpiredStates();

  const redirectUri = callbackUrl(providerId);
  let redirectTo: string | undefined;
  try {
    const body = (await request.json()) as { redirectTo?: string };
    // Only same-path values — never an absolute URL, so this cannot become an
    // open redirect after the callback.
    if (typeof body.redirectTo === "string" && body.redirectTo.startsWith("/")) {
      redirectTo = body.redirectTo;
    }
  } catch {
    // no body is fine
  }

  // The state token is generated inside createOAuthState, but buildAuthUrl
  // needs it — so mint the raw value here and pass it to both.
  const { randomBytes } = await import("node:crypto");
  const state = randomBytes(24).toString("base64url");

  const { url, codeVerifier } = provider.buildAuthUrl({
    redirectUri,
    state,
    scopes: provider.meta.scopes,
  });

  await createOAuthState({
    state,
    ownerId: auth.ownerId,
    provider: providerId,
    scopes: provider.meta.scopes,
    codeVerifier,
    redirectTo,
  });

  await logIntegration({
    provider: providerId,
    operation: "connect.start",
    status: "pending",
    detail: { scopes: provider.meta.scopes },
  });

  return Response.json({ url });
}
