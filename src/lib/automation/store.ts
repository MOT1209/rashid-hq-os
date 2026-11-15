import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { nextCronRun } from "@/lib/automation/cron";
import { LIMITS, type Definition, type EventType, type Step, type StepResult } from "@/lib/automation/definition";
import { dbError } from "@/lib/errors";
import { getServiceSupabase } from "@/lib/supabase/server";

const db = () => getServiceSupabase() as unknown as SupabaseClient;

export type AutomationRow = {
  id: string; owner_id: string; name: string; description: string; enabled: boolean;
  trigger_type: "manual" | "schedule" | "event"; schedule_cron: string | null; timezone: string; event_type: string | null;
  steps: Step[]; max_attempts: number; backoff_seconds: number; notify_on_failure: boolean;
  next_run_at: string | null; last_run_at: string | null; version: number; created_at: string; updated_at: string;
};

export type RunRow = {
  id: string; automation_id: string; owner_id: string; status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  trigger: "manual" | "schedule" | "event"; trigger_payload: Record<string, unknown>; run_at: string; current_step: number;
  step_results: StepResult[]; error: string | null; created_at: string; started_at: string | null; finished_at: string | null;
};

export class ConflictError extends Error {}
export class RateLimitError extends Error {}

const rowFrom = (d: Definition) => ({
  name: d.name, description: d.description, trigger_type: d.trigger.type,
  schedule_cron: d.trigger.type === "schedule" ? d.trigger.cron : null,
  timezone: d.trigger.type === "schedule" ? d.trigger.timezone : "UTC",
  event_type: d.trigger.type === "event" ? d.trigger.event : null,
  steps: d.steps, max_attempts: d.maxAttempts, backoff_seconds: d.backoffSeconds, notify_on_failure: d.notifyOnFailure,
});

/** Next due time for a schedule automation, or null for other triggers. */
export function nextRunFor(a: Pick<AutomationRow, "trigger_type" | "schedule_cron" | "timezone">, after: Date): string | null {
  if (a.trigger_type !== "schedule" || !a.schedule_cron) return null;
  return nextCronRun(a.schedule_cron, after, a.timezone)?.toISOString() ?? null;
}

export async function listAutomations(ownerId: string): Promise<AutomationRow[]> {
  const { data, error } = await db().from("automations").select("*").eq("owner_id", ownerId).order("updated_at", { ascending: false }).limit(200);
  if (error) throw dbError("Loading automations", error);
  return (data ?? []) as AutomationRow[];
}

export async function getAutomation(ownerId: string, id: string): Promise<AutomationRow | null> {
  const { data, error } = await db().from("automations").select("*").eq("owner_id", ownerId).eq("id", id).maybeSingle();
  if (error) throw dbError("Loading the automation", error);
  return (data as AutomationRow | null) ?? null;
}

/** New automations are created PAUSED; the owner enables them explicitly. */
export async function createAutomation(ownerId: string, d: Definition): Promise<AutomationRow> {
  const { data, error } = await db().from("automations").insert({ owner_id: ownerId, enabled: false, ...rowFrom(d) }).select("*").single();
  if (error) throw dbError("Saving the automation", error);
  return data as AutomationRow;
}

export async function updateAutomation(ownerId: string, id: string, d: Definition, expectedVersion: number): Promise<AutomationRow> {
  const current = await getAutomation(ownerId, id);
  if (!current) throw new Error("Automation not found.");
  if (current.version !== expectedVersion) throw new ConflictError("This automation was changed elsewhere. Reload and try again.");
  const row = rowFrom(d);
  const now = new Date();
  const { data, error } = await db()
    .from("automations")
    .update({
      ...row, version: current.version + 1, updated_at: now.toISOString(),
      // The schedule may have changed: recompute (only while enabled).
      next_run_at: current.enabled ? nextRunFor({ trigger_type: row.trigger_type, schedule_cron: row.schedule_cron, timezone: row.timezone }, now) : null,
    })
    .eq("id", id).eq("owner_id", ownerId).eq("version", expectedVersion)
    .select("*").maybeSingle();
  if (error) throw dbError("Updating the automation", error);
  if (!data) throw new ConflictError("This automation was changed elsewhere. Reload and try again.");
  return data as AutomationRow;
}

/** Resume = enabled true (schedule recomputed from now, so no burst of missed runs); pause = enabled false. */
export async function setEnabled(ownerId: string, id: string, enabled: boolean): Promise<boolean> {
  const a = await getAutomation(ownerId, id);
  if (!a) return false;
  const now = new Date();
  const { data, error } = await db()
    .from("automations")
    .update({ enabled, next_run_at: enabled ? nextRunFor(a, now) : null, updated_at: now.toISOString() })
    .eq("id", id).eq("owner_id", ownerId).select("id");
  if (error) throw dbError("Updating the automation", error);
  if (enabled === false) {
    // Pausing also stops runs that have not started yet.
    await db().from("automation_runs").update({ status: "cancelled", error: "The automation was paused.", finished_at: now.toISOString() }).eq("automation_id", id).eq("status", "queued").neq("trigger", "manual");
  }
  return Boolean(data?.length);
}

export async function deleteAutomation(ownerId: string, id: string): Promise<boolean> {
  const { data, error } = await db().from("automations").delete().eq("id", id).eq("owner_id", ownerId).select("id");
  if (error) throw dbError("Deleting the automation", error);
  return Boolean(data?.length);
}

export async function listRuns(ownerId: string, automationId?: string, limit = 30): Promise<RunRow[]> {
  let q = db().from("automation_runs").select("*").eq("owner_id", ownerId).order("created_at", { ascending: false }).limit(Math.min(limit, 100));
  if (automationId) q = q.eq("automation_id", automationId);
  const { data, error } = await q;
  if (error) throw dbError("Loading runs", error);
  return (data ?? []) as RunRow[];
}

export async function cancelRun(ownerId: string, runId: string): Promise<boolean> {
  const { data, error } = await db().from("automation_runs").update({ status: "cancelled", error: "Cancelled by the owner.", finished_at: new Date().toISOString() }).eq("id", runId).eq("owner_id", ownerId).eq("status", "queued").select("id");
  if (error) throw dbError("Cancelling the run", error);
  return Boolean(data?.length);
}

/**
 * Queues a run. The unique idempotency key makes a repeated schedule tick or a
 * redelivered event a no-op (returns null); a per-automation hourly cap stops
 * runaway loops.
 */
export async function enqueueRun(a: Pick<AutomationRow, "id" | "owner_id">, trigger: RunRow["trigger"], payload: Record<string, unknown>, idempotencyKey: string | null): Promise<string | null> {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count, error: cErr } = await db().from("automation_runs").select("id", { count: "exact", head: true }).eq("automation_id", a.id).gte("created_at", since);
  if (cErr) throw dbError("Checking the run rate", cErr);
  if ((count ?? 0) >= LIMITS.runsPerHour) throw new RateLimitError(`At most ${LIMITS.runsPerHour} runs per hour per automation.`);

  const { data, error } = await db().from("automation_runs")
    .insert({ automation_id: a.id, owner_id: a.owner_id, trigger, trigger_payload: payload, idempotency_key: idempotencyKey })
    .select("id").single();
  if (error) {
    if ((error as { code?: string }).code === "23505") return null; // duplicate tick/event
    throw dbError("Queueing the run", error);
  }
  await db().from("automations").update({ last_run_at: new Date().toISOString() }).eq("id", a.id);
  return (data as { id: string }).id;
}

/**
 * Queues a run for every due schedule automation and moves each to its next
 * slot. A missed window (worker down) yields ONE catch-up run, not a burst.
 * The update is conditional on the old next_run_at, so concurrent ticks cannot
 * both claim a slot.
 */
export async function tickSchedules(now: Date = new Date(), limit = 20): Promise<{ queued: number }> {
  const { data, error } = await db().from("automations").select("*").eq("enabled", true).eq("trigger_type", "schedule").lte("next_run_at", now.toISOString()).order("next_run_at").limit(limit);
  if (error) throw dbError("Loading due schedules", error);
  let queued = 0;
  for (const a of (data ?? []) as AutomationRow[]) {
    const slot = a.next_run_at as string;
    const next = nextRunFor(a, now);
    const { data: claimed } = await db().from("automations").update({ next_run_at: next }).eq("id", a.id).eq("next_run_at", slot).select("id");
    if (!claimed?.length) continue;
    try {
      if (await enqueueRun(a, "schedule", { scheduled_for: slot }, `sched:${a.id}:${slot}`)) queued += 1;
    } catch (e) {
      if (!(e instanceof RateLimitError)) throw e;
    }
  }
  return { queued };
}

const MAX_EVENT_BYTES = 4000;
const boundPayload = (p: Record<string, unknown>) => {
  const s = JSON.stringify(p);
  return s.length <= MAX_EVENT_BYTES ? p : { truncated: true, preview: s.slice(0, MAX_EVENT_BYTES) };
};

/** Queues a run for every enabled automation listening for `type`. Best effort; never throws to the caller. */
export async function emitEvent(type: EventType, payload: Record<string, unknown>, eventKey: string): Promise<number> {
  try {
    const { data, error } = await db().from("automations").select("id, owner_id").eq("enabled", true).eq("trigger_type", "event").eq("event_type", type).limit(50);
    if (error) return 0;
    let n = 0;
    for (const a of (data ?? []) as { id: string; owner_id: string }[]) {
      try {
        if (await enqueueRun(a, "event", { event: type, ...boundPayload(payload) }, `evt:${a.id}:${eventKey}`)) n += 1;
      } catch {
        // rate-limited or transient: the event is dropped for this automation
      }
    }
    return n;
  } catch {
    return 0;
  }
}
