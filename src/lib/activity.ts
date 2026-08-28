import "server-only";

import { getServiceSupabase } from "@/lib/supabase/server";
import { captureError } from "@/lib/errors";
import type { Json, LogStatus } from "@/types/database";

type StartArgs = {
  projectId?: string | null;
  agentName: string;
  toolName: string;
  payload?: Json;
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
 * Writes a `pending` row so the dashboard sees the call the moment it starts,
 * and returns a finish() that flips it to success/failed with the result.
 * Logging must never break the caller, so failures here are swallowed.
 */
export async function startActivity({
  projectId,
  agentName,
  toolName,
  payload,
}: StartArgs) {
  const supabase = getServiceSupabase();
  const { data, error } = await insertLog(
    supabase,
    {
      project_id: projectId ?? null,
      agent_name: agentName,
      tool_name: toolName,
      payload: bounded(payload),
      status: "pending",
    },
    projectId ?? null,
  );

  // A systemic agent_logs outage would otherwise be invisible: the caller is
  // never blocked (by design), so Sentry is the only place this surfaces.
  if (error) captureError("activity:startActivity", error, { agentName, toolName });
  const id = data?.id ?? null;

  return async function finish(status: LogStatus, result: Json) {
    if (!id) return;
    const { error: updateError } = await supabase
      .from("agent_logs")
      .update({ status, result: bounded(result) })
      .eq("id", id);
    if (updateError) {
      captureError("activity:finish", updateError, { agentName, toolName, status });
    }
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
