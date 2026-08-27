import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * captureError always returns a reference and logs; with SENTRY_DSN set it also
 * ships a Sentry envelope. These pin the envelope shape — the legacy /store/
 * endpoint it used before is gone for recent Sentry projects.
 */

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const { captureError } = await import("@/lib/errors");

const DSN = "https://abc123@o42.ingest.sentry.io/4508";

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200 });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.SENTRY_DSN;
  vi.restoreAllMocks();
});

describe("captureError", () => {
  it("returns a reference and does not call fetch without a DSN", () => {
    const ref = captureError("ctx", new Error("boom"));
    expect(ref).toMatch(/^[0-9a-f-]{36}$/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts a three-line envelope to the /envelope/ endpoint", async () => {
    process.env.SENTRY_DSN = DSN;
    const ref = captureError("ctx", new Error("boom"), { projectId: "p1" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://o42.ingest.sentry.io/api/4508/envelope/");

    const lines = String(init.body).split("\n");
    expect(lines).toHaveLength(3);
    const header = JSON.parse(lines[0]);
    const itemHeader = JSON.parse(lines[1]);
    const event = JSON.parse(lines[2]);

    expect(header.event_id).toBe(ref.replace(/-/g, ""));
    expect(itemHeader).toEqual({ type: "event" });
    expect(event.exception.values[0].value).toBe("boom");
    expect(event.extra).toMatchObject({ ref, context: "ctx", projectId: "p1" });
  });

  it("includes parsed, in-app-flagged stack frames", async () => {
    process.env.SENTRY_DSN = DSN;
    const err = new Error("with stack");
    err.stack = [
      "Error: with stack",
      "    at inner (/app/src/lib/thing.ts:10:5)",
      "    at /app/node_modules/pkg/index.js:1:1",
    ].join("\n");

    captureError("ctx", err);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const event = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body).split("\n")[2]);
    const frames = event.exception.values[0].stacktrace.frames;
    // Reversed: innermost (thing.ts) last.
    expect(frames.at(-1)).toMatchObject({ function: "inner", filename: "/app/src/lib/thing.ts", in_app: true });
    expect(frames[0]).toMatchObject({ filename: "/app/node_modules/pkg/index.js", in_app: false });
  });

  it("swallows a malformed DSN without throwing", () => {
    process.env.SENTRY_DSN = "not-a-dsn";
    expect(() => captureError("ctx", new Error("boom"))).not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
