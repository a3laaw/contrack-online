# Task ID: 23-5-w1 — Agent: full-stack (contract-invoice-pages)

**التاريخ:** 2026-10-18 · **المشروع:** /home/z/my-project (ConTrack — Next.js 16 + TS + Tailwind 4، عربي RTL)

## المهمة
تحويل نافذتَي «عقد جديد» (معالج 3 خطوات) و«فاتورة جديدة» (6 حقول) إلى صفحتين كاملتين داخليتين — بلا تغيير منطق أعمال أو API أو payload. الملفات الحصرية: ContractsView.tsx، InvoicesView.tsx، ContractNewPage.tsx (جديد)، InvoiceNewPage.tsx (جديد).

## المنجز
- **ContractNewPage.tsx (جديد):** نسخة صفحة كاملة من معالج النافذة السابق — نفس الخطوات الثلاث كخطوات داخل الصفحة (مؤشر شرائح + وصف «الخطوة N من 3» تحت العنوان) بلا نوافذ. الحقول كلها بنفس ids (ct-name/ct-amount/ct-date/ct-desc) ونفس منطق نوع العقد (defaultAmount يملأ المبلغ إن كان فارغًا) وصفوف المراحل (grid-cols-[1fr_5rem_5rem_2rem]، max-h-64 تمرير) وصفوف الدفعات (باستحقاق افتراضي = اليوم). نفس createMutation حرفيًا (POST /api/contracts بنفس payload: trim الاسم/الوصف، stages المفلترة بالاسم، plan المفلترة بالعنوان والمبلغ>0، sortOrder) ونفس invalidations (contracts/dashboard/customers) ونفس toasts («تم إنشاء العقد»/«تعذر إنشاء العقد») ونفس تحقق submitCreate (اختر العميل أولًا / أدخل مبلغ العقد مع setStep(1)). الحقول grid-cols-1 md:grid-cols-2 lg:grid-cols-3 (مؤكد فعليًا 3 أعمدة في المتصفح).
- **InvoiceNewPage.tsx (جديد):** نسخة صفحة كاملة من نافذة الفاتورة — نفس الحقول الستة (العميل/العقد/التاريخ/المبلغ/الوصف/ملاحظات) بنفس السلوك (العقد disabled حتى اختيار عميل، «اختر عميلًا أولًا»)، نفس الاستعلامات الثلاثة (["customers",""]/["customer",id]/["contract",id] retry:false) ونفس حسابات البطاقة (nCurrent/nInvoiced من قائمة الفواتير/nRemaining/nExceeds) ونفس createMutation (POST /api/invoices بنفس payload مع description/notes trim||undefined) وinvalidations (invoices/contract/dashboard) وtoasts («صدرت الفاتورة»/«رُفضت الفاتورة» برسائل الحرجتين حرفيًا) ونفس submitNew (4 تحققات بالتوست). المبالغ font-mono tabular-nums dir="ltr" مع formatKWD.
- **ContractsView.tsx:** حُذفت النافذة وكل حالاتها واستعلاما types/customers الخاصان بها والمutation؛ استُبدلت بحالة createPage | null؛ زر «عقد جديد» يفتح الصفحة، وeffect الـpreset (من ملف العميل عبر ConTrackApp) يفتحها مع presetCustomerId ويستهلك الـpreset كما كان؛ early return بعد كل الـhooks يعرض <ContractNewPage> مكان القائمة (onSaved/onCancel ⇒ setCreatePage(null)؛ onOpenContract كما كان بعد النجاح). تنظيف استيرادات (Dialog/Label/Textarea/apiPost/apiGet الإضافية/useToast/useQueryClient/الأيقونات/الأنواع) وتنظيف qc غير المستخدم.
- **InvoicesView.tsx:** حُذفت نافذة «فاتورة جديدة» وحالاتها وwasOpen/newPresetRef والاستعلامات الثلاثة والمutation؛ استُبدلت بحالة newPage {presetCustomerId} | null؛ openNew يمرر فلتر العميل الحالي كما كان؛ early return بعد كل الـhooks يعرض <InvoiceNewPage invoices={items} …> (نفس مخزون ["invoices"] فلُحساب «المفوتر سابقًا» بلا إعادة جلب). حُذفت todayStr واستيراد Textarea/Label/TriangleAlert/apiPost والأنواع المنقولة. بقيت النوافذ الصغيرة (التفاصيل، حذف الفاتورة) كما هي ≤ حقول عرضية.

## تكييفات الشكل فقط (بلا منطق)
- الصفحتان تُركَّبان عند الفتح فقط ⇒ التهيئة مباشرة من props بدل effect إعادة الضبط (نفس تكييف VoucherPage/CustomerEditPage)، وإزالة حراس `enabled: newOpen` من الاستعلامات المنقولة (حارس enabled بالشروط الدلالية بقي: nCustomerIdNum/nContractIdNum !== null).
- إلغاء في صفحة العقد صار outline (كان ghost) التزامًا بقاعدة «زر أساسي واحد + إلغاء outline»؛ التالي/إنشاء العقد والسابق كما هي (variant الأصل) في الشريط السفلي sticky (bg-background/95 backdrop-blur sticky bottom-2 z-30).
- بطاقة أرقام الفاتورة أُضيف لها font-mono + dir="ltr" على القيم (كانت tabular-nums فقط) وحقل المبلغ أُضيف dir="ltr" — تحسين عرض فقط.

## التحقق
- `npx tsc --noEmit` صفر أخطاء؛ `bun run lint` نظيف.
- grep الملفات الأربعة: صفر ألوان حرة (utility-scoped bg-/text-/border-/ring-… للألوان الحرة + dark: + bg-black + hex) — كلها رموز اللوحة (border/bg-muted/bg-primary/status-*/destructive النغمي المعتمد).
- خادم التطوير كان متوقفًا عند البدء (3000 refusing) — أُعيد تشغيله بالأمر المعتمد (bun run dev مع تصدير .env.local) كما في 23-5-b1.
- agent-browser (جلسة خاصة w1، admin بكلمة المرور الجديدة):
  - العقود ← «عقد جديد»: صفحة كاملة بالمسار «العملاء والعقود ← العقود» وكل الحقول، الشبكة 3 أعمدة فعلية (316px×3)، تنقل الخطوات 1→2→3 يعمل (إضافة مرحلة/دفعة تضيف صفوفًا بالاستحقاق الافتراضي) و«السابق» يعود، «إلغاء» من الخطوة 2 يعود للقائمة.
  - ملف العميل (شركة الأفق) ← تبويب العقود ← «عقد جديد»: فتح الصفحة مع العميل معبأ مسبقًا «شركة الأفق للمقاولات (C-0014)» و«إلغاء» يعود.
  - المحاسبة ← الفواتير ← «فاتورة جديدة»: صفحة كاملة بالمسار «المحاسبة ← الفواتير» و6 حقول، العقد disabled قبل اختيار العميل، اختيار شركة الأفق ⇒ CON-0012 ⇒ بطاقة الأرقام صحيحة (25,000.000 / 0.000 / 25,000.000)، مبلغ 999999 ⇒ تحذير التجاوز ظهر، «إلغاء» يعود للقائمة.
  - صفر أخطاء كونسول وصفر page errors؛ dev.log: لا POST /api/contracts ولا POST /api/invoices (لم يُحفظ شيء) وكل الـAPI 200 (401 قبل الدخول فقط)؛ لقطات /tmp/w1-contract-new.png و/tmp/w1-invoice-new.png.

## Stage Summary
- النافذتان الكبيرتان صارتا صفحتين كاملتين داخليتين بنفس المنطق والحقول والـmutations والـpayload حرفيًا، ضمن اللوحة اللونية وقاعدة الزر الأساسي الواحد، وبلا مسارات جديدة أو تعديل خارج الملفات الأربعة.
- النوافذ المتبقية في الشاشتين صغيرة (≤3 حقول/تأكيدات) فبقيت نوافذ مشروعة: العقود (GapsDialog)، الفواتير (التفاصيل + حذف).
