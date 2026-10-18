# Task 13-a — Backend: Payment Gateway + Clearing + Other Company (ملخص الوكيل)

## الملفات المنشأة (الكل جديد — لم يُعدَّل أي ملف قائم)
- `src/lib/gateway-server.ts` — مكتبة البوابة والشركة الأخرى (مطابقة/تثبيت/تصنيف/توزيع/تصفية يومية/بنك/أرصدة/دفتر).
- `src/app/api/gateway/` : `profiles/route.ts` · `profiles/[id]/route.ts` · `settlement-file/route.ts` · `ops/route.ts` · `ops/classify/route.ts` · `ops/distribute/route.ts` · `ops/undistribute/route.ts` · `aliases/route.ts` · `daily-clearing/route.ts` · `bank-lines/route.ts` · `unmatched-bank/route.ts` · `summary/route.ts` · `wipe/route.ts`.
- `src/app/api/other-company/` : `balance/route.ts` · `opening/route.ts` · `due-items/route.ts` · `transfers/route.ts` · `transfers/[id]/route.ts` · `transfers/[id]/coverage/route.ts` · `ledger/route.ts` · `daily-settlement/route.ts`.

## الصلاحيات
- البوابة `screen_gateway` (wipe للمدير بجسم `{confirm:'مسح البوابة'}` حرفيًا — غيره 422).
- التصفية/كشف البنك/غير المربوط `screen_clearing` · الشركة الأخرى `screen_other_company`.
- ملاحظة نمط النظام: المفتاح المجهول لا يقيّد — السكرتير يُمنع فقط بصف UserPermission صريح (تحقق 403/200).

## أبرز القرارات والانحرافات الموثقة
1. **إرجاع الموزَّع المسدد** (undistribute): المصدر يُتخطى المسدد؛ المهمة طلبت undo_other حرفيًا — أنفذ: حذف تخصيصات العملية من transfer_op_allocs وسحب المبلغ من التسديد (يصير «على الحساب» unallocated) وpaid_transfer_id=0 ثم distributed=false.
2. **wipe** يحذف كشف البنك معه (نص المهمة) بينما المصدر يبقيه — بقيت البروفايلات/الافتتاحي/الروابط.
3. **T+1 لعمليات البوابة دائمًا** بأيام عمل (جمعة/سبت) — KNET الفوري يخص سندات القبض لا عمليات البوابة (تعارض PLAN §1 موثق، الكود هو المعتمد). expectedCollectionDate منفصلة (خميس/جمعة/سبت⇒الأحد).
4. **ترتيب مرشحي المطابقة**: هاتف+اسم=0، هاتف=1، رابط محفوظ=1، اسم=2، اسم جزئي=3، **مبلغ فقط=4** («أو رصيد إجمالي يطابق» بنص المهمة) — مع استبعاد السندات المستهلكة بعمليات mine أخرى وقيد (method يشير للبوابة OR سندات عميل الرابط).
5. **التسديد فوق الصافي**: التخصيص الصريح يُقص على متبقي الصافي لكل عملية (كالمصدر min) والفائض يبقى على الحساب؛ الفحص الوحيد: مجموع الصريح ≤ مبلغ التسديد. لا سند نهائيًا.
6. **expect في التصفية اليومية** = إجمالي اليوم − عمولاته (سهمَي mine+other) — هكذا المصدر؛ النصيب my_share/other_share منفصلان.

## نقاط مزامنة مع الواجهة (13-b)
كل أشكال الاستجابات موثقة حرفيًا في نهاية قيد worklog.md (Task 13-a، البند الأخير «نقاط مزامنة» أ–و). أبرز ما راقبه الوكيل الأمامي أثناء اختباره الحي ووافق أنواعه:
- `GET /api/gateway/ops` → `{ops[], totals}` · `POST /api/gateway/settlement-file` → `{matched, summary, checklist}` · `daily-clearing` → `{rows[], totals}` · `other-company/balance` → `{opening, dues, paid, remaining, side}` · `daily-settlement` → `{days[{...,cumulative_due,cumulative_paid,cumulative_diff}], totals, transfersTotal}` · `transfers/[id]/coverage` → `{transfer, ops, groups, totals{unalloc}}`.

## جودة
- `bunx tsc --noEmit` على ملفاتي = **صفر**؛ eslint نظيف؛ dev.log بلا 500. أخطاء tsc الظاهرة الآن في `OtherCompanyView.tsx` للوكيل الأمامي قيد البناء (أنواعها الأساسية في contrack-types.ts متوافقة مع استجاباتي).
- بيانات الاختبار نُظفت بالكامل عبر الـAPI (wipe + حذف التسديدات/العقد/العميل/الروابط/البروفايل + تصفير الافتتاحي) — بقايا مقصودة: audit + عدّادات الترقيم وRV-0008 ملغى.
