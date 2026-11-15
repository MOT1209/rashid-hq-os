import { isValidTimeZone, minGapMinutes, nextCronRun } from "@/lib/automation/cron";

/**
 * Automation definitions (pure, browser-safe, tested): validation, template
 * substitution, conditions, retry backoff and the run-time rules.
 */

export const EVENT_TYPES = ["social_job_failed", "social_job_succeeded", "tool_call_failed"] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export const isEventType = (v: unknown): v is EventType => typeof v === "string" && (EVENT_TYPES as readonly string[]).includes(v);

export const LIMITS = { name: 120, description: 500, steps: 10, maxAttempts: 5, text: 2000, inputBytes: 8000, minIntervalMinutes: 5, runsPerHour: 20, outputBytes: 4000 } as const;

export type Op = "eq" | "neq" | "exists" | "not_exists" | "gt" | "lt" | "contains";
const OPS: Op[] = ["eq", "neq", "exists", "not_exists", "gt", "lt", "contains"];

export type Condition = { path: string; op: Op; value?: string | number | boolean };

type Base = { id: string; when?: Condition; onFailure?: "stop" | "continue"; maxAttempts?: number };
export type ToolStep = Base & { type: "tool"; tool: string; input: Record<string, unknown> };
export type AgentStep = Base & { type: "agent"; department: string; task: string };
export type NotifyStep = Base & { type: "notify"; subject: string; message: string };
export type Step = ToolStep | AgentStep | NotifyStep;

export type Definition = {
  name: string; description: string;
  trigger: { type: "manual" } | { type: "schedule"; cron: string; timezone: string } | { type: "event"; event: EventType };
  steps: Step[];
  maxAttempts: number; backoffSeconds: number; notifyOnFailure: boolean;
};

const ID_RE = /^[a-z][a-z0-9_]{0,19}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/* ---------------- templating & conditions ---------------- */

export type RunContext = { trigger: Record<string, unknown>; steps: Record<string, { output?: unknown; status?: string }> };

function getPath(root: unknown, path: string[]): unknown {
  let cur: unknown = root;
  for (const key of path) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") return undefined;
    if (!isObj(cur) && !Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Resolves `trigger.x.y` or `steps.<id>.output.x` against the run context. */
export function resolvePath(path: string, ctx: RunContext): unknown {
  const parts = path.split(".");
  if (parts[0] === "trigger") return getPath(ctx.trigger, parts.slice(1));
  if (parts[0] === "steps" && parts.length >= 3) return getPath(ctx.steps[parts[1]], parts.slice(2));
  return undefined;
}

const TEMPLATE = /\{\{\s*((?:trigger|steps)\.[a-zA-Z0-9_.]+)\s*\}\}/g;

/** Substitutes {{path}} in a string. Values are inserted as text and never re-interpreted. */
export function renderTemplate(text: string, ctx: RunContext): string {
  return text.replace(TEMPLATE, (_m, path: string) => {
    const v = resolvePath(path, ctx);
    if (v === undefined || v === null) return "";
    return (typeof v === "object" ? JSON.stringify(v) : String(v)).slice(0, 1000);
  });
}

/** Deep-renders every string in a JSON value (keys are left untouched). */
export function renderDeep<T>(value: T, ctx: RunContext): T {
  if (typeof value === "string") return renderTemplate(value, ctx) as T;
  if (Array.isArray(value)) return value.map((v) => renderDeep(v, ctx)) as T;
  if (isObj(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renderDeep(v, ctx)])) as T;
  return value;
}

export function evalCondition(c: Condition, ctx: RunContext): boolean {
  const v = resolvePath(c.path, ctx);
  switch (c.op) {
    case "exists": return v !== undefined && v !== null && v !== "";
    case "not_exists": return v === undefined || v === null || v === "";
    case "eq": return String(v) === String(c.value);
    case "neq": return String(v) !== String(c.value);
    case "gt": return Number(v) > Number(c.value);
    case "lt": return Number(v) < Number(c.value);
    case "contains": return typeof v === "string" ? v.includes(String(c.value)) : Array.isArray(v) ? v.map(String).includes(String(c.value)) : false;
  }
}

/* ---------------- retry ---------------- */

/** Exponential backoff from the automation's base delay, capped at one hour. */
export function backoffSeconds(base: number, attempt: number): number {
  return Math.min(3600, base * 2 ** Math.max(0, attempt - 1));
}

/* ---------------- validation ---------------- */

export type Validated = { ok: true; value: Definition; warnings: string[] } | { ok: false; errors: string[] };

function validateCondition(raw: unknown, priorIds: string[], where: string, errors: string[]): Condition | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isObj(raw)) { errors.push(`${where}: condition must be an object.`); return undefined; }
  const path = typeof raw.path === "string" ? raw.path : "";
  const op = raw.op as Op;
  if (!OPS.includes(op)) errors.push(`${where}: unknown operator "${String(raw.op)}".`);
  const m = path.match(/^(trigger(?:\.[a-zA-Z0-9_]+)+|steps\.([a-z][a-z0-9_]*)\.(?:output|status)(?:\.[a-zA-Z0-9_]+)*)$/);
  if (!m) errors.push(`${where}: path must look like trigger.field or steps.<id>.output.field.`);
  else if (m[2] && !priorIds.includes(m[2])) errors.push(`${where}: path refers to "${m[2]}", which is not an earlier step.`);
  if (op !== "exists" && op !== "not_exists" && !["string", "number", "boolean"].includes(typeof raw.value)) errors.push(`${where}: a value is required for "${String(op)}".`);
  return { path, op, ...(raw.value !== undefined ? { value: raw.value as string | number | boolean } : {}) };
}

/**
 * Validates an automation definition from untrusted input (a form or JSON).
 * `allowedTools` is the unattended-safe tool allowlist; `knownDepartments` the
 * department keys that exist.
 */
export function validateDefinition(input: unknown, opts: { allowedTools: string[]; knownDepartments: string[]; now?: Date }): Validated {
  const errors: string[] = [];
  const warnings: string[] = [];
  const o = isObj(input) ? input : {};
  const now = opts.now ?? new Date();

  const name = typeof o.name === "string" ? o.name.trim() : "";
  if (!name) errors.push("Name is required.");
  else if (name.length > LIMITS.name) errors.push(`Name is longer than ${LIMITS.name} characters.`);
  const description = typeof o.description === "string" ? o.description.trim() : "";
  if (description.length > LIMITS.description) errors.push(`Description is longer than ${LIMITS.description} characters.`);

  let trigger: Definition["trigger"] = { type: "manual" };
  const t = isObj(o.trigger) ? o.trigger : {};
  if (t.type === "schedule") {
    const cron = typeof t.cron === "string" ? t.cron.trim() : "";
    const timezone = typeof t.timezone === "string" && t.timezone ? t.timezone : "UTC";
    if (!isValidTimeZone(timezone)) errors.push("Unknown timezone.");
    else {
      try {
        const next = nextCronRun(cron, now, timezone);
        if (!next) errors.push("This schedule never runs.");
        else {
          const gap = minGapMinutes(cron, timezone, now);
          if (gap !== null && gap < LIMITS.minIntervalMinutes) errors.push(`Schedules may run at most every ${LIMITS.minIntervalMinutes} minutes (this one runs every ${gap}).`);
          warnings.push("Runs start when the scheduler worker next ticks (every ~10 minutes), so timing is approximate.");
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : "Invalid cron expression.");
      }
    }
    trigger = { type: "schedule", cron, timezone };
  } else if (t.type === "event") {
    if (!isEventType(t.event)) errors.push(`Unknown event. Choose one of: ${EVENT_TYPES.join(", ")}.`);
    else trigger = { type: "event", event: t.event };
  } else if (t.type !== "manual") errors.push("Trigger type must be manual, schedule or event.");

  const rawSteps = Array.isArray(o.steps) ? o.steps : null;
  const steps: Step[] = [];
  if (!rawSteps || rawSteps.length === 0) errors.push("Add at least one step.");
  else if (rawSteps.length > LIMITS.steps) errors.push(`At most ${LIMITS.steps} steps.`);
  else {
    const ids: string[] = [];
    rawSteps.forEach((raw, i) => {
      const where = `Step ${i + 1}`;
      if (!isObj(raw)) { errors.push(`${where}: must be an object.`); return; }
      const id = typeof raw.id === "string" ? raw.id : "";
      if (!ID_RE.test(id)) errors.push(`${where}: id must be lowercase letters, digits or _ (start with a letter, max 20).`);
      else if (ids.includes(id)) errors.push(`${where}: duplicate id "${id}".`);
      const base: Base = { id };
      const when = validateCondition(raw.when, ids, `${where} condition`, errors);
      if (when) base.when = when;
      if (raw.onFailure !== undefined) {
        if (raw.onFailure === "stop" || raw.onFailure === "continue") base.onFailure = raw.onFailure;
        else errors.push(`${where}: onFailure must be stop or continue.`);
      }
      if (raw.maxAttempts !== undefined) {
        if (Number.isInteger(raw.maxAttempts) && (raw.maxAttempts as number) >= 1 && (raw.maxAttempts as number) <= LIMITS.maxAttempts) base.maxAttempts = raw.maxAttempts as number;
        else errors.push(`${where}: maxAttempts must be 1–${LIMITS.maxAttempts}.`);
      }
      const text = (k: string, max: number = LIMITS.text) => {
        const v = typeof raw[k] === "string" ? (raw[k] as string).trim() : "";
        if (!v) errors.push(`${where}: ${k} is required.`);
        else if (v.length > max) errors.push(`${where}: ${k} is longer than ${max} characters.`);
        return v;
      };
      if (raw.type === "tool") {
        const tool = text("tool", 100);
        if (tool && !opts.allowedTools.includes(tool)) errors.push(`${where}: "${tool}" cannot run unattended. Allowed: ${opts.allowedTools.join(", ")}.`);
        const input = raw.input === undefined ? {} : raw.input;
        if (!isObj(input)) errors.push(`${where}: input must be an object.`);
        else if (JSON.stringify(input).length > LIMITS.inputBytes) errors.push(`${where}: input is larger than ${LIMITS.inputBytes} bytes.`);
        steps.push({ ...base, type: "tool", tool, input: isObj(input) ? input : {} });
      } else if (raw.type === "agent") {
        const department = text("department", 60);
        if (department && !opts.knownDepartments.includes(department)) errors.push(`${where}: unknown department "${department}".`);
        steps.push({ ...base, type: "agent", department, task: text("task") });
      } else if (raw.type === "notify") {
        steps.push({ ...base, type: "notify", subject: text("subject", 200), message: text("message") });
      } else errors.push(`${where}: type must be tool, agent or notify.`);
      if (ID_RE.test(id)) ids.push(id);
    });
  }

  const maxAttempts = o.maxAttempts === undefined ? 1 : Number(o.maxAttempts);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > LIMITS.maxAttempts) errors.push(`Max attempts must be 1–${LIMITS.maxAttempts}.`);
  const backoff = o.backoffSeconds === undefined ? 60 : Number(o.backoffSeconds);
  if (!Number.isInteger(backoff) || backoff < 10 || backoff > 3600) errors.push("Backoff must be 10–3600 seconds.");

  if (errors.length) return { ok: false, errors };
  return { ok: true, warnings, value: { name, description, trigger, steps, maxAttempts, backoffSeconds: backoff, notifyOnFailure: o.notifyOnFailure !== false } };
}

/* ---------------- run records ---------------- */

export type StepResult = {
  id: string;
  status: "succeeded" | "failed" | "skipped" | "retrying";
  attempts: number;
  output?: unknown;
  error?: string;
  started_at?: string;
  finished_at?: string;
};

/** Keeps stored step output bounded. */
export function boundOutput(value: unknown): unknown {
  if (value === undefined) return undefined;
  const s = JSON.stringify(value);
  if (s === undefined || s.length <= LIMITS.outputBytes) return value;
  return { truncated: true, preview: s.slice(0, LIMITS.outputBytes) };
}

export function contextFrom(trigger: Record<string, unknown>, results: StepResult[]): RunContext {
  const steps: RunContext["steps"] = {};
  for (const r of results) steps[r.id] = { output: r.output, status: r.status };
  return { trigger, steps };
}
