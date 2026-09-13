import { describe, expect, it } from "vitest";
import { standingTaskSummary } from "@/lib/standing-task-summary";
import type { AgentLog } from "@/types/database";

/**
 * The cron writes its report into a jsonb column, so everything read back is
 * `unknown` — the department page must not blow up on a row shaped by an older
 * version of the cron, or by a model that returned nothing.
 */

function log(result: unknown, status = "success"): AgentLog {
  return {
    id: "log-1",
    project_id: null,
    agent_name: "Dev Agent",
    tool_name: "standing_task",
    payload: null,
    result: result as AgentLog["result"],
    status: status as AgentLog["status"],
    created_at: "2026-09-13T07:00:00.000Z",
    decision: null,
    decision_reason: null,
    actor_type: null,
  };
}

describe("standingTaskSummary", () => {
  it("reads the summary and step count from a successful run", () => {
    const run = standingTaskSummary(log({ summary: "All projects responded.", steps: 3 }));

    expect(run).toMatchObject({
      summary: "All projects responded.",
      steps: 3,
      error: null,
      status: "success",
    });
  });

  it("reads the message from a failed run", () => {
    const run = standingTaskSummary(log({ error: "provider unavailable" }, "failed"));

    expect(run?.error).toBe("provider unavailable");
    expect(run?.summary).toBeNull();
  });

  it("returns null when the department has never run one", () => {
    expect(standingTaskSummary(null)).toBeNull();
  });

  it("treats a blank or wrongly-typed field as absent instead of rendering it", () => {
    const run = standingTaskSummary(log({ summary: "   ", steps: "3" }));

    expect(run?.summary).toBeNull();
    expect(run?.steps).toBeNull();
  });

  it("survives a row with no result at all", () => {
    const run = standingTaskSummary(log(null));

    expect(run).toMatchObject({ summary: null, error: null, steps: null });
  });
});
