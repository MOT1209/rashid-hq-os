import { describe, expect, it } from "vitest";
import { AGENTS, AGENT_KEYS, OWNER_ONLY, TOOL_PERMISSION, allowedTools, can, effectivePermissions } from "@/lib/social/agents-core";

describe("agent permission model", () => {
  it("no agent definition can reach an owner-only permission, even by its maximum", () => {
    for (const a of Object.values(AGENTS)) for (const p of a.max) expect(OWNER_ONLY).not.toContain(p);
  });
  it("no tool maps to an owner-only permission (there is no publish/schedule/delete/account tool)", () => {
    for (const p of Object.values(TOOL_PERMISSION)) expect(OWNER_ONLY).not.toContain(p);
  });
  it("defaults to the maximum; stored grants can only narrow it", () => {
    expect(effectivePermissions("writer", null)).toEqual(["read_content", "prepare_content", "edit_drafts"]);
    expect(effectivePermissions("writer", ["read_content"])).toEqual(["read_content"]);
    expect(effectivePermissions("writer", [])).toEqual([]);
  });
  it("clamps tampered rows: cannot exceed the agent's max or add owner-only permissions", () => {
    const p = effectivePermissions("publishing_assistant", ["read_content", "publish_content", "edit_drafts", "schedule_content", "bogus"]);
    expect(p).toEqual(["read_content"]);
    expect(can(["publish_content"], "publish_content")).toBe(false);
  });
  it("tools follow permissions: revoking edit_drafts removes update tools", () => {
    expect(allowedTools("writer", ["read_content", "prepare_content", "edit_drafts"])).toEqual(["list_content", "get_content", "create_draft", "update_draft"]);
    expect(allowedTools("writer", ["read_content", "prepare_content"])).toEqual(["list_content", "get_content", "create_draft"]);
    expect(allowedTools("writer", [])).toEqual([]);
  });
  it("the publishing assistant is strictly read-only", () => {
    const tools = allowedTools("publishing_assistant", effectivePermissions("publishing_assistant", null));
    expect(tools.every((t) => ["list_content", "get_content", "validate_content", "list_jobs"].includes(t))).toBe(true);
  });
  it("defines all six agents", () => expect(AGENT_KEYS).toHaveLength(6));
});
