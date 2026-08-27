import { describe, expect, it } from "vitest";
import {
  agentLabel,
  categoryLabel,
  categoryLabelOf,
  departmentForCategory,
  departmentName,
  fallbackDepartment,
  getDepartment,
  type Department,
  type ProjectCategory,
} from "@/lib/agents";
import { dictionaries, getDictionary } from "@/lib/i18n";

/**
 * Departments and categories are rows now, so these exercise the routing logic
 * against data rather than against the constants that used to be compiled in.
 */

function department(key: string, overrides: Partial<Department> = {}): Department {
  return {
    key,
    name_ar: `${key}-ar`,
    name_en: `${key}-en`,
    agent_name: `${key} Agent`,
    agent_label_ar: `وكيل ${key}`,
    agent_label_en: `${key} Agent`,
    icon: "📁",
    is_fallback: false,
    sort_order: 0,
    // Routing does not read these, but a Department carries them since 0011/0012.
    system_prompt: "",
    model: null,
    standing_task: null,
    standing_task_enabled: true,
    ...overrides,
  };
}

function category(value: string, departmentKey: string | null): ProjectCategory {
  return {
    value,
    label_ar: `${value}-ar`,
    label_en: value,
    department_key: departmentKey,
    sort_order: 0,
  };
}

const DEPARTMENTS = [
  department("dev"),
  department("store"),
  department("media"),
  department("custom", { is_fallback: true }),
];

const CATEGORIES = [
  category("Web App", "dev"),
  category("E-Commerce", "store"),
  category("Marketing", "media"),
  category("Other", null),
];

const route = (value: string | null) =>
  departmentForCategory(DEPARTMENTS, CATEGORIES, value)?.key;

describe("departmentForCategory", () => {
  it("routes a category to the department it belongs to", () => {
    expect(route("Web App")).toBe("dev");
    expect(route("E-Commerce")).toBe("store");
    expect(route("Marketing")).toBe("media");
  });

  it("falls back for an unassigned, unknown or missing category", () => {
    expect(route("Other")).toBe("custom");
    // A value written before a category was renamed is not in the table at all.
    expect(route("Something New")).toBe("custom");
    expect(route(null)).toBe("custom");
  });

  it("finds the fallback by flag, so ordering cannot change the answer", () => {
    const reversed = [...DEPARTMENTS].reverse();
    expect(fallbackDepartment(reversed)?.key).toBe("custom");
    expect(departmentForCategory(reversed, CATEGORIES, null)?.key).toBe("custom");
  });

  it("still resolves when a category points at a department that no longer exists", () => {
    const orphan = [category("Ghost", "deleted-department")];
    expect(departmentForCategory(DEPARTMENTS, orphan, "Ghost")?.key).toBe("custom");
  });

  it("returns undefined only when there are no departments at all", () => {
    expect(departmentForCategory([], CATEGORIES, "Web App")).toBeUndefined();
  });
});

describe("labels", () => {
  it("picks the field matching the locale", () => {
    const dev = DEPARTMENTS[0];
    expect(departmentName(dev, "ar")).toBe("dev-ar");
    expect(departmentName(dev, "en")).toBe("dev-en");
    expect(agentLabel(dev, "ar")).toBe("وكيل dev");
    expect(agentLabel(dev, "en")).toBe("dev Agent");
    expect(categoryLabelOf(CATEGORIES[0], "ar")).toBe("Web App-ar");
  });

  it("passes an unknown category through unchanged rather than blanking it", () => {
    expect(categoryLabel(CATEGORIES, "ar", "Legacy Value")).toBe("Legacy Value");
    expect(categoryLabel(CATEGORIES, "ar", null)).toBeNull();
  });
});

describe("getDepartment", () => {
  it("only accepts a key that exists", () => {
    expect(getDepartment(DEPARTMENTS, "dev")?.key).toBe("dev");
    expect(getDepartment(DEPARTMENTS, "nope")).toBeUndefined();
  });
});

describe("dictionaries", () => {
  it("Arabic and English have exactly the same keys", () => {
    expect(Object.keys(dictionaries.ar).sort()).toEqual(
      Object.keys(dictionaries.en).sort(),
    );
  });

  it("no value is left empty", () => {
    for (const [locale, dict] of Object.entries(dictionaries)) {
      for (const [key, value] of Object.entries(dict)) {
        expect(String(value).trim(), `${locale}.${key}`).not.toBe("");
      }
    }
  });

  it("still carries the static UI strings the pages rely on", () => {
    const t = getDictionary("en");
    expect(t.departments).toBeTruthy();
    expect(t.projects).toBeTruthy();
  });
});
