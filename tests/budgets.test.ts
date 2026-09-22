import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 1.2: department token budgets. Past 80% the owners get one mail a
 * day, at 100% no new run starts — and any ledger outage fails safe to
 * "allowed", exactly the pre-budget behavior.
 */

const spendRows: { tokens_in: number | null; tokens_out: number | null }[] = [];
let spendError: unknown = null;
const inserts: { table: string; row: Record<string, unknown> }[] = [];
const updates: { table: string; patch: Record<string, unknown> }[] = [];

function builder(table: string) {
  if (table === "agent_runs") {
    return {
      select: () => ({
        eq: () => ({
          gte: () => ({
            limit: async () => ({ data: spendRows, error: spendError }),
          }),
        }),
      }),
    };
  }
  return {
    insert: (row: Record<string, unknown>) => {
      inserts.push({ table, row });
      return Promise.resolve({ error: null });
    },
    update: (patch: Record<string, unknown>) => {
      updates.push({ table, patch });
      return { eq: () => Promise.resolve({ error: null }) };
    },
  };
}

const from = vi.fn((table: string) => builder(table));
vi.mock("@/lib/supabase/server", () => ({ getServiceSupabase: () => ({ from }) }));

const captureError = vi.fn();
vi.mock("@/lib/errors", () => ({ captureError: (...args: unknown[]) => captureError(...args) }));

const sendEmail = vi.fn(async (..._args: unknown[]) => true);
vi.mock("@/lib/email", () => ({ sendEmail: (...args: unknown[]) => sendEmail(...args) }));

vi.mock("@/lib/owners", () => ({ ownerEmails: () => ["owner@example.com"] }));

const { checkDepartmentBudget, spendForAgent } = await import("@/lib/budgets");

const BASE = {
  agentName: "Dev Agent",
  departmentKey: "dev",
  budget: 100_000,
  alertedAt: null as string | null,
};

beforeEach(() => {
  from.mockClear();
  captureError.mockClear();
  sendEmail.mockClear();
  spendRows.length = 0;
  spendError = null;
  inserts.length = 0;
  updates.length = 0;
});

describe("spendForAgent", () => {
  it("sums in + out tokens over the window", async () => {
    spendRows.push({ tokens_in: 80_000, tokens_out: 10_000 }, { tokens_in: null, tokens_out: 5_000 });
    await expect(spendForAgent("Dev Agent")).resolves.toBe(95_000);
  });
});

describe("checkDepartmentBudget", () => {
  it("allows everything when no budget is set, without touching the ledger", async () => {
    const result = await checkDepartmentBudget({ ...BASE, budget: null });
    expect(result).toEqual({ allowed: true, used: 0, budget: null, alerted: false });
    expect(from).not.toHaveBeenCalled();
  });

  it("allows under 80% with no mail and no event", async () => {
    spendRows.push({ tokens_in: 50_000, tokens_out: 0 });
    const result = await checkDepartmentBudget(BASE);
    expect(result).toEqual({ allowed: true, used: 50_000, budget: 100_000, alerted: false });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it("mails once past 80%, stamps the department and records the alert", async () => {
    spendRows.push({ tokens_in: 85_000, tokens_out: 0 });
    const result = await checkDepartmentBudget(BASE);
    expect(result).toEqual({ allowed: true, used: 85_000, budget: 100_000, alerted: true });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([{ table: "departments", patch: expect.objectContaining({}) }]);
    expect(inserts).toEqual([
      {
        table: "budget_events",
        row: expect.objectContaining({ agent_name: "Dev Agent", kind: "alert" }),
      },
    ]);
  });

  it("does not re-mail within a day of the last alert", async () => {
    spendRows.push({ tokens_in: 85_000, tokens_out: 0 });
    const result = await checkDepartmentBudget({ ...BASE, alertedAt: new Date().toISOString() });
    expect(result.alerted).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("blocks at 100% and records the block without mailing", async () => {
    spendRows.push({ tokens_in: 100_000, tokens_out: 1 });
    const result = await checkDepartmentBudget(BASE);
    expect(result).toEqual({ allowed: false, used: 100_001, budget: 100_000, alerted: false });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(inserts).toEqual([
      {
        table: "budget_events",
        row: expect.objectContaining({ kind: "blocked" }),
      },
    ]);
  });

  it("fails safe to allowed when the ledger is unreadable", async () => {
    spendError = { message: "connection lost" };
    const result = await checkDepartmentBudget(BASE);
    expect(result).toEqual({ allowed: true, used: 0, budget: 100_000, alerted: false });
    expect(captureError).toHaveBeenCalledWith("budget:check", expect.anything(), {
      agentName: "Dev Agent",
    });
  });
});
