import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * list_skills/get_skill (the read-only MCP counterpart to the console's
 * SkillManager) had no test coverage. Both are read tools with no ownership
 * boundary — any authenticated caller can read every skill — so what's worth
 * pinning down is the not-found shape and the exact columns returned.
 */

const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ getServiceSupabase: () => ({ from }) }));
vi.mock("@/lib/net/safe-endpoint", () => ({
  assertSafeEndpoint: vi.fn(async (url: string) => new URL(url)),
  UnsafeEndpointError: class extends Error {},
}));

const { findTool } = await import("@/lib/mcp/tools");
type Tool = ReturnType<typeof findTool>;
const tool = (name: string) => findTool(name) as NonNullable<Tool>;

/** A Supabase query builder stub: every chained call returns itself. */
function stubQuery(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit"]) chain[method] = () => chain;
  chain.maybeSingle = async () => result;
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

const SKILL_ID = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  from.mockReset();
});

describe("list_skills", () => {
  it("returns the skills ordered newest-first", async () => {
    const rows = [{ id: SKILL_ID, name: "deploy", description: null, prompt: "go", created_at: "now" }];
    from.mockImplementationOnce(() => stubQuery({ data: rows, error: null }));

    const result = await tool("list_skills").execute({} as never, {
      agentName: "agent",
      ownerId: "owner-1",
    });

    expect(result).toEqual({ skills: rows });
  });

  it("returns an empty list rather than null when nothing is saved", async () => {
    from.mockImplementationOnce(() => stubQuery({ data: null, error: null }));

    const result = await tool("list_skills").execute({} as never, {
      agentName: "agent",
      ownerId: "owner-1",
    });

    expect(result).toEqual({ skills: [] });
  });

  it("propagates a database error", async () => {
    from.mockImplementationOnce(() => stubQuery({ data: null, error: { message: "boom" } }));

    await expect(
      tool("list_skills").execute({} as never, { agentName: "agent", ownerId: "owner-1" }),
    ).rejects.toThrow();
  });
});

describe("get_skill", () => {
  it("returns the matching skill", async () => {
    const row = { id: SKILL_ID, name: "deploy", description: "ops", prompt: "go", created_at: "now" };
    from.mockImplementationOnce(() => stubQuery({ data: row, error: null }));

    const result = await tool("get_skill").execute(
      { skill_id: SKILL_ID } as never,
      { agentName: "agent", ownerId: "owner-1" },
    );

    expect(result).toEqual({ skill: row });
  });

  it("throws not-found when no row matches", async () => {
    from.mockImplementationOnce(() => stubQuery({ data: null, error: null }));

    await expect(
      tool("get_skill").execute({ skill_id: SKILL_ID } as never, {
        agentName: "agent",
        ownerId: "owner-1",
      }),
    ).rejects.toThrow(/not found/i);
  });
});
