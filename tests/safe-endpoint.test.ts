import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertSafeEndpoint, isSafeEndpoint } from "@/lib/net/safe-endpoint";

// The guard resolves DNS, so the cases below stub the resolver rather than
// reaching the network — otherwise CI turns red when a runner's DNS hiccups,
// which says nothing about this code.
vi.mock("node:dns/promises", () => ({
  lookup: async (host: string) => {
    const table: Record<string, { address: string; family: number }[]> = {
      // A real public name that points at 127.0.0.1 — the case a hostname-only
      // blocklist waves through.
      "localtest.me": [{ address: "127.0.0.1", family: 4 }],
      "example.com": [{ address: "93.184.216.34", family: 4 }],
      "mixed.example": [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.7", family: 4 },
      ],
      "v6.example": [{ address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 }],
    };
    const hit = table[host];
    if (!hit) throw new Error(`ENOTFOUND ${host}`);
    return hit;
  },
}));

/**
 * This guard is the only thing standing between an agent token and a full-read
 * SSRF through call_project_tool, so its rejections are worth pinning down.
 */
describe("assertSafeEndpoint", () => {
  beforeEach(() => {
    delete process.env.ALLOW_PRIVATE_MCP_ENDPOINTS;
  });

  it("rejects plain http", async () => {
    await expect(assertSafeEndpoint("http://example.com/mcp")).rejects.toThrow(
      /https/i,
    );
  });

  it("rejects non-http schemes", async () => {
    await expect(assertSafeEndpoint("file:///etc/passwd")).rejects.toThrow();
    await expect(assertSafeEndpoint("gopher://example.com")).rejects.toThrow();
  });

  it("rejects strings that are not URLs", async () => {
    await expect(assertSafeEndpoint("not a url")).rejects.toThrow(/absolute URL/i);
  });

  it("rejects cloud metadata and loopback literals", async () => {
    for (const url of [
      "https://169.254.169.254/latest/meta-data/",
      "https://127.0.0.1/mcp",
      "https://[::1]/mcp",
      "https://10.0.0.5/mcp",
      "https://172.16.0.1/mcp",
      "https://192.168.1.1/mcp",
      "https://100.64.0.1/mcp",
    ]) {
      await expect(assertSafeEndpoint(url), url).rejects.toThrow(/private/i);
    }
  });

  it("rejects localhost and internal suffixes by name", async () => {
    for (const url of [
      "https://localhost/mcp",
      "https://db.internal/mcp",
      "https://thing.local/mcp",
    ]) {
      await expect(assertSafeEndpoint(url), url).rejects.toThrow(/private/i);
    }
  });

  it("rejects a public hostname that resolves to a private address", async () => {
    await expect(assertSafeEndpoint("https://localtest.me/mcp")).rejects.toThrow(
      /private/i,
    );
  });

  it("rejects when any resolved address is private, not just the first", async () => {
    await expect(assertSafeEndpoint("https://mixed.example/mcp")).rejects.toThrow(
      /private/i,
    );
  });

  it("accepts a public IPv6 result", async () => {
    const url = await assertSafeEndpoint("https://v6.example/mcp");
    expect(url.hostname).toBe("v6.example");
  });

  it("rejects a hostname that does not resolve", async () => {
    await expect(
      assertSafeEndpoint("https://this-host-should-not-exist.invalid/mcp"),
    ).rejects.toThrow(/resolve/i);
  });

  it("accepts a public https endpoint", async () => {
    const url = await assertSafeEndpoint("https://example.com/mcp");
    expect(url.hostname).toBe("example.com");
  });

  it("allows private targets only when explicitly opted in", async () => {
    expect(await isSafeEndpoint("http://localhost:3000/mcp")).toBe(false);
    process.env.ALLOW_PRIVATE_MCP_ENDPOINTS = "1";
    expect(await isSafeEndpoint("http://localhost:3000/mcp")).toBe(true);
  });
});
