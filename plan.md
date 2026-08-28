# خطة العمل — Alking HQ OS

> آخر تحديث: 2026-08-28 · آخر commit: `9c06030` · الإنتاج: https://rashid-hq-os.vercel.app

هذه الوثيقة نقطة الاستئناف. تقرأها وتعرف: أين وصلنا، ما الذي يعمل فعلاً، ما الذي ما زال مكسورًا، وما الخطوة التالية ولماذا.

---

## 1. أين وصلنا

### نظام الوكلاء — يعمل ومُثبت بالدليل
وكلاء الأقسام كانوا **نصًا في برومبت بلا منفّذ**. الآن صاروا حقيقيين:

- كل قسم في جدول `departments` له `system_prompt` و `model` (migration `0011`)
- الكونسول يفوّض عبر أداة `delegate_to_department`
- وكيل القسم ينفّذ بنفس سجل الأدوات، ويسجّل باسمه (`agent_name`)
- **الدليل**: أول سجل في تاريخ المشروع باسم `Dev Agent` مع `list_projects` بحالة `success`

الأثر الملموس: صفحات الأقسام كانت تعرض «لا توجد نشاطات بعد» **إلى الأبد** — لأن لا شيء يسجّل بأسمائهم. الآن تضيء.

### ما أُنجز قبل ذلك في هذه الجلسة
| الميزة | الحالة |
|---|---|
| تنبيه إيميل عند فشل مشروع 3 مرات متتالية | الكود يعمل — **لكن لا يصل** (انظر §2) |
| إعادة محاولة في الفحص الصحي (تقلل الإنذارات الكاذبة) | ✅ |
| تنبيه تفعيل 2FA لحساب المالك | ✅ |
| تصدير CSV لسجل النشاط | ✅ |
| بحث سريع عن المشاريع (يدعم تطبيع العربية) | ✅ |
| تسجيل عمليات الدخول | ✅ |
| تحسينات صفحة القسم (KPIs، جدول تفاعلي، فلترة، إضافة مشروع، آخر فحص صحي، تبويبات) | ✅ |
| 18 مهارة وكلاء من skills.sh | ✅ |

### التحقق الحالي
`typecheck` ✅ · `lint` ✅ · `build` ✅ · `vitest` ✅ **167/167** (22 ملف)

---

## 2. ما هو مكسور أو ناقص الآن

### أ. تنبيهات الفشل — تعمل للمالك عبر عنوان Resend الجاهز (قرار 2026-08-28)
`rashid-wep.com` بلا DNS zone إطلاقًا (`Non-existent domain`) وحالته في Resend `not_started`. إصلاحه يتطلب وصولًا للمُسجّل لا نملكه، **وقرار المالك: تجاهله.**

الحل المعتمد: `EMAIL_FROM` غير مضبوط → الكود يرجع لـ `onboarding@resend.dev` (انظر `src/lib/email.ts:24`). هذا يُسلّم **لعنوان صاحب حساب Resend فقط** — وهو كافٍ لمركز قيادة بمالك واحد.

**تحقق واحد متبقٍّ:** `OWNER_EMAILS` في Vercel يجب أن يحوي نفس إيميل حساب Resend، وإلا تفشل التنبيهات بصمت. سجلات Resend لو احتيجت لاحقًا: DKIM `resend._domainkey` (TXT) · SPF `send` (MX `feedback-smtp.us-east-1.amazonses.com` pri 10) · SPF `send` (TXT `v=spf1 include:amazonses.com ~all`).

### ب. ~~توقيع الطلبات الصادرة~~ — مفعّل ✅ (2026-08-27)
`OUTBOUND_SIGNING_SECRET` مضبوط في Vercel (Production). نقطة `/api/project-tools` ترفض أي طلب بلا توقيع HMAC صحيح (تحقق: `whoami` غير موقّع → 401 على الإنتاج). أُضيف أيضًا `CRON_SECRET` (كان ناقصًا — الفحص الصحي المجدول كان يُرفض) و `TOKEN_PEPPER`.

### ج. ~~`Demo Project`~~ — محذوف ✅ (2026-08-27)

### د. ~~مفتاح Groq مكشوف~~ — مُدوّر ومُلغى ✅ (2026-08-27)
`GROQ_API_KEY` في Vercel جديد، والمفتاح القديم حُذف من لوحة Groq.

---

## 3. الخطة — بالأولوية

### ~~أولوية 1: واجهة تحرير الوكلاء~~ ✅ (commit `a5932fc`)
لوحة «وكلاء الأقسام» في `/dashboard/settings` (مشرف فقط) لتحرير `system_prompt` و `model` لكل قسم. `requireAdmin`، وتسجيل `update_department_agent` في `agent_logs`.
**تحقق متبقٍّ:** عدّل برومبت Dev Agent من الواجهة، فوّض له مهمة، ولاحظ تغيّر سلوكه.

### ~~أولوية 2: إعطاء الوكلاء شيئًا يشغّلونه~~ ✅ (commit `6783e2a`)
نقطة `‎/api/project-tools` داخل الريبو: تحقّق توقيع HMAC + نافذة إعادة تشغيل 5 دقائق + أدوات `ping`/`echo`/`whoami`. مسجّلة كـ `mcp_endpoint` على `conecter-app` و `EDITOR.AI` و `Englisch-app`. `call_project_tool` صار يعمل من طرف إلى طرف (مُختبر على الإنتاج). أي مشروع حقيقي ينسخ `src/app/api/project-tools/route.ts` في كوده.
**تحقق متبقٍّ:** من صفحة قسم، زر «اختبار» على أداة، أو فوّض للوكيل مهمة يستدعي فيها أداة المشروع.

### ~~أولوية 3: وكلاء مجدولة (المهام الدائمة)~~ ✅ (migration `0012`)
- عمودان على `departments`: `standing_task` (فارغ = لا شيء) و `standing_task_enabled` (مفتاح إيقاف يحفظ النص)
- cron `‎/api/agent/standing-tasks` يوميًا 07:00 UTC — نفس مصادقة `daily-check` (سرّ cron أو جلسة مالك)
- يعيد استخدام `runDepartmentAgent` كما هي
- **السقف على 3 جهات:** المفتاح المُفعّل · حارس تشغيلة-واحدة-يوميًا (`ranOnDay`) · `MAX_STEPS=6` داخل المنفّذ. وسقف `MAX_DEPARTMENTS_PER_RUN=10`
- التحرير من نفس لوحة «وكلاء الأقسام» في `/dashboard/settings`
- **تحقق متبقٍّ:** اضبط مهمة دائمة لقسم من الواجهة، ثم `GET /api/agent/standing-tasks` بجلسة المالك، ولاحظ ظهور `standing_task` في البث

### ~~أولوية 4: تفعيل تسليم البريد~~ — القرار: عنوان Resend الجاهز (2026-08-28)
الدومين المخصّص مُتجاهَل (انظر §2.أ). البريد يُسلَّم لصاحب حساب Resend عبر `onboarding@resend.dev`. الوحيد المتبقّي: التأكد أن `OWNER_EMAILS` في Vercel = إيميل حساب Resend.

### أولوية 5: تنظيف
- ~~حذف `Demo Project`~~ ✅ (2026-08-27)
- ~~ضبط `OUTBOUND_SIGNING_SECRET` + `CRON_SECRET` + `TOKEN_PEPPER` في Vercel~~ ✅ (2026-08-27)
- ~~إلغاء مفتاح Groq القديم~~ ✅ (2026-08-27)
- **Sentry**: ✅ يعمل ومُثبت بالدليل. `@sentry/nextjs@10` مُوصّل بالكامل (`instrumentation.ts` · `instrumentation-client.ts` · `sentry.server/edge.config.ts` · `withSentryConfig` · `onRequestError` · `global-error.tsx` · `errors.ts` → `Sentry.captureException`). أخطاء + tracing + وسم الإصدارات (release = commit SHA)، بلا Replay (كونسول داخلي بـ CSP صارم). Next 16 + Turbopack. `/monitoring` مستثنى من `proxy.ts`.
  - مشروع Sentry: `alking-enterprises/javascript-nextjs` (US) · `SENTRY_DSN` · `NEXT_PUBLIC_SENTRY_DSN` · `SENTRY_ORG` · `SENTRY_PROJECT` في Vercel (Production + Preview)
  - **الدليل**: خطأ حقيقي من الإنتاج وصل Sentry (`JAVASCRIPT-NEXTJS-1`، وُسم بالإصدار والـ trace، ثم حُلّ). مسار التحقق المؤقت `/api/sentry-check` حُذف
  - **فخ Turbopack**: مُعالِج route عادي لا يُغسَل تلقائيًا — `Sentry.captureException` في route handler يحتاج `await Sentry.flush()` صراحةً وإلا تُفقد الأحداث قبل تجميد الـ lambda. المسار التلقائي (`onRequestError` للأخطاء غير المُلتقَطة) يغسل من نفسه
  - **يبقى (harden، اختياري):** `SENTRY_AUTH_TOKEN` لرفع source maps — بدونه الـ stacktrace في الإنتاج مُصغَّر. من Sentry → Settings → Auth Tokens

### مراجعة شاملة + تقوية (2026-08-28)
مراجعة ٣ محاور (أمن، اختبارات، منتج). التقرير الكامل في `.claude/plans/robust-puzzling-flurry.md`. المُنفَّذ:
- **`45f5888`** — **ثغرة أمنية مُصلَحة**: الوكيل المجدول كان يعمل يوميًا بلا إشراف بصلاحيات كتابة كاملة (حذف مشاريع، حقن نقاط نهاية). الآن `mode: "autonomous"` يقيّده على أدوات القراءة + `call_project_tool` فقط؛ التفويض من الكونسول يبقى كاملًا. + اختبار `tool-schemas` يقفل انحدار `null` من Groq + أخطاء `activity.ts`/MCP تذهب لـ Sentry
- **`a552623`** — تقوية SSRF (صيغ IP الرقمية، mapped-v6 hex، رفض الاتصال غير المثبَّت) · CSRF على مسارات cron عبر `Sec-Fetch-Site` (`src/lib/cron-auth.ts` موحَّد) · `REQUIRE_2FA` (بوابة اختيارية للكتابة) · قواعد rate-limit لـ `/api/agent`·`/api/maintenance`·`/api/activity/export`
- **`9c06030`** — اختبارات أفعال المالك الأساسية (تفويض، ملكية، SSRF، تسجيل)
- **متبقٍّ من التقرير:** `ToolDefinition` عام (0.4) · `buildToolSet` (1.2) · جدول `agent_runs` وتتبّع التكلفة (1.4) · `/dashboard/insights` · بريد ملخّص المهام الدائمة · تنظيف `.env.local`/Vercel (`AI_GATEWAY_API_KEY`, `CEO_CONSOLE_MODEL`)

---

## 4. معرفة مهمة لا تُفقد

هذه أشياء اكتُشفت بالتجربة وتوفّر وقتًا كبيرًا لاحقًا:

### المزوّدون — ثلاثة جُرِّبوا
| المزوّد | النتيجة |
|---|---|
| Vercel AI Gateway | ✗ يرفض كل طلب بلا بطاقة ائتمان (`customer_verification_required`) |
| Google Gemini | ✗ المفاتيح المتاحة كانت رموز `AQ.` مؤقتة تموت خلال دقائق، ومشروع بحصة صفر |
| **Groq** | ✅ مفتاح دائم، بلا بطاقة، واستدعاء أدوات يعمل |

النموذج الافتراضي `openai/gpt-oss-120b` — اختير لقدرته على استدعاء الأدوات تحديدًا (الكونسول يشغّل 14 أداة).

### فخ حقيقي: التحقق الصارم من مخطط الأدوات
Groq يرفض معاملات الأدوات إن لم تطابق المخطط بدقة، **والنموذج يرسل `null` لا `undefined`** للحقول الاختيارية. كل `.optional()` كانت تنفجر:
```
`/category`: expected string, but got null
```
الحل: `.nullish()` في كل مكان. **الاختبارات المحاكاة الـ167 كانت تمر في الحالتين** — لأنها لا تمر بتحقق المزوّد.

**الدرس:** لأي ميزة تعتمد على نموذج، شغّل اختبارًا حيًا مقابل النموذج والقاعدة الحقيقيين. المحاكاة لا تكشف هذه الفئة من الأخطاء.

### فخ حقيقي: اقتباس في متغيّر بيئة يقفل المالك خارجًا (2026-08-28)
`OWNER_EMAILS` في Vercel كان محفوظًا كـ `"zwnt45602@gmail.com"` — بعلامتَي اقتباس (يحدث عند نسخ القيمة من سطر `.env`). النتيجة: الدخول ينجح (كلمة المرور صحيحة، جلسة تُنشأ)، ثم `resolveRole` يفشل لأن `isOwnerEmail` قارن مع الاقتباس، فيُرمى المستخدم لـ `/sign-in?denied=1` برسالة «غير مصرّح». وجدول `members` فارغ فلا بديل.
**الحل:** `ownerEmails()` صار يجرّد الاقتباس المحيط (commit `91156f0`) + أُعيد ضبط المتغيّر نظيفًا.
**الدرس:** رسالة «غير مصرّح» بعد كلمة مرور صحيحة = مشكلة في `OWNER_EMAILS` أو `members`، لا في المصادقة نفسها.

### تفاصيل تقنية تُنسى
- `delegationDepth` في `ToolContext`: الكونسول 0، وكيل القسم 1، والأداة ترفض عند 1. بدونه: حلقة تفويض لا نهائية تحرق رصيدًا
- `"CEO Console"` في سجل النشاط **مصدران**: الذكاء الاصطناعي، و`OWNER_ACTOR` في `src/app/actions.ts:22` لأفعالك اليدوية. هذا خدعني أثناء التشخيص
- `.agents/skills` مستثناة من eslint — ملف مهارة خارجية يستخدم `require()` وكان يُفشل CI
- زر حذف المشروع يستخدم `window.confirm` — يجمّد أتمتة المتصفح، فالحذف يدوي

---

## 5. الحالة النهائية

كل أولويات الخطة (1–5) منجزة. المتبقّي تحقّقات يدوية صغيرة تحتاج وصولك:

| البند | ما تفعله |
|---|---|
| ~~تنبيهات البريد~~ | ✅ يعمل — رسائل إعادة التعيين تصل `zwnt45602@gmail.com` (Opened + Clicked في لوحة Resend) |
| ~~الدخول~~ | ✅ يعمل — بعد إصلاح اقتباس `OWNER_EMAILS` |
| source maps لـ Sentry (اختياري) | `SENTRY_AUTH_TOKEN` في Vercel من Sentry → Settings → Auth Tokens |
| تحقّق الوكلاء المجدولة | اضبط `standing_task` لقسم من `/dashboard/settings` وجرّب |
