import "server-only";

import { z } from "zod";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

export type ToolContext = {
  /** Who is calling — an agent name from agent_tokens, or the CEO console. */
  agentName: string;
  /** When set, the caller is pinned to a single project. */
  projectId?: string | null;
};

export type ToolDefinition = {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  execute: (args: never, ctx: ToolContext) => Promise<Json>;
};

function scopeError(): never {
  throw new Error("This token is scoped to a different project.");
}

const listProjects = {
  name: "list_projects",
  description:
    "List every project in the Alking Enterprises registry, optionally filtered by category or status.",
  schema: z.object({
    category: z.string().optional(),
    status: z.enum(["active", "idle", "maintenance"]).optional(),
  }),
  async execute(args: { category?: string; status?: string }, ctx: ToolContext) {
    let query = getServiceSupabase()
      .from("projects")
      .select("id, name, category, url, repository_url, mcp_endpoint, status, created_at")
      .order("created_at", { ascending: false });

    if (args.category) query = query.eq("category", args.category);
    if (args.status) query = query.eq("status", args.status);
    if (ctx.projectId) query = query.eq("id", ctx.projectId);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return { projects: data ?? [] } as Json;
  },
};

const getProject = {
  name: "get_project",
  description: "Fetch one project with the custom MCP tools registered against it.",
  schema: z.object({ project_id: z.string().uuid() }),
  async execute(args: { project_id: string }, ctx: ToolContext) {
    if (ctx.projectId && ctx.projectId !== args.project_id) scopeError();
    const supabase = getServiceSupabase();

    const [{ data: project, error }, { data: tools }] = await Promise.all([
      supabase.from("projects").select("*").eq("id", args.project_id).maybeSingle(),
      supabase
        .from("project_tools")
        .select("tool_name, description, input_schema, endpoint")
        .eq("project_id", args.project_id),
    ]);

    if (error) throw new Error(error.message);
    if (!project) throw new Error("Project not found.");
    return { project, tools: tools ?? [] } as Json;
  },
};

const registerProject = {
  name: "register_project",
  description:
    "Register a new project in the enterprise registry so it appears on the CEO dashboard.",
  schema: z.object({
    name: z.string().min(1),
    category: z.string().optional(),
    url: z.string().url().optional(),
    repository_url: z.string().url().optional(),
    mcp_endpoint: z.string().url().optional(),
    status: z.enum(["active", "idle", "maintenance"]).default("active"),
  }),
  async execute(args: Record<string, string>) {
    const { data, error } = await getServiceSupabase()
      .from("projects")
      .insert({
        name: args.name,
        category: args.category ?? null,
        url: args.url ?? null,
        repository_url: args.repository_url ?? null,
        mcp_endpoint: args.mcp_endpoint ?? null,
        status: (args.status ?? "active") as "active",
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return { project: data } as Json;
  },
};

const listRecentLogs = {
  name: "list_recent_logs",
  description: "Read the most recent agent activity, newest first.",
  schema: z.object({
    project_id: z.string().uuid().optional(),
    agent_name: z.string().optional(),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  async execute(
    args: { project_id?: string; agent_name?: string; limit?: number },
    ctx: ToolContext,
  ) {
    let query = getServiceSupabase()
      .from("agent_logs")
      .select("id, project_id, agent_name, tool_name, status, created_at, result")
      .order("created_at", { ascending: false })
      .limit(args.limit ?? 20);

    const projectId = ctx.projectId ?? args.project_id;
    if (projectId) query = query.eq("project_id", projectId);
    if (args.agent_name) query = query.eq("agent_name", args.agent_name);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return { logs: data ?? [] } as Json;
  },
};

const callProjectTool = {
  name: "call_project_tool",
  description:
    "Invoke a custom tool registered on a project, proxied to that project's own MCP endpoint.",
  schema: z.object({
    project_id: z.string().uuid(),
    tool_name: z.string(),
    input: z.record(z.string(), z.unknown()).default({}),
  }),
  async execute(
    args: { project_id: string; tool_name: string; input?: Record<string, unknown> },
    ctx: ToolContext,
  ) {
    if (ctx.projectId && ctx.projectId !== args.project_id) scopeError();
    const supabase = getServiceSupabase();

    const { data: tool } = await supabase
      .from("project_tools")
      .select("endpoint")
      .eq("project_id", args.project_id)
      .eq("tool_name", args.tool_name)
      .maybeSingle();

    const { data: project } = await supabase
      .from("projects")
      .select("mcp_endpoint, name")
      .eq("id", args.project_id)
      .maybeSingle();

    const endpoint = tool?.endpoint ?? project?.mcp_endpoint;
    if (!endpoint) {
      throw new Error(
        `No endpoint for "${args.tool_name}" — set one on the tool or on the project.`,
      );
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool: args.tool_name, input: args.input ?? {} }),
      signal: AbortSignal.timeout(30_000),
    });

    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Remote returned plain text; keep it as-is.
    }

    if (!response.ok) {
      throw new Error(`Remote tool failed (${response.status}): ${text.slice(0, 300)}`);
    }
    return { endpoint, response: body } as Json;
  },
};

export const TOOLS: ToolDefinition[] = [
  listProjects,
  getProject,
  registerProject,
  listRecentLogs,
  callProjectTool,
] as unknown as ToolDefinition[];

export function findTool(name: string) {
  return TOOLS.find((t) => t.name === name);
}
