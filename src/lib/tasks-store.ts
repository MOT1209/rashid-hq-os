import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "@/lib/errors";
import { getServiceSupabase } from "@/lib/supabase/server";
import { nextPosition, swapTarget, type Priority, type TaskDraft, type TaskStatus } from "@/lib/tasks";

const db = () => getServiceSupabase() as unknown as SupabaseClient;

export type TaskRow = {
  id: string; project_id: string; owner_id: string; title: string; description: string; status: TaskStatus; priority: Priority;
  due_date: string | null; assignee: string | null; position: number; created_at: string; updated_at: string; completed_at: string | null;
};

/** The project must belong to this owner before any task of it is read or written. */
export async function ownsProject(projectId: string, ownerId: string): Promise<boolean> {
  const { data } = await db().from("projects").select("id").eq("id", projectId).eq("owner_id", ownerId).maybeSingle();
  return Boolean(data);
}

export async function listTasks(ownerId: string, projectId: string): Promise<TaskRow[]> {
  const { data, error } = await db().from("project_tasks").select("*").eq("owner_id", ownerId).eq("project_id", projectId).order("position").limit(500);
  if (error) throw dbError("Loading tasks", error);
  return (data ?? []) as TaskRow[];
}

/** done/total per project, for the projects list. */
export async function taskCounts(ownerId: string): Promise<Map<string, { total: number; done: number; overdue: number }>> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await db().from("project_tasks").select("project_id, status, due_date").eq("owner_id", ownerId).limit(5000);
  if (error) throw dbError("Loading task counts", error);
  const out = new Map<string, { total: number; done: number; overdue: number }>();
  for (const r of (data ?? []) as { project_id: string; status: string; due_date: string | null }[]) {
    const c = out.get(r.project_id) ?? { total: 0, done: 0, overdue: 0 };
    c.total += 1;
    if (r.status === "done") c.done += 1;
    else if (r.due_date && r.due_date < today) c.overdue += 1;
    out.set(r.project_id, c);
  }
  return out;
}

export async function createTask(ownerId: string, projectId: string, d: TaskDraft, status: TaskStatus = "todo"): Promise<TaskRow> {
  const existing = await listTasks(ownerId, projectId);
  const { data, error } = await db()
    .from("project_tasks")
    .insert({ ...d, project_id: projectId, owner_id: ownerId, status, position: nextPosition(existing, status), completed_at: status === "done" ? new Date().toISOString() : null })
    .select("*").single();
  if (error) throw dbError("Saving the task", error);
  return data as TaskRow;
}

export async function getTask(ownerId: string, id: string): Promise<TaskRow | null> {
  const { data, error } = await db().from("project_tasks").select("*").eq("owner_id", ownerId).eq("id", id).maybeSingle();
  if (error) throw dbError("Loading the task", error);
  return (data as TaskRow | null) ?? null;
}

export async function updateTask(ownerId: string, id: string, d: TaskDraft): Promise<boolean> {
  const { data, error } = await db().from("project_tasks").update({ ...d, updated_at: new Date().toISOString() }).eq("id", id).eq("owner_id", ownerId).select("id");
  if (error) throw dbError("Updating the task", error);
  return Boolean(data?.length);
}

/** Moves a task to another column (end of that column); completed_at tracks entry into/exit from 'done'. */
export async function setStatus(ownerId: string, id: string, status: TaskStatus): Promise<TaskRow | null> {
  const task = await getTask(ownerId, id);
  if (!task) return null;
  if (task.status === status) return task;
  const siblings = await listTasks(ownerId, task.project_id);
  const { data, error } = await db()
    .from("project_tasks")
    .update({ status, position: nextPosition(siblings, status), updated_at: new Date().toISOString(), completed_at: status === "done" ? new Date().toISOString() : null })
    .eq("id", id).eq("owner_id", ownerId).select("*").maybeSingle();
  if (error) throw dbError("Moving the task", error);
  return (data as TaskRow | null) ?? null;
}

/** Swaps positions with the neighbour above/below inside the same column. */
export async function reorder(ownerId: string, id: string, dir: -1 | 1): Promise<boolean> {
  const task = await getTask(ownerId, id);
  if (!task) return false;
  const all = await listTasks(ownerId, task.project_id);
  const other = swapTarget(all, id, dir);
  if (!other) return false;
  // Equal positions are possible (legacy/imports): give the pair distinct slots.
  const [a, b] = task.position === other.position ? [task.position + (dir === 1 ? 1 : 0), other.position + (dir === 1 ? 0 : 1)] : [other.position, task.position];
  const r1 = await db().from("project_tasks").update({ position: a }).eq("id", task.id).eq("owner_id", ownerId);
  const r2 = await db().from("project_tasks").update({ position: b }).eq("id", other.id).eq("owner_id", ownerId);
  if (r1.error || r2.error) throw dbError("Reordering tasks", r1.error ?? r2.error);
  return true;
}

export async function deleteTask(ownerId: string, id: string): Promise<boolean> {
  const { data, error } = await db().from("project_tasks").delete().eq("id", id).eq("owner_id", ownerId).select("id");
  if (error) throw dbError("Deleting the task", error);
  return Boolean(data?.length);
}
