import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "@/lib/errors";
import { open, seal } from "@/lib/integrations/encryption";
import { getServiceSupabase } from "@/lib/supabase/server";

/**
 * Bearer tokens for 'mcp'-protocol project servers, sealed with
 * INTEGRATIONS_SECRET (AES-256-GCM). The browser can learn only WHETHER a
 * token is set (hasMcpToken) — never its value.
 */
const db = () => getServiceSupabase() as unknown as SupabaseClient;

export async function loadMcpToken(projectId: string): Promise<string | null> {
  const { data, error } = await db().from("mcp_server_credentials").select("secret_ciphertext").eq("project_id", projectId).maybeSingle();
  if (error) throw dbError("Loading the MCP credential", error);
  if (!data) return null;
  return open<{ token: string }>((data as { secret_ciphertext: string }).secret_ciphertext).token ?? null;
}

export async function hasMcpTokens(projectIds: string[]): Promise<Set<string>> {
  if (projectIds.length === 0) return new Set();
  const { data, error } = await db().from("mcp_server_credentials").select("project_id").in("project_id", projectIds);
  if (error) throw dbError("Loading MCP credentials", error);
  return new Set((data ?? []).map((r: { project_id: string }) => r.project_id));
}

export async function saveMcpToken(projectId: string, ownerId: string, token: string): Promise<void> {
  const { error } = await db().from("mcp_server_credentials").upsert(
    { project_id: projectId, owner_id: ownerId, secret_ciphertext: seal({ token }), updated_at: new Date().toISOString() },
    { onConflict: "project_id" },
  );
  if (error) throw dbError("Saving the MCP credential", error);
}

export async function clearMcpToken(projectId: string): Promise<void> {
  const { error } = await db().from("mcp_server_credentials").delete().eq("project_id", projectId);
  if (error) throw dbError("Removing the MCP credential", error);
}
