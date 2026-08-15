"use client";

import { useActionState } from "react";
import { createProjectAction, addProjectToolAction } from "@/app/actions";
import { useLocale } from "@/components/providers";
import { PROJECT_CATEGORIES } from "@/lib/agents";
import type { Project } from "@/types/database";

const field =
  "w-full rounded-xl border border-border bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent";

type State = { error?: string; ok?: boolean } | null;

export function ProjectForm() {
  const { t } = useLocale();
  const [state, action, pending] = useActionState<State, FormData>(
    async (_prev, formData) => createProjectAction(formData),
    null,
  );

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <input name="name" placeholder={t.name} required className={field} />
      <select name="category" defaultValue="" className={field}>
        <option value="">{t.category}</option>
        {PROJECT_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <input name="url" type="url" placeholder={t.url} className={field} />
      <input
        name="repository_url"
        type="url"
        placeholder={t.repository}
        className={field}
      />
      <input
        name="mcp_endpoint"
        type="url"
        placeholder={t.mcpEndpoint}
        className={field}
      />
      <select name="status" defaultValue="active" className={field}>
        <option value="active">{t.active}</option>
        <option value="idle">{t.idle}</option>
        <option value="maintenance">{t.maintenance}</option>
      </select>

      <div className="sm:col-span-2 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
        >
          {t.save}
        </button>
        {state?.error && <span className="text-xs text-err">{state.error}</span>}
      </div>
    </form>
  );
}

export function ProjectToolForm({ projects }: { projects: Project[] }) {
  const { t } = useLocale();
  const [state, action, pending] = useActionState<State, FormData>(
    async (_prev, formData) => addProjectToolAction(formData),
    null,
  );

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <select name="project_id" required defaultValue="" className={field}>
        <option value="" disabled>
          {t.project}
        </option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <input name="tool_name" placeholder={t.tool} required className={field} />
      <input name="endpoint" type="url" placeholder={t.mcpEndpoint} className={field} />
      <input name="description" placeholder="—" className={field} />

      <div className="sm:col-span-2 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl border border-accent px-4 py-2 text-sm font-medium text-accent disabled:opacity-40"
        >
          {t.save}
        </button>
        {state?.error && <span className="text-xs text-err">{state.error}</span>}
      </div>
    </form>
  );
}
