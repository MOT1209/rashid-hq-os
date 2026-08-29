import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Department } from "@/lib/agents";

/**
 * The autonomous standing-task cron runs a department agent daily with no human
 * watching, and its context includes text it does not control (the brief,
 * third-party MCP output, raw project fields). So an autonomous run must only
 * get read tools + call_project_tool — never the registry-mutation tools that a
 * prompt injection could turn destructive.
 */

const generateText = vi.fn(
  async (_opts: { tools: Record<string, unknown> }) => ({ text: "reported back", steps: [1, 2] }),
);
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: (opts: { tools: Record<string, unknown> }) => generateText(opts),
  };
});
vi.mock("@/lib/model", () => ({ languageModel: () => "mock-model" }));
vi.mock("@/lib/activity", () => ({
  startActivity: async () => async () => {},
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
