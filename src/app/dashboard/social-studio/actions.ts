"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireAdmin } from "@/lib/session";
import { getFreshAccessToken } from "@/lib/integrations/connections";
import { integrationFetchJson } from "@/lib/integrations/http";
import { idempotencyKey, manualRetryAllowed, parseSchedule } from "@/lib/social/jobs";
import { PLATFORMS, canPublish, isPlatform, type MediaKind } from "@/lib/social/providers";
import { runDueJobs } from "@/lib/social/engine";
import { db, getAsset, getContentBundle, upsertAccount, type AccountRow } from "@/lib/social/store";
import { hasErrors, parseHashtags, validateVariant } from "@/lib/social/validation";
import { logActivity } from "@/lib/activity";

const PATH = "/dashboard/social-studio";
type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/* ---------- accounts ---------- */

/** Reads the connected channel from YouTube itself and records it. */
export async function syncYouTubeAccountAction(): Promise<Result<{ name: string }>> {
  const session = await requireAdmin();
  try {
    const token = await getFreshAccessToken(session.user.id, "youtube_publish");
    const res = await integrationFetchJson<{ items?: { id: string; snippet?: { title?: string } }[] }>(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
      { headers: { authorization: `Bearer ${token}` } },
    );
    const ch = res.items?.[0];
    if (!ch) return fail("This Google account has no YouTube channel.");
    await upsertAccount(session.user.id, {
      platform: "youtube",
      connection_provider: "youtube_publish",
      external_id: ch.id,
      display_name: ch.snippet?.title ?? ch.id,
    });
    revalidatePath(PATH);
    return { ok: true, name: ch.snippet?.title ?? ch.id };
  } catch {
    return fail("Could not read the YouTube channel. Connect “YouTube Publishing” in Integrations first.");
  }
}

/* ---------- media (direct-to-storage via signed URL) ---------- */

const VIDEO_MIME = ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"];
const IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"];
const MAX_VIDEO = 5 * 1024 ** 3;
const MAX_IMAGE = 20 * 1024 ** 2;

export async function requestUploadAction(input: {
  name: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds?: number;
}): Promise<Result<{ assetId: string; signedUrl: string }>> {
  const session = await requireAdmin();
  const kind: MediaKind | null = VIDEO_MIME.includes(input.mimeType) ? "video" : IMAGE_MIME.includes(input.mimeType) ? "image" : null;
  if (!kind) return fail("Unsupported file type.");
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) return fail("Invalid file size.");
  if (input.sizeBytes > (kind === "video" ? MAX_VIDEO : MAX_IMAGE)) return fail("File is too large.");

  const safe = input.name.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 80) || "file";
  const path = `${session.user.id}/${randomUUID()}-${safe}`;
  const supabase = db();
  const signed = await supabase.storage.from("social-media").createSignedUploadUrl(path);
  if (signed.error || !signed.data) return fail("Storage is not available. Check the social-media bucket.");

  const { data, error } = await supabase
    .from("social_media_assets")
    .insert({
      owner_id: session.user.id,
      name: input.name.slice(0, 200),
      kind,
      mime_type: input.mimeType,
      size_bytes: Math.round(input.sizeBytes),
      duration_seconds: input.durationSeconds ?? null,
      storage_path: path,
      status: "pending",
    })
    .select("id")
    .single();
  if (error || !data) return fail("Could not register the upload.");
  return { ok: true, assetId: data.id as string, signedUrl: signed.data.signedUrl };
}

/** Marks an upload ready only after verifying the object exists with the declared size. */
export async function confirmUploadAction(assetId: string): Promise<Result> {
  const session = await requireAdmin();
  const asset = await getAsset(session.user.id, assetId);
  if (!asset) return fail("Not found.");
  const dir = asset.storage_path.slice(0, asset.storage_path.lastIndexOf("/"));
  const file = asset.storage_path.slice(asset.storage_path.lastIndexOf("/") + 1);
  const { data } = await db().storage.from(asset.storage_bucket).list(dir, { search: file, limit: 1 });
  const found = data?.find((o) => o.name === file);
  const size = Number((found?.metadata as { size?: number } | undefined)?.size ?? 0);
  if (!found || size !== Number(asset.size_bytes)) {
    await db().storage.from(asset.storage_bucket).remove([asset.storage_path]);
    await db().from("social_media_assets").delete().eq("id", assetId).eq("owner_id", session.user.id);
    return fail("Upload did not complete or size mismatch; it was discarded.");
  }
  await db().from("social_media_assets").update({ status: "ready", updated_at: new Date().toISOString() }).eq("id", assetId).eq("owner_id", session.user.id);
  revalidatePath(PATH);
  return { ok: true };
}

export async function archiveAssetAction(assetId: string): Promise<Result> {
  const session = await requireAdmin();
  const { error } = await db().from("social_media_assets").update({ status: "archived" }).eq("id", assetId).eq("owner_id", session.user.id);
  if (error) return fail("Could not archive.");
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteAssetAction(assetId: string): Promise<Result> {
  const session = await requireAdmin();
  const asset = await getAsset(session.user.id, assetId);
  if (!asset) return fail("Not found.");
  // content_media FK is ON DELETE RESTRICT: media in use cannot be deleted.
  const { error } = await db().from("social_media_assets").delete().eq("id", assetId).eq("owner_id", session.user.id);
  if (error) return fail("This media is used by content. Archive it instead.");
  await db().storage.from(asset.storage_bucket).remove([asset.storage_path]);
  revalidatePath(PATH);
  return { ok: true };
}

export async function mediaPreviewUrlAction(assetId: string): Promise<Result<{ url: string }>> {
  const session = await requireAdmin();
  const asset = await getAsset(session.user.id, assetId);
  if (!asset) return fail("Not found.");
  const { data } = await db().storage.from(asset.storage_bucket).createSignedUrl(asset.storage_path, 600);
  return data ? { ok: true, url: data.signedUrl } : fail("Could not sign URL.");
}

/* ---------- content ---------- */

export async function saveContentAction(input: {
  id?: string;
  title: string;
  description: string;
  caption: string;
  hashtags: string;
  language: string;
  notes: string;
  mediaIds: string[];
  platforms: string[];
  privacy?: string;
  variantOverrides?: Record<string, { title?: string; caption?: string }>;
}): Promise<Result<{ id: string }>> {
  const session = await requireAdmin();
  const owner = session.user.id;
  const supabase = db();

  const platforms = input.platforms.filter(isPlatform);
  const mediaIds = [...new Set(input.mediaIds)].slice(0, 10);
  if (mediaIds.length) {
    const { data } = await supabase.from("social_media_assets").select("id").eq("owner_id", owner).in("id", mediaIds);
    if ((data?.length ?? 0) !== mediaIds.length) return fail("Some media was not found.");
  }

  const fields = {
    title: input.title.slice(0, 200),
    description: input.description.slice(0, 5000),
    caption: input.caption.slice(0, 5000),
    hashtags: parseHashtags(input.hashtags).slice(0, 30),
    language: input.language === "en" ? "en" : "ar",
    notes: input.notes.slice(0, 2000),
    updated_at: new Date().toISOString(),
    ai_generated: false,
  };

  let id = input.id;
  if (id) {
    const { data, error } = await supabase.from("social_content").update(fields).eq("id", id).eq("owner_id", owner).select("id").maybeSingle();
    if (error || !data) return fail("Content not found.");
  } else {
    const { data, error } = await supabase.from("social_content").insert({ owner_id: owner, ...fields }).select("id").single();
    if (error || !data) return fail("Could not save the draft.");
    id = data.id as string;
  }

  await supabase.from("social_content_media").delete().eq("content_id", id);
  if (mediaIds.length) {
    await supabase.from("social_content_media").insert(mediaIds.map((asset_id, position) => ({ content_id: id, asset_id, position })));
  }

  const privacy = ["private", "unlisted", "public"].includes(input.privacy ?? "") ? input.privacy : "private";
  for (const platform of platforms) {
    const o = input.variantOverrides?.[platform];
    await supabase.from("social_content_variants").upsert(
      {
        content_id: id,
        platform,
        title: o?.title?.trim() ? o.title.slice(0, 200) : null,
        caption: o?.caption?.trim() ? o.caption.slice(0, 5000) : null,
        options: platform === "youtube" ? { privacy } : {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: "content_id,platform" },
    );
  }
  // Variants for de-selected platforms are dropped unless a job references them.
  const drop = (Object.keys(PLATFORMS) as string[]).filter((p) => !platforms.includes(p as never));
  if (drop.length) await supabase.from("social_content_variants").delete().eq("content_id", id).in("platform", drop);

  revalidatePath(PATH);
  return { ok: true, id: id! };
}

export async function validateContentAction(contentId: string) {
  const session = await requireAdmin();
  const bundle = await getContentBundle(session.user.id, contentId);
  if (!bundle) return fail("Not found.");
  const ids = bundle.media.map((m) => m.asset_id);
  const { data: assets } = ids.length ? await db().from("social_media_assets").select("*").eq("owner_id", session.user.id).in("id", ids) : { data: [] };
  const facts = (assets ?? []).map((a: { kind: MediaKind; mime_type: string; size_bytes: number; duration_seconds: number | null }) => ({
    kind: a.kind, mimeType: a.mime_type, sizeBytes: Number(a.size_bytes), durationSeconds: a.duration_seconds,
  }));
  const report = bundle.variants.map((v) => ({
    platform: v.platform,
    issues: validateVariant(
      { platform: v.platform, title: v.title ?? bundle.content.title, caption: v.caption ?? bundle.content.caption, hashtags: v.hashtags ?? bundle.content.hashtags },
      facts,
    ),
  }));
  return { ok: true as const, report };
}

/* ---------- publishing ---------- */

/**
 * The ONLY path that creates publish jobs. It is an explicit owner action
 * (requireAdmin incl. 2FA policy) and stamps approved_by — nothing, including
 * AI output or agents, can enqueue a job without passing through here.
 */
export async function confirmPublishAction(input: {
  contentId: string;
  platform: string;
  accountId: string;
  /** Wall-clock "yyyy-mm-ddThh:mm" in `timezone`, or empty for publish now. */
  scheduledAt?: string;
  timezone?: string;
}): Promise<Result<{ jobId: string; duplicate: boolean }>> {
  const session = await requireAdmin();
  const owner = session.user.id;
  if (!isPlatform(input.platform)) return fail("Unknown platform.");
  if (!canPublish(input.platform)) return fail(`${PLATFORMS[input.platform].name} publishing is not available yet.`);

  const supabase = db();
  const bundle = await getContentBundle(owner, input.contentId);
  if (!bundle) return fail("Content not found.");
  const variant = bundle.variants.find((v) => v.platform === input.platform);
  if (!variant) return fail("Prepare a version for this platform first.");

  const { data: account } = await supabase.from("social_accounts").select("*").eq("id", input.accountId).eq("owner_id", owner).maybeSingle();
  if (!account || (account as AccountRow).platform !== input.platform || (account as AccountRow).status !== "active") {
    return fail("Select a connected account for this platform.");
  }

  const check = await validateContentAction(input.contentId);
  if (!check.ok) return fail(check.error);
  const mine = check.report.find((r) => r.platform === input.platform);
  if (!mine || hasErrors(mine.issues)) return fail(mine?.issues.find((i) => i.severity === "error")?.message ?? "Validation failed.");

  const now = new Date();
  let runAt = now;
  const timezone = input.timezone || "UTC";
  if (input.scheduledAt) {
    const parsed = parseSchedule(input.scheduledAt, timezone, now);
    if (!parsed.ok) return fail(parsed.error);
    runAt = parsed.at;
  }

  const key = idempotencyKey(variant.id, input.accountId);
  const { data: existing } = await supabase.from("social_publish_jobs").select("id, status").eq("idempotency_key", key).maybeSingle();
  if (existing) {
    const status = (existing as { status: string }).status;
    if (status !== "cancelled") return { ok: true, jobId: (existing as { id: string }).id, duplicate: true };
    // Re-publishing a cancelled job re-queues the same row (key stays unique).
    await supabase.from("social_publish_jobs").update({ status: "queued", run_at: runAt.toISOString(), timezone, attempts: 0, last_error: null, error_kind: null, approved_by: session.user.email, approved_at: now.toISOString(), updated_at: now.toISOString() }).eq("id", (existing as { id: string }).id).eq("status", "cancelled");
    return { ok: true, jobId: (existing as { id: string }).id, duplicate: false };
  }

  const { data: job, error } = await supabase
    .from("social_publish_jobs")
    .insert({
      owner_id: owner,
      content_id: input.contentId,
      variant_id: variant.id,
      account_id: input.accountId,
      platform: input.platform,
      run_at: runAt.toISOString(),
      timezone,
      idempotency_key: key,
      approved_by: session.user.email,
    })
    .select("id")
    .single();
  if (error || !job) return fail("Could not queue the job (it may already exist).");

  await logActivity({ agentName: "Social Studio", toolName: "social.publish.approve", status: "success", payload: { jobId: job.id, platform: input.platform, runAt: runAt.toISOString() } as never }).catch(() => undefined);

  // Publish-now: run in the background after the response; scheduled jobs wait for the worker.
  if (!input.scheduledAt) after(() => runDueJobs(1).catch(() => undefined));
  revalidatePath(PATH);
  return { ok: true, jobId: job.id as string, duplicate: false };
}

export async function cancelJobAction(jobId: string): Promise<Result> {
  const session = await requireAdmin();
  const { data } = await db().from("social_publish_jobs").update({ status: "cancelled", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", jobId).eq("owner_id", session.user.id).eq("status", "queued").select("id");
  if (!data?.length) return fail("Only queued jobs can be cancelled.");
  revalidatePath(PATH);
  return { ok: true };
}

export async function retryJobAction(jobId: string): Promise<Result> {
  const session = await requireAdmin();
  const supabase = db();
  const { data: job } = await supabase.from("social_publish_jobs").select("status, error_kind").eq("id", jobId).eq("owner_id", session.user.id).maybeSingle();
  if (!job || !manualRetryAllowed(job.status, job.error_kind)) {
    return fail("This job cannot be retried (terminal failures may have posted; verify on the platform first).");
  }
  const { data } = await supabase.from("social_publish_jobs").update({ status: "queued", run_at: new Date().toISOString(), attempts: 0, completed_at: null, updated_at: new Date().toISOString() }).eq("id", jobId).eq("owner_id", session.user.id).eq("status", "failed").select("id");
  if (!data?.length) return fail("Job changed state; refresh.");
  after(() => runDueJobs(1).catch(() => undefined));
  revalidatePath(PATH);
  return { ok: true };
}
