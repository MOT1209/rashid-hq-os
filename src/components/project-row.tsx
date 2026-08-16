"use client";

import { useActionState, useId, useState } from "react";
import { Pencil } from "lucide-react";
import { updateProjectAction } from "@/app/actions";
import { useLocale } from "@/components/providers";
import { DeleteProjectButton } from "@/components/delete-project-button";
import { Field, FormError, StatusBadge, fieldClass } from "@/components/ui";
import { categoryLabel, categoryLabelOf, type ProjectCategory } from "@/lib/agents";
import type { Project, ProjectStatus } from "@/types/database";

type State = { error?: string; ok?: boolean } | null;

/**
 * A project row that flips into an inline edit form. Until now projects could
 * only be created and deleted — a typo in an endpoint meant recreating the row
 * and losing its logs to the cascade.
 */
export function ProjectRow({
  project,
  categories,
}: {
  project: Project;
  categories: ProjectCategory[];
}) {
  const { t, locale } = useLocale();
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState<State, FormData>(
    async (_prev, formData) => {
      const result = await updateProjectAction(formData);
      if (result?.ok) setEditing(false);
      return result;
    },
    null,
  );

  const statusLabel: Record<ProjectStatus, string> = {
    active: t.active,
    idle: t.idle,
    maintenance: t.maintenance,
  };

  if (editing) {
    return (
      <tr>
        <td colSpan={6} className="py-3">
          <form action={action} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="id" value={project.id} />

            <Field id={`${id}-name`} label={t.name}>
              <input
                id={`${id}-name`}
                name="name"
                defaultValue={project.name}
                required
                className={fieldClass}
              />
            </Field>

            <Field id={`${id}-category`} label={t.category}>
              <select
                id={`${id}-category`}
                name="category"
                defaultValue={project.category ?? ""}
                className={fieldClass}
              >
                <option value="">—</option>
                {categories.map((c) => (
                  <option key={c.value} value={c.value}>
                    {categoryLabelOf(c, locale)}
                  </option>
                ))}
              </select>
            </Field>

            <Field id={`${id}-url`} label={t.url}>
              <input
                id={`${id}-url`}
                name="url"
                type="url"
                defaultValue={project.url ?? ""}
                className={fieldClass}
              />
            </Field>

            <Field id={`${id}-repo`} label={t.repository}>
              <input
                id={`${id}-repo`}
                name="repository_url"
                type="url"
                defaultValue={project.repository_url ?? ""}
                className={fieldClass}
              />
            </Field>

            <Field id={`${id}-mcp`} label={t.mcpEndpoint}>
              <input
                id={`${id}-mcp`}
                name="mcp_endpoint"
                type="url"
                defaultValue={project.mcp_endpoint ?? ""}
                className={fieldClass}
              />
            </Field>

            <Field id={`${id}-status`} label={t.status}>
              <select
                id={`${id}-status`}
                name="status"
                defaultValue={project.status}
                className={fieldClass}
              >
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
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-xl border border-border px-4 py-2 text-sm text-muted"
              >
                {t.cancel}
              </button>
              {state?.error && <FormError>{state.error}</FormError>}
            </div>
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="py-3">
        <div className="font-medium">{project.name}</div>
        {project.url && (
          <a
            href={project.url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-accent"
          >
            {project.url}
          </a>
        )}
      </td>
      <td className="py-3 text-muted">{categoryLabel(categories, locale, project.category) ?? "—"}</td>
      <td className="max-w-56 truncate py-3 text-xs text-muted">
        {project.mcp_endpoint ?? "—"}
      </td>
      <td className="py-3">
        <StatusBadge status={project.status} label={statusLabel[project.status]} />
      </td>
      <td className="py-3 text-xs text-muted">
        <time dateTime={project.created_at} suppressHydrationWarning>
          {new Date(project.created_at).toLocaleDateString(locale)}
        </time>
      </td>
      <td className="py-3">
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={`${t.edit}: ${project.name}`}
            className="rounded-lg p-1.5 text-muted hover:bg-panel-2 hover:text-text"
          >
            <Pencil size={15} aria-hidden />
          </button>
          <DeleteProjectButton projectId={project.id} projectName={project.name} />
        </div>
      </td>
    </tr>
  );
}
