import "server-only";

import { google } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

/**
 * Which model the console and the department agents run on.
 *
 * This used to go through the Vercel AI Gateway, which refuses every request
 * until a credit card is on file — `customer_verification_required`, even for
 * the free credit. That made the whole agent system unreachable, so it calls
 * Google directly instead: an AI Studio key is free and needs no card.
 *
 * One place rather than two, because the console and a department agent must
 * not silently end up on different models.
 */

/** Gemini's newest flash generation; unrecognised gemini-* ids resolve upward. */
const DEFAULT_MODEL = "gemini-3.7-flash";

export function modelConfigured() {
  return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
}

/**
 * `override` is a department's own `model` column; null falls back to the
 * environment, then to the default above.
 */
export function languageModel(override?: string | null): LanguageModel {
  return google(override || process.env.GEMINI_MODEL || DEFAULT_MODEL);
}
