import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The two authorization boundaries on the MCP endpoint: what a token's scopes
 * permit, and whether a project-pinned token can reach past its project.
 * Everything below runs against a stubbed Supabase client — the point is the
 * decision, not the query.
 */

const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getServiceSupabase: () => ({ from }),
}));

// Never let a test reach the network through the SSRF guard.
vi.mock("@/lib/net/safe-endpoint", () => ({
  assertSafeEndpoint: vi.fn(async (url: string) => new URL(url)),
  UnsafeEndpointError: class extends Error {},
}));

const { TOOLS, findTool, scopeDenialReason } = await import("@/lib/mcp/tools");

type Tool = (typeof TOOLS)[number];
const tool = (name: string) => findTool(name) as Tool;

/** A Supabase query builder stub: every chained call returns itself. */
function stubQuery(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "insert", "update", "delete"]) {
    chain[method] = () => chain;
  }
  chain.maybeSingle = async () => result;
  chain.single = async () => result;
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

beforeEach(() => {
  from.mockReset();
  from.mockImplementation(() => stubQuery({ data: null, error: null }));
});

describe("scope enforcement", () => {
  it("refuses a write tool to a read-only token", () => {
    for (const name of ["register_project", "call_project_tool"]) {
      const reason = scopeDenialReason(tool(name), ["read"]);
      expect(reason, name).toMatch(/lacks the "write" scope/);
    }
  });

  it("allows read tools to a read-only token", () => {
    for (const name of ["list_projects", "get_project", "list_recent_logs"]) {
      expect(scopeDenialReason(tool(name), ["read"]), name).toBeNull();
    }
  });

  it("refuses everything to a token with no scopes", () => {
    for (const t of TOOLS) {
      expect(scopeDenialReason(t, []), t.name).not.toBeNull();
      expect(scopeDenialReason(t, undefined), t.name).not.toBeNull();
    }
  });

  it("ignores unrelated scopes", () => {
    expect(scopeDenialReason(tool("register_project"), ["admin", "root"])).not.toBeNull();
  });

  it("every tool declares a scope, and only the mutating tools need write", () => {
    const write = TOOLS.filter((t) => t.requiredScope === "write").map((t) => t.name);
    expect(write.sort()).toEqual(
      [
        "add_project_tool",
        "call_project_tool",
        // Starts another model run on the caller's behalf, so it is a write
        // even though it changes nothing in this database directly.
        "delegate_to_department",
        "delete_project",
        "delete_project_tool",
        "register_project",
        "update_project",
        "update_project_tool",
      ].sort(),
    );
    for (const t of TOOLS) {
      expect(["read", "write"], t.name).toContain(t.requiredScope);
    }
  });
});

describe("project pinning", () => {
  const ctx = { agentName: "pinned", projectId: "11111111-1111-4111-8111-111111111111", actorType: "agent_token" as const };

  it("refuses get_project for another project", async () => {
    await expect(
      tool("get_project").execute(
        { project_id: "22222222-2222-4222-8222-222222222222" } as never,
        ctx,
      ),
    ).rejects.toThrow(/scoped to a different project/);
  });

  it("refuses call_project_tool for another project", async () => {
    await expect(
      tool("call_project_tool").execute(
        {
          project_id: "22222222-2222-4222-8222-222222222222",
          tool_name: "anything",
          input: {},
        } as never,
        ctx,
      ),
    ).rejects.toThrow(/scoped to a different project/);
  });

  it("refuses register_project outright — a pinned token must not mint new projects", async () => {
    await expect(
      tool("register_project").execute({ name: "new" } as never, ctx),
    ).rejects.toThrow(/scoped to a different project/);
    expect(from).not.toHaveBeenCalled();
  });

  it("does not reach the database when a pinned call is refused", async () => {
    await expect(
      tool("get_project").execute(
        { project_id: "22222222-2222-4222-8222-222222222222" } as never,
        ctx,
      ),
    ).rejects.toThrow();
    expect(from).not.toHaveBeenCalled();
  });
});

describe("ownership propagation", () => {
  it("register_project stamps the owner so the dashboard can still manage it", async () => {
    const insert = vi.fn(() => stubQuery({ data: { id: "p1" }, error: null }));
    from.mockImplementation(() => ({ insert }));

    await tool("register_project").execute({ name: "owned" } as never, {
      agentName: "agent",
      ownerId: "owner-123",
      actorType: "agent_token",
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ owner_id: "owner-123" }),
    );
  });
});
