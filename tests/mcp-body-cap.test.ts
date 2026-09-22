import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

/**
 * L2 (security review 2026-09-21): the two MCP transports (/api/mcp,
 * /api/mcp-server) must not buffer + parse an unbounded request body. Both
 * enforce a 512 KiB cap on the measured length, with the advertised
 * content-length as a cheap first gate.
 */

const MAX = 512 * 1024;

// NextRequest is a Request subclass; the hand-rolled routes only touch
// url/headers/text() on it, so the platform Request is a faithful stand-in.
function mcpRequest(url: string, init: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest;
}

describe("/api/mcp JSON-RPC body cap", () => {
  async function send(contentLength?: number, body?: string) {
    const { POST } = await import("@/app/api/mcp/route");
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (contentLength !== undefined) headers["content-length"] = String(contentLength);
    return POST(mcpRequest("https://example.com/api/mcp", { method: "POST", headers, body: body ?? "" }));
  }

  it("rejects an oversized content-length header before reading the body", async () => {
    const res = await send(MAX + 1, '{"jsonrpc":"2.0","id":1,"method":"tools/list"}');
    expect(res.status).toBe(413);
  });

  it("rejects an oversized measured body even when content-length lies", async () => {
    const big = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "x", arguments: { blob: "a".repeat(MAX + 1) } },
    });
    const res = await send(0, big);
    expect(res.status).toBe(413);
    const outcome = (await res.json()) as { error: { code: number } };
    expect(outcome.error.code).toBe(-32600);
  });

  it("does not misfire on a legitimate-sized payload", async () => {
    const res = await send(undefined, '{"jsonrpc":"2.0","id":1,"method":"tools/list"}');
    // No token → the size gate passes and the request proceeds to auth.
    expect([200, 401, 400]).toContain(res.status);
    expect(res.status).not.toBe(413);
  });
});

describe("/api/mcp-server body cap", () => {
  async function send(contentLength?: number, body?: string) {
    const { POST } = await import("@/app/api/mcp-server/route");
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (contentLength !== undefined) headers["content-length"] = String(contentLength);
    return POST(mcpRequest("https://example.com/api/mcp-server", { method: "POST", headers, body: body ?? "" }));
  }

  it("rejects an oversized content-length header before touching the SDK", async () => {
    const res = await send(MAX + 1, '{"jsonrpc":"2.0","id":1,"method":"tools/list"}');
    expect(res.status).toBe(413);
  });

  it("rejects an oversized measured body when content-length is absent", async () => {
    const big = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: { blob: "a".repeat(MAX + 1) },
    });
    const res = await send(undefined, big);
    expect(res.status).toBe(413);
  });

  it("let a normal-sized call reach the SDK, which then rejects for auth", async () => {
    const res = await send(undefined, '{"jsonrpc":"2.0","id":1,"method":"tools/list"}');
    expect(res.status).not.toBe(413);
  });
});