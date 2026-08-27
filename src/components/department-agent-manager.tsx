"use client";

import { useActionState, useId } from "react";
import { updateDepartmentAgentAction } from "@/app/actions";
import { useLocale } from "@/components/providers";
import { Field, FormError, fieldClass } from "@/components/ui";
import { agentLabel, departmentName } from "@/lib/agents";
import type { Department } from "@/lib/agents";

type State = { error?: string; ok?: boolean } | null;

/**
 * Edits the `system_prompt` and `model` behind each department agent
 * (migration 0011). Before this the only way to change an agent's personality
 * was SQL against the production database.
 */
export function DepartmentAgentManager({ departments }: { departments: Department[] }) {
  const { t } = useLocale();

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">{t.departmentAgentsHint}</p>
      <ul className="space-y-6">
        {departments.map((department) => (
          <li key={department.key}>
            <AgentEditor department={department} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function AgentEditor({ department }: { department: Department }) {
  const { t, locale } = useLocale();
  const id = useId();

  const [state, save, saving] = useActionState<State, FormData>(
    async (_prev, formData) => updateDepartmentAgentAction(formData),
    null,
  );

  return (
    <form action={save} className="grid gap-3 rounded-xl border border-border p-4">
      <div>
        <p className="flex items-center gap-2 font-medium">
          <span aria-hidden>{department.icon}</span>
          {departmentName(department, locale)}
          <code className="text-xs text-muted">{department.agent_name}</code>
        </p>
        <p className="text-xs text-muted">{agentLabel(department, locale)}</p>
      </div>

      <input type="hidden" name="key" value={department.key} />

      <Field id={`${id}-prompt`} label={t.systemPrompt}>
        <textarea
          id={`${id}-prompt`}
          name="system_prompt"
          rows={6}
          defaultValue={department.system_prompt}
          className={`${fieldClass} resize-y font-mono text-xs`}
        />
      </Field>

      <Field id={`${id}-model`} label={t.model}>
        <input
          id={`${id}-model`}
          name="model"
          defaultValue={department.model ?? ""}
          placeholder={t.modelPlaceholder}
          className={fieldClass}
        />
      </Field>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
        >
          {t.saveAgent}
        </button>
        {state?.ok && <span className="text-xs text-muted">{t.agentSaved}</span>}
        {state?.error && <FormError>{state.error}</FormError>}
      </div>
    </form>
  );
}
