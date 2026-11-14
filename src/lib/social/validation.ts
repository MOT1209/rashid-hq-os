import { PLATFORMS, canPublish, type MediaKind, type SocialPlatform } from "@/lib/social/providers";

/**
 * Validates one platform variant against that platform's declared capabilities.
 * Pure: callers pass the already-loaded media facts.
 */

export type VariantInput = {
  platform: SocialPlatform;
  title?: string | null;
  caption?: string | null;
  hashtags?: string[];
};

export type MediaFacts = {
  kind: MediaKind;
  mimeType: string;
  sizeBytes: number;
  durationSeconds?: number | null;
};

export type Issue = { field: string; code: string; message: string; severity: "error" | "warning" };

const VIDEO_MIME = new Set(["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"]);
const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export function validateVariant(variant: VariantInput, media: MediaFacts[]): Issue[] {
  const cap = PLATFORMS[variant.platform];
  const issues: Issue[] = [];
  const err = (field: string, code: string, message: string) =>
    issues.push({ field, code, message, severity: "error" });

  if (!canPublish(variant.platform)) {
    err("platform", "not_ready", `${cap.name} publishing is not implemented yet (${cap.blockers[0]}).`);
  }

  const title = (variant.title ?? "").trim();
  if (cap.requires.title && !title) err("title", "required", "A title is required.");
  if (cap.limits.titleMax && title.length > cap.limits.titleMax) {
    err("title", "too_long", `Title exceeds ${cap.limits.titleMax} characters.`);
  }

  const caption = variant.caption ?? "";
  if (caption.length > cap.limits.captionMax) {
    err("caption", "too_long", `Caption exceeds ${cap.limits.captionMax} characters.`);
  }

  const tags = variant.hashtags ?? [];
  if (cap.limits.hashtagsMax && tags.length > cap.limits.hashtagsMax) {
    err("hashtags", "too_many", `At most ${cap.limits.hashtagsMax} hashtags.`);
  }

  if (cap.requires.media && media.length === 0) err("media", "required", "Attach media.");
  if (variant.platform === "youtube" && media.length > 1) {
    err("media", "too_many", "YouTube takes exactly one video per post.");
  }

  for (const m of media) {
    if (!cap.mediaTypes.includes(m.kind)) {
      err("media", "unsupported_type", `${cap.name} does not accept ${m.kind} posts.`);
      continue;
    }
    const okMime = m.kind === "video" ? VIDEO_MIME.has(m.mimeType) : IMAGE_MIME.has(m.mimeType);
    if (!okMime) err("media", "bad_mime", `Unsupported file type ${m.mimeType}.`);
    if (m.kind === "video" && cap.limits.videoMaxBytes && m.sizeBytes > cap.limits.videoMaxBytes) {
      err("media", "too_large", "Video exceeds the platform size limit.");
    }
    if (m.kind === "image" && cap.limits.imageMaxBytes && m.sizeBytes > cap.limits.imageMaxBytes) {
      err("media", "too_large", "Image exceeds the platform size limit.");
    }
    if (
      m.kind === "video" &&
      cap.limits.videoMaxSeconds &&
      m.durationSeconds != null &&
      m.durationSeconds > cap.limits.videoMaxSeconds
    ) {
      err("media", "too_long", `Video exceeds ${cap.limits.videoMaxSeconds}s.`);
    }
  }
  return issues;
}

export function hasErrors(issues: Issue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

/** Normalises "#Tag, tag2 #tag" into unique lowercase tags without '#'. */
export function parseHashtags(raw: string): string[] {
  const out = new Set<string>();
  for (const part of raw.split(/[\s,]+/)) {
    const tag = part.replace(/^#+/, "").trim().toLowerCase();
    if (tag && /^[\p{L}\p{N}_]+$/u.test(tag)) out.add(tag);
  }
  return [...out];
}
