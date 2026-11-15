import { describe, expect, it } from "vitest";
import { isEnabled, projectAllowed, scopeNote, toolAllowed, validateConfig, validateNewAgent } from "@/lib/agent-config";
import { budgetUsed, summariseAgents, totalTokens } from "@/lib/agent-metrics";

const read = { name: "list_projects", requiredScope: "read" as const };
const write = { name: "update_project", requiredScope: "write" as const };

describe("toolAllowed", () => {
  it("defaults (no governance fields) allow everything except delegation", () => {
    expect(toolAllowed({}, read)).toBe(true);
    expect(toolAllowed({}, write)).toBe(true);
    expect(toolAllowed({}, { name: "delegate_to_department", requiredScope: "write" })).toBe(false);
  });
  it("read_only blocks write tools even if explicitly listed", () => {
    expect(toolAllowed({ read_only: true }, write)).toBe(false);
    expect(toolAllowed({ read_only: true, allowed_tools: ["update_project"] }, write)).toBe(false);
    expect(toolAllowed({ read_only: true }, read)).toBe(true);
  });
  it("allowed_tools is a strict allowlist; an empty list means no tools", () => {
    expect(toolAllowed({ allowed_tools: ["list_projects"] }, read)).toBe(true);
    expect(toolAllowed({ allowed_tools: ["list_projects"] }, write)).toBe(false);
    expect(toolAllowed({ allowed_tools: [] }, read)).toBe(false);
  });
  it("enabled defaults to on", () => {
    expect(isEnabled({})).toBe(true);
    expect(isEnabled({ enabled: false })).toBe(false);
  });
});

describe("projectAllowed", () => {
  it("is unrestricted with no assignments", () => expect(projectAllowed([], { project_id: "x" })).toEqual({ ok: true }));
  it("refuses a project outside the assignment, allows inside and project-less calls", () => {
    expect(projectAllowed(["a"], { project_id: "b" })).toMatchObject({ ok: false });
    expect(projectAllowed(["a"], { project_id: "a" })).toEqual({ ok: true });
    expect(projectAllowed(["a"], {})).toEqual({ ok: true });
    expect(projectAllowed(["a"], null)).toEqual({ ok: true });
  });
});

describe("validateNewAgent", () => {
  const good = { key: "Support", name_en: "Support", name_ar: "الدعم", agent_name: "Support Agent", system_prompt: "help", model: "" };
  it("accepts and normalises", () => {
    expect(validateNewAgent(good, ["dev"])).toMatchObject({ ok: true, value: { key: "support", icon: "🤖", model: null } });
  });
  it("rejects bad keys, duplicates, missing names and oversize fields", () => {
    for (const bad of [{ ...good, key: "1x" }, { ...good, key: "a b" }, { ...good, key: "dev" }, { ...good, name_ar: "" }, { ...good, agent_name: "x".repeat(81) }, { ...good, system_prompt: "x".repeat(4001) }, {}]) {
      expect(validateNewAgent(bad, ["dev"]).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("validateConfig", () => {
  const tools = ["list_projects", "update_project"];
  it("accepts all-tools (null) and a valid subset", () => {
    expect(validateConfig({ allowed_tools: null, project_ids: ["p1"] }, tools, ["p1"])).toMatchObject({ ok: true, value: { allowed_tools: null, project_ids: ["p1"], enabled: true, read_only: false } });
    expect(validateConfig({ allowed_tools: ["list_projects", "list_projects"], read_only: true, enabled: false }, tools, [])).toMatchObject({ ok: true, value: { allowed_tools: ["list_projects"], read_only: true, enabled: false } });
  });
  it("rejects unknown tools, the delegation tool, and projects not owned", () => {
    expect(validateConfig({ allowed_tools: ["nope"] }, tools, []).ok).toBe(false);
    expect(validateConfig({ allowed_tools: ["delegate_to_department"] }, tools, []).ok).toBe(false);
    expect(validateConfig({ project_ids: ["foreign"] }, tools, ["p1"]).ok).toBe(false);
    expect(validateConfig({ allowed_tools: "all" }, tools, []).ok).toBe(false);
  });
});

describe("scopeNote", () => {
  it("states assignments and read-only mode", () => {
    expect(scopeNote([], false)).toBe("");
    expect(scopeNote(["A", "B"], true)).toMatch(/A, B.*read-only/);
  });
});

describe("summariseAgents", () => {
  const run = (over: Record<string, unknown> = {}) => ({ agent_name: "Dev Agent", kind: "delegation", status: "success", tokens_in: 100, tokens_out: 50, duration_ms: 2000, step_count: 3, created_at: "2026-01-01T00:00:00Z", ...over }) as never;
  it("aggregates real runs per agent", () => {
    const m = summariseAgents([run(), run({ status: "failed", duration_ms: 4000, step_count: 5, kind: "standing_task", created_at: "2026-01-03T00:00:00Z", tokens_in: null }), run({ agent_name: "Store Agent" })]).get("Dev Agent")!;
    expect(m).toMatchObject({ runs: 2, succeeded: 1, failed: 1, successRate: 0.5, tokensIn: 100, tokensOut: 100, avgDurationMs: 3000, avgSteps: 4, lastRunAt: "2026-01-03T00:00:00Z", byKind: { delegation: 1, standing_task: 1 } });
    expect(totalTokens(m)).toBe(200);
  });
  it("shows nothing for an agent with no runs (no fabricated zeros as rates)", () => {
    expect(summariseAgents([]).get("x")).toBeUndefined();
    expect(totalTokens(undefined)).toBe(0);
  });
  it("budget share needs a budget", () => {
    expect(budgetUsed(50, 200)).toBe(0.25);
    expect(budgetUsed(50, null)).toBeNull();
    expect(budgetUsed(50, 0)).toBeNull();
  });
});
