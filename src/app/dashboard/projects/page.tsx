import Link from "next/link";
import { ProjectForm, ProjectToolForm } from "@/components/project-form";
import { ProjectRow } from "@/components/project-row";
import { ToolRow } from "@/components/tool-row";
import { EmptyState, Panel } from "@/components/ui";
import { getT } from "@/lib/locale-server";
import { requireSession } from "@/lib/session";
import { taskCounts } from "@/lib/tasks-store";
import { fetchCategories, fetchProjects, fetchProjectTools } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ProjectsPage({ searchParams }: { searchParams?: Promise<{ archived?: string }> }) {
  const [t, session, params] = await Promise.all([getT(), requireSession(), searchParams]);
  const isAdmin = session.role === "admin";
  const showArchived = params?.archived === "1";
  const [allProjects, tools, categories] = await Promise.all([
    fetchProjects(),
    fetchProjectTools(),
    fetchCategories(),
  ]);
  // Archived projects are hidden by default; tools/pickers below still see all of them.
  const projects = showArchived ? allProjects : allProjects.filter((p) => !p.archived_at);
  const archivedCount = allProjects.length - allProjects.filter((p) => !p.archived_at).length;
  // Task progress is a nice-to-have: if the tasks table is missing (migration 0032 not applied) the list still renders.
  const progressByProject = await taskCounts(session.user.id).catch(() => new Map<string, { total: number; done: number; overdue: number }>());

  const projectName = new Map(projects.map((p) => [p.id, p.name]));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t.projects}</h1>
        <p className="text-sm text-muted">{t.brand}</p>
      </header>

      {isAdmin && (
        <Panel title={t.newProject}>
          <ProjectForm categories={categories} />
        </Panel>
      )}

      <Panel
        title={t.projects}
        action={archivedCount > 0 || showArchived ? (
          <Link href={showArchived ? "/dashboard/projects" : "/dashboard/projects?archived=1"} className="text-xs text-accent">
            {showArchived ? t.hideArchived : `${t.showArchived} (${archivedCount})`}
          </Link>
        ) : undefined}
      >
        {projects.length === 0 ? (
          <EmptyState>{t.noProjects}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{t.projects}</caption>
              <thead className="text-xs uppercase tracking-wider text-muted">
                <tr className="border-b border-border">
                  <th scope="col" className="py-2 text-start">{t.name}</th>
                  <th scope="col" className="py-2 text-start">{t.category}</th>
                  <th scope="col" className="py-2 text-start">{t.mcpEndpoint}</th>
                  <th scope="col" className="py-2 text-start">{t.status}</th>
                  <th scope="col" className="py-2 text-start">{t.createdAt}</th>
                  <th scope="col" className="py-2 text-end">{t.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {projects.map((project) => (
                  <ProjectRow
                    key={project.id}
                    project={project}
                    categories={categories}
                    canEdit={isAdmin}
                    taskProgress={progressByProject.get(project.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title={t.mcpTools}>
        {isAdmin && <ProjectToolForm projects={projects} />}
        {tools.length === 0 ? (
          <p className="mt-4 text-sm text-muted">{t.noTools}</p>
        ) : (
          <ul className="mt-4 divide-y divide-border text-sm">
            {tools.map((tool) => (
              <ToolRow
                key={tool.id}
                tool={tool}
                projectName={projectName.get(tool.project_id) ?? "—"}
                canEdit={isAdmin}
              />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
