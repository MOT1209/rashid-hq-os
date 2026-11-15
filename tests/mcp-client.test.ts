import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/net/safe-endpoint", () => ({ assertSafeEndpoint: vi.fn(), pinnedDispatcher: vi.fn() }));

const { withMcpSession, parseRpcBody, McpError } = await import("@/lib/mcp/client");

const target = { url: new URL("https://mcp.example.com/mcp"), dispatcher: undefined };
const json = (body: unknown, headers: Record<string, string> = {}, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const ack = () => new Response(null, { status: 202 });

describe("parseRpcBody", () => {
  it("parses plain JSON and SSE, matching on id", () => {
    expect(parseRpcBody("application/json", JSON.stringify({ jsonrpc: "2.0", id: 2, result: { a: 1 } }), 2).result).toEqual({ a: 1 });
    const sse = `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 3, result: { b: 2 } })}\n\n`;
    expect(parseRpcBody("text/event-stream", sse, 3).result).toEqual({ b: 2 });
  });
  it("ignores responses for other ids and rejects garbage", () => {
    expect(() => parseRpcBody("application/json", JSON.stringify({ id: 9, result: {} }), 1)).toThrow(McpError);
    expect(() => parseRpcBody("application/json", "<html>", 1)).toThrow(McpError);
  });
});

describe("withMcpSession (mocked HTTP)", () => {
  it("initializes, sends the session id and bearer token, lists tools with pagination", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "x" } }, { "mcp-session-id": "S1" }))
      .mockResolvedValueOnce(ack())
      .mockResolvedValueOnce(json({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "a" }], nextCursor: "c2" } }))
      .mockResolvedValueOnce(json({ jsonrpc: "2.0", id: 3, result: { tools: [{ name: "b", description: "d", inputSchema: { type: "object" } }] } }))
      .mockResolvedValue(ack());
    const tools = await withMcpSession("https://mcp.example.com/mcp", "TOK", (s) => s.listTools(), { fetchImpl: f as never, target });
    expect(tools.map((t) => t.name)).toEqual(["a", "b"]);
    const second = f.mock.calls[2][1] as RequestInit;
    expect(second.headers).toMatchObject({ authorization: "Bearer TOK", "mcp-session-id": "S1" });
    expect(f.mock.calls[3][1].body).toContain('"cursor":"c2"');
  });

  it("calls a tool and returns its result; isError becomes a failure", async () => {
    const ok = vi.fn()
      .mockResolvedValueOnce(json({ jsonrpc: "2.0", id: 1, result: {} }))
      .mockResolvedValueOnce(ack())
      .mockResolvedValueOnce(json({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: "hi" }] } }));
    expect(await withMcpSession("u", null, (s) => s.callTool("echo", { x: 1 }), { fetchImpl: ok as never, target })).toMatchObject({ content: [{ text: "hi" }] });
    expect(JSON.parse(ok.mock.calls[2][1].body)).toMatchObject({ method: "tools/call", params: { name: "echo", arguments: { x: 1 } } });

    const bad = vi.fn()
      .mockResolvedValueOnce(json({ jsonrpc: "2.0", id: 1, result: {} }))
      .mockResolvedValueOnce(ack())
      .mockResolvedValueOnce(json({ jsonrpc: "2.0", id: 2, result: { isError: true, content: [{ type: "text", text: "boom" }] } }));
    await expect(withMcpSession("u", null, (s) => s.callTool("echo", {}), { fetchImpl: bad as never, target })).rejects.toThrow(/boom/);
  });

  it("maps auth failures, redirects and JSON-RPC errors to clear errors", async () => {
    await expect(withMcpSession("u", "T", (s) => s.listTools(), { fetchImpl: vi.fn().mockResolvedValue(new Response("", { status: 401 })) as never, target })).rejects.toThrow(/credentials/);
    await expect(withMcpSession("u", null, (s) => s.listTools(), { fetchImpl: vi.fn().mockResolvedValue(new Response("", { status: 302 })) as never, target })).rejects.toThrow(/redirect/);
    await expect(withMcpSession("u", null, (s) => s.listTools(), { fetchImpl: vi.fn().mockResolvedValue(json({ jsonrpc: "2.0", id: 1, error: { message: "nope" } })) as never, target })).rejects.toThrow(/nope/);
  });

  it("caps discovery at the configured maximum", async () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ name: `t${i}` }));
    const f = vi.fn()
      .mockResolvedValueOnce(json({ jsonrpc: "2.0", id: 1, result: {} }))
      .mockResolvedValueOnce(ack())
      .mockResolvedValueOnce(json({ jsonrpc: "2.0", id: 2, result: { tools: many } }));
    expect((await withMcpSession("u", null, (s) => s.listTools(), { fetchImpl: f as never, target })).length).toBe(100);
  });
});
