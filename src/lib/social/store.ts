import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceSupabase } from "@/lib/supabase/server";
import { dbError } from "@/lib/errors";
import type { SocialPlatform } from "@/lib/social/providers";
import type { FailureKind, JobStatus } from "@/lib/social/jobs";

/**
 * Owner-scoped data access for Social Studio. The generated `Database` type
 * does not know these tables yet, so this module uses an untyped client and
 * declares its own row shapes. EVERY query filters by owner_id (except the
 * worker's claim, which is system-level and re-reads the owner from the job).
 */

export const db = () => getServiceSupabase() as unknown as SupabaseClient;

export type AccountRow = {
  id: string;
  owner_id: string;
  platform: SocialPlatform;
  connection_provider: string;
  external_id: string;
  display_name: string;
  status: "active" | "disabled";
  /** Non-secret facts only (e.g. the linked Facebook page_id for Instagram). */
  metadata: Record<string, unknown>;
};

export type AssetRow = {
  id: string;
  owner_id: string;
  name: string;
  kind: "video" | "image";
  mime_type: string;
  size_bytes: number;
  duration_seconds: number | null;
  storage_bucket: string;
  storage_path: string;
  status: "pending" | "ready" | "archived";
  tags: string[];
  category: string | null;
  created_at: string;
};

export type ContentRow = {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  caption: string;
  hashtags: string[];
  language: string;
  notes: string;
  tags: string[];
  status: "draft" | "ready" | "archived";
  ai_generated: boolean;
  updated_at: string;
};

export type VariantRow = {
  id: string;
  content_id: string;
  platform: SocialPlatform;
  title: string | null;
  caption: string | null;
  hashtags: string[] | null;
  options: Record<string, unknown>;
};

export type JobRow = {
  id: string;
  owner_id: string;
  content_id: string;
  variant_id: string;
  account_id: string;
  platform: SocialPlatform;
  status: JobStatus;
  run_at: string;
  timezone: string;
  idempotency_key: string;
  attempts: number;
  error_kind: FailureKind | null;
  last_error: string | null;
  external_id: string | null;
  external_url: string | null;
  approved_at: string;
  completed_at: string | null;
  created_at: string;
};

function check<T>(context: string, res: { data: T | null; error: unknown }): T {
  if (res.error) throw dbError(context, res.error);
  return res.data as T;
}

export async function listAccounts(ownerId: string): Promise<AccountRow[]> {
  return check(
    "Loading social accounts",
    await db().from("social_accounts").select("*").eq("owner_id", ownerId).order("created_at"),
  ) as AccountRow[];
}

export async function upsertAccount(
  ownerId: string,
  a: Pick<AccountRow, "platform" | "connection_provider" | "external_id" | "display_name"> & {
    metadata?: Record<string, unknown>;
  },
): Promise<AccountRow> {
  return check(
    "Saving the social account",
    await db()
      .from("social_accounts")
      .upsert(
        { owner_id: ownerId, metadata: {}, ...a, status: "active", updated_at: new Date().toISOString() },
        { onConflict: "owner_id,platform,external_id" },
      )
      .select("*")
      .single(),
  ) as AccountRow;
}

export async function listAssets(ownerId: string, opts: { q?: string; includeArchived?: boolean } = {}) {
  let q = db()
    .from("social_media_assets")
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(100);
  q = opts.includeArchived ? q : q.neq("status", "archived");
  if (opts.q) q = q.ilike("name", `%${opts.q.replace(/[%_,]/g, "")}%`);
  return check("Loading media", await q) as AssetRow[];
}

export async function getAsset(ownerId: string, id: string): Promise<AssetRow | null> {
  const { data, error } = await db()
    .from("social_media_assets")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw dbError("Loading media", error);
  return (data as AssetRow | null) ?? null;
}

export async function listContent(ownerId: string) {
  return check(
    "Loading content",
    await db()
      .from("social_content")
      .select("*")
      .eq("owner_id", ownerId)
      .neq("status", "archived")
      .order("updated_at", { ascending: false })
      .limit(100),
  ) as ContentRow[];
}

export async function getContentBundle(ownerId: string, contentId: string) {
  const { data: content, error } = await db()
    .from("social_content")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("id", contentId)
    .maybeSingle();
  if (error) throw dbError("Loading content", error);
  if (!content) return null;
  const [variants, media] = await Promise.all([
    db().from("social_content_variants").select("*").eq("content_id", contentId),
    db()
      .from("social_content_media")
      .select("asset_id, position, is_thumbnail")
      .eq("content_id", contentId)
      .order("position"),
  ]);
  return {
    content: content as ContentRow,
    variants: check("Loading variants", variants) as VariantRow[],
    media: check("Loading content media", media) as {
      asset_id: string;
      position: number;
      is_thumbnail: boolean;
    }[],
  };
}

export async function listJobs(
  ownerId: string,
  opts: { status?: string; platform?: string; limit?: number } = {},
) {
  let q = db()
    .from("social_publish_jobs")
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(Math.min(opts.limit ?? 50, 200));
  if (opts.status) q = q.eq("status", opts.status);
  if (opts.platform) q = q.eq("platform", opts.platform);
  return check("Loading publishing history", await q) as JobRow[];
}

export async function listAttempts(ownerId: string, jobId: string) {
  // Ownership is verified through the job row first.
  const { data: job } = await db()
    .from("social_publish_jobs")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return [];
  return check(
    "Loading attempts",
    await db().from("social_publish_attempts").select("*").eq("job_id", jobId).order("attempt_no"),
  ) as Record<string, unknown>[];
}

/**
 * Variants and attachments for MANY content items in two queries (instead of
 * three per item). `contentIds` must come from an owner-scoped listing: the
 * ids are additionally checked against the owner's content here so a foreign id
 * can never leak rows.
 */
export async function getContentRelations(ownerId: string, contentIds: string[]) {
  const out = new Map<string, { variants: VariantRow[]; media: { asset_id: string; position: number; is_thumbnail: boolean }[] }>();
  if (contentIds.length === 0) return out;
  const { data: owned, error } = await db().from("social_content").select("id").eq("owner_id", ownerId).in("id", contentIds);
  if (error) throw dbError("Loading content", error);
  const ids = ((owned ?? []) as { id: string }[]).map((r) => r.id);
  for (const id of ids) out.set(id, { variants: [], media: [] });
  if (ids.length === 0) return out;
  const [variants, media] = await Promise.all([
    db().from("social_content_variants").select("*").in("content_id", ids),
    db().from("social_content_media").select("content_id, asset_id, position, is_thumbnail").in("content_id", ids).order("position"),
  ]);
  for (const v of check("Loading variants", variants) as VariantRow[]) out.get(v.content_id)?.variants.push(v);
  for (const m of check("Loading content media", media) as { content_id: string; asset_id: string; position: number; is_thumbnail: boolean }[]) {
    out.get(m.content_id)?.media.push({ asset_id: m.asset_id, position: m.position, is_thumbnail: m.is_thumbnail });
  }
  return out;
}
