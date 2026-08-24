import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * saveSkillAction/deleteSkillAction (migration 0010, "saved-prompt skills")
 * had no test coverage at all. The validation here is the only thing standing
 * between a form post and an insert: name/prompt required, and every field has
 * a length ceiling so an oversized value is refused rather than silently
 * truncated (same policy as every other form action in this file).
 */

const insert = vi.fn();
const deleteEq = vi.fn();
const from = vi.fn((table: string) => {
  if (table !== "agent_skills") throw new Error(`unexpected table ${table}`);
  return {
    insert: (row: unknown) => insert(row),
    delete: () => ({ eq: (col: string, value: string) => deleteEq(col, value) }),
  };
});

vi.mock("@/lib/supabase/server", () => ({
  getServiceSupabase: () => ({ from }),
}));

let role: "admin" | "viewer" = "admin";
const requireAdmin = vi.fn(async () => {
  if (role !== "admin") throw new Error("You do not have permission to make changes.");
  return { user: { id: "owner-1", email: "owner@example.com" } };
});
vi.mock("@/lib/session", () => ({ requireAdmin: () => requireAdmin() }));

const logActivity = vi.fn(async () => {});
vi.mock("@/lib/activity", () => ({ logActivity, startActivity: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: vi.fn(), get: vi.fn() }) }));
vi.mock("@/lib/mcp/tools", () => ({ findTool: vi.fn() }));
vi.mock("@/lib/net/safe-endpoint", () => ({
  assertSafeEndpoint: vi.fn(async (url: string) => new URL(url)),
  UnsafeEndpointError: class extends Error {},
}));
vi.mock("@/lib/agent-tokens", () => ({
  canRevokeToken: vi.fn(),
  issueAgentToken: vi.fn(),
  revokeAgentToken: vi.fn(),
}));

const { saveSkillAction, deleteSkillAction } = await import("@/app/actions");

function formOf(fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

beforeEach(() => {
  role = "admin";
  insert.mockReset().mockResolvedValue({ error: null });
  deleteEq.mockReset().mockResolvedValue({ error: null });
  logActivity.mockClear();
  requireAdmin.mockClear();
});

describe("saveSkillAction", () => {
  it("refuses a viewer before touching the database", async () => {
    role = "viewer";
    await expect(
      saveSkillAction(formOf({ name: "a", prompt: "b" })),
    ).rejects.toThrow(/permission to make changes/i);
    expect(insert).not.toHaveBeenCalled();
  });

  it("requires a name", async () => {
    const result = await saveSkillAction(formOf({ prompt: "do the thing" }));
    expect(result).toEqual({ error: "Name is required." });
    expect(insert).not.toHaveBeenCalled();
  });

  it("requires a prompt", async () => {
    const result = await saveSkillAction(formOf({ name: "deploy" }));
    expect(result).toEqual({ error: "Prompt is required." });
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects a name over the shared field limit", async () => {
    const result = await saveSkillAction(
      formOf({ name: "x".repeat(501), prompt: "ok" }),
    );
    expect(result).toEqual({ error: `"name" is longer than 500 characters.` });
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects a prompt over its own, larger limit", async () => {
    // Under the shared 500-char field limit but over the skill-specific 4000.
    const result = await saveSkillAction(
      formOf({ name: "deploy", prompt: "x".repeat(4001) }),
    );
    expect(result).toEqual({ error: `"prompt" is longer than 4000 characters.` });
    expect(insert).not.toHaveBeenCalled();
  });

  it("saves a valid skill and logs the activity", async () => {
    const result = await saveSkillAction(
      formOf({ name: "deploy", prompt: "run the deploy", description: "ops" }),
    );

    expect(result).toEqual({ ok: true });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: "deploy", prompt: "run the deploy", created_by: "owner-1" }),
    );
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "save_skill", status: "success" }),
    );
  });

  it("surfaces a database error instead of throwing", async () => {
    insert.mockResolvedValue({ error: { message: "boom" } });
    const result = await saveSkillAction(formOf({ name: "deploy", prompt: "run it" }));
    expect(result).toHaveProperty("error");
    expect(logActivity).not.toHaveBeenCalled();
  });
});

describe("deleteSkillAction", () => {
  it("refuses a viewer", async () => {
    role = "viewer";
    await expect(deleteSkillAction(formOf({ id: "skill-1" }))).rejects.toThrow(
      /permission to make changes/i,
    );
    expect(deleteEq).not.toHaveBeenCalled();
  });

  it("requires an id", async () => {
    const result = await deleteSkillAction(formOf({}));
    expect(result).toEqual({ error: "Skill is required." });
    expect(deleteEq).not.toHaveBeenCalled();
  });

  it("deletes by id and logs the activity", async () => {
    const result = await deleteSkillAction(formOf({ id: "skill-1" }));
    expect(result).toEqual({ ok: true });
    expect(deleteEq).toHaveBeenCalledWith("id", "skill-1");
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "delete_skill", status: "success" }),
    );
  });
});
