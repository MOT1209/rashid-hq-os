import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, createHmac } from "node:crypto";

/**
 * Switching from a bare SHA-256 to a keyed HMAC must not strand tokens that
 * were issued under the old scheme, so verification accepts both and rewrites
 * the weaker digest on first use.
 */

const PEPPER = "test-pepper";
const TOKEN = "hq_" + "b".repeat(43);

const sha = createHash("sha256").update(TOKEN).digest("hex");
const hmac = createHmac("sha256", PEPPER).update(TOKEN).digest("hex");

const rows = new Map<string, unknown>();
const updates: Record<string, unknown>[] = [];

const from = vi.fn(() => ({
  select: () => ({
    eq: (_column: string, value: string) => ({
      maybeSingle: async () => ({ data: rows.get(value) ?? null, error: null }),
    }),
  }),
  update: (patch: Record<string, unknown>) => {
    updates.push(patch);
    return { eq: async () => ({ error: null }) };
  },
}));

vi.mock("@/lib/supabase/server", () => ({ getServiceSupabase: () => ({ from }) }));

function record() {
  return {
    id: "t1",
    agent_name: "legacy-agent",
    token_prefix: TOKEN.slice(0, 11),
    scopes: ["read"],
    project_id: null,
    created_by: "owner-1",
    last_used_at: null,
    revoked_at: null,
    expires_at: null,
    created_at: new Date().toISOString(),
  };
}

beforeEach(() => {
  rows.clear();
  updates.length = 0;
  vi.resetModules();
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("with TOKEN_PEPPER set", () => {
  async function load() {
    process.env.TOKEN_PEPPER = PEPPER;
    return import("@/lib/agent-tokens");
  }

  it("hashes new tokens with the keyed digest, not the bare one", async () => {
    const { verifyAgentToken } = await load();
    rows.set(hmac, record());

    const found = await verifyAgentToken(`Bearer ${TOKEN}`);
    expect(found?.agent_name).toBe("legacy-agent");
    expect(sha).not.toBe(hmac);
  });

  it("still accepts a token stored under the old bare digest", async () => {
    const { verifyAgentToken } = await load();
    rows.set(sha, record());

    const found = await verifyAgentToken(`Bearer ${TOKEN}`);
    expect(found?.agent_name).toBe("legacy-agent");
  });

  it("rewrites the old digest in place so it stops being stored weakly", async () => {
    const { verifyAgentToken } = await load();
    rows.set(sha, record());

    await verifyAgentToken(`Bearer ${TOKEN}`);
    // The write is fire-and-forget (deliberately — a digest upgrade must never
    // block a verification), so poll instead of sleeping a fixed amount.
    await vi.waitFor(() => {
      expect(updates.at(-1)).toMatchObject({ token_hash: hmac });
    });
  });

  it("still rejects a token that matches neither digest", async () => {
    const { verifyAgentToken } = await load();
    expect(await verifyAgentToken(`Bearer ${TOKEN}`)).toBeNull();
  });
});

describe("without TOKEN_PEPPER", () => {
  it("keeps the original behaviour and does not rewrite anything", async () => {
    delete process.env.TOKEN_PEPPER;
    const { verifyAgentToken } = await import("@/lib/agent-tokens");
    rows.set(sha, record());

    const found = await verifyAgentToken(`Bearer ${TOKEN}`);
    await new Promise((r) => setTimeout(r, 10));

    expect(found?.agent_name).toBe("legacy-agent");
    expect(updates.at(-1)).not.toHaveProperty("token_hash");
  });
});
