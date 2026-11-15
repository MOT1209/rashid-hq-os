import { beforeEach, describe, expect, it, vi } from "vitest";

let failing = new Set<string>();
let counts: Record<string, number> = {};
let rows: Record<string, unknown[]> = {};

vi.mock("@/lib/supabase/server", () => ({
  getServiceSupabase: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      const result = (head: boolean) => (failing.has(table) ? { data: null, count: null, error: { message: "boom" } } : { data: rows[table] ?? [], count: head ? counts[table] ?? 0 : null, error: null });
      let head = false;
      Object.assign(chain, {
        select: (_c?: string, o?: { head?: boolean }) => { head = Boolean(o?.head); return chain; },
        eq: self, neq: self, lt: self, gte: self, order: self, limit: self,
        then: (res: (v: unknown) => unknown) => Promise.resolve(result(head)).then(res),
      });
      return chain;
    },
  }),
}));
vi.mock("@/lib/agent-admin", () => ({ fetchAgentRuns: vi.fn(async () => [{ agent_name: "Dev Agent", kind: "delegation", status: "failed", tokens_in: 90, tokens_out: 20, duration_ms: 1, step_count: 1, created_at: new Date().toISOString() }]) }));
vi.mock("@/lib/queries", () => ({ fetchDepartments: vi.fn(async () => [{ key: "dev", agent_name: "Dev Agent", monthly_token_budget: 100, enabled: true }, { key: "x", agent_name: "X Agent", monthly_token_budget: null, enabled: false }]) }));
vi.mock("@/lib/social/summary", () => ({ socialSummary: vi.fn(async () => ({ accounts: 1, queued: 2, running: 0, failed7d: 1, succeeded7d: 4, nextRunAt: null, lastError: null })) }));

const { fetchOverview } = await import("@/lib/overview");

beforeEach(() => { failing = new Set(); counts = { tool_approvals: 3, agent_logs: 5, automation_runs: 1, project_tasks: 2 }; rows = { integration_connections: [{ status: "connected" }, { status: "expired" }], project_tools: [{ enabled: true, permission: "dangerous", last_test_ok: false }, { enabled: false, permission: "read", last_test_ok: false }], automations: [{ name: "A", enabled: true, trigger_type: "schedule", next_run_at: "2026-01-02T00:00:00Z" }, { name: "B", enabled: false, trigger_type: "schedule", next_run_at: "2026-01-01T00:00:00Z" }], projects: [{ id: "p" }] }; });

describe("fetchOverview", () => {
  it("assembles real figures from each source", async () => {
    const o = await fetchOverview("owner");
    expect(o.db.ok).toBe(true);
    expect(o.approvalsPending).toBe(3);
    expect(o.integrations).toEqual({ connected: 1, error: 0, expired: 1, disconnected: 0 });
    expect(o.mcp).toEqual({ tools: 2, enabled: 1, dangerous: 1, testFailing: 1 }); // a disabled tool's failed test is not counted
    expect(o.agents).toMatchObject({ total: 2, enabled: 1, runs24h: 1, failed24h: 1, overBudget: 0, exhausted: 1 }); // 110 of 100 tokens = budget exhausted (80–99% would be overBudget)
    expect(o.automations?.next.map((n) => n.name)).toEqual(["A"]); // paused automations are not "scheduled"
    expect(o.social).toMatchObject({ queued: 2, succeeded7d: 4 });
    expect(o.activity?.failed24h).toBe(5);
  });

  it("one failing source makes ONLY its card unavailable", async () => {
    failing = new Set(["integration_connections", "tool_approvals"]);
    const o = await fetchOverview("owner");
    expect(o.integrations).toBeNull();
    expect(o.approvalsPending).toBeNull();
    expect(o.mcp).not.toBeNull();
    expect(o.agents).not.toBeNull();
    expect(o.social).not.toBeNull();
  });

  it("a database outage is reported (and the page still renders)", async () => {
    failing = new Set(["projects"]);
    const o = await fetchOverview("owner");
    expect(o.db).toEqual({ ok: false, latencyMs: null });
  });

  it("never exposes environment values in the health list", async () => {
    process.env.BETTER_AUTH_SECRET = "TOP-SECRET-VALUE-0123456789-0123456789-abcdef";
    const o = await fetchOverview("owner");
    expect(JSON.stringify(o)).not.toContain("TOP-SECRET-VALUE");
    delete process.env.BETTER_AUTH_SECRET;
  });
});
