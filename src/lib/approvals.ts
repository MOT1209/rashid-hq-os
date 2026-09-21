import "server-only";

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
  created_at: string;
};

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
    })
    .select("id")
    .single();
  if (error) throw dbError("queueApproval", error);
  return (data as { id: string }).id;
}

export async function listPendingApprovals(): Promise<ToolApproval[]> {
  const { data, error } = await getServiceSupabase()
    .from("tool_approvals")
    .select("*")
    .eq("status", "pending")
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
    output = await tool.execute(approval.args as never, approval.ctx);
  } catch (error) {
    status = "failed";
    output = { error: error instanceof Error ? error.message : "The tool failed unexpectedly." };
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
