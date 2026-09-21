import type { Database } from "@/types/supabase";

export type { Database };
export type { Json } from "@/types/supabase";

type Row<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

export type ProjectStatus = "active" | "idle" | "maintenance";
export type LogStatus = "success" | "failed" | "pending" | "awaiting_approval";

/**
 * The policy gate's verdict on a tool call, recorded on the same agent_logs
 * row it decided (migration 0014). "allow"/"deny" are terminal; a
 * "require_approval" row starts `awaiting_approval` and is finished later by
 * an admin via approveToolCall/rejectToolCall (src/lib/approvals.ts).
 */
export type PolicyDecision = "allow" | "deny" | "require_approval";

/**
 * Who actually drove a tool call, distinct from `agent_name` (a display
 * label). Populated at each of the 4 call sites that build a ToolContext.
 */
export type ActorType =
  | "person"
  | "agent_token"
  | "department_agent"
  | "standing_task_routine";

/** `status` is a text column with a CHECK constraint, so narrow it here. */
export type Project = Omit<Row<"projects">, "status"> & { status: ProjectStatus };
export type AgentLog = Omit<Row<"agent_logs">, "status"> & { status: LogStatus };
export type ProjectTool = Row<"project_tools">;
export type ToolApprovalStatus = "pending" | "approved" | "rejected";
export type ToolApprovalRow = Row<"tool_approvals">;

/**
 * DB-driven policy gate (migration 0017). Hand-written — src/types/supabase.ts
 * is generated and does not know this table yet. Semantics documented in the
 * migration and matched by matchDbPolicy (src/lib/policy.ts).
 */
export type PolicyRow = {
  id: string;
  description: string;
  tool_names: string[];
  actor_type: ActorType | null;
  required_scope: "read" | "write" | null;
  exclude_tool: string | null;
  decision: PolicyDecision;
  priority: number;
  enabled: boolean;
  created_at: string;
};

/** The three places a generateText/streamText call happens (src/lib/agent-run.ts). */
export type RunKind = "console" | "delegation" | "standing_task";
export type RunStatus = "success" | "failed";
export type AgentRun = Omit<Row<"agent_runs">, "kind" | "status"> & {
  kind: RunKind;
  status: RunStatus;
};
