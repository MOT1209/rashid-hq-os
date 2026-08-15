import "server-only";

import { cookies } from "next/headers";
import { DEFAULT_LOCALE, getDictionary, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { DEFAULT_THEME, isTheme, THEME_COOKIE } from "@/lib/theme";

export async function getLocale() {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/**
 * Theme is resolved on the server, exactly like the locale, so <html> ships
 * with the right class already applied — no pre-paint script, no flash, and
 * nothing for the client to disagree with during hydration.
 */
export async function getTheme() {
  const value = (await cookies()).get(THEME_COOKIE)?.value;
  return isTheme(value) ? value : DEFAULT_THEME;
}

export async function getT() {
  return getDictionary(await getLocale());
}
