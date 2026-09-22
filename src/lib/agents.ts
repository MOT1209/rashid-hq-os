import type { Locale } from "@/lib/i18n";

/**
 * Departments and categories now live in the database (migration 0007), so a
 * new one is a row rather than a code change plus two dictionary edits plus a
 * deploy. This module holds the shape and the pure routing logic; the rows are
 * read server-side in src/lib/queries.ts and passed down as props.
 */

export type Department = {
  /** URL segment, and the value stored against a category. */
  key: string;
  name_ar: string;
  name_en: string;
  /** Written into agent_logs.agent_name by the agent — never translated. */
  agent_name: string;
  agent_label_ar: string;
  agent_label_en: string;
  icon: string;
  /** Exactly one row is the catch-all for categories that match nothing. */
  is_fallback: boolean;
  sort_order: number;
  /** Instructions this department's agent runs under (migration 0011). */
  system_prompt: string;
  /** Null falls back to GROQ_MODEL, then the default in src/lib/model.ts. */
  model: string | null;
  /**
   * A brief the agent runs once a day on its own (migration 0012). Null or
   * empty means nothing is scheduled.
   */
  standing_task: string | null;
  /** Per-department off switch for the standing task, keeping the brief text. */
  standing_task_enabled: boolean;
  /**
   * Monthly token cap across console, delegation and standing-task runs
   * (migration 0018). Null = unlimited. Checked in runDepartmentAgent before
   * any model call; the CEO console itself is owner-driven and unchecked.
   */
  monthly_token_budget: number | null;
  /** Last 80% alert mail — throttles it to one a day (src/lib/budgets.ts). */
  budget_alerted_at: string | null;
};

export type ProjectCategory = {
  /** The value stored in projects.category. */
  value: string;
  label_ar: string;
  label_en: string;
  department_key: string | null;
  sort_order: number;
};

/**
 * A saved command/prompt template (migration 0010). Picking one fills the CEO
 * console's input box — it does not run a model itself, so reading or listing
 * a skill never starts a second agentic loop or an unexpected model call.
 */
export type AgentSkill = {
  id: string;
  name: string;
  description: string | null;
  prompt: string;
  created_by: string | null;
  created_at: string;
};

export function departmentName(department: Department, locale: Locale) {
  return locale === "ar" ? department.name_ar : department.name_en;
}

export function agentLabel(department: Department, locale: Locale) {
  return locale === "ar" ? department.agent_label_ar : department.agent_label_en;
}

export function categoryLabelOf(category: ProjectCategory, locale: Locale) {
  return locale === "ar" ? category.label_ar : category.label_en;
}

export function getDepartment(departments: Department[], key: string) {
  return departments.find((d) => d.key === key);
}

/** The catch-all, found by flag so ordering can never change the answer. */
export function fallbackDepartment(departments: Department[]) {
  return departments.find((d) => d.is_fallback) ?? departments.at(-1);
}

/**
 * The department a project belongs to, based on its category. A category with
 * no department — and any value not in the table at all, which is possible for
 * rows written before a category was renamed — falls through to the catch-all.
 */
export function departmentForCategory(
  departments: Department[],
  categories: ProjectCategory[],
  category: string | null,
): Department | undefined {
  if (category) {
    const match = categories.find((c) => c.value === category);
    if (match?.department_key) {
      const department = getDepartment(departments, match.department_key);
      if (department) return department;
    }
  }
  return fallbackDepartment(departments);
}

/** Translated category name, falling back to the raw stored value. */
export function categoryLabel(
  categories: ProjectCategory[],
  locale: Locale,
  category: string | null,
) {
  if (!category) return null;
  const match = categories.find((c) => c.value === category);
  return match ? categoryLabelOf(match, locale) : category;
}
