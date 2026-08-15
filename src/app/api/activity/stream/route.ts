import { fetchLogs } from "@/lib/queries";
import { getSession } from "@/lib/session";
import { isOwnerEmail } from "@/lib/owners";
import type { AgentLog } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const POLL_MS = 3000;
const HEARTBEAT_MS = 25_000;

/**
 * Server-authenticated activity feed (SSE).
 *
 * Replaces the browser's direct Supabase Realtime subscription: that required
 * an anon SELECT policy on agent_logs, which exposed every payload and result
 * to anyone holding the publishable key. Here the service role reads on the
 * server and only the signed-in owner receives the stream.
 *
 * Sends rows whose id has not been seen yet, plus rows whose status changed
 * (a call starts `pending` and later flips to success/failed).
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session || !isOwnerEmail(session.user.email)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId") ?? undefined;
  const agentNames = url.searchParams.get("agents")?.split(",").filter(Boolean);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 100);
  // Newest row the client already holds. On reconnect it replays the gap.
  const since = url.searchParams.get("since") ?? undefined;

  const encoder = new TextEncoder();
  // id → status, so an update to an already-sent row is re-emitted once.
  const seen = new Map<string, string>();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      // Guards against two polls overlapping if one runs longer than POLL_MS.
      let polling = false;

      const poll = async () => {
        if (closed || polling) return;
        polling = true;
        try {
          const logs = await fetchLogs({ limit, projectId, agentNames });
          const fresh = logs.filter((log) => seen.get(log.id) !== log.status);
          for (const log of logs) seen.set(log.id, log.status);
          // Cap the memory of a long-lived stream.
          if (seen.size > 1000) {
            const keep = new Set(logs.map((l) => l.id));
            for (const id of seen.keys()) if (!keep.has(id)) seen.delete(id);
          }
          if (fresh.length) send("logs", fresh satisfies AgentLog[]);
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

      // Prime `seen` so the client is not re-sent rows it already has. `since`
      // is the newest row the client holds; on an EventSource reconnect it lets
      // the server replay anything created while the connection was down —
      // priming from the current window alone would silently skip those.
      try {
        for (const log of await fetchLogs({ limit, projectId, agentNames })) {
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
