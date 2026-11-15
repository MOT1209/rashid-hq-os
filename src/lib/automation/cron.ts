/**
 * 5-field cron (minute hour day-of-month month day-of-week) evaluated in an
 * IANA timezone. Pure and dependency-free.
 *
 * Supported: `*`, lists `1,5`, ranges `1-5`, steps `*\/15` and `1-30/5`,
 * day-of-week 0-7 (0 and 7 = Sunday). Not supported: names (`MON`), `@daily`,
 * `L`/`W`/`#`. Day matching follows Vixie cron: when BOTH day-of-month and
 * day-of-week are restricted, either may match.
 */

export type CronSpec = {
  minutes: number[]; hours: number[]; dom: Set<number>; months: Set<number>; dow: Set<number>;
  domStar: boolean; dowStar: boolean;
};

function field(raw: string, min: number, max: number, label: string): { values: number[]; star: boolean } {
  const out = new Set<number>();
  for (const part of raw.split(",")) {
    const m = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
    if (!m) throw new Error(`Invalid ${label} field "${raw}".`);
    const step = m[2] ? Number(m[2]) : 1;
    if (step < 1) throw new Error(`Invalid step in ${label}.`);
    let lo: number, hi: number;
    if (m[1] === "*") [lo, hi] = [min, max];
    else if (m[1].includes("-")) [lo, hi] = m[1].split("-").map(Number);
    else {
      lo = Number(m[1]);
      hi = m[2] ? max : lo; // "5/10" = from 5 to max step 10
    }
    if (lo < min || hi > max || lo > hi) throw new Error(`${label} must be between ${min} and ${max}.`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return { values: [...out].sort((a, b) => a - b), star: raw === "*" };
}

export function parseCron(expr: string): CronSpec {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("A cron expression has 5 fields: minute hour day-of-month month day-of-week.");
  const [mi, h, d, mo, w] = parts;
  const dow = field(w, 0, 7, "day-of-week");
  return {
    minutes: field(mi, 0, 59, "minute").values,
    hours: field(h, 0, 23, "hour").values,
    dom: new Set(field(d, 1, 31, "day-of-month").values),
    months: new Set(field(mo, 1, 12, "month").values),
    dow: new Set(dow.values.map((v) => v % 7)),
    domStar: d === "*",
    dowStar: dow.star,
  };
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    fmtCache.set(tz, f);
  }
  return f;
}

function localParts(ms: number, tz: string) {
  const p = fmt(tz).formatToParts(new Date(ms));
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return { y: g("year"), mo: g("month"), d: g("day"), h: g("hour"), mi: g("minute"), s: g("second") };
}

export function isValidTimeZone(tz: string): boolean {
  try {
    fmt(tz);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock time in `tz` → UTC ms, or null if that local time does not exist (DST gap). */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): number | null {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off = (ms: number) => {
    const l = localParts(ms, tz);
    return Date.UTC(l.y, l.mo - 1, l.d, l.h, l.mi, l.s) - Math.floor(ms / 1000) * 1000;
  };
  let ms = guess - off(guess);
  ms = guess - off(ms);
  const l = localParts(ms, tz);
  return l.y === y && l.mo === mo && l.d === d && l.h === h && l.mi === mi ? ms : null;
}

const dayAbacus = (y: number, mo: number, d: number, add: number) => {
  const dt = new Date(Date.UTC(y, mo - 1, d + add));
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate(), dow: dt.getUTCDay() };
};

/** The first matching instant strictly after `after`, or null within ~4 years (enough for Feb 29). */
export function nextCronRun(expr: string, after: Date, tz: string): Date | null {
  const spec = parseCron(expr);
  const start = localParts(after.getTime(), tz);
  for (let off = 0; off <= 1500; off++) {
    const day = dayAbacus(start.y, start.mo, start.d, off);
    if (!spec.months.has(day.mo)) continue;
    const domOk = spec.dom.has(day.d);
    const dowOk = spec.dow.has(day.dow);
    const dayOk = spec.domStar || spec.dowStar ? domOk && dowOk : domOk || dowOk;
    if (!dayOk) continue;
    for (const h of spec.hours) {
      for (const mi of spec.minutes) {
        const ms = zonedToUtc(day.y, day.mo, day.d, h, mi, tz);
        if (ms !== null && ms > after.getTime()) return new Date(ms);
      }
    }
  }
  return null;
}

/** Shortest gap between the next few runs, in minutes (for the minimum-interval rule). */
export function minGapMinutes(expr: string, tz: string, from: Date, samples = 6): number | null {
  let prev = nextCronRun(expr, from, tz);
  let min = Infinity;
  for (let i = 0; i < samples && prev; i++) {
    const next = nextCronRun(expr, prev, tz);
    if (!next) break;
    min = Math.min(min, (next.getTime() - prev.getTime()) / 60_000);
    prev = next;
  }
  return Number.isFinite(min) ? min : null;
}
