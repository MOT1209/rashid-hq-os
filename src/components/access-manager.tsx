"use client";

import { useActionState, useId, useState } from "react";
import { Check, Copy } from "lucide-react";
import { issueTokenAction } from "@/app/actions";
import { useLocale } from "@/components/providers";
import { Field, FormError, fieldClass } from "@/components/ui";
import type { Project } from "@/types/database";

type State = { token?: string; error?: string } | null;

/** Issues a bearer token for an agent. The plaintext is shown exactly once. */
export function IssueTokenForm({
  projects,
}: {
  projects: Pick<Project, "id" | "name">[];
}) {
  const { t } = useLocale();
  const id = useId();
  const errorId = `${id}-error`;
  const [copied, setCopied] = useState(false);
  const [state, action, pending] = useActionState<State, FormData>(
    async (_prev, formData) => {
      setCopied(false);
      return issueTokenAction(formData);
    },
    null,
  );

  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      // Clipboard blocked (insecure origin or denied permission); the token is
      // on screen and selectable, so this is not worth an error state.
    }
  };

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-5">
      <Field id={`${id}-agent`} label={t.agent} hideLabel>
        <input
          id={`${id}-agent`}
          name="agent_name"
          placeholder={t.agent}
          required
          aria-describedby={state?.error ? errorId : undefined}
          className={fieldClass}
        />
      </Field>

      <Field id={`${id}-project`} label={t.project} hideLabel>
        <select id={`${id}-project`} name="project_id" defaultValue="" className={fieldClass}>
          <option value="">{`${t.project} — *`}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>

      {/* Scopes are enforced per tool in /api/mcp — a read token cannot write. */}
      <Field id={`${id}-scopes`} label={t.scope} hideLabel>
        <select id={`${id}-scopes`} name="scopes" defaultValue="read" className={fieldClass}>
          <option value="read">{t.scopeRead}</option>
          <option value="write">{t.scopeReadWrite}</option>
        </select>
      </Field>

      {/* expires_at was always enforced but never settable, so every token
          issued was immortal. Default to 90 days rather than forever. */}
      <Field id={`${id}-expiry`} label={t.expiry} hideLabel>
        <select id={`${id}-expiry`} name="expires_days" defaultValue="90" className={fieldClass}>
          <option value="7">{t.days7}</option>
          <option value="30">{t.days30}</option>
          <option value="90">{t.days90}</option>
          <option value="365">{t.days365}</option>
          <option value="0">{t.neverExpires}</option>
        </select>
      </Field>

      <button
        type="submit"
        disabled={pending}
        className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
      >
        {t.issueToken}
      </button>

      {state?.error && (
        <div className="sm:col-span-5">
          <FormError id={errorId}>{state.error}</FormError>
        </div>
      )}

      {state?.token && (
        <div className="sm:col-span-5 rounded-xl border border-accent/40 bg-accent-soft p-3">
          <p className="mb-2 text-xs text-warn">{t.tokenOnce}</p>
          <div className="flex items-start gap-2">
            <code className="block flex-1 break-all text-xs">{state.token}</code>
            <button
              type="button"
              onClick={() => void copy(state.token!)}
              aria-label={t.token}
              className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-panel-2 hover:text-text"
            >
              {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
