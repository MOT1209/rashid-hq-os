import { fetchLogs } from "@/lib/queries";
import { getSession } from "@/lib/session";
import { isOwnerEmail } from "@/lib/owners";
import type { LogStatus } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

function isStatus(value: string | null): value is LogStatus {
  return value === "success" || value === "failed" || value === "pending";
}

/**
 * Keyset pagination for the activity feed's "load more" button. Reads older
 * rows than `before`; the SSE route handles anything newer.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session || !isOwnerEmail(session.user.email)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const before = url.searchParams.get("before") ?? undefined;
  const projectId = url.searchParams.get("projectId") ?? undefined;
  const agentNames = url.searchParams.get("agents")?.split(",").filter(Boolean);
  const statusParam = url.searchParams.get("status");

  try {
    const logs = await fetchLogs({
      limit: PAGE_SIZE,
      before,
      projectId,
      agentNames,
      status: isStatus(statusParam) ? statusParam : undefined,
    });
    return Response.json({ logs, hasMore: logs.length === PAGE_SIZE });
  } catch (error) {
    console.error("[activity-page]", error);
    return Response.json({ error: "Could not load activity." }, { status: 500 });
  }
}
