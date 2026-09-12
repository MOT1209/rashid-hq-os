import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The approval queue is the human half of the policy gate: a call the policy
 * marked require_approval sits here until an admin decides. Approving must
 * run the tool for real without re-checking the policy (a human already made
 * the call); rejecting must never touch execute() at all.
 */

type Result = { data?: unknown; error?: unknown };
let approvalRow: Record<string, unknown> | null = null;
let insertResult: Result = { data: { id: "approval-1" }, error: null };
const updates: Record<string, unknown>[] = [];

function builder(table: string) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "eq", "order", "limit"];
  for (const m of methods) chain[m] = () => chain;
  chain.insert = (row: Record<string, unknown>) => {
    void row;
    return {
      select: () => ({ single: async () => insertResult }),
    };
  };
  chain.update = (patch: Record<string, unknown>) => {
    updates.push({ table, ...patch });
    return {
      eq: () => ({
        eq: async () => ({ error: null }),
      }),
    };
  };
  chain.maybeSingle = async () => ({ data: approvalRow, error: null });
  chain.then = (resolve: (v: Result) => unknown) =>
    Promise.resolve({ data: approvalRow ? [approvalRow] : [], error: null }).then(resolve);
  return chain;
}

const from = vi.fn((table: string) => builder(table));
vi.mock("@/lib/supabase/server", () => ({ getServiceSupabase: () => ({ from }) }));

const finishActivity = vi.fn(async (_id: string, _status: string, _result: unknown) => {});
vi.mock("@/lib/activity", () => ({
  finishActivity: (id: string, status: string, result: unknown) =>
    finishActivity(id, status, result),
}));

const execute = vi.fn(async () => ({ ok: true }));
const findTool = vi.fn((name: string) =>
  name === "delete_project" ? { name: "delete_project", execute } : undefined,
);
vi.mock("@/lib/mcp/tools", () => ({ findTool: (name: string) => findTool(name) }));

const { queueApproval, listPendingApprovals, approveToolCall, rejectToolCall } = await import(
  "@/lib/approvals"
);

const CTX = { agentName: "CEO Console", ownerId: "owner-1", actorType: "person" as const };

beforeEach(() => {
  from.mockClear();
  finishActivity.mockClear();
  execute.mockClear();
  findTool.mockClear();
  updates.length = 0;
  insertResult = { data: { id: "approval-1" }, error: null };
  approvalRow = {
    id: "approval-1",
    log_id: "log-1",
    tool_name: "delete_project",
    args: { project_id: "p1" },
    ctx: CTX,
    status: "pending",
    decided_by: null,
    decided_at: null,
    created_at: new Date().toISOString(),
  };
});

describe("queueApproval", () => {
  it("inserts a row linked to the log that already carries the require_approval decision", async () => {
    const id = await queueApproval({
      logId: "log-1",
      toolName: "delete_project",
      args: { project_id: "p1" },
      ctx: CTX,
    });
    expect(id).toBe("approval-1");
  });
});

describe("listPendingApprovals", () => {
  it("returns the pending rows", async () => {
    const rows = await listPendingApprovals();
    expect(rows).toHaveLength(1);
    expect(rows[0].tool_name).toBe("delete_project");
  });
});

describe("approveToolCall", () => {
  it("runs the tool for real with the stored args and ctx, and finishes the log as success", async () => {
    const result = await approveToolCall("approval-1", "admin-1");

    expect(execute).toHaveBeenCalledWith({ project_id: "p1" }, CTX);
    expect(finishActivity).toHaveBeenCalledWith("log-1", "success", { ok: true });
    expect(result).toEqual({ status: "success", output: { ok: true } });

    const decision = updates.find((u) => u.table === "tool_approvals");
    expect(decision).toMatchObject({ status: "approved", decided_by: "admin-1" });
  });

  it("does not re-run the policy — an unknown-scope ctx still executes, because a human already decided", async () => {
    await approveToolCall("approval-1", "admin-1");
    // No scope on CTX at all; a normal runTool() call would deny this outright.
    expect(execute).toHaveBeenCalled();
  });

  it("finishes the log as failed when the tool itself throws, but still marks the approval approved", async () => {
    execute.mockRejectedValueOnce(new Error("boom"));

    const result = await approveToolCall("approval-1", "admin-1");

    expect(finishActivity).toHaveBeenCalledWith("log-1", "failed", { error: "boom" });
    expect(result.status).toBe("failed");
    const decision = updates.find((u) => u.table === "tool_approvals");
    expect(decision).toMatchObject({ status: "approved" });
  });

  it("refuses an approval that is not pending (already decided, or unknown id)", async () => {
    approvalRow = null;
    await expect(approveToolCall("approval-1", "admin-1")).rejects.toThrow(
      /not found or already decided/i,
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuses an approval for a tool that no longer exists", async () => {
    approvalRow!.tool_name = "some_removed_tool";
    await expect(approveToolCall("approval-1", "admin-1")).rejects.toThrow(/unknown tool/i);
  });
});

describe("rejectToolCall", () => {
  it("finishes the log as failed and never calls execute", async () => {
    await rejectToolCall("approval-1", "admin-1");

    expect(execute).not.toHaveBeenCalled();
    expect(finishActivity).toHaveBeenCalledWith("log-1", "failed", {
      error: "Rejected by an administrator.",
    });
    const decision = updates.find((u) => u.table === "tool_approvals");
    expect(decision).toMatchObject({ status: "rejected", decided_by: "admin-1" });
  });

  it("refuses an approval that is not pending", async () => {
    approvalRow = null;
    await expect(rejectToolCall("approval-1", "admin-1")).rejects.toThrow(
      /not found or already decided/i,
    );
  });
});
