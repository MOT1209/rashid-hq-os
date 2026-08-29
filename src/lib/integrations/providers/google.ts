import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { integrationFetch, integrationFetchJson } from "@/lib/integrations/http";
import type {
  IntegrationProvider,
  OAuthTokenResponse,
  ProviderMeta,
  SecretBundle,
} from "@/lib/integrations/types";

/**
 * Google OAuth 2.0 engine, shared by every Google-family provider.
 * Docs: https://developers.google.com/identity/protocols/oauth2
 *
 * One Google Cloud OAuth client (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) backs
 * all of them. Each registry entry ("google", "youtube", "gmail", "drive",
 * "calendar", "search_console") requests only the scopes it needs — Google
 * supports incremental authorization, so connecting a second Google provider
 * adds scopes to the same underlying grant.
 *
 * PKCE (S256) is used even though this is a confidential client: it costs
 * nothing and protects the code in transit.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";

// Always requested, so we can always name the connected account.
const BASE_SCOPES = ["openid", "email"];

function clientId() {
  const id = process.env.GOOGLE_CLIENT_ID;
  if (!id) throw new Error("GOOGLE_CLIENT_ID is not set.");
  return id;
}
function clientSecret() {
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) throw new Error("GOOGLE_CLIENT_SECRET is not set.");
  return secret;
}

function pkce() {
  const codeVerifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, challenge };
}

async function tokenRequest(params: Record<string, string>): Promise<OAuthTokenResponse> {
  return integrationFetchJson<OAuthTokenResponse>(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
}

/** The shared runtime half. Every Google registry entry reuses these. */
export const googleEngine = {
  buildAuthUrl({
    redirectUri,
    state,
    scopes,
  }: {
    redirectUri: string;
    state: string;
    scopes: string[];
  }) {
    const { codeVerifier, challenge } = pkce();
    const url = new URL(AUTH_ENDPOINT);
    url.searchParams.set("client_id", clientId());
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set(
      "scope",
      [...new Set([...BASE_SCOPES, ...scopes])].join(" "),
    );
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    // offline + consent so a refresh token is always issued, even on re-connect.
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
    return { url: url.toString(), codeVerifier };
  },

  async exchangeCode({
    code,
    redirectUri,
    codeVerifier,
  }: {
    code: string;
    redirectUri: string;
    codeVerifier?: string;
  }): Promise<OAuthTokenResponse> {
    return tokenRequest({
      client_id: clientId(),
      client_secret: clientSecret(),
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
    });
  },

  async refresh(refreshToken: string): Promise<OAuthTokenResponse> {
    const res = await tokenRequest({
      client_id: clientId(),
      client_secret: clientSecret(),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });
    // Google omits refresh_token on refresh; the caller keeps the existing one.
    return res;
  },

  async revoke(secret: SecretBundle): Promise<void> {
    const token = secret.refresh_token ?? secret.access_token;
    if (!token) return;
    try {
      await integrationFetch(REVOKE_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }).toString(),
      });
    } catch {
      // Best effort — the local row is deleted regardless.
    }
  },

  async testConnection(secret: SecretBundle): Promise<{ accountLabel: string }> {
    if (!secret.access_token) throw new Error("No access token on this connection.");
    const info = await integrationFetchJson<{ email?: string; sub?: string }>(
      USERINFO_ENDPOINT,
      { headers: { authorization: `Bearer ${secret.access_token}` } },
    );
    return { accountLabel: info.email ?? info.sub ?? "Google account" };
  },
};

/** Builds a full IntegrationProvider for one Google-family registry entry. */
export function googleProvider(meta: ProviderMeta): IntegrationProvider {
  return {
    meta,
    buildAuthUrl: googleEngine.buildAuthUrl,
    exchangeCode: googleEngine.exchangeCode,
    refresh: googleEngine.refresh,
    revoke: googleEngine.revoke,
    testConnection: googleEngine.testConnection,
  };
}
