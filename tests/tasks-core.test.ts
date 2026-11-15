import { describe, expect, it } from "vitest";
import { isOverdue, isRealDate, neighbour, nextPosition, progress, sortColumn, swapTarget, validateProjectMeta, validateTask, LIMITS, type TaskLike } from "@/lib/tasks";

const t = (id: string, status: TaskLike["status"], position: number, over: Partial<TaskLike> = {}): TaskLike => ({ id, status, position, created_at: `2026-01-0${position + 1}`, priority: "normal", ...over });

describe("validateTask", () => {
  it("accepts and normalises", () => {
    const v = validateTask({ title: "  Ship it ", description: " d ", priority: "high", due_date: "2026-03-01", assignee: " Sara " });
    expect(v).toEqual({ ok: true, value: { title: "Ship it", description: "d", priority: "high", due_date: "2026-03-01", assignee: "Sara" } });
    expect(validateTask({ title: "x" })).toMatchObject({ ok: true, value: { priority: "normal", due_date: null, assignee: null } });
  });
  it("rejects bad input", () => {
    for (const bad of [{}, { title: " " }, { title: "x".repeat(LIMITS.title + 1) }, { title: "x", priority: "now" }, { title: "x", due_date: "2026-02-31" }, { title: "x", due_date: "tomorrow" }, { title: "x", description: "d".repeat(LIMITS.description + 1) }, { title: "x", assignee: "a".repeat(81) }]) {
      expect(validateTask(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });
  it("real dates only", () => {
    expect(isRealDate("2028-02-29")).toBe(true);
    expect(isRealDate("2026-02-29")).toBe(false);
    expect(isRealDate("2026-13-01")).toBe(false);
    expect(isRealDate("26-1-1")).toBe(false);
  });
});

describe("validateProjectMeta", () => {
  it("validates priority and limits", () => {
    expect(validateProjectMeta({ priority: "urgent", description: " d ", documentation: "# docs" })).toEqual({ ok: true, value: { priority: "urgent", description: "d", documentation: "# docs" } });
    expect(validateProjectMeta({ priority: "x" }).ok).toBe(false);
    expect(validateProjectMeta({ priority: "low", documentation: "x".repeat(LIMITS.documentation + 1) }).ok).toBe(false);
  });
});

describe("board logic", () => {
  it("moves between columns and stops at the edges", () => {
    expect(neighbour("todo", 1)).toBe("in_progress");
    expect(neighbour("done", 1)).toBeNull();
    expect(neighbour("todo", -1)).toBeNull();
    expect(neighbour("blocked", -1)).toBe("in_progress");
  });
  it("appends to the end of a column", () => {
    expect(nextPosition([t("a", "todo", 0), t("b", "todo", 4), t("c", "done", 9)], "todo")).toBe(5);
    expect(nextPosition([], "todo")).toBe(0);
  });
  it("orders a column by position, then priority, then age", () => {
    const col = sortColumn([t("a", "todo", 1), t("b", "todo", 0, { priority: "low" }), t("c", "todo", 0, { priority: "urgent" })]);
    expect(col.map((x) => x.id)).toEqual(["c", "b", "a"]);
  });
  it("finds the swap neighbour within the same column only", () => {
    const tasks = [t("a", "todo", 0), t("b", "todo", 1), t("c", "done", 0)];
    expect(swapTarget(tasks, "a", 1)?.id).toBe("b");
    expect(swapTarget(tasks, "a", -1)).toBeNull();
    expect(swapTarget(tasks, "c", 1)).toBeNull();
    expect(swapTarget(tasks, "zzz", 1)).toBeNull();
  });
  it("progress counts only done tasks; empty is 0%", () => {
    expect(progress([])).toEqual({ total: 0, done: 0, percent: 0 });
    expect(progress([{ status: "done" }, { status: "blocked" }, { status: "in_progress" }])).toEqual({ total: 3, done: 1, percent: 33 });
  });
  it("overdue ignores done tasks and tasks without a date", () => {
    expect(isOverdue({ status: "todo", due_date: "2026-01-01" }, "2026-01-02")).toBe(true);
    expect(isOverdue({ status: "todo", due_date: "2026-01-02" }, "2026-01-02")).toBe(false);
    expect(isOverdue({ status: "done", due_date: "2020-01-01" }, "2026-01-02")).toBe(false);
    expect(isOverdue({ status: "todo", due_date: null }, "2026-01-02")).toBe(false);
  });
});
