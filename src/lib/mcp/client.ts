import "server-only";

import { isIP } from "node:net";
import { assertSafeEndpoint, pinnedDispatcher } from "@/lib/net/safe-endpoint";

/**
 * Minimal MCP client over Streamable HTTP (JSON-RPC 2.0), enough to
 * discover (tools/list) and call (tools/call) tools on a remote server.
 * Spec: https://modelcontextprotocol.io/specification
 *
 * Security: the endpoint is SSRF-vetted and pinned to the vetted address
 * (same guard as call_project_tool), redirects are refused, bodies and
 * timeouts are capped, and the optional bearer token is only ever sent in the
 * Authorization header. Tested with mocked fetch only.
 */

const PROTOCOL_VERSION = "2025-06-18";
const MAX_BODY = 1_000_000;
const TIMEOUT_MS = 20_000;
export const MAX_DISCOVERED = 100;

export class McpError extends Error {}

export type McpTool = { name: string; description?: string; inputSchema?: unknown };
type Fetch = typeof fetch;

type Target = { url: URL; dispatcher: unknown };

/** Vets the endpoint and pins the connection to the vetted address. */
export async function guardEndpoint(endpoint: string): Promise<Target> {
  const url = await assertSafeEndpoint(endpoint);
  const dispatcher = pinnedDispatcher(url);
  if (!dispatcher && !isIP(url.hostname.replace(/^\[|\]$/g, ""))) {
    throw new McpError("Endpoint could not be pinned; refusing to connect.");
  }
  return { url, dispatcher };
}

/** Extracts the JSON-RPC response with `id` from a JSON or SSE body. */
export function parseRpcBody(contentType: string, text: string, id: number): { result?: unknown; error?: { message?: string } } {
  const pick = (v: unknown) => {
    const arr = Array.isArray(v) ? v : [v];
    return arr.find((m) => m && typeof m === "object" && (m as { id?: unknown }).id === id) as { result?: unknown; error?: { message?: string } } | undefined;
  };
  if (contentType.includes("text/event-stream")) {
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
      if (!data) continue;
      try {
        const m = pick(JSON.parse(data));
        if (m) return m;
      } catch {
        // not JSON; keep looking
      }
    }
    throw new McpError("The server's event stream did not contain a response.");
  }
  try {
    const m = pick(JSON.parse(text));
    if (m) return m;
  } catch {
    // fall through
  }
  throw new McpError("The server did not return a valid MCP (JSON-RPC) response.");
}

export type McpSession = {
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
};

/** Runs `fn` inside an initialized MCP session and closes it afterwards (best effort). */
export async function withMcpSession<T>(
  endpoint: string,
  token: string | null,
  fn: (s: McpSession) => Promise<T>,
  deps: { fetchImpl?: Fetch; target?: Target } = {},
): Promise<T> {
  const target = deps.target ?? (await guardEndpoint(endpoint));
  const f = deps.fetchImpl ?? fetch;
  let sessionId: string | null = null;
  let nextId = 1;

  async function post(body: unknown) {
    const res = await f(target.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": PROTOCOL_VERSION,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
      body: JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      dispatcher: target.dispatcher,
    } as RequestInit & { dispatcher?: unknown });
    if (res.status >= 300 && res.status < 400) throw new McpError("The server attempted a redirect, which is not allowed.");
    if (res.status === 401 || res.status === 403) throw new McpError("The server rejected the credentials (401/403). Check the token.");
    const text = (await res.text()).slice(0, MAX_BODY);
    if (!res.ok && res.status !== 202) throw new McpError(`The server answered with status ${res.status}.`);
    return { res, text };
  }

  async function rpc(method: string, params?: unknown) {
    const id = nextId++;
    const { res, text } = await post({ jsonrpc: "2.0", id, method, params });
    const sid = res.headers.get("mcp-session-id");
    if (sid) sessionId = sid;
    const msg = parseRpcBody(res.headers.get("content-type") ?? "", text, id);
    if (msg.error) throw new McpError(`MCP error: ${msg.error.message ?? "unknown"}`.slice(0, 300));
    return msg.result;
  }

  await rpc("initialize", { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "rashid-hq-os", version: "1.0" } });
  await post({ jsonrpc: "2.0", method: "notifications/initialized" });

  try {
    return await fn({
      async listTools() {
        const tools: McpTool[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < 5 && tools.length < MAX_DISCOVERED; page++) {
          const r = (await rpc("tools/list", cursor ? { cursor } : {})) as { tools?: McpTool[]; nextCursor?: string } | undefined;
          for (const t of r?.tools ?? []) if (t && typeof t.name === "string") tools.push(t);
          cursor = r?.nextCursor;
          if (!cursor) break;
        }
        return tools.slice(0, MAX_DISCOVERED);
      },
      async callTool(name, args) {
        const r = (await rpc("tools/call", { name, arguments: args })) as { isError?: boolean; content?: { type?: string; text?: string }[] } | undefined;
        if (r?.isError) {
          const msg = r.content?.find((c) => c.type === "text")?.text ?? "the tool reported an error";
          throw new McpError(`Remote tool error: ${msg}`.slice(0, 300));
        }
        return r;
      },
    });
  } finally {
    if (sessionId) {
      // Best effort: tell the server the session is over.
      void f(target.url, { method: "DELETE", headers: { "mcp-session-id": sessionId, ...(token ? { authorization: `Bearer ${token}` } : {}) }, redirect: "manual", signal: AbortSignal.timeout(5_000), dispatcher: target.dispatcher } as RequestInit & { dispatcher?: unknown }).catch(() => undefined);
    }
  }
}
