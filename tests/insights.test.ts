import { describe, expect, it } from "vitest";
import { summariseRuns, type RunRow } from "@/lib/insights";

/**
 * The aggregation behind /dashboard/insights. The parts worth pinning are the
 * ones a dashboard silently lies about when they are wrong: null token counts,
 * a window that must show empty days, and rows that fall outside it.
 */

const NOW = new Date("2026-09-13T12:00:00.000Z");

function run(overrides: Partial<RunRow> = {}): RunRow {
  return {
    agent_name: "CEO Console",
    kind: "console",
    tokens_in: 100,
    tokens_out: 20,
    duration_ms: 1000,
    status: "success",
    created_at: "2026-09-13T09:00:00.000Z",
    ...overrides,
  };
}

describe("summariseRuns totals", () => {
  it("sums tokens and averages duration", () => {
    const result = summariseRuns(
      [run(), run({ tokens_in: 50, tokens_out: 5, duration_ms: 3000 })],
      7,
      NOW,
    );

    expect(result.runs).toBe(2);
    expect(result.tokensIn).toBe(150);
    expect(result.tokensOut).toBe(25);
    expect(result.avgDurationMs).toBe(2000);
  });

  it("counts a null token column as zero rather than dropping the run", () => {
    const result = summariseRuns([run({ tokens_in: null, tokens_out: null })], 7, NOW);

    expect(result.runs).toBe(1);
    expect(result.tokensIn).toBe(0);
    expect(result.byKind.find((b) => b.key === "console")?.tokens).toBe(0);
  });

  it("reports a failure rate in whole percent, and 0 for an empty window", () => {
    expect(summariseRuns([run(), run({ status: "failed" })], 7, NOW).failureRate).toBe(50);
    expect(summariseRuns([], 7, NOW).failureRate).toBe(0);
    expect(summariseRuns([], 7, NOW).avgDurationMs).toBe(0);
  });
});

describe("summariseRuns buckets", () => {
  it("keeps a row for every kind, including the ones that never ran", () => {
    const result = summariseRuns([run()], 7, NOW);

    expect(result.byKind.map((b) => b.key).sort()).toEqual([
      "console",
      "delegation",
      "standing_task",
    ]);
    expect(result.byKind.find((b) => b.key === "standing_task")).toMatchObject({
      runs: 0,
      tokens: 0,
    });
  });

  it("orders agents by spend, heaviest first", () => {
    const result = summariseRuns(
      [
        run({ agent_name: "Dev Agent", tokens_in: 10, tokens_out: 0 }),
        run({ agent_name: "CEO Console", tokens_in: 900, tokens_out: 100 }),
      ],
      7,
      NOW,
    );

    expect(result.byAgent.map((b) => b.key)).toEqual(["CEO Console", "Dev Agent"]);
    expect(result.byAgent[0].tokens).toBe(1000);
  });
});

describe("summariseRuns window", () => {
  it("returns one bucket per day, oldest first, even on days with no runs", () => {
    const result = summariseRuns([run()], 7, NOW);

    expect(result.byDay).toHaveLength(7);
    expect(result.byDay[0].key).toBe("2026-09-07");
    expect(result.byDay[6].key).toBe("2026-09-13");
    expect(result.byDay[6].runs).toBe(1);
    expect(result.byDay[0].runs).toBe(0);
  });

  it("still counts a row older than the window in the totals, just not in the trend", () => {
    const result = summariseRuns([run({ created_at: "2020-01-01T00:00:00.000Z" })], 7, NOW);

    expect(result.runs).toBe(1);
    expect(result.tokensIn).toBe(100);
    expect(result.byDay.every((day) => day.runs === 0)).toBe(true);
  });
});
