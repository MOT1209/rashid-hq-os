import { describe, expect, it } from "vitest";
import { matchProjects, normalize } from "@/lib/search";

/**
 * Project names here are Arabic as often as English, and the alef/ya/ta-marbuta
 * variants are typed interchangeably — a search that only matches the exact
 * codepoint someone happened to save looks broken rather than strict.
 */

const p = (name: string) => ({ id: name, name });
const names = (rows: { name: string }[]) => rows.map((r) => r.name);

describe("normalize", () => {
  it("folds case", () => {
    expect(normalize("EDITOR.AI")).toBe(normalize("editor.ai"));
  });

  it("folds the alef variants", () => {
    for (const variant of ["آ", "أ", "إ", "ٱ"]) {
      expect(normalize(variant), variant).toBe("ا");
    }
  });

  it("folds ya and ta marbuta", () => {
    expect(normalize("ى")).toBe("ي");
    expect(normalize("ة")).toBe("ه");
  });

  it("drops harakat and tatweel", () => {
    expect(normalize("مَشْرُوع")).toBe("مشروع");
    expect(normalize("مشـــروع")).toBe("مشروع");
  });

  it("trims surrounding whitespace", () => {
    expect(normalize("  app  ")).toBe("app");
  });
});

describe("matchProjects", () => {
  const projects = [p("Englisch-app"), p("conecter-app"), p("EDITOR.AI"), p("مشروع التسويق")];

  it("returns nothing for an empty or whitespace query", () => {
    expect(matchProjects(projects, "")).toEqual([]);
    expect(matchProjects(projects, "   ")).toEqual([]);
  });

  it("matches on a substring, not just a prefix", () => {
    expect(names(matchProjects(projects, "app"))).toContain("Englisch-app");
  });

  it("ranks a prefix match ahead of a mid-name match", () => {
    // "conecter-app" starts with the query; "Englisch-app" only contains it.
    expect(names(matchProjects(projects, "con"))[0]).toBe("conecter-app");
  });

  it("orders ties alphabetically rather than by input order", () => {
    const shuffled = [p("beta"), p("alpha"), p("gamma")];
    expect(names(matchProjects(shuffled, "a"))).toEqual(["alpha", "beta", "gamma"]);
  });

  it("is case insensitive", () => {
    expect(names(matchProjects(projects, "editor"))).toEqual(["EDITOR.AI"]);
  });

  it("matches Arabic across alef and ta-marbuta spelling differences", () => {
    const rows = [p("إدارة المشاريع")];
    expect(names(matchProjects(rows, "اداره"))).toEqual(["إدارة المشاريع"]);
  });

  it("matches a name that carries harakat when the query does not", () => {
    expect(names(matchProjects([p("مَشْرُوع")], "مشروع"))).toEqual(["مَشْرُوع"]);
  });

  it("returns nothing when there is no match", () => {
    expect(matchProjects(projects, "zzz")).toEqual([]);
  });

  it("caps the list so it stays a jump list", () => {
    const many = Array.from({ length: 30 }, (_, i) => p(`project-${i}`));
    expect(matchProjects(many, "project")).toHaveLength(8);
  });
});
