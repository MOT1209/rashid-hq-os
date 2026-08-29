import "server-only";

import { allProviders, providerConfigured } from "@/lib/integrations/registry";
import { listConnections } from "@/lib/integrations/connections";
import { encryptionConfigured } from "@/lib/integrations/encryption";
import type { IntegrationView } from "@/lib/integrations/types";

/**
 * The full picture for the dashboard: every provider in the registry, joined
 * with this owner's connection (if any). No secrets — `listConnections` never
 * decrypts.
 */
export async function integrationsForOwner(ownerId: string): Promise<IntegrationView[]> {
  const connections = await listConnections(ownerId);
  const byProvider = new Map(connections.map((c) => [c.provider, c]));
  const secretStore = encryptionConfigured();

  return allProviders().map(({ meta }) => {
    const conn = byProvider.get(meta.id);
    return {
      ...meta,
      // A credential-storing provider is only truly usable with the encryption
      // key present; surface that the same way as a missing OAuth client.
      configured: providerConfigured(meta) && (meta.authMethod === "oauth2" ? secretStore : true),
      connection: conn
        ? {
            status: conn.status,
            accountLabel: (conn.metadata.accountLabel as string | undefined) ?? null,
            scopes: (conn.metadata.scopes as string[] | undefined) ?? [],
            expiresAt: conn.expiresAt,
            lastConnectedAt: conn.lastConnectedAt,
            lastError: conn.lastError,
          }
        : null,
    };
  });
}
