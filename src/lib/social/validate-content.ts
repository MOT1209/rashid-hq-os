import "server-only";

import { db, getContentBundle } from "@/lib/social/store";
import { validateVariant, type Issue } from "@/lib/social/validation";
import type { MediaKind } from "@/lib/social/providers";

/** Validation report for every platform variant of one content item (owner-scoped). */
export async function validateContent(ownerId: string, contentId: string): Promise<{ platform: string; issues: Issue[] }[] | null> {
  const bundle = await getContentBundle(ownerId, contentId);
  if (!bundle) return null;
  const ids = bundle.media.map((m) => m.asset_id);
  const { data: assets } = ids.length ? await db().from("social_media_assets").select("*").eq("owner_id", ownerId).in("id", ids) : { data: [] };
  const facts = (assets ?? []).map((a: { kind: MediaKind; mime_type: string; size_bytes: number; duration_seconds: number | null }) => ({
    kind: a.kind, mimeType: a.mime_type, sizeBytes: Number(a.size_bytes), durationSeconds: a.duration_seconds,
  }));
  return bundle.variants.map((v) => ({
    platform: v.platform,
    issues: validateVariant(
      { platform: v.platform, title: v.title ?? bundle.content.title, caption: v.caption ?? bundle.content.caption, hashtags: v.hashtags ?? bundle.content.hashtags },
      facts,
    ),
  }));
}
