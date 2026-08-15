import { redirect } from "next/navigation";
import { SignInForm } from "@/components/sign-in-form";
import { getSession } from "@/lib/session";
import { getT } from "@/lib/locale-server";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const [session, params] = await Promise.all([getSession(), searchParams]);
  // A session that is not on the owner allowlist lands here with ?denied=1 —
  // it must not be bounced straight back to /dashboard.
  if (session && !params.denied) redirect("/dashboard");
  const t = await getT();

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-panel p-6">
        <h1 className="text-lg font-semibold text-accent">{t.brand}</h1>
        <p className="mb-6 text-sm text-muted">{t.subtitle}</p>
        <SignInForm denied={Boolean(params.denied)} />
      </div>
    </main>
  );
}
