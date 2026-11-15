import { describe, expect, it, vi } from "vitest";

const { publishToTikTok, classifyTikTokError, chunkPlan, CHUNK } = await import("@/lib/social/adapters/tiktok");

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const ok = { error: { code: "ok" } };
const creator = (opts = ["SELF_ONLY", "PUBLIC_TO_EVERYONE"], max = 600) => json({ data: { privacy_level_options: opts, max_video_post_duration_sec: max }, ...ok });
const init = () => json({ data: { publish_id: "pub1", upload_url: "https://upload.tiktok/x" }, ...ok });
const status = (s: string, extra = {}) => json({ data: { status: s, ...extra }, ...ok });
const put = (code = 201) => new Response("", { status: code });

const base = (f: unknown, over = {}) => ({
  accessToken: "T", title: "hi", privacy: "SELF_ONLY", sizeBytes: 1000, mimeType: "video/mp4", durationSeconds: 10,
  readRange: async (s: number, e: number) => new Uint8Array(e - s + 1),
  fetchImpl: f as never, sleep: async () => {}, ...over,
});

describe("chunk plan", () => {
  it("single chunk for small files; floor(size/10MB) chunks for big ones", () => {
    expect(chunkPlan(1000)).toEqual({ chunkSize: 1000, count: 1 });
    expect(chunkPlan(CHUNK * 3 + 5)).toEqual({ chunkSize: CHUNK, count: 3 });
  });
});

describe("TikTok adapter (mocked HTTP)", () => {
  it("publishes: creator info → init → upload → PUBLISH_COMPLETE", async () => {
    const f = vi.fn().mockResolvedValueOnce(creator()).mockResolvedValueOnce(init()).mockResolvedValueOnce(put())
      .mockResolvedValueOnce(status("PROCESSING_UPLOAD")).mockResolvedValueOnce(status("PUBLISH_COMPLETE", { publicaly_available_post_id: [777] }));
    const r = await publishToTikTok(base(f));
    expect(r).toMatchObject({ ok: true, externalId: "pub1", externalUrl: "https://www.tiktok.com/video/777" });
    const putCall = f.mock.calls[2];
    expect((putCall[1] as RequestInit).headers).toMatchObject({ "content-range": "bytes 0-999/1000" });
  });
  it("refuses a privacy level the creator does not offer, before posting anything", async () => {
    const f = vi.fn().mockResolvedValueOnce(creator(["SELF_ONLY"]));
    const r = await publishToTikTok(base(f, { privacy: "PUBLIC_TO_EVERYONE" }));
    expect(r).toMatchObject({ ok: false, kind: "terminal" });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("rejects videos longer than the creator allows", async () => {
    const f = vi.fn().mockResolvedValueOnce(creator(["SELF_ONLY"], 60));
    expect(await publishToTikTok(base(f, { durationSeconds: 120 }))).toMatchObject({ ok: false, kind: "terminal" });
  });
  it("maps API error codes (unaudited client is terminal, token errors are auth)", async () => {
    const f = vi.fn().mockResolvedValueOnce(creator()).mockResolvedValueOnce(json({ error: { code: "unaudited_client_can_only_post_to_private_accounts", message: "x" } }, 403));
    expect(await publishToTikTok(base(f))).toMatchObject({ ok: false, kind: "terminal" });
    expect(classifyTikTokError(401, "access_token_invalid")).toBe("auth");
    expect(classifyTikTokError(429, "rate_limit_exceeded")).toBe("rate_limited");
    expect(classifyTikTokError(500, "internal_error")).toBe("retryable");
  });
  it("FAILED status is terminal and carries the reason", async () => {
    const f = vi.fn().mockResolvedValueOnce(creator()).mockResolvedValueOnce(init()).mockResolvedValueOnce(put()).mockResolvedValueOnce(status("FAILED", { fail_reason: "file_format_check_failed" }));
    const r = await publishToTikTok(base(f));
    expect(r).toMatchObject({ ok: false, kind: "terminal" });
    expect((r as { message: string }).message).toContain("file_format_check_failed");
  });
  it("a still-processing video at the deadline is terminal (could duplicate on retry)", async () => {
    const f = vi.fn().mockResolvedValueOnce(creator()).mockResolvedValueOnce(init()).mockResolvedValueOnce(put()).mockResolvedValue(status("PROCESSING_UPLOAD"));
    expect(await publishToTikTok(base(f, { pollDeadlineMs: -1 }))).toMatchObject({ ok: false, kind: "terminal" });
  });
  it("a failure before the last chunk is retryable; on the last chunk it is terminal", async () => {
    const big = CHUNK * 2 + 10;
    const mid = vi.fn().mockResolvedValueOnce(creator()).mockResolvedValueOnce(init()).mockRejectedValueOnce(new Error("reset"));
    expect(await publishToTikTok(base(mid, { sizeBytes: big }))).toMatchObject({ ok: false, kind: "retryable" });
    const lastF = vi.fn().mockResolvedValueOnce(creator()).mockResolvedValueOnce(init()).mockResolvedValueOnce(put(206)).mockRejectedValueOnce(new Error("reset"));
    expect(await publishToTikTok(base(lastF, { sizeBytes: big }))).toMatchObject({ ok: false, kind: "terminal" });
  });
  it("splits a large file into ranges with the remainder on the last chunk", async () => {
    const size = CHUNK * 2 + 10;
    const ranges: [number, number][] = [];
    const f = vi.fn().mockResolvedValueOnce(creator()).mockResolvedValueOnce(init()).mockResolvedValueOnce(put(206)).mockResolvedValueOnce(put(201)).mockResolvedValueOnce(status("PUBLISH_COMPLETE"));
    await publishToTikTok(base(f, { sizeBytes: size, readRange: async (s: number, e: number) => { ranges.push([s, e]); return new Uint8Array(e - s + 1); } }));
    expect(ranges).toEqual([[0, CHUNK - 1], [CHUNK, size - 1]]);
  });
});
