import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { verifyAgentToken } from "@/lib/agent-tokens";
import { runTool } from "@/lib/mcp/executor";
import { TOOLS } from "@/lib/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Real MCP server, reachable by any Streamable-HTTP MCP client (Claude Code,
 * Claude Desktop, ...) rather than only by callers of the hand-rolled
 * JSON-RPC endpoint at /api/mcp. Same tool registry (src/lib/mcp/tools.ts),
 * same bearer tokens, same activity log — this is a second transport onto
 * the same server, not a second implementation. /api/mcp is left in place
 * for whatever already calls it.
 */

type AgentContext = {
  agentName: string;
  projectId?: string | null;
  ownerId?: string | null;
};

const mcpHandler = createMcpHandler(
  (server) => {
    for (const tool of TOOLS) {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.schema },
        async (args, ctx) => {
          const authInfo = ctx.http?.authInfo;
          const extra = (authInfo?.extra ?? {}) as AgentContext;

          const outcome = await runTool(tool, args, {
            agentName: extra.agentName ?? "unknown",
            projectId: extra.projectId,
            scopes: authInfo?.scopes,
            ownerId: extra.ownerId,
            actorType: "agent_token",
          });

          switch (outcome.status) {
            case "denied":
              // A token's scopes (or the policy gate) are the authorization
              // decision, not decoration — same check the JSON-RPC endpoint makes.
              return { content: [{ type: "text", text: outcome.reason }], isError: true };
            case "queued":
              return {
                content: [{ type: "text", text: "Queued for admin approval." }],
                structuredContent: { queued: true, approval_id: outcome.approvalId },
              };
            case "success":
              return {
                content: [{ type: "text", text: JSON.stringify(outcome.result) }],
                structuredContent: outcome.result,
              };
            case "failed":
              return { content: [{ type: "text", text: outcome.error }], isError: true };
          }
        },
      );
    }
  },
  { serverInfo: { name: "alking-hq-mcp", version: "1.0.0" } },
);

/**
 * Bridges our own agent_tokens table into the SDK's AuthInfo shape.
 * `extra` carries what the JSON-RPC route reads off `agent` directly —
 * the tool-context fields aren't part of AuthInfo's own schema.
 */
const authedHandler = withMcpAuth(
  mcpHandler,
  async (_req, bearerToken) => {
    const agent = await verifyAgentToken(bearerToken ? `Bearer ${bearerToken}` : null);
    if (!agent) return undefined;

    return {
      token: bearerToken ?? "",
      clientId: agent.agent_name,
      scopes: agent.scopes,
      extra: {
        agentName: agent.agent_name,
        projectId: agent.project_id,
        ownerId: agent.created_by,
      } satisfies AgentContext,
    };
  },
  { required: true },
);

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE };
