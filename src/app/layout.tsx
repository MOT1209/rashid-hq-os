import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import { getLocale, getTheme } from "@/lib/locale-server";
import { dirFor } from "@/lib/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: "Alking Enterprises — CEO Command Center",
  description: "Universal executive command center for Alking Enterprises.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [locale, theme] = await Promise.all([getLocale(), getTheme()]);

  return (
    // The theme class is rendered server-side, so the first paint is already
    // correct. suppressHydrationWarning stays only to tolerate extensions that
    // mutate <html> before React loads.
    <html
      lang={locale}
      dir={dirFor(locale)}
      className={theme === "dark" ? "dark" : undefined}
      suppressHydrationWarning
    >
      <body className="antialiased">
        <Providers locale={locale} theme={theme}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
