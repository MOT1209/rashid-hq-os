/** Aggregates call_project_tool activity rows per (project, tool). Pure. */

export type CallRow = {
  project_id: string | null;
  status: string;
  decision: string | null;
  created_at: string;
  payload: unknown;
  result?: unknown;
};

export type ToolStats = {
  calls: number;
  succeeded: number;
  failed: number;
  denied: number;
  awaitingApproval: number;
  lastCallAt: string | null;
  recent: { at: string; status: string; error: string | null }[];
};

const keyOf = (projectId: string, tool: string) => `${projectId}::${tool}`;

export function toolNameOf(payload: unknown): string | null {
  const t = (payload as { tool_name?: unknown } | null)?.tool_name;
  return typeof t === "string" ? t : null;
}

function errorOf(result: unknown): string | null {
  const e = (result as { error?: unknown } | null)?.error;
  return typeof e === "string" ? e.slice(0, 200) : null;
}

export function summariseCalls(rows: CallRow[], recentPerTool = 5): Map<string, ToolStats> {
  const out = new Map<string, ToolStats>();
  for (const r of [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    const tool = toolNameOf(r.payload);
    if (!r.project_id || !tool) continue;
    const k = keyOf(r.project_id, tool);
    const s = out.get(k) ?? { calls: 0, succeeded: 0, failed: 0, denied: 0, awaitingApproval: 0, lastCallAt: null, recent: [] };
    s.calls += 1;
    if (r.decision === "deny") s.denied += 1;
    else if (r.status === "awaiting_approval") s.awaitingApproval += 1;
    else if (r.status === "success") s.succeeded += 1;
    else if (r.status === "failed") s.failed += 1;
    s.lastCallAt ??= r.created_at;
    if (s.recent.length < recentPerTool) s.recent.push({ at: r.created_at, status: r.decision === "deny" ? "denied" : r.status, error: r.status === "failed" ? errorOf(r.result) : null });
    out.set(k, s);
  }
  return out;
}

export const statsKey = keyOf;

/** Failure rate over calls that actually executed (success + failed). */
export function failureRate(s: ToolStats | undefined): number | null {
  if (!s) return null;
  const ran = s.succeeded + s.failed;
  return ran === 0 ? null : s.failed / ran;
}
