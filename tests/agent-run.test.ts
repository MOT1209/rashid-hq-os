import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * agent_runs is the spend ledger nothing else writes: one row per model
 * invocation (console/delegation/standing_task). Like activity.ts, it must
 * never throw back into the run it is trying to measure — a dropped row is
 * a Sentry event, not a crash.
 */

const inserts: Record<string, unknown>[] = [];
let insertResult: { error: unknown } = { error: null };

const from = vi.fn(() => ({
  insert: (row: Record<string, unknown>) => {
    inserts.push(row);
    return Promise.resolve(insertResult);
  },
}));
vi.mock("@/lib/supabase/server", () => ({ getServiceSupabase: () => ({ from }) }));

const captureError = vi.fn((_context: string, _error: unknown, _extra?: unknown) => "ref-1");
vi.mock("@/lib/errors", () => ({
  captureError: (context: string, error: unknown, extra?: unknown) =>
    captureError(context, error, extra),
}));

const { recordAgentRun } = await import("@/lib/agent-run");

beforeEach(() => {
  inserts.length = 0;
  insertResult = { error: null };
  from.mockClear();
  captureError.mockClear();
});

describe("recordAgentRun", () => {
  it("inserts one row with the given kind, tokens, duration, steps and status", async () => {
    await recordAgentRun({
      agentName: "CEO Console",
      kind: "console",
      tokensIn: 100,
      tokensOut: 25,
      durationMs: 1500,
      stepCount: 3,
      status: "success",
    });

    expect(inserts).toEqual([
      {
        agent_name: "CEO Console",
        kind: "console",
        tokens_in: 100,
        tokens_out: 25,
        duration_ms: 1500,
        step_count: 3,
        status: "success",
      },
    ]);
  });

  it("stores missing token counts as null rather than undefined", async () => {
    await recordAgentRun({
      agentName: "Dev Agent",
      kind: "standing_task",
      durationMs: 200,
      stepCount: 0,
      status: "failed",
    });

    expect(inserts[0].tokens_in).toBeNull();
    expect(inserts[0].tokens_out).toBeNull();
  });

  it("never throws — a failed insert is reported to Sentry, not to the caller", async () => {
    insertResult = { error: { message: "connection refused" } };

    await expect(
      recordAgentRun({
        agentName: "Dev Agent",
        kind: "delegation",
        durationMs: 50,
        stepCount: 1,
        status: "success",
      }),
    ).resolves.toBeUndefined();

    expect(captureError).toHaveBeenCalledWith(
      "agent-run:record",
      { message: "connection refused" },
      { agentName: "Dev Agent", kind: "delegation" },
    );
  });
});
