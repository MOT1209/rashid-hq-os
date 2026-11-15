/**
 * Per-tool permission policy for project MCP tools (pure; migration 0028).
 *
 * Applied by evaluatePolicyAsync for call_project_tool, BEFORE the generic
 * policy rows, both when a call is first made and again when an owner approves
 * a queued one (so disabling a tool also blocks calls already waiting).
 */

export type ToolPermission = "read" | "write" | "dangerous";

export type ProjectToolPolicyRow = {
  enabled: boolean;
  permission: ToolPermission | string;
  requires_approval: boolean;
};

export type ToolDecision = { decision: "deny" | "require_approval"; ruleId: string };

export const PERMISSIONS: ToolPermission[] = ["read", "write", "dangerous"];
export const isPermission = (v: unknown): v is ToolPermission => typeof v === "string" && (PERMISSIONS as string[]).includes(v);

/**
 * Returns a restricting decision, or null to fall through to the generic rules
 * (i.e. today's behaviour for plain enabled read/write tools).
 */
export function decideProjectTool(row: ProjectToolPolicyRow | null, actorType: string | null | undefined): ToolDecision | null {
  if (!row) return null;
  if (!row.enabled) return { decision: "deny", ruleId: "project-tool-disabled" };
  // Unknown permission strings are treated as the most restrictive class.
  const permission = isPermission(row.permission) ? row.permission : "dangerous";
  if (permission === "dangerous") {
    // Nobody is watching a cron run, so a dangerous tool simply does not run there.
    if (actorType === "standing_task_routine") return { decision: "deny", ruleId: "project-tool-dangerous-unattended" };
    return { decision: "require_approval", ruleId: "project-tool-dangerous" };
  }
  if (row.requires_approval) return { decision: "require_approval", ruleId: "project-tool-requires-approval" };
  return null;
}

/** Only read-class, enabled tools may be fired by the "test" button: a test sends empty input, which could trigger a write. */
export function testAllowed(row: Pick<ProjectToolPolicyRow, "enabled" | "permission">): { ok: true } | { ok: false; reason: string } {
  if (!row.enabled) return { ok: false, reason: "This tool is disabled." };
  if (row.permission !== "read") return { ok: false, reason: "Only read-class tools can be tested: a test calls the tool with empty input, which could change data." };
  return { ok: true };
}
