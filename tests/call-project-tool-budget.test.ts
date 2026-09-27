import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * call_project_tool (0022) gates on the project's own token budget before
 * doing anything over the network — mirroring the department budget gate in
 * runDepartmentAgent. This pins down that a refusal happens before fetch,
 * assertSafeEndpoint, or pinnedDispatcher are ever reached.
 */

const PROJECT = "11111111-1111-4111-8111-111111111111";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const projectRow = {
  mcp_endpoint: "https://tool.example/x",
  name: "Clothing Store",
  monthly_token_budget: 100_000,
  budget_alerted_at: null as string | null,
  budget_exhausted_alerted_at: null as string | null,
};

vi.mock("@/lib/supabase/server", () => ({
  getServiceSupabase: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null }) }),
          maybeSingle: async () => ({ data: table === "projects" ? projectRow : null }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/net/safe-endpoint", () => ({
  assertSafeEndpoint: vi.fn(async (v: string) => new URL(v)),
  pinnedDispatcher: vi.fn(() => ({})),
  UnsafeEndpointError: class extends Error {},
}));

const checkProjectBudget = vi.fn();
vi.mock("@/lib/budgets", () => ({
  checkProjectBudget: (input: Record<string, unknown>) => checkProjectBudget(input),
}));

const { findTool } = await import("@/lib/mcp/tools");
const { assertSafeEndpoint } = await import("@/lib/net/safe-endpoint");

function call() {
  return findTool("call_project_tool")!.execute(
    { project_id: PROJECT, tool_name: "deploy", input: {} } as never,
    { agentName: "agent", scopes: ["read", "write"], actorType: "agent_token" },
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "{}" });
  checkProjectBudget.mockReset();
  vi.mocked(assertSafeEndpoint).mockClear();
});

describe("call_project_tool budget gate", () => {
  it("refuses before any network call once the project is over budget", async () => {
    checkProjectBudget.mockResolvedValue({
      allowed: false,
      used: 120_000,
      budget: 100_000,
      alerted: false,
    });

    await expect(call()).rejects.toThrow(/budget exceeded/i);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(assertSafeEndpoint).not.toHaveBeenCalled();
  });

  it("proceeds to the network when the project is within budget", async () => {
    checkProjectBudget.mockResolvedValue({
      allowed: true,
      used: 1_000,
      budget: 100_000,
      alerted: false,
    });

    await call();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes the project's name and budget columns to the check", async () => {
    checkProjectBudget.mockResolvedValue({ allowed: true, used: 0, budget: null, alerted: false });

    await call();

    expect(checkProjectBudget).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT,
        projectName: "Clothing Store",
        budget: 100_000,
      }),
    );
  });
});
