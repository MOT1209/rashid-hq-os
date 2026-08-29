import "server-only";

import { getServiceSupabase } from "@/lib/supabase/server";
import { dbError } from "@/lib/errors";
import { open, seal } from "@/lib/integrations/encryption";
import { getProvider } from "@/lib/integrations/registry";
import type {
  ConnectionStatus,
  IntegrationConnection,
  OAuthTokenResponse,
  SecretBundle,
} from "@/lib/integrations/types";

/**
 * Owner-scoped store for integration connections. Every read and write is
 * filtered by owner_id, exactly like `ownsProject` in the MCP tools — a caller
 * can only ever see or touch their own connections.
 *
 * Secrets are sealed on the way in and opened only when a caller explicitly
 * asks (`withSecret`). The UI path never asks.
 */

type Row = {
  id: string;
  owner_id: string;
  provider: string;
  status: string;
  secret_ciphertext: string | null;
  metadata: Record<string, unknown> | null;
  expires_at: string | null;
  last_connected_at: string | null;
  last_error: string | null;
};

function toConnection(row: Row): IntegrationConnection {
  return {
    id: row.id,
    ownerId: row.owner_id,
    provider: row.provider,
    status: row.status as ConnectionStatus,
    metadata: row.metadata ?? {},
    expiresAt: row.expires_at,
    lastConnectedAt: row.last_connected_at,
    lastError: row.last_error,
  };
}

const COLUMNS =
  "id, owner_id, provider, status, secret_ciphertext, metadata, expires_at, last_connected_at, last_error";

export async function listConnections(ownerId: string): Promise<IntegrationConnection[]> {
  const { data, error } = await getServiceSupabase()
    .from("integration_connections")
    .select(COLUMNS)
    .eq("owner_id", ownerId);
  if (error) throw dbError("Loading integrations", error);
  return (data ?? []).map((r) => toConnection(r as Row));
}

export async function getConnection(
  ownerId: string,
  provider: string,
): Promise<IntegrationConnection | null> {
  const { data, error } = await getServiceSupabase()
    .from("integration_connections")
    .select(COLUMNS)
    .eq("owner_id", ownerId)
    .eq("provider", provider)
    .maybeSingle();
  if (error) throw dbError("Loading the integration", error);
  return data ? toConnection(data as Row) : null;
}

/** Loads a connection with its secret bundle decrypted. */
export async function getConnectionWithSecret(
  ownerId: string,
  provider: string,
): Promise<IntegrationConnection | null> {
  const { data, error } = await getServiceSupabase()
    .from("integration_connections")
    .select(COLUMNS)
    .eq("owner_id", ownerId)
    .eq("provider", provider)
    .maybeSingle();
  if (error) throw dbError("Loading the integration", error);
  if (!data) return null;
  const row = data as Row;
  const conn = toConnection(row);
  if (row.secret_ciphertext) {
    conn.secret = open<SecretBundle>(row.secret_ciphertext);
  }
  return conn;
}

/** Upserts the connection for (owner, provider) with a fresh sealed secret. */
export async function saveConnection(input: {
  ownerId: string;
  provider: string;
  secret: SecretBundle;
  status: ConnectionStatus;
  metadata?: Record<string, unknown>;
  expiresAt?: string | null;
}): Promise<void> {
  const { error } = await getServiceSupabase()
    .from("integration_connections")
    .upsert(
      {
        owner_id: input.ownerId,
        provider: input.provider,
        secret_ciphertext: seal(input.secret),
        status: input.status,
        metadata: (input.metadata ?? {}) as never,
        expires_at: input.expiresAt ?? null,
        last_connected_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id,provider" },
    );
  if (error) throw dbError("Saving the integration", error);
}

/** Records a non-fatal failure without discarding the stored secret. */
export async function markConnectionError(
  ownerId: string,
  provider: string,
  message: string,
  status: ConnectionStatus = "error",
): Promise<void> {
  await getServiceSupabase()
    .from("integration_connections")
    .update({ status, last_error: message.slice(0, 500), updated_at: new Date().toISOString() })
    .eq("owner_id", ownerId)
    .eq("provider", provider);
}

export async function deleteConnection(ownerId: string, provider: string): Promise<boolean> {
  const { error, count } = await getServiceSupabase()
    .from("integration_connections")
    .delete({ count: "exact" })
    .eq("owner_id", ownerId)
    .eq("provider", provider);
  if (error) throw dbError("Disconnecting the integration", error);
  return Boolean(count);
}

/** Merge an OAuth token response into a stored secret bundle. */
export function mergeTokens(prev: SecretBundle, next: OAuthTokenResponse): SecretBundle {
  return {
    ...prev,
    access_token: next.access_token,
    refresh_token: next.refresh_token ?? prev.refresh_token,
    id_token: next.id_token ?? prev.id_token,
    token_type: next.token_type ?? prev.token_type,
  };
}

/**
 * Returns a valid access token for (owner, provider), refreshing first if the
 * stored one is within 60s of expiry. Throws if the connection is missing or
 * cannot be refreshed — the caller decides whether that is fatal.
 */
export async function getFreshAccessToken(
  ownerId: string,
  provider: string,
): Promise<string> {
  const conn = await getConnectionWithSecret(ownerId, provider);
  if (!conn?.secret?.access_token) {
    throw new Error(`No connected ${provider} account.`);
  }

  const isExpired =
    Boolean(conn.expiresAt) &&
    new Date(conn.expiresAt as string).getTime() - Date.now() < 60_000;
  if (!isExpired) return conn.secret.access_token;

  const impl = getProvider(provider);
  if (!impl?.refresh || !conn.secret.refresh_token) {
    await markConnectionError(ownerId, provider, "Access token expired.", "expired");
    throw new Error(`${provider} token expired and cannot be refreshed.`);
  }

  const refreshed = await impl.refresh(conn.secret.refresh_token);
  const merged = mergeTokens(conn.secret, refreshed);
  await saveConnection({
    ownerId,
    provider,
    secret: merged,
    status: "connected",
    metadata: conn.metadata,
    expiresAt: refreshed.expires_in
      ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
      : null,
  });
  return merged.access_token!;
}
