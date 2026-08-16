"use client";

import { useActionState, useId } from "react";
import { Trash2 } from "lucide-react";
import { removeMemberAction, saveMemberAction } from "@/app/actions";
import { useLocale } from "@/components/providers";
import { Field, FormError, fieldClass } from "@/components/ui";
import type { Member } from "@/lib/members";

type State = { error?: string; ok?: boolean } | null;

/**
 * Grants access and sets roles. OWNER_EMAILS still exists and still wins, so
 * the list here is only the people added at runtime — the environment allowlist
 * is what keeps a fresh install from locking itself out.
 */
export function MemberManager({ members }: { members: Member[] }) {
  const { t } = useLocale();
  const id = useId();

  const [state, save, saving] = useActionState<State, FormData>(
    async (_prev, formData) => saveMemberAction(formData),
    null,
  );

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">{t.membersHint}</p>

      {members.length === 0 ? (
        <p className="text-sm text-muted">{t.noMembers}</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {members.map((m) => (
            <li key={m.email} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate">{m.email}</span>
              <div className="flex items-center gap-3">
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-xs ${
                    m.role === "admin"
                      ? "border-accent/40 bg-accent-soft text-accent"
                      : "border-border bg-panel-2 text-muted"
                  }`}
                >
                  {m.role === "admin" ? t.roleAdmin : t.roleViewer}
                </span>
                <RemoveMember email={m.email} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <form action={save} className="grid gap-3 sm:grid-cols-3">
        <Field id={`${id}-email`} label={t.email}>
          <input
            id={`${id}-email`}
            name="email"
            type="email"
            required
            className={fieldClass}
          />
        </Field>

        <Field id={`${id}-role`} label={t.role}>
          <select id={`${id}-role`} name="role" defaultValue="viewer" className={fieldClass}>
            <option value="viewer">{t.roleViewer}</option>
            <option value="admin">{t.roleAdmin}</option>
          </select>
        </Field>

        <div className="flex items-end">
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
          >
            {t.addMember}
          </button>
        </div>

        {state?.error && (
          <div className="sm:col-span-3">
            <FormError>{state.error}</FormError>
          </div>
        )}
      </form>
    </div>
  );
}

function RemoveMember({ email }: { email: string }) {
  const { t } = useLocale();
  const [state, action, pending] = useActionState<State, FormData>(
    async (_prev, formData) => removeMemberAction(formData),
    null,
  );

  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(`${t.confirmRemoveMember}\n\n${email}`)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="email" value={email} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`${t.delete}: ${email}`}
        className="rounded-lg p-1.5 text-err hover:bg-err/10 disabled:opacity-40"
      >
        <Trash2 size={15} aria-hidden />
      </button>
      {state?.error && (
        <p role="alert" className="text-[11px] text-err">
          {state.error}
        </p>
      )}
    </form>
  );
}
