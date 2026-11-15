"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createTaskAction, deleteTaskAction, moveTaskAction, reorderTaskAction, saveProjectMetaAction, setProjectArchivedAction, updateTaskAction,
} from "@/app/dashboard/projects/board-actions";
import { Field, FormError, Panel, fieldClass } from "@/components/ui";
import { PRIORITIES, STATUSES, isOverdue, progress, sortColumn, type Priority, type TaskStatus } from "@/lib/tasks";
import type { BoardT } from "@/lib/tasks-i18n";

export type TaskView = { id: string; title: string; description: string; status: TaskStatus; priority: Priority; dueDate: string | null; assignee: string | null; position: number; createdAt: string };
type Msg = { kind: "ok" | "err"; text: string } | null;
const PRI_COLOR: Record<string, string> = { low: "text-muted", normal: "text-text", high: "text-warn", urgent: "text-err" };

function TaskForm({ t, initial, onSubmit, onCancel, pending }: {
  t: BoardT; initial?: TaskView; pending: boolean; onCancel: () => void;
  onSubmit: (v: { title: string; description: string; priority: string; due_date: string; assignee: string }) => void;
}) {
  const [f, setF] = useState({ title: initial?.title ?? "", description: initial?.description ?? "", priority: initial?.priority ?? "normal", due_date: initial?.dueDate ?? "", assignee: initial?.assignee ?? "" });
  const id = initial?.id ?? "new";
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((v) => ({ ...v, [k]: e.target.value }));
  return (
    <form className="space-y-2 rounded-xl border border-border bg-panel-2 p-2" onSubmit={(e) => { e.preventDefault(); onSubmit(f); }}>
      <Field id={`t-title-${id}`} label={t.title}><input id={`t-title-${id}`} className={fieldClass} value={f.title} maxLength={200} onChange={set("title")} required dir="auto" /></Field>
      <Field id={`t-desc-${id}`} label={t.description}><textarea id={`t-desc-${id}`} rows={2} className={fieldClass} value={f.description} onChange={set("description")} dir="auto" /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field id={`t-pri-${id}`} label={t.priority}>
          <select id={`t-pri-${id}`} className={fieldClass} value={f.priority} onChange={set("priority")}>{PRIORITIES.map((p) => <option key={p} value={p}>{t.pri[p]}</option>)}</select>
        </Field>
        <Field id={`t-due-${id}`} label={t.due}><input id={`t-due-${id}`} type="date" className={fieldClass} value={f.due_date} onChange={set("due_date")} /></Field>
      </div>
      <Field id={`t-as-${id}`} label={t.assignee}><input id={`t-as-${id}`} className={fieldClass} value={f.assignee} maxLength={80} onChange={set("assignee")} /></Field>
      <div className="flex gap-2 text-xs">
        <button type="submit" disabled={pending} className="rounded-lg bg-accent px-3 py-1.5 font-medium text-white">{pending ? t.working : t.save}</button>
        <button type="button" className="rounded-lg border border-border px-3 py-1.5" onClick={onCancel}>{t.cancel}</button>
      </div>
    </form>
  );
}

export function ProjectBoard({ t, projectId, tasks, canEdit, locale }: { t: BoardT; projectId: string; tasks: TaskView[]; canEdit: boolean; locale: string }) {
  const router = useRouter();
  const [adding, setAdding] = useState<TaskStatus | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const p = progress(tasks);
  const today = new Date().toISOString().slice(0, 10);
  const dueFmt = (d: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: () => void) =>
    start(async () => { const r = await fn(); setMsg(r.ok ? null : { kind: "err", text: r.error }); if (r.ok) after?.(); router.refresh(); });

  return (
    <Panel title={t.board}>
      <div className="mb-4">
        <div className="mb-1 flex justify-between text-xs text-muted"><span>{t.progress}</span><span>{t.tasksDone.replace("{done}", String(p.done)).replace("{total}", String(p.total))} · {p.percent}%</span></div>
        <div className="h-2 overflow-hidden rounded-full bg-panel-2" role="progressbar" aria-valuenow={p.percent} aria-valuemin={0} aria-valuemax={100} aria-label={t.progress}>
          <div className="h-full bg-accent" style={{ width: `${p.percent}%` }} />
        </div>
      </div>
      {msg && <FormError>{msg.text}</FormError>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {STATUSES.map((status) => {
          const col = sortColumn(tasks.filter((x) => x.status === status));
          return (
            <section key={status} aria-label={t.col[status]} className="space-y-2 rounded-xl border border-border p-2">
              <h3 className="flex items-center justify-between text-xs font-semibold">{t.col[status]} <span className="text-muted">{col.length}</span></h3>
              {col.map((x) => editing === x.id ? (
                <TaskForm key={x.id} t={t} initial={x} pending={pending} onCancel={() => setEditing(null)}
                  onSubmit={(v) => run(() => updateTaskAction(x.id, v), () => setEditing(null))} />
              ) : (
                <article key={x.id} className="space-y-1 rounded-lg border border-border bg-panel p-2 text-sm">
                  <p className="font-medium" dir="auto">{x.title}</p>
                  {x.description && <p className="whitespace-pre-wrap text-xs text-muted" dir="auto">{x.description}</p>}
                  <p className="flex flex-wrap gap-x-2 text-[11px]">
                    <span className={PRI_COLOR[x.priority]}>{t.pri[x.priority]}</span>
                    {x.dueDate && <span className={isOverdue({ status: x.status, due_date: x.dueDate }, today) ? "text-err" : "text-muted"}>{dueFmt(x.dueDate)}{isOverdue({ status: x.status, due_date: x.dueDate }, today) ? ` · ${t.overdue}` : ""}</span>}
                    {x.assignee && <span className="text-muted">{x.assignee}</span>}
                  </p>
                  {canEdit && (
                    <div className="flex flex-wrap gap-1 pt-1 text-[11px]">
                      <button type="button" disabled={pending || status === STATUSES[0]} aria-label={t.left} className="rounded border border-border px-1.5 py-0.5 disabled:opacity-40" onClick={() => run(() => moveTaskAction(x.id, { dir: -1 }))}>‹</button>
                      <button type="button" disabled={pending || status === STATUSES[3]} aria-label={t.right} className="rounded border border-border px-1.5 py-0.5 disabled:opacity-40" onClick={() => run(() => moveTaskAction(x.id, { dir: 1 }))}>›</button>
                      <button type="button" disabled={pending} aria-label={t.up} className="rounded border border-border px-1.5 py-0.5" onClick={() => run(() => reorderTaskAction(x.id, -1))}>↑</button>
                      <button type="button" disabled={pending} aria-label={t.down} className="rounded border border-border px-1.5 py-0.5" onClick={() => run(() => reorderTaskAction(x.id, 1))}>↓</button>
                      <button type="button" className="rounded border border-border px-1.5 py-0.5" onClick={() => setEditing(x.id)}>{t.edit}</button>
                      <button type="button" disabled={pending} className="rounded border border-border px-1.5 py-0.5 text-err" onClick={() => { if (window.confirm(t.confirmDelete)) run(() => deleteTaskAction(x.id)); }}>{t.delete}</button>
                    </div>
                  )}
                </article>
              ))}
              {col.length === 0 && adding !== status && <p className="text-[11px] text-muted">—</p>}
              {canEdit && (adding === status ? (
                <TaskForm t={t} pending={pending} onCancel={() => setAdding(null)} onSubmit={(v) => run(() => createTaskAction(projectId, v, status), () => setAdding(null))} />
              ) : (
                <button type="button" className="w-full rounded-lg border border-dashed border-border px-2 py-1 text-xs text-muted" onClick={() => setAdding(status)}>+ {t.addTask}</button>
              ))}
            </section>
          );
        })}
      </div>
      {tasks.length === 0 && <p className="mt-3 text-xs text-muted">{t.noTasks}</p>}
    </Panel>
  );
}

export function ProjectMetaPanel({ t, projectId, canEdit, archived, meta }: {
  t: BoardT; projectId: string; canEdit: boolean; archived: boolean; meta: { priority: string; description: string; documentation: string };
}) {
  const router = useRouter();
  const [f, setF] = useState(meta);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  return (
    <Panel title={t.meta}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await saveProjectMetaAction(projectId, f); setMsg(r.ok ? { kind: "ok", text: t.saved } : { kind: "err", text: r.error }); router.refresh(); }); }}>
        <div className="grid gap-3 md:grid-cols-[1fr_12rem]">
          <Field id="pm-desc" label={t.projectDescription}><input id="pm-desc" className={fieldClass} disabled={!canEdit} maxLength={1000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} dir="auto" /></Field>
          <Field id="pm-pri" label={t.priority}>
            <select id="pm-pri" className={fieldClass} disabled={!canEdit} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p} value={p}>{t.pri[p]}</option>)}</select>
          </Field>
        </div>
        <Field id="pm-docs" label={`${t.docs} — ${t.docsHint}`}><textarea id="pm-docs" rows={8} className={fieldClass} disabled={!canEdit} maxLength={20000} value={f.documentation} onChange={(e) => setF({ ...f, documentation: e.target.value })} dir="auto" /></Field>
        {msg && (msg.kind === "err" ? <FormError>{msg.text}</FormError> : <p role="status" className="text-xs text-ok">{msg.text}</p>)}
        {canEdit && (
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={pending} className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white">{pending ? t.working : t.save}</button>
            <button type="button" disabled={pending} className="rounded-xl border border-border px-4 py-2 text-sm"
              onClick={() => { if (archived || window.confirm(t.confirmArchive)) start(async () => { const r = await setProjectArchivedAction(projectId, !archived); setMsg(r.ok ? null : { kind: "err", text: r.error }); router.refresh(); }); }}>
              {archived ? t.unarchive : t.archive}
            </button>
            <span className="text-xs text-muted">{t.archiveNote}</span>
          </div>
        )}
      </form>
    </Panel>
  );
}
