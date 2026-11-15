import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewAgent } from "@/lib/agent-config";
import type { RunRow } from "@/lib/agent-metrics";
import { dbError } from "@/lib/errors";
import { getServiceSupabase } from "@/lib/supabase/server";

const db = () => getServiceSupabase() as unknown as SupabaseClient;

/** Last `days` of the model-run ledger (bounded). Tokens, durations and outcomes are real; nothing is estimated. */
export async function fetchAgentRuns(days = 30, limit = 5000): Promise<RunRow[]> {
  const since = new Date(Date.now() - days * 24 * 3600_000).toISOString();
  const { data, error } = await db().from("agent_runs").select("agent_name, kind, status, tokens_in, tokens_out, duration_ms, step_count, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(limit);
  if (error) throw dbError("Loading agent runs", error);
  return (data ?? []) as RunRow[];
}

export type FailureRow = { id: string; agent_name: string | null; tool_name: string | null; created_at: string; error: string | null };

/** Failed tool calls and decisions per agent in the last week (error reporting). */
export async function fetchAgentFailures(agentNames: string[], days = 7, limit = 150): Promise<FailureRow[]> {
  if (agentNames.length === 0) return [];
  const since = new Date(Date.now() - days * 24 * 3600_000).toISOString();
  const { data, error } = await db().from("agent_logs").select("id, agent_name, tool_name, created_at, result").in("agent_name", agentNames).eq("status", "failed").gte("created_at", since).order("created_at", { ascending: false }).limit(limit);
  if (error) throw dbError("Loading agent failures", error);
  return ((data ?? []) as { id: string; agent_name: string | null; tool_name: string | null; created_at: string; result: { error?: unknown } | null }[]).map((r) => ({
    id: r.id, agent_name: r.agent_name, tool_name: r.tool_name, created_at: r.created_at,
    error: typeof r.result?.error === "string" ? r.result.error.slice(0, 200) : null,
  }));
}

/** Assignments may not exist yet (migration 0033 not applied): treat that as none. */
export async function fetchAssignments(): Promise<Map<string, string[]>> {
  const { data, error } = await db().from("agent_projects").select("department_key, project_id");
  const out = new Map<string, string[]>();
  if (error) return out;
  for (const r of (data ?? []) as { department_key: string; project_id: string }[]) out.set(r.department_key, [...(out.get(r.department_key) ?? []), r.project_id]);
  return out;
}

export async function createAgent(a: NewAgent): Promise<void> {
  const { data: max } = await db().from("departments").select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { error } = await db().from("departments").insert({
    key: a.key, name_en: a.name_en, name_ar: a.name_ar, agent_name: a.agent_name,
    agent_label_en: a.agent_name, agent_label_ar: a.agent_name, icon: a.icon, system_prompt: a.system_prompt, model: a.model,
    sort_order: ((max as { sort_order: number } | null)?.sort_order ?? 0) + 1, is_custom: true, enabled: true, is_fallback: false,
  });
  if (error) throw dbError("Creating the agent", error);
}

export async function saveConfig(key: string, c: { enabled: boolean; read_only: boolean; allowed_tools: string[] | null; project_ids: string[] }): Promise<void> {
  const supabase = db();
  const { data, error } = await supabase.from("departments").update({ enabled: c.enabled, read_only: c.read_only, allowed_tools: c.allowed_tools }).eq("key", key).select("key");
  if (error) throw dbError("Saving the agent", error);
  if (!data?.length) throw new Error("Agent not found.");
  // Replace the assignment set (small, bounded by the owner's projects).
  const del = await supabase.from("agent_projects").delete().eq("department_key", key);
  if (del.error) throw dbError("Saving the assignments", del.error);
  if (c.project_ids.length) {
    const ins = await supabase.from("agent_projects").insert(c.project_ids.map((project_id) => ({ department_key: key, project_id })));
    if (ins.error) throw dbError("Saving the assignments", ins.error);
  }
}

/** Only agents created from the Agents page can be deleted; built-in departments and the fallback cannot. */
export async function deleteCustomAgent(key: string): Promise<boolean> {
  const { data, error } = await db().from("departments").delete().eq("key", key).eq("is_custom", true).eq("is_fallback", false).select("key");
  if (error) throw dbError("Deleting the agent", error);
  return Boolean(data?.length);
}
