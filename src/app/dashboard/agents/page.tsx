import { AgentsManager, type AgentView } from "@/components/agents-manager";
import { fetchAgentFailures, fetchAgentRuns, fetchAssignments } from "@/lib/agent-admin";
import { budgetUsed, summariseAgents, totalTokens } from "@/lib/agent-metrics";
import { agentsT } from "@/lib/agents-i18n";
import { getLocale } from "@/lib/locale-server";
import { TOOLS } from "@/lib/mcp/tools";
import { fetchDepartments, fetchProjectOptions } from "@/lib/queries";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Agent management. Read: any signed-in role. Every change is a server action
 * behind requireAdmin. All numbers come from the real run ledger and activity
 * log — an agent with no runs shows no rates, not zeros.
 */
export default async function AgentsPage() {
  const [locale, session] = await Promise.all([getLocale(), requireSession()]);
  const t = agentsT(locale);

  const [departments, projects, runs, assignments] = await Promise.all([
    fetchDepartments(), fetchProjectOptions(), fetchAgentRuns().catch(() => []), fetchAssignments(),
  ]);
  const failures = await fetchAgentFailures(departments.map((d) => d.agent_name)).catch(() => []);
  const metrics = summariseAgents(runs);

  const agents: AgentView[] = departments.map((d) => {
    const m = metrics.get(d.agent_name);
    const used = totalTokens(m);
    return {
      key: d.key, isCustom: Boolean(d.is_custom), isFallback: d.is_fallback, icon: d.icon,
      name: locale === "ar" ? d.name_ar : d.name_en, agentName: d.agent_name, model: d.model,
      enabled: d.enabled !== false, readOnly: Boolean(d.read_only), allowedTools: d.allowed_tools ?? null,
      projectIds: assignments.get(d.key) ?? [],
      budget: d.monthly_token_budget, tokensUsed: used, budgetShare: budgetUsed(used, d.monthly_token_budget),
      metrics: m ? { runs: m.runs, successRate: m.successRate, avgDurationMs: m.avgDurationMs, avgSteps: m.avgSteps, tokensIn: m.tokensIn, tokensOut: m.tokensOut, lastRunAt: m.lastRunAt, byKind: m.byKind } : null,
      failures: failures.filter((f) => f.agent_name === d.agent_name).slice(0, 5),
    };
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t.title}</h1>
        <p className="text-sm text-muted">{t.subtitle}</p>
      </header>
      <AgentsManager
        t={t} locale={locale} canEdit={session.role === "admin"} agents={agents}
        tools={TOOLS.filter((x) => x.name !== "delegate_to_department").map((x) => ({ name: x.name, scope: x.requiredScope }))}
        projects={projects}
      />
    </div>
  );
}
