"use client";

import Link from "next/link";
import { useId, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { signIn, twoFactor } from "@/lib/auth-client";
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

  // Set once the password step comes back asking for a second factor. No
  // session exists yet at that point — Better Auth holds a short-lived
  // verification cookie instead — so the form below is a second, separate
  // step rather than an inline field.
  const [needsTwoFactor, setNeedsTwoFactor] = useState(false);
  const [useBackupCode, setUseBackupCode] = useState(false);

  if (needsTwoFactor) {
    return (
      <form
        className="space-y-3"
        method="post"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const code = String(form.get("code")).trim();
          setPending(true);
          setError(null);

          const { error: verifyError } = useBackupCode
            ? await twoFactor.verifyBackupCode({ code })
            : await twoFactor.verifyTotp({ code });

          setPending(false);
          if (verifyError) {
            setError(verifyError.message ?? t.twoFactorInvalidCode);
            return;
          }
          router.push("/dashboard");
          router.refresh();
        }}
      >
        <p className="text-sm text-muted">{t.signInTwoFactorHint}</p>

        <Field
          id={`${id}-code`}
          label={useBackupCode ? t.backupCode : t.twoFactorCode}
          hideLabel
        >
          <input
            id={`${id}-code`}
            name="code"
            type="text"
            inputMode={useBackupCode ? "text" : "numeric"}
            autoComplete="one-time-code"
            placeholder={useBackupCode ? t.backupCode : t.twoFactorCode}
            required
            autoFocus
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className={fieldClass}
          />
        </Field>

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-xl bg-accent px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
        >
          {pending ? t.loading : t.twoFactorVerify}
        </button>
        {error && <FormError id={errorId}>{error}</FormError>}

        <button
          type="button"
          onClick={() => {
            setUseBackupCode((v) => !v);
            setError(null);
          }}
          className="block w-full text-center text-xs text-muted hover:text-text"
        >
          {useBackupCode ? t.useAuthenticatorCode : t.useBackupCode}
        </button>
      </form>
    );
  }

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

        const { data, error: signInError } = await signIn.email({
          // Autofill and paste routinely add a trailing space, and the server
          // compares the address exactly. Passwords are left untouched — a
          // space can be a real character there.
          email: String(form.get("email")).trim(),
          password: String(form.get("password")),
        });

        setPending(false);
        if (signInError) {
          setError(signInError.message ?? t.signInFailed);
          return;
        }
        if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
          setNeedsTwoFactor(true);
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

      <Link
        href="/forgot-password"
        className="block text-center text-xs text-muted hover:text-text"
      >
        {t.forgotPassword}
      </Link>
    </form>
  );
}
