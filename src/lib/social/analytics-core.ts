/**
 * Pure analytics rules (no I/O).
 *
 * Honesty rules:
 *  - a metric is present only if the platform returned it;
 *  - anything we cannot read is listed in `unsupported`, never zero-filled;
 *  - platforms are never summed or ranked against each other (their "views",
 *    "reach" and "likes" are not defined the same way).
 */

export type MetricName = "views" | "likes" | "comments" | "shares" | "reach" | "watch_time" | "subscribers";

export type Collected = { metrics: Partial<Record<MetricName, number>>; unsupported: string[] };

const DAY = 24 * 3600_000;

/**
 * Quota-friendly cadence: every 6h for the first 2 days, then daily until day
 * 7, then every 3 days up to day 30; nothing after 30 days.
 */
export function shouldCollect(lastSnapshotAt: Date | null, publishedAt: Date, now: Date): boolean {
  const age = now.getTime() - publishedAt.getTime();
  if (age > 30 * DAY) return false;
  if (!lastSnapshotAt) return true;
  const since = now.getTime() - lastSnapshotAt.getTime();
  if (age <= 2 * DAY) return since >= 6 * 3600_000;
  if (age <= 7 * DAY) return since >= DAY;
  return since >= 3 * DAY;
}

/** Positive integer or undefined; rejects NaN/negatives/non-numerics from API bodies. */
export function toCount(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
}

/** Engagement rate = (likes+comments+shares)/views, only when views is a real, non-zero number. */
export function engagementRate(m: Collected["metrics"]): number | null {
  if (!m.views) return null;
  const sum = (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0);
  return sum / m.views;
}

/** Delta of a metric between two snapshots; null if either side lacks it. */
export function delta(prev: Collected["metrics"] | null, next: Collected["metrics"], key: MetricName): number | null {
  const a = prev?.[key];
  const b = next[key];
  return a === undefined || b === undefined ? null : b - a;
}

export function collectYouTube(body: unknown): Collected {
  const stats = ((body as { items?: { statistics?: Record<string, unknown> }[] })?.items?.[0]?.statistics ?? null) as Record<string, unknown> | null;
  if (!stats) return { metrics: {}, unsupported: ["views", "likes", "comments", "shares", "reach", "watch_time"] };
  const metrics: Collected["metrics"] = {};
  const views = toCount(stats.viewCount);
  const likes = toCount(stats.likeCount);
  const comments = toCount(stats.commentCount);
  if (views !== undefined) metrics.views = views;
  if (likes !== undefined) metrics.likes = likes;
  if (comments !== undefined) metrics.comments = comments;
  const unsupported = ["shares", "reach", "watch_time (needs the YouTube Analytics scope, not requested)"];
  if (likes === undefined) unsupported.push("likes (hidden by the creator)");
  if (comments === undefined) unsupported.push("comments (disabled)");
  return { metrics, unsupported };
}

export function collectFacebook(body: unknown): Collected {
  const b = (body ?? {}) as {
    reactions?: { summary?: { total_count?: unknown } };
    comments?: { summary?: { total_count?: unknown } };
    shares?: { count?: unknown };
  };
  const metrics: Collected["metrics"] = {};
  const likes = toCount(b.reactions?.summary?.total_count);
  const comments = toCount(b.comments?.summary?.total_count);
  if (likes !== undefined) metrics.likes = likes;
  if (comments !== undefined) metrics.comments = comments;
  // Facebook omits `shares` entirely when there are none: absence is not provably zero.
  const shares = toCount(b.shares?.count);
  const unsupported = ["views", "reach (need the read_insights permission, not requested)"];
  if (shares !== undefined) metrics.shares = shares;
  else unsupported.push("shares (not reported)");
  return { metrics, unsupported };
}

export function collectInstagram(body: unknown): Collected {
  const b = (body ?? {}) as { like_count?: unknown; comments_count?: unknown };
  const metrics: Collected["metrics"] = {};
  const likes = toCount(b.like_count);
  const comments = toCount(b.comments_count);
  if (likes !== undefined) metrics.likes = likes;
  if (comments !== undefined) metrics.comments = comments;
  const unsupported = ["views", "reach", "shares (need instagram_manage_insights, not requested)"];
  if (likes === undefined) unsupported.push("likes (hidden)");
  return { metrics, unsupported };
}
