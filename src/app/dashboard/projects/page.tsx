import { ProjectForm, ProjectToolForm } from "@/components/project-form";
import { ProjectRow } from "@/components/project-row";
import { EmptyState, Panel } from "@/components/ui";
import { getT } from "@/lib/locale-server";
import { fetchProjects, fetchProjectTools } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const t = await getT();
  const [projects, tools] = await Promise.all([fetchProjects(), fetchProjectTools()]);

  const projectName = new Map(projects.map((p) => [p.id, p.name]));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t.projects}</h1>
        <p className="text-sm text-muted">{t.brand}</p>
      </header>

      <Panel title={t.newProject}>
        <ProjectForm />
      </Panel>

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
                  <ProjectRow key={project.id} project={project} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title={t.mcpTools}>
        <ProjectToolForm projects={projects} />
        {tools.length === 0 ? (
          <p className="mt-4 text-sm text-muted">{t.noTools}</p>
        ) : (
          <ul className="mt-4 divide-y divide-border text-sm">
            {tools.map((tool) => (
              <li key={tool.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <code className="text-accent">{tool.tool_name}</code>
                  {/* Which project a tool belongs to was previously invisible. */}
                  <span className="ms-2 text-xs text-muted">
                    · {projectName.get(tool.project_id) ?? "—"}
                  </span>
                </div>
                <span className="truncate text-xs text-muted">{tool.endpoint ?? "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
