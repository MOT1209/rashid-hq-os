import { describe, expect, it } from "vitest";
import { isValidTimeZone, minGapMinutes, nextCronRun, parseCron, zonedToUtc } from "@/lib/automation/cron";

const iso = (d: Date | null) => d?.toISOString() ?? null;

describe("parseCron", () => {
  it("parses lists, ranges, steps and Sunday=7", () => {
    const s = parseCron("*/15 9-11 1,15 * 7");
    expect(s.minutes).toEqual([0, 15, 30, 45]);
    expect(s.hours).toEqual([9, 10, 11]);
    expect([...s.dom]).toEqual([1, 15]);
    expect([...s.dow]).toEqual([0]);
  });
  it("rejects malformed expressions", () => {
    for (const bad of ["* * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "* * * 13 *", "*/0 * * * *", "a * * * *", "5-1 * * * *", "* * * * 8"]) {
      expect(() => parseCron(bad), bad).toThrow();
    }
  });
});

describe("nextCronRun", () => {
  it("every day at 09:00 UTC", () => {
    expect(iso(nextCronRun("0 9 * * *", new Date("2026-03-01T08:00:00Z"), "UTC"))).toBe("2026-03-01T09:00:00.000Z");
    expect(iso(nextCronRun("0 9 * * *", new Date("2026-03-01T09:00:00Z"), "UTC"))).toBe("2026-03-02T09:00:00.000Z"); // strictly after
  });
  it("respects the timezone (Riyadh = UTC+3)", () => {
    expect(iso(nextCronRun("30 18 * * *", new Date("2026-03-01T00:00:00Z"), "Asia/Riyadh"))).toBe("2026-03-01T15:30:00.000Z");
  });
  it("weekday and month restrictions; Vixie OR when both dom and dow are set", () => {
    // Mondays 08:00 (2026-03-02 is a Monday)
    expect(iso(nextCronRun("0 8 * * 1", new Date("2026-03-01T00:00:00Z"), "UTC"))).toBe("2026-03-02T08:00:00.000Z");
    // 13th OR Friday: first match after 2026-03-01 is Friday the 6th
    expect(iso(nextCronRun("0 0 13 * 5", new Date("2026-03-01T00:00:00Z"), "UTC"))).toBe("2026-03-06T00:00:00.000Z");
    expect(iso(nextCronRun("0 0 1 6 *", new Date("2026-03-01T00:00:00Z"), "UTC"))).toBe("2026-06-01T00:00:00.000Z");
  });
  it("handles year rollover and Feb 29", () => {
    expect(iso(nextCronRun("0 0 1 1 *", new Date("2026-06-01T00:00:00Z"), "UTC"))).toBe("2027-01-01T00:00:00.000Z");
    expect(iso(nextCronRun("0 0 29 2 *", new Date("2026-03-01T00:00:00Z"), "UTC"))).toBe("2028-02-29T00:00:00.000Z");
  });
  it("is DST-aware (New York: EST until Mar 8 2026, then EDT)", () => {
    expect(iso(nextCronRun("0 9 * * *", new Date("2026-03-07T00:00:00Z"), "America/New_York"))).toBe("2026-03-07T14:00:00.000Z"); // UTC-5
    expect(iso(nextCronRun("0 9 * * *", new Date("2026-03-09T00:00:00Z"), "America/New_York"))).toBe("2026-03-09T13:00:00.000Z"); // UTC-4
  });
  it("skips a local time that does not exist (spring-forward gap)", () => {
    // 02:30 on 2026-03-08 does not exist in New York; next valid is the 9th.
    expect(iso(nextCronRun("30 2 * * *", new Date("2026-03-08T00:00:00Z"), "America/New_York"))).toBe("2026-03-09T06:30:00.000Z");
  });
  it("returns null for an impossible date", () => {
    expect(nextCronRun("0 0 31 2 *", new Date("2026-01-01T00:00:00Z"), "UTC")).toBeNull();
  });
});

describe("helpers", () => {
  it("zonedToUtc and timezone validation", () => {
    expect(zonedToUtc(2026, 6, 1, 12, 0, "Asia/Riyadh")).toBe(Date.UTC(2026, 5, 1, 9, 0));
    expect(zonedToUtc(2026, 3, 8, 2, 30, "America/New_York")).toBeNull();
    expect(isValidTimeZone("Asia/Riyadh")).toBe(true);
    expect(isValidTimeZone("Mars/Base")).toBe(false);
  });
  it("minGapMinutes", () => {
    expect(minGapMinutes("*/5 * * * *", "UTC", new Date("2026-01-01T00:00:00Z"))).toBe(5);
    expect(minGapMinutes("0 * * * *", "UTC", new Date("2026-01-01T00:00:00Z"))).toBe(60);
    expect(minGapMinutes("* * * * *", "UTC", new Date("2026-01-01T00:00:00Z"))).toBe(1);
  });
});
