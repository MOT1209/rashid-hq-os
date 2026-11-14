import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /connect enforced REQUIRE_2FA but /callback did not, so the policy could be
 * sidestepped at the second leg of the flow. Both now share
 * checkIntegrationOwner; this pins the callback behaviour.
 */

let user: { id: string; email: string; twoFactorEnabled?: boolean } | null = null;
let role: "admin" | "viewer" | null = "admin";
const consume = vi.fn();

vi.mock("@/lib/session", () => ({ getSession: async () => (user ? { user } : null) }));
vi.mock("@/lib/members", () => ({ resolveRole: async () => role }));
vi.mock("@/lib/integrations/oauth", () => ({
  callbackUrl: () => "https://hq.example/cb",
  consoleOrigin: () => "https://hq.example",
  consumeOAuthState: (...a: unknown[]) => consume(...a),
}));
vi.mock("@/lib/integrations/connections", () => ({ mergeTokens: vi.fn(), saveConnection: vi.fn() }));
vi.mock("@/lib/integrations/logger", () => ({ logIntegration: vi.fn() }));
vi.mock("@/lib/integrations/registry", () => ({
  getProvider: () => ({ exchangeCode: vi.fn(), testConnection: vi.fn() }),
}));

const { GET } = await import("@/app/api/integrations/[provider]/callback/route");

const call = () =>
  GET(new Request("https://hq.example/api/integrations/youtube/callback?code=c&state=s"), {
    params: Promise.resolve({ provider: "youtube" }),
  });

beforeEach(() => {
  user = { id: "u1", email: "o@example.com", twoFactorEnabled: false };
  role = "admin";
  consume.mockReset();
  consume.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());

describe("integration callback security", () => {
  it("rejects an admin without 2FA when REQUIRE_2FA is set, before touching state", async () => {
    vi.stubEnv("REQUIRE_2FA", "1");
    const res = await call();
    expect(res.headers.get("location")).toContain("error=two_factor_required");
    expect(consume).not.toHaveBeenCalled();
  });

  it("rejects anonymous and non-admin sessions", async () => {
    user = null;
    expect((await call()).headers.get("location")).toContain("error=not_signed_in");
    user = { id: "u2", email: "v@example.com" };
    role = "viewer";
    expect((await call()).headers.get("location")).toContain("error=not_signed_in");
    expect(consume).not.toHaveBeenCalled();
  });

  it("proceeds to state validation for an admin with 2FA", async () => {
    vi.stubEnv("REQUIRE_2FA", "1");
    user = { id: "u1", email: "o@example.com", twoFactorEnabled: true };
    const res = await call();
    expect(consume).toHaveBeenCalledWith("s", "u1", "youtube");
    expect(res.headers.get("location")).toContain("error=bad_state");
  });
});
