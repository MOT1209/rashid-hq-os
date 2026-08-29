import { getSession } from "@/lib/session";
import { resolveRole } from "@/lib/members";
import { getProvider } from "@/lib/integrations/registry";
import {
  callbackUrl,
  consoleOrigin,
  consumeOAuthState,
} from "@/lib/integrations/oauth";
import { mergeTokens, saveConnection } from "@/lib/integrations/connections";
import { logIntegration } from "@/lib/integrations/logger";
import type { SecretBundle } from "@/lib/integrations/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/integrations/:provider/callback
 *
 * The provider redirects the browser here with ?code&state. Security rests on
 * three checks, not on the request's origin (it legitimately arrives
 * cross-site from the provider):
 *   1. a live admin session
 *   2. the `state` row exists, is unexpired, and belongs to THIS owner+provider
 *   3. the row is deleted on read, so a replay finds nothing
 * Then the code is exchanged, tokens are sealed, and the connection is tested.
 */
function fail(reason: string, provider: string) {
  const url = new URL("/dashboard/settings/integrations", consoleOrigin());
  url.searchParams.set("error", reason);
  url.searchParams.set("provider", provider);
  return Response.redirect(url, 303);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: providerId } = await params;
  const provider = getProvider(providerId);
  if (!provider?.exchangeCode) return fail("unknown_provider", providerId);

  const session = await getSession();
  const role = session ? await resolveRole(session.user.email) : null;
  if (!session || role !== "admin") return fail("not_signed_in", providerId);

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");
  if (providerError) return fail(`provider_${providerError}`.slice(0, 40), providerId);
  if (!code || !state) return fail("missing_code", providerId);

  const stored = await consumeOAuthState(state, session.user.id, providerId);
  if (!stored) return fail("bad_state", providerId);

  try {
    const tokens = await provider.exchangeCode({
      code,
      redirectUri: callbackUrl(providerId),
      codeVerifier: stored.codeVerifier ?? undefined,
    });

    const secret: SecretBundle = mergeTokens({}, tokens);

    let accountLabel: string | null = null;
    try {
      accountLabel = (await provider.testConnection(secret)).accountLabel;
    } catch {
      // Connected but the probe failed — still save, surface the state.
    }

    const grantedScopes = tokens.scope
      ? tokens.scope.split(" ").filter(Boolean)
      : stored.scopes;

    await saveConnection({
      ownerId: session.user.id,
      provider: providerId,
      secret,
      status: accountLabel ? "connected" : "error",
      metadata: { accountLabel, scopes: grantedScopes },
      expiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null,
    });

    await logIntegration({
      provider: providerId,
      operation: "connect.complete",
      status: accountLabel ? "success" : "failed",
      detail: { accountLabel, scopes: grantedScopes },
    });

    const dest = new URL("/dashboard/settings/integrations", consoleOrigin());
    if (stored.redirectTo) dest.pathname = stored.redirectTo;
    dest.searchParams.set("connected", providerId);
    return Response.redirect(dest, 303);
  } catch (error) {
    await logIntegration({
      provider: providerId,
      operation: "connect.complete",
      status: "failed",
      detail: { message: error instanceof Error ? error.message : "exchange failed" },
    });
    return fail("exchange_failed", providerId);
  }
}
