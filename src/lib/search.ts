/**
 * Matching for the project quick-search.
 *
 * Pure and separate from the component so the ranking and the Arabic-folding
 * rules can be tested directly. No fuzzy matching: with a handful of projects
 * a substring match ranked by where it hits is more predictable than a score.
 */

const MAX_RESULTS = 8;

/**
 * Folds the differences that stop an honest search from matching: case, the
 * Arabic diacritics a name may or may not carry, tatweel, and the alef/ya/ta
 * marbuta variants people type interchangeably.
 */
export function normalize(value: string): string {
  return (
    value
      .toLowerCase()
      // NFKD splits آ أ إ into a bare alef plus a combining maddah or hamza,
      // so stripping the marks below folds them for free.
      .normalize("NFKD")
      // Harakat (U+064B–U+065F), the superscript alef (U+0670), and the
      // tatweel stretch character (U+0640) carry no meaning for a search.
      .replace(/[ً-ٰٟـ]/g, "")
      // ٱ (alef wasla) has no decomposition, so it still needs folding by hand.
      .replace(/ٱ/g, "ا")
      .replace(/ى/g, "ي")
      .replace(/ة/g, "ه")
      .trim()
  );
}

/**
 * Substring matches, names starting with the query first, then alphabetical so
 * the order never depends on how the rows arrived. Capped — this is a jump
 * list, not a results page.
 */
export function matchProjects<T extends { id: string; name: string }>(
  projects: T[],
  query: string,
): T[] {
  const needle = normalize(query);
  if (!needle) return [];

  return projects
    .map((project) => ({ project, at: normalize(project.name).indexOf(needle) }))
    .filter(({ at }) => at !== -1)
    .sort(
      (a, b) =>
        Number(a.at !== 0) - Number(b.at !== 0) ||
        a.project.name.localeCompare(b.project.name),
    )
    .slice(0, MAX_RESULTS)
    .map(({ project }) => project);
}
