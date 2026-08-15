export type Theme = "dark" | "light";

export const DEFAULT_THEME: Theme = "dark";
export const THEME_COOKIE = "hq_theme";

export function isTheme(value: string | undefined): value is Theme {
  return value === "dark" || value === "light";
}
