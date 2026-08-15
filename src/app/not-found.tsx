import Link from "next/link";
import { getT } from "@/lib/locale-server";

export default async function NotFound() {
  const t = await getT();

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="text-4xl font-semibold text-accent">404</p>
      <h1 className="mt-3 text-lg font-semibold">{t.notFoundTitle}</h1>
      <p className="mt-2 text-sm text-muted">{t.notFoundBody}</p>
      <Link
        href="/dashboard"
        className="mt-6 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-black"
      >
        {t.backToDashboard}
      </Link>
    </div>
  );
}
