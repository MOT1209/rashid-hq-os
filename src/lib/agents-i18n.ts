import type { Locale } from "@/lib/i18n";

const en = {
  title: "Agents", subtitle: "Configure, test and monitor every agent: tools, permissions, project scope and real performance.", nav: "Agents",
  note: "Agents are the departments: instructions, model, budget and standing task are edited on each agent's department page. This page adds enable/disable, tool and project limits, testing and performance.",
  newAgent: "New agent", create: "Create agent", created: "Agent created.", key: "Key (URL id)", nameEn: "English name", nameAr: "Arabic name", agentName: "Agent display name", icon: "Icon", instructions: "Instructions", model: "Model (optional)",
  empty: "No agents.", custom: "custom", disabled: "Disabled", enabledBadge: "Enabled", enabled: "Enabled", readOnly: "Read-only (can look things up, cannot change anything)",
  tools: "Tools", allTools: "All tools this agent's mode allows", selectedTools: "Only the selected tools", readTools: "Read", writeTools: "Write",
  projects: "Project scope", allProjects: "No restriction: may act on any project", projectsNote: "If you tick projects, calls naming any other project are refused.",
  save: "Save", saved: "Saved.", test: "Run self-test", testNote: "Real model run, read-only tools, counts against the token budget.", testing: "Testing…", testResult: "Self-test result", steps: "steps",
  delete: "Delete", confirmDelete: "Delete this agent? Projects keep their data.", openDept: "Instructions & standing task", working: "Working…",
  performance: "Performance (30 days)", runs: "Runs", successRate: "Success rate", avgDuration: "Avg duration", avgSteps: "Avg steps", tokens: "Tokens (in / out)", lastRun: "Last run", never: "never", none: "—",
  budget: "Token budget", unlimited: "unlimited", used: "used", costNote: "Cost is not shown: only token counts are recorded.",
  failures: "Recent failures (7 days)", noFailures: "No failures recorded.", noRuns: "No runs in the last 30 days.",
  kinds: { console: "console", delegation: "delegated", standing_task: "standing task", social_assist: "content assistant" } as Record<string, string>,
  seconds: "s",
};
const ar: typeof en = {
  title: "الوكلاء", subtitle: "إعداد كل وكيل واختباره ومراقبته: الأدوات والصلاحيات ونطاق المشاريع والأداء الفعلي.", nav: "الوكلاء",
  note: "الوكلاء هي الأقسام: التعليمات والنموذج والميزانية والمهمة الدائمة تُعدَّل من صفحة قسم كل وكيل. تضيف هذه الصفحة التفعيل والتعطيل وحدود الأدوات والمشاريع والاختبار والأداء.",
  newAgent: "وكيل جديد", create: "إنشاء وكيل", created: "تم إنشاء الوكيل.", key: "المعرّف (في الرابط)", nameEn: "الاسم بالإنجليزية", nameAr: "الاسم بالعربية", agentName: "اسم الوكيل المعروض", icon: "الأيقونة", instructions: "التعليمات", model: "النموذج (اختياري)",
  empty: "لا يوجد وكلاء.", custom: "مخصّص", disabled: "معطّل", enabledBadge: "مفعّل", enabled: "مفعّل", readOnly: "قراءة فقط (يبحث ولا يغيّر شيئاً)",
  tools: "الأدوات", allTools: "كل الأدوات التي يسمح بها نمط تشغيل الوكيل", selectedTools: "الأدوات المحددة فقط", readTools: "قراءة", writeTools: "كتابة",
  projects: "نطاق المشاريع", allProjects: "بلا قيد: يعمل على أي مشروع", projectsNote: "إذا حدّدت مشاريع فستُرفض أي استدعاءات تذكر مشروعاً آخر.",
  save: "حفظ", saved: "تم الحفظ.", test: "تشغيل اختبار ذاتي", testNote: "تشغيل نموذج حقيقي بأدوات قراءة فقط، ويُحتسب من ميزانية الرموز.", testing: "جارٍ الاختبار…", testResult: "نتيجة الاختبار", steps: "خطوات",
  delete: "حذف", confirmDelete: "حذف هذا الوكيل؟ تبقى بيانات المشاريع.", openDept: "التعليمات والمهمة الدائمة", working: "جارٍ التنفيذ…",
  performance: "الأداء (30 يوماً)", runs: "التشغيلات", successRate: "نسبة النجاح", avgDuration: "متوسط المدة", avgSteps: "متوسط الخطوات", tokens: "الرموز (دخل / خرج)", lastRun: "آخر تشغيل", never: "أبداً", none: "—",
  budget: "ميزانية الرموز", unlimited: "غير محدودة", used: "مستخدم", costNote: "لا تُعرض التكلفة: تُسجَّل أعداد الرموز فقط.",
  failures: "آخر الإخفاقات (7 أيام)", noFailures: "لا إخفاقات مسجّلة.", noRuns: "لا تشغيلات في آخر 30 يوماً.",
  kinds: { console: "الكونسول", delegation: "مفوَّض", standing_task: "مهمة دائمة", social_assist: "مساعد المحتوى" } as Record<string, string>,
  seconds: "ث",
};
export type AgentsT = typeof en;
export const agentsT = (l: Locale): AgentsT => (l === "ar" ? ar : en);
