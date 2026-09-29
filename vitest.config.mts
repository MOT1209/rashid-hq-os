import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws when imported outside a React Server Component.
      // Under Vitest these modules are plain Node, so stub it out.
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
      // The real @sentry/nextjs drags in the OTel instrumentation stack; unit
      // tests that assert on reporting mock it explicitly.
      "@sentry/nextjs": fileURLToPath(new URL("./tests/stubs/sentry.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The first-run transpile of the whole project is slow on a cold machine;
    // a file that does real DB/parse work can legitimately cross 5 s.
    testTimeout: 15_000,
  },
  // Workaround for Windows paths with spaces causing spawn EPERM
  // See: https://github.com/vitejs/vite/issues/15714
  optimizeDeps: {
    disabled: true,
  },
  esbuild: {
    // Use esbuild instead of rolldown to avoid Windows path issues
    target: "node18",
  },
});
