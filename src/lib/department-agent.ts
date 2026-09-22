import "server-only";

import { generateText, stepCountIs, tool, type ToolSet } from "ai";
import type { z } from "zod";
import { recordAgentRun } from "@/lib/agent-run";
import { checkDepartmentBudget } from "@/lib/budgets";
import { runTool } from "@/lib/mcp/executor";
import { TOOLS, type ToolContext } from "@/lib/mcp/tools";
import { languageModel } from "@/lib/model";
import type { Department } from "@/lib/agents";

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
 * Every tool call goes through runTool (src/lib/mcp/executor.ts), exactly as
 * in the console route, which is what puts the work in Live Activity in real
 * time rather than only when the run finishes.
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
    // The policy gate (src/lib/policy.ts) singles out the unattended cron —
    // this is the only place that distinction is made.
    actorType: mode === "autonomous" ? "standing_task_routine" : "department_agent",
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
          const outcome = await runTool(definition, args, context);
          // Always returned, never thrown: a denied/failed/queued tool call is
          // information the agent can act on, and throwing would abort the
          // whole delegated run.
          switch (outcome.status) {
            case "success":
              return outcome.result;
            case "queued":
              return { queued: true, approval_id: outcome.approvalId };
            case "denied":
              return { error: outcome.reason };
            case "failed":
              return { error: outcome.error };
          }
        },
      }),
    ]),
  );

  const kind = mode === "autonomous" ? "standing_task" : "delegation";
  const budget = await checkDepartmentBudget({
    agentName,
    departmentKey: department.key,
    budget: department.monthly_token_budget,
    alertedAt: department.budget_alerted_at,
  });
  if (!budget.allowed) {
    throw new Error(
      `Monthly token budget exceeded for ${agentName} (${budget.used.toLocaleString("en")} of ${budget.budget?.toLocaleString("en")} tokens). Raise it in Settings.`,
    );
  }

  const startedAt = Date.now();
  let result;
  try {
    result = await generateText({
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
  } catch (error) {
    await recordAgentRun({
      agentName,
      kind,
      durationMs: Date.now() - startedAt,
      stepCount: 0,
      status: "failed",
    });
    throw error;
  }

  await recordAgentRun({
    agentName,
    kind,
    tokensIn: result.usage.inputTokens ?? null,
    tokensOut: result.usage.outputTokens ?? null,
    durationMs: Date.now() - startedAt,
    stepCount: result.steps.length,
    status: "success",
  });

  return {
    agent: agentName,
    summary: result.text,
    steps: result.steps.length,
  };
}
