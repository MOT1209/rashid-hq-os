import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolDefinition } from "@/lib/mcp/tools";

/**
 * Phase 1.1: the policy gate reads its rules from the `policies` table
 * (migration 0017) instead of only the hard-coded POLICY. The DB rows must
 * decide exactly what the code rules decided (parity), and any DB failure
 * must fall back to the hard-coded rules — never fail open or closed.
 */

const SEED_ROWS = [
  {
    id: "standing-task-write-guard",
    description: "seed",
    tool_names: [],
    actor_type: "standing_task_routine",
    required_scope: "write",
    exclude_tool: "call_project_tool",
    decision: "deny",
    priority: 10,
    enabled: true,
    created_at: "now",
  },
  {
    id: "delete-project-needs-approval",
    description: "seed",
    tool_names: ["delete_project"],
    actor_type: null,
    required_scope: null,
    exclude_tool: null,
    decision: "require_approval",
    priority: 20,
    enabled: true,
    created_at: "now",
  },
  {
    id: "already-guarded-writes",
    description: "seed",
    tool_names: [
      "register_project",
      "update_project",
      "add_project_tool",
      "update_project_tool",
      "delete_project_tool",
      "call_project_tool",
      "delegate_to_department",
    ],
    actor_type: null,
    required_scope: null,
    exclude_tool: null,
    decision: "allow",
    priority: 30,
    enabled: true,
    created_at: "now",
  },
];

let dbResult: { data: unknown; error: unknown } = { data: SEED_ROWS, error: null };
const orderCalls: unknown[] = [];
const from = vi.fn((_table: string) => ({
  select: () => ({
    eq: () => ({
      order: async (...args: unknown[]) => {
        orderCalls.push(args);
        return dbResult;
      },
    }),
  }),
  update: () => ({ eq: async () => ({ error: null }) }),
}));
vi.mock("@/lib/supabase/server", () => ({ getServiceSupabase: () => ({ from }) }));

const captureError = vi.fn();
vi.mock("@/lib/errors", () => ({ captureError: (...args: unknown[]) => captureError(...args) }));

const {
  evaluatePolicy,
  evaluatePolicyAsync,
  matchDbPolicy,
  clearPolicyCache,
  listEnabledPolicies,
} = await import("@/lib/policy");

function tool(name: string, scope: "read" | "write" = "write") {
  return { name, requiredScope: scope } as unknown as ToolDefinition;
}
const PERSON = { agentName: "CEO Console", actorType: "person" } as never;
const AUTONOMOUS = { agentName: "Dev Agent", actorType: "standing_task_routine" } as never;

beforeEach(() => {
  clearPolicyCache();
  from.mockClear();
  captureError.mockClear();
  orderCalls.length = 0;
  dbResult = { data: SEED_ROWS, error: null };
});

describe("matchDbPolicy", () => {
  it("blocks a standing-task write but exempts call_project_tool", () => {
    const guard = SEED_ROWS[0] as never;
    expect(matchDbPolicy(guard, tool("delete_project"), AUTONOMOUS)).toBe(true);
    expect(matchDbPolicy(guard, tool("call_project_tool"), AUTONOMOUS)).toBe(false);
    expect(matchDbPolicy(guard, tool("delete_project"), PERSON)).toBe(false);
  });

  it("matches delete_project regardless of actor", () => {
    const rule = SEED_ROWS[1] as never;
    expect(matchDbPolicy(rule, tool("delete_project"), PERSON)).toBe(true);
    expect(matchDbPolicy(rule, tool("update_project"), PERSON)).toBe(false);
  });
});

describe("evaluatePolicyAsync with DB rows", () => {
  it("reaches the same verdicts as the hard-coded rules (parity)", async () => {
    const cases: Array<[ReturnType<typeof tool>, typeof PERSON | typeof AUTONOMOUS]> = [
      [tool("delete_project"), PERSON],
      [tool("update_project"), PERSON],
      [tool("delete_project"), AUTONOMOUS],
      [tool("call_project_tool"), AUTONOMOUS],
      [tool("list_projects", "read"), PERSON],
      [tool("some_future_write_tool"), PERSON],
    ];
    for (const [t, ctx] of cases) {
      const viaDb = await evaluatePolicyAsync(t, ctx, {});
      clearPolicyCache();
      const viaCode = evaluatePolicy(t, ctx, {});
      expect(viaDb, t.name).toEqual(viaCode);
    }
  });

  it("caches the table briefly instead of querying per call", async () => {
    await evaluatePolicyAsync(tool("list_projects", "read"), PERSON, {});
    await evaluatePolicyAsync(tool("list_projects", "read"), PERSON, {});
    expect(from).toHaveBeenCalledTimes(1);
  });
});

describe("evaluatePolicyAsync fallback", () => {
  it("falls back to the hard-coded rules when the table is unreadable", async () => {
    dbResult = { data: null, error: { message: "relation policies does not exist" } };

    const result = await evaluatePolicyAsync(tool("list_projects", "read"), PERSON, {});

    expect(result).toEqual({ decision: "allow", ruleId: null });
    expect(captureError).toHaveBeenCalledWith("policy:db-fallback", expect.anything());
  });

  it("still queues an unknown write when the DB is down (fail-safe, not fail-open)", async () => {
    dbResult = { data: null, error: { message: "connection lost" } };

    const result = await evaluatePolicyAsync(tool("some_future_write_tool"), PERSON, {});

    expect(result).toEqual({ decision: "require_approval", ruleId: null });
  });
});

describe("listEnabledPolicies", () => {
  it("queries enabled rows ordered by priority", async () => {
    await listEnabledPolicies();
    expect(from).toHaveBeenCalledWith("policies");
    expect(orderCalls[0]).toEqual(["priority", { ascending: true }]);
  });
});
