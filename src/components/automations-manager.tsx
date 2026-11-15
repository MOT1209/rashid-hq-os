"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  cancelRunAction, deleteAutomationAction, runAutomationNowAction, saveAutomationAction, setAutomationEnabledAction,
} from "@/app/dashboard/automations/actions";
import { EmptyState, Field, FormError, Panel, fieldClass } from "@/components/ui";
import type { AutoT } from "@/lib/automation/i18n";
import type { Step, StepResult } from "@/lib/automation/definition";

export type AutomationView = {
  id: string; name: string; description: string; enabled: boolean; version: number;
  trigger: { type: "manual" } | { type: "schedule"; cron: string; timezone: string } | { type: "event"; event: string };
  steps: Step[]; maxAttempts: number; backoffSeconds: number; notifyOnFailure: boolean; nextRunAt: string | null; lastRunAt: string | null;
};
export type RunView = {
  id: string; automationId: string; automationName: string; status: string; trigger: string; createdAt: string; finishedAt: string | null; error: string | null; results: StepResult[];
};
type Msg = { kind: "ok" | "err"; text: string } | null;

/* ---- editor state: strings for every field, converted to a definition on save ---- */
type Ed = {
  id: string; type: "tool" | "agent" | "notify"; tool: string; input: string; department: string; task: string; subject: string; message: string;
  condPath: string; condOp: string; condValue: string; onFailure: "stop" | "continue"; maxAttempts: string;
};
const blank = (n: number, tools: string[], deps: string[]): Ed => ({ id: `s${n}`, type: "tool", tool: tools[0] ?? "", input: "{}", department: deps[0] ?? "", task: "", subject: "", message: "", condPath: "", condOp: "eq", condValue: "", onFailure: "stop", maxAttempts: "" });
const fromStep = (s: Step): Ed => ({
  ...blank(0, [], []), id: s.id, type: s.type,
  tool: s.type === "tool" ? s.tool : "", input: s.type === "tool" ? JSON.stringify(s.input, null, 2) : "{}",
  department: s.type === "agent" ? s.department : "", task: s.type === "agent" ? s.task : "",
  subject: s.type === "notify" ? s.subject : "", message: s.type === "notify" ? s.message : "",
  condPath: s.when?.path ?? "", condOp: s.when?.op ?? "eq", condValue: s.when?.value !== undefined ? String(s.when.value) : "",
  onFailure: s.onFailure ?? "stop", maxAttempts: s.maxAttempts ? String(s.maxAttempts) : "",
});
function toStep(e: Ed): { step?: unknown; error?: string } {
  const base: Record<string, unknown> = { id: e.id.trim(), type: e.type, onFailure: e.onFailure };
  if (e.maxAttempts.trim()) base.maxAttempts = Number(e.maxAttempts);
  if (e.condPath.trim()) {
    const numeric = ["gt", "lt"].includes(e.condOp);
    base.when = { path: e.condPath.trim(), op: e.condOp, ...(["exists", "not_exists"].includes(e.condOp) ? {} : { value: numeric ? Number(e.condValue) : e.condValue }) };
  }
  if (e.type === "tool") {
    let input: unknown = {};
    try { input = e.input.trim() ? JSON.parse(e.input) : {}; } catch { return { error: `Step "${e.id}": tool input is not valid JSON.` }; }
    return { step: { ...base, tool: e.tool, input } };
  }
  if (e.type === "agent") return { step: { ...base, department: e.department, task: e.task } };
  return { step: { ...base, subject: e.subject, message: e.message } };
}

function Editor({ t, a, tools, departments, events }: { t: AutoT; a: AutomationView | null; tools: string[]; departments: { key: string; name: string }[]; events: string[] }) {
  const router = useRouter();
  const [name, setName] = useState(a?.name ?? "");
  const [description, setDescription] = useState(a?.description ?? "");
  const [trType, setTrType] = useState<"manual" | "schedule" | "event">(a?.trigger.type ?? "manual");
  const [cron, setCron] = useState(a?.trigger.type === "schedule" ? a.trigger.cron : "0 9 * * *");
  const [tz, setTz] = useState(a?.trigger.type === "schedule" ? a.trigger.timezone : "UTC");
  const [event, setEvent] = useState(a?.trigger.type === "event" ? a.trigger.event : events[0]);
  const [steps, setSteps] = useState<Ed[]>(a ? a.steps.map(fromStep) : [blank(1, tools, departments.map((d) => d.key))]);
  const [maxAttempts, setMaxAttempts] = useState(String(a?.maxAttempts ?? 1));
  const [backoff, setBackoff] = useState(String(a?.backoffSeconds ?? 60));
  const [notify, setNotify] = useState(a?.notifyOnFailure ?? true);
  const [msg, setMsg] = useState<Msg>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const upd = (i: number, patch: Partial<Ed>) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: -1 | 1) => setSteps((s) => { const j = i + d; if (j < 0 || j >= s.length) return s; const c = [...s]; [c[i], c[j]] = [c[j], c[i]]; return c; });

  function submit() {
    const built: unknown[] = [];
    for (const e of steps) {
      const r = toStep(e);
      if (r.error) return setMsg({ kind: "err", text: r.error });
      built.push(r.step);
    }
    const trigger = trType === "schedule" ? { type: "schedule", cron, timezone: tz } : trType === "event" ? { type: "event", event } : { type: "manual" };
    start(async () => {
      setMsg(null);
      const r = await saveAutomationAction({
        id: a?.id, expectedVersion: a?.version,
        definition: { name, description, trigger, steps: built, maxAttempts: Number(maxAttempts), backoffSeconds: Number(backoff), notifyOnFailure: notify },
      });
      if (!r.ok) return setMsg({ kind: "err", text: r.error });
      setNotes(r.warnings);
      setMsg({ kind: "ok", text: t.saved });
      router.replace(`/dashboard/automations?id=${r.id}`);
      router.refresh();
    });
  }

  return (
    <Panel title={a ? a.name : t.newAutomation} action={<Link href="/dashboard/automations" className="text-xs text-accent">{t.close}</Link>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="grid gap-3 md:grid-cols-2">
          <Field id="au-name" label={t.name}><input id="au-name" className={fieldClass} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} required /></Field>
          <Field id="au-desc" label={t.description}><input id="au-desc" className={fieldClass} value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} /></Field>
        </div>

        <fieldset className="space-y-2 rounded-xl border border-border p-3">
          <legend className="px-1 text-xs text-muted">{t.trigger}</legend>
          <div className="flex flex-wrap gap-3">
            {(["manual", "schedule", "event"] as const).map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm"><input type="radio" name="trigger" checked={trType === k} onChange={() => setTrType(k)} />{{ manual: t.trManual, schedule: t.trSchedule, event: t.trEvent }[k]}</label>
            ))}
          </div>
          {trType === "schedule" && (
            <div className="grid gap-3 md:grid-cols-2">
              <Field id="au-cron" label={t.cron}><input id="au-cron" dir="ltr" className={`${fieldClass} font-mono`} value={cron} onChange={(e) => setCron(e.target.value)} /></Field>
              <Field id="au-tz" label={t.timezone}><input id="au-tz" dir="ltr" className={fieldClass} value={tz} onChange={(e) => setTz(e.target.value)} /></Field>
            </div>
          )}
          {trType === "event" && (
            <Field id="au-ev" label={t.event}>
              <select id="au-ev" className={fieldClass} value={event} onChange={(e) => setEvent(e.target.value)}>{events.map((x) => <option key={x} value={x}>{t.ev[x] ?? x}</option>)}</select>
            </Field>
          )}
        </fieldset>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold">{t.steps}</h3>
          {steps.map((s, i) => (
            <div key={i} className="space-y-3 rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-end gap-3">
                <Field id={`st-id-${i}`} label={t.stepId}><input id={`st-id-${i}`} dir="ltr" className={`${fieldClass} !w-32`} value={s.id} onChange={(e) => upd(i, { id: e.target.value })} /></Field>
                <Field id={`st-type-${i}`} label={t.stepType}>
                  <select id={`st-type-${i}`} className={`${fieldClass} !w-auto`} value={s.type} onChange={(e) => upd(i, { type: e.target.value as Ed["type"] })}>
                    <option value="tool">{t.stTool}</option><option value="agent">{t.stAgent}</option><option value="notify">{t.stNotify}</option>
                  </select>
                </Field>
                <div className="ms-auto flex gap-2 text-xs">
                  <button type="button" className="rounded-lg border border-border px-2 py-1" onClick={() => move(i, -1)}>{t.up}</button>
                  <button type="button" className="rounded-lg border border-border px-2 py-1" onClick={() => move(i, 1)}>{t.down}</button>
                  <button type="button" disabled={steps.length === 1} className="rounded-lg border border-border px-2 py-1 text-err" onClick={() => setSteps((x) => x.filter((_, j) => j !== i))}>{t.remove}</button>
                </div>
              </div>

              {s.type === "tool" && (
                <>
                  <Field id={`st-tool-${i}`} label={t.tool}><select id={`st-tool-${i}`} dir="ltr" className={fieldClass} value={s.tool} onChange={(e) => upd(i, { tool: e.target.value })}>{tools.map((x) => <option key={x}>{x}</option>)}</select></Field>
                  <Field id={`st-in-${i}`} label={t.toolInput}><textarea id={`st-in-${i}`} dir="ltr" rows={3} className={`${fieldClass} font-mono text-xs`} value={s.input} onChange={(e) => upd(i, { input: e.target.value })} /></Field>
                </>
              )}
              {s.type === "agent" && (
                <>
                  <Field id={`st-dep-${i}`} label={t.department}><select id={`st-dep-${i}`} className={fieldClass} value={s.department} onChange={(e) => upd(i, { department: e.target.value })}>{departments.map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}</select></Field>
                  <Field id={`st-task-${i}`} label={t.task}><textarea id={`st-task-${i}`} rows={3} className={fieldClass} dir="auto" value={s.task} onChange={(e) => upd(i, { task: e.target.value })} /></Field>
                </>
              )}
              {s.type === "notify" && (
                <>
                  <Field id={`st-sub-${i}`} label={t.subject}><input id={`st-sub-${i}`} className={fieldClass} dir="auto" value={s.subject} onChange={(e) => upd(i, { subject: e.target.value })} /></Field>
                  <Field id={`st-msg-${i}`} label={t.message}><textarea id={`st-msg-${i}`} rows={3} className={fieldClass} dir="auto" value={s.message} onChange={(e) => upd(i, { message: e.target.value })} /></Field>
                </>
              )}

              <div className="grid gap-3 md:grid-cols-4">
                <Field id={`st-cp-${i}`} label={`${t.condition} — ${t.condPath}`}><input id={`st-cp-${i}`} dir="ltr" placeholder={t.none} className={fieldClass} value={s.condPath} onChange={(e) => upd(i, { condPath: e.target.value })} /></Field>
                <Field id={`st-co-${i}`} label={t.condOp}>
                  <select id={`st-co-${i}`} className={fieldClass} value={s.condOp} onChange={(e) => upd(i, { condOp: e.target.value })}>
                    {["eq", "neq", "exists", "not_exists", "gt", "lt", "contains"].map((o) => <option key={o}>{o}</option>)}
                  </select>
                </Field>
                <Field id={`st-cv-${i}`} label={t.condValue}><input id={`st-cv-${i}`} className={fieldClass} value={s.condValue} onChange={(e) => upd(i, { condValue: e.target.value })} /></Field>
                <Field id={`st-of-${i}`} label={t.onFailure}>
                  <select id={`st-of-${i}`} className={fieldClass} value={s.onFailure} onChange={(e) => upd(i, { onFailure: e.target.value as Ed["onFailure"] })}><option value="stop">{t.ofStop}</option><option value="continue">{t.ofContinue}</option></select>
                </Field>
              </div>
              <Field id={`st-ma-${i}`} label={t.stepAttempts}><input id={`st-ma-${i}`} type="number" min={1} max={5} className={`${fieldClass} !w-24`} value={s.maxAttempts} onChange={(e) => upd(i, { maxAttempts: e.target.value })} /></Field>
            </div>
          ))}
          <button type="button" disabled={steps.length >= 10} className="rounded-xl border border-border px-3 py-2 text-xs" onClick={() => setSteps((s) => [...s, blank(s.length + 1, tools, departments.map((d) => d.key))])}>{t.addStep}</button>
        </div>

        <fieldset className="space-y-2 rounded-xl border border-border p-3">
          <legend className="px-1 text-xs text-muted">{t.retry}</legend>
          <div className="flex flex-wrap items-end gap-3">
            <Field id="au-ma" label={t.maxAttempts}><input id="au-ma" type="number" min={1} max={5} className={`${fieldClass} !w-24`} value={maxAttempts} onChange={(e) => setMaxAttempts(e.target.value)} /></Field>
            <Field id="au-bo" label={t.backoff}><input id="au-bo" type="number" min={10} max={3600} className={`${fieldClass} !w-28`} value={backoff} onChange={(e) => setBackoff(e.target.value)} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={notify} onChange={() => setNotify((v) => !v)} />{t.notifyFail}</label>
          </div>
          <p className="text-xs text-muted">{t.retryNote}</p>
        </fieldset>

        {msg && (msg.kind === "err" ? <FormError>{msg.text}</FormError> : <p role="status" className="text-xs text-ok">{msg.text}</p>)}
        {notes.length > 0 && <div className="text-xs text-warn"><p className="font-medium">{t.warnings}</p><ul className="list-disc ps-5">{notes.map((n) => <li key={n}>{n}</li>)}</ul></div>}
        <button type="submit" disabled={pending} className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white">{pending ? t.working : t.save}</button>
      </form>
    </Panel>
  );
}

const RUN_COLOR: Record<string, string> = { queued: "text-muted", running: "text-accent", succeeded: "text-ok", failed: "text-err", cancelled: "text-muted" };

export function AutomationsManager({ t, locale, canEdit, automations, runs, tools, departments, events, editingId }: {
  t: AutoT; locale: string; canEdit: boolean; automations: AutomationView[]; runs: RunView[]; tools: string[]; departments: { key: string; name: string }[]; events: string[]; editingId: string | null;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const when = (iso: string | null) => (iso ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : t.never);
  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => start(async () => { const r = await fn(); setMsg(r.ok ? null : { kind: "err", text: r.error }); router.refresh(); });
  const editing = editingId === "new" ? "new" : automations.find((a) => a.id === editingId) ?? null;
  const triggerLabel = (a: AutomationView) => (a.trigger.type === "schedule" ? `${t.trSchedule}: ${a.trigger.cron} (${a.trigger.timezone})` : a.trigger.type === "event" ? `${t.trEvent}: ${t.ev[a.trigger.event] ?? a.trigger.event}` : t.trManual);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">{t.unattendedNote}</p>
      <Panel title={t.title} action={canEdit && <Link href="/dashboard/automations?id=new" className="rounded-xl bg-accent px-3 py-2 text-xs font-medium text-white">{t.newAutomation}</Link>}>
        {msg && <FormError>{msg.text}</FormError>}
        {automations.length === 0 ? <EmptyState>{t.empty}</EmptyState> : (
          <ul className="divide-y divide-border">
            {automations.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium">{a.name} <span className={`ms-2 rounded-full px-2 py-0.5 text-[10px] ${a.enabled ? "bg-ok/15 text-ok" : "bg-panel-2 text-muted"}`}>{a.enabled ? t.active : t.paused}</span></p>
                  <p className="text-xs text-muted">{triggerLabel(a)} · {a.steps.length} {t.steps}</p>
                  <p className="text-xs text-muted">{t.nextRun}: {a.trigger.type === "schedule" && a.enabled ? when(a.nextRunAt) : "—"} · {t.lastRun}: {when(a.lastRunAt)}</p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Link href={`/dashboard/automations?id=${a.id}`} className="rounded-lg border border-border px-2 py-1">{t.edit}</Link>
                  {canEdit && (
                    <>
                      <button type="button" disabled={pending} className="rounded-lg border border-border px-2 py-1" onClick={() => run(() => setAutomationEnabledAction(a.id, !a.enabled))}>{a.enabled ? t.pause : t.resume}</button>
                      <button type="button" disabled={pending} className="rounded-lg bg-accent px-2 py-1 text-white" onClick={() => run(() => runAutomationNowAction(a.id))}>{t.runNow}</button>
                      <button type="button" disabled={pending} className="rounded-lg border border-border px-2 py-1 text-err" onClick={() => { if (window.confirm(t.confirmDelete)) run(() => deleteAutomationAction(a.id)); }}>{t.delete}</button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {editing && canEdit && <Editor key={editing === "new" ? "new" : `${editing.id}-${editing.version}`} t={t} a={editing === "new" ? null : editing} tools={tools} departments={departments} events={events} />}

      <Panel title={t.history}>
        {runs.length === 0 ? <EmptyState>{t.noRuns}</EmptyState> : (
          <ul className="divide-y divide-border">
            {runs.map((r) => (
              <li key={r.id} className="space-y-1 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p><span className="font-medium">{r.automationName}</span> <span className={`text-xs ${RUN_COLOR[r.status] ?? ""}`}>{t.rs[r.status] ?? r.status}</span> <span className="text-xs text-muted">· {t.via} {r.trigger} · {when(r.createdAt)}</span></p>
                  {canEdit && r.status === "queued" && <button type="button" disabled={pending} className="rounded-lg border border-border px-2 py-1 text-xs" onClick={() => run(() => cancelRunAction(r.id))}>{t.cancel}</button>}
                </div>
                {r.error && <p className="text-xs text-err">{r.error}</p>}
                {r.results.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted">{r.results.length} {t.steps}</summary>
                    <ul className="mt-1 space-y-1">
                      {r.results.map((s, i) => (
                        <li key={i}><span className="font-mono">{s.id}</span> · {t.ss[s.status] ?? s.status} · {s.attempts} {t.attempts}{s.error ? <span className="text-err"> — {s.error}</span> : null}
                          {s.output !== undefined && <pre className="mt-0.5 max-h-24 overflow-auto rounded bg-panel-2 p-1 text-[11px]" dir="ltr">{JSON.stringify(s.output, null, 1).slice(0, 600)}</pre>}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
