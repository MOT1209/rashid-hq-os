import { beforeEach, describe, expect, it, vi } from "vitest";

let toolRow: unknown = null;
let lookupError: unknown = null;
const captureError = vi.fn();

vi.mock("@/lib/errors", () => ({ captureError: (...a: unknown[]) => captureError(...a), dbError: (c: string) => new Error(c) }));
vi.mock("@/lib/supabase/server", () => ({
  getServiceSupabase: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      Object.assign(chain, {
        select: self, eq: self, order: self,
        maybeSingle: async () => (table === "project_tools" ? { data: toolRow, error: lookupError } : { data: null, error: null }),
        then: (res: (v: unknown) => void) => res({ data: [], error: null }), // policies table: no DB rows
      });
      return chain;
    },
  }),
}));

const { decideProjectTool, testAllowed } = await import("@/lib/mcp/tool-policy");
const { evaluatePolicyAsync, clearPolicyCache } = await import("@/lib/policy");

const callTool = { name: "call_project_tool", requiredScope: "write" } as never;
const ctx = (actorType: string) => ({ agentName: "a", scopes: ["read", "write"], actorType }) as never;
const args = { project_id: "p1", tool_name: "deploy" };

describe("decideProjectTool (pure)", () => {
  it("falls through for unknown tools and plain enabled read/write tools", () => {
    expect(decideProjectTool(null, "person")).toBeNull();
    expect(decideProjectTool({ enabled: true, permission: "read", requires_approval: false }, "person")).toBeNull();
    expect(decideProjectTool({ enabled: true, permission: "write", requires_approval: false }, "person")).toBeNull();
  });
  it("a disabled tool is denied whatever else is set", () => {
    expect(decideProjectTool({ enabled: false, permission: "read", requires_approval: false }, "person")).toEqual({ decision: "deny", ruleId: "project-tool-disabled" });
  });
  it("dangerous tools need approval, and are denied for unattended cron runs", () => {
    const row = { enabled: true, permission: "dangerous", requires_approval: false };
    expect(decideProjectTool(row, "person")?.decision).toBe("require_approval");
    expect(decideProjectTool(row, "agent")?.decision).toBe("require_approval");
    expect(decideProjectTool(row, "standing_task_routine")?.decision).toBe("deny");
  });
  it("requires_approval applies to any class", () => {
    expect(decideProjectTool({ enabled: true, permission: "read", requires_approval: true }, "person")?.decision).toBe("require_approval");
  });
  it("an unknown permission string is treated as dangerous", () => {
    expect(decideProjectTool({ enabled: true, permission: "root", requires_approval: false }, "person")?.decision).toBe("require_approval");
  });
});

describe("testAllowed", () => {
  it("only enabled read-class tools may be test-fired", () => {
    expect(testAllowed({ enabled: true, permission: "read" })).toEqual({ ok: true });
    expect(testAllowed({ enabled: true, permission: "write" }).ok).toBe(false);
    expect(testAllowed({ enabled: true, permission: "dangerous" }).ok).toBe(false);
    expect(testAllowed({ enabled: false, permission: "read" }).ok).toBe(false);
  });
});

describe("evaluatePolicyAsync with per-tool policy", () => {
  beforeEach(() => { toolRow = null; lookupError = null; captureError.mockClear(); clearPolicyCache(); });

  it("denies a disabled project tool (also what the approval step re-checks)", async () => {
    toolRow = { enabled: false, permission: "write", requires_approval: false };
    expect(await evaluatePolicyAsync(callTool, ctx("person"), args)).toEqual({ decision: "deny", ruleId: "project-tool-disabled" });
  });
  it("queues a dangerous tool for approval", async () => {
    toolRow = { enabled: true, permission: "dangerous", requires_approval: false };
    expect((await evaluatePolicyAsync(callTool, ctx("agent"), args)).decision).toBe("require_approval");
  });
  it("fails SAFE when the lookup errors: approval, never allow", async () => {
    lookupError = new Error("db down");
    const r = await evaluatePolicyAsync(callTool, ctx("person"), args);
    expect(r).toEqual({ decision: "require_approval", ruleId: "project-tool-lookup-failed" });
    expect(captureError).toHaveBeenCalled();
  });
  it("does not touch other tools", async () => {
    toolRow = { enabled: false, permission: "dangerous", requires_approval: true };
    const r = await evaluatePolicyAsync({ name: "list_projects", requiredScope: "read" } as never, ctx("person"), {});
    expect(r.decision).toBe("allow");
  });
});
