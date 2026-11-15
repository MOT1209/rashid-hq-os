# Project management

Pages: `/dashboard/projects` (list) and `/dashboard/projects/<id>` (board). Read: any signed-in role. Every change is a server
action behind `requireAdmin` (role + `REQUIRE_2FA`) that re-checks the project belongs to the signed-in owner.

| Feature | Notes |
|---|---|
| Create / edit / delete | Unchanged (existing forms and actions). Delete still cascades to tools, tokens and logs |
| **Archive / restore** | Hides the project from the default list and from the "active projects" count; **nothing is deleted** (tools, tokens, tasks, history stay). Toggle "Show archived" on the list |
| **Priority** | low / normal / high / urgent (existing projects = normal); shown in the list and header |
| **Description & documentation** | Plain text (description ≤ 1,000, documentation ≤ 20,000 characters) edited on the project page |
| **Task board** | Four columns: To do · In progress · Blocked · Done. Per task: title, description, priority, due date, assignee (free label), manual order. Move left/right, reorder up/down (buttons, so it works by keyboard and screen reader), edit, delete |
| **Progress** | done ÷ total tasks (blocked/in-progress count as not done), shown as a bar on the page and a mini bar + overdue count in the list |
| Overdue | A task past its due date and not done is flagged |
| Project tools | The project's registered MCP tools with permission/enabled state, linking to `/dashboard/mcp` |
| Activity history | The project's last 20 activity-feed entries (agent and tool calls) |

Migration `0032_project_tasks.sql` (additive, re-runnable). Task ownership: each task carries `owner_id`; the page reads the board with the
project owner's id so members with the viewer role can see it, while only the owner (admin) can change it.

## Limits (honest)

- **Not built:** drag-and-drop (use the buttons), task comments/attachments, subtasks/dependencies, assigning tasks to real user accounts
  (assignee is free text), notifications for due dates, a calendar of due dates, per-project agent assignment (project-specific agents arrive with general agent management), free-form per-project configuration.
- Documentation is plain text (no Markdown rendering).
- Progress is task-based only; it is not derived from agent activity.
- Task counts in the list are read in one bounded query (5,000 rows); a very large board would need pagination.

## Manual verification

- [ ] Open a project from the list; add tasks in several columns; move one to Done → progress bar and list mini-bar update.
- [ ] Reorder two tasks in a column; reload → order persists.
- [ ] Set a due date in the past → "Overdue" shows; move it to Done → flag disappears.
- [ ] Archive the project → it leaves the list and the dashboard's active count; "Show archived" brings it back; restore it.
- [ ] A viewer-role member can read the board but sees no edit buttons.
