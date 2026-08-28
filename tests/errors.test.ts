import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * captureError always returns a reference and logs; it also hands the error to
 * the Sentry SDK (a no-op there without a DSN). These pin the reference format
 * and what reaches Sentry.
 */

const captureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
  flush: async () => true,
}));

// `after` only runs inside a request scope; in tests, run the callback inline.
vi.mock("next/server", () => ({
  after: (fn: () => unknown) => {
    void fn();
  },
}));

const { captureError, dbError, safeMessage } = await import("@/lib/errors");

beforeEach(() => {
  captureException.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("captureError", () => {
  it("returns a uuid reference", () => {
    expect(captureError("ctx", new Error("boom"))).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("forwards the error to Sentry with the ref, context, and extra", () => {
    const ref = captureError("loading projects", new Error("boom"), { projectId: "p1" });
    expect(captureException).toHaveBeenCalledTimes(1);
    const [err, options] = captureException.mock.calls[0] as [Error, Record<string, unknown>];
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("boom");
    expect(options).toMatchObject({
      tags: { context: "loading projects" },
      extra: { ref, projectId: "p1" },
    });
  });

  it("wraps a non-Error value (a Postgres error object) so Sentry still gets a stack", () => {
    captureError("ctx", { message: "violates unique constraint", code: "23505" });
    const [err] = captureException.mock.calls[0] as [Error];
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("23505");
    expect(err.message).toContain("violates unique constraint");
  });
});

describe("dbError / safeMessage", () => {
  it("returns a generic message carrying only the reference", () => {
    const message = safeMessage("Updating the project", new Error("column x does not exist"));
    expect(message).toMatch(/^Updating the project failed\. Reference: [0-9a-f-]{36}$/);
    expect(message).not.toContain("column x");
  });

  it("dbError produces an Error with the same shape", () => {
    const err = dbError("ctx", new Error("secret detail"));
    expect(err.message).toMatch(/^ctx failed\. Reference: /);
  });
});
