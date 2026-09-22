import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * L6/M2 (security review 2026-09-21): the webhook ingress is unauthenticated
 * by design, so it must (1) refuse providers it can't verify before reading
 * any body, (2) honour content-length so oversized payloads are rejected
 * before they are buffered, and (3) de-duplicate deliveries by payload hash so
 * a replayed webhook can never be processed twice.
 */

type Result = { data?: unknown; error?: unknown };
let insertResult: Result = { data: { id: "w1" }, error: null };
const inserts: Record<string, unknown>[] = [];

const from = vi.fn((table: string) => {
  const insert = (row: Record<string, unknown>) => {
    inserts.push(row);
    return Promise.resolve(insertResult);
  };
  const chain = Object.assign(
    () => chain,
    {
      insert: (row: Record<string, unknown>) => insert(row),
      select: () => chain,
      eq: () => chain,
      single: async () => insertResult,
    },
  );
  return chain;
});

vi.mock("@/lib/supabase/server", () => ({ getServiceSupabase: () => ({ from }) }));

const logIntegration = vi.fn(async (_input: unknown) => {});
vi.mock("@/lib/integrations/logger", () => ({
  logIntegration: (input: unknown) => logIntegration(input),
}));
const captureError = vi.fn();
vi.mock("@/lib/errors", () => ({ captureError: (input: unknown) => captureError(input) }));

type WebhookVerdict = { valid: boolean; eventId?: string | null; eventType?: string | null };
const verifyWebhook = vi.fn(
  (_input: unknown): WebhookVerdict => ({ valid: true, eventId: "evt_1", eventType: "push" }),
);

vi.mock("@/lib/integrations/registry", () => ({
  getProvider: (id: string) =>
    id === "test-provider"
      ? {
          id: "test-provider",
          name: "Test",
          verifyWebhook: (input: unknown) => verifyWebhook(input),
        }
      : undefined,
}));

beforeEach(() => {
  verifyWebhook.mockReset();
  verifyWebhook.mockReturnValue({ valid: true, eventId: "evt_1", eventType: "push" });
  insertResult = { data: { id: "w1" }, error: null };
  inserts.length = 0;
  logIntegration.mockClear();
});

async function POST(body?: BodyInit | null, headers?: HeadersInit) {
  const { POST } = await import("@/app/api/webhooks/[provider]/route");
  return POST(
    new Request("https://example.com/api/webhooks/test-provider", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    }),
    { params: Promise.resolve({ provider: "test-provider" }) },
  );
}

describe("webhook ingress", () => {
  it("returns 404 for an unknown provider without reading the body", async () => {
    const { POST } = await import("@/app/api/webhooks/[provider]/route");
    const res = await POST(
      new Request("https://example.com/api/webhooks/nope", {
        method: "POST",
        body: '{ "whatever": true }',
      }),
      { params: Promise.resolve({ provider: "nope" }) },
    );
    expect(res.status).toBe(404);
    expect(verifyWebhook).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it("rejects oversized payloads from the content-length header before buffering", async () => {
    const res = await POST("{}", { "content-length": String(2_000_000) });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "Payload too large." });
    expect(verifyWebhook).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it("stores the payload hash for replay protection", async () => {
    const body = JSON.stringify({ action: "opened", number: 4 });

    const res = await POST(body);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      provider: "test-provider",
      event_id: "evt_1",
      event_type: "push",
      status: "verified",
    });
    const { createHash } = await import("node:crypto");
    expect(inserts[0].content_hash).toBe(`sha256:${createHash("sha256").update(body).digest("hex")}`);
  });

  it("answers duplicate=true when the unique hash/index rejects the same body", async () => {
    insertResult = { data: null, error: { message: "duplicate", code: "23505" } };

    const res = await POST(JSON.stringify({ id: 1 }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, duplicate: true });
    expect(logIntegration).toHaveBeenCalledWith(
      expect.objectContaining({ status: "success", detail: expect.objectContaining({ duplicate: true }) }),
    );
  });

  it("rejects invalid signatures at 401", async () => {
    verifyWebhook.mockReturnValue({ valid: false, eventId: null, eventType: null });

    const res = await POST(JSON.stringify({}));

    expect(res.status).toBe(401);
    expect(inserts).toHaveLength(0);
  });
});