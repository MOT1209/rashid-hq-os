import { describe, expect, it } from "vitest";
import { budgetState, configHealth, deriveWarnings, type Overview } from "@/lib/overview-core";

const base = (over: Partial<Overview> = {}): Overview => ({
  db: { ok: true, latencyMs: 12 }, approvalsPending: 0, integrations: { connected: 2, error: 0, expired: 0, disconnected: 0 },
  mcp: { tools: 3, enabled: 3, dangerous: 0, testFailing: 0 }, agents: { total: 4, enabled: 4, runs24h: 5, failed24h: 0, overBudget: 0, exhausted: 0 },
  automations: { active: 1, queued: 0, running: 0, failed24h: 0, next: [] }, social: { queued: 0, running: 0, failed7d: 0, succeeded7d: 3, accounts: 1, nextRunAt: null },
  tasks: { inProgress: 2, overdue: 0 }, activity: { failed24h: 0, recentFailures: [] }, health: [], ...over,
});

describe("configHealth", () => {
  const full = { BETTER_AUTH_SECRET: "x".repeat(32), INTEGRATIONS_SECRET: "y".repeat(16), OWNER_EMAILS: "a@b.c", GROQ_API_KEY: "k", REQUIRE_2FA: "1", CRON_SECRET: "z".repeat(16), KV_REST_API_URL: "u", KV_REST_API_TOKEN: "t", RESEND_API_KEY: "r", SENTRY_DSN: "d" };
  it("is all ok with a complete environment", () => {
    expect(configHealth(full, true).every((h) => h.level === "ok")).toBe(true);
  });
  it("flags missing critical secrets as errors and optional ones as warnings", () => {
    const h = Object.fromEntries(configHealth({}, true).map((x) => [x.id, x.level]));
    expect(h).toMatchObject({ auth_secret: "err", encryption: "err", owner_emails: "err", rate_limit_store: "err", model: "warn", email: "warn", two_factor_policy: "warn", cron_secret: "warn", error_tracking: "info" });
  });
  it("a missing shared rate-limit store is only a warning outside production", () => {
    expect(configHealth({}, false).find((x) => x.id === "rate_limit_store")!.level).toBe("warn");
  });
  it("treats short secrets as not set", () => {
    expect(configHealth({ BETTER_AUTH_SECRET: "short" }, true).find((x) => x.id === "auth_secret")!.level).toBe("err");
  });
  it("never returns any variable value", () => {
    const out = JSON.stringify(configHealth({ BETTER_AUTH_SECRET: "SUPER-SECRET-VALUE-0123456789abcdef0123456789" }, true));
    expect(out).not.toContain("SUPER-SECRET");
  });
});

describe("deriveWarnings", () => {
  it("is empty when everything is healthy", () => expect(deriveWarnings(base())).toEqual([]));
  it("surfaces each real problem with its count and a link, most severe first", () => {
    const w = deriveWarnings(base({
      approvalsPending: 3, activity: { failed24h: 7, recentFailures: [] }, social: { queued: 0, running: 0, failed7d: 2, succeeded7d: 0, accounts: 1, nextRunAt: null },
      agents: { total: 4, enabled: 4, runs24h: 5, failed24h: 1, overBudget: 1, exhausted: 1 }, health: [{ id: "model", level: "warn" }, { id: "encryption", level: "err" }],
    }));
    expect(w[0].level).toBe("err");
    expect(w.filter((x) => x.level === "err").map((x) => x.id)).toEqual(expect.arrayContaining(["budget_exhausted", "config_encryption"]));
    expect(w.find((x) => x.id === "approvals_pending")).toMatchObject({ count: 3, href: "/dashboard/access" });
    expect(w.find((x) => x.id === "failed_calls")).toMatchObject({ count: 7 });
    expect(w.find((x) => x.id === "social_failed")).toMatchObject({ count: 2 });
    expect(w.find((x) => x.id === "config_model")).toBeTruthy();
    const levels = w.map((x) => x.level);
    expect(levels).toEqual([...levels].sort((a, b) => (a === "err" ? 0 : 1) - (b === "err" ? 0 : 1)));
  });
  it("a database outage is an error", () => {
    expect(deriveWarnings(base({ db: { ok: false, latencyMs: null } }))[0]).toMatchObject({ id: "db_down", level: "err" });
  });
  it("cards that could not load (null) add no warnings and never become zeros", () => {
    const w = deriveWarnings(base({ integrations: null, mcp: null, agents: null, automations: null, social: null, tasks: null, activity: null, approvalsPending: null }));
    expect(w).toEqual([]);
  });
  it("counts expired and errored integrations together", () => {
    expect(deriveWarnings(base({ integrations: { connected: 1, error: 1, expired: 2, disconnected: 0 } })).find((x) => x.id === "integrations_broken")!.count).toBe(3);
  });
});

describe("budgetState", () => {
  it("classifies usage against the budget", () => {
    expect(budgetState(10, null)).toBe("none");
    expect(budgetState(10, 0)).toBe("none");
    expect(budgetState(79, 100)).toBe("ok");
    expect(budgetState(80, 100)).toBe("high");
    expect(budgetState(100, 100)).toBe("exhausted");
    expect(budgetState(150, 100)).toBe("exhausted");
  });
});
