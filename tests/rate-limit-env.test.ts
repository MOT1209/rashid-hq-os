import { describe, expect, it } from "vitest";
import {
  assertRateLimitBackendAtBuild,
  isProductionRuntime,
  RateLimitConfigError,
  resolveRateLimitBackend,
} from "@/lib/env/rate-limit";

/**
 * The in-memory throttle counts per instance, so on a multi-instance
 * production host it does not actually limit. Production must refuse to run
 * on it unless the operator opts in by name.
 */

const REDIS = { KV_REST_API_URL: "https://eu1-x.upstash.io", KV_REST_API_TOKEN: "tok" };

describe("isProductionRuntime", () => {
  it("prefers VERCEL_ENV, so a preview build (NODE_ENV=production) is not production", () => {
    expect(isProductionRuntime({ VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe(false);
    expect(isProductionRuntime({ VERCEL_ENV: "production" })).toBe(true);
  });

  it("falls back to NODE_ENV off Vercel", () => {
    expect(isProductionRuntime({ NODE_ENV: "production" })).toBe(true);
    expect(isProductionRuntime({ NODE_ENV: "development" })).toBe(false);
  });
});

describe("resolveRateLimitBackend", () => {
  it("uses Redis when both variables are set", () => {
    expect(resolveRateLimitBackend({ ...REDIS, NODE_ENV: "production" })).toEqual({
      kind: "redis",
      url: REDIS.KV_REST_API_URL,
      token: "tok",
    });
  });

  it("allows the in-memory fallback outside production", () => {
    expect(resolveRateLimitBackend({ NODE_ENV: "development" }).kind).toBe("memory");
    expect(resolveRateLimitBackend({ VERCEL_ENV: "preview", NODE_ENV: "production" }).kind).toBe(
      "memory",
    );
  });

  it("refuses to run in production without Redis", () => {
    expect(() => resolveRateLimitBackend({ VERCEL_ENV: "production" })).toThrow(
      RateLimitConfigError,
    );
    expect(() => resolveRateLimitBackend({ NODE_ENV: "production" })).toThrow(/KV_REST_API_URL/);
  });

  it("treats blank values as missing", () => {
    expect(() =>
      resolveRateLimitBackend({
        NODE_ENV: "production",
        KV_REST_API_URL: "  ",
        KV_REST_API_TOKEN: "",
      }),
    ).toThrow(RateLimitConfigError);
  });

  it("honours the explicit single-instance opt-out, and only the exact value 1", () => {
    expect(
      resolveRateLimitBackend({ NODE_ENV: "production", RATE_LIMIT_ALLOW_IN_MEMORY: "1" }).kind,
    ).toBe("memory");
    expect(() =>
      resolveRateLimitBackend({ NODE_ENV: "production", RATE_LIMIT_ALLOW_IN_MEMORY: "true" }),
    ).toThrow(RateLimitConfigError);
  });

  it("rejects a half-configured pair in every environment", () => {
    expect(() =>
      resolveRateLimitBackend({ NODE_ENV: "development", KV_REST_API_URL: REDIS.KV_REST_API_URL }),
    ).toThrow(/KV_REST_API_TOKEN is missing/);
    expect(() =>
      resolveRateLimitBackend({ NODE_ENV: "development", KV_REST_API_TOKEN: "tok" }),
    ).toThrow(/KV_REST_API_URL is missing/);
  });

  it("rejects a non-https Redis URL in production", () => {
    expect(() =>
      resolveRateLimitBackend({
        NODE_ENV: "production",
        KV_REST_API_URL: "http://eu1-x.upstash.io",
        KV_REST_API_TOKEN: "tok",
      }),
    ).toThrow(/https/);
  });
});

describe("assertRateLimitBackendAtBuild", () => {
  it("only gates Vercel production builds", () => {
    // Local/CI `next build` sets NODE_ENV=production with no VERCEL_ENV.
    expect(() => assertRateLimitBackendAtBuild({ NODE_ENV: "production" })).not.toThrow();
    expect(() => assertRateLimitBackendAtBuild({ VERCEL_ENV: "preview" })).not.toThrow();
    expect(() => assertRateLimitBackendAtBuild({ VERCEL_ENV: "production" })).toThrow(
      RateLimitConfigError,
    );
    expect(() => assertRateLimitBackendAtBuild({ VERCEL_ENV: "production", ...REDIS })).not.toThrow();
  });
});
