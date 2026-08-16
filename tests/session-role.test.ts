import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The authorization boundary itself. Hiding a button is presentation; this is
 * what actually stops a viewer from writing, so it is worth testing directly
 * rather than through the UI.
 */

let sessionUser: { email: string } | null = null;
let role: "admin" | "viewer" | null = null;

const redirect = vi.fn((to: string) => {
  // Next's redirect throws to unwind; mirror that so callers cannot continue.
  throw new Error(`REDIRECT:${to}`);
});

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => (sessionUser ? { user: sessionUser } : null) } },
}));
vi.mock("@/lib/members", () => ({ resolveRole: async () => role }));

const { requireSession, requireAdmin } = await import("@/lib/session");

beforeEach(() => {
  sessionUser = { email: "someone@example.com" };
  role = "admin";
  redirect.mockClear();
});

describe("requireSession", () => {
  it("sends an anonymous visitor to sign-in", async () => {
    sessionUser = null;
    await expect(requireSession()).rejects.toThrow("REDIRECT:/sign-in");
  });

  it("refuses a signed-in account that resolves to no role", async () => {
    role = null;
    await expect(requireSession()).rejects.toThrow("REDIRECT:/sign-in?denied=1");
  });

  it("returns the session with the role attached", async () => {
    role = "viewer";
    const session = await requireSession();
    expect(session.role).toBe("viewer");
    expect(session.user.email).toBe("someone@example.com");
  });
});

describe("requireAdmin", () => {
  it("lets an admin through", async () => {
    role = "admin";
    const session = await requireAdmin();
    expect(session.role).toBe("admin");
  });

  it("refuses a viewer — this is what every mutation is guarded by", async () => {
    role = "viewer";
    await expect(requireAdmin()).rejects.toThrow(/permission to make changes/i);
  });

  it("refuses before any session exists at all", async () => {
    sessionUser = null;
    await expect(requireAdmin()).rejects.toThrow("REDIRECT:/sign-in");
  });

  it("refuses an account with no role rather than defaulting to admin", async () => {
    role = null;
    await expect(requireAdmin()).rejects.toThrow("REDIRECT:/sign-in?denied=1");
  });
});
