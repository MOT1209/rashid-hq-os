"use client";

import Link from "next/link";
import { useId, useState, useSyncExternalStore } from "react";
import { authClient } from "@/lib/auth-client";
import { useLocale } from "@/components/providers";
import { Field, FormError, fieldClass } from "@/components/ui";

const subscribe = () => () => {};

/** False during SSR and until hydration finishes — see sign-in-form.tsx. */
function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

export function ForgotPasswordForm() {
  const { t } = useLocale();
  const id = useId();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const hydrated = useHydrated();

  if (sent) {
    return (
      <div className="space-y-4">
        <p role="status" className="text-sm text-ok">
          {t.resetSent}
        </p>
        <Link href="/sign-in" className="text-sm text-accent">
          {t.backToSignIn}
        </Link>
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      method="post"
      onSubmit={async (event) => {
        event.preventDefault();
        const email = String(new FormData(event.currentTarget).get("email")).trim();
        setPending(true);
        setError(null);

        const { error: requestError } = await authClient.requestPasswordReset({
          email,
          redirectTo: "/reset-password",
        });

        setPending(false);
        // The same message either way: whether an address has an account is not
        // something an unauthenticated caller should be able to probe.
        if (requestError && requestError.status !== 200) {
          setError(requestError.message ?? t.somethingBroke);
          return;
        }
        setSent(true);
      }}
    >
      <Field id={`${id}-email`} label={t.email} hideLabel>
        <input
          id={`${id}-email`}
          name="email"
          type="email"
          autoComplete="email"
          placeholder={t.email}
          required
          className={fieldClass}
        />
      </Field>

      <button
        type="submit"
        disabled={pending || !hydrated}
        className="w-full rounded-xl bg-accent px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
      >
        {hydrated ? t.resetSendLink : t.loading}
      </button>

      {error && <FormError>{error}</FormError>}

      <Link href="/sign-in" className="block text-center text-xs text-muted hover:text-text">
        {t.backToSignIn}
      </Link>
    </form>
  );
}
