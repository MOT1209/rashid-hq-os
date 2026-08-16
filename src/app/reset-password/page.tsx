import { ResetPasswordForm } from "@/components/reset-password-form";
import { getT } from "@/lib/locale-server";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const [t, params] = await Promise.all([getT(), searchParams]);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-panel p-6">
        <h1 className="text-lg font-semibold text-accent">{t.brand}</h1>
        <p className="mb-6 text-sm text-muted">{t.resetPassword}</p>
        <ResetPasswordForm token={params.token ?? null} />
      </div>
    </main>
  );
}
