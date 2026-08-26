/**
 * When the scheduled health check should mail the owners.
 *
 * Kept separate from the cron route so the decision — the part that is easy to
 * get subtly wrong — can be tested against a plain list of statuses instead of
 * a mocked database.
 */

/**
 * Consecutive failed runs before the owners are mailed. Three days of silence
 * is a real outage; one is usually a blip on the far end.
 */
export const ALERT_AFTER = 3;

/**
 * True only on the run where the failure streak *reaches* ALERT_AFTER: the
 * newest runs are all failures and the run before them was not. Alerting on
 * `>=` instead would mail every single day for as long as the endpoint stayed
 * down.
 *
 * `statuses` must be newest-first and include the run just recorded.
 */
export function crossedFailureThreshold(statuses: string[]): boolean {
  if (statuses.length < ALERT_AFTER) return false;

  const newest = statuses.slice(0, ALERT_AFTER);
  if (!newest.every((status) => status === "failed")) return false;

  // Nothing older at all means this streak is also its first crossing.
  const previous = statuses[ALERT_AFTER];
  return previous === undefined || previous !== "failed";
}
