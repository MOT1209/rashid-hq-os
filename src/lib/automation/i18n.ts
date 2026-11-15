import type { Locale } from "@/lib/i18n";

const en = {
  title: "Automations", subtitle: "Scheduled, event-driven and manual workflows with retries, history and failure alerts.", nav: "Automations",
  unattendedNote: "Automations run unattended: write tools other than a project's own registered tools are blocked, dangerous tools never run, and nothing can wait for your approval. New automations start paused.",
  newAutomation: "New automation", empty: "No automations yet.", edit: "Edit", delete: "Delete", confirmDelete: "Delete this automation and its run history?",
  pause: "Pause", resume: "Resume", runNow: "Run now", paused: "Paused", active: "Active", close: "Close",
  trigger: "Trigger", trManual: "Manual", trSchedule: "Schedule", trEvent: "Event", cron: "Cron (minute hour day month weekday)", timezone: "Timezone", event: "Event",
  ev: { social_job_failed: "A social post failed for good", social_job_succeeded: "A social post was published", tool_call_failed: "A tool call failed" } as Record<string, string>,
  name: "Name", description: "Description", steps: "Steps", addStep: "Add step", remove: "Remove", up: "Up", down: "Down",
  stepType: "Type", stTool: "Run a tool", stAgent: "Ask a department agent", stNotify: "Email the owners",
  stepId: "Step id", tool: "Tool", toolInput: "Tool input (JSON; may use {{trigger.x}} / {{steps.id.output.x}})", department: "Department", task: "Task", subject: "Subject", message: "Message",
  condition: "Only run if…", condPath: "Path (e.g. steps.a.output.count)", condOp: "Operator", condValue: "Value", none: "Always",
  onFailure: "If it fails", ofStop: "Stop the run", ofContinue: "Continue", stepAttempts: "Max attempts (this step)",
  retry: "Retry policy", maxAttempts: "Default max attempts", backoff: "Base backoff (seconds)", retryNote: "Only read-only tools and email are retried automatically; writes and agent runs are never repeated.",
  notifyFail: "Email me when a run fails", save: "Save", saved: "Saved.", warnings: "Notes", working: "Working…",
  nextRun: "Next run", lastRun: "Last run", never: "never", history: "Run history", noRuns: "No runs yet.", cancel: "Cancel",
  rs: { queued: "Queued", running: "Running", succeeded: "Succeeded", failed: "Failed", cancelled: "Cancelled" } as Record<string, string>,
  ss: { succeeded: "OK", failed: "Failed", skipped: "Skipped", retrying: "Retrying" } as Record<string, string>,
  attempts: "attempts", via: "via",
};
const ar: typeof en = {
  title: "الأتمتة", subtitle: "سير عمل مجدول أو مرتبط بأحداث أو يدوي، مع إعادة محاولة وسجل وتنبيه عند الفشل.", nav: "الأتمتة",
  unattendedNote: "تعمل الأتمتة دون إشراف: أدوات الكتابة غير أدوات المشروع المسجّلة محظورة، والأدوات الخطرة لا تعمل أبداً، ولا شيء ينتظر موافقتك. تبدأ الأتمتة الجديدة متوقفة.",
  newAutomation: "أتمتة جديدة", empty: "لا توجد أتمتة بعد.", edit: "تعديل", delete: "حذف", confirmDelete: "حذف هذه الأتمتة وسجل تشغيلها؟",
  pause: "إيقاف مؤقت", resume: "استئناف", runNow: "تشغيل الآن", paused: "متوقفة", active: "نشطة", close: "إغلاق",
  trigger: "المشغّل", trManual: "يدوي", trSchedule: "جدولة", trEvent: "حدث", cron: "Cron (دقيقة ساعة يوم شهر يوم-أسبوع)", timezone: "المنطقة الزمنية", event: "الحدث",
  ev: { social_job_failed: "فشل منشور اجتماعي نهائياً", social_job_succeeded: "نُشر منشور اجتماعي", tool_call_failed: "فشل استدعاء أداة" } as Record<string, string>,
  name: "الاسم", description: "الوصف", steps: "الخطوات", addStep: "إضافة خطوة", remove: "إزالة", up: "أعلى", down: "أسفل",
  stepType: "النوع", stTool: "تشغيل أداة", stAgent: "سؤال وكيل قسم", stNotify: "إرسال بريد للمالكين",
  stepId: "معرّف الخطوة", tool: "الأداة", toolInput: "مدخلات الأداة (JSON؛ يمكن استخدام {{trigger.x}} / {{steps.id.output.x}})", department: "القسم", task: "المهمة", subject: "الموضوع", message: "الرسالة",
  condition: "تُنفَّذ فقط إذا…", condPath: "المسار (مثل steps.a.output.count)", condOp: "العملية", condValue: "القيمة", none: "دائماً",
  onFailure: "عند الفشل", ofStop: "إيقاف التشغيل", ofContinue: "المتابعة", stepAttempts: "أقصى محاولات (هذه الخطوة)",
  retry: "سياسة إعادة المحاولة", maxAttempts: "أقصى محاولات افتراضياً", backoff: "التأخير الأساسي (ثوانٍ)", retryNote: "تُعاد تلقائياً أدوات القراءة والبريد فقط؛ عمليات الكتابة وتشغيل الوكلاء لا تتكرر أبداً.",
  notifyFail: "أرسل لي بريداً عند فشل التشغيل", save: "حفظ", saved: "تم الحفظ.", warnings: "ملاحظات", working: "جارٍ التنفيذ…",
  nextRun: "التشغيل القادم", lastRun: "آخر تشغيل", never: "أبداً", history: "سجل التشغيل", noRuns: "لا توجد تشغيلات بعد.", cancel: "إلغاء",
  rs: { queued: "في الطابور", running: "قيد التنفيذ", succeeded: "نجح", failed: "فشل", cancelled: "أُلغي" } as Record<string, string>,
  ss: { succeeded: "نجحت", failed: "فشلت", skipped: "تُخطيت", retrying: "إعادة محاولة" } as Record<string, string>,
  attempts: "محاولات", via: "عبر",
};
export type AutoT = typeof en;
export const autoT = (l: Locale): AutoT => (l === "ar" ? ar : en);
