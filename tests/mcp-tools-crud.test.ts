import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The write tools added for project/tool management (update_project,
 * delete_project, add/update/delete_project_tool) share one authorization
 * boundary that is easy to get backwards: ownership is checked against
 * ctx.ownerId (the token issuer, or the signed-in owner for the console),
 * never assumed. A caller with no ownerId — an old token that predates
 * created_by — must fail closed, not match a row with a null owner_id.
 */

const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getServiceSupabase: () => ({ from }),
}));

const assertSafeEndpoint = vi.fn(async (url: string) => new URL(url));
vi.mock("@/lib/net/safe-endpoint", () => ({
  assertSafeEndpoint: (...args: [string]) => assertSafeEndpoint(...args),
  UnsafeEndpointError: class extends Error {},
}));

const { findTool } = await import("@/lib/mcp/tools");

type Tool = ReturnType<typeof findTool>;
const tool = (name: string) => findTool(name) as NonNullable<Tool>;

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

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TOOL_ID = "22222222-2222-4222-8222-222222222222";
const OWNER_ID = "owner-123";

beforeEach(() => {
  from.mockReset();
  assertSafeEndpoint.mockClear();
  assertSafeEndpoint.mockImplementation(async (url: string) => new URL(url));
});

describe("project ownership boundary", () => {
  it("update_project refuses a caller who does not own the project", async () => {
    from.mockImplementationOnce(() => stubQuery({ data: null, error: null })); // ownsProject check

    await expect(
      tool("update_project").execute(
        { project_id: PROJECT_ID, name: "renamed" } as never,
        { agentName: "agent", ownerId: OWNER_ID, actorType: "agent_token" },
      ),
    ).rejects.toThrow(/not found/i);

    // Never got past the ownership check to the actual update.
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("update_project fails closed when the caller carries no ownerId at all", async () => {
    await expect(
      tool("update_project").execute(
        { project_id: PROJECT_ID, name: "renamed" } as never,
        { agentName: "agent", ownerId: null, actorType: "agent_token" },
      ),
    ).rejects.toThrow(/not found/i);

    // ownsProject short-circuits on a missing ownerId — never even queries.
    expect(from).not.toHaveBeenCalled();
  });

  it("update_project succeeds for the owner and re-validates a new mcp_endpoint", async () => {
    from
      .mockImplementationOnce(() => stubQuery({ data: { id: PROJECT_ID }, error: null })) // ownsProject
      .mockImplementationOnce(() => stubQuery({ data: { id: PROJECT_ID }, error: null })); // update

    await tool("update_project").execute(
      {
        project_id: PROJECT_ID,
        name: "renamed",
        mcp_endpoint: "https://example.com/mcp",
      } as never,
      { agentName: "agent", ownerId: OWNER_ID, actorType: "agent_token" },
    );

    expect(assertSafeEndpoint).toHaveBeenCalledWith("https://example.com/mcp");
  });

  it("delete_project reports not-found when the delete matches zero rows (wrong owner)", async () => {
    from.mockImplementationOnce(() => stubQuery({ error: null, count: 0 }));

    await expect(
      tool("delete_project").execute({ project_id: PROJECT_ID } as never, {
        agentName: "agent",
        ownerId: OWNER_ID,
        actorType: "agent_token",
      }),
    ).rejects.toThrow(/not found/i);
  });

  it("delete_project succeeds when exactly one row matched", async () => {
    from.mockImplementationOnce(() => stubQuery({ error: null, count: 1 }));

    const result = await tool("delete_project").execute(
      { project_id: PROJECT_ID } as never,
      { agentName: "agent", ownerId: OWNER_ID, actorType: "agent_token" },
    );

    expect(result).toEqual({ deleted_project_id: PROJECT_ID });
  });

  it("a project-pinned token cannot update or delete a different project", async () => {
    const ctx = { agentName: "pinned", projectId: PROJECT_ID, ownerId: OWNER_ID, actorType: "agent_token" as const };
    const otherProject = "33333333-3333-4333-8333-333333333333";

    await expect(
      tool("update_project").execute(
        { project_id: otherProject, name: "x" } as never,
        ctx,
      ),
    ).rejects.toThrow(/scoped to a different project/);
    await expect(
      tool("delete_project").execute({ project_id: otherProject } as never, ctx),
    ).rejects.toThrow(/scoped to a different project/);

    expect(from).not.toHaveBeenCalled();
  });
});

describe("project tool ownership boundary", () => {
  it("update_project_tool and delete_project_tool refuse a non-owner", async () => {
    from
      .mockImplementationOnce(() =>
        stubQuery({ data: { project_id: PROJECT_ID }, error: null }),
      ) // lookup existing tool
      .mockImplementationOnce(() => stubQuery({ data: null, error: null })); // ownsProject fails

    await expect(
      tool("update_project_tool").execute(
        { tool_id: TOOL_ID, tool_name: "renamed" } as never,
        { agentName: "agent", ownerId: "someone-else", actorType: "agent_token" },
      ),
    ).rejects.toThrow(/not found/i);
  });

  it("add_project_tool validates the endpoint before storing it", async () => {
    from.mockImplementationOnce(() => stubQuery({ data: { id: PROJECT_ID }, error: null })); // ownsProject
    from.mockImplementationOnce(() => stubQuery({ data: { id: TOOL_ID }, error: null })); // insert

    await tool("add_project_tool").execute(
      {
        project_id: PROJECT_ID,
        tool_name: "ping",
        endpoint: "https://example.com/ping",
      } as never,
      { agentName: "agent", ownerId: OWNER_ID, actorType: "agent_token" },
    );

    expect(assertSafeEndpoint).toHaveBeenCalledWith("https://example.com/ping");
  });
});
