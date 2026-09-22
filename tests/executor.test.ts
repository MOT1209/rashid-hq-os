import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext, ToolDefinition } from "@/lib/mcp/tools";

/**
 * runTool (src/lib/mcp/executor.ts) is the single place a tool call executes,
 * in front of every transport. Contract: every decision — scope deny, policy
 * deny, require_approval, allow — is audited in agent_logs with the caller's
 * real actor_type; no decision except "allow" ever reaches tool.execute(); an
 * allow that crashes is logged failed and reported as unexpected unless the
 * error already carries a dbError reference.
 */

type ActivityEntry = Record<string, unknown>;

const activityLogs: ActivityEntry[] = [];
const finishes: unknown[][] = [];
let activityId: string | null = "log-1";

const startActivity = vi.fn(async (entry: ActivityEntry) => {
  activityLogs.push(entry);
  const finish = vi.fn(async (...args: unknown[]) => {
    const last = finishes[finishes.length - 1] ?? (finishes[finishes.length] = []);
    last.push(args);
  });
  finishes.push([]);
  return { id: activityId, finish };
});

vi.mock("@/lib/activity", () => ({
  startActivity: (entry: ActivityEntry) => startActivity(entry),
}));

const captureError = vi.fn();
vi.mock("@/lib/errors", () => ({
  captureError: (context: string, error: unknown, extra?: unknown) =>
    captureError(context, error, extra),
}));

type ApprovalInput = { logId: string };
const queueApproval = vi.fn(async (input: ApprovalInput) => `approval-${input.logId}`);
vi.mock("@/lib/approvals", () => ({
  queueApproval: (input: ApprovalInput) => queueApproval(input),
}));

type PolicyDecision = { decision: "allow" | "deny" | "require_approval"; ruleId: string | null };
const evaluatePolicyAsync = vi.fn(
  async (_tool: unknown, _ctx: unknown, _args: unknown): Promise<PolicyDecision> => ({
    decision: "allow",
    ruleId: null,
  }),
);
vi.mock("@/lib/policy", () => ({
  evaluatePolicyAsync: (tool: unknown, ctx: unknown, args: unknown) =>
    evaluatePolicyAsync(tool, ctx, args),
}));

const scopeDenialReason = vi.fn(
  (_tool: unknown, _scopes?: Array<string | undefined>): string | null => null,
);
vi.mock("@/lib/mcp/tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mcp/tools")>();
  return {
    ...actual,
    scopeDenialReason: (tool: unknown, scopes?: Array<string | undefined>) =>
      scopeDenialReason(tool, scopes),
  };
});

const execute = vi.fn(async () => ({ ok: true }));
function stubTool(): ToolDefinition {
  return {
    name: "test_tool",
    description: "stub",
    schema: undefined as never,
    requiredScope: "write",
    execute,
  } as unknown as ToolDefinition;
}

const ctx: ToolContext = {
  agentName: "test-agent",
  projectId: "p1",
  scopes: ["write"],
  ownerId: "owner-1",
  actorType: "department_agent",
};

async function load() {
  return import("@/lib/mcp/executor");
}

beforeEach(() => {
  activityLogs.length = 0;
  finishes.length = 0;
  activityId = "log-1";
  startActivity.mockClear();
  captureError.mockClear();
  queueApproval.mockClear();
  execute.mockClear();
  execute.mockResolvedValue({ ok: true });
  scopeDenialReason.mockClear();
  scopeDenialReason.mockReturnValue(null);
  evaluatePolicyAsync.mockClear();
  evaluatePolicyAsync.mockResolvedValue({ decision: "allow", ruleId: null });
});

describe("runTool audit contract", () => {
  it("denies on a scope mismatch without executing, and audits the exact actor_type", async () => {
    scopeDenialReason.mockReturnValue("requires write scope");
    const { runTool } = await load();

    const out = await runTool(stubTool(), { x: 1 }, ctx);

    expect(out.status).toBe("denied");
    expect(execute).not.toHaveBeenCalled();
    expect(activityLogs.at(-1)).toMatchObject({
      decision: "deny",
      decisionReason: "scope",
      actorType: "department_agent",
      toolName: "test_tool",
      projectId: "p1",
    });
    expect(finishes.at(-1)).toEqual([["failed", { error: "requires write scope" }]]);
  });

  it("denies on a policy deny without executing", async () => {
    evaluatePolicyAsync.mockResolvedValue({ decision: "deny", ruleId: "rule-7" });
    const { runTool } = await load();

    const out = await runTool(stubTool(), { x: 1 }, ctx);

    expect(out.status).toBe("denied");
    expect(execute).not.toHaveBeenCalled();
    expect(activityLogs.at(-1)).toMatchObject({
      decision: "deny",
      decisionReason: "rule-7",
      actorType: "department_agent",
    });
  });

  it("queues for approval and logs awaiting_approval", async () => {
    evaluatePolicyAsync.mockResolvedValue({ decision: "require_approval", ruleId: "rule-9" });
    const { runTool } = await load();

    const out = await runTool(stubTool(), { x: 1 }, ctx);

    expect(out).toEqual({ status: "queued", approvalId: "approval-log-1" });
    expect(execute).not.toHaveBeenCalled();
    expect(activityLogs.at(-1)).toMatchObject({
      status: "awaiting_approval",
      decision: "require_approval",
      decisionReason: "rule-9",
    });
    expect(queueApproval).toHaveBeenCalledWith(
      expect.objectContaining({ logId: "log-1", toolName: "test_tool", args: { x: 1 }, ctx }),
    );
  });

  it("fails without executing when the activity row never lands", async () => {
    activityId = null;
    evaluatePolicyAsync.mockResolvedValue({ decision: "require_approval", ruleId: null });
    const { runTool } = await load();

    const out = await runTool(stubTool(), {}, ctx);

    expect(out.status).toBe("failed");
    expect(execute).not.toHaveBeenCalled();
    expect(queueApproval).not.toHaveBeenCalled();
  });

  it("allows: executes, audits allow, finishes success", async () => {
    const { runTool } = await load();

    const out = await runTool(stubTool(), { zip: 2 }, ctx);

    expect(out).toEqual({ status: "success", result: { ok: true } });
    expect(execute).toHaveBeenCalledWith({ zip: 2 }, ctx);
    expect(activityLogs.at(-1)).toMatchObject({ decision: "allow", actorType: "department_agent" });
    expect(finishes.at(-1)).toEqual([["success", { ok: true }]]);
  });

  it("logs an unexpected success as failed and reports it", async () => {
    execute.mockRejectedValue(new Error("boom"));
    const { runTool } = await load();

    const out = await runTool(stubTool(), {}, ctx);

    expect(out).toMatchObject({ status: "failed", error: "boom", unexpected: true });
    expect(captureError).toHaveBeenCalledWith("tool:test_tool", expect.any(Error), {
      agentName: "test-agent",
    });
    expect(finishes.at(-1)).toEqual([["failed", { error: "boom" }]]);
  });

  it("does not treat a dbError-shaped crash as unexpected", async () => {
    execute.mockRejectedValue(new Error("Something failed. Reference: 12435d34-0000-0000-0000-000000000000"));
    const { runTool } = await load();

    const out = await runTool(stubTool(), {}, ctx);

    expect(out).toMatchObject({ status: "failed", unexpected: false });
    expect(captureError).not.toHaveBeenCalled();
  });
});