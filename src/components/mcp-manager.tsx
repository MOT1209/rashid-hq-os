"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { discoverToolsAction, saveServerTokenAction, setServerProtocolAction, setToolPolicyAction } from "@/app/dashboard/mcp/actions";
import { testProjectToolAction } from "@/app/actions";
import { EmptyState, Field, FormError, Panel, fieldClass } from "@/components/ui";
import type { McpT } from "@/lib/mcp/i18n";

export type ToolView = {
  id: string; projectId: string; name: string; description: string | null;
  enabled: boolean; permission: string; requiresApproval: boolean;
  lastTestedAt: string | null; lastTestOk: boolean | null; lastTestError: string | null; lastLatencyMs: number | null;
  calls: number; denied: number; awaiting: number; failureRate: number | null;
  recent: { at: string; status: string; error: string | null }[];
};
export type ServerView = { id: string; name: string; endpoint: string | null; protocol: "hq" | "mcp"; hasToken: boolean; tools: ToolView[] };

function ToolCard({ t, tool, canEdit, locale }: { t: McpT; tool: ToolView; canEdit: boolean; locale: string }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(tool.enabled);
  const [permission, setPermission] = useState(tool.permission);
  const [approval, setApproval] = useState(tool.requiresApproval);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const when = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  const testable = tool.enabled && tool.permission === "read";
  const dangerous = permission === "dangerous";

  return (
    <li className="space-y-3 py-4">
      <div>
        <p className="font-medium">{tool.name}</p>
        {tool.description && <p className="text-xs text-muted">{tool.description}</p>}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" disabled={!canEdit} checked={enabled} onChange={() => setEnabled((v) => !v)} /> {t.enabled}
        </label>
        <Field id={`perm-${tool.id}`} label={t.permission}>
          <select id={`perm-${tool.id}`} disabled={!canEdit} className={`${fieldClass} !w-auto`} value={permission} onChange={(e) => setPermission(e.target.value)}>
            <option value="read">{t.permRead}</option>
            <option value="write">{t.permWrite}</option>
            <option value="dangerous">{t.permDangerous}</option>
          </select>
        </Field>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" disabled={!canEdit || dangerous} checked={approval || dangerous} onChange={() => setApproval((v) => !v)} /> {t.requiresApproval}
        </label>
        {canEdit && (
          <button type="button" disabled={pending} className="rounded-lg border border-border px-3 py-2 text-xs"
            onClick={() => start(async () => {
              const r = await setToolPolicyAction(tool.id, { enabled, permission, requiresApproval: approval });
              setMsg(r.ok ? { kind: "ok", text: t.saved } : { kind: "err", text: r.error });
              router.refresh();
            })}>{pending ? t.working : t.save}</button>
        )}
        {canEdit && (
          <button type="button" disabled={pending || !testable} title={testable ? undefined : t.testBlocked} className="rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-50"
            onClick={() => start(async () => {
              const fd = new FormData();
              fd.set("project_id", tool.projectId);
              fd.set("tool_name", tool.name);
              const r = await testProjectToolAction(fd);
              setMsg(r && "ok" in r && r.ok ? { kind: "ok", text: t.ok } : { kind: "err", text: (r && "error" in r && r.error) || t.failed });
              router.refresh();
            })}>{t.test}</button>
        )}
      </div>
      {msg && (msg.kind === "err" ? <FormError>{msg.text}</FormError> : <p role="status" className="text-xs text-ok">{msg.text}</p>)}

      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
        <div><dt className="text-muted">{t.lastTest}</dt>
          <dd>{tool.lastTestedAt ? <span className={tool.lastTestOk ? "text-ok" : "text-err"}>{tool.lastTestOk ? t.ok : t.failed}{tool.lastLatencyMs != null ? ` · ${tool.lastLatencyMs}ms` : ""} · {when(tool.lastTestedAt)}{tool.lastTestError ? ` — ${tool.lastTestError}` : ""}</span> : t.never}</dd></div>
        <div><dt className="text-muted">{t.calls7d}</dt><dd>{tool.calls}</dd></div>
        <div><dt className="text-muted">{t.failRate}</dt><dd>{tool.failureRate == null ? t.none : `${Math.round(tool.failureRate * 100)}%`}</dd></div>
        <div><dt className="text-muted">{t.denied}</dt><dd>{tool.denied}</dd></div>
        <div><dt className="text-muted">{t.awaiting}</dt><dd>{tool.awaiting}</dd></div>
      </dl>

      {tool.recent.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted">{t.recent}</summary>
          <ul className="mt-1 space-y-0.5">
            {tool.recent.map((r, i) => <li key={i}><span className="text-muted">{when(r.at)}</span> · {r.status}{r.error ? ` — ${r.error}` : ""}</li>)}
          </ul>
        </details>
      )}
    </li>
  );
}

function ServerCard({ t, s, canEdit, locale }: { t: McpT; s: ServerView; canEdit: boolean; locale: string }) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const report = (r: { ok: true } | { ok: false; error: string }, okText = t.saved) => setMsg(r.ok ? { kind: "ok", text: okText } : { kind: "err", text: r.error });

  return (
    <Panel title={s.name}>
      <p className="mb-3 break-all text-xs text-muted" dir="ltr">{s.endpoint ?? "—"}</p>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Field id={`proto-${s.id}`} label={t.protocol}>
          <select id={`proto-${s.id}`} disabled={!canEdit || pending} className={`${fieldClass} !w-auto`} value={s.protocol}
            onChange={(e) => start(async () => { report(await setServerProtocolAction(s.id, e.target.value)); router.refresh(); })}>
            <option value="hq">{t.protoHq}</option>
            <option value="mcp">{t.protoMcp}</option>
          </select>
        </Field>
        {s.protocol === "mcp" && canEdit && (
          <>
            <button type="button" disabled={pending || !s.endpoint} className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white"
              onClick={() => start(async () => {
                const r = await discoverToolsAction(s.id);
                setMsg(r.ok ? { kind: "ok", text: t.discovered.replace("{found}", String(r.found)).replace("{added}", String(r.added)) } : { kind: "err", text: r.error });
                router.refresh();
              })}>{pending ? t.working : t.discover}</button>
            <Field id={`tok-${s.id}`} label={`${t.token} — ${s.hasToken ? t.tokenSet : t.tokenNone}`}>
              <input id={`tok-${s.id}`} type="password" autoComplete="off" className={fieldClass} placeholder={t.tokenPlaceholder} value={token} onChange={(e) => setToken(e.target.value)} />
            </Field>
            <button type="button" disabled={pending} className="rounded-lg border border-border px-3 py-2 text-xs"
              onClick={() => start(async () => { report(await saveServerTokenAction(s.id, token)); setToken(""); router.refresh(); })}>{t.saveToken}</button>
          </>
        )}
      </div>
      <p className="mb-2 text-xs text-muted">{s.protocol === "mcp" ? t.discoverNote : t.protoNote}</p>
      {msg && (msg.kind === "err" ? <FormError>{msg.text}</FormError> : <p role="status" className="text-xs text-ok">{msg.text}</p>)}
      {s.tools.length === 0 ? <EmptyState>{t.noTools}</EmptyState> : (
        <ul className="divide-y divide-border">{s.tools.map((tool) => <ToolCard key={tool.id} t={t} tool={tool} canEdit={canEdit} locale={locale} />)}</ul>
      )}
    </Panel>
  );
}

export function McpManager({ t, servers, canEdit, locale }: { t: McpT; servers: ServerView[]; canEdit: boolean; locale: string }) {
  if (servers.length === 0) return <EmptyState>{t.empty}</EmptyState>;
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">{t.policyHelp}</p>
      {servers.map((s) => <ServerCard key={s.id} t={t} s={s} canEdit={canEdit} locale={locale} />)}
    </div>
  );
}
