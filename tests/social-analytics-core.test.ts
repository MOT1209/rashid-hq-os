import { describe, expect, it } from "vitest";
import { collectFacebook, collectInstagram, collectYouTube, delta, engagementRate, shouldCollect, toCount } from "@/lib/social/analytics-core";

const t = (s: string) => new Date(s);

describe("shouldCollect cadence", () => {
  const pub = t("2026-01-01T00:00:00Z");
  it("collects immediately when there is no snapshot", () => expect(shouldCollect(null, pub, t("2026-01-01T01:00:00Z"))).toBe(true));
  it("every 6h in the first 2 days", () => {
    expect(shouldCollect(t("2026-01-01T10:00:00Z"), pub, t("2026-01-01T14:00:00Z"))).toBe(false);
    expect(shouldCollect(t("2026-01-01T10:00:00Z"), pub, t("2026-01-01T16:00:00Z"))).toBe(true);
  });
  it("daily until day 7, every 3 days until 30, then never", () => {
    expect(shouldCollect(t("2026-01-04T00:00:00Z"), pub, t("2026-01-04T12:00:00Z"))).toBe(false);
    expect(shouldCollect(t("2026-01-04T00:00:00Z"), pub, t("2026-01-05T01:00:00Z"))).toBe(true);
    expect(shouldCollect(t("2026-01-10T00:00:00Z"), pub, t("2026-01-12T00:00:00Z"))).toBe(false);
    expect(shouldCollect(t("2026-01-10T00:00:00Z"), pub, t("2026-01-13T01:00:00Z"))).toBe(true);
    expect(shouldCollect(null, pub, t("2026-03-01T00:00:00Z"))).toBe(false);
  });
});

describe("metric rules", () => {
  it("toCount rejects junk", () => {
    expect(toCount("12")).toBe(12);
    expect(toCount(-1)).toBeUndefined();
    expect(toCount("abc")).toBeUndefined();
    expect(toCount(undefined)).toBeUndefined();
  });
  it("engagement rate needs real views", () => {
    expect(engagementRate({ likes: 5 })).toBeNull();
    expect(engagementRate({ views: 0, likes: 5 })).toBeNull();
    expect(engagementRate({ views: 100, likes: 5, comments: 5 })).toBe(0.1);
  });
  it("delta is null when a side is missing", () => {
    expect(delta({ views: 10 }, { views: 15 }, "views")).toBe(5);
    expect(delta(null, { views: 15 }, "views")).toBeNull();
    expect(delta({ likes: 1 }, { views: 15 }, "views")).toBeNull();
  });
});

describe("platform collectors never fabricate", () => {
  it("YouTube: maps statistics, flags hidden likes and unsupported watch time", () => {
    const r = collectYouTube({ items: [{ statistics: { viewCount: "1200", commentCount: "4" } }] });
    expect(r.metrics).toEqual({ views: 1200, comments: 4 });
    expect(r.metrics.likes).toBeUndefined();
    expect(r.unsupported.join(" ")).toMatch(/watch_time/);
    expect(r.unsupported.join(" ")).toMatch(/likes/);
  });
  it("YouTube: missing item means nothing is claimed", () => {
    expect(collectYouTube({ items: [] }).metrics).toEqual({});
  });
  it("Facebook: reactions/comments/shares only; views and reach unsupported", () => {
    const r = collectFacebook({ reactions: { summary: { total_count: 9 } }, comments: { summary: { total_count: 2 } } });
    expect(r.metrics).toEqual({ likes: 9, comments: 2 });
    expect(r.unsupported.join(" ")).toMatch(/views/);
    expect(r.unsupported.join(" ")).toMatch(/shares/);
  });
  it("Instagram: likes/comments only", () => {
    const r = collectInstagram({ like_count: 3, comments_count: 1 });
    expect(r.metrics).toEqual({ likes: 3, comments: 1 });
    expect(r.unsupported.join(" ")).toMatch(/reach/);
  });
});
