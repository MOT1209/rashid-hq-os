"use client";

import { useActionState, useId } from "react";
import { createProjectAction, addProjectToolAction } from "@/app/actions";
import { useLocale } from "@/components/providers";
import { Field, FormError, fieldClass } from "@/components/ui";
import { categoryLabelOf, type ProjectCategory } from "@/lib/agents";
import type { Project } from "@/types/database";

type State = { error?: string; ok?: boolean } | null;

export function ProjectForm({ categories }: { categories: ProjectCategory[] }) {
  const { t, locale } = useLocale();
  const id = useId();
  const errorId = `${id}-error`;
  const [state, action, pending] = useActionState<State, FormData>(
    async (_prev, formData) => createProjectAction(formData),
    null,
  );

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <Field id={`${id}-name`} label={t.name} hideLabel>
        <input
          id={`${id}-name`}
          name="name"
          placeholder={t.name}
          required
          aria-describedby={state?.error ? errorId : undefined}
          className={fieldClass}
        />
      </Field>

      <Field id={`${id}-category`} label={t.category} hideLabel>
        <select id={`${id}-category`} name="category" defaultValue="" className={fieldClass}>
          <option value="">{t.category}</option>
          {categories.map((c) => (
            <option key={c.value} value={c.value}>
              {categoryLabelOf(c, locale)}
            </option>
          ))}
        </select>
      </Field>

      <Field id={`${id}-url`} label={t.url} hideLabel>
        <input
          id={`${id}-url`}
          name="url"
          type="url"
          placeholder={t.url}
          className={fieldClass}
        />
      </Field>

      <Field id={`${id}-repo`} label={t.repository} hideLabel>
        <input
          id={`${id}-repo`}
          name="repository_url"
          type="url"
          placeholder={t.repository}
          className={fieldClass}
        />
      </Field>

      <Field id={`${id}-mcp`} label={t.mcpEndpoint} hideLabel>
        <input
          id={`${id}-mcp`}
          name="mcp_endpoint"
          type="url"
          placeholder={t.mcpEndpoint}
          className={fieldClass}
        />
      </Field>

      <Field id={`${id}-status`} label={t.status} hideLabel>
        <select id={`${id}-status`} name="status" defaultValue="active" className={fieldClass}>
          <option value="active">{t.active}</option>
          <option value="idle">{t.idle}</option>
          <option value="maintenance">{t.maintenance}</option>
        </select>
      </Field>

      <div className="sm:col-span-2 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
        >
          {t.save}
        </button>
        {state?.error && <FormError id={errorId}>{state.error}</FormError>}
      </div>
    </form>
  );
}

export function ProjectToolForm({
  projects,
}: {
  projects: Pick<Project, "id" | "name">[];
}) {
  const { t } = useLocale();
  const id = useId();
  const errorId = `${id}-error`;
  const [state, action, pending] = useActionState<State, FormData>(
    async (_prev, formData) => addProjectToolAction(formData),
    null,
  );

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <Field id={`${id}-project`} label={t.project} hideLabel>
        <select
          id={`${id}-project`}
          name="project_id"
          required
          defaultValue=""
          className={fieldClass}
        >
          <option value="" disabled>
            {t.project}
          </option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>

      <Field id={`${id}-tool`} label={t.tool} hideLabel>
        <input
          id={`${id}-tool`}
          name="tool_name"
          placeholder={t.tool}
          required
          aria-describedby={state?.error ? errorId : undefined}
          className={fieldClass}
        />
      </Field>

      <Field id={`${id}-endpoint`} label={t.endpoint} hideLabel>
        <input
          id={`${id}-endpoint`}
          name="endpoint"
          type="url"
          placeholder={t.mcpEndpoint}
          className={fieldClass}
        />
      </Field>

      <Field id={`${id}-desc`} label={t.description} hideLabel>
        <input
          id={`${id}-desc`}
          name="description"
          placeholder={t.description}
          className={fieldClass}
        />
      </Field>

      <div className="sm:col-span-2 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl border border-accent px-4 py-2 text-sm font-medium text-accent disabled:opacity-40"
        >
          {t.save}
        </button>
        {state?.error && <FormError id={errorId}>{state.error}</FormError>}
      </div>
    </form>
  );
}
