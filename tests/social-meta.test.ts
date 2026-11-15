import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/integrations/providers/meta", () => ({ GRAPH_VERSION: "v21.0" }));
const { publishToFacebook, publishToInstagram, classifyMetaError } = await import("@/lib/social/adapters/meta");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const accounts = () => json({ data: [{ id: "P1", name: "Page", access_token: "PAGE_TOK", instagram_business_account: { id: "IG1" } }] });
const noSleep = async () => {};

describe("Facebook adapter (mocked HTTP)", () => {
  it("publishes a video via the Page token and confirms with the returned id", async () => {
    const f = vi.fn().mockResolvedValueOnce(accounts()).mockResolvedValueOnce(json({ id: "vid9" }));
    const r = await publishToFacebook({ userToken: "U", externalId: "P1", caption: "hi", media: { kind: "video", url: "https://s/x" }, fetchImpl: f as never });
    expect(r).toMatchObject({ ok: true, externalId: "vid9" });
    const body = String((f.mock.calls[1][1] as RequestInit).body);
    expect(body).toContain("access_token=PAGE_TOK");
    expect(body).not.toContain("access_token=U");
    expect(f.mock.calls[1][0]).toContain("/P1/videos");
  });
  it("fails auth when the Page is not accessible", async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ data: [] }));
    expect(await publishToFacebook({ userToken: "U", externalId: "P1", caption: "x", media: null, fetchImpl: f as never })).toMatchObject({ ok: false, kind: "auth" });
  });
  it("does not count a 2xx without an id as published", async () => {
    const f = vi.fn().mockResolvedValueOnce(accounts()).mockResolvedValueOnce(json({}));
    expect((await publishToFacebook({ userToken: "U", externalId: "P1", caption: "x", media: null, fetchImpl: f as never })).ok).toBe(false);
  });
  it("treats a dropped publish request as terminal (outcome unknown)", async () => {
    const f = vi.fn().mockResolvedValueOnce(accounts()).mockRejectedValueOnce(new Error("reset"));
    expect(await publishToFacebook({ userToken: "U", externalId: "P1", caption: "x", media: null, fetchImpl: f as never })).toMatchObject({ ok: false, kind: "terminal" });
  });
});

describe("Instagram adapter (mocked HTTP)", () => {
  const base = { userToken: "U", externalId: "IG1", pageId: "P1", caption: "c", media: { kind: "video" as const, url: "https://s/x" }, sleep: noSleep };

  it("creates a container, waits for FINISHED, publishes, and returns the permalink", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(accounts())
      .mockResolvedValueOnce(json({ id: "C1" }))
      .mockResolvedValueOnce(json({ status_code: "IN_PROGRESS" }))
      .mockResolvedValueOnce(json({ status_code: "FINISHED" }))
      .mockResolvedValueOnce(json({ id: "M1" }))
      .mockResolvedValueOnce(json({ permalink: "https://www.instagram.com/reel/abc/" }));
    const r = await publishToInstagram({ ...base, fetchImpl: f as never });
    expect(r).toMatchObject({ ok: true, externalId: "M1", externalUrl: "https://www.instagram.com/reel/abc/" });
    expect(String((f.mock.calls[1][1] as RequestInit).body)).toContain("media_type=REELS");
  });
  it("fails terminally when processing errors", async () => {
    const f = vi.fn().mockResolvedValueOnce(accounts()).mockResolvedValueOnce(json({ id: "C1" })).mockResolvedValueOnce(json({ status_code: "ERROR", status: "bad codec" }));
    expect(await publishToInstagram({ ...base, fetchImpl: f as never })).toMatchObject({ ok: false, kind: "terminal" });
  });
  it("is retryable (and publishes nothing) when processing outlasts the deadline", async () => {
    const f = vi.fn().mockResolvedValueOnce(accounts()).mockResolvedValueOnce(json({ id: "C1" })).mockResolvedValue(json({ status_code: "IN_PROGRESS" }));
    const r = await publishToInstagram({ ...base, pollDeadlineMs: -1, fetchImpl: f as never });
    expect(r).toMatchObject({ ok: false, kind: "retryable" });
    expect(f.mock.calls.some((c) => String(c[0]).includes("media_publish"))).toBe(false);
  });
  it("a dropped media_publish is terminal (possible duplicate)", async () => {
    const f = vi.fn().mockResolvedValueOnce(accounts()).mockResolvedValueOnce(json({ id: "C1" })).mockResolvedValueOnce(json({ status_code: "FINISHED" })).mockRejectedValueOnce(new Error("reset"));
    expect(await publishToInstagram({ ...base, fetchImpl: f as never })).toMatchObject({ ok: false, kind: "terminal" });
  });
  it("requires media and a linked page", async () => {
    expect((await publishToInstagram({ ...base, media: null })).ok).toBe(false);
    expect((await publishToInstagram({ ...base, pageId: "" })).ok).toBe(false);
  });
});

describe("classifyMetaError", () => {
  it("maps Graph codes", () => {
    expect(classifyMetaError(400, { error: { code: 190 } }).kind).toBe("auth");
    expect(classifyMetaError(403, { error: { code: 200 } }).kind).toBe("auth");
    expect(classifyMetaError(400, { error: { code: 4 } }).kind).toBe("rate_limited");
    expect(classifyMetaError(500, null).kind).toBe("retryable");
    expect(classifyMetaError(400, { error: { code: 100 } }).kind).toBe("terminal");
  });
});
