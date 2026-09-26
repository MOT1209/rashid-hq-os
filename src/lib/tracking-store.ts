import "server-only";

import { getServiceSupabase } from "@/lib/supabase/server";
import type {
  CellKind,
  CellMap,
  CellValue,
  OverallGrade,
  TrackedMember,
  WeekNum,
} from "@/lib/tracking";
import { CELL_KINDS, GRADES, QUIZ_COUNT, WEEKS } from "@/lib/tracking";

export type TrackingMonth = {
  id: string;
  school_name: string;
  class_name: string;
  subject: string;
  month_key: string;
};

export type TrackingData = {
  /** False when migration 0020 has not been applied yet. */
  ready: boolean;
  months: TrackingMonth[];
  activeMonth: TrackingMonth | null;
  members: TrackedMember[];
};

function isMissingTable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "42P01"
  );
}

function toGrade(value: unknown): OverallGrade {
  return GRADES.includes(value as OverallGrade) ? (value as OverallGrade) : "ممتاز";
}

function toCellValue(value: unknown): CellValue {
  return value === 1 || value === 2 ? value : 0;
}

/**
 * Loads one month with all members, cells and scores, reassembled into the
 * TrackedMember shape the pure stats functions in tracking.ts consume.
 * Returns { ready: false } instead of throwing when the 0020 tables do not
 * exist yet, so the page can show a setup hint rather than a 500.
 */
export async function fetchTrackingData(monthKey?: string): Promise<TrackingData> {
  const empty: TrackingData = { ready: false, months: [], activeMonth: null, members: [] };
  try {
    const db = getServiceSupabase();

    const { data: months, error: monthsError } = await db
      .from("tracking_months")
      .select("id, school_name, class_name, subject, month_key")
      .order("created_at", { ascending: false })
      .limit(24);
    if (monthsError) {
      if (isMissingTable(monthsError)) return empty;
      throw monthsError;
    }

    const rows = (months ?? []) as TrackingMonth[];
    if (rows.length === 0) return { ready: true, months: [], activeMonth: null, members: [] };

    const activeMonth = rows.find((m) => m.month_key === monthKey) ?? rows[0];

    const { data: members, error: membersError } = await db
      .from("tracking_members")
      .select("id, name, role, overall_grade, notes, sort_order")
      .eq("month_id", activeMonth.id)
      .order("sort_order");
    if (membersError) throw membersError;

    const memberRows = (members ?? []) as {
      id: string;
      name: string;
      role: string;
      overall_grade: string;
      notes: string;
    }[];
    const ids = memberRows.map((m) => m.id);
    const cells: CellMap = {};
    const quizzesByMember = new Map<string, number[]>();
    if (ids.length > 0) {
      const [{ data: cellRows }, { data: scoreRows }] = await Promise.all([
        db.from("tracking_cells").select("member_id, week, kind, value").in("member_id", ids),
        db.from("tracking_scores").select("member_id, idx, score").in("member_id", ids),
      ]);
      for (const c of (cellRows ?? []) as { member_id: string; week: number; kind: string; value: number }[]) {
        cells[`${c.member_id}:${c.week}:${c.kind}`] = toCellValue(c.value);
      }
      for (const m of memberRows) {
        quizzesByMember.set(m.id, Array.from({ length: QUIZ_COUNT }, () => 0));
      }
      for (const s of (scoreRows ?? []) as { member_id: string; idx: number; score: number }[]) {
        const arr = quizzesByMember.get(s.member_id);
        if (arr && s.idx >= 1 && s.idx <= QUIZ_COUNT) arr[s.idx - 1] = Number(s.score) || 0;
      }
    }

    const tracked: TrackedMember[] = memberRows.map((m) => {
      const memberCells: CellMap = {};
      for (const week of WEEKS) {
        for (const kind of CELL_KINDS) {
          const v = cells[`${m.id}:${week}:${kind}`] ?? 0;
          if (v !== 0) memberCells[`${week}:${kind}`] = v as CellValue;
        }
      }
      return {
        id: m.id,
        name: m.name,
        role: m.role,
        cells: memberCells,
        quizzes: quizzesByMember.get(m.id) ?? Array.from({ length: QUIZ_COUNT }, () => 0),
        overallGrade: toGrade(m.overall_grade),
        notes: m.notes,
      };
    });

    return { ready: true, months: rows, activeMonth, members: tracked };
  } catch (error) {
    if (isMissingTable(error)) return empty;
    throw error;
  }
}

/** Narrow row types used by the actions below (kept here, next to the table). */
export type CellRow = { week: WeekNum; kind: CellKind; value: CellValue };
