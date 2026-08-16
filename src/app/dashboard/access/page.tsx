import { headers } from "next/headers";
import { revokeTokenAction } from "@/app/actions";
import { IssueTokenForm } from "@/components/access-manager";
import { EmptyState, Panel } from "@/components/ui";
import { getLocale, getT } from "@/lib/locale-server";
import { fetchProjectOptions } from "@/lib/queries";
import { listAgentTokens } from "@/lib/agent-tokens";

export const dynamic = "force-dynamic";

export default async function AccessPage() {
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const [projects, tokens, headerList] = await Promise.all([
    fetchProjectOptions(),
    listAgentTokens(),
    headers(),
  ]);

  const origin =
    process.env.BETTER_AUTH_URL ?? `https://${headerList.get("host") ?? "localhost:7070"}`;
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
          <EmptyState>{t.noTokens}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{t.access}</caption>
              <thead className="text-xs uppercase tracking-wider text-muted">
                <tr className="border-b border-border">
                  <th scope="col" className="py-2 text-start">{t.agent}</th>
                  <th scope="col" className="py-2 text-start">{t.token}</th>
                  <th scope="col" className="py-2 text-start">{t.scope}</th>
                  <th scope="col" className="py-2 text-start">{t.project}</th>
                  <th scope="col" className="py-2 text-start">{t.expiresAt}</th>
                  <th scope="col" className="py-2 text-start">{t.lastUsed}</th>
                  <th scope="col" className="py-2 text-end">{t.actions}</th>
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
                      {token.scopes.includes("write") ? t.scopeReadWrite : t.scopeRead}
                    </td>
                    <td className="py-3 text-xs text-muted">
                      {token.project_id ? names[token.project_id] ?? "—" : "*"}
                    </td>
                    <td className="py-3 text-xs">
                      {!token.expires_at ? (
                        <span className="text-muted">{t.neverExpires}</span>
                      ) : new Date(token.expires_at) < new Date() ? (
                        <span className="text-err">{t.expired}</span>
                      ) : (
                        <time
                          dateTime={token.expires_at}
                          suppressHydrationWarning
                          className="text-muted"
                        >
                          {new Date(token.expires_at).toLocaleDateString(locale)}
                        </time>
                      )}
                    </td>
                    <td className="py-3 text-xs text-muted">
                      {token.last_used_at ? (
                        <time dateTime={token.last_used_at} suppressHydrationWarning>
                          {new Date(token.last_used_at).toLocaleString(locale)}
                        </time>
                      ) : (
                        t.never
                      )}
                    </td>
                    <td className="py-3 text-end">
                      {token.revoked_at ? (
                        <span className="text-xs text-muted">{t.revoked}</span>
                      ) : (
                        <form action={revokeTokenAction}>
                          <input type="hidden" name="id" value={token.id} />
                          <button
                            type="submit"
                            aria-label={`${t.revoke}: ${token.agent_name}`}
                            className="text-xs text-err"
                          >
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
