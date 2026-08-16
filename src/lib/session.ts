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
 */
export async function requireAdmin() {
  const session = await requireSession();
  if (session.role !== "admin") {
    throw new Error("This account does not have permission to make changes.");
  }
  return session;
}

export type SessionRole = Role;
