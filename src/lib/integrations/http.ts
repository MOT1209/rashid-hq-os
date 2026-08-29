import "server-only";

/**
 * Outbound HTTP for provider API clients.
 *
 * Unlike `call_project_tool`, the hosts here are compile-time constants baked
 * into each provider module (`https://www.googleapis.com`, `https://api.github.com`,
 * …) — never owner input — so the SSRF guard that `assertSafeEndpoint` exists
 * for does not apply. What these calls do need is a timeout, sane error
 * surfacing, and backoff on the transient failures every third-party API has.
 */

export class IntegrationHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "IntegrationHttpError";
  }
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 20_000;

function backoffMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 30_000);
  }
  // 0.5s, 1s, 2s + jitter
  return 2 ** attempt * 500 + Math.random() * 250;
}

/**
 * fetch with a timeout and exponential backoff on 429/5xx. A non-retryable
 * error status throws `IntegrationHttpError` immediately. GET/HEAD are retried;
 * other verbs are retried only on 429 and 503 (the two that are safe to repeat
 * without risking a double write).
 */
export async function integrationFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const idempotent = method === "GET" || method === "HEAD";

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        ...init,
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (response.ok) return response;

      const retryable =
        RETRYABLE.has(response.status) &&
        (idempotent || response.status === 429 || response.status === 503);

      if (retryable && attempt < MAX_ATTEMPTS - 1) {
        await new Promise((r) =>
          setTimeout(r, backoffMs(attempt, response.headers.get("retry-after"))),
        );
        continue;
      }

      const body = await response.text().catch(() => "");
      throw new IntegrationHttpError(
        `Request to ${new URL(url).host} failed with ${response.status}.`,
        response.status,
        body.slice(0, 2_000),
      );
    } catch (error) {
      if (error instanceof IntegrationHttpError) throw error;
      lastError = error;
      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, backoffMs(attempt, null)));
      }
    }
  }
  throw new IntegrationHttpError(
    `Request to ${new URL(url).host} failed: ${
      lastError instanceof Error ? lastError.message : "network error"
    }`,
    0,
  );
}

/** integrationFetch + JSON parse, with the same error surface. */
export async function integrationFetchJson<T = unknown>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await integrationFetch(url, {
    ...init,
    headers: { accept: "application/json", ...(init.headers ?? {}) },
  });
  return (await response.json()) as T;
}
