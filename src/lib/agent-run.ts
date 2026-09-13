import "server-only";

import { captureError } from "@/lib/errors";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { RunKind, RunStatus } from "@/types/database";

type RecordAgentRunInput = {
  agentName: string;
  kind: RunKind;
  tokensIn?: number | null;
  tokensOut?: number | null;
  durationMs: number;
  stepCount: number;
  status: RunStatus;
};

/**
 * One row per model invocation — a console turn, a delegated department run,
 * or a standing-task run (the three places a generateText/streamText call
 * happens; migration 0016). agent_logs records what a *tool* did; this is
 * the spend ledger for what a *model run* cost, which nothing reads today
 * even though agents spend credit daily.
 *
 * Fire-and-forget-safe like src/lib/activity.ts: a dropped row must never
 * break the run it was trying to measure, so failures here are swallowed.
 */
export async function recordAgentRun(input: RecordAgentRunInput): Promise<void> {
  const { error } = await getServiceSupabase().from("agent_runs").insert({
    agent_name: input.agentName,
    kind: input.kind,
    tokens_in: input.tokensIn ?? null,
    tokens_out: input.tokensOut ?? null,
    duration_ms: input.durationMs,
    step_count: input.stepCount,
    status: input.status,
  });
  if (error) {
    captureError("agent-run:record", error, { agentName: input.agentName, kind: input.kind });
  }
}
