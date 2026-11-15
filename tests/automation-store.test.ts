import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/errors", () => ({ dbError: (c: string) => new Error(c) }));

type Op = { table: string; op: string; payload?: unknown; filters: Record<string, unknown> };
let ops: Op[] = [];
let dueRows: unknown[] = [];
let claimResult: unknown[] = [{ id: "a1" }];
let runCount = 0;
let insertError: unknown = null;
let eventAutomations: unknown[] = [];

vi.mock("@/lib/supabase/server", () => ({
  getServiceSupabase: () => ({
    from: (table: string) => {
      const o: Op = { table, op: "select", filters: {} };
      let head = false;
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      const record = () => { ops.push(o); };
      Object.assign(chain, {
        select: (_c?: string, opts?: { head?: boolean }) => { head = Boolean(opts?.head); return chain; },
        order: self, limit: self,
        eq: (k: string, v: unknown) => { o.filters[k] = v; return chain; },
        lte: (k: string, v: unknown) => { o.filters[`lte:${k}`] = v; return chain; },
        gte: (k: string, v: unknown) => { o.filters[`gte:${k}`] = v; return chain; },
        insert: (p: unknown) => { o.op = "insert"; o.payload = p; record(); return chain; },
        update: (p: unknown) => { o.op = "update"; o.payload = p; record(); return chain; },
        single: async () => ({ data: insertError ? null : { id: "run1" }, error: insertError }),
        then: (res: (v: unknown) => unknown) => {
          let v: unknown;
          if (table === "automation_runs" && head) v = { count: runCount, error: null };
          else if (table === "automations" && o.op === "update" && o.filters.next_run_at !== undefined) v = { data: claimResult, error: null };
          else if (table === "automations" && o.op === "select" && o.filters.trigger_type === "schedule") v = { data: dueRows, error: null };
          else if (table === "automations" && o.op === "select" && o.filters.trigger_type === "event") v = { data: eventAutomations, error: null };
          else v = { data: [], error: null };
          return Promise.resolve(v).then(res);
        },
      });
      return chain;
    },
  }),
}));

const { tickSchedules, enqueueRun, emitEvent, nextRunFor, RateLimitError } = await import("@/lib/automation/store");

const due = (over: Record<string, unknown> = {}) => ({ id: "a1", owner_id: "o", trigger_type: "schedule", schedule_cron: "0 9 * * *", timezone: "UTC", next_run_at: "2026-03-01T09:00:00.000Z", enabled: true, ...over });
beforeEach(() => { ops = []; dueRows = []; claimResult = [{ id: "a1" }]; runCount = 0; insertError = null; eventAutomations = []; });

describe("nextRunFor", () => {
  it("computes the next slot for schedules only", () => {
    expect(nextRunFor({ trigger_type: "schedule", schedule_cron: "0 9 * * *", timezone: "UTC" }, new Date("2026-03-01T10:00:00Z"))).toBe("2026-03-02T09:00:00.000Z");
    expect(nextRunFor({ trigger_type: "manual", schedule_cron: null, timezone: "UTC" }, new Date())).toBeNull();
  });
});

describe("tickSchedules", () => {
  it("queues one run per due automation with a slot-based idempotency key and advances next_run_at from NOW (no burst of missed runs)", async () => {
    dueRows = [due()];
    const r = await tickSchedules(new Date("2026-03-05T12:00:00Z"));
    expect(r.queued).toBe(1);
    const insert = ops.find((o) => o.table === "automation_runs" && o.op === "insert")!;
    expect(insert.payload).toMatchObject({ trigger: "schedule", idempotency_key: "sched:a1:2026-03-01T09:00:00.000Z" });
    const advance = ops.find((o) => o.table === "automations" && o.op === "update" && o.filters.next_run_at)!;
    expect(advance.payload).toEqual({ next_run_at: "2026-03-06T09:00:00.000Z" });
    expect(advance.filters.next_run_at).toBe("2026-03-01T09:00:00.000Z"); // conditional claim
  });
  it("does nothing when another tick already claimed the slot", async () => {
    dueRows = [due()];
    claimResult = [];
    expect((await tickSchedules(new Date("2026-03-05T12:00:00Z"))).queued).toBe(0);
    expect(ops.some((o) => o.table === "automation_runs" && o.op === "insert")).toBe(false);
  });
  it("a duplicate idempotency key (unique violation) is a no-op, not an error", async () => {
    dueRows = [due()];
    insertError = { code: "23505" };
    expect((await tickSchedules(new Date("2026-03-05T12:00:00Z"))).queued).toBe(0);
  });
  it("skips (without failing the tick) an automation over its hourly limit", async () => {
    dueRows = [due()];
    runCount = 20;
    expect((await tickSchedules(new Date("2026-03-05T12:00:00Z"))).queued).toBe(0);
  });
});

describe("enqueueRun", () => {
  it("enforces the per-automation hourly cap", async () => {
    runCount = 20;
    await expect(enqueueRun({ id: "a1", owner_id: "o" }, "manual", {}, null)).rejects.toBeInstanceOf(RateLimitError);
  });
  it("returns the run id, or null for a duplicate key", async () => {
    expect(await enqueueRun({ id: "a1", owner_id: "o" }, "manual", {}, "k")).toBe("run1");
    insertError = { code: "23505" };
    expect(await enqueueRun({ id: "a1", owner_id: "o" }, "manual", {}, "k")).toBeNull();
  });
});

describe("emitEvent", () => {
  it("queues a run per listening automation with a per-event idempotency key", async () => {
    eventAutomations = [{ id: "a1", owner_id: "o" }, { id: "a2", owner_id: "o" }];
    expect(await emitEvent("social_job_failed", { job_id: "j1" }, "j1:1")).toBe(2);
    const keys = ops.filter((o) => o.op === "insert").map((o) => (o.payload as { idempotency_key: string }).idempotency_key);
    expect(keys).toEqual(["evt:a1:j1:1", "evt:a2:j1:1"]);
    expect(ops.find((o) => o.op === "insert")!.payload).toMatchObject({ trigger: "event", trigger_payload: { event: "social_job_failed", job_id: "j1" } });
  });
  it("never throws, and drops events for rate-limited automations", async () => {
    eventAutomations = [{ id: "a1", owner_id: "o" }];
    runCount = 99;
    await expect(emitEvent("tool_call_failed", {}, "k")).resolves.toBe(0);
  });
  it("bounds large payloads", async () => {
    eventAutomations = [{ id: "a1", owner_id: "o" }];
    await emitEvent("tool_call_failed", { error: "x".repeat(10_000) }, "k");
    const payload = (ops.find((o) => o.op === "insert")!.payload as { trigger_payload: Record<string, unknown> }).trigger_payload;
    expect(JSON.stringify(payload).length).toBeLessThan(4500);
  });
});
