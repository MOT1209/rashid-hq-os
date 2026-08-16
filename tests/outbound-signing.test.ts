import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

/**
 * call_project_tool used to POST with nothing but a content-type, so the
 * receiving MCP server could not tell a genuine call from anyone who found the
 * URL. These pin down what it now sends.
 */

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

vi.mock("@/lib/supabase/server", () => ({
  getServiceSupabase: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: table === "project_tools" ? { endpoint: "https://tool.example/x" } : null,
            }),
          }),
          maybeSingle: async () => ({ data: null }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/net/safe-endpoint", () => ({
  assertSafeEndpoint: async (v: string) => new URL(v),
  pinnedDispatcher: () => undefined,
  UnsafeEndpointError: class extends Error {},
}));

const { findTool } = await import("@/lib/mcp/tools");

const PROJECT = "11111111-1111-4111-8111-111111111111";

function call() {
  return findTool("call_project_tool")!.execute(
    { project_id: PROJECT, tool_name: "deploy", input: { ref: "main" } } as never,
    { agentName: "agent", scopes: ["read", "write"] },
  );
}

function sentRequest() {
  const [, init] = fetchMock.mock.calls.at(-1) as [URL, RequestInit];
  return {
    headers: init.headers as Record<string, string>,
    body: JSON.parse(String(init.body)) as Record<string, unknown>,
    raw: String(init.body),
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ done: true }),
  });
});

afterEach(() => {
  delete process.env.OUTBOUND_SIGNING_SECRET;
});

describe("outbound identity", () => {
  it("always names itself so a receiver can recognise the caller", async () => {
    await call();
    expect(sentRequest().headers["x-hq-source"]).toBe("alking-hq");
  });

  it("sends no signature when no secret is configured", async () => {
    await call();
    expect(sentRequest().headers["x-hq-signature"]).toBeUndefined();
  });

  it("signs the exact body when a secret is set", async () => {
    process.env.OUTBOUND_SIGNING_SECRET = "shared-secret";
    await call();

    const { headers, raw } = sentRequest();
    const expected =
      "sha256=" + createHmac("sha256", "shared-secret").update(raw).digest("hex");
    expect(headers["x-hq-signature"]).toBe(expected);
  });

  it("a tampered body no longer matches the signature", async () => {
    process.env.OUTBOUND_SIGNING_SECRET = "shared-secret";
    await call();

    const { headers, raw } = sentRequest();
    const tampered = raw.replace('"main"', '"attacker-branch"');
    const forged =
      "sha256=" + createHmac("sha256", "shared-secret").update(tampered).digest("hex");
    expect(forged).not.toBe(headers["x-hq-signature"]);
  });

  it("carries the project and a timestamp inside the signed body, so replays are detectable", async () => {
    process.env.OUTBOUND_SIGNING_SECRET = "shared-secret";
    await call();

    const { body } = sentRequest();
    expect(body.project_id).toBe(PROJECT);
    expect(body.tool).toBe("deploy");
    expect(typeof body.issued_at).toBe("string");
    expect(Number.isNaN(Date.parse(String(body.issued_at)))).toBe(false);
  });
});
