import { describe, expect, it } from "vitest";
import { addDays, addMonths, groupByDay, localDateKey, monthGrid, startOfWeek, toLocalInput, weekDays } from "@/lib/social/calendar";
import { parseSchedule } from "@/lib/social/jobs";

describe("calendar math", () => {
  it("adds days/months across boundaries (leap year too)", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-01");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-01");
  });
  it("week starts respect the locale choice", () => {
    expect(startOfWeek("2026-11-18", 0)).toBe("2026-11-15"); // Wed -> Sunday
    expect(startOfWeek("2026-11-18", 6)).toBe("2026-11-14"); // Wed -> Saturday
    expect(weekDays("2026-11-18", 6)).toHaveLength(7);
  });
  it("month grid covers the whole month in full weeks", () => {
    const g = monthGrid("2026-11-10", 0);
    expect(g.every((w) => w.length === 7)).toBe(true);
    const flat = g.flat();
    expect(flat).toContain("2026-11-01");
    expect(flat).toContain("2026-11-30");
    expect(flat[0] <= "2026-11-01").toBe(true);
  });
});

describe("timezone bucketing", () => {
  it("assigns the same instant to different days per timezone", () => {
    const iso = "2026-06-10T22:30:00Z";
    expect(localDateKey(iso, "UTC")).toBe("2026-06-10");
    expect(localDateKey(iso, "Asia/Riyadh")).toBe("2026-06-11"); // UTC+3
    expect(localDateKey(iso, "America/New_York")).toBe("2026-06-10");
  });
  it("groups and orders jobs by local day", () => {
    const m = groupByDay([{ run_at: "2026-06-10T22:30:00Z" }, { run_at: "2026-06-10T01:00:00Z" }], "Asia/Riyadh");
    expect([...m.keys()]).toEqual(["2026-06-10", "2026-06-11"]);
  });
  it("round-trips a wall-clock time through parseSchedule", () => {
    const tz = "Asia/Riyadh";
    const parsed = parseSchedule("2026-12-05T18:30", tz, new Date("2026-01-01T00:00:00Z"));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(toLocalInput(parsed.at.toISOString(), tz)).toBe("2026-12-05T18:30");
  });
});
