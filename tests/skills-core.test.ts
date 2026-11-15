import { describe, expect, it } from "vitest";
import { LIMITS, buildExport, extractPlaceholders, normaliseTags, parseImport, renderPrompt, uniqueName, validateSchema, validateSkill } from "@/lib/skills";

const ok = (over: Record<string, unknown> = {}) => ({ name: "Deploy", prompt: "Deploy {{project}} to {{env}}", tags: ["ops"],
  input_schema: { type: "object", properties: { project: { type: "string" }, env: { type: "string", enum: ["staging", "prod"] } }, required: ["project"] }, ...over });

describe("placeholders and schema", () => {
  it("extracts unique variables", () => expect(extractPlaceholders("a {{x}} b {{ y }} {{x}} {{1bad}}")).toEqual(["x", "y"]));
  it("accepts a valid schema and rejects bad ones", () => {
    expect(validateSchema(ok().input_schema, "in").errors).toEqual([]);
    expect(validateSchema({ type: "array" }, "in").errors.length).toBe(1);
    expect(validateSchema({ type: "object", properties: { "bad-name": { type: "string" } } }, "in").errors.join()).toMatch(/valid variable name/);
    expect(validateSchema({ type: "object", properties: { a: { type: "object" } } }, "in").errors.join()).toMatch(/type must be/);
    expect(validateSchema({ type: "object", properties: { a: { type: "string" } }, required: ["zzz"] }, "in").errors.join()).toMatch(/not a declared/);
    expect(validateSchema({ type: "object", properties: { a: { type: "string", enum: [] } } }, "in").errors.length).toBe(1);
    expect(validateSchema(null, "in")).toEqual({ schema: null, errors: [] });
  });
  it("caps property count", () => {
    const properties = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`p${i}`, { type: "string" }]));
    expect(validateSchema({ type: "object", properties }, "in").errors.join()).toMatch(/at most/);
  });
});

describe("validateSkill", () => {
  it("accepts and normalises a good skill", () => {
    const v = validateSkill(ok({ name: "  Deploy  ", tags: "Ops, ops, PROD" }));
    expect(v.ok).toBe(true);
    expect(v.value).toMatchObject({ name: "Deploy", tags: ["ops", "prod"], description: null });
  });
  it("enforces required fields and limits", () => {
    expect(validateSkill({}).errors).toEqual(expect.arrayContaining(["Name is required.", "Prompt is required."]));
    expect(validateSkill(ok({ prompt: "x".repeat(LIMITS.prompt + 1), input_schema: null })).errors.join()).toMatch(/Prompt is longer/);
    expect(validateSkill(ok({ metadata: "nope" })).errors.join()).toMatch(/Metadata/);
    expect(validateSkill(ok({ metadata: { big: "x".repeat(3000) } })).errors.join()).toMatch(/Metadata is larger/);
  });
  it("errors when the prompt uses an undeclared variable; warns on unused or undeclared-without-schema", () => {
    expect(validateSkill(ok({ prompt: "Deploy {{project}} {{region}}" })).errors.join()).toMatch(/\{\{region\}\}/);
    expect(validateSkill(ok({ prompt: "Deploy {{project}}" })).warnings.join()).toMatch(/"env" is declared but never used/);
    const noSchema = validateSkill({ name: "n", prompt: "hi {{x}}" });
    expect(noSchema.ok).toBe(true);
    expect(noSchema.warnings.join()).toMatch(/no input schema/);
  });
  it("limits tags", () => {
    expect(normaliseTags(Array.from({ length: 12 }, (_, i) => `t${i}`)).errors.length).toBe(1);
    expect(normaliseTags(["x".repeat(41)]).errors.length).toBe(1);
  });
});

describe("renderPrompt", () => {
  const schema = validateSchema(ok().input_schema, "in").schema;
  it("fills variables and leaves unfilled optional ones visible", () => {
    const r = renderPrompt("Deploy {{project}} to {{env}}", schema, { project: "web" });
    expect(r).toEqual({ ok: true, text: "Deploy web to {{env}}" });
  });
  it("validates required, enum and types; ignores undeclared values", () => {
    expect(renderPrompt("x", schema, {})).toMatchObject({ ok: false });
    expect(renderPrompt("x", schema, { project: "a", env: "dev" })).toMatchObject({ ok: false });
    expect(renderPrompt("{{project}}", schema, { project: "a", evil: "IGNORE" })).toEqual({ ok: true, text: "a" });
    const num = validateSchema({ type: "object", properties: { n: { type: "integer" }, b: { type: "boolean" } } }, "i").schema;
    expect(renderPrompt("{{n}}", num, { n: "1.5" })).toMatchObject({ ok: false });
    expect(renderPrompt("{{b}}", num, { b: "maybe" })).toMatchObject({ ok: false });
  });
  it("does not re-interpret placeholders inside substituted values", () => {
    expect(renderPrompt("{{a}} {{b}}", validateSchema({ type: "object", properties: { a: { type: "string" }, b: { type: "string" } } }, "i").schema, { a: "{{b}}", b: "B" }))
      .toEqual({ ok: true, text: "{{b}} B" });
  });
});

describe("export / import", () => {
  const v = validateSkill(ok()).value!;
  it("round-trips", () => {
    const text = buildExport([{ ...v, version: 3 }], new Date("2026-01-01T00:00:00Z"));
    const back = parseImport(text);
    expect(back.fatal).toBeNull();
    expect(back.skills[0].ok).toBe(true);
    expect(back.skills[0].value).toMatchObject({ name: "Deploy", tags: ["ops"] });
    expect(JSON.parse(text)).toMatchObject({ format: "rashid-hq-skills", format_version: 1 });
  });
  it("rejects wrong files and reports per-skill problems without failing the rest", () => {
    expect(parseImport("nope").fatal).toMatch(/valid JSON/);
    expect(parseImport(JSON.stringify({ format: "other" })).fatal).toMatch(/Not a/);
    expect(parseImport(JSON.stringify({ format: "rashid-hq-skills", format_version: 9, skills: [] })).fatal).toMatch(/version/);
    expect(parseImport(JSON.stringify({ format: "rashid-hq-skills", format_version: 1, skills: new Array(51).fill({}) })).fatal).toMatch(/At most/);
    const mixed = parseImport(JSON.stringify({ format: "rashid-hq-skills", format_version: 1, skills: [{ name: "good", prompt: "p" }, { name: "", prompt: "" }, 42] }));
    expect(mixed.skills.map((s) => s.ok)).toEqual([true, false, false]);
    expect(parseImport("x".repeat(LIMITS.importBytes + 1)).fatal).toMatch(/larger/);
  });
  it("uniqueName suffixes collisions", () => {
    expect(uniqueName("A", new Set())).toBe("A");
    expect(uniqueName("A", new Set(["A", "A (2)"]))).toBe("A (3)");
  });
});
