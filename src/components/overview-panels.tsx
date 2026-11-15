import Link from "next/link";
import { Panel } from "@/components/ui";
import { deriveWarnings, type Level, type Overview } from "@/lib/overview-core";
import { levelColor, type OverviewT } from "@/lib/overview-i18n";

/**
 * CEO overview cards. A card whose data is `null` could not be loaded and says
 * so; it is never rendered as zero. Server component: no client state.
 */
const dot: Record<Level, string> = { ok: "bg-ok", info: "bg-muted", warn: "bg-warn", err: "bg-err" };

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div>
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className={`text-lg font-semibold ${tone ?? ""}`}>{value}</dd>
    </div>
  );
}

const Unavailable = ({ t }: { t: OverviewT }) => <p className="text-xs text-muted">{t.unavailable}</p>;

export function OverviewPanels({ t, o, locale }: { t: OverviewT; o: Overview; locale: string }) {
  const warnings = deriveWarnings(o);
  const when = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  const n = (v: number) => v.toLocaleString(locale);

  return (
    <section aria-label={t.title} className="space-y-4">
      <Panel title={t.attention}>
        {warnings.length === 0 ? (
          <p className="text-sm text-ok">{t.allClear}</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {warnings.map((w) => (
              <li key={w.id}>
                <Link href={w.href} className="flex items-start gap-2 rounded-lg px-2 py-1 hover:bg-panel-2">
                  <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot[w.level]}`} />
                  <span className={w.level === "err" ? "text-err" : "text-warn"}>
                    <span className="sr-only">{w.level === "err" ? "Error: " : "Warning: "}</span>
                    {w.count !== undefined ? `${n(w.count)} ` : ""}{t.w[w.id] ?? w.id}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Panel title={t.system}>
          <ul className="space-y-1 text-xs">
            <li className="flex items-center justify-between"><span>{t.database}</span><span className={o.db.ok ? "text-ok" : "text-err"}>{o.db.ok ? `${t.dbOk}${o.db.latencyMs !== null ? ` · ${o.db.latencyMs} ${t.latency}` : ""}` : t.dbDown}</span></li>
            {o.health.map((h) => (
              <li key={h.id} className="flex items-center justify-between"><span>{t.health[h.id] ?? h.id}</span><span className={levelColor[h.level]}>{h.level === "ok" ? "✓" : h.level === "info" ? "–" : "!"}<span className="sr-only"> {h.level}</span></span></li>
            ))}
          </ul>
        </Panel>

        <Panel title={t.agents} action={<Link href="/dashboard/agents" className="text-xs text-accent">{t.open}</Link>}>
          {!o.agents ? <Unavailable t={t} /> : (
            <dl className="grid grid-cols-3 gap-2">
              <Stat label={t.agentsOn} value={`${o.agents.enabled}/${o.agents.total}`} />
              <Stat label={t.runs24h} value={n(o.agents.runs24h)} />
              <Stat label={t.failed24h} value={n(o.agents.failed24h)} tone={o.agents.failed24h ? "text-err" : ""} />
            </dl>
          )}
        </Panel>

        <Panel title={t.running}>
          <dl className="grid grid-cols-1 gap-2 text-xs">
            <div className="flex justify-between"><dt>{t.automationsQ}</dt><dd className="font-semibold">{o.automations ? `${o.automations.queued}/${o.automations.running}` : "—"}</dd></div>
            <div className="flex justify-between"><dt>{t.socialQ}</dt><dd className="font-semibold">{o.social ? `${o.social.queued}/${o.social.running}` : "—"}</dd></div>
            <div className="flex justify-between"><dt>{t.tasksIn}</dt><dd className="font-semibold">{o.tasks ? <>{o.tasks.inProgress}{o.tasks.overdue ? <span className="text-err"> · {o.tasks.overdue} {t.overdue}</span> : null}</> : "—"}</dd></div>
          </dl>
        </Panel>

        <Panel title={t.approvals} action={<Link href="/dashboard/access" className="text-xs text-accent">{t.review}</Link>}>
          {o.approvalsPending === null ? <Unavailable t={t} /> : o.approvalsPending === 0 ? <p className="text-xs text-muted">{t.approvalsNone}</p> : <p className="text-2xl font-semibold text-warn">{n(o.approvalsPending)}</p>}
        </Panel>

        <Panel title={t.mcp} action={<Link href="/dashboard/mcp" className="text-xs text-accent">{t.open}</Link>}>
          {!o.mcp ? <Unavailable t={t} /> : (
            <dl className="grid grid-cols-2 gap-2">
              <Stat label={`${t.mcpTools} / ${t.mcpEnabled}`} value={`${o.mcp.tools} / ${o.mcp.enabled}`} />
              <Stat label={t.mcpDangerous} value={o.mcp.dangerous} />
              <Stat label={t.mcpFailing} value={o.mcp.testFailing} tone={o.mcp.testFailing ? "text-err" : ""} />
            </dl>
          )}
        </Panel>

        <Panel title={t.integrations} action={<Link href="/dashboard/settings/integrations" className="text-xs text-accent">{t.open}</Link>}>
          {!o.integrations ? <Unavailable t={t} /> : o.integrations.connected + o.integrations.error + o.integrations.expired + o.integrations.disconnected === 0 ? <p className="text-xs text-muted">{t.none}</p> : (
            <dl className="grid grid-cols-2 gap-2">
              <Stat label={t.connected} value={o.integrations.connected} tone="text-ok" />
              <Stat label={t.broken} value={o.integrations.error + o.integrations.expired} tone={o.integrations.error + o.integrations.expired ? "text-err" : ""} />
            </dl>
          )}
        </Panel>

        <Panel title={t.scheduled}>
          <p className="mb-1 text-[11px] text-muted">{t.nextAutomations}</p>
          {!o.automations ? <Unavailable t={t} /> : o.automations.next.length === 0 ? <p className="text-xs text-muted">{t.nothingScheduled}</p> : (
            <ul className="space-y-0.5 text-xs">{o.automations.next.map((x) => <li key={x.name + x.at} className="flex justify-between gap-2"><span className="truncate">{x.name}</span><span className="text-muted">{when(x.at)}</span></li>)}</ul>
          )}
          <p className="mb-1 mt-2 text-[11px] text-muted">{t.nextSocial}</p>
          {!o.social ? <Unavailable t={t} /> : <p className="text-xs">{o.social.nextRunAt ? when(o.social.nextRunAt) : t.nothingScheduled}</p>}
        </Panel>

        <Panel title={t.social} action={<Link href="/dashboard/social-studio" className="text-xs text-accent">{t.open}</Link>}>
          {!o.social ? <Unavailable t={t} /> : (
            <dl className="grid grid-cols-3 gap-2">
              <Stat label={t.accounts} value={o.social.accounts} />
              <Stat label={t.published7d} value={o.social.succeeded7d} />
              <Stat label={t.failed7d} value={o.social.failed7d} tone={o.social.failed7d ? "text-err" : ""} />
            </dl>
          )}
        </Panel>

        <Panel title={t.failures} action={<Link href="/dashboard/activity" className="text-xs text-accent">{t.open}</Link>}>
          {!o.activity ? <Unavailable t={t} /> : o.activity.recentFailures.length === 0 ? <p className="text-xs text-muted">{t.noFailures}</p> : (
            <ul className="space-y-0.5 text-xs">{o.activity.recentFailures.map((f) => <li key={f.id}><span className="text-muted">{when(f.at)}</span> · {f.agent ?? "—"} · <span dir="ltr">{f.tool ?? "—"}</span></li>)}</ul>
          )}
        </Panel>
      </div>
    </section>
  );
}
