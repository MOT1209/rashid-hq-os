import { describe, expect, it } from "vitest";
import {
  MAX_ATTEMPTS,
  assertTransition,
  backoffMs,
  canTransition,
  idempotencyKey,
  lockExpired,
  manualRetryAllowed,
  nextAfterFailure,
  parseSchedule,
} from "@/lib/social/jobs";
import { PLATFORMS, canPublish } from "@/lib/social/providers";
import { hasErrors, parseHashtags, validateVariant } from "@/lib/social/validation";

describe("job state machine", () => {
  it("allows the documented transitions only", () => {
    expect(canTransition("queued", "running")).toBe(true);
    expect(canTransition("running", "succeeded")).toBe(true);
    expect(canTransition("failed", "queued")).toBe(true);
    expect(canTransition("queued", "succeeded")).toBe(false); // never skip the platform
    expect(canTransition("succeeded", "queued")).toBe(false); // no double publish
    expect(canTransition("cancelled", "queued")).toBe(false);
    expect(() => assertTransition("succeeded", "running")).toThrow(/Illegal/);
  });
});

describe("retry policy", () => {
  it("backs off exponentially and caps", () => {
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(2)).toBe(120_000);
    expect(backoffMs(3)).toBe(240_000);
    expect(backoffMs(30)).toBe(6 * 60 * 60_000);
  });
  it("honours a longer Retry-After", () => {
    expect(backoffMs(1, 600_000)).toBe(600_000);
  });
  it("requeues retryable failures with a future runAt", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const r = nextAfterFailure("retryable", 1, now);
    expect(r.status).toBe("queued");
    expect(r.runAt!.getTime()).toBe(now.getTime() + 60_000);
  });
  it("fails terminal and auth errors immediately", () => {
    const now = new Date();
    expect(nextAfterFailure("terminal", 1, now).status).toBe("failed");
    expect(nextAfterFailure("auth", 1, now).status).toBe("failed");
  });
  it("gives up after MAX_ATTEMPTS", () => {
    expect(nextAfterFailure("retryable", MAX_ATTEMPTS, new Date()).status).toBe("failed");
  });
  it("blocks manual retry of terminal failures", () => {
    expect(manualRetryAllowed("failed", "retryable")).toBe(true);
    expect(manualRetryAllowed("failed", "terminal")).toBe(false);
    expect(manualRetryAllowed("succeeded", null)).toBe(false);
  });
});

describe("locking and idempotency", () => {
  it("is deterministic per variant+account", () => {
    expect(idempotencyKey("v1", "a1")).toBe(idempotencyKey("v1", "a1"));
    expect(idempotencyKey("v1", "a1")).not.toBe(idempotencyKey("v1", "a2"));
  });
  it("treats stale locks as reclaimable", () => {
    const now = new Date("2026-01-01T01:00:00Z");
    expect(lockExpired(null, now)).toBe(true);
    expect(lockExpired("2026-01-01T00:59:00Z", now)).toBe(false);
    expect(lockExpired("2026-01-01T00:00:00Z", now)).toBe(true);
  });
});

describe("parseSchedule", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  it("interprets wall-clock time in the owner's timezone", () => {
    const r = parseSchedule("2026-06-10T09:00", "Asia/Riyadh", now); // UTC+3
    expect(r.ok && r.at.toISOString()).toBe("2026-06-10T06:00:00.000Z");
  });
  it("handles DST (America/New_York, EDT = UTC-4)", () => {
    const r = parseSchedule("2026-07-01T12:00", "America/New_York", now);
    expect(r.ok && r.at.toISOString()).toBe("2026-07-01T16:00:00.000Z");
  });
  it("accepts explicit offsets", () => {
    const r = parseSchedule("2026-06-10T09:00:00+03:00", "UTC", now);
    expect(r.ok && r.at.toISOString()).toBe("2026-06-10T06:00:00.000Z");
  });
  it("rejects the past, bad dates and bad zones", () => {
    expect(parseSchedule("2026-05-01T09:00", "UTC", now).ok).toBe(false);
    expect(parseSchedule("nonsense", "UTC", now).ok).toBe(false);
    expect(parseSchedule("2026-06-10T09:00", "Mars/Base", now).ok).toBe(false);
  });
});

describe("provider registry honesty", () => {
  it("only YouTube is publishable; the rest are declared pending with blockers", () => {
    expect(canPublish("youtube")).toBe(true);
    for (const p of ["facebook", "instagram", "tiktok"] as const) {
      expect(canPublish(p)).toBe(false);
      expect(PLATFORMS[p].blockers.length).toBeGreaterThan(0);
    }
  });
});

describe("validateVariant", () => {
  const video = { kind: "video" as const, mimeType: "video/mp4", sizeBytes: 10_000_000, durationSeconds: 30 };
  it("passes a valid YouTube variant", () => {
    expect(hasErrors(validateVariant({ platform: "youtube", title: "Hi", caption: "d" }, [video]))).toBe(false);
  });
  it("requires title and media, and rejects images for YouTube", () => {
    const codes = validateVariant({ platform: "youtube", title: "" }, []).map((i) => i.code);
    expect(codes).toContain("required");
    const img = { kind: "image" as const, mimeType: "image/png", sizeBytes: 1 };
    expect(validateVariant({ platform: "youtube", title: "x" }, [img]).some((i) => i.code === "unsupported_type")).toBe(true);
  });
  it("enforces length limits and bad mime", () => {
    const issues = validateVariant(
      { platform: "youtube", title: "x".repeat(101), caption: "y".repeat(5001) },
      [{ ...video, mimeType: "application/pdf" }],
    );
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("too_long");
    expect(codes).toContain("bad_mime");
  });
  it("refuses pending platforms", () => {
    expect(validateVariant({ platform: "tiktok", caption: "x" }, [video]).some((i) => i.code === "not_ready")).toBe(true);
  });
});

describe("parseHashtags", () => {
  it("normalises, dedupes and keeps Arabic", () => {
    expect(parseHashtags("#Foo, foo  #بيع bad-tag")).toEqual(["foo", "بيع"]);
  });
});
