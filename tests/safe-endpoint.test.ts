import { beforeEach, describe, expect, it } from "vitest";
import { assertSafeEndpoint, isSafeEndpoint } from "@/lib/net/safe-endpoint";

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
    // localtest.me is a real public DNS name pointing at 127.0.0.1 — the case
    // a hostname-only blocklist would wave through.
    await expect(assertSafeEndpoint("https://localtest.me/mcp")).rejects.toThrow(
      /private/i,
    );
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
