import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/errors", () => ({ dbError: (c: string) => new Error(c) }));

type Op = { op: string; payload?: Record<string, unknown>; filters: Record<string, unknown> };
let ops: Op[] = [];
let rows: Record<string, unknown>[] = [];

vi.mock("@/lib/supabase/server", () => ({
  getServiceSupabase: () => ({
    from: (table: string) => {
      const o: Op = { op: "select", filters: {} };
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      Object.assign(chain, {
        select: self, order: self, limit: self,
        eq: (k: string, v: unknown) => { o.filters[k] = v; return chain; },
        insert: (p: Record<string, unknown>) => { o.op = "insert"; o.payload = p; ops.push(o); return chain; },
        update: (p: Record<string, unknown>) => { o.op = "update"; o.payload = p; ops.push(o); return chain; },
        single: async () => ({ data: { id: "new", ...(o.payload ?? {}) }, error: null }),
        maybeSingle: async () => {
          if (o.op === "update") return { data: { id: o.filters.id, ...(o.payload ?? {}) }, error: null };
          const id = o.filters.id;
          return { data: table === "project_tasks" ? rows.find((r) => r.id === id) ?? null : { id: "p1" }, error: null };
        },
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: table === "project_tasks" ? rows : [], error: null }).then(res),
      });
      return chain;
    },
  }),
}));

const { createTask, setStatus, reorder, taskCounts } = await import("@/lib/tasks-store");
const row = (id: string, status: string, position: number, over: Record<string, unknown> = {}) => ({ id, project_id: "p1", owner_id: "o", status, position, due_date: null, ...over });
beforeEach(() => { ops = []; rows = []; });

describe("createTask", () => {
  it("appends to the end of its column and stamps completed_at only for done", async () => {
    rows = [row("a", "todo", 3)];
    await createTask("o", "p1", { title: "T", description: "", priority: "normal", due_date: null, assignee: null });
    expect(ops.find((x) => x.op === "insert")!.payload).toMatchObject({ status: "todo", position: 4, owner_id: "o", project_id: "p1", completed_at: null });
    ops = [];
    await createTask("o", "p1", { title: "T", description: "", priority: "normal", due_date: null, assignee: null }, "done");
    expect(ops.find((x) => x.op === "insert")!.payload!.completed_at).toEqual(expect.any(String));
  });
});

describe("setStatus", () => {
  it("moves to the end of the target column and tracks completion", async () => {
    rows = [row("a", "todo", 0), row("b", "done", 5)];
    await setStatus("o", "a", "done");
    expect(ops.find((x) => x.op === "update")!.payload).toMatchObject({ status: "done", position: 6, completed_at: expect.any(String) });
  });
  it("clears completed_at when a task leaves done", async () => {
    rows = [row("a", "done", 0, { completed_at: "x" })];
    await setStatus("o", "a", "in_progress");
    expect(ops.find((x) => x.op === "update")!.payload).toMatchObject({ status: "in_progress", completed_at: null });
  });
  it("is a no-op when the status is unchanged, and returns null for an unknown task", async () => {
    rows = [row("a", "todo", 0)];
    await setStatus("o", "a", "todo");
    expect(ops.some((x) => x.op === "update")).toBe(false);
    expect(await setStatus("o", "zzz", "done")).toBeNull();
  });
});

describe("reorder", () => {
  it("swaps positions with the neighbour in the same column", async () => {
    rows = [row("a", "todo", 0), row("b", "todo", 1)];
    expect(await reorder("o", "a", 1)).toBe(true);
    const upd = ops.filter((x) => x.op === "update");
    expect(upd.map((u) => [u.filters.id, u.payload!.position])).toEqual([["a", 1], ["b", 0]]);
  });
  it("gives equal positions distinct slots", async () => {
    rows = [row("a", "todo", 0, { created_at: "1" }), row("b", "todo", 0, { created_at: "2" })];
    await reorder("o", "a", 1);
    const pos = ops.filter((x) => x.op === "update").map((u) => u.payload!.position);
    expect(new Set(pos).size).toBe(2);
  });
  it("does nothing at the edge of a column", async () => {
    rows = [row("a", "todo", 0)];
    expect(await reorder("o", "a", -1)).toBe(false);
    expect(ops.some((x) => x.op === "update")).toBe(false);
  });
});

describe("taskCounts", () => {
  it("counts done and overdue (not done, past due) per project", async () => {
    rows = [row("a", "done", 0, { due_date: "2000-01-01" }), row("b", "todo", 1, { due_date: "2000-01-01" }), row("c", "todo", 2, { due_date: "2999-01-01" }), row("d", "blocked", 3), row("e", "todo", 0, { project_id: "p2" })];
    const m = await taskCounts("o");
    expect(m.get("p1")).toEqual({ total: 4, done: 1, overdue: 1 });
    expect(m.get("p2")).toEqual({ total: 1, done: 0, overdue: 0 });
  });
});
