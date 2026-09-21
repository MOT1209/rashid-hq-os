import "server-only";

import { captureError } from "@/lib/errors";
import type { ToolContext, ToolDefinition } from "@/lib/mcp/tools";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { PolicyDecision, PolicyRow } from "@/types/database";

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

/**
 * DB-backed evaluation (migration 0017). Reads enabled rows ordered by
 * priority — first match wins, same fail-safe default as above when nothing
 * matches. The table is cached briefly in-process; any DB error falls back
 * to the hard-coded POLICY so the gate never fails open or closed.
 *
 * This is the path src/lib/mcp/executor.ts and approveToolCall take. The
 * sync evaluatePolicy() above stays as the fallback and the unit-test seam.
 */
let policyCache: { rows: PolicyRow[]; at: number } | null = null;
const POLICY_CACHE_MS = 30_000;

export function matchDbPolicy(
  row: PolicyRow,
  tool: ToolDefinition,
  ctx: ToolContext,
): boolean {
  if (row.tool_names.length > 0 && !row.tool_names.includes(tool.name)) return false;
  if (row.actor_type !== null && ctx.actorType !== row.actor_type) return false;
  if (row.required_scope !== null && tool.requiredScope !== row.required_scope) return false;
  if (row.exclude_tool !== null && tool.name === row.exclude_tool) return false;
  return true;
}

export async function listEnabledPolicies(): Promise<PolicyRow[]> {
  const now = Date.now();
  if (policyCache && now - policyCache.at < POLICY_CACHE_MS) return policyCache.rows;
  const { data, error } = await getServiceSupabase()
    .from("policies")
    .select("*")
    .eq("enabled", true)
    .order("priority", { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as unknown as PolicyRow[];
  policyCache = { rows, at: now };
  return rows;
}

export async function evaluatePolicyAsync(
  tool: ToolDefinition,
  ctx: ToolContext,
  args: unknown,
): Promise<{ decision: PolicyDecision; ruleId: string | null }> {
  void args;
  try {
    for (const row of await listEnabledPolicies()) {
      if (matchDbPolicy(row, tool, ctx)) return { decision: row.decision, ruleId: row.id };
    }
    return {
      decision: tool.requiredScope === "read" ? "allow" : "require_approval",
      ruleId: null,
    };
  } catch (error) {
    captureError("policy:db-fallback", error);
    return evaluatePolicy(tool, ctx, args);
  }
}

/** For tests and cache invalidation after an admin edit. */
export function clearPolicyCache(): void {
  policyCache = null;
}

/** Dashboard read — all rows, enabled or not, for /dashboard/access. */
export async function listPolicies(): Promise<PolicyRow[]> {
  const { data, error } = await getServiceSupabase()
    .from("policies")
    .select("*")
    .order("priority", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as PolicyRow[];
}

/** Dashboard write — admin-only callers (see togglePolicyAction). */
export async function setPolicyEnabled(id: string, enabled: boolean): Promise<void> {
  const { error } = await getServiceSupabase().from("policies").update({ enabled }).eq("id", id);
  if (error) throw error;
  clearPolicyCache();
}
