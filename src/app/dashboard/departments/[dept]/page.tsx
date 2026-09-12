import { notFound } from "next/navigation";
import Link from "next/link";
import { ActivityStream } from "@/components/activity-stream";
import { ActivityFilters } from "@/components/activity-filters";
import { ProjectForm } from "@/components/project-form";
import { ProjectRow } from "@/components/project-row";
import { EmptyState, Panel, StatCard } from "@/components/ui";
import { getLocale, getT } from "@/lib/locale-server";
import { requireSession } from "@/lib/session";
import {
  fetchCategories,
  fetchDepartments,
  fetchDepartmentStats,
  fetchLogs,
  fetchProjects,
  projectNameMap,
} from "@/lib/queries";
import { agentLabel, departmentForCategory, departmentName, getDepartment } from "@/lib/agents";
import type { AgentLog, LogStatus } from "@/types/database";

export const dynamic = "force-dynamic";

const HEALTH_CHECK_AGENT = "Scheduled Health Check";

function isStatus(value: string | undefined): value is LogStatus {
  return (
    value === "success" ||
    value === "failed" ||
    value === "pending" ||
    value === "awaiting_approval"
  );
}

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

/** Latest health-check log per project id, from a small slice of recent runs. */
function lastHealthCheckByProject(logs: AgentLog[]) {
  const byProject = new Map<string, AgentLog>();
  for (const log of logs) {
    if (!log.project_id) continue;
    const existing = byProject.get(log.project_id);
    if (!existing || log.created_at > existing.created_at) byProject.set(log.project_id, log);
  }
  return byProject;
}

export default async function DepartmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ dept: string }>;
  searchParams: Promise<{ status?: string; projectId?: string }>;
}) {
  const [{ dept }, filters, t, locale, session, departments, categories] = await Promise.all([
    params,
    searchParams,
    getT(),
    getLocale(),
    requireSession(),
    fetchDepartments(),
    fetchCategories(),
  ]);
  const status = isStatus(filters.status) ? filters.status : undefined;
  const projectId = filters.projectId;

  const department = getDepartment(departments, dept);
  if (!department) notFound();

  const isAdmin = session.role === "admin";

  const [allProjects, logs, healthLogs, stats] = await Promise.all([
    fetchProjects(),
    fetchLogs({ limit: 50, agentNames: [department.agent_name], status, projectId }),
    fetchLogs({ agentNames: [HEALTH_CHECK_AGENT], limit: 200 }),
    fetchDepartmentStats(department.agent_name),
  ]);

  const projects = allProjects.filter(
    (p) => departmentForCategory(departments, categories, p.category)?.key === department.key,
  );
  const activeProjects = projects.filter((p) => p.status === "active").length;
  const departmentCategories = categories.filter((c) => c.department_key === department.key);
  const lastHealthCheck = lastHealthCheckByProject(healthLogs);

  return (
    <div className="space-y-6">
      <nav aria-label={t.departments} className="flex flex-wrap gap-2">
        {departments.map((d) => (
          <Link
            key={d.key}
            href={`/dashboard/departments/${d.key}`}
            aria-current={d.key === department.key ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              d.key === department.key
                ? "border-accent bg-accent/10 text-accent"
                : "border-border text-muted hover:text-text"
            }`}
          >
            <span aria-hidden>{d.icon}</span> {departmentName(d, locale)}
          </Link>
        ))}
      </nav>

      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <span aria-hidden>{department.icon}</span>
          {departmentName(department, locale)}
        </h1>
        <p className="text-sm text-muted">{agentLabel(department, locale)}</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t.activeProjects} value={activeProjects} />
        <StatCard label={t.callsToday} value={stats.callsToday} />
        <StatCard label={t.failureRate} value={`${stats.failureRate}%`} />
        <StatCard label={t.pendingCalls} value={stats.pending} />
      </div>

      {isAdmin && (
        <Panel title={t.newProject}>
          <ProjectForm categories={departmentCategories} />
        </Panel>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
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
                    <th scope="col" className="py-2 text-start">{t.lastHealthCheck}</th>
                    <th scope="col" className="py-2 text-start">{t.createdAt}</th>
                    <th scope="col" className="py-2 text-end">{t.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {projects.map((project) => {
                    const check = lastHealthCheck.get(project.id);
                    return (
                      <ProjectRow
                        key={project.id}
                        project={project}
                        categories={categories}
                        canEdit={isAdmin}
                        healthCheck={
                          check
                            ? {
                                ok: check.status === "success",
                                at: check.created_at,
                              }
                            : null
                        }
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title={t.activity}>
          <div className="mb-4">
            <ActivityFilters projects={projects} />
          </div>
          <ActivityStream
            // Remount on filter change so the SSE subscription and the loaded
            // page both reset instead of mixing results from two filters.
            key={`${projectId ?? ""}:${status ?? ""}`}
            initialLogs={logs}
            projectNames={projectNameMap(allProjects)}
            agentNames={[department.agent_name]}
            projectId={projectId}
            status={status}
            compact
          />
        </Panel>
      </div>
    </div>
  );
}
