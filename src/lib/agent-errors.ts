import "server-only";

import { captureError } from "@/lib/errors";
import type { ActorType, RunKind } from "@/types/database";

/**
 * Agent-aware error reporting.
 *
 * captureError tags an event with a free-text `context` and nothing else, so
 * a failed tool call in Sentry could not be filtered by which agent ran it,
 * which project it touched, or whether it came from the unattended cron —
 * exactly the questions asked first when an agent misbehaves.
 *
 * Tags vs. context:
 * - `scope.setTag` — indexed and searchable (`agent_name:"Dev Agent"
 *   failure_kind:timeout`), shown in the issue sidebar and usable in alert
 *   rules. Values must be short strings, so only low-cardinality or ID fields
 *   go here.
 * - `scope.setContext` — a structured, unindexed block on the event page for
 *   everything useful when reading one event but not worth searching on.
 *
 * Both are set on a *scope local to this one event* (Sentry.withScope, via
 * captureError's enricher), never with the global Sentry.setTag: the console
 * runs several tool calls concurrently inside one request, so a global tag
 * set for one call would be stamped on the next call's error too.
 */

export type AgentFailureKind = "tool_error" | "timeout" | "model_error";

export type AgentErrorContext = {
  agentName: string;
  /** Null for a model-run failure that did not happen inside a tool. */
  toolName: string | null;
  projectId: string | null | undefined;
  actorType: ActorType;
  delegationDepth: number | undefined;
  runKind?: RunKind;
  durationMs?: number;
};

const TIMEOUT_NAMES = new Set(["TimeoutError", "AbortError"]);
const TIMEOUT_CODES = new Set([
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

/**
 * AbortSignal.timeout rejects with a DOMException named TimeoutError; undici
 * and the AI SDK often wrap the real cause one or two levels down, so the
 * `cause` chain is walked (bounded — a cyclic chain must not hang reporting).
 */
export function isTimeoutError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    const record = current as { name?: unknown; code?: unknown; cause?: unknown };
    if (typeof record.name === "string" && TIMEOUT_NAMES.has(record.name)) return true;
    if (typeof record.code === "string" && TIMEOUT_CODES.has(record.code)) return true;
    current = record.cause;
  }
  return false;
}

/**
 * Reports an agent failure with searchable tags and returns the reference,
 * like captureError. `defaultKind` is what a non-timeout error counts as.
 */
export function captureAgentError(
  context: string,
  error: unknown,
  agent: AgentErrorContext,
  defaultKind: Exclude<AgentFailureKind, "timeout"> = "tool_error",
): string {
  const failureKind: AgentFailureKind = isTimeoutError(error) ? "timeout" : defaultKind;
  const delegationDepth = agent.delegationDepth ?? 0;

  return captureError(
    context,
    error,
    // Mirrored into `extra` so the server log line and the Sentry event carry
    // the same facts even with Sentry disabled.
    { agentName: agent.agentName, toolName: agent.toolName, failureKind },
    (scope) => {
      scope.setTag("agent_name", agent.agentName);
      scope.setTag("tool_name", agent.toolName ?? "none");
      scope.setTag("project_id", agent.projectId ?? "none");
      scope.setTag("actor_type", agent.actorType);
      scope.setTag("delegation_depth", String(delegationDepth));
      scope.setTag("failure_kind", failureKind);

      scope.setContext("agent", {
        agent_name: agent.agentName,
        tool_name: agent.toolName,
        project_id: agent.projectId ?? null,
        actor_type: agent.actorType,
        delegation_depth: delegationDepth,
        run_kind: agent.runKind ?? null,
        duration_ms: agent.durationMs ?? null,
      });

      if (failureKind === "timeout") {
        // A remote timeout is an upstream condition, not a bug in this code.
        scope.setLevel("warning");
        // Timeouts all throw from inside undici, so the default stack-based
        // grouping would fold every tool's timeouts into one issue. One issue
        // per tool keeps "call_project_tool is timing out" distinguishable.
        scope.setFingerprint(["agent-timeout", agent.toolName ?? "model"]);
      }
    },
  );
}
