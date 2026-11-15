import "server-only";

import { dbError } from "@/lib/errors";
import type { CallRow } from "@/lib/mcp/stats";
import { getServiceSupabase } from "@/lib/supabase/server";

/** Last `days` of call_project_tool activity (bounded), for the MCP management page. */
export async function fetchToolCallRows(days = 7, limit = 1000): Promise<CallRow[]> {
  const since = new Date(Date.now() - days * 24 * 3600_000).toISOString();
  const { data, error } = await getServiceSupabase()
    .from("agent_logs")
    .select("project_id, status, decision, created_at, payload, result")
    .eq("tool_name", "call_project_tool")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw dbError("Loading tool history", error);
  return (data ?? []) as CallRow[];
}
