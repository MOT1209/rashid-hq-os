import Link from "next/link";
import { ActivityStream } from "@/components/activity-stream";
import { CeoConsole } from "@/components/ceo-console";
import { Panel, StatCard, StatusBadge } from "@/components/ui";
import { getT } from "@/lib/locale-server";
import { fetchLogs, fetchProjects, fetchStats, projectNameMap } from "@/lib/queries";
import { DEPARTMENTS } from "@/lib/agents";
import type { ProjectStatus } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const t = await getT();
  const [projects, logs, stats] = await Promise.all([
    fetchProjects(),
    fetchLogs({ limit: 15 }),
    fetchStats(),
  ]);

  const statusLabel: Record<ProjectStatus, string> = {
    active: t.active,
    idle: t.idle,
    maintenance: t.maintenance,
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t.subtitle}</h1>
        <p className="text-sm text-muted">{t.brand}</p>
      </header>

      <CeoConsole />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t.activeProjects} value={stats.activeProjects} />
        <StatCard label={t.callsToday} value={stats.callsToday} />
        <StatCard label={t.failureRate} value={`${stats.failureRate}%`} />
        <StatCard label={t.pendingCalls} value={stats.pending} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title={t.recentActivity} className="lg:col-span-2">
          <ActivityStream
            initialLogs={logs}
            projectNames={projectNameMap(projects)}
            limit={15}
            compact
          />
        </Panel>

        <div className="space-y-6">
          <Panel title={t.departments}>
            <ul className="space-y-2">
              {DEPARTMENTS.map((d) => (
                <li key={d.key}>
                  <Link
                    href={`/dashboard/departments/${d.key}`}
                    className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-sm hover:border-accent/50"
                  >
                    <span className="flex items-center gap-2">
                      <span aria-hidden>{d.icon}</span>
                      {t[d.key]}
                    </span>
                    <span className="text-xs text-muted">{d.agent}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel
            title={t.projects}
            action={
              <Link href="/dashboard/projects" className="text-xs text-accent">
                {t.newProject}
              </Link>
            }
          >
            <ul className="space-y-2">
              {projects.slice(0, 6).map((project) => (
                <li
                  key={project.id}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="truncate">{project.name}</span>
                  <StatusBadge
                    status={project.status}
                    label={statusLabel[project.status]}
                  />
                </li>
              ))}
              {projects.length === 0 && (
                <li className="text-sm text-muted">{t.noProjects}</li>
              )}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
