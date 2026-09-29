import { describe, expect, it } from "vitest";
import {
  assertAuthSecretAtBuild,
  assertAuthSecretConfigured,
  AuthSecretConfigError,
  BETTER_AUTH_DEFAULT_SECRET,
} from "@/lib/env/auth-secret";

/**
 * The guard exists because Better Auth's fallback secret is a public constant:
 * production sessions signed with it can be forged by anyone. These tests pin
 * the two distinctions the guard is responsible for — production vs everything
 * else, and missing vs literal-default vs real secret.
 */

const PROD: Record<string, string> = { VERCEL_ENV: "production" };

describe("assertAuthSecretConfigured", () => {
  it("refuses production with no secret — the silent fallback is the whole point", () => {
    expect(() => assertAuthSecretConfigured(PROD)).toThrow(AuthSecretConfigError);
  });

  it("refuses production when the fallback is pasted literally", () => {
    expect(() =>
      assertAuthSecretConfigured({ ...PROD, BETTER_AUTH_SECRET: BETTER_AUTH_DEFAULT_SECRET }),
    ).toThrow(/hard-coded default/);
  });

  it("accepts production with a real secret", () => {
    expect(() =>
      assertAuthSecretConfigured({ ...PROD, BETTER_AUTH_SECRET: "a".repeat(32) }),
    ).not.toThrow();
  });

  it("never fires outside production — dev is the fallback's intended user", () => {
    expect(() => assertAuthSecretConfigured({ NODE_ENV: "development" })).not.toThrow();
    expect(() => assertAuthSecretConfigured({ VERCEL_ENV: "preview" })).not.toThrow();
  });

  it("treats a self-hosted production runtime (NODE_ENV=production, no VERCEL_ENV) as production", () => {
    // This is exactly the case the build gate cannot see — the boot check in
    // src/instrumentation.ts exists for it.
    expect(() => assertAuthSecretConfigured({ NODE_ENV: "production" })).toThrow(AuthSecretConfigError);
  });

  it("treats a whitespace-only secret as unset", () => {
    expect(() => assertAuthSecretConfigured({ ...PROD, BETTER_AUTH_SECRET: "   " })).toThrow(
      AuthSecretConfigError,
    );
  });
});

describe("assertAuthSecretAtBuild", () => {
  it("checks only the Vercel production build", () => {
    expect(() => assertAuthSecretAtBuild({ VERCEL_ENV: "production" })).toThrow(AuthSecretConfigError);
    expect(() => assertAuthSecretAtBuild({ NODE_ENV: "production" })).not.toThrow();
  });
});
