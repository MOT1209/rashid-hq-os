import { redirect } from "next/navigation";
import { SignInForm } from "@/components/sign-in-form";
import { getSession } from "@/lib/session";
import { getT } from "@/lib/locale-server";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  if (await getSession()) redirect("/dashboard");
  const t = await getT();

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-panel p-6">
        <h1 className="text-lg font-semibold text-accent">{t.brand}</h1>
        <p className="mb-6 text-sm text-muted">{t.subtitle}</p>
        <SignInForm />
      </div>
    </main>
  );
}
