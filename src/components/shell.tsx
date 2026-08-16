"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  Activity,
  Boxes,
  KeyRound,
  LayoutDashboard,
  Languages,
  LogOut,
  Menu,
  Moon,
  Settings,
  Sun,
  X,
} from "lucide-react";
import { useLocale } from "@/components/providers";
import { setLocaleAction, setThemeAction } from "@/app/actions";
import { signOut } from "@/lib/auth-client";
import { departmentName, type Department } from "@/lib/agents";

export function Shell({
  departments,
  children,
}: {
  departments: Department[];
  children: React.ReactNode;
}) {
  const { t, locale, theme } = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const nav = [
    { href: "/dashboard", label: t.dashboard, icon: LayoutDashboard },
    { href: "/dashboard/activity", label: t.activity, icon: Activity },
    { href: "/dashboard/projects", label: t.projects, icon: Boxes },
    { href: "/dashboard/access", label: t.access, icon: KeyRound },
    { href: "/dashboard/settings", label: t.settings, icon: Settings },
  ];

  const linkClass = (href: string) =>
    `flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
      pathname === href
        ? "bg-accent-soft text-accent font-medium"
        : "text-muted hover:bg-panel-2 hover:text-text"
    }`;

  // The drawer is a navigation surface, so following a link dismisses it.
  // Doing this on click rather than in an effect keyed on pathname avoids a
  // cascading render (and a no-op on desktop, where the drawer is never open).
  const closeMenu = () => setMenuOpen(false);

  const sidebar = (
    <>
      <div className="mb-6 px-2">
        <p className="text-sm font-semibold tracking-wide text-accent">{t.brand}</p>
        <p className="text-xs text-muted">{t.subtitle}</p>
      </div>

      <nav aria-label={t.dashboard} className="space-y-1">
        {nav.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={pathname === href ? "page" : undefined}
            onClick={closeMenu}
            className={linkClass(href)}
          >
            <Icon size={16} aria-hidden />
            {label}
          </Link>
        ))}
      </nav>

      <p className="mt-6 px-3 text-xs font-medium uppercase tracking-wider text-muted">
        {t.departments}
      </p>
      <nav aria-label={t.departments} className="mt-2 space-y-1">
        {departments.map((d) => {
          const href = `/dashboard/departments/${d.key}`;
          return (
            <Link
              key={d.key}
              href={href}
              aria-current={pathname === href ? "page" : undefined}
              onClick={closeMenu}
              className={linkClass(href)}
            >
              <span aria-hidden>{d.icon}</span>
              {departmentName(d, locale)}
            </Link>
          );
        })}
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
          {theme === "dark" ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
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
          <Languages size={16} aria-hidden />
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
          <LogOut size={16} aria-hidden />
          {t.signOut}
        </button>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:rounded-xl focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:text-black"
      >
        {t.skipToContent}
      </a>

      <aside className="hidden w-64 shrink-0 border-e border-border bg-panel p-4 md:block">
        {sidebar}
      </aside>

      {/* Below md the sidebar is hidden entirely, so the drawer is the only
          way to navigate — without it small screens have no navigation. */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label={t.closeMenu}
            onClick={() => setMenuOpen(false)}
            className="absolute inset-0 bg-black/60"
          />
          <aside className="absolute inset-y-0 start-0 w-72 overflow-y-auto border-e border-border bg-panel p-4">
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              aria-label={t.closeMenu}
              className="mb-2 rounded-xl p-2 text-muted hover:bg-panel-2 hover:text-text"
            >
              <X size={18} aria-hidden />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border bg-panel px-4 py-3 md:hidden">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label={t.menu}
            aria-expanded={menuOpen}
            className="rounded-xl p-2 text-muted hover:bg-panel-2 hover:text-text"
          >
            <Menu size={20} aria-hidden />
          </button>
          <span className="text-sm font-semibold text-accent">{t.brand}</span>
        </header>

        <main id="main" className="min-w-0 flex-1 p-4 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
