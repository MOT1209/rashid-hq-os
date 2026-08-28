import { afterEach, describe, expect, it } from "vitest";
import { isOwnerEmail, ownerEmails } from "@/lib/owners";

/** The allowlist is what keeps sign-up closed, so "fails closed" must hold. */
describe("isOwnerEmail", () => {
  afterEach(() => {
    delete process.env.OWNER_EMAILS;
  });

  it("denies everyone when OWNER_EMAILS is unset", () => {
    expect(isOwnerEmail("owner@example.com")).toBe(false);
  });

  it("denies everyone when OWNER_EMAILS is empty or whitespace", () => {
    process.env.OWNER_EMAILS = "   ";
    expect(ownerEmails()).toEqual([]);
    expect(isOwnerEmail("owner@example.com")).toBe(false);
  });

  it("matches case-insensitively and ignores surrounding spaces", () => {
    process.env.OWNER_EMAILS = " Owner@Example.com , second@example.com ";
    expect(isOwnerEmail("owner@example.com")).toBe(true);
    expect(isOwnerEmail("  OWNER@EXAMPLE.COM ")).toBe(true);
    expect(isOwnerEmail("second@example.com")).toBe(true);
  });

  it("tolerates a value pasted from an .env line, quotes and all", () => {
    process.env.OWNER_EMAILS = '"owner@example.com"';
    expect(ownerEmails()).toEqual(["owner@example.com"]);
    expect(isOwnerEmail("owner@example.com")).toBe(true);

    process.env.OWNER_EMAILS = "'a@example.com','b@example.com'";
    expect(isOwnerEmail("b@example.com")).toBe(true);
  });

  it("denies addresses outside the list", () => {
    process.env.OWNER_EMAILS = "owner@example.com";
    expect(isOwnerEmail("attacker@evil.test")).toBe(false);
    expect(isOwnerEmail("")).toBe(false);
    expect(isOwnerEmail(null)).toBe(false);
    expect(isOwnerEmail(undefined)).toBe(false);
  });
});
