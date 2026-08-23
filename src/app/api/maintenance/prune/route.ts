import { timingSafeEqual } from "node:crypto";
import { getServiceSupabase } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { isOwnerEmail } from "@/lib/owners";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Compares two strings in constant time to prevent timing attacks. */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Deletes activity older than the retention window.
 *
 * Two ways in: a Vercel Cron request (verified by CRON_SECRET, which Vercel
 * sends as a bearer token), or the signed-in owner running it by hand. Without
 * this, agent_logs grows forever — every tool call is a row with two unbounded
 * jsonb columns.
 *
 * Schedule it in vercel.json:
 *   { "crons": [{ "path": "/api/maintenance/prune", "schedule": "0 4 * * *" }] }
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const authorized = secret && authHeader
    ? safeCompare(authHeader, `Bearer ${secret}`)
    : false;

  if (!authorized) {
    const session = await getSession();
    if (!session || !isOwnerEmail(session.user.email)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const { data, error } = await getServiceSupabase().rpc("prune_agent_logs", {
      older_than: process.env.LOG_RETENTION ?? "90 days",
    });
    if (error) throw new Error(error.message);
    return Response.json({ removed: data ?? 0 });
  } catch (error) {
    console.error("[maintenance] prune failed:", error);
    return Response.json({ error: "Prune failed." }, { status: 500 });
  }
}
