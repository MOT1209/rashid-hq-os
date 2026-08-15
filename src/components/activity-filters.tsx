"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { useLocale } from "@/components/providers";
import type { Project } from "@/types/database";

const field =
  "rounded-xl border border-border bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent";

/**
 * Filters live in the URL, so the server component re-queries with them and the
 * view is shareable and back-button friendly.
 */
export function ActivityFilters({
  projects,
}: {
  projects: Pick<Project, "id" | "name">[];
}) {
  const { t } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.replace(`${pathname}?${next}`));
  };

  const projectId = params.get("projectId") ?? "";
  const status = params.get("status") ?? "";
  const hasFilters = Boolean(projectId || status);

  return (
    <div className="flex flex-wrap items-center gap-3" aria-busy={pending}>
      <label className="sr-only" htmlFor="filter-project">
        {t.project}
      </label>
      <select
        id="filter-project"
        className={field}
        value={projectId}
        onChange={(e) => setParam("projectId", e.target.value)}
      >
        <option value="">{t.allProjects}</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="filter-status">
        {t.status}
      </label>
      <select
        id="filter-status"
        className={field}
        value={status}
        onChange={(e) => setParam("status", e.target.value)}
      >
        <option value="">{t.allStatuses}</option>
        <option value="success">{t.success}</option>
        <option value="failed">{t.failed}</option>
        <option value="pending">{t.pending}</option>
      </select>

      {hasFilters && (
        <button
          type="button"
          onClick={() => startTransition(() => router.replace(pathname))}
          className="rounded-xl border border-border px-3 py-2 text-sm text-muted hover:text-text"
        >
          {t.clear}
        </button>
      )}
    </div>
  );
}
