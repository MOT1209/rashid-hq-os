import { IntegrationsManager } from "@/components/integrations-manager";
import { getT } from "@/lib/locale-server";
import { requireSession } from "@/lib/session";
import { integrationsForOwner } from "@/lib/integrations/service";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const [t, session] = await Promise.all([getT(), requireSession()]);
  const isAdmin = session.role === "admin";

  const integrations = isAdmin ? await integrationsForOwner(session.user.id) : [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t.integrations}</h1>
        <p className="mt-1 text-sm text-muted">{t.integrationsHint}</p>
        {!isAdmin && <p className="mt-2 text-sm text-warn">{t.readOnlyNotice}</p>}
      </header>

      {isAdmin && <IntegrationsManager integrations={integrations} />}
    </div>
  );
}
