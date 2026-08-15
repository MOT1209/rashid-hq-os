"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  Activity,
  Boxes,
  KeyRound,
  LayoutDashboard,
  Languages,
  LogOut,
  Moon,
  Sun,
} from "lucide-react";
import { useLocale } from "@/components/providers";
import { setLocaleAction, setThemeAction } from "@/app/actions";
import { signOut } from "@/lib/auth-client";
import { DEPARTMENTS } from "@/lib/agents";

export function Shell({ children }: { children: React.ReactNode }) {
  const { t, locale, theme } = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const nav = [
    { href: "/dashboard", label: t.dashboard, icon: LayoutDashboard },
    { href: "/dashboard/activity", label: t.activity, icon: Activity },
    { href: "/dashboard/projects", label: t.projects, icon: Boxes },
    { href: "/dashboard/access", label: t.access, icon: KeyRound },
  ];

  const linkClass = (href: string) =>
    `flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
      pathname === href
        ? "bg-accent-soft text-accent font-medium"
        : "text-muted hover:bg-panel-2 hover:text-text"
    }`;

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 border-e border-border bg-panel p-4 md:block">
        <div className="mb-6 px-2">
          <p className="text-sm font-semibold tracking-wide text-accent">{t.brand}</p>
          <p className="text-xs text-muted">{t.subtitle}</p>
        </div>

        <nav className="space-y-1">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={linkClass(href)}>
              <Icon size={16} />
              {label}
            </Link>
          ))}
        </nav>

        <p className="mt-6 px-3 text-xs font-medium uppercase tracking-wider text-muted">
          {t.departments}
        </p>
        <nav className="mt-2 space-y-1">
          {DEPARTMENTS.map((d) => (
            <Link
              key={d.key}
              href={`/dashboard/departments/${d.key}`}
              className={linkClass(`/dashboard/departments/${d.key}`)}
            >
              <span aria-hidden>{d.icon}</span>
              {t[d.key]}
            </Link>
          ))}
        </nav>

        <div className="mt-8 space-y-1 border-t border-border pt-4">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(() => setThemeAction(theme === "dark" ? "light" : "dark"))
            }
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted hover:bg-panel-2 hover:text-text"
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            {theme === "dark" ? t.themeLight : t.themeDark}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(() => setLocaleAction(locale === "ar" ? "en" : "ar"))
            }
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted hover:bg-panel-2 hover:text-text"
          >
            <Languages size={16} />
            {locale === "ar" ? "English" : "العربية"}
          </button>
          <button
            type="button"
            onClick={() => {
              void signOut().then(() => {
                router.push("/sign-in");
                router.refresh();
              });
            }}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted hover:bg-panel-2 hover:text-text"
          >
            <LogOut size={16} />
            {t.signOut}
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
