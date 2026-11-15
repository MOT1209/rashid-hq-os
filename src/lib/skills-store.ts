import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "@/lib/errors";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { ExportableSkill, SkillDraft } from "@/lib/skills";

const db = () => getServiceSupabase() as unknown as SupabaseClient;

export type SkillRow = {
  id: string; name: string; description: string | null; prompt: string; enabled: boolean; version: number;
  tags: string[]; input_schema: SkillDraft["input_schema"]; output_schema: SkillDraft["output_schema"];
  metadata: Record<string, unknown>; created_at: string; updated_at: string;
};
export type VersionRow = Omit<SkillRow, "enabled" | "created_at" | "updated_at"> & { skill_id: string; saved_at: string; saved_by: string | null };

export class ConflictError extends Error {}

const COLS = "id, name, description, prompt, enabled, version, tags, input_schema, output_schema, metadata, created_at, updated_at";

export async function listSkills(opts: { q?: string; tag?: string; enabled?: boolean } = {}): Promise<SkillRow[]> {
  let q = db().from("agent_skills").select(COLS).order("updated_at", { ascending: false }).limit(300);
  if (opts.enabled !== undefined) q = q.eq("enabled", opts.enabled);
  if (opts.tag) q = q.contains("tags", [opts.tag.toLowerCase()]);
  if (opts.q) {
    // Strip characters that have meaning in PostgREST filter syntax.
    const term = opts.q.replace(/[%_,()*\\]/g, " ").trim().slice(0, 80);
    if (term) q = q.or(`name.ilike.%${term}%,description.ilike.%${term}%,prompt.ilike.%${term}%`);
  }
  const { data, error } = await q;
  if (error) throw dbError("Loading skills", error);
  return (data ?? []) as SkillRow[];
}

export async function getSkill(id: string): Promise<SkillRow | null> {
  const { data, error } = await db().from("agent_skills").select(COLS).eq("id", id).maybeSingle();
  if (error) throw dbError("Loading the skill", error);
  return (data as SkillRow | null) ?? null;
}

export async function listVersions(id: string): Promise<VersionRow[]> {
  const { data, error } = await db().from("agent_skill_versions").select("*").eq("skill_id", id).order("version", { ascending: false }).limit(50);
  if (error) throw dbError("Loading versions", error);
  return (data ?? []) as VersionRow[];
}

export async function createSkill(d: SkillDraft, ownerId: string, enabled = true): Promise<SkillRow> {
  const { data, error } = await db()
    .from("agent_skills")
    .insert({ ...d, enabled, created_by: ownerId })
    .select(COLS)
    .single();
  if (error) throw dbError("Saving the skill", error);
  return data as SkillRow;
}

/**
 * Edits a skill. The previous state is snapshotted as its own version first
 * (unique per skill+version), then the row is updated only if nobody else
 * changed it meanwhile (optimistic lock on `version`).
 */
export async function updateSkill(id: string, d: SkillDraft, expectedVersion: number, ownerId: string): Promise<SkillRow> {
  const current = await getSkill(id);
  if (!current) throw new Error("Skill not found.");
  if (current.version !== expectedVersion) throw new ConflictError("This skill was changed elsewhere. Reload and try again.");

  const { error: snapErr } = await db().from("agent_skill_versions").insert({
    skill_id: id, version: current.version, name: current.name, description: current.description, prompt: current.prompt, tags: current.tags,
    input_schema: current.input_schema, output_schema: current.output_schema, metadata: current.metadata, saved_by: ownerId,
  });
  if (snapErr) {
    if ((snapErr as { code?: string }).code === "23505") throw new ConflictError("This skill was changed elsewhere. Reload and try again.");
    throw dbError("Saving the previous version", snapErr);
  }
  const { data, error } = await db()
    .from("agent_skills")
    .update({ ...d, version: current.version + 1, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("version", expectedVersion)
    .select(COLS)
    .maybeSingle();
  if (error) throw dbError("Updating the skill", error);
  if (!data) throw new ConflictError("This skill was changed elsewhere. Reload and try again.");
  return data as SkillRow;
}

export async function restoreVersion(id: string, version: number, ownerId: string): Promise<SkillRow> {
  const current = await getSkill(id);
  if (!current) throw new Error("Skill not found.");
  const { data, error } = await db().from("agent_skill_versions").select("*").eq("skill_id", id).eq("version", version).maybeSingle();
  if (error) throw dbError("Loading the version", error);
  if (!data) throw new Error("Version not found.");
  const v = data as VersionRow;
  // Restoring creates a NEW version (history is never rewritten).
  return updateSkill(id, { name: v.name, description: v.description, prompt: v.prompt, tags: v.tags, input_schema: v.input_schema, output_schema: v.output_schema, metadata: v.metadata }, current.version, ownerId);
}

export async function setEnabled(id: string, enabled: boolean): Promise<boolean> {
  const { data, error } = await db().from("agent_skills").update({ enabled, updated_at: new Date().toISOString() }).eq("id", id).select("id");
  if (error) throw dbError("Updating the skill", error);
  return Boolean(data?.length);
}

export async function deleteSkill(id: string): Promise<boolean> {
  const { data, error } = await db().from("agent_skills").delete().eq("id", id).select("id");
  if (error) throw dbError("Deleting the skill", error);
  return Boolean(data?.length);
}

export async function allNames(): Promise<Set<string>> {
  const { data, error } = await db().from("agent_skills").select("name").limit(1000);
  if (error) throw dbError("Loading skills", error);
  return new Set((data ?? []).map((r: { name: string }) => r.name));
}

export async function forExport(ids?: string[]): Promise<ExportableSkill[]> {
  let q = db().from("agent_skills").select(COLS).order("name").limit(500);
  if (ids?.length) q = q.in("id", ids);
  const { data, error } = await q;
  if (error) throw dbError("Loading skills", error);
  return ((data ?? []) as SkillRow[]).map((s) => ({ name: s.name, description: s.description, prompt: s.prompt, tags: s.tags, input_schema: s.input_schema, output_schema: s.output_schema, metadata: s.metadata, version: s.version }));
}

export type UsageEntry = { at: string; tool: string; actor: string | null; status: string; version: number | null };

/** Real usage from the activity log: console picks (use_skill) and agent reads (get_skill). */
export async function usageFor(id: string, limit = 10): Promise<{ total: number; entries: UsageEntry[] }> {
  const { data, error, count } = await db()
    .from("agent_logs")
    .select("created_at, tool_name, agent_name, status, payload", { count: "exact" })
    .in("tool_name", ["use_skill", "get_skill"])
    .contains("payload", { skill_id: id })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw dbError("Loading skill usage", error);
  return {
    total: count ?? 0,
    entries: (data ?? []).map((r: { created_at: string; tool_name: string; agent_name: string | null; status: string; payload: { version?: number } | null }) => ({
      at: r.created_at, tool: r.tool_name, actor: r.agent_name, status: r.status, version: typeof r.payload?.version === "number" ? r.payload.version : null,
    })),
  };
}
