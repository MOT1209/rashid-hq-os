import { describe, expect, it } from "vitest";
import { ALERT_AFTER, crossedFailureThreshold } from "@/lib/health-alert";

/**
 * The alert fires on the run where the streak *reaches* the threshold, never
 * again while it holds. Getting that wrong in either direction is silent: too
 * eager mails the owners every day of an outage, too lazy never mails at all.
 */
describe("crossedFailureThreshold", () => {
  const failed = (n: number) => Array<string>(n).fill("failed");

  it("fires on exactly the run that reaches the threshold", () => {
    expect(crossedFailureThreshold([...failed(ALERT_AFTER), "success"])).toBe(true);
  });

  it("fires when there is no earlier run at all", () => {
    expect(crossedFailureThreshold(failed(ALERT_AFTER))).toBe(true);
  });

  it("stays quiet once the streak is already past the threshold", () => {
    // Same outage, one day later: the run before the window also failed.
    expect(crossedFailureThreshold(failed(ALERT_AFTER + 1))).toBe(false);
  });

  it("stays quiet below the threshold", () => {
    for (let n = 0; n < ALERT_AFTER; n++) {
      expect(crossedFailureThreshold(failed(n)), `${n} failures`).toBe(false);
    }
  });

  it("stays quiet when the most recent run recovered", () => {
    expect(crossedFailureThreshold(["success", ...failed(ALERT_AFTER)])).toBe(false);
  });

  it("stays quiet when a success interrupts the window", () => {
    const statuses = failed(ALERT_AFTER);
    statuses[1] = "success";
    expect(crossedFailureThreshold(statuses)).toBe(false);
  });

  it("treats a pending run as not-a-failure rather than counting it", () => {
    const statuses = failed(ALERT_AFTER);
    statuses[0] = "pending";
    expect(crossedFailureThreshold(statuses)).toBe(false);
  });

  it("handles an empty history", () => {
    expect(crossedFailureThreshold([])).toBe(false);
  });
});
