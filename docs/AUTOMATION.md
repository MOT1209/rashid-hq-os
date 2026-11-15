# Automation engine

Page: `/dashboard/automations` (read: any signed-in role; every change: admin + `REQUIRE_2FA` policy).
Worker: `GET /api/automation/run` (`CRON_SECRET` bearer or same-origin owner), called every ~10 minutes by
`.github/workflows/social-worker.yml` (also runs the social publishing worker).

## Model

An **automation** = trigger + ordered **steps** + retry policy + failure notification. A **run** is one execution, persisted in Postgres
(`automations`, `automation_runs`, migration 0031). Nothing is held in memory: queue, retries, schedules and progress all survive restarts.

| Piece | Behaviour |
|---|---|
| Triggers | **Manual** ("Run now") · **Schedule** (5-field cron + IANA timezone, DST-aware; min interval 5 min) · **Event** (`social_job_failed`, `social_job_succeeded`, `tool_call_failed`) |
| Steps (max 10) | **tool** (an unattended-safe tool via the central `runTool`) · **agent** (department agent in *autonomous* mode) · **notify** (email the owners) |
| Conditions | Each step may have `when: { path, op, value }` (ops: eq, neq, exists, not_exists, gt, lt, contains) on `trigger.*` or an **earlier** step's output; false ⇒ the step is *skipped* |
| Data flow | `{{trigger.x}}` and `{{steps.<id>.output.x}}` templates in tool input, agent task, email subject/message. Values are inserted as text and never re-interpreted |
| Failure handling | per step `onFailure: stop \| continue`; per step or default `maxAttempts` (1–5) with exponential backoff (`backoff_seconds`·2ⁿ, max 1 h) |
| Retries are persistent | A retryable failure puts the run back in the queue with a future `run_at` and keeps its place; finished steps are never repeated |
| Durability | Progress is saved after every step; a crashed worker's lock expires after 15 min and the run **resumes at the first unfinished step** |
| Pause / resume | Pause = `enabled=false`: no schedule ticks, no event runs, queued non-manual runs are cancelled, an in-flight run stops at the next step boundary. Resume recomputes `next_run_at` from now (no burst of missed runs) |
| History | Per run and per step: status, attempts, bounded output (4 KB), error, timestamps |
| Failure notification | Email to `OWNER_EMAILS` on final failure (if `RESEND_API_KEY` is set) + a failed entry in the activity feed |
| Idempotency | Schedule runs keyed `sched:<id>:<slot>`, event runs `evt:<id>:<event key>` — duplicate ticks/events are no-ops. Cap: 20 runs/hour per automation (stops loops) |

## Safety model (important)

Automations run **unattended**, so they inherit the same guard rails as the daily standing-task cron:

- Actor type `standing_task_routine`: the policy engine **denies every write tool except a project's own registered tools**, and **denies `dangerous`-class project tools** (see `docs/MCP_MANAGEMENT.md`). Disabled project tools are denied too.
- Tool steps are limited to the `AUTONOMOUS_TOOLS` allowlist (read tools + `call_project_tool`). Anything needing **owner approval fails the step** — automations never wait for approvals.
- Agent steps run with the autonomous toolset and count against department/project **token budgets**.
- **Only read-only tools and email are retried automatically.** A failed write or agent run is never repeated (it may already have had effects).
- Events from unattended runs are never emitted, so an automation cannot trigger itself through `tool_call_failed`.
- New automations are created **paused**.
- No arbitrary HTTP step exists (SSRF surface); reach external systems through registered project tools.

## Limits (honest)

- **Timing is approximate**: schedules fire when the worker ticks (~10 min with the provided workflow; Vercel Hobby cron is daily-only). Sub-10-minute precision needs a faster caller.
- A run executes inside one worker invocation (`maxDuration` 300 s, 2 runs per tick); very long agent steps may be cut off and resume after the lock expires.
- No parallel branches, loops, sub-automations or manual approval gates inside a workflow; conditions are step-level only.
- `tool_call_failed` is emitted for failures from the console, agents and MCP callers, not from unattended runs.
- Email needs `RESEND_API_KEY`; without it notify steps fail with a clear message and failure alerts are visible only in the UI/feed.
- Tested with fakes for the database, tools, agents and email (unit tests); the SQL queue behaviour was verified by hand on Postgres 16. Not yet run end-to-end against a live deployment.

## Manual verification

- [ ] Create a manual automation (tool `list_projects` → notify); Run now → history shows both steps OK (notify fails clearly if email is not configured).
- [ ] Create a schedule `*/10 * * * *`-style (every 10 min) automation, resume it → a run appears after the next worker tick; pause → no more runs.
- [ ] Add a condition `steps.a.output.projects` exists / `trigger.x eq y` → step shows *skipped* when false.
- [ ] Event trigger `social_job_failed`: force a failing social job → a run appears with the job in its trigger payload.
- [ ] A step calling a `dangerous` project tool fails with "denied by policy"; a write tool outside the allowlist cannot be added to the form.
- [ ] Set max attempts 3 on a read tool pointing at a failing endpoint → run goes *queued* with growing delays, then *failed*, then you get the failure email.
