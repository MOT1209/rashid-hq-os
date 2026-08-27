"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { useLocale } from "@/components/providers";

/**
 * Queries now throw on database errors instead of silently returning [], so a
 * broken Supabase surfaces here rather than as a page that claims there are no
 * projects. The raw message is already sanitised in src/lib/errors.ts.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useLocale();

  useEffect(() => {
    console.error("[dashboard]", error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-lg font-semibold">{t.somethingBroke}</h1>
      <p className="mt-2 text-sm text-muted">{error.message}</p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-black"
      >
        {t.tryAgain}
      </button>
    </div>
  );
}
