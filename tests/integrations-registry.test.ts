import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { allProviders, getProvider } from "@/lib/integrations/registry";

describe("integration registry", () => {
  const providers = allProviders();

  it("has unique ids", () => {
    const ids = providers.map((p) => p.meta.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every provider exposes testConnection", () => {
    for (const p of providers) {
      expect(typeof p.testConnection).toBe("function");
    }
  });

  it("available OAuth providers can build an auth URL and exchange a code", () => {
    const oauth = providers.filter(
      (p) => p.meta.readiness === "available" && p.meta.authMethod === "oauth2",
    );
    expect(oauth.length).toBeGreaterThan(0);
    for (const p of oauth) {
      expect(typeof p.buildAuthUrl).toBe("function");
      expect(typeof p.exchangeCode).toBe("function");
    }
  });

  it("planned providers refuse testConnection", async () => {
    const planned = providers.filter((p) => p.meta.readiness === "planned");
    expect(planned.length).toBeGreaterThan(0);
    for (const p of planned) {
      await expect(p.testConnection({})).rejects.toThrow();
    }
  });

  it("google-family providers request least-privilege read scopes", () => {
    const yt = getProvider("youtube")!;
    expect(yt.meta.scopes.every((s) => s.includes("readonly"))).toBe(true);
  });

  it("builds a Google authorize URL with PKCE and state", () => {
    process.env.GOOGLE_CLIENT_ID = "cid";
    process.env.GOOGLE_CLIENT_SECRET = "csecret";
    const google = getProvider("google")!;
    const { url, codeVerifier } = google.buildAuthUrl!({
      redirectUri: "https://hq.example.com/api/integrations/google/callback",
      state: "xyz",
      scopes: [],
    });
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://accounts.google.com");
    expect(parsed.searchParams.get("state")).toBe("xyz");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("code_challenge")).toBeTruthy();
    expect(codeVerifier).toBeTruthy();
  });

  it("github verifies a webhook signature", () => {
    process.env.GITHUB_WEBHOOK_SECRET = "shh";
    const gh = getProvider("github")!;
    const body = JSON.stringify({ hello: "world" });
    const sig = "sha256=" + createHmac("sha256", "shh").update(body).digest("hex");
    const good = gh.verifyWebhook!({
      rawBody: body,
      headers: new Headers({ "x-hub-signature-256": sig, "x-github-delivery": "d1" }),
    });
    expect(good.valid).toBe(true);
    expect(good.eventId).toBe("d1");

    const bad = gh.verifyWebhook!({
      rawBody: body,
      headers: new Headers({ "x-hub-signature-256": "sha256=deadbeef" }),
    });
    expect(bad.valid).toBe(false);
  });
});
