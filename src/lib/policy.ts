import "server-only";

import type { ToolContext, ToolDefinition } from "@/lib/mcp/tools";
import type { PolicyDecision } from "@/types/database";

export type PolicyRule = {
  id: string;
  description: string;
  match: (tool: ToolDefinition, ctx: ToolContext, args: unknown) => boolean;
  decision: PolicyDecision;
};

/**
 * Ordered — first match wins. A literal OpenBot-style `deny: []` default
 * would break every write tool that already runs safely today behind
 * ownsProject/assertSafeEndpoint, so this is additive: explicit allow rules
 * for what is already safe, one explicit require_approval for the one
 * irreversible action, one defensive deny for the unattended cron, and a
 * fail-safe (not fail-closed-to-nothing) default below for anything no rule
 * names.
 */
export const POLICY: PolicyRule[] = [
  {
    id: "standing-task-write-guard",
    description:
      "The daily standing-task cron runs with no human watching and its context includes text it does not control. Defense in depth alongside the AUTONOMOUS_TOOLS allowlist in department-agent.ts: no write beyond calling a project's own registered tool.",
    match: (tool, ctx) =>
      ctx.actorType === "standing_task_routine" &&
      tool.requiredScope === "write" &&
      tool.name !== "call_project_tool",
    decision: "deny",
  },
  {
    id: "delete-project-needs-approval",
    description:
      "Irreversible, and cascades to project_tools, agent_tokens and agent_logs (tools.ts) — the one write worth a human's eyes before it runs.",
    match: (tool) => tool.name === "delete_project",
    decision: "require_approval",
  },
  {
    id: "already-guarded-writes",
    description:
      "Safe today behind ownsProject/assertSafeEndpoint (src/lib/mcp/tools.ts): explicit allow so this gate does not re-litigate checks that already exist.",
    match: (tool) =>
      (
        [
          "register_project",
          "update_project",
          "add_project_tool",
          "update_project_tool",
          "delete_project_tool",
          "call_project_tool",
          "delegate_to_department",
        ] as string[]
      ).includes(tool.name),
    decision: "allow",
  },
];

/**
 * Evaluated inside src/lib/mcp/executor.ts, after the scope check passes and
 * before execute() runs.
 *
 * The default when no rule matches is the fail-safe part: a read tool nobody
 * wrote a rule for still has nothing to leak, so it is allowed; a write tool
 * nobody wrote a rule for does not silently inherit full access (today's
 * behavior for any write tool) and is not silently denied either — it queues
 * for a human, which is the safe default for a policy author who forgot it
 * existed.
 */
export function evaluatePolicy(
  tool: ToolDefinition,
  ctx: ToolContext,
  args: unknown,
): { decision: PolicyDecision; ruleId: string | null } {
  for (const rule of POLICY) {
    if (rule.match(tool, ctx, args)) return { decision: rule.decision, ruleId: rule.id };
  }
  return {
    decision: tool.requiredScope === "read" ? "allow" : "require_approval",
    ruleId: null,
  };
}
