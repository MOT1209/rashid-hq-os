import { notFound } from "next/navigation";
import { ActivityStream } from "@/components/activity-stream";
import { EmptyState, Panel, StatusBadge } from "@/components/ui";
import { getLocale, getT } from "@/lib/locale-server";
import {
  fetchCategories,
  fetchDepartments,
  fetchLogs,
  fetchProjects,
  projectNameMap,
} from "@/lib/queries";
import {
  agentLabel,
  categoryLabel,
  departmentForCategory,
  departmentName,
  getDepartment,
} from "@/lib/agents";
import type { ProjectStatus } from "@/types/database";

export const dynamic = "force-dynamic";

// Departments are rows now, so their routes are only known at request time —
// no generateStaticParams. The page is force-dynamic regardless.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ dept: string }>;
}) {
  const [{ dept }, t, locale, departments] = await Promise.all([
    params,
    getT(),
    getLocale(),
    fetchDepartments(),
  ]);
  const department = getDepartment(departments, dept);
  return {
    title: department
      ? `${departmentName(department, locale)} — ${t.brand}`
      : t.notFoundTitle,
  };
}

export default async function DepartmentPage({
  params,
}: {
  params: Promise<{ dept: string }>;
}) {
  const [{ dept }, t, locale, departments, categories] = await Promise.all([
    params,
    getT(),
    getLocale(),
    fetchDepartments(),
    fetchCategories(),
  ]);

  const department = getDepartment(departments, dept);
  if (!department) notFound();

  const [allProjects, logs] = await Promise.all([
    fetchProjects(),
    fetchLogs({ limit: 50, agentNames: [department.agent_name] }),
  ]);

  const projects = allProjects.filter(
    (p) => departmentForCategory(departments, categories, p.category)?.key === department.key,
  );

  const statusLabel: Record<ProjectStatus, string> = {
    active: t.active,
    idle: t.idle,
    maintenance: t.maintenance,
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <span aria-hidden>{department.icon}</span>
          {departmentName(department, locale)}
        </h1>
        <p className="text-sm text-muted">{agentLabel(department, locale)}</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={t.projects}>
          {projects.length === 0 ? (
            <EmptyState>{t.noProjects}</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {projects.map((project) => (
                <li
                  key={project.id}
                  className="flex items-center justify-between gap-3 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{project.name}</p>
                    <p className="truncate text-xs text-muted">
                      {categoryLabel(categories, locale, project.category) ?? "—"}
                    </p>
                  </div>
                  <StatusBadge
                    status={project.status}
                    label={statusLabel[project.status]}
                  />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={t.activity}>
          <ActivityStream
            initialLogs={logs}
            projectNames={projectNameMap(allProjects)}
            agentNames={[department.agent_name]}
            compact
          />
        </Panel>
      </div>
    </div>
  );
}
