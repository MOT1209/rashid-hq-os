import type { Locale } from "@/lib/i18n";
import type { Level } from "@/lib/overview-core";

const en = {
  title: "Command overview", unavailable: "Unavailable (could not be loaded)",
  attention: "Needs attention", allClear: "Nothing needs your attention.",
  system: "System health", database: "Database", dbOk: "Reachable", dbDown: "Unreachable", latency: "ms",
  agents: "Agents", agentsOn: "enabled", runs24h: "runs (24h)", failed24h: "failed (24h)",
  approvals: "Pending approvals", approvalsNone: "None waiting.", review: "Review",
  running: "Running now", automationsQ: "Automation runs queued/running", socialQ: "Social jobs queued/running", tasksIn: "Tasks in progress", overdue: "overdue",
  mcp: "MCP tools", mcpTools: "tools", mcpEnabled: "enabled", mcpDangerous: "dangerous", mcpFailing: "failing last test",
  integrations: "Integrations", connected: "connected", broken: "need attention", none: "None",
  scheduled: "Scheduled", nextAutomations: "Next automation runs", nextSocial: "Next social post", nothingScheduled: "Nothing scheduled.",
  social: "Social publishing", published7d: "published (7d)", failed7d: "failed (7d)", accounts: "accounts",
  failures: "Recent failures", noFailures: "No failures in the last 24 hours.", open: "Open",
  w: {
    db_down: "The database is unreachable", budget_exhausted: "agent(s) reached their token budget", integrations_broken: "integration(s) expired or in error",
    approvals_pending: "tool call(s) waiting for your approval", failed_calls: "failed tool call(s) in 24h", agent_runs_failed: "failed agent run(s) in 24h",
    budget_high: "agent(s) above 80% of their token budget", automations_failed: "automation run(s) failed in 24h", social_failed: "social post(s) failed in 7 days",
    mcp_tests_failing: "enabled MCP tool(s) failed their last test", tasks_overdue: "overdue task(s)",
    config_auth_secret: "BETTER_AUTH_SECRET is missing or too short", config_encryption: "INTEGRATIONS_SECRET is missing or too short", config_owner_emails: "OWNER_EMAILS is not set",
    config_rate_limit_store: "No shared rate-limit store configured", config_model: "No AI model key configured (GROQ_API_KEY)", config_two_factor_policy: "REQUIRE_2FA is not enabled",
    config_cron_secret: "CRON_SECRET is missing or too short", config_email: "Email is not configured (RESEND_API_KEY)", config_error_tracking: "Error tracking (Sentry) is not configured",
  } as Record<string, string>,
  health: {
    auth_secret: "Auth secret", encryption: "Token encryption key", owner_emails: "Owner emails", model: "AI model key", two_factor_policy: "2FA policy",
    cron_secret: "Cron secret", rate_limit_store: "Shared rate limit", email: "Email", error_tracking: "Error tracking",
  } as Record<string, string>,
};
const ar: typeof en = {
  title: "نظرة القيادة", unavailable: "غير متاح (تعذّر التحميل)",
  attention: "يحتاج انتباهك", allClear: "لا شيء يحتاج انتباهك.",
  system: "صحة النظام", database: "قاعدة البيانات", dbOk: "متاحة", dbDown: "غير متاحة", latency: "مللي ثانية",
  agents: "الوكلاء", agentsOn: "مفعّل", runs24h: "تشغيل (24 ساعة)", failed24h: "فاشل (24 ساعة)",
  approvals: "موافقات معلّقة", approvalsNone: "لا شيء ينتظر.", review: "مراجعة",
  running: "قيد التنفيذ الآن", automationsQ: "تشغيلات الأتمتة (طابور/جارية)", socialQ: "مهام النشر (طابور/جارية)", tasksIn: "مهام قيد التنفيذ", overdue: "متأخرة",
  mcp: "أدوات MCP", mcpTools: "أداة", mcpEnabled: "مفعّلة", mcpDangerous: "خطرة", mcpFailing: "فشل آخر اختبار",
  integrations: "التكاملات", connected: "متصلة", broken: "تحتاج انتباهاً", none: "لا شيء",
  scheduled: "المجدول", nextAutomations: "التشغيلات القادمة للأتمتة", nextSocial: "المنشور القادم", nothingScheduled: "لا شيء مجدول.",
  social: "النشر الاجتماعي", published7d: "منشور (7 أيام)", failed7d: "فاشل (7 أيام)", accounts: "حسابات",
  failures: "آخر الإخفاقات", noFailures: "لا إخفاقات في آخر 24 ساعة.", open: "فتح",
  w: {
    db_down: "قاعدة البيانات غير متاحة", budget_exhausted: "وكيل/وكلاء بلغوا ميزانية الرموز", integrations_broken: "تكامل/تكاملات منتهية أو بها خطأ",
    approvals_pending: "استدعاء/استدعاءات أدوات تنتظر موافقتك", failed_calls: "استدعاء أداة فاشل خلال 24 ساعة", agent_runs_failed: "تشغيل وكيل فاشل خلال 24 ساعة",
    budget_high: "وكيل/وكلاء فوق 80% من ميزانية الرموز", automations_failed: "تشغيل أتمتة فاشل خلال 24 ساعة", social_failed: "منشور اجتماعي فاشل خلال 7 أيام",
    mcp_tests_failing: "أداة/أدوات MCP مفعّلة فشل آخر اختبار لها", tasks_overdue: "مهمة/مهام متأخرة",
    config_auth_secret: "BETTER_AUTH_SECRET مفقود أو قصير", config_encryption: "INTEGRATIONS_SECRET مفقود أو قصير", config_owner_emails: "OWNER_EMAILS غير مضبوط",
    config_rate_limit_store: "لا يوجد مخزن مشترك لتحديد المعدّل", config_model: "لا يوجد مفتاح نموذج ذكاء اصطناعي (GROQ_API_KEY)", config_two_factor_policy: "سياسة REQUIRE_2FA غير مفعّلة",
    config_cron_secret: "CRON_SECRET مفقود أو قصير", config_email: "البريد غير مضبوط (RESEND_API_KEY)", config_error_tracking: "تتبّع الأخطاء (Sentry) غير مضبوط",
  } as Record<string, string>,
  health: {
    auth_secret: "سر المصادقة", encryption: "مفتاح تشفير الرموز", owner_emails: "بريد المالكين", model: "مفتاح نموذج الذكاء الاصطناعي", two_factor_policy: "سياسة 2FA",
    cron_secret: "سر المهام المجدولة", rate_limit_store: "تحديد المعدّل المشترك", email: "البريد", error_tracking: "تتبّع الأخطاء",
  } as Record<string, string>,
};
export type OverviewT = typeof en;
export const overviewT = (l: Locale): OverviewT => (l === "ar" ? ar : en);
export const levelColor: Record<Level, string> = { ok: "text-ok", info: "text-muted", warn: "text-warn", err: "text-err" };
