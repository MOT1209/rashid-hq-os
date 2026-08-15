import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import { getLocale } from "@/lib/locale-server";
import { dirFor } from "@/lib/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: "Alking Enterprises — CEO Command Center",
  description: "Universal executive command center for Alking Enterprises.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();

  return (
    <html lang={locale} dir={dirFor(locale)} suppressHydrationWarning>
      <body className="antialiased">
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
