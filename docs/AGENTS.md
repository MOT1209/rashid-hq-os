# Agent management

Page: `/dashboard/agents` (read: any signed-in role; every change: admin + `REQUIRE_2FA` policy).
**Agents are the departments** (instructions, model, token budget and standing task live on each agent's department page,
`/dashboard/departments/<key>`). This page adds governance, testing and monitoring on top, without a second agent system.

| Feature | Notes |
|---|---|
| **Create agents** | Key, English/Arabic names, display name, icon, instructions, optional model. Created agents are flagged `is_custom` |
| Edit instructions / model / budget / standing task | On the department page (existing) — linked from each card |
| **Enable / disable** | A disabled agent refuses delegated runs and its standing task is skipped. The console's `delegate_to_department` goes through the same check |
| **Tool allowlist** | "All tools the agent's mode allows" (today's behaviour) or only selected tools. Delegation is never available to agents |
| **Read-only** | Only read-scope tools, whatever the allowlist says |
| **Project scope** | Optional assignment. With no assignment an agent may act on any project; with assignments, any tool call naming another `project_id` is refused before it runs, and the agent's instructions state its boundaries |
| **Self-test** | A real model run with a fixed harmless brief and **read-only tools forced** (regardless of the agent's settings); counts against the token budget and shows in history |
| **Execution history / performance** | From the real `agent_runs` ledger (30 days): runs by kind, success rate, average duration and steps, tokens in/out, last run. An agent with no runs shows no rates (never fabricated zeros) |
| **Token usage & budget** | 30-day tokens vs the monthly budget. **Cost is not shown**: only token counts are recorded (prices vary and are not stored) |
| **Error reporting** | Last 7 days of failed tool calls per agent from the activity log, with the error text; model-run failures are also in Sentry |
| Delete | Only agents created here; built-in departments and the fallback cannot be deleted |

Migration `0033_agent_management.sql` (additive; existing agents keep today's behaviour). Governance layers combine strictly:
run-mode allowlist (autonomous runs) ∩ read-only ∩ tool allowlist ∩ project scope ∩ the policy engine/approvals (unchanged).

## Safety notes

- Governance can only **narrow** an agent's capabilities; nothing here grants a tool the run mode would not already allow (an `allowed_tools` entry cannot re-enable a write tool in an autonomous run).
- A missing `agent_projects` table (migration not yet applied) means "no restriction", so deploying the code first never breaks agents; any other lookup error fails closed.
- Everything is audited in the activity feed (`create_agent`, `configure_agent`, `test_agent`, `delete_agent`).

## Limits (honest)

- Per-agent **MCP server** assignment is not separate: an agent uses the registered project tools (via `call_project_tool`) within its tool and project limits.
- The project-scope guard applies to calls that carry a `project_id`; listing tools (e.g. `list_projects`) still return the registry. It is a guard against acting on other projects, not data hiding.
- Performance windows are fixed (30 days / 7 days) and capped (5,000 runs / 150 failures).
- Not built: custom per-agent tool code, agent-to-agent workflows beyond the existing depth-1 delegation, A/B testing of instructions.

## Manual verification

- [ ] Create an agent; it appears on the Agents page and as `/dashboard/departments/<key>`.
- [ ] Disable an agent → delegating to it from the console fails with "is disabled"; its standing task is skipped at the next cron.
- [ ] Set Read-only, run the self-test → it can list projects; ask it (in the console) to change a project → refused (no write tools).
- [ ] Assign it to one project → asking it to inspect another project returns "not assigned".
- [ ] Run the self-test twice → runs, tokens and average duration update on the card.
- [ ] Try deleting a built-in department from this page → refused.
