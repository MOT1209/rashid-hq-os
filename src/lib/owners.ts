import "server-only";

/**
 * The allowlist that keeps this a single-owner console. Enforced in two places:
 * at sign-up (src/lib/auth.ts) so no new account can be created, and at every
 * guarded read (src/lib/session.ts) so an account that predates the allowlist
 * still cannot reach the dashboard.
 *
 * Fails closed: an unset or empty OWNER_EMAILS locks everyone out rather than
 * letting everyone in.
 */
export function ownerEmails(): string[] {
  return (process.env.OWNER_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isOwnerEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ownerEmails().includes(email.trim().toLowerCase());
}
