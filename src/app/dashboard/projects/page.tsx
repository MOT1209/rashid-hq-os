import { ProjectForm, ProjectToolForm } from "@/components/project-form";
import { ProjectRow } from "@/components/project-row";
import { ToolRow } from "@/components/tool-row";
import { EmptyState, Panel } from "@/components/ui";
import { getT } from "@/lib/locale-server";
import { requireSession } from "@/lib/session";
import { fetchCategories, fetchProjects, fetchProjectTools } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const [t, session] = await Promise.all([getT(), requireSession()]);
  const isAdmin = session.role === "admin";
  const [projects, tools, categories] = await Promise.all([
    fetchProjects(),
    fetchProjectTools(),
    fetchCategories(),
  ]);

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

      <Panel title={t.projects}>
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
