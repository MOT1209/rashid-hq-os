/**
 * Tolerating a schema that is behind the code.
 *
 * Production applies migrations by hand (`npm run migrate:apply`) while Vercel
 * deploys `main` automatically, so for a while the new code can run against the
 * previous schema. The audit's #1 finding was exactly this drift. Reads that the
 * EXISTING pages depend on must therefore fall back to the old column set when a
 * newer column does not exist yet, instead of breaking those pages.
 *
 * Only "column/table does not exist" counts: every other error is still an error.
 */
export function isMissingColumn(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  const msg = e.message ?? "";
  return (
    e.code === "42703" || // Postgres: undefined_column
    e.code === "PGRST204" || // PostgREST: column not in schema cache
    /column [^ ]+ does not exist/i.test(msg) ||
    /could not find the '[^']+' column/i.test(msg)
  );
}
