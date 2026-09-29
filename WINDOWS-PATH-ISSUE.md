# ⚠️ مشكلة مسارات Windows في Vitest

## المشكلة

الاختبارات لا تعمل على Windows بسبب خطأ `spawn EPERM` في Vite/Vitest:

```
Error: spawn EPERM
    at windowsSafeRealPathSync
    at bundleConfigFile
```

**السبب الجذري:**  
مسار المشروع يحتوي على مسافة: `C:\Users\aihmo\alle folder von code\rashid-hq-os`

Vite/Vitest يستخدم `child_process.exec` لحل المسارات الحقيقية (realpath) على Windows، والذي يفشل مع المسارات التي تحتوي على مسافات في Node v24.

## الحلول الممكنة

### ✅ الحل 1: نقل المشروع لمسار بدون مسافات (الأسهل)

```powershell
# انقل المشروع إلى مسار بدون مسافات
cd C:\Users\aihmo
mkdir code  # أو projects
Move-Item "alle folder von code\rashid-hq-os" "code\rashid-hq-os"
cd code\rashid-hq-os

# جرب الاختبارات الآن
npm test
```

### ⚙️ الحل 2: استخدام مسار مختصر (8.3 format)

```powershell
# اعرض المسار المختصر
fsutil file shortname "C:\Users\aihmo\alle folder von code"
# قد يعطيك: C:\Users\aihmo\ALLEFO~1

cd C:\Users\aihmo\ALLEFO~1\rashid-hq-os
npm test
```

### 🔧 الحل 3: استخدام WSL (Windows Subsystem for Linux)

```bash
# في WSL
cd /mnt/c/Users/aihmo/alle\ folder\ von\ code/rashid-hq-os
npm test
```

### 🐛 الحل 4: استخدام Jest بدلاً من Vitest (آخر حل)

```bash
npm uninstall vitest
npm install --save-dev jest @types/jest ts-jest

# ثم أنشئ jest.config.js
```

## الحل الموصى به

**انقل المشروع** إلى مسار بدون مسافات. هذا هو الحل الأنظف وسيتجنب مشاكل مستقبلية مع أدوات أخرى.

```powershell
# الخطوات الكاملة:
cd C:\Users\aihmo
mkdir projects
Move-Item "alle folder von code\rashid-hq-os" "projects\rashid-hq-os"
cd projects\rashid-hq-os

# تحقق من الاختبارات
npm test

# إذا نجح، احذف المجلد القديم
Remove-Item "C:\Users\aihmo\alle folder von code" -Recurse -Confirm
```

## الحالة الحالية

- ✅ Vitest مُثبت ويعمل (`npx vitest --version`)
- ❌ تشغيل الاختبارات يفشل بسبب المسار
- ⚠️ حاولنا تعديل `vitest.config.mts` لكن المشكلة في Vite نفسه

## Issue المرتبطة

- https://github.com/vitejs/vite/issues/15714
- https://github.com/vitest-dev/vitest/issues/4842

## ملاحظة

هذه ليست مشكلة في الكود أو التكوين - إنها قيد معروف في Vite مع مسارات Windows التي تحتوي على مسافات.

---

**تاريخ الإنشاء:** 27 سبتمبر 2026  
**الحالة:** Blocked - يحتاج نقل المشروع
