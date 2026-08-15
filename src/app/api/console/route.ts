import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { startActivity } from "@/lib/activity";
import { TOOLS } from "@/lib/mcp/tools";
import type { Json } from "@/types/database";

export const runtime = "nodejs";
export const maxDuration = 300;

const SYSTEM_PROMPT = `You are the executive assistant of the CEO of Alking Enterprises.
You operate the company's project registry and its agents through the tools you are given.
Rules:
- Always look up real data with the tools before answering; never invent project names, IDs, or metrics.
- Route work to the right department: Dev Agent (web/game/API/mobile), Store Agent (e-commerce), Media Agent (marketing/video).
- Reply in the same language the CEO wrote in (Arabic or English). Be brief and executive.`;

/**
 * The CEO command console. Runs the same tools the remote MCP endpoint exposes,
 * so every action it takes shows up in the live activity stream.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  if (!process.env.AI_GATEWAY_API_KEY) {
    return new Response(
      JSON.stringify({
        error:
          "AI_GATEWAY_API_KEY is not set. Add it to .env.local (Vercel AI Gateway) to use the console.",
      }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  }

  const { messages } = (await request.json()) as { messages: UIMessage[] };
  const agentName = "CEO Console";

  const tools = Object.fromEntries(
    TOOLS.map((definition) => [
      definition.name,
      tool({
        description: definition.description,
        inputSchema: definition.schema as z.ZodType<Record<string, unknown>>,
        execute: async (args: Record<string, unknown>) => {
          const finish = await startActivity({
            projectId: typeof args.project_id === "string" ? args.project_id : null,
            agentName,
            toolName: definition.name,
            payload: args as Json,
          });
          try {
            const result = await definition.execute(args as never, { agentName });
            await finish("success", result);
            return result;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await finish("failed", { error: message });
            return { error: message };
          }
        },
      }),
    ]),
  );

  const result = streamText({
    model: process.env.CEO_CONSOLE_MODEL ?? "anthropic/claude-sonnet-5",
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(8),
  });

  return result.toUIMessageStreamResponse();
}
