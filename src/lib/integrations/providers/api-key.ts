import "server-only";

import { integrationFetch } from "@/lib/integrations/http";
import type { IntegrationProvider, ProviderMeta, SecretBundle } from "@/lib/integrations/types";

/**
 * Providers authenticated by a single secret the owner pastes in — no OAuth
 * dance. The key is sealed by encryption.ts before it touches the database and
 * is never sent to the browser (only a fingerprint is).
 *
 * `test` proves the key works against a cheap, read-only endpoint.
 */

type ApiKeyConfig = {
  meta: Omit<ProviderMeta, "authMethod" | "scopes" | "readiness" | "hasWebhooks"> &
    Partial<Pick<ProviderMeta, "readiness" | "hasWebhooks">>;
  /** Given the key, hit a harmless endpoint and return an account label. */
  test: (apiKey: string) => Promise<string>;
};

function apiKeyProvider(config: ApiKeyConfig): IntegrationProvider {
  return {
    meta: {
      ...config.meta,
      authMethod: "api_key",
      scopes: [],
      readiness: config.meta.readiness ?? "available",
      hasWebhooks: config.meta.hasWebhooks ?? false,
    },
    async testConnection(secret: SecretBundle) {
      const key = secret.api_key;
      if (!key) throw new Error("No API key stored for this connection.");
      const label = await config.test(key);
      return { accountLabel: label };
    },
  };
}

export const openaiProvider = apiKeyProvider({
  meta: {
    id: "openai",
    name: "OpenAI",
    description: {
      ar: "مفتاح OpenAI API لاستخدام النماذج من الخادم.",
      en: "OpenAI API key for server-side model calls.",
    },
    icon: "Sparkles",
    category: "ai",
    docsUrl: "https://platform.openai.com/docs",
    requiredEnv: [],
  },
  async test(apiKey) {
    const res = await integrationFetch("https://api.openai.com/v1/models", {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    const data = (await res.json()) as { data?: { id: string }[] };
    return `${data.data?.length ?? 0} models available`;
  },
});

export const anthropicProvider = apiKeyProvider({
  meta: {
    id: "anthropic",
    name: "Anthropic",
    description: {
      ar: "مفتاح Anthropic API لاستخدام نماذج Claude من الخادم.",
      en: "Anthropic API key for server-side Claude calls.",
    },
    icon: "Bot",
    category: "ai",
    docsUrl: "https://docs.anthropic.com/",
    requiredEnv: [],
  },
  async test(apiKey) {
    const res = await integrationFetch("https://api.anthropic.com/v1/models", {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    });
    const data = (await res.json()) as { data?: { id: string }[] };
    return `${data.data?.length ?? 0} models available`;
  },
});

export const geminiProvider = apiKeyProvider({
  meta: {
    id: "gemini",
    name: "Google Gemini",
    description: {
      ar: "مفتاح Google AI (Gemini) API.",
      en: "Google AI (Gemini) API key.",
    },
    icon: "Gem",
    category: "ai",
    docsUrl: "https://ai.google.dev/gemini-api/docs",
    requiredEnv: [],
  },
  async test(apiKey) {
    const res = await integrationFetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    );
    const data = (await res.json()) as { models?: { name: string }[] };
    return `${data.models?.length ?? 0} models available`;
  },
});

/**
 * Microsoft Clarity is configuration, not an API integration: the owner stores
 * a Project ID that the front end would use for the tracking snippet. There is
 * no server-side API to test, so `testConnection` just confirms the shape.
 * Docs: https://learn.microsoft.com/en-us/clarity/
 */
export const clarityProvider: IntegrationProvider = {
  meta: {
    id: "clarity",
    name: "Microsoft Clarity",
    description: {
      ar: "معرّف مشروع Clarity لإعداد تتبّع تحليلات الجلسات.",
      en: "Clarity project ID for session-analytics tracking configuration.",
    },
    icon: "Eye",
    category: "analytics",
    authMethod: "config",
    readiness: "available",
    scopes: [],
    docsUrl: "https://learn.microsoft.com/en-us/clarity/",
    requiredEnv: [],
    hasWebhooks: false,
  },
  async testConnection(secret) {
    const id = secret.api_key;
    if (!id || !/^[a-z0-9]{6,15}$/i.test(id)) {
      throw new Error("That does not look like a Clarity project ID.");
    }
    return { accountLabel: `Project ${id}` };
  },
};
