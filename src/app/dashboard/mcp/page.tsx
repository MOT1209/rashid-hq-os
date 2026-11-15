import { McpManager, type ServerView } from "@/components/mcp-manager";
import { getLocale } from "@/lib/locale-server";
import { hasMcpTokens } from "@/lib/mcp/credentials";
import { mcpT } from "@/lib/mcp/i18n";
import { fetchToolCallRows } from "@/lib/mcp/history";
import { failureRate, statsKey, summariseCalls } from "@/lib/mcp/stats";
import { fetchProjects, fetchProjectTools } from "@/lib/queries";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * MCP management: every project server and its registered tools with the
 * per-tool permission policy (migration 0028), last test result, and 7-day
 * execution history from the real activity log. Read for any signed-in role;
 * every change is a server action behind requireAdmin.
 */
export default async function McpPage() {
  const [locale, session] = await Promise.all([getLocale(), requireSession()]);
  const t = mcpT(locale);

  const [projects, tools, logs] = await Promise.all([fetchProjects(), fetchProjectTools(), fetchToolCallRows()]);
  const stats = summariseCalls(logs);
  const relevant = projects.filter((p) => p.mcp_endpoint || tools.some((x) => x.project_id === p.id));
  const tokens = await hasMcpTokens(relevant.map((p) => p.id)).catch(() => new Set<string>());

  const servers: ServerView[] = relevant.map((p) => ({
    id: p.id,
    name: p.name,
    endpoint: p.mcp_endpoint,
    protocol: p.mcp_protocol === "mcp" ? "mcp" : "hq",
    hasToken: tokens.has(p.id),
    tools: tools
      .filter((x) => x.project_id === p.id)
      .map((x) => {
        const s = stats.get(statsKey(p.id, x.tool_name));
        return {
          id: x.id,
          name: x.tool_name,
          description: x.description,
          // Rows from before migration 0028 have neither column: they behave as enabled, write-class.
          enabled: x.enabled !== false,
          permission: x.permission ?? "write",
          requiresApproval: x.requires_approval,
          lastTestedAt: x.last_tested_at,
          lastTestOk: x.last_test_ok,
          lastTestError: x.last_test_error,
          lastLatencyMs: x.last_latency_ms,
          calls: s?.calls ?? 0,
          denied: s?.denied ?? 0,
          awaiting: s?.awaitingApproval ?? 0,
          failureRate: failureRate(s),
          recent: s?.recent ?? [],
          projectId: p.id,
        };
      }),
  }));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t.title}</h1>
        <p className="text-sm text-muted">{t.subtitle}</p>
      </header>
      <McpManager t={t} servers={servers} canEdit={session.role === "admin"} locale={locale} />
    </div>
  );
}
