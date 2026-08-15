import { ActivityStream } from "@/components/activity-stream";
import { Panel } from "@/components/ui";
import { getT } from "@/lib/locale-server";
import { fetchLogs, fetchProjects, projectNameMap } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const t = await getT();
  const [projects, logs] = await Promise.all([
    fetchProjects(),
    fetchLogs({ limit: 100 }),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t.activity}</h1>
        <p className="text-sm text-muted">{t.brand}</p>
      </header>

      <Panel>
        <ActivityStream
          initialLogs={logs}
          projectNames={projectNameMap(projects)}
          limit={100}
        />
      </Panel>
    </div>
  );
}
