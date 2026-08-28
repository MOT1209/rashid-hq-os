import { describe, expect, it } from "vitest";
import { z } from "zod";
import { TOOLS } from "@/lib/mcp/tools";

/**
 * The regression this locks down (plan.md): Groq sends `null`, not `undefined`,
 * for an optional tool parameter it chooses to omit. Every `.optional()` field
 * then threw provider-side validation — and the mocked test suite passed
 * either way because it never runs provider validation.
 *
 * Rule: any field that accepts `undefined` (i.e. the model may omit it) MUST
 * also accept `null`. `.nullish()` satisfies this; `.optional()` does not.
 */

const CASES = TOOLS.flatMap((tool) => {
  const shape = (tool.schema as z.ZodObject<z.ZodRawShape>).shape ?? {};
  return Object.entries(shape).map(([field, schema]) => ({
    tool: tool.name,
    field,
    schema: schema as z.ZodTypeAny,
  }));
});

describe("every optional tool parameter also accepts null", () => {
  it.each(CASES)("$tool.$field", ({ schema }) => {
    const acceptsUndefined = schema.safeParse(undefined).success;
    if (!acceptsUndefined) return; // a required field: rejecting null is correct
    expect(schema.safeParse(null).success).toBe(true);
  });
});

describe("tool input JSON Schema is stable", () => {
  it.each(TOOLS.map((t) => ({ name: t.name, tool: t })))("$name", ({ tool }) => {
    // A snapshot so a change in how a schema serialises to JSON Schema — which
    // is what the model actually sees — is a deliberate, reviewed change.
    expect(z.toJSONSchema(tool.schema, { io: "input" })).toMatchSnapshot();
  });
});
