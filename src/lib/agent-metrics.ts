/** Per-agent performance from real agent_runs rows (pure, tested). Tokens only: no cost is computed (prices vary and are not stored). */

export type RunRow = {
  agent_name: string; kind: string; status: string; tokens_in: number | null; tokens_out: number | null;
  duration_ms: number; step_count: number; created_at: string;
};

export type AgentMetrics = {
  runs: number; succeeded: number; failed: number; successRate: number | null;
  tokensIn: number; tokensOut: number; avgDurationMs: number | null; avgSteps: number | null; lastRunAt: string | null;
  byKind: Record<string, number>;
};

const empty = (): AgentMetrics => ({ runs: 0, succeeded: 0, failed: 0, successRate: null, tokensIn: 0, tokensOut: 0, avgDurationMs: null, avgSteps: null, lastRunAt: null, byKind: {} });

export function summariseAgents(rows: RunRow[]): Map<string, AgentMetrics> {
  const out = new Map<string, AgentMetrics>();
  const dur = new Map<string, number>();
  const steps = new Map<string, number>();
  for (const r of rows) {
    const m = out.get(r.agent_name) ?? empty();
    m.runs += 1;
    if (r.status === "success") m.succeeded += 1;
    else if (r.status === "failed") m.failed += 1;
    m.tokensIn += r.tokens_in ?? 0;
    m.tokensOut += r.tokens_out ?? 0;
    m.byKind[r.kind] = (m.byKind[r.kind] ?? 0) + 1;
    if (!m.lastRunAt || r.created_at > m.lastRunAt) m.lastRunAt = r.created_at;
    dur.set(r.agent_name, (dur.get(r.agent_name) ?? 0) + r.duration_ms);
    steps.set(r.agent_name, (steps.get(r.agent_name) ?? 0) + r.step_count);
    out.set(r.agent_name, m);
  }
  for (const [name, m] of out) {
    m.successRate = m.runs ? m.succeeded / m.runs : null;
    m.avgDurationMs = m.runs ? Math.round((dur.get(name) ?? 0) / m.runs) : null;
    m.avgSteps = m.runs ? Math.round(((steps.get(name) ?? 0) / m.runs) * 10) / 10 : null;
  }
  return out;
}

export const totalTokens = (m: AgentMetrics | undefined) => (m ? m.tokensIn + m.tokensOut : 0);

/** Share of the monthly budget used, or null when there is no budget. */
export function budgetUsed(used: number, budget: number | null | undefined): number | null {
  return budget && budget > 0 ? used / budget : null;
}
