import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/errors", () => ({ dbError: (c: string) => new Error(c) }));

type Call = { table: string; op: string; payload?: unknown; filters: Record<string, unknown> };
let calls: Call[] = [];
let current: Record<string, unknown> | null;
let snapshotError: unknown = null;
let updateResult: unknown = null;
let versionRow: unknown = null;

vi.mock("@/lib/supabase/server", () => ({
  getServiceSupabase: () => ({
    from: (table: string) => {
      const c: Call = { table, op: "select", filters: {} };
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      Object.assign(chain, {
        select: self, order: self, limit: self,
        eq: (k: string, v: unknown) => { c.filters[k] = v; return chain; },
        insert: (p: unknown) => { c.op = "insert"; c.payload = p; calls.push(c); return Promise.resolve({ error: table === "agent_skill_versions" ? snapshotError : null }); },
        update: (p: unknown) => { c.op = "update"; c.payload = p; calls.push(c); return chain; },
        maybeSingle: async () => {
          if (table === "agent_skills" && c.op === "update") return { data: updateResult, error: null };
          if (table === "agent_skills") return { data: current, error: null };
          if (table === "agent_skill_versions") return { data: versionRow, error: null };
          return { data: null, error: null };
        },
      });
      return chain;
    },
  }),
}));

const { updateSkill, restoreVersion, ConflictError } = await import("@/lib/skills-store");

const draft = { name: "N2", description: null, prompt: "p2", tags: [], input_schema: null, output_schema: null, metadata: {} };
const row = (v: number) => ({ id: "s1", name: "N1", description: null, prompt: "p1", enabled: true, version: v, tags: ["a"], input_schema: null, output_schema: null, metadata: {}, created_at: "x", updated_at: "x" });

beforeEach(() => { calls = []; current = row(3); snapshotError = null; updateResult = row(4); versionRow = null; });

describe("updateSkill versioning", () => {
  it("snapshots the previous state, then updates to version+1 guarded by the expected version", async () => {
    const out = await updateSkill("s1", draft, 3, "owner");
    expect(out.version).toBe(4);
    const snap = calls.find((c) => c.table === "agent_skill_versions" && c.op === "insert")!;
    expect(snap.payload).toMatchObject({ skill_id: "s1", version: 3, name: "N1", prompt: "p1", saved_by: "owner" });
    const upd = calls.find((c) => c.table === "agent_skills" && c.op === "update")!;
    expect(upd.payload).toMatchObject({ version: 4, name: "N2", prompt: "p2" });
    expect(upd.filters).toMatchObject({ id: "s1", version: 3 });
  });
  it("refuses a stale edit before writing anything", async () => {
    await expect(updateSkill("s1", draft, 2, "o")).rejects.toBeInstanceOf(ConflictError);
    expect(calls).toHaveLength(0);
  });
  it("treats a concurrent snapshot (unique violation) as a conflict", async () => {
    snapshotError = { code: "23505" };
    await expect(updateSkill("s1", draft, 3, "o")).rejects.toBeInstanceOf(ConflictError);
  });
  it("treats a lost optimistic-lock update as a conflict", async () => {
    updateResult = null;
    await expect(updateSkill("s1", draft, 3, "o")).rejects.toBeInstanceOf(ConflictError);
  });
  it("a missing skill is reported", async () => {
    current = null;
    await expect(updateSkill("s1", draft, 1, "o")).rejects.toThrow(/not found/);
  });
});

describe("restoreVersion", () => {
  it("restores an old version as a NEW version (history is never rewritten)", async () => {
    versionRow = { skill_id: "s1", version: 1, name: "Old", description: "d", prompt: "old prompt", tags: [], input_schema: null, output_schema: null, metadata: {} };
    await restoreVersion("s1", 1, "owner");
    const upd = calls.find((c) => c.table === "agent_skills" && c.op === "update")!;
    expect(upd.payload).toMatchObject({ name: "Old", prompt: "old prompt", version: 4 });
    expect(calls.find((c) => c.table === "agent_skill_versions" && c.op === "insert")!.payload).toMatchObject({ version: 3, name: "N1" });
  });
  it("fails clearly for an unknown version", async () => {
    versionRow = null;
    await expect(restoreVersion("s1", 9, "o")).rejects.toThrow(/Version not found/);
  });
});
