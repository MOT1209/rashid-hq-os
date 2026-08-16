import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * verifyAgentToken is what stands between the internet and every MCP tool.
 * These cover its rejection paths — a revoked or expired token must fail shut,
 * and a malformed header must never reach the database at all.
 */

const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const update = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));
const from = vi.fn(() => ({ select, update }));

vi.mock("@/lib/supabase/server", () => ({
  getServiceSupabase: () => ({ from }),
}));

const { verifyAgentToken } = await import("@/lib/agent-tokens");

const VALID = "hq_" + "a".repeat(43);

function token(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: "t1",
      agent_name: "agent",
      token_prefix: VALID.slice(0, 11),
      scopes: ["read"],
      project_id: null,
      created_by: "owner-1",
      last_used_at: null,
      revoked_at: null,
      expires_at: null,
      created_at: new Date().toISOString(),
      ...overrides,
    },
    error: null,
  };
}

beforeEach(() => {
  from.mockClear();
  maybeSingle.mockReset();
});

describe("verifyAgentToken", () => {
  it("rejects a missing or malformed Authorization header without touching the database", async () => {
    for (const header of [null, "", "Basic abc", "Bearer", "bearer hq_x", "Bearer wrong_prefix"]) {
      expect(await verifyAgentToken(header), String(header)).toBeNull();
    }
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects a token that is not in the database", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await verifyAgentToken(`Bearer ${VALID}`)).toBeNull();
  });

  it("rejects a revoked token", async () => {
    maybeSingle.mockResolvedValue(token({ revoked_at: new Date().toISOString() }));
    expect(await verifyAgentToken(`Bearer ${VALID}`)).toBeNull();
  });

  it("rejects an expired token", async () => {
    maybeSingle.mockResolvedValue(
      token({ expires_at: new Date(Date.now() - 1000).toISOString() }),
    );
    expect(await verifyAgentToken(`Bearer ${VALID}`)).toBeNull();
  });

  it("accepts a token whose expiry is still in the future", async () => {
    maybeSingle.mockResolvedValue(
      token({ expires_at: new Date(Date.now() + 60_000).toISOString() }),
    );
    const record = await verifyAgentToken(`Bearer ${VALID}`);
    expect(record?.agent_name).toBe("agent");
  });

  it("looks the token up by hash, never by its plaintext", async () => {
    maybeSingle.mockResolvedValue(token());
    await verifyAgentToken(`Bearer ${VALID}`);

    const lastCall = eq.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    const [column, value] = lastCall as unknown as [string, string];
    expect(column).toBe("token_hash");
    expect(value).not.toContain(VALID);
    expect(value).toMatch(/^[0-9a-f]{64}$/);
  });

  it("carries created_by through, so anything the token creates keeps an owner", async () => {
    maybeSingle.mockResolvedValue(token());
    const record = await verifyAgentToken(`Bearer ${VALID}`);
    expect(record?.created_by).toBe("owner-1");
  });
});
