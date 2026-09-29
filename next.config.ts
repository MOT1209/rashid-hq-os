import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { assertRateLimitBackendAtBuild } from "./src/lib/env/rate-limit";
import { assertAuthSecretAtBuild } from "./src/lib/env/auth-secret";

// Fail the Vercel production build, not the live deployment, when the shared
// rate-limit store is missing: a failed build keeps the previous deployment
// serving. No-op for local, CI and preview builds (see the function).
assertRateLimitBackendAtBuild();

// Same gate for the Better Auth signing secret: production must never boot on
// the library's hard-coded public fallback (or on it pasted literally), or
// anyone can mint a valid session cookie. Failing the build keeps the last
// good deployment serving instead.
assertAuthSecretAtBuild();

const nextConfig: NextConfig = {
  // `pg` is a native-ish driver used by Better Auth; keep it out of the bundle.
  serverExternalPackages: ["pg"],
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Build-time secret, distinct from the DSN. Unset (locally, or before the
  // project is provisioned) simply skips source-map upload — the build still
  // succeeds and runtime error capture is unaffected.
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Better client-side stack traces.
  widenClientFileUpload: true,

  // Same-origin proxy route so ad blockers do not eat error reports. Excluded
  // from the throttle and nonce handling in src/proxy.ts.
  tunnelRoute: "/monitoring",

  // Quiet unless running in CI.
  silent: !process.env.CI,
});
