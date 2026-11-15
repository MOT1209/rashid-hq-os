import {
  LIMITS, backoffSeconds, boundOutput, contextFrom, evalCondition, renderDeep, renderTemplate,
  type RunContext, type Step, type StepResult,
} from "@/lib/automation/definition";

/**
 * Pure orchestration of one automation run over injected dependencies (so every
 * branch is unit-tested without a database, network or model). The production
 * wiring lives in runtime.ts.
 *
 * Durability: progress (current_step + step_results) is saved after every step.
 * A worker that dies mid-run leaves the lock to expire; the next worker resumes
 * at the first unfinished step, so completed steps are never repeated.
 *
 * Retries are persistent, not in-memory: a failed step that may be retried puts
 * the whole run back in the queue with a future run_at (exponential backoff).
 */

export type AutomationRecord = {
  id: string; owner_id: string; name: string; enabled: boolean; steps: Step[];
  max_attempts: number; backoff_seconds: number; notify_on_failure: boolean;
};

export type RunRecord = {
  id: string; automation_id: string; owner_id: string; trigger: "manual" | "schedule" | "event";
  trigger_payload: Record<string, unknown>; current_step: number; step_results: StepResult[];
};

export type StepOutcome = { ok: true; output: unknown } | { ok: false; error: string; retryable: boolean };

export type Deps = {
  now: () => Date;
  loadAutomation: (run: RunRecord) => Promise<AutomationRecord | null>;
  saveProgress: (run: RunRecord, p: { current_step: number; step_results: StepResult[] }) => Promise<void>;
  executeStep: (step: Step, a: { automation: AutomationRecord; run: RunRecord; ctx: RunContext }) => Promise<StepOutcome>;
  /** Guarded on status = 'running' by the implementation so a cancel is never overwritten. */
  finish: (run: RunRecord, patch: Record<string, unknown>) => Promise<void>;
  onFailure: (automation: AutomationRecord, run: RunRecord, message: string) => Promise<void>;
  audit: (run: RunRecord, status: "success" | "failed", detail: Record<string, unknown>) => Promise<void>;
};

export type RunOutcome = "succeeded" | "failed" | "requeued" | "cancelled";

const msg = (e: unknown) => (e instanceof Error ? e.message : "unexpected error").slice(0, 300);

export async function processRun(run: RunRecord, deps: Deps): Promise<RunOutcome> {
  const results: StepResult[] = [...(run.step_results ?? [])];
  let automation = await deps.loadAutomation(run);

  const cancel = async (reason: string): Promise<RunOutcome> => {
    await deps.finish(run, { status: "cancelled", error: reason, locked_at: null, locked_by: null, finished_at: deps.now().toISOString() });
    return "cancelled";
  };
  const fail = async (a: AutomationRecord, error: string): Promise<RunOutcome> => {
    await deps.finish(run, { status: "failed", error, step_results: results, locked_at: null, locked_by: null, finished_at: deps.now().toISOString() });
    await deps.audit(run, "failed", { automation: a.name, error });
    // A notification problem must never change the run's recorded outcome.
    await deps.onFailure(a, run, error).catch(() => undefined);
    return "failed";
  };

  if (!automation) {
    await deps.finish(run, { status: "failed", error: "The automation no longer exists.", locked_at: null, locked_by: null, finished_at: deps.now().toISOString() });
    return "failed";
  }

  for (let i = run.current_step; i < automation.steps.length; i++) {
    // Re-read each time: pausing or editing takes effect at the next step boundary.
    automation = (await deps.loadAutomation(run)) ?? automation;
    if (!automation.enabled && run.trigger !== "manual") return cancel("The automation was paused.");
    const step = automation.steps[i];
    if (!step) return fail(automation, "The automation was edited while it was running.");

    const ctx = contextFrom(run.trigger_payload ?? {}, results);

    if (step.when && !evalCondition(step.when, ctx)) {
      results[i] = { id: step.id, status: "skipped", attempts: 0 };
      await deps.saveProgress(run, { current_step: i + 1, step_results: results });
      continue;
    }

    const attempts = (results[i]?.attempts ?? 0) + 1;
    const startedAt = deps.now().toISOString();
    let outcome: StepOutcome;
    try {
      outcome = await deps.executeStep(renderStep(step, ctx), { automation, run, ctx });
    } catch (e) {
      // An exception is unexpected: don't assume it is safe to repeat.
      outcome = { ok: false, error: msg(e), retryable: false };
    }

    if (outcome.ok) {
      results[i] = { id: step.id, status: "succeeded", attempts, output: boundOutput(outcome.output), started_at: startedAt, finished_at: deps.now().toISOString() };
      await deps.saveProgress(run, { current_step: i + 1, step_results: results });
      continue;
    }

    const max = Math.min(LIMITS.maxAttempts, step.maxAttempts ?? automation.max_attempts);
    if (outcome.retryable && attempts < max) {
      results[i] = { id: step.id, status: "retrying", attempts, error: outcome.error.slice(0, 300), started_at: startedAt, finished_at: deps.now().toISOString() };
      const runAt = new Date(deps.now().getTime() + backoffSeconds(automation.backoff_seconds, attempts) * 1000);
      await deps.finish(run, { status: "queued", run_at: runAt.toISOString(), current_step: i, step_results: results, error: null, locked_at: null, locked_by: null });
      await deps.audit(run, "failed", { automation: automation.name, step: step.id, attempts, willRetry: true });
      return "requeued";
    }

    results[i] = { id: step.id, status: "failed", attempts, error: outcome.error.slice(0, 300), started_at: startedAt, finished_at: deps.now().toISOString() };
    if (step.onFailure === "continue") {
      await deps.saveProgress(run, { current_step: i + 1, step_results: results });
      continue;
    }
    return fail(automation, `Step "${step.id}" failed: ${outcome.error}`);
  }

  await deps.finish(run, { status: "succeeded", step_results: results, current_step: automation.steps.length, error: null, locked_at: null, locked_by: null, finished_at: deps.now().toISOString() });
  await deps.audit(run, "success", { automation: automation.name, steps: results.length });
  return "succeeded";
}

/** Substitutes {{templates}} into a step just before it executes. */
export function renderStep(step: Step, ctx: RunContext): Step {
  switch (step.type) {
    case "tool": return { ...step, input: renderDeep(step.input, ctx) };
    case "agent": return { ...step, task: renderTemplate(step.task, ctx) };
    case "notify": return { ...step, subject: renderTemplate(step.subject, ctx), message: renderTemplate(step.message, ctx) };
  }
}
