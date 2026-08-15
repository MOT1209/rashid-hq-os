"use client";

import { createContext, useContext } from "react";
import { getDictionary, type Dictionary, type Locale } from "@/lib/i18n";
import { DEFAULT_THEME, type Theme } from "@/lib/theme";

type AppValue = { locale: Locale; t: Dictionary; theme: Theme };

const AppContext = createContext<AppValue>({
  locale: "ar",
  t: getDictionary("ar"),
  theme: DEFAULT_THEME,
});

export function useLocale() {
  return useContext(AppContext);
}

/**
 * Locale and theme both arrive already resolved from the server (cookies read
 * in src/lib/locale-server.ts), so there is nothing to detect in the browser —
 * no pre-paint script, and no first-render mismatch to hydrate through.
 */
export function Providers({
  locale,
  theme,
  children,
}: {
  locale: Locale;
  theme: Theme;
  children: React.ReactNode;
}) {
  return (
    <AppContext.Provider value={{ locale, t: getDictionary(locale), theme }}>
      {children}
    </AppContext.Provider>
  );
}
