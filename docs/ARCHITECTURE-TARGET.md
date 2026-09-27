# Rashid HQ OS — Target Architecture

Where the system should go to become a Company OS, **without discarding the
working core**. This is a direction, not a Phase-1 work order. Nothing here is to
be built during the audit.

## Guiding principle

Grow outward from the one thing that already works — the central governed
executor — rather than rewriting it. Every new capability (workflows, memory,
eval) plugs into the same scope→policy→approval→audit spine and the same
tool registry.

## Target planes

```
                          RASHID HQ OS
                                |
        +-----------------------+-----------------------+
        |                       |                       |
   CONTROL PLANE           KNOWLEDGE PLANE         EXECUTION PLANE
   - Agent Registry        - Company Memory        - Tool Registry (have)
   - Policy Engine (have)  - Long/short/project    - MCP Platform (have)
   - Approval (have+)        memory                - Model Gateway
   - Budget/FinOps         - Knowledge / RAG       - External connectors (have)
   - Security Center       - Versioned prompts     - Sandboxed execution
        |                       |                       |
        +-----------+-----------+-----------+-----------+
                    |                       |
              ORCHESTRATION            EVENT BUS
              - Workflow engine        - domain events
              - A2A (depth>1, typed)   - triggers, webhooks
                    |
              OBSERVABILITY (trace_id/run_id across all of the above)
                    |
              Database / Events / Audit
```

## Component targets (from current → target)

| Component | Now | Target |
|---|---|---|
| Agent Registry | code + rows | first-class table: agent = {identity, prompt(versioned), tools, model, budget, memory scope}; console + departments become registry entries |
| Model Gateway | single `languageModel()` seam, Groq only | provider-agnostic gateway behind the same seam: OpenAI/Anthropic/Google/Groq/local, with per-call fallback, retry, timeout, cost table |
| Company Memory | client chat only | short-term (run), project memory, company knowledge; explicit store/retrieve/retention/isolation |
| Knowledge / RAG | none | embeddings + retrieval as a tool, governed like any tool |
| Workflow Engine | none | declarative multi-step tasks over the tool registry, each step audited with a shared run_id |
| A2A | depth ≤ 1 | typed, budget-propagating, depth-bounded, identity-preserving multi-hop |
| Approval | works, diverges | unified through the executor; `expires_at`; Sentry on failure; approval = signed intent bound to args+policy+time |
| Budget/FinOps | tokens, rolling, race | currency via per-model price; calendar periods; atomic reservation; console capped |
| Observability | Sentry + audit | one `trace_id`/`run_id` threaded request→run→tool→approval→Sentry; insights built on it |
| Event Bus | none | domain events (run.started, tool.denied, budget.exceeded…) to drive triggers, alerts, workflows |
| Evaluation | none | golden tasks + scoring on agent/prompt/policy changes |
| Versioning | none | prompts, policies, tool schemas versioned and diffable |
| Security Center | boundaries only | a surface: tokens, scopes, denials, approvals, advisories in one place |

## Non-negotiable invariants to carry forward

- Single execution boundary (`runTool`); no new bypasses.
- Service-role-only DB; browser never touches Postgres.
- Fail-safe policy default; DB-error fallback.
- Additive, re-runnable migrations with types updated in lockstep.
- Least-privilege tokens; SSRF guard on every outbound call.

## Explicitly out of scope for the near term

Autonomous self-modifying agents, agents that write their own tools, and any
path that lets a model change policy/budget/registry without human approval.
Those require the eval + versioning + event-bus foundations first.
