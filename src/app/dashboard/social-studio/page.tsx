import Link from "next/link";
import { getLocale } from "@/lib/locale-server";
import { requireSession } from "@/lib/session";
import { socialT } from "@/lib/social/i18n";
import { PLATFORMS } from "@/lib/social/providers";
import { getContentBundle, listAccounts, listAssets, listContent, listJobs } from "@/lib/social/store";
import {
  AccountsPanel,
  ContentPanel,
  JobsPanel,
  MediaPanel,
  type ContentView,
} from "@/components/social-studio-client";

export const dynamic = "force-dynamic";

const TABS = ["accounts", "media", "content", "schedule", "history"] as const;
type Tab = (typeof TABS)[number];

/**
 * KING Social Studio. Read access for any signed-in role; every mutation goes
 * through server actions that call requireAdmin (role + 2FA policy), so hiding
 * a control is presentation only.
 */
export default async function SocialStudioPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string; connected?: string; error?: string }>;
}) {
  const [locale, session, params] = await Promise.all([getLocale(), requireSession(), searchParams]);
  const t = socialT(locale);
  const tab: Tab = TABS.includes(params?.tab as Tab) ? (params!.tab as Tab) : "accounts";
  const owner = session.user.id;
  const timezone = process.env.OWNER_TIMEZONE || "UTC";
  const labels: Record<Tab, string> = {
    accounts: t.tabAccounts, media: t.tabMedia, content: t.tabContent, schedule: t.tabCalendar, history: t.tabHistory,
  };
  const platforms = Object.values(PLATFORMS);

  type Data =
    | { tab: "accounts"; accounts: Awaited<ReturnType<typeof listAccounts>> }
    | { tab: "media"; assets: Awaited<ReturnType<typeof listAssets>> }
    | { tab: "content"; assets: Awaited<ReturnType<typeof listAssets>>; accounts: Awaited<ReturnType<typeof listAccounts>>; views: ContentView[] }
    | { tab: "schedule" | "history"; jobs: Awaited<ReturnType<typeof listJobs>> };

  async function load(): Promise<Data> {
    if (tab === "accounts") return { tab, accounts: await listAccounts(owner) };
    if (tab === "media") return { tab, assets: await listAssets(owner) };
    if (tab === "content") {
      const [assets, contents, accounts] = await Promise.all([listAssets(owner), listContent(owner), listAccounts(owner)]);
      const views: ContentView[] = await Promise.all(
        contents.map(async (c) => {
          const b = await getContentBundle(owner, c.id);
          const yt = b?.variants.find((v) => v.platform === "youtube");
          return {
            id: c.id, title: c.title, description: c.description, caption: c.caption, hashtags: c.hashtags,
            language: c.language, notes: c.notes, aiGenerated: c.ai_generated,
            mediaIds: b?.media.map((m) => m.asset_id) ?? [],
            platforms: b?.variants.map((v) => v.platform) ?? [],
            privacy: typeof yt?.options?.privacy === "string" ? yt.options.privacy : "private",
          };
        }),
      );
      return { tab, assets, accounts, views };
    }
    return { tab, jobs: await listJobs(owner, { limit: 100 }) };
  }

  // Most likely failure: migration 0024 has not been applied yet.
  const data: Data | null = await load().catch(() => null);
  const loadError =
    data !== null
      ? null
      : locale === "ar"
        ? "تعذّر تحميل بيانات Social Studio. تأكد من تطبيق الترحيل 0024 (npm run migrate:apply)."
        : "Could not load Social Studio data. Make sure migration 0024 is applied (npm run migrate:apply).";

  let body: React.ReactNode = null;
  if (data?.tab === "accounts") body = <AccountsPanel t={t} platforms={platforms} accounts={data.accounts} />;
  else if (data?.tab === "media") body = <MediaPanel t={t} assets={data.assets} />;
  else if (data?.tab === "content")
    body = <ContentPanel t={t} platforms={platforms} assets={data.assets} contents={data.views} accounts={data.accounts} timezone={timezone} />;
  else if (data) body = <JobsPanel t={t} jobs={data.jobs} scheduleOnly={data.tab === "schedule"} locale={locale} />;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t.title}</h1>
        <p className="text-sm text-muted">{t.subtitle}</p>
      </header>
      {params?.connected && <p role="status" className="text-sm text-ok">✓ {params.connected}</p>}
      <nav aria-label={t.title} className="flex flex-wrap gap-2 text-sm">
        {TABS.map((id) => (
          <Link
            key={id}
            href={`/dashboard/social-studio?tab=${id}`}
            aria-current={tab === id ? "page" : undefined}
            className={`rounded-xl px-3 py-2 ${tab === id ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-panel-2"}`}
          >
            {labels[id]}
          </Link>
        ))}
      </nav>
      {loadError ? <p role="alert" className="text-sm text-err">{loadError}</p> : body}
    </div>
  );
}
