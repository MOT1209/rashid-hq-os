import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * canRevokeToken decides who may pull a live agent token. The rule it encodes
 * is easy to get backwards: an issuer-only check reads like tightened security
 * but strands a leaked token the moment the admin who issued it moves on, since
 * `role` is "admin" for member-table admins and cannot stand in for the owner.
 */

vi.mock("@/lib/supabase/server", () => ({ getServiceSupabase: () => ({}) }));

const { canRevokeToken } = await import("@/lib/agent-tokens");

const OWNER = "boss@example.com";

function viewer(id: string, email?: string) {
  return { user: { id, email: email ?? null } };
}

afterEach(() => {
  delete process.env.OWNER_EMAILS;
});

describe("canRevokeToken", () => {
  it("lets the issuer revoke what they issued", () => {
    expect(canRevokeToken("admin-a", viewer("admin-a"))).toBe(true);
  });

  it("lets an OWNER_EMAILS owner revoke another admin's token", () => {
    process.env.OWNER_EMAILS = OWNER;
    expect(canRevokeToken("admin-a", viewer("owner-1", OWNER))).toBe(true);
  });

  it("matches the owner allowlist case- and space-insensitively", () => {
    process.env.OWNER_EMAILS = ` ${OWNER.toUpperCase()} `;
    expect(canRevokeToken("admin-a", viewer("owner-1", OWNER))).toBe(true);
  });

  it("refuses a second admin who neither issued it nor owns the console", () => {
    process.env.OWNER_EMAILS = OWNER;
    expect(canRevokeToken("admin-a", viewer("admin-b", "b@example.com"))).toBe(false);
  });

  it("allows revocation of rows that predate created_by being recorded", () => {
    expect(canRevokeToken(null, viewer("admin-b", "b@example.com"))).toBe(true);
  });

  it("fails closed when OWNER_EMAILS is unset", () => {
    expect(canRevokeToken("admin-a", viewer("admin-b", "b@example.com"))).toBe(false);
  });
});
