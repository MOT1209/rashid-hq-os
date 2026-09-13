import type { RunKind } from "@/types/database";

/**
 * The aggregation behind /dashboard/insights, kept pure so "what does a month
 * of runs add up to" is unit-testable without a database — the same split as
 * standing-tasks.ts and health-alert.ts.
 *
 * Postgres could group this server-side through an RPC, but a month of runs
 * for a single-owner console is a few hundred rows; that is not worth a
 * migration and a stored function.
 */

export type RunRow = {
  agent_name: string;
  kind: string;
  tokens_in: number | null;
  tokens_out: number | null;
  duration_ms: number;
  status: string;
  created_at: string;
};

export type Bucket = {
  key: string;
  runs: number;
  tokens: number;
};

export type RunInsights = {
  runs: number;
  tokensIn: number;
  tokensOut: number;
  /** Whole percent, matching fetchStats' failureRate. */
  failureRate: number;
  avgDurationMs: number;
  byKind: Bucket[];
  byAgent: Bucket[];
  /** Oldest first, one entry per day in the window even when nothing ran. */
  byDay: Bucket[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Every kind gets a row even at zero, so a silent cron reads as 0 rather than absent. */
const KINDS: RunKind[] = ["console", "delegation", "standing_task"];

function tokensOf(row: RunRow): number {
  return (row.tokens_in ?? 0) + (row.tokens_out ?? 0);
}

function add(into: Map<string, Bucket>, key: string, row: RunRow) {
  const bucket = into.get(key) ?? { key, runs: 0, tokens: 0 };
  bucket.runs += 1;
  bucket.tokens += tokensOf(row);
  into.set(key, bucket);
}

/** The UTC days covered by the window, oldest first. Matches created_at's own slice. */
function windowDays(days: number, now: Date): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    out.push(new Date(now.getTime() - i * DAY_MS).toISOString().slice(0, 10));
  }
  return out;
}

export function summariseRuns(
  rows: RunRow[],
  days: number,
  now: Date = new Date(),
): RunInsights {
  const byKind = new Map<string, Bucket>(
    KINDS.map((kind) => [kind, { key: kind, runs: 0, tokens: 0 }]),
  );
  const byAgent = new Map<string, Bucket>();
  const byDay = new Map<string, Bucket>(
    windowDays(days, now).map((day) => [day, { key: day, runs: 0, tokens: 0 }]),
  );

  let tokensIn = 0;
  let tokensOut = 0;
  let durationTotal = 0;
  let failed = 0;

  for (const row of rows) {
    tokensIn += row.tokens_in ?? 0;
    tokensOut += row.tokens_out ?? 0;
    durationTotal += row.duration_ms;
    if (row.status === "failed") failed += 1;

    add(byKind, row.kind, row);
    add(byAgent, row.agent_name, row);
    // A row older than the window (or from a clock skew) has no bucket to land
    // in; counting it in the totals but not the trend is the honest reading.
    const day = row.created_at.slice(0, 10);
    if (byDay.has(day)) add(byDay, day, row);
  }

  const runs = rows.length;

  return {
    runs,
    tokensIn,
    tokensOut,
    failureRate: runs ? Math.round((failed / runs) * 100) : 0,
    avgDurationMs: runs ? Math.round(durationTotal / runs) : 0,
    byKind: [...byKind.values()],
    byAgent: [...byAgent.values()].sort((a, b) => b.tokens - a.tokens),
    byDay: [...byDay.values()],
  };
}
