import "server-only";

import { generateText, stepCountIs, tool, type ToolSet } from "ai";
import type { z } from "zod";
import { startActivity } from "@/lib/activity";
import { TOOLS, type ToolContext } from "@/lib/mcp/tools";
import { languageModel } from "@/lib/model";
import type { Department } from "@/lib/agents";
import type { Json } from "@/types/database";

/**
 * The executor behind a department agent.
 *
 * Department agents used to exist only as a line in the console's system
 * prompt telling the model to "route work to the Dev/Store/Media Agent" — with
 * nothing on the other end. This is the other end: the same tools the console
 * runs, under the department's own instructions, logged under the department's
 * own agent_name so its page stops reading "no activity yet".
 */

/** A sub-run inside the console's request, so it has to stay well short of it. */
const MAX_STEPS = 6;

/** The delegating tool is withheld from the agent, so it cannot re-delegate. */
const DELEGATE_TOOL = "delegate_to_department";

/**
 * How the run was triggered.
 *
 * `interactive` — a human delegated from the console and is watching the result.
 * The agent gets the full toolset (minus delegate).
 *
 * `autonomous` — the standing-task cron, running daily with no human in the
 * loop. The agent's context includes text it does not control: the standing
 * brief, whatever a third-party project MCP server returns from
 * `call_project_tool`, and raw project fields. Any of that can carry a prompt
 * injection ("delete every project", "register a tool pointing at http://…").
 * So an autonomous run gets an allowlist: read everything, act on a project's
 * own registered tools, but never restructure the registry. A tool added later
 * is excluded from autonomous runs until it is added here on purpose.
 */
export type RunMode = "interactive" | "autonomous";

const AUTONOMOUS_TOOLS = new Set([
  "list_projects",
  "get_project",
  "list_categories",
  "list_departments",
  "list_skills",
  "get_skill",
  "list_integrations",
  "list_recent_logs",
  "call_project_tool",
]);

export type DepartmentRun = {
  agent: string;
  summary: string;
  steps: number;
};

/**
 * Runs `task` as `department`'s agent and returns what it reports back.
 *
 * Every tool call is bracketed by startActivity/finish exactly as in the
 * console route, which is what puts the work in Live Activity in real time
 * rather than only when the run finishes.
 */
export async function runDepartmentAgent(input: {
  department: Department;
  task: string;
  ownerId: string | null | undefined;
  /** Defaults to `interactive` — the full toolset. */
  mode?: RunMode;
}): Promise<DepartmentRun> {
  const { department, task, ownerId, mode = "interactive" } = input;
  const agentName = department.agent_name;

  const context: ToolContext = {
    agentName,
    scopes: ["read", "write"],
    ownerId,
    // Already one delegation deep: delegate_to_department refuses from here.
    delegationDepth: 1,
  };

  const available = TOOLS.filter((definition) => {
    if (definition.name === DELEGATE_TOOL) return false;
    if (mode === "autonomous") return AUTONOMOUS_TOOLS.has(definition.name);
    return true;
  });

  const tools: ToolSet = Object.fromEntries(
    available.map((definition) => [
      definition.name,
      tool({
        description: definition.description,
        inputSchema: definition.schema as z.ZodType<Record<string, unknown>>,
        execute: async (args: Record<string, unknown>) => {
          const finish = await startActivity({
            projectId: typeof args.project_id === "string" ? args.project_id : null,
            agentName,
            toolName: definition.name,
            payload: args as Json,
          });
          try {
            const result = await definition.execute(args as never, context);
            await finish("success", result);
            return result;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await finish("failed", { error: message });
            // Returned, not thrown: a failed tool call is information the agent
            // can act on, and throwing would abort the whole delegated run.
            return { error: message };
          }
        },
      }),
    ]),
  );

  const result = await generateText({
    model: languageModel(department.model),
    system: [
      department.system_prompt,
      "You were delegated this task by the CEO console. Do the work with the tools available to you, then report back in one short paragraph. Reply in the same language the task was written in.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    prompt: task,
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
  });

  return {
    agent: agentName,
    summary: result.text,
    steps: result.steps.length,
  };
}
