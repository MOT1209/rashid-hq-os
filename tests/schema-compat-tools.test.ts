import { beforeEach, describe, expect, it, vi } from "vitest";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const SKILL = "44444444-4444-4444-8444-444444444444";
const MISSING = { code: "42703", message: "column projects.mcp_protocol does not exist" };

let projectCalls: string[] = [];
let skillCalls: string[] = [];
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

vi.mock("@/lib/supabase/server", () => ({
  getServiceSupabase: () => ({
    from: (table: string) => {
      let cols = "";
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      const result = () => {
        if (table === "projects") {
          projectCalls.push(cols);
          if (cols.includes("mcp_protocol")) return { data: null, error: MISSING };
          return { data: { mcp_endpoint: "https://tool.example/x", name: "Store", monthly_token_budget: 100, budget_alerted_at: null, budget_exhausted_alerted_at: null }, error: null };
        }
        if (table === "agent_skills") {
          skillCalls.push(cols);
          if (cols.includes("version") || cols.includes("tags")) return { data: null, error: { code: "42703", message: "column agent_skills.version does not exist" } };
          return { data: cols.includes("id, name") ? [{ id: SKILL, name: "n", description: null, prompt: "p", created_at: "now" }] : null, error: null };
        }
        return { data: null, error: null }; // project_tools: no per-tool endpoint
      };
      Object.assign(chain, {
        select: (c: string) => { cols = c; return chain; },
        eq: self, order: self, limit: self,
        maybeSingle: async () => {
          const r = result();
          return table === "agent_skills" && !r.error ? { data: (r.data as unknown[] | null)?.[0] ?? null, error: null } : r;
        },
        then: (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res),
      });
      return chain;
    },
  }),
}));
vi.mock("@/lib/net/safe-endpoint", () => ({ assertSafeEndpoint: vi.fn(async (v: string) => new URL(v)), pinnedDispatcher: vi.fn(() => ({})), UnsafeEndpointError: class extends Error {} }));
vi.mock("@/lib/errors", () => ({ dbError: (c: string) => new Error(`${c} failed`), captureError: vi.fn() }));
const checkProjectBudget = vi.fn();
vi.mock("@/lib/budgets", () => ({ checkProjectBudget: (i: Record<string, unknown>) => checkProjectBudget(i) }));

const { findTool } = await import("@/lib/mcp/tools");
const ctx = { agentName: "agent", scopes: ["read", "write"], actorType: "agent_token" } as never;

beforeEach(() => { projectCalls = []; skillCalls = []; fetchMock.mockReset(); fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "{}" }); checkProjectBudget.mockReset(); });

describe("call_project_tool before migration 0029", () => {
  it("still loads the project's budget columns (budget enforcement must not silently turn off)", async () => {
    checkProjectBudget.mockResolvedValue({ allowed: false, used: 120, budget: 100, alerted: false });
    await expect(findTool("call_project_tool")!.execute({ project_id: PROJECT, tool_name: "deploy", input: {} } as never, ctx)).rejects.toThrow(/budget exceeded/);
    expect(checkProjectBudget).toHaveBeenCalledWith(expect.objectContaining({ budget: 100, projectName: "Store" }));
    expect(projectCalls.map((c) => c.includes("mcp_protocol"))).toEqual([true, false]); // retried without the missing column
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("calls the legacy HQ protocol when the protocol column does not exist", async () => {
    checkProjectBudget.mockResolvedValue({ allowed: true, used: 0, budget: 100, alerted: false });
    const r = (await findTool("call_project_tool")!.execute({ project_id: PROJECT, tool_name: "deploy", input: {} } as never, ctx)) as { status: number };
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("skills tools before migration 0030", () => {
  it("list_skills falls back to the legacy columns", async () => {
    const r = (await findTool("list_skills")!.execute({} as never, ctx)) as { skills: { id: string }[] };
    expect(r.skills[0].id).toBe(SKILL);
    expect(skillCalls.length).toBe(2);
    expect(skillCalls[1]).not.toMatch(/version|tags/);
  });
  it("get_skill falls back too", async () => {
    const r = (await findTool("get_skill")!.execute({ skill_id: SKILL } as never, ctx)) as { skill: { id: string } };
    expect(r.skill.id).toBe(SKILL);
  });
});
