import { timingSafeEqual } from "node:crypto";
import { getServiceSupabase } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { isOwnerEmail } from "@/lib/owners";
import { resolveOwnerId } from "@/lib/owner";
import { logActivity } from "@/lib/activity";
import { runDepartmentAgent } from "@/lib/department-agent";
import { fetchDepartments } from "@/lib/queries";
import { ranOnDay, scheduledDepartments, STANDING_TASK_TOOL } from "@/lib/standing-tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Each department is a full agent run; give the batch room but bound it. */
export const maxDuration = 300;

/** Compares two strings in constant time. */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Runs each department's standing task once a day (vercel.json). This is the
 * second autonomous agent in the console after the health check — but where
 * that one only reads, this one runs the department agent with every write
 * tool, so its cost and blast radius are bounded on three sides: the
 * per-department enabled flag, the one-run-per-day guard below, and MAX_STEPS
 * inside runDepartmentAgent.
 *
 * Auth mirrors /api/agent/daily-check: the Vercel cron secret, or a signed-in
 * owner running it by hand to check a brief without waiting for 07:00 UTC.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const authorized =
    secret && authHeader ? safeCompare(authHeader, `Bearer ${secret}`) : false;

  if (!authorized) {
    const session = await getSession();
    if (!session || !isOwnerEmail(session.user.email)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const departments = scheduledDepartments(await fetchDepartments());
  if (departments.length === 0) {
    return Response.json({ ran: 0, results: [] });
  }

  const ownerId = await resolveOwnerId();

  // One small slice of recent runs answers "did this department already run
  // today" for every department at once.
  const since = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recent } = await getServiceSupabase()
    .from("agent_logs")
    .select("agent_name, tool_name, created_at")
    .eq("tool_name", STANDING_TASK_TOOL)
    .gte("created_at", since);

  const now = new Date();
  const results: Array<Record<string, unknown>> = [];

  for (const department of departments) {
    if (ranOnDay(recent ?? [], department.agent_name, now)) {
      results.push({ department: department.key, skipped: "already ran today" });
      continue;
    }

    const task = (department.standing_task ?? "").trim();
    try {
      const run = await runDepartmentAgent({ department, task, ownerId });
      await logActivity({
        agentName: department.agent_name,
        toolName: STANDING_TASK_TOOL,
        payload: { task },
        result: { summary: run.summary, steps: run.steps },
        status: "success",
      });
      results.push({ department: department.key, ok: true, steps: run.steps });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The standing task failed.";
      await logActivity({
        agentName: department.agent_name,
        toolName: STANDING_TASK_TOOL,
        payload: { task },
        result: { error: message },
        status: "failed",
      });
      results.push({ department: department.key, ok: false, error: message });
    }
  }

  return Response.json({ ran: results.length, results });
}
