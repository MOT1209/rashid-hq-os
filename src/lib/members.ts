import "server-only";

import { cache } from "react";
import { getServiceSupabase } from "@/lib/supabase/server";
import { isOwnerEmail } from "@/lib/owners";
import { dbError } from "@/lib/errors";

export type Role = "admin" | "viewer";

export type Member = {
  email: string;
  role: Role;
  invited_by: string | null;
  created_at: string;
};

/**
 * Who a signed-in address is allowed to be.
 *
 * OWNER_EMAILS still wins and still fails closed — anyone on it is an admin, so
 * a fresh install works with no seeding and cannot lock itself out by deleting
 * the last member row. Everyone else must have a row in `members`.
 */
export const resolveRole = cache(async (email: string | null | undefined): Promise<Role | null> => {
  if (!email) return null;
  if (isOwnerEmail(email)) return "admin";

  const { data, error } = await getServiceSupabase()
    .from("members")
    .select("role")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();

  if (error) throw dbError("Resolving the member role", error);
  return (data?.role as Role | undefined) ?? null;
});

export const listMembers = cache(async (): Promise<Member[]> => {
  const { data, error } = await getServiceSupabase()
    .from("members")
    .select("*")
    .order("created_at");
  if (error) throw dbError("Loading members", error);
  return (data ?? []) as Member[];
});
