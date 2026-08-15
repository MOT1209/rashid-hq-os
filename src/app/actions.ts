"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getServiceSupabase } from "@/lib/supabase/server";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { issueAgentToken, revokeAgentToken } from "@/lib/agent-tokens";
import { isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import type { ProjectStatus } from "@/types/database";

function text(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function setLocaleAction(locale: string) {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
}

export async function createProjectAction(form: FormData) {
  const session = await requireSession();
  const name = text(form, "name");
  if (!name) return { error: "Name is required." };

  const { data, error } = await getServiceSupabase()
    .from("projects")
    .insert({
      name,
      category: text(form, "category"),
      url: text(form, "url"),
      repository_url: text(form, "repository_url"),
      mcp_endpoint: text(form, "mcp_endpoint"),
      status: (text(form, "status") ?? "active") as ProjectStatus,
      owner_id: session.user.id,
    })
    .select("id, name")
    .single();

  if (error) return { error: error.message };

  await logActivity({
    projectId: data.id,
    agentName: "CEO Console",
    toolName: "register_project",
    payload: { name },
    status: "success",
    result: { project_id: data.id },
  });

  revalidatePath("/dashboard/projects");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteProjectAction(formData: FormData) {
  await requireSession();
  const id = text(formData, "id");
  if (!id) return;
  await getServiceSupabase().from("projects").delete().eq("id", id);
  revalidatePath("/dashboard/projects");
}

export async function addProjectToolAction(form: FormData) {
  await requireSession();
  const projectId = text(form, "project_id");
  const toolName = text(form, "tool_name");
  if (!projectId || !toolName) return { error: "Project and tool name are required." };

  const { error } = await getServiceSupabase().from("project_tools").insert({
    project_id: projectId,
    tool_name: toolName,
    description: text(form, "description"),
    endpoint: text(form, "endpoint"),
  });

  if (error) return { error: error.message };
  revalidatePath("/dashboard/projects");
  return { ok: true };
}

export async function issueTokenAction(form: FormData) {
  const session = await requireSession();
  const agentName = text(form, "agent_name");
  if (!agentName) return { error: "Agent name is required." };

  try {
    const { token } = await issueAgentToken({
      agentName,
      projectId: text(form, "project_id"),
      createdBy: session.user.id,
    });
    revalidatePath("/dashboard/access");
    return { token };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to issue token." };
  }
}

export async function revokeTokenAction(form: FormData) {
  await requireSession();
  const id = text(form, "id");
  if (!id) return;
  await revokeAgentToken(id);
  revalidatePath("/dashboard/access");
}
