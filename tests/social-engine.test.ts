import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/integrations/connections", () => ({ getFreshAccessToken: vi.fn(), markConnectionError: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getServiceSupabase: vi.fn() }));

const { processJob } = await import("@/lib/social/engine");
const { publishToYouTube, classifyYouTubeError } = await import("@/lib/social/adapters/youtube");

const job = (over: Record<string, unknown> = {}) =>
  ({
    id: "j1", owner_id: "o", content_id: "c", variant_id: "v", account_id: "a",
    platform: "youtube", status: "running", attempts: 1, ...over,
  }) as never;

const ctx = (over: Record<string, unknown> = {}) =>
  ({
    content: { title: "T", caption: "c", hashtags: [] },
    variant: { title: null, caption: null, hashtags: null, options: {} },
    account: { status: "active", connection_provider: "youtube_publish" },
    assets: [{ kind: "video", mime_type: "video/mp4", size_bytes: 100, duration_seconds: 10, storage_bucket: "b", storage_path: "p" }],
    ...over,
  }) as never;

function deps(publish: () => unknown, context: unknown = ctx()) {
  const finalize = vi.fn();
  const finishAttempt = vi.fn();
  return {
    finalize,
    finishAttempt,
    deps: {
      now: () => new Date("2026-01-01T00:00:00Z"),
      loadContext: async () => context,
      publish: async () => publish(),
      startAttempt: vi.fn(),
      finishAttempt,
      finalize,
      audit: vi.fn(),
    } as never,
  };
}

describe("processJob", () => {
  it("marks success only with the platform-confirmed id", async () => {
    const d = deps(() => ({ ok: true, externalId: "vid1", externalUrl: "https://y/vid1", summary: {} }));
    expect(await processJob(job(), d.deps)).toBe("succeeded");
    expect(d.finalize.mock.calls[0][1]).toMatchObject({ status: "succeeded", external_id: "vid1" });
  });

  it("requeues a retryable failure with backoff", async () => {
    const d = deps(() => ({ ok: false, kind: "retryable", message: "503" }));
    expect(await processJob(job(), d.deps)).toBe("requeued");
    const patch = d.finalize.mock.calls[0][1];
    expect(patch.status).toBe("queued");
    expect(patch.run_at).toBe("2026-01-01T00:01:00.000Z");
  });

  it("fails auth errors without retry", async () => {
    const d = deps(() => ({ ok: false, kind: "auth", message: "revoked" }));
    expect(await processJob(job(), d.deps)).toBe("failed");
    expect(d.finalize.mock.calls[0][1].status).toBe("failed");
  });

  it("gives up after the max attempts", async () => {
    const d = deps(() => ({ ok: false, kind: "retryable", message: "x" }));
    expect(await processJob(job({ attempts: 5 }), d.deps)).toBe("failed");
  });

  it("refuses pending platforms and never calls an adapter", async () => {
    const publish = vi.fn();
    const d = deps(publish);
    expect(await processJob(job({ platform: "tiktok" }), d.deps)).toBe("failed");
    expect(publish).not.toHaveBeenCalled();
  });

  it("fails validation before publishing", async () => {
    const publish = vi.fn();
    const d = deps(publish, ctx({ content: { title: "", caption: "", hashtags: [] } }));
    expect(await processJob(job(), d.deps)).toBe("failed");
    expect(publish).not.toHaveBeenCalled();
  });

  it("treats an adapter exception as terminal (possible double-post)", async () => {
    const d = deps(() => {
      throw new Error("boom");
    });
    expect(await processJob(job(), d.deps)).toBe("failed");
    expect(d.finalize.mock.calls[0][1].error_kind).toBe("terminal");
  });

  it("fails when the account is disabled or data is gone", async () => {
    expect(await processJob(job(), deps(() => ({}), ctx({ account: { status: "disabled" } })).deps)).toBe("failed");
    expect(await processJob(job(), deps(() => ({}), null).deps)).toBe("failed");
  });
});

describe("YouTube adapter (mocked HTTP)", () => {
  const base = {
    accessToken: "tok", title: "T", description: "d", tags: [], privacy: "private" as const,
    mimeType: "video/mp4", sizeBytes: 3,
    openMedia: async () => new Response(new Blob(["abc"]).stream()),
  };

  it("confirms publication from the response id", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 200, headers: { location: "https://upload/x" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "abc123" }), { status: 200 }));
    const r = await publishToYouTube({ ...base, fetchImpl: f as never });
    expect(r).toMatchObject({ ok: true, externalId: "abc123", externalUrl: "https://www.youtube.com/watch?v=abc123" });
    expect(f.mock.calls[0][1].headers.authorization).toBe("Bearer tok");
  });

  it("does not count 2xx without an id as published", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 200, headers: { location: "https://upload/x" } }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const r = await publishToYouTube({ ...base, fetchImpl: f as never });
    expect(r.ok).toBe(false);
  });

  it("treats a dropped upload connection as terminal (outcome unknown)", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 200, headers: { location: "https://upload/x" } }))
      .mockRejectedValueOnce(new Error("socket hang up"));
    const r = await publishToYouTube({ ...base, fetchImpl: f as never });
    expect(r).toMatchObject({ ok: false, kind: "terminal" });
  });

  it("a failure before bytes are sent is retryable", async () => {
    const f = vi.fn().mockRejectedValueOnce(new Error("ECONNRESET"));
    expect(await publishToYouTube({ ...base, fetchImpl: f as never })).toMatchObject({ ok: false, kind: "retryable" });
  });

  it("classifies errors", () => {
    expect(classifyYouTubeError(401, "").kind).toBe("auth");
    expect(classifyYouTubeError(403, '{"reason":"quotaExceeded"}').kind).toBe("rate_limited");
    expect(classifyYouTubeError(429, "").kind).toBe("rate_limited");
    expect(classifyYouTubeError(503, "").kind).toBe("retryable");
    expect(classifyYouTubeError(400, "").kind).toBe("terminal");
  });
});
