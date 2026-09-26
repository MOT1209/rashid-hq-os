"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServiceSupabase } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { clampScore, GRADES, nextCellValue, parseImportNames } from "@/lib/tracking";
import type { CellKind, CellValue, OverallGrade, WeekNum } from "@/lib/tracking";

const PATH = "/dashboard/tracking";
const ACTOR = "CEO Console";

function isWeek(value: number): value is WeekNum {
  return value >= 1 && value <= 4;
}

function isKind(value: string): value is CellKind {
  return value === "c" || value === "t" || value === "b" || value === "h";
}

/** Creates the month row if needed and returns its id. */
async function ensureMonthId(monthKey: string): Promise<string> {
  const db = getServiceSupabase();
  const { data: existing } = await db
    .from("tracking_months")
    .select("id")
    .eq("month_key", monthKey)
    .maybeSingle();
  if (existing) return (existing as { id: string }).id;

  const { data, error } = await db
    .from("tracking_months")
    .insert({ month_key: monthKey })
    .select("id")
    .single();
  if (error) throw new Error("Could not create the tracking month.");
  return (data as { id: string }).id;
}

export async function createMonthAction(form: FormData): Promise<void> {
  await requireAdmin();
  const monthKey = String(form.get("month_key") ?? "").trim().slice(0, 60);
  if (!monthKey) throw new Error("Month is required.");
  const school = String(form.get("school_name") ?? "").slice(0, 200);
  const className = String(form.get("class_name") ?? "").slice(0, 200);
  const subject = String(form.get("subject") ?? "").slice(0, 200);

  const db = getServiceSupabase();
  const { error } = await db.from("tracking_months").upsert(
    { month_key: monthKey, school_name: school, class_name: className, subject },
    { onConflict: "month_key" },
  );
  if (error) throw new Error("Could not save the month.");
  revalidatePath(PATH);
  redirect(`${PATH}?month=${encodeURIComponent(monthKey)}`);
}

/**
 * Replaces the member list of a month from the textarea (one "Name - role"
 * per line), preserving rows whose name already exists — the same behaviour
 * as saveStudentsFromImport in the HTML.
 */
export async function importMembersAction(monthId: string, raw: string) {
  const session = await requireAdmin();
  const entries = parseImportNames(raw).slice(0, 300);
  if (entries.length === 0) return { error: "No names found." };

  const db = getServiceSupabase();
  const { data: current } = await db
    .from("tracking_members")
    .select("id, name")
    .eq("month_id", monthId);
  const byName = new Map(((current ?? []) as { id: string; name: string }[]).map((m) => [m.name, m.id]));
  const keep = new Set<string>();

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const id = byName.get(entry.name);
    if (id) {
      keep.add(id);
      await db
        .from("tracking_members")
        .update({ role: entry.role.slice(0, 200), sort_order: i })
        .eq("id", id);
    } else {
      const { data, error } = await db
        .from("tracking_members")
        .insert({ month_id: monthId, name: entry.name.slice(0, 200), role: entry.role.slice(0, 200), sort_order: i })
        .select("id")
        .single();
      if (error) return { error: "Could not import the list." };
      keep.add((data as { id: string }).id);
    }
  }

  // Drop members that are no longer on the list (cells/scores cascade).
  const stale = ((current ?? []) as { id: string }[]).map((m) => m.id).filter((id) => !keep.has(id));
  if (stale.length > 0) {
    await db.from("tracking_members").delete().in("id", stale);
  }

  await logActivity({
    agentName: ACTOR,
    toolName: "tracking_import",
    payload: { month_id: monthId, count: entries.length, actor: session.user.email },
    status: "success",
    actorType: "person",
  });
  revalidatePath(PATH);
  return { ok: true, count: entries.length };
}

export async function toggleCellAction(memberId: string, week: number, kind: string) {
  await requireAdmin();
  if (!isWeek(week) || !isKind(kind)) return { error: "Bad cell." };

  const db = getServiceSupabase();
  const { data } = await db
    .from("tracking_cells")
    .select("value")
    .eq("member_id", memberId)
    .eq("week", week)
    .eq("kind", kind)
    .maybeSingle();
  const current = (data as { value: number } | null)?.value === 1
    ? 1
    : (data as { value: number } | null)?.value === 2
      ? 2
      : 0;
  const next: CellValue = nextCellValue(current as CellValue);

  const { error } = await db
    .from("tracking_cells")
    .upsert({ member_id: memberId, week, kind, value: next }, { onConflict: "member_id,week,kind" });
  if (error) return { error: "Could not save the cell." };
  revalidatePath(PATH);
  return { ok: true, value: next };
}

export async function setScoreAction(memberId: string, idx: number, score: number) {
  await requireAdmin();
  if (!Number.isInteger(idx) || idx < 1 || idx > 5) return { error: "Bad quiz index." };
  const value = clampScore(Number(score));

  const { error } = await getServiceSupabase()
    .from("tracking_scores")
    .upsert({ member_id: memberId, idx, score: value }, { onConflict: "member_id,idx" });
  if (error) return { error: "Could not save the score." };
  revalidatePath(PATH);
  return { ok: true, value };
}

export async function setGradeAction(memberId: string, grade: string, notes: string) {
  await requireAdmin();
  const overall: OverallGrade = GRADES.includes(grade as OverallGrade) ? (grade as OverallGrade) : "ممتاز";
  const { error } = await getServiceSupabase()
    .from("tracking_members")
    .update({ overall_grade: overall, notes: notes.slice(0, 2000) })
    .eq("id", memberId);
  if (error) return { error: "Could not save the evaluation." };
  revalidatePath(PATH);
  return { ok: true };
}

/** Clears every cell and score of the month but keeps the member list. */
export async function clearMonthAction(monthId: string) {
  await requireAdmin();
  const db = getServiceSupabase();
  const { data: members } = await db.from("tracking_members").select("id").eq("month_id", monthId);
  const ids = ((members ?? []) as { id: string }[]).map((m) => m.id);
  if (ids.length > 0) {
    await db.from("tracking_cells").delete().in("member_id", ids);
    await db.from("tracking_scores").delete().in("member_id", ids);
  }
  revalidatePath(PATH);
  return { ok: true };
}

export { ensureMonthId };
