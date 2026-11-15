import { getServiceSupabase } from "@/lib/supabase/server";
import { authorizeCron } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  if (!(await authorizeCron(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { data, error } = await getServiceSupabase().rpc("prune_agent_logs", {
      older_than: process.env.LOG_RETENTION ?? "90 days",
    });
    if (error) throw new Error(error.message);

    // Social Studio / Automation retention (migration 0034). Best effort: a missing function (migration
    // not applied yet) or a failure here must never fail the activity-log prune above.
    const extra: Record<string, number | null> = {};
    for (const [key, fn, env, fallback] of [
      ["automationRuns", "prune_automation_runs", "AUTOMATION_RETENTION", "90 days"],
      ["socialData", "prune_social_data", "SOCIAL_RETENTION", "180 days"],
    ] as const) {
      const res = await getServiceSupabase().rpc(fn as never, { older_than: process.env[env] ?? fallback } as never);
      extra[key] = res.error ? null : ((res.data as unknown as number) ?? 0);
    }
    return Response.json({ removed: data ?? 0, ...extra });
  } catch (error) {
    console.error("[maintenance] prune failed:", error);
    return Response.json({ error: "Prune failed." }, { status: 500 });
  }
}
