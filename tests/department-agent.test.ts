import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Department } from "@/lib/agents";

/**
 * The autonomous standing-task cron runs a department agent daily with no human
 * watching, and its context includes text it does not control (the brief,
 * third-party MCP output, raw project fields). So an autonomous run must only
 * get read tools + call_project_tool — never the registry-mutation tools that a
 * prompt injection could turn destructive.
 */

const generateText = vi.fn(async (_opts: { tools: Record<string, unknown> }) => ({
  text: "reported back",
  steps: [1, 2],
  usage: { inputTokens: 120, outputTokens: 40 },
}));
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: (opts: { tools: Record<string, unknown> }) => generateText(opts),
  };
});
vi.mock("@/lib/model", () => ({ languageModel: () => "mock-model" }));
vi.mock("@/lib/activity", () => ({
  startActivity: async () => ({ id: "log-1", finish: async () => {} }),
}));

const recordAgentRun = vi.fn(async (_input: Record<string, unknown>) => {});
vi.mock("@/lib/agent-run", () => ({
  recordAgentRun: (input: Record<string, unknown>) => recordAgentRun(input),
}));

// Budgets are covered in tests/budgets.test.ts; here the gate stays open
// unless a test says otherwise — and must never touch the network.
const checkDepartmentBudget = vi.fn(async (_input: Record<string, unknown>) => ({
  allowed: true,
  used: 0,
  budget: null,
  alerted: false,
}));
vi.mock("@/lib/budgets", () => ({
  checkDepartmentBudget: (input: Record<string, unknown>) => checkDepartmentBudget(input),
}));

const { runDepartmentAgent } = await import("@/lib/department-agent");

function dept(overrides: Partial<Department> = {}): Department {
  return {
    key: "dev",
    name_ar: "",
    name_en: "",
    agent_name: "Dev Agent",
    agent_label_ar: "",
    agent_label_en: "",
    icon: "",
    is_fallback: false,
    sort_order: 0,
    system_prompt: "",
    model: null,
    standing_task: null,
    standing_task_enabled: true,
    monthly_token_budget: null,
    budget_alerted_at: null,
    ...overrides,
  };
}

/** The tool names generateText was handed on the last call. */
function toolNames(): string[] {
  const [opts] = generateText.mock.calls.at(-1) ?? [];
  return Object.keys(opts?.tools ?? {}).sort();
}

const REGISTRY_MUTATION = [
  "register_project",
  "update_project",
  "delete_project",
  "add_project_tool",
  "update_project_tool",
  "delete_project_tool",
];

beforeEach(() => {
  generateText.mockClear();
  recordAgentRun.mockClear();
  checkDepartmentBudget.mockClear();
});

describe("runDepartmentAgent tool exposure", () => {
  it("interactive mode (default) exposes the full toolset minus delegate", async () => {
    await runDepartmentAgent({ department: dept(), task: "do it", ownerId: "o1" });
    const names = toolNames();
    expect(names).not.toContain("delegate_to_department");
    for (const t of REGISTRY_MUTATION) expect(names).toContain(t);
    expect(names).toContain("call_project_tool");
  });

  it("autonomous mode withholds every registry-mutation tool", async () => {
    await runDepartmentAgent({
      department: dept(),
      task: "check the projects",
      ownerId: "o1",
      mode: "autonomous",
    });
    const names = toolNames();
    for (const t of REGISTRY_MUTATION) expect(names).not.toContain(t);
    expect(names).not.toContain("delegate_to_department");
  });

  it("autonomous mode still allows reads and call_project_tool", async () => {
    await runDepartmentAgent({
      department: dept(),
      task: "check the projects",
      ownerId: "o1",
      mode: "autonomous",
    });
    const names = toolNames();
    expect(names).toEqual(
      [
        "call_project_tool",
        "get_project",
        "get_skill",
        "list_categories",
        "list_departments",
        "list_integrations",
        "list_projects",
        "list_recent_logs",
        "list_skills",
      ].sort(),
    );
  });

  it("returns the model's text as the summary and the step count", async () => {
    const run = await runDepartmentAgent({ department: dept(), task: "x", ownerId: "o1" });
    expect(run).toEqual({ agent: "Dev Agent", summary: "reported back", steps: 2 });
  });
});

describe("runDepartmentAgent cost tracking (agent_runs)", () => {
  it("records a 'delegation' run for an interactive call, with tokens and steps from the model result", async () => {
    await runDepartmentAgent({ department: dept(), task: "do it", ownerId: "o1" });

    expect(recordAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        agentName: "Dev Agent",
        kind: "delegation",
        tokensIn: 120,
        tokensOut: 40,
        stepCount: 2,
        status: "success",
      }),
    );
  });

  it("records a 'standing_task' run for an autonomous call", async () => {
    await runDepartmentAgent({
      department: dept(),
      task: "check the projects",
      ownerId: "o1",
      mode: "autonomous",
    });

    expect(recordAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "standing_task", status: "success" }),
    );
  });

  it("records a failed run and rethrows when the model call itself throws", async () => {
    generateText.mockRejectedValueOnce(new Error("provider unavailable"));

    await expect(
      runDepartmentAgent({ department: dept(), task: "x", ownerId: "o1" }),
    ).rejects.toThrow("provider unavailable");

    expect(recordAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "delegation", status: "failed", stepCount: 0 }),
    );
  });
});

describe("runDepartmentAgent budget gate", () => {
  it("refuses to start when the department is over budget, before any model call", async () => {
    checkDepartmentBudget.mockResolvedValueOnce({
      allowed: false,
      used: 120_000,
      budget: 100_000,
      alerted: false,
    });

    await expect(
      runDepartmentAgent({
        department: dept({ monthly_token_budget: 100_000 }),
        task: "x",
        ownerId: "o1",
      }),
    ).rejects.toThrow(/budget exceeded/i);

    expect(generateText).not.toHaveBeenCalled();
  });

  it("passes the department's budget columns to the check", async () => {
    await runDepartmentAgent({
      department: dept({ monthly_token_budget: 50_000, budget_alerted_at: "2026-09-01T00:00:00Z" }),
      task: "x",
      ownerId: "o1",
    });

    expect(checkDepartmentBudget).toHaveBeenCalledWith(
      expect.objectContaining({
        agentName: "Dev Agent",
        departmentKey: "dev",
        budget: 50_000,
        alertedAt: "2026-09-01T00:00:00Z",
      }),
    );
  });
});
