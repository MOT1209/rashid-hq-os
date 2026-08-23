/**
 * Pure parsing helpers for the localStorage-backed UI state (command history,
 * activity filters). Split out from the components that use them so the
 * "malformed JSON in storage" edge cases — a corrupt value, a value written by
 * an older version of this app, private-mode storage that silently no-ops —
 * are testable without mounting a component or mocking the DOM.
 */

export type SavedFilters = { projectId?: string; status?: string };

/** Never throws: bad JSON, the wrong shape, or non-string values all fall back safely. */
export function parseSavedFilters(raw: string | null): SavedFilters {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const { projectId, status } = parsed as Record<string, unknown>;
    return {
      projectId: typeof projectId === "string" ? projectId : undefined,
      status: typeof status === "string" ? status : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * The console's command history. `max` matches MAX_HISTORY in ceo-console.tsx
 * — re-applied here too, since a value saved by a future version with a
 * higher cap should not balloon this one's list past what it expects to show.
 */
export function parseCommandHistory(raw: string | null, max: number): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((h): h is string => typeof h === "string").slice(0, max);
  } catch {
    return [];
  }
}

/** Most-recent-first, deduplicated, capped at `max`. */
export function pushCommandHistory(history: string[], entry: string, max: number): string[] {
  return [entry, ...history.filter((h) => h !== entry)].slice(0, max);
}
