"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { logActivity } from "@/lib/activity";
import { ALLOWED_TOOLS, runDueAutomations } from "@/lib/automation/runtime";
import { validateDefinition } from "@/lib/automation/definition";
import {
  ConflictError, RateLimitError, cancelRun, createAutomation, deleteAutomation, enqueueRun, getAutomation, setEnabled, updateAutomation,
} from "@/lib/automation/store";
import { safeMessage } from "@/lib/errors";
import { fetchDepartments } from "@/lib/queries";
import { requireAdmin } from "@/lib/session";
import type { Json } from "@/types/database";

const PATH = "/dashboard/automations";
const ACTOR = "CEO Console";
type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const audit = (tool: string, payload: Json) => logActivity({ agentName: ACTOR, toolName: tool, payload, status: "success" }).catch(() => undefined);

export async function saveAutomationAction(input: { id?: string; expectedVersion?: number; definition: unknown }): Promise<Result<{ id: string; warnings: string[] }>> {
  const session = await requireAdmin();
  const departments = (await fetchDepartments()).map((d) => d.key);
  const v = validateDefinition(input.definition, { allowedTools: ALLOWED_TOOLS, knownDepartments: departments });
  if (!v.ok) return fail(v.errors.join(" "));
  try {
    const row = input.id
      ? await updateAutomation(session.user.id, input.id, v.value, input.expectedVersion ?? -1)
      : await createAutomation(session.user.id, v.value);
    await audit(input.id ? "update_automation" : "create_automation", { automation_id: row.id, name: row.name });
    revalidatePath(PATH);
    return { ok: true, id: row.id, warnings: v.warnings };
  } catch (e) {
    if (e instanceof ConflictError) return fail(e.message);
    if (e instanceof Error && e.message === "Automation not found.") return fail(e.message);
    return fail(safeMessage("Saving the automation", e));
  }
}

/** Resume (true) or pause (false). New automations start paused. */
export async function setAutomationEnabledAction(id: string, enabled: boolean): Promise<Result> {
  const session = await requireAdmin();
  try {
    if (!(await setEnabled(session.user.id, id, enabled))) return fail("Automation not found.");
  } catch (e) {
    return fail(safeMessage("Updating the automation", e));
  }
  await audit(enabled ? "resume_automation" : "pause_automation", { automation_id: id });
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteAutomationAction(id: string): Promise<Result> {
  const session = await requireAdmin();
  try {
    if (!(await deleteAutomation(session.user.id, id))) return fail("Automation not found.");
  } catch (e) {
    return fail(safeMessage("Deleting the automation", e));
  }
  await audit("delete_automation", { automation_id: id });
  revalidatePath(PATH);
  return { ok: true };
}

/** Manual trigger. Runs in the background after the response; progress shows in the history. */
export async function runAutomationNowAction(id: string): Promise<Result<{ runId: string }>> {
  const session = await requireAdmin();
  const a = await getAutomation(session.user.id, id);
  if (!a) return fail("Automation not found.");
  try {
    const runId = await enqueueRun(a, "manual", { triggered_by: "owner" }, null);
    if (!runId) return fail("Could not queue the run.");
    await audit("run_automation", { automation_id: id, run_id: runId });
    after(() => runDueAutomations(1).catch(() => undefined));
    revalidatePath(PATH);
    return { ok: true, runId };
  } catch (e) {
    if (e instanceof RateLimitError) return fail(e.message);
    return fail(safeMessage("Queueing the run", e));
  }
}

export async function cancelRunAction(runId: string): Promise<Result> {
  const session = await requireAdmin();
  try {
    if (!(await cancelRun(session.user.id, runId))) return fail("Only queued runs can be cancelled.");
  } catch (e) {
    return fail(safeMessage("Cancelling the run", e));
  }
  revalidatePath(PATH);
  return { ok: true };
}
