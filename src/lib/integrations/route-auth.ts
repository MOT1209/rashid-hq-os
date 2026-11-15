import "server-only";

import { getSession } from "@/lib/session";
import { resolveRole } from "@/lib/members";

/**
 * Admin gate for the integration route handlers, mirroring the CEO console
 * route (src/app/api/console/route.ts): a real session, an admin role, and
 * — when REQUIRE_2FA is set — a verified second factor. Connecting an account
 * is a write, so it gets the same bar as every other write.
 *
 * Returns the owner id on success, or a Response to return as-is on failure.
 */
/**
 * The single definition of "may this session perform a sensitive integration
 * action". Shared by /connect (JSON errors) and /callback (redirect errors) so
 * the two can never drift apart again — the callback used to check the role but
 * skip the REQUIRE_2FA policy that /connect enforced.
 */
export type OwnerCheck =
  | { ok: true; ownerId: string }
  | { ok: false; reason: "unauthorized" | "two_factor_required" };

export async function checkIntegrationOwner(): Promise<OwnerCheck> {
  const session = await getSession();
  const role = session ? await resolveRole(session.user.email) : null;
  if (!session || role !== "admin") return { ok: false, reason: "unauthorized" };
  if (process.env.REQUIRE_2FA && !session.user.twoFactorEnabled) {
    return { ok: false, reason: "two_factor_required" };
  }
  return { ok: true, ownerId: session.user.id };
}

export async function requireIntegrationOwner(): Promise<
  { ownerId: string } | { response: Response }
> {
  const check = await checkIntegrationOwner();
  if (check.ok) return { ownerId: check.ownerId };
  if (check.reason === "two_factor_required") {
    return {
      response: Response.json(
        { error: "Two-factor authentication is required. Enable it in Settings." },
        { status: 403 },
      ),
    };
  }
  return { response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
}
