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
}): Promise<DepartmentRun> {
  const { department, task, ownerId } = input;
  const agentName = department.agent_name;

  const context: ToolContext = {
    agentName,
    scopes: ["read", "write"],
    ownerId,
    // Already one delegation deep: delegate_to_department refuses from here.
    delegationDepth: 1,
  };

  const tools: ToolSet = Object.fromEntries(
    TOOLS.filter((definition) => definition.name !== DELEGATE_TOOL).map((definition) => [
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
