import { authorizeCron } from "@/lib/cron-auth";
import { runDueAutomations } from "@/lib/automation/runtime";
import { tickSchedules } from "@/lib/automation/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Automation worker: (1) queue runs for schedules that are due, (2) claim and
 * process queued runs. Auth is the same as the other cron routes. Everything is
 * persisted, so a missed or duplicated tick is harmless. Resolution equals the
 * cadence of whatever calls this (see docs/AUTOMATION.md).
 */
export async function GET(request: Request) {
  if (!(await authorizeCron(request))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const schedules = await tickSchedules();
    const runs = await runDueAutomations(2);
    return Response.json({ schedules, runs });
  } catch (error) {
    console.error("[automation] worker failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Worker failed." }, { status: 500 });
  }
}
