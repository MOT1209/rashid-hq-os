/**
 * Calendar date math. Day identity is a "yyyy-mm-dd" key in the OWNER'S
 * timezone; grid arithmetic uses UTC dates purely as a calendar abacus so it
 * is independent of the machine's timezone and of DST.
 */

export type DateKey = string;

export function localDateKey(d: Date | string, timeZone: string): DateKey {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));
  return parts; // en-CA => yyyy-mm-dd
}

const toUtc = (k: DateKey) => {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const key = (d: Date): DateKey => d.toISOString().slice(0, 10);

export function addDays(k: DateKey, n: number): DateKey {
  const d = toUtc(k);
  d.setUTCDate(d.getUTCDate() + n);
  return key(d);
}

export function addMonths(k: DateKey, n: number): DateKey {
  const d = toUtc(k);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  return key(d);
}

/** First day of the week containing `k`. weekStart: 0=Sunday … 6=Saturday. */
export function startOfWeek(k: DateKey, weekStart: number): DateKey {
  const dow = toUtc(k).getUTCDay();
  return addDays(k, -((dow - weekStart + 7) % 7));
}

export function weekDays(k: DateKey, weekStart: number): DateKey[] {
  const s = startOfWeek(k, weekStart);
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
}

/** Weeks (arrays of 7 keys) covering the month of `k`, padded with neighbouring days. */
export function monthGrid(k: DateKey, weekStart: number): DateKey[][] {
  const first = `${k.slice(0, 7)}-01`;
  const last = addDays(addMonths(first, 1), -1);
  const weeks: DateKey[][] = [];
  for (let s = startOfWeek(first, weekStart); s <= last; s = addDays(s, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(s, i)));
  }
  return weeks;
}

export function groupByDay<T extends { run_at: string }>(items: T[], timeZone: string): Map<DateKey, T[]> {
  const out = new Map<DateKey, T[]>();
  for (const it of [...items].sort((a, b) => a.run_at.localeCompare(b.run_at))) {
    const k = localDateKey(it.run_at, timeZone);
    out.set(k, [...(out.get(k) ?? []), it]);
  }
  return out;
}

/** "yyyy-mm-ddThh:mm" wall-clock string in `timeZone` for a UTC instant (for datetime-local inputs). */
export function toLocalInput(iso: string, timeZone: string): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}
