import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * assertSafeEndpoint resolves the hostname, then fetch would resolve it again.
 * A name that answers differently between the two calls is the DNS-rebinding
 * hole. pinnedDispatcher closes it by connecting only to the address that was
 * actually vetted.
 */

vi.mock("node:dns/promises", () => ({
  lookup: async (host: string) => {
    const table: Record<string, { address: string; family: number }[]> = {
      "public.example": [{ address: "93.184.216.34", family: 4 }],
      "private.example": [{ address: "10.0.0.9", family: 4 }],
    };
    const hit = table[host];
    if (!hit) throw new Error(`ENOTFOUND ${host}`);
    return hit;
  },
}));

const { assertSafeEndpoint, pinnedDispatcher } = await import("@/lib/net/safe-endpoint");

beforeEach(() => {
  delete process.env.ALLOW_PRIVATE_MCP_ENDPOINTS;
});

afterEach(() => {
  delete process.env.ALLOW_PRIVATE_MCP_ENDPOINTS;
});

describe("pinnedDispatcher", () => {
  it("pins to the address the guard vetted, ignoring what DNS says later", async () => {
    const url = await assertSafeEndpoint("https://public.example/mcp");
    const dispatcher = pinnedDispatcher(url);
    expect(dispatcher).toBeDefined();

    // Reach into the dispatcher's connect options and run its lookup: it must
    // answer with the vetted address, not re-resolve the name.
    type Lookup = (
      hostname: string,
      options: unknown,
      callback: (error: unknown, address: string, family: number) => void,
    ) => void;

    const options = dispatcher as unknown as {
      [key: symbol]: { connect?: { lookup?: Lookup } };
    };
    const lookup = Object.getOwnPropertySymbols(options)
      .map((s) => options[s]?.connect?.lookup)
      .find(Boolean);

    expect(lookup, "dispatcher exposes a custom lookup").toBeTypeOf("function");

    const answered = await new Promise<string>((resolve) => {
      lookup!("anything-at-all", {}, (_e: unknown, address: string) => resolve(address));
    });
    expect(answered).toBe("93.184.216.34");

    await dispatcher?.close();
  });

  it("returns nothing for a host that was never vetted", () => {
    expect(pinnedDispatcher(new URL("https://never-checked.example/x"))).toBeUndefined();
  });

  it("returns nothing for an IP literal — there is nothing to re-resolve", async () => {
    expect(pinnedDispatcher(new URL("https://93.184.216.34/mcp"))).toBeUndefined();
  });

  it("does not pin when private endpoints are explicitly allowed", async () => {
    await assertSafeEndpoint("https://public.example/mcp");
    process.env.ALLOW_PRIVATE_MCP_ENDPOINTS = "1";
    expect(pinnedDispatcher(new URL("https://public.example/mcp"))).toBeUndefined();
  });

  it("never vets a host that resolves privately, so it can never be pinned", async () => {
    await expect(assertSafeEndpoint("https://private.example/mcp")).rejects.toThrow(
      /private/i,
    );
    expect(pinnedDispatcher(new URL("https://private.example/mcp"))).toBeUndefined();
  });
});
