import "server-only";

import { logActivity } from "@/lib/activity";
import type { Json } from "@/types/database";

/**
 * Integration operations land in the same activity feed as every agent and
 * owner action — so "connected GitHub", "token refresh failed", "webhook
 * received" all show up in Live Activity. Never pass a secret in `payload`;
 * callers pass scopes, account labels and status only.
 */
export async function logIntegration(args: {
  provider: string;
  operation: string;
  status: "success" | "failed" | "pending";
  detail?: Record<string, unknown>;
}): Promise<void> {
  await logActivity({
    agentName: "Integrations",
    toolName: `${args.provider}.${args.operation}`,
    payload: { provider: args.provider, ...(args.detail ?? {}) } as Json,
    status: args.status,
  });
}
