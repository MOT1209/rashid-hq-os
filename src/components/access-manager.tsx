"use client";

import { useActionState } from "react";
import { issueTokenAction } from "@/app/actions";
import { useLocale } from "@/components/providers";
import type { Project } from "@/types/database";

const field =
  "w-full rounded-xl border border-border bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent";

type State = { token?: string; error?: string } | null;

/** Issues a bearer token for an agent. The plaintext is shown exactly once. */
export function IssueTokenForm({ projects }: { projects: Project[] }) {
  const { t } = useLocale();
  const [state, action, pending] = useActionState<State, FormData>(
    async (_prev, formData) => issueTokenAction(formData),
    null,
  );

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-4">
      <input name="agent_name" placeholder={t.agent} required className={field} />
      <select name="project_id" defaultValue="" className={field}>
        <option value="">{`${t.project} — *`}</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {/* Scopes are enforced per tool in /api/mcp — a read token cannot write. */}
      <select name="scopes" defaultValue="read" className={field}>
        <option value="read">{t.scopeRead}</option>
        <option value="write">{t.scopeReadWrite}</option>
      </select>
      <button
        type="submit"
        disabled={pending}
        className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
      >
        {t.issueToken}
      </button>

      {state?.error && (
        <p className="sm:col-span-4 text-xs text-err">{state.error}</p>
      )}
      {state?.token && (
        <div className="sm:col-span-4 rounded-xl border border-accent/40 bg-accent-soft p-3">
          <p className="mb-2 text-xs text-warn">{t.tokenOnce}</p>
          <code className="block break-all text-xs">{state.token}</code>
        </div>
      )}
    </form>
  );
}
