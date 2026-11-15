import "server-only";

import { captureError } from "@/lib/errors";
import { getFreshAccessToken } from "@/lib/integrations/connections";
import { GRAPH_VERSION } from "@/lib/integrations/providers/meta";
import { getPageAccess } from "@/lib/social/adapters/meta";
import { collectFacebook, collectInstagram, collectYouTube, shouldCollect, type Collected } from "@/lib/social/analytics-core";
import { db, type AccountRow, type JobRow } from "@/lib/social/store";

/**
 * Collects metrics for PUBLISHED jobs from the official APIs and stores
 * snapshots. A failure is stored as an error snapshot; nothing is ever
 * estimated. Mocked-HTTP tested only (see tests/social-analytics.test.ts).
 */

const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

export type CollectOutcome = { ok: true; data: Collected } | { ok: false; error: string };

export async function collectForJob(
  job: Pick<JobRow, "platform" | "external_id" | "owner_id">,
  account: Pick<AccountRow, "connection_provider" | "external_id" | "metadata">,
  f: typeof fetch = fetch,
  tokenFor: (owner: string, provider: string) => Promise<string> = getFreshAccessToken,
): Promise<CollectOutcome> {
  if (!job.external_id) return { ok: false, error: "No platform id." };
  try {
    const token = await tokenFor(job.owner_id, account.connection_provider);
    if (job.platform === "youtube") {
      const r = await f(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(job.external_id)}`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20_000),
      });
      if (!r.ok) return { ok: false, error: `YouTube returned ${r.status}.` };
      return { ok: true, data: collectYouTube(await r.json()) };
    }
    if (job.platform === "facebook" || job.platform === "instagram") {
      const pageId = job.platform === "facebook" ? account.external_id : String((account.metadata as Record<string, unknown>)?.page_id ?? "");
      const access = await getPageAccess(token, pageId, f);
      if (!access.ok) return { ok: false, error: access.failure.ok ? "Page unavailable." : access.failure.message };
      const pt = encodeURIComponent(access.page.access_token);
      const url =
        job.platform === "facebook"
          ? `${GRAPH}/${job.external_id}?fields=shares,comments.summary(true).limit(0),reactions.summary(true).limit(0)&access_token=${pt}`
          : `${GRAPH}/${job.external_id}?fields=like_count,comments_count&access_token=${pt}`;
      const r = await f(url, { signal: AbortSignal.timeout(20_000) });
      if (!r.ok) return { ok: false, error: `${job.platform} returned ${r.status}.` };
      const body = await r.json();
      return { ok: true, data: job.platform === "facebook" ? collectFacebook(body) : collectInstagram(body) };
    }
    return { ok: false, error: `${job.platform} analytics are not supported.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "collection failed" };
  }
}

/** Collects for due jobs (bounded per run to respect platform quotas). `ownerId` scopes manual refreshes. */
export async function collectDue(opts: { limit?: number; ownerId?: string; force?: boolean } = {}) {
  const supabase = db();
  let q = supabase
    .from("social_publish_jobs")
    .select("*")
    .eq("status", "succeeded")
    .not("external_id", "is", null)
    .gte("completed_at", new Date(Date.now() - 30 * 24 * 3600_000).toISOString())
    .order("completed_at", { ascending: false })
    .limit(100);
  if (opts.ownerId) q = q.eq("owner_id", opts.ownerId);
  const { data: jobs, error } = await q;
  if (error) throw new Error("Could not load published jobs.");

  let done = 0;
  let failed = 0;
  const now = new Date();
  for (const job of (jobs ?? []) as JobRow[]) {
    if (done + failed >= (opts.limit ?? 10)) break;
    const { data: last } = await supabase
      .from("social_analytics_snapshots")
      .select("retrieved_at")
      .eq("job_id", job.id)
      .order("retrieved_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!opts.force && !shouldCollect(last ? new Date(last.retrieved_at) : null, new Date(job.completed_at ?? job.created_at), now)) continue;

    const { data: account } = await supabase.from("social_accounts").select("*").eq("id", job.account_id).eq("owner_id", job.owner_id).maybeSingle();
    if (!account) continue;
    const out = await collectForJob(job, account as AccountRow);
    const row = out.ok
      ? { metrics: out.data.metrics, unsupported: out.data.unsupported, error: null }
      : { metrics: {}, unsupported: [], error: out.error };
    const { error: insErr } = await supabase.from("social_analytics_snapshots").insert({
      owner_id: job.owner_id,
      job_id: job.id,
      platform: job.platform,
      external_id: job.external_id,
      ...row,
    });
    if (insErr) captureError("social-analytics:insert", insErr);
    if (out.ok) done += 1;
    else failed += 1;
  }
  return { collected: done, failed };
}

export type SnapshotRow = {
  id: string; job_id: string; platform: string; external_id: string; retrieved_at: string;
  metrics: Record<string, number>; unsupported: string[]; error: string | null;
};

export async function listSnapshots(ownerId: string, perJob = 8) {
  const supabase = db();
  const { data: jobs, error } = await supabase
    .from("social_publish_jobs")
    .select("id, platform, external_id, external_url, completed_at")
    .eq("owner_id", ownerId)
    .eq("status", "succeeded")
    .order("completed_at", { ascending: false })
    .limit(30);
  if (error) throw new Error("Could not load published jobs.");
  const ids = (jobs ?? []).map((j: { id: string }) => j.id);
  const snaps = ids.length
    ? await supabase.from("social_analytics_snapshots").select("*").eq("owner_id", ownerId).in("job_id", ids).order("retrieved_at", { ascending: false }).limit(600)
    : { data: [], error: null };
  if (snaps.error) throw new Error("Could not load snapshots.");
  const byJob = new Map<string, SnapshotRow[]>();
  for (const s of (snaps.data ?? []) as SnapshotRow[]) {
    const arr = byJob.get(s.job_id) ?? [];
    if (arr.length < perJob) arr.push(s);
    byJob.set(s.job_id, arr);
  }
  return (jobs ?? []).map((j: { id: string; platform: string; external_id: string; external_url: string | null; completed_at: string | null }) => ({ ...j, snapshots: byJob.get(j.id) ?? [] }));
}
