# DealFinder Mobile — Phase 5

## اختبار هاتف ARM64 — متابعة المرحلة6.1

لم يُختبر هاتف فعلي في هذه المرحلة، ولم تُحذف ملفات أو تطبيقات أو بيانات محاكي. لبناء Debug لهاتفAndroid يدعمARM64 من `mobile`:

```bash
flutter build apk --debug --target-platform android-arm64 \
  --dart-define=API_BASE_URL=http://YOUR_COMPUTER_LAN_IP:3000/api/v1 \
  --dart-define=DEMO_MODE=true
adb devices
adb -s DEVICE_SERIAL install -r build/app/outputs/flutter-apk/app-debug.apk
```

استبدل العنوان بـLAN الفعلي للجهاز، واجعل الهاتف والحاسوب على شبكة اختبار موثوقة واحدة. localhost على الهاتف لا يشير إلى الحاسوب، و10.0.2.2 مخصص لمحاكيAndroid. يتطلب وصولLAN استماع Backend للعنوان المناسب والسماح المحلي المراجع بالمنفذ؛ لا تغير إعدادات الشبكة أوتنشر الخدمة تلقائيًا. Debug يعرض البيانات الاصطناعية موسومة، وزر الشراء منها معطل.

لبناء Release لاحقًا مع Backend مصرح عبرHTTPS:

```bash
flutter build apk --release --target-platform android-arm64 \
  --dart-define=API_BASE_URL=https://YOUR_AUTHORIZED_BACKEND/api/v1 \
  --dart-define=DEMO_MODE=false
```

Release يستبعد synthetic مهما كانت قيمة Demo؛ غياب مصدر تجاري يؤدي لقائمة فارغة صحيحة. لا تضع مفاتيح متاجر أوDB داخل dart-define. توقيع القالب الحالي debug للتحقق المحلي؛ لا تنشره كتوقيع إنتاج. هذه تعليمات مجهزة فقط؛ لم يُبنَ ARM64 أو يُثبّت على هاتف في المرحلة6.1. الواجهات الحالية تستخدم offset pagination دون تغيير؛ cursor الجديد اختياري لعملاءAPI فقط.

تطبيق Flutter مستقل يتصل بـBackend الموجود. الواجهة الافتراضية إنجليزية، وتستخدم Material 3 وRiverpod وDio وGoRouter. البيانات المتاحة حاليًا **اصطناعية فقط**؛ لا يوجد مصدر تجاري معتمد ولا عمليات شراء داخل التطبيق.

## المتطلبات

- Flutter **3.44.2** stable، Dart **3.12.2** (الإصداران اللذان اختُبر بهما المشروع).
- Android SDK 36 وJDK 17 وتراخيص Android مقبولة من صاحب الجهاز.
- PostgreSQL وBackend الحالي يعملان. لا يحتاج التطبيق مفاتيح Best Buy أو AliExpress أو WooCommerce.
- لبناء iOS يلزم macOS وXcode؛ لم يُختبر بناء iOS على Windows.

اعتماديات التطبيق المباشرة: `flutter_riverpod 3.5.0`، `dio 5.11.1`، `go_router 18.1.4`، `shared_preferences 2.5.6`، `url_launcher 6.3.3`، و`flutter_localizations` من SDK. الإصدارات الفعلية مقفلة في `pubspec.lock`؛ توجد اعتماديات أحدث لبعض الحزم خارج قيود SDK الحالية، ولم تُرقّ المكتبات أو أدوات الجهاز لتجاوز ذلك.

## تشغيل Backend والبيانات التجريبية

من جذر DealFinder، مع `.env` المحلي الموجود وإعداد قاعدة التطوير:

```powershell
cd backend
docker compose up -d postgres
npm.cmd ci
npm.cmd run db:migrate
npm.cmd run build
npm.cmd start
```

في نافذة أخرى، عند الحاجة لتجديد بيانات التطوير المتقادمة:

```powershell
cd backend
npm.cmd run db:seed
npm.cmd run worker:seed-demo
$env:NODE_ENV='development'
$env:WORKER_ENABLED='true'
$env:WORKER_ALLOW_SYNTHETIC='true'
npm.cmd run worker:once
Remove-Item Env:WORKER_ENABLED
Remove-Item Env:WORKER_ALLOW_SYNTHETIC
```

الأوامر إضافية/idempotent ولا تمسح قاعدة التطوير. Worker لا يعمل دوريًا هنا. عروض Worker تصبح stale حسب سياسة المصدر (حاليًا 15 دقيقة) وقد يفرغ Top Deals إذا طال وقت الاختبار؛ أعد الجولة اليدوية عند الحاجة، ولا تتجاوز قواعد الحداثة في التطبيق. على macOS/Linux استخدم `npm` وصيغة متغيرات البيئة المناسبة للصدفة.

## تشغيل Flutter

```powershell
cd mobile
flutter pub get
flutter run -d emulator-5554 --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1 --dart-define=DEMO_MODE=true
```

`API_BASE_URL` إعداد وقت البناء، وليس سرًا؛ تغييره يتطلب إعادة التشغيل/البناء مع `--dart-define`، دون تعديل الشيفرة. الافتراضي في Debug هو عنوان محاكي Android أعلاه. لا تستخدم عنوان متجر أو API خارجي هنا، بل عنوان DealFinder Backend فقط.

| الجهاز | عنوان Backend |
| --- | --- |
| Android Emulator الرسمي | `http://10.0.2.2:3000/api/v1`؛ localhost داخل المحاكي هو المحاكي نفسه |
| iOS Simulator على Mac | `http://127.0.0.1:3000/api/v1` عندما يكون Backend على Mac نفسه |
| هاتف فعلي | `http://<عنوان الحاسوب في الشبكة المحلية>:3000/api/v1` في Debug، على الشبكة نفسها |
| Chrome اختياري للتطوير | `http://127.0.0.1:3000/api/v1` مع CORS مضبوط لأصل واجهة الويب |

للهاتف الفعلي فقط، شغّل Backend مؤقتًا بـ`HOST=0.0.0.0`، واختر عنوان LAN الحقيقي في الأمر. قد تحتاج السماح بمنفذ التطوير في جدار الحماية بنفسك. لم نغير إعدادات الشبكة أو جدار الحماية. لا تعرض PostgreSQL للهاتف، ولا تفتح الخدمة على الإنترنت. بديل لهاتف Android موصول بـUSB: `adb reverse tcp:3000 tcp:3000` ثم استخدم `http://127.0.0.1:3000/api/v1`.

يُسمح HTTP محليًا في **Android Debug فقط** عبر manifest منفصل، وفي iOS Debug عبر `Info-Debug.plist`. Release/Profile لا يحملان استثناء ATS الخاص بـDebug. Android الرئيسي يضبط `usesCleartextTraffic=false`. كود Release يرفض Backend غير HTTPS، ويحجب البيانات الاصطناعية حتى إذا مرر أحدهم `DEMO_MODE=true`. لا توجد أسرار أو خدمات مدفوعة أو تعطيل للتحقق من شهادات TLS. إعداد Release هنا حماية للبيانات، وليس إقرارًا بجاهزية نشر تجاري أو إعداد توقيع المتاجر.

## الصفحات والسلوك

- **Home:** العلامة، البحث، السوق/العملة، التصنيفات، Top Deals، Latest Deals، Low Price Products تحت 20 من العملة المختارة، Biggest Discounts. كل قسم يطلب حتى 6 عروض عند بنائه تدريجيًا، وSee all يفتح الاستعلام نفسه في Explore.
- **Explore:** بحث مؤجل 350ms (حد Backend: 200 حرف)، إلغاء الطلب القديم وحماية من النتائج المتأخرة، Grid متجاوب، تحميل صفحات 20 عنصرًا، منع التكرار والتزامن، Pull to refresh، وخمسة ترتيبات. لا تقارن أسعار عملات مختلفة.
- **Filters:** تصنيف ومتجر وسوق وعملة ونطاق سعر (حتى 18 رقمًا صحيحًا و6 كسور، وفق Backend). العملة مطلوبة للمقارنة، وتغييرها يمسح نطاق السعر. تحفظ العملة والسوق محليًا؛ يبقى البحث وباقي الفلاتر في ذاكرة فرع Explore أثناء التنقل. لا توجد فلاتر مصطنعة لنسبة الخصم أو التوفر لأن Backend لا يدعمهما حاليًا.
- **Details:** بيانات العرض الحالية، المرجع والخصم الموثوقان فقط، الشحن عند معرفته، السوق والتحديث، Score ومكوناته وأسبابه. إذا أعاد مسار `/deals/:id` الحالة 404 لمنتج Low Price غير مخفض، يُستخدم `/products/:productId` الموجود لتحديد العرض نفسه. لا تغييرات Backend لهذا الغرض.
- **Favorites:** مستودع قابل للاستبدال، SharedPreferences تحفظ معرف العرض ومعرف المنتج المرتبط **فقط**، دون أسعار أو صور أو وصف. يُعاد الجلب عند فتح المفضلة والتفاصيل والسحب للتحديث؛ يعرض المنتهي/المفقود حالة واضحة مع إمكانية الإزالة. التفضيلات والمفضلة محلية على الجهاز ولا توجد حسابات.
- **Settings:** رمز سوق ISO من حرفين (أو فراغ لكل الأسواق)، عملة من ثلاثة أحرف، Light/Dark/System، تعريف بالتطبيق وإفصاح Affiliate. اختيار سوق ليس ضمانًا للشحن إليه، واختيار عملة لا يحول الأسعار.
- GoRouter يستخدم `StatefulShellRoute.indexedStack` لحفظ حالة الفروع وموضع التصفح. التفاصيل تقبل `/deals/<offer-id>?productId=<product-id>`؛ معرف المنتج اختياري للعروض المخفضة ومفيد لاسترجاع عروض Low Price المحفوظة.
- Skeleton، retry، empty state، timeout، HTTP 400/404/429/500 وJSON غير المتوقع. لا إعادة طلب تلقائية في حلقة من الواجهة عند فشل صفحة؛ يبقى المحتوى المحمل ويمكن Retry.

## سلامة البيانات والصور والروابط

أسعار Decimal تبقى نصوصًا ويستخدم التحقق والمقارنة `BigInt`؛ لا تحويل مالي إلى `double` ولا تحويل عملات. العرض لا يعيد اختراع خصم إذا غاب المرجع الموثوق أو كان غير صالح. التوفر والشحن المجهولان يظلان مجهولين.

Demo Mode ظاهر، وكل رابط شراء اصطناعي معطل. بيانات منشأ مجهول تعامل كبيانات محجوبة خارج Demo. Release لا يعرض عروضًا أو تصنيفات أو متاجر اصطناعية. العروض المنتهية مستبعدة عند القراءة، ويخفي مؤقت محلي محتوى البطاقة/التفاصيل عند الانتهاء أثناء فتح الشاشة. تحفظ المفضلة الهوية فقط، وتبقى سياسة حداثة المصدر وحق عرضه مسؤولية Backend.

لا يوجد تخزين دائم لكتالوج المنتجات أو صورها، ولا cache على القرص أو بيانات اختبار ثابتة في واجهات التطبيق. تستخدم الصور التجارية المصرح بها مستقبلًا HTTPS وتحميلًا كسولًا وتحجيمًا في الذاكرة مع placeholder عند الفشل؛ لا تُطلب أي صور خارجية للبيانات الاصطناعية. Placeholder وأيقونة Android رسومات محلية. الذاكرة المؤقتة الافتراضية لـFlutter ليست أرشيف أسعار أو صور.

View Deal يقبل HTTPS عام فقط، يمنع credentials والمنافذ غير الافتراضية وIP وlocalhost والنطاقات المحلية/الاختبارية، ويفضل Affiliate صالحًا ثم الرابط الأصلي الصالح. يُفتح الرابط في تطبيق خارجي، دون WebView أو JavaScript داخل التطبيق. لا يُعد الفحص المحلي مراجعة سمعة نطاق أو تصريح مصدر: هذه مسؤولية اعتماد المصدر في Backend قبل إدخال بيانات حقيقية.

الإنجليزية هي اللغة الوحيدة المترجمة في هذه المرحلة. أضيفت localization delegates ومفاهيم التخطيط الاتجاهية لتوسعة اللغات/RTL لاحقًا؛ لم يُدّع تنفيذ ترجمة عربية كاملة.

## بنية الملفات

```text
mobile/
  lib/
    main.dart                       # Initialize local preferences + ProviderScope
    app.dart                        # Themes, GoRouter, preserved navigation branches
    core/{config,widgets,retention}.dart
    features/
      catalog/
        domain/models.dart          # Exact decimals, offers, metadata, pagination, queries
        data/catalog_repository.dart
        application/explore_controller.dart
        presentation/               # Home, Explore, filters, details, reusable cards
      favorites/favorites_screen.dart
      preferences/                  # Settings, local repositories/controllers
  test/{models,repository,state,widget}_test.dart
  test/support.dart                 # Explicitly synthetic HTTP fixtures, tests only
  tool/backend_smoke_test.dart      # Explicit local live API test, outside default test suite
  docs/live-backend-check.json       # Recorded real local API check (synthetic data)
  docs/screenshots/                  # Actual emulator captures when available
  android/ ios/ web/                 # Flutter-generated platform projects + scoped config
  pubspec.yaml pubspec.lock analysis_options.yaml
```

لا توجد migrations أو تعديلات على StoreProvider أو كود Backend في هذه المرحلة. أُنشئت ملفات منصة Flutter القياسية؛ تعديلات المنصة المقصودة هي تسمية/أيقونة Android وInternet وإعدادات HTTP/ATS الخاصة بـDebug فقط. `local.properties` ومجلدات build والأسرار مستبعدة من Git.

## التحقق والبناء

```powershell
flutter pub get
dart format --output=none --set-exit-if-changed lib test tool
flutter analyze
flutter test
flutter test tool/backend_smoke_test.dart --dart-define=API_BASE_URL=http://127.0.0.1:3000/api/v1
flutter build apk --debug --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1 --dart-define=DEMO_MODE=true
```

اختبار HTTP الفعلي منفصل ومقصود، ويتطلب Backend وبيانات اصطناعية حديثة. لا تعتمد اختبارات الوحدة والواجهات على الإنترنت أو PostgreSQL؛ تستخدم استجابات Mock واضحة داخل `test` فقط. يكتب الاختبار الحي تقريره في `docs/live-backend-check.json`. ملف APK الناتج: `build/app/outputs/flutter-apk/app-debug.apk`، وهو Debug تجريبي كبير الحجم ولا يصلح للنشر كنسخة متجر.

النتائج الفعلية والقيود التشغيلية موثقة في [PROGRESS.md](../PROGRESS.md). اكتملت مراجعة المرحلة السادسة كما يوضح [تقرير الجودة](../docs/QA_REPORT.md)، دون الانتقال للمرحلة السابعة.

## صور التطبيق الفعلية

التقطت هذه الصور من APK Debug يعمل على Android Emulator Pixel_5، ويتصل بخادم التطوير الحالي. المنتجات اصطناعية بالكامل، والصور البديلة محلية:

- [Home](docs/screenshots/home.png)
- [Explore والأسعار والخصومات](docs/screenshots/explore.png)
- [تفاصيل المنتج](docs/screenshots/details.png)
- [تفاصيل التقييم والشحن المجهول وزر الشراء المعطل](docs/screenshots/details-score.png)
- [Settings وDark Mode](docs/screenshots/settings-dark.png)

## معالجة INSTALL_FAILED_INSUFFICIENT_STORAGE

نجاح البناء لا يضمن وجود مساحة كافية للتثبيت داخل Android: يلزم هامش لفك الحزمة والمكتبات بالإضافة إلى حجم APK. افحص الجهازين بصورة مستقلة:

```powershell
adb -s emulator-5554 shell df -h /data
Get-PSDrive C
```

في متابعة 2026-11-18 كان المحاكي ممتلئًا 93% والمتاح نحو 461MB فقط، والمضيف نحو 1GB. لم يكف تنظيف كاش Android لتثبيت APK المتعدد المعماريات (162MB). **نجح بناء وتثبيت APK مخصص لـx86_64 بحجم نحو 78MB وتشغيل التطبيق**، دون حذف بيانات التطبيقات أو مسح AVD. يظل توفير مساحة إضافية مفيدًا للبناء المتكرر.

بعد توفير مساحة مناسبة، يمكن تقليل APK للمحاكي x86_64 فقط، ثم إعادة التثبيت:

```powershell
flutter build apk --debug --target-platform android-x64 --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1
adb -s emulator-5554 install -r -t build/app/outputs/flutter-apk/app-debug.apk
```

هذه النسخة مخصصة لمحاكي x86_64، وليست لهاتف ARM. نتيجة التثبيت المذكورة تخص المتابعة السابقة. في المرحلة السادسة أُعيد بناء Debug وRelease بنجاح، لكن تعذر إقلاع المحاكي بسبب مساحة القرص ولم يُختبر تثبيت الحزمتين الجديدتين. لتشغيل حزمة جاهزة بعد توفير المساحة:

```powershell
flutter run -d emulator-5554 --use-application-binary=build/app/outputs/flutter-apk/app-debug.apk
```

عنوان Backend مدمج وقت بناء هذه الحزمة؛ لتغييره أو لتغيير الكود أعد بناء النسخة المخصصة بالأمر أعلاه. أُوقفت المحاولة الأولى احترازيًا بعد قراءة غير متاحة لمساحة المضيف داخل البيئة المقيدة؛ صحح الفحص المباشر القراءة، ثم نجح البناء. مخرجات البناء الوسيطة قابلة لإعادة التوليد؛ التفاصيل في PROGRESS.md.
