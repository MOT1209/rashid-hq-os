import { notFound } from "next/navigation";
import { ActivityStream } from "@/components/activity-stream";
import { EmptyState, Panel, StatusBadge } from "@/components/ui";
import { getT } from "@/lib/locale-server";
import { fetchLogs, fetchProjects, projectNameMap } from "@/lib/queries";
import { departmentForCategory, getDepartment } from "@/lib/agents";
import type { ProjectStatus } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function DepartmentPage({
  params,
}: {
  params: Promise<{ dept: string }>;
}) {
  const { dept } = await params;
  const department = getDepartment(dept);
  if (!department) notFound();

  const t = await getT();
  const [allProjects, logs] = await Promise.all([
    fetchProjects(),
    fetchLogs({ limit: 50, agentNames: [department.agent] }),
  ]);

  const projects = allProjects.filter(
    (p) => departmentForCategory(p.category).key === department.key,
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
          {t[department.key]}
        </h1>
        <p className="text-sm text-muted">{department.agent}</p>
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
                      {project.category ?? "—"}
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
            agentNames={[department.agent]}
            compact
          />
        </Panel>
      </div>
    </div>
  );
}
