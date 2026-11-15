import "server-only";

import type { FailureKind } from "@/lib/social/jobs";
import type { PublishResult } from "@/lib/social/adapters/youtube";
import { GRAPH_VERSION } from "@/lib/integrations/providers/meta";

/**
 * Facebook Pages + Instagram publishing through the Graph API.
 * Docs: https://developers.facebook.com/docs/pages-api/posts
 *       https://developers.facebook.com/docs/instagram-platform/content-publishing
 *
 * Meta fetches the media itself from a public HTTPS URL (we pass a short-lived
 * signed storage URL), so no bytes pass through this server.
 * Mocked-HTTP tested only; not yet run against a live Page/IG account.
 */

const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
const VIDEO_GRAPH = `https://graph-video.facebook.com/${GRAPH_VERSION}`;

type GraphError = { error?: { message?: string; code?: number; error_subcode?: number; is_transient?: boolean } };

/** Maps a Graph API failure to a retry class. */
export function classifyMetaError(status: number, body: GraphError | null): { kind: FailureKind; retryAfterMs?: number } {
  const e = body?.error;
  const code = e?.code;
  if (code === 190 || code === 102 || status === 401) return { kind: "auth" }; // expired/invalid token
  if ((code !== undefined && code >= 200 && code < 300) || code === 10) return { kind: "auth" }; // permissions
  if (code === 4 || code === 17 || code === 32 || code === 613 || status === 429) {
    return { kind: "rate_limited", retryAfterMs: 30 * 60_000 };
  }
  if (e?.is_transient || code === 1 || code === 2 || status >= 500) return { kind: "retryable" };
  return { kind: "terminal" };
}

async function graph(f: typeof fetch, url: string, init?: RequestInit) {
  const res = await f(url, { ...init, signal: AbortSignal.timeout(60_000) });
  const text = await res.text().catch(() => "");
  let json: (GraphError & Record<string, unknown>) | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { res, json, text };
}

const form = (o: Record<string, string>) =>
  ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o).toString() }) as RequestInit;

const fail = (kind: FailureKind, message: string, extra: Partial<Extract<PublishResult, { ok: false }>> = {}): PublishResult => ({ ok: false, kind, message, ...extra });

function apiFailure(what: string, res: Response, json: GraphError | null): PublishResult {
  const c = classifyMetaError(res.status, json);
  return fail(c.kind, `${what} failed (${res.status}): ${json?.error?.message ?? "no detail"}`.slice(0, 400), { httpStatus: res.status, retryAfterMs: c.retryAfterMs });
}

/** Derives the Page token (and linked IG user) from the stored user token; nothing is persisted. */
export async function getPageAccess(userToken: string, pageId: string, f: typeof fetch = fetch) {
  const { res, json } = await graph(
    f,
    `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100&access_token=${encodeURIComponent(userToken)}`,
  );
  if (!res.ok) return { ok: false as const, failure: apiFailure("Listing Pages", res, json) };
  const pages = (json?.data ?? []) as { id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } }[];
  const page = pages.find((p) => p.id === pageId);
  if (!page) return { ok: false as const, failure: fail("auth", "The Page is no longer accessible with this authorization. Reconnect Meta.") };
  return { ok: true as const, page, pages };
}

export type MetaPostInput = {
  userToken: string;
  /** FB: page id. IG: instagram user id. */
  externalId: string;
  /** IG only: the Page that owns the IG account (to derive the token). */
  pageId?: string;
  caption: string;
  title?: string;
  media: { kind: "video" | "image"; url: string } | null;
  fetchImpl?: typeof fetch;
  /** Test hook. */
  sleep?: (ms: number) => Promise<void>;
  pollDeadlineMs?: number;
};

export async function publishToFacebook(i: MetaPostInput): Promise<PublishResult> {
  const f = i.fetchImpl ?? fetch;
  let access;
  try {
    access = await getPageAccess(i.userToken, i.externalId, f);
  } catch (e) {
    return fail("retryable", `Could not reach Meta: ${msg(e)}`);
  }
  if (!access.ok) return access.failure;
  const token = access.page.access_token;

  let url: string;
  let body: Record<string, string>;
  if (i.media?.kind === "video") {
    url = `${VIDEO_GRAPH}/${i.externalId}/videos`;
    body = { file_url: i.media.url, description: i.caption, published: "true", access_token: token, ...(i.title ? { title: i.title } : {}) };
  } else if (i.media?.kind === "image") {
    url = `${GRAPH}/${i.externalId}/photos`;
    body = { url: i.media.url, caption: i.caption, published: "true", access_token: token };
  } else {
    url = `${GRAPH}/${i.externalId}/feed`;
    body = { message: i.caption, access_token: token };
  }

  let r;
  try {
    r = await graph(f, url, form(body));
  } catch (e) {
    // The POST may have been accepted before the connection died.
    return fail("terminal", `Request interrupted (${msg(e)}). The outcome is unknown — check the Page before retrying.`);
  }
  if (!r.res.ok) return apiFailure("Facebook publish", r.res, r.json);
  const id = (r.json?.post_id ?? r.json?.id) as unknown;
  if (typeof id !== "string" || !id) return fail("terminal", "Facebook returned success without a post id; not marking as published.", { httpStatus: r.res.status });
  return { ok: true, externalId: id, externalUrl: `https://www.facebook.com/${id}`, summary: { postId: id } };
}

export async function publishToInstagram(i: MetaPostInput): Promise<PublishResult> {
  const f = i.fetchImpl ?? fetch;
  const sleep = i.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  if (!i.media) return fail("terminal", "Instagram requires media.");
  if (!i.pageId) return fail("terminal", "Instagram account is missing its linked Page; re-detect accounts.");

  let access;
  try {
    access = await getPageAccess(i.userToken, i.pageId, f);
  } catch (e) {
    return fail("retryable", `Could not reach Meta: ${msg(e)}`);
  }
  if (!access.ok) return access.failure;
  const token = access.page.access_token;

  // 1) Create the container. Nothing is public yet, so failures here are safe to retry.
  let c;
  try {
    c = await graph(
      f,
      `${GRAPH}/${i.externalId}/media`,
      form({
        ...(i.media.kind === "video" ? { media_type: "REELS", video_url: i.media.url } : { image_url: i.media.url }),
        caption: i.caption,
        access_token: token,
      }),
    );
  } catch (e) {
    return fail("retryable", `Could not create the media container: ${msg(e)}`);
  }
  if (!c.res.ok) return apiFailure("Instagram container creation", c.res, c.json);
  const containerId = c.json?.id;
  if (typeof containerId !== "string") return fail("retryable", "Instagram did not return a container id.");

  // 2) Wait until Instagram has processed the media.
  const deadline = Date.now() + (i.pollDeadlineMs ?? 240_000);
  for (;;) {
    let s;
    try {
      s = await graph(f, `${GRAPH}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(token)}`);
    } catch (e) {
      return fail("retryable", `Could not check processing status: ${msg(e)}`);
    }
    if (!s.res.ok) return apiFailure("Instagram status check", s.res, s.json);
    const code = s.json?.status_code;
    if (code === "FINISHED") break;
    if (code === "ERROR" || code === "EXPIRED") return fail("terminal", `Instagram could not process the media (${code}): ${String(s.json?.status ?? "")}`.slice(0, 400));
    if (Date.now() >= deadline) return fail("retryable", "Instagram is still processing the media; will retry.");
    await sleep(5_000);
  }

  // 3) Publish. A drop here is ambiguous, so it is terminal.
  let p;
  try {
    p = await graph(f, `${GRAPH}/${i.externalId}/media_publish`, form({ creation_id: containerId, access_token: token }));
  } catch (e) {
    return fail("terminal", `Publish request interrupted (${msg(e)}). The outcome is unknown — check Instagram before retrying.`);
  }
  if (!p.res.ok) return apiFailure("Instagram publish", p.res, p.json);
  const mediaId = p.json?.id;
  if (typeof mediaId !== "string" || !mediaId) return fail("terminal", "Instagram returned success without a media id; not marking as published.", { httpStatus: p.res.status });

  let permalink = `https://www.instagram.com/`;
  try {
    const pl = await graph(f, `${GRAPH}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(token)}`);
    if (typeof pl.json?.permalink === "string") permalink = pl.json.permalink;
  } catch {
    // The post IS published; the link is cosmetic.
  }
  return { ok: true, externalId: mediaId, externalUrl: permalink, summary: { mediaId, containerId } };
}

const msg = (e: unknown) => (e instanceof Error ? e.message : "unknown error");
