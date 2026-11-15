import type { Locale } from "@/lib/i18n";

const en = {
  title: "Skills", subtitle: "Reusable prompt templates for the console and agents, with versions, schemas and usage history.",
  nav: "Skills",
  search: "Search", tag: "Tag", status: "Status", all: "All", enabledOnly: "Enabled", disabledOnly: "Disabled", filter: "Filter",
  newSkill: "New skill", empty: "No skills match.", edit: "Edit", enable: "Enable", disable: "Disable", duplicate: "Duplicate", delete: "Delete",
  confirmDelete: "Delete this skill and all its versions?", exportAll: "Export all", exportOne: "Export", import: "Import", importNote: "Imported skills are added DISABLED so you can review them first.",
  importDone: "Imported {n}.", importFailed: "{n} skill(s) were rejected:", importWarn: "{n} warning(s).",
  disabledBadge: "disabled", versionLabel: "v",
  fName: "Name", fDescription: "Description", fPrompt: "Prompt (use {{variable}} for inputs)", fTags: "Tags (comma separated)",
  fInput: "Input schema (JSON)", fOutput: "Output schema (JSON, informational)", fMetadata: "Metadata (JSON object)",
  schemaHelp: "Format: { \"type\": \"object\", \"properties\": { \"name\": { \"type\": \"string\" } }, \"required\": [\"name\"] }. Types: string, number, integer, boolean.",
  save: "Save", saved: "Saved (version {v}).", warnings: "Warnings", working: "Working…",
  versions: "Versions", current: "current", restore: "Restore", restored: "Restored as version {v}.", noVersions: "No earlier versions.",
  usage: "Usage log", usageNote: "Console picks and agent reads, from the activity log.", usageTotal: "{n} uses", noUsage: "Not used yet.",
  conflict: "Changed elsewhere", close: "Close",
};
const ar: typeof en = {
  title: "المهارات", subtitle: "قوالب أوامر قابلة لإعادة الاستخدام للكونسول والوكلاء، مع إصدارات ومخططات وسجل استخدام.",
  nav: "المهارات",
  search: "بحث", tag: "وسم", status: "الحالة", all: "الكل", enabledOnly: "مفعّلة", disabledOnly: "معطّلة", filter: "تصفية",
  newSkill: "مهارة جديدة", empty: "لا توجد مهارات مطابقة.", edit: "تعديل", enable: "تفعيل", disable: "تعطيل", duplicate: "نسخ", delete: "حذف",
  confirmDelete: "حذف هذه المهارة وكل إصداراتها؟", exportAll: "تصدير الكل", exportOne: "تصدير", import: "استيراد", importNote: "المهارات المستوردة تُضاف معطّلة لتراجعها أولاً.",
  importDone: "تم استيراد {n}.", importFailed: "رُفضت {n} مهارة:", importWarn: "{n} تنبيه.",
  disabledBadge: "معطّلة", versionLabel: "إ",
  fName: "الاسم", fDescription: "الوصف", fPrompt: "النص (استخدم {{متغير}} للمدخلات)", fTags: "الوسوم (مفصولة بفواصل)",
  fInput: "مخطط المدخلات (JSON)", fOutput: "مخطط المخرجات (JSON، للتوثيق)", fMetadata: "بيانات وصفية (كائن JSON)",
  schemaHelp: "الصيغة: { \"type\": \"object\", \"properties\": { \"name\": { \"type\": \"string\" } }, \"required\": [\"name\"] }. الأنواع: string, number, integer, boolean.",
  save: "حفظ", saved: "تم الحفظ (الإصدار {v}).", warnings: "تنبيهات", working: "جارٍ التنفيذ…",
  versions: "الإصدارات", current: "الحالي", restore: "استعادة", restored: "تمت الاستعادة كإصدار {v}.", noVersions: "لا توجد إصدارات سابقة.",
  usage: "سجل الاستخدام", usageNote: "اختيارات الكونسول وقراءات الوكلاء، من سجل النشاط.", usageTotal: "{n} استخدام", noUsage: "لم تُستخدم بعد.",
  conflict: "تغيّرت من مكان آخر", close: "إغلاق",
};
export type SkillsT = typeof en;
export const skillsT = (l: Locale): SkillsT => (l === "ar" ? ar : en);
