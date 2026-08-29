import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.INTEGRATIONS_SECRET = "test-secret-at-least-sixteen-chars-long";
});

async function mod() {
  return import("@/lib/integrations/encryption");
}

describe("integration secret encryption", () => {
  it("round-trips a token bundle", async () => {
    const { seal, open } = await mod();
    const value = { access_token: "ya29.abc", refresh_token: "1//xyz" };
    const sealed = seal(value);
    expect(sealed.startsWith("v1:")).toBe(true);
    expect(sealed).not.toContain("ya29.abc");
    expect(open(sealed)).toEqual(value);
  });

  it("rejects a tampered ciphertext", async () => {
    const { seal, open } = await mod();
    const sealed = seal({ api_key: "sk-live" });
    const parts = sealed.split(":");
    // Flip a character in the ciphertext segment.
    parts[3] = parts[3].slice(0, -1) + (parts[3].at(-1) === "A" ? "B" : "A");
    expect(() => open(parts.join(":"))).toThrow();
  });

  it("fails when the secret is wrong", async () => {
    const { seal } = await mod();
    const sealed = seal({ api_key: "sk-live" });
    process.env.INTEGRATIONS_SECRET = "a-completely-different-secret-value";
    const { open } = await import("@/lib/integrations/encryption");
    expect(() => open(sealed)).toThrow();
    process.env.INTEGRATIONS_SECRET = "test-secret-at-least-sixteen-chars-long";
  });

  it("throws without a configured secret", async () => {
    const saved = process.env.INTEGRATIONS_SECRET;
    delete process.env.INTEGRATIONS_SECRET;
    const { seal, encryptionConfigured } = await import("@/lib/integrations/encryption");
    expect(encryptionConfigured()).toBe(false);
    expect(() => seal({ a: 1 })).toThrow(/INTEGRATIONS_SECRET/);
    process.env.INTEGRATIONS_SECRET = saved;
  });

  it("fingerprints are stable and short", async () => {
    const { fingerprint } = await mod();
    expect(fingerprint("sk-abc")).toEqual(fingerprint("sk-abc"));
    expect(fingerprint("sk-abc")).toHaveLength(8);
    expect(fingerprint("sk-abc")).not.toEqual(fingerprint("sk-def"));
  });
});
