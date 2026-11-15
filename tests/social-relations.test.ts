import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/errors", () => ({ dbError: (c: string) => new Error(c) }));

let queries: { table: string; filters: Record<string, unknown> }[] = [];
const OWNED = ["c1", "c2", "c3"];

vi.mock("@/lib/supabase/server", () => ({
  getServiceSupabase: () => ({
    from: (table: string) => {
      const q = { table, filters: {} as Record<string, unknown> };
      queries.push(q);
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      Object.assign(chain, {
        select: self, order: self,
        eq: (k: string, v: unknown) => { q.filters[k] = v; return chain; },
        in: (k: string, v: unknown) => { q.filters[k] = v; return chain; },
        then: (res: (v: unknown) => unknown) => {
          const ids = (q.filters.id ?? q.filters.content_id) as string[];
          let data: unknown[] = [];
          if (table === "social_content") data = OWNED.filter((i) => ids.includes(i)).map((id) => ({ id }));
          if (table === "social_content_variants") data = ids.map((content_id) => ({ id: `v-${content_id}`, content_id, platform: "youtube", options: {} }));
          if (table === "social_content_media") data = ids.filter((i) => i !== "c3").map((content_id) => ({ content_id, asset_id: `a-${content_id}`, position: 0, is_thumbnail: false }));
          return Promise.resolve({ data, error: null }).then(res);
        },
      });
      return chain;
    },
  }),
}));

const { getContentRelations } = await import("@/lib/social/store");
beforeEach(() => { queries = []; });

describe("getContentRelations", () => {
  it("uses a constant number of queries however many drafts there are", async () => {
    await getContentRelations("owner", ["c1", "c2", "c3"]);
    const three = queries.length;
    queries = [];
    await getContentRelations("owner", OWNED);
    expect(queries.length).toBe(three);
    expect(three).toBe(3); // ownership check + variants + media (was 3 per draft)
  });
  it("groups variants and media per draft", async () => {
    const m = await getContentRelations("owner", ["c1", "c2", "c3"]);
    expect(m.get("c1")!.variants.map((v) => v.id)).toEqual(["v-c1"]);
    expect(m.get("c1")!.media.map((x) => x.asset_id)).toEqual(["a-c1"]);
    expect(m.get("c3")!.media).toEqual([]);
  });
  it("never returns rows for ids the owner does not own", async () => {
    const m = await getContentRelations("owner", ["c1", "foreign"]);
    expect([...m.keys()]).toEqual(["c1"]);
    const relationQueries = queries.filter((q) => q.table !== "social_content");
    for (const q of relationQueries) expect(q.filters.content_id).toEqual(["c1"]);
  });
  it("does no queries for an empty list", async () => {
    expect((await getContentRelations("owner", [])).size).toBe(0);
    expect(queries).toHaveLength(0);
  });
});
