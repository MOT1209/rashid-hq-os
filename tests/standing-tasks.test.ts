import { describe, expect, it } from "vitest";
import {
  MAX_DEPARTMENTS_PER_RUN,
  isScheduled,
  ranOnDay,
  scheduledDepartments,
} from "@/lib/standing-tasks";
import type { Department } from "@/lib/agents";

function dept(overrides: Partial<Department> = {}): Department {
  return {
    key: "dev",
    name_ar: "التطوير",
    name_en: "Development",
    agent_name: "Dev Agent",
    agent_label_ar: "",
    agent_label_en: "",
    icon: "🛠",
    is_fallback: false,
    sort_order: 0,
    system_prompt: "",
    model: null,
    standing_task: "check the projects",
    standing_task_enabled: true,
    ...overrides,
  };
}

describe("isScheduled", () => {
  it("is true for an enabled department with a brief", () => {
    expect(isScheduled(dept())).toBe(true);
  });

  it("is false when disabled, even with a brief", () => {
    expect(isScheduled(dept({ standing_task_enabled: false }))).toBe(false);
  });

  it("is false when the brief is empty or whitespace", () => {
    expect(isScheduled(dept({ standing_task: null }))).toBe(false);
    expect(isScheduled(dept({ standing_task: "   " }))).toBe(false);
  });
});

describe("scheduledDepartments", () => {
  it("keeps only the scheduled ones", () => {
    const list = [
      dept({ key: "dev" }),
      dept({ key: "store", standing_task_enabled: false }),
      dept({ key: "media", standing_task: "" }),
      dept({ key: "custom" }),
    ];
    expect(scheduledDepartments(list).map((d) => d.key)).toEqual(["dev", "custom"]);
  });

  it("never returns more than the per-run cap", () => {
    const many = Array.from({ length: MAX_DEPARTMENTS_PER_RUN + 5 }, (_, i) =>
      dept({ key: `d${i}` }),
    );
    expect(scheduledDepartments(many)).toHaveLength(MAX_DEPARTMENTS_PER_RUN);
  });
});

describe("ranOnDay", () => {
  const now = new Date("2026-08-27T07:00:00Z");

  it("is true when a standing_task run exists on the same UTC day", () => {
    const logs = [
      { agent_name: "Dev Agent", tool_name: "standing_task", created_at: "2026-08-27T06:59:00Z" },
    ];
    expect(ranOnDay(logs, "Dev Agent", now)).toBe(true);
  });

  it("is false for a run on a previous day", () => {
    const logs = [
      { agent_name: "Dev Agent", tool_name: "standing_task", created_at: "2026-08-26T07:00:00Z" },
    ];
    expect(ranOnDay(logs, "Dev Agent", now)).toBe(false);
  });

  it("does not confuse a different agent or a different tool", () => {
    const logs = [
      { agent_name: "Store Agent", tool_name: "standing_task", created_at: "2026-08-27T06:00:00Z" },
      { agent_name: "Dev Agent", tool_name: "list_projects", created_at: "2026-08-27T06:00:00Z" },
    ];
    expect(ranOnDay(logs, "Dev Agent", now)).toBe(false);
  });
});
