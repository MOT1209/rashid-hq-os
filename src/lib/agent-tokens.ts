import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { getServiceSupabase } from "@/lib/supabase/server";
import { dbError } from "@/lib/errors";

export type AgentToken = {
  id: string;
  agent_name: string;
  token_prefix: string;
  scopes: string[];
  project_id: string | null;
  /** The owner who issued this token; inherited by anything it creates. */
  created_by: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  expires_at: string | null;
  created_at: string;
};

const PREFIX = "hq_";

function hash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Issues a bearer token for an agent. The plaintext is returned exactly once —
 * only its SHA-256 hash is stored, so a leaked database row cannot be replayed.
 */
export async function issueAgentToken(input: {
  agentName: string;
  projectId?: string | null;
  scopes?: string[];
  createdBy?: string;
  expiresAt?: string | null;
}) {
  const token = PREFIX + randomBytes(32).toString("base64url");
  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from("agent_tokens")
    .insert({
      agent_name: input.agentName,
      token_hash: hash(token),
      token_prefix: token.slice(0, 11),
      scopes: input.scopes ?? ["read", "write"],
      project_id: input.projectId ?? null,
      created_by: input.createdBy ?? null,
      expires_at: input.expiresAt ?? null,
    })
    .select("id, agent_name, token_prefix, scopes, project_id, created_at")
    .single();

  if (error) throw dbError("Issuing the token", error);
  return { token, record: data as AgentToken };
}

export async function listAgentTokens(): Promise<AgentToken[]> {
  const { data, error } = await getServiceSupabase()
    .from("agent_tokens")
    .select(
      "id, agent_name, token_prefix, scopes, project_id, created_by, last_used_at, revoked_at, expires_at, created_at",
    )
    .order("created_at", { ascending: false });

  if (error) throw dbError("Listing tokens", error);
  return (data ?? []) as AgentToken[];
}

export async function revokeAgentToken(id: string) {
  const { error } = await getServiceSupabase()
    .from("agent_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw dbError("Revoking the token", error);
}

/**
 * Verifies an `Authorization: Bearer <token>` header against agent_tokens.
 * Returns null for missing, unknown, revoked, or expired tokens.
 */
export async function verifyAgentToken(
  authorization: string | null,
): Promise<AgentToken | null> {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice(7).trim();
  if (!token.startsWith(PREFIX)) return null;

  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from("agent_tokens")
    .select(
      "id, agent_name, token_prefix, scopes, project_id, created_by, last_used_at, revoked_at, expires_at, created_at",
    )
    .eq("token_hash", hash(token))
    .maybeSingle();

  if (error || !data) return null;
  const record = data as AgentToken;
  if (record.revoked_at) return null;
  if (record.expires_at && new Date(record.expires_at) < new Date()) return null;

  // Fire-and-forget: last_used_at is telemetry, not part of the auth decision.
  // Still needs a catch, or a failed write becomes an unhandled rejection.
  void (async () => {
    try {
      const { error: updateError } = await supabase
        .from("agent_tokens")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", record.id);
      if (updateError) console.error("[auth] last_used_at:", updateError.message);
    } catch (cause) {
      console.error("[auth] last_used_at:", cause);
    }
  })();

  return record;
}
