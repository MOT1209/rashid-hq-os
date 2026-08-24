import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { verifyAgentToken } from "@/lib/agent-tokens";
import { startActivity } from "@/lib/activity";
import { TOOLS, scopeDenialReason } from "@/lib/mcp/tools";
import type { Json } from "@/types/database";

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

          // A token's scopes are the authorization decision, not decoration —
          // same check the JSON-RPC endpoint makes.
          const denied = scopeDenialReason(tool, authInfo?.scopes);
          if (denied) {
            return { content: [{ type: "text", text: denied }], isError: true };
          }

          const argsRecord = (args ?? {}) as Record<string, unknown>;
          const finish = await startActivity({
            projectId:
              extra.projectId ??
              (typeof argsRecord.project_id === "string" ? argsRecord.project_id : null),
            agentName: extra.agentName ?? "unknown",
            toolName: tool.name,
            payload: argsRecord as Json,
          });

          try {
            const result = await tool.execute(args as never, {
              agentName: extra.agentName ?? "unknown",
              projectId: extra.projectId,
              scopes: authInfo?.scopes,
              ownerId: extra.ownerId,
            });
            await finish("success", result);
            return {
              content: [{ type: "text", text: JSON.stringify(result) }],
              structuredContent: result,
            };
          } catch (error) {
            // Tool errors are already sanitised (see src/lib/errors.ts);
            // anything else is logged in full and reported generically.
            const message =
              error instanceof Error ? error.message : "The tool failed unexpectedly.";
            console.error(`[mcp-server] ${tool.name} failed:`, error);
            await finish("failed", { error: message });
            return { content: [{ type: "text", text: message }], isError: true };
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
