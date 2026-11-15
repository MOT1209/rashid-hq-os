import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Vercel deploys `main` the moment it merges, but migrations are applied by hand,
 * so the new code must keep the EXISTING pages and the governance gates working
 * against the previous schema. These tests simulate Postgres/PostgREST answering
 * "column does not exist" for the new columns.
 */

const MISSING = { code: "42703", message: "column projects.priority does not exist" };
let calls: { table: string; columns: string; filters: string[] }[] = [];
let failColumns: string[] = []; // a select naming any of these columns fails with "does not exist"
let toolRow: unknown = null;
let policyError: unknown = null;
let projectsError: unknown = null; // a NON-column failure for the projects table

vi.mock("@/lib/errors", () => ({ captureError: vi.fn(), dbError: (c: string) => new Error(c) }));
vi.mock("@/lib/supabase/server", () => ({
  getServiceSupabase: () => ({
    from: (table: string) => {
      const c = { table, columns: "", filters: [] as string[] };
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      const fails = () => failColumns.some((col) => c.columns.split(/,\s*/).includes(col) || c.filters.includes(col));
      const result = () => {
        calls.push({ ...c });
        if (table === "projects" && projectsError) return { data: null, count: null, error: projectsError };
        if (fails()) return { data: null, count: null, error: MISSING };
        if (table === "project_tools") return { data: toolRow, count: null, error: policyError };
        return { data: table === "projects" ? [{ id: "p1", name: "P", status: "active" }] : [], count: 3, error: null };
      };
      Object.assign(chain, {
        select: (cols: string) => { c.columns = cols; return chain; },
        eq: self, neq: self, order: self, limit: self, in: self, gte: self,
        is: (col: string) => { c.filters.push(col); return chain; },
        maybeSingle: async () => result(),
        then: (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res),
      });
      return chain;
    },
  }),
}));

const { isMissingColumn } = await import("@/lib/schema-compat");
const { fetchProjects, fetchStats } = await import("@/lib/queries");
const { evaluatePolicyAsync, clearPolicyCache } = await import("@/lib/policy");

beforeEach(() => { calls = []; failColumns = []; toolRow = null; policyError = null; projectsError = null; clearPolicyCache(); });

describe("isMissingColumn", () => {
  it("recognises Postgres and PostgREST 'missing column' errors only", () => {
    expect(isMissingColumn({ code: "42703" })).toBe(true);
    expect(isMissingColumn({ code: "PGRST204", message: "x" })).toBe(true);
    expect(isMissingColumn({ message: 'column "priority" of relation "projects" does not exist' })).toBe(false); // quoted form is a different message
    expect(isMissingColumn({ message: "column projects.priority does not exist" })).toBe(true);
    expect(isMissingColumn({ message: "Could not find the 'priority' column of 'projects' in the schema cache" })).toBe(true);
    expect(isMissingColumn({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingColumn({ code: "08006", message: "connection failure" })).toBe(false);
    expect(isMissingColumn(null)).toBe(false);
  });
});

describe("existing pages against an un-migrated schema", () => {
  it("fetchProjects falls back to the legacy columns and fills defaults", async () => {
    failColumns = ["priority", "archived_at"];
    const rows = await fetchProjects();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "p1", priority: "normal", archived_at: null });
    expect(calls.map((c) => c.columns.includes("priority"))).toEqual([true, false]);
  });
  it("fetchProjects still throws for a real (non-column) error — the fallback does not swallow outages", async () => {
    projectsError = { code: "08006", message: "connection failure" };
    await expect(fetchProjects()).rejects.toThrow(/Loading projects/);
  });
  it("fetchStats counts active projects without the archive filter when the column is missing", async () => {
    failColumns = ["archived_at"];
    const stats = await fetchStats();
    expect(stats.activeProjects).toBe(3); // the retried, unfiltered count — not a silent 0
    expect(calls.filter((c) => c.table === "projects" && !c.filters.includes("archived_at")).length).toBeGreaterThan(0);
  });
});

describe("project-tool policy before migration 0028", () => {
  const callTool = { name: "call_project_tool", requiredScope: "write" } as never;
  const ctx = { agentName: "a", scopes: ["read", "write"], actorType: "person" } as never;
  const args = { project_id: "p1", tool_name: "deploy" };

  it("a missing policy column means 'no per-tool policy yet' (the pre-0028 behaviour), not a blanket approval queue", async () => {
    failColumns = ["enabled", "permission", "requires_approval"];
    const r = await evaluatePolicyAsync(callTool, ctx, args);
    expect(r.ruleId).not.toBe("project-tool-lookup-failed");
  });
  it("any OTHER lookup error still fails safe to approval", async () => {
    policyError = { code: "08006", message: "connection failure" };
    toolRow = null;
    expect(await evaluatePolicyAsync(callTool, ctx, args)).toEqual({ decision: "require_approval", ruleId: "project-tool-lookup-failed" });
  });
  it("after the migration the per-tool policy applies again", async () => {
    toolRow = { enabled: false, permission: "write", requires_approval: false };
    expect(await evaluatePolicyAsync(callTool, ctx, args)).toEqual({ decision: "deny", ruleId: "project-tool-disabled" });
  });
});
