import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveRole, type Role } from "@/lib/members";

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/**
 * Guards a server component or action. A valid session is not enough — the
 * account must also resolve to a role, either through OWNER_EMAILS or a row in
 * `members`. Returns the session with the role attached.
 */
export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const role = await resolveRole(session.user.email);
  if (!role) redirect("/sign-in?denied=1");

  return { ...session, role };
}

/**
 * Guards anything that writes. A viewer can read the whole dashboard but every
 * mutation is refused — the check lives here rather than in the UI, so hiding a
 * button is presentation and this is the boundary.
 *
 * With REQUIRE_2FA set, an admin without a second factor can still read the
 * dashboard but cannot write until they enable it on /dashboard/settings (which
 * only needs requireSession). Break-glass: unset REQUIRE_2FA.
 */
export async function requireAdmin() {
  const session = await requireSession();
  if (session.role !== "admin") {
    throw new Error("This account does not have permission to make changes.");
  }
  if (process.env.REQUIRE_2FA && !session.user.twoFactorEnabled) {
    throw new Error(
      "Two-factor authentication is required for changes. Enable it in Settings first.",
    );
  }
  return session;
}

export type SessionRole = Role;
