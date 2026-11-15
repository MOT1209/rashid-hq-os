import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ getServiceSupabase: () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));
vi.mock("@/lib/cron-auth", () => ({ authorizeCron: async () => true }));

const { GET } = await import("@/app/api/maintenance/prune/route");
beforeEach(() => { rpc.mockReset(); delete process.env.SOCIAL_RETENTION; delete process.env.AUTOMATION_RETENTION; });

describe("/api/maintenance/prune", () => {
  it("prunes logs, automation runs and social data with the documented windows", async () => {
    rpc.mockImplementation(async (fn: string) => ({ data: { prune_agent_logs: 5, prune_automation_runs: 3, prune_social_data: 2 }[fn], error: null }));
    const body = await (await GET(new Request("https://x/api/maintenance/prune"))).json();
    expect(body).toEqual({ removed: 5, automationRuns: 3, socialData: 2 });
    expect(rpc).toHaveBeenCalledWith("prune_automation_runs", { older_than: "90 days" });
    expect(rpc).toHaveBeenCalledWith("prune_social_data", { older_than: "180 days" });
  });
  it("honours the retention env vars", async () => {
    process.env.SOCIAL_RETENTION = "30 days";
    rpc.mockResolvedValue({ data: 0, error: null });
    await GET(new Request("https://x/api/maintenance/prune"));
    expect(rpc).toHaveBeenCalledWith("prune_social_data", { older_than: "30 days" });
  });
  it("a missing new function (migration not applied) does not fail the log prune", async () => {
    rpc.mockImplementation(async (fn: string) => (fn === "prune_agent_logs" ? { data: 7, error: null } : { data: null, error: { message: "function does not exist" } }));
    const res = await GET(new Request("https://x/api/maintenance/prune"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: 7, automationRuns: null, socialData: null });
  });
  it("still fails (500) when the activity-log prune itself fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect((await GET(new Request("https://x/api/maintenance/prune"))).status).toBe(500);
  });
});
