import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/errors", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/integrations/connections", () => ({ getFreshAccessToken: vi.fn() }));
vi.mock("@/lib/integrations/providers/meta", () => ({ GRAPH_VERSION: "v21.0" }));
vi.mock("@/lib/supabase/server", () => ({ getServiceSupabase: vi.fn() }));

const { collectForJob } = await import("@/lib/social/analytics");
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const token = async () => "TOK";
const acct = { connection_provider: "youtube_publish", external_id: "UC1", metadata: {} };

describe("collectForJob (mocked HTTP)", () => {
  it("YouTube: reads statistics with the owner's token", async () => {
    const f = vi.fn().mockResolvedValue(json({ items: [{ statistics: { viewCount: "50", likeCount: "5" } }] }));
    const r = await collectForJob({ platform: "youtube", external_id: "vid", owner_id: "o" }, acct, f as never, token);
    expect(r).toMatchObject({ ok: true, data: { metrics: { views: 50, likes: 5 } } });
    expect((f.mock.calls[0][1] as RequestInit).headers).toMatchObject({ authorization: "Bearer TOK" });
  });
  it("surfaces API failures as errors, not zeros", async () => {
    const f = vi.fn().mockResolvedValue(json({}, 403));
    expect(await collectForJob({ platform: "youtube", external_id: "vid", owner_id: "o" }, acct, f as never, token)).toMatchObject({ ok: false });
  });
  it("Facebook: derives the Page token then reads engagement", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json({ data: [{ id: "P1", name: "P", access_token: "PT" }] }))
      .mockResolvedValueOnce(json({ reactions: { summary: { total_count: 7 } }, comments: { summary: { total_count: 1 } } }));
    const r = await collectForJob({ platform: "facebook", external_id: "P1_9", owner_id: "o" }, { ...acct, external_id: "P1" }, f as never, token);
    expect(r).toMatchObject({ ok: true, data: { metrics: { likes: 7, comments: 1 } } });
    expect(String(f.mock.calls[1][0])).toContain("access_token=PT");
  });
  it("Instagram: uses the linked page id from account metadata", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json({ data: [{ id: "P1", name: "P", access_token: "PT" }] }))
      .mockResolvedValueOnce(json({ like_count: 2, comments_count: 0 }));
    const r = await collectForJob({ platform: "instagram", external_id: "M1", owner_id: "o" }, { ...acct, external_id: "IG1", metadata: { page_id: "P1" } }, f as never, token);
    expect(r).toMatchObject({ ok: true, data: { metrics: { likes: 2, comments: 0 } } });
  });
  it("reports unsupported platforms and token failures", async () => {
    expect((await collectForJob({ platform: "tiktok", external_id: "x", owner_id: "o" }, acct, vi.fn() as never, token)).ok).toBe(false);
    const bad = async () => { throw new Error("no connection"); };
    expect((await collectForJob({ platform: "youtube", external_id: "v", owner_id: "o" }, acct, vi.fn() as never, bad)).ok).toBe(false);
  });
});
