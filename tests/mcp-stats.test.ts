import { describe, expect, it } from "vitest";
import { failureRate, statsKey, summariseCalls } from "@/lib/mcp/stats";

const row = (over: Record<string, unknown>) => ({ project_id: "p1", status: "success", decision: "allow", created_at: "2026-01-01T00:00:00Z", payload: { tool_name: "deploy" }, ...over }) as never;

describe("summariseCalls", () => {
  it("buckets by project+tool and classifies outcomes", () => {
    const m = summariseCalls([
      row({}), row({ status: "failed", created_at: "2026-01-02T00:00:00Z", result: { error: "boom" } }),
      row({ status: "failed", decision: "deny", created_at: "2026-01-03T00:00:00Z" }),
      row({ status: "awaiting_approval", decision: "require_approval", created_at: "2026-01-04T00:00:00Z" }),
      row({ payload: { tool_name: "other" } }), row({ project_id: null }), row({ payload: {} }),
    ]);
    const s = m.get(statsKey("p1", "deploy"))!;
    expect(s).toMatchObject({ calls: 4, succeeded: 1, failed: 1, denied: 1, awaitingApproval: 1, lastCallAt: "2026-01-04T00:00:00Z" });
    expect(s.recent[0].status).toBe("awaiting_approval");
    expect(s.recent.find((r) => r.error)?.error).toBe("boom");
    expect(m.get(statsKey("p1", "other"))!.calls).toBe(1);
    expect(m.size).toBe(2);
  });
  it("failure rate counts only executed calls (denied/awaiting excluded)", () => {
    const m = summariseCalls([row({}), row({ status: "failed" }), row({ status: "failed", decision: "deny" })]);
    expect(failureRate(m.get(statsKey("p1", "deploy")))).toBe(0.5);
    expect(failureRate(undefined)).toBeNull();
  });
  it("limits recent calls per tool", () => {
    const rows = Array.from({ length: 9 }, (_, i) => row({ created_at: `2026-01-0${i + 1}T00:00:00Z` }));
    expect(summariseCalls(rows, 3).get(statsKey("p1", "deploy"))!.recent).toHaveLength(3);
  });
});
