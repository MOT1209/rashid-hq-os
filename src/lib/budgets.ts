import "server-only";

import { captureError } from "@/lib/errors";
import { sendEmail } from "@/lib/email";
import { ownerEmails } from "@/lib/owners";
import { getServiceSupabase } from "@/lib/supabase/server";

/**
 * Spend guardrails (Phase 1.2, migration 0018). agent_runs measures what each
 * model run cost; this turns the measurement into a budget: past 80% the
 * owners get one mail a day, at 100% no new department run starts.
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
async function bestEffort(work: Promise<unknown>, label: string): Promise<void> {
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

async function sendBudgetAlert(input: {
  agentName: string;
  used: number;
  budget: number;
}): Promise<boolean> {
  const to = ownerEmails();
  if (to.length === 0) return false;
  const { agentName, used, budget } = input;
  const subject = `ميزانية ${agentName} تجاوزت 80% · ${agentName} past 80% of its token budget`;
  const text = [
    `استهلك وكيل "${agentName}" ${used.toLocaleString("en")} من ${budget.toLocaleString("en")} توكن شهريًا.`,
    "عند 100% تتوقف التشغيلات الجديدة — ارفع السقف من Settings إن كان مقصودًا.",
    "",
    `Agent "${agentName}" has used ${used.toLocaleString("en")} of ${budget.toLocaleString("en")} monthly tokens.`,
    "New runs stop at 100% — raise the cap in Settings if that spend is intended.",
  ].join("\n");
  return sendEmail({ to, subject, html: `<pre>${text}</pre>`, text });
}

export async function checkDepartmentBudget(input: {
  agentName: string;
  departmentKey: string;
  budget: number | null | undefined;
  alertedAt: string | null | undefined;
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

  if (used >= budget) {
    await recordBudgetEvent({
      agentName: input.agentName,
      tokensUsed: used,
      budget,
      kind: "blocked",
    });
    return { allowed: false, used, budget, alerted: false };
  }

  if (used >= budget * BUDGET_ALERT_RATIO) {
    const last = input.alertedAt ? Date.parse(input.alertedAt) : NaN;
    if (Number.isFinite(last) && Date.now() - last < DAY_MS) {
      return { allowed: true, used, budget, alerted: false };
    }
    const sent = await sendBudgetAlert({ agentName: input.agentName, used, budget });
    if (sent) {
      await bestEffort(
        getServiceSupabase()
          .from("departments")
          .update({ budget_alerted_at: new Date().toISOString() })
          .eq("key", input.departmentKey)
          .then(({ error }) => {
            if (error) throw error;
          }),
        "budget:alert-stamp",
      );
      await recordBudgetEvent({
        agentName: input.agentName,
        tokensUsed: used,
        budget,
        kind: "alert",
      });
    }
    return { allowed: true, used, budget, alerted: sent };
  }

  return { allowed: true, used, budget, alerted: false };
}
