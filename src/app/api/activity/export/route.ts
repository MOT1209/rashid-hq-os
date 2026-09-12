import { fetchLogs, fetchProjectOptions, projectNameMap } from "@/lib/queries";
import { getSession } from "@/lib/session";
import { isOwnerEmail } from "@/lib/owners";
import { toCsv } from "@/lib/csv";
import type { AgentLog, LogStatus } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Enough to review a quarter without turning the export into a way to pull the
 * whole table down in one request.
 */
const MAX_ROWS = 5_000;

function isStatus(value: string | null): value is LogStatus {
  return (
    value === "success" ||
    value === "failed" ||
    value === "pending" ||
    value === "awaiting_approval"
  );
}

/**
 * Downloads the activity log as CSV, honouring the same filters as the feed —
 * reviewing a month of agent activity meant scrolling the live stream, which
 * is built for tailing, not for reading back.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session || !isOwnerEmail(session.user.email)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");

  try {
    const [logs, projects] = await Promise.all([
      fetchLogs({
        limit: MAX_ROWS,
        projectId: url.searchParams.get("projectId") ?? undefined,
        agentNames: url.searchParams.get("agents")?.split(",").filter(Boolean),
        status: isStatus(statusParam) ? statusParam : undefined,
      }),
      fetchProjectOptions(),
    ]);

    const names = projectNameMap(projects);
    const csv = toCsv<AgentLog>(
      [
        { key: "created_at", get: (l) => l.created_at },
        { key: "project", get: (l) => (l.project_id ? names[l.project_id] : "") },
        { key: "agent_name", get: (l) => l.agent_name },
        { key: "tool_name", get: (l) => l.tool_name },
        { key: "status", get: (l) => l.status },
        { key: "payload", get: (l) => l.payload },
        { key: "result", get: (l) => l.result },
      ],
      logs,
    );

    const date = new Date().toISOString().slice(0, 10);
    // The BOM is what makes Excel read the Arabic project names as UTF-8
    // instead of falling back to the local codepage.
    return new Response(`﻿${csv}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="activity-${date}.csv"`,
      },
    });
  } catch (error) {
    console.error("[activity] export failed:", error);
    return Response.json({ error: "Export failed." }, { status: 500 });
  }
}
