import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { resolveRole } from "@/lib/members";
import { recordAgentRun } from "@/lib/agent-run";
import { runTool } from "@/lib/mcp/executor";
import { TOOLS } from "@/lib/mcp/tools";
import { languageModel, modelConfigured } from "@/lib/model";

export const runtime = "nodejs";
export const maxDuration = 300;

/** The console drives real tools; keep a runaway client from driving them far. */
const MAX_MESSAGES = 60;

const SYSTEM_PROMPT = `You are the executive assistant of the CEO of Alking Enterprises.
You operate the company's project registry and its agents through the tools you are given.
Rules:
- Always look up real data with the tools before answering; never invent project names, IDs, or metrics.
- Delegate real work to the department that owns it with delegate_to_department (use list_departments for the keys): dev covers web/game/API/mobile, store covers e-commerce, media covers marketing/video. Give the agent a complete brief — it cannot see this conversation — and report what it sends back.
- Answer quick questions about the registry yourself; delegating a lookup you can do in one tool call just adds latency.
- Reply in the same language the CEO wrote in (Arabic or English). Be brief and executive.`;

/**
 * The CEO command console. Runs the same tools the remote MCP endpoint exposes,
 * so every action it takes shows up in the live activity stream.
 */
export async function POST(request: Request) {
  // The console drives every write tool, so it needs the same admin check as a
  // server action — not the OWNER_EMAILS allowlist, which would refuse an admin
  // created through the member manager.
  const session = await getSession();
  const role = session ? await resolveRole(session.user.email) : null;
  if (!session || role !== "admin") {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  // Same gate as requireAdmin (src/lib/session.ts) — the console drives every
  // write tool, so REQUIRE_2FA covers it too.
  if (process.env.REQUIRE_2FA && !session.user.twoFactorEnabled) {
    return new Response(
      JSON.stringify({ error: "Two-factor authentication is required. Enable it in Settings." }),
      { status: 403, headers: { "content-type": "application/json" } },
    );
  }

  if (!modelConfigured()) {
    return new Response(
      JSON.stringify({
        error:
          "GROQ_API_KEY is not set. Get a free key at https://console.groq.com/keys and add it to .env.local to use the console.",
      }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  }

  let messages: UIMessage[];
  try {
    const body = (await request.json()) as { messages?: unknown };
    if (!Array.isArray(body.messages)) throw new Error("messages must be an array");
    if (body.messages.length > MAX_MESSAGES) throw new Error("conversation too long");
    messages = body.messages as UIMessage[];
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body." }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const agentName = "CEO Console";

  const tools = Object.fromEntries(
    TOOLS.map((definition) => [
      definition.name,
      tool({
        description: definition.description,
        inputSchema: definition.schema as z.ZodType<Record<string, unknown>>,
        execute: async (args: Record<string, unknown>) => {
          // The console runs as the owner, so it carries both scopes and
          // anything it registers is owned by the signed-in user. Top of the
          // chain: the console may delegate, its agents may not.
          const outcome = await runTool(definition, args, {
            agentName,
            scopes: ["read", "write"],
            ownerId: session.user.id,
            delegationDepth: 0,
            actorType: "person",
          });
          switch (outcome.status) {
            case "success":
              return outcome.result;
            case "queued":
              return { queued: true, approval_id: outcome.approvalId };
            case "denied":
              return { error: outcome.reason };
            case "failed":
              return { error: outcome.error };
          }
        },
      }),
    ]),
  );

  const startedAt = Date.now();
  let stepCount = 0;

  const result = streamText({
    model: languageModel(),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(8),
    onStepFinish: () => {
      stepCount += 1;
    },
    onFinish: async ({ usage }) => {
      await recordAgentRun({
        agentName,
        kind: "console",
        tokensIn: usage.inputTokens ?? null,
        tokensOut: usage.outputTokens ?? null,
        durationMs: Date.now() - startedAt,
        stepCount,
        status: "success",
      });
    },
    onError: async ({ error }) => {
      console.error("[console] streamText failed:", error);
      await recordAgentRun({
        agentName,
        kind: "console",
        durationMs: Date.now() - startedAt,
        stepCount,
        status: "failed",
      });
    },
  });

  return result.toUIMessageStreamResponse();
}
