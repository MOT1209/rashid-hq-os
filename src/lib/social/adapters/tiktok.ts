import "server-only";

import type { FailureKind } from "@/lib/social/jobs";
import type { PublishResult } from "@/lib/social/adapters/youtube";

/**
 * TikTok Content Posting API (Direct Post, FILE_UPLOAD, chunked).
 * Docs: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
 *
 * Flow: creator_info → init → PUT chunks → poll status until PUBLISH_COMPLETE.
 * Mocked-HTTP tested only. TikTok forces SELF_ONLY (private) for clients that
 * have not passed its audit, and requires the creator's real privacy options;
 * we never choose a privacy level the creator does not offer.
 */

const API = "https://open.tiktokapis.com";
const MB = 1024 * 1024;
export const CHUNK = 10 * MB;

export const TIKTOK_PRIVACY = ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"] as const;

type Envelope<T> = { data?: T; error?: { code?: string; message?: string; log_id?: string } };

export function classifyTikTokError(status: number, code: string | undefined): FailureKind {
  if (code === "access_token_invalid" || code === "scope_not_authorized" || code === "scope_permission_missed" || status === 401) return "auth";
  if (code === "rate_limit_exceeded" || status === 429) return "rate_limited";
  if (code === "internal_error" || code === "service_unavailable" || status >= 500) return "retryable";
  return "terminal"; // incl. spam_risk_*, unaudited_client_can_only_post_to_private_accounts, invalid_param
}

/** chunk plan per TikTok rules: <10MB single chunk; else floor(size/10MB) chunks, last takes the remainder. */
export function chunkPlan(size: number): { chunkSize: number; count: number } {
  if (size <= CHUNK) return { chunkSize: size, count: 1 };
  return { chunkSize: CHUNK, count: Math.floor(size / CHUNK) };
}

export type TikTokInput = {
  accessToken: string;
  title: string;
  privacy: string;
  sizeBytes: number;
  mimeType: string;
  durationSeconds?: number | null;
  /** Fetches a byte range of the media (inclusive). */
  readRange: (start: number, end: number) => Promise<Uint8Array>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  pollDeadlineMs?: number;
};

const fail = (kind: FailureKind, message: string, extra: Partial<Extract<PublishResult, { ok: false }>> = {}): PublishResult => ({ ok: false, kind, message, ...extra });
const msg = (e: unknown) => (e instanceof Error ? e.message : "unknown error");

export async function publishToTikTok(i: TikTokInput): Promise<PublishResult> {
  const f = i.fetchImpl ?? fetch;
  const sleep = i.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const auth = { authorization: `Bearer ${i.accessToken}`, "content-type": "application/json; charset=UTF-8" };

  async function call<T>(path: string, body: unknown) {
    const res = await f(`${API}${path}`, { method: "POST", headers: auth, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    const json = (await res.json().catch(() => null)) as Envelope<T> | null;
    return { res, json };
  }
  const apiFail = (what: string, res: Response, json: Envelope<unknown> | null) => {
    const code = json?.error?.code;
    return fail(classifyTikTokError(res.status, code), `${what} failed (${res.status}${code ? ` ${code}` : ""}): ${json?.error?.message ?? "no detail"}`.slice(0, 400), { httpStatus: res.status });
  };

  // 1) Creator info: the privacy options and max duration are the creator's, not ours.
  let creator;
  try {
    creator = await call<{ privacy_level_options?: string[]; max_video_post_duration_sec?: number }>("/v2/post/publish/creator_info/query/", {});
  } catch (e) {
    return fail("retryable", `Could not reach TikTok: ${msg(e)}`);
  }
  if (!creator.res.ok || (creator.json?.error?.code && creator.json.error.code !== "ok")) return apiFail("Creator info", creator.res, creator.json);
  const options = creator.json?.data?.privacy_level_options ?? [];
  if (!options.includes(i.privacy)) {
    return fail("terminal", `Privacy "${i.privacy}" is not available for this TikTok account (available: ${options.join(", ") || "none"}).`);
  }
  const maxSec = creator.json?.data?.max_video_post_duration_sec;
  if (maxSec && i.durationSeconds && i.durationSeconds > maxSec) {
    return fail("terminal", `Video is ${Math.round(i.durationSeconds)}s; this TikTok account allows at most ${maxSec}s.`);
  }

  // 2) Init. Nothing is posted yet, so failures here are safe to retry.
  const { chunkSize, count } = chunkPlan(i.sizeBytes);
  let init;
  try {
    init = await call<{ publish_id?: string; upload_url?: string }>("/v2/post/publish/video/init/", {
      post_info: { title: i.title.slice(0, 2200), privacy_level: i.privacy, disable_duet: false, disable_comment: false, disable_stitch: false },
      source_info: { source: "FILE_UPLOAD", video_size: i.sizeBytes, chunk_size: chunkSize, total_chunk_count: count },
    });
  } catch (e) {
    return fail("retryable", `Could not start the upload: ${msg(e)}`);
  }
  if (!init.res.ok || (init.json?.error?.code && init.json.error.code !== "ok")) return apiFail("Upload init", init.res, init.json);
  const publishId = init.json?.data?.publish_id;
  const uploadUrl = init.json?.data?.upload_url;
  if (!publishId || !uploadUrl) return fail("retryable", "TikTok did not return an upload session.");

  // 3) Upload chunks. Before the LAST chunk a failure leaves no post, so it is retryable;
  //    after the last chunk was sent the outcome is ambiguous.
  for (let n = 0; n < count; n++) {
    const start = n * chunkSize;
    const end = n === count - 1 ? i.sizeBytes - 1 : start + chunkSize - 1;
    const last = n === count - 1;
    let bytes: Uint8Array;
    try {
      bytes = await i.readRange(start, end);
    } catch (e) {
      return fail("retryable", `Could not read the media file: ${msg(e)}`);
    }
    try {
      const put = await f(uploadUrl, {
        method: "PUT",
        headers: { "content-type": i.mimeType, "content-length": String(bytes.byteLength), "content-range": `bytes ${start}-${end}/${i.sizeBytes}` },
        body: bytes as unknown as BodyInit,
        signal: AbortSignal.timeout(120_000),
      });
      if (!(put.status === 206 || put.status === 201 || put.status === 200)) {
        return fail(last ? "terminal" : classifyTikTokError(put.status, undefined) === "retryable" ? "retryable" : "terminal", `Chunk ${n + 1}/${count} rejected (${put.status}).`, { httpStatus: put.status });
      }
    } catch (e) {
      return fail(last ? "terminal" : "retryable", last ? `Upload interrupted on the final chunk (${msg(e)}). The outcome is unknown — check TikTok before retrying.` : `Chunk ${n + 1}/${count} failed: ${msg(e)}`);
    }
  }

  // 4) Confirm. Success only on PUBLISH_COMPLETE.
  const deadline = Date.now() + (i.pollDeadlineMs ?? 120_000);
  for (;;) {
    let s;
    try {
      s = await call<{ status?: string; fail_reason?: string; publicaly_available_post_id?: (string | number)[] }>("/v2/post/publish/status/fetch/", { publish_id: publishId });
    } catch (e) {
      return fail("terminal", `Lost contact while confirming (${msg(e)}). The post may still publish — check TikTok before retrying.`);
    }
    if (!s.res.ok) return apiFail("Status check", s.res, s.json);
    const status = s.json?.data?.status;
    if (status === "PUBLISH_COMPLETE") {
      const postId = s.json?.data?.publicaly_available_post_id?.[0];
      return {
        ok: true,
        externalId: publishId,
        externalUrl: postId ? `https://www.tiktok.com/video/${postId}` : "https://www.tiktok.com/",
        summary: { publishId, postId: postId ?? null, privacy: i.privacy },
      };
    }
    if (status === "FAILED") return fail("terminal", `TikTok failed to publish: ${s.json?.data?.fail_reason ?? "unknown reason"}`);
    if (Date.now() >= deadline) {
      return fail("terminal", "TikTok is still processing the video. It may publish later — check TikTok before retrying (retrying could post it twice).");
    }
    await sleep(5_000);
  }
}
