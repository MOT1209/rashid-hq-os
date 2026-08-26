import { timingSafeEqual } from "node:crypto";
import { getServiceSupabase } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { isOwnerEmail, ownerEmails } from "@/lib/owners";
import { logActivity } from "@/lib/activity";
import { sendHealthAlert } from "@/lib/email";
import { ALERT_AFTER, crossedFailureThreshold } from "@/lib/health-alert";
import { assertSafeEndpoint, pinnedDispatcher } from "@/lib/net/safe-endpoint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** One project's health check should never hold up the rest, or the cron. */
export const maxDuration = 60;

const AGENT_NAME = "Scheduled Health Check";
const TIMEOUT_MS = 10_000;
/** Total ping attempts per project, including the first. */
const ATTEMPTS = 2;
const RETRY_DELAY_MS = 2_000;

type Probe = { ok: boolean; attempts: number; detail: Record<string, unknown> };

/** One ping. Throws on a network-level failure; a non-2xx is a value, not a throw. */
async function probe(endpoint: string) {
  // Endpoints are validated on write, but a row could predate that check or be
  // edited out of band — re-validate before every call.
  const safeUrl = await assertSafeEndpoint(endpoint);
  return fetch(safeUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    // A followed redirect would walk straight past assertSafeEndpoint.
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    dispatcher: pinnedDispatcher(safeUrl),
  } as RequestInit & { dispatcher?: unknown });
}

/**
 * Pings, and on failure tries once more after a short pause. A single dropped
 * connection or cold start used to be recorded as an outage, which both
 * overstated the failure rate and pushed projects toward the alert threshold
 * for reasons that had nothing to do with them being down.
 *
 * Deliberately not a general backoff: this runs once a day, so a second
 * attempt is enough to tell a blip from something actually broken.
 */
async function probeWithRetry(endpoint: string): Promise<Probe> {
  let last: Probe = { ok: false, attempts: 0, detail: {} };

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const response = await probe(endpoint);
      last = {
        ok: response.ok,
        attempts: attempt,
        detail: { status: response.status },
      };
    } catch (err) {
      last = {
        ok: false,
        attempts: attempt,
        detail: { error: err instanceof Error ? err.message : "Health check failed." },
      };
    }

    if (last.ok) return last;
    if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  }

  return last;
}

/**
 * Reads the run this cron just recorded, so it must be called after
 * logActivity. The decision itself lives in src/lib/health-alert.ts.
 */
async function justCrossedFailureThreshold(projectId: string) {
  const { data, error } = await getServiceSupabase()
    .from("agent_logs")
    .select("status")
    .eq("project_id", projectId)
    .eq("agent_name", AGENT_NAME)
    .eq("tool_name", "health_check")
    .order("created_at", { ascending: false })
    .limit(ALERT_AFTER + 1);

  if (error || !data) return false;
  return crossedFailureThreshold(data.map((row) => row.status as string));
}

/**
 * Mails the owners once, on the run where the streak crosses the threshold.
 * Never throws: an alert that cannot be sent must not fail the whole cron, and
 * without RESEND_API_KEY sendHealthAlert simply logs and returns false.
 */
async function alertIfDown(projectId: string, name: string, endpoint: string) {
  try {
    if (!(await justCrossedFailureThreshold(projectId))) return false;
    return await sendHealthAlert(ownerEmails(), {
      name,
      endpoint,
      failures: ALERT_AFTER,
    });
  } catch (cause) {
    console.error("[agent] daily-check: alert failed:", cause);
    return false;
  }
}

/** Compares two strings in constant time to prevent timing attacks. */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * The first genuinely autonomous agent in this console — nothing about it
 * runs because a human typed a command. Once a day (vercel.json), it pings
 * the MCP endpoint of every active project and logs the result under a fixed
 * agent name, so a dead integration shows up in Live Activity on its own
 * instead of waiting to be noticed the next time someone happens to use it.
 *
 * Reuses the exact same request shape and SSRF guard as call_project_tool
 * (src/lib/mcp/tools.ts) — this is that same trust boundary, just initiated
 * by a clock instead of a caller.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const authorized =
    secret && authHeader ? safeCompare(authHeader, `Bearer ${secret}`) : false;

  // Same fallback as /api/maintenance/prune: the cron is the real trigger,
  // but the signed-in owner can run it by hand too — useful to confirm an
  // endpoint is actually broken without waiting for the next scheduled run.
  if (!authorized) {
    const session = await getSession();
    if (!session || !isOwnerEmail(session.user.email)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const { data: projects, error } = await getServiceSupabase()
    .from("projects")
    .select("id, name, mcp_endpoint")
    .eq("status", "active")
    .not("mcp_endpoint", "is", null);

  if (error) {
    console.error("[agent] daily-check: failed to list projects:", error.message);
    return Response.json({ error: "Failed to list projects." }, { status: 500 });
  }

  const results = await Promise.all(
    (projects ?? []).map(async (project) => {
      const endpoint = project.mcp_endpoint;
      if (!endpoint) return { project: project.name, ok: false, skipped: true };

      const outcome = await probeWithRetry(endpoint);
      await logActivity({
        projectId: project.id,
        agentName: AGENT_NAME,
        toolName: "health_check",
        payload: { endpoint },
        result: { ...outcome.detail, attempts: outcome.attempts },
        status: outcome.ok ? "success" : "failed",
      });

      const alerted = outcome.ok
        ? false
        : await alertIfDown(project.id, project.name, endpoint);
      return { project: project.name, ok: outcome.ok, alerted };
    }),
  );

  return Response.json({ checked: results.length, results });
}
