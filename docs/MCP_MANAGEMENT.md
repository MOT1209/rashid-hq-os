# MCP management

Page: `/dashboard/mcp` (read: any signed-in role; every change: admin + `REQUIRE_2FA` policy).
A "server" is a project with an MCP endpoint and/or registered tools.

## What it does

| Feature | How |
|---|---|
| Per-tool **permission policy** | `enabled` kill switch · class `read` / `write` / `dangerous` · optional "always require my approval" (migration 0028) |
| Enforcement | In the policy engine (`src/lib/policy.ts` → `src/lib/mcp/tool-policy.ts`) for `call_project_tool`, at call time **and again when an owner approves** a queued call, so disabling a tool also blocks calls already waiting |
| Dangerous tools | Always `require_approval`; **denied** for unattended standing-task (cron) runs |
| Fail-safe | If the policy lookup errors, the call queues for approval — it never runs ungoverned |
| **Test** button | Only enabled, read-class tools (a test sends empty input; it used to bypass approval for any tool, which could run a destructive tool unapproved). Records last result and latency |
| **Health / history** | Last test result + latency per tool; 7-day calls, failure rate, denied and awaiting-approval counts, and the 5 most recent calls — all from the real activity log (no synthetic data) |
| **Protocol** per server | `HQ signed POST` (unchanged default) or **standard MCP** over Streamable HTTP (migration 0029) |
| **Discovery** (standard MCP) | `initialize` → `tools/list` (paginated, max 100). New tools are inserted **disabled, write-class, approval required**; existing tools are untouched |
| **Credentials** | Optional bearer token per MCP server, sealed with `INTEGRATIONS_SECRET`; the browser only learns whether one is set |
| Audit | Every change is logged to the activity feed as the owner (`mcp.tool_policy`, `mcp.protocol`, `mcp.credential`, `mcp.discover`) |

## Security notes

- Endpoints are SSRF-vetted and the connection is pinned to the vetted address (same guard as `call_project_tool`); redirects are refused; response bodies and timeouts are capped.
- The bearer token is only sent in the `Authorization` header and never logged or returned.
- Existing tools keep today's behaviour after the migration (enabled, `write`, no extra approval). Review them and mark destructive ones `dangerous`.

## Limits (honest)

- The standard-MCP client is stateless-friendly Streamable HTTP with JSON or SSE replies. It does **not** implement OAuth for MCP servers, server-initiated requests (sampling/elicitation), resources/prompts, or the legacy HTTP+SSE transport. Servers that need OAuth are not supported.
- Tested with **mocked HTTP only** (`tests/mcp-client.test.ts`); not yet run against a live MCP server.
- "Start/stop" of a server process is not applicable: servers are remote endpoints; the controls are enable/disable per tool and protocol/credential per server.
- There is no push-based server health probe; health is the last manual test plus real call outcomes.
- Parameter schemas discovered from a server are stored (`input_schema`) but call input is not validated against them before sending.

## Manual verification

- [ ] Mark a tool `dangerous`; call it from the CEO console → it queues for approval and does not run.
- [ ] Disable a tool with a pending approval → approving it is refused ("Denied by policy (project-tool-disabled)").
- [ ] Test button is disabled for write/dangerous tools; works for an enabled read tool and shows latency.
- [ ] Set a server to "Standard MCP", save a token, **Discover tools** → tools appear disabled; enable one, call it.
- [ ] The token is never visible in the page source or network responses.
