import "server-only";

import type { FailureKind } from "@/lib/social/jobs";

/**
 * YouTube Data API v3 upload via the resumable protocol (single streaming PUT).
 * Docs: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
 *
 * Success is returned ONLY when YouTube's response body carries a video id.
 * Exercised against mocked fetch in tests; not yet run against a live channel.
 */

export type PublishInput = {
  accessToken: string;
  title: string;
  description: string;
  tags: string[];
  privacy: "private" | "unlisted" | "public";
  mimeType: string;
  sizeBytes: number;
  /** Streams the media bytes (e.g. a signed storage URL). */
  openMedia: () => Promise<Response>;
  fetchImpl?: typeof fetch;
};

export type PublishResult =
  | { ok: true; externalId: string; externalUrl: string; summary: Record<string, unknown> }
  | {
      ok: false;
      kind: FailureKind;
      message: string;
      httpStatus?: number;
      retryAfterMs?: number;
      summary?: Record<string, unknown>;
    };

const UPLOAD_URL =
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";

/** Maps an HTTP failure from YouTube to a retry class. */
export function classifyYouTubeError(status: number, body: string): { kind: FailureKind; retryAfterMs?: number } {
  const lower = body.toLowerCase();
  if (status === 401) return { kind: "auth" };
  if (status === 403 && (lower.includes("quotaexceeded") || lower.includes("dailylimitexceeded"))) {
    return { kind: "rate_limited", retryAfterMs: 60 * 60_000 };
  }
  if (status === 403 && (lower.includes("forbidden") || lower.includes("insufficientpermissions") || lower.includes("youtubesignuprequired"))) {
    return { kind: "auth" };
  }
  if (status === 429) return { kind: "rate_limited", retryAfterMs: 10 * 60_000 };
  if (status >= 500) return { kind: "retryable" };
  return { kind: "terminal" };
}

export async function publishToYouTube(input: PublishInput): Promise<PublishResult> {
  const f = input.fetchImpl ?? fetch;

  // 1) Start the resumable session. Nothing is public yet; a failure here is
  //    always safe to retry because no video exists.
  let start: Response;
  try {
    start = await f(UPLOAD_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-length": String(input.sizeBytes),
        "x-upload-content-type": input.mimeType,
      },
      body: JSON.stringify({
        snippet: {
          title: input.title.slice(0, 100),
          description: input.description.slice(0, 5000),
          tags: input.tags.slice(0, 15),
        },
        status: { privacyStatus: input.privacy, selfDeclaredMadeForKids: false },
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    return { ok: false, kind: "retryable", message: `Could not reach YouTube: ${errMsg(e)}` };
  }
  if (!start.ok) {
    const body = await safeText(start);
    const c = classifyYouTubeError(start.status, body);
    return { ok: false, ...c, httpStatus: start.status, message: `YouTube rejected the upload request (${start.status}).`, summary: { body: body.slice(0, 500) } };
  }
  const location = start.headers.get("location");
  if (!location) {
    return { ok: false, kind: "retryable", message: "YouTube did not return an upload session URL." };
  }

  // 2) Stream the bytes.
  let media: Response;
  try {
    media = await input.openMedia();
    if (!media.ok || !media.body) throw new Error(`storage returned ${media.status}`);
  } catch (e) {
    return { ok: false, kind: "retryable", message: `Could not read the media file: ${errMsg(e)}` };
  }

  let put: Response;
  try {
    put = await f(location, {
      method: "PUT",
      headers: { "content-type": input.mimeType, "content-length": String(input.sizeBytes) },
      body: media.body,
      // Node/undici requires this for streaming request bodies.
      duplex: "half",
    } as RequestInit);
  } catch (e) {
    // The connection died mid/after the upload: YouTube may or may not have
    // created the video. Retrying blindly could double-post, so this is
    // terminal — the owner verifies on YouTube, then re-queues deliberately.
    return {
      ok: false,
      kind: "terminal",
      message: `Upload interrupted (${errMsg(e)}). The outcome is unknown — check your channel before retrying.`,
    };
  }

  const text = await safeText(put);
  if (!put.ok) {
    const c = classifyYouTubeError(put.status, text);
    // A 5xx on the final PUT is also ambiguous; only treat as retryable when
    // YouTube clearly did not accept the bytes (4xx handled above).
    return { ok: false, ...c, httpStatus: put.status, message: `YouTube rejected the video (${put.status}).`, summary: { body: text.slice(0, 500) } };
  }

  let id: unknown;
  try {
    id = (JSON.parse(text) as { id?: unknown }).id;
  } catch {
    id = undefined;
  }
  if (typeof id !== "string" || !id) {
    // 2xx without an id is NOT a confirmed publication.
    return { ok: false, kind: "terminal", message: "YouTube returned success without a video id; not marking as published.", httpStatus: put.status };
  }
  return {
    ok: true,
    externalId: id,
    externalUrl: `https://www.youtube.com/watch?v=${id}`,
    summary: { videoId: id, privacy: input.privacy },
  };
}

function errMsg(e: unknown) {
  return e instanceof Error ? e.message : "unknown error";
}
async function safeText(r: Response) {
  try {
    return await r.text();
  } catch {
    return "";
  }
}
