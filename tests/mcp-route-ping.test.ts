import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `ping` is the one JSON-RPC method the scheduled health check
 * (src/app/api/agent/daily-check) calls with no Authorization header at all.
 * Every other method requires a bearer token, so `ping` must be dispatched
 * before the auth gate — otherwise every registered project, including this
 * one if self-registered, reads as permanently down.
 */

const verifyAgentToken = vi.fn();
vi.mock("@/lib/agent-tokens", () => ({ verifyAgentToken: (...a: [string | null]) => verifyAgentToken(...a) }));
vi.mock("@/lib/activity", () => ({ startActivity: vi.fn() }));
vi.mock("@/lib/mcp/tools", () => ({
  findTool: vi.fn(),
  scopeDenialReason: vi.fn(),
  TOOLS: [],
}));

const { POST } = await import("@/app/api/mcp/route");

function rpcRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://example.com/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  verifyAgentToken.mockReset().mockResolvedValue(null);
});

describe("POST /api/mcp — ping", () => {
  it("answers ping with no Authorization header at all", async () => {
    const response = await POST(rpcRequest({ jsonrpc: "2.0", id: 1, method: "ping" }));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
    expect(verifyAgentToken).not.toHaveBeenCalled();
  });

  it("still requires a token for every other method", async () => {
    const response = await POST(rpcRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    expect(response.status).toBe(401);
    expect(verifyAgentToken).toHaveBeenCalled();
  });
});
