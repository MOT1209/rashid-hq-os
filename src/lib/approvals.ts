import "server-only";

import { captureAgentError } from "@/lib/agent-errors";
import { finishActivity } from "@/lib/activity";
import { dbError } from "@/lib/errors";
import { findTool, scopeDenialReason, type ToolContext } from "@/lib/mcp/tools";
import { evaluatePolicyAsync } from "@/lib/policy";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { Json, ToolApprovalStatus } from "@/types/database";

export type ToolApproval = {
  id: string;
  log_id: string;
  tool_name: string;
  args: Record<string, unknown>;
  ctx: ToolContext;
  status: ToolApprovalStatus;
  decided_by: string | null;
  decided_at: string | null;
  expires_at: string | null;
  created_at: string;
};

/**
 * How long a queued call stays actionable (migration 0023). An admin who never
 * gets to a request should have it lapse rather than execute a weeks-old intent
 * on today's state. Seven days is long enough for a real backlog, short enough
 * that a forgotten approval does not become a latent write.
 */
const APPROVAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** A dbError() message already carries its own reference; anything else is an unexpected crash. */
const KNOWN_ERROR = /Reference: [0-9a-f-]{36}$/;

/** Called only from src/lib/mcp/executor.ts, once a policy rule has already decided to queue the call. */
export async function queueApproval(input: {
  logId: string;
  toolName: string;
  args: Record<string, unknown>;
  ctx: ToolContext;
}): Promise<string> {
  const { data, error } = await getServiceSupabase()
    .from("tool_approvals")
    .insert({
      log_id: input.logId,
      tool_name: input.toolName,
      args: input.args as Json,
      ctx: input.ctx as Json,
      expires_at: new Date(Date.now() + APPROVAL_TTL_MS).toISOString(),
    })
    .select("id")
    .single();
  if (error) throw dbError("queueApproval", error);
  return (data as { id: string }).id;
}

/** True once a queued call's expiry has passed. A null expiry (legacy row) never expires. */
function isExpired(approval: Pick<ToolApproval, "expires_at">): boolean {
  if (!approval.expires_at) return false;
  const at = Date.parse(approval.expires_at);
  return Number.isFinite(at) && at <= Date.now();
}

export async function listPendingApprovals(): Promise<ToolApproval[]> {
  const nowIso = new Date().toISOString();
  const { data, error } = await getServiceSupabase()
    .from("tool_approvals")
    .select("*")
    .eq("status", "pending")
    // Hide already-expired rows from the admin queue: they can no longer be
    // approved (approveToolCall refuses them), so showing them is misleading.
    // A null expiry (legacy, pre-0023) is still shown.
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order("created_at", { ascending: true });
  if (error) throw dbError("listPendingApprovals", error);
  return (data ?? []) as unknown as ToolApproval[];
}

async function loadPending(id: string): Promise<ToolApproval | null> {
  const { data, error } = await getServiceSupabase()
    .from("tool_approvals")
    .select("*")
    .eq("id", id)
    .eq("status", "pending")
    .maybeSingle();
  if (error) throw dbError("loadApproval", error);
  return data as unknown as ToolApproval | null;
}

/**
 * Runs a queued write for real. Unlike before, the policy AND the scope are
 * re-evaluated here against the *current* rules — not the ones stored at
 * queue time. A permission revoked (or a rule tightened to `deny`) between
 * the request and the admin's click must not execute on a stale context.
 * An admin click only satisfies `require_approval`; it never overrides a
 * `deny` or a scope failure, which land as a rejection instead.
 */
export async function approveToolCall(id: string, decidedBy: string) {
  const approval = await loadPending(id);
  if (!approval) throw new Error("Approval not found or already decided.");

  const tool = findTool(approval.tool_name);
  if (!tool) throw new Error(`Unknown tool: ${approval.tool_name}`);

  // Expired before an admin got to it: finalize as 'expired' (distinct from a
  // deliberate rejection) and refuse. Bounds the window in which a stale intent
  // can still run — see migration 0023.
  if (isExpired(approval)) {
    const reason = "This approval has expired and can no longer be run. Re-issue the request.";
    await finishActivity(approval.log_id, "failed", { error: reason });
    const { error } = await getServiceSupabase()
      .from("tool_approvals")
      .update({ status: "expired", decided_by: decidedBy, decided_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "pending");
    if (error) throw dbError("approveToolCall:expired", error);
    throw new Error(reason);
  }

  const scopeReason = scopeDenialReason(tool, approval.ctx.scopes);
  const policy = scopeReason
    ? { decision: "deny" as const, ruleId: "scope" }
    : await evaluatePolicyAsync(tool, approval.ctx, approval.args);
  if (policy.decision === "deny") {
    const reason = scopeReason ?? `Denied by policy${policy.ruleId ? ` (${policy.ruleId})` : ""}.`;
    await finishActivity(approval.log_id, "failed", { error: reason });
    const { error } = await getServiceSupabase()
      .from("tool_approvals")
      .update({ status: "rejected", decided_by: decidedBy, decided_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "pending");
    if (error) throw dbError("approveToolCall:blocked", error);
    throw new Error(reason);
  }

  let status: "success" | "failed" = "success";
  let output: Json;
  try {
    // Not routed through runTool: that would open a second agent_logs row and
    // re-enter the policy gate, which would return require_approval again and
    // re-queue this call forever. Scope + policy were just re-checked above
    // against current rules, so this is the deliberate execute step. It does,
    // however, share the executor's failure reporting so an approved tool that
    // crashes is as visible in Sentry as one that fails inline.
    output = await tool.execute(approval.args as never, approval.ctx);
  } catch (error) {
    status = "failed";
    const message = error instanceof Error ? error.message : "The tool failed unexpectedly.";
    output = { error: message };
    const unexpected = !(error instanceof Error && KNOWN_ERROR.test(error.message));
    if (unexpected) {
      captureAgentError(`approval:${approval.tool_name}`, error, {
        agentName: approval.ctx.agentName,
        toolName: approval.tool_name,
        projectId: approval.ctx.projectId,
        actorType: approval.ctx.actorType,
        delegationDepth: approval.ctx.delegationDepth,
      });
    }
  }

  await finishActivity(approval.log_id, status, output);

  const { error } = await getServiceSupabase()
    .from("tool_approvals")
    .update({ status: "approved", decided_by: decidedBy, decided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending");
  if (error) throw dbError("approveToolCall", error);

  return { status, output };
}

export async function rejectToolCall(id: string, decidedBy: string) {
  const approval = await loadPending(id);
  if (!approval) throw new Error("Approval not found or already decided.");

  await finishActivity(approval.log_id, "failed", { error: "Rejected by an administrator." });

  const { error } = await getServiceSupabase()
    .from("tool_approvals")
    .update({ status: "rejected", decided_by: decidedBy, decided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending");
  if (error) throw dbError("rejectToolCall", error);
}
