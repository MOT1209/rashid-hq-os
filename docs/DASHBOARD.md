# CEO dashboard

`/dashboard` shows the console, the KPI tiles, and a **Command overview** built only from real data. Each card loads independently:
if its query fails (outage, or a migration not applied yet) only that card says "Unavailable" — it is never shown as zero — and the
rest of the page still renders.

| Card | Source | Notes |
|---|---|---|
| **Needs attention** | derived from the cards below | Real problems only, most severe first, each linking to where to fix it: database down, missing critical secrets, agents at their token budget, expired/errored integrations, pending approvals, failed tool calls (24 h), failed agent runs, agents ≥ 80 % of budget, failed automation runs, failed social posts (7 d), MCP tools failing their last test, overdue tasks, missing optional config |
| **System health** | live DB ping + environment | Database reachability and latency, and ✓/!/– for auth secret, token-encryption key, owner emails, AI model key, 2FA policy, cron secret, shared rate limit, email, error tracking. **Only booleans are computed; no secret value is ever read into the page** |
| **Agents** | `departments`, `agent_runs` | enabled/total, runs and failures in 24 h |
| **Running now** | `automation_runs`, `social_publish_jobs`, `project_tasks` | queued/running automation runs and social jobs, tasks in progress and overdue |
| **Pending approvals** | `tool_approvals` | links to the approval queue |
| **MCP tools** | `project_tools` | total, enabled, dangerous, failing their last test (disabled tools excluded) |
| **Integrations** | `integration_connections` | connected vs expired/errored |
| **Scheduled** | `automations`, `social_publish_jobs` | next 3 enabled automation runs, next queued social post |
| **Social publishing** | `social_publish_jobs`, `social_accounts` | accounts, published and failed in 7 days |
| **Recent failures** | `agent_logs` | last 5 failed calls in 24 h |

The earlier standalone "Social publishing" panel was folded into these cards (same numbers plus queue/next-post/failures); the KPI tiles,
live activity, departments and projects panels are unchanged.

## Limits (honest)

- Counts use bounded reads (e.g. 5,000 runs, 1,000 tools, 200 connections); a much larger deployment would need aggregation in SQL.
- "Running now" shows queue depth, not per-item progress; open the linked page for detail.
- The overview is fetched on each page load (no caching), about 20 small queries in parallel.
- Cost is not shown (only token counts are recorded).
- The layout has not been visually reviewed in a browser against live data in this build; check the manual list below.

## Manual verification

- [ ] Load `/dashboard` in Arabic and English (RTL/LTR) — cards align, no overflow at phone width.
- [ ] With everything healthy, "Needs attention" says nothing needs attention.
- [ ] Unset `RESEND_API_KEY` → a warning appears linking to Settings; set it back → it disappears.
- [ ] Queue a tool call that needs approval → "Pending approvals" and the warning count update.
- [ ] Temporarily revoke an integration token → it appears under "need attention".
- [ ] Stop the database / use a bad service key in a preview → the database row turns red and the page still loads.
