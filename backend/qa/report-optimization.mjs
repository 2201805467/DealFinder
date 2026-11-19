import fs from 'node:fs';
const folder = '../docs/qa-evidence/';
if (process.argv.includes('--save-array-candidate')) {
  fs.copyFileSync(
    folder + 'performance-optimization-final.json',
    folder + 'performance-optimization-policy-array.json',
  );
  process.exit(0);
}
const read = (name) =>
  JSON.parse(fs.readFileSync(folder + name + '.json', 'utf8'));
const before = read('performance-optimization-reference'),
  after = read('performance-optimization-final');
if (!before.finishedAt || !after.finishedAt)
  throw Error('Wait for the complete benchmark');
const probe = read('optimization-probe'),
  pager = read('pagination-optimization'),
  roles = read('database-roles');
const backend = read('backend-verification'),
  flutter = read('flutter-verification'),
  production = read('production-guards');
const live = JSON.parse(
  fs.readFileSync('../mobile/docs/qa-live-ui.json', 'utf8'),
);
fs.copyFileSync(
  '../mobile/docs/qa-live-ui.json',
  folder + 'optimization-flutter-live.json',
);
for (const [source, target] of [
  ['backend-verification', 'optimization-backend-verification'],
  ['flutter-verification', 'optimization-flutter-verification'],
  ['production-guards', 'optimization-production-guards'],
])
  fs.copyFileSync(folder + source + '.json', folder + target + '.json');
const f = (v) =>
  typeof v === 'number' && Number.isFinite(v) ? v.toFixed(2) : 'لم يُختبر';
const get = (report, size, name, vu) =>
  report.datasets
    .find((d) => d.products === size)
    ?.cases.find((c) => c.name === name && c.connections === vu);
const ok = (c) =>
  c?.successfulRps ??
  (c ? (c.requests - c.non2xx) / c.durationSeconds : undefined);
const top = get(after, 100000, 'top', 10),
  mixed = get(after, 100000, 'mixed', 50);
const lines = [
  '# تحسين الأداء والاستعداد للإنتاج — المرحلة6.1',
  '',
  'تاريخ التنفيذ: 2026-11-19. جميع البيانات اصطناعية، وكل الحمل على loopback وقاعدة dealfinder_qa_test المستقلة. لم يبدأ النشر أو المرحلة السابعة، ولم تُستخدم مصادر تجارية أو خدمات مدفوعة. لم تُحذف بيانات التطوير أو ملفات أو تطبيقات أو بيانات المحاكي.',
  '',
  '## 1. المشكلات والحلول المعتمدة',
  '',
  '- كان PostgreSQL يعيد حساب النسب والقسمة الزمنية الثابتة لكل عرض عند كل قراءة. أضيفت أربعة عوامل GENERATED STORED من نوع numeric غير محدود الدقة: نسبة الخصم الأصلية غير المقربة، معامل الشحن، epoch الجلب، وطول نافذة الحداثة. تتجدد ذريًا عند كل INSERT/UPDATE، حتى SQL خارج خدمة الإدخال، ولا يستطيع التطبيق تعيينها يدويًا.',
  '- لا يخزن Base Score موزونًا أو درجة نهائية. الأوزان وdiscountCap وtopThreshold كما كانت وقابلة للضبط بالقواعد الموجودة. الحداثة والصورة الحالية والأهلية والانتهاء وموافقة المصدر تحسب وقت القراءة. العوامل بلا تقريب وسيط إضافي؛ التقريب النهائي إلى منزلتين كما في الخوارزمية السابقة.',
  '- ضُيق CTE إلى المعرف والدرجة وحقل الترتيب المطلوب فقط. بقي فحص موافقة متجر العرض ومصدر محتوى المنتج بالوصلات الأصلية في كل طلب؛ لا توجد نسخة مخزنة من الموافقة. استُبعد بديل مجموعات UUID رغم مكسبه المعزول لأن اختبار REST لم يؤكد تحسنًا ثابتًا.',
  '- عوامل SQL الداخلية موسومة @ignore في Prisma حتى لا يحملها كل جلب عرض أو تظهر ضمن بيانات التطبيق. Schema تصف خصائص الأعمدة الفعلية، وتعريف GENERATED في Migration SQL المراجعة. تحقق migrate diff قراءةً فقط وأعاد empty migration؛ لا تستخدم db push لإعادة تعريفها.',
  '- أضيفت pagination=cursor اختيارية لقائمة الأحدث، بلا OFFSET أوCOUNT، مع الإبقاء على العقد الافتراضي المستخدم من Flutter.',
  '- لم يضف Cache أوRedis، ولم تُرفع أوزان التقييم أوPool أوحد التزامن أوSQL/HTTP timeout. لا توجد فهارس إضافية في6.1؛ أعيد استخدام فهرس currency/recent/id المقاس في المرحلة السادسة.',
  '',
  '### البدائل التي قيست ولم تعتمد',
  '',
  'المقارنة المعزولة التالية EXPLAIN ANALYZE على100k، وليست زمنREST كاملًا. ترتيب الحالات وcache والموارد يؤثر على الزمن؛ حفظت الخطط الخام للمراجعة:',
  '',
  '| البديل | زمن التنفيذ ms |',
  '|---|---:|',
  ...probe.cases.map((c) => `| ${c.name} | ${f(c.executionMs)} |`),
  '',
  `اختلافات الدرجات في مقارنة العوامل المعزولة: ${probe.numericDifferences}. الاستعلام inline أعاد حساب الدرجة في الموضعين وكان أبطأ؛ لم يعتمد. work_mem=8MB أعطى تحسنًا محدودًا مقارنة4MB مع تكلفة ذاكرة أعلى لكل عملية، فلم يُعمم. لم تتغير إعدادات Docker أوPostgreSQL الدائمة.`,
  '',
  'تجربة انتظار معاملة Prisma من2s إلى5s أزالت أخطاء P2028 في عينة التشخيص لكنها خفضت Successful RPS من35.73 إلى17.49 ورفعت p95 الناجح إلى نحو5038ms؛ رُفضت. بقي الانتظار الافتراضي2s وPool10 وSQL timeout5s والقبول64 وRate Limit300/IP/min. [أدلة تشخيص الانتظار](qa-evidence/concurrency-optimization.json).',
  '',
  '## 2. نتائج الحمل قبل وبعد',
  '',
  `Node ${after.environment.node}، ${after.environment.cpus} معالجًا منطقيًا، RAM إجمالي${f(after.environment.ramBytes / 1024 ** 3)}GiB، PostgreSQL17 وDocker محليان. الأداة autocannon السابقة، والمسارات الثمانية السابقة نفسها، وأحجام10k/50k/100k. حالات المسار الواحد10 اتصالات لأربع ثوان، والمزيج10 ثم50 ثم100 لمدة10 ثوان لكل مستوى عند الاستقرار؛ أرقام المدة الفعلية أدناه.`,
  '',
  'خط المرجع6.1 يستخدم SQL التقييم السابق بحقن داخلي في أداة QA، مع schema نفسها وCTE المضيق. يحتوي النهائي أيضًا على إلغاء تحميل عوامل SQL الداخلية غير اللازمة. هذا مرجع مضبوط للمقارنة وليس checkout مطابقًا لكل سطر من المرحلة السادسة. أرقام المرحلة السادسة التاريخية (Top≈882ms وأخطاء المزيج50≈27.59%) تبقى في تقريرها؛ مدة4/10 ثوان مختلفة عن تجربتها2/5 ثوان.',
  'حُفظت تجربة الموافقات المرفوضة في performance-optimization-policy-array.json، وتجربة العوامل قبلها في performance-optimization-after.json. لا تستخدم أي منهما بدل المرور النهائي؛ لم يحتفظ الكود بتبسيط الموافقات الذي لم يثبت مكسبه.',
  '',
  `المرجع: ${before.startedAt} → ${before.finishedAt} UTC. النهائي: ${after.startedAt} → ${after.finishedAt} UTC. الجهاز مشترك مع برامج أخرى، وليست البيئة معزولة؛ بعض المسارات قد لا تتحسن، ولا ينسب كل فرق زمني إلى الكود.`,
  '',
  'إعدادات الحمل فقط: API_RATE_LIMIT_MAX=1000000 لتجنب قياس حصة العميل الواحد، وV8 max-old-space-size=128MB لعملية API التجريبية فقط. هذا حد heap وليس حدRSS. الإعدادان متماثلان في المرورين وليسا إعدادات إنتاج جديدة. Pool10 وحد64 وSQL5s ثابتة. يحسب CPU من عمليةAPI كل500ms (100%=نواة واحدة)، RAM هوRSS، وDB يشمل اتصال المراقبة. عينات Docker فيJSON بعد كل حالة وليست قممًا مستمرة.',
  '',
  'توقف التصعيد إذا تجاوز الخطأ1% أوp95 ثانيتين أو انخفض RAM الحر تحت1GiB. لم يُغلق أي برنامج مستخدم. المحاولة performance-optimization-before اختصرت حالات تحت ضغطRAM، فحفظت كدليل على القيد ولا تستخدم لإثبات قياس طويل. أُعيد القياس الكامل عندما سمحت الموارد المتاحة، دون تغيير الجهاز.',
  '',
  '429 و503 وأخطاءالنقل ليست طلبات ناجحة. عمودp95 التالي للطلبات الناجحة فقط؛ JSON يضم p95 لجميع الردود أيضًا، الذي قد ينخفض بسبب رفض سريع ولا يمثل جودة الخدمة.',
  '',
  '| المنتجات | الحالة/VU | ناجح/s قبل | p95 ناجح قبل ms | خطأقبل % | ناجح/s بعد | p95 ناجح بعد ms | خطأبعد % |',
  '|---:|---|---:|---:|---:|---:|---:|---:|',
];
for (const size of [10000, 50000, 100000])
  for (const [name, vu] of [
    ['top', 10],
    ['mixed', 10],
    ['mixed', 50],
    ['mixed', 100],
  ]) {
    const a = get(before, size, name, vu),
      b = get(after, size, name, vu);
    if (!a && !b) continue;
    lines.push(
      `| ${size} | ${name}/${vu} | ${f(ok(a))} | ${f(a?.successfulP95Ms)} | ${f(a?.errorRate * 100)} | ${f(ok(b))} | ${f(b?.successfulP95Ms)} | ${f(b?.errorRate * 100)} |`,
    );
  }
lines.push(
  '',
  '### الأهداف المبدئية ونتيجتها الفعلية',
  '',
  `- Top Deals عند100k و10 اتصالات: p95 الناجح=${f(top?.successfulP95Ms)}ms؛ هدف أقل500ms ${top && top.successfulP95Ms < 500 ? 'تحقق في العينة' : 'لم يتحقق'}.`,
  `- المزيج عند100k و50 اتصالًا: ناجح/s=${f(ok(mixed))}، خطأ=${f(mixed?.errorRate * 100)}%، p95 الناجح=${f(mixed?.successfulP95Ms)}ms؛ هدف الخطأ أقل1% ${mixed && mixed.errorRate < 0.01 ? 'تحقق في العينة' : 'لم يتحقق'}.`,
  '- لا تعد هذه القياسات ضمانًا لسعة إنتاج. ما زال ترتيبScore والعد الدقيق عبر100k يعتمد على مسح وفرز المرشحين، ويتسبب انتظار المعاملات فيP2028 تحت الحمل. لم يُخف القيد برفع المهلة أو التزامن أو احتساب ردود الرفض.',
  '',
  '### جميع حالات المرور النهائي',
  '',
  '| المنتجات | الحالة | VU | المدة s | الردود | ناجح/s | p95 ناجح ms | p99 ناجح ms | خطأ % | API CPU % | API MiB | DB conn |',
  '|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
);
for (const d of after.datasets)
  for (const c of d.cases)
    lines.push(
      `| ${d.products} | ${c.name} | ${c.connections} | ${f(c.durationSeconds)} | ${c.requests} | ${f(ok(c))} | ${f(c.successfulP95Ms)} | ${f(c.successfulP99Ms)} | ${f(c.errorRate * 100)} | ${f(c.apiPeakCPUPercent)} | ${f(c.apiPeakRAMBytes / 1048576)} | ${c.dbPeakConnections} |`,
    );
for (const d of after.datasets)
  lines.push(
    '',
    `توقف التصعيد عند ${d.stoppedEscalationAt ?? 'الحد المحدد'} اتصال لحجم ${d.products}. السبب: ${d.stopReason ?? after.stopped ?? 'انتهاء المستويات المحددة'}. لم تختبر المستويات الأعلى في هذا المرور.`,
  );
lines.push(
  '',
  '## 3. Pagination ودقة الترتيب',
  '',
  'العقد الافتراضي page/pageSize/total/totalPages باقٍ. للاستخدام الاختياري: `GET /api/v1/deals?pagination=cursor&sort=newest&currency=USD&pageSize=20`، ثم أرسل nextCursor في cursor مع المرشحات والحجم نفسيهما. يحتوي الرد على hasMore وnextCursor وtotal=null وtotalPages=null. لا تستخدم page أكبر من1 في هذا النمط؛ Flutter الحالي لا يرسله.',
  '',
  'Cursor يرتب lastUpdatedAt DESC ثم UUID ASC، ويرتبط ببصمة المرشحات والحجم وينتهي بعد15 دقيقة. تُفحص الصيغة والتواريخ والحجم وتُربط القيم كمعاملات SQL. لا COUNT أوOFFSET. يستبعد تحديثات أحدث من startedAt، لكنه ليس snapshot تاريخيًا؛ تعديل أو حذف عرض قد يغير بقية القائمة. يعاد فحص الانتهاء والقدم والموافقة في كل طلب، ولا تجمد لحظة إصدار الرمز.',
  'فصل الاستعلام نطاق التوقيت المتساوي وUUID الأكبر عن نطاق التوقيت الأقدم باستخدام UNION ALL؛ الفرعان منفصلان ومحدودان بحجم الصفحة، ثم يطبق الترتيب والحد النهائي. يتجنب ذلك OR الذي قد يمسح معظم الفهرس عند تساوي التوقيت. اختُبر عبور مجموعات زمنية مختلفة مع تعادل المعرفات الزمنية دون تكرار أو فقد.',
  '',
  'قُصر keyset على newest لأن ترتيب Score يتغير مع الزمن. السعر والخصم والدرجة والمنتجات باقون على العقد القديم. اختُبرت120 نتيجة بتوقيت متساو عبر كل الصفحات، دون تكرار أو فقد في مجموعة ثابتة، وتطابق أول100 مع offset. اختُبر تغير الموافقة والانتهاء وحجب بيانات الإنتاج بين الصفحات.',
  '',
  'قياس خدمة منفرد على100k، خمس عينات لكل حالة. اختيار حد الصفحة العميقة لإعداد الاختبار له كلفة OFFSET خارج القياس؛ العميل الحقيقي يتلقى الحد من صفحته السابقة:',
  '',
  '| الحالة | median ms | p95 ms | العناصر | total |',
  '|---|---:|---:|---:|---|',
  ...pager.cases.map(
    (c) =>
      `| ${c.name} | ${f(c.medianMs)} | ${f(c.p95Ms)} | ${c.items} | ${c.total ?? 'غير محسوب'} |`,
  ),
  '',
  `تطابق معرفات الصفحة العميقة: ${pager.sameDeepPage}. يستفيد Cursor من الفهرس الموجود، دون فهرس جديد. [الدليل](qa-evidence/pagination-optimization.json).`,
  '',
  '## 4. صحة التقييم والاحتفاظ',
  '',
  'اختُبرت120 عينة ×7 أزمنة ×مجموعتين من الأوزان =1680 مقارنة SQL قديمة/جديدة، وترتيب المجموعة كاملة في14 حالة. تشمل الصفر والمفقود والأرقام الكبيرة والمرجع غير الموثوق والشحن والصور ونافذة1ms والمستقبل وحدود الانتهاء. اختُبر تحديث السعر والثقة والشحن والصورة ورفض الكتابة المباشرة في عامل GENERATED.',
  '',
  'بقي evaluateDeal وتفسير المكونات وDTO كما كانا، دون حساب مالي بكسور JavaScript الثنائية. يتحول الوقت بدقة إلى numeric seconds وتُجمع المكونات وتقرب كما في SQL السابق. لا درجة نهائية قديمة أو scoredAt مخزن؛ الحساب يخص وقت الطلب. حذف العرض المنتهي يزيل عوامله؛ لا تاريخ أسعار جديد. أثبتت اختبارات REST الحجب بعد الانتهاء والقدم وسحب الموافقة، بما فيها Cursor.',
  '',
  '## 5. نتائج التحقق النهائي',
  '',
  `- Backend: ${backend.steps.find((s) => s.name === 'unit')?.tests} اختبارات وحدة، و${backend.steps.find((s) => s.name === 'integration')?.tests} اختبارات تكامل PostgreSQL؛ ${backend.steps.every((s) => s.exitCode === 0) ? 'جميعها والبناء والأنواع والترحيلات نجحت' : 'راجع خطوات الفحص الفاشلة فيJSON'}.`,
  `- Flutter Analyze و${flutter.steps.find((s) => s.name === 'tests')?.passed} اختبارًا: ${flutter.steps.every((s) => s.exitCode === 0) ? 'نجحت' : 'راجع JSON'}. لم تتغير آلية التصفح أو الواجهة. تعليمات Debug/Release ARM64 في mobile/README؛ لم يُبنَ ARM64 أو يشغّل على هاتف.`,
  `- اختبار Flutter HTTP الحقيقي المحلي:1/1 ناجح، ${live.loadedOffers} عرض عبر صفحات من كتالوج100k، مع التمرير والتفاصيل والتفضيلات. الاختبار headless وSharedPreferences mock فقط؛ لا هاتف أو API متجر. [الدليل](qa-evidence/optimization-flutter-live.json).`,
  `- production محلي فعلي: ${production.http.length} قراءات HTTP200 بلا synthetic، ورفض worker/seed/seed-worker رغم أعلام opt-in؛ بقي ${production.syntheticOffersUnchanged} عرضًا اصطناعيًا دون تغيير.`,
  `- أدوار PostgreSQL: ${roles.passed ? 'نجح' : 'فشل'}؛ ترحيلات بهوية غير superuser وCRUD والأقفال والتقييم بهوية تطبيق فعلية. رفضت الأوامر الإدارية وقراءة metadata والتصعيد بـ42501. أزيلت قاعدة الاختبار وأدوارها؛ لا بيانات اعتماد إنتاجية.`,
  `- ترحيل إضافي: 20261119090000_score_factors على التطوير والاختبار وQA؛6 ترحيلات إجمالية. بقيت بيانات التطوير ${production.developmentCounts.products} منتجًا و${production.developmentCounts.offers} عرضًا. لا reset أو تغيير لحساب التطوير أو كلماته أوDocker.`,
  '',
  '## 6. إعداد قاعدة البيانات المقترح للإنتاج',
  '',
  'القوالب في [DATABASE_ROLES.md](DATABASE_ROLES.md) وbackend/database/*.sql: Application لجداول الأعمال فقط، Migration يملك schema ويثبت pg_trgm، وAdministrative لصيانة قاعدة الهدف. الأدوار NOLOGIN دون كلمات مرور. يستخدم CLI رابط MIGRATION_DATABASE_URL، والتطبيق DATABASE_URL؛ تثبتهما أدوات الاختبار على القاعدة المعزولة نفسها. يلزم verify-full وشهادة موثوقة للاتصالين البعيدين؛ لم تُختبر شهادة بعيدة فعلية.',
  '',
  'Pool10 وSQL timeout5s والحدود الحالية نقطة بدء محلية، وليست ضمان سعة. خصص ميزانية اتصالات لكل نسخة API وWorker وراجع reverse proxy والحدود الموزعة عند نشر مصرح به. لا Redis أو إعداد نشر جديد. إضافة GENERATED STORED تعيد كتابة الجدول وتتطلب قفلًا؛ راجع نافذة الصيانة وحجم الإنتاج عند تطبيقها لاحقًا. استخدم SQL المراجعة، دون تعديل Migration مطبقة أو db push.',
  '',
  '## 7. القيود والتوصيات',
  '',
  'تتأثر النتائج ببرامج الجهاز ومدة الاختبار؛ لا soak test أو ضمان إنتاج. الأهداف المفتوحة ظاهرة أعلاه. التوصية التالية: قياس أطول على بيئة مخصصة، ثم دراسة فهرس أو تضييق مرشحين بحد أعلى مثبت للدرجة مع اختبار عدم إسقاط عروض مؤهلة وحداثة حية. لا يعتمد Cache لترتيب قديم دون حل الإبطال والانتهاء والأوزان. لم ينفذ هذا التصميم الأوسع في6.1.',
  '',
  'يبقى Rate Limit لكل process وحساب التطوير superuser كما طلب المستخدم، ولا مصدر تجاري مصرح. لا اختبار هاتف فعلي أو TLS بعيد أو نشر، ولم تُحذف بيانات المحاكي. ظهر تحذير pg عن client.query المتزامن في مسار Prisma تحت الحمل؛ لم تنفذ ترقية كاسرة، ويلزم مراجعة توافق المحول قبل pg9.',
  '',
  '## 8. الملفات الجديدة والمعدلة',
  '',
  'الجديدة: migration score_factors؛ src/services/catalog-cursor.ts؛ tests/catalog-cursor.test.ts وtests/integration/scoring-optimization.test.ts؛ database/roles.sql وdatabase-privileges.sql وapplication-privileges.sql؛ أدوات qa/run.sh وoptimization-probe وoptimization-inspect وconcurrency-probe وpagination-performance وdatabase-roles وreport-optimization؛ docs/DATABASE_ROLES.md وهذا التقرير وJSON الأدلة.',
  '',
  'المعدلة: schema.prisma وprisma.config.ts و.env.example؛ scoring/deal-scoring.ts وservices/catalog.ts وcatalog-query.ts وcontrollers/catalog.controller.ts وscripts/test-database.ts؛ أدوات qa/performance وproduction وfinal-checks؛ mobile/README وREADME وdocs/CATALOG وKNOWN_ISSUES وPROGRESS. كود Flutter والمزودان BestBuy/WooCommerce محفوظون؛ لا خدمات أو تقنيات جديدة.',
  '',
  '## إعادة القياس',
  '',
  'من backend عبر Git Bash بعد build وتجهيز .env وقاعدة الاختبار:',
  '',
  '```bash',
  'node qa/performance.mjs --label=optimization-repeat --sizes=10000,50000,100000 --duration=10 --single-duration=4 --max-connections=100 --max-error-rate=0.01 --api-heap-mb=128',
  'node qa/pagination-performance.mjs',
  'node qa/database-roles.mjs',
  '```',
  '',
  'للمرجع أضف --legacy-score. يعيد الحمل إعداد dealfinder_qa_test فقط، ولا يعمل ضمن Express أوWorker أو الاختبارات التلقائية. ترفض الأدوات قاعدة تطوير أو عنوانًا بعيدًا. الأدلة: [المرجع](qa-evidence/performance-optimization-reference.json)، [النهائي](qa-evidence/performance-optimization-final.json)، [الخطط](qa-evidence/optimization-probe.json)، [Backend](qa-evidence/optimization-backend-verification.json)، [Flutter](qa-evidence/optimization-flutter-verification.json)، [الإنتاج](qa-evidence/optimization-production-guards.json)، [الأدوار](qa-evidence/database-roles.json).',
);
fs.writeFileSync(
  '../docs/PERFORMANCE_OPTIMIZATION.md',
  lines.join('\n') + '\n',
);
console.log(
  JSON.stringify({
    topP95ms: top?.successfulP95Ms,
    mixed50ErrorRate: mixed?.errorRate,
    mixed50SuccessfulRps: ok(mixed),
    finalCases: after.datasets.reduce((n, d) => n + d.cases.length, 0),
  }),
);
