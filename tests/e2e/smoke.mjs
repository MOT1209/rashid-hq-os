/**
 * Browser smoke test against a RUNNING production build (npm run build && npm start).
 *
 *   E2E_BASE_URL=http://localhost:7070 CRON_SECRET=... node tests/e2e/smoke.mjs
 *
 * Needs the app plus a reachable DATABASE_URL (Better Auth reads sessions from it;
 * a scratch Postgres with the migrations applied is enough) but no seeded owner: it checks what must hold for an
 * anonymous visitor — sign-in renders in RTL Arabic by default, protected
 * Social Studio redirects to sign-in, the CSP/security headers are present,
 * and the publishing worker rejects unauthenticated callers.
 *
 * It does NOT cover authenticated flows (upload, draft, schedule, publish,
 * history); those need a Supabase project and a seeded owner and are listed
 * as not yet automated in docs/TESTING.md.
 */
import { createRequire } from "node:module";

// Playwright is provided by the environment (not a project dependency, to keep installs small).
const { chromium } = createRequire(import.meta.url)("playwright");

const base = process.env.E2E_BASE_URL ?? "http://localhost:7070";
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` — ${detail}`}`);
  if (!ok) failures += 1;
};

const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();

  const res = await page.goto(`${base}/sign-in`, { waitUntil: "domcontentloaded" });
  check("sign-in responds 200", res?.status() === 200, String(res?.status()));
  check("sign-in is RTL Arabic by default", (await page.getAttribute("html", "dir")) === "rtl");
  check("sign-in has email and password fields", (await page.locator('input[type="email"], input[name="email"]').count()) > 0 && (await page.locator('input[type="password"]').count()) > 0);

  const h = res?.headers() ?? {};
  check("CSP header present with nonce", /script-src[^;]*'nonce-/.test(h["content-security-policy"] ?? ""));
  check("CSP forbids framing", /frame-ancestors 'none'/.test(h["content-security-policy"] ?? ""));
  check("nosniff header", h["x-content-type-options"] === "nosniff");

  await page.goto(`${base}/dashboard/social-studio`, { waitUntil: "domcontentloaded" });
  check("anonymous visitor to /dashboard/social-studio is sent to sign-in", new URL(page.url()).pathname.startsWith("/sign-in"), page.url());

  const worker = await page.request.get(`${base}/api/social/run`);
  check("worker rejects anonymous callers (401)", worker.status() === 401, String(worker.status()));
  const wrong = await page.request.get(`${base}/api/social/run`, { headers: { authorization: "Bearer wrong" } });
  check("worker rejects a wrong secret (401)", wrong.status() === 401, String(wrong.status()));

  const connect = await page.request.post(`${base}/api/integrations/youtube_publish/connect`, { data: {} });
  check("OAuth connect requires a session", [401, 403].includes(connect.status()), String(connect.status()));
  const cb = await page.request.get(`${base}/api/integrations/youtube_publish/callback?code=x&state=y`, { maxRedirects: 0 });
  check("OAuth callback without a session redirects with an error", cb.status() === 303 && /error=/.test(cb.headers()["location"] ?? ""), `${cb.status()} ${cb.headers()["location"]}`);

  if (process.env.CRON_SECRET) {
    check("(info) CRON_SECRET provided; authenticated worker run is NOT exercised here (needs a database)", true);
  }
} finally {
  await browser.close();
}
console.log(failures === 0 ? "\nAll smoke checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
