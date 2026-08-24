import { fetchLogs, isUuid } from "@/lib/queries";
import { getSession } from "@/lib/session";
import { isOwnerEmail } from "@/lib/owners";
import type { AgentLog, LogStatus } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Each connected tab holds an invocation for this long before EventSource
 * reconnects. Kept well under the platform ceiling so a tab left open
 * overnight is a series of short-lived invocations, not one endless one.
 */
export const maxDuration = 120;

const POLL_MS = 8000;
const HEARTBEAT_MS = 25_000;

function isStatus(value: string | null): value is LogStatus {
  return value === "success" || value === "failed" || value === "pending";
}

/**
 * Server-authenticated activity feed (SSE).
 *
 * Replaces the browser's direct Supabase Realtime subscription: that required
 * an anon SELECT policy on agent_logs, which exposed every payload and result
 * to anyone holding the publishable key. Here the service role reads on the
 * server and only the signed-in owner receives the stream.
 *
 * Each poll asks for rows at or newer than the newest one already sent, rather
 * than re-reading the whole window — a quiet feed costs an empty result set
 * instead of `limit` rows including two unbounded jsonb columns.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session || !isOwnerEmail(session.user.email)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const projectIdParam = url.searchParams.get("projectId") ?? undefined;
  const agentNames = url.searchParams.get("agents")?.split(",").filter(Boolean);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 100);
  const statusParam = url.searchParams.get("status");
  // Newest row the client already holds. On reconnect it replays the gap.
  const since = url.searchParams.get("since") ?? undefined;

  // A junk project id filters to something that cannot exist; say so once
  // rather than letting every poll raise 22P02 into a swallowed catch.
  if (projectIdParam && !isUuid(projectIdParam)) {
    return new Response("Invalid projectId", { status: 400 });
  }

  // Filtering on the server matters: with client-side filtering a burst of
  // non-matching rows could fill the window and the live view would stop
  // updating while still showing "Live".
  const filters = {
    projectId: projectIdParam,
    agentNames,
    status: isStatus(statusParam) ? statusParam : undefined,
    slim: true as const,
  };

  const encoder = new TextEncoder();
  // id → status, so an update to an already-sent row is re-emitted once.
  const seen = new Map<string, string>();
  // Watermark for the next delta query.
  let watermark = since;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      const remember = (logs: AgentLog[]) => {
        for (const log of logs) {
          seen.set(log.id, log.status);
          if (!watermark || log.created_at > watermark) watermark = log.created_at;
        }
        // Cap the memory of a long-lived stream.
        if (seen.size > 2000) {
          const keep = [...seen.keys()].slice(-1000);
          const kept = new Set(keep);
          for (const id of seen.keys()) if (!kept.has(id)) seen.delete(id);
        }
      };

      // Guards against two polls overlapping if one runs longer than POLL_MS.
      let polling = false;

      const poll = async () => {
        if (closed || polling) return;
        polling = true;
        try {
          const logs = await fetchLogs({ ...filters, limit, since: watermark });
          const fresh = logs.filter((log) => seen.get(log.id) !== log.status);
          remember(logs);
          if (fresh.length) send("logs", fresh);
        } catch (error) {
          console.error("[activity-stream] poll failed:", error);
        } finally {
          polling = false;
        }
      };

      // Collected here so `stop` can clear them even when the client aborts
      // before they are created.
      const timers: ReturnType<typeof setInterval>[] = [];

      const stop = () => {
        if (closed) return;
        closed = true;
        for (const timer of timers) clearInterval(timer);
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      };

      // Registered before the first await: if the client disconnects during
      // priming the abort event has already fired by the time we get back, and
      // the timers below would poll Supabase forever on a dead connection.
      request.signal.addEventListener("abort", stop);

      // Prime `seen` so the client is not re-sent rows it already has. Rows
      // newer than `since` are deliberately left unseen: on an EventSource
      // reconnect they are the gap the client missed and must be replayed.
      try {
        for (const log of await fetchLogs({ ...filters, limit })) {
          if (since && log.created_at > since) continue;
          seen.set(log.id, log.status);
        }
      } catch (error) {
        console.error("[activity-stream] priming failed:", error);
      }
      if (request.signal.aborted) return stop();
      send("ready", { ok: true });
      void poll();

      timers.push(setInterval(poll, POLL_MS));
      // Comment frames keep proxies from closing an idle connection.
      timers.push(
        setInterval(() => {
          if (!closed) controller.enqueue(encoder.encode(": keepalive\n\n"));
        }, HEARTBEAT_MS),
      );
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
