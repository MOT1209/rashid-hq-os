"use client";

import { useId, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "@/lib/auth-client";
import { useLocale } from "@/components/providers";
import { Field, FormError, fieldClass } from "@/components/ui";

const subscribe = () => () => {};

/**
 * False during SSR and until hydration finishes. Sign-in runs entirely in the
 * submit handler, so before hydration there is nothing to call preventDefault()
 * — the browser would fall back to a native submit.
 */
function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

export function SignInForm({ denied = false }: { denied?: boolean }) {
  const { t } = useLocale();
  const router = useRouter();
  const id = useId();
  const errorId = `${id}-error`;
  const [error, setError] = useState<string | null>(denied ? t.accessDenied : null);
  const [pending, setPending] = useState(false);
  const hydrated = useHydrated();

  return (
    <form
      className="space-y-3"
      // A GET fallback would put the email and password in the URL — and so in
      // history, logs and referrers. POST keeps a pre-hydration submit in the
      // request body; the disabled button below makes it unreachable anyway.
      method="post"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setPending(true);
        setError(null);

        const { error: signInError } = await signIn.email({
          email: String(form.get("email")),
          password: String(form.get("password")),
        });

        setPending(false);
        if (signInError) {
          setError(signInError.message ?? t.signInFailed);
          return;
        }
        router.push("/dashboard");
        router.refresh();
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
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={fieldClass}
        />
      </Field>

      <Field id={`${id}-password`} label={t.password} hideLabel>
        <input
          id={`${id}-password`}
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder={t.password}
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={fieldClass}
        />
      </Field>

      <button
        type="submit"
        disabled={pending || !hydrated}
        className="w-full rounded-xl bg-accent px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
      >
        {hydrated ? t.signIn : t.loading}
      </button>
      {error && <FormError id={errorId}>{error}</FormError>}
    </form>
  );
}
