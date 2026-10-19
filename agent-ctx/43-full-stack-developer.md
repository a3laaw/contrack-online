# Task 43 — full-stack-developer

## المهمة
المرحلة 7-أ: إثراء شاشة المتابعة المالية — تدرّج انتهاء العقود (deep/warn/info) · قسم «تمديد إشراف» البنفسجي · قسم «🏗 مراحل التنفيذ» · توازي فلاتر الحالة مع المكتبي · إكمال نوع FollowupResponse وحذف followup-types اليتيم.

## الملفات
- **جديد** `src/lib/followup-alerts.ts` — منطق نقي كامل (بلا DB): parseExpiryLevels/expiryLevelsOrDefault/expiryTier (مرآة lifecycle:412+429 · main_window:287) · isSupervisionInExtension (supervision:431) · isFollowupCollection (يستبقي مغلق/ملغى/مسودة — lifecycle:5303) · isFollowupExpiring (يستبقي مغلق/ملغى/منتهي — lifecycle:437) · isFollowupExecutionContract · classifyStageExecution (معيار تقرير مراحل التنفيذ الحرفي: over إذا > المتوقع، near إذا ≥ المتوقع−3) · buildExecutionAlertRows (متأخرون أولًا بالتجاوز تنازليًا ثم قاربون بما بقي تصاعديًا).
- **جديد** `tests/phase7-followup.test.ts` — TDD أولًا (أحمر ثم أخضر): 19 اختبارًا/54 تأكيدًا نقيًا بلا قاعدة.
- `src/app/api/followup/route.ts` — نافذة الانتهاء = أكبر مستوى (كان أول قيمة)؛ tier لكل صف expiring؛ فلترة الحالات الجديدة؛ استعلاما `extension` (مراحل isSupervision بشرط supEnd غير فارغ + العقد بمغلق/ملغى، ثم فلترة نقية، صف واحد للعقد بأحدث supEnd) و`execution` (عقود بلا مغلق/ملغى/مسودة + buildExecutionAlertRows). حقول الرد القديمة كلها كما هي + الجديدة.
- `src/lib/report-server.ts` — reportExecution يعيد استخدام classifyStageExecution في خياري stages/occupancy (سلوك مطابق حرفيًا — تحقق إنتاجي)؛ لم يُمس أي مُصدِّر آخر.
- `src/components/contrack/contrack-types.ts` — FollowupResponse كامل: generatedAt/today/settings/dueNowTotal + extension/execution؛ FollowupExpiringRow +tier؛ FollowupBaseEndRow +customerName?؛ أنواع FollowupExtensionRow/FollowupExecutionRow/FollowupExpiryTier/FollowupSettings.
- `src/components/contrack/FollowupView.tsx` — شارة الانتهاء بالتدرّج (deep أحمر/warn كهرماني/info أزرق عبر EXPIRY_TIER_BADGE)؛ قسمان جديدان ببطاقتي عدّ (الشبكة sm:3/xl:6): «تمديد إشراف» بنفسجي (badge bg-purple-100 text-purple-700 + dark) و«🏗 مراحل التنفيذ» (متأخر أحمر/قارب كهرماني)؛ اسم العميل في صف nearBaseEnd.
- **حُذف** `src/lib/followup-types.ts` — يتيم (grep للمشروع كله: صفر استيراد).

## التحقق
- bun test **125/125** (576 تأكيدًا — كان 106) · tsc --noEmit = 0 · eslint = 0.
- متصفحيًا (zphase7 admin مؤقت مقابل إنتاج Supabase): 6 أقسام تُصيَّر؛ القاعدة الفعلية بلا بيانات تنبيه (فُحصت قرائيًا: عقد نشط واحد بلا endDate وبلا إشراف ومرحلة جارية يومها الأول) ⇒ حالات فارغة سليمة بالأحرف المطلوبة؛ ثم بـnetwork-mock لرد /api/followup: شارات التدرّج الثلاث بألوانها الصحيحة، صفّا «في التمديد» البنفسجي بنهاية كاملة (بها/بلاها)، متأخر أحمر «متأخر 15 يومًا» + قارب كهرماني «باقي 1 يوم»، ونقر صف فتح تفاصيل العقد الحقيقي CON-0012 بلا أخطاء نافذة.
- /api/reports/execution (stages + occupancy) بلا تغيير سلوك بعد إعادة الاستخدام: «ضمن الوقت · بقي 19 يوم» وoccupancy over=0/near=0.
- تنظيف كامل: حُذف zphase7 (id=10) وسجلّا التدقيق الخاصان به (بقيا admin/secretary فقط)، وحُذفت سكربتات _tmp الثلاثة.

## ملاحظات/انحرافات
- مسار `src/app/api/reports/execution/_server.ts` المذكور بالمواصفة غير موجود — منطق التقرير كله داخل reportExecution في report-server.ts؛ سُحب المنطق النقي منه إلى followup-alerts.ts.
- تنبيهات التنفيذ تستبقي «مسودة» أيضًا (المواصفة: بلا مغلق/ملغى كحد أدنى) لمطابقة تقرير مراحل التنفيذ الحرفي الموجود.
- «منتهي» ليس فهرسًا حاليًا في قاعدة الإنتاج لكنه مستبعد برمجيًا للانتهاء كالمكتبي.
