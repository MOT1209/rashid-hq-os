"use client";

import { useActionState, useId } from "react";
import { Trash2 } from "lucide-react";
import { deleteSkillAction, saveSkillAction } from "@/app/actions";
import { useLocale } from "@/components/providers";
import { Field, FormError, fieldClass } from "@/components/ui";
import type { AgentSkill } from "@/lib/agents";

type State = { error?: string; ok?: boolean } | null;

/**
 * Saved command templates the CEO console can fill its input box with
 * (src/components/ceo-console.tsx). A skill is a stored string, nothing
 * more — it never runs a model on its own, so this panel carries none of the
 * risk a self-executing tool would.
 */
export function SkillManager({ skills }: { skills: AgentSkill[] }) {
  const { t } = useLocale();
  const id = useId();

  const [state, save, saving] = useActionState<State, FormData>(
    async (_prev, formData) => saveSkillAction(formData),
    null,
  );

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">{t.skillsHint}</p>

      {skills.length > 0 ? (
        <ul className="divide-y divide-border text-sm">
          {skills.map((skill) => (
            <li key={skill.id} className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="font-medium">{skill.name}</p>
                {skill.description && (
                  <p className="text-xs text-muted">{skill.description}</p>
                )}
                <p className="mt-1 truncate text-xs text-muted" title={skill.prompt}>
                  {skill.prompt}
                </p>
              </div>
              <DeleteSkill id={skill.id} name={skill.name} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">{t.noSkills}</p>
      )}

      <form action={save} className="grid gap-3">
        <Field id={`${id}-name`} label={t.skillName}>
          <input id={`${id}-name`} name="name" required className={fieldClass} />
        </Field>

        <Field id={`${id}-description`} label={t.skillDescription}>
          <input id={`${id}-description`} name="description" className={fieldClass} />
        </Field>

        <Field id={`${id}-prompt`} label={t.skillPrompt}>
          <textarea
            id={`${id}-prompt`}
            name="prompt"
            required
            rows={3}
            className={`${fieldClass} resize-y`}
          />
        </Field>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
          >
            {t.addSkill}
          </button>
          {state?.error && <FormError>{state.error}</FormError>}
        </div>
      </form>
    </div>
  );
}

function DeleteSkill({ id, name }: { id: string; name: string }) {
  const { t } = useLocale();
  const [state, action, pending] = useActionState<State, FormData>(
    async (_prev, formData) => deleteSkillAction(formData),
    null,
  );

  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(`${t.confirmDeleteSkill}\n\n${name}`)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`${t.delete}: ${name}`}
        className="shrink-0 rounded-lg p-1.5 text-err hover:bg-err/10 disabled:opacity-40"
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
