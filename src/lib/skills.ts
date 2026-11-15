/**
 * Skills Manager rules (pure, browser-safe, tested).
 *
 * A skill is a saved prompt template. Optional `input_schema` declares the
 * `{{variables}}` the prompt uses; `output_schema` documents what a good
 * answer looks like (informational: no model runs a skill by itself).
 */

export const FORMAT = "rashid-hq-skills";
export const FORMAT_VERSION = 1;

export const LIMITS = {
  name: 200,
  description: 500,
  prompt: 4000,
  tags: 10,
  tagLength: 40,
  props: 20,
  propDescription: 200,
  enumValues: 20,
  importSkills: 50,
  importBytes: 500_000,
  metadataBytes: 2_000,
} as const;

export const PROP_TYPES = ["string", "number", "integer", "boolean"] as const;
type PropType = (typeof PROP_TYPES)[number];

export type SchemaProp = { type: PropType; description?: string; enum?: string[] };
export type SkillSchema = { type: "object"; properties: Record<string, SchemaProp>; required?: string[] };

export type SkillDraft = {
  name: string;
  description: string | null;
  prompt: string;
  tags: string[];
  input_schema: SkillSchema | null;
  output_schema: SkillSchema | null;
  metadata: Record<string, unknown>;
};

const NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,39}$/;
const PLACEHOLDER = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export function extractPlaceholders(prompt: string): string[] {
  return [...new Set([...prompt.matchAll(PLACEHOLDER)].map((m) => m[1]))];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Validates a schema-like value; returns normalised schema or errors. */
export function validateSchema(value: unknown, label: string): { schema: SkillSchema | null; errors: string[] } {
  if (value == null) return { schema: null, errors: [] };
  const errors: string[] = [];
  if (!isObj(value) || value.type !== "object" || !isObj(value.properties)) {
    return { schema: null, errors: [`${label}: must be { "type": "object", "properties": { … } }.`] };
  }
  const names = Object.keys(value.properties);
  if (names.length > LIMITS.props) errors.push(`${label}: at most ${LIMITS.props} properties.`);
  const properties: Record<string, SchemaProp> = {};
  for (const n of names.slice(0, LIMITS.props)) {
    const p = (value.properties as Record<string, unknown>)[n];
    if (!NAME_RE.test(n)) errors.push(`${label}: "${n}" is not a valid variable name (letters, digits, underscore; max 40).`);
    if (!isObj(p) || !(PROP_TYPES as readonly string[]).includes(p.type as string)) {
      errors.push(`${label}.${n}: type must be one of ${PROP_TYPES.join(", ")}.`);
      continue;
    }
    const prop: SchemaProp = { type: p.type as PropType };
    if (typeof p.description === "string") prop.description = p.description.slice(0, LIMITS.propDescription);
    if (p.enum !== undefined) {
      if (!Array.isArray(p.enum) || p.enum.length === 0 || p.enum.length > LIMITS.enumValues || !p.enum.every((e) => typeof e === "string")) {
        errors.push(`${label}.${n}: enum must be 1–${LIMITS.enumValues} strings.`);
      } else prop.enum = p.enum as string[];
    }
    properties[n] = prop;
  }
  let required: string[] | undefined;
  if (value.required !== undefined) {
    if (!Array.isArray(value.required) || !value.required.every((r) => typeof r === "string")) errors.push(`${label}: required must be a list of names.`);
    else {
      required = value.required as string[];
      for (const r of required) if (!(r in properties)) errors.push(`${label}: required "${r}" is not a declared property.`);
    }
  }
  return { schema: errors.length ? null : { type: "object", properties, ...(required ? { required } : {}) }, errors };
}

export function normaliseTags(raw: unknown): { tags: string[]; errors: string[] } {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,،\n]/) : [];
  const tags = [...new Set(list.map((t) => String(t).trim().toLowerCase()).filter(Boolean))];
  const errors: string[] = [];
  if (tags.length > LIMITS.tags) errors.push(`At most ${LIMITS.tags} tags.`);
  if (tags.some((t) => t.length > LIMITS.tagLength)) errors.push(`Tags are limited to ${LIMITS.tagLength} characters.`);
  return { tags: tags.slice(0, LIMITS.tags).map((t) => t.slice(0, LIMITS.tagLength)), errors };
}

export type Validation = { ok: boolean; value: SkillDraft | null; errors: string[]; warnings: string[] };

/** Validates and normalises one skill (from a form or an import). Never trusts types. */
export function validateSkill(input: unknown): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const o = isObj(input) ? input : {};
  const name = typeof o.name === "string" ? o.name.trim() : "";
  const prompt = typeof o.prompt === "string" ? o.prompt.trim() : "";
  const description = typeof o.description === "string" && o.description.trim() ? o.description.trim() : null;

  if (!name) errors.push("Name is required.");
  else if (name.length > LIMITS.name) errors.push(`Name is longer than ${LIMITS.name} characters.`);
  if (!prompt) errors.push("Prompt is required.");
  else if (prompt.length > LIMITS.prompt) errors.push(`Prompt is longer than ${LIMITS.prompt} characters.`);
  if (description && description.length > LIMITS.description) errors.push(`Description is longer than ${LIMITS.description} characters.`);

  const t = normaliseTags(o.tags);
  errors.push(...t.errors);
  const inS = validateSchema(o.input_schema, "input schema");
  const outS = validateSchema(o.output_schema, "output schema");
  errors.push(...inS.errors, ...outS.errors);

  let metadata: Record<string, unknown> = {};
  if (o.metadata !== undefined && o.metadata !== null) {
    if (!isObj(o.metadata)) errors.push("Metadata must be a JSON object.");
    else if (JSON.stringify(o.metadata).length > LIMITS.metadataBytes) errors.push(`Metadata is larger than ${LIMITS.metadataBytes} bytes.`);
    else metadata = o.metadata;
  }

  // Variables used in the prompt vs declared inputs.
  const used = extractPlaceholders(prompt);
  if (inS.schema) {
    const declared = Object.keys(inS.schema.properties);
    for (const u of used) if (!declared.includes(u)) errors.push(`The prompt uses {{${u}}} but the input schema does not declare it.`);
    for (const d of declared) if (!used.includes(d)) warnings.push(`Input "${d}" is declared but never used in the prompt.`);
  } else if (used.length > 0) {
    warnings.push(`The prompt uses ${used.map((u) => `{{${u}}}`).join(", ")} but no input schema declares them.`);
  }

  if (errors.length) return { ok: false, value: null, errors, warnings };
  return { ok: true, errors, warnings, value: { name, description, prompt, tags: t.tags, input_schema: inS.schema, output_schema: outS.schema, metadata } };
}

/** Fills {{variables}} from values using the input schema (required/enum/type checks). */
export function renderPrompt(prompt: string, schema: SkillSchema | null, values: Record<string, unknown>): { ok: true; text: string } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const props = schema?.properties ?? {};
  for (const r of schema?.required ?? []) if (values[r] === undefined || values[r] === "") errors.push(`"${r}" is required.`);
  const coerced: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    const p = props[k];
    if (v === undefined || v === "") continue;
    if (!p) continue; // unknown values are ignored, never injected
    const s = String(v);
    if (p.type === "number" && !Number.isFinite(Number(s))) errors.push(`"${k}" must be a number.`);
    else if (p.type === "integer" && !Number.isInteger(Number(s))) errors.push(`"${k}" must be an integer.`);
    else if (p.type === "boolean" && !["true", "false"].includes(s)) errors.push(`"${k}" must be true or false.`);
    else if (p.enum && !p.enum.includes(s)) errors.push(`"${k}" must be one of: ${p.enum.join(", ")}.`);
    else coerced[k] = s.slice(0, 1000);
  }
  if (errors.length) return { ok: false, errors };
  // Unfilled optional variables are left visible so the owner notices them.
  return { ok: true, text: prompt.replace(PLACEHOLDER, (m, name: string) => (name in coerced ? coerced[name] : m)) };
}

/** "name" → "name (2)" when taken. */
export function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  for (let i = 2; i < 1000; i++) {
    const c = `${name.slice(0, LIMITS.name - 8)} (${i})`;
    if (!taken.has(c)) return c;
  }
  return `${name.slice(0, LIMITS.name - 12)} (${Date.now()})`;
}

export type ExportableSkill = SkillDraft & { version: number };

export function buildExport(skills: ExportableSkill[], now: Date = new Date()): string {
  return JSON.stringify(
    {
      format: FORMAT,
      format_version: FORMAT_VERSION,
      exported_at: now.toISOString(),
      skills: skills.map((s) => ({ name: s.name, description: s.description, prompt: s.prompt, tags: s.tags, input_schema: s.input_schema, output_schema: s.output_schema, metadata: s.metadata, version: s.version })),
    },
    null,
    2,
  );
}

export type ImportResult = { skills: Validation[]; fatal: string | null };

/** Parses an export bundle. Per-skill problems are reported, not thrown, so one bad entry does not block the rest. */
export function parseImport(text: string): ImportResult {
  if (text.length > LIMITS.importBytes) return { skills: [], fatal: `File is larger than ${LIMITS.importBytes / 1000} KB.` };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { skills: [], fatal: "The file is not valid JSON." };
  }
  if (!isObj(data) || data.format !== FORMAT) return { skills: [], fatal: `Not a ${FORMAT} file.` };
  if (data.format_version !== FORMAT_VERSION) return { skills: [], fatal: `Unsupported format version ${String(data.format_version)}.` };
  if (!Array.isArray(data.skills)) return { skills: [], fatal: "The file has no skills list." };
  if (data.skills.length > LIMITS.importSkills) return { skills: [], fatal: `At most ${LIMITS.importSkills} skills per import.` };
  return { skills: data.skills.map(validateSkill), fatal: null };
}
