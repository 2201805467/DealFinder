# تقرير ضمان الجودة — المرحلة السادسة

تاريخ التنفيذ: 2026-11-18. اكتملت مراجعة المرحلة السادسة والاختبارات الممكنة وإصلاح المشكلات المؤكدة، مع القيود الموضحة أدناه. لم تبدأ المرحلة السابعة ولم يُنشر المشروع. جميع منتجات الاختبار اصطناعية، ولا يوجد مصدر تجاري معتمد.

## مراجعة الكود والنطاق

رُوجع PROJECT_SPEC.md وPROGRESS.md وكود Backend وFlutter والقاعدة والمزودات والعامل والاختبارات قبل التعديل. بقي Express مستقلًا عن Worker، وبقي منطق الإدخال في OfferIngestionService دون نسخه في خدمة أخرى. احتُفظ بـBestBuyProvider وWooCommerceProvider؛ أضيفت حماية النقل والتحويل دون تفعيل أي اتصال تجاري أو مصدر جديد.

شملت المراجعة معالجة الأخطاء وType Safety والاتصالات والمعاملات وstreams وreaders والمؤقتات وAbortSignal، وإدارة Dio وRiverpod وdebounce والتخزين المحلي. لا إعادة كتابة للبنية أو ملفات فارغة. بقيت الأسعار Decimal/numeric ونصوصًا عشرية في API. لا سجل دائم لتاريخ الأسعار أو API كتابة عامة.

لم يظهر تسرب ذاكرة مؤكد في السيناريو المنفذ؛ ارتفاع RSS لإطار اختبار Flutter وحده لا يثبت تسربًا أو ينفيه. قُيدت قائمة Explore بـ1000 عنصر، وقُيدت صفحات metadata، واستُخدم Set لإزالة تكرار المفضلة بدل البحث المتكرر. أزيل اعتماد تعريفات أنواع غير مستخدم لأداة الحمل المكتوبة JavaScript.

## المشكلات التي عولجت

| الخطورة | المشكلة المؤكدة | النتيجة |
|---|---|---|
| High | SSRF من عنوان متجر قابل للضبط | تحقق العناوين وDNS داخل الاتصال نفسه، ومنع redirects والوجهات الداخلية؛ اختبارات ناجحة |
| High | غياب حدود المعدل والتزامن، وتضخم عروض المنتج المتداخلة | حدود rate/concurrency/body/query والنتائج؛ حماية جزئية من الحمل وليست ادعاء منع DDoS |
| High | المزامنة المحدودة تعيد أول الصفحات دون Checkpoint | استكمال ذري مع pageSize وoffset وبصمة وإصدار؛ اجتياز2000 عنصر دون إهمال الصفحات الأخيرة |
| High | احتمال كتابة عامل قديم بعد فقد اتصال القفل | generation fencing داخل معاملة الإدخال؛ اختبارات رفض الملكية القديمة وفقد الاتصال نجحت |
| High | PostgreSQL يفشل على50k/100k بسبب ذاكرة Parallel Hash المشتركة | تعطيل parallel workers لكل اتصال تطبيق؛ تجربة معزولة أعطت50/50 نجاح بعد5/50 قبل |
| Medium | إنشاء Worker جديد يتجاوز Retry-After | syncNotBefore محفوظ فيDB ولا يتجاوزه manual force؛ ناجح |
| Medium | فقد دقة بعض Woo currency minor units الكبيرة | تحقق round-trip دقيق وحجب السعر غير القابل للتمثيل؛ ناجح |
| Medium | بيانات تفضيلات تالفة أو عمل مؤجل بعد disposal | fallback للأنواع وحفظ الموارد وفحص mounted؛ ناجح |
| Medium | overflow بمقدار91px عند نص200% وشاشة320px | تكيف البطاقات والأعمدة واختيار المظهر؛ الصفحات الخمس اجتازت الفحص |
| Low | بحث Explore بلا تسمية في semantics | أضيف label؛ بقي قيد SDK لعقدة حقل داخلي بارتفاع24px موثق |

لم تُكتشف مشكلة Critical مؤكدة ضمن النطاق. تفاصيل الأمان في [SECURITY_AUDIT.md](SECURITY_AUDIT.md)، والمسائل المفتوحة في [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

## نتائج التحقق النهائي

| الفحص | النتيجة الفعلية |
|---|---|
| TypeScript typecheck | نجاح exit0 |
| Prisma generate وTypeScript build | نجاح exit0 |
| Backend unit tests | **61/61**، دون فشل |
| PostgreSQL integration tests | **54/54** على dealfinder_test، دون فشل |
| Prisma migrate deploy/status | نجح؛5 ترحيلات إجمالية وschema up to date |
| Flutter Analyze | **No issues found** |
| Flutter tests | **48/48**، دون فشل |
| Flutter → HTTP → PostgreSQL | اختبار live اختياري ناجح:200 عرض فريد من كتالوج100k مع التمرير والتفاصيل والتفضيلات |
| Debug APK، x86_64 | نجاح؛105,394,555 بايت،27.39s في البناء النهائي |
| Release APK، x86_64 | نجاح؛21,721,067 بايت،93.98s في البناء النهائي، دون نشر أو مفتاح إنتاج جديد |
| npm audit |0 ثغرات معروفة وقت الفحص، قبل وبعد |
| OSV Pub audit |68 حزمة،0 نتائج معروفة وقت الفحص |
| Backend production فعلي |5 قراءات HTTP200 فارغة رغم100k عرض اصطناعي؛ رفض seed/worker/seed-worker برمز1 دون تغيير العروض |
| أسرار APK وGit |لا env متتبع؛0 تطابق للسر المحلي المضبوط في542 entry لـDebug و366 لـRelease |

الأدلة: [Backend](qa-evidence/backend-verification.json)، [Flutter](qa-evidence/flutter-verification.json)، [APK](qa-evidence/apk-builds.json)، [حراس الإنتاج](qa-evidence/production-guards.json)، [المسح والترحيل](qa-evidence/final-checks.json)، [Flutter live](../mobile/docs/qa-live-ui.json). سجلات الأوامر `.log` موجودة محليًا؛ تبقى مستبعدة منGit وفق سياسة المشروع.

## قاعدة البيانات وحفظ البيانات

أضيفت3 ترحيلات دون reset أو حذف بيانات تطوير:

1. `20261118200000_sync_checkpoint`: حقل JSON في merchants للاستكمال.
2. `20261118201000_measured_catalog_indexes`: فهرس currency/recent/id، وpg_trgm وGIN على lower(product.name)، بعد قياس EXPLAIN قبل وبعد.
3. `20261118202000_worker_fencing_and_cooldown`: syncGeneration وsyncNotBefore لمنع الكتابة القديمة وحفظ مهلة المصدر.

طُبقت على dealfinder وdealfinder_test وdealfinder_qa_test بنجاح. لم تُعدل الترحيلات السابقة. تفعيل pg_trgm يتطلب صلاحية إنشاء extension؛ يلزم تجهيزها بدور الترحيل عند اعتماد بيئة إنتاج لاحقًا. بقيت بيانات التطوير **19 منتجًا و16 عرضًا**، ولم تُجدد أو تُحذف أثناء الحمل. قاعدة الأداء وحدها أُعيد إعدادها للأحجام الأربعة بعد حارس الاسم وloopback. لم تُعدل ملفات .env المحلية.

تُجلب علاقات صفحة المنتجات كدفعة عبر Prisma؛ لا حلقة استعلام يدوي لكل منتج. قُيدت العروض المتداخلة بـ20 مع offersTruncated. يدعم مسار تفاصيل المنتج offerId اختياريًا حتى لا يفقد العرض المحفوظ خارج أول20 إمكانية الوصول. لا يتجاوز ذلك شروط الصلاحية.

## اختبار Worker

تشمل مجموعة التكامل54 اختبارًا للقاعدة والكتالوج والمزامنة. ثبتت الحالات التالية:

- صفحة واحدة وعدة صفحات، إنشاء وتحديث دون تكرار، استجابة فارغة وبيانات ناقصة، وتراجع الصفحة غير الصالحة وحدها.
- Network وTimeout و429 وRetry-After وbackoff/jitter، وحدود الصفحات والمنتجات والطلبات والوقت، ورفض النتيجة المتأخرة.
- فشل مصدر مع استمرار آخر، دون حذف جماعي؛ تنظيف المنتهي يحافظ على العلاقات الصالحة.
- التزامن عبر عملاء وعمليات متعددة، الإيقاف والإلغاء وتحرير القفل، الجدولة والتنظيف أثناء انتظار مصدر بطيء.
- **2000 عنصر** اصطناعي مع maxProducts=150 وpageSize=100 عبر جولات محدودة، وCheckpoint داخل الصفحة عند تغيير الميزانية.
- **خروج عملية Node فعلي برمز9** قبل الصفحة الثانية؛ حفظ الأولى وCheckpoint وتحرير القفل، ثم استئناف الثانية فقط وتسجيل انقطاع الجولة السابقة.
- إنهاء اتصال coordinator فعليًا بـpg_terminate_backend أثناء انتظار المزود؛ رفض البيانات المتأخرة ثم استعادة المزامنة. اقتصر الإنهاء على اتصال ذي اسم فريد بقاعدة الاختبار.
- رفض generation قديمة ورفض إعادة التشغيل أثناء Retry-After حتى مع force، وتمييز UNSTABLE_PAGINATION وINCOMPLETE_CYCLE بدل ادعاء اكتمال تغطية المصدر.
- تطابق SQL وDecimal للدرجة، وتأثير مرور الوقت والسعر الصفري والمرجع غير الموثوق والانتهاء وREST وتعطيل الاصطناع في الإنتاج.

لم تُوقف حاوية PostgreSQL المشتركة لمحاكاة تعطل الخادم كله؛ اختُبر فقد اتصال المزامنة دون المساس بالتطوير. Proxy وPgBouncer غير مختبرين. يشرح [دليل المزامنة](SYNCHRONIZATION.md) Checkpoint والملكية والمهلة المحفوظة.

## Flutter والحالات غير الطبيعية

اختُبرت حالات offline وtimeout وcancellation و400/404/429/500، API فارغ أو malformed، pagination غير صالحة، أسعار مفقودة وصفرية وضخمة، مرجع غير موثوق، انتهاء العرض أثناء فتح البطاقة، وروابط وصور غير متاحة. حالات التحميل والخطأ وإعادة المحاولة واضحة، ولا يفسر التطبيق HTML.

اختُبر بحث سريع مع طلب قديم بطيء؛ لا يستبدل الطلب القديم النتيجة الأحدث. اختُبرت load متداخلة ومنع التكرار وتغيير العملة والسوق ومسح نطاق السعر السابق، والملاحة مع الاحتفاظ بالبحث. تُخزن المفضلة كمعرفات فقط، وتُستعاد مع الإعدادات في ProviderContainer جديد. هذا اختبار persistence باستخدام SharedPreferences mock، ولا يثبت kill/relaunch لتطبيق Android فعلي.

رُوجعت Home وExplore وProduct Details وFavorites وSettings في الشاشات الضيقة وتكبير النص200%، واختُبر light/dark. اجتازت Home وExplore تسميات عناصر اللمس؛ اجتازت Home أحجام Android tap targets. بقي فشل قياس عقدة SearchBar الداخلية24px في Explore رغم مساحة البحث الخارجية56px؛ سُجل الاستثناء بدل ادعاء اجتياز شامل. لم تُنفذ مراجعة TalkBack فعلية أو قياس contrast كامل.

اختبار HTTP المحلي يستخدم المستودع والنقل الحقيقيين مع SharedPreferences mock فقط. جلب200 عرض فريد، مع4 ثم8 بطاقات مركبة أثناء التمرير، ما يثبت البناء الكسول في العينة. اختبار50 صفحة Mock يثبت التوقف عند1000 عرض دون طلب صفحات أخرى. الأزمنة وRSS في [تقرير الأداء](PERFORMANCE_REPORT.md) تخص Windows headless debug؛ ليست Android FPS أو DevTools profile.

## قيود البيئة والاختبارات المتعذرة

- رفض Android Emulator35.4.9 إقلاع Pixel_5 برسالة `Your device does not have enough disk space to run avd: Pixel_5` وفشل hasSufficientDiskSpace. لا جهاز ADB متصل. لم تُمسح AVD أو تُحذف com.example.baladity أو أي بيانات مستخدم. لم يُثبت APK الجديد على Android؛ نجاح البناء مستقل عن التثبيت.
- لا هاتف فعلي؛ لم تُجمع DevTools/frame traces أو profile/soak أو قياسات صور شبكة. [Flutter profile غير متاح للمحاكي](https://docs.flutter.dev/testing/build-modes).
- علق PowerShell bootstrap في flutter.bat. استُخدم Dart وflutter_tools.snapshot المثبتان مباشرة، مع Gradle init خاص بأمر البناء دون تعديل SDK أو سياسة Windows. توقفت محاولة Release أولى بمهلة240s أثناء تهيئة Gradle، ثم نجح البناء بالـcache الدافئ وأُعيد بعد إصلاح الواجهة.
- يستخدم Release توقيع debug القائم للتحقق المحلي، ولا يوجد endpoint HTTPS تجاري مضبوط. عنوان Debug الافتراضي غير الآمن يرفضه AppConfig في Release. يلزم عنوان HTTPS مصرح وقت البناء للاستخدام لاحقًا؛ لم تُنشأ مفاتيح نشر.
- لم تُختبر iOS أو استضافة أو شهادات DB بعيدة أو API تجاري. توقف الحمل قبل500/1000 عند تجاوز العتبات؛ القياسات المحلية لا تضمن سعة إنتاج.

## الملفات الجديدة والمعدلة

الجديدة:

- `backend/src/middleware/security.ts` و`backend/src/providers/safe-http.ts` و`backend/tests/security.test.ts`.
- مجلدات الترحيلات الثلاثة المذكورة أعلاه.
- `backend/qa/`: performance وparallelism وverify وflutter-verify وproduction وfinal-checks وdependency-audit وreport-performance، وأدوات monitor/inspect-results وstart-emulator وwindows-build وwindows-flutter.init.gradle وwindows_flutter.cmd. لا يستوردها الخادم أو العامل.
- `mobile/tool/qa_live_ui_test.dart` و`mobile/docs/qa-live-ui.json`، ومجلد `docs/qa-evidence/` للأدلة.
- التقارير SECURITY_AUDIT وPERFORMANCE_REPORT وQA_REPORT وKNOWN_ISSUES.

المعدلة:

- Backend: package.json وlock و.env.example وschema، وapp/server/config/env/database/client وcatalog.controller وerror-handler وخدمات catalog/offer-ingestion/product-synchronization، وعقد StoreProvider وMockStoreProvider وBest Buy وWooCommerce provider/normalize، واختبارات catalog/synchronization/Woo.
- Flutter: explore_controller وcatalog_repository وmodels وexplore_screen وhome_screen وoffer_card وpreferences وsettings_screen، واختبارات models/repository/state/widget.
- التوثيق: README في الجذر وmobile، وCATALOG وSYNCHRONIZATION وPROGRESS. لم يُعدل PROJECT_SPEC.md أو ملف env حساس، ولم يُحذف مزود.

## إعادة التحقق

من backend بعد الإعداد الموثق وقاعدة اختبار مستقلة:

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
npm.cmd run test:integration
npm.cmd run format:check
node qa/verify.mjs
node qa/production.mjs
node qa/dependency-audit.mjs
```

يطبق qa/verify.mjs ترحيلات migrate deploy على قاعدة .env أيضًا، ثم قاعدة الاختبار؛ لا ينفذ reset. راجع الترحيلات قبل تشغيله على بيئة أخرى. أدوات qa تفترض التشغيل من backend. performance.mjs وحده يعيد إعداد dealfinder_qa_test.

من mobile:

```powershell
flutter analyze
flutter test
flutter build apk --debug --target-platform android-x64
flutter build apk --release --target-platform android-x64
```

لاختبار live: شغل `node qa/performance.mjs --server` من backend وخذ منفذ loopback المطبوع، ثم نفذ من mobile: `flutter test tool/qa_live_ui_test.dart --dart-define=API_BASE_URL=http://127.0.0.1:<port>/api/v1`. أوقف خادم الاختبار عند الانتهاء. الاختبار خارج test/ حتى لا يرسل HTTP ضمن المجموعة الافتراضية. بديل جلسة Windows هو `node qa/flutter-verify.mjs` و`node qa/windows-build.mjs`؛ يستخدمان SDK المثبت ولا يثبتان أدوات.

لم تُفعّل جدولة تجارية أو مصدر جديد أو تسجيل دخول أو إشعارات أو خدمات مدفوعة. المرحلة السابعة تنتظر طلب صاحب المشروع.
