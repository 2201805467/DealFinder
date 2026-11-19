# مراجعة الأمان — المرحلة السادسة

تاريخ المراجعة: 2026-11-18. النطاق: Backend وPrisma/PostgreSQL وStoreProvider وWorker وFlutter وملفات الإعداد والبناء. اختبارات الهجوم والحمل محلية فقط، بمصادر اصطناعية. لم تُجر اختبارات على Best Buy أو AliExpress أو متجر WooCommerce خارجي. لم تثبت جاهزية تجارية أو ترخيص مصدر جديد.

## النتائج حسب الخطورة

لم تُكتشف مشكلة **Critical مؤكدة** ضمن الاختبارات المنفذة؛ هذا لا يثبت خلو المشروع من جميع الثغرات.

| المعرف | الخطورة | المشكلة المؤكدة | الإجراء والحالة |
|---|---|---|---|
| SEC-01 | High | عنوان WooCommerce القابل للضبط كان يسمح بعنوان HTTPS داخلي؛ فحص البروتوكول وحده لا يمنع SSRF أو DNS rebinding | أضيف safe-http: منع العناوين الداخلية/metadata/CGNAT والمحلية والمقيدة، فحص جميع DNS answers داخل socket lookup والاتصال بالعناوين نفسها، HTTPS443، منع redirects وcredentials. عولج؛ اختبارات عناوين وDNS Mock وHTTP loopback فعلي |
| SEC-02 | High | غياب Rate Limit وحد قبول للطلبات المكلفة، وجلب عروض متداخلة دون سقف لكل منتج | حد300/IP/min قابل للضبط، trust proxy=false، سقف64 طلبًا جاريًا و503، جسم JSON100KiB، upstream4MiB، SQL5s، Pool10، وعروض متداخلة20. عولج تضخم الاستجابة؛ حماية الحمل جزئية وتبقى حدود السعة أدناه |
| SEC-03 | High | غياب Checkpoint يكرر الصفحات الأولى وقد يمنع تحديث بقية كتالوج محدود الميزانية | Checkpoint ذري مع الإدخال، pageSize ثابت وoffset داخل الصفحة، استكمال واختبارات2000 عنصر وخروج عملية حقيقي. عولج |
| SEC-04 | High | القفل على اتصال منفصل لا يمنع كاتبًا قديمًا إذا فُقد الاتصال أثناء معالجة دفعة | generation fencing تحت قفل صف المتجر، التحقق داخل معاملة الإدخال، إنهاء run/موعد المزامنة للمالك الحالي فقط. عولج واختبر رفض generation قديمة وفقد اتصال coordinator فعليًا |
| SEC-05 | Medium | مهلة Retry-After داخل Provider instance لا تكفي عند إنشاء Worker جديد أو manual force | syncNotBefore محفوظ في PostgreSQL؛ manual force لا يتجاوزه. عولج واختبر1h cooldown بلا طلب ثانٍ |
| SEC-06 | Medium | استجابة مصدر كبيرة قد تستهلك الذاكرة قبل JSON parsing | قراءة streaming مقيدة4MiB، إلغاء body والـreader ومعالجة malformed/204 والمهلة. عولج |
| SEC-07 | Medium | تحويل بعض minor units الكبيرة إلى number قد يفقد دقة السعر قبل Decimal | Woo normalizer يتحقق من round-trip بالقيمة الصحيحة المشتقة من BigInt؛ يحذف السعر غير القابل للتمثيل بدل اختلاق سعر مقرب. عولج باختبار |
| SEC-08 | Medium | اتصال PostgreSQL البعيد في production لم يكن يشترط التحقق من شهادة TLS | Zod يرفض remote production URL دون sslmode=verify-full. Loopback المحلي مستثنى عمدًا. عولج التحقق؛ لم تُختبر شهادة خادم بعيد |
| SEC-09 | High عند النقل للإنتاج | حساب PostgreSQL المحلي الحالي superuser، والاتصال المحلي غير مشفر | أكد SELECT من pg_roles/pg_stat_ssl ذلك. لم تُغير الحسابات أو كلمات المرور أو TLS للخادم المحلي حتى لا تتعطل بيئة التطوير. **متبقٍ للإنتاج:** دور تشغيل بأقل صلاحيات، ودور ترحيل منفصل، وشهادة موثقة للاتصال البعيد |
| SEC-10 | Medium | معدل الطلبات وقبولها محليان لكل process؛ ليسا حماية موزعة | موثق. عند نشر متعدد النسخ يلزم حد على reverse proxy/gateway موثوق وضبط trust proxy بدقة. لم يُضف Redis أو نظام نشر خارج النطاق |
| SEC-11 | Low | ترويسات الأمان لم تكن مكتملة | Helmet: CSP/nosniff/frame policy وHSTS في production، دون x-powered-by. عولج؛ HSTS لا ينشئ HTTPS بنفسه |

## الاختبارات الفعلية

| المجال | ما اختُبر والنتيجة |
|---|---|
| SQL Injection | بحث `' OR 1=1 --` وعبارات SQL كنصوص، مع query parameters وPrisma.sql؛ HTTP200 فارغ وعدد المنتجات لم يتغير. sort بقيمة SQL مرفوض. لا تُستخدم مدخلات العميل كمعرفات SQL خام |
| NoSQL Injection | لا توجد قاعدة NoSQL؛ معاملات مثل q[$ne] والمصفوفات مرفوضة، وExpress simple query parser يلغي تفسير الكائنات المتداخلة |
| XSS | نص `<script>` في البحث يعامل حرفيًا ولا ينفذ. JSON/nosniff/CSP؛ Flutter يعرض Text ولا يفسر HTML. ليس هذا اختبار DOM لموقع ويب غير موجود |
| SSRF | loopback والتمثيل العددي المختصر وmetadata وprivate IPv4/IPv6 وmixed DNS ومخططات file/http وcredentials؛ كلها مرفوضة. خادم loopback يعيد302 نحو metadata: لم يُتبع redirect، إجمالي ضربات الخادم2 لا أكثر مع حالة204. لم يُرسل طلب فعلي إلى metadata أو عنوان داخلي حساس |
| CORS | الأصل المسموح وحده يحصل على Access-Control-Allow-Origin؛ الأصل الآخر لا يحصل عليه. CORS ليس مصادقة ولا يمنع عميلًا خارج المتصفح |
| Rate/IP | بعد حد2 في test تعيد الصحة429 وRetry-After؛ X-Forwarded-For مزور لا يتجاوز الحد. الإنتاج الافتراضي300/min |
| المدخلات | حدود page/pageSize/q/URLs والعملات والأسعار وsort، JSON غير صالح و110000-character payload يعيد413، wildcard % و_ وbackslash حرفية |
| أخطاء الإنتاج | تمرير Error يحوي PostgreSQL URL وapiKey وهميين يعيد INTERNAL_ERROR آمنًا؛ startup/HTTP/provider/worker لا يطبعون الخطأ الخام أو URL أو response body. أخطاء DB المعروفة/المهلات تعيد503 برسالة عامة |
| دورة الموارد | reader/body cancellation، request timeout، clear timers، AbortSignal، $disconnect، إغلاق HTTP، استعادة القفل بعد موت العملية؛ اختبارات وحدة وتكامل |
| حماية البيانات | جرى تشغيل dist/server بوضعproduction على QA100k؛ deals/top/products/categories/merchants=200 وقوائم فارغة. تشغيل worker/seed/seed-worker مع رفع أعلام الاصطناع رفض exit1؛ بقيت100k عروض دون تغيير |
| Flutter Release | اختبارات repository وwidget تشغل config.release=true حتى مع requestedDemo=true وتثبت حجب synthetic/unknown وإزالةDemo Banner. هذا تحقق سلوكي محلي، لا تشغيل APK Release على جهاز |
| الأسرار | ملفات .env و.env.test غير متتبعة في Git. فُكت entries داخل APK Debug وRelease في الذاكرة وفُحص السر المحلي المضبوط بصيغتيUTF8/UTF16 دون طباعة قيمته:0 تطابق. لا يوجد API key تجاري مضبوط لاختباره. فحص قيم محددة ليس ضمانًا ضد جميع الأسرار المجهولة أو سجلات Git القديمة |

الروابط الخارجية في Flutter تقبل HTTPS443 العام فقط، وتحجب credentials وIP/localhost والنطاقات المحلية والتجريبية. الشراء من Synthetic/expired/stale/unavailable معطل. لا WebView أو تنفيذ HTML من الوصف. الروابط والصور التجارية تبقى خاضعة لترخيص المصدر؛ لا يوجد Proxy صور جديد أو تنزيل صور تجارية في هذه المرحلة.

## مراجعة الاعتماديات

- `npm audit --json` قبل وبعد: **0** نتائج معروفة وقت الفحص. أضيفت Helmet وexpress-rate-limit للحماية وautocannon كأداة تطوير فقط؛ لم تُنفذ ترقية كاسرة للاعتماديات الأساسية.
- فحص OSV API فعلي لـ**68** حزمة Pub hosted من pubspec.lock: **0** نتائج معروفة وقت الفحص. لم تُرفع أسرار أو كود إلىOSV؛ أُرسلت أسماء الحزم وإصداراتها فقط.
- لم يشمل الفحص CVE لكل مكونات Android/Gradle/JDK/Docker أو الحزم غير المنشورة علىPub أو تحليلًا تجاريًا مغلق المصدر. نتيجة صفر ليست شهادة أمان.

الأدلة: [npm قبل](qa-evidence/npm-audit-before.json)، [npm بعد](qa-evidence/npm-audit-after.json)، [OSV](qa-evidence/flutter-osv.json)، [حراس الإنتاج](qa-evidence/production-guards.json)، [APK/Git](qa-evidence/final-checks.json)، [نتيجة Backend](qa-evidence/backend-verification.json).

## المتبقي وحدود الاعتماد

الاستعلام الديناميكي للدرجة مكلف عند100k، وحدود الحمل المحلية لا تحل DDoS أو Slowloris على مستوى الشبكة. مهل الخادم وSQL وحدود الحجم والقبول تقلل الأثر دون ادعاء منع مطلق. لا تُفعل trust proxy على نحو شامل؛ عناوين البروكسي يجب مراجعتها عند نشر مصرح به. لا توجد كتابة عامة أو تسجيل دخول؛ أمان حسابات المستخدمين والمصادقة خارج المرحلة.

لم تُغير بيانات الاعتماد المحلية أو تُنشئ مستخدمًا/شهادة إنتاج أو تنشر أي خدمة. قبل الإنتاج: مصدر بيانات مصرح، دورDB محدود، ترحيلات بدور منفصل، HTTPS موثق، سياسات reverse proxy والحصص، اختبار هاتف وحمل مستقر على البيئة المستهدفة. المسائل المفتوحة مفصلة في [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

مرجع سياسة الشبكة: [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html). الفحص داخل socket lookup ومنع redirects يطبقان الحماية من تغير DNS بين الفحص والاتصال؛ ليس مجرد فحص regex للرابط.
