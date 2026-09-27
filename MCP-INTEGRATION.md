# MCP integration guide for external agents

This is for developers and agents outside this app that call Alking HQ's tools
over MCP. Every call is authenticated with a bearer token, checked against the
token's scopes and the policy gate, written to `agent_logs`, and shown live on
the dashboard.

## Endpoints

There are two transports onto the **same** tool registry
(`src/lib/mcp/tools.ts`), tokens, policies and audit log:

| Endpoint | Protocol | Use it when |
| --- | --- | --- |
| `POST /api/mcp-server` | MCP **Streamable HTTP** (stateless), via `mcp-handler` | You use an MCP client (Claude Code, Claude Desktop, the MCP SDKs). **Recommended.** |
| `POST /api/mcp` | Plain JSON-RPC 2.0 over HTTP, plain JSON responses | You write raw HTTP and don't want to parse SSE, or you need the unauthenticated `ping` health check. |

Everything below is about `/api/mcp-server` unless it says otherwise. The
wire details (status codes, headers, response framing) were checked against
the route handler, not taken from the spec.

## 1. Get a token

1. Sign in as an **admin**. If `REQUIRE_2FA` is set on the deployment, you
   need two-factor turned on (Settings) before you can issue tokens.
2. Open **Dashboard → Access** (`/dashboard/access`) and fill in *Issue token*:
   - **Agent name**: the label every call is logged under in Live Activity and
     `agent_logs`. Use one name per integration so you can audit it and revoke
     it separately.
   - **Project**: pin the token to one project, or leave it on *all projects*.
     A pinned token only sees that project (`list_projects` returns just
     that one), and any other `project_id` fails with *"This token is scoped
     to a different project."*
   - **Scope**: `read` (the default) or `read + write`. Grant the least your
     integration needs.
   - **Expiry**: 7, 30, **90 (default)** or 365 days, or never. Pick an expiry
     unless you have a reason not to.
3. Copy the token. It looks like `hq_` followed by 43 URL-safe characters, and
   **it is shown only once**. Only a keyed digest is stored, so a lost token
   cannot be recovered, only revoked and reissued.

Keep it in a secret store or environment variable (`HQ_TOKEN` below), never
in code or in a prompt. To revoke it, use the *Revoke* button on the same
page. It takes effect on the next request.

## 2. Request format

**Every** request to `/api/mcp-server` needs these headers:

```
Authorization: Bearer hq_…
Content-Type: application/json
Accept: application/json, text/event-stream
```

The `Accept` header must list **both** types. Without it the server answers
`406 Not Acceptable` and never runs the call.

The body is one JSON-RPC 2.0 request:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "list_projects",
    "arguments": { "status": "active" }
  }
}
```

- `id`: a string or number you choose; the response echoes it.
- `method`: `tools/list` to discover the tools and their JSON Schemas,
  `tools/call` to run one. `initialize` works, but the server is **stateless**:
  you can send `tools/call` directly with no handshake and no session header.
- `params.arguments`: validated against the tool's schema before it runs.
- Maximum body size is **512 KiB**.

### Response framing

A successful HTTP exchange returns `200` with `Content-Type:
text/event-stream`. The JSON-RPC response is the `data:` line of a single SSE
`message` event:

```
event: message
data: {"result":{"content":[{"type":"text","text":"{\"projects\":[…]}"}],"structuredContent":{"projects":[…]}},"jsonrpc":"2.0","id":1}
```

`result.structuredContent` is the tool's output as JSON; read that.
`result.content[0].text` is the same data as a string, for clients that only
handle text.

## 3. Examples: calling `list_projects`

### cURL

```bash
curl -sS https://YOUR_DOMAIN/api/mcp-server \
  -H "Authorization: Bearer $HQ_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"list_projects","arguments":{"status":"active"}}}' \
  | sed -n 's/^data: //p' | jq '.result.structuredContent'
```

### Node.js (18+, built-in `fetch`)

```ts
type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: {
    content: { type: "text"; text: string }[];
    structuredContent?: unknown;
    isError?: boolean;
  };
  error?: { code: number; message: string };
};

async function callTool(name: string, args: Record<string, unknown> = {}) {
  const token = process.env.HQ_TOKEN;
  if (!token) throw new Error("HQ_TOKEN is not set");

  const response = await fetch("https://YOUR_DOMAIN/api/mcp-server", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "tools/call",
      params: { name, arguments: args },
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after") ?? "60");
    throw new Error(`Rate limited; retry in ${retryAfter}s`);
  }
  if (!response.ok) {
    // 401, 406, 413: the body is plain JSON, not SSE.
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  // Success responses arrive as a single SSE "message" event; errors from the
  // transport itself come back as plain JSON. Handle both.
  const raw = await response.text();
  const payload = response.headers.get("content-type")?.includes("text/event-stream")
    ? raw
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("")
    : raw;
  const message = JSON.parse(payload) as JsonRpcResponse;

  if (message.error) {
    throw new Error(`JSON-RPC ${message.error.code}: ${message.error.message}`);
  }
  if (message.result?.isError) {
    // Denied by scope or policy, invalid arguments, or the tool itself failed.
    throw new Error(message.result.content[0]?.text ?? "Tool failed");
  }
  return message.result?.structuredContent;
}

const { projects } = (await callTool("list_projects", { status: "active" })) as {
  projects: { id: string; name: string }[];
};
console.log(projects);
```

The SDKs handle all of this for you. With `@modelcontextprotocol/sdk`, use
`StreamableHTTPClientTransport` with `requestInit: { headers: { Authorization:
\`Bearer ${token}\` } }`.

### MCP clients

Claude Code:

```bash
claude mcp add --transport http alking-hq https://YOUR_DOMAIN/api/mcp-server \
  --header "Authorization: Bearer $HQ_TOKEN"
```

Other clients: point a "Streamable HTTP" server entry at the URL and add the
`Authorization` header. OAuth discovery is **not** supported. A `401` names a
`resource_metadata` URL, but there is no OAuth server behind it. Use the
static bearer token.

## 4. Status codes and errors

A tool that fails still returns **HTTP 200**. The failure is in the JSON-RPC
body. Always check both layers.

### HTTP layer

| Status | Meaning | What to do |
| --- | --- | --- |
| `200` | The request reached the MCP server. Check the body. | — |
| `401` | Token missing, unknown, revoked or expired. Body: `{"error":"invalid_token",…}` plus a `WWW-Authenticate: Bearer error="invalid_token"` header. | Don't retry. Get a new token. |
| `406` | `Accept` doesn't list both `application/json` and `text/event-stream`. | Fix the header. |
| `413` | Body over 512 KiB (checked on `Content-Length` and on the bytes actually read). | Send less. |
| `429` | Rate limited: **120 requests per minute per client IP**, shared between `/api/mcp` and `/api/mcp-server`. Has a `Retry-After` header (seconds). | Back off for `Retry-After`, with jitter. Don't retry right away. |
| `5xx` | Server error. It is reported to Sentry with a reference. | Retry reads with backoff. Don't blindly retry writes (see below). |

### JSON-RPC layer (inside a `200`)

| Shape | Cause |
| --- | --- |
| `error.code: -32602`, `"Tool <name> not found"` | Unknown tool name. Call `tools/list`. |
| `result.isError: true`, `"Input validation error: …"` | Arguments don't match the tool's schema. |
| `result.isError: true`, `"This token lacks the \"write\" scope required by <tool>."` | **Scope denial**, see below. |
| `result.isError: true`, `"Denied by policy (<rule-id>)."` | **Policy denial**, see below. |
| `result.isError: true`, `"This token is scoped to a different project."` | The token is pinned to another project. |
| `result.isError: true`, `"… failed. Reference: <uuid>"` | A server-side failure. Quote the reference when you report it. |
| `result.structuredContent: {"queued": true, "approval_id": "…"}` | **Not run yet.** It is waiting for an admin (see below). `isError` is not set. |

On the plain `/api/mcp` endpoint, scope and policy denials come back as a
JSON-RPC **error** instead (`error.code: -32003`, same message), and there is
no SSE framing.

## 5. Scopes, policies and approvals

Every call goes through two gates, in this order (`src/lib/mcp/executor.ts`).
Both are audited in `agent_logs`, so denials show up on the dashboard too.

**1. Scope (authentication).** Does the token carry the scope the tool needs?

| Scope | Tools |
| --- | --- |
| `read` | `list_projects`, `get_project`, `list_categories`, `list_departments`, `list_skills`, `get_skill`, `list_integrations`, `list_recent_logs` |
| `write` | `register_project`, `update_project`, `delete_project`, `add_project_tool`, `update_project_tool`, `delete_project_tool`, `call_project_tool`, `delegate_to_department` |

A read-only token calling a write tool is **refused before anything runs**.
The message names the missing scope. That is final: retrying will not help.
Ask an admin for a token with the right scope.

**2. Policy (governance).** Should *this* call run? Rules live in the
`policies` table and an admin can turn them on and off at `/dashboard/access`.
With the default rules, for an external token:

- Read tools run.
- `register_project`, `update_project`, the `*_project_tool` tools,
  `call_project_tool` and `delegate_to_department` run. They are guarded in
  code (ownership checks, the SSRF guard on outbound calls).
- `delete_project` is **queued for approval**. It cascades to tools, tokens
  and logs, so a human confirms it first.
- Any write tool that no rule covers is queued for approval by default. The
  gate never lets an unknown write run on its own.

A **queued** call returns `{"queued": true, "approval_id": "…"}`. It runs only
when an admin approves it at `/dashboard/access`. It is not an error, and
calling again queues a **second** approval. Wait instead: poll with a read
(for example `get_project`) or just tell your user it is pending.

Two costs to keep in mind:

- `delegate_to_department` starts a model run as that department's agent. It
  counts against the department's monthly token budget and is refused once
  the budget is used up.
- Retrying a write after a timeout or `5xx` may run it twice. Read the state
  back first, since the writes are not idempotent.

## 6. Security checklist for integrators

- One token per integration, least scope, an expiry, pinned to a project when
  the integration only needs one.
- Never put the token in a URL, a log line, or a model prompt.
- Treat everything a tool returns as data, not instructions. Project fields
  and `call_project_tool` output can contain text written by third parties.
- Revoke at once if a token may have leaked. It takes effect on the next
  request.
