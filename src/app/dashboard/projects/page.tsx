import { deleteProjectAction } from "@/app/actions";
import { ProjectForm, ProjectToolForm } from "@/components/project-form";
import { EmptyState, Panel, StatusBadge } from "@/components/ui";
import { getT } from "@/lib/locale-server";
import { fetchProjects, fetchProjectTools } from "@/lib/queries";
import type { ProjectStatus } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const t = await getT();
  const [projects, tools] = await Promise.all([fetchProjects(), fetchProjectTools()]);

  const statusLabel: Record<ProjectStatus, string> = {
    active: t.active,
    idle: t.idle,
    maintenance: t.maintenance,
  };

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
              <thead className="text-xs uppercase tracking-wider text-muted">
                <tr className="border-b border-border">
                  <th className="py-2 text-start">{t.name}</th>
                  <th className="py-2 text-start">{t.category}</th>
                  <th className="py-2 text-start">{t.mcpEndpoint}</th>
                  <th className="py-2 text-start">{t.status}</th>
                  <th className="py-2 text-start">{t.createdAt}</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {projects.map((project) => (
                  <tr key={project.id}>
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
                    <td className="py-3 text-muted">{project.category ?? "—"}</td>
                    <td className="max-w-56 truncate py-3 text-xs text-muted">
                      {project.mcp_endpoint ?? "—"}
                    </td>
                    <td className="py-3">
                      <StatusBadge
                        status={project.status}
                        label={statusLabel[project.status]}
                      />
                    </td>
                    <td className="py-3 text-xs text-muted">
                      {new Date(project.created_at).toISOString().slice(0, 10)}
                    </td>
                    <td className="py-3 text-end">
                      <form action={deleteProjectAction}>
                        <input type="hidden" name="id" value={project.id} />
                        <button type="submit" className="text-xs text-err">
                          ✕
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="MCP Tools">
        <ProjectToolForm projects={projects} />
        {tools.length > 0 && (
          <ul className="mt-4 divide-y divide-border text-sm">
            {tools.map((tool) => (
              <li key={tool.id} className="flex items-center justify-between gap-3 py-2">
                <code className="text-accent">{tool.tool_name}</code>
                <span className="truncate text-xs text-muted">
                  {tool.endpoint ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
