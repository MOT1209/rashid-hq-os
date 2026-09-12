"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getServiceSupabase } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/session";
import { logActivity, startActivity } from "@/lib/activity";
import { canRevokeToken, issueAgentToken, revokeAgentToken } from "@/lib/agent-tokens";
import { approveToolCall, rejectToolCall } from "@/lib/approvals";
import { findTool } from "@/lib/mcp/tools";
import { isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { isTheme, THEME_COOKIE } from "@/lib/theme";
import { assertSafeEndpoint, UnsafeEndpointError } from "@/lib/net/safe-endpoint";
import { safeMessage } from "@/lib/errors";
import type { ProjectStatus } from "@/types/database";

/**
 * agent_logs recorded what agents did and almost nothing the owner did: only
 * project creation was logged, so editing, deleting, issuing a token and
 * revoking one all happened without a trace. This actor name distinguishes
 * those entries from an agent's in the same feed.
 */
const OWNER_ACTOR = "CEO Console";

/** Longest value accepted in any single text field on a form. */
const MAX_FIELD = 500;

function text(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Oversized input is refused, never trimmed to fit. Slicing a value silently
 * stores a fragment the owner never typed, and the fragment can still be
 * plausible: a truncated mcp_endpoint parses as a URL and would be fetched as
 * one. Returns the message to hand back, so the form names the offending field
 * instead of reporting success on mangled data.
 */
function tooLong(form: FormData): string | null {
  for (const [key, value] of form.entries()) {
    if (typeof value === "string" && value.trim().length > MAX_FIELD) {
      return `"${key}" is longer than ${MAX_FIELD} characters.`;
    }
  }
  return null;
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

export async function setThemeAction(theme: string) {
  if (!isTheme(theme)) return;
  (await cookies()).set(THEME_COOKIE, theme, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
}

export async function createProjectAction(form: FormData) {
  const session = await requireAdmin();
  const oversized = tooLong(form);
  if (oversized) return { error: oversized };

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

export async function updateProjectAction(form: FormData) {
  const session = await requireAdmin();
  const oversized = tooLong(form);
  if (oversized) return { error: oversized };

  const id = text(form, "id");
  const name = text(form, "name");
  if (!id) return { error: "Project is required." };
  if (!name) return { error: "Name is required." };
  if (!(await assertOwnsProject(id, session.user.id))) {
    return { error: "Project not found." };
  }

  const mcpEndpoint = text(form, "mcp_endpoint");
  if (mcpEndpoint) {
    try {
      await assertSafeEndpoint(mcpEndpoint);
    } catch (error) {
      if (error instanceof UnsafeEndpointError) return { error: error.message };
      throw error;
    }
  }

  const { error } = await getServiceSupabase()
    .from("projects")
    .update({
      name,
      category: text(form, "category"),
      url: text(form, "url"),
      repository_url: text(form, "repository_url"),
      mcp_endpoint: mcpEndpoint,
      status: (text(form, "status") ?? "active") as ProjectStatus,
    })
    .eq("id", id)
    .eq("owner_id", session.user.id);

  if (error) return { error: safeMessage("Updating the project", error) };

  await logActivity({
    projectId: id,
    agentName: OWNER_ACTOR,
    toolName: "update_project",
    payload: { name },
    status: "success",
  });

  revalidatePath("/dashboard/projects");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteProjectAction(formData: FormData) {
  const session = await requireAdmin();
  const oversized = tooLong(formData);
  if (oversized) return { error: oversized };

  const id = text(formData, "id");
  if (!id) return { error: "Project is required." };

  const supabase = getServiceSupabase();

  // Read what is about to disappear so the audit entry can say so. Deleting a
  // project cascades to its logs, its tools and its live agent tokens.
  const [{ data: project }, { count: tokenCount }] = await Promise.all([
    supabase
      .from("projects")
      .select("name")
      .eq("id", id)
      .eq("owner_id", session.user.id)
      .maybeSingle(),
    supabase
      .from("agent_tokens")
      .select("id", { count: "exact", head: true })
      .eq("project_id", id)
      .is("revoked_at", null),
  ]);

  // Scoped to the owner: defence in depth today, a real boundary the moment a
  // second account exists. `count` distinguishes "not yours / not there" from
  // a successful delete — without it a no-op looked like success in the UI.
  const { error, count } = await supabase
    .from("projects")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("owner_id", session.user.id);

  if (error) return { error: safeMessage("Deleting the project", error) };
  if (!count) return { error: "Project not found." };

  // Deliberately unlinked: agent_logs cascades on project delete, so an entry
  // carrying this project_id would be erased along with the thing it records.
  await logActivity({
    agentName: OWNER_ACTOR,
    toolName: "delete_project",
    payload: {
      deleted_project_id: id,
      name: project?.name ?? null,
      revoked_tokens: tokenCount ?? 0,
    },
    status: "success",
  });

  revalidatePath("/dashboard/projects");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function addProjectToolAction(form: FormData) {
  const session = await requireAdmin();
  const oversized = tooLong(form);
  if (oversized) return { error: oversized };

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
  const session = await requireAdmin();
  const oversized = tooLong(form);
  if (oversized) return { error: oversized };

  const agentName = text(form, "agent_name");
  if (!agentName) return { error: "Agent name is required." };

  const projectId = text(form, "project_id");
  if (projectId && !(await assertOwnsProject(projectId, session.user.id))) {
    return { error: "Project not found." };
  }

  const scopes = form.get("scopes") === "read" ? ["read"] : ["read", "write"];

  // expires_at has always been stored and enforced, but nothing ever set it —
  // every token issued was immortal until revoked by hand.
  const days = Number(form.get("expires_days"));
  const expiresAt =
    Number.isFinite(days) && days > 0
      ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
      : null;

  try {
    const { token } = await issueAgentToken({
      agentName,
      projectId,
      scopes,
      expiresAt,
      createdBy: session.user.id,
    });
    await logActivity({
      agentName: OWNER_ACTOR,
      toolName: "issue_token",
      projectId,
      payload: { agent_name: agentName, scopes, expires_at: expiresAt },
      status: "success",
    });
    revalidatePath("/dashboard/access");
    return { token };
  } catch (error) {
    return { error: safeMessage("Issuing the token", error) };
  }
}

/**
 * Departments and categories used to be arrays in the source, so adding one was
 * a code change plus two dictionary edits plus a deploy. These keep them
 * editable at runtime.
 */
export async function saveCategoryAction(form: FormData) {
  await requireAdmin();
  const oversized = tooLong(form);
  if (oversized) return { error: oversized };

  const value = text(form, "value");
  const labelAr = text(form, "label_ar");
  const labelEn = text(form, "label_en");
  if (!value || !labelAr || !labelEn) {
    return { error: "Value and both labels are required." };
  }

  const departmentKey = text(form, "department_key");
  const { error } = await getServiceSupabase()
    .from("project_categories")
    .upsert({
      value,
      label_ar: labelAr,
      label_en: labelEn,
      department_key: departmentKey,
      sort_order: Number(form.get("sort_order")) || 0,
    });

  if (error) return { error: safeMessage("Saving the category", error) };

  await logActivity({
    agentName: OWNER_ACTOR,
    toolName: "save_category",
    payload: { value, department_key: departmentKey },
    status: "success",
  });

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteCategoryAction(form: FormData) {
  await requireAdmin();
  const oversized = tooLong(form);
  if (oversized) return { error: oversized };

  const value = text(form, "value");
  if (!value) return { error: "Category is required." };

  // Projects keep the string they were saved with; categoryLabel passes an
  // unknown value straight through, so nothing breaks visually.
  const { error } = await getServiceSupabase()
    .from("project_categories")
    .delete()
    .eq("value", value);

  if (error) return { error: safeMessage("Deleting the category", error) };

  await logActivity({
    agentName: OWNER_ACTOR,
    toolName: "delete_category",
    payload: { value },
    status: "success",
  });

  revalidatePath("/", "layout");
  return { ok: true };
}

/** Prompts run longer than every other text field this console stores. */
const MAX_SKILL_PROMPT = 4000;

/**
 * Saved command templates for the CEO console (migration 0010). A skill only
 * ever fills the console's input box — it never runs a model on its own, so
 * saving or reading one carries none of the risk a self-executing tool would.
 */
export async function saveSkillAction(form: FormData) {
  const session = await requireAdmin();

  const name = text(form, "name");
  const prompt = text(form, "prompt");
  const description = text(form, "description");
  if (!name) return { error: "Name is required." };
  if (!prompt) return { error: "Prompt is required." };
  if (name.length > MAX_FIELD) return { error: `"name" is longer than ${MAX_FIELD} characters.` };
  if (description && description.length > MAX_FIELD) {
    return { error: `"description" is longer than ${MAX_FIELD} characters.` };
  }
  if (prompt.length > MAX_SKILL_PROMPT) {
    return { error: `"prompt" is longer than ${MAX_SKILL_PROMPT} characters.` };
  }

  const { error } = await getServiceSupabase().from("agent_skills").insert({
    name,
    description,
    prompt,
    created_by: session.user.id,
  });

  if (error) return { error: safeMessage("Saving the skill", error) };

  await logActivity({
    agentName: OWNER_ACTOR,
    toolName: "save_skill",
    payload: { name },
    status: "success",
  });

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteSkillAction(form: FormData) {
  await requireAdmin();
  const oversized = tooLong(form);
  if (oversized) return { error: oversized };

  const id = text(form, "id");
  if (!id) return { error: "Skill is required." };

  const { error } = await getServiceSupabase().from("agent_skills").delete().eq("id", id);
  if (error) return { error: safeMessage("Deleting the skill", error) };

  await logActivity({
    agentName: OWNER_ACTOR,
    toolName: "delete_skill",
    payload: { id },
    status: "success",
  });

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard");
  return { ok: true };
}

/** Agent instructions run longer than every other text field this console stores. */
const MAX_AGENT_PROMPT = 4000;

/** A standing task is a brief, not a document — same cap as delegate_to_department. */
const MAX_STANDING_TASK = 2000;

/**
 * Edits a department agent's instructions, model, and standing task
 * (migrations 0011 and 0012). Until now all of these could only be changed
 * with SQL against the production database — customisable agents with no way
 * to customise them. Admins only; logged in the same feed as every other
 * owner action.
 */
export async function updateDepartmentAgentAction(form: FormData) {
  await requireAdmin();

  const key = text(form, "key");
  if (!key) return { error: "Department is required." };

  // Empty is valid — it means "no instructions beyond the runtime defaults" —
  // so this is read raw rather than through text(), which would return null.
  const raw = form.get("system_prompt");
  const systemPrompt = typeof raw === "string" ? raw.trim() : "";
  if (systemPrompt.length > MAX_AGENT_PROMPT) {
    return { error: `"system_prompt" is longer than ${MAX_AGENT_PROMPT} characters.` };
  }

  const model = text(form, "model");
  if (model && model.length > MAX_FIELD) {
    return { error: `"model" is longer than ${MAX_FIELD} characters.` };
  }

  const standingRaw = form.get("standing_task");
  const standingTask = typeof standingRaw === "string" ? standingRaw.trim() : "";
  if (standingTask.length > MAX_STANDING_TASK) {
    return { error: `"standing_task" is longer than ${MAX_STANDING_TASK} characters.` };
  }
  // A brief that runs a model daily on its own is off unless explicitly turned
  // on, so the checkbox must be present and checked — not merely non-empty text.
  const standingTaskEnabled = form.get("standing_task_enabled") === "on";

  const { data, error } = await getServiceSupabase()
    .from("departments")
    .update({
      system_prompt: systemPrompt,
      model,
      standing_task: standingTask || null,
      standing_task_enabled: standingTaskEnabled,
    })
    .eq("key", key)
    .select("key")
    .maybeSingle();

  if (error) return { error: safeMessage("Updating the agent", error) };
  if (!data) return { error: "Department not found." };

  await logActivity({
    agentName: OWNER_ACTOR,
    toolName: "update_department_agent",
    payload: {
      key,
      model,
      prompt_chars: systemPrompt.length,
      standing_task: standingTask ? `${standingTask.length} chars` : null,
      standing_task_enabled: standingTaskEnabled,
    },
    status: "success",
  });

  revalidatePath("/", "layout");
  revalidatePath("/dashboard/settings");
  return { ok: true };
}

/** Grants or changes someone's role. Admins only, by requireAdmin above. */
export async function saveMemberAction(form: FormData) {
  const session = await requireAdmin();
  const oversized = tooLong(form);
  if (oversized) return { error: oversized };

  const email = text(form, "email")?.toLowerCase();
  const role = form.get("role") === "admin" ? "admin" : "viewer";
  if (!email || !email.includes("@")) return { error: "A valid email is required." };

  const { error } = await getServiceSupabase()
    .from("members")
    .upsert({ email, role, invited_by: session.user.email });

  if (error) return { error: safeMessage("Saving the member", error) };

  await logActivity({
    agentName: OWNER_ACTOR,
    toolName: "save_member",
    payload: { email, role },
    status: "success",
  });

  revalidatePath("/dashboard/settings");
  return { ok: true };
}

export async function removeMemberAction(form: FormData) {
  const session = await requireAdmin();
  const oversized = tooLong(form);
  if (oversized) return { error: oversized };

  const email = text(form, "email")?.toLowerCase();
  if (!email) return { error: "Member is required." };

  // Removing yourself would be a one-click lockout for anyone not covered by
  // OWNER_EMAILS, so it is refused rather than merely hidden.
  if (email === session.user.email?.toLowerCase()) {
    return { error: "You cannot remove your own access." };
  }

  const { error } = await getServiceSupabase()
    .from("members")
    .delete()
    .eq("email", email);

  if (error) return { error: safeMessage("Removing the member", error) };

  await logActivity({
    agentName: OWNER_ACTOR,
    toolName: "remove_member",
    payload: { email },
    status: "success",
  });

  revalidatePath("/dashboard/settings");
  return { ok: true };
}

export async function revokeTokenAction(form: FormData) {
  const session = await requireAdmin();
  const id = text(form, "id");
  if (!id) return;

  const { data: token } = await getServiceSupabase()
    .from("agent_tokens")
    .select("agent_name, project_id, created_by")
    .eq("id", id)
    .maybeSingle();

  if (!token) return;

  // Defence in depth: the issuer can revoke, and so can an OWNER_EMAILS owner —
  // otherwise a leaked token issued by a since-departed admin could never be
  // pulled from the console. `role` is "admin" for member-table admins too, so
  // it cannot stand in for the owner check here.
  if (!canRevokeToken(token.created_by, session)) {
    // Silent no-ops were invisible: the button did nothing and said nothing.
    // The refusal now lands in the same feed as every other owner action.
    await logActivity({
      projectId: token.project_id ?? null,
      agentName: OWNER_ACTOR,
      toolName: "revoke_token",
      payload: { agent_name: token.agent_name ?? null, denied: "not_the_issuer" },
      status: "failed",
    });
    revalidatePath("/dashboard/access");
    return;
  }

  await revokeAgentToken(id);
  await logActivity({
    projectId: token.project_id ?? null,
    agentName: OWNER_ACTOR,
    toolName: "revoke_token",
    payload: { agent_name: token.agent_name ?? null },
    status: "success",
  });
  revalidatePath("/dashboard/access");
}

/**
 * The other half of the policy gate (src/lib/policy.ts): a call it marked
 * require_approval sits in tool_approvals until an admin decides. Approving
 * runs the tool's own execute() for real — the policy already made the
 * authorization call by queuing it, so this does not re-check it. Mirrors
 * revokeTokenAction above: a plain form action, failure logged rather than
 * surfaced inline.
 */
export async function approveToolCallAction(form: FormData) {
  const session = await requireAdmin();
  const id = text(form, "id");
  if (!id) return;

  try {
    await approveToolCall(id, session.user.id);
  } catch (error) {
    await logActivity({
      agentName: OWNER_ACTOR,
      toolName: "approve_tool_call",
      payload: { approval_id: id },
      status: "failed",
      result: { error: safeMessage("Approving the call", error) },
    });
  }
  revalidatePath("/dashboard/access");
}

export async function rejectToolCallAction(form: FormData) {
  const session = await requireAdmin();
  const id = text(form, "id");
  if (!id) return;

  try {
    await rejectToolCall(id, session.user.id);
  } catch (error) {
    await logActivity({
      agentName: OWNER_ACTOR,
      toolName: "reject_tool_call",
      payload: { approval_id: id },
      status: "failed",
      result: { error: safeMessage("Rejecting the call", error) },
    });
  }
  revalidatePath("/dashboard/access");
}

/** Tools could only ever be added — a typo'd endpoint was permanent. */
export async function updateProjectToolAction(form: FormData) {
  const session = await requireAdmin();
  const oversized = tooLong(form);
  if (oversized) return { error: oversized };

  const id = text(form, "id");
  const toolName = text(form, "tool_name");
  if (!id || !toolName) return { error: "Tool name is required." };

  const supabase = getServiceSupabase();
  const { data: existing } = await supabase
    .from("project_tools")
    .select("project_id")
    .eq("id", id)
    .maybeSingle();

  if (!existing || !(await assertOwnsProject(existing.project_id, session.user.id))) {
    return { error: "Tool not found." };
  }

  const endpoint = text(form, "endpoint");
  if (endpoint) {
    try {
      await assertSafeEndpoint(endpoint);
    } catch (error) {
      if (error instanceof UnsafeEndpointError) return { error: error.message };
      throw error;
    }
  }

  const { error } = await supabase
    .from("project_tools")
    .update({
      tool_name: toolName,
      description: text(form, "description"),
      endpoint,
    })
    .eq("id", id);

  if (error) return { error: safeMessage("Updating the tool", error) };

  await logActivity({
    projectId: existing.project_id,
    agentName: OWNER_ACTOR,
    toolName: "update_project_tool",
    payload: { tool_name: toolName },
    status: "success",
  });

  revalidatePath("/dashboard/projects");
  return { ok: true };
}

export async function deleteProjectToolAction(form: FormData) {
  const session = await requireAdmin();
  const oversized = tooLong(form);
  if (oversized) return { error: oversized };

  const id = text(form, "id");
  if (!id) return { error: "Tool is required." };

  const supabase = getServiceSupabase();
  const { data: existing } = await supabase
    .from("project_tools")
    .select("project_id, tool_name")
    .eq("id", id)
    .maybeSingle();

  if (!existing || !(await assertOwnsProject(existing.project_id, session.user.id))) {
    return { error: "Tool not found." };
  }

  const { error } = await supabase.from("project_tools").delete().eq("id", id);
  if (error) return { error: safeMessage("Deleting the tool", error) };

  await logActivity({
    projectId: existing.project_id,
    agentName: OWNER_ACTOR,
    toolName: "delete_project_tool",
    payload: { tool_name: existing.tool_name },
    status: "success",
  });

  revalidatePath("/dashboard/projects");
  return { ok: true };
}

/**
 * Fires a project's registered tool with an empty input so the owner can see
 * whether the endpoint answers — previously you only found out when a real
 * agent call failed. Runs through the same SSRF guard and activity log as a
 * genuine MCP call.
 */
export async function testProjectToolAction(form: FormData) {
  const session = await requireAdmin();
  const oversized = tooLong(form);
  if (oversized) return { error: oversized };

  const projectId = text(form, "project_id");
  const toolName = text(form, "tool_name");
  if (!projectId || !toolName) return { error: "Project and tool are required." };
  if (!(await assertOwnsProject(projectId, session.user.id))) {
    return { error: "Project not found." };
  }

  const tool = findTool("call_project_tool");
  if (!tool) return { error: "Tool unavailable." };

  const { finish } = await startActivity({
    projectId,
    agentName: OWNER_ACTOR,
    toolName: "call_project_tool",
    payload: { tool_name: toolName, test: true },
  });

  try {
    const result = await tool.execute(
      { project_id: projectId, tool_name: toolName, input: {} } as never,
      { agentName: OWNER_ACTOR, scopes: ["read", "write"], ownerId: session.user.id },
    );
    await finish("success", result);
    revalidatePath("/dashboard/projects");
    return { ok: true, result: JSON.stringify(result).slice(0, 2000) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The call failed.";
    await finish("failed", { error: message });
    revalidatePath("/dashboard/projects");
    return { error: message };
  }
}
