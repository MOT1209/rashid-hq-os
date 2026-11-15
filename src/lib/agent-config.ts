/**
 * Agent governance rules (pure, tested): which tools an agent may use, which
 * projects it may touch, and validation of agent definitions/config.
 */
import type { Department } from "@/lib/agents";

export type ToolInfo = { name: string; requiredScope: "read" | "write" };

export const DELEGATE_TOOL = "delegate_to_department";
export const KEY_RE = /^[a-z][a-z0-9-]{1,30}$/;
export const LIMITS = { name: 80, icon: 8, prompt: 4000, model: 100 } as const;

type Governance = Pick<Department, "enabled" | "allowed_tools" | "read_only">;

/** An agent is on unless explicitly disabled (rows from before migration 0033 have no flag). */
export const isEnabled = (d: Pick<Department, "enabled">) => d.enabled !== false;

/**
 * Whether `tool` is in this agent's toolset (before the run-mode allowlist is
 * applied). read_only wins over allowed_tools; the delegating tool is never available.
 */
export function toolAllowed(d: Governance, tool: ToolInfo): boolean {
  if (tool.name === DELEGATE_TOOL) return false;
  if (d.read_only && tool.requiredScope !== "read") return false;
  if (d.allowed_tools && !d.allowed_tools.includes(tool.name)) return false;
  return true;
}

/**
 * Project assignment guard. With no assignments the agent is unrestricted
 * (today's behaviour). With assignments, a call that names a project_id outside
 * the list is refused. Calls without a project_id (e.g. listing) are unaffected.
 */
export function projectAllowed(assigned: string[], args: unknown): { ok: true } | { ok: false; reason: string } {
  if (assigned.length === 0) return { ok: true };
  const id = (args as { project_id?: unknown } | null)?.project_id;
  if (typeof id !== "string") return { ok: true };
  return assigned.includes(id) ? { ok: true } : { ok: false, reason: "This agent is not assigned to that project." };
}

export type NewAgent = { key: string; name_en: string; name_ar: string; agent_name: string; icon: string; system_prompt: string; model: string | null };
type V<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export function validateNewAgent(input: unknown, existingKeys: string[]): V<NewAgent> {
  const o = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const s = (k: string) => (typeof o[k] === "string" ? (o[k] as string).trim() : "");
  const errors: string[] = [];
  const key = s("key").toLowerCase();
  if (!KEY_RE.test(key)) errors.push("Key: lowercase letters, digits and dashes, starting with a letter (2–31 characters).");
  else if (existingKeys.includes(key)) errors.push("An agent with this key already exists.");
  for (const [k, label] of [["name_en", "English name"], ["name_ar", "Arabic name"], ["agent_name", "Agent display name"]] as const) {
    if (!s(k)) errors.push(`${label} is required.`);
    else if (s(k).length > LIMITS.name) errors.push(`${label} is longer than ${LIMITS.name} characters.`);
  }
  const prompt = s("system_prompt");
  if (prompt.length > LIMITS.prompt) errors.push(`Instructions are longer than ${LIMITS.prompt} characters.`);
  const model = s("model");
  if (model.length > LIMITS.model) errors.push("Model name is too long.");
  const icon = s("icon") || "🤖";
  if ([...icon].length > LIMITS.icon) errors.push("Icon is too long.");
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { key, name_en: s("name_en"), name_ar: s("name_ar"), agent_name: s("agent_name"), icon, system_prompt: prompt, model: model || null } };
}

export type AgentConfig = { enabled: boolean; read_only: boolean; allowed_tools: string[] | null; project_ids: string[] };

/** `allowedTools: null` means "all tools". Unknown tool names and the delegating tool are rejected. */
export function validateConfig(input: unknown, knownTools: string[], ownedProjectIds: string[]): V<AgentConfig> {
  const o = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const errors: string[] = [];
  let allowed: string[] | null = null;
  if (o.allowed_tools !== null && o.allowed_tools !== undefined) {
    if (!Array.isArray(o.allowed_tools) || !o.allowed_tools.every((t) => typeof t === "string")) errors.push("Tools must be a list of names.");
    else {
      allowed = [...new Set(o.allowed_tools as string[])];
      for (const t of allowed) {
        if (t === DELEGATE_TOOL) errors.push("Agents cannot be given the delegation tool.");
        else if (!knownTools.includes(t)) errors.push(`Unknown tool "${t}".`);
      }
    }
  }
  const ids = Array.isArray(o.project_ids) ? [...new Set(o.project_ids.filter((x): x is string => typeof x === "string"))] : [];
  for (const id of ids) if (!ownedProjectIds.includes(id)) errors.push("A selected project was not found.");
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { enabled: o.enabled !== false, read_only: o.read_only === true, allowed_tools: allowed, project_ids: ids } };
}

/** Appended to the agent's instructions so it knows its own boundaries. */
export function scopeNote(assignedNames: string[], readOnly: boolean): string {
  const parts: string[] = [];
  if (assignedNames.length) parts.push(`You are assigned to these projects only: ${assignedNames.join(", ")}. Do not act on any other project.`);
  if (readOnly) parts.push("You are read-only: you can look things up but cannot change anything.");
  return parts.join(" ");
}
