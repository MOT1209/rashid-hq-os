"use client";

import { useId, useState, useSyncExternalStore } from "react";
import { changePassword } from "@/lib/auth-client";
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

/** Matches minPasswordLength in src/lib/auth.ts; checked again server-side. */
const MIN_LENGTH = 12;

export function ChangePasswordForm() {
  const { t } = useLocale();
  const id = useId();
  const errorId = `${id}-error`;
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const hydrated = useHydrated();

  return (
    <form
      className="grid max-w-md gap-3"
      // Passwords must never reach the URL, so a submit that happens before
      // hydration goes in a POST body rather than a query string.
      method="post"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const currentPassword = String(data.get("current_password"));
        const newPassword = String(data.get("new_password"));
        const confirm = String(data.get("confirm_password"));

        setError(null);
        setDone(false);

        if (newPassword.length < MIN_LENGTH) return setError(t.passwordTooShort);
        if (newPassword !== confirm) return setError(t.passwordsDoNotMatch);
        if (newPassword === currentPassword) return setError(t.passwordSameAsOld);

        setPending(true);
        const { error: changeError } = await changePassword({
          currentPassword,
          newPassword,
          // Anything signed in elsewhere with the old password is cut off.
          revokeOtherSessions: true,
        });
        setPending(false);

        if (changeError) {
          setError(changeError.message ?? t.somethingBroke);
          return;
        }
        form.reset();
        setDone(true);
      }}
    >
      <Field id={`${id}-current`} label={t.currentPassword}>
        <input
          id={`${id}-current`}
          name="current_password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={fieldClass}
        />
      </Field>

      <Field id={`${id}-new`} label={t.newPassword}>
        <input
          id={`${id}-new`}
          name="new_password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_LENGTH}
          required
          aria-describedby={error ? errorId : undefined}
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
          aria-describedby={error ? errorId : undefined}
          className={fieldClass}
        />
      </Field>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending || !hydrated}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
        >
          {hydrated ? t.changePassword : t.loading}
        </button>
        {error && <FormError id={errorId}>{error}</FormError>}
        {done && (
          <p role="status" className="text-xs text-ok">
            {t.passwordChanged}
          </p>
        )}
      </div>
    </form>
  );
}
