import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectBoard, ProjectMetaPanel, type TaskView } from "@/components/project-board";
import { Panel } from "@/components/ui";
import { getLocale } from "@/lib/locale-server";
import { requireSession } from "@/lib/session";
import { getServiceSupabase } from "@/lib/supabase/server";
import { boardT } from "@/lib/tasks-i18n";
import { listTasks } from "@/lib/tasks-store";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One project: task board, progress, documentation, tools and activity.
 * Readable by any signed-in role; every change is a server action behind
 * requireAdmin that re-checks ownership.
 */
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, locale, session] = await Promise.all([params, getLocale(), requireSession()]);
  if (!UUID.test(id)) notFound();
  const t = boardT(locale);
  const supabase = getServiceSupabase();

  const { data: project } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
  if (!project) notFound();

  const [tasks, tools, logs] = await Promise.all([
    project.owner_id ? listTasks(project.owner_id, id) : Promise.resolve([]),
    supabase.from("project_tools").select("id, tool_name, enabled, permission").eq("project_id", id).order("tool_name"),
    supabase.from("agent_logs").select("id, agent_name, tool_name, status, created_at").eq("project_id", id).order("created_at", { ascending: false }).limit(20),
  ]);

  const taskViews: TaskView[] = tasks.map((x) => ({ id: x.id, title: x.title, description: x.description, status: x.status, priority: x.priority, dueDate: x.due_date, assignee: x.assignee, position: x.position, createdAt: x.created_at }));
  const when = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  const canEdit = session.role === "admin" && project.owner_id === session.user.id;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link href="/dashboard/projects" className="text-xs text-accent">← {t.back}</Link>
        <h1 className="text-2xl font-semibold">
          {project.name}
          {project.archived_at && <span className="ms-3 rounded-full bg-panel-2 px-2 py-0.5 text-xs text-muted">{t.archived}</span>}
        </h1>
        <p className="text-sm text-muted">
          {t.priority}: {t.pri[project.priority] ?? project.priority} · {t.status}: {project.status}
          {project.category ? ` · ${t.category}: ${project.category}` : ""}
        </p>
        {project.mcp_endpoint && <p className="break-all text-xs text-muted" dir="ltr">{project.mcp_endpoint}</p>}
      </header>

      <ProjectBoard t={t} projectId={id} tasks={taskViews} canEdit={canEdit} locale={locale} />

      <ProjectMetaPanel t={t} projectId={id} canEdit={canEdit} archived={Boolean(project.archived_at)} meta={{ priority: project.priority, description: project.description, documentation: project.documentation }} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t.tools} action={<Link href="/dashboard/mcp" className="text-xs text-accent">{t.manageTools}</Link>}>
          {(tools.data ?? []).length === 0 ? <p className="text-xs text-muted">{t.noTools}</p> : (
            <ul className="space-y-1 text-sm">
              {(tools.data ?? []).map((x: { id: string; tool_name: string; enabled: boolean; permission: string }) => (
                <li key={x.id} className="flex justify-between gap-2"><span dir="ltr">{x.tool_name}</span><span className="text-xs text-muted">{x.permission} · {x.enabled ? t.enabledLabel : t.disabledLabel}</span></li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title={t.activity}>
          {(logs.data ?? []).length === 0 ? <p className="text-xs text-muted">{t.noActivity}</p> : (
            <ul className="space-y-1 text-xs">
              {(logs.data ?? []).map((l: { id: string; agent_name: string | null; tool_name: string | null; status: string; created_at: string }) => (
                <li key={l.id}><span className="text-muted">{when(l.created_at)}</span> · {l.agent_name ?? "—"} · <span dir="ltr">{l.tool_name ?? "—"}</span> · {l.status}</li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
