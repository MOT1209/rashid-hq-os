/**
 * CEO dashboard rules (pure, tested). Inputs are plain numbers/flags read from
 * the real database elsewhere; nothing here is estimated, and a card whose data
 * could not be loaded is `null` and is shown as unavailable, never as zero.
 */

export type Level = "ok" | "info" | "warn" | "err";

export type HealthItem = { id: string; level: Level };

/**
 * Configuration health. Only booleans/levels leave this function: no value of
 * any variable is ever returned (these are secrets).
 */
export function configHealth(env: Record<string, string | undefined>, production: boolean): HealthItem[] {
  const set = (k: string, min = 1) => (env[k] ?? "").trim().length >= min;
  return [
    { id: "auth_secret", level: set("BETTER_AUTH_SECRET", 32) ? "ok" : "err" },
    { id: "encryption", level: set("INTEGRATIONS_SECRET", 16) ? "ok" : "err" },
    { id: "owner_emails", level: set("OWNER_EMAILS") ? "ok" : "err" },
    { id: "model", level: set("GROQ_API_KEY") ? "ok" : "warn" },
    { id: "two_factor_policy", level: set("REQUIRE_2FA") ? "ok" : "warn" },
    { id: "cron_secret", level: set("CRON_SECRET", 16) ? "ok" : "warn" },
    { id: "rate_limit_store", level: set("KV_REST_API_URL") && set("KV_REST_API_TOKEN") ? "ok" : production ? "err" : "warn" },
    { id: "email", level: set("RESEND_API_KEY") ? "ok" : "warn" },
    { id: "error_tracking", level: set("SENTRY_DSN") ? "ok" : "info" },
  ];
}

export type Overview = {
  db: { ok: boolean; latencyMs: number | null };
  approvalsPending: number | null;
  integrations: { connected: number; error: number; expired: number; disconnected: number } | null;
  mcp: { tools: number; enabled: number; dangerous: number; testFailing: number } | null;
  agents: { total: number; enabled: number; runs24h: number; failed24h: number; overBudget: number; exhausted: number } | null;
  automations: { active: number; queued: number; running: number; failed24h: number; next: { name: string; at: string }[] } | null;
  social: { queued: number; running: number; failed7d: number; succeeded7d: number; accounts: number; nextRunAt: string | null } | null;
  tasks: { inProgress: number; overdue: number } | null;
  activity: { failed24h: number; recentFailures: { id: string; agent: string | null; tool: string | null; at: string }[] } | null;
  health: HealthItem[];
};

export type Warning = { id: string; level: "warn" | "err"; count?: number; href: string };

/** Everything the owner should look at, most severe first. Cards that failed to load contribute nothing. */
export function deriveWarnings(o: Overview): Warning[] {
  const w: Warning[] = [];
  const add = (x: Warning) => w.push(x);
  if (!o.db.ok) add({ id: "db_down", level: "err", href: "/dashboard/settings" });
  for (const h of o.health) if (h.level === "err") add({ id: `config_${h.id}`, level: "err", href: "/dashboard/settings" });
  if (o.agents && o.agents.exhausted > 0) add({ id: "budget_exhausted", level: "err", count: o.agents.exhausted, href: "/dashboard/agents" });
  if (o.integrations && o.integrations.error + o.integrations.expired > 0) add({ id: "integrations_broken", level: "warn", count: o.integrations.error + o.integrations.expired, href: "/dashboard/settings/integrations" });
  if (o.approvalsPending) add({ id: "approvals_pending", level: "warn", count: o.approvalsPending, href: "/dashboard/access" });
  if (o.activity && o.activity.failed24h > 0) add({ id: "failed_calls", level: "warn", count: o.activity.failed24h, href: "/dashboard/activity" });
  if (o.agents && o.agents.failed24h > 0) add({ id: "agent_runs_failed", level: "warn", count: o.agents.failed24h, href: "/dashboard/agents" });
  if (o.agents && o.agents.overBudget > 0) add({ id: "budget_high", level: "warn", count: o.agents.overBudget, href: "/dashboard/agents" });
  if (o.automations && o.automations.failed24h > 0) add({ id: "automations_failed", level: "warn", count: o.automations.failed24h, href: "/dashboard/automations" });
  if (o.social && o.social.failed7d > 0) add({ id: "social_failed", level: "warn", count: o.social.failed7d, href: "/dashboard/social-studio?tab=history" });
  if (o.mcp && o.mcp.testFailing > 0) add({ id: "mcp_tests_failing", level: "warn", count: o.mcp.testFailing, href: "/dashboard/mcp" });
  if (o.tasks && o.tasks.overdue > 0) add({ id: "tasks_overdue", level: "warn", count: o.tasks.overdue, href: "/dashboard/projects" });
  for (const h of o.health) if (h.level === "warn") add({ id: `config_${h.id}`, level: "warn", href: "/dashboard/settings" });
  const rank = { err: 0, warn: 1 } as const;
  return w.sort((a, b) => rank[a.level] - rank[b.level]);
}

/** Budget share thresholds used for the agent warnings: ≥ 80% is "high", ≥ 100% is "exhausted". */
export function budgetState(used: number, budget: number | null | undefined): "none" | "ok" | "high" | "exhausted" {
  if (!budget || budget <= 0) return "none";
  const r = used / budget;
  return r >= 1 ? "exhausted" : r >= 0.8 ? "high" : "ok";
}
