import { describe, expect, it } from "vitest";
import { isUuid } from "@/lib/queries";

/**
 * Filters arrive straight from the URL and land on a uuid column, so anything
 * that is not a uuid has to be rejected before it reaches Postgres — otherwise
 * `?projectId=abc` raises 22P02 and takes the page down.
 */
describe("isUuid", () => {
  it("accepts a real uuid in either case", () => {
    expect(isUuid("65b58414-2bb1-498a-ac65-7d66805242ef")).toBe(true);
    expect(isUuid("65B58414-2BB1-498A-AC65-7D66805242EF")).toBe(true);
  });

  it("rejects anything else", () => {
    for (const value of [
      "abc",
      "",
      "65b58414-2bb1-498a-ac65",
      "65b58414-2bb1-498a-ac65-7d66805242ef-extra",
      "'; drop table projects; --",
      undefined,
      null,
    ]) {
      expect(isUuid(value as string | undefined), String(value)).toBe(false);
    }
  });
});
