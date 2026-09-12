import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyAgentToken } from "@/lib/agent-tokens";
import { runTool } from "@/lib/mcp/executor";
import { findTool, TOOLS } from "@/lib/mcp/tools";

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

  // A liveness probe, deliberately unauthenticated: the scheduled health
  // check (src/app/api/agent/daily-check) pings every registered project's
  // mcp_endpoint with no credentials, so gating this method behind a bearer
  // token would make every project — including this one, if self-registered
  // — read as permanently down.
  if (method === "ping") return rpcResult(id, {});

  const agent = await verifyAgentToken(request.headers.get("authorization"));
  if (!agent) return unauthorized();

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

    const parsed = tool.schema.safeParse(rawArgs);
    if (!parsed.success) {
      return rpcError(id, -32602, `Invalid arguments: ${parsed.error.message}`);
    }

    const outcome = await runTool(tool, parsed.data, {
      agentName: agent.agent_name,
      projectId: agent.project_id,
      scopes: agent.scopes,
      // Anything this token creates belongs to the owner who issued it.
      ownerId: agent.created_by,
      actorType: "agent_token",
    });

    switch (outcome.status) {
      case "denied":
        // A token's scopes (or the policy gate) are the authorization
        // decision, not decoration.
        return rpcError(id, -32003, outcome.reason);
      case "queued":
        return rpcResult(id, {
          content: [{ type: "text", text: "Queued for admin approval." }],
          structuredContent: { queued: true, approval_id: outcome.approvalId },
        });
      case "success":
        return rpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(outcome.result) }],
          structuredContent: outcome.result,
        });
      case "failed":
        return rpcResult(id, {
          content: [{ type: "text", text: outcome.error }],
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
