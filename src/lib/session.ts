import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isOwnerEmail } from "@/lib/owners";

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/**
 * Guards a server component or action. A valid session is not enough — the
 * account must also be on the OWNER_EMAILS allowlist, so a stray account
 * created before the allowlist existed still gets nothing.
 */
export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (!isOwnerEmail(session.user.email)) redirect("/sign-in?denied=1");
  return session;
}
