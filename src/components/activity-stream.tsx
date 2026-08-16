"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "@/components/providers";
import { EmptyState, StatusLed } from "@/components/ui";
import type { AgentLog, LogStatus } from "@/types/database";

type Props = {
  initialLogs: AgentLog[];
  projectNames: Record<string, string>;
  /** Restrict the feed to one project or one agent (department views). */
  projectId?: string;
  agentNames?: string[];
  status?: LogStatus;
  limit?: number;
  compact?: boolean;
  /** Show the "load more" button — the full activity page only. */
  paginated?: boolean;
  /** True when the first page came back full, i.e. older rows may exist. */
  initialHasMore?: boolean;
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
  status,
  limit = 50,
  compact = false,
  paginated = false,
  initialHasMore = false,
}: Props) {
  const { t, locale } = useLocale();
  const [logs, setLogs] = useState<AgentLog[]>(initialLogs);
  const [connected, setConnected] = useState(false);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);

  const agentFilter = useMemo(() => agentNames?.join("|"), [agentNames]);

  // Newest row currently held, kept in a ref so it never re-runs the
  // subscription effect. Written from an effect, not during render.
  const newestRef = useRef(initialLogs[0]?.created_at);
  useEffect(() => {
    newestRef.current = logs[0]?.created_at ?? newestRef.current;
  }, [logs]);

  // A revalidation re-renders with fresh server rows; adopt them rather than
  // keeping the stale client list. Adjusting state during render is React's
  // documented pattern for this — an effect would cause a cascading render.
  const [seenInitial, setSeenInitial] = useState(initialLogs);
  if (seenInitial !== initialLogs) {
    setSeenInitial(initialLogs);
    setLogs(initialLogs);
    setHasMore(initialHasMore);
  }

  useEffect(() => {
    const allowedAgents = agentFilter ? agentFilter.split("|") : null;

    // The server applies these too; this is a second line of defence against a
    // stale connection delivering rows from a filter that has since changed.
    const matches = (log: AgentLog) => {
      if (projectId && log.project_id !== projectId) return false;
      if (status && log.status !== status) return false;
      if (allowedAgents && !allowedAgents.includes(log.agent_name ?? "")) return false;
      return true;
    };

    let source: EventSource | null = null;

    const open = () => {
      if (source) return;
      const params = new URLSearchParams({ limit: String(limit) });
      if (projectId) params.set("projectId", projectId);
      if (allowedAgents) params.set("agents", allowedAgents.join(","));
      if (status) params.set("status", status);
      // Newest row we already have, read through a ref so a server revalidation
      // does not tear down the connection. EventSource reconnects on any blip,
      // and without `since` the server would treat rows created meanwhile as
      // already delivered and the feed would silently skip them.
      const newest = newestRef.current;
      if (newest) params.set("since", newest);

      source = new EventSource(`/api/activity/stream?${params}`);
      attach(source);
    };

    const close = () => {
      source?.close();
      source = null;
      setConnected(false);
    };

    // A hidden tab is not being read, and every open tab holds a server
    // invocation polling the database. Drop the connection while the tab is in
    // the background and reopen on return — `since` replays whatever was missed.
    const onVisibility = () => {
      if (document.visibilityState === "hidden") close();
      else open();
    };

    function attach(es: EventSource) {
      es.addEventListener("ready", () => setConnected(true));
      es.addEventListener("logs", (event) => {
        const incoming = (JSON.parse((event as MessageEvent).data) as AgentLog[])
          .filter(matches);
        if (incoming.length === 0) return;

        setLogs((prev) => {
          const byId = new Map(prev.map((log) => [log.id, log]));
          // A slim row from the live feed must not wipe the payload a full row
          // already carried; merge rather than replace.
          for (const log of incoming) {
            const existing = byId.get(log.id);
            byId.set(log.id, existing ? { ...existing, ...log } : log);
          }
          return [...byId.values()].sort((a, b) =>
            b.created_at.localeCompare(a.created_at),
          );
        });
      });
      es.onerror = () => setConnected(false);
    }

    if (document.visibilityState !== "hidden") open();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      close();
    };
  }, [projectId, agentFilter, status, limit]);

  const loadMore = async () => {
    const oldest = logs[logs.length - 1];
    if (!oldest || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ before: oldest.created_at });
      if (projectId) params.set("projectId", projectId);
      if (agentFilter) params.set("agents", agentFilter.split("|").join(","));
      if (status) params.set("status", status);

      const response = await fetch(`/api/activity/page?${params}`);
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { logs: AgentLog[]; hasMore: boolean };

      setLogs((prev) => {
        const byId = new Map(prev.map((log) => [log.id, log]));
        for (const log of data.logs) byId.set(log.id, log);
        return [...byId.values()].sort((a, b) =>
          b.created_at.localeCompare(a.created_at),
        );
      });
      setHasMore(data.hasMore);
    } catch (error) {
      console.error("[activity] load more failed:", error);
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  };

  const statusLabel: Record<LogStatus, string> = {
    success: t.success,
    failed: t.failed,
    pending: t.pending,
  };

  // The dashboard panel is a fixed-height preview; the full page is unbounded.
  const visible = paginated ? logs : logs.slice(0, limit);

  return (
    <div>
      <p className="mb-3 flex items-center gap-2 text-xs text-muted" aria-live="polite">
        <span
          aria-hidden
          className={`inline-block h-2 w-2 rounded-full ${
            connected ? "bg-ok" : "bg-warn led-pending"
          }`}
        />
        {connected ? t.live : t.connecting}
      </p>

      {visible.length === 0 ? (
        <EmptyState>{t.noLogs}</EmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {visible.map((log) => (
            <li key={log.id} className="flex items-start gap-3 py-3">
              <span className="mt-1.5">
                <StatusLed status={log.status} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="font-medium">{log.agent_name ?? "—"}</span>
                  <span className="text-muted" aria-hidden>
                    {locale === "ar" ? "←" : "→"}
                  </span>
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
                <time dateTime={log.created_at} suppressHydrationWarning>
                  {new Date(log.created_at).toLocaleTimeString(locale)}
                </time>
              </div>
            </li>
          ))}
        </ul>
      )}

      {paginated && visible.length > 0 && (
        <div className="mt-4 text-center">
          {hasMore ? (
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="rounded-xl border border-border px-4 py-2 text-sm text-muted hover:border-accent/50 hover:text-text disabled:opacity-40"
            >
              {loadingMore ? t.loading : t.loadMore}
            </button>
          ) : (
            <p className="text-xs text-muted">{t.noMore}</p>
          )}
        </div>
      )}
    </div>
  );
}
