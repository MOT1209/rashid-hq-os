import { describe, expect, it } from "vitest";
import { evaluatePolicy, POLICY } from "@/lib/policy";
import type { ToolContext, ToolDefinition } from "@/lib/mcp/tools";

/**
 * The policy gate is what makes forgetting to write a rule safe rather than
 * silently permissive: a write tool with no matching rule queues for a human
 * instead of inheriting full access, and a read tool with no rule is still
 * allowed since it has nothing to leak. Everything here runs against fake
 * tools — the point is the ordering and the default, not any real tool.
 */

function fakeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: "fake_tool",
    description: "",
    schema: {} as ToolDefinition["schema"],
    requiredScope: "read",
    execute: async () => ({}) as never,
    ...overrides,
  } as ToolDefinition;
}

const PERSON: ToolContext = { agentName: "CEO Console", actorType: "person" };
const AUTONOMOUS: ToolContext = { agentName: "Dev Agent", actorType: "standing_task_routine" };

describe("evaluatePolicy defaults", () => {
  it("allows a read tool nobody wrote a rule for", () => {
    const tool = fakeTool({ name: "some_future_read_tool", requiredScope: "read" });
    expect(evaluatePolicy(tool, PERSON, {})).toEqual({ decision: "allow", ruleId: null });
  });

  it("queues a write tool nobody wrote a rule for, rather than allowing or denying it", () => {
    const tool = fakeTool({ name: "some_future_write_tool", requiredScope: "write" });
    expect(evaluatePolicy(tool, PERSON, {})).toEqual({
      decision: "require_approval",
      ruleId: null,
    });
  });
});

describe("evaluatePolicy named rules", () => {
  it("requires approval for delete_project", () => {
    const tool = fakeTool({ name: "delete_project", requiredScope: "write" });
    const result = evaluatePolicy(tool, PERSON, {});
    expect(result.decision).toBe("require_approval");
    expect(result.ruleId).toBe("delete-project-needs-approval");
  });

  it("allows the tools already guarded by ownsProject/assertSafeEndpoint", () => {
    for (const name of [
      "register_project",
      "update_project",
      "add_project_tool",
      "update_project_tool",
      "delete_project_tool",
      "call_project_tool",
      "delegate_to_department",
    ]) {
      const tool = fakeTool({ name, requiredScope: "write" });
      expect(evaluatePolicy(tool, PERSON, {}), name).toEqual({
        decision: "allow",
        ruleId: "already-guarded-writes",
      });
    }
  });

  it("read tools are never touched by the write-only rules", () => {
    const tool = fakeTool({ name: "list_projects", requiredScope: "read" });
    expect(evaluatePolicy(tool, AUTONOMOUS, {})).toEqual({ decision: "allow", ruleId: null });
  });
});

describe("standing-task-write-guard", () => {
  it("denies a write tool for the autonomous cron even if it would otherwise be allowed", () => {
    const tool = fakeTool({ name: "register_project", requiredScope: "write" });
    expect(evaluatePolicy(tool, AUTONOMOUS, {})).toEqual({
      decision: "deny",
      ruleId: "standing-task-write-guard",
    });
  });

  it("still lets the autonomous cron call a project's own tool", () => {
    const tool = fakeTool({ name: "call_project_tool", requiredScope: "write" });
    expect(evaluatePolicy(tool, AUTONOMOUS, {})).toEqual({
      decision: "allow",
      ruleId: "already-guarded-writes",
    });
  });

  it("takes priority over the delete_project approval rule — a defensive deny, not a queue no one will see", () => {
    const tool = fakeTool({ name: "delete_project", requiredScope: "write" });
    expect(evaluatePolicy(tool, AUTONOMOUS, {})).toEqual({
      decision: "deny",
      ruleId: "standing-task-write-guard",
    });
  });

  it("does not apply to a person or a department agent", () => {
    const tool = fakeTool({ name: "register_project", requiredScope: "write" });
    const departmentAgent: ToolContext = { agentName: "Dev Agent", actorType: "department_agent" };
    expect(evaluatePolicy(tool, PERSON, {}).decision).toBe("allow");
    expect(evaluatePolicy(tool, departmentAgent, {}).decision).toBe("allow");
  });
});

describe("rule ordering", () => {
  it("evaluates rules in declaration order, first match wins", () => {
    expect(POLICY[0].id).toBe("standing-task-write-guard");
    expect(POLICY[1].id).toBe("delete-project-needs-approval");
  });
});
