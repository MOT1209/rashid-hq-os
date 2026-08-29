/**
 * Shared shapes for the integrations layer. No `server-only` here so the client
 * components can import the metadata types.
 */

export type AuthMethod = "oauth2" | "api_key" | "config";

export type ConnectionStatus = "connected" | "disconnected" | "error" | "expired";

/** How ready a provider is in this codebase. */
export type ProviderReadiness = "available" | "planned";

/**
 * Static, non-secret description of a provider. Rendered directly in the
 * dashboard, so everything here is safe to send to the browser.
 */
export type ProviderMeta = {
  /** Registry key — the URL segment and the `provider` column value. */
  id: string;
  name: string;
  /** Short bilingual blurb for the card. */
  description: { ar: string; en: string };
  /** lucide-react icon name, resolved in the client component. */
  icon: string;
  category: "google" | "developer" | "social" | "messaging" | "payments" | "ai" | "analytics";
  authMethod: AuthMethod;
  readiness: ProviderReadiness;
  /** OAuth scopes requested at connect time. Least-privilege by default. */
  scopes: string[];
  /** Docs link shown in the UI and in INTEGRATIONS.md. */
  docsUrl: string;
  /** Env vars this provider needs to be usable, for the "needs setup" hint. */
  requiredEnv: string[];
  /** Provider emits webhooks this console can receive. */
  hasWebhooks: boolean;
};

/** What the UI receives per provider — metadata plus this owner's connection. */
export type IntegrationView = ProviderMeta & {
  connection: {
    status: ConnectionStatus;
    accountLabel: string | null;
    scopes: string[];
    expiresAt: string | null;
    lastConnectedAt: string | null;
    lastError: string | null;
  } | null;
  /** False when requiredEnv is missing on the server. */
  configured: boolean;
};

/** The decrypted secret bundle. Shape varies by auth method. */
export type SecretBundle = {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  token_type?: string;
  api_key?: string;
  [key: string]: unknown;
};

/** Row shape after decryption, as the rest of the app consumes it. */
export type IntegrationConnection = {
  id: string;
  ownerId: string;
  provider: string;
  status: ConnectionStatus;
  metadata: Record<string, unknown>;
  expiresAt: string | null;
  lastConnectedAt: string | null;
  lastError: string | null;
  /** Only populated by callers that explicitly ask for it. */
  secret?: SecretBundle;
};

export type OAuthTokenResponse = {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
};

/**
 * The behaviour contract every provider implements. Metadata lives in
 * `ProviderMeta`; this is the runtime half.
 */
export type IntegrationProvider = {
  meta: ProviderMeta;

  /**
   * OAuth providers: build the provider's authorize URL. `redirectUri` is this
   * console's callback. Returns the URL plus anything the callback will need
   * (a PKCE verifier), which the caller persists against `state`.
   */
  buildAuthUrl?: (args: {
    redirectUri: string;
    state: string;
    scopes: string[];
  }) => { url: string; codeVerifier?: string };

  /** OAuth providers: exchange an authorization code for tokens. */
  exchangeCode?: (args: {
    code: string;
    redirectUri: string;
    codeVerifier?: string;
  }) => Promise<OAuthTokenResponse>;

  /** OAuth providers that issue refresh tokens. */
  refresh?: (refreshToken: string) => Promise<OAuthTokenResponse>;

  /** Best-effort remote revoke on disconnect. Never throws. */
  revoke?: (secret: SecretBundle) => Promise<void>;

  /**
   * Prove the connection works and return a human label for the external
   * account (email, login, channel name). Throws on failure.
   */
  testConnection: (secret: SecretBundle) => Promise<{ accountLabel: string }>;

  /** Verify an inbound webhook signature. Providers without webhooks omit it. */
  verifyWebhook?: (args: {
    rawBody: string;
    headers: Headers;
  }) => { valid: boolean; eventId?: string; eventType?: string };
};
