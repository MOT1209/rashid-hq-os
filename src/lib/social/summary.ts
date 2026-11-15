import "server-only";

import { db } from "@/lib/social/store";

export type SocialSummary = {
  accounts: number;
  queued: number;
  running: number;
  failed7d: number;
  succeeded7d: number;
  nextRunAt: string | null;
  lastError: string | null;
};

/** Real counts for the CEO dashboard. Throws if the tables are unavailable (caller shows a notice). */
export async function socialSummary(ownerId: string): Promise<SocialSummary> {
  const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const supabase = db();
  const count = async (q: PromiseLike<{ count: number | null; error: unknown }>) => {
    const r = await q;
    if (r.error) throw new Error("summary query failed");
    return r.count ?? 0;
  };
  const jobs = () => supabase.from("social_publish_jobs").select("id", { count: "exact", head: true }).eq("owner_id", ownerId);
  const [accounts, queued, running, failed7d, succeeded7d, next, lastFailed] = await Promise.all([
    count(supabase.from("social_accounts").select("id", { count: "exact", head: true }).eq("owner_id", ownerId).eq("status", "active")),
    count(jobs().eq("status", "queued")),
    count(jobs().eq("status", "running")),
    count(jobs().eq("status", "failed").gte("updated_at", since)),
    count(jobs().eq("status", "succeeded").gte("completed_at", since)),
    supabase.from("social_publish_jobs").select("run_at").eq("owner_id", ownerId).eq("status", "queued").order("run_at").limit(1).maybeSingle(),
    supabase.from("social_publish_jobs").select("last_error").eq("owner_id", ownerId).eq("status", "failed").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return {
    accounts, queued, running, failed7d, succeeded7d,
    nextRunAt: (next.data as { run_at: string } | null)?.run_at ?? null,
    lastError: (lastFailed.data as { last_error: string | null } | null)?.last_error ?? null,
  };
}
