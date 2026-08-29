import "server-only";

import { googleProvider } from "@/lib/integrations/providers/google";
import { githubProvider } from "@/lib/integrations/providers/github";
import {
  anthropicProvider,
  clarityProvider,
  geminiProvider,
  openaiProvider,
} from "@/lib/integrations/providers/api-key";
import type { IntegrationProvider, ProviderMeta } from "@/lib/integrations/types";

/**
 * The single source of truth for which providers exist and how they behave.
 *
 * Adding a provider is a new entry here plus its module under `providers/` —
 * no change to the API routes, the UI, the agent tool, or the database.
 *
 * `readiness: "planned"` entries render in the dashboard as "coming soon" with
 * their connect button disabled. They carry no runtime behaviour, so the
 * console never pretends a capability it does not have (§42 of the brief).
 */

const GOOGLE_CLIENT_ENV = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];

/** A Google-family provider: shares the OAuth engine, differs only in scopes. */
function google(
  id: string,
  name: string,
  descAr: string,
  descEn: string,
  icon: string,
  scopes: string[],
  docsUrl: string,
): IntegrationProvider {
  const meta: ProviderMeta = {
    id,
    name,
    description: { ar: descAr, en: descEn },
    icon,
    category: "google",
    authMethod: "oauth2",
    readiness: "available",
    scopes,
    docsUrl,
    requiredEnv: GOOGLE_CLIENT_ENV,
    hasWebhooks: false,
  };
  return googleProvider(meta);
}

/** Metadata-only placeholder for a provider not yet wired up. */
function planned(meta: Omit<ProviderMeta, "readiness">): IntegrationProvider {
  return {
    meta: { ...meta, readiness: "planned" },
    async testConnection() {
      throw new Error(`${meta.name} is not available yet.`);
    },
  };
}

const PROVIDERS: IntegrationProvider[] = [
  // ── Google family (one OAuth client, per-API scopes) ──────────────────────
  google(
    "google",
    "Google",
    "تسجيل الدخول بحساب Google والوصول لبيانات الملف الشخصي الأساسية.",
    "Sign in with Google and access basic profile data.",
    "Chrome",
    [],
    "https://developers.google.com/identity/protocols/oauth2",
  ),
  google(
    "youtube",
    "YouTube",
    "قراءة بيانات القناة والفيديوهات والإحصائيات وإدارة قوائم التشغيل.",
    "Read channel data, videos and analytics; manage playlists.",
    "Youtube",
    [
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/yt-analytics.readonly",
    ],
    "https://developers.google.com/youtube/v3",
  ),
  google(
    "gmail",
    "Gmail",
    "قراءة البريد والبحث وإدارة التسميات حسب الصلاحيات الممنوحة.",
    "Read mail, search and manage labels within the scopes you grant.",
    "Mail",
    ["https://www.googleapis.com/auth/gmail.readonly"],
    "https://developers.google.com/gmail/api",
  ),
  google(
    "drive",
    "Google Drive",
    "قراءة الملفات والبحث عنها ضمن صلاحيات المستخدم.",
    "Read and search files within the user's permissions.",
    "HardDrive",
    ["https://www.googleapis.com/auth/drive.readonly"],
    "https://developers.google.com/drive/api",
  ),
  google(
    "calendar",
    "Google Calendar",
    "قراءة الأحداث ومعلومات التقويم.",
    "Read events and calendar information.",
    "Calendar",
    ["https://www.googleapis.com/auth/calendar.readonly"],
    "https://developers.google.com/calendar/api",
  ),
  google(
    "search_console",
    "Google Search Console",
    "تحليلات البحث: النقرات، الظهور، CTR، الموضع، والاستعلامات.",
    "Search analytics: clicks, impressions, CTR, position and queries.",
    "LineChart",
    ["https://www.googleapis.com/auth/webmasters.readonly"],
    "https://developers.google.com/webmaster-tools",
  ),

  // ── Developer ────────────────────────────────────────────────────────────
  githubProvider,

  // ── AI (API key) ─────────────────────────────────────────────────────────
  openaiProvider,
  anthropicProvider,
  geminiProvider,

  // ── Analytics (config) ──────────────────────────────────────────────────
  clarityProvider,

  // ── Planned — metadata only, connect disabled ───────────────────────────
  planned({
    id: "google_adsense",
    name: "Google AdSense",
    description: {
      ar: "معلومات الحساب والتقارير وبيانات الأرباح.",
      en: "Account information, reports and earnings data.",
    },
    icon: "DollarSign",
    category: "google",
    authMethod: "oauth2",
    scopes: ["https://www.googleapis.com/auth/adsense.readonly"],
    docsUrl: "https://developers.google.com/adsense/management",
    requiredEnv: GOOGLE_CLIENT_ENV,
    hasWebhooks: false,
  }),
  planned({
    id: "google_search",
    name: "Programmable Search",
    description: {
      ar: "بحث الويب عبر Google Programmable Search — مزوّد قابل للتبديل.",
      en: "Web search via Google Programmable Search — a swappable provider.",
    },
    icon: "Search",
    category: "analytics",
    authMethod: "api_key",
    scopes: [],
    docsUrl: "https://developers.google.com/custom-search",
    requiredEnv: ["GOOGLE_SEARCH_API_KEY", "GOOGLE_SEARCH_ENGINE_ID"],
    hasWebhooks: false,
  }),
  planned({
    id: "x",
    name: "X (Twitter)",
    description: {
      ar: "قراءة الحساب والمنشورات وإنشائها حسب صلاحيات الخطة.",
      en: "Read the account and posts, and create posts, subject to your plan.",
    },
    icon: "Twitter",
    category: "social",
    authMethod: "oauth2",
    scopes: ["tweet.read", "users.read", "offline.access"],
    docsUrl: "https://developer.x.com/en/docs",
    requiredEnv: ["X_CLIENT_ID", "X_CLIENT_SECRET"],
    hasWebhooks: true,
  }),
  planned({
    id: "discord",
    name: "Discord",
    description: {
      ar: "OAuth2 والبوت: الخوادم والقنوات والرسائل و Webhooks.",
      en: "OAuth2 and bot: guilds, channels, messages and webhooks.",
    },
    icon: "MessageCircle",
    category: "messaging",
    authMethod: "oauth2",
    scopes: ["identify", "guilds"],
    docsUrl: "https://discord.com/developers/docs/intro",
    requiredEnv: ["DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET"],
    hasWebhooks: true,
  }),
  planned({
    id: "telegram",
    name: "Telegram",
    description: {
      ar: "بوت Telegram: إرسال الرسائل والملفات واستقبال Webhooks.",
      en: "Telegram bot: send messages and files, receive webhooks.",
    },
    icon: "Send",
    category: "messaging",
    authMethod: "api_key",
    scopes: [],
    docsUrl: "https://core.telegram.org/bots/api",
    requiredEnv: ["TELEGRAM_BOT_TOKEN"],
    hasWebhooks: true,
  }),
  planned({
    id: "whatsapp",
    name: "WhatsApp Business",
    description: {
      ar: "منصة WhatsApp Business الرسمية: رسائل، قوالب، وسائط، Webhooks.",
      en: "Official WhatsApp Business Platform: messages, templates, media, webhooks.",
    },
    icon: "MessageSquare",
    category: "messaging",
    authMethod: "api_key",
    scopes: [],
    docsUrl: "https://developers.facebook.com/docs/whatsapp/",
    requiredEnv: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"],
    hasWebhooks: true,
  }),
  planned({
    id: "stripe",
    name: "Stripe",
    description: {
      ar: "العملاء والمنتجات والمدفوعات والاشتراكات و Webhooks.",
      en: "Customers, products, payments, subscriptions and webhooks.",
    },
    icon: "CreditCard",
    category: "payments",
    authMethod: "api_key",
    scopes: [],
    docsUrl: "https://docs.stripe.com/api",
    requiredEnv: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
    hasWebhooks: true,
  }),
  planned({
    id: "paypal",
    name: "PayPal",
    description: {
      ar: "المدفوعات والطلبات و Webhooks.",
      en: "Payments, orders and webhooks.",
    },
    icon: "Wallet",
    category: "payments",
    authMethod: "oauth2",
    scopes: [],
    docsUrl: "https://developer.paypal.com/api/rest/",
    requiredEnv: ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"],
    hasWebhooks: true,
  }),
];

const BY_ID = new Map(PROVIDERS.map((p) => [p.meta.id, p]));

export function allProviders(): IntegrationProvider[] {
  return PROVIDERS;
}

export function getProvider(id: string): IntegrationProvider | undefined {
  return BY_ID.get(id);
}

/** True when every env var the provider needs is present on the server. */
export function providerConfigured(meta: ProviderMeta): boolean {
  return meta.requiredEnv.every((name) => Boolean(process.env[name]));
}
