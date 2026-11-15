import { beforeEach, describe, expect, it, vi } from "vitest";

const runDepartmentAgent = vi.fn();
const createAgent = vi.fn();
const saveConfig = vi.fn();
const deleteCustomAgent = vi.fn();
let departments: { key: string; agent_name: string }[] = [];

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireAdmin: async () => ({ user: { id: "owner-1" } }) }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock("@/lib/errors", () => ({ safeMessage: (c: string) => `${c} failed.` }));
vi.mock("@/lib/department-agent", () => ({ runDepartmentAgent: (...a: unknown[]) => runDepartmentAgent(...a) }));
vi.mock("@/lib/agent-admin", () => ({
  createAgent: (...a: unknown[]) => createAgent(...a), saveConfig: (...a: unknown[]) => saveConfig(...a), deleteCustomAgent: (...a: unknown[]) => deleteCustomAgent(...a),
}));
vi.mock("@/lib/mcp/tools", () => ({ TOOLS: [{ name: "list_projects" }, { name: "update_project" }, { name: "delegate_to_department" }] }));
vi.mock("@/lib/queries", () => ({
  fetchDepartments: async () => departments,
  fetchProjectOptions: async () => [{ id: "p1", name: "P1" }],
}));

const { createAgentAction, saveAgentConfigAction, testAgentAction, deleteAgentAction } = await import("@/app/dashboard/agents/actions");

beforeEach(() => {
  runDepartmentAgent.mockReset(); createAgent.mockReset(); saveConfig.mockReset(); deleteCustomAgent.mockReset();
  departments = [{ key: "dev", agent_name: "Dev Agent" }];
});

describe("createAgentAction", () => {
  const good = { key: "support", name_en: "Support", name_ar: "الدعم", agent_name: "Support Agent", system_prompt: "help" };
  it("creates a valid agent", async () => {
    expect(await createAgentAction(good)).toEqual({ ok: true, key: "support" });
    expect(createAgent).toHaveBeenCalledWith(expect.objectContaining({ key: "support", icon: "🤖" }));
  });
  it("rejects duplicates and invalid input without touching the database", async () => {
    expect(await createAgentAction({ ...good, key: "dev" })).toMatchObject({ ok: false });
    expect(await createAgentAction({})).toMatchObject({ ok: false });
    expect(createAgent).not.toHaveBeenCalled();
  });
});

describe("saveAgentConfigAction", () => {
  it("saves a valid config (null tools = all)", async () => {
    expect(await saveAgentConfigAction("dev", { enabled: true, read_only: true, allowed_tools: null, project_ids: ["p1"] })).toEqual({ ok: true });
    expect(saveConfig).toHaveBeenCalledWith("dev", { enabled: true, read_only: true, allowed_tools: null, project_ids: ["p1"] });
  });
  it("rejects unknown tools, the delegation tool, unknown projects and unknown agents", async () => {
    for (const bad of [{ allowed_tools: ["nope"] }, { allowed_tools: ["delegate_to_department"] }, { project_ids: ["not-mine"] }]) {
      expect(await saveAgentConfigAction("dev", bad)).toMatchObject({ ok: false });
    }
    expect(await saveAgentConfigAction("ghost", {})).toMatchObject({ ok: false });
    expect(saveConfig).not.toHaveBeenCalled();
  });
});

describe("testAgentAction", () => {
  it("runs a real model run but FORCES read-only tools", async () => {
    runDepartmentAgent.mockResolvedValue({ agent: "Dev Agent", summary: "I can read.", steps: 2 });
    const r = await testAgentAction("dev");
    expect(r).toMatchObject({ ok: true, summary: "I can read.", steps: 2 });
    expect(runDepartmentAgent.mock.calls[0][0]).toMatchObject({ forceReadOnly: true, ownerId: "owner-1" });
    expect(runDepartmentAgent.mock.calls[0][0].task).toMatch(/Do not change anything/);
  });
  it("reports a disabled agent or a failed run as an error, not a success", async () => {
    runDepartmentAgent.mockRejectedValue(new Error("Dev Agent is disabled. Enable it on the Agents page."));
    expect(await testAgentAction("dev")).toMatchObject({ ok: false, error: expect.stringMatching(/disabled/) });
    expect(await testAgentAction("ghost")).toMatchObject({ ok: false });
  });
});

describe("deleteAgentAction", () => {
  it("only custom agents can be deleted", async () => {
    deleteCustomAgent.mockResolvedValueOnce(false);
    expect(await deleteAgentAction("dev")).toMatchObject({ ok: false, error: expect.stringMatching(/built-in/) });
    deleteCustomAgent.mockResolvedValueOnce(true);
    expect(await deleteAgentAction("support")).toEqual({ ok: true });
  });
});
