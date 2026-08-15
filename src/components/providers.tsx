"use client";

import { createContext, useContext } from "react";
import { ThemeProvider } from "next-themes";
import { getDictionary, type Dictionary, type Locale } from "@/lib/i18n";

type LocaleValue = { locale: Locale; t: Dictionary };

const LocaleContext = createContext<LocaleValue>({
  locale: "ar",
  t: getDictionary("ar"),
});

export function useLocale() {
  return useContext(LocaleContext);
}

export function Providers({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  return (
    <LocaleContext.Provider value={{ locale, t: getDictionary(locale) }}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
        {children}
      </ThemeProvider>
    </LocaleContext.Provider>
  );
}
