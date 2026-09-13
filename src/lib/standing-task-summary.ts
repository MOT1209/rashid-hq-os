import type { AgentLog } from "@/types/database";

/**
 * Reads what a standing-task run reported back out of its agent_logs row.
 *
 * The cron writes `{ summary, steps }` on success and `{ error }` on failure
 * into a jsonb column, so everything here is `unknown` until proven otherwise
 * — and until now the only way to read it was as raw JSON in the activity
 * stream. Pure, so the parsing is testable without a database.
 */

export type StandingTaskRun = {
  summary: string | null;
  error: string | null;
  steps: number | null;
  status: string;
  ranAt: string;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function standingTaskSummary(log: AgentLog | null): StandingTaskRun | null {
  if (!log) return null;

  const result = (log.result ?? {}) as Record<string, unknown>;
  return {
    summary: text(result.summary),
    error: text(result.error),
    steps: typeof result.steps === "number" ? result.steps : null,
    status: log.status,
    ranAt: log.created_at,
  };
}
