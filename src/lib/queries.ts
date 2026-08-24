import "server-only";

import { cache } from "react";
import { getServiceSupabase } from "@/lib/supabase/server";
import { dbError } from "@/lib/errors";
import type { AgentSkill, Department, ProjectCategory } from "@/lib/agents";
import type { AgentLog, LogStatus, Project, ProjectTool } from "@/types/database";

/**
 * Departments and categories are read by nearly every page — the sidebar, the
 * dashboard, the project forms. `cache` dedupes them to one query per request
 * instead of one per component that asks.
 */
export const fetchDepartments = cache(async (): Promise<Department[]> => {
  const { data, error } = await getServiceSupabase()
    .from("departments")
    .select("*")
    .order("sort_order");
  if (error) throw dbError("Loading departments", error);
  return (data ?? []) as Department[];
});

export const fetchCategories = cache(async (): Promise<ProjectCategory[]> => {
  const { data, error } = await getServiceSupabase()
    .from("project_categories")
    .select("*")
    .order("sort_order");
  if (error) throw dbError("Loading categories", error);
  return (data ?? []) as ProjectCategory[];
});

/** Saved command templates for the CEO console (migration 0010). */
export const fetchSkills = cache(async (): Promise<AgentSkill[]> => {
  const { data, error } = await getServiceSupabase()
    .from("agent_skills")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw dbError("Loading skills", error);
  return (data ?? []) as AgentSkill[];
});

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * project_id is a uuid column, so a junk filter value makes Postgres raise
 * 22P02 and the page throws. Callers take filters straight from the URL, so
 * validate before querying and treat anything else as "no such project".
 */
export function isUuid(value: string | undefined | null): value is string {
  return typeof value === "string" && UUID.test(value);
}

export type LogFilters = {
  limit?: number;
  projectId?: string;
  agentNames?: string[];
  status?: LogStatus;
  /** Keyset pagination: return rows strictly older than this timestamp. */
  before?: string;
  /**
   * Live tail: return only rows at or newer than this timestamp. Lets the SSE
   * feed ask for the delta instead of re-reading its whole window every poll.
   */
  since?: string;
  /** Drop the jsonb payload/result columns — the compact feed does not show them. */
  slim?: boolean;
};

/** Everything except the two unbounded jsonb columns. */
const LOG_COLUMNS_SLIM =
  "id, project_id, agent_name, tool_name, status, created_at";

export async function fetchLogs(options: LogFilters = {}): Promise<AgentLog[]> {
  // The generated types resolve `select()` per literal, so a conditional column
  // list confuses the parser. The runtime shape is a subset of AgentLog either
  // way — payload/result are simply absent when `slim` is set.
  const columns: "*" = (options.slim ? LOG_COLUMNS_SLIM : "*") as "*";

  let query = getServiceSupabase()
    .from("agent_logs")
    .select(columns)
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 50);

  // A caller that passes a non-uuid meant to filter to something that cannot
  // exist; match nothing rather than letting Postgres raise.
  if (options.projectId) {
    if (!isUuid(options.projectId)) return [];
    query = query.eq("project_id", options.projectId);
  }
  if (options.agentNames?.length) query = query.in("agent_name", options.agentNames);
  if (options.status) query = query.eq("status", options.status);
  // Keyset, not offset: stable under inserts and index-friendly as the table grows.
  if (options.before) query = query.lt("created_at", options.before);
  // `gte` not `gt`: a row updated in place keeps its created_at, so the live
  // tail must still see a pending → success flip at the boundary.
  if (options.since) query = query.gte("created_at", options.since);

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
