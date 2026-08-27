// Stands in for `@sentry/nextjs` under Vitest. The real package pulls in the
// OpenTelemetry/instrumentation stack, which is irrelevant to unit tests and
// slow to load; tests that care about reporting mock this module themselves.
export function captureException() {}
export function captureRequestError() {}
export function captureRouterTransitionStart() {}
export function init() {}
export const logger = {
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
};
