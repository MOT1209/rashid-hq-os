import "server-only";

import { captureError } from "@/lib/errors";
import { escapeHtml, sendEmail } from "@/lib/email";
import { ownerEmails } from "@/lib/owners";
import { getServiceSupabase } from "@/lib/supabase/server";

/**
 * Spend guardrails (Phase 1.2, migration 0018; project scope added in 0022).
 * agent_runs measures what each model run cost; this turns the measurement
 * into a budget: past 80% the owners get one mail a day, at 100% no new
 * department/project-gated run starts and the owners get a separate "runs
 * are blocked" mail (also one a day, 0021).
 *
 * Department and project budgets share one engine (checkBudget/spendFor)
 * parameterized by scope — the alert throttling, mail copy and budget_events
 * bookkeeping are identical, only the table/column being read and stamped
 * differs.
 *
 * Fail-safe throughout: a ledger outage must never halt the business, so any
 * DB error here resolves to `allowed: true` and is reported to Sentry — the
 * run proceeds exactly as it did before budgets existed.
 */

export const BUDGET_WINDOW_DAYS = 30;
const BUDGET_ALERT_RATIO = 0.8;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Page size for summing agent_runs — keeps each request bounded. */
const SPEND_PAGE_SIZE = 1000;
/**
 * Hard stop on pagination so a runaway agent can't turn a budget check into
 * an unbounded scan. 200 pages (~200k rows) is far beyond any real 30-day
 * window; hitting it means something is badly wrong upstream, so we log and
 * return the partial sum rather than loop forever.
 */
const SPEND_MAX_PAGES = 200;

export type BudgetCheck = {
  allowed: boolean;
  used: number;
  budget: number | null;
  alerted: boolean;
};

type BudgetScope = "department" | "project";
type BudgetNoun = "agent" | "project";

/** Best-effort side effects (events, alert timestamps) must never flip a verdict. */
async function bestEffort(work: PromiseLike<unknown>, label: string): Promise<void> {
  try {
    await work;
  } catch (error) {
    captureError(label, error);
  }
}

async function spendFor(scope: BudgetScope, key: string, days = BUDGET_WINDOW_DAYS): Promise<number> {
  const since = new Date(Date.now() - days * DAY_MS).toISOString();
  const column = scope === "department" ? "agent_name" : "project_id";
  const client = getServiceSupabase();

  // Paginate rather than cap at one page: a single `.limit()` silently
  // truncates the sum for any department/project past that many runs in the
  // window, which is exactly the case a budget check exists to catch.
  let total = 0;
  for (let page = 0; page < SPEND_MAX_PAGES; page++) {
    const from = page * SPEND_PAGE_SIZE;
    const { data, error } = await client
      .from("agent_runs")
      .select("tokens_in, tokens_out")
      .eq(column, key)
      .gte("created_at", since)
      .range(from, from + SPEND_PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as { tokens_in: number | null; tokens_out: number | null }[];
    total += rows.reduce((sum, row) => sum + (row.tokens_in ?? 0) + (row.tokens_out ?? 0), 0);
    if (rows.length < SPEND_PAGE_SIZE) return total;
  }
  captureError(
    "budgets.spendFor.pageLimitExceeded",
    new Error(`spendFor(${scope}, ${key}) hit ${SPEND_MAX_PAGES} pages — returning partial sum`),
  );
  return total;
}

export function spendForAgent(agentName: string, days = BUDGET_WINDOW_DAYS): Promise<number> {
  return spendFor("department", agentName, days);
}

export function spendForProject(projectId: string, days = BUDGET_WINDOW_DAYS): Promise<number> {
  return spendFor("project", projectId, days);
}

async function recordBudgetEvent(input: {
  agentName: string;
  projectId?: string | null;
  tokensUsed: number;
  budget: number;
  kind: "alert" | "blocked";
}): Promise<void> {
  await bestEffort(
    getServiceSupabase()
      .from("budget_events")
      .insert({
        agent_name: input.agentName,
        project_id: input.projectId ?? null,
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

function nounLabel(noun: BudgetNoun, lang: "ar" | "en"): string {
  if (noun === "agent") return lang === "ar" ? "وكيل" : "Agent";
  return lang === "ar" ? "مشروع" : "Project";
}

async function sendBudgetAlert(input: {
  noun: BudgetNoun;
  label: string;
  used: number;
  budget: number;
  level: AlertLevel;
}): Promise<boolean> {
  const to = ownerEmails();
  if (to.length === 0) return false;
  const { label, level, noun } = input;
  const used = input.used.toLocaleString("en");
  const budget = input.budget.toLocaleString("en");
  const nounAr = nounLabel(noun, "ar");
  const nounEn = nounLabel(noun, "en");
  const subject =
    level === "exhausted"
      ? `ميزانية ${label} نفدت — التشغيلات متوقفة · ${label} hit 100% — runs are blocked`
      : `ميزانية ${label} تجاوزت 80% · ${label} past 80% of its token budget`;
  const text = (
    level === "exhausted"
      ? [
          `استهلك ${nounAr} "${label}" ${used} من ${budget} توكن — لن تبدأ أي تشغيلات جديدة له.`,
          "ارفع السقف من Settings إن كان هذا الاستهلاك مقصودًا، وإلا راجع Insights بحثًا عن حلقة.",
          "",
          `${nounEn} "${label}" has used ${used} of ${budget} tokens — no new runs will start.`,
          "Raise the cap in Settings if that spend is intended; otherwise check Insights for a runaway loop.",
        ]
      : [
          `استهلك ${nounAr} "${label}" ${used} من ${budget} توكن شهريًا.`,
          "عند 100% تتوقف التشغيلات الجديدة — ارفع السقف من Settings إن كان مقصودًا.",
          "",
          `${nounEn} "${label}" has used ${used} of ${budget} monthly tokens.`,
          "New runs stop at 100% — raise the cap in Settings if that spend is intended.",
        ]
  ).join("\n");
  // label is admin-editable free text (agent name or project name); escape it
  // like every other template.
  return sendEmail({ to, subject, html: `<pre>${escapeHtml(text)}</pre>`, text });
}

/**
 * Mails the owners at most once a day per level, then stamps the department
 * or project row. The stamp is written only after a successful send, so a
 * mail outage retries on the next run instead of losing the alert for a day.
 * Two concurrent runs can both send (read-then-write throttle) — a duplicate
 * mail, judged cheaper than a row lock on every gate check.
 */
async function alertOnce(input: {
  tableName: "departments" | "projects";
  rowKey: "key" | "id";
  rowKeyValue: string;
  noun: BudgetNoun;
  agentName: string;
  projectId?: string | null;
  used: number;
  budget: number;
  level: AlertLevel;
  lastAlertedAt: string | null | undefined;
}): Promise<boolean> {
  if (alertedWithinADay(input.lastAlertedAt)) return false;
  const sent = await sendBudgetAlert({
    noun: input.noun,
    label: input.agentName,
    used: input.used,
    budget: input.budget,
    level: input.level,
  });
  if (!sent) return false;
  const patch =
    input.level === "exhausted"
      ? { budget_exhausted_alerted_at: new Date().toISOString() }
      : { budget_alerted_at: new Date().toISOString() };
  // Two branches, not one dynamic .from(tableName).eq(rowKey, ...): the
  // generated Supabase types key each table's `eq` columns off its own name,
  // so a union tableName/rowKey pair does not type-check against either.
  const stamped =
    input.tableName === "departments"
      ? getServiceSupabase().from("departments").update(patch).eq("key", input.rowKeyValue)
      : getServiceSupabase().from("projects").update(patch).eq("id", input.rowKeyValue);
  await bestEffort(
    stamped.then(({ error }) => {
      if (error) throw error;
    }),
    "budget:alert-stamp",
  );
  return true;
}

type CheckBudgetInput = {
  scope: BudgetScope;
  /** agent_name (department) or project id (project) — what spendFor sums by. */
  subjectKey: string;
  /** Name shown in mail copy and stored as budget_events.agent_name either way. */
  label: string;
  tableName: "departments" | "projects";
  rowKey: "key" | "id";
  rowKeyValue: string;
  projectId?: string | null;
  budget: number | null | undefined;
  alertedAt: string | null | undefined;
  /** Throttle stamp for the 100% mail (migration 0021). */
  exhaustedAlertedAt?: string | null | undefined;
};

/**
 * The gate, called before a department run or a project tool call starts —
 * not from recordAgentRun: by the time a run is recorded its tokens are
 * already spent, so a check there could only report an overrun, never
 * prevent one. The cost of checking up front is that one run can overshoot
 * the cap by at most its own spend (bounded by MAX_STEPS for departments).
 */
async function checkBudget(input: CheckBudgetInput): Promise<BudgetCheck> {
  const budget = input.budget ?? null;
  if (budget === null || budget <= 0) return { allowed: true, used: 0, budget: null, alerted: false };

  let used: number;
  try {
    used = await spendFor(input.scope, input.subjectKey);
  } catch (error) {
    captureError("budget:check", error, { agentName: input.label });
    return { allowed: true, used: 0, budget, alerted: false };
  }

  const noun: BudgetNoun = input.scope === "project" ? "project" : "agent";
  const alertBase = {
    tableName: input.tableName,
    rowKey: input.rowKey,
    rowKeyValue: input.rowKeyValue,
    noun,
    agentName: input.label,
    projectId: input.projectId,
    used,
    budget,
  };

  if (used >= budget) {
    // Every blocked attempt is audited; only the first one a day mails.
    await recordBudgetEvent({
      agentName: input.label,
      projectId: input.projectId,
      tokensUsed: used,
      budget,
      kind: "blocked",
    });
    const alerted = await alertOnce({
      ...alertBase,
      level: "exhausted",
      lastAlertedAt: input.exhaustedAlertedAt,
    });
    return { allowed: false, used, budget, alerted };
  }

  if (used >= budget * BUDGET_ALERT_RATIO) {
    const alerted = await alertOnce({
      ...alertBase,
      level: "warning",
      lastAlertedAt: input.alertedAt,
    });
    if (alerted) {
      await recordBudgetEvent({
        agentName: input.label,
        projectId: input.projectId,
        tokensUsed: used,
        budget,
        kind: "alert",
      });
    }
    return { allowed: true, used, budget, alerted };
  }

  return { allowed: true, used, budget, alerted: false };
}

export function checkDepartmentBudget(input: {
  agentName: string;
  departmentKey: string;
  budget: number | null | undefined;
  alertedAt: string | null | undefined;
  exhaustedAlertedAt?: string | null | undefined;
}): Promise<BudgetCheck> {
  return checkBudget({
    scope: "department",
    subjectKey: input.agentName,
    label: input.agentName,
    tableName: "departments",
    rowKey: "key",
    rowKeyValue: input.departmentKey,
    budget: input.budget,
    alertedAt: input.alertedAt,
    exhaustedAlertedAt: input.exhaustedAlertedAt,
  });
}

/** Same contract as checkDepartmentBudget, gating a project's monthly_token_budget instead. */
export function checkProjectBudget(input: {
  projectId: string;
  projectName: string;
  budget: number | null | undefined;
  alertedAt: string | null | undefined;
  exhaustedAlertedAt?: string | null | undefined;
}): Promise<BudgetCheck> {
  return checkBudget({
    scope: "project",
    subjectKey: input.projectId,
    label: input.projectName,
    tableName: "projects",
    rowKey: "id",
    rowKeyValue: input.projectId,
    projectId: input.projectId,
    budget: input.budget,
    alertedAt: input.alertedAt,
    exhaustedAlertedAt: input.exhaustedAlertedAt,
  });
}
