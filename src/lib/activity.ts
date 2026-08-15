import "server-only";

import { getServiceSupabase } from "@/lib/supabase/server";
import type { Json, LogStatus } from "@/types/database";

type StartArgs = {
  projectId?: string | null;
  agentName: string;
  toolName: string;
  payload?: Json;
};

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
  const { data, error } = await supabase
    .from("agent_logs")
    .insert({
      project_id: projectId ?? null,
      agent_name: agentName,
      tool_name: toolName,
      payload: payload ?? null,
      status: "pending",
    })
    .select("id")
    .single();

  if (error) console.error("[activity] insert failed", error.message);
  const id = data?.id ?? null;

  return async function finish(status: LogStatus, result: Json) {
    if (!id) return;
    const { error: updateError } = await supabase
      .from("agent_logs")
      .update({ status, result })
      .eq("id", id);
    if (updateError) console.error("[activity] update failed", updateError.message);
  };
}

/** One-shot log for something that already happened. */
export async function logActivity(args: StartArgs & { status: LogStatus; result?: Json }) {
  const supabase = getServiceSupabase();
  const { error } = await supabase.from("agent_logs").insert({
    project_id: args.projectId ?? null,
    agent_name: args.agentName,
    tool_name: args.toolName,
    payload: args.payload ?? null,
    result: args.result ?? null,
    status: args.status,
  });
  if (error) console.error("[activity] insert failed", error.message);
}
