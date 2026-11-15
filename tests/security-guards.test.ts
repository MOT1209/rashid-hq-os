import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static regression guards. They read the source tree, so a new server action, API route
 * or URL-embedded secret cannot slip in without a failing test.
 */

const SRC = join(process.cwd(), "src");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const files = walk(SRC);
const rel = (f: string) => f.slice(SRC.length + 1);

/** Server actions that are deliberately open: presentation cookies only. */
const OPEN_ACTIONS = new Set(["app/actions.ts:setLocaleAction", "app/actions.ts:setThemeAction"]);

describe("server actions", () => {
  const actionFiles = files.filter((f) => /^\s*["']use server["']/.test(readFileSync(f, "utf8").slice(0, 200)));

  it("finds the action modules (guard against the scan silently matching nothing)", () => {
    expect(actionFiles.length).toBeGreaterThanOrEqual(8);
  });

  it("every exported server action calls requireAdmin() or requireSession() (except the allowlisted cookie setters)", () => {
    const unguarded: string[] = [];
    for (const f of actionFiles) {
      const src = readFileSync(f, "utf8");
      const matches = [...src.matchAll(/export\s+async\s+function\s+(\w+)\s*\(/g)];
      for (const m of matches) {
        const start = m.index! + m[0].length;
        const next = src.indexOf("\nexport ", start);
        const body = src.slice(start, next === -1 ? src.length : next);
        const key = `${rel(f)}:${m[1]}`;
        if (!/require(Admin|Session)\(/.test(body) && !OPEN_ACTIONS.has(key)) unguarded.push(key);
      }
    }
    expect(unguarded).toEqual([]);
  });

  it("mutating actions use requireAdmin (requireSession is only for the usage-log write)", () => {
    const sessionOnly: string[] = [];
    for (const f of actionFiles) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/export\s+async\s+function\s+(\w+)\s*\(/g)) {
        const start = m.index! + m[0].length;
        const next = src.indexOf("\nexport ", start);
        const body = src.slice(start, next === -1 ? src.length : next);
        if (/requireSession\(/.test(body) && !/requireAdmin\(/.test(body)) sessionOnly.push(`${rel(f)}:${m[1]}`);
      }
    }
    expect(sessionOnly).toEqual(["app/dashboard/skills/actions.ts:recordSkillUseAction"]);
  });
});

describe("API routes", () => {
  const routes = files.filter((f) => f.endsWith(`${"/"}route.ts`) && f.includes(`${"/"}app${"/"}api${"/"}`));
  const AUTH_MARKERS = ["authorizeCron(", "requireIntegrationOwner(", "checkIntegrationOwner(", "getSession(", "verifyAgentToken(", "requireAdmin(", "verifyProjectToolCall(", "verifyWebhook", "toNextJsHandler"];

  it("finds the routes", () => expect(routes.length).toBeGreaterThanOrEqual(15));

  it("every route handler contains an authentication/verification step", () => {
    const open = routes.filter((f) => !AUTH_MARKERS.some((m) => readFileSync(f, "utf8").includes(m))).map(rel);
    expect(open).toEqual([]);
  });

  it("the worker/cron routes authenticate through authorizeCron (bearer CRON_SECRET or same-origin owner)", () => {
    for (const r of ["social/run", "automation/run", "maintenance/prune", "agent/standing-tasks", "agent/daily-check"]) {
      const src = readFileSync(join(SRC, "app/api", r, "route.ts"), "utf8");
      expect(src, r).toContain("authorizeCron(");
    }
  });
});

describe("rate limiting", () => {
  it("every cron-authenticated route sits under a rate-limit rule in src/proxy.ts", () => {
    const proxy = readFileSync(join(SRC, "proxy.ts"), "utf8");
    const prefixes = [...proxy.matchAll(/\[\s*"(\/[^"]+)"\s*,\s*\{\s*windowMs/g)].map((m) => m[1]);
    expect(prefixes.length).toBeGreaterThan(5);
    const uncovered: string[] = [];
    for (const f of files.filter((x) => x.endsWith(`${"/"}route.ts`) && x.includes(`${"/"}app${"/"}api${"/"}`))) {
      if (!readFileSync(f, "utf8").includes("authorizeCron(")) continue;
      const path = `/api/${rel(f).replace(/^app\/api\//, "").replace(/\/route\.ts$/, "")}`;
      if (!prefixes.some((p) => path === p || path.startsWith(`${p}/`))) uncovered.push(path);
    }
    expect(uncovered).toEqual([]);
  });
});

describe("secrets in URLs", () => {
  it("no source file builds a URL with an access token, API key or client secret in the query string", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((line, i) => {
        // `searchParams.set("client_secret", …)` on a POST body/form is fine; a literal "?access_token=" in a URL string is not.
        if (/[?&](access_token|api_key|client_secret|refresh_token)=\$\{/.test(line)) offenders.push(`${rel(f)}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe("dangerous APIs", () => {
  it("no eval / new Function / dangerouslySetInnerHTML / child_process in application code", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (/\beval\(|new Function\(|dangerouslySetInnerHTML|child_process/.test(src)) offenders.push(rel(f));
    }
    expect(offenders).toEqual([]);
  });
});
