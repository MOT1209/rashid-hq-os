import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/agent-run", () => ({ recordAgentRun: vi.fn() }));
vi.mock("@/lib/errors", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/model", () => ({ languageModel: () => ({}), modelConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({ getServiceSupabase: vi.fn() }));
vi.mock("@/lib/social/analytics", () => ({ listSnapshots: vi.fn() }));
vi.mock("@/lib/social/store", () => ({ db: vi.fn(), getContentBundle: vi.fn(), listAssets: vi.fn(), listContent: vi.fn(), listJobs: vi.fn() }));
vi.mock("@/lib/social/validate-content", () => ({ validateContent: vi.fn() }));

const { buildTools, runSocialAgent } = await import("@/lib/social/agents");
const { effectivePermissions } = await import("@/lib/social/agents-core");

const fakeOps = () => ({
  listContent: vi.fn(async () => []), getContent: vi.fn(async () => ({})), listMedia: vi.fn(async () => []), listJobs: vi.fn(async () => []),
  validate: vi.fn(async () => []), analytics: vi.fn(async () => []),
  createDraft: vi.fn(async () => ({ id: "d1" })), updateDraft: vi.fn(async () => ({})), setVariant: vi.fn(async () => ({})), tagMedia: vi.fn(async () => ({})),
});

describe("buildTools", () => {
  it("exposes only the tools the permissions allow, and never a publish/schedule/delete/account tool", () => {
    const all = Object.keys(buildTools("writer", effectivePermissions("writer", null), "o", fakeOps() as never));
    expect(all).toEqual(["list_content", "get_content", "create_draft", "update_draft"]);
    for (const a of ["strategist", "writer", "adapter", "publishing_assistant", "analytics", "media_organizer"] as const) {
      const names = Object.keys(buildTools(a, effectivePermissions(a, null), "o", fakeOps() as never));
      expect(names.some((n) => /publish|schedule|delete|account/.test(n.replace("validate_content", "")))).toBe(false);
    }
  });
  it("revoking a permission removes the write tools", () => {
    const names = Object.keys(buildTools("writer", effectivePermissions("writer", ["read_content"]), "o", fakeOps() as never));
    expect(names).toEqual(["list_content", "get_content"]);
  });
  it("runs tools scoped to the owner and audits writes", async () => {
    const ops = fakeOps();
    const audit = vi.fn();
    const tools = buildTools("writer", effectivePermissions("writer", null), "owner-1", ops as never, audit);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tools.create_draft as any).execute({ title: "T", hashtags: ["#Foo", "foo"] }, { toolCallId: "1", messages: [] });
    expect(ops.createDraft).toHaveBeenCalledWith("owner-1", expect.objectContaining({ title: "T", hashtags: ["foo"] }));
    expect(audit).toHaveBeenCalledWith("create_draft", expect.anything());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tools.list_content as any).execute({}, { toolCallId: "2", messages: [] });
    expect(ops.listContent).toHaveBeenCalledWith("owner-1");
    expect(audit).toHaveBeenCalledTimes(1); // reads are not audited as writes
  });
});

describe("runSocialAgent", () => {
  const usage = { inputTokens: 5, outputTokens: 7 };
  const gen = (extra = {}) => vi.fn(async () => ({ text: "done", usage, steps: [{ toolCalls: [{ toolName: "create_draft", input: { title: "x" } }, { toolName: "list_content", input: {} }] }], ...extra })) as never;
  const settings = { enabled: true, permissions: effectivePermissions("writer", null) };

  it("returns the text and lists only WRITE actions taken", async () => {
    const record = vi.fn();
    const r = await runSocialAgent("writer", "write a caption", "o", { generate: gen(), settings, count: async () => 0, record: record as never, ops: fakeOps() as never });
    expect(r).toMatchObject({ ok: true, text: "done", actions: [{ tool: "create_draft" }], tokens: 12 });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ kind: "social_assist", status: "success" }));
  });
  it("refuses a disabled agent without calling the model", async () => {
    const g = gen();
    expect((await runSocialAgent("writer", "x", "o", { generate: g, settings: { ...settings, enabled: false } })).ok).toBe(false);
    expect(g).not.toHaveBeenCalled();
  });
  it("enforces the shared daily cap", async () => {
    const g = gen();
    expect((await runSocialAgent("writer", "x", "o", { generate: g, settings, count: async () => 1_000_000 })).ok).toBe(false);
    expect(g).not.toHaveBeenCalled();
  });
  it("hides provider errors and records the failed run", async () => {
    const record = vi.fn();
    const g = vi.fn(async () => { throw new Error("secret"); }) as never;
    const r = await runSocialAgent("writer", "x", "o", { generate: g, settings, count: async () => 0, record: record as never });
    expect(r).toEqual({ ok: false, error: expect.not.stringContaining("secret") });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });
});
