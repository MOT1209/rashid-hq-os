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
            range: async (from: number, to: number) => {
              if (spendError) return { data: null, error: spendError };
              return { data: spendRows.slice(from, to + 1), error: null };
            },
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
vi.mock("@/lib/email", async (importOriginal) => ({
  escapeHtml: (await importOriginal<typeof import("@/lib/email")>()).escapeHtml,
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}));

vi.mock("@/lib/owners", () => ({ ownerEmails: () => ["owner@example.com"] }));

const { checkDepartmentBudget, checkProjectBudget, spendForAgent, spendForProject } =
  await import("@/lib/budgets");

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

  it("sums past a single page of rows instead of truncating", async () => {
    // One page's worth of full-size rows plus one more row on a second page:
    // a single-page `.limit()` would have dropped that last row entirely.
    for (let i = 0; i < 1000; i++) spendRows.push({ tokens_in: 1, tokens_out: 0 });
    spendRows.push({ tokens_in: 500, tokens_out: 0 });
    await expect(spendForAgent("Dev Agent")).resolves.toBe(1500);
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

  it("blocks at 100%, records the block and mails the exhausted alert once", async () => {
    spendRows.push({ tokens_in: 100_000, tokens_out: 1 });
    const result = await checkDepartmentBudget(BASE);
    expect(result).toEqual({ allowed: false, used: 100_001, budget: 100_000, alerted: true });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ subject: expect.stringContaining("100%") });
    expect(updates).toEqual([
      {
        table: "departments",
        patch: { budget_exhausted_alerted_at: expect.any(String) },
      },
    ]);
    expect(inserts).toEqual([
      {
        table: "budget_events",
        row: expect.objectContaining({ kind: "blocked" }),
      },
    ]);
  });

  it("still blocks but does not re-mail within a day of the last exhausted alert", async () => {
    spendRows.push({ tokens_in: 100_000, tokens_out: 1 });
    const result = await checkDepartmentBudget({
      ...BASE,
      exhaustedAlertedAt: new Date().toISOString(),
    });
    expect(result).toEqual({ allowed: false, used: 100_001, budget: 100_000, alerted: false });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it("escapes the agent name in the HTML body", async () => {
    spendRows.push({ tokens_in: 100_000, tokens_out: 0 });
    await checkDepartmentBudget({ ...BASE, agentName: "<img src=x onerror=alert(1)>" });
    const [mail] = sendEmail.mock.calls[0] as [{ html: string }];
    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain("&lt;img");
  });

  it("a recent 80% alert does not suppress the 100% alert", async () => {
    spendRows.push({ tokens_in: 100_000, tokens_out: 0 });
    const result = await checkDepartmentBudget({ ...BASE, alertedAt: new Date().toISOString() });
    expect(result.allowed).toBe(false);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("does not stamp the department when the mail could not be sent", async () => {
    spendRows.push({ tokens_in: 100_000, tokens_out: 0 });
    sendEmail.mockResolvedValueOnce(false);
    const result = await checkDepartmentBudget(BASE);
    expect(result).toMatchObject({ allowed: false, alerted: false });
    expect(updates).toHaveLength(0);
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

describe("spendForProject", () => {
  it("sums in + out tokens over the window", async () => {
    spendRows.push({ tokens_in: 30_000, tokens_out: 4_000 }, { tokens_in: null, tokens_out: 1_000 });
    await expect(spendForProject("proj-1")).resolves.toBe(35_000);
  });
});

describe("checkProjectBudget", () => {
  const PROJECT_BASE = {
    projectId: "proj-1",
    projectName: "Clothing Store",
    budget: 100_000,
    alertedAt: null as string | null,
  };

  it("allows everything when no budget is set, without touching the ledger", async () => {
    const result = await checkProjectBudget({ ...PROJECT_BASE, budget: null });
    expect(result).toEqual({ allowed: true, used: 0, budget: null, alerted: false });
    expect(from).not.toHaveBeenCalled();
  });

  it("allows under 80% with no mail and no event", async () => {
    spendRows.push({ tokens_in: 50_000, tokens_out: 0 });
    const result = await checkProjectBudget(PROJECT_BASE);
    expect(result).toEqual({ allowed: true, used: 50_000, budget: 100_000, alerted: false });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it("mails once past 80%, stamps the project (not departments) and records the alert with project_id", async () => {
    spendRows.push({ tokens_in: 85_000, tokens_out: 0 });
    const result = await checkProjectBudget(PROJECT_BASE);
    expect(result).toEqual({ allowed: true, used: 85_000, budget: 100_000, alerted: true });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([{ table: "projects", patch: expect.objectContaining({}) }]);
    expect(inserts).toEqual([
      {
        table: "budget_events",
        row: expect.objectContaining({
          agent_name: "Clothing Store",
          project_id: "proj-1",
          kind: "alert",
        }),
      },
    ]);
  });

  it("does not re-mail within a day of the last alert", async () => {
    spendRows.push({ tokens_in: 85_000, tokens_out: 0 });
    const result = await checkProjectBudget({ ...PROJECT_BASE, alertedAt: new Date().toISOString() });
    expect(result.alerted).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("blocks at 100%, records the block and mails the exhausted alert once", async () => {
    spendRows.push({ tokens_in: 100_000, tokens_out: 1 });
    const result = await checkProjectBudget(PROJECT_BASE);
    expect(result).toEqual({ allowed: false, used: 100_001, budget: 100_000, alerted: true });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ subject: expect.stringContaining("100%") });
    expect(updates).toEqual([
      { table: "projects", patch: { budget_exhausted_alerted_at: expect.any(String) } },
    ]);
    expect(inserts).toEqual([
      { table: "budget_events", row: expect.objectContaining({ project_id: "proj-1", kind: "blocked" }) },
    ]);
  });

  it("still blocks but does not re-mail within a day of the last exhausted alert", async () => {
    spendRows.push({ tokens_in: 100_000, tokens_out: 1 });
    const result = await checkProjectBudget({
      ...PROJECT_BASE,
      exhaustedAlertedAt: new Date().toISOString(),
    });
    expect(result).toEqual({ allowed: false, used: 100_001, budget: 100_000, alerted: false });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it("uses the word 'Project' rather than 'Agent' in the mail copy", async () => {
    spendRows.push({ tokens_in: 100_000, tokens_out: 0 });
    await checkProjectBudget(PROJECT_BASE);
    const [mail] = sendEmail.mock.calls[0] as [{ text: string }];
    expect(mail.text).toContain('Project "Clothing Store"');
    expect(mail.text).not.toContain('Agent "Clothing Store"');
  });
});
