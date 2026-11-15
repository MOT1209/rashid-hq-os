import "server-only";

import { integrationFetch, integrationFetchJson } from "@/lib/integrations/http";
import type { IntegrationProvider, OAuthTokenResponse, SecretBundle } from "@/lib/integrations/types";

/**
 * Meta (Facebook Pages + Instagram Business) OAuth.
 * Docs: https://developers.facebook.com/docs/facebook-login/guides/access-tokens
 *
 * Meta has no refresh tokens and no PKCE. We exchange the short-lived code
 * token for a ~60-day LONG-LIVED USER token and store it as both
 * `access_token` and `refresh_token`: the shared integrations layer then
 * "refreshes" by re-exchanging it (fb_exchange_token) before expiry. Page
 * access tokens are never stored — they are derived from the user token at
 * publish time (see adapters/meta.ts), so nothing extra sits at rest.
 */

export const GRAPH_VERSION = "v21.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

export const META_SCOPES = [
  "pages_show_list",
  "pages_manage_posts",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_content_publish",
];

const need = (n: string) => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} is not set.`);
  return v;
};

async function longLived(token: string): Promise<OAuthTokenResponse> {
  const url = new URL(`${GRAPH}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", need("META_APP_ID"));
  url.searchParams.set("client_secret", need("META_APP_SECRET"));
  url.searchParams.set("fb_exchange_token", token);
  const r = await integrationFetchJson<{ access_token: string; expires_in?: number; token_type?: string }>(url.toString());
  // Same token doubles as the "refresh token" — see header comment.
  return { access_token: r.access_token, refresh_token: r.access_token, expires_in: r.expires_in, token_type: r.token_type };
}

export const metaProvider: IntegrationProvider = {
  meta: {
    id: "meta_publish",
    name: "Meta (Facebook Pages & Instagram)",
    description: {
      ar: "النشر على صفحات فيسبوك وحساب انستغرام المهني بعد موافقتك (KING Social Studio).",
      en: "Publish to Facebook Pages and your Instagram professional account after your approval (KING Social Studio).",
    },
    icon: "Share2",
    category: "social",
    authMethod: "oauth2",
    readiness: "available",
    scopes: META_SCOPES,
    docsUrl: "https://developers.facebook.com/docs/pages-api/posts",
    requiredEnv: ["META_APP_ID", "META_APP_SECRET"],
    hasWebhooks: false,
  },

  buildAuthUrl({ redirectUri, state, scopes }) {
    const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
    url.searchParams.set("client_id", need("META_APP_ID"));
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", scopes.join(","));
    return { url: url.toString() };
  },

  async exchangeCode({ code, redirectUri }) {
    const url = new URL(`${GRAPH}/oauth/access_token`);
    url.searchParams.set("client_id", need("META_APP_ID"));
    url.searchParams.set("client_secret", need("META_APP_SECRET"));
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("code", code);
    const short = await integrationFetchJson<{ access_token: string }>(url.toString());
    return longLived(short.access_token);
  },

  async refresh(refreshToken) {
    return longLived(refreshToken);
  },

  async revoke(secret: SecretBundle) {
    if (!secret.access_token) return;
    try {
      await integrationFetch(`${GRAPH}/me/permissions?access_token=${encodeURIComponent(secret.access_token)}`, { method: "DELETE" });
    } catch {
      // best effort
    }
  },

  async testConnection(secret) {
    if (!secret.access_token) throw new Error("No access token on this connection.");
    const me = await integrationFetchJson<{ id: string; name?: string }>(`${GRAPH}/me?fields=id,name`, {
      headers: { authorization: `Bearer ${secret.access_token}` },
    });
    return { accountLabel: me.name ?? me.id };
  },
};
