"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "@/lib/auth-client";
import { useLocale } from "@/components/providers";

const field =
  "w-full rounded-xl border border-border bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent";

export function SignInForm() {
  const { t } = useLocale();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="space-y-3"
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
          setError(signInError.message ?? "Sign-in failed.");
          return;
        }
        router.push("/dashboard");
        router.refresh();
      }}
    >
      <input name="email" type="email" placeholder={t.email} required className={field} />
      <input
        name="password"
        type="password"
        placeholder={t.password}
        required
        className={field}
      />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-accent px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
      >
        {t.signIn}
      </button>
      {error && <p className="text-xs text-err">{error}</p>}
    </form>
  );
}
