/**
 * CSV serialisation for the activity export.
 *
 * Separate from the route so the escaping — the part with real edge cases —
 * is testable without a request. RFC 4180 rules: a field containing a comma,
 * quote, CR or LF is wrapped in quotes and its own quotes are doubled.
 */

function escapeField(value: unknown): string {
  if (value === null || value === undefined) return "";

  const raw = typeof value === "object" ? JSON.stringify(value) : String(value);

  // A leading =, +, - or @ is executed as a formula by Excel and Sheets when
  // the file is opened. Agent-supplied strings land in these columns, so the
  // export must not hand a spreadsheet something to run.
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;

  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** Rows are serialised in the order the columns are given. */
export function toCsv<T>(columns: { key: string; get: (row: T) => unknown }[], rows: T[]) {
  const header = columns.map((c) => escapeField(c.key)).join(",");
  const body = rows.map((row) => columns.map((c) => escapeField(c.get(row))).join(","));
  // CRLF: what RFC 4180 specifies, and what Excel expects on every platform.
  return [header, ...body].join("\r\n");
}
