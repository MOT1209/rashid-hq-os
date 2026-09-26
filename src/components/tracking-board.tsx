"use client";

import { useMemo, useState, useTransition } from "react";
import { EmptyState, Panel, StatCard } from "@/components/ui";
import {
  CELL_KINDS,
  GRADES,
  QUIZ_COUNT,
  WEEKS,
  cellLabel,
  getCell,
  memberStats,
  summariseRegister,
} from "@/lib/tracking";
import type { CellKind, OverallGrade, TrackedMember, WeekNum } from "@/lib/tracking";
import type { Dictionary } from "@/lib/i18n";
import {
  clearMonthAction,
  importMembersAction,
  setGradeAction,
  setScoreAction,
  toggleCellAction,
} from "@/app/dashboard/tracking/actions";

const WEEK_LABEL: Record<WeekNum, string> = {
  1: "الأول",
  2: "الثاني",
  3: "الثالث",
  4: "الرابع",
};

const KIND_LABEL: Record<CellKind, string> = {
  c: "التوثيق",
  t: "المهام",
  b: "التواصل",
  h: "التسليم",
};

function cellClass(value: number): string {
  if (value === 1) return "bg-ok/15 text-ok border-ok/40";
  if (value === 2) return "bg-err/15 text-err border-err/40";
  return "bg-panel-2 text-muted border-transparent hover:border-border";
}

export function TrackingBoard({
  t,
  monthId,
  monthKey,
  initialMembers,
  isAdmin,
}: {
  t: Dictionary;
  monthId: string;
  monthKey: string;
  initialMembers: TrackedMember[];
  isAdmin: boolean;
}) {
  const [members, setMembers] = useState<TrackedMember[]>(initialMembers);
  const [search, setSearch] = useState("");
  const [gradeFilter, setGradeFilter] = useState("ALL");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [reportId, setReportId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(
    () =>
      members.filter((m) => {
        const hit = m.name.toLowerCase().includes(search.trim().toLowerCase());
        const grade = gradeFilter === "ALL" || m.overallGrade === gradeFilter;
        return hit && grade;
      }),
    [members, search, gradeFilter],
  );

  const summary = useMemo(() => summariseRegister(members), [members]);

  const mutate = (fn: () => Promise<unknown>) => {
    startTransition(() => {
      void fn();
    });
  };

  const onToggle = (memberId: string, week: WeekNum, kind: CellKind) => {
    setMembers((prev) =>
      prev.map((m) => {
        if (m.id !== memberId) return m;
        const key = `${week}:${kind}`;
        const next = (((m.cells[key] ?? 0) + 1) % 3) as 0 | 1 | 2;
        const cells = { ...m.cells };
        if (next === 0) delete cells[key];
        else cells[key] = next;
        return { ...m, cells };
      }),
    );
    mutate(() => toggleCellAction(memberId, week, kind));
  };

  const onScore = (memberId: string, idx: number, raw: string) => {
    const value = Math.min(10, Math.max(0, Number(raw) || 0));
    setMembers((prev) =>
      prev.map((m) => {
        if (m.id !== memberId) return m;
        const quizzes = [...m.quizzes];
        quizzes[idx] = value;
        return { ...m, quizzes };
      }),
    );
    mutate(() => setScoreAction(memberId, idx + 1, value));
  };

  const onImport = () => {
    mutate(async () => {
      const res = await importMembersAction(monthId, importText);
      if (!res.error) {
        setImportOpen(false);
        setImportText("");
      }
    });
  };

  const exportCsv = () => {
    const head = ["#", t.name, ...WEEKS.flatMap((w) => CELL_KINDS.map((k) => `أ${w}_${KIND_LABEL[k]}`)), "ت1", "ت2", "ت3", "ت4", "ت5", t.status];
    const lines = filtered.map((m, i) => {
      const cells = WEEKS.flatMap((w) => CELL_KINDS.map((k) => cellLabel(getCell(m, w, k))));
      return [String(i + 1), m.name, ...cells, ...m.quizzes.map((q) => String(q)), m.overallGrade ?? ""].join(",");
    });
    const blob = new Blob(["﻿" + [head.join(","), ...lines].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tracking_${monthKey}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const reportMember = members.find((m) => m.id === reportId) ?? null;

  return (
    <div className="space-y-6">
      <style>{`@media print { body * { visibility: hidden; } #tracking-print, #tracking-print * { visibility: visible; } #tracking-print { position: absolute; inset: 0; padding: 12mm; background: #fff; color: #000; } }`}</style>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t.trackingMembers} value={summary.total} />
        <StatCard label={t.callsToday} value={`${summary.completionPct}%`} />
        <StatCard label={t.totalTokens} value={`${summary.avgQuiz} / 10`} />
        <StatCard label={t.agent} value={summary.topPerformer || "—"} />
      </div>

      <Panel
        title={`${t.trackingMonth}: ${monthKey}`}
        action={
          isAdmin ? (
            <div className="flex flex-wrap gap-2 text-xs">
              <button type="button" onClick={() => setImportOpen((v) => !v)} className="rounded-xl border border-border px-3 py-1.5 hover:border-accent/50">
                {t.trackingImport}
              </button>
              <button type="button" onClick={exportCsv} className="rounded-xl border border-border px-3 py-1.5 hover:border-accent/50">
                {t.exportCsv}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (window.confirm(t.trackingClear)) mutate(() => clearMonthAction(monthId));
                }}
                className="rounded-xl border border-err/40 px-3 py-1.5 text-err"
              >
                {t.trackingClear}
              </button>
            </div>
          ) : undefined
        }
      >
        {!isAdmin && <p className="mb-3 text-xs text-warn">{t.readOnlyNotice}</p>}

        {importOpen && isAdmin && (
          <div className="mb-4 space-y-2">
            <p className="text-xs text-muted">{t.trackingImportHint}</p>
            <textarea
              rows={5}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              className="w-full rounded-xl border border-border bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <button
              type="button"
              disabled={pending}
              onClick={onImport}
              className="rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-black disabled:opacity-50"
            >
              {t.trackingImportAction}
            </button>
          </div>
        )}

        <div className="mb-3 flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.trackingSearch}
            className="min-w-52 flex-1 rounded-xl border border-border bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <select
            value={gradeFilter}
            onChange={(e) => setGradeFilter(e.target.value)}
            className="rounded-xl border border-border bg-panel-2 px-3 py-2 text-xs outline-none"
          >
            <option value="ALL">{t.trackingAllGrades}</option>
            {GRADES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>

        {filtered.length === 0 ? (
          <EmptyState>{t.trackingNoMembers}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-300 text-center text-xs">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th scope="col" className="py-2 text-start">#</th>
                  <th scope="col" className="py-2 text-start">{t.name}</th>
                  {WEEKS.map((w) => (
                    <th key={w} colSpan={4} scope="col" className="border-s border-border px-1 py-2">
                      الأسبوع {WEEK_LABEL[w]}
                    </th>
                  ))}
                  <th colSpan={QUIZ_COUNT} scope="col" className="border-s border-border px-1 py-2">
                    / 10
                  </th>
                  <th scope="col" className="border-s border-border px-1 py-2">{t.actions}</th>
                </tr>
                <tr className="border-b border-border text-[11px] text-muted">
                  <th />
                  <th />
                  {WEEKS.flatMap((w) =>
                    CELL_KINDS.map((k) => (
                      <th key={`${w}${k}`} scope="col" className="px-1 py-1 font-normal" title={KIND_LABEL[k]}>
                        {KIND_LABEL[k]}
                      </th>
                    )),
                  )}
                  {Array.from({ length: QUIZ_COUNT }, (_, i) => (
                    <th key={i} scope="col" className="px-1 py-1 font-normal">ت{i + 1}</th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((m, i) => {
                  const s = memberStats(m);
                  return (
                    <tr key={m.id} className="hover:bg-panel-2/60">
                      <td className="py-2 font-semibold">{i + 1}</td>
                      <td className="max-w-44 truncate py-2 text-start font-semibold" title={m.role ? `${m.name} — ${m.role}` : m.name}>
                        {m.name}
                      </td>
                      {WEEKS.flatMap((w) =>
                        CELL_KINDS.map((k) => {
                          const v = getCell(m, w, k);
                          return (
                            <td key={`${w}${k}`} className="px-0.5 py-1">
                              <button
                                type="button"
                                disabled={!isAdmin || pending}
                                onClick={() => onToggle(m.id, w, k)}
                                aria-label={`${m.name} ${WEEK_LABEL[w]} ${KIND_LABEL[k]}: ${cellLabel(v)}`}
                                className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border text-sm transition active:scale-90 disabled:opacity-60 ${cellClass(v)}`}
                              >
                                {v === 1 ? "😊" : v === 2 ? "☹️" : "-"}
                              </button>
                            </td>
                          );
                        }),
                      )}
                      {m.quizzes.map((q, qi) => (
                        <td key={qi} className="px-0.5 py-1">
                          <input
                            type="number"
                            min={0}
                            max={10}
                            step={0.5}
                            defaultValue={q}
                            key={`${m.id}-q${qi}-${q}`}
                            disabled={!isAdmin}
                            onBlur={(e) => onScore(m.id, qi, e.target.value)}
                            className="h-7 w-11 rounded-lg border border-border bg-panel-2 text-center text-xs font-bold outline-none focus:border-accent disabled:opacity-60"
                          />
                        </td>
                      ))}
                      <td className="px-1 py-2">
                        <button
                          type="button"
                          onClick={() => setReportId(m.id)}
                          className="rounded-lg bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent"
                        >
                          {t.trackingReport} · {s.completionPct}%
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {reportMember && (
        <ReportCard t={t} member={reportMember} isAdmin={isAdmin} onClose={() => setReportId(null)} />
      )}

      <div id="tracking-print" className="hidden">
        {members.map((m) => {
          const s = memberStats(m);
          return (
            <div key={m.id} style={{ breakAfter: "page" }}>
              <h2>{m.name}</h2>
              <p>
                {t.trackingMonth}: {monthKey} · {s.completionPct}% · {s.avgQuiz} / 10 · {m.overallGrade}
              </p>
              <p>{m.notes}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReportCard({
  t,
  member,
  isAdmin,
  onClose,
}: {
  t: Dictionary;
  member: TrackedMember;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const [grade, setGrade] = useState(member.overallGrade ?? "ممتاز");
  const [notes, setNotes] = useState(member.notes ?? "");
  const [pending, startTransition] = useTransition();
  const s = memberStats(member);

  return (
    <Panel
      title={`${t.trackingReport}: ${member.name}`}
      action={
        <button type="button" onClick={onClose} className="text-xs text-muted">
          {t.cancel}
        </button>
      }
    >
      <div className="grid gap-3 text-sm sm:grid-cols-3">
        <p>😊 {s.done} / 16</p>
        <p>☹️ {s.missed} / 16</p>
        <p>{s.completionPct}% · {s.avgQuiz} / 10</p>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-xs">
          {t.status}
          <select
            value={grade}
            disabled={!isAdmin}
            onChange={(e) =>
              setGrade(GRADES.includes(e.target.value as OverallGrade) ? (e.target.value as OverallGrade) : "ممتاز")
            }
            className="mt-1 w-full rounded-xl border border-border bg-panel-2 px-3 py-2 text-sm outline-none disabled:opacity-60"
          >
            {GRADES.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs sm:col-span-2">
          {t.description}
          <textarea
            rows={3}
            value={notes}
            disabled={!isAdmin}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1 w-full rounded-xl border border-border bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60"
          />
        </label>
      </div>
      <div className="mt-3 flex gap-2">
        {isAdmin && (
          <button
            type="button"
            disabled={pending}
            onClick={() => startTransition(() => void setGradeAction(member.id, grade, notes))}
            className="rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-black disabled:opacity-50"
          >
            {t.save}
          </button>
        )}
        <button type="button" onClick={() => window.print()} className="rounded-xl border border-border px-4 py-2 text-xs">
          🖨️ A4
        </button>
      </div>
    </Panel>
  );
}
