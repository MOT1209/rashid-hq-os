import { CategoryManager } from "@/components/category-manager";
import { ChangePasswordForm } from "@/components/change-password-form";
import { Panel } from "@/components/ui";
import { getT } from "@/lib/locale-server";
import { fetchCategories, fetchDepartments } from "@/lib/queries";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [t, session, categories, departments] = await Promise.all([
    getT(),
    requireSession(),
    fetchCategories(),
    fetchDepartments(),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t.settings}</h1>
        <p className="text-sm text-muted">
          {t.signedInAs} <span className="text-accent">{session.user.email}</span>
        </p>
      </header>

      <Panel title={t.changePassword}>
        <ChangePasswordForm />
      </Panel>

      <Panel title={t.categories}>
        <CategoryManager categories={categories} departments={departments} />
      </Panel>
    </div>
  );
}
