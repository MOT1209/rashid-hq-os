import "server-only";

import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { getServiceSupabase } from "@/lib/supabase/server";
import { assertSafeEndpoint, pinnedDispatcher } from "@/lib/net/safe-endpoint";
import { dbError } from "@/lib/errors";
import type { Json } from "@/types/database";

export type Scope = "read" | "write";

export type ToolContext = {
  /** Who is calling — an agent name from agent_tokens, or the CEO console. */
  agentName: string;
  /** When set, the caller is pinned to a single project. */
  projectId?: string | null;
  /** Scopes carried by the token. The CEO console passes both. */
  scopes?: string[];
  /**
   * The owner this call acts on behalf of — the user who issued the token, or
   * the signed-in owner for the console. Every dashboard mutation is scoped by
   * projects.owner_id, so anything created here must carry it or it becomes
   * un-editable and un-deletable from the UI.
   */
  ownerId?: string | null;
  /**
   * How many delegations deep this call already is. The console starts at 0; a
   * department agent runs at 1 and `delegate_to_department` refuses from there.
   *
   * Without this an agent could delegate to an agent that delegates again,
   * with no natural stopping point — a loop that burns model credit rather
   * than failing loudly.
   */
  delegationDepth?: number;
};

export type ToolDefinition = {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  /** Least privilege a caller needs. Enforced in src/app/api/mcp/route.ts. */
  requiredScope: Scope;
  execute: (args: never, ctx: ToolContext) => Promise<Json>;
};

function scopeError(): never {
  throw new Error("This token is scoped to a different project.");
}

/**
 * Every mutation below is scoped by projects.owner_id, mirroring
 * assertOwnsProject in src/app/actions.ts. A null/undefined ownerId (a token
 * that predates created_by, or a caller that never carried one) fails closed
 * rather than matching every row with a null owner_id.
 */
async function ownsProject(
  supabase: ReturnType<typeof getServiceSupabase>,
  projectId: string,
  ownerId: string | null | undefined,
): Promise<boolean> {
  if (!ownerId) return false;
  const { data } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  return Boolean(data);
}

/**
 * Whether a caller's scopes permit a tool. Pure and exported so the
 * authorization boundary can be tested directly rather than only through a
 * live request — a token with no scopes, or an unknown scope, must be refused.
 */
export function scopeDenialReason(
  tool: Pick<ToolDefinition, "name" | "requiredScope">,
  scopes: string[] | undefined,
): string | null {
  if (!scopes?.includes(tool.requiredScope)) {
    return `This token lacks the "${tool.requiredScope}" scope required by ${tool.name}.`;
  }
  return null;
}

/** Remote tool responses are logged and echoed back; keep them bounded. */
const MAX_REMOTE_BODY = 100_000;

/** Maximum size of the input payload we will forward to a remote endpoint. */
const MAX_INPUT_PAYLOAD = 10_240;

/**
 * Identifies the caller to the project's own MCP server.
 *
 * call_project_tool used to send nothing but a content-type, so a receiving
 * server had no way to distinguish a genuine call from anyone who found the
 * URL. With OUTBOUND_SIGNING_SECRET set, every request carries an HMAC of the
 * exact body; the receiver recomputes it with the shared secret. The timestamp
 * is inside the signed body, so a replay is detectable.
 *
 * Unset means unsigned, as before — this is opt-in so existing endpoints that
 * do not verify anything keep working.
 */
function outboundAuthHeaders(body: string): Record<string, string> {
  const secret = process.env.OUTBOUND_SIGNING_SECRET;
  if (!secret) return { "x-hq-source": "alking-hq" };

  return {
    "x-hq-source": "alking-hq",
    "x-hq-signature": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
  };
}

const listProjects = {
  name: "list_projects",
  description:
    "List every project in the Alking Enterprises registry, optionally filtered by category or status.",
  requiredScope: "read" as const,
  schema: z.object({
    category: z.string().nullish(),
    status: z.enum(["active", "idle", "maintenance"]).nullish(),
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
    if (error) throw dbError("list_projects", error);
    return { projects: data ?? [] } as Json;
  },
};

const getProject = {
  name: "get_project",
  description: "Fetch one project with the custom MCP tools registered against it.",
  requiredScope: "read" as const,
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

    if (error) throw dbError("get_project", error);
    if (!project) throw new Error("Project not found.");
    return { project, tools: tools ?? [] } as Json;
  },
};

const registerProject = {
  name: "register_project",
  description:
    "Register a new project in the enterprise registry so it appears on the CEO dashboard.",
  requiredScope: "write" as const,
  schema: z.object({
    name: z.string().min(1).max(200),
    category: z.string().max(100).nullish(),
    url: z.string().url().nullish(),
    repository_url: z.string().url().nullish(),
    mcp_endpoint: z.string().url().nullish(),
    status: z.enum(["active", "idle", "maintenance"]).nullish().transform((v) => v ?? "active"),
  }),
  async execute(args: Record<string, string>, ctx: ToolContext) {
    // A project-scoped token must not be able to mint new, unscoped projects
    // (which would also be new outbound endpoints for call_project_tool).
    if (ctx.projectId) scopeError();
    // Validated before storage so the endpoint can never become an SSRF target.
    if (args.mcp_endpoint) await assertSafeEndpoint(args.mcp_endpoint);

    const { data, error } = await getServiceSupabase()
      .from("projects")
      .insert({
        name: args.name,
        category: args.category ?? null,
        url: args.url ?? null,
        repository_url: args.repository_url ?? null,
        mcp_endpoint: args.mcp_endpoint ?? null,
        status: (args.status ?? "active") as "active",
        owner_id: ctx.ownerId ?? null,
      })
      .select()
      .single();

    if (error) throw dbError("register_project", error);
    return { project: data } as Json;
  },
};

const updateProject = {
  name: "update_project",
  description: "Update an existing project's name, category, links, endpoint or status.",
  requiredScope: "write" as const,
  schema: z.object({
    project_id: z.string().uuid(),
    name: z.string().min(1).max(200),
    category: z.string().max(100).nullish(),
    url: z.string().url().nullish(),
    repository_url: z.string().url().nullish(),
    mcp_endpoint: z.string().url().nullish(),
    status: z.enum(["active", "idle", "maintenance"]).nullish().transform((v) => v ?? "active"),
  }),
  async execute(
    args: {
      project_id: string;
      name: string;
      category?: string;
      url?: string;
      repository_url?: string;
      mcp_endpoint?: string;
      status?: "active" | "idle" | "maintenance";
    },
    ctx: ToolContext,
  ) {
    if (ctx.projectId && ctx.projectId !== args.project_id) scopeError();
    const supabase = getServiceSupabase();
    if (!(await ownsProject(supabase, args.project_id, ctx.ownerId))) {
      throw new Error("Project not found.");
    }
    // Validated before storage, same as register_project.
    if (args.mcp_endpoint) await assertSafeEndpoint(args.mcp_endpoint);

    const { data, error } = await supabase
      .from("projects")
      .update({
        name: args.name,
        category: args.category ?? null,
        url: args.url ?? null,
        repository_url: args.repository_url ?? null,
        mcp_endpoint: args.mcp_endpoint ?? null,
        status: (args.status ?? "active") as "active",
      })
      .eq("id", args.project_id)
      .eq("owner_id", ctx.ownerId ?? "")
      .select()
      .single();

    if (error) throw dbError("update_project", error);
    return { project: data } as Json;
  },
};

const deleteProject = {
  name: "delete_project",
  description:
    "Delete a project. Cascades to its registered tools, live agent tokens and activity logs.",
  requiredScope: "write" as const,
  schema: z.object({ project_id: z.string().uuid() }),
  async execute(args: { project_id: string }, ctx: ToolContext) {
    if (ctx.projectId && ctx.projectId !== args.project_id) scopeError();
    const supabase = getServiceSupabase();

    // `count` distinguishes "not yours / not there" from a real delete —
    // without it a no-op would report success.
    const { error, count } = await supabase
      .from("projects")
      .delete({ count: "exact" })
      .eq("id", args.project_id)
      .eq("owner_id", ctx.ownerId ?? "");

    if (error) throw dbError("delete_project", error);
    if (!count) throw new Error("Project not found.");
    return { deleted_project_id: args.project_id } as Json;
  },
};

const addProjectTool = {
  name: "add_project_tool",
  description: "Register a new custom MCP tool endpoint on a project.",
  requiredScope: "write" as const,
  schema: z.object({
    project_id: z.string().uuid(),
    tool_name: z.string().min(1).max(200),
    description: z.string().max(500).nullish(),
    endpoint: z.string().url().nullish(),
  }),
  async execute(
    args: {
      project_id: string;
      tool_name: string;
      description?: string;
      endpoint?: string;
    },
    ctx: ToolContext,
  ) {
    if (ctx.projectId && ctx.projectId !== args.project_id) scopeError();
    const supabase = getServiceSupabase();
    if (!(await ownsProject(supabase, args.project_id, ctx.ownerId))) {
      throw new Error("Project not found.");
    }
    // This is what call_project_tool ends up POSTing to, so it is validated
    // before it is ever stored.
    if (args.endpoint) await assertSafeEndpoint(args.endpoint);

    const { data, error } = await supabase
      .from("project_tools")
      .insert({
        project_id: args.project_id,
        tool_name: args.tool_name,
        description: args.description ?? null,
        endpoint: args.endpoint ?? null,
      })
      .select()
      .single();

    if (error) throw dbError("add_project_tool", error);
    return { tool: data } as Json;
  },
};

const updateProjectTool = {
  name: "update_project_tool",
  description: "Update a project's registered tool (name, description or endpoint).",
  requiredScope: "write" as const,
  schema: z.object({
    tool_id: z.string().uuid(),
    tool_name: z.string().min(1).max(200),
    description: z.string().max(500).nullish(),
    endpoint: z.string().url().nullish(),
  }),
  async execute(
    args: { tool_id: string; tool_name: string; description?: string; endpoint?: string },
    ctx: ToolContext,
  ) {
    const supabase = getServiceSupabase();
    const { data: existing } = await supabase
      .from("project_tools")
      .select("project_id")
      .eq("id", args.tool_id)
      .maybeSingle();
    if (!existing) throw new Error("Tool not found.");
    if (ctx.projectId && ctx.projectId !== existing.project_id) scopeError();
    if (!(await ownsProject(supabase, existing.project_id, ctx.ownerId))) {
      throw new Error("Tool not found.");
    }
    if (args.endpoint) await assertSafeEndpoint(args.endpoint);

    const { data, error } = await supabase
      .from("project_tools")
      .update({
        tool_name: args.tool_name,
        description: args.description ?? null,
        endpoint: args.endpoint ?? null,
      })
      .eq("id", args.tool_id)
      .select()
      .single();

    if (error) throw dbError("update_project_tool", error);
    return { tool: data } as Json;
  },
};

const deleteProjectTool = {
  name: "delete_project_tool",
  description: "Delete a project's registered tool.",
  requiredScope: "write" as const,
  schema: z.object({ tool_id: z.string().uuid() }),
  async execute(args: { tool_id: string }, ctx: ToolContext) {
    const supabase = getServiceSupabase();
    const { data: existing } = await supabase
      .from("project_tools")
      .select("project_id, tool_name")
      .eq("id", args.tool_id)
      .maybeSingle();
    if (!existing) throw new Error("Tool not found.");
    if (ctx.projectId && ctx.projectId !== existing.project_id) scopeError();
    if (!(await ownsProject(supabase, existing.project_id, ctx.ownerId))) {
      throw new Error("Tool not found.");
    }

    const { error } = await supabase.from("project_tools").delete().eq("id", args.tool_id);
    if (error) throw dbError("delete_project_tool", error);
    return { deleted_tool_id: args.tool_id, tool_name: existing.tool_name } as Json;
  },
};

const listCategories = {
  name: "list_categories",
  description: "List the project categories configured for this console.",
  requiredScope: "read" as const,
  schema: z.object({}),
  async execute() {
    const { data, error } = await getServiceSupabase()
      .from("project_categories")
      .select("*")
      .order("sort_order");
    if (error) throw dbError("list_categories", error);
    return { categories: data ?? [] } as Json;
  },
};

const listDepartments = {
  name: "list_departments",
  description:
    "List the departments and their agents. Use this to find the department_key to delegate to.",
  requiredScope: "read" as const,
  schema: z.object({}),
  async execute() {
    const { data, error } = await getServiceSupabase()
      .from("departments")
      // Not select("*"): system_prompt is another agent's instructions, and
      // feeding it to this one invites it to imitate rather than delegate.
      .select("key, name_ar, name_en, agent_name, icon, is_fallback")
      .order("sort_order");
    if (error) throw dbError("list_departments", error);
    return { departments: data ?? [] } as Json;
  },
};

const listSkills = {
  name: "list_skills",
  description: "List saved command templates (skills) configured for this console.",
  requiredScope: "read" as const,
  schema: z.object({}),
  async execute() {
    const { data, error } = await getServiceSupabase()
      .from("agent_skills")
      .select("id, name, description, prompt, created_at")
      .order("created_at", { ascending: false });
    if (error) throw dbError("list_skills", error);
    return { skills: data ?? [] } as Json;
  },
};

const getSkill = {
  name: "get_skill",
  description: "Fetch one saved command template (skill) by id.",
  requiredScope: "read" as const,
  schema: z.object({ skill_id: z.string().uuid() }),
  async execute(args: { skill_id: string }) {
    const { data, error } = await getServiceSupabase()
      .from("agent_skills")
      .select("id, name, description, prompt, created_at")
      .eq("id", args.skill_id)
      .maybeSingle();
    if (error) throw dbError("get_skill", error);
    if (!data) throw new Error("Skill not found.");
    return { skill: data } as Json;
  },
};

const listRecentLogs = {
  name: "list_recent_logs",
  description: "Read the most recent agent activity, newest first.",
  requiredScope: "read" as const,
  schema: z.object({
    project_id: z.string().uuid().nullish(),
    agent_name: z.string().nullish(),
    limit: z.number().int().min(1).max(100).nullish().transform((v) => v ?? 20),
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
    if (error) throw dbError("list_recent_logs", error);
    return { logs: data ?? [] } as Json;
  },
};

const callProjectTool = {
  name: "call_project_tool",
  description:
    "Invoke a custom tool registered on a project, proxied to that project's own MCP endpoint.",
  requiredScope: "write" as const,
  schema: z.object({
    project_id: z.string().uuid(),
    tool_name: z.string().max(200),
    input: z.record(z.string(), z.unknown()).nullish().transform((v) => v ?? {}),
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

    // Last line of defence: endpoints are validated on write, but a row could
    // predate that check or be edited out of band.
    const safeUrl = await assertSafeEndpoint(endpoint);

    // assertSafeEndpoint just vetted this host and cached the address it
    // resolved to. If pinnedDispatcher can't produce that pin now (a DNS name
    // whose vetted entry is somehow missing or stale), connecting anyway would
    // let fetch re-resolve — the exact DNS-rebinding window the pin closes.
    // A literal IP legitimately returns undefined and is safe to connect to.
    const dispatcher = pinnedDispatcher(safeUrl);
    if (!dispatcher && !isIP(safeUrl.hostname.replace(/^\[|\]$/g, ""))) {
      throw new Error("Endpoint could not be pinned; refusing to connect.");
    }

    // Bound the input payload before it hits the wire — unbounded JSON would
    // be forwarded as-is and logged to agent_logs (truncated to 32 KB there,
    // but the outbound request itself is not capped without this check).
    const inputPayload = JSON.stringify(args.input ?? {});
    if (inputPayload.length > MAX_INPUT_PAYLOAD) {
      throw new Error(
        `Input payload (${inputPayload.length} bytes) exceeds the ${MAX_INPUT_PAYLOAD}-byte limit.`,
      );
    }

    const requestBody = JSON.stringify({
      tool: args.tool_name,
      input: args.input ?? {},
      // Lets the receiver tie the call to a project and reject replays.
      project_id: args.project_id,
      issued_at: new Date().toISOString(),
    });

    const response = await fetch(safeUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Until now the receiving server had no way to tell a call from HQ
        // apart from any other request that found the URL.
        ...outboundAuthHeaders(requestBody),
      },
      body: requestBody,
      // A followed redirect would walk straight past assertSafeEndpoint.
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
      // Connect to the address the guard actually vetted, so a name that
      // changes answers between the check and the request cannot be used to
      // reach an internal host. TLS still validates against the hostname.
      dispatcher,
    } as RequestInit & { dispatcher?: unknown });

    if (response.status >= 300 && response.status < 400) {
      throw new Error("Remote tool attempted a redirect, which is not allowed.");
    }

    const text = (await response.text()).slice(0, MAX_REMOTE_BODY);
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Remote returned plain text; keep it as-is.
    }

    if (!response.ok) {
      console.error(
        `[mcp] call_project_tool ${args.tool_name} -> ${response.status}: ${text.slice(0, 300)}`,
      );
      throw new Error(`Remote tool failed with status ${response.status}.`);
    }
    return { endpoint: safeUrl.toString(), status: response.status, response: body } as Json;
  },
};

/** Long enough for a real brief, short enough not to become the whole prompt. */
const MAX_TASK_LENGTH = 2_000;

const delegateToDepartment = {
  name: "delegate_to_department",
  description:
    "Hand a task to a department's agent. It runs with the same tools under that department's own instructions and reports back. Use it for work that belongs to one department rather than doing it yourself.",
  requiredScope: "write" as const,
  schema: z.object({
    department_key: z
      .string()
      .describe("The department key, e.g. dev, store, media. Use list_departments values."),
    task: z
      .string()
      .max(MAX_TASK_LENGTH)
      .describe("What the department agent should do, stated plainly and completely."),
  }),
  async execute(args: { department_key: string; task: string }, ctx: ToolContext) {
    // A delegated agent must not delegate again: there is no natural stopping
    // point, so the loop would burn model credit instead of failing loudly.
    if ((ctx.delegationDepth ?? 0) >= 1) {
      throw new Error(
        "Delegation is one level deep. Do this work yourself with the tools you already have.",
      );
    }

    const { data, error } = await getServiceSupabase()
      .from("departments")
      .select("*")
      .eq("key", args.department_key)
      .maybeSingle();

    if (error) throw dbError("delegate_to_department", error);
    if (!data) throw new Error(`No department with key "${args.department_key}".`);

    // Imported here rather than at module scope: the runtime imports TOOLS from
    // this file, so a static import would be a cycle.
    const { runDepartmentAgent } = await import("@/lib/department-agent");
    const run = await runDepartmentAgent({
      department: data as never,
      task: args.task,
      ownerId: ctx.ownerId,
      // Delegated from the console: a human is watching the result, so the
      // department agent keeps the full toolset. The autonomous cron path
      // (src/app/api/agent/standing-tasks) passes "autonomous" instead.
      mode: "interactive",
    });
    return run as unknown as Json;
  },
};

export const TOOLS: ToolDefinition[] = [
  listProjects,
  getProject,
  registerProject,
  updateProject,
  deleteProject,
  addProjectTool,
  updateProjectTool,
  deleteProjectTool,
  listCategories,
  listDepartments,
  listSkills,
  getSkill,
  listRecentLogs,
  callProjectTool,
  delegateToDepartment,
] as unknown as ToolDefinition[];

export function findTool(name: string) {
  return TOOLS.find((t) => t.name === name);
}
