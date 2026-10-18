# Task 22-e — full-stack (sub-delete) — عقد الـAPI وملاحظات المتابعة

## النطاق المنفذ
- `src/lib/sub-delete-server.ts` (جديد) — دلالات `sub_delete_service.py` المكتبي حرفيًا.
- `src/app/api/sub-contracts/delete/route.ts` (جديد) — endpoint واحد (GET معاينة + POST أفعال).
- `src/components/contrack/SubDeleteDialog.tsx` (جديد) — نافذة الخيارات (3 تابات) بنصوص `ui/sub_delete_dialog.py` حرفيًا.
- `src/components/contrack/SubcontractorsView.tsx` — زر الحذف يفتح النافذة (أُزيل الحذف المباشر DELETE /api/subcontractors/[id] من الواجهة).
- `src/components/contrack/SubContractDialog.tsx` — زر «حذف» يفتح النافذة focus=contracts (أُزيل apiDelete المباشر) + إصلاح جسيم حوار الإلغاء (statusReason → reason؛ كان يُرفض دائمًا ب«سبب الإلغاء مطلوب»).

## عقد الـAPI — POST/GET /api/sub-contracts/delete
### GET ?subcontractorId=N  (authGuard: screen_subcontractors)
```json
{
  "subcontractor": {"id","subCode","name","phone","email","activity","notes"} | null,
  "contracts": [{"id","contractNumber","customerName","amount","status","items","planRows","vouchersActive","claims","canDelete","blockReason"}],
  "vouchers":  [{"id","voucherNumber","vtype","typeLabel","vdate","amount","cancelled","linkedContract","linkedSubContractId"}],
  "summary": {"contracts","contractsValue","vouchers","vouchersActive","vouchersCancelled","vouchersTotal"},
  "canDeleteRecord": bool, "recordBlock": "…", "isDeveloper": bool
}
```
- blockReason نصوص المكتبي: «{n} سند صرف سارٍ» · «{n} مطالبة» (join « · »).
- recordBlock: «لا يمكن حذف سجل المقاول الآن — عليه {… و …}. احذفها من هذه الشاشة أولًا.»
- المقاول غير موجود ⇒ subcontractor:null (الواجهة تعرض «المقاول غير موجود»).
- 401 بلا توكن.

### POST {action} — الأفعال الثلاثة
1) `contracts` (authGuard: action_cancel_contract): `{subcontractorId, subContractIds:[], reason?}`
   ⇒ `{deleted, ids:[], errors:[{id,msg}]}` — كل عقد بمعاملة مستقلة؛ بلا ids ⇒ 400 «حدد عقد باطن واحدًا على الأقل.»
   - رسائل الرفض لكل id: «لا يمكن حذف عقد الباطن · للمقاول سندات صرف سارية على هذا العقد.\nألغِ السندات أولًا.» (شاملة السندات الغامرة غير المرتبطة على نفس عقد العميل لنفس المقاول V5.8) / «لا يمكن حذف عقد الباطن · عليه {n} مطالبة مسجّلة.\nاحذف المطالبات أولًا.» (أي مطالبة بلا فلترة حالة — كالمكتبي).
   - على النجاح: حذف صفّي فعلي للعقد + خطته ومصادره وبنوده + أسطر addendum_items side=sub + فك addendums والسندات الملغاة (subContractId=null) + حدث «حذف عقد باطن» + audit.
2) `vouchers` (authGuard: action_cancel_contract): `{subcontractorId, voucherIds:[], reason}`
   ⇒ `{mode:"delete"|"cancel", deleted?|cancelled?, ids, errors:[{id,msg}]}`
   - بلا ids ⇒ «حدد سندًا واحدًا على الأقل.»؛ بلا سبب ⇒ «اكتب سبب الحذف/الإلغاء — يُحفظ في سجل التدقيق.»
   - المطور (role=developer) ⇒ حذف نهائي: فك parentVoucherId للأبناء + حذف JournalEntry (voucher|voucher_cancel) + audit «حذف نهائي» + حذف السند (روابط الدفع Cascade).
   - غيره ⇒ إلغاء موثّق: حاجز voucherCancelBarrier ثم cancelVoucherTx بسبب «{reason} — إلغاء بدل حذف (بلا حساب مطوّر)». أخطاء per-id: «السند غير موجود.» / «السند ملغى بالفعل.» / رسالة الحاجز.
3) `record` (authGuard فقط؛ الدور داخل الخدمة): `{subcontractorId, reason}`
   - ترتيب الرفض المكتبي: «حدد المقاول.» ⇒ «المقاول غير موجود.» (404) ⇒ «لا يمكن حذف سجل المقاول «الاسم».\n{recordBlock}» ⇒ «اكتب سبب الحذف — يُحفظ في سجل التدقيق.» ⇒ «أداة التنظيف متاحة لحساب المطور فقط.\nهذه الأداة تحذف بيانات نهائيًا ولا تُتاح لأي مستخدم آخر.»
   - النجاح: حذف صف subcontractor + audit «حذف نهائي».
- action مجهول ⇒ 400 «action غير صالح (contracts|vouchers|record)».

## دلالات البيانات (ما حدث لأي شيء)
- سطور الخطة (sub_payment_plan) ومصادرها (sub_payment_sources) وبنود الارتباط (sub_contract_items): تُحذف فعليًا مع العقد (كالمكتبي؛ الـCascade موجود لكن الحذف الصريح يطابق الترتيب).
- السندات: السارية تمنع حذف العقد؛ الملغاة تُفكّ (subContractId=null) وتبقى في السجل — لا إلغاء ولا حذف ضمني عند حذف العقد.
- voucher_payment_links: لا تُمسّ عند حذف العقد (كالمكتبي) — حسابات الويب تربط الروابط بسندات غير ملغاة دائمًا فلا تأثير؛ مع الحذف النهائي للسند تُحذف روابطه Cascade.
- المطالبات: أي claim على العقد يمنع الحذف (لا حالات مستثناة — كالمكتبي).
- الملحقات: أسطر side=sub تُحذف وAddendum.subContractId=null (تبقى في سجل العقد) — كـV5.5.
- عقد الباطن نفسه: حذف صفّي فعلي (وليس «ملغى») — مطابق لـlc.delete_sub_contract؛ أما الـDELETE القديم /api/sub-contracts/[id] (إلغاء ناعم) فبقي كما هو دون كسر.
- الإلغاء ناعم دائمًا والأرقام لا تُعاد (قاعدة المشروع) — لم يُنشأ أي مسار إعادة ترقيم.

## نتائج الاختبار الحي (admin/admin — بيانات أُنشئت ونُظفت)
- 401 بلا توكن؛ المعاينة صحيحة (blockReason/recordBlock حرفيًا)؛ رفض حذف السجل وعليه عقد؛ رفض contracts/vouchers بلا ids وaction مجهول؛ حذف عقد بلا سندات ⇒ deleted:1 والصف أزيل من القاعدة فعلًا؛ رفض السجل الفارغ بلا سبب ثم بسبب (admin) برسالة المطور؛ PV-0016 على العقد ⇒ منع حذف العقد بالنص الحرفي ثم الإلغاء (mode:cancel) بسبب اللاحقة الحرفية ثم نجاح حذف العقد وفك السند الملغى (بقي معروضًا linkedContract فارغًا). التنظيف: سجل المقاول المؤقت حُذف؛ بقي سند ملغى ناعمًا PV-0016 (لا يُمحى بلا حساب مطور).
- lint: صفر. tsc: صفر أخطاء في ملفاتي (أخطاء باقية في ملفات وكيل متزامن غير ملتزمة: contracts/[id]/overview، pay-view، ContractDetailView — خارج نطاقي). dev.log: صفر 500.

## قرارات مطلوبة من المستخدم
1. لا يوجد مستخدم بدور developer في القاعدة — يلزم إنشاؤه لتفعيل «حذف نهائي للسندات» و«حذف سجل المقاول» (غيره يرى الرسالة الحرفية).
2. لقطة الحذف النهائي تُكتب في AuditLog فقط (لا عمود snapshot — ممنوع db push). لقطة كاملة كـpurge_audit تتطلب أعمدة/جدولًا جديدًا.
3. سند الاختبار PV-0016 ملغى ناعمًا وباقٍ في السجل (يمكن حذفه نهائيًا من النافذة نفسها عند توفر مطور).

## ملاحظات للوكلاء اللاحقيين
- لم يُلمس DELETE /api/sub-contracts/[id] ولا DELETE /api/subcontractors/[id] (يبقيان لمستدعٍ خارجي محتمل)؛ الواجهتان لم تعودا تستدعيهما للحذف.
- SubDeleteDialog props: `{subcontractorId, open, onOpenChange, onAuthError, onDone?({action,deletedContractIds}), focus?}` — isDeveloper يأتي من الخادم دائمًا.
- إصلاح العرضي في SubContractDialog (reason بدل statusReason) عالج انكسار «إلغاء العقد الباطن» القائم.
