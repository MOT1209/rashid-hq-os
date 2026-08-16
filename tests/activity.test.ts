import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Activity logging is the record the whole dashboard reads from, and it is
 * deliberately non-throwing — which is exactly why its failure paths need
 * covering. A dropped row used to be invisible.
 */

const inserts: Record<string, unknown>[] = [];
let insertResult: { data: unknown; error: unknown } = { data: { id: "log-1" }, error: null };
let secondInsertResult: { data: unknown; error: unknown } | null = null;

const from = vi.fn(() => ({
  insert: (row: Record<string, unknown>) => {
    inserts.push(row);
    const result =
      inserts.length > 1 && secondInsertResult ? secondInsertResult : insertResult;
    return {
      select: () => ({ single: async () => result }),
    };
  },
  update: () => ({ eq: async () => ({ error: null }) }),
}));

vi.mock("@/lib/supabase/server", () => ({ getServiceSupabase: () => ({ from }) }));

const { startActivity, logActivity } = await import("@/lib/activity");

beforeEach(() => {
  inserts.length = 0;
  insertResult = { data: { id: "log-1" }, error: null };
  secondInsertResult = null;
  from.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("unknown project_id", () => {
  const FK = { code: "23503", message: "violates foreign key constraint" };

  it("retries unlinked so the call still appears in the feed", async () => {
    insertResult = { data: null, error: FK };
    secondInsertResult = { data: { id: "log-2" }, error: null };

    await startActivity({
      projectId: "99999999-9999-4999-8999-999999999999",
      agentName: "agent",
      toolName: "list_projects",
    });

    expect(inserts).toHaveLength(2);
    expect(inserts[1].project_id).toBeNull();
    expect(inserts[1].payload).toMatchObject({
      unknown_project_id: "99999999-9999-4999-8999-999999999999",
    });
  });

  it("does not retry when there was no project id to blame", async () => {
    insertResult = { data: null, error: FK };
    await startActivity({ agentName: "agent", toolName: "ping" });
    expect(inserts).toHaveLength(1);
  });

  it("does not retry on an unrelated database error", async () => {
    insertResult = { data: null, error: { code: "42501", message: "denied" } };
    await startActivity({
      projectId: "99999999-9999-4999-8999-999999999999",
      agentName: "agent",
      toolName: "ping",
    });
    expect(inserts).toHaveLength(1);
  });
});

describe("payload bounds", () => {
  it("truncates an oversized payload instead of storing it whole", async () => {
    const huge = { blob: "x".repeat(50_000) };
    await logActivity({
      agentName: "agent",
      toolName: "call_project_tool",
      payload: huge,
      status: "success",
    });

    const stored = inserts[0].payload as Record<string, unknown>;
    expect(stored.truncated).toBe(true);
    expect(stored.original_bytes).toBeGreaterThan(32_000);
    expect(String(stored.preview)).toHaveLength(32_000);
  });

  it("leaves a normal payload untouched", async () => {
    const payload = { project: "demo", count: 3 };
    await logActivity({
      agentName: "agent",
      toolName: "list_projects",
      payload,
      status: "success",
    });
    expect(inserts[0].payload).toEqual(payload);
  });

  it("keeps null as null", async () => {
    await logActivity({ agentName: "agent", toolName: "ping", status: "success" });
    expect(inserts[0].payload).toBeNull();
    expect(inserts[0].result).toBeNull();
  });
});
