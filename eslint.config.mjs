import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored agent skills (skills-lock.json). Third-party instruction files
    // and their example scripts, linted by whoever publishes them — holding
    // them to this app's rules only reports on code we do not maintain.
    ".agents/skills/**",
  ]),
]);

export default eslintConfig;
