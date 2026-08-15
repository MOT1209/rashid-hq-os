import "server-only";

import { getServiceSupabase } from "@/lib/supabase/server";
import { dbError } from "@/lib/errors";
import type { AgentLog, LogStatus, Project, ProjectTool } from "@/types/database";

/** Registry pages need every column; pickers only need id + name. */
const PROJECT_COLUMNS =
  "id, name, category, url, repository_url, mcp_endpoint, status, owner_id, created_at";

export async function fetchProjects(limit = 200): Promise<Project[]> {
  const { data, error } = await getServiceSupabase()
    .from("projects")
    .select(PROJECT_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw dbError("Loading projects", error);
  return (data ?? []) as Project[];
}

/**
 * Pared-down variant for the pages that only label rows or fill a <select>.
 * Avoids pulling endpoints and URLs into pages that never show them.
 */
export async function fetchProjectOptions(): Promise<
  Pick<Project, "id" | "name">[]
> {
  const { data, error } = await getServiceSupabase()
    .from("projects")
    .select("id, name")
    .order("name");
  if (error) throw dbError("Loading projects", error);
  return (data ?? []) as Pick<Project, "id" | "name">[];
}

export async function fetchProjectTools(): Promise<ProjectTool[]> {
  const { data, error } = await getServiceSupabase()
    .from("project_tools")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw dbError("Loading project tools", error);
  return (data ?? []) as ProjectTool[];
}

export type LogFilters = {
  limit?: number;
  projectId?: string;
  agentNames?: string[];
  status?: LogStatus;
  /** Keyset pagination: return rows strictly older than this timestamp. */
  before?: string;
};

export async function fetchLogs(options: LogFilters = {}): Promise<AgentLog[]> {
  let query = getServiceSupabase()
    .from("agent_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 50);

  if (options.projectId) query = query.eq("project_id", options.projectId);
  if (options.agentNames?.length) query = query.in("agent_name", options.agentNames);
  if (options.status) query = query.eq("status", options.status);
  // Keyset, not offset: stable under inserts and index-friendly as the table grows.
  if (options.before) query = query.lt("created_at", options.before);

  const { data, error } = await query;
  if (error) throw dbError("Loading activity", error);
  return (data ?? []) as AgentLog[];
}

/** id → name lookup so the activity feed can label rows without a join. */
export function projectNameMap(projects: Pick<Project, "id" | "name">[]) {
  return Object.fromEntries(projects.map((p) => [p.id, p.name]));
}

export async function fetchStats() {
  const supabase = getServiceSupabase();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // `planned` reads the query planner's estimate instead of walking the table.
  // Exact counts on agent_logs are O(rows) in Postgres and these are KPI tiles.
  const [active, today, failed, pending] = await Promise.all([
    supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
    supabase
      .from("agent_logs")
      .select("id", { count: "planned", head: true })
      .gte("created_at", since),
    supabase
      .from("agent_logs")
      .select("id", { count: "planned", head: true })
      .gte("created_at", since)
      .eq("status", "failed"),
    supabase
      .from("agent_logs")
      .select("id", { count: "planned", head: true })
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
