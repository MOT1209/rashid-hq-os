import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { integrationFetch, integrationFetchJson } from "@/lib/integrations/http";
import type { IntegrationProvider, OAuthTokenResponse } from "@/lib/integrations/types";

/**
 * GitHub OAuth App.
 * Docs: https://docs.github.com/en/apps/oauth-apps
 *
 * GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET from an OAuth App (Settings →
 * Developer settings → OAuth Apps). Webhook deliveries are verified with
 * GITHUB_WEBHOOK_SECRET (sha256 HMAC in the X-Hub-Signature-256 header).
 *
 * PKCE (S256) is used even though this is a confidential client: it costs
 * nothing and protects the authorization code in transit.
 */

const AUTH_ENDPOINT = "https://github.com/login/oauth/authorize";
const TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";
const API = "https://api.github.com";

function pkce() {
  const codeVerifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, challenge };
}

function clientId() {
  const id = process.env.GITHUB_CLIENT_ID;
  if (!id) throw new Error("GITHUB_CLIENT_ID is not set.");
  return id;
}
function clientSecret() {
  const secret = process.env.GITHUB_CLIENT_SECRET;
  if (!secret) throw new Error("GITHUB_CLIENT_SECRET is not set.");
  return secret;
}

export const githubProvider: IntegrationProvider = {
  meta: {
    id: "github",
    name: "GitHub",
    description: {
      ar: "الوصول إلى المستودعات والمشكلات وطلبات السحب والإصدارات.",
      en: "Access repositories, issues, pull requests and releases.",
    },
    icon: "Github",
    category: "developer",
    authMethod: "oauth2",
    readiness: "available",
    // Least privilege: read-user plus public repos only. The previous full
    // `repo` scope granted read+write over every private repository the user
    // can see; widen per real need when private-repo access is asked for.
    scopes: ["read:user", "public_repo"],
    docsUrl: "https://docs.github.com/en/rest",
    requiredEnv: ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"],
    hasWebhooks: true,
  },

  buildAuthUrl({ redirectUri, state, scopes }) {
    const { codeVerifier, challenge } = pkce();
    const url = new URL(AUTH_ENDPOINT);
    url.searchParams.set("client_id", clientId());
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", scopes.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    return { url: url.toString(), codeVerifier };
  },

  async exchangeCode({ code, redirectUri, codeVerifier }): Promise<OAuthTokenResponse> {
    const res = await integrationFetchJson<{
      access_token?: string;
      token_type?: string;
      scope?: string;
      error?: string;
      error_description?: string;
    }>(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: clientId(),
        client_secret: clientSecret(),
        code,
        redirect_uri: redirectUri,
        ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
      }).toString(),
    });
    if (!res.access_token) {
      throw new Error(res.error_description ?? res.error ?? "GitHub token exchange failed.");
    }
    return {
      access_token: res.access_token,
      token_type: res.token_type,
      scope: res.scope,
    };
  },

  async revoke(secret) {
    // Deleting the OAuth grant needs Basic auth with the app credentials.
    if (!secret.access_token) return;
    try {
      await integrationFetch(`${API}/applications/${clientId()}/grant`, {
        method: "DELETE",
        headers: {
          authorization: `Basic ${Buffer.from(`${clientId()}:${clientSecret()}`).toString("base64")}`,
          accept: "application/vnd.github+json",
        },
        body: JSON.stringify({ access_token: secret.access_token }),
      });
    } catch {
      // best effort
    }
  },

  async testConnection(secret) {
    if (!secret.access_token) throw new Error("No access token on this connection.");
    const user = await integrationFetchJson<{ login?: string }>(`${API}/user`, {
      headers: {
        authorization: `Bearer ${secret.access_token}`,
        accept: "application/vnd.github+json",
        "user-agent": "alking-hq-os",
      },
    });
    if (!user.login) throw new Error("GitHub did not return a user.");
    return { accountLabel: user.login };
  },

  verifyWebhook({ rawBody, headers }) {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    const signature = headers.get("x-hub-signature-256");
    if (!secret || !signature) return { valid: false };
    const expected =
      "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    const valid = a.length === b.length && timingSafeEqual(a, b);
    return {
      valid,
      eventId: headers.get("x-github-delivery") ?? undefined,
      eventType: headers.get("x-github-event") ?? undefined,
    };
  },
};
