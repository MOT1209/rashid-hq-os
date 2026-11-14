"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EmptyState, Field, FormError, Panel, fieldClass } from "@/components/ui";
import type { SocialT } from "@/lib/social/i18n";
import type { PlatformCapabilities } from "@/lib/social/providers";
import {
  archiveAssetAction,
  cancelJobAction,
  confirmPublishAction,
  confirmUploadAction,
  deleteAssetAction,
  mediaPreviewUrlAction,
  requestUploadAction,
  retryJobAction,
  saveContentAction,
  syncYouTubeAccountAction,
  validateContentAction,
} from "@/app/dashboard/social-studio/actions";

/* Plain serialisable shapes passed from the server page. No secrets. */
export type AccountView = { id: string; platform: string; display_name: string; status: string };
export type AssetView = { id: string; name: string; kind: string; mime_type: string; size_bytes: number; duration_seconds: number | null; status: string };
export type ContentView = {
  id: string; title: string; description: string; caption: string; hashtags: string[]; language: string; notes: string;
  mediaIds: string[]; platforms: string[]; privacy: string;
};
export type JobView = {
  id: string; platform: string; status: string; run_at: string; timezone: string; attempts: number;
  last_error: string | null; error_kind: string | null; external_id: string | null; external_url: string | null; created_at: string;
};

const mb = (n: number) => `${(Number(n) / 1024 ** 2).toFixed(1)} MB`;

/* ------------------------------ Accounts ------------------------------ */

export function AccountsPanel({
  t, platforms, accounts,
}: { t: SocialT; platforms: PlatformCapabilities[]; accounts: AccountView[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function connect(integrationId: string) {
    setMsg(null);
    const res = await fetch(`/api/integrations/${integrationId}/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirectTo: "/dashboard/social-studio" }),
    });
    const data = (await res.json()) as { url?: string; error?: string };
    if (data.url) window.location.assign(data.url);
    else setMsg(data.error ?? "Error");
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">{t.readinessNote}</p>
      {msg && <FormError>{msg}</FormError>}
      <div className="grid gap-4 md:grid-cols-2">
        {platforms.map((p) => {
          const mine = accounts.filter((a) => a.platform === p.id);
          const ready = p.readiness === "implemented";
          return (
            <Panel
              key={p.id}
              title={p.name}
              action={
                <span className={`rounded-full px-2 py-0.5 text-xs ${ready ? "bg-accent-soft text-accent" : "bg-panel-2 text-muted"}`}>
                  {ready ? t.ready : t.pending}
                </span>
              }
            >
              <dl className="space-y-1 text-xs text-muted">
                <div><dt className="inline font-medium">Auth: </dt><dd className="inline">{p.auth}</dd></div>
                <div><dt className="inline font-medium">{t.scopes}: </dt><dd className="inline break-all">{p.requiredScopes.join(", ")}</dd></div>
                <div><dt className="inline font-medium">{t.limits}: </dt><dd className="inline">caption ≤ {p.limits.captionMax}{p.limits.titleMax ? `, title ≤ ${p.limits.titleMax}` : ""}</dd></div>
              </dl>
              <p className="mt-3 text-xs font-medium">{t.blockers}</p>
              <ul className="mt-1 list-disc space-y-1 ps-5 text-xs text-muted">
                {p.blockers.map((b) => <li key={b}>{b}</li>)}
              </ul>
              {mine.map((a) => (
                <p key={a.id} className="mt-3 rounded-lg bg-panel-2 px-3 py-2 text-sm">{a.display_name}</p>
              ))}
              {ready && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => connect(p.integrationId)} className="rounded-xl bg-accent px-3 py-2 text-xs font-medium text-white">
                    {t.connect}
                  </button>
                  {p.id === "youtube" && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => start(async () => {
                        const r = await syncYouTubeAccountAction();
                        setMsg(r.ok ? null : r.error);
                        router.refresh();
                      })}
                      className="rounded-xl border border-border px-3 py-2 text-xs"
                    >
                      {pending ? t.working : t.syncAccount}
                    </button>
                  )}
                </div>
              )}
              {ready && mine.length === 0 && <p className="mt-3 text-xs text-muted">{t.noAccounts}</p>}
            </Panel>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------- Media -------------------------------- */

function videoDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("video/")) return resolve(undefined);
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => { resolve(Number.isFinite(v.duration) ? v.duration : undefined); URL.revokeObjectURL(url); };
    v.onerror = () => { resolve(undefined); URL.revokeObjectURL(url); };
    v.src = url;
  });
}

export function MediaPanel({ t, assets }: { t: SocialT; assets: AssetView[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, { url: string; kind: string }>>({});

  async function onFile(file: File) {
    setError(null);
    setBusy(true);
    try {
      const durationSeconds = await videoDuration(file);
      const req = await requestUploadAction({ name: file.name, mimeType: file.type, sizeBytes: file.size, durationSeconds });
      if (!req.ok) return setError(req.error);
      const body = new FormData();
      body.append("cacheControl", "3600");
      body.append("", file);
      const put = await fetch(req.signedUrl, { method: "PUT", body });
      if (!put.ok) return setError(`Upload failed (${put.status}).`);
      const done = await confirmUploadAction(req.assetId);
      if (!done.ok) return setError(done.error);
      router.refresh();
    } catch {
      setError("Upload failed.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <Panel
      title={t.tabMedia}
      action={
        <>
          <input ref={input} type="file" accept="video/*,image/jpeg,image/png,image/webp" className="sr-only" id="media-file"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          <label htmlFor="media-file" className="cursor-pointer rounded-xl bg-accent px-3 py-2 text-xs font-medium text-white">
            {busy ? t.uploading : t.upload}
          </label>
        </>
      }
    >
      {error && <FormError>{error}</FormError>}
      {assets.length === 0 ? <EmptyState>{t.noMedia}</EmptyState> : (
        <ul className="divide-y divide-border">
          {assets.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{a.name}</p>
                <p className="text-xs text-muted">
                  {a.kind} · {a.mime_type} · {mb(a.size_bytes)}{a.duration_seconds ? ` · ${Math.round(a.duration_seconds)}s` : ""}
                </p>
                {previews[a.id] && (previews[a.id].kind === "video"
                  ? <video src={previews[a.id].url} controls className="mt-2 max-h-48 rounded-lg" />
                  // eslint-disable-next-line @next/next/no-img-element
                  : <img src={previews[a.id].url} alt={a.name} className="mt-2 max-h-48 rounded-lg" />)}
              </div>
              <div className="flex gap-2 text-xs">
                <button type="button" className="rounded-lg border border-border px-2 py-1" onClick={async () => {
                  const r = await mediaPreviewUrlAction(a.id);
                  if (r.ok) setPreviews((p) => ({ ...p, [a.id]: { url: r.url, kind: a.kind } })); else setError(r.error);
                }}>{t.preview}</button>
                <button type="button" className="rounded-lg border border-border px-2 py-1" onClick={async () => { await archiveAssetAction(a.id); router.refresh(); }}>{t.archive}</button>
                <button type="button" className="rounded-lg border border-border px-2 py-1 text-err" onClick={async () => {
                  if (!window.confirm(t.confirmDelete)) return;
                  const r = await deleteAssetAction(a.id);
                  if (!r.ok) setError(r.error);
                  router.refresh();
                }}>{t.delete}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ------------------------------- Content ------------------------------- */

const EMPTY: ContentView = { id: "", title: "", description: "", caption: "", hashtags: [], language: "ar", notes: "", mediaIds: [], platforms: ["youtube"], privacy: "private" };

export function ContentPanel({
  t, platforms, assets, contents, accounts, timezone,
}: {
  t: SocialT; platforms: PlatformCapabilities[]; assets: AssetView[]; contents: ContentView[]; accounts: AccountView[]; timezone: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState<ContentView>(EMPTY);
  const [hashtags, setHashtags] = useState("");
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [issues, setIssues] = useState<{ platform: string; issues: { message: string; severity: string }[] }[] | null>(null);
  const [when, setWhen] = useState("");
  const [pending, start] = useTransition();
  const ready = assets.filter((a) => a.status === "ready");
  const set = <K extends keyof ContentView>(k: K, v: ContentView[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const payload = () => ({ ...form, id: form.id || undefined, hashtags: hashtags, mediaIds: form.mediaIds, platforms: form.platforms });

  function save(then?: (id: string) => Promise<void>) {
    setNote(null);
    start(async () => {
      const r = await saveContentAction({ ...payload() });
      if (!r.ok) return setNote({ kind: "err", text: r.error });
      set("id", r.id);
      setNote({ kind: "ok", text: t.saved });
      if (then) await then(r.id);
      router.refresh();
    });
  }

  async function validate(id: string) {
    const r = await validateContentAction(id);
    if (!r.ok) return setNote({ kind: "err", text: r.error });
    setIssues(r.report);
    if (r.report.every((x) => x.issues.length === 0)) setNote({ kind: "ok", text: t.allGood });
  }

  async function publish(id: string, platform: string, scheduled: boolean) {
    if (!window.confirm(t.confirmPublishText)) return;
    const account = accounts.find((a) => a.platform === platform);
    if (!account) return setNote({ kind: "err", text: t.noAccounts });
    const r = await confirmPublishAction({ contentId: id, platform, accountId: account.id, scheduledAt: scheduled ? when : undefined, timezone });
    setNote(r.ok ? { kind: "ok", text: r.duplicate ? t.duplicate : t.queued } : { kind: "err", text: r.error });
    router.refresh();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
      <Panel title={t.tabContent} action={<button type="button" className="text-xs text-accent" onClick={() => { setForm(EMPTY); setHashtags(""); setIssues(null); setNote(null); }}>{t.newContent}</button>}>
        {contents.length === 0 ? <EmptyState>{t.noContent}</EmptyState> : (
          <ul className="space-y-1">
            {contents.map((c) => (
              <li key={c.id}>
                <button type="button" className={`w-full rounded-xl px-3 py-2 text-start text-sm hover:bg-panel-2 ${form.id === c.id ? "bg-accent-soft" : ""}`}
                  onClick={() => { setForm(c); setHashtags(c.hashtags.join(" ")); setIssues(null); setNote(null); }}>
                  {c.title || "—"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={form.id ? t.editContent : t.newContent}>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <Field id="sc-title" label={t.fieldTitle}><input id="sc-title" className={fieldClass} value={form.title} maxLength={200} onChange={(e) => set("title", e.target.value)} /></Field>
          <Field id="sc-desc" label={t.fieldDescription}><textarea id="sc-desc" rows={3} className={fieldClass} value={form.description} onChange={(e) => set("description", e.target.value)} /></Field>
          <Field id="sc-cap" label={t.fieldCaption}><textarea id="sc-cap" rows={3} className={fieldClass} value={form.caption} onChange={(e) => set("caption", e.target.value)} /></Field>
          <Field id="sc-tags" label={t.fieldHashtags}><input id="sc-tags" className={fieldClass} value={hashtags} onChange={(e) => setHashtags(e.target.value)} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="sc-lang" label={t.fieldLanguage}>
              <select id="sc-lang" className={fieldClass} value={form.language} onChange={(e) => set("language", e.target.value)}>
                <option value="ar">العربية</option><option value="en">English</option>
              </select>
            </Field>
            <Field id="sc-priv" label={t.fieldPrivacy}>
              <select id="sc-priv" className={fieldClass} value={form.privacy} onChange={(e) => set("privacy", e.target.value)}>
                <option value="private">{t.privPrivate}</option><option value="unlisted">{t.privUnlisted}</option><option value="public">{t.privPublic}</option>
              </select>
            </Field>
          </div>
          <fieldset>
            <legend className="mb-1 text-xs text-muted">{t.fieldMedia}</legend>
            <div className="flex flex-wrap gap-2">
              {ready.length === 0 && <span className="text-xs text-muted">{t.noMedia}</span>}
              {ready.map((a) => (
                <label key={a.id} className="flex items-center gap-2 rounded-lg border border-border px-2 py-1 text-xs">
                  <input type="checkbox" checked={form.mediaIds.includes(a.id)} onChange={() => set("mediaIds", toggle(form.mediaIds, a.id))} />
                  {a.name}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-xs text-muted">{t.fieldPlatforms}</legend>
            <div className="flex flex-wrap gap-2">
              {platforms.map((p) => (
                <label key={p.id} className="flex items-center gap-2 rounded-lg border border-border px-2 py-1 text-xs">
                  <input type="checkbox" checked={form.platforms.includes(p.id)} onChange={() => set("platforms", toggle(form.platforms, p.id))} />
                  {p.name}{p.readiness !== "implemented" ? ` (${t.pending})` : ""}
                </label>
              ))}
            </div>
          </fieldset>
          <Field id="sc-notes" label={t.fieldNotes}><textarea id="sc-notes" rows={2} className={fieldClass} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></Field>

          {note && (note.kind === "err" ? <FormError>{note.text}</FormError> : <p role="status" className="text-xs text-ok">{note.text}</p>)}
          {issues && issues.map((r) => r.issues.length > 0 && (
            <ul key={r.platform} className="list-disc space-y-1 ps-5 text-xs text-err">
              {r.issues.map((i) => <li key={i.message}>{r.platform}: {i.message}</li>)}
            </ul>
          ))}

          <div className="flex flex-wrap items-end gap-2">
            <button type="submit" disabled={pending} className="rounded-xl bg-accent px-3 py-2 text-xs font-medium text-white">{pending ? t.working : t.saveDraft}</button>
            <button type="button" disabled={pending || !form.title} className="rounded-xl border border-border px-3 py-2 text-xs" onClick={() => save(validate)}>{t.validate}</button>
          </div>

          <div className="space-y-2 border-t border-border pt-3">
            <Field id="sc-when" label={`${t.scheduledAt} (${timezone})`}>
              <input id="sc-when" type="datetime-local" className={fieldClass} value={when} onChange={(e) => setWhen(e.target.value)} />
            </Field>
            {form.platforms.filter((p) => platforms.find((x) => x.id === p)?.readiness === "implemented").map((p) => (
              <div key={p} className="flex flex-wrap gap-2">
                <button type="button" disabled={pending || !form.title} className="rounded-xl bg-ok px-3 py-2 text-xs font-medium text-white"
                  onClick={() => save((id) => publish(id, p, false))}>{t.publishNow} · {p}</button>
                <button type="button" disabled={pending || !form.title || !when} className="rounded-xl border border-border px-3 py-2 text-xs"
                  onClick={() => save((id) => publish(id, p, true))}>{t.schedule} · {p}</button>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted">{t.aiNote}</p>
        </form>
      </Panel>
    </div>
  );
}

/* ----------------------------- History / Schedule ----------------------------- */

export function JobsPanel({ t, jobs, scheduleOnly, locale }: { t: SocialT; jobs: JobView[]; scheduleOnly?: boolean; locale: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const label = (s: string) => ({ queued: t.statusQueued, running: t.statusRunning, succeeded: t.statusSucceeded, failed: t.statusFailed, cancelled: t.statusCancelled }[s] ?? s);
  const shown = jobs.filter((j) => (scheduleOnly ? j.status === "queued" : filter ? j.status === filter : true));
  const fmt = (iso: string, tz: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: tz }).format(new Date(iso));

  return (
    <Panel
      title={scheduleOnly ? t.tabCalendar : t.tabHistory}
      action={!scheduleOnly && (
        <select aria-label={t.filterStatus} className={`${fieldClass} !w-auto`} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">{t.all}</option>
          {["queued", "running", "succeeded", "failed", "cancelled"].map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
      )}
    >
      {error && <FormError>{error}</FormError>}
      {shown.length === 0 ? <EmptyState>{scheduleOnly ? t.noScheduled : t.noJobs}</EmptyState> : (
        <ul className="divide-y divide-border">
          {shown.map((j) => (
            <li key={j.id} className="space-y-1 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{j.platform} · {label(j.status)}</span>
                <span className="flex gap-2 text-xs">
                  {j.status === "queued" && <button type="button" className="rounded-lg border border-border px-2 py-1" onClick={async () => { const r = await cancelJobAction(j.id); if (!r.ok) setError(r.error); router.refresh(); }}>{t.cancel}</button>}
                  {j.status === "failed" && j.error_kind !== "terminal" && <button type="button" className="rounded-lg border border-border px-2 py-1" onClick={async () => { const r = await retryJobAction(j.id); if (!r.ok) setError(r.error); router.refresh(); }}>{t.retry}</button>}
                </span>
              </div>
              <p className="text-xs text-muted">{t.runAt}: {fmt(j.run_at, j.timezone)} ({j.timezone}) · {t.attempts}: {j.attempts}</p>
              {j.external_id && (
                <p className="text-xs text-muted">{t.externalId}: {j.external_id}{" "}
                  {j.external_url && <a className="text-accent underline" href={j.external_url} target="_blank" rel="noopener noreferrer">{t.open}</a>}
                </p>
              )}
              {j.last_error && <p className="text-xs text-err">{j.last_error}</p>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
