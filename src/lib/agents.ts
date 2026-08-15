import type { Dictionary } from "@/lib/i18n";

export type DepartmentKey = "dev" | "store" | "media" | "custom";

export type Department = {
  key: DepartmentKey;
  /** Stored in agent_logs.agent_name — never translated. */
  agent: string;
  /** Dictionary key for the display name of that agent. */
  agentLabel: keyof Dictionary;
  icon: string;
  /** Project categories routed to this department. */
  categories: string[];
};

export const DEPARTMENTS: Department[] = [
  {
    key: "dev",
    agent: "Dev Agent",
    agentLabel: "agentDev",
    icon: "💻",
    categories: ["Web App", "Game", "API", "Mobile App"],
  },
  {
    key: "store",
    agent: "Store Agent",
    agentLabel: "agentStore",
    icon: "🛒",
    categories: ["E-Commerce"],
  },
  {
    key: "media",
    agent: "Media Agent",
    agentLabel: "agentMedia",
    icon: "📣",
    categories: ["Media", "Marketing"],
  },
  {
    key: "custom",
    agent: "Custom Agent",
    agentLabel: "agentCustom",
    icon: "🚀",
    // Empty on purpose: this is the fallback department (see CUSTOM_DEPARTMENT).
    categories: [],
  },
];

/** The catch-all, referenced by key so reordering DEPARTMENTS cannot break it. */
const CUSTOM_DEPARTMENT = DEPARTMENTS.find((d) => d.key === "custom")!;

/** Category value stored in the database → dictionary key for its label. */
export const PROJECT_CATEGORIES: { value: string; label: keyof Dictionary }[] = [
  { value: "Web App", label: "catWebApp" },
  { value: "E-Commerce", label: "catECommerce" },
  { value: "Game", label: "catGame" },
  { value: "API", label: "catAPI" },
  { value: "Mobile App", label: "catMobileApp" },
  { value: "Media", label: "catMedia" },
  { value: "Marketing", label: "catMarketing" },
  { value: "Other", label: "catOther" },
];

/** Translated category name, falling back to the raw stored value. */
export function categoryLabel(t: Dictionary, category: string | null) {
  if (!category) return null;
  const match = PROJECT_CATEGORIES.find((c) => c.value === category);
  return match ? t[match.label] : category;
}

export function getDepartment(key: string): Department | undefined {
  return DEPARTMENTS.find((d) => d.key === key);
}

/** The department a project belongs to, based on its category. */
export function departmentForCategory(category: string | null): Department {
  if (category) {
    const match = DEPARTMENTS.find((d) => d.categories.includes(category));
    if (match) return match;
  }
  return CUSTOM_DEPARTMENT;
}
