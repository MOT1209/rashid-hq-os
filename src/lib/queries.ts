import "server-only";

import { getServiceSupabase } from "@/lib/supabase/server";
import type { AgentLog, Project, ProjectTool } from "@/types/database";

export async function fetchProjects(): Promise<Project[]> {
  const { data } = await getServiceSupabase()
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false });
  return (data ?? []) as Project[];
}

export async function fetchProjectTools(): Promise<ProjectTool[]> {
  const { data } = await getServiceSupabase()
    .from("project_tools")
    .select("*")
    .order("created_at", { ascending: false });
  return (data ?? []) as ProjectTool[];
}

export async function fetchLogs(options: {
  limit?: number;
  projectId?: string;
  agentNames?: string[];
} = {}): Promise<AgentLog[]> {
  let query = getServiceSupabase()
    .from("agent_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 50);

  if (options.projectId) query = query.eq("project_id", options.projectId);
  if (options.agentNames?.length) query = query.in("agent_name", options.agentNames);

  const { data } = await query;
  return (data ?? []) as AgentLog[];
}

/** id → name lookup so the activity feed can label rows without a join. */
export function projectNameMap(projects: Project[]) {
  return Object.fromEntries(projects.map((p) => [p.id, p.name]));
}

export async function fetchStats() {
  const supabase = getServiceSupabase();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [active, today, failed, pending] = await Promise.all([
    supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
    supabase
      .from("agent_logs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since),
    supabase
      .from("agent_logs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since)
      .eq("status", "failed"),
    supabase
      .from("agent_logs")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
  ]);

  const calls = today.count ?? 0;
  return {
    activeProjects: active.count ?? 0,
    callsToday: calls,
    pending: pending.count ?? 0,
    failureRate: calls ? Math.round(((failed.count ?? 0) / calls) * 100) : 0,
  };
}
