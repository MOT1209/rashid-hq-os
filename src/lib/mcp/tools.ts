import "server-only";

import { createHmac } from "node:crypto";
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
    category: z.string().max(100).optional(),
    url: z.string().url().optional(),
    repository_url: z.string().url().optional(),
    mcp_endpoint: z.string().url().optional(),
    status: z.enum(["active", "idle", "maintenance"]).default("active"),
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

const listRecentLogs = {
  name: "list_recent_logs",
  description: "Read the most recent agent activity, newest first.",
  requiredScope: "read" as const,
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

    // Last line of defence: endpoints are validated on write, but a row could
    // predate that check or be edited out of band.
    const safeUrl = await assertSafeEndpoint(endpoint);

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
      dispatcher: pinnedDispatcher(safeUrl),
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
