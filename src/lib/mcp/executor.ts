import "server-only";

import { startActivity } from "@/lib/activity";
import { captureError } from "@/lib/errors";
import { queueApproval } from "@/lib/approvals";
import { evaluatePolicy } from "@/lib/policy";
import { scopeDenialReason, type ToolContext, type ToolDefinition } from "@/lib/mcp/tools";
import type { Json } from "@/types/database";

export type RunToolResult =
  | { status: "denied"; reason: string }
  | { status: "queued"; approvalId: string }
  | { status: "success"; result: Json }
  | { status: "failed"; error: string; unexpected: boolean };

/** A dbError() message already carries its own reference; anything else is an unexpected crash. */
const KNOWN_ERROR = /Reference: [0-9a-f-]{36}$/;

function projectIdFrom(ctx: ToolContext, args: Record<string, unknown>): string | null {
  return ctx.projectId ?? (typeof args.project_id === "string" ? args.project_id : null);
}

/**
 * The single place a tool call actually runs, in front of every transport.
 * Before this, each of the 4 call sites (the console, department-agent, and
 * both MCP transports) re-implemented "check scope, run execute, log the
 * result" independently — and one of them (the console) never checked scope
 * at all, relying entirely on always handing itself both scopes.
 *
 * Order: scope first (an authentication fact — does this caller carry the
 * tool's required scope at all), then policy (a governance decision — should
 * this specific call run, given who and what it is). Both a scope failure and
 * a policy "deny" end here without calling execute, and — unlike before —
 * both are now audited: a scope denial on either MCP transport used to touch
 * agent_logs not at all.
 */
export async function runTool(
  tool: ToolDefinition,
  args: unknown,
  ctx: ToolContext,
): Promise<RunToolResult> {
  const argsRecord = (args ?? {}) as Record<string, unknown>;
  const projectId = projectIdFrom(ctx, argsRecord);

  const scopeReason = scopeDenialReason(tool, ctx.scopes);
  if (scopeReason) {
    const { finish } = await startActivity({
      projectId,
      agentName: ctx.agentName,
      toolName: tool.name,
      payload: argsRecord as Json,
      decision: "deny",
      decisionReason: "scope",
      actorType: ctx.actorType,
    });
    await finish("failed", { error: scopeReason });
    return { status: "denied", reason: scopeReason };
  }

  const policy = evaluatePolicy(tool, ctx, args);

  if (policy.decision === "deny") {
    const reason = `Denied by policy${policy.ruleId ? ` (${policy.ruleId})` : ""}.`;
    const { finish } = await startActivity({
      projectId,
      agentName: ctx.agentName,
      toolName: tool.name,
      payload: argsRecord as Json,
      decision: "deny",
      decisionReason: policy.ruleId,
      actorType: ctx.actorType,
    });
    await finish("failed", { error: reason });
    return { status: "denied", reason };
  }

  if (policy.decision === "require_approval") {
    const { id } = await startActivity({
      projectId,
      agentName: ctx.agentName,
      toolName: tool.name,
      payload: argsRecord as Json,
      status: "awaiting_approval",
      decision: "require_approval",
      decisionReason: policy.ruleId,
      actorType: ctx.actorType,
    });
    if (!id) {
      // Logging is fire-and-forget-safe by design (src/lib/activity.ts): if
      // the row never landed, there is nothing for an admin to approve later,
      // so fail the call rather than queue an approval no one can ever find.
      return {
        status: "failed",
        error: "Could not queue this call for approval.",
        unexpected: true,
      };
    }
    const approvalId = await queueApproval({
      logId: id,
      toolName: tool.name,
      args: argsRecord,
      ctx,
    });
    return { status: "queued", approvalId };
  }

  const { finish } = await startActivity({
    projectId,
    agentName: ctx.agentName,
    toolName: tool.name,
    payload: argsRecord as Json,
    decision: "allow",
    decisionReason: policy.ruleId,
    actorType: ctx.actorType,
  });

  try {
    const result = await tool.execute(args as never, ctx);
    await finish("success", result);
    return { status: "success", result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The tool failed unexpectedly.";
    const unexpected = !(error instanceof Error && KNOWN_ERROR.test(error.message));
    if (unexpected) captureError(`tool:${tool.name}`, error, { agentName: ctx.agentName });
    await finish("failed", { error: message });
    return { status: "failed", error: message, unexpected };
  }
}
