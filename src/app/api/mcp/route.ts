import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyAgentToken } from "@/lib/agent-tokens";
import { startActivity } from "@/lib/activity";
import { findTool, scopeDenialReason, TOOLS } from "@/lib/mcp/tools";
import type { Json } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROTOCOL_VERSION = "2025-06-18";

type RpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

function rpcResult(id: RpcRequest["id"], result: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result });
}

function rpcError(id: RpcRequest["id"], code: number, message: string, status = 200) {
  return NextResponse.json(
    { jsonrpc: "2.0", id: id ?? null, error: { code, message } },
    { status },
  );
}

function unauthorized() {
  return NextResponse.json(
    { error: "invalid_token", error_description: "Missing or revoked agent token." },
    {
      status: 401,
      headers: { "WWW-Authenticate": 'Bearer realm="rashid-hq-os"' },
    },
  );
}

/**
 * Universal remote MCP endpoint (JSON-RPC 2.0 over HTTP).
 * Agents authenticate with a bearer token issued from /dashboard/access;
 * every tool call is written to agent_logs and streams to the dashboard live.
 */
export async function POST(request: Request) {
  const agent = await verifyAgentToken(request.headers.get("authorization"));
  if (!agent) return unauthorized();

  let body: RpcRequest;
  try {
    body = (await request.json()) as RpcRequest;
  } catch {
    return rpcError(null, -32700, "Parse error");
  }

  const { id, params } = body;
  const method = body?.method;
  // A body without a string `method` used to reach method.startsWith() and
  // throw, turning a malformed request into a 500 instead of a protocol error.
  if (typeof method !== "string") {
    return rpcError(id, -32600, "Invalid Request: missing method");
  }

  if (method === "initialize") {
    return rpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "alking-hq-mcp", version: "1.0.0" },
    });
  }

  // Notifications carry no id and expect no response body.
  if (method.startsWith("notifications/")) {
    return new NextResponse(null, { status: 202 });
  }

  if (method === "ping") return rpcResult(id, {});

  if (method === "tools/list") {
    return rpcResult(id, {
      tools: TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: z.toJSONSchema(tool.schema, { io: "input" }),
      })),
    });
  }

  if (method === "tools/call") {
    const toolName = String(params?.name ?? "");
    const rawArgs = (params?.arguments ?? {}) as Record<string, unknown>;
    const tool = findTool(toolName);
    if (!tool) return rpcError(id, -32602, `Unknown tool: ${toolName}`);

    // A token's scopes are the authorization decision, not decoration.
    const denied = scopeDenialReason(tool, agent.scopes);
    if (denied) return rpcError(id, -32003, denied);

    const parsed = tool.schema.safeParse(rawArgs);
    if (!parsed.success) {
      return rpcError(id, -32602, `Invalid arguments: ${parsed.error.message}`);
    }

    // Read project_id from the validated args — the raw value is an arbitrary
    // string that would silently fail the uuid column on insert.
    const args = parsed.data as Record<string, unknown>;
    const finish = await startActivity({
      projectId:
        agent.project_id ??
        (typeof args.project_id === "string" ? args.project_id : null),
      agentName: agent.agent_name,
      toolName,
      payload: parsed.data as Json,
    });

    try {
      const result = await tool.execute(parsed.data as never, {
        agentName: agent.agent_name,
        projectId: agent.project_id,
        scopes: agent.scopes,
        // Anything this token creates belongs to the owner who issued it.
        ownerId: agent.created_by,
      });
      await finish("success", result);
      return rpcResult(id, {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      });
    } catch (error) {
      // Tool errors are already sanitised (see src/lib/errors.ts); anything
      // else is logged in full and reported generically.
      const message =
        error instanceof Error ? error.message : "The tool failed unexpectedly.";
      console.error(`[mcp] ${toolName} failed:`, error);
      await finish("failed", { error: message });
      return rpcResult(id, {
        content: [{ type: "text", text: message }],
        isError: true,
      });
    }
  }

  return rpcError(id, -32601, `Method not found: ${method}`);
}

export async function GET(request: Request) {
  const agent = await verifyAgentToken(request.headers.get("authorization"));
  if (!agent) return unauthorized();
  // No server-initiated messages yet; clients should use POST.
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
