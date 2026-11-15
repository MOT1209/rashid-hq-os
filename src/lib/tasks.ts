/**
 * Project task rules (pure, browser-safe, tested): validation, board order,
 * progress and overdue logic.
 */

export const STATUSES = ["todo", "in_progress", "blocked", "done"] as const;
export type TaskStatus = (typeof STATUSES)[number];
export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const isStatus = (v: unknown): v is TaskStatus => typeof v === "string" && (STATUSES as readonly string[]).includes(v);
export const isPriority = (v: unknown): v is Priority => typeof v === "string" && (PRIORITIES as readonly string[]).includes(v);

export const LIMITS = { title: 200, description: 2000, assignee: 80, documentation: 20_000, projectDescription: 1000 } as const;

export type TaskDraft = { title: string; description: string; priority: Priority; due_date: string | null; assignee: string | null };
export type Validated<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** True for a real calendar date written yyyy-mm-dd (rejects 2026-02-31). */
export function isRealDate(s: string): boolean {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export function validateTask(input: unknown): Validated<TaskDraft> {
  const o = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const errors: string[] = [];
  const title = typeof o.title === "string" ? o.title.trim() : "";
  if (!title) errors.push("Title is required.");
  else if (title.length > LIMITS.title) errors.push(`Title is longer than ${LIMITS.title} characters.`);
  const description = typeof o.description === "string" ? o.description.trim() : "";
  if (description.length > LIMITS.description) errors.push(`Description is longer than ${LIMITS.description} characters.`);
  const priority = o.priority === undefined || o.priority === "" ? "normal" : o.priority;
  if (!isPriority(priority)) errors.push("Unknown priority.");
  const rawDue = typeof o.due_date === "string" ? o.due_date.trim() : "";
  if (rawDue && !isRealDate(rawDue)) errors.push("Due date must be a real date (yyyy-mm-dd).");
  const assignee = typeof o.assignee === "string" && o.assignee.trim() ? o.assignee.trim() : null;
  if (assignee && assignee.length > LIMITS.assignee) errors.push(`Assignee is longer than ${LIMITS.assignee} characters.`);
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { title, description, priority: priority as Priority, due_date: rawDue || null, assignee } };
}

export type ProjectMeta = { priority: Priority; description: string; documentation: string };

export function validateProjectMeta(input: unknown): Validated<ProjectMeta> {
  const o = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const errors: string[] = [];
  if (!isPriority(o.priority)) errors.push("Unknown priority.");
  const description = typeof o.description === "string" ? o.description.trim() : "";
  if (description.length > LIMITS.projectDescription) errors.push(`Description is longer than ${LIMITS.projectDescription} characters.`);
  const documentation = typeof o.documentation === "string" ? o.documentation : "";
  if (documentation.length > LIMITS.documentation) errors.push(`Documentation is longer than ${LIMITS.documentation} characters.`);
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { priority: o.priority as Priority, description, documentation } };
}

export type TaskLike = { id: string; status: TaskStatus; position: number; created_at?: string; due_date?: string | null; priority?: Priority };

/** Left/right movement across the board columns; null at the edges. */
export function neighbour(status: TaskStatus, dir: -1 | 1): TaskStatus | null {
  const i = STATUSES.indexOf(status) + dir;
  return i < 0 || i >= STATUSES.length ? null : STATUSES[i];
}

/** Position that places a task at the END of `status`. */
export function nextPosition(tasks: TaskLike[], status: TaskStatus): number {
  const inCol = tasks.filter((t) => t.status === status);
  return inCol.length === 0 ? 0 : Math.max(...inCol.map((t) => t.position)) + 1;
}

const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/** Board order inside one column: manual position first, then priority, then age. */
export function sortColumn<T extends TaskLike>(tasks: T[]): T[] {
  return [...tasks].sort(
    (a, b) => a.position - b.position || PRIORITY_RANK[a.priority ?? "normal"] - PRIORITY_RANK[b.priority ?? "normal"] || (a.created_at ?? "").localeCompare(b.created_at ?? ""),
  );
}

/** Progress = done / all tasks (blocked and in-progress count as not done). */
export function progress(tasks: Pick<TaskLike, "status">[]): { total: number; done: number; percent: number } {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "done").length;
  return { total, done, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

export function isOverdue(t: Pick<TaskLike, "status" | "due_date">, todayKey: string): boolean {
  return t.status !== "done" && Boolean(t.due_date) && (t.due_date as string) < todayKey;
}

/** Swap targets for moving a task up/down inside its column: returns the neighbour task or null. */
export function swapTarget<T extends TaskLike>(tasks: T[], id: string, dir: -1 | 1): T | null {
  const me = tasks.find((t) => t.id === id);
  if (!me) return null;
  const col = sortColumn(tasks.filter((t) => t.status === me.status));
  const i = col.findIndex((t) => t.id === id) + dir;
  return col[i] ?? null;
}
