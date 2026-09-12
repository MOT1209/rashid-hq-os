import "server-only";

import { finishActivity } from "@/lib/activity";
import { dbError } from "@/lib/errors";
import { findTool, type ToolContext } from "@/lib/mcp/tools";
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
 * Runs a queued write for real. The policy already decided this call needed
 * a human; an admin acting here *is* that decision, so — unlike a normal
 * runTool() call — this does not re-evaluate the policy.
 */
export async function approveToolCall(id: string, decidedBy: string) {
  const approval = await loadPending(id);
  if (!approval) throw new Error("Approval not found or already decided.");

  const tool = findTool(approval.tool_name);
  if (!tool) throw new Error(`Unknown tool: ${approval.tool_name}`);

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
