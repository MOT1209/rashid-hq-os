import "server-only";

import { getServiceSupabase } from "@/lib/supabase/server";

/**
 * The owner id that background work runs as when there is no session — today,
 * the standing-task cron. Every write tool scopes its query by
 * projects.owner_id and fails closed without a match (src/lib/mcp/tools.ts).
 *
 * Read straight off projects.owner_id rather than the Better Auth `user` table
 * (which is not in the generated schema): it is the exact value the tools
 * compare against, and a console with no owned project has nothing for a
 * standing task to act on anyway.
 */
export async function resolveOwnerId(): Promise<string | null> {
  // Ordered so the choice is deterministic while this is single-owner. Once a
  // second owner exists, an autonomous run must instead carry the id of the
  // user who configured that department's standing task (a
  // standing_task_created_by column) rather than "whichever project is oldest".
  const { data } = await getServiceSupabase()
    .from("projects")
    .select("owner_id")
    .not("owner_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(1);

  return data?.[0]?.owner_id ?? null;
}
