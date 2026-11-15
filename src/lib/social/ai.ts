import "server-only";

import { generateText } from "ai";
import { recordAgentRun } from "@/lib/agent-run";
import { captureError } from "@/lib/errors";
import { languageModel, modelConfigured } from "@/lib/model";
import { getServiceSupabase } from "@/lib/supabase/server";
import {
  MAX_OUTPUT_TOKENS,
  buildPrompt,
  shapeOutput,
  type AiRequest,
} from "@/lib/social/ai-prompts";

export const AGENT_NAME = "Social Studio AI";

/** Default daily cap on assistant runs; override with SOCIAL_AI_DAILY_RUNS. */
export function dailyRunLimit(): number {
  const n = Number(process.env.SOCIAL_AI_DAILY_RUNS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 100;
}

type Generate = typeof generateText;

export type AssistResult =
  | { ok: true; text: string; hashtags?: string[]; tokens: number | null }
  | { ok: false; error: string };

async function runsToday(): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count, error } = await getServiceSupabase()
    .from("agent_runs")
    .select("id", { count: "exact", head: true })
    .like("agent_name", `${AGENT_NAME}%`)
    .gte("created_at", since);
  if (error) throw error;
  return count ?? 0;
}

/**
 * One assistant run: budget gate → model call (bounded input/output) → usage
 * recorded in the shared agent_runs ledger → shaped suggestion. The result is
 * text only; callers must show it as an AI suggestion the owner can edit.
 */
export async function runAssist(
  req: AiRequest,
  deps: { generate?: Generate; count?: () => Promise<number>; record?: typeof recordAgentRun } = {},
): Promise<AssistResult> {
  if (!req.text.trim()) return { ok: false, error: "Enter some text or a topic first." };
  if (!modelConfigured()) return { ok: false, error: "No AI model is configured (set GROQ_API_KEY)." };

  try {
    if ((await (deps.count ?? runsToday)()) >= dailyRunLimit()) {
      return { ok: false, error: "Daily AI limit reached. Raise SOCIAL_AI_DAILY_RUNS or try tomorrow." };
    }
  } catch (e) {
    // The ledger being down must not block the owner (same fail-safe as budgets.ts) — but it is reported.
    captureError("social-ai:count", e);
  }

  const { system, prompt } = buildPrompt(req);
  const startedAt = Date.now();
  const record = deps.record ?? recordAgentRun;
  try {
    const result = await (deps.generate ?? generateText)({
      model: languageModel(),
      system,
      prompt,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
    const tokens = (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0);
    await record({
      agentName: AGENT_NAME,
      kind: "social_assist",
      tokensIn: result.usage.inputTokens ?? null,
      tokensOut: result.usage.outputTokens ?? null,
      durationMs: Date.now() - startedAt,
      stepCount: 1,
      status: "success",
    });
    const shaped = shapeOutput(req.task, result.text);
    if (!shaped.text) return { ok: false, error: "The model returned nothing. Try again." };
    return { ok: true, ...shaped, tokens: tokens || null };
  } catch (e) {
    captureError("social-ai:generate", e);
    await record({ agentName: AGENT_NAME, kind: "social_assist", durationMs: Date.now() - startedAt, stepCount: 0, status: "failed" });
    return { ok: false, error: "The AI request failed. Try again in a moment." };
  }
}
