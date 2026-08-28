import "server-only";

import { timingSafeEqual } from "node:crypto";
import { getSession } from "@/lib/session";
import { isOwnerEmail } from "@/lib/owners";

/**
 * The shared gate for the GET cron routes: /api/agent/daily-check,
 * /api/agent/standing-tasks, /api/maintenance/prune.
 *
 * Two ways in:
 *  1. Vercel Cron — sends `Authorization: Bearer <CRON_SECRET>`.
 *  2. The signed-in owner running it by hand, to check a job without waiting
 *     for the schedule.
 *
 * Path 2 is where CSRF lives: these are GET handlers authenticated by an
 * ambient cookie, so `<img src="/api/agent/standing-tasks">` on a malicious
 * page would otherwise trigger a full write-scoped agent run as the owner.
 * The `Sec-Fetch-Site` check blocks that — a cross-site request carries
 * `cross-site` / `same-site`; a real navigation or same-origin fetch carries
 * `same-origin` or `none`. If CRON_SECRET is unset there is no unauthenticated
 * path — the bearer check simply fails and we fall through to the session.
 */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function authorizeCron(request: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (secret && authHeader && safeCompare(authHeader, `Bearer ${secret}`)) {
    return true;
  }

  // Cross-site requests cannot reach the manual-trigger path.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;

  const session = await getSession();
  return Boolean(session && isOwnerEmail(session.user.email));
}
