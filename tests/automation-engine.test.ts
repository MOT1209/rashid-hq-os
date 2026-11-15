import { describe, expect, it, vi } from "vitest";
import { processRun, renderStep, type AutomationRecord, type Deps, type RunRecord, type StepOutcome } from "@/lib/automation/engine";
import type { Step } from "@/lib/automation/definition";

const NOW = new Date("2026-01-01T00:00:00Z");
const tool = (id: string, extra: Partial<Step> = {}) => ({ id, type: "tool", tool: "list_projects", input: {}, ...extra }) as Step;

const automation = (steps: Step[], over: Partial<AutomationRecord> = {}): AutomationRecord => ({
  id: "a1", owner_id: "o", name: "Auto", enabled: true, steps, max_attempts: 3, backoff_seconds: 60, notify_on_failure: true, ...over,
});
const run = (over: Partial<RunRecord> = {}): RunRecord => ({ id: "r1", automation_id: "a1", owner_id: "o", trigger: "schedule", trigger_payload: {}, current_step: 0, step_results: [], ...over });

function harness(a: AutomationRecord | null, exec: (step: Step, n: number) => StepOutcome | Promise<StepOutcome>) {
  const calls: string[] = [];
  const counts: Record<string, number> = {};
  const finish = vi.fn(async () => {});
  const saveProgress = vi.fn(async () => {});
  const onFailure = vi.fn(async () => {});
  const audit = vi.fn(async () => {});
  const deps: Deps = {
    now: () => NOW,
    loadAutomation: async () => a,
    saveProgress,
    executeStep: async (step) => { calls.push(step.id); counts[step.id] = (counts[step.id] ?? 0) + 1; return exec(step, counts[step.id]); },
    finish, onFailure, audit,
  };
  return { deps, calls, finish, saveProgress, onFailure, audit };
}
const lastFinish = (h: ReturnType<typeof harness>) => (h.finish.mock.calls.at(-1) as unknown as [unknown, Record<string, unknown>])[1];

describe("processRun", () => {
  it("runs all steps in order, saving progress after each", async () => {
    const h = harness(automation([tool("a"), tool("b")]), (s) => ({ ok: true, output: { from: s.id } }));
    expect(await processRun(run(), h.deps)).toBe("succeeded");
    expect(h.calls).toEqual(["a", "b"]);
    expect(h.saveProgress).toHaveBeenCalledTimes(2);
    expect(lastFinish(h)).toMatchObject({ status: "succeeded", current_step: 2 });
    expect(h.onFailure).not.toHaveBeenCalled();
  });

  it("resumes at the first unfinished step after a crash (finished steps are not repeated)", async () => {
    const done = { id: "a", status: "succeeded" as const, attempts: 1, output: { x: 1 } };
    const h = harness(automation([tool("a"), tool("b")]), () => ({ ok: true, output: {} }));
    await processRun(run({ current_step: 1, step_results: [done] }), h.deps);
    expect(h.calls).toEqual(["b"]);
    const finalResults = lastFinish(h).step_results as { id: string }[];
    expect(finalResults.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("feeds earlier outputs and the trigger payload into later steps via templates", async () => {
    const seen: Step[] = [];
    const a = automation([tool("a"), { id: "b", type: "notify", subject: "Job {{trigger.job}}", message: "got {{steps.a.output.count}}" } as Step]);
    const h = harness(a, (s) => { seen.push(s); return { ok: true, output: { count: 3 } }; });
    await processRun(run({ trigger_payload: { job: "J9" } }), h.deps);
    expect(seen[1]).toMatchObject({ subject: "Job J9", message: "got 3" });
  });

  it("skips a step whose condition is false and runs one whose condition is true", async () => {
    const a = automation([tool("a"), tool("b", { when: { path: "steps.a.output.n", op: "gt", value: 5 } }), tool("c", { when: { path: "steps.a.output.n", op: "lt", value: 5 } })]);
    const h = harness(a, () => ({ ok: true, output: { n: 1 } }));
    await processRun(run(), h.deps);
    expect(h.calls).toEqual(["a", "c"]);
    expect((lastFinish(h).step_results as { status: string }[]).map((r) => r.status)).toEqual(["succeeded", "skipped", "succeeded"]);
  });

  it("re-queues a retryable failure with exponential backoff and keeps its place", async () => {
    const h = harness(automation([tool("a"), tool("b")]), (s) => (s.id === "b" ? { ok: false, error: "503", retryable: true } : { ok: true, output: 1 }));
    expect(await processRun(run(), h.deps)).toBe("requeued");
    expect(lastFinish(h)).toMatchObject({ status: "queued", current_step: 1, run_at: "2026-01-01T00:01:00.000Z" });
    // second attempt (attempts carried in step_results) doubles the delay
    const retrying = [{ id: "a", status: "succeeded" as const, attempts: 1 }, { id: "b", status: "retrying" as const, attempts: 1 }];
    const h2 = harness(automation([tool("a"), tool("b")]), () => ({ ok: false, error: "503", retryable: true }));
    expect(await processRun(run({ current_step: 1, step_results: retrying }), h2.deps)).toBe("requeued");
    expect(lastFinish(h2)).toMatchObject({ run_at: "2026-01-01T00:02:00.000Z" });
    expect(h2.calls).toEqual(["b"]); // step a NOT re-run
  });

  it("fails after the attempt limit and notifies", async () => {
    const retrying = [{ id: "a", status: "retrying" as const, attempts: 2 }];
    const h = harness(automation([tool("a")], { max_attempts: 3 }), () => ({ ok: false, error: "still down", retryable: true }));
    expect(await processRun(run({ step_results: retrying }), h.deps)).toBe("failed");
    expect(lastFinish(h)).toMatchObject({ status: "failed" });
    expect(String(lastFinish(h).error)).toMatch(/Step "a" failed: still down/);
    expect(h.onFailure).toHaveBeenCalledTimes(1);
  });

  it("never retries a non-retryable failure", async () => {
    const h = harness(automation([tool("a")]), () => ({ ok: false, error: "denied by policy", retryable: false }));
    expect(await processRun(run(), h.deps)).toBe("failed");
    expect(h.calls).toEqual(["a"]);
  });

  it("onFailure=continue records the failure and carries on", async () => {
    const h = harness(automation([tool("a", { onFailure: "continue" }), tool("b")]), (s) => (s.id === "a" ? { ok: false, error: "x", retryable: false } : { ok: true, output: 1 }));
    expect(await processRun(run(), h.deps)).toBe("succeeded");
    expect((lastFinish(h).step_results as { status: string }[]).map((r) => r.status)).toEqual(["failed", "succeeded"]);
  });

  it("a per-step maxAttempts overrides the automation default", async () => {
    const h = harness(automation([tool("a", { maxAttempts: 1 })], { max_attempts: 5 }), () => ({ ok: false, error: "x", retryable: true }));
    expect(await processRun(run(), h.deps)).toBe("failed");
  });

  it("treats a thrown executor error as non-retryable (it may have had side effects)", async () => {
    const h = harness(automation([tool("a")]), () => { throw new Error("kaboom"); });
    expect(await processRun(run(), h.deps)).toBe("failed");
    expect(String(lastFinish(h).error)).toContain("kaboom");
  });

  it("cancels an unattended run whose automation was paused; manual runs still finish", async () => {
    const paused = automation([tool("a")], { enabled: false });
    const h = harness(paused, () => ({ ok: true, output: 1 }));
    expect(await processRun(run({ trigger: "schedule" }), h.deps)).toBe("cancelled");
    expect(h.calls).toEqual([]);
    const h2 = harness(paused, () => ({ ok: true, output: 1 }));
    expect(await processRun(run({ trigger: "manual" }), h2.deps)).toBe("succeeded");
  });

  it("fails cleanly if the automation was deleted", async () => {
    const h = harness(null, () => ({ ok: true, output: 1 }));
    expect(await processRun(run(), h.deps)).toBe("failed");
  });

  it("a failing notification never changes the recorded outcome", async () => {
    const h = harness(automation([tool("a", { maxAttempts: 1 })]), () => ({ ok: false, error: "x", retryable: false }));
    h.onFailure.mockRejectedValueOnce(new Error("mail down"));
    expect(await processRun(run(), h.deps)).toBe("failed");
  });
});

describe("renderStep", () => {
  it("renders templates deeply in tool input and agent tasks without touching other fields", () => {
    const ctx = { trigger: { p: "web" }, steps: {} };
    expect(renderStep({ id: "a", type: "tool", tool: "get_project", input: { q: { name: "{{trigger.p}}" } } }, ctx)).toMatchObject({ input: { q: { name: "web" } }, tool: "get_project" });
    expect(renderStep({ id: "a", type: "agent", department: "dev", task: "check {{trigger.p}}" }, ctx)).toMatchObject({ task: "check web", department: "dev" });
  });
});
