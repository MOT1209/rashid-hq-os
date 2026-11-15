"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity";
import { safeMessage } from "@/lib/errors";
import { requireAdmin } from "@/lib/session";
import { getServiceSupabase } from "@/lib/supabase/server";
import { isStatus, neighbour, validateProjectMeta, validateTask, type TaskStatus } from "@/lib/tasks";
import { createTask, deleteTask, getTask, ownsProject, reorder, setStatus, updateTask } from "@/lib/tasks-store";

const ACTOR = "CEO Console";
type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const refresh = (projectId: string) => { revalidatePath(`/dashboard/projects/${projectId}`); revalidatePath("/dashboard/projects"); };
const audit = (projectId: string, tool: string, payload: Record<string, string | number | boolean | null>) =>
  logActivity({ projectId, agentName: ACTOR, toolName: tool, payload, status: "success" }).catch(() => undefined);

export async function createTaskAction(projectId: string, input: unknown, status: string = "todo"): Promise<Result<{ id: string }>> {
  const session = await requireAdmin();
  if (!isStatus(status)) return fail("Unknown column.");
  if (!(await ownsProject(projectId, session.user.id))) return fail("Project not found.");
  const v = validateTask(input);
  if (!v.ok) return fail(v.errors.join(" "));
  try {
    const t = await createTask(session.user.id, projectId, v.value, status as TaskStatus);
    await audit(projectId, "create_task", { task_id: t.id, title: t.title });
    refresh(projectId);
    return { ok: true, id: t.id };
  } catch (e) {
    return fail(safeMessage("Saving the task", e));
  }
}

export async function updateTaskAction(taskId: string, input: unknown): Promise<Result> {
  const session = await requireAdmin();
  const task = await getTask(session.user.id, taskId);
  if (!task) return fail("Task not found.");
  const v = validateTask(input);
  if (!v.ok) return fail(v.errors.join(" "));
  try {
    if (!(await updateTask(session.user.id, taskId, v.value))) return fail("Task not found.");
    await audit(task.project_id, "update_task", { task_id: taskId });
    refresh(task.project_id);
    return { ok: true };
  } catch (e) {
    return fail(safeMessage("Updating the task", e));
  }
}

/** Move one column left/right (dir) or straight to a status. */
export async function moveTaskAction(taskId: string, to: { dir: -1 | 1 } | { status: string }): Promise<Result> {
  const session = await requireAdmin();
  const task = await getTask(session.user.id, taskId);
  if (!task) return fail("Task not found.");
  const target = "dir" in to ? neighbour(task.status, to.dir) : isStatus(to.status) ? to.status : null;
  if (!target) return fail("Cannot move the task there.");
  try {
    await setStatus(session.user.id, taskId, target);
    await audit(task.project_id, "move_task", { task_id: taskId, from: task.status, to: target });
    refresh(task.project_id);
    return { ok: true };
  } catch (e) {
    return fail(safeMessage("Moving the task", e));
  }
}

export async function reorderTaskAction(taskId: string, dir: -1 | 1): Promise<Result> {
  const session = await requireAdmin();
  const task = await getTask(session.user.id, taskId);
  if (!task) return fail("Task not found.");
  try {
    await reorder(session.user.id, taskId, dir);
    refresh(task.project_id);
    return { ok: true };
  } catch (e) {
    return fail(safeMessage("Reordering the task", e));
  }
}

export async function deleteTaskAction(taskId: string): Promise<Result> {
  const session = await requireAdmin();
  const task = await getTask(session.user.id, taskId);
  if (!task) return fail("Task not found.");
  try {
    await deleteTask(session.user.id, taskId);
    await audit(task.project_id, "delete_task", { task_id: taskId, title: task.title });
    refresh(task.project_id);
    return { ok: true };
  } catch (e) {
    return fail(safeMessage("Deleting the task", e));
  }
}

/** Priority, description and documentation of a project. Name/endpoint/status stay with the existing edit form. */
export async function saveProjectMetaAction(projectId: string, input: unknown): Promise<Result> {
  const session = await requireAdmin();
  if (!(await ownsProject(projectId, session.user.id))) return fail("Project not found.");
  const v = validateProjectMeta(input);
  if (!v.ok) return fail(v.errors.join(" "));
  const { error } = await getServiceSupabase().from("projects").update(v.value).eq("id", projectId).eq("owner_id", session.user.id);
  if (error) return fail(safeMessage("Saving the project", error));
  await audit(projectId, "update_project_meta", { priority: v.value.priority });
  refresh(projectId);
  return { ok: true };
}

/** Archive hides the project from default lists and counts; all data, tools and history are kept. */
export async function setProjectArchivedAction(projectId: string, archived: boolean): Promise<Result> {
  const session = await requireAdmin();
  if (!(await ownsProject(projectId, session.user.id))) return fail("Project not found.");
  const { error } = await getServiceSupabase().from("projects").update({ archived_at: archived ? new Date().toISOString() : null }).eq("id", projectId).eq("owner_id", session.user.id);
  if (error) return fail(safeMessage("Updating the project", error));
  await audit(projectId, archived ? "archive_project" : "unarchive_project", {});
  refresh(projectId);
  revalidatePath("/dashboard");
  return { ok: true };
}
