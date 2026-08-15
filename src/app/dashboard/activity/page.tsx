import { ActivityFilters } from "@/components/activity-filters";
import { ActivityStream } from "@/components/activity-stream";
import { Panel } from "@/components/ui";
import { getT } from "@/lib/locale-server";
import { fetchLogs, fetchProjectOptions, projectNameMap } from "@/lib/queries";
import type { LogStatus } from "@/types/database";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

function isStatus(value: string | undefined): value is LogStatus {
  return value === "success" || value === "failed" || value === "pending";
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string; status?: string }>;
}) {
  const [t, filters] = await Promise.all([getT(), searchParams]);
  const status = isStatus(filters.status) ? filters.status : undefined;

  const [projects, logs] = await Promise.all([
    fetchProjectOptions(),
    fetchLogs({ limit: PAGE_SIZE, projectId: filters.projectId, status }),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t.activity}</h1>
        <p className="text-sm text-muted">{t.brand}</p>
      </header>

      <Panel title={t.filters}>
        <ActivityFilters projects={projects} />
      </Panel>

      <Panel>
        <ActivityStream
          // Remount on filter change so the SSE subscription and the loaded
          // page both reset instead of mixing results from two filters.
          key={`${filters.projectId ?? ""}:${status ?? ""}`}
          initialLogs={logs}
          projectNames={projectNameMap(projects)}
          projectId={filters.projectId}
          status={status}
          limit={PAGE_SIZE}
          paginated
          initialHasMore={logs.length === PAGE_SIZE}
        />
      </Panel>
    </div>
  );
}
