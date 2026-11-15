import { AutomationsManager, type AutomationView, type RunView } from "@/components/automations-manager";
import { autoT } from "@/lib/automation/i18n";
import { ALLOWED_TOOLS } from "@/lib/automation/runtime";
import { EVENT_TYPES } from "@/lib/automation/definition";
import { listAutomations, listRuns } from "@/lib/automation/store";
import { getLocale } from "@/lib/locale-server";
import { fetchDepartments } from "@/lib/queries";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AutomationsPage({ searchParams }: { searchParams?: Promise<{ id?: string }> }) {
  const [locale, session, params] = await Promise.all([getLocale(), requireSession(), searchParams]);
  const t = autoT(locale);
  const owner = session.user.id;

  let loadError: string | null = null;
  const loaded = await Promise.all([listAutomations(owner), listRuns(owner, undefined, 40), fetchDepartments()]).catch(() => null);
  if (!loaded) {
    loadError = locale === "ar" ? "تعذّر تحميل الأتمتة. تأكد من تطبيق الترحيل 0031 (npm run migrate:apply)." : "Could not load automations. Make sure migration 0031 is applied (npm run migrate:apply).";
  }
  const [automations, runs, departments] = loaded ?? [[], [], []];

  const names = new Map(automations.map((a) => [a.id, a.name]));
  const aViews: AutomationView[] = automations.map((a) => ({
    id: a.id, name: a.name, description: a.description, enabled: a.enabled, version: a.version,
    trigger: a.trigger_type === "schedule" ? { type: "schedule", cron: a.schedule_cron ?? "", timezone: a.timezone } : a.trigger_type === "event" ? { type: "event", event: a.event_type ?? "" } : { type: "manual" },
    steps: a.steps, maxAttempts: a.max_attempts, backoffSeconds: a.backoff_seconds, notifyOnFailure: a.notify_on_failure,
    nextRunAt: a.next_run_at, lastRunAt: a.last_run_at,
  }));
  const rViews: RunView[] = runs.map((r) => ({
    id: r.id, automationId: r.automation_id, automationName: names.get(r.automation_id) ?? "—", status: r.status, trigger: r.trigger,
    createdAt: r.created_at, finishedAt: r.finished_at, error: r.error, results: r.step_results ?? [],
  }));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t.title}</h1>
        <p className="text-sm text-muted">{t.subtitle}</p>
      </header>
      {loadError ? <p role="alert" className="text-sm text-err">{loadError}</p> : (
        <AutomationsManager
          t={t} locale={locale} canEdit={session.role === "admin"} automations={aViews} runs={rViews}
          tools={ALLOWED_TOOLS.sort()} departments={departments.map((d) => ({ key: d.key, name: locale === "ar" ? d.name_ar : d.name_en }))}
          events={[...EVENT_TYPES]} editingId={params?.id ?? null}
        />
      )}
    </div>
  );
}
