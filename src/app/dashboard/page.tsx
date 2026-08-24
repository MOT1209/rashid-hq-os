import { Suspense } from "react";
import Link from "next/link";
import { ActivityStream } from "@/components/activity-stream";
import { CeoConsole } from "@/components/ceo-console";
import { PanelSkeleton, StatCardsSkeleton } from "@/components/skeleton";
import { Panel, StatCard, StatusBadge } from "@/components/ui";
import { getT } from "@/lib/locale-server";
import {
  fetchCategories,
  fetchDepartments,
  fetchLogs,
  fetchProjectOptions,
  fetchProjects,
  fetchSkills,
  fetchStats,
  projectNameMap,
} from "@/lib/queries";
import { agentLabel, categoryLabel, departmentName } from "@/lib/agents";
import { getLocale } from "@/lib/locale-server";
import type { Dictionary, Locale } from "@/lib/i18n";
import type { ProjectStatus } from "@/types/database";

export const dynamic = "force-dynamic";

/**
 * The three data panels are independent, so each streams behind its own
 * Suspense boundary — the console and headings paint immediately instead of
 * waiting on the slowest Supabase round-trip.
 */
export default async function DashboardPage() {
  const [t, locale, skills] = await Promise.all([getT(), getLocale(), fetchSkills()]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t.subtitle}</h1>
        <p className="text-sm text-muted">{t.brand}</p>
      </header>

      <CeoConsole skills={skills} />

      <Suspense fallback={<StatCardsSkeleton />}>
        <Stats t={t} />
      </Suspense>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Suspense fallback={<PanelSkeleton rows={5} />}>
            <RecentActivity t={t} />
          </Suspense>
        </div>

        <div className="space-y-6">
          <Suspense fallback={<PanelSkeleton rows={4} />}>
            <DepartmentsPanel t={t} locale={locale} />
          </Suspense>

          <Suspense fallback={<PanelSkeleton rows={4} />}>
            <ProjectsPanel t={t} locale={locale} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

async function Stats({ t }: { t: Dictionary }) {
  const stats = await fetchStats();
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label={t.activeProjects} value={stats.activeProjects} />
      <StatCard label={t.callsToday} value={stats.callsToday} />
      <StatCard label={t.failureRate} value={`${stats.failureRate}%`} />
      <StatCard label={t.pendingCalls} value={stats.pending} />
    </div>
  );
}

async function RecentActivity({ t }: { t: Dictionary }) {
  const [projects, logs] = await Promise.all([
    fetchProjectOptions(),
    fetchLogs({ limit: 15 }),
  ]);

  return (
    <Panel title={t.recentActivity}>
      <ActivityStream
        initialLogs={logs}
        projectNames={projectNameMap(projects)}
        limit={15}
        compact
      />
    </Panel>
  );
}

async function DepartmentsPanel({ t, locale }: { t: Dictionary; locale: Locale }) {
  const departments = await fetchDepartments();

  return (
    <Panel title={t.departments}>
      <ul className="space-y-2">
        {departments.map((d) => (
          <li key={d.key}>
            <Link
              href={`/dashboard/departments/${d.key}`}
              className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-sm hover:border-accent/50"
            >
              <span className="flex items-center gap-2">
                <span aria-hidden>{d.icon}</span>
                {departmentName(d, locale)}
              </span>
              <span className="text-xs text-muted">{agentLabel(d, locale)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

async function ProjectsPanel({ t, locale }: { t: Dictionary; locale: Locale }) {
  const [projects, categories] = await Promise.all([fetchProjects(6), fetchCategories()]);

  const statusLabel: Record<ProjectStatus, string> = {
    active: t.active,
    idle: t.idle,
    maintenance: t.maintenance,
  };

  return (
    <Panel
      title={t.projects}
      action={
        <Link href="/dashboard/projects" className="text-xs text-accent">
          {t.newProject}
        </Link>
      }
    >
      <ul className="space-y-2">
        {projects.map((project) => (
          <li key={project.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate">
              {project.name}
              {project.category && (
                <span className="ms-2 text-xs text-muted">
                  {categoryLabel(categories, locale, project.category)}
                </span>
              )}
            </span>
            <StatusBadge status={project.status} label={statusLabel[project.status]} />
          </li>
        ))}
        {projects.length === 0 && <li className="text-sm text-muted">{t.noProjects}</li>}
      </ul>
    </Panel>
  );
}
