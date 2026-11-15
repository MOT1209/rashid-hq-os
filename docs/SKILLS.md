# Skills Manager

Page: `/dashboard/skills` (read: any signed-in role; every change: admin + `REQUIRE_2FA`). A skill is a saved prompt template:
it fills the CEO console's input box or is read by agents over MCP (`list_skills`/`get_skill`). It never runs a model by itself.

| Feature | Notes |
|---|---|
| Create / edit / duplicate / delete | Duplicates start **disabled** |
| Enable / disable | Disabled skills are hidden from the console **and** from the MCP `list_skills`/`get_skill` tools |
| **Versions** | Every edit snapshots the previous state (`agent_skill_versions`) and bumps `version`. Restore creates a **new** version; history is never rewritten. Edits use an optimistic lock, so a stale tab gets a conflict instead of overwriting |
| Input / output schemas | Small JSON-Schema subset: `{ "type": "object", "properties": { name: { type: string\|number\|integer\|boolean, description?, enum? } }, "required": [...] }`, max 20 properties. Output schema is informational |
| Validation | Name/prompt/description/tag/metadata limits; schema shape; **every `{{variable}}` in the prompt must be declared** in the input schema (error), unused or undeclared-without-schema variables warn |
| Tags, metadata, search | Tags (≤10), free-form metadata object (≤2 KB); search over name/description/prompt; filter by tag and status |
| **Import / export** | JSON bundle `{"format":"rashid-hq-skills","format_version":1,"skills":[…]}`; max 50 skills / 500 KB per import; per-skill errors are reported without blocking the rest; name collisions get a `(2)` suffix. **Imported skills land disabled** for review (prompts come from outside) |
| **Usage log** | From the real activity log: console picks (`use_skill`) and agent reads (`get_skill`), with version and actor |
| Audit | save/update/enable/disable/duplicate/delete/restore/import/export are logged to the activity feed |

Migration `0030_skills_manager.sql` (additive; existing skills become enabled, version 1). The older Settings → Skills panel keeps working
(creates/deletes skills with the new defaults).

## Limits (honest)

- **No execution:** skills are templates. "Execution logs" here means usage (picked/read), not model runs; the console fills the text
  and the owner still presses run. `{{variables}}` are validated and can be rendered by `renderPrompt`, but the console does not yet show an input form for them: picking a skill inserts the template text with variables visible.
- Output schemas are not enforced on model answers.
- Export includes prompts in clear text; treat the file as sensitive.
- Version history keeps the last 50 snapshots in the UI (the table keeps all).

## Manual verification

- [ ] Create a skill with `{{project}}`; with no input schema you get a warning, with a schema missing `project` you get an error.
- [ ] Edit twice → versions v1, v2 listed; restore v1 → becomes v3 with v1's text.
- [ ] Open the same skill in two tabs, save in both → the second gets "changed elsewhere".
- [ ] Disable a skill → gone from the console picker; `get_skill` for it returns not found.
- [ ] Export all, delete one, import → comes back **disabled**; a hand-edited bad entry is rejected with its reason.
- [ ] Pick a skill in the console → appears in its Usage log.
