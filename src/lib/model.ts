import "server-only";

import { groq } from "@ai-sdk/groq";
import type { LanguageModel } from "ai";

/**
 * Which model the console and the department agents run on.
 *
 * Two providers were tried and abandoned for reasons that had nothing to do
 * with the code: the Vercel AI Gateway refuses every request until a credit
 * card is on file (`customer_verification_required`), and the Gemini keys
 * available here were short-lived Live-API tokens against a project with no
 * free quota. Groq issues a long-lived key with no card and a usable free
 * tier, which is what this deployment actually needs.
 *
 * One place rather than two, because the console and a department agent must
 * not silently end up on different models.
 */

/**
 * Chosen for tool calling specifically: the console drives 14 tools and a
 * department agent 13, so instruction-following on tool schemas matters far
 * more here than prose quality.
 */
const DEFAULT_MODEL = "openai/gpt-oss-120b";

export function modelConfigured() {
  return Boolean(process.env.GROQ_API_KEY);
}

/**
 * `override` is a department's own `model` column; null falls back to the
 * environment, then to the default above.
 */
export function languageModel(override?: string | null): LanguageModel {
  return groq(override || process.env.GROQ_MODEL || DEFAULT_MODEL);
}
