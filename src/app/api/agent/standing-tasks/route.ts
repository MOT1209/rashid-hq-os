import { getServiceSupabase } from "@/lib/supabase/server";
import { authorizeCron } from "@/lib/cron-auth";
import { ownerEmails } from "@/lib/owners";
import { resolveOwnerId } from "@/lib/owner";
import { logActivity } from "@/lib/activity";
import { runDepartmentAgent } from "@/lib/department-agent";
import { sendStandingTaskDigest } from "@/lib/email";
import { fetchDepartments } from "@/lib/queries";
import { ranOnDay, scheduledDepartments, STANDING_TASK_TOOL } from "@/lib/standing-tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Each department is a full agent run; give the batch room but bound it. */
export const maxDuration = 300;

/**
 * Runs each department's standing task once a day (vercel.json). The second
 * autonomous agent in the console after the health check — and it runs the
 * department agent, so its cost and blast radius are bounded four ways: the
 * per-department enabled flag, the one-run-per-day guard below, MAX_STEPS
 * inside runDepartmentAgent, and the read-only tool allowlist that "autonomous"
 * mode imposes.
 *
 * Auth mirrors /api/agent/daily-check via authorizeCron: the Vercel cron
 * secret, or a same-origin request from the signed-in owner running it by hand.
 */
export async function GET(request: Request) {
  if (!(await authorizeCron(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
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
  /** What the digest mail reports — skipped departments are not in it. */
  const digest: { department: string; ok: boolean; summary: string }[] = [];

  for (const department of departments) {
    if (ranOnDay(recent ?? [], department.agent_name, now)) {
      results.push({ department: department.key, skipped: "already ran today" });
      continue;
    }

    const task = (department.standing_task ?? "").trim();
    try {
      // Autonomous: no human is watching, and the agent's context includes
      // third-party MCP output and raw project fields — so it runs on a
      // read + call_project_tool allowlist, never the registry-mutation tools.
      const run = await runDepartmentAgent({ department, task, ownerId, mode: "autonomous" });
      await logActivity({
        agentName: department.agent_name,
        toolName: STANDING_TASK_TOOL,
        payload: { task },
        result: { summary: run.summary, steps: run.steps },
        status: "success",
      });
      results.push({ department: department.key, ok: true, steps: run.steps });
      digest.push({ department: department.agent_name, ok: true, summary: run.summary });
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
      digest.push({ department: department.agent_name, ok: false, summary: message });
    }
  }

  // One mail for the whole batch. Like every other alert here it needs
  // RESEND_API_KEY; without it sendStandingTaskDigest logs and returns false,
  // and a mail failure must not fail the cron that already did its work.
  try {
    await sendStandingTaskDigest(ownerEmails(), digest);
  } catch (error) {
    console.error("[standing-tasks] digest mail threw:", error);
  }

  return Response.json({ ran: results.length, results });
}
