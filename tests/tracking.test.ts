import { describe, expect, it } from "vitest";
import {
  cellKey,
  clampScore,
  getCell,
  memberStats,
  nextCellValue,
  parseImportNames,
  summariseRegister,
  type TrackedMember,
} from "@/lib/tracking";

function member(overrides: Partial<TrackedMember> = {}): TrackedMember {
  return {
    id: "m1",
    name: "Rashid",
    cells: {},
    quizzes: [0, 0, 0, 0, 0],
    ...overrides,
  };
}

describe("cell toggle cycle", () => {
  it("cycles 0 -> 1 -> 2 -> 0 like the HTML toggleCellState", () => {
    expect(nextCellValue(0)).toBe(1);
    expect(nextCellValue(1)).toBe(2);
    expect(nextCellValue(2)).toBe(0);
  });

  it("reads an absent cell as 0", () => {
    expect(getCell(member(), 1, "c")).toBe(0);
    expect(cellKey(2, "t")).toBe("2:t");
  });
});

describe("clampScore", () => {
  it("pins quizzes to 0..10 like updateQuizScore", () => {
    expect(clampScore(-3)).toBe(0);
    expect(clampScore(11)).toBe(10);
    expect(clampScore(Number.NaN)).toBe(0);
    expect(clampScore(9.5)).toBe(9.5);
  });
});

describe("memberStats", () => {
  it("counts done/missed and completion over 16 cells", () => {
    const m = member({ cells: { "1:c": 1, "1:t": 1, "2:c": 2 } });
    const s = memberStats(m);
    expect(s.done).toBe(2);
    expect(s.missed).toBe(1);
    // 2/16 = 12.5% -> rounds to 13, matching Math.round in the HTML.
    expect(s.completionPct).toBe(13);
  });

  it("averages quizzes to one decimal", () => {
    const s = memberStats(member({ quizzes: [10, 9, 8, 7, 6] }));
    expect(s.avgQuiz).toBe(8);
  });
});

describe("summariseRegister", () => {
  it("returns zeros for an empty register", () => {
    expect(summariseRegister([])).toEqual({
      total: 0,
      completionPct: 0,
      avgQuiz: 0,
      topPerformer: "",
    });
  });

  it("picks the top performer by done*2 + quizSum", () => {
    const a = member({ name: "A", cells: { "1:c": 1 }, quizzes: [10, 10, 10, 10, 10] });
    const b = member({
      name: "B",
      cells: { "1:c": 1, "1:t": 1, "1:b": 1, "1:h": 1 },
      quizzes: [5, 5, 5, 5, 5],
    });
    const summary = summariseRegister([a, b]);
    expect(summary.total).toBe(2);
    // done total 5 / 32 = 15.6% -> 16.
    expect(summary.completionPct).toBe(16);
    expect(summary.topPerformer).toBe("A");
  });
});

describe("parseImportNames", () => {
  it("splits name and role on a dash", () => {
    expect(parseImportNames("Rashid - وزير الطاقم\nAhmad")).toEqual([
      { name: "Rashid", role: "وزير الطاقم" },
      { name: "Ahmad", role: "" },
    ]);
  });

  it("drops blank lines", () => {
    expect(parseImportNames("\n  \nAli\n")).toEqual([{ name: "Ali", role: "" }]);
  });
});
