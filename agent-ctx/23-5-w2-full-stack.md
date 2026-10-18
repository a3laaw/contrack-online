# Task ID: 23-5-w2 — full-stack (gateway-pages)

## المهمة
تحويل النوافذ الكبرى في GatewayView.tsx وOtherCompanyView.tsx إلى صفحات كاملة داخلية (نمط ContractEditPage): رفع ملف تسديد بوابة الدفع (8 حقول)، رفع كشف حساب البنك (5 حقول)، إضافة/تعديل بوابة profile (8 حقول)، و«تسديد مختارات» للشركة الأخرى (6 حقول) — بلا تغيير منطق أعمال أو API أو payload.

## ما أُنجز
- **ملفات جديدة (5)** — كلها ضمن البادئات المسموحة Gateway*/OtherCompany*:
  - `src/components/contrack/GatewayFileParse.ts` — نقل حرفي لدوال تحليل الملفات النصية (parseOpsText/parseBankText وأنواعها ومساعداتها) من GatewayView لمشاركتها.
  - `src/components/contrack/GatewayUploadPage.tsx` — صفحة رفع ملف التسديد: نفس الحقول (بوابة Select + إضافة سريعة + ملف + نص خام + معاينة 5 صفوف قابلة للتعديل) ونفس settlementMutation/quickAddMutation/payload حرفيًا؛ **عند الانتهاء يعود لتبويب العمليات** (بطاقة نتيجة النافذة أُزيلت لأن onDone يغادر فورًا — الملخص بالتوست نفسه).
  - `src/components/contrack/GatewayBankUploadPage.tsx` — صفحة رفع كشف البنك: نفس الحقول الخمسة وbankUploadMutation والinvalidations الثلاثة حرفيًا؛ العودة لتبويب التصفية.
  - `src/components/contrack/GatewayProfileEditPage.tsx` — صفحة إضافة/تعديل بوابة: 8 حقول بتهيئة من editing (key={id ?? "new"}) وprofileSaveMutation/payload/تحقق «اسم البوابة مطلوب» حرفيًا.
  - `src/components/contrack/OtherCompanyPayPage.tsx` — صفحة تسديد مختارات: 6 حقول + allocateAmount/todayStr منقولتان حرفيًا + payMutation/payload/تحققات submitPay الثلاثة حرفيًا + **حارس آمن** بلا تحديد عمليات (حالة «لا عمليات محددة» + عودة للقائمة)؛ لذلك أُزيل disabled عن زر الفتح (بوابة تنقل فقط).
- **GatewayView.tsx** (2117→1416): حالة `page: "upload"|"bank"|"profile"|null` + profileEditing، early return بعد كل الـhooks يعرض الصفحات مكان شاشة القائمة؛ حُذفت النوافذ الثلاث الكبرى وحالاتها وmutationsها وكتلة التحليل المنقولة؛ نوافذ ≤3 حقول بقيت (التصنيف/حذف بوابة/حذف عملية/مسح شامل) وأزرار خطرها صارت فاتحة `border-0 bg-status-danger-bg text-status-danger hover:bg-status-danger-bg/80`.
- **OtherCompanyView.tsx** (1247→1050): حالة `page: "pay"|null` + early return؛ حُذفت نافذة التسديد ومنقولاتها؛ الرصيد الافتتاحي (حقل واحد) وتغطية التسديد وحذف التسديد بقيت نوافذ (زر الحذف فاتح).

## ملاحظات للوكلاء القادمين
- **ملاحظة معلقة (خارج النطاق)**: bankQuery/unmatchedQuery في GatewayView معطلان (`enabled: tab === "bank"`) ولا يوجد تبويب "bank" في TabsList — قسم «سطور البنك» داخل «التصفية اليومية» يظهر فارغًا دائمًا رغم البيانات. التفعيل = تغيير الشرط إلى `tab === "clearing"` (قرار مستخدم).
- مسار «تسديد مختارات» المعبأ لم يُختبر فعليًا (لا مستحقات بالقاعدة) — الكود مطابق حرفيًا للنافذة السابقة.
- لاختبار تعديل بوابة أُنشئت بوابة مؤقتة عبر API وحُذفت فورًا (profiles عادت []) — القاعدة نظيفة.

## التحقق
- `npx tsc --noEmit` صفر على src، `bun run lint` نظيف، grep ألوان حرة (utility + dark: + bg-black + hex) على الملفات السبعة = صفر.
- agent-browser --session w2: الدخول admin ← بوابة الدفع: صفحة الرفع بكل حقولها ولصق+تحليل ⇒ معاينة صفين و«معالجة ورفع (2)» تفعّل و«إلغاء» عاد (بلا حفظ)؛ سطور البنك قسم داخل التصفية يظهر؛ صفحة كشف البنك تعمل وتحلل وتعود؛ تعديل بوابة يفتح الصفحة معبأة ويعود؛ بوابة جديدة تعمل؛ الشركة الأخرى: «تسديد مختارات» بلا تحديد ⇒ حالة آمنة و«عودة للقائمة» تعمل. errors فارغ وconsole نظيف وdev.log بلا 5xx.
- ملاحظة تشغيلية: خادم التطوير سقط أثناء التحقق وأُعيد إطلاقه بالأمر المعتمد (bun run dev مع تصدير .env.local).
