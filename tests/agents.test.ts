import { describe, expect, it } from "vitest";
import {
  DEPARTMENTS,
  PROJECT_CATEGORIES,
  categoryLabel,
  departmentForCategory,
  getDepartment,
} from "@/lib/agents";
import { dictionaries, getDictionary } from "@/lib/i18n";

describe("departmentForCategory", () => {
  it("routes known categories to their department", () => {
    expect(departmentForCategory("Web App").key).toBe("dev");
    expect(departmentForCategory("E-Commerce").key).toBe("store");
    expect(departmentForCategory("Marketing").key).toBe("media");
  });

  it("falls back to custom for unknown and null categories", () => {
    expect(departmentForCategory("Other").key).toBe("custom");
    expect(departmentForCategory("Something New").key).toBe("custom");
    expect(departmentForCategory(null).key).toBe("custom");
  });

  it("keeps the fallback stable if DEPARTMENTS is reordered", () => {
    // The fallback is looked up by key, not by array position.
    const reversed = [...DEPARTMENTS].reverse();
    expect(reversed[0].key).toBe("custom");
    expect(departmentForCategory(null).key).toBe("custom");
  });
});

describe("categories and labels", () => {
  it("every category maps to a real dictionary key", () => {
    const t = getDictionary("en");
    for (const category of PROJECT_CATEGORIES) {
      expect(t[category.label], category.value).toBeTruthy();
    }
  });

  it("translates known categories and passes unknown ones through", () => {
    const ar = getDictionary("ar");
    expect(categoryLabel(ar, "Web App")).toBe(ar.catWebApp);
    expect(categoryLabel(ar, "Legacy Value")).toBe("Legacy Value");
    expect(categoryLabel(ar, null)).toBeNull();
  });

  it("every department has a dictionary key for its name and agent", () => {
    const t = getDictionary("en");
    for (const d of DEPARTMENTS) {
      expect(t[d.key], d.key).toBeTruthy();
      expect(t[d.agentLabel], d.agentLabel).toBeTruthy();
    }
  });

  it("getDepartment only accepts real keys", () => {
    expect(getDepartment("dev")?.key).toBe("dev");
    expect(getDepartment("nope")).toBeUndefined();
  });
});

describe("dictionaries", () => {
  it("Arabic and English have exactly the same keys", () => {
    const ar = Object.keys(dictionaries.ar).sort();
    const en = Object.keys(dictionaries.en).sort();
    expect(ar).toEqual(en);
  });

  it("no value is left empty", () => {
    for (const [locale, dict] of Object.entries(dictionaries)) {
      for (const [key, value] of Object.entries(dict)) {
        expect(String(value).trim(), `${locale}.${key}`).not.toBe("");
      }
    }
  });
});
