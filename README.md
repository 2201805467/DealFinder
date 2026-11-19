# DealFinder

المرجع الأساسي هو [PROJECT_SPEC.md](PROJECT_SPEC.md). الأولوية الحالية تطبيق Full-Stack Mobile ببيانات حقيقية للـCV وPortfolio. تدمج المرحلة السابعة CheapShark وGamerPower عبر واجهاتهما العامة دون حسابات أو مفاتيح، مع فصل المصدر عن البائع والإسناد والاحتفاظ المحدود. Best Buy معلق، وAwin رفض الطلب، وAliExpress Affiliate approved لكن صلاحيات المطور غير مكتملة، وWooCommerce محلي/Mock. [حالة المصادر وشروطها](docs/DATA_SOURCES.md) و[نتائج المرحلة السابعة](docs/PHASE7_REPORT.md).

المرحلة السادسة أضافت فحوص الجودة والأمان والحمل وإصلاحات المزامنة والواجهة. النتائج التاريخية في [QA_REPORT](docs/QA_REPORT.md) و[SECURITY_AUDIT](docs/SECURITY_AUDIT.md) و[PERFORMANCE_REPORT](docs/PERFORMANCE_REPORT.md)، والقيود الحالية في [KNOWN_ISSUES](docs/KNOWN_ISSUES.md). لم يبدأ النشر.

المرحلة6.1 حسنت عوامل التقييم وأضافت Cursor اختياريًا للأحدث وقوالب أدوار PostgreSQL منفصلة. راجع [نتائج تحسين الأداء](docs/PERFORMANCE_OPTIMIZATION.md) و[إرشادات الأدوار](docs/DATABASE_ROLES.md). لا يوجد نشر أو حساب إنتاج؛ أهداف الأداء التي لم تتحقق ما زالت موثقة صراحة.

أضافت المرحلة الخامسة تطبيق Flutter داخل `mobile` لعرض العروض والبحث والتصفية والتفاصيل والمفضلة المحلية والإعدادات، مع Demo Mode صريح وحجب البيانات الاصطناعية في Release. [دليل تشغيل تطبيق الموبايل وبنيته واختباراته](mobile/README.md).

تضيف المرحلة الرابعة Worker مستقلًا ومزامنة Mock اصطناعية وتقييم عروض قابلًا للتفسير. التشغيل مغلق افتراضيًا وممنوع للبيانات الاصطناعية في الإنتاج. [دليل المزامنة والتقييم](docs/SYNCHRONIZATION.md) يشرح الأوامر والجدولة والحدود والأوزان وMigration الجديدة.

## عرض البيانات الحقيقية محليًا

من Git Bash، بعد تجهيز `.env` وPostgreSQL كما في التعليمات التالية:

```bash
cd backend
docker compose up -d --wait
npm run db:migrate
npm run cheapshark:sync -- --confirm --limit 20
npm run gamerpower:sync -- --confirm --limit 20
npm run dev
```

في نافذة أخرى:

```bash
cd mobile
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1 --dart-define=DEMO_MODE=false
```

`10.0.2.2` خاص بمحاكي Android؛ الهاتف يحتاج عنوان جهاز التطوير المتاح له. لا endpoint إنترنت أو نشر في هذه المرحلة. إذا علق PowerShell داخل flutter.bat راجع بديل Windows المحلي في `mobile/README.md`.

تنتهي صلاحية عينات CheapShark بعد30 دقيقة وGamerPower بعد10 دقائق، فتختفي من الواجهة؛ هذا مقصود لحماية حداثة البيانات. أعد المزامنة يدويًا عند الحاجة. CheapShark يدوي محدود فقط. للجدولة الاختيارية لـGamerPower في نافذة مستقلة:

```bash
cd backend
WORKER_ENABLED=true WORKER_ALLOW_SYNTHETIC=false GAMERPOWER_ENABLED=true npm run worker:real
```

العامل مستقل ولا يبدأ معExpress؛ التفعيل مغلق افتراضيًا. يعيد GamerPower طلب خلاصة كل300 ثانية، وينظف البيانات المنتهية دوريًا. `npm run db:purge-expired` صيانة يدوية بديلة. الأسعارUSD دون تحويل عملة، والسوق غير معروف؛ اترك مرشح الدولة فارغًا ولا تفترض إتاحة عالمية. `view=all` يعرض المجاني أيضًا؛ مسارdeals دونview يحافظ على شرط الخصم السابق. لا تعرض قيمةWorth كتخفيض موثوق.

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
| `API_RATE_LIMIT_MAX` | عدد الطلبات لكل IP خلال دقيقة، افتراضيًا300. حد القبول64 طلبًا جاريًا لكل عملية؛ trust proxy مغلق |
| `CATALOG_INCLUDE_SYNTHETIC` | false افتراضيًا؛ يسمح ببياناتDemo فقط عندtrue فيالتطوير، ويُتجاهل فيالإنتاج. يلزمDEMO_MODE=true صراحةً فيFlutter لعرضها |
| `CHEAPSHARK_ENABLED`, `GAMERPOWER_ENABLED` | false افتراضيًا؛ تفعيل مستقل للعامل الحقيقي. CheapShark لا يدخل الجدولة حتى عندتفعيله |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | إعدادات حاوية PostgreSQL المحلية |
| `POSTGRES_PORT` | منفذ PostgreSQL المحلي، افتراضيًا `5432` |

غيّر كلمة المرور التوضيحية في `POSTGRES_PASSWORD` وفي `DATABASE_URL` بالقيمة نفسها، ورمّز المحارف الخاصة في جزء كلمة المرور داخل URL. يجب أن يتطابق المستخدم واسم قاعدة البيانات والمنفذ في الرابط مع إعدادات PostgreSQL. متغيرات `POSTGRES_*` تهيئ الحاوية فقط عند إنشاء وحدة تخزين جديدة؛ تغييرها لاحقًا لا يغير حسابات قاعدة موجودة.

رابط PostgreSQL البعيد في production يحتاج `sslmode=verify-full` وشهادة موثوقة. حساب الحاوية المحلي ليس حساب تشغيل إنتاج. Pool التطبيق10 اتصالات معSQL timeout5s، وتعطيل parallel workers لكل استعلام لتجنب استنفاد `/dev/shm` في الحاوية المحلية. لا تغير هذه الحدود أوtrust proxy قبل قياس بيئة التشغيل.

## PostgreSQL وPrisma

```powershell
docker compose up -d postgres
docker compose ps
npm run prisma:validate
npm run prisma:generate
npm run db:check
```

يمكن استخدام PostgreSQL محلي موجود بتعديل `DATABASE_URL` دون Docker. ينفذ `db:check` استعلام `SELECT 1` عبر Prisma، ثم يغلق الاتصال ويعيد رمز خروج غير صفري عند الفشل. لا ينشئ أي جداول.

يحتوي `prisma/schema.prisma` على merchants وcategories وproducts وoffers وsync_runs. يقرأ `prisma.config.ts` رابط الاتصال من البيئة وفق إعداد Prisma 7. طبّق الترحيلات قبل استخدام واجهات المنتجات؛ يعاد توليد العميل أثناء البناء ولا يُحفظ الناتج المولد في Git.

```powershell
npm run db:migrate
npm run db:seed
```

Seed للتطوير المحلي فقط، وبياناته موسومة DEMO و`isSynthetic=true` وتُحجب في الإنتاج. تفاصيل الجداول والإدخال والاحتفاظ والمرشحات وأمثلة REST وإعداد قاعدة الاختبار المستقلة في [دليل قاعدة المنتجات والعروض](docs/CATALOG.md). لا تستخدم أوامر reset لحل اختلافات قاعدة بيانات قائمة.

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

تغطي اختبارات Best Buy الإضافية التحويل والأسعار والخصم والقيود وPagination والأخطاء والمهلة الزمنية باستجابات Mock فقط، دون الاتصال بالمتجر. تفاصيل المصدر والتسجيل وحدود الاستخدام في [دليل Best Buy](docs/BESTBUY.md).

Best Buy موقوف مؤقتًا بسبب عائق التسجيل؛ أمره محفوظ للتشغيل الصريح فقط إذا استؤنف لاحقًا بعد التفعيل:

```powershell
npm run bestbuy:sample -- --limit 20
```

المفتاح اختياري لتشغيل Backend وفحص الصحة، ومطلوب لأمر العينة فقط. الأمر لا يستخدم بيانات بديلة عند الفشل ولا يحفظ المنتجات في قاعدة البيانات.

لتشغيل عينات WooCommerce المحلية وإعداد متجر Docker التجريبي، اتبع [دليل WooCommerce](docs/WOOCOMMERCE.md). يضبط عنوان المتجر واسمه ونوع الاستخدام في متغيرات البيئة، ولا يستخدم الخادم أي مزود تلقائيًا:

```powershell
npm run woocommerce:sample -- --limit 20
npm run woocommerce:sample -- --on-sale --limit 20
```

## تنظيم الكود

```text
backend/
  prisma/schema.prisma       نماذج المنتجات والعروض وسياسات المصادر
  prisma/migrations/        ترحيلات PostgreSQL المراجعة
  prisma.config.ts          إعداد Prisma CLI
  src/
    app.ts                  تركيب Express دون فتح منفذ
    server.ts               تشغيل HTTP وإيقافه
    config/env.ts           قراءة الإعدادات والتحقق منها
    config/bestbuy.ts       إعداد مفتاح Best Buy والمهلة بشكل مستقل
    routes/index.ts         مسارات API v1
    controllers/            معالجة طلبات HTTP وفحص المدخلات
    services/               استعلامات الكتالوج والإدخال والحساب العشري
    middleware/             404 ومعالجة الأخطاء المركزية
    database/               إنشاء عميل Prisma وفحص الاتصال
    utils/logger.ts         سجلات JSON دون أسرار
    providers/              واجهة StoreProvider ومزودا Best Buy وWooCommerce
    scripts/                أمر جلب عينة حقيقية من Terminal
  tests/                    اختبارات HTTP والإعدادات
  compose.yaml              PostgreSQL للتطوير المحلي
```

`src/jobs/` يحوي العامل المستقل، و`src/scoring/` يحوي التقييم. لا توجد ملفات أو طبقات فارغة تمهيدية. لا تستخدم Health Service لأن فحص الصحة الحالي لا يحتاج منطق أعمال، ولا يبدأ Worker مع Express.

المفاتيح تبقى في إعدادات الخادم ولا تُرسل للموبايل. لا يوجد تسجيل دخول. عينات المصدرين العامين تحفظ مؤقتًا وفق السياسة الموثقة، ولا يبدأ أي تكامل مع Best Buy أوWooCommerce تلقائيًا. إعداد Docker هنا للتطوير المحلي فقط؛ إعداد الإنتاج والنشر ضمن مرحلة منفصلة غير مصرح بها الآن.

مراجع الإعداد: [Prisma 7](https://www.prisma.io/docs/orm/v7)، و[معالجة الأخطاء في Express 5](https://expressjs.com/en/5x/guide/error-handling/).
