import "server-only";

import { getServiceSupabase } from "@/lib/supabase/server";
import { captureError } from "@/lib/errors";
import type { ActorType, Json, LogStatus, PolicyDecision } from "@/types/database";

type StartArgs = {
  projectId?: string | null;
  agentName: string;
  toolName: string;
  payload?: Json;
  /**
   * Defaults to "pending". A require_approval call starts life as
   * "awaiting_approval" instead, since nothing will call finish() on it until
   * an admin decides — possibly in a different request entirely.
   */
  status?: LogStatus;
  decision?: PolicyDecision | null;
  decisionReason?: string | null;
  actorType?: ActorType | null;
};

/** Postgres foreign-key violation. */
const FK_VIOLATION = "23503";

/**
 * Tool arguments are arbitrary JSON from an agent and results come from a
 * remote server, so both are attacker-influenced in size. Rows live for 90 days
 * (migration 0006); an unbounded blob would sit in the table for all of it.
 */
const MAX_JSON_BYTES = 32_000;

function bounded(value: Json | null | undefined): Json | null {
  if (value == null) return null;
  const text = JSON.stringify(value);
  if (text.length <= MAX_JSON_BYTES) return value;
  return {
    truncated: true,
    original_bytes: text.length,
    preview: text.slice(0, MAX_JSON_BYTES),
  } as Json;
}

/**
 * A row referencing a project that does not exist violates the foreign key and
 * the whole log is lost. That silently hid an entire class of failing tool
 * calls — exactly the ones worth seeing. Retry unlinked instead, keeping the
 * id in the payload so the record still says which project was asked for.
 */
async function insertLog(
  supabase: ReturnType<typeof getServiceSupabase>,
  row: Record<string, unknown>,
  projectId: string | null,
) {
  const first = await supabase.from("agent_logs").insert(row).select("id").single();
  if (!first.error) return first;

  if (first.error.code === FK_VIOLATION && projectId) {
    console.error(`[activity] unknown project_id ${projectId}; logging unlinked`);
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    return supabase
      .from("agent_logs")
      .insert({
        ...row,
        project_id: null,
        payload: { ...payload, unknown_project_id: projectId },
      })
      .select("id")
      .single();
  }

  return first;
}

/**
 * Flips a row to success/failed with its result. Split out from
 * startActivity so a decision made in a later, unrelated request — an admin
 * approving or rejecting a queued call — can finish a row it did not start.
 * Logging must never break the caller, so failures here are swallowed.
 */
export async function finishActivity(id: string, status: LogStatus, result: Json) {
  const { error } = await getServiceSupabase()
    .from("agent_logs")
    .update({ status, result: bounded(result) })
    .eq("id", id);
  if (error) captureError("activity:finish", error, { id, status });
}

/**
 * Writes a row (`pending` unless `status` overrides it) so the dashboard sees
 * the call the moment it starts, and returns the row id plus a finish() bound
 * to it. Logging must never break the caller, so failures here are swallowed.
 */
export async function startActivity({
  projectId,
  agentName,
  toolName,
  payload,
  status,
  decision,
  decisionReason,
  actorType,
}: StartArgs) {
  const { data, error } = await insertLog(
    getServiceSupabase(),
    {
      project_id: projectId ?? null,
      agent_name: agentName,
      tool_name: toolName,
      payload: bounded(payload),
      status: status ?? "pending",
      decision: decision ?? null,
      decision_reason: decisionReason ?? null,
      actor_type: actorType ?? null,
    },
    projectId ?? null,
  );

  // A systemic agent_logs outage would otherwise be invisible: the caller is
  // never blocked (by design), so Sentry is the only place this surfaces.
  if (error) captureError("activity:startActivity", error, { agentName, toolName });
  const id = (data?.id as string | undefined) ?? null;

  return {
    id,
    finish: async (finishStatus: LogStatus, result: Json) => {
      if (!id) return;
      await finishActivity(id, finishStatus, result);
    },
  };
}

/** One-shot log for something that already happened. */
export async function logActivity(args: StartArgs & { status: LogStatus; result?: Json }) {
  const supabase = getServiceSupabase();
  const { error } = await insertLog(
    supabase,
    {
      project_id: args.projectId ?? null,
      agent_name: args.agentName,
      tool_name: args.toolName,
      payload: bounded(args.payload),
      result: bounded(args.result),
      status: args.status,
    },
    args.projectId ?? null,
  );
  if (error) {
    captureError("activity:logActivity", error, {
      agentName: args.agentName,
      toolName: args.toolName,
    });
  }
}
