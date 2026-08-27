import { NextResponse } from "next/server";
import {
  UnknownProjectToolError,
  runProjectTool,
  verifyProjectToolCall,
} from "@/lib/project-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reference implementation of a project's own MCP endpoint — the far side of
 * call_project_tool (src/lib/mcp/tools.ts) and of the scheduled health check
 * (src/app/api/agent/daily-check). It is registered on projects as their
 * mcp_endpoint so the whole path works end to end today; a real project
 * reimplements this route in its own codebase and points HQ at it instead.
 */
export async function POST(request: Request) {
  const raw = await request.text();

  // The health check POSTs a credential-free JSON-RPC ping — answered here the
  // same way the HQ endpoint (src/app/api/mcp) answers it.
  let rpc: { method?: unknown; id?: unknown } = {};
  try {
    rpc = JSON.parse(raw) as typeof rpc;
  } catch {
    // Not JSON — the verifier below returns a clean 400.
  }
  if (rpc.method === "ping") {
    return NextResponse.json({ jsonrpc: "2.0", id: rpc.id ?? null, result: {} });
  }

  const verdict = verifyProjectToolCall(raw, {
    signature: request.headers.get("x-hq-signature"),
    source: request.headers.get("x-hq-source"),
  });
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.error }, { status: verdict.status });
  }

  try {
    const result = runProjectTool(verdict.call);
    return NextResponse.json({ ok: true, tool: verdict.call.tool, result });
  } catch (error) {
    if (error instanceof UnknownProjectToolError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}

export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
