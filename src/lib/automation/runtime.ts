import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logActivity } from "@/lib/activity";
import { processRun, type AutomationRecord, type Deps, type RunRecord, type StepOutcome } from "@/lib/automation/engine";
import { escapeHtml, emailConfigured, sendEmail } from "@/lib/email";
import { AUTONOMOUS_TOOLS, runDepartmentAgent } from "@/lib/department-agent";
import { runTool } from "@/lib/mcp/executor";
import { findTool } from "@/lib/mcp/tools";
import { ownerEmails } from "@/lib/owners";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { Department } from "@/lib/agents";
import type { Step } from "@/lib/automation/definition";

/**
 * Production wiring for the automation engine.
 *
 * Automations are UNATTENDED, so they get the same guard rails as the daily
 * standing-task cron: actor type `standing_task_routine` (the policy engine
 * denies writes except a project's own registered tools, and denies dangerous
 * project tools), the AUTONOMOUS_TOOLS allowlist, department budgets, and no
 * waiting for approvals.
 */
const db = () => getServiceSupabase() as unknown as SupabaseClient;

export const ALLOWED_TOOLS = [...AUTONOMOUS_TOOLS];

async function executeStep(step: Step, a: { automation: AutomationRecord; run: RunRecord }): Promise<StepOutcome> {
  const name = `Automation: ${a.automation.name}`.slice(0, 80);

  if (step.type === "tool") {
    const def = findTool(step.tool);
    if (!def || !AUTONOMOUS_TOOLS.has(step.tool)) return { ok: false, error: `"${step.tool}" cannot run unattended.`, retryable: false };
    const parsed = def.schema.safeParse(step.input);
    if (!parsed.success) return { ok: false, error: `Invalid input for ${step.tool}: ${parsed.error.issues[0]?.message ?? "bad input"}`.slice(0, 300), retryable: false };
    const outcome = await runTool(def, parsed.data, { agentName: name, scopes: ["read", "write"], ownerId: a.run.owner_id, actorType: "standing_task_routine" });
    switch (outcome.status) {
      case "success": return { ok: true, output: outcome.result };
      case "queued": return { ok: false, error: "This call needs owner approval, which an unattended automation cannot wait for.", retryable: false };
      case "denied": return { ok: false, error: outcome.reason, retryable: false };
      // Only READ tools are safe to repeat; a write that failed halfway could double its effect.
      case "failed": return { ok: false, error: outcome.error, retryable: def.requiredScope === "read" };
    }
  }

  if (step.type === "agent") {
    const { data } = await db().from("departments").select("*").eq("key", step.department).maybeSingle();
    if (!data) return { ok: false, error: `Unknown department "${step.department}".`, retryable: false };
    try {
      const r = await runDepartmentAgent({ department: data as Department, task: step.task, ownerId: a.run.owner_id, mode: "autonomous" });
      return { ok: true, output: { summary: r.summary.slice(0, 1500), steps: r.steps } };
    } catch (e) {
      // The agent may already have acted, so a failed run is never auto-repeated.
      return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "The agent run failed.", retryable: false };
    }
  }

  // notify
  const to = ownerEmails();
  if (!emailConfigured()) return { ok: false, error: "Email is not configured (RESEND_API_KEY).", retryable: false };
  if (to.length === 0) return { ok: false, error: "No owner email is configured (OWNER_EMAILS).", retryable: false };
  const sent = await sendEmail({
    to, subject: `[Automation] ${step.subject}`.slice(0, 200),
    html: `<p>${escapeHtml(step.message).replace(/\n/g, "<br>")}</p><p style="color:#888">${escapeHtml(a.automation.name)}</p>`,
    text: `${step.message}\n\n— ${a.automation.name}`,
  });
  return sent ? { ok: true, output: { sent: true } } : { ok: false, error: "The email could not be sent.", retryable: true };
}

export function realDeps(): Deps {
  return {
    now: () => new Date(),
    async loadAutomation(run) {
      const { data } = await db().from("automations").select("*").eq("id", run.automation_id).maybeSingle();
      return (data as AutomationRecord | null) ?? null;
    },
    async saveProgress(run, p) {
      const { error } = await db().from("automation_runs").update({ current_step: p.current_step, step_results: p.step_results }).eq("id", run.id).eq("status", "running");
      if (error) throw new Error("could not save run progress");
    },
    executeStep: (step, a) => executeStep(step, a),
    async finish(run, patch) {
      // Guarded on status so a concurrent cancel is never overwritten.
      const { error } = await db().from("automation_runs").update(patch).eq("id", run.id).eq("status", "running");
      if (error) throw new Error("could not record the run result");
    },
    async onFailure(automation, run, message) {
      if (!automation.notify_on_failure) return;
      if (!emailConfigured() || ownerEmails().length === 0) return; // still visible in the run history and activity feed
      await sendEmail({
        to: ownerEmails(), subject: `[Automation failed] ${automation.name}`.slice(0, 200),
        html: `<p><strong>${escapeHtml(automation.name)}</strong> failed.</p><p>${escapeHtml(message)}</p><p style="color:#888">Run ${escapeHtml(run.id)}</p>`,
        text: `${automation.name} failed.\n\n${message}\n\nRun ${run.id}`,
      });
    },
    async audit(run, status, detail) {
      await logActivity({ agentName: "Automation", toolName: "automation.run", status, payload: { run_id: run.id, ...detail } as never }).catch(() => undefined);
    },
  };
}

/** Claims due runs (SKIP LOCKED) and processes them. Safe to call concurrently. */
export async function runDueAutomations(limit = 2, deps: Deps = realDeps()) {
  const worker = `w-${randomUUID().slice(0, 8)}`;
  const { data, error } = await db().rpc("claim_automation_runs", { p_limit: limit, p_worker: worker });
  if (error) throw new Error("Could not claim automation runs.");
  const runs = (data ?? []) as RunRecord[];
  const results: Record<string, string> = {};
  for (const run of runs) {
    try {
      results[run.id] = await processRun(run, deps);
    } catch {
      // The lock expires after 15 minutes and the run resumes at its saved step.
      results[run.id] = "error";
    }
  }
  return { claimed: runs.length, results };
}
