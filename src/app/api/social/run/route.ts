import { authorizeCron } from "@/lib/cron-auth";
import { runDueJobs } from "@/lib/social/engine";
import { collectDue } from "@/lib/social/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Publishing worker. Claims due jobs from the persistent queue
 * (claim_social_jobs, SKIP LOCKED) so scheduling survives restarts and is safe
 * under concurrent invocations. Same auth as the other cron routes:
 * CRON_SECRET bearer, or the signed-in owner (same-origin only).
 *
 * Trigger it every few minutes — see docs/SOCIAL_STUDIO.md (Vercel Hobby only
 * allows daily crons; the provided GitHub Actions workflow works on any plan).
 */
export async function GET(request: Request) {
  if (!(await authorizeCron(request))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const publishing = await runDueJobs(3);
    // Analytics collection is best-effort and cadence-limited; it must never fail the publishing tick.
    const analytics = await collectDue({ limit: 5 }).catch(() => ({ collected: 0, failed: 0, error: true }));
    return Response.json({ ...publishing, analytics });
  } catch (error) {
    console.error("[social] worker failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Worker failed." }, { status: 500 });
  }
}
