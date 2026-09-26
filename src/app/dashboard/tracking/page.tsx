import Link from "next/link";
import { EmptyState, Panel } from "@/components/ui";
import { TrackingBoard } from "@/components/tracking-board";
import { TrackingTimer } from "@/components/tracking-timer";
import { TrackingWheel } from "@/components/tracking-wheel";
import { getLocale, getT } from "@/lib/locale-server";
import { requireSession } from "@/lib/session";
import { fetchTrackingData } from "@/lib/tracking-store";
import { createMonthAction } from "@/app/dashboard/tracking/actions";

export const dynamic = "force-dynamic";

/**
 * Monthly follow-up register — the HTML single-file tracker rebuilt as a
 * dashboard page: one register table per month, persisted in Supabase
 * (migration 0020) instead of a browser's localStorage, plus the same wheel
 * and timer as side tools.
 */
export default async function TrackingPage({
  searchParams,
}: {
  searchParams?: Promise<{ month?: string }>;
}) {
  const [t, locale, session] = await Promise.all([getT(), getLocale(), requireSession()]);
  const params = (await searchParams) ?? {};
  const data = await fetchTrackingData(params.month);
  const isAdmin = session.role === "admin";

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t.tracking}</h1>
          <p className="text-sm text-muted">{t.trackingHint}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data.months.length > 1 && (
            <nav aria-label={t.trackingMonth} className="flex flex-wrap gap-2 text-xs">
              {data.months.map((m) => (
                <Link
                  key={m.id}
                  href={`/dashboard/tracking?month=${encodeURIComponent(m.month_key)}`}
                  aria-current={data.activeMonth?.id === m.id ? "page" : undefined}
                  className={`rounded-xl border px-3 py-1.5 ${
                    data.activeMonth?.id === m.id
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-border text-muted hover:border-accent/50"
                  }`}
                >
                  {m.month_key}
                </Link>
              ))}
            </nav>
          )}
          {isAdmin && data.ready && (
            <form action={createMonthAction} className="flex items-center gap-2 text-xs">
              <input
                type="month"
                name="month_key"
                required
                aria-label={t.trackingNewMonth}
                className="rounded-xl border border-border bg-panel-2 px-2 py-1.5 text-xs outline-none focus:border-accent"
              />
              <button
                type="submit"
                className="rounded-xl border border-border px-3 py-1.5 text-muted hover:border-accent/50 hover:text-text"
              >
                + {t.trackingNewMonth}
              </button>
            </form>
          )}
        </div>
      </header>

      {!data.ready ? (
        <Panel title={t.tracking}>
          <EmptyState>{t.trackingSetupHint}</EmptyState>
        </Panel>
      ) : !data.activeMonth ? (
        <Panel title={t.tracking}>
          <form action={createMonthAction} className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs">
              {t.trackingMonth}
              <input
                type="month"
                name="month_key"
                required
                disabled={!isAdmin}
                className="mt-1 w-full rounded-xl border border-border bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60"
              />
            </label>
            <label className="block text-xs">
              {t.trackingSchool}
              <input
                name="school_name"
                disabled={!isAdmin}
                className="mt-1 w-full rounded-xl border border-border bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60"
              />
            </label>
            <label className="block text-xs">
              {t.trackingClass}
              <input
                name="class_name"
                disabled={!isAdmin}
                className="mt-1 w-full rounded-xl border border-border bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60"
              />
            </label>
            <label className="block text-xs">
              {t.trackingSubject}
              <input
                name="subject"
                disabled={!isAdmin}
                className="mt-1 w-full rounded-xl border border-border bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60"
              />
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={!isAdmin}
                className="rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-black disabled:opacity-50"
              >
                {t.trackingNewMonth}
              </button>
            </div>
          </form>
          {!isAdmin && <p className="mt-2 text-xs text-warn">{t.readOnlyNotice}</p>}
        </Panel>
      ) : (
        <>
          {(data.activeMonth.school_name || data.activeMonth.class_name || data.activeMonth.subject) && (
            <p className="text-sm text-muted" dir={locale === "ar" ? "rtl" : "ltr"}>
              {[data.activeMonth.school_name, data.activeMonth.class_name, data.activeMonth.subject]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          <TrackingBoard
            t={t}
            monthId={data.activeMonth.id}
            monthKey={data.activeMonth.month_key}
            initialMembers={data.members}
            isAdmin={isAdmin}
          />
          <div className="grid gap-6 lg:grid-cols-2">
            <TrackingWheel t={t} names={data.members.map((m) => m.name)} />
            <TrackingTimer t={t} />
          </div>
        </>
      )}
    </div>
  );
}
