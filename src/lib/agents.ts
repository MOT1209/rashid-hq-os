export type DepartmentKey = "dev" | "store" | "media" | "custom";

export type Department = {
  key: DepartmentKey;
  agent: string;
  icon: string;
  /** Project categories routed to this department. */
  categories: string[];
};

export const DEPARTMENTS: Department[] = [
  {
    key: "dev",
    agent: "Dev Agent",
    icon: "💻",
    categories: ["Web App", "Game", "API", "Mobile App"],
  },
  {
    key: "store",
    agent: "Store Agent",
    icon: "🛒",
    categories: ["E-Commerce"],
  },
  {
    key: "media",
    agent: "Media Agent",
    icon: "📣",
    categories: ["Media", "Marketing"],
  },
  {
    key: "custom",
    agent: "Custom Agent",
    icon: "🚀",
    categories: [],
  },
];

export const PROJECT_CATEGORIES = [
  "Web App",
  "E-Commerce",
  "Game",
  "API",
  "Mobile App",
  "Media",
  "Marketing",
  "Other",
];

export function getDepartment(key: string): Department | undefined {
  return DEPARTMENTS.find((d) => d.key === key);
}

/** The department a project belongs to, based on its category. */
export function departmentForCategory(category: string | null): Department {
  if (category) {
    const match = DEPARTMENTS.find((d) => d.categories.includes(category));
    if (match) return match;
  }
  return DEPARTMENTS[DEPARTMENTS.length - 1];
}
