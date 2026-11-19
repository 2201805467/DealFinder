# أدوار PostgreSQL المقترحة — المرحلة6.1

السكربتات قوالب تُشغل صراحة على قاعدة جديدة مخصصة. لم تُطبق على حساب التطوير أو كلمات مروره أو Docker، ولم تُنشأ بيانات اعتماد إنتاجية. استُخدمت حسابات اختبار مؤقتة وأزيلت بعد التحقق الفعلي.

| الدور | الصلاحيات | ما لا يملكه |
|---|---|---|
| Application | CONNECT وUSAGE وSELECT/INSERT/UPDATE/DELETE على جداول الأعمال الخمسة | superuser وCREATEDB وCREATEROLE وreplication وbypassRLS وCREATE schema/table وTRUNCATE وقراءة سجل Prisma migrations |
| Migration | ملكية public وكائنات الترحيل وCREATE على قاعدة الهدف، لتشغيل migrations وpg_trgm الموثوق | إدارة الأدوار أو إنشاء قواعد أخرى أوsuperuser |
| Administrative | ملكية قاعدة الهدف وإمكانية SET ROLE صريحة إلى Migration للصيانة | دخول تلقائي أو مفاتيح أوsuperuser أوإدارة عنقود PostgreSQL كله |

الأدوار الثلاثة NOLOGIN؛ هي مجموعات صلاحيات فقط. يجهز المشغل هوية دخول منفصلة عبر آلية الأسرار/المصادقة المعتمدة لاحقًا، دون وضع كلمة مرور فيGit أو command line. لا يمنح التطبيق عضوية Migration أوAdministrative. استخدم هوية تشغيل منفصلة للـWorker بحسب الحاجة، ولا تشغل API بحساب الترحيلات. هوية إدارية للعنقود ينظمها مشغل قاعدة الإنتاج خارج هذه القوالب.

## ترتيب الإعداد على قاعدة جديدة

باستخدام psql واتصال إداري مخزن بطريقة آمنة، عرّف أسماء الأدوار وقاعدة الهدف عبر `-v`:

```bash
psql "$ADMIN_CONNECTION" -X -v ON_ERROR_STOP=1 \
  -v app_role=dealfinder_app -v migration_role=dealfinder_migration \
  -v admin_role=dealfinder_admin -f database/roles.sql

# أنشئ قاعدة الهدف الجديدة إداريًا، ثم اتصل بها صراحة.
psql "$NEW_DATABASE_ADMIN_CONNECTION" -X -v ON_ERROR_STOP=1 \
  -v database_name=dealfinder_production \
  -v app_role=dealfinder_app -v migration_role=dealfinder_migration \
  -v admin_role=dealfinder_admin -f database/database-privileges.sql

# باستخدام هوية الترحيل الخاصة بقاعدة الهدف:
MIGRATION_DATABASE_URL="$MIGRATION_CONNECTION" npm run db:migrate

psql "$NEW_DATABASE_ADMIN_CONNECTION" -X -v ON_ERROR_STOP=1 \
  -v app_role=dealfinder_app -f database/application-privileges.sql
```

الأسماء والقيم أعلاه توضيحية؛ لم تُنشأ هذه الأدوار الإنتاجية أو قاعدة بهذا الاسم. لا تطبق سكربت ملكية القاعدة على dealfinder المحلية. اجعل هوية الترحيل تنفذ `SET ROLE dealfinder_migration` عند الاتصال، مثل خيار اتصال PostgreSQL `options=-c role=dealfinder_migration` المشفر داخلURL، حتى تكون ملكية الكائنات للدور المقصود. اختُبر هذا فعليًا في القاعدة المؤقتة.

Prisma CLI يستخدم MIGRATION_DATABASE_URL عند توفيره، وإلا يعود إلى DATABASE_URL للتوافق المحلي. الخادم وWorker يستخدمان DATABASE_URL فقط. المشغل مسؤول عن مطابقة المضيف/المنفذ/القاعدة في الرابطين؛ لا توجه ترحيلًا إلى قاعدة غير مقصودة. أدوات الاختبار تضبط رابط الترحيل إلى قاعدة الاختبار نفسها صراحة حتى لا ترث رابطًا آخر من البيئة.

سكربت التطبيق يمنح قائمة جداول صريحة، ويجب مراجعته بعد إضافة جداول مستقبلًا. لا تمنح ALL TABLES أو صلاحيات default على جداول مستقبلية للتطبيق، كي لا يحصل على وصول إلى `_prisma_migrations` أو جداول إدارة جديدة. لا تحتاج معرفاتUUID الحالية إلى صلاحيات sequences. لا تستخدم Prisma reset/db push أو migrate dev بصلاحية التطبيق؛ shadow database ليس مطلوبًا لـmigrate deploy. يجهز المطور shadow database منفصلة بصلاحيات مناسبة عند تطوير ترحيلات مستقبلية.

## pg_trgm وTLS

pg_trgm امتداد موثوق فيPostgreSQL17؛ يحتاج CREATE على قاعدة الهدف لتثبيته. يسمح بذلك لدورMigration فقط، ويُمنع عن التطبيق. اختُبر إنشاء الامتداد والفهارس وترحيلات الأعمدة GENERATED بهوية migration غيرsuperuser من البداية. مزود استضافة قد يفرض قائمة امتدادات أو إجراء تثبيت إداريًا؛ راجع سياساته عند اختياره.

في اتصال بعيد استخدم `sslmode=verify-full` وشهادةCA موثوقة والتحقق من اسم المضيف، لكلا رابطَي التطبيق والترحيل. لا تستخدم rejectUnauthorized=false أو sslmode=no-verify. الخادم يرفض رابط production بعيدًا دون verify-full. لم تُعدل شهادات أو إعداداتPostgreSQL المحلية ولم يُختبر اتصال بعيد بشهادة فعلية؛ اتصال اختبار loopback محلي غيرمشفر ولا يثبت جاهزيةTLS إنتاجية.

توثيق [الأدوار](https://www.postgresql.org/docs/17/sql-createrole.html)، [العضويات](https://www.postgresql.org/docs/17/role-membership.html)، [الصلاحيات الافتراضية](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html)، [الامتدادات الموثوقة](https://www.postgresql.org/docs/17/contrib.html)، [تحققTLS](https://www.postgresql.org/docs/17/libpq-ssl.html).

## نتيجة الاختبار المحلي

منbackend:

```bash
node qa/database-roles.mjs
```

ينشئ قاعدة ذات اسم فريد ينتهي `_test` وأدوارًا ذات أسماء عشوائية بعد إثبات عدم وجودها، ويولّد كلمات مرور اختبار في الذاكرة دون تسجيلها. يشغل SQL القوالب وPrisma migrate deploy بهويةTCP فعلية غيرsuperuser، ثم يختبر الإدخال والأقفال والتقييم والقراءة والتعديل والحذف بهوية تطبيق فعلية. رفض التطبيق CREATE DATABASE/ROLE/SCHEMA/TABLE وALTER/TRUNCATE وقراءة metadata والتصعيد إلىmigration بـSQLSTATE42501. أثبتت flags عدمامتلاك صلاحيات إدارية أوقراءة ملفاتالخادم. أزيلت قاعدة الاختبار وأدواره فيالنهاية. الأدلة: [database-roles.json](qa-evidence/database-roles.json).
