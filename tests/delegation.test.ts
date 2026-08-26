import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Delegation is the first thing in this console that can spend money on its
 * own: a tool call that starts another model run. The guard that matters is
 * depth — an agent that can delegate to an agent that delegates again has no
 * natural stopping point, and the failure mode is a bill rather than an error.
 */

const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ getServiceSupabase: () => ({ from }) }));
vi.mock("@/lib/net/safe-endpoint", () => ({
  assertSafeEndpoint: vi.fn(async (url: string) => new URL(url)),
  UnsafeEndpointError: class extends Error {},
}));

const runDepartmentAgent = vi.fn(async () => ({
  agent: "Dev Agent",
  summary: "done",
  steps: 2,
}));
vi.mock("@/lib/department-agent", () => ({
  runDepartmentAgent: (...args: unknown[]) => runDepartmentAgent(...(args as [])),
}));

const { TOOLS, findTool } = await import("@/lib/mcp/tools");

type Tool = NonNullable<ReturnType<typeof findTool>>;
const tool = (name: string) => findTool(name) as Tool;

/** A Supabase query builder stub: every chained call returns itself. */
function stubQuery(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit"]) chain[method] = () => chain;
  chain.maybeSingle = async () => result;
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

const DEV = {
  key: "dev",
  agent_name: "Dev Agent",
  system_prompt: "You are the Dev Agent.",
  model: null,
};

beforeEach(() => {
  from.mockReset();
  runDepartmentAgent.mockClear();
});

describe("delegate_to_department", () => {
  it("runs the department's agent and returns what it reports", async () => {
    from.mockImplementationOnce(() => stubQuery({ data: DEV, error: null }));

    const result = await tool("delegate_to_department").execute(
      { department_key: "dev", task: "review the dev projects" } as never,
      { agentName: "CEO Console", ownerId: "owner-1", delegationDepth: 0 },
    );

    expect(result).toEqual({ agent: "Dev Agent", summary: "done", steps: 2 });
    expect(runDepartmentAgent).toHaveBeenCalledWith(
      expect.objectContaining({ task: "review the dev projects", ownerId: "owner-1" }),
    );
  });

  it("refuses a second level of delegation", async () => {
    await expect(
      tool("delegate_to_department").execute(
        { department_key: "dev", task: "delegate again" } as never,
        // What a department agent's own context looks like.
        { agentName: "Dev Agent", ownerId: "owner-1", delegationDepth: 1 },
      ),
    ).rejects.toThrow(/one level deep/i);

    // Refused before the lookup, so no model run and no query.
    expect(runDepartmentAgent).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("reports an unknown department key instead of failing obscurely", async () => {
    from.mockImplementationOnce(() => stubQuery({ data: null, error: null }));

    await expect(
      tool("delegate_to_department").execute(
        { department_key: "nope", task: "x" } as never,
        { agentName: "CEO Console", ownerId: "owner-1", delegationDepth: 0 },
      ),
    ).rejects.toThrow(/no department with key "nope"/i);
    expect(runDepartmentAgent).not.toHaveBeenCalled();
  });

  it("treats a missing depth as the top of the chain", async () => {
    // An older caller that predates delegationDepth must still work, not be
    // locked out of delegating.
    from.mockImplementationOnce(() => stubQuery({ data: DEV, error: null }));

    await tool("delegate_to_department").execute(
      { department_key: "dev", task: "x" } as never,
      { agentName: "CEO Console", ownerId: "owner-1" },
    );

    expect(runDepartmentAgent).toHaveBeenCalled();
  });

  it("needs the write scope", () => {
    expect(tool("delegate_to_department").requiredScope).toBe("write");
  });
});

describe("list_departments", () => {
  it("does not expose one agent's instructions to another", async () => {
    // select() is what enforces this, so assert on the columns asked for.
    const select = vi.fn(() => ({ order: () => ({ data: [], error: null }) }));
    from.mockImplementationOnce(() => ({ select }));

    await tool("list_departments").execute({} as never, { agentName: "CEO Console" });

    expect(select).toHaveBeenCalledWith(expect.not.stringContaining("system_prompt"));
  });
});

describe("the tool registry", () => {
  it("exposes delegation exactly once", () => {
    expect(TOOLS.filter((t) => t.name === "delegate_to_department")).toHaveLength(1);
  });

  it("gives every tool a scope", () => {
    for (const t of TOOLS) {
      expect(["read", "write"], t.name).toContain(t.requiredScope);
    }
  });
});
