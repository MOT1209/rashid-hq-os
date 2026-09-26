/**
 * Monthly follow-up register — pure domain logic ported from
 * monthly_tracking_register.html so it is unit-testable without a database,
 * the same split as insights.ts / standing-tasks.ts / health-alert.ts.
 *
 * Shape mirrors the HTML exactly: 4 weeks x 4 kinds (c=توثيق, t=مهام,
 * b=تواصل, h=تسليم) with values 0 (empty) / 1 (done 😊) / 2 (missed ☹️),
 * plus 5 quiz scores out of 10.
 */

export type CellValue = 0 | 1 | 2;
export type CellKind = "c" | "t" | "b" | "h";
export type WeekNum = 1 | 2 | 3 | 4;

export const CELL_KINDS: CellKind[] = ["c", "t", "b", "h"];
export const WEEKS: WeekNum[] = [1, 2, 3, 4];
export const QUIZ_COUNT = 5;
export const CELLS_PER_MEMBER = 16;

export type OverallGrade = "ممتاز" | "جيد جداً" | "جيد" | "مقبول" | "بحاجة لتحسين";

export const GRADES: OverallGrade[] = [
  "ممتاز",
  "جيد جداً",
  "جيد",
  "مقبول",
  "بحاجة لتحسين",
];

/** Sparse cell map: key `${week}:${kind}` -> value. Absent = 0. */
export type CellMap = Partial<Record<string, CellValue>>;

export type TrackedMember = {
  id: string;
  name: string;
  role?: string;
  cells: CellMap;
  quizzes: number[];
  overallGrade?: OverallGrade;
  notes?: string;
};

export type MemberStats = {
  done: number;
  missed: number;
  completionPct: number;
  avgQuiz: number;
};

export type RegisterSummary = {
  total: number;
  completionPct: number;
  avgQuiz: number;
  topPerformer: string;
};

export function cellKey(week: WeekNum, kind: CellKind): string {
  return `${week}:${kind}`;
}

export function getCell(member: TrackedMember, week: WeekNum, kind: CellKind): CellValue {
  return member.cells[cellKey(week, kind)] ?? 0;
}

/** Cycle 0 -> 1 -> 2 -> 0, exactly like toggleCellState in the HTML. */
export function nextCellValue(current: CellValue): CellValue {
  return ((current + 1) % 3) as CellValue;
}

export function clampScore(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 10) return 10;
  return value;
}

export function memberStats(member: TrackedMember): MemberStats {
  let done = 0;
  let missed = 0;
  for (const week of WEEKS) {
    for (const kind of CELL_KINDS) {
      const v = getCell(member, week, kind);
      if (v === 1) done += 1;
      else if (v === 2) missed += 1;
    }
  }
  const quizSum = member.quizzes.reduce((acc, v) => acc + (Number.isFinite(v) ? v : 0), 0);
  const quizCount = member.quizzes.length || 1;
  return {
    done,
    missed,
    completionPct: Math.round((done / CELLS_PER_MEMBER) * 100),
    avgQuiz: Math.round((quizSum / quizCount) * 10) / 10,
  };
}

/**
 * Dashboard KPIs. Top performer = highest (done*2 + quizSum), same formula
 * the HTML used in renderAnalytics.
 */
export function summariseRegister(members: TrackedMember[]): RegisterSummary {
  const total = members.length;
  if (total === 0) return { total: 0, completionPct: 0, avgQuiz: 0, topPerformer: "" };

  let doneTotal = 0;
  let quizSum = 0;
  let quizCount = 0;
  let best = -1;
  let top = "";

  for (const m of members) {
    const s = memberStats(m);
    doneTotal += s.done;
    for (const q of m.quizzes) {
      quizSum += Number.isFinite(q) ? q : 0;
      quizCount += 1;
    }
    const rating = s.done * 2 + m.quizzes.reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0);
    if (rating > best) {
      best = rating;
      top = m.name;
    }
  }

  return {
    total,
    completionPct: Math.round((doneTotal / (total * CELLS_PER_MEMBER)) * 100),
    avgQuiz: quizCount > 0 ? Math.round((quizSum / quizCount) * 10) / 10 : 0,
    topPerformer: top,
  };
}

/**
 * Parse the import textarea from the HTML ("Name - role" per line).
 * Splits on newline, drops empties, splits role on the first - / – / : / /.
 */
export function parseImportNames(raw: string): { name: string; role: string }[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const parts = line.split(/\s*[-–:/|]\s*/);
      if (parts.length === 1) return { name: line, role: "" };
      const [first, ...rest] = parts;
      return { name: first.trim() || line, role: rest.join(" ").trim() };
    })
    .filter((entry) => entry.name.length > 0);
}

export function cellLabel(value: CellValue): string {
  if (value === 1) return "تم";
  if (value === 2) return "لم يتم";
  return "-";
}
