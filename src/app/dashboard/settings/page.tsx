import { CategoryManager } from "@/components/category-manager";
import { ChangePasswordForm } from "@/components/change-password-form";
import { MemberManager } from "@/components/member-manager";
import { Panel } from "@/components/ui";
import { getT } from "@/lib/locale-server";
import { fetchCategories, fetchDepartments } from "@/lib/queries";
import { listMembers } from "@/lib/members";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [t, session] = await Promise.all([getT(), requireSession()]);
  const isAdmin = session.role === "admin";

  // A viewer sees the page and can still change their own password; everything
  // that writes shared state is admin-only, enforced in the actions themselves.
  const [categories, departments, members] = isAdmin
    ? await Promise.all([fetchCategories(), fetchDepartments(), listMembers()])
    : [[], [], []];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t.settings}</h1>
        <p className="text-sm text-muted">
          {t.signedInAs} <span className="text-accent">{session.user.email}</span>
          <span className="ms-2 text-xs">
            ({isAdmin ? t.roleAdmin : t.roleViewer})
          </span>
        </p>
        {!isAdmin && (
          <p className="mt-2 text-sm text-warn">{t.readOnlyNotice}</p>
        )}
      </header>

      <Panel title={t.changePassword}>
        <ChangePasswordForm />
      </Panel>

      {isAdmin && (
        <>
          <Panel title={t.members}>
            <MemberManager members={members} />
          </Panel>

          <Panel title={t.categories}>
            <CategoryManager categories={categories} departments={departments} />
          </Panel>
        </>
      )}
    </div>
  );
}
