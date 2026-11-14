/**
 * Capability-based registry of social platforms. Static, non-secret, safe to
 * ship to the browser.
 *
 * Honesty rule: `readiness` describes what THIS CODEBASE can do today, never
 * what the platform could theoretically allow.
 *   - "implemented": a publishing adapter exists in src/lib/social/adapters.
 *     It has been exercised against mocked HTTP in tests only; a live account
 *     plus the external approvals listed in `blockers` are still required.
 *   - "pending": capabilities are declared (from the official docs) so the UI
 *     and validation can reason about them, but there is NO adapter. Publishing
 *     to a pending provider is refused server-side.
 *
 * Capability facts below come from the platforms' public API docs and may
 * change; re-verify before relying on a limit.
 */

export type SocialPlatform = "youtube" | "tiktok" | "instagram" | "facebook";
export type MediaKind = "video" | "image";
export type SocialReadiness = "implemented" | "pending";

export type PlatformCapabilities = {
  id: SocialPlatform;
  name: string;
  /** Integration-registry id holding the OAuth connection used to publish. */
  integrationId: string;
  readiness: SocialReadiness;
  auth: string;
  mediaTypes: MediaKind[];
  /** How media reaches the platform. */
  upload: "resumable_binary" | "public_url" | "chunked_binary";
  /** Platform-native scheduling vs. our own persistent job scheduler. */
  nativeScheduling: boolean;
  analytics: string[];
  requiredScopes: string[];
  limits: {
    titleMax?: number;
    captionMax: number;
    hashtagsMax?: number;
    videoMaxBytes?: number;
    videoMaxSeconds?: number;
    imageMaxBytes?: number;
  };
  /** Rules about WHAT may be published, enforced by validation. */
  requires: { title?: boolean; media: boolean; videoOnly?: boolean };
  accountRequirements: string;
  /** Exact external blockers between the code and a live publish. */
  blockers: string[];
  docsUrl: string;
};

const GB = 1024 ** 3;
const MB = 1024 ** 2;

export const PLATFORMS: Record<SocialPlatform, PlatformCapabilities> = {
  youtube: {
    id: "youtube",
    name: "YouTube",
    integrationId: "youtube_publish",
    readiness: "implemented",
    auth: "Google OAuth 2.0 (PKCE, offline access)",
    mediaTypes: ["video"],
    upload: "resumable_binary",
    nativeScheduling: true, // status.publishAt on a private video
    analytics: ["views", "likes", "comments", "subscribers", "watch_time"],
    requiredScopes: ["https://www.googleapis.com/auth/youtube.upload"],
    limits: { titleMax: 100, captionMax: 5000, hashtagsMax: 15, videoMaxBytes: 256 * GB },
    requires: { title: true, media: true, videoOnly: true },
    accountRequirements: "A YouTube channel on the connected Google account.",
    blockers: [
      "Create a Google Cloud OAuth client and enable the YouTube Data API v3 (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).",
      "Uploads from an API project that has not passed Google's compliance audit are forced to private. Request the audit before expecting public posts.",
      "Each upload costs ~1600 quota units of the default 10,000/day.",
    ],
    docsUrl: "https://developers.google.com/youtube/v3/docs/videos/insert",
  },
  facebook: {
    id: "facebook",
    name: "Facebook Pages",
    integrationId: "facebook",
    readiness: "pending",
    auth: "Meta OAuth 2.0 (Page access tokens)",
    mediaTypes: ["video", "image"],
    upload: "public_url",
    nativeScheduling: true, // scheduled_publish_time (10 min – 30 days ahead)
    analytics: ["views", "reach", "likes", "comments", "shares"],
    requiredScopes: ["pages_manage_posts", "pages_read_engagement", "pages_show_list"],
    limits: { captionMax: 63206 },
    requires: { media: false },
    accountRequirements: "A Facebook Page the owner administers.",
    blockers: [
      "No Meta adapter is implemented yet.",
      "Meta app review + business verification are required for pages_manage_posts outside development mode.",
    ],
    docsUrl: "https://developers.facebook.com/docs/pages-api/posts",
  },
  instagram: {
    id: "instagram",
    name: "Instagram",
    integrationId: "instagram",
    readiness: "pending",
    auth: "Meta OAuth 2.0 (Instagram Business/Creator via Facebook Page)",
    mediaTypes: ["video", "image"],
    upload: "public_url",
    nativeScheduling: false,
    analytics: ["views", "reach", "likes", "comments", "shares"],
    requiredScopes: ["instagram_basic", "instagram_content_publish", "pages_show_list"],
    limits: { captionMax: 2200, hashtagsMax: 30, videoMaxSeconds: 900 },
    requires: { media: true },
    accountRequirements: "Instagram Business or Creator account linked to a Facebook Page.",
    blockers: [
      "No Meta adapter is implemented yet.",
      "Media must be fetchable from a public HTTPS URL during publishing.",
      "Meta app review is required for instagram_content_publish.",
    ],
    docsUrl: "https://developers.facebook.com/docs/instagram-platform/content-publishing",
  },
  tiktok: {
    id: "tiktok",
    name: "TikTok",
    integrationId: "tiktok",
    readiness: "pending",
    auth: "TikTok Login Kit OAuth 2.0 (PKCE)",
    mediaTypes: ["video"],
    upload: "chunked_binary",
    nativeScheduling: false,
    analytics: ["views", "likes", "comments", "shares"],
    requiredScopes: ["video.publish", "video.upload", "user.info.basic"],
    limits: { titleMax: 2200, captionMax: 2200, videoMaxBytes: 4 * GB, videoMaxSeconds: 600 },
    requires: { media: true, videoOnly: true },
    accountRequirements: "A TikTok account; posting must use the creator's chosen privacy options.",
    blockers: [
      "No TikTok adapter is implemented yet.",
      "Direct Post requires TikTok's app audit; unaudited clients can only post private (SELF_ONLY) content.",
      "TikTok requires the user to confirm privacy/interaction settings in the UI before each post.",
    ],
    docsUrl: "https://developers.tiktok.com/doc/content-posting-api-get-started",
  },
};

export const PLATFORM_IDS = Object.keys(PLATFORMS) as SocialPlatform[];

export function isPlatform(value: unknown): value is SocialPlatform {
  return typeof value === "string" && value in PLATFORMS;
}

export function canPublish(platform: SocialPlatform): boolean {
  return PLATFORMS[platform].readiness === "implemented";
}

export const MAX_IMAGE_BYTES_DEFAULT = 20 * MB;
