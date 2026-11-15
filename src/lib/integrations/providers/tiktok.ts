import "server-only";

import { integrationFetchJson } from "@/lib/integrations/http";
import type { IntegrationProvider, OAuthTokenResponse } from "@/lib/integrations/types";

/**
 * TikTok Login Kit v2 (web) — OAuth for the Content Posting API.
 * Docs: https://developers.tiktok.com/doc/oauth-user-access-token-management
 *
 * Needs TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET from a TikTok developer app
 * with the Login Kit and Content Posting API products. Access tokens last 24h
 * and are refreshed with the refresh token (valid ~1 year).
 */

const TOKEN = "https://open.tiktokapis.com/v2/oauth/token/";

const need = (n: string) => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} is not set.`);
  return v;
};

type TokenBody = OAuthTokenResponse & { error?: string; error_description?: string; open_id?: string };

async function tokenRequest(params: Record<string, string>): Promise<OAuthTokenResponse> {
  const r = await integrationFetchJson<TokenBody>(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "cache-control": "no-cache" },
    body: new URLSearchParams({ client_key: need("TIKTOK_CLIENT_KEY"), client_secret: need("TIKTOK_CLIENT_SECRET"), ...params }).toString(),
  });
  if (r.error || !r.access_token) throw new Error(`TikTok token error: ${r.error ?? "no token"}`);
  return r;
}

export const tiktokProvider: IntegrationProvider = {
  meta: {
    id: "tiktok_publish",
    name: "TikTok",
    description: {
      ar: "نشر الفيديوهات على حساب TikTok بعد موافقتك (KING Social Studio). يتطلب تدقيق التطبيق من TikTok للنشر العلني.",
      en: "Publish videos to your TikTok account after your approval (KING Social Studio). Public posting requires TikTok's app audit.",
    },
    icon: "Share2",
    category: "social",
    authMethod: "oauth2",
    readiness: "available",
    scopes: ["user.info.basic", "video.publish", "video.upload"],
    docsUrl: "https://developers.tiktok.com/doc/content-posting-api-get-started",
    requiredEnv: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
    hasWebhooks: false,
  },

  buildAuthUrl({ redirectUri, state, scopes }) {
    const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
    url.searchParams.set("client_key", need("TIKTOK_CLIENT_KEY"));
    url.searchParams.set("scope", scopes.join(","));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    return { url: url.toString() };
  },

  exchangeCode: ({ code, redirectUri }) =>
    tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri }),

  refresh: (refreshToken) => tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }),

  async testConnection(secret) {
    if (!secret.access_token) throw new Error("No access token on this connection.");
    const r = await integrationFetchJson<{ data?: { user?: { display_name?: string; open_id?: string } } }>(
      "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name",
      { headers: { authorization: `Bearer ${secret.access_token}` } },
    );
    const u = r.data?.user;
    return { accountLabel: u?.display_name ?? u?.open_id ?? "TikTok account" };
  },
};
