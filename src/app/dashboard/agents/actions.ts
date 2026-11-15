"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity";
import { validateConfig, validateNewAgent } from "@/lib/agent-config";
import { createAgent, deleteCustomAgent, saveConfig } from "@/lib/agent-admin";
import { runDepartmentAgent } from "@/lib/department-agent";
import { safeMessage } from "@/lib/errors";
import { TOOLS } from "@/lib/mcp/tools";
import { fetchDepartments, fetchProjectOptions } from "@/lib/queries";
import { requireAdmin } from "@/lib/session";
import type { Json } from "@/types/database";

const PATH = "/dashboard/agents";
const ACTOR = "CEO Console";
type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const audit = (tool: string, payload: Json) => logActivity({ agentName: ACTOR, toolName: tool, payload, status: "success" }).catch(() => undefined);
const refresh = () => { revalidatePath(PATH); revalidatePath("/dashboard"); };

export async function createAgentAction(input: unknown): Promise<Result<{ key: string }>> {
  await requireAdmin();
  const existing = (await fetchDepartments()).map((d) => d.key);
  const v = validateNewAgent(input, existing);
  if (!v.ok) return fail(v.errors.join(" "));
  try {
    await createAgent(v.value);
  } catch (e) {
    return fail(safeMessage("Creating the agent", e));
  }
  await audit("create_agent", { key: v.value.key, name: v.value.agent_name });
  refresh();
  return { ok: true, key: v.value.key };
}

/** Enable/disable, read-only, tool allowlist (null = all) and project assignment for one agent. */
export async function saveAgentConfigAction(key: string, input: unknown): Promise<Result> {
  await requireAdmin();
  const agents = await fetchDepartments();
  if (!agents.some((d) => d.key === key)) return fail("Agent not found.");
  const projects = (await fetchProjectOptions()).map((p) => p.id);
  const v = validateConfig(input, TOOLS.map((t) => t.name), projects);
  if (!v.ok) return fail(v.errors.join(" "));
  try {
    await saveConfig(key, v.value);
  } catch (e) {
    return fail(e instanceof Error && e.message === "Agent not found." ? e.message : safeMessage("Saving the agent", e));
  }
  await audit("configure_agent", { key, enabled: v.value.enabled, read_only: v.value.read_only, tools: v.value.allowed_tools?.length ?? "all", projects: v.value.project_ids.length });
  refresh();
  return { ok: true };
}

/**
 * Self-test: a real model run with a fixed harmless brief and READ-ONLY tools
 * (forced, whatever the agent's own settings say). Counts against the agent's
 * token budget and appears in its run history like any other run.
 */
export async function testAgentAction(key: string): Promise<Result<{ summary: string; steps: number; durationMs: number }>> {
  const session = await requireAdmin();
  const dept = (await fetchDepartments()).find((d) => d.key === key);
  if (!dept) return fail("Agent not found.");
  const startedAt = Date.now();
  try {
    const run = await runDepartmentAgent({
      department: dept, ownerId: session.user.id, forceReadOnly: true,
      task: "Self-test. In two sentences: say which tools you can use, and call list_projects once to confirm you can read the registry. Do not change anything.",
    });
    await audit("test_agent", { key, ok: true });
    revalidatePath(PATH);
    return { ok: true, summary: run.summary.slice(0, 1200), steps: run.steps, durationMs: Date.now() - startedAt };
  } catch (e) {
    await audit("test_agent", { key, ok: false });
    revalidatePath(PATH);
    return fail(e instanceof Error ? e.message.slice(0, 300) : "The test run failed.");
  }
}

export async function deleteAgentAction(key: string): Promise<Result> {
  await requireAdmin();
  try {
    if (!(await deleteCustomAgent(key))) return fail("Only agents created here can be deleted (built-in departments cannot).");
  } catch (e) {
    return fail(safeMessage("Deleting the agent", e));
  }
  await audit("delete_agent", { key });
  refresh();
  return { ok: true };
}
