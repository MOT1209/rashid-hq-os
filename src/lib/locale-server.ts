import "server-only";

import { cookies } from "next/headers";
import { DEFAULT_LOCALE, getDictionary, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

export async function getLocale() {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export async function getT() {
  return getDictionary(await getLocale());
}
