"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity";
import { safeMessage } from "@/lib/errors";
import { requireAdmin, requireSession } from "@/lib/session";
import { buildExport, parseImport, uniqueName, validateSkill, type SkillDraft } from "@/lib/skills";
import {
  ConflictError, allNames, createSkill, deleteSkill, forExport, getSkill, restoreVersion, setEnabled, updateSkill,
} from "@/lib/skills-store";
import type { Json } from "@/types/database";

const PATH = "/dashboard/skills";
const ACTOR = "CEO Console";
type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

function refresh() {
  revalidatePath(PATH);
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/settings");
}
async function audit(tool: string, payload: Json) {
  await logActivity({ agentName: ACTOR, toolName: tool, payload, status: "success" }).catch(() => undefined);
}
const parseJson = (text: string, label: string): { ok: true; value: unknown } | { ok: false; error: string } => {
  if (!text.trim()) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, error: `${label} is not valid JSON.` };
  }
};

export type SkillForm = {
  id?: string;
  expectedVersion?: number;
  name: string;
  description: string;
  prompt: string;
  tags: string;
  inputSchema: string;
  outputSchema: string;
  metadata: string;
};

function draftFrom(form: SkillForm): { ok: true; draft: SkillDraft; warnings: string[] } | { ok: false; error: string } {
  const i = parseJson(form.inputSchema, "Input schema");
  const o = parseJson(form.outputSchema, "Output schema");
  const m = parseJson(form.metadata, "Metadata");
  for (const p of [i, o, m]) if (!p.ok) return p;
  const v = validateSkill({
    name: form.name, description: form.description, prompt: form.prompt, tags: form.tags,
    input_schema: (i as { value: unknown }).value, output_schema: (o as { value: unknown }).value, metadata: (m as { value: unknown }).value,
  });
  if (!v.ok || !v.value) return { ok: false, error: v.errors.join(" ") };
  return { ok: true, draft: v.value, warnings: v.warnings };
}

export async function saveSkillAction(form: SkillForm): Promise<Result<{ id: string; version: number; warnings: string[] }>> {
  const session = await requireAdmin();
  const d = draftFrom(form);
  if (!d.ok) return fail(d.error);
  try {
    const row = form.id
      ? await updateSkill(form.id, d.draft, form.expectedVersion ?? -1, session.user.id)
      : await createSkill(d.draft, session.user.id);
    await audit(form.id ? "update_skill" : "save_skill", { skill_id: row.id, name: row.name, version: row.version });
    refresh();
    return { ok: true, id: row.id, version: row.version, warnings: d.warnings };
  } catch (e) {
    if (e instanceof ConflictError) return fail(e.message);
    return fail(safeMessage("Saving the skill", e));
  }
}

export async function toggleSkillAction(id: string, enabled: boolean): Promise<Result> {
  await requireAdmin();
  try {
    if (!(await setEnabled(id, enabled))) return fail("Skill not found.");
  } catch (e) {
    return fail(safeMessage("Updating the skill", e));
  }
  await audit(enabled ? "enable_skill" : "disable_skill", { skill_id: id });
  refresh();
  return { ok: true };
}

export async function duplicateSkillAction(id: string): Promise<Result<{ id: string }>> {
  const session = await requireAdmin();
  try {
    const s = await getSkill(id);
    if (!s) return fail("Skill not found.");
    const name = uniqueName(`${s.name} (copy)`, await allNames());
    // Copies start DISABLED so a duplicate never silently becomes a second live version.
    const row = await createSkill(
      { name, description: s.description, prompt: s.prompt, tags: s.tags, input_schema: s.input_schema, output_schema: s.output_schema, metadata: s.metadata },
      session.user.id,
      false,
    );
    await audit("duplicate_skill", { skill_id: row.id, from: id });
    refresh();
    return { ok: true, id: row.id };
  } catch (e) {
    return fail(safeMessage("Duplicating the skill", e));
  }
}

export async function deleteSkillAction(id: string): Promise<Result> {
  await requireAdmin();
  try {
    if (!(await deleteSkill(id))) return fail("Skill not found.");
  } catch (e) {
    return fail(safeMessage("Deleting the skill", e));
  }
  await audit("delete_skill", { skill_id: id });
  refresh();
  return { ok: true };
}

export async function restoreVersionAction(id: string, version: number): Promise<Result<{ version: number }>> {
  const session = await requireAdmin();
  try {
    const row = await restoreVersion(id, version, session.user.id);
    await audit("restore_skill_version", { skill_id: id, restored: version, new_version: row.version });
    refresh();
    return { ok: true, version: row.version };
  } catch (e) {
    if (e instanceof ConflictError) return fail(e.message);
    return fail(e instanceof Error && e.message.endsWith("not found.") ? e.message : safeMessage("Restoring the version", e));
  }
}

/** Returns the export JSON for the chosen skills (all when none are given). Read-only; admin because prompts can be sensitive. */
export async function exportSkillsAction(ids?: string[]): Promise<Result<{ filename: string; json: string; count: number }>> {
  await requireAdmin();
  try {
    const skills = await forExport(ids);
    if (skills.length === 0) return fail("Nothing to export.");
    await audit("export_skills", { count: skills.length });
    return { ok: true, filename: `skills-${new Date().toISOString().slice(0, 10)}.json`, json: buildExport(skills), count: skills.length };
  } catch (e) {
    return fail(safeMessage("Exporting skills", e));
  }
}

/**
 * Imports a bundle. Imported prompts come from outside, so every imported
 * skill lands DISABLED for the owner to review before agents or the console can see it.
 */
export async function importSkillsAction(text: string): Promise<Result<{ imported: number; failed: { index: number; errors: string[] }[]; warnings: number }>> {
  const session = await requireAdmin();
  const parsed = parseImport(text);
  if (parsed.fatal) return fail(parsed.fatal);
  try {
    const taken = await allNames();
    let imported = 0;
    let warnings = 0;
    const failed: { index: number; errors: string[] }[] = [];
    for (const [index, v] of parsed.skills.entries()) {
      if (!v.ok || !v.value) {
        failed.push({ index: index + 1, errors: v.errors });
        continue;
      }
      const name = uniqueName(v.value.name, taken);
      taken.add(name);
      await createSkill({ ...v.value, name, metadata: { ...v.value.metadata, imported_at: new Date().toISOString() } }, session.user.id, false);
      imported += 1;
      warnings += v.warnings.length;
    }
    await audit("import_skills", { imported, failed: failed.length });
    refresh();
    return { ok: true, imported, failed, warnings };
  } catch (e) {
    return fail(safeMessage("Importing skills", e));
  }
}

/** Called when a skill is picked in the console, so usage shows up in the skill's log. */
export async function recordSkillUseAction(id: string): Promise<void> {
  const session = await requireSession();
  const s = await getSkill(id).catch(() => null);
  if (!s) return;
  await logActivity({
    agentName: session.user.email ?? ACTOR,
    toolName: "use_skill",
    payload: { skill_id: s.id, name: s.name, version: s.version },
    status: "success",
  }).catch(() => undefined);
}
