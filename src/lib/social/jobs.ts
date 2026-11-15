/**
 * Pure publishing-job logic: state machine, retry/backoff, idempotency.
 * No I/O so it is exhaustively unit-testable.
 *
 *   draft ─► queued ─► running ─► succeeded
 *               ▲          │
 *               │          ├─► queued   (retryable failure, backoff)
 *               │          └─► failed   (terminal / attempts exhausted)
 *   queued ─► cancelled
 *   failed ─► queued (manual retry, only for retryable failures)
 *
 * "succeeded" is only ever entered with a platform-confirmed external id.
 */

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  queued: ["running", "cancelled"],
  running: ["succeeded", "failed", "queued"],
  failed: ["queued"],
  succeeded: [],
  cancelled: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransition(from, to)) throw new Error(`Illegal job transition ${from} → ${to}.`);
}

export const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 60_000;
const MAX_DELAY_MS = 6 * 60 * 60_000;

/** Exponential backoff: 1m, 2m, 4m… capped; `retryAfterMs` (rate limit) wins when larger. */
export function backoffMs(attempt: number, retryAfterMs?: number): number {
  const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1));
  return Math.max(exp, retryAfterMs ?? 0);
}

export type FailureKind = "retryable" | "rate_limited" | "terminal" | "auth";

/** What the job should do after a failed attempt. */
export function nextAfterFailure(
  kind: FailureKind,
  attempt: number,
  now: Date,
  retryAfterMs?: number,
): { status: "queued" | "failed"; runAt?: Date } {
  // Auth and terminal errors never auto-retry: re-sending a rejected post or
  // using a revoked token cannot succeed and risks account flags.
  if (kind === "terminal" || kind === "auth") return { status: "failed" };
  if (attempt >= MAX_ATTEMPTS) return { status: "failed" };
  return { status: "queued", runAt: new Date(now.getTime() + backoffMs(attempt, retryAfterMs)) };
}

/** A failed job may be manually retried only if its failure was not terminal. */
export function manualRetryAllowed(status: JobStatus, kind: FailureKind | null): boolean {
  return status === "failed" && kind !== "terminal";
}

/**
 * One job per (variant, account). The DB enforces this with a unique index on
 * the key; the same key is sent to platforms that accept one.
 */
export function idempotencyKey(variantId: string, accountId: string): string {
  return `pub:${variantId}:${accountId}`;
}

/** A running job whose lock is older than this is presumed dead and reclaimable. */
export const LOCK_TIMEOUT_MS = 15 * 60_000;

export function lockExpired(lockedAt: string | Date | null, now: Date): boolean {
  if (!lockedAt) return true;
  return now.getTime() - new Date(lockedAt).getTime() > LOCK_TIMEOUT_MS;
}

/** Scheduling is stored in UTC; reject past/invalid times and unknown timezones. */
export function parseSchedule(
  localIso: string,
  timeZone: string,
  now: Date,
): { ok: true; at: Date } | { ok: false; error: string } {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
  } catch {
    return { ok: false, error: "Unknown timezone." };
  }
  const hasOffset = /([zZ]|[+-]\d{2}:?\d{2})$/.test(localIso);
  let at: Date;
  if (hasOffset) {
    at = new Date(localIso);
  } else {
    // Interpret a wall-clock time (yyyy-mm-ddThh:mm) in `timeZone`.
    const m = localIso.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    if (!m) return { ok: false, error: "Invalid date." };
    const [y, mo, d, h, mi] = m.slice(1).map(Number);
    const guess = Date.UTC(y, mo - 1, d, h, mi);
    // Offset of `timeZone` at that instant, then correct once for DST edges.
    const offsetAt = (ms: number) => {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).formatToParts(new Date(ms));
      const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
      return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - ms;
    };
    let ms = guess - offsetAt(guess);
    ms = guess - offsetAt(ms);
    at = new Date(ms);
  }
  if (Number.isNaN(at.getTime())) return { ok: false, error: "Invalid date." };
  if (at.getTime() <= now.getTime()) return { ok: false, error: "Scheduled time is in the past." };
  return { ok: true, at };
}
