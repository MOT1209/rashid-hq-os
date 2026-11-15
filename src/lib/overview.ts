import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAgentRuns } from "@/lib/agent-admin";
import { summariseAgents, totalTokens } from "@/lib/agent-metrics";
import { budgetState, configHealth, type Overview } from "@/lib/overview-core";
import { fetchDepartments } from "@/lib/queries";
import { socialSummary } from "@/lib/social/summary";
import { getServiceSupabase } from "@/lib/supabase/server";

const db = () => getServiceSupabase() as unknown as SupabaseClient;
const DAY = 24 * 3600_000;

/** Runs one card's queries; any failure (missing migration, outage) makes ONLY that card unavailable. */
async function card<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch {
    return null;
  }
}

async function count(q: PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  const r = await q;
  if (r.error) throw new Error("count failed");
  return r.count ?? 0;
}

export async function fetchOverview(ownerId: string): Promise<Overview> {
  const supabase = db();
  const since24 = new Date(Date.now() - DAY).toISOString();
  const today = new Date().toISOString().slice(0, 10);

  const dbCheck = async (): Promise<Overview["db"]> => {
    const t0 = Date.now();
    try {
      const { error } = await supabase.from("projects").select("id").limit(1);
      return { ok: !error, latencyMs: error ? null : Date.now() - t0 };
    } catch {
      return { ok: false, latencyMs: null };
    }
  };

  const [dbState, approvalsPending, integrations, mcp, agents, automations, social, tasks, activity] = await Promise.all([
    dbCheck(),
    card(() => count(supabase.from("tool_approvals").select("id", { count: "exact", head: true }).eq("status", "pending"))),
    card(async () => {
      const { data, error } = await supabase.from("integration_connections").select("status").eq("owner_id", ownerId).limit(200);
      if (error) throw error;
      const r = { connected: 0, error: 0, expired: 0, disconnected: 0 };
      for (const row of (data ?? []) as { status: keyof typeof r }[]) if (row.status in r) r[row.status] += 1;
      return r;
    }),
    card(async () => {
      const { data, error } = await supabase.from("project_tools").select("enabled, permission, last_test_ok").limit(1000);
      if (error) throw error;
      const rows = (data ?? []) as { enabled: boolean; permission: string; last_test_ok: boolean | null }[];
      return {
        tools: rows.length, enabled: rows.filter((r) => r.enabled).length, dangerous: rows.filter((r) => r.permission === "dangerous").length,
        testFailing: rows.filter((r) => r.enabled && r.last_test_ok === false).length,
      };
    }),
    card(async () => {
      const [departments, runs] = await Promise.all([fetchDepartments(), fetchAgentRuns(30)]);
      const recent = summariseAgents(runs.filter((r) => r.created_at >= since24));
      const month = summariseAgents(runs);
      let runs24h = 0, failed24h = 0, overBudget = 0, exhausted = 0;
      for (const d of departments) {
        const m = recent.get(d.agent_name);
        runs24h += m?.runs ?? 0;
        failed24h += m?.failed ?? 0;
        const state = budgetState(totalTokens(month.get(d.agent_name)), d.monthly_token_budget);
        if (state === "exhausted") exhausted += 1;
        else if (state === "high") overBudget += 1;
      }
      return { total: departments.length, enabled: departments.filter((d) => d.enabled !== false).length, runs24h, failed24h, overBudget, exhausted };
    }),
    card(async () => {
      const [auto, queued, running, failed] = await Promise.all([
        supabase.from("automations").select("name, enabled, trigger_type, next_run_at").eq("owner_id", ownerId).limit(200),
        count(supabase.from("automation_runs").select("id", { count: "exact", head: true }).eq("owner_id", ownerId).eq("status", "queued")),
        count(supabase.from("automation_runs").select("id", { count: "exact", head: true }).eq("owner_id", ownerId).eq("status", "running")),
        count(supabase.from("automation_runs").select("id", { count: "exact", head: true }).eq("owner_id", ownerId).eq("status", "failed").gte("created_at", since24)),
      ]);
      if (auto.error) throw auto.error;
      const rows = (auto.data ?? []) as { name: string; enabled: boolean; trigger_type: string; next_run_at: string | null }[];
      const next = rows.filter((r) => r.enabled && r.trigger_type === "schedule" && r.next_run_at).sort((a, b) => (a.next_run_at as string).localeCompare(b.next_run_at as string)).slice(0, 3).map((r) => ({ name: r.name, at: r.next_run_at as string }));
      return { active: rows.filter((r) => r.enabled).length, queued, running, failed24h: failed, next };
    }),
    card(async () => {
      const s = await socialSummary(ownerId);
      return { queued: s.queued, running: s.running, failed7d: s.failed7d, succeeded7d: s.succeeded7d, accounts: s.accounts, nextRunAt: s.nextRunAt };
    }),
    card(async () => {
      const [inProgress, overdue] = await Promise.all([
        count(supabase.from("project_tasks").select("id", { count: "exact", head: true }).eq("owner_id", ownerId).eq("status", "in_progress")),
        count(supabase.from("project_tasks").select("id", { count: "exact", head: true }).eq("owner_id", ownerId).neq("status", "done").lt("due_date", today)),
      ]);
      return { inProgress, overdue };
    }),
    card(async () => {
      const [failed, recent] = await Promise.all([
        count(supabase.from("agent_logs").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", since24)),
        supabase.from("agent_logs").select("id, agent_name, tool_name, created_at").eq("status", "failed").gte("created_at", since24).order("created_at", { ascending: false }).limit(5),
      ]);
      if (recent.error) throw recent.error;
      return {
        failed24h: failed,
        recentFailures: ((recent.data ?? []) as { id: string; agent_name: string | null; tool_name: string | null; created_at: string }[]).map((r) => ({ id: r.id, agent: r.agent_name, tool: r.tool_name, at: r.created_at })),
      };
    }),
  ]);

  return {
    db: dbState, approvalsPending, integrations, mcp, agents, automations, social, tasks, activity,
    health: configHealth(process.env, process.env.NODE_ENV === "production"),
  };
}
