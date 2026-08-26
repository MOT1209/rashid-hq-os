import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/csv";

/**
 * Agent-supplied strings (tool names, payloads, project names) land in these
 * cells, so the escaping is the boundary between "a spreadsheet" and "a file
 * that breaks, leaks into the next column, or runs a formula on open".
 */

type Row = { a: unknown; b?: unknown };
const cols = [
  { key: "a", get: (r: Row) => r.a },
  { key: "b", get: (r: Row) => r.b },
];
const body = (rows: Row[]) => toCsv(cols, rows).split("\r\n").slice(1);

describe("toCsv", () => {
  it("writes a header from the column keys", () => {
    expect(toCsv(cols, []).split("\r\n")).toEqual(["a,b"]);
  });

  it("separates rows with CRLF, as RFC 4180 specifies", () => {
    expect(toCsv(cols, [{ a: 1, b: 2 }])).toBe("a,b\r\n1,2");
  });

  it("quotes a field containing a comma so it cannot leak into the next column", () => {
    expect(body([{ a: "one,two", b: "x" }])).toEqual(['"one,two",x']);
  });

  it("doubles embedded quotes", () => {
    expect(body([{ a: 'say "hi"' }])).toEqual(['"say ""hi""",']);
  });

  it("quotes newlines instead of breaking the row apart", () => {
    // Asserted on the whole document, not via the CRLF split the other cases
    // use — an embedded newline is exactly what that split cannot survive,
    // which is the point of quoting it.
    expect(toCsv(cols, [{ a: "line1\nline2" }])).toBe('a,b\r\n"line1\nline2",');
    expect(toCsv(cols, [{ a: "line1\r\nline2" }])).toBe('a,b\r\n"line1\r\nline2",');
  });

  it("renders null and undefined as empty, not as the words", () => {
    expect(body([{ a: null, b: undefined }])).toEqual([","]);
  });

  it("serialises objects as JSON so a payload column stays one cell", () => {
    expect(body([{ a: { ok: true } }])).toEqual(['"{""ok"":true}",']);
  });

  it("neutralises spreadsheet formulas", () => {
    // Excel and Sheets execute these on open unless the leading character is
    // defused — a tool name is attacker-controlled text, not a formula.
    for (const attack of ["=1+1", "+1", "-1", "@SUM(A1)"]) {
      expect(body([{ a: attack }])[0], attack).toBe(`'${attack},`);
    }
  });

  it("quotes a formula that also contains a comma", () => {
    expect(body([{ a: "=HYPERLINK(1,2)" }])).toEqual(["\"'=HYPERLINK(1,2)\","]);
  });

  it("leaves ordinary text untouched", () => {
    expect(body([{ a: "health_check", b: "success" }])).toEqual([
      "health_check,success",
    ]);
  });
});
