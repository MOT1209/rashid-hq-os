import type { Department } from "@/lib/agents";
import type { AgentLog } from "@/types/database";

/**
 * The scheduling logic behind /api/agent/standing-tasks, kept pure so the
 * "which departments run, and when" decision is unit-testable without a
 * database or a model.
 */

/** The tool_name every standing-task summary is logged under. */
export const STANDING_TASK_TOOL = "standing_task";

/** Never run more than this many departments in one cron invocation. */
export const MAX_DEPARTMENTS_PER_RUN = 10;

/** A department is scheduled when it has a non-empty brief and is not paused. */
export function isScheduled(department: Department): boolean {
  return department.standing_task_enabled && (department.standing_task ?? "").trim().length > 0;
}

export function scheduledDepartments(departments: Department[]): Department[] {
  return departments.filter(isScheduled).slice(0, MAX_DEPARTMENTS_PER_RUN);
}

/**
 * True if this department already had a standing-task run recorded on the same
 * UTC day as `now`. The cron is daily, but Vercel can deliver a cron more than
 * once; this keeps a redelivery from spending a second run's worth of credit.
 */
export function ranOnDay(
  logs: Pick<AgentLog, "agent_name" | "tool_name" | "created_at">[],
  agentName: string,
  now: Date,
): boolean {
  const day = now.toISOString().slice(0, 10);
  return logs.some(
    (log) =>
      log.agent_name === agentName &&
      log.tool_name === STANDING_TASK_TOOL &&
      log.created_at.slice(0, 10) === day,
  );
}
