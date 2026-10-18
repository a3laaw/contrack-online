# Task 22-a — Full-stack: expense-accounts API + FeatureFlags (42) + إزالة visits/delete الاحتياطي

## الملفات المنشأة (جديدة)
- `src/lib/expense-accounts-server.ts` — DEFAULT_EXPENSE_TREE حرفيًا من المكتبي + ensureExpenseAccountDefaults (عند قاعدة فارغة فقط) + refreshExpenseAccountPaths (يكتب المتغيّر فقط) + orderExpenseAccounts (مطابق `ORDER BY COALESCE(parent_id,id), sort_order, name`) + isCustodyLikeName + serializeExpenseAccount.
- `src/app/api/expense-accounts/route.ts` — GET مصفوفة مباشرة (طابق المستهلكين) + POST للمدير (adminGuard) بتحققات add_account حرفيًا.
- `src/app/api/expense-accounts/[id]/route.ts` — PUT بتحققات update_account حرفيًا + DELETE ناعم (إيقاف) يُرفض عند الاستخدام في السندات أو وجود أبناء (المكتبي بلا حذف أصلًا — toggle_active هو السلوك).
- `src/lib/feature-flags.ts` — FEATURE_CATALOG (42 مفتاحًا بنصوصها العربية حرفيًا من feature_service.py) + CORE_FEATURES + FORCED_ON_FEATURES (followup, rep_execution) + isEffectivelyEnabled (تعطيل الأصل يعطّل التابع — مطابقة enabled()) + isRawEnabled + featureDependents + groupedFeatures.
- `src/app/api/feature-flags/route.ts` — GET ⇒ `{flags:[{key,name,desc,group,requires,enabled,effective}]}` (enabled=raw، FORCED_ON يُعاد true دائمًا) + PUT `{key,enabled}` للمدير/المطور (adminGuard) مع رفض مفتاح مجهول (404) ومفتاح forced-on (400) + audit.
- `src/components/contrack/FeatureFlagsProvider.tsx` — React Query ["feature-flags"] staleTime 60s؛ useFeatureFlags() ⇒ { loading, flags, enabled(key) }. قبل نجاح التحميل أو عند فشله ⇒ enabled=true دائمًا (لا تُخفى شاشات بلا دليل).

## الملفات المعدلة (أدنى تعديل إضافي)
- `src/components/contrack/ConTrackApp.tsx` — تغليف AppRoot بـ FeatureFlagsProvider داخل QueryClientProvider.
- `src/components/contrack/AppShell.tsx` — استيراد hook + ثابت NAV_VIEW_FLAG + سطر فلترة واحد: invoices→invoices، custody→custody، gateway→payment_gateway، subcontractors→subcontractors، reports→reports، statement→statement، followup→followup، tasks→tasks، visits→visits، comments→comments، data-mgmt→full_backup. (لا مفاتيح في السجل لـ other_company/claims/dashboard/customers/contracts/vouchers/settings/users ⇒ بلا ربط؛ المفاتيح الداخلية projects/addendums/payment_plan/boq_items/supervision/documents/forms_center/word_forms/user_permissions/rep_*/cashflow/bank_fee/whatsapp/network_folder/import_old/contract_gaps/template_plan_mode/amount_guard/items_sync/mode_banner/settle_edit/notif_cleanup تُستخدم داخل التبويبات لاحقًا.)
- `src/components/contrack/VisitsView.tsx` — إزالة فرع 404/405 الاحتياطي لـ POST /api/visits/delete؛ unbookMutation يعتمد DELETE /api/visits فقط (نفس السلوك: DELETE موجود فعلًا ولم يكن الاحتياطي يُستدعى عمليًا).

## عقد الـAPI لوكيل تبويب المزايا (الإعدادات)
- GET /api/feature-flags بدون تعديل: `{flags:[{key,name,desc,group,requires:string[],enabled,effective}]}` — 42 مدخلًا مرتبة بترتيب السجل المكتبي، المجموعات: الشاشات 11 · داخل العقد 11 · التقارير 10 · أدوات 7 · المالية 3.
- PUT جسم `{key, enabled:boolean}` ⇒ `{key, enabled, saved:true}` — للمدير/المطور فقط (403 لغيرهما: «هذا الإجراء للمدير فقط»).
- الاستجابات الحرفية للأخطاء: «مفتاح ميزة غير معروف» (404) · «هذه الميزة مفعّلة دائمًا في هذا النظام ولا يمكن تعطيلها» (400).
- لا حاجة لأي مسار آخر لحفظ دفعة؛ أعِد PUT لكل مفتاح (upsert ذري مع audit).

## قاعدة البيانات
- **لا db push** — FeatureFlag في schema.prisma (key @id + enabled + @@map feature_flags) مطابق تمامًا لجدول المكتبي؛ النصوص الثابتة تبقى في TS كالسجل المكتبي.
- expense_accounts موجودة بمخطط مطابق (parentId/fullPath/isActive/allowPosting/includeInProfitability/accountKind/sortOrder).
- بقايا اختبار نظّفت: الصف المؤقت id=17 حُذف فعليًا؛ حساب «عهدة عامة» (16) أُعيد تفعيله بعد اختبار DELETE؛ سطور audit للاختبارات باقية (سجل إلحاقي فقط).

## تحقق حي (كلها على الخادم الحي 3000)
- GET /api/expense-accounts ⇒ 200 مصفوفة 12 (بيانات مرحلة) بترتيب المكتبي؛ ?all=1 يشمل الموقوف؛ 401 بلا توكن.
- POST ⇒ 201 + duplicate ⇒ 400 «يوجد حساب بنفس الاسم تحت نفس الأب.» + ابن تحت ابن ⇒ 400 «الشجرة مستويان فقط…».
- PUT ⇒ 200 + parentId=نفسه ⇒ 400 «لا يمكن جعل الحساب أبًا لنفسه.».
- DELETE غير مستعمل ⇒ 200 {deleted:true,deactivated:true}؛ (رفض المستعمل مُغطى بالعدّ: usedAsExpense/usedAsCustody).
- GET /api/feature-flags ⇒ 200 (42)؛ PUT reports=false ⇒ effective=false لِـ rep_customers/rep_cashflow/rep_subcontractors وeffective=true لِـ subcontractors/followup (forced) — ثم أُعيد reports=true.
- متصفحيًا: دخول admin ⇒ الأقسام 19 ظاهرة (كل المفاتيح مفعّلة) ⇒ PUT visits=false ⇒ «الزيارات» اختفت من التنقل بعد إعادة التحميل ⇒ أعيدها true ⇒ عادت. صفر أخطاء كونسول. حوار «سند جديد → صرف → مصروف» يُظهر شجرة «حساب رئيسي/حساب فرعي» من المسار الجديد (بدل input الاحتياطي).
- bun run lint: 0 errors (تحذيران مسبقان في AdvancesView/CustomerFormDialog لوكيل آخر) · bunx tsc --noEmit: صفر.
