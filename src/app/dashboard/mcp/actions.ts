"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity";
import { safeMessage } from "@/lib/errors";
import { clearMcpToken, saveMcpToken } from "@/lib/mcp/credentials";
import { withMcpSession } from "@/lib/mcp/client";
import { isPermission } from "@/lib/mcp/tool-policy";
import { requireAdmin } from "@/lib/session";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

const PATH = "/dashboard/mcp";
const ACTOR = "CEO Console";
type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Every action re-checks that the project belongs to the signed-in owner. */
async function ownedProject(projectId: string, ownerId: string) {
  const { data } = await getServiceSupabase()
    .from("projects")
    .select("id, mcp_endpoint, mcp_protocol")
    .eq("id", projectId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  return data;
}

async function audit(projectId: string, toolName: string, payload: Json) {
  await logActivity({ projectId, agentName: ACTOR, toolName, payload, status: "success" }).catch(() => undefined);
}

/** Enable/disable, permission class and approval requirement for one registered tool. */
export async function setToolPolicyAction(toolId: string, input: { enabled: boolean; permission: string; requiresApproval: boolean }): Promise<Result> {
  const session = await requireAdmin();
  if (!isPermission(input.permission)) return fail("Unknown permission class.");
  const supabase = getServiceSupabase();
  const { data: tool } = await supabase.from("project_tools").select("id, project_id, tool_name").eq("id", toolId).maybeSingle();
  if (!tool || !(await ownedProject(tool.project_id, session.user.id))) return fail("Tool not found.");

  const { error } = await supabase
    .from("project_tools")
    .update({ enabled: input.enabled, permission: input.permission, requires_approval: input.requiresApproval })
    .eq("id", toolId);
  if (error) return fail(safeMessage("Updating the tool policy", error));
  await audit(tool.project_id, "mcp.tool_policy", { tool_name: tool.tool_name, enabled: input.enabled, permission: input.permission, requires_approval: input.requiresApproval });
  revalidatePath(PATH);
  return { ok: true };
}

export async function setServerProtocolAction(projectId: string, protocol: string): Promise<Result> {
  const session = await requireAdmin();
  if (protocol !== "hq" && protocol !== "mcp") return fail("Unknown protocol.");
  if (!(await ownedProject(projectId, session.user.id))) return fail("Server not found.");
  const { error } = await getServiceSupabase().from("projects").update({ mcp_protocol: protocol }).eq("id", projectId);
  if (error) return fail(safeMessage("Updating the server", error));
  await audit(projectId, "mcp.protocol", { protocol });
  revalidatePath(PATH);
  return { ok: true };
}

/** Stores (or, with an empty value, removes) the bearer token. The value is never returned. */
export async function saveServerTokenAction(projectId: string, token: string): Promise<Result> {
  const session = await requireAdmin();
  if (!(await ownedProject(projectId, session.user.id))) return fail("Server not found.");
  const value = token.trim();
  try {
    if (value) {
      if (value.length > 2000 || /\s/.test(value)) return fail("That does not look like a bearer token.");
      await saveMcpToken(projectId, session.user.id, value);
    } else {
      await clearMcpToken(projectId);
    }
  } catch (e) {
    return fail(safeMessage("Saving the credential", e));
  }
  await audit(projectId, "mcp.credential", { action: value ? "set" : "cleared" });
  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Lists the tools a standard MCP server offers and registers the new ones as
 * DISABLED, 'write' class, approval required — the owner reviews each before
 * it can run. Existing tools are left untouched.
 */
export async function discoverToolsAction(projectId: string): Promise<Result<{ found: number; added: number }>> {
  const session = await requireAdmin();
  const project = await ownedProject(projectId, session.user.id);
  if (!project) return fail("Server not found.");
  if (project.mcp_protocol !== "mcp") return fail("Discovery needs the server protocol set to “MCP”.");
  if (!project.mcp_endpoint) return fail("Set the server endpoint on the project first.");

  try {
    const { loadMcpToken } = await import("@/lib/mcp/credentials");
    const token = await loadMcpToken(projectId);
    const tools = await withMcpSession(project.mcp_endpoint, token, (s) => s.listTools());
    const supabase = getServiceSupabase();
    const { data: existing } = await supabase.from("project_tools").select("tool_name").eq("project_id", projectId);
    const have = new Set((existing ?? []).map((t: { tool_name: string }) => t.tool_name));
    const fresh = tools.filter((t) => t.name.length > 0 && t.name.length <= 200 && !have.has(t.name));
    if (fresh.length > 0) {
      const { error } = await supabase.from("project_tools").insert(
        fresh.map((t) => ({
          project_id: projectId,
          tool_name: t.name,
          description: t.description ? t.description.slice(0, 500) : null,
          input_schema: (t.inputSchema ?? null) as Json,
          enabled: false,
          permission: "write",
          requires_approval: true,
        })),
      );
      if (error) return fail(safeMessage("Saving the discovered tools", error));
    }
    await audit(projectId, "mcp.discover", { found: tools.length, added: fresh.length });
    revalidatePath(PATH);
    return { ok: true, found: tools.length, added: fresh.length };
  } catch (e) {
    return fail(e instanceof Error && e.name !== "Error" ? e.message : e instanceof Error ? e.message.slice(0, 300) : "Discovery failed.");
  }
}
