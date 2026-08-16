import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Roles decide who may write. OWNER_EMAILS must keep winning so a fresh install
 * works with no seeding and cannot lock itself out by deleting a member row.
 */

let row: { role: string } | null = null;

const maybeSingle = vi.fn(async () => ({ data: row, error: null }));
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq, order: async () => ({ data: [], error: null }) }));
const from = vi.fn(() => ({ select }));

vi.mock("@/lib/supabase/server", () => ({ getServiceSupabase: () => ({ from }) }));

beforeEach(() => {
  row = null;
  from.mockClear();
  eq.mockClear();
  vi.resetModules();
});

afterEach(() => {
  delete process.env.OWNER_EMAILS;
});

async function load() {
  return import("@/lib/members");
}

describe("resolveRole", () => {
  it("treats an OWNER_EMAILS address as admin without touching the database", async () => {
    process.env.OWNER_EMAILS = "owner@example.com";
    const { resolveRole } = await load();

    expect(await resolveRole("owner@example.com")).toBe("admin");
    expect(from).not.toHaveBeenCalled();
  });

  it("matches OWNER_EMAILS case-insensitively", async () => {
    process.env.OWNER_EMAILS = "Owner@Example.com";
    const { resolveRole } = await load();
    expect(await resolveRole("OWNER@example.COM")).toBe("admin");
  });

  it("falls back to the members table for anyone else", async () => {
    process.env.OWNER_EMAILS = "owner@example.com";
    row = { role: "viewer" };
    const { resolveRole } = await load();

    expect(await resolveRole("colleague@example.com")).toBe("viewer");
    expect(eq).toHaveBeenCalledWith("email", "colleague@example.com");
  });

  it("reads an admin row as admin", async () => {
    row = { role: "admin" };
    const { resolveRole } = await load();
    expect(await resolveRole("colleague@example.com")).toBe("admin");
  });

  it("denies an address that is neither on the allowlist nor a member", async () => {
    process.env.OWNER_EMAILS = "owner@example.com";
    row = null;
    const { resolveRole } = await load();
    expect(await resolveRole("stranger@example.com")).toBeNull();
  });

  it("denies a missing address without querying", async () => {
    const { resolveRole } = await load();
    expect(await resolveRole(null)).toBeNull();
    expect(await resolveRole(undefined)).toBeNull();
    expect(await resolveRole("")).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it("still fails closed when OWNER_EMAILS is unset and there is no row", async () => {
    row = null;
    const { resolveRole } = await load();
    expect(await resolveRole("anyone@example.com")).toBeNull();
  });

  it("lowercases and trims before looking up", async () => {
    row = { role: "viewer" };
    const { resolveRole } = await load();
    await resolveRole("  Mixed@Case.com  ");
    expect(eq).toHaveBeenCalledWith("email", "mixed@case.com");
  });
});
