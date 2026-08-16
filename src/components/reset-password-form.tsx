"use client";

import Link from "next/link";
import { useId, useState, useSyncExternalStore } from "react";
import { authClient } from "@/lib/auth-client";
import { useLocale } from "@/components/providers";
import { Field, FormError, fieldClass } from "@/components/ui";

const subscribe = () => () => {};

function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

/** Matches minPasswordLength in src/lib/auth.ts; checked again server-side. */
const MIN_LENGTH = 12;

export function ResetPasswordForm({ token }: { token: string | null }) {
  const { t } = useLocale();
  const id = useId();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const hydrated = useHydrated();

  if (!token) {
    return (
      <div className="space-y-4">
        <FormError>{t.resetInvalidLink}</FormError>
        <Link href="/forgot-password" className="text-sm text-accent">
          {t.resetPassword}
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="space-y-4">
        <p role="status" className="text-sm text-ok">
          {t.resetDone}
        </p>
        <Link href="/sign-in" className="text-sm text-accent">
          {t.signIn}
        </Link>
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      // A GET fallback would put the new password in the URL.
      method="post"
      onSubmit={async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const newPassword = String(data.get("new_password"));
        const confirm = String(data.get("confirm_password"));

        setError(null);
        if (newPassword.length < MIN_LENGTH) return setError(t.passwordTooShort);
        if (newPassword !== confirm) return setError(t.passwordsDoNotMatch);

        setPending(true);
        const { error: resetError } = await authClient.resetPassword({
          newPassword,
          token,
        });
        setPending(false);

        if (resetError) {
          setError(resetError.message ?? t.resetInvalidLink);
          return;
        }
        setDone(true);
      }}
    >
      <Field id={`${id}-new`} label={t.newPassword}>
        <input
          id={`${id}-new`}
          name="new_password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_LENGTH}
          required
          className={fieldClass}
        />
      </Field>

      <Field id={`${id}-confirm`} label={t.confirmPassword}>
        <input
          id={`${id}-confirm`}
          name="confirm_password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_LENGTH}
          required
          className={fieldClass}
        />
      </Field>

      <button
        type="submit"
        disabled={pending || !hydrated}
        className="w-full rounded-xl bg-accent px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
      >
        {hydrated ? t.resetPassword : t.loading}
      </button>

      {error && <FormError>{error}</FormError>}
    </form>
  );
}
