import "server-only";

import { generateText, stepCountIs, tool, type ToolSet } from "ai";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { recordAgentRun } from "@/lib/agent-run";
import { captureError } from "@/lib/errors";
import { languageModel, modelConfigured } from "@/lib/model";
import { getServiceSupabase } from "@/lib/supabase/server";
import { dailyRunLimit } from "@/lib/social/ai";
import {
  AGENTS, allowedTools, effectivePermissions, type AgentKey, type Permission, type ToolId,
} from "@/lib/social/agents-core";
import { listSnapshots } from "@/lib/social/analytics";
import { db, getContentBundle, listAssets, listContent, listJobs } from "@/lib/social/store";
import { validateContent } from "@/lib/social/validate-content";
import { isPlatform } from "@/lib/social/providers";
import { parseHashtags } from "@/lib/social/validation";

/**
 * Social agent runtime. Tools are real (they read and write Social Studio
 * data) but every one is owner-scoped, permission-gated, and audited. There is
 * deliberately NO tool that schedules, publishes, deletes content or touches
 * accounts. Drafts written by an agent are flagged ai_generated.
 */

export const AGENT_PREFIX = "Social Studio AI";
const MAX_STEPS = 6;

/** Data operations the tools use; injectable so permission/tool behaviour is unit-tested without a database. */
export type Ops = {
  listContent(owner: string): Promise<unknown>;
  getContent(owner: string, id: string): Promise<unknown>;
  listMedia(owner: string): Promise<unknown>;
  listJobs(owner: string): Promise<unknown>;
  validate(owner: string, id: string): Promise<unknown>;
  analytics(owner: string): Promise<unknown>;
  createDraft(owner: string, d: { title: string; description?: string; caption?: string; hashtags?: string[]; language?: string }): Promise<unknown>;
  updateDraft(owner: string, id: string, d: Record<string, unknown>): Promise<unknown>;
  setVariant(owner: string, id: string, platform: string, d: { title?: string; caption?: string; hashtags?: string[] }): Promise<unknown>;
  tagMedia(owner: string, id: string, d: { tags?: string[]; category?: string }): Promise<unknown>;
};

const trim = (s: string | undefined, n: number) => (s ?? "").slice(0, n);

export const realOps: Ops = {
  async listContent(owner) {
    return (await listContent(owner)).slice(0, 30).map((c) => ({ id: c.id, title: c.title, status: c.status, language: c.language, aiGenerated: c.ai_generated }));
  },
  async getContent(owner, id) {
    const b = await getContentBundle(owner, id);
    return b ? { content: { id: b.content.id, title: b.content.title, description: b.content.description, caption: b.content.caption, hashtags: b.content.hashtags, language: b.content.language }, variants: b.variants.map((v) => ({ platform: v.platform, title: v.title, caption: v.caption, hashtags: v.hashtags })) } : { error: "Not found." };
  },
  async listMedia(owner) {
    return (await listAssets(owner)).slice(0, 50).map((a) => ({ id: a.id, name: a.name, kind: a.kind, mime: a.mime_type, tags: a.tags, category: a.category }));
  },
  async listJobs(owner) {
    return (await listJobs(owner, { limit: 30 })).map((j) => ({ id: j.id, platform: j.platform, status: j.status, runAt: j.run_at, attempts: j.attempts, error: j.last_error, externalUrl: j.external_url }));
  },
  async validate(owner, id) {
    return (await validateContent(owner, id)) ?? { error: "Not found." };
  },
  async analytics(owner) {
    return (await listSnapshots(owner, 3)).map((j) => ({ platform: j.platform, id: j.external_id, snapshots: j.snapshots.map((s) => ({ at: s.retrieved_at, metrics: s.metrics, unsupported: s.unsupported, error: s.error })) }));
  },
  async createDraft(owner, d) {
    const { data, error } = await db().from("social_content").insert({
      owner_id: owner, title: trim(d.title, 200), description: trim(d.description, 5000), caption: trim(d.caption, 5000),
      hashtags: (d.hashtags ?? []).slice(0, 30), language: d.language === "en" ? "en" : "ar", ai_generated: true,
    }).select("id").single();
    return error ? { error: "Could not save the draft." } : { id: data.id, status: "draft" };
  },
  async updateDraft(owner, id, d) {
    const patch: Record<string, unknown> = { ai_generated: true, updated_at: new Date().toISOString() };
    if (typeof d.title === "string") patch.title = trim(d.title, 200);
    if (typeof d.description === "string") patch.description = trim(d.description, 5000);
    if (typeof d.caption === "string") patch.caption = trim(d.caption, 5000);
    if (Array.isArray(d.hashtags)) patch.hashtags = (d.hashtags as string[]).slice(0, 30);
    const { data } = await db().from("social_content").update(patch).eq("id", id).eq("owner_id", owner).eq("status", "draft").select("id");
    return data?.length ? { id, updated: true } : { error: "Draft not found (only drafts can be edited)." };
  },
  async setVariant(owner, id, platform, d) {
    if (!isPlatform(platform)) return { error: "Unknown platform." };
    const { data: c } = await db().from("social_content").select("id").eq("id", id).eq("owner_id", owner).eq("status", "draft").maybeSingle();
    if (!c) return { error: "Draft not found (only drafts can be edited)." };
    const { error } = await db().from("social_content_variants").upsert(
      { content_id: id, platform, title: d.title ? trim(d.title, 200) : null, caption: d.caption ? trim(d.caption, 5000) : null, hashtags: d.hashtags ?? null, updated_at: new Date().toISOString() },
      { onConflict: "content_id,platform" },
    );
    if (!error) await db().from("social_content").update({ ai_generated: true }).eq("id", id).eq("owner_id", owner);
    return error ? { error: "Could not save the version." } : { id, platform, saved: true };
  },
  async tagMedia(owner, id, d) {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (d.tags) patch.tags = d.tags.map((t) => t.toLowerCase().slice(0, 40)).slice(0, 20);
    if (d.category) patch.category = d.category.slice(0, 60);
    const { data } = await db().from("social_media_assets").update(patch).eq("id", id).eq("owner_id", owner).select("id");
    return data?.length ? { id, tagged: true } : { error: "Media not found." };
  },
};

const WRITE_TOOLS = new Set<ToolId>(["create_draft", "update_draft", "set_variant", "tag_media"]);

/** Builds the AI-SDK toolset for an agent: only tools its effective permissions allow, each audited when it writes. */
export function buildTools(
  agent: AgentKey,
  perms: Permission[],
  owner: string,
  ops: Ops,
  audit: (tool: string, args: unknown) => Promise<void> = async () => {},
): ToolSet {
  const defs: Record<ToolId, ToolSet[string]> = {
    list_content: tool({ description: "List the owner's content items (id, title, status).", inputSchema: z.object({}), execute: () => ops.listContent(owner) }),
    get_content: tool({ description: "Get one content item with its platform versions.", inputSchema: z.object({ id: z.string() }), execute: ({ id }) => ops.getContent(owner, id) }),
    list_media: tool({ description: "List media files (id, name, kind, tags, category).", inputSchema: z.object({}), execute: () => ops.listMedia(owner) }),
    list_jobs: tool({ description: "List recent publishing jobs and their statuses (read-only).", inputSchema: z.object({}), execute: () => ops.listJobs(owner) }),
    validate_content: tool({ description: "Validate a content item against each platform's requirements.", inputSchema: z.object({ id: z.string() }), execute: ({ id }) => ops.validate(owner, id) }),
    read_analytics: tool({ description: "Read stored analytics snapshots (real API metrics only; 'unsupported' lists what is unavailable).", inputSchema: z.object({}), execute: () => ops.analytics(owner) }),
    create_draft: tool({
      description: "Save a NEW draft (never published automatically).",
      inputSchema: z.object({ title: z.string().max(200), description: z.string().optional(), caption: z.string().optional(), hashtags: z.array(z.string()).optional(), language: z.enum(["ar", "en"]).optional() }),
      execute: async (a) => { await audit("create_draft", a); return ops.createDraft(owner, { ...a, hashtags: a.hashtags ? parseHashtags(a.hashtags.join(" ")) : undefined }); },
    }),
    update_draft: tool({
      description: "Update fields of an existing DRAFT.",
      inputSchema: z.object({ id: z.string(), title: z.string().optional(), description: z.string().optional(), caption: z.string().optional(), hashtags: z.array(z.string()).optional() }),
      execute: async ({ id, ...rest }) => { await audit("update_draft", { id }); return ops.updateDraft(owner, id, { ...rest, hashtags: rest.hashtags ? parseHashtags(rest.hashtags.join(" ")) : undefined }); },
    }),
    set_variant: tool({
      description: "Set the platform-specific title/caption/hashtags of a DRAFT.",
      inputSchema: z.object({ id: z.string(), platform: z.enum(["youtube", "facebook", "instagram", "tiktok"]), title: z.string().optional(), caption: z.string().optional(), hashtags: z.array(z.string()).optional() }),
      execute: async ({ id, platform, ...rest }) => { await audit("set_variant", { id, platform }); return ops.setVariant(owner, id, platform, { ...rest, hashtags: rest.hashtags ? parseHashtags(rest.hashtags.join(" ")) : undefined }); },
    }),
    tag_media: tool({
      description: "Set tags and/or a category on a media file.",
      inputSchema: z.object({ id: z.string(), tags: z.array(z.string()).optional(), category: z.string().optional() }),
      execute: async ({ id, ...rest }) => { await audit("tag_media", { id }); return ops.tagMedia(owner, id, rest); },
    }),
  };
  const out: ToolSet = {};
  for (const id of allowedTools(agent, perms)) out[id] = defs[id];
  return out;
}

export type AgentSettings = { enabled: boolean; permissions: Permission[] };

export async function getAgentSettings(owner: string, agent: AgentKey): Promise<AgentSettings> {
  const { data } = await db().from("social_agent_settings").select("enabled, permissions").eq("owner_id", owner).eq("agent_key", agent).maybeSingle();
  return { enabled: data ? data.enabled !== false : true, permissions: effectivePermissions(agent, data ? (data.permissions as string[]) : null) };
}

export async function saveAgentSettings(owner: string, agent: AgentKey, enabled: boolean, requested: string[]): Promise<AgentSettings> {
  const permissions = effectivePermissions(agent, requested); // clamps to max, strips owner-only
  const { error } = await db().from("social_agent_settings").upsert(
    { owner_id: owner, agent_key: agent, enabled, permissions, updated_at: new Date().toISOString() },
    { onConflict: "owner_id,agent_key" },
  );
  if (error) throw new Error("Could not save the agent settings.");
  return { enabled, permissions };
}

export type AgentRunResult =
  | { ok: true; text: string; actions: { tool: string; args: unknown }[]; tokens: number | null }
  | { ok: false; error: string };

async function usedToday(): Promise<number> {
  const { count, error } = await getServiceSupabase()
    .from("agent_runs").select("id", { count: "exact", head: true })
    .like("agent_name", `${AGENT_PREFIX}%`).gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString());
  if (error) throw error;
  return count ?? 0;
}

export async function runSocialAgent(
  agent: AgentKey,
  instruction: string,
  owner: string,
  deps: { generate?: typeof generateText; ops?: Ops; settings?: AgentSettings; count?: () => Promise<number>; record?: typeof recordAgentRun } = {},
): Promise<AgentRunResult> {
  if (!instruction.trim()) return { ok: false, error: "Write an instruction first." };
  if (!modelConfigured()) return { ok: false, error: "No AI model is configured (set GROQ_API_KEY)." };
  const settings = deps.settings ?? (await getAgentSettings(owner, agent));
  if (!settings.enabled) return { ok: false, error: "This agent is disabled." };
  try {
    if ((await (deps.count ?? usedToday)()) >= dailyRunLimit()) return { ok: false, error: "Daily AI limit reached. Raise SOCIAL_AI_DAILY_RUNS or try tomorrow." };
  } catch (e) {
    captureError("social-agent:count", e);
  }

  const name = `${AGENT_PREFIX} · ${agent}`;
  const record = deps.record ?? recordAgentRun;
  const tools = buildTools(agent, settings.permissions, owner, deps.ops ?? realOps, async (toolName, args) => {
    await logActivity({ agentName: name, toolName: `social.agent.${toolName}`, status: "success", payload: args as never }).catch(() => undefined);
  });
  const startedAt = Date.now();
  try {
    const result = await (deps.generate ?? generateText)({
      model: languageModel(),
      system: AGENTS[agent].prompt,
      prompt: `<request>\n${instruction.slice(0, 4000)}\n</request>`,
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
      maxOutputTokens: 1200,
    });
    await record({
      agentName: name, kind: "social_assist", tokensIn: result.usage.inputTokens ?? null, tokensOut: result.usage.outputTokens ?? null,
      durationMs: Date.now() - startedAt, stepCount: result.steps.length, status: "success",
    });
    const actions = result.steps.flatMap((s) => s.toolCalls.filter((c) => WRITE_TOOLS.has(c.toolName as ToolId)).map((c) => ({ tool: c.toolName, args: c.input })));
    return { ok: true, text: result.text.trim() || "(no text returned)", actions, tokens: (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0) || null };
  } catch (e) {
    captureError("social-agent:run", e);
    await record({ agentName: name, kind: "social_assist", durationMs: Date.now() - startedAt, stepCount: 0, status: "failed" });
    return { ok: false, error: "The agent run failed. Try again in a moment." };
  }
}
