"use client";

import { useState, useTransition } from "react";
import {
  Bot,
  Calendar,
  Chrome,
  CreditCard,
  DollarSign,
  Eye,
  Gem,
  Github,
  HardDrive,
  LineChart,
  Mail,
  MessageCircle,
  MessageSquare,
  Plug,
  Search,
  Send,
  Sparkles,
  Twitter,
  Wallet,
  Youtube,
  type LucideIcon,
} from "lucide-react";
import { useLocale } from "@/components/providers";
import { Panel, fieldClass } from "@/components/ui";
import {
  disconnectAction,
  saveApiKeyAction,
} from "@/app/dashboard/settings/integrations/actions";
import type { IntegrationView } from "@/lib/integrations/types";

const ICONS: Record<string, LucideIcon> = {
  Bot, Calendar, Chrome, CreditCard, DollarSign, Eye, Gem, Github, HardDrive,
  LineChart, Mail, MessageCircle, MessageSquare, Search, Send, Sparkles,
  Twitter, Wallet, Youtube,
};

const STATUS_STYLE: Record<string, string> = {
  connected: "text-ok border-ok/40 bg-ok/10",
  disconnected: "text-muted border-border bg-panel-2",
  error: "text-err border-err/40 bg-err/10",
  expired: "text-warn border-warn/40 bg-warn/10",
};

export function IntegrationsManager({ integrations }: { integrations: IntegrationView[] }) {
  const { t } = useLocale();

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {integrations.map((it) => (
        <IntegrationCard key={it.id} it={it} />
      ))}
      {integrations.length === 0 && (
        <p className="text-sm text-muted">{t.noIntegrations}</p>
      )}
    </div>
  );
}

function IntegrationCard({ it }: { it: IntegrationView }) {
  const { t, locale } = useLocale();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(it.connection?.lastError ?? null);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");

  const Icon = ICONS[it.icon] ?? Plug;
  const status = it.connection?.status ?? "disconnected";
  const connected = status === "connected";
  const planned = it.readiness === "planned";

  const statusLabel = planned
    ? t.integrationPlanned
    : (t as Record<string, string>)[`integrationStatus_${status}`] ?? status;

  async function startOAuth() {
    setError(null);
    const res = await fetch(`/api/integrations/${it.id}/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = (await res.json()) as { url?: string; error?: string };
    if (data.url) window.location.href = data.url;
    else setError(data.error ?? t.integrationConnectFailed);
  }

  async function runTest() {
    setTestMsg(null);
    setError(null);
    const res = await fetch(`/api/integrations/${it.id}/test`, { method: "POST" });
    const data = (await res.json()) as { ok?: boolean; accountLabel?: string; error?: string };
    if (data.ok) setTestMsg(data.accountLabel ?? t.integrationTestPassed);
    else setError(data.error ?? t.integrationTestFailed);
  }

  return (
    <Panel className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span className="rounded-xl border border-border bg-panel-2 p-2">
          <Icon size={18} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{it.name}</p>
          <p className="text-xs text-muted">{it.description[locale] ?? it.description.en}</p>
        </div>
      </div>

      <span
        className={`inline-flex w-fit items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
          planned ? STATUS_STYLE.disconnected : STATUS_STYLE[status]
        }`}
      >
        {statusLabel}
      </span>

      {it.connection?.accountLabel && (
        <p className="truncate text-xs text-muted" title={it.connection.accountLabel}>
          {it.connection.accountLabel}
        </p>
      )}
      {!planned && !it.configured && (
        <p className="text-xs text-warn">{t.integrationNeedsSetup}</p>
      )}
      {error && <p role="alert" className="text-xs text-err">{error}</p>}
      {testMsg && <p className="text-xs text-ok">{testMsg}</p>}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        {planned && (
          <span className="text-xs text-muted">{t.integrationComingSoon}</span>
        )}

        {!planned && it.authMethod === "oauth2" && !connected && (
          <button
            type="button"
            disabled={!it.configured || pending}
            onClick={() => startTransition(startOAuth)}
            className="rounded-xl bg-accent px-3 py-1.5 text-xs font-medium text-black disabled:opacity-40"
          >
            {status === "disconnected" ? t.integrationConnect : t.integrationReconnect}
          </button>
        )}

        {!planned &&
          (it.authMethod === "api_key" || it.authMethod === "config") &&
          !connected && (
            <form
              className="flex w-full flex-wrap gap-2"
              action={(fd) => {
                fd.set("provider", it.id);
                fd.set("api_key", apiKey);
                startTransition(async () => {
                  const r = await saveApiKeyAction(fd);
                  if (r.error) setError(r.error);
                  else setApiKey("");
                });
              }}
            >
              <input
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={it.authMethod === "config" ? t.integrationProjectId : t.integrationApiKey}
                className={`${fieldClass} flex-1`}
                aria-label={t.integrationApiKey}
              />
              <button
                type="submit"
                disabled={pending || !apiKey}
                className="rounded-xl bg-accent px-3 py-1.5 text-xs font-medium text-black disabled:opacity-40"
              >
                {t.save}
              </button>
            </form>
          )}

        {connected && (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => startTransition(runTest)}
              className="rounded-xl border border-border px-3 py-1.5 text-xs hover:bg-panel-2 disabled:opacity-40"
            >
              {t.integrationTest}
            </button>
            <form
              action={(fd) => {
                fd.set("provider", it.id);
                startTransition(async () => {
                  await disconnectAction(fd);
                });
              }}
            >
              <button
                type="submit"
                disabled={pending}
                className="rounded-xl border border-err/40 px-3 py-1.5 text-xs text-err hover:bg-err/10 disabled:opacity-40"
              >
                {t.integrationDisconnect}
              </button>
            </form>
          </>
        )}

        <a
          href={it.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ms-auto text-xs text-accent hover:underline"
        >
          {t.integrationDocs}
        </a>
      </div>
    </Panel>
  );
}
