import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  REPLAY_WINDOW_MS,
  UnknownProjectToolError,
  runProjectTool,
  verifyProjectToolCall,
} from "@/lib/project-tools";

/**
 * The receiving side of call_project_tool. tests/outbound-signing.test.ts pins
 * down what HQ sends; these pin down what a project's endpoint accepts.
 */

const PROJECT = "11111111-1111-4111-8111-111111111111";

function body(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    tool: "echo",
    input: { hello: "world" },
    project_id: PROJECT,
    issued_at: new Date().toISOString(),
    ...overrides,
  });
}

function sign(raw: string, secret: string) {
  return `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
}

afterEach(() => {
  delete process.env.OUTBOUND_SIGNING_SECRET;
});

describe("verifyProjectToolCall — unsigned mode", () => {
  it("accepts a call that names the caller", () => {
    const verdict = verifyProjectToolCall(body(), { signature: null, source: "alking-hq" });
    expect(verdict.ok).toBe(true);
  });

  it("rejects a call from an unrecognised caller", () => {
    const verdict = verifyProjectToolCall(body(), { signature: null, source: null });
    expect(verdict).toMatchObject({ ok: false, status: 401 });
  });
});

describe("verifyProjectToolCall — signed mode", () => {
  beforeEach(() => {
    process.env.OUTBOUND_SIGNING_SECRET = "shared-secret";
  });

  it("accepts a body signed with the shared secret", () => {
    const raw = body();
    const verdict = verifyProjectToolCall(raw, {
      signature: sign(raw, "shared-secret"),
      source: "alking-hq",
    });
    expect(verdict.ok).toBe(true);
  });

  it("rejects a tampered body", () => {
    const raw = body();
    const signature = sign(raw, "shared-secret");
    const tampered = raw.replace("world", "tampered");
    const verdict = verifyProjectToolCall(tampered, { signature, source: "alking-hq" });
    expect(verdict).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects a missing signature even from a named caller", () => {
    const verdict = verifyProjectToolCall(body(), { signature: null, source: "alking-hq" });
    expect(verdict).toMatchObject({ ok: false, status: 401 });
  });
});

describe("verifyProjectToolCall — validation", () => {
  it("rejects non-JSON", () => {
    const verdict = verifyProjectToolCall("not json", { signature: null, source: "alking-hq" });
    expect(verdict).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects a body with no tool", () => {
    const verdict = verifyProjectToolCall(body({ tool: undefined }), {
      signature: null,
      source: "alking-hq",
    });
    expect(verdict).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects a stale timestamp — a replay", () => {
    const stale = new Date(Date.now() - REPLAY_WINDOW_MS - 1_000).toISOString();
    const verdict = verifyProjectToolCall(body({ issued_at: stale }), {
      signature: null,
      source: "alking-hq",
    });
    expect(verdict).toMatchObject({ ok: false, status: 400 });
  });

  it("defaults a missing input to an empty object", () => {
    const verdict = verifyProjectToolCall(body({ input: undefined }), {
      signature: null,
      source: "alking-hq",
    });
    expect(verdict.ok && verdict.call.input).toEqual({});
  });
});

describe("runProjectTool", () => {
  const call = {
    tool: "echo",
    input: { a: 1 },
    project_id: PROJECT,
    issued_at: new Date().toISOString(),
  };

  it("echoes the input back", () => {
    expect(runProjectTool({ ...call, tool: "echo" })).toEqual({ echo: { a: 1 } });
  });

  it("answers ping with the project id", () => {
    const result = runProjectTool({ ...call, tool: "ping" });
    expect(result).toMatchObject({ pong: true, project_id: PROJECT });
  });

  it("lists its tools on whoami", () => {
    expect(runProjectTool({ ...call, tool: "whoami" })).toMatchObject({
      tools: ["ping", "echo", "whoami"],
    });
  });

  it("throws UnknownProjectToolError for anything else", () => {
    expect(() => runProjectTool({ ...call, tool: "deploy" })).toThrow(UnknownProjectToolError);
  });
});
