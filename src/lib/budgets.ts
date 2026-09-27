import "server-only";

import { captureError } from "@/lib/errors";
import { escapeHtml, sendEmail } from "@/lib/email";
import { ownerEmails } from "@/lib/owners";
import { getServiceSupabase } from "@/lib/supabase/server";

/**
 * Spend guardrails (Phase 1.2, migration 0018). agent_runs measures what each
 * model run cost; this turns the measurement into a budget: past 80% the
 * owners get one mail a day, at 100% no new department run starts and the
 * owners get a separate "runs are blocked" mail (also one a day, 0021).
 *
 * Fail-safe throughout: a ledger outage must never halt the business, so any
 * DB error here resolves to `allowed: true` and is reported to Sentry — the
 * run proceeds exactly as it did before budgets existed.
 */

export const BUDGET_WINDOW_DAYS = 30;
const BUDGET_ALERT_RATIO = 0.8;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Same ceiling as the insights query — one window cannot pull unbounded rows. */
const SPEND_MAX_ROWS = 5000;

export type BudgetCheck = {
  allowed: boolean;
  used: number;
  budget: number | null;
  alerted: boolean;
};

/** Best-effort side effects (events, alert timestamps) must never flip a verdict. */
async function bestEffort(work: PromiseLike<unknown>, label: string): Promise<void> {
  try {
    await work;
  } catch (error) {
    captureError(label, error);
  }
}

export async function spendForAgent(
  agentName: string,
  days = BUDGET_WINDOW_DAYS,
): Promise<number> {
  const since = new Date(Date.now() - days * DAY_MS).toISOString();
  const { data, error } = await getServiceSupabase()
    .from("agent_runs")
    .select("tokens_in, tokens_out")
    .eq("agent_name", agentName)
    .gte("created_at", since)
    .limit(SPEND_MAX_ROWS);
  if (error) throw error;
  return ((data ?? []) as { tokens_in: number | null; tokens_out: number | null }[]).reduce(
    (sum, row) => sum + (row.tokens_in ?? 0) + (row.tokens_out ?? 0),
    0,
  );
}

async function recordBudgetEvent(input: {
  agentName: string;
  tokensUsed: number;
  budget: number;
  kind: "alert" | "blocked";
}): Promise<void> {
  await bestEffort(
    getServiceSupabase()
      .from("budget_events")
      .insert({
        agent_name: input.agentName,
        tokens_used: input.tokensUsed,
        budget: input.budget,
        kind: input.kind,
      })
      .then(({ error }) => {
        if (error) throw error;
      }),
    "budget:event",
  );
}

type AlertLevel = "warning" | "exhausted";

function alertedWithinADay(stamp: string | null | undefined): boolean {
  const last = stamp ? Date.parse(stamp) : NaN;
  return Number.isFinite(last) && Date.now() - last < DAY_MS;
}

async function sendBudgetAlert(input: {
  agentName: string;
  used: number;
  budget: number;
  level: AlertLevel;
}): Promise<boolean> {
  const to = ownerEmails();
  if (to.length === 0) return false;
  const { agentName, level } = input;
  const used = input.used.toLocaleString("en");
  const budget = input.budget.toLocaleString("en");
  const subject =
    level === "exhausted"
      ? `ميزانية ${agentName} نفدت — التشغيلات متوقفة · ${agentName} hit 100% — runs are blocked`
      : `ميزانية ${agentName} تجاوزت 80% · ${agentName} past 80% of its token budget`;
  const text = (
    level === "exhausted"
      ? [
          `استهلك وكيل "${agentName}" ${used} من ${budget} توكن — لن تبدأ أي تشغيلات جديدة له.`,
          "ارفع السقف من Settings إن كان هذا الاستهلاك مقصودًا، وإلا راجع Insights بحثًا عن حلقة.",
          "",
          `Agent "${agentName}" has used ${used} of ${budget} tokens — no new runs will start.`,
          "Raise the cap in Settings if that spend is intended; otherwise check Insights for a runaway loop.",
        ]
      : [
          `استهلك وكيل "${agentName}" ${used} من ${budget} توكن شهريًا.`,
          "عند 100% تتوقف التشغيلات الجديدة — ارفع السقف من Settings إن كان مقصودًا.",
          "",
          `Agent "${agentName}" has used ${used} of ${budget} monthly tokens.`,
          "New runs stop at 100% — raise the cap in Settings if that spend is intended.",
        ]
  ).join("\n");
  // agentName is admin-editable free text; escape it like every other template.
  return sendEmail({ to, subject, html: `<pre>${escapeHtml(text)}</pre>`, text });
}

/**
 * Mails the owners at most once a day per level, then stamps the department.
 * The stamp is written only after a successful send, so a mail outage retries
 * on the next run instead of losing the alert for a day. Two concurrent runs
 * can both send (read-then-write throttle) — a duplicate mail, judged cheaper
 * than a row lock on every gate check.
 */
async function alertOnce(input: {
  agentName: string;
  departmentKey: string;
  used: number;
  budget: number;
  level: AlertLevel;
  lastAlertedAt: string | null | undefined;
}): Promise<boolean> {
  if (alertedWithinADay(input.lastAlertedAt)) return false;
  const sent = await sendBudgetAlert(input);
  if (!sent) return false;
  await bestEffort(
    getServiceSupabase()
      .from("departments")
      .update(
        input.level === "exhausted"
          ? { budget_exhausted_alerted_at: new Date().toISOString() }
          : { budget_alerted_at: new Date().toISOString() },
      )
      .eq("key", input.departmentKey)
      .then(({ error }) => {
        if (error) throw error;
      }),
    "budget:alert-stamp",
  );
  return true;
}

/**
 * The gate, called before a department run starts (src/lib/department-agent.ts)
 * — not from recordAgentRun: by the time a run is recorded its tokens are
 * already spent, so a check there could only report an overrun, never
 * prevent one. The cost of checking up front is that one run can overshoot
 * the cap by at most its own spend (bounded by MAX_STEPS).
 */
export async function checkDepartmentBudget(input: {
  agentName: string;
  departmentKey: string;
  budget: number | null | undefined;
  alertedAt: string | null | undefined;
  /** Throttle stamp for the 100% mail (migration 0021). */
  exhaustedAlertedAt?: string | null | undefined;
}): Promise<BudgetCheck> {
  const budget = input.budget ?? null;
  if (budget === null || budget <= 0) return { allowed: true, used: 0, budget: null, alerted: false };

  let used: number;
  try {
    used = await spendForAgent(input.agentName);
  } catch (error) {
    captureError("budget:check", error, { agentName: input.agentName });
    return { allowed: true, used: 0, budget, alerted: false };
  }

  const alertInput = {
    agentName: input.agentName,
    departmentKey: input.departmentKey,
    used,
    budget,
  };

  if (used >= budget) {
    // Every blocked attempt is audited; only the first one a day mails.
    await recordBudgetEvent({
      agentName: input.agentName,
      tokensUsed: used,
      budget,
      kind: "blocked",
    });
    const alerted = await alertOnce({
      ...alertInput,
      level: "exhausted",
      lastAlertedAt: input.exhaustedAlertedAt,
    });
    return { allowed: false, used, budget, alerted };
  }

  if (used >= budget * BUDGET_ALERT_RATIO) {
    const alerted = await alertOnce({
      ...alertInput,
      level: "warning",
      lastAlertedAt: input.alertedAt,
    });
    if (alerted) {
      await recordBudgetEvent({
        agentName: input.agentName,
        tokensUsed: used,
        budget,
        kind: "alert",
      });
    }
    return { allowed: true, used, budget, alerted };
  }

  return { allowed: true, used, budget, alerted: false };
}
