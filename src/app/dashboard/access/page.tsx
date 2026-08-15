import { headers } from "next/headers";
import { revokeTokenAction } from "@/app/actions";
import { IssueTokenForm } from "@/components/access-manager";
import { EmptyState, Panel } from "@/components/ui";
import { getT } from "@/lib/locale-server";
import { fetchProjects } from "@/lib/queries";
import { listAgentTokens } from "@/lib/agent-tokens";

export const dynamic = "force-dynamic";

export default async function AccessPage() {
  const t = await getT();
  const [projects, tokens, headerList] = await Promise.all([
    fetchProjects(),
    listAgentTokens(),
    headers(),
  ]);

  const origin =
    process.env.BETTER_AUTH_URL ?? `https://${headerList.get("host") ?? "localhost:3000"}`;
  const names = Object.fromEntries(projects.map((p) => [p.id, p.name]));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t.access}</h1>
        <p className="text-sm text-muted">
          {t.mcpHint}{" "}
          <code className="text-accent">{`${origin}/api/mcp`}</code>
        </p>
      </header>

      <Panel title={t.issueToken}>
        <IssueTokenForm projects={projects} />
      </Panel>

      <Panel title={t.access}>
        {tokens.length === 0 ? (
          <EmptyState>—</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted">
                <tr className="border-b border-border">
                  <th className="py-2 text-start">{t.agent}</th>
                  <th className="py-2 text-start">Token</th>
                  <th className="py-2 text-start">{t.project}</th>
                  <th className="py-2 text-start">{t.lastUsed}</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tokens.map((token) => (
                  <tr key={token.id} className={token.revoked_at ? "opacity-50" : ""}>
                    <td className="py-3 font-medium">{token.agent_name}</td>
                    <td className="py-3">
                      <code className="text-xs text-muted">{token.token_prefix}…</code>
                    </td>
                    <td className="py-3 text-xs text-muted">
                      {token.project_id ? names[token.project_id] ?? "—" : "*"}
                    </td>
                    <td className="py-3 text-xs text-muted">
                      {token.last_used_at
                        ? new Date(token.last_used_at).toLocaleString()
                        : t.never}
                    </td>
                    <td className="py-3 text-end">
                      {token.revoked_at ? (
                        <span className="text-xs text-muted">{t.revoked}</span>
                      ) : (
                        <form action={revokeTokenAction}>
                          <input type="hidden" name="id" value={token.id} />
                          <button type="submit" className="text-xs text-err">
                            {t.revoke}
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
