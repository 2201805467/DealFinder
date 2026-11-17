# WooCommerceProvider — اختبار محلي ضمن المرحلة الثانية

يستخدم المزود `GET /wp-json/wc/store/v1/products` من [Store API الرسمي](https://developer.woocommerce.com/docs/apis/store-api/). هذا مسار عام للمنتجات لا يتطلب مفاتيح WooCommerce REST API الإدارية. عمومية المسار لا تمنح إذنًا بإعادة نشر بيانات متجر أو صوره؛ لا يوجد متجر خارجي مصرح به للمشروع حاليًا.

## إعداد البيئة وأمر العينة

أضف إلى `backend/.env`:

```dotenv
WOOCOMMERCE_BASE_URL=http://127.0.0.1:8088
WOOCOMMERCE_STORE_NAME=DealFinder LOCAL TEST Store
WOOCOMMERCE_USAGE=local-test
WOOCOMMERCE_TIMEOUT_MS=10000
```

`BASE_URL` هو جذر المتجر، مع مسار تثبيته الفرعي إن وجد، دون `wp-json` أو بيانات دخول أو Query. إعداد WooCommerce مستقل عن إعداد Backend؛ لا يختاره الخادم افتراضيًا. لا يلزم مفتاح أو حساب عميل لقراءة المنتجات العامة.

من `backend`:

```powershell
npm.cmd run woocommerce:sample -- --limit 20
npm.cmd run woocommerce:sample -- --on-sale --limit 20
npm.cmd run woocommerce:sample -- --query "LOCAL TEST" --limit 2 --page 2
```

في وضع `local-test` يسمح الاتصال بـlocalhost أو `127.0.0.1` أو `::1` فقط، وتوسم النتائج بأنها بيانات اختبار محلية وليست عروضًا تجارية. لا توجد عودة تلقائية إلى بيانات Mock عند فشل الاتصال. يعرض الأمر نتيجة طلب واحد فقط ولا يكتب بيانات المنتجات في PostgreSQL أو ملفات.

بعد توفر تصريح متجر يغطي البيانات والصور والروابط والاستخدام التجاري، يمكن ضبط HTTPS واسم المتجر و`WOOCOMMERCE_USAGE=authorized`. هذه القيمة إقرار إعداد وليست آلية للحصول على تصريح أو التحقق القانوني منه؛ لا تضبطها قبل مراجعة التصريح. مدة التخزين والتحديث وحقوق الصور تحددها شروط صاحب المتجر؛ لا يفترض المزود رخصة عامة أو مدة Cache موحدة، ولا يعيد استضافة الصور.

## متجر Docker تجريبي منفصل

يتطلب Docker Engine يعمل ومساحة وتنزيل صور WordPress وMariaDB وWP-CLI وإضافة WooCommerce من مصدرها الرسمي. لا يثبت برامج على Windows ولا يستخدم صورًا أو منتجات من متاجر خارجية. كل البيانات في مشروع Compose منفصل باسم `dealfinder-wc-demo` ووحدات تخزين منفصلة عن PostgreSQL الخاص بـDealFinder.

لتجهيز بيئة جديدة من `backend`:

```powershell
Copy-Item .env.woocommerce.example .env.woocommerce
```

استبدل كلمات المرور التوضيحية الثلاث بقيم عشوائية محلية. لا تستبدل ملف `.env.woocommerce` الموجود إذا سبق تهيئة وحدة التخزين؛ تغيير الملف وحده لا يغير كلمات مرور قاعدة موجودة. الملف مستبعد من Git، بينما المثال لا يحتوي أسرارًا حقيقية.

```powershell
docker compose --env-file .env.woocommerce -f compose.woocommerce.yaml up -d --wait wc-store
docker compose --env-file .env.woocommerce -f compose.woocommerce.yaml run --rm wc-setup
docker compose --env-file .env.woocommerce -f compose.woocommerce.yaml ps
```

الأمر الثاني يثبت WordPress ويفعّل WooCommerce وينشئ ثلاثة منتجات اصطناعية فقط. ملف `dev/woocommerce/seed.php` محصور بمتجر العنوان المحلي، ويعيد تحديث المنتجات ذات SKU التجريبي نفسه عند تكراره بدل نسخها. لا ينزل صورًا ولا يهيئ بوابة دفع. لا تستورد بيانات العرض التجريبية الخارجية الخاصة بالإضافة.

| المنتج التجريبي | السعر العادي USD | السعر الحالي USD | الخصم المتوقع |
| --- | --- | --- | --- |
| LOCAL TEST Demo Headphones | 129.99 | 99.99 | 23.08% |
| LOCAL TEST Demo Cable | 20.00 | 15.00 | 25% |
| LOCAL TEST Demo Notebook | 8.50 | 8.50 | لا يوجد؛ غير متوفر بالمخزون |

هذه قيم اختبارات أنشأناها، وليست عروض سوق حقيقية. اسم مستخدم إدارة المتجر `dealfinder_demo`، وكلمة مروره في `WC_DEMO_ADMIN_PASSWORD` بالملف المحلي. المنافذ مربوطة بـ`127.0.0.1` فقط. لتنظيف العمليات مع الاحتفاظ بالبيانات:

```powershell
docker compose --env-file .env.woocommerce -f compose.woocommerce.yaml down
```

لا تستخدم `down -v` إلا إذا أردت حذف بيانات العرض التجريبي. إصدار WordPress وصور PHP فرع متحرك للتطوير فقط؛ يسجل `PROGRESS.md` النسخ التي اختُبرت فعليًا، وأمر setup يطبع إصدار WordPress وWooCommerce. تنزيل جديد قد يحتاج إعادة تحقق من توافق الإصدارات.

## التحويل وحدوده

- مصدر السعر الحالي هو `prices.price`؛ تُحوّل السلسلة الصحيحة غير السالبة بقسمتها على `10 ** currency_minor_unit`. مثال: `10025` مع 2 يساوي 100.25، ومع 0 يساوي 10025. لا يُستخدم `raw_prices.precision` بدل وحدة العملة.
- يعالج التنفيذ وحدات 0..6 وأرقام minor units الآمنة في JavaScript فقط. القيمة الفارغة أو السالبة أو النص العشري أو غياب وحدة العملة/رمزها لا ينتج سعرًا مخترعًا. الصفر الصريح صالح، بينما المرجع الصفري لا يسمح بحساب نسبة خصم.
- `prices.regular_price` سعر عادي مرجعي وليس إثباتًا لتاريخ الأسعار. لا تحسب النسبة إلا عند `on_sale=true`، ومرجع أعلى، وتطابق `sale_price` مع السعر الحالي. لا يوجد Scoring أو حكم بجودة العرض.
- المنتجات المتغيرة والمجمعة و`price_range` غير الفارغ لا تُسند لها أسعار مفردة في هذا العقد؛ تبقى بيانات المنتج ويغيب سعره ونسبة خصمه حتى اختيار متغير قابل للمقارنة. هذه سياسة محافظة تمنع مقارنة أسعار متغيرات مختلفة.
- `id` و`name` و`permalink` وأول صورة صالحة والوصف القصير تحول للحقول الحالية. أسماء المنتجات والوصف قد يحويان HTML؛ هما بيانات غير موثوقة، ويلزم عرضهما كنص أو تنقيتهما عند بناء الواجهة، دون تنفيذ HTML خام. لا ينفذ المزود تنزيل الصور.
- حالة التوفر تحتاج إشارات `is_in_stock` و`is_purchasable`، ولا تَعِد بشحن عالمي. لا تستنتج دولة المتجر من العملة أو عنوان السيرفر، لذا يبقى `market` غائبًا عند عدم معرفته. السعر المعروض ليس ضمانًا لتكلفة الشحن والضرائب النهائية.

المصدر: [Products API](https://developer.woocommerce.com/docs/apis/store-api/resources-endpoints/products/).

## البحث والصفحات والأخطاء

تُرسل `search` و`on_sale=true` و`page` و`per_page`؛ حجم الصفحة 1..100، ولا يدعم Cursor. تؤخذ `total` و`totalPages` من `X-WP-Total` و`X-WP-TotalPages`، ولا تُختلق عند فقد الترويسات؛ يلزم تصحيح Proxy المتجر إذا حذفها. مجموع النتائج يتبع المصدر، و`skippedCount` عدد السجلات غير الصالحة محليًا. الاستجابة الفارغة تظل فارغة، والصفحة خارج المجال قد تعيد خطأ مصدر واضحًا.

يوجد Timeout ورفض Redirect وأخطاء آمنة دون نص الاستجابة الخام أو رابط يحوي أسرارًا. `429` يحترم Retry-After أو يستخدم تهدئة 60 ثانية، بلا إعادة محاولات تلقائية. لا تُفترض حصة موحدة للطلبات GET؛ [صفحة Rate Limiting الرسمية](https://developer.woocommerce.com/docs/apis/store-api/rate-limiting/) تتناول حدودًا اختيارية لطلبات POST، وقد يضيف مستضيف المتجر أو Proxy حدودًا أخرى.

## الاختبارات والجاهزية

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run format:check
```

اختبارات `woocommerce.test.ts` تستخدم Mock معنونة، بما فيها اختبار HTTP عبر خادم Node محلي يعيد Fixture وليس متجر WooCommerce فعليًا. فحص Docker الحقيقي، إن نجح، مسجل منفصلًا في `PROGRESS.md`. نجاح أي منهما لا يثبت تصريحًا تجاريًا ولا يجعل التكامل جاهزًا للاستخدام التجاري. يلزم متجر يسمح بالاستخدام وعينة فعلية منه والتحقق من سياق الأسعار والترخيص قبل الاعتماد التجاري.
