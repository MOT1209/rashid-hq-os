import "server-only";

/**
 * Postgres errors name tables, columns and constraints — sometimes the values
 * that tripped them. That belongs in the server log, never in a response to an
 * agent or a browser. Log the detail, return a stable generic message.
 */
export function dbError(context: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`[db] ${context}: ${detail}`);
  return new Error(`${context} failed. See server logs for details.`);
}

/** Same idea for anything that reaches a client as a plain string. */
export function safeMessage(context: string, error: unknown): string {
  return dbError(context, error).message;
}
