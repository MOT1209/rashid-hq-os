"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { twoFactor } from "@/lib/auth-client";
import { useLocale } from "@/components/providers";
import { Field, FormError, fieldClass } from "@/components/ui";

/**
 * Pulled out of the otpauth:// URI so the owner can type the key into an
 * authenticator app by hand — this console has no camera-facing QR renderer,
 * and every authenticator supports manual entry as a fallback to scanning.
 */
function secretFromUri(uri: string): string | null {
  try {
    return new URL(uri.replace("otpauth://", "https://")).searchParams.get("secret");
  } catch {
    return null;
  }
}

/**
 * Enable/disable panel for TOTP two-factor authentication. Three stages:
 * idle (show status + toggle button), password (confirm identity before
 * either enabling or disabling), and — enable only — verify (show the
 * secret + backup codes, wait for one code to prove the app was set up
 * correctly before flipping twoFactorEnabled on).
 */
export function TwoFactorForm({ initiallyEnabled }: { initiallyEnabled: boolean }) {
  const { t } = useLocale();
  const router = useRouter();
  const id = useId();
  const errorId = `${id}-error`;

  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [stage, setStage] = useState<"idle" | "password" | "verify">("idle");
  const [intent, setIntent] = useState<"enable" | "disable">("enable");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  const startPassword = (nextIntent: "enable" | "disable") => {
    setIntent(nextIntent);
    setStage("password");
    setError(null);
  };

  const cancel = () => {
    setStage("idle");
    setError(null);
    setSecret(null);
    setBackupCodes(null);
  };

  return (
    <div className="max-w-md space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm">
            {enabled ? t.twoFactorEnabledStatus : t.twoFactorDisabledStatus}
          </p>
          <p className="mt-1 text-xs text-muted">{t.twoFactorHint}</p>
        </div>
        {stage === "idle" && (
          <button
            type="button"
            onClick={() => startPassword(enabled ? "disable" : "enable")}
            className="shrink-0 rounded-xl border border-border px-3 py-2 text-sm text-text hover:border-accent"
          >
            {enabled ? t.disableTwoFactor : t.enableTwoFactor}
          </button>
        )}
      </div>

      {stage === "password" && (
        <form
          className="grid gap-3 rounded-xl border border-border bg-panel-2 p-4"
          method="post"
          onSubmit={async (event) => {
            event.preventDefault();
            const password = String(new FormData(event.currentTarget).get("password"));
            setPending(true);
            setError(null);

            if (intent === "disable") {
              const { error: disableError } = await twoFactor.disable({ password });
              setPending(false);
              if (disableError) {
                setError(disableError.message ?? t.somethingBroke);
                return;
              }
              setEnabled(false);
              setStage("idle");
              router.refresh();
              return;
            }

            const { data, error: enableError } = await twoFactor.enable({ password });
            setPending(false);
            if (enableError || !data) {
              setError(enableError?.message ?? t.somethingBroke);
              return;
            }
            setSecret(secretFromUri(data.totpURI));
            setBackupCodes(data.backupCodes);
            setStage("verify");
          }}
        >
          {intent === "disable" && (
            <p className="text-xs text-warn">{t.confirmDisableTwoFactor}</p>
          )}
          <Field id={`${id}-password`} label={t.twoFactorPasswordPrompt}>
            <input
              id={`${id}-password`}
              name="password"
              type="password"
              autoComplete="current-password"
              required
              autoFocus
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              className={fieldClass}
            />
          </Field>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={pending}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
            >
              {pending ? t.loading : intent === "disable" ? t.disableTwoFactor : t.enableTwoFactor}
            </button>
            <button
              type="button"
              onClick={cancel}
              className="rounded-xl border border-border px-3 py-2 text-sm text-muted hover:text-text"
            >
              {t.cancel}
            </button>
          </div>
          {error && <FormError id={errorId}>{error}</FormError>}
        </form>
      )}

      {stage === "verify" && (
        <div className="grid gap-4 rounded-xl border border-border bg-panel-2 p-4">
          <div>
            <p className="mb-2 text-xs text-muted">{t.twoFactorSetupInstructions}</p>
            {secret && (
              <code className="block break-all rounded-lg bg-bg px-3 py-2 text-xs text-accent">
                {secret}
              </code>
            )}
          </div>

          {backupCodes && (
            <div>
              <p className="mb-2 text-xs text-muted">{t.twoFactorBackupCodesHint}</p>
              <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-bg p-3">
                {backupCodes.map((code) => (
                  <code key={code} className="text-xs text-text">
                    {code}
                  </code>
                ))}
              </div>
            </div>
          )}

          <form
            className="grid gap-3"
            method="post"
            onSubmit={async (event) => {
              event.preventDefault();
              const code = String(new FormData(event.currentTarget).get("code")).trim();
              setPending(true);
              setError(null);

              const { error: verifyError } = await twoFactor.verifyTotp({ code });
              setPending(false);
              if (verifyError) {
                setError(verifyError.message ?? t.twoFactorInvalidCode);
                return;
              }
              setEnabled(true);
              setStage("idle");
              setSecret(null);
              setBackupCodes(null);
              router.refresh();
            }}
          >
            <Field id={`${id}-code`} label={t.twoFactorVerifyCode}>
              <input
                id={`${id}-code`}
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                className={fieldClass}
              />
            </Field>
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={pending}
                className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
              >
                {pending ? t.loading : t.twoFactorVerify}
              </button>
              <button
                type="button"
                onClick={cancel}
                className="rounded-xl border border-border px-3 py-2 text-sm text-muted hover:text-text"
              >
                {t.cancel}
              </button>
            </div>
            {error && <FormError id={errorId}>{error}</FormError>}
          </form>
        </div>
      )}
    </div>
  );
}
