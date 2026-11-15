"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAgentAction, deleteAgentAction, saveAgentConfigAction, testAgentAction } from "@/app/dashboard/agents/actions";
import { EmptyState, Field, FormError, Panel, fieldClass } from "@/components/ui";
import type { AgentsT } from "@/lib/agents-i18n";

export type AgentView = {
  key: string; isCustom: boolean; isFallback: boolean; icon: string; name: string; agentName: string; model: string | null;
  enabled: boolean; readOnly: boolean; allowedTools: string[] | null; projectIds: string[];
  budget: number | null; tokensUsed: number; budgetShare: number | null;
  metrics: { runs: number; successRate: number | null; avgDurationMs: number | null; avgSteps: number | null; tokensIn: number; tokensOut: number; lastRunAt: string | null; byKind: Record<string, number> } | null;
  failures: { id: string; tool_name: string | null; created_at: string; error: string | null }[];
};
type Msg = { kind: "ok" | "err"; text: string } | null;

function NewAgentForm({ t }: { t: AgentsT }) {
  const router = useRouter();
  const [f, setF] = useState({ key: "", name_en: "", name_ar: "", agent_name: "", icon: "🤖", system_prompt: "", model: "" });
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((v) => ({ ...v, [k]: e.target.value }));
  return (
    <Panel title={t.newAgent}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); start(async () => {
        const r = await createAgentAction(f);
        setMsg(r.ok ? { kind: "ok", text: t.created } : { kind: "err", text: r.error });
        if (r.ok) { setF({ key: "", name_en: "", name_ar: "", agent_name: "", icon: "🤖", system_prompt: "", model: "" }); router.refresh(); }
      }); }}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field id="na-key" label={t.key}><input id="na-key" dir="ltr" className={fieldClass} value={f.key} onChange={set("key")} required /></Field>
          <Field id="na-en" label={t.nameEn}><input id="na-en" className={fieldClass} value={f.name_en} onChange={set("name_en")} required /></Field>
          <Field id="na-ar" label={t.nameAr}><input id="na-ar" className={fieldClass} value={f.name_ar} onChange={set("name_ar")} required dir="auto" /></Field>
          <Field id="na-an" label={t.agentName}><input id="na-an" className={fieldClass} value={f.agent_name} onChange={set("agent_name")} required /></Field>
          <Field id="na-ic" label={t.icon}><input id="na-ic" className={fieldClass} value={f.icon} onChange={set("icon")} /></Field>
          <Field id="na-md" label={t.model}><input id="na-md" dir="ltr" className={fieldClass} value={f.model} onChange={set("model")} /></Field>
        </div>
        <Field id="na-pr" label={t.instructions}><textarea id="na-pr" rows={4} className={fieldClass} value={f.system_prompt} maxLength={4000} onChange={set("system_prompt")} dir="auto" /></Field>
        {msg && (msg.kind === "err" ? <FormError>{msg.text}</FormError> : <p role="status" className="text-xs text-ok">{msg.text}</p>)}
        <button type="submit" disabled={pending} className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white">{pending ? t.working : t.create}</button>
      </form>
    </Panel>
  );
}

function AgentCard({ t, a, canEdit, tools, projects, locale }: { t: AgentsT; a: AgentView; canEdit: boolean; tools: { name: string; scope: string }[]; projects: { id: string; name: string }[]; locale: string }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(a.enabled);
  const [readOnly, setReadOnly] = useState(a.readOnly);
  const [allTools, setAllTools] = useState(a.allowedTools === null);
  const [selected, setSelected] = useState<string[]>(a.allowedTools ?? tools.map((x) => x.name));
  const [projs, setProjs] = useState<string[]>(a.projectIds);
  const [msg, setMsg] = useState<Msg>(null);
  const [testOut, setTestOut] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const m = a.metrics;
  const when = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  const num = (n: number) => n.toLocaleString(locale);
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <Panel title={`${a.icon} ${a.name}`} action={<span className={`rounded-full px-2 py-0.5 text-xs ${a.enabled ? "bg-ok/15 text-ok" : "bg-panel-2 text-muted"}`}>{a.enabled ? t.enabledBadge : t.disabled}</span>}>
      <p className="mb-3 text-xs text-muted">{a.agentName}{a.isCustom ? ` · ${t.custom}` : ""}{a.model ? ` · ${a.model}` : ""} · <Link href={`/dashboard/departments/${a.key}`} className="text-accent">{t.openDept}</Link></p>

      <h3 className="mb-1 text-xs font-semibold">{t.performance}</h3>
      {!m ? <p className="mb-3 text-xs text-muted">{t.noRuns}</p> : (
        <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
          <div><dt className="text-muted">{t.runs}</dt><dd className="font-semibold">{m.runs} <span className="font-normal text-muted">({Object.entries(m.byKind).map(([k, v]) => `${t.kinds[k] ?? k} ${v}`).join("، ")})</span></dd></div>
          <div><dt className="text-muted">{t.successRate}</dt><dd className={`font-semibold ${m.successRate !== null && m.successRate < 0.8 ? "text-err" : ""}`}>{m.successRate === null ? t.none : `${Math.round(m.successRate * 100)}%`}</dd></div>
          <div><dt className="text-muted">{t.avgDuration}</dt><dd className="font-semibold">{m.avgDurationMs === null ? t.none : `${(m.avgDurationMs / 1000).toFixed(1)}${t.seconds}`}</dd></div>
          <div><dt className="text-muted">{t.avgSteps}</dt><dd className="font-semibold">{m.avgSteps ?? t.none}</dd></div>
          <div><dt className="text-muted">{t.tokens}</dt><dd className="font-semibold">{num(m.tokensIn)} / {num(m.tokensOut)}</dd></div>
          <div><dt className="text-muted">{t.lastRun}</dt><dd className="font-semibold">{m.lastRunAt ? when(m.lastRunAt) : t.never}</dd></div>
        </dl>
      )}
      <p className="mb-3 text-xs text-muted">{t.budget}: {a.budget ? `${num(a.tokensUsed)} / ${num(a.budget)} (${Math.round((a.budgetShare ?? 0) * 100)}% ${t.used})` : `${t.unlimited} · ${num(a.tokensUsed)} ${t.used}`} · {t.costNote}</p>

      <div className="space-y-3 rounded-xl border border-border p-3">
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" disabled={!canEdit} checked={enabled} onChange={() => setEnabled((v) => !v)} />{t.enabled}</label>
          <label className="flex items-center gap-2"><input type="checkbox" disabled={!canEdit} checked={readOnly} onChange={() => setReadOnly((v) => !v)} />{t.readOnly}</label>
        </div>

        <fieldset className="space-y-1">
          <legend className="text-xs font-semibold">{t.tools}</legend>
          <label className="flex items-center gap-2 text-xs"><input type="radio" name={`tools-${a.key}`} disabled={!canEdit} checked={allTools} onChange={() => setAllTools(true)} />{t.allTools}</label>
          <label className="flex items-center gap-2 text-xs"><input type="radio" name={`tools-${a.key}`} disabled={!canEdit} checked={!allTools} onChange={() => setAllTools(false)} />{t.selectedTools}</label>
          {!allTools && (
            <div className="flex flex-wrap gap-2 pt-1">
              {tools.map((x) => (
                <label key={x.name} className={`flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] ${readOnly && x.scope !== "read" ? "opacity-40" : ""}`}>
                  <input type="checkbox" disabled={!canEdit} checked={selected.includes(x.name)} onChange={() => setSelected((l) => toggle(l, x.name))} />
                  <span dir="ltr">{x.name}</span><span className="text-muted">· {x.scope === "read" ? t.readTools : t.writeTools}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <fieldset className="space-y-1">
          <legend className="text-xs font-semibold">{t.projects}</legend>
          <p className="text-xs text-muted">{projs.length === 0 ? t.allProjects : t.projectsNote}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            {projects.map((p) => (
              <label key={p.id} className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px]">
                <input type="checkbox" disabled={!canEdit} checked={projs.includes(p.id)} onChange={() => setProjs((l) => toggle(l, p.id))} />{p.name}
              </label>
            ))}
          </div>
        </fieldset>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button type="button" disabled={pending} className="rounded-lg bg-accent px-3 py-2 font-medium text-white" onClick={() => start(async () => {
              const r = await saveAgentConfigAction(a.key, { enabled, read_only: readOnly, allowed_tools: allTools ? null : selected, project_ids: projs });
              setMsg(r.ok ? { kind: "ok", text: t.saved } : { kind: "err", text: r.error });
              router.refresh();
            })}>{pending ? t.working : t.save}</button>
            <button type="button" disabled={pending || !a.enabled} className="rounded-lg border border-border px-3 py-2" onClick={() => start(async () => {
              setTestOut(null); setMsg(null);
              const r = await testAgentAction(a.key);
              if (r.ok) setTestOut(`${r.summary}\n(${r.steps} ${t.steps}, ${(r.durationMs / 1000).toFixed(1)}${t.seconds})`); else setMsg({ kind: "err", text: r.error });
              router.refresh();
            })}>{pending ? t.testing : t.test}</button>
            {a.isCustom && !a.isFallback && (
              <button type="button" disabled={pending} className="rounded-lg border border-border px-3 py-2 text-err" onClick={() => { if (window.confirm(t.confirmDelete)) start(async () => { const r = await deleteAgentAction(a.key); setMsg(r.ok ? null : { kind: "err", text: r.error }); router.refresh(); }); }}>{t.delete}</button>
            )}
            <span className="text-muted">{t.testNote}</span>
          </div>
        )}
        {msg && (msg.kind === "err" ? <FormError>{msg.text}</FormError> : <p role="status" className="text-xs text-ok">{msg.text}</p>)}
        {testOut && <div className="rounded-lg border border-accent/40 bg-accent-soft p-2 text-xs"><p className="font-medium text-accent">{t.testResult}</p><pre className="whitespace-pre-wrap" dir="auto">{testOut}</pre></div>}
      </div>

      <h3 className="mb-1 mt-3 text-xs font-semibold">{t.failures}</h3>
      {a.failures.length === 0 ? <p className="text-xs text-muted">{t.noFailures}</p> : (
        <ul className="space-y-0.5 text-xs">{a.failures.map((f) => <li key={f.id}><span className="text-muted">{when(f.created_at)}</span> · <span dir="ltr">{f.tool_name ?? "—"}</span>{f.error ? <span className="text-err"> — {f.error}</span> : null}</li>)}</ul>
      )}
    </Panel>
  );
}

export function AgentsManager({ t, locale, canEdit, agents, tools, projects }: { t: AgentsT; locale: string; canEdit: boolean; agents: AgentView[]; tools: { name: string; scope: string }[]; projects: { id: string; name: string }[] }) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">{t.note}</p>
      {canEdit && <NewAgentForm t={t} />}
      {agents.length === 0 ? <EmptyState>{t.empty}</EmptyState> : (
        <div className="grid gap-4 xl:grid-cols-2">{agents.map((a) => <AgentCard key={a.key} t={t} a={a} canEdit={canEdit} tools={tools} projects={projects} locale={locale} />)}</div>
      )}
    </div>
  );
}
