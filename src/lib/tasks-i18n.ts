import type { Locale } from "@/lib/i18n";

const en = {
  back: "All projects", board: "Task board", progress: "Progress", tasksDone: "{done} of {total} done", noTasks: "No tasks yet.",
  col: { todo: "To do", in_progress: "In progress", blocked: "Blocked", done: "Done" } as Record<string, string>,
  pri: { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" } as Record<string, string>,
  addTask: "Add task", title: "Title", description: "Description", priority: "Priority", due: "Due date", assignee: "Assignee",
  save: "Save", cancel: "Cancel", edit: "Edit", delete: "Delete", confirmDelete: "Delete this task?", left: "Move left", right: "Move right", up: "Up", down: "Down",
  overdue: "Overdue", saved: "Saved.", working: "Working…",
  meta: "Details & documentation", docs: "Documentation", docsHint: "Runbooks, decisions, links. Plain text.", projectDescription: "Description",
  archive: "Archive project", unarchive: "Restore project", archived: "Archived", archiveNote: "Archiving hides the project from default lists and the active count. Nothing is deleted.",
  confirmArchive: "Archive this project?",
  tools: "MCP tools", noTools: "No tools registered.", manageTools: "Manage in MCP", enabledLabel: "enabled", disabledLabel: "disabled",
  activity: "Recent activity", noActivity: "No activity yet.",
  status: "Status", category: "Category", endpoint: "MCP endpoint",
};
const ar: typeof en = {
  back: "كل المشاريع", board: "لوحة المهام", progress: "التقدم", tasksDone: "{done} من {total} مكتملة", noTasks: "لا توجد مهام بعد.",
  col: { todo: "للتنفيذ", in_progress: "قيد التنفيذ", blocked: "معطّلة", done: "مكتملة" } as Record<string, string>,
  pri: { low: "منخفضة", normal: "عادية", high: "عالية", urgent: "عاجلة" } as Record<string, string>,
  addTask: "إضافة مهمة", title: "العنوان", description: "الوصف", priority: "الأولوية", due: "تاريخ الاستحقاق", assignee: "المسؤول",
  save: "حفظ", cancel: "إلغاء", edit: "تعديل", delete: "حذف", confirmDelete: "حذف هذه المهمة؟", left: "نقل لليسار", right: "نقل لليمين", up: "أعلى", down: "أسفل",
  overdue: "متأخرة", saved: "تم الحفظ.", working: "جارٍ التنفيذ…",
  meta: "التفاصيل والتوثيق", docs: "التوثيق", docsHint: "إجراءات تشغيل وقرارات وروابط. نص عادي.", projectDescription: "الوصف",
  archive: "أرشفة المشروع", unarchive: "استعادة المشروع", archived: "مؤرشف", archiveNote: "الأرشفة تخفي المشروع من القوائم الافتراضية وعدّاد النشطة. لا يُحذف شيء.",
  confirmArchive: "أرشفة هذا المشروع؟",
  tools: "أدوات MCP", noTools: "لا توجد أدوات مسجلة.", manageTools: "الإدارة من MCP", enabledLabel: "مفعّلة", disabledLabel: "معطّلة",
  activity: "آخر النشاطات", noActivity: "لا يوجد نشاط بعد.",
  status: "الحالة", category: "التصنيف", endpoint: "نقطة MCP",
};
export type BoardT = typeof en;
export const boardT = (l: Locale): BoardT => (l === "ar" ? ar : en);
