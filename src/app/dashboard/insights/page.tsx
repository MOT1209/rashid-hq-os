import { EmptyState, Panel, StatCard } from "@/components/ui";
import { getLocale, getT } from "@/lib/locale-server";
import {
  fetchDepartments,
  fetchProjectBudgets,
  fetchRunInsights,
  INSIGHTS_WINDOW_DAYS,
} from "@/lib/queries";
import { requireSession } from "@/lib/session";
import { departmentName } from "@/lib/agents";
import type { Bucket } from "@/lib/insights";
import type { Dictionary } from "@/lib/i18n";

type BudgetRow = { key: string; name: string; used: number; budget: number | null };

export const dynamic = "force-dynamic";

/**
 * The first page to read agent_runs (migration 0016). Everything else in this
 * console answers "what did an agent do"; this one answers "what did it cost".
 */
export default async function InsightsPage() {
  const [t, locale] = await Promise.all([getT(), getLocale(), requireSession()]);
  const [insights, departments, projects] = await Promise.all([
    fetchRunInsights(),
    fetchDepartments(),
    fetchProjectBudgets(),
  ]);

  const spendByAgent = new Map(insights.byAgent.map((b) => [b.key, b.tokens]));
  const departmentBudgets: BudgetRow[] = departments.map((d) => ({
    key: d.key,
    name: departmentName(d, locale),
    used: spendByAgent.get(d.agent_name) ?? 0,
    // Pre-0018 rows (or a missing migration) read as unlimited, not zero.
    budget: d.monthly_token_budget ?? null,
  }));

  const spendByProject = new Map(insights.byProject.map((b) => [b.key, b.tokens]));
  // Only projects with a cap set are worth showing here — an uncapped
  // project's spend already appears in the Insights numbers above.
  const projectBudgets: BudgetRow[] = projects
    .filter((p) => p.monthly_token_budget !== null)
    .map((p) => ({
      key: p.id,
      name: p.name,
      used: spendByProject.get(p.id) ?? 0,
      budget: p.monthly_token_budget,
    }));

  const kindLabel: Record<string, string> = {
    console: t.runKindConsole,
    delegation: t.runKindDelegation,
    standing_task: t.runKindStandingTask,
  };

  const number = (value: number) => value.toLocaleString(locale);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t.insights}</h1>
        <p className="text-sm text-muted">
          {t.insightsHint.replace("{days}", String(INSIGHTS_WINDOW_DAYS))}
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t.totalRuns} value={number(insights.runs)} />
        <StatCard
          label={t.totalTokens}
          value={number(insights.tokensIn + insights.tokensOut)}
        />
        <StatCard label={t.failureRate} value={`${insights.failureRate}%`} />
        <StatCard
          label={t.avgDuration}
          value={`${(insights.avgDurationMs / 1000).toFixed(1)}s`}
        />
      </div>

      <Panel title={t.budgets}>
        <p className="mb-3 text-sm text-muted">{t.budgetsHint}</p>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
          {t.departments}
        </h3>
        <BudgetList rows={departmentBudgets} t={t} number={number} />
        {projectBudgets.length > 0 && (
          <>
            <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-muted">
              {t.projects}
            </h3>
            <BudgetList rows={projectBudgets} t={t} number={number} />
          </>
        )}
      </Panel>

      {insights.runs === 0 ? (
        <Panel title={t.tokensPerDay}>
          <EmptyState>{t.noRuns}</EmptyState>
        </Panel>
      ) : (
        <>
          <Panel title={t.tokensPerDay}>
            <TokensPerDay days={insights.byDay} locale={locale} t={t} />
          </Panel>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title={t.byKind}>
              <BucketTable
                buckets={insights.byKind}
                label={(key) => kindLabel[key] ?? key}
                t={t}
                number={number}
              />
            </Panel>

            <Panel title={t.byAgent}>
              <BucketTable
                buckets={insights.byAgent}
                label={(key) => key}
                t={t}
                number={number}
              />
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

/** Shared by the departments and projects sub-lists in the Budgets panel. */
function BudgetList({
  rows,
  t,
  number,
}: {
  rows: BudgetRow[];
  t: Dictionary;
  number: (value: number) => string;
}) {
  return (
    <ul className="space-y-3">
      {rows.map((b) => {
        const pct = b.budget ? Math.min(100, Math.round((b.used / b.budget) * 100)) : 0;
        const over = b.budget !== null && b.used >= b.budget;
        return (
          <li key={b.key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium">{b.name}</span>
              <span className={over ? "text-err" : "text-muted"}>
                {b.budget === null
                  ? `${number(b.used)} ${t.tokens} · ${t.unlimited}`
                  : `${number(b.used)} / ${number(b.budget)} ${t.tokens}`}
              </span>
            </div>
            {b.budget !== null && (
              <div
                className="mt-1 h-2 overflow-hidden rounded-full bg-panel-2"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={b.name}
              >
                <div
                  className={`h-full rounded-full ${over ? "bg-err" : pct >= 80 ? "bg-warn" : "bg-accent"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A bar per day, drawn with plain divs. A chart library would be the fifth
 * dependency in this console for one view; the shape of the trend is all this
 * needs to show, and the exact numbers are one hover away.
 */
function TokensPerDay({
  days,
  locale,
  t,
}: {
  days: Bucket[];
  locale: string;
  t: Dictionary;
}) {
  const peak = Math.max(...days.map((day) => day.tokens), 1);

  return (
    <div className="overflow-x-auto">
      <ul className="flex min-w-[32rem] items-end gap-1" style={{ height: "8rem" }}>
        {days.map((day) => (
          <li
            key={day.key}
            className="flex h-full flex-1 flex-col justify-end"
            title={`${new Date(day.key).toLocaleDateString(locale)} · ${day.tokens.toLocaleString(locale)} ${t.tokens} · ${day.runs} ${t.totalRuns}`}
          >
            <div
              className="rounded-t bg-accent/70"
              style={{ height: `${Math.round((day.tokens / peak) * 100)}%` }}
            />
          </li>
        ))}
      </ul>
      <p className="mt-2 flex justify-between text-xs text-muted">
        <span>{new Date(days[0].key).toLocaleDateString(locale)}</span>
        <span>{new Date(days[days.length - 1].key).toLocaleDateString(locale)}</span>
      </p>
    </div>
  );
}

function BucketTable({
  buckets,
  label,
  t,
  number,
}: {
  buckets: Bucket[];
  label: (key: string) => string;
  t: Dictionary;
  number: (value: number) => string;
}) {
  if (buckets.length === 0) return <EmptyState>{t.noRuns}</EmptyState>;

  return (
    <table className="w-full text-sm">
      <thead className="text-xs uppercase tracking-wider text-muted">
        <tr className="border-b border-border">
          <th scope="col" className="py-2 text-start">
            {t.agent}
          </th>
          <th scope="col" className="py-2 text-end">
            {t.totalRuns}
          </th>
          <th scope="col" className="py-2 text-end">
            {t.tokens}
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {buckets.map((bucket) => (
          <tr key={bucket.key}>
            <td className="py-2.5">{label(bucket.key)}</td>
            <td className="py-2.5 text-end text-muted">{number(bucket.runs)}</td>
            <td className="py-2.5 text-end text-accent">{number(bucket.tokens)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
