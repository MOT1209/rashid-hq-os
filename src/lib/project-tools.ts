import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The receiving side of call_project_tool (src/lib/mcp/tools.ts).
 *
 * A project's own MCP endpoint gets a signed POST from HQ and has to answer it.
 * This module is that receiver, factored out of the route so the signature
 * check, the replay window and the dispatch are unit-testable.
 *
 * It ships in this repo as the reference a real project copies: the wire
 * format, the HMAC verification and the timestamp window all live here, and
 * /api/project-tools registers it as a working endpoint so call_project_tool
 * has a real target today rather than only once every project exposes one.
 */

/** A call whose timestamp is further than this from now — past or future — is rejected. */
export const REPLAY_WINDOW_MS = 5 * 60 * 1000;

export type ProjectToolCall = {
  tool: string;
  input: Record<string, unknown>;
  project_id: string;
  issued_at: string;
};

export type Verdict =
  | { ok: true; call: ProjectToolCall }
  | { ok: false; status: number; error: string };

/**
 * Authenticates and validates one inbound call. With OUTBOUND_SIGNING_SECRET
 * set the body must carry a matching HMAC; without it, the caller must at least
 * name itself — the same opt-in posture as the sending side.
 */
export function verifyProjectToolCall(
  rawBody: string,
  headers: { signature: string | null; source: string | null },
  now: number = Date.now(),
): Verdict {
  const secret = process.env.OUTBOUND_SIGNING_SECRET;

  if (secret) {
    const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
    if (!constantTimeEqual(headers.signature ?? "", expected)) {
      return { ok: false, status: 401, error: "Bad or missing signature." };
    }
  } else if (headers.source !== "alking-hq") {
    return { ok: false, status: 401, error: "Unrecognised caller." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 400, error: "Body is not JSON." };
  }

  const call = (parsed ?? {}) as Partial<ProjectToolCall>;
  if (typeof call.tool !== "string" || typeof call.project_id !== "string") {
    return { ok: false, status: 400, error: "Missing tool or project_id." };
  }

  const issuedAt = Date.parse(String(call.issued_at));
  if (Number.isNaN(issuedAt)) {
    return { ok: false, status: 400, error: "Missing or invalid issued_at." };
  }
  if (Math.abs(now - issuedAt) > REPLAY_WINDOW_MS) {
    return { ok: false, status: 400, error: "Call is outside the replay window." };
  }

  return {
    ok: true,
    call: {
      tool: call.tool,
      input: (call.input ?? {}) as Record<string, unknown>,
      project_id: call.project_id,
      issued_at: String(call.issued_at),
    },
  };
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** The tools this reference endpoint answers. */
export const PROJECT_TOOLS = ["ping", "echo", "whoami"] as const;

export class UnknownProjectToolError extends Error {
  constructor(tool: string) {
    super(`Unknown tool "${tool}".`);
    this.name = "UnknownProjectToolError";
  }
}

/**
 * Runs one verified call. These three tools are deliberately side-effect-free —
 * this endpoint lives in HQ's own codebase and has no business acting on a
 * separate project — but they exercise the full round trip: auth, transport,
 * dispatch, the shape of the response, and the activity log on the HQ side.
 */
export function runProjectTool(call: ProjectToolCall): Record<string, unknown> {
  switch (call.tool) {
    case "ping":
      return {
        pong: true,
        project_id: call.project_id,
        received_at: new Date().toISOString(),
      };
    case "echo":
      return { echo: call.input };
    case "whoami":
      return {
        service: "alking-hq reference project-tools endpoint",
        project_id: call.project_id,
        tools: [...PROJECT_TOOLS],
      };
    default:
      throw new UnknownProjectToolError(call.tool);
  }
}
