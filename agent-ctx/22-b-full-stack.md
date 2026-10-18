# Task 22-b — ملف العميل كصفحة داخلية (full-stack)

## العقد النهائي للـAPI

### GET /api/customer-file/[id]  (authGuard: screen_customers)
`{ customer, totals, cheques14, topContracts, contracts, timeline, meta }`
- `customer`: id/customerCode/name/phone/email/governorate/area/block/plot/address/notes/**folderPath**
- `totals`: count (كل الحالات) · active (=«نشط») · overdueCount · overdueDays (أقصى تأخر) · current/collected/paid/remaining (تُستثنى «ملغى» و«مسودة» من المال)
- `cheques14`: عدد سندات بطريقة تحتوي «شيك» وchequeDueDate ≤ اليوم+14 (يشمل المتأخر — كdue_cheques(14) المكتبية بلا حد أدنى) على عقود هذا العميل
- `topContracts`: أكبر 5 متبقٍ (id/contractNumber/name/status/current/collected/remaining)
- `contracts`: كل العقود (id desc) + hasOverdue/overdueDays/overdueTitle/isSupervision — أقصى تأخر = خط خطة بمتبقٍ>0.001 وdaysDiff<0 وحالة ≠ skipped، للعقود غير (مغلق/ملغى)
- `timeline`: آخر 40 حدثًا لعقود العميل → أعلى 12 (contractId/contractName/eventTime/eventType/description/username)
- `meta`: { today, overdueTooltip } — نص tooltip «على العميل N عقد بقسط متأخر (أقصى تأخر X يومًا)» أو ""

### GET /api/customer-file/[id]/print
HTML RTL للطباعة (بطاقة العميل + لكل عقد ملخصه وجدول سنداته) — مصادقة كوكي الجلسة (window.open) أو Bearer. لا PDF خادمي.

### GET /api/attachments?customerId=X  (امتداد)
`{ attachments: [{id, contractId, contractNumber, contractName, fileName, addedAt, sizeBytes}] }` — مرفقات كل عقود العميل. POST/DELETE/تنزيل id&download=1 كما هي.

### GET /api/comments (امتدادات)
- `contractId=0` ⇒ «غير محدد» (بلا عقد) · `contractId=N` ⇒ عقد · حذفه ⇒ كل العقود
- الرد أضاف `customerTotal` (إجمالي تعليقات العميل قبل الفلترة — مقابل comments_count)
- التثبيت أولًا افتراضيًا (pinnedFirst=1)

### PATCH /api/customers/[id] (امتداد)
يقبل `folderPath` (نص) — تعيين/حذف مسار مجلد الشبكة دون حذف ملفات.

## الواجهة
- `CustomerFilePage.tsx`: شريط رجوع ثابت (Esc أو زر) · EntityHeader بالشارات الحرفية · Tabs «عام»/«العقود والتفاصيل» · ملخص العميل (المتبقي/العقود/شيكات 14/أقصى تأخر + القيمة/المحصّل/المدفوع) · نماذج ومرفقات (تعيين/حذف مسار الشبكة + رفع مرفق base64 لعقد + قائمة بحجم وحذف) · أهم عقود (5) تنقر لفتح العقد في التبويب الثاني · السجل الزمني بنص المكتبي · تعليقات (فلتر/بحث/كتابة/تثبيت/تعديل/حذف ناعم) · Master-Detail بـContractDetailView مضمّنًا كما هو (لا تعديل عليه) · شريط سفلي: عقد جديد/كشف حساب العميل (StatementTarget kind:"customer")/طباعة كل المستندات/المزيد.
- `CustomersView`: فتح الصفحة عبر `onOpenCustomerFile` بدل الـDialog؛ حوار التعديل استُخرج إلى `CustomerFormDialog.tsx` (يُستعمل من القائمة ومن الصفحة).
- `ConTrackApp`: view "customer-file" + `openCustomerFile(id)` + onBack ⇒ navigate("customers")؛ البحث الشامل عن عميل يفتح الملف مباشرة.

## ملاحظات لمن يلحق
- لا حاجة لأي db push: folderPath موجود في نموذج Customer، المرفقات على ContractAttachment الموجود (تخزين قرص db/attachments — على Vercel serverless قد لا يثبت القرص؛ موثق في worklog).
- لم ألمس: AppShell/ContractDetailView/SettingsView/ReportsView/SubcontractorsView/AdvancesView.
- dev server كان متوقفًا عند بدء مهمتي؛ شغّلته بـ`env -u DATABASE_URL bun run dev` (متغير شل DATABASE_URL=file: كان يكسر postgres في .env).
