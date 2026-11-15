"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteSkillAction, duplicateSkillAction, exportSkillsAction, importSkillsAction, restoreVersionAction, saveSkillAction, toggleSkillAction,
} from "@/app/dashboard/skills/actions";
import { EmptyState, Field, FormError, Panel, fieldClass } from "@/components/ui";
import type { SkillsT } from "@/lib/skills-i18n";

export type SkillView = {
  id: string; name: string; description: string | null; prompt: string; enabled: boolean; version: number; tags: string[];
  inputSchema: string; outputSchema: string; metadata: string;
};
type Msg = { kind: "ok" | "err"; text: string } | null;

function download(filename: string, json: string) {
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function Editor({ t, skill, versions, usage, locale }: {
  t: SkillsT; skill: SkillView | "new"; locale: string;
  versions: { version: number; name: string; savedAt: string }[];
  usage: { total: number; entries: { at: string; tool: string; actor: string | null; status: string; version: number | null }[] };
}) {
  const router = useRouter();
  const s = skill === "new" ? null : skill;
  const [f, setF] = useState({
    name: s?.name ?? "", description: s?.description ?? "", prompt: s?.prompt ?? "", tags: s?.tags.join(", ") ?? "",
    inputSchema: s?.inputSchema ?? "", outputSchema: s?.outputSchema ?? "", metadata: s?.metadata ?? "",
  });
  const [msg, setMsg] = useState<Msg>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const when = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((v) => ({ ...v, [k]: e.target.value }));

  return (
    <div className="space-y-4">
      <Panel title={s ? `${s.name} · ${t.versionLabel}${s.version}` : t.newSkill} action={<Link href="/dashboard/skills" className="text-xs text-accent">{t.close}</Link>}>
        <form className="space-y-3" onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            setMsg(null);
            const r = await saveSkillAction({ id: s?.id, expectedVersion: s?.version, ...f });
            if (!r.ok) return setMsg({ kind: "err", text: r.error });
            setWarnings(r.warnings);
            setMsg({ kind: "ok", text: t.saved.replace("{v}", String(r.version)) });
            router.replace(`/dashboard/skills?id=${r.id}`);
            router.refresh();
          });
        }}>
          <Field id="sk-name" label={t.fName}><input id="sk-name" className={fieldClass} value={f.name} maxLength={200} onChange={set("name")} required /></Field>
          <Field id="sk-desc" label={t.fDescription}><input id="sk-desc" className={fieldClass} value={f.description} maxLength={500} onChange={set("description")} /></Field>
          <Field id="sk-prompt" label={t.fPrompt}><textarea id="sk-prompt" rows={6} className={fieldClass} value={f.prompt} maxLength={4000} onChange={set("prompt")} required dir="auto" /></Field>
          <Field id="sk-tags" label={t.fTags}><input id="sk-tags" className={fieldClass} value={f.tags} onChange={set("tags")} /></Field>
          <p className="text-xs text-muted" dir="ltr">{t.schemaHelp}</p>
          <div className="grid gap-3 md:grid-cols-2">
            <Field id="sk-in" label={t.fInput}><textarea id="sk-in" rows={6} className={`${fieldClass} font-mono text-xs`} dir="ltr" value={f.inputSchema} onChange={set("inputSchema")} /></Field>
            <Field id="sk-out" label={t.fOutput}><textarea id="sk-out" rows={6} className={`${fieldClass} font-mono text-xs`} dir="ltr" value={f.outputSchema} onChange={set("outputSchema")} /></Field>
          </div>
          <Field id="sk-meta" label={t.fMetadata}><textarea id="sk-meta" rows={3} className={`${fieldClass} font-mono text-xs`} dir="ltr" value={f.metadata} onChange={set("metadata")} /></Field>
          {msg && (msg.kind === "err" ? <FormError>{msg.text}</FormError> : <p role="status" className="text-xs text-ok">{msg.text}</p>)}
          {warnings.length > 0 && <div className="text-xs text-warn"><p className="font-medium">{t.warnings}</p><ul className="list-disc ps-5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>}
          <button type="submit" disabled={pending} className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white">{pending ? t.working : t.save}</button>
        </form>
      </Panel>

      {s && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title={t.versions}>
            <ul className="space-y-1 text-sm">
              <li className="flex justify-between"><span>{t.versionLabel}{s.version}</span><span className="text-xs text-muted">{t.current}</span></li>
              {versions.length === 0 && <li className="text-xs text-muted">{t.noVersions}</li>}
              {versions.map((v) => (
                <li key={v.version} className="flex items-center justify-between gap-2">
                  <span>{t.versionLabel}{v.version} <span className="text-xs text-muted">· {when(v.savedAt)}</span></span>
                  <button type="button" disabled={pending} className="rounded-lg border border-border px-2 py-1 text-xs" onClick={() => start(async () => {
                    const r = await restoreVersionAction(s.id, v.version);
                    setMsg(r.ok ? { kind: "ok", text: t.restored.replace("{v}", String(r.version)) } : { kind: "err", text: r.error });
                    router.refresh();
                  })}>{t.restore}</button>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title={t.usage}>
            <p className="mb-2 text-xs text-muted">{t.usageNote} · {t.usageTotal.replace("{n}", String(usage.total))}</p>
            {usage.entries.length === 0 ? <p className="text-xs text-muted">{t.noUsage}</p> : (
              <ul className="space-y-1 text-xs">{usage.entries.map((u, i) => <li key={i}><span className="text-muted">{when(u.at)}</span> · {u.actor ?? "—"} · {u.tool}{u.version ? ` · ${t.versionLabel}${u.version}` : ""}</li>)}</ul>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}

export function SkillsManager({ t, locale, canEdit, skills, tags, filters, editing, versions, usage }: {
  t: SkillsT; locale: string; canEdit: boolean; skills: SkillView[]; tags: string[]; filters: { q: string; tag: string; status: string };
  editing: SkillView | "new" | null;
  versions: { version: number; name: string; savedAt: string }[];
  usage: { total: number; entries: { at: string; tool: string; actor: string | null; status: string; version: number | null }[] };
}) {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [details, setDetails] = useState<string[]>([]);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => start(async () => {
    const r = await fn();
    setMsg(r.ok ? null : { kind: "err", text: r.error });
    router.refresh();
  });

  return (
    <div className="space-y-4">
      <Panel
        title={t.title}
        action={canEdit && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Link href="/dashboard/skills?id=new" className="rounded-xl bg-accent px-3 py-2 font-medium text-white">{t.newSkill}</Link>
            <button type="button" disabled={pending} className="rounded-xl border border-border px-3 py-2" onClick={() => start(async () => {
              const r = await exportSkillsAction();
              if (r.ok) download(r.filename, r.json); else setMsg({ kind: "err", text: r.error });
            })}>{t.exportAll}</button>
            <input ref={file} type="file" accept="application/json,.json" className="sr-only" id="skills-import" onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              start(async () => {
                const r = await importSkillsAction(await f.text());
                if (!r.ok) setMsg({ kind: "err", text: r.error });
                else {
                  setMsg({ kind: "ok", text: [t.importDone.replace("{n}", String(r.imported)), r.warnings ? t.importWarn.replace("{n}", String(r.warnings)) : ""].filter(Boolean).join(" ") });
                  setDetails(r.failed.map((x) => `#${x.index}: ${x.errors.join(" ")}`));
                }
                if (file.current) file.current.value = "";
                router.refresh();
              });
            }} />
            <label htmlFor="skills-import" className="cursor-pointer rounded-xl border border-border px-3 py-2">{t.import}</label>
          </div>
        )}
      >
        {canEdit && <p className="mb-3 text-xs text-muted">{t.importNote}</p>}
        <form method="get" className="mb-3 flex flex-wrap items-end gap-2">
          <Field id="f-q" label={t.search}><input id="f-q" name="q" defaultValue={filters.q} className={fieldClass} /></Field>
          <Field id="f-tag" label={t.tag}>
            <select id="f-tag" name="tag" defaultValue={filters.tag} className={`${fieldClass} !w-auto`}><option value="">{t.all}</option>{tags.map((x) => <option key={x} value={x}>{x}</option>)}</select>
          </Field>
          <Field id="f-st" label={t.status}>
            <select id="f-st" name="status" defaultValue={filters.status} className={`${fieldClass} !w-auto`}><option value="">{t.all}</option><option value="enabled">{t.enabledOnly}</option><option value="disabled">{t.disabledOnly}</option></select>
          </Field>
          <button type="submit" className="rounded-xl border border-border px-3 py-2 text-xs">{t.filter}</button>
        </form>
        {msg && (msg.kind === "err" ? <FormError>{msg.text}</FormError> : <p role="status" className="text-xs text-ok">{msg.text}</p>)}
        {details.length > 0 && <div className="text-xs text-err"><p>{t.importFailed.replace("{n}", String(details.length))}</p><ul className="list-disc ps-5">{details.map((d) => <li key={d}>{d}</li>)}</ul></div>}

        {skills.length === 0 ? <EmptyState>{t.empty}</EmptyState> : (
          <ul className="divide-y divide-border">
            {skills.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium">{s.name} <span className="text-xs text-muted">{t.versionLabel}{s.version}</span>{!s.enabled && <span className="ms-2 rounded-full bg-panel-2 px-2 py-0.5 text-[10px] text-muted">{t.disabledBadge}</span>}</p>
                  {s.description && <p className="truncate text-xs text-muted">{s.description}</p>}
                  {s.tags.length > 0 && <p className="text-[11px] text-muted">{s.tags.map((x) => `#${x}`).join(" ")}</p>}
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Link href={`/dashboard/skills?id=${s.id}`} className="rounded-lg border border-border px-2 py-1">{t.edit}</Link>
                  {canEdit && (
                    <>
                      <button type="button" disabled={pending} className="rounded-lg border border-border px-2 py-1" onClick={() => run(() => toggleSkillAction(s.id, !s.enabled))}>{s.enabled ? t.disable : t.enable}</button>
                      <button type="button" disabled={pending} className="rounded-lg border border-border px-2 py-1" onClick={() => run(() => duplicateSkillAction(s.id))}>{t.duplicate}</button>
                      <button type="button" disabled={pending} className="rounded-lg border border-border px-2 py-1" onClick={() => start(async () => {
                        const r = await exportSkillsAction([s.id]);
                        if (r.ok) download(r.filename, r.json); else setMsg({ kind: "err", text: r.error });
                      })}>{t.exportOne}</button>
                      <button type="button" disabled={pending} className="rounded-lg border border-border px-2 py-1 text-err" onClick={() => { if (window.confirm(t.confirmDelete)) run(() => deleteSkillAction(s.id)); }}>{t.delete}</button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {editing && <Editor key={editing === "new" ? "new" : `${editing.id}-${editing.version}`} t={t} skill={editing} versions={versions} usage={usage} locale={locale} />}
    </div>
  );
}
