"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { getProvider } from "@/lib/integrations/registry";
import {
  deleteConnection,
  getConnectionWithSecret,
  saveConnection,
} from "@/lib/integrations/connections";
import { encryptionConfigured, fingerprint } from "@/lib/integrations/encryption";
import { logIntegration } from "@/lib/integrations/logger";

type Result = { ok?: true; error?: string; accountLabel?: string };

const PAGE = "/dashboard/settings/integrations";
const MAX_KEY = 400;

/**
 * Save (or replace) the credential for an API-key / config provider. The key is
 * tested against the provider before it is stored, so a bad paste fails loudly
 * instead of sitting broken. Sealed by encryption.ts on the way in; the
 * plaintext never returns to the client.
 */
export async function saveApiKeyAction(form: FormData): Promise<Result> {
  const session = await requireAdmin();

  const providerId = String(form.get("provider") ?? "");
  const apiKey = String(form.get("api_key") ?? "").trim();
  const impl = getProvider(providerId);

  if (!impl) return { error: "Unknown provider." };
  if (impl.meta.authMethod !== "api_key" && impl.meta.authMethod !== "config") {
    return { error: "This provider connects through OAuth, not an API key." };
  }
  if (!apiKey) return { error: "A value is required." };
  if (apiKey.length > MAX_KEY) return { error: "That value is too long." };
  if (!encryptionConfigured()) {
    return { error: "INTEGRATIONS_SECRET is not set on the server; cannot store credentials." };
  }

  let accountLabel: string;
  try {
    ({ accountLabel } = await impl.testConnection({ api_key: apiKey }));
  } catch (error) {
    return { error: error instanceof Error ? error.message : "The key was rejected." };
  }

  await saveConnection({
    ownerId: session.user.id,
    provider: providerId,
    secret: { api_key: apiKey },
    status: "connected",
    metadata: { accountLabel, keyFingerprint: fingerprint(apiKey) },
  });

  await logIntegration({
    provider: providerId,
    operation: "connect.apikey",
    status: "success",
    detail: { accountLabel },
  });

  revalidatePath(PAGE);
  return { ok: true, accountLabel };
}

/** Disconnect any provider (OAuth or API-key) from a plain form. */
export async function disconnectAction(form: FormData): Promise<Result> {
  const session = await requireAdmin();
  const providerId = String(form.get("provider") ?? "");
  const impl = getProvider(providerId);
  if (!impl) return { error: "Unknown provider." };

  if (impl.revoke) {
    const conn = await getConnectionWithSecret(session.user.id, providerId);
    if (conn?.secret) {
      try {
        await impl.revoke(conn.secret);
      } catch {
        // best effort
      }
    }
  }

  const removed = await deleteConnection(session.user.id, providerId);
  await logIntegration({
    provider: providerId,
    operation: "disconnect",
    status: removed ? "success" : "failed",
  });
  revalidatePath(PAGE);
  return { ok: true };
}
