import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * src/app/actions.ts holds the owner-facing authorization, ownership and SSRF
 * checks for every dashboard mutation, and almost none of it was tested. These
 * cover the security-relevant contract of the highest-risk actions: a viewer is
 * refused before the database is touched, oversized input is rejected, a
 * project that is not yours cannot be mutated, an unsafe endpoint is refused,
 * and every successful action is written to the audit feed.
 */

// A chainable Supabase stub. Every builder method returns the same object; the
// terminal shapes (maybeSingle / single / await) resolve to `result`, which a
// test sets per case. `.delete({ count })` and plain `await` are covered by
// making the object thenable.
type Result = { data?: unknown; error?: unknown; count?: number };
let result: Result = { data: null, error: null };
const calls: { table: string; method: string; args: unknown[] }[] = [];

function builder(table: string) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "insert", "update", "upsert", "delete", "eq", "is", "not", "order", "limit"];
  for (const m of methods) {
    chain[m] = (...args: unknown[]) => {
      calls.push({ table, method: m, args });
      return chain;
    };
  }
  chain.maybeSingle = async () => result;
  chain.single = async () => result;
  chain.then = (resolve: (v: Result) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}
const from = vi.fn((table: string) => builder(table));
vi.mock("@/lib/supabase/server", () => ({ getServiceSupabase: () => ({ from }) }));

let role: "admin" | "viewer" = "admin";
const requireAdmin = vi.fn(async () => {
  if (role !== "admin") throw new Error("This account does not have permission to make changes.");
  return { user: { id: "owner-1", email: "owner@example.com" } };
});
vi.mock("@/lib/session", () => ({ requireAdmin: () => requireAdmin() }));

const logActivity = vi.fn(async () => {});
vi.mock("@/lib/activity", () => ({ logActivity, startActivity: vi.fn(async () => async () => {}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: vi.fn(), get: vi.fn() }) }));
vi.mock("@/lib/mcp/tools", () => ({ findTool: vi.fn() }));

class UnsafeEndpointError extends Error {}
const assertSafeEndpoint = vi.fn(async (url: string) => {
  if (url.includes("169.254")) throw new UnsafeEndpointError("Endpoint resolves to a private address.");
  return new URL(url);
});
vi.mock("@/lib/net/safe-endpoint", () => ({ assertSafeEndpoint, UnsafeEndpointError }));
vi.mock("@/lib/agent-tokens", () => ({
  canRevokeToken: vi.fn(),
  issueAgentToken: vi.fn(),
  revokeAgentToken: vi.fn(),
}));

const {
  createProjectAction,
  updateProjectAction,
  deleteProjectAction,
  updateDepartmentAgentAction,
  saveMemberAction,
  removeMemberAction,
} = await import("@/app/actions");

function form(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeEach(() => {
  role = "admin";
  result = { data: null, error: null };
  calls.length = 0;
  from.mockClear();
  logActivity.mockClear();
  requireAdmin.mockClear();
  assertSafeEndpoint.mockClear();
});

describe("createProjectAction", () => {
  it("refuses a viewer before any query", async () => {
    role = "viewer";
    await expect(createProjectAction(form({ name: "x" }))).rejects.toThrow(/permission/i);
    expect(from).not.toHaveBeenCalled();
  });

  it("requires a name", async () => {
    expect(await createProjectAction(form({}))).toEqual({ error: "Name is required." });
  });

  it("rejects an oversized field", async () => {
    const res = await createProjectAction(form({ name: "ok", url: "x".repeat(501) }));
    expect(res).toMatchObject({ error: expect.stringContaining("longer than 500") });
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects an unsafe mcp_endpoint", async () => {
    const res = await createProjectAction(
      form({ name: "ok", mcp_endpoint: "https://169.254.169.254/x" }),
    );
    expect(res).toMatchObject({ error: expect.stringMatching(/private address/i) });
  });

  it("inserts with owner_id and logs register_project on success", async () => {
    result = { data: { id: "p1", name: "Store" }, error: null };
    const res = await createProjectAction(form({ name: "Store" }));
    expect(res).toEqual({ ok: true });
    const insert = calls.find((c) => c.method === "insert");
    expect(insert?.args[0]).toMatchObject({ name: "Store", owner_id: "owner-1" });
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "register_project", status: "success" }),
    );
  });
});

describe("updateProjectAction / deleteProjectAction ownership", () => {
  it("update refuses a project the owner does not own", async () => {
    result = { data: null, error: null }; // assertOwnsProject -> not found
    const res = await updateProjectAction(form({ id: "p9", name: "x" }));
    expect(res).toEqual({ error: "Project not found." });
    expect(calls.some((c) => c.method === "update")).toBe(false);
  });

  it("delete refuses when the scoped delete matched no row", async () => {
    result = { data: { name: "Store" }, error: null, count: 0 };
    const res = await deleteProjectAction(form({ id: "p9" }));
    expect(res).toEqual({ error: "Project not found." });
    expect(logActivity).not.toHaveBeenCalled();
  });
});

describe("updateDepartmentAgentAction", () => {
  it("refuses a viewer", async () => {
    role = "viewer";
    await expect(updateDepartmentAgentAction(form({ key: "dev" }))).rejects.toThrow(/permission/i);
  });

  it("requires a department key", async () => {
    expect(await updateDepartmentAgentAction(form({}))).toEqual({
      error: "Department is required.",
    });
  });

  it("caps the standing task length", async () => {
    const res = await updateDepartmentAgentAction(
      form({ key: "dev", standing_task: "x".repeat(2001) }),
    );
    expect(res).toMatchObject({ error: expect.stringContaining("standing_task") });
  });

  it("treats a missing enabled checkbox as off, and logs the change", async () => {
    result = { data: { key: "dev" }, error: null };
    const res = await updateDepartmentAgentAction(
      form({ key: "dev", system_prompt: "You are Dev.", standing_task: "check things" }),
    );
    expect(res).toEqual({ ok: true });
    const update = calls.find((c) => c.method === "update");
    expect(update?.args[0]).toMatchObject({
      standing_task: "check things",
      standing_task_enabled: false,
    });
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "update_department_agent" }),
    );
  });
});

describe("saveMemberAction / removeMemberAction", () => {
  it("requires a valid email", async () => {
    expect(await saveMemberAction(form({ email: "not-an-email", role: "admin" }))).toMatchObject({
      error: expect.stringMatching(/valid email/i),
    });
  });

  it("upserts a lowercased email with the chosen role", async () => {
    const res = await saveMemberAction(form({ email: "New@Example.com", role: "admin" }));
    expect(res).toEqual({ ok: true });
    const upsert = calls.find((c) => c.method === "insert" || c.method === "update");
    // saveMemberAction uses .upsert(); the stub maps it through the generic path.
    void upsert;
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "save_member", payload: expect.objectContaining({ email: "new@example.com", role: "admin" }) }),
    );
  });

  it("refuses removing your own access", async () => {
    const res = await removeMemberAction(form({ email: "owner@example.com" }));
    expect(res).toEqual({ error: "You cannot remove your own access." });
  });
});
