# DealFinder

المرجع الأساسي هو [PROJECT_SPEC.md](PROJECT_SPEC.md). المنجز حاليًا هو المرحلة الأولى فقط: بنية Backend وبيئة التطوير. لا توجد جداول أعمال أو تكاملات متاجر أو تطبيق Flutter بعد.

## متطلبات التشغيل

- Node.js 24 LTS وnpm.
- PostgreSQL 17 محليًا، أو Docker مع Docker Compose وخدمة Docker قيد التشغيل.
- نفّذ أوامر Backend التالية من مجلد `backend`.
- على Windows إذا منع PowerShell تشغيل `npm.ps1` فاستخدم `npm.cmd` بدلًا من `npm`، دون تغيير سياسة تشغيل السكربتات.

## التثبيت والإعداد

```powershell
cd backend
npm ci
Copy-Item .env.example .env
```

على Linux/macOS استخدم `cp .env.example .env`. عدّل `.env` محليًا؛ الملف مستبعد من Git. القيم في المثال محلية وتوضيحية وليست بيانات اعتماد حقيقية.

| المتغير | الغرض |
| --- | --- |
| `NODE_ENV` | `development` أو `test` أو `production` |
| `HOST` | عنوان الاستماع، افتراضيًا `127.0.0.1`؛ استخدم `0.0.0.0` عند الحاجة داخل حاوية |
| `PORT` | منفذ HTTP، افتراضيًا `3000` |
| `DATABASE_URL` | رابط PostgreSQL مطلوب؛ لا تسجله أو تشاركه |
| `CORS_ORIGINS` | أصول HTTP(S) مسموحة مفصولة بفواصل، بلا مسار أو شرطة مائلة أخيرة؛ القيمة الفارغة لا تسمح بطلبات متصفح عبر أصول مختلفة |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | إعدادات حاوية PostgreSQL المحلية |
| `POSTGRES_PORT` | منفذ PostgreSQL المحلي، افتراضيًا `5432` |

غيّر كلمة المرور التوضيحية في `POSTGRES_PASSWORD` وفي `DATABASE_URL` بالقيمة نفسها، ورمّز المحارف الخاصة في جزء كلمة المرور داخل URL. يجب أن يتطابق المستخدم واسم قاعدة البيانات والمنفذ في الرابط مع إعدادات PostgreSQL. متغيرات `POSTGRES_*` تهيئ الحاوية فقط عند إنشاء وحدة تخزين جديدة؛ تغييرها لاحقًا لا يغير حسابات قاعدة موجودة.

## PostgreSQL وPrisma

```powershell
docker compose up -d postgres
docker compose ps
npm run prisma:validate
npm run prisma:generate
npm run db:check
```

يمكن استخدام PostgreSQL محلي موجود بتعديل `DATABASE_URL` دون Docker. ينفذ `db:check` استعلام `SELECT 1` عبر Prisma، ثم يغلق الاتصال ويعيد رمز خروج غير صفري عند الفشل. لا ينشئ أي جداول.

يحتوي `prisma/schema.prisma` على إعداد المولد ومصدر PostgreSQL فقط. يقرأ `prisma.config.ts` رابط الاتصال من البيئة وفق إعداد Prisma 7، ويستخدم العميل محول PostgreSQL. لم تُنشأ Models أو Migrations في هذه المرحلة. يعاد توليد العميل أثناء البناء، ولا يُحفظ الناتج المولد في Git.

لإيقاف الحاوية مع الاحتفاظ بالبيانات:

```powershell
docker compose down
```

## تشغيل Backend

```powershell
npm run prisma:generate
npm run dev
```

لبناء وتشغيل JavaScript:

```powershell
npm run build
npm start
```

للتحقق من الخادم في نافذة أخرى:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/v1/health
```

الاستجابة المتوقعة برمز `200`:

```json
{ "status": "ok", "service": "dealfinder-backend" }
```

هذا الفحص يؤكد أن HTTP يعمل، ولا يدعي جاهزية قاعدة البيانات. استخدم `npm run db:check` لفحصها مستقلًا. يفحص بدء التشغيل متغيرات البيئة عبر Zod، ويوقف التشغيل عند وجود قيم غير صالحة. CORS سياسة للمتصفح وليست آلية مصادقة.

## التحقق والاختبارات

```powershell
npm run prisma:generate
npm run typecheck
npm run build
npm test
npm run format:check
```

يستخدم الاختبار مشغل Node.js المدمج وطلبات HTTP فعلية إلى منفذ محلي مؤقت، ولا يحتاج قاعدة بيانات أو بيانات متاجر. يغطي الصحة و404 وCORS وJSON غير صالح والتحقق من الإعدادات. استخدم `npm run format` لتنسيق الملفات. يعرض [PROGRESS.md](PROGRESS.md) نتائج التحقق الفعلية وحدود البيئة.

## تنظيم الكود

```text
backend/
  prisma/schema.prisma       إعداد قاعدة البيانات بلا جداول
  prisma.config.ts          إعداد Prisma CLI
  src/
    app.ts                  تركيب Express دون فتح منفذ
    server.ts               تشغيل HTTP وإيقافه
    config/env.ts           قراءة الإعدادات والتحقق منها
    routes/index.ts         مسارات API v1
    controllers/            معالجة طلبات HTTP
    middleware/             404 ومعالجة الأخطاء المركزية
    database/               إنشاء عميل Prisma وفحص الاتصال
    utils/logger.ts         سجلات JSON دون أسرار
  tests/                    اختبارات HTTP والإعدادات
  compose.yaml              PostgreSQL للتطوير المحلي
```

عند بدء المراحل المعنية ستضاف `src/services/` لمنطق الأعمال، و`src/providers/` لواجهة `StoreProvider` وتنفيذاتها، و`src/jobs/` لمهام التحديث. لا توجد ملفات أو طبقات فارغة تمهيدية. لا تستخدم Health Service لأن فحص الصحة الحالي لا يحتاج منطق أعمال.

المفاتيح المستقبلية للمتاجر تبقى في الخادم. لا توجد مفاتيح متاجر أو نتائج عروض أو تسجيل دخول في هذه المرحلة. إعداد Docker هنا للتطوير المحلي فقط؛ إعداد الإنتاج والنشر ضمن مرحلتهما المنفصلة.

مراجع الإعداد: [Prisma 7](https://www.prisma.io/docs/orm/v7)، و[معالجة الأخطاء في Express 5](https://expressjs.com/en/5x/guide/error-handling/).
