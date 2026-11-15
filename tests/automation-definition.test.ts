import { describe, expect, it } from "vitest";
import { LIMITS, backoffSeconds, boundOutput, contextFrom, evalCondition, renderDeep, renderTemplate, resolvePath, validateDefinition } from "@/lib/automation/definition";

const opts = { allowedTools: ["list_projects", "call_project_tool"], knownDepartments: ["dev", "store"], now: new Date("2026-01-01T00:00:00Z") };
const base = () => ({ name: "Nightly", trigger: { type: "manual" }, steps: [{ id: "a", type: "tool", tool: "list_projects", input: {} }] });

describe("validateDefinition", () => {
  it("accepts a minimal manual automation", () => {
    const v = validateDefinition(base(), opts);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.value).toMatchObject({ name: "Nightly", maxAttempts: 1, backoffSeconds: 60, notifyOnFailure: true });
  });
  it("validates schedule triggers: cron, timezone, minimum interval", () => {
    const ok = validateDefinition({ ...base(), trigger: { type: "schedule", cron: "0 9 * * *", timezone: "Asia/Riyadh" } }, opts);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.warnings.join()).toMatch(/approximate/);
    expect(validateDefinition({ ...base(), trigger: { type: "schedule", cron: "* * * * *", timezone: "UTC" } }, opts)).toMatchObject({ ok: false });
    expect(validateDefinition({ ...base(), trigger: { type: "schedule", cron: "nope", timezone: "UTC" } }, opts)).toMatchObject({ ok: false });
    expect(validateDefinition({ ...base(), trigger: { type: "schedule", cron: "0 9 * * *", timezone: "Mars/Base" } }, opts)).toMatchObject({ ok: false });
    expect(validateDefinition({ ...base(), trigger: { type: "schedule", cron: "0 0 31 2 *", timezone: "UTC" } }, opts)).toMatchObject({ ok: false });
  });
  it("validates event triggers", () => {
    expect(validateDefinition({ ...base(), trigger: { type: "event", event: "social_job_failed" } }, opts).ok).toBe(true);
    expect(validateDefinition({ ...base(), trigger: { type: "event", event: "bogus" } }, opts).ok).toBe(false);
  });
  it("only allows unattended-safe tools and known departments", () => {
    const bad = validateDefinition({ ...base(), steps: [{ id: "a", type: "tool", tool: "delete_project", input: {} }] }, opts);
    expect(bad).toMatchObject({ ok: false });
    expect(!bad.ok && bad.errors.join()).toMatch(/cannot run unattended/);
    expect(validateDefinition({ ...base(), steps: [{ id: "a", type: "agent", department: "nope", task: "x" }] }, opts).ok).toBe(false);
    expect(validateDefinition({ ...base(), steps: [{ id: "a", type: "agent", department: "dev", task: "x" }] }, opts).ok).toBe(true);
  });
  it("enforces step ids, count, notify fields and attempts", () => {
    expect(validateDefinition({ ...base(), steps: [] }, opts).ok).toBe(false);
    const dup = [{ id: "a", type: "notify", subject: "s", message: "m" }, { id: "a", type: "notify", subject: "s", message: "m" }];
    expect(validateDefinition({ ...base(), steps: dup }, opts).ok).toBe(false);
    expect(validateDefinition({ ...base(), steps: [{ id: "BAD ID", type: "notify", subject: "s", message: "m" }] }, opts).ok).toBe(false);
    expect(validateDefinition({ ...base(), steps: Array.from({ length: LIMITS.steps + 1 }, (_, i) => ({ id: `s${i}`, type: "notify", subject: "s", message: "m" })) }, opts).ok).toBe(false);
    expect(validateDefinition({ ...base(), maxAttempts: 9 }, opts).ok).toBe(false);
    expect(validateDefinition({ ...base(), backoffSeconds: 1 }, opts).ok).toBe(false);
    expect(validateDefinition({ ...base(), steps: [{ id: "a", type: "notify", subject: "", message: "m" }] }, opts).ok).toBe(false);
  });
  it("conditions may only reference the trigger or EARLIER steps", () => {
    const steps = (when: unknown) => [{ id: "a", type: "tool", tool: "list_projects", input: {} }, { id: "b", type: "notify", subject: "s", message: "m", when }];
    expect(validateDefinition({ ...base(), steps: steps({ path: "steps.a.output.count", op: "gt", value: 0 }) }, opts).ok).toBe(true);
    expect(validateDefinition({ ...base(), steps: steps({ path: "steps.b.output.x", op: "exists" }) }, opts).ok).toBe(false);
    expect(validateDefinition({ ...base(), steps: steps({ path: "steps.zzz.output.x", op: "exists" }) }, opts).ok).toBe(false);
    expect(validateDefinition({ ...base(), steps: steps({ path: "env.SECRET", op: "exists" }) }, opts).ok).toBe(false);
    expect(validateDefinition({ ...base(), steps: steps({ path: "trigger.x", op: "eq" }) }, opts).ok).toBe(false); // value missing
    expect(validateDefinition({ ...base(), steps: steps({ path: "trigger.x", op: "wat", value: 1 }) }, opts).ok).toBe(false);
  });
});

describe("templating and conditions", () => {
  const ctx = contextFrom({ job: { platform: "youtube", id: 7 }, err: "boom" }, [{ id: "a", status: "succeeded", attempts: 1, output: { projects: [1, 2], status: "ok" } }]);
  it("resolves trigger and step paths; unknown paths are empty", () => {
    expect(resolvePath("trigger.job.platform", ctx)).toBe("youtube");
    expect(resolvePath("steps.a.output.status", ctx)).toBe("ok");
    expect(resolvePath("steps.a.status", ctx)).toBe("succeeded");
    expect(resolvePath("steps.zzz.output", ctx)).toBeUndefined();
    expect(resolvePath("env.HOME", ctx)).toBeUndefined();
  });
  it("blocks prototype traversal", () => {
    expect(resolvePath("trigger.__proto__.polluted", ctx)).toBeUndefined();
    expect(resolvePath("trigger.constructor.name", ctx)).toBeUndefined();
  });
  it("renders strings and deep objects; values are never re-interpreted", () => {
    expect(renderTemplate("Job {{trigger.job.id}} on {{ trigger.job.platform }}: {{trigger.missing}}", ctx)).toBe("Job 7 on youtube: ");
    expect(renderDeep({ a: ["{{trigger.err}}", 5], "{{trigger.err}}": "k" }, ctx)).toEqual({ a: ["boom", 5], "{{trigger.err}}": "k" });
    const nested = contextFrom({ x: "{{trigger.y}}", y: "SECRET" }, []);
    expect(renderTemplate("{{trigger.x}}", nested)).toBe("{{trigger.y}}");
  });
  it("evaluates operators", () => {
    const c = (op: never, value?: unknown, path = "steps.a.output.status") => evalCondition({ path, op, value } as never, ctx);
    expect(c("eq" as never, "ok")).toBe(true);
    expect(c("neq" as never, "ok")).toBe(false);
    expect(c("exists" as never)).toBe(true);
    expect(c("not_exists" as never, undefined, "trigger.nope")).toBe(true);
    expect(evalCondition({ path: "trigger.job.id", op: "gt", value: 5 }, ctx)).toBe(true);
    expect(evalCondition({ path: "trigger.job.id", op: "lt", value: 5 }, ctx)).toBe(false);
    expect(evalCondition({ path: "steps.a.output.projects", op: "contains", value: 2 }, ctx)).toBe(true);
    expect(evalCondition({ path: "trigger.err", op: "contains", value: "oo" }, ctx)).toBe(true);
  });
});

describe("retry and bounds", () => {
  it("backs off exponentially, capped at an hour", () => {
    expect([1, 2, 3].map((a) => backoffSeconds(60, a))).toEqual([60, 120, 240]);
    expect(backoffSeconds(600, 10)).toBe(3600);
  });
  it("bounds oversized step output", () => {
    expect(boundOutput({ a: 1 })).toEqual({ a: 1 });
    expect(boundOutput("x".repeat(10_000))).toMatchObject({ truncated: true });
    expect(boundOutput(undefined)).toBeUndefined();
  });
});
