import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const runTool = vi.fn();
const sendEmail = vi.fn();
const runDepartmentAgent = vi.fn();
let departmentRow: unknown = { key: "dev", agent_name: "Dev Agent" };
let emailOn = true;
let owners = ["owner@example.com"];

vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/mcp/executor", () => ({ runTool: (...a: unknown[]) => runTool(...a) }));
vi.mock("@/lib/mcp/tools", () => ({
  findTool: (name: string) =>
    ({ list_projects: { name, requiredScope: "read", schema: z.object({}) }, call_project_tool: { name, requiredScope: "write", schema: z.object({ project_id: z.string(), tool_name: z.string() }) }, delete_project: { name, requiredScope: "write", schema: z.object({}) } })[name],
}));
vi.mock("@/lib/department-agent", () => ({ AUTONOMOUS_TOOLS: new Set(["list_projects", "call_project_tool"]), runDepartmentAgent: (...a: unknown[]) => runDepartmentAgent(...a) }));
vi.mock("@/lib/email", () => ({ escapeHtml: (s: string) => s.replace(/</g, "&lt;"), emailConfigured: () => emailOn, sendEmail: (...a: unknown[]) => sendEmail(...a) }));
vi.mock("@/lib/owners", () => ({ ownerEmails: () => owners }));
vi.mock("@/lib/supabase/server", () => ({
  getServiceSupabase: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: departmentRow, error: null }) }) }) }) }),
}));

const { realDeps, ALLOWED_TOOLS } = await import("@/lib/automation/runtime");
const deps = realDeps();
const automation = { id: "a", owner_id: "o", name: "Nightly", enabled: true, steps: [], max_attempts: 1, backoff_seconds: 60, notify_on_failure: true };
const run = { id: "r1", automation_id: "a", owner_id: "o", trigger: "manual", trigger_payload: {}, current_step: 0, step_results: [] } as never;
const exec = (step: unknown) => deps.executeStep(step as never, { automation, run, ctx: { trigger: {}, steps: {} } });

beforeEach(() => { runTool.mockReset(); sendEmail.mockReset(); runDepartmentAgent.mockReset(); departmentRow = { key: "dev" }; emailOn = true; owners = ["owner@example.com"]; });

describe("tool steps", () => {
  it("exposes only the unattended allowlist", () => expect(ALLOWED_TOOLS.sort()).toEqual(["call_project_tool", "list_projects"]));

  it("runs through runTool as the UNATTENDED actor with the owner's id", async () => {
    runTool.mockResolvedValue({ status: "success", result: { projects: [] }, projectId: null });
    expect(await exec({ id: "a", type: "tool", tool: "list_projects", input: {} })).toEqual({ ok: true, output: { projects: [] } });
    expect(runTool.mock.calls[0][2]).toMatchObject({ actorType: "standing_task_routine", ownerId: "o", scopes: ["read", "write"] });
  });
  it("refuses tools outside the allowlist without calling runTool", async () => {
    expect(await exec({ id: "a", type: "tool", tool: "delete_project", input: {} })).toMatchObject({ ok: false, retryable: false });
    expect(runTool).not.toHaveBeenCalled();
  });
  it("rejects invalid input before running anything", async () => {
    expect(await exec({ id: "a", type: "tool", tool: "call_project_tool", input: { project_id: 5 } })).toMatchObject({ ok: false, retryable: false });
    expect(runTool).not.toHaveBeenCalled();
  });
  it("an approval-needed call fails (automations cannot wait) and a policy denial is final", async () => {
    runTool.mockResolvedValueOnce({ status: "queued", approvalId: "x", projectId: null });
    expect(await exec({ id: "a", type: "tool", tool: "list_projects", input: {} })).toMatchObject({ ok: false, retryable: false, error: expect.stringMatching(/approval/) });
    runTool.mockResolvedValueOnce({ status: "denied", reason: "Denied by policy (project-tool-dangerous-unattended).", projectId: null });
    expect(await exec({ id: "a", type: "tool", tool: "list_projects", input: {} })).toMatchObject({ ok: false, retryable: false });
  });
  it("only READ tools are retryable after a failure (a failed write could double its effect)", async () => {
    runTool.mockResolvedValue({ status: "failed", error: "503", unexpected: false, projectId: null });
    expect(await exec({ id: "a", type: "tool", tool: "list_projects", input: {} })).toMatchObject({ retryable: true });
    expect(await exec({ id: "a", type: "tool", tool: "call_project_tool", input: { project_id: "p", tool_name: "t" } })).toMatchObject({ retryable: false });
  });
});

describe("agent steps", () => {
  it("runs the department agent in AUTONOMOUS mode", async () => {
    runDepartmentAgent.mockResolvedValue({ agent: "Dev Agent", summary: "all good", steps: 3 });
    expect(await exec({ id: "a", type: "agent", department: "dev", task: "check" })).toEqual({ ok: true, output: { summary: "all good", steps: 3 } });
    expect(runDepartmentAgent.mock.calls[0][0]).toMatchObject({ mode: "autonomous", ownerId: "o", task: "check" });
  });
  it("unknown department and agent failures are non-retryable", async () => {
    departmentRow = null;
    expect(await exec({ id: "a", type: "agent", department: "nope", task: "x" })).toMatchObject({ ok: false, retryable: false });
    departmentRow = { key: "dev" };
    runDepartmentAgent.mockRejectedValue(new Error("Monthly token budget exceeded"));
    expect(await exec({ id: "a", type: "agent", department: "dev", task: "x" })).toMatchObject({ ok: false, retryable: false, error: expect.stringMatching(/budget/) });
  });
});

describe("notify steps", () => {
  it("sends to the owners with the message escaped", async () => {
    sendEmail.mockResolvedValue(true);
    expect(await exec({ id: "n", type: "notify", subject: "Hi", message: "<b>x</b>" })).toEqual({ ok: true, output: { sent: true } });
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ to: ["owner@example.com"], subject: "[Automation] Hi" });
    expect(sendEmail.mock.calls[0][0].html).toContain("&lt;b>x");
  });
  it("fails honestly when email is not configured, instead of pretending", async () => {
    emailOn = false;
    expect(await exec({ id: "n", type: "notify", subject: "s", message: "m" })).toMatchObject({ ok: false, retryable: false });
    emailOn = true; owners = [];
    expect(await exec({ id: "n", type: "notify", subject: "s", message: "m" })).toMatchObject({ ok: false, retryable: false });
    expect(sendEmail).not.toHaveBeenCalled();
  });
  it("a send failure is retryable", async () => {
    sendEmail.mockResolvedValue(false);
    expect(await exec({ id: "n", type: "notify", subject: "s", message: "m" })).toMatchObject({ ok: false, retryable: true });
  });
});

describe("failure notification", () => {
  it("emails the owners only when enabled and configured", async () => {
    sendEmail.mockResolvedValue(true);
    await deps.onFailure({ ...automation, notify_on_failure: false } as never, run, "boom");
    expect(sendEmail).not.toHaveBeenCalled();
    await deps.onFailure(automation as never, run, "boom");
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].subject).toContain("[Automation failed] Nightly");
  });
});
