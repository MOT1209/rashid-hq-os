import type { Database } from "@/types/supabase";

export type { Database };
export type { Json } from "@/types/supabase";

type Row<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

export type ProjectStatus = "active" | "idle" | "maintenance";
export type LogStatus = "success" | "failed" | "pending";

/** `status` is a text column with a CHECK constraint, so narrow it here. */
export type Project = Omit<Row<"projects">, "status"> & { status: ProjectStatus };
export type AgentLog = Omit<Row<"agent_logs">, "status"> & { status: LogStatus };
export type ProjectTool = Row<"project_tools">;
