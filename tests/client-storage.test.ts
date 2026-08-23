import { describe, expect, it } from "vitest";
import {
  parseCommandHistory,
  parseSavedFilters,
  pushCommandHistory,
} from "@/lib/client-storage";

describe("parseSavedFilters", () => {
  it("returns both fields from valid JSON", () => {
    expect(parseSavedFilters('{"projectId":"p1","status":"failed"}')).toEqual({
      projectId: "p1",
      status: "failed",
    });
  });

  it("returns an empty object for null (nothing saved yet)", () => {
    expect(parseSavedFilters(null)).toEqual({});
  });

  it("returns an empty object for malformed JSON", () => {
    expect(parseSavedFilters("{not json")).toEqual({});
  });

  it("returns an empty object for valid JSON that isn't an object", () => {
    expect(parseSavedFilters("42")).toEqual({});
    expect(parseSavedFilters("null")).toEqual({});
    expect(parseSavedFilters('"projectId"')).toEqual({});
  });

  it("drops non-string fields instead of passing them through", () => {
    expect(parseSavedFilters('{"projectId":123,"status":"failed"}')).toEqual({
      projectId: undefined,
      status: "failed",
    });
  });

  it("ignores unknown keys from a future version of this app", () => {
    expect(parseSavedFilters('{"projectId":"p1","extra":"whatever"}')).toEqual({
      projectId: "p1",
      status: undefined,
    });
  });
});

describe("parseCommandHistory", () => {
  it("parses a saved list", () => {
    expect(parseCommandHistory('["b","a"]', 20)).toEqual(["b", "a"]);
  });

  it("returns [] for null", () => {
    expect(parseCommandHistory(null, 20)).toEqual([]);
  });

  it("returns [] for malformed JSON instead of throwing", () => {
    expect(parseCommandHistory("[oops", 20)).toEqual([]);
  });

  it("returns [] when the saved value isn't an array", () => {
    expect(parseCommandHistory('{"not":"an array"}', 20)).toEqual([]);
  });

  it("drops non-string entries", () => {
    expect(parseCommandHistory('["a",1,"b",null]', 20)).toEqual(["a", "b"]);
  });

  it("caps at max, in case a newer version saved a longer list", () => {
    const saved = JSON.stringify(["a", "b", "c", "d", "e"]);
    expect(parseCommandHistory(saved, 3)).toEqual(["a", "b", "c"]);
  });
});

describe("pushCommandHistory", () => {
  it("adds a new entry to the front", () => {
    expect(pushCommandHistory(["b", "a"], "c", 20)).toEqual(["c", "b", "a"]);
  });

  it("moves a repeated entry to the front instead of duplicating it", () => {
    expect(pushCommandHistory(["c", "b", "a"], "b", 20)).toEqual(["b", "c", "a"]);
  });

  it("caps the result at max", () => {
    expect(pushCommandHistory(["a", "b"], "c", 2)).toEqual(["c", "a"]);
  });
});
