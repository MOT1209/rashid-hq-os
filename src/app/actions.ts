"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getServiceSupabase } from "@/lib/supabase/server";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { issueAgentToken, revokeAgentToken } from "@/lib/agent-tokens";
import { isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { assertSafeEndpoint, UnsafeEndpointError } from "@/lib/net/safe-endpoint";
import { safeMessage } from "@/lib/errors";
import type { ProjectStatus } from "@/types/database";

function text(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Confirms the signed-in owner owns this project before it can be mutated. */
async function assertOwnsProject(projectId: string, ownerId: string) {
  const { data } = await getServiceSupabase()
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  return Boolean(data);
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

  const mcpEndpoint = text(form, "mcp_endpoint");
  if (mcpEndpoint) {
    try {
      await assertSafeEndpoint(mcpEndpoint);
    } catch (error) {
      if (error instanceof UnsafeEndpointError) return { error: error.message };
      throw error;
    }
  }

  const { data, error } = await getServiceSupabase()
    .from("projects")
    .insert({
      name,
      category: text(form, "category"),
      url: text(form, "url"),
      repository_url: text(form, "repository_url"),
      mcp_endpoint: mcpEndpoint,
      status: (text(form, "status") ?? "active") as ProjectStatus,
      owner_id: session.user.id,
    })
    .select("id, name")
    .single();

  if (error) return { error: safeMessage("Creating the project", error) };

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
  const session = await requireSession();
  const id = text(formData, "id");
  if (!id) return;
  // Scoped to the owner: defence in depth today, a real boundary the moment a
  // second account exists.
  const { error } = await getServiceSupabase()
    .from("projects")
    .delete()
    .eq("id", id)
    .eq("owner_id", session.user.id);
  if (error) safeMessage("Deleting the project", error);
  revalidatePath("/dashboard/projects");
  revalidatePath("/dashboard");
}

export async function addProjectToolAction(form: FormData) {
  const session = await requireSession();
  const projectId = text(form, "project_id");
  const toolName = text(form, "tool_name");
  if (!projectId || !toolName) return { error: "Project and tool name are required." };
  if (!(await assertOwnsProject(projectId, session.user.id))) {
    return { error: "Project not found." };
  }

  // This endpoint is what call_project_tool POSTs to, so it is validated before
  // it is ever stored.
  const endpoint = text(form, "endpoint");
  if (endpoint) {
    try {
      await assertSafeEndpoint(endpoint);
    } catch (error) {
      if (error instanceof UnsafeEndpointError) return { error: error.message };
      throw error;
    }
  }

  const { error } = await getServiceSupabase().from("project_tools").insert({
    project_id: projectId,
    tool_name: toolName,
    description: text(form, "description"),
    endpoint,
  });

  if (error) return { error: safeMessage("Adding the tool", error) };
  revalidatePath("/dashboard/projects");
  return { ok: true };
}

export async function issueTokenAction(form: FormData) {
  const session = await requireSession();
  const agentName = text(form, "agent_name");
  if (!agentName) return { error: "Agent name is required." };

  const projectId = text(form, "project_id");
  if (projectId && !(await assertOwnsProject(projectId, session.user.id))) {
    return { error: "Project not found." };
  }

  const scopes = form.get("scopes") === "read" ? ["read"] : ["read", "write"];

  try {
    const { token } = await issueAgentToken({
      agentName,
      projectId,
      scopes,
      createdBy: session.user.id,
    });
    revalidatePath("/dashboard/access");
    return { token };
  } catch (error) {
    return { error: safeMessage("Issuing the token", error) };
  }
}

export async function revokeTokenAction(form: FormData) {
  await requireSession();
  const id = text(form, "id");
  if (!id) return;
  await revokeAgentToken(id);
  revalidatePath("/dashboard/access");
}
