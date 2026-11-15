import { Suspense } from "react";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
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
import { isOwnerEmail } from "@/lib/owners";
import { requireSession } from "@/lib/session";
import { socialSummary } from "@/lib/social/summary";
import { socialT } from "@/lib/social/i18n";
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
  const [t, locale, skills, session] = await Promise.all([
    getT(),
    getLocale(),
    fetchSkills(),
    requireSession(),
  ]);

  // An owner account can reach every project and issue tokens for all of them,
  // so leaving it on a password alone is the widest hole this console can have.
  // A nudge rather than a block: forcing it could lock the only owner out.
  const needsTwoFactor =
    isOwnerEmail(session.user.email) && !session.user.twoFactorEnabled;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t.subtitle}</h1>
        <p className="text-sm text-muted">{t.brand}</p>
      </header>

      {needsTwoFactor && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
          <ShieldAlert size={16} aria-hidden className="shrink-0" />
          {t.twoFactorNudge}
          <Link href="/dashboard/settings" className="font-medium underline">
            {t.twoFactorNudgeAction}
          </Link>
        </p>
      )}

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

          <Suspense fallback={<PanelSkeleton rows={3} />}>
            <SocialPanel ownerId={session.user.id} locale={locale} />
          </Suspense>

          <Suspense fallback={<PanelSkeleton rows={4} />}>
            <ProjectsPanel t={t} locale={locale} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

async function SocialPanel({ ownerId, locale }: { ownerId: string; locale: Locale }) {
  const st = socialT(locale);
  // Not inside the page's try/catch: a missing migration must degrade this panel only.
  const summary = await socialSummary(ownerId).catch(() => null);
  const fmt = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  return (
    <Panel title={st.dashTitle}>
      {!summary ? (
        <p className="text-xs text-muted">{st.dashUnavailable}</p>
      ) : (
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-xs text-muted">{st.dashAccounts}</dt><dd className="text-lg font-semibold">{summary.accounts}</dd></div>
          <div><dt className="text-xs text-muted">{st.dashQueued}</dt><dd className="text-lg font-semibold">{summary.queued}</dd></div>
          <div><dt className="text-xs text-muted">{st.dashPublished7d}</dt><dd className="text-lg font-semibold">{summary.succeeded7d}</dd></div>
          <div><dt className="text-xs text-muted">{st.dashFailed7d}</dt><dd className={`text-lg font-semibold ${summary.failed7d ? "text-err" : ""}`}>{summary.failed7d}</dd></div>
          <div className="col-span-2"><dt className="text-xs text-muted">{st.dashNext}</dt><dd>{summary.nextRunAt ? fmt(summary.nextRunAt) : st.dashNone}</dd></div>
          {summary.lastError && <div className="col-span-2 text-xs text-err">{summary.lastError}</div>}
        </dl>
      )}
      <Link href="/dashboard/social-studio" className="mt-3 inline-block text-xs text-accent underline">{st.dashOpen}</Link>
    </Panel>
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
