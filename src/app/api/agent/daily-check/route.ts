import { timingSafeEqual } from "node:crypto";
import { getServiceSupabase } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { isOwnerEmail } from "@/lib/owners";
import { logActivity } from "@/lib/activity";
import { assertSafeEndpoint, pinnedDispatcher } from "@/lib/net/safe-endpoint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** One project's health check should never hold up the rest, or the cron. */
export const maxDuration = 60;

const AGENT_NAME = "Scheduled Health Check";
const TIMEOUT_MS = 10_000;

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

      try {
        // Endpoints are validated on write, but a row could predate that
        // check or be edited out of band — re-validate before every call.
        const safeUrl = await assertSafeEndpoint(endpoint);
        const response = await fetch(safeUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
          // A followed redirect would walk straight past assertSafeEndpoint.
          redirect: "manual",
          signal: AbortSignal.timeout(TIMEOUT_MS),
          dispatcher: pinnedDispatcher(safeUrl),
        } as RequestInit & { dispatcher?: unknown });

        const ok = response.ok;
        await logActivity({
          projectId: project.id,
          agentName: AGENT_NAME,
          toolName: "health_check",
          payload: { endpoint },
          result: { status: response.status },
          status: ok ? "success" : "failed",
        });
        return { project: project.name, ok };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Health check failed.";
        await logActivity({
          projectId: project.id,
          agentName: AGENT_NAME,
          toolName: "health_check",
          payload: { endpoint },
          result: { error: message },
          status: "failed",
        });
        return { project: project.name, ok: false };
      }
    }),
  );

  return Response.json({ checked: results.length, results });
}
