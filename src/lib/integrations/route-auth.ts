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
export async function requireIntegrationOwner(): Promise<
  { ownerId: string } | { response: Response }
> {
  const session = await getSession();
  const role = session ? await resolveRole(session.user.email) : null;
  if (!session || role !== "admin") {
    return {
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (process.env.REQUIRE_2FA && !session.user.twoFactorEnabled) {
    return {
      response: Response.json(
        { error: "Two-factor authentication is required. Enable it in Settings." },
        { status: 403 },
      ),
    };
  }
  return { ownerId: session.user.id };
}
