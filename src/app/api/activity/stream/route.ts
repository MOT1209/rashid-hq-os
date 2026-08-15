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

      const poll = async () => {
        if (closed) return;
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
        }
      };

      // Prime `seen` from the current window so the client is not re-sent the
      // rows its server render already contains.
      try {
        for (const log of await fetchLogs({ limit, projectId, agentNames })) {
          seen.set(log.id, log.status);
        }
      } catch (error) {
        console.error("[activity-stream] priming failed:", error);
      }
      send("ready", { ok: true });

      const pollTimer = setInterval(poll, POLL_MS);
      // Comment frames keep proxies from closing an idle connection.
      const beatTimer = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, HEARTBEAT_MS);

      const stop = () => {
        if (closed) return;
        closed = true;
        clearInterval(pollTimer);
        clearInterval(beatTimer);
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      };

      request.signal.addEventListener("abort", stop);
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
