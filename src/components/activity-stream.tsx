"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale } from "@/components/providers";
import { EmptyState, StatusLed } from "@/components/ui";
import type { AgentLog, LogStatus } from "@/types/database";

type Props = {
  initialLogs: AgentLog[];
  projectNames: Record<string, string>;
  /** Restrict the feed to one project or one agent (department views). */
  projectId?: string;
  agentNames?: string[];
  limit?: number;
  compact?: boolean;
};

/**
 * Subscribes to /api/activity/stream (SSE). New rows prepend, rows already in
 * the list are patched in place (a call starts `pending` and later flips to
 * success/failed). The stream is authenticated server-side — the browser holds
 * no database credentials.
 */
export function ActivityStream({
  initialLogs,
  projectNames,
  projectId,
  agentNames,
  limit = 50,
  compact = false,
}: Props) {
  const { t, locale } = useLocale();
  const [logs, setLogs] = useState<AgentLog[]>(initialLogs);
  const [connected, setConnected] = useState(false);

  const agentFilter = useMemo(() => agentNames?.join("|"), [agentNames]);

  useEffect(() => {
    const allowedAgents = agentFilter ? agentFilter.split("|") : null;

    const matches = (log: AgentLog) => {
      if (projectId && log.project_id !== projectId) return false;
      if (allowedAgents && !allowedAgents.includes(log.agent_name ?? "")) return false;
      return true;
    };

    const params = new URLSearchParams({ limit: String(limit) });
    if (projectId) params.set("projectId", projectId);
    if (allowedAgents) params.set("agents", allowedAgents.join(","));

    const source = new EventSource(`/api/activity/stream?${params}`);

    source.addEventListener("ready", () => setConnected(true));
    source.addEventListener("logs", (event) => {
      const incoming = (JSON.parse((event as MessageEvent).data) as AgentLog[])
        .filter(matches);
      if (incoming.length === 0) return;

      setLogs((prev) => {
        const byId = new Map(prev.map((log) => [log.id, log]));
        for (const log of incoming) byId.set(log.id, log);
        return [...byId.values()]
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .slice(0, limit);
      });
    });
    source.onerror = () => setConnected(false);

    return () => {
      setConnected(false);
      source.close();
    };
  }, [projectId, agentFilter, limit]);

  const statusLabel: Record<LogStatus, string> = {
    success: t.success,
    failed: t.failed,
    pending: t.pending,
  };

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-xs text-muted">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            connected ? "bg-ok" : "bg-warn led-pending"
          }`}
        />
        {connected ? t.live : t.connecting}
      </div>

      {logs.length === 0 ? (
        <EmptyState>{t.noLogs}</EmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {logs.map((log) => (
            <li key={log.id} className="flex items-start gap-3 py-3">
              <span className="mt-1.5">
                <StatusLed status={log.status} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="font-medium">{log.agent_name ?? "—"}</span>
                  <span className="text-muted">→</span>
                  <code className="rounded bg-panel-2 px-1.5 py-0.5 text-xs text-accent">
                    {log.tool_name ?? "—"}
                  </code>
                  {log.project_id && projectNames[log.project_id] && (
                    <span className="text-xs text-muted">
                      · {projectNames[log.project_id]}
                    </span>
                  )}
                </p>
                {!compact && log.result != null && (
                  <pre className="mt-1 max-h-24 overflow-auto rounded bg-panel-2 p-2 text-[11px] text-muted">
                    {JSON.stringify(log.result).slice(0, 400)}
                  </pre>
                )}
              </div>
              <div className="shrink-0 text-end text-xs text-muted">
                <div>{statusLabel[log.status]}</div>
                <time dateTime={log.created_at}>
                  {new Date(log.created_at).toLocaleTimeString(
                    locale === "ar" ? "ar-EG" : "en-GB",
                  )}
                </time>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
