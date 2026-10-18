# spec-8-e — العُهد والتصفيات + سلف الموظفين + الفواتير + بوابة الدفع (تفصيل التنفيذ) + تسديدات الشركة الأخرى

> قراءة عميقة حرفية لـ ConTrack V9.15.18 (كل الأرقام أسطر من الملف المذكور). مرجع تنفيذ المرحلة 5 في النسخة الأونلاين.
> الملفات المقروءة: settlement_service.py (كامل 2296)، custody_center.py (2479)، custody_settlements.py، advances_page.py، invoice_service.py، invoice_pdf.py، voucher_pdf.py، custody_pdf.py، database.py، lifecycle_service.py (الأقسام المالية)، gateway_service.py (كامل 748)، report_service.py (التدفق النقدي)، expense_account_service.py، auth_service.py، feature_service.py، main_window.py (التنقل)، gateway_page.py، payment_gateway_page.py، clearing_page.py، other_company_page.py، other_transfers_page.py، due_items_page.py، vouchers.py (وضع العهدة)، extras_service.py.

---

## 0. خلاصة معمارية أساسية (تُغيّر طريقة التنفيذ)

1. **لا يوجد جدول "عهد" ولا جدول "سلف" ولا جدول "تصفيات"** — كل شيء مشتق من `vouchers` بعمودين رابطين:
   - `custody_account_id` (FK → expense_accounts) = حركة عهدة.
   - `advance_employee_id` (FK → employees) = حركة سلفة موظف.
   - `expense_group_ref` (نص `PAY-GRP-YYYYMMDD-###`) = تجميع بنود تصفية العهدة (والصرف المجمع).
   - السند إما "تسليم عهدة" (payment + custody_account_id + expense_account_id فارغ) أو "بند تصفية" (payment + custody_account_id + expense_group_ref ممتلئ + حساب مصروف فعلي) أو "إرجاع" (vtype='custody_return').
2. **جداول البوابة/الأخرى كلها تُنشأ لحظيًا** بـ `CREATE TABLE IF NOT EXISTS` داخل `settlement_service.ensure_*` — **غير موجودة في database.py إطلاقًا** (تحقق: grep على database.py بلا نتائج): `gateway_profiles`، `gateway_ops`، `bank_lines`، `gateway_fee_vouchers`، `other_company_transfers`، `transfer_op_allocs`، `other_company_opening`، `schema_flags`، و`match_aliases` (في gateway_service).
3. **لا أرصدة مخزنة**: كل الرصيد (عهدة/سلفة/أخرى) محسوب قراءةً من السندات/التوزيعات. العتبة الموحدة 0.001/0.0005 والتواريخ نصية `YYYY-MM-DD`.
4. **الترقيم**: سندات `RV`/`PV`/`TV`/`CV`/`SD` حسب vtype (lifecycle_service.py:112-120)؛ مجموعة الصرف `PAY-GRP-YYYYMMDD-###` (2962-2975)؛ الفواتير `INV-%04d` (invoice_service.py:30-44).

---

## 1. العُهد (Custody)

### 1.1 التخزين
- حسابات العهدة = صفوف `expense_accounts` حيث `account_kind='advance'` تحت أب «العُهد» (لا يقبل قيدًا: `allow_posting=0`) وابن افتراضي «عهدة عامة» (`allow_posting=1, include_in_profitability=0, account_kind='advance', sort_order=8001`) — expense_account_service.py:18-19, 81-104. أي حساب قديم اسمه يحوي «عهد» يُعاد تصنيفه advance تلقائيًا (94-96).
- **حارس مزدوج**: `account_snapshot()` يرفض استخدام حساب عهدة كحساب مصروف (expense_account_service.py:288-293)، و`add_voucher` يرفض حساب غير advance كعهدة (lifecycle_service.py:2347-2352).
- سند تسليم العهدة يبقى ظاهرًا في سندات الصرف (خروج نقدي فعلي)؛ أما بنود التصفية فتُستبعد من قائمة سندات الصرف (vouchers.py:2645-2651 `exclude_custody_settlement`) وتُعرض في شاشة العُهد فقط (custody_center.py:1-9).

### 1.2 دورة العهدة كاملة
```
① تسليم عهدة (Handover)     ← سند صرف PV
   vtype='payment', custody_account_id=<حساب عهدة>, expense_account_id=None
   account = custody_account_snapshot (يظهر «حساب العهدة»)
   البيان الافتراضي = بادئة الإعدادات desc_prefix_custody + "تسليم عهدة"
   (lifecycle_service.py:2340-2357 · custody_center.py:27-33 · vouchers.py:269-279,2070-2087)
   ⚠️ لا يُطلب طرف عميل/مقاول/مشروع ولا عميل تحليلي (vouchers.py:761,1444)

② تصفية (Settlement)        ← دفعة سندات صرف تحت مرجع واحد
   CustodySettlementDialog: تاريخ عام + حساب العهدة (+ رصيد قبل/بعد حي)
   + بنود: {vdate لكل بند, expense_account_id, amount, party, expense_customer_id,
            contract_id, description (فارغ ⇒ "عميل — مصروف")}
   ⇒ add_custody_settlement(vdate, custody_account_id, rows, group_desc)
     (lifecycle_service.py:3044-3058) ← add_grouped_payments(method="تصفية عهدة")
     (2979-3041): فحص كل البنود أولًا ثم إنشاء سند PV مستقل لكل بند مع:
       expense_group_ref=group_ref, expense_group_line=i,
       custody_account_id, notes += "\nتصفية عهدة من حساب: {full_path}"
   ⇒ التصفية "ليست خروجًا نقديًا جديدًا" — cash_account_balances يتخطاها
     (is_settlement_voucher, lifecycle_service.py:1981-2003 + 2062-2065)

③ إرجاع متبقي للخزينة (V4.52) ← سند custody_return CV
   add_custody_return (3061-3080): مدين البنك/الصندوق دائن العهدة، بلا سند قبض
   وبلا أثر إيرادي. حارس: المبلغ ≤ متبقي الحساب (add_voucher 2291-2310)
   الرصيد: handed − spent − returned (custody_balances 3425-3480)

④ الإغلاق = التصفية الكاملة (الرصيد ≤ 0.005) — لا حالة "مغلق" مخزنة.
   «معلقة» = رصيد موجب (custody_open_items 3483-3525: أقدم تسليم + عدّاد أيام)
```

### 1.3 أعمدة/حقول التصفية وحالتها
- كل بند تصفية = سند `vouchers` مستقل بحقول: `voucher_number(PV)`, `vdate` (تاريخ الفاتورة للبند)، `method="تصفية عهدة"`، `party` (المورد/الجهة)، `expense_account_id` + `expense_account_snapshot`، `amount`، `description`، `expense_customer_id`، `contract_id`، `custody_account_id` + `custody_account_snapshot`، `expense_group_ref` + `expense_group_line`، `notes` (وسم المصدر)، `cancelled/cancel_reason/cancelled_at`.
- المجموعة تُعرض/تُطبع عبر `custody_settlement(group_ref)` (3368-3422): `{group_ref, custody_account(_id), holder, vdate, method, lines, active_count, cancelled_count, handed, spent, balance=handed−spent}` — «المُسلَّم» = سندات التسليم بلا مرجع مجموعة حتى تاريخ التصفية (3394-3407).
- تعديل التصفية (للمدير): `SettlementEditDialog` يحفظ البنود بـ `update_voucher` ويُلغي المحذوف بـ `cancel_voucher(vid, "حذف بند أثناء تعديل التصفية")` (custody_center.py:727-772) — لا يمكن حفظ تصفية فارغة (728-730).

### 1.4 قواعد التحقق (حرفية)
- **لا إلغاء تسليم عهدة بتصفية/رد سارٍ** (cancel_voucher 4709-4725): إذا `vtype='payment'` و`custody_account_id` ليس بند تصفية ⇒ عدّ السندات السارية لنفس `custody_account_id` من نوع `custody_return` أو `expense_group_ref<>''` أو notes تحتوي «تصفية عهدة من حساب:»/«إغلاق عهدة من حساب:» (باستثناء السند نفسه) — إن وُجد ⇒ رفض: «لا يمكن إلغاء تسليم العهدة: توجد تصفية أو ردود سارية. ألغها أولًا ثم ألغِ التسليم.»
- **لا يجمع السند عهدة وسلفة معًا** (add_voucher 2201-2202).
- `custody_return` يتطلب حساب عهدة أو موظفًا (2203-2205).
- إلغاء أي سند يمر أيضًا بحارس المطالبات السارية للعقد (4741-4751) وحارس حالة العقد (`_ensure_contract_accepts_financial_actions` 4739).
- الإلغاء يعمل على الأبناء (`parent_voucher_id`) ويعكس قيود journal_entries (4753-4765).

### 1.5 من يصرّح / يصفّي
- التسليم: أي مستخدم يملك `screen_payments` عبر سند صرف (وضع «تسليم عهدة») أو زر «✍ تسليم عهدة» في شاشة العُهد (custody_center.py:2154-2163).
- التصفية/الإرجاع: من شاشة العُهد (نفس الصلاحية الضمنية).
- تعديل التصفية/حذف بند: **مدير فقط + ميزة `settle_edit`** (custody_center.py:2126-2131، custody_settlements.py:405-411، feature_service.py:261-265).

### 1.6 أعمدة العهدة المطبوعة (custody_pdf.py)
- `generate_custody_pdf(data)` — data من `custody_settlement(group_ref)`:
  - ترويسة: اسم الشركة + «كشف تصفية عهدة» + `المرجع: {group_ref}` + تاريخ الطباعة (159-183).
  - صندوق معلومات: **حساب العهدة / المستلم (holder) / تاريخ التصفية** (185-208).
  - أعمدة الجدول `_COLS` (50-57): **م | التاريخ | المستفيد | العقد/المشروع | البيان (مع حساب المصروف بين قوسين) | المبلغ** — البيان يُلفّ على سطرين (270-292)، البند الملغى يُطبع بالأحمر مشطوبًا (236, 309-313).
  - الموازنة (315-364): «إجمالي المصروف من العهدة (N بند)» ثم **المبلغ المُسلَّم / المصروف الفعلي / المتبقي لدى المستلم (أو «مستحق للمستلم (صرف زيادة)» بالأحمر)** + ملاحظة عدد الملغى المستثنى.
  - توقيعات: **المستلم | المحاسب | المدير** (366-380) + ترقيم صفحات (128-135).
- `generate_custody_ledger_pdf` (804+) لكشف الحساب، و`generate_custody_overview_pdf` (388+) للتقرير الشامل (landscape)، و`generate_blank_custody_settlement_form` (688+) نموذج فارغ مع «الاسم والتوقيع» (نموذج Excel أيضًا `_blank_excel_form` custody_center.py:2250).

### 1.7 كشف العهدة الموحد (custody_ledger 3544-3678)
صفوف بثلاثة أنواع: `handover` (وارد +)، `return` (خارج −)، `settlement` (خارج − بإجمالي المجموعة + `details` بنودها) برصيد جارٍ. التقارير الأربعة: `settlements_summary` (3913-3963)، `custody_balances` (3425-3480)، `custody_detailed_report` (3681-3743: رصيد تراكمي **لكل حساب عهدة على حدة**)، `custody_monthly_summary` (3746-3799: افتتاحي/تسليم/صرف/مرتجع/ختامي شهريًا)، `custody_handover_list` (3802-3827)، `custody_overview` (3830-3910).
شاشة العُهد الموحدة `CustodyUnifiedPage` = تابات: كشف الحساب / التصفيات / التقارير (custody_center.py:2370-2414) مع مزامنة فلتر الحساب بين التابات (2462-2479).

---

## 2. سلف الموظفين (Advances)

### 2.1 الجداول
- `employees` (database.py:397-403 ومرة ثانية 1563-1577):
  ```sql
  id INTEGER PK AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
  phone TEXT DEFAULT '', notes TEXT DEFAULT '', active INTEGER NOT NULL DEFAULT 1
  ```
- الحركات في `vouchers` عبر `advance_employee_id` (database.py:702) — **لا جدول سلف مستقل**.

### 2.2 الحركات الثلاث (lifecycle_service.py V4.53)
| الحركة | vtype | القيد المحاسبي | الحارس |
|---|---|---|---|
| صرف سلفة `add_employee_advance` (3257-3274) | `payment` + advance_employee_id | مصروف على حساب **«سلف موظفين / قرض راتب»** حصرًا (ensure_employee_advance_account 2670-2697؛ DEFAULT_TREE 12؛ رفض أي حساب آخر 2367-2372) | الموظف موجود و`active` |
| رد نقدي `add_advance_cash_return` (3277-3294) | `custody_return` + advance_employee_id | يدخل الخزينة (method=الصندوق/البنك) ويخفض المصروف (dائن السلف — add_voucher 2311-2325) | المبلغ ≤ متبقي السلفة (2321-2325) |
| خصم من راتب `add_salary_deduction` (3297-3313) | `salary_deduction` + advance_employee_id | مدين «رواتب» دائن السلف — **بلا حركة نقدية** (account = مسار الحساب؛ ensure_salary_account 2700-2702) | المبلغ ≤ متبقي السلفة (2335-2339) |

- القيود العامة في add_voucher: `salary_deduction` يتطلب موظفًا (2206-2207)؛ vtype النظامية خمسة فقط (2198-2200).

### 2.3 الرصيد والحالة لكل موظف
- `employee_balance(eid)` (3203-3213): `Σ payment + − Σ(custody_return, salary_deduction)` للسندات غير الملغاة → **الرصيد المستحق على الموظف**.
- `employee_balances()` (3162-3200): لكل موظف `{advanced, recovered, deducted, balance=advanced−recovered−deducted}` مع اسم/هاتف.
- `employee_ledger(eid, d1, d2)` (3216-3254): كشف برصيد جارٍ وأنواع موسومة: `سلفة (+)` / `رد نقدي (−)` / `خصم راتب (−)`.

### 2.4 FIFO الاسترداد (المؤثرة على التقارير)
- `report_service._advance_settlement` (**995-1031**): يرتب أحداث السلف والردود `(vdate, kind, id)` ويُطفئ **أقدم سلفة للموظف أولًا** — يرجع `{voucher_id: المبلغ المسترد منها}`. السلفة المُستردة لا تُحسب مصروفًا.
- في `cash_flow_report`: السلفة تدخل الخارج بمصروفها فقط (`amount − المسترد`، 1132-1143)، الرد النقدي ليس إيرادًا (1150-1154)، الخصم من الراتب خارج التقرير النقدي كليًا (1110-1112)، وأثر السلف على الرصيد = `−adv_paid + adv_back + adv_expense` (1165-1173). المجاميع: `advance_out/in/returned` (1182-1184).

### 2.5 الحرس والقواعد
- **إلغاء سلفة ممنوع بوجود رد/خصم سارٍ** (cancel_voucher 4726-4738: عدّ `custody_return/salary_deduction` السارية لنفس الموظف ⇒ رفض).
- **حذف موظف ممنوع بوجود سلف نشطة** (delete_employee 3141-3159) — بدلًا منه `set_employee_active` (3118-3121). اسم الموظف فريد (UNIQUE).
- **استعادة سلفة ملغاة** (V8.4، advances_page.py:350-396): اختيار من سندات `advance_employee_id=? AND cancelled=1` ثم `unified_cancel_service.restore_transaction("voucher", vid)`.

### 2.6 شاشة السلف (advances_page.py)
- شريط علوي: قائمة موظفين (قابلة للبحث) + أزرار: «➕ موظف» / «＋ سلفة جديدة» / «↩ رد نقدي» / «✂ خصم من راتب» / «♻️ استعادة سلفة» (201-224).
- 3 بطاقات: «💸 إجمالي المسلَّم» / «↩ المسترد + المخصوم» / «💰 المتبقي» (227-234, 303-317).
- أدوات: «📋 كشف حساب» (فردي، 412-481) / «📊 تقرير مجمع» (أرصدة كل الموظفين، 483-548) / «📤 تصدير Excel» / «🖨 طباعة PDF» (tabular_pdf، 550-586).
- أعمدة الجدول `HEADS` (16-17): **التاريخ | المرجع | الحركة | البيان | سلفة (+) | استرداد (−) | المتبقي**. نوافذ الحركة: موظف + «المتبقي الحالي» + مبلغ + تاريخ + طريقة (الصندوق/البنك، مخفية في الخصم) + ملاحظات؛ مبلغ الاسترداد/الخصم مسقوف بالمتبقي تلقائيًا (110-119).
- إضافة موظف: نافذة اسم*/هاتف/ملاحظات (20-49).

---

## 3. الفواتير (Invoices)

### 3.1 الجدول الحرفي (database.py:264-274)
```sql
CREATE TABLE IF NOT EXISTS invoices (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number TEXT NOT NULL UNIQUE,
    customer_id    INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    contract_id    INTEGER NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
    invoice_date   TEXT NOT NULL,
    description    TEXT DEFAULT '',
    amount         REAL NOT NULL CHECK (amount > 0),
    notes          TEXT DEFAULT '',
    created_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
```

### 3.2 القواعد (invoice_service.py)
- الترقيم `INV-{n:04d}` تصاعدي من أعلى رقم موجود؛ عند تعارض UNIQUE يعاد توليده حتى 8 محاولات (30-44, 122-142).
- **لا حالات إطلاقًا** (لا مسودة/صادرة/مدفوعة) — الفاتورة صف ثابت: إنشاؤها `add_invoice`، تعديلها `update_invoice`، وحذفها **فيزيائي** `DELETE` (164-169).
- `_validate` (96-119): رقم + عميل + عقد + تاريخ + مبلغ > 0؛ العقد يخص العميل نفسه؛ **القاعدة التقييدية: `amount ≤ contract.amount (الخام!) − Σ فواتير العقد`** (contract_financials 77-93 مع `exclude_invoice_id` عند التعديل) — رفض: «قيمة الفاتورة تتجاوز المبلغ المتبقي من العقد».
- **قاعدة V3.14 (لا تخفض المديونية)** — statement_service.py:72-77: الفاتورة تدخل كشف الحساب سطرًا «فاتورة (للعلم): …» بمدين 0 ودائن 0؛ «المتبقي = القيمة الحالية − المحصّل فقط» (112-129). الفاتورة **لا تغطي دفعة ولا ترتبط بـ payment_plan أو voucher_payment_links** — مجرد مستند للعلم + طباعة. (لا تُحسب في مستحقات العميل ولا التغطية FIFO.)

### 3.3 بنية الفاتورة PDF (invoice_pdf.py:63-274)
- ترويسة: صورة `header_image` أو ترويسة مرسومة (شريط primary بلون `settings.invoice_primary` + لوجو + اسم/عنوان/هاتف الشركة + كلمة «فاتورة») (81-117).
- شريط معلومات 4 حقول: **رقم الفاتورة | التاريخ | العميل | رقم العقد** (119-141).
- جدول البيان: سطر واحد «البيان/المبلغ» (description أو «دفعة من قيمة العقد») + صف «إجمالي الفاتورة» (143-183).
- **ملخص العقد**: قيمة العقد / إجمالي الفواتير / المبلغ المتبقي (أخضر/أحمر) (185-207).
- ملاحظات (≤3 أسطر)، توقيعان: **توقيع المستلم | التوقيع**، **الختم** (صورة `stamp_image` بحجم `stamp_size_mm` وإزاحة `stamp_x/y_mm` وإلا إطار متقطع «مكان الختم») — **بلا تفقيط** (التفقيط حكر على السندات)، فوتر صورة أو نص «شركة · شكرًا لتعاملكم معنا».
- طابع «الاقتصاد» `print_economy` يزيل الختم.

### 3.4 من ينشئها/أين تظهر
- الإنشاء/التعديل: `InvoiceDialog` (ui/invoices.py:32-193) بملخص مالي حي (قيمة العقد/إجمالي الفواتير/المتبقي 79-93,144-165). حقل الرقم يُملأ تلقائيًا بـ `next_invoice_number()` (124).
- الميزة مقفلة بـ **feature flag `invoices`** (feature_service.py:49-53، default True): تظهر فواتير العميل/العقد في روابط التعاملات (dealings.py:749-752)، الطباعة الدفعية للعقد (contract_hub.py:1740-1745)، الأرشيف (archive.py:1894-1899)، والبحث بمرجع الفاتورة يفتح عرض «سند زجاجي» `GlassReceiptDialog` (statement.py:476-490، main_window.py:1839-1844) الذي يطبعها عبر `generate_invoice_pdf` (glass_receipt.py:291-292). لا شاشة قائمة فواتير مستقلة في التنقل.

---

## 4. بوابة الدفع — تفصيل التنفيذ

### 4.1 الجداول اللحظية (settlement_service.py — ليست في database.py)
**gateway_profiles** (64-72):
```sql
id PK, name TEXT UNIQUE, bank_account TEXT DEFAULT '',
methods TEXT DEFAULT 'KNET', lag_days INTEGER DEFAULT 1,
fee_fixed REAL DEFAULT 0, tolerance REAL DEFAULT 0.005,
late_days INTEGER DEFAULT 3, is_active INTEGER DEFAULT 1
```
الافتراضي: «البوابة الافتراضية» methods=KNET lag=1 fee=0 (89-94). `methods` = كلمات مفصولة بفواصل تُحسب سندات القبض التي تحتوي إحداها في `vouchers.method` واردَ هذه البوابة (`_method_clause` 405-410: `method LIKE %kw%` OR).

**gateway_ops** (136-187) — عمليات كشف البوابة المثبتة:
```sql
id PK, gateway TEXT, op_date TEXT, phone TEXT, amount REAL,
ref TEXT, status TEXT ('mine'|'other'|'unmarked'|''),
receipt_no TEXT, customer TEXT, batch TEXT,
created_at TEXT DEFAULT (datetime('now','localtime'))
-- UNIQUE INDEX uq_gateway_ops(gateway, op_date, phone, amount, ref)  (146-148)
+ أعمدة ملحقة (ALTER): paid_transfer_id INTEGER DEFAULT 0,
  classified_manual INTEGER DEFAULT 0, distributed INTEGER DEFAULT 0,
  gw_paid INTEGER, gw_paid_date TEXT, gw_token TEXT,
  distributed_at TEXT, effective_date TEXT   -- V8.11: T+1
```
ترحيل لمرة واحدة `dist_migrated_v416` (175-186): المصنف القديم mine/other يعدّ موزَّعًا.
**`effective_date`** = T+1 بأيام عمل للبوابة/التحويل البنكي (45-60؛ الجمعة/السبت عطلة `WEEKEND=(4,5)` 18؛ `add_business_days` 34-42).

**bank_lines** (276-286) — **جدول فعلي دائم** (ليس استيرادًا مؤقتًا):
```sql
id PK, bank_account TEXT, cdate TEXT, amount REAL, descr TEXT, batch TEXT, created_at
-- UNIQUE INDEX uq_bank_lines(bank_account, cdate, amount, descr)
```
يُستورد من كشف بنك xlsx/csv (`read_bank_file` 360-386 → `_extract_bank_lines` 331-357: كشف الأعمدة `BANK_*_KEYS` 20-26، الإيداعات فقط credit أو amount بدون مدين) ثم `save_bank_lines` (389-401: INSERT OR IGNORE ⇒ الاستيراد idempotent ويبقى بين الجلسات). الاستيراد من UI في clearing_page.py:483-504.

**gateway_fee_vouchers** (818-824): `op_id PK, voucher_id, transfer_id, fee` — منع ازدواج سند العمولة.

**match_aliases** (gateway_service.py:431-441): `id, file_phone, file_name, customer_id` + UNIQUE(file_phone, file_name) — روابط يدوية «هوية الملف ← عميل النظام» يتعلمها (`save_alias` 444-454 يطبّع بالكويت `canon_phone` + `normalize_name`).

### 4.2 دورة الاستيراد (gateway_page.py:538-590 + gateway_service.py)
```
١) read_settlement_file(path)  — xlsx عبر openpyxl أو CSV (utf-8-sig ثم cp1256)
٢) _extract_rows (295-364):
   - detect_columns على أول 5 صفوف (193-239):
     phone/amount إلزاميان (وإلا رفض "تعذر إيجاد عمودي الهاتف والمبلغ")
     + status (باستثناء أعمدة sms) + customer + descr + token + updated + created
     + التاريخ: مرشحون (updated/created/DATE_KEYS) بترجيح "transaction date/payment/الدفع/العملية"
     + ref: مرشحون بترجيح "invoice number"
   - لكل صف: paid_state_of(status) (160-174): 1 محوّل | 0 معلّق | 2 ملغى | -1 فاشل
     · الفاشل (-1) يُستبعد (skipped_unpaid) · الملغى يبقى ليُعلَّم
     · التاريخ: updated للمحول، created للمعلق، وإلا العمود الأساسي ثم date_fallback
     · gw_paid_date = تاريخ العملية الأساسي للمحول
   - parse_date مرن (248-277: ISO/dmy/26-Sep-2026/20260926) · parse_amount (280-284)
٣) refresh_gw_paid (settlement 235-272): تحديث حالة التحصيل للصفوف المثبتة
   بمطابقة ref+amount (التاريخ يتغير عند التحصيل) — يستثني المسدد للشركة الأخرى
٤) _auto (gateway_page.py:592-630):
   match_settlement → auto_classify (المطابق الواضح mine والباقي unmasked 741-748)
   → restore_manual (استرجاع اليدوي المحفوظ classified_manual=1، 1442-1456)
   → mark_paid_before (المسددة: paid_transfer_id>0 ⇒ تعليم paid_before وإخفاؤها 1321-1335)
   → mark_seen_before (المثبتة مسبقًا: mine/diff ⇒ "مطابقة مسبقة"، other ⇒ "مسجلة بانتظار السداد" 1559-1578)
   → suggest_row_classes (اقتراح توزيع جاهز 1369-1439)
   → إخفاء المسدد/الملغى/غير المدفوع من الشبكة
٥) save_gateway_ops (189-232) — تثبيت تراكمي:
   · تحديث صف موجود غير مسدد وغير موزَّع وغير يدوي (حالته الجديدة)
   · INSERT OR IGNORE للمكرر (الفهرس الفريد) — الموزَّع والمسدد لا يُمسّان
   · batch = اسم الملف · يرجع عدد الجديد فقط · "لا أثر حسابي هنا"
```

### 4.3 المطابقة الآلية match_settlement (gateway_service.py:569-717)
- مصدر سنداتنا: `receipt_phones()` (396-415) = سندات قبض سارية + هاتف/اسم العميل (من party_id أو من عقد السند) + رقم العقد واسمه ووصفه.
- الهوية: هاتف (`phones_match` 67-76: تساوٍ أو لاحقة ≥7 أرقام بعد تجريد الأصفار) / اسم دقيق (`names_match` بعد توحيد التشكيل وألف/هة/ى 79-93) / اسم جزئي (كلمات الأقصر كلها في الأطول 96-103) / **رابط محفوظ** (`_alias_hit` 475-485).
- الترتيب (635-663): `(تلميح عقد أو وصف أولًا (110-140)، رتبة الهوية 0..3، فرق التاريخ، id)` — النافذة: **5 أيام** للهاتف/الرابط و**3 أيام** للاسم (WINDOW_DAYS/NAME_WINDOW_DAYS 47-48؛ `_within_window` 418-427).
- مطابق تام (مبلغ ±0.001 + نافذة) ⇒ `mine` مع `via` («الهاتف والاسم/الهاتف/رابط محفوظ/الاسم/اسم جزئي» + «عقد + »/«وصف + »).
- وإلا هوية موجودة والمبلغ/التاريخ لا ⇒ `diff` مع سبب مفصل (682-709)؛ وإلا الهوية لعميلنا بلا سند ⇒ `diff` «الهوية لعميلنا لكن لا سند بهذا المبلغ» (710-714)؛ وإلا `other` «لا يوجد عميل بهذه الهوية — للشركة الأخرى».
- ربط يدوي: `link_row_manual` (494-522) يحدّث العملية mine+receipt_no ويحفظ alias؛ `unlink_row_manual` (533-550) يعيدها other ويحذف الرابط.
- اقتراح `suggest_row_classes` (1369-1439): 1) حالة الدخول mine ⇒ شركتنا «مطابق» 2) سوابق الهاتف **من الموزَّع فقط** ⇒ إجماع/تعارض (يبقى غير مصنف + علم conflict) 3) الهاتف في دليل عملائنا ⇒ «عميل معروف» 4) غير ذلك ⇒ «بلا سابقة».
- تصنيف يدوي حر `set_row_class` (1459-1483): دورة unmasked→mine→other بالنقر (CLASS_CYCLE)؛ يرفض الموزَّع/المسدد/غير المثبت — **«القفل يبدأ من لحظة التوزيع لا التصنيف»**.

### 4.4 التوزيع distribute_rows (1499-1528)
```
◆ توزيع: لكل مفتاح (op_date, phone, amount, ref):
  رفض/تخطٍ إذا: غير موجود | distributed=1 | paid_transfer_id>0
              | status ليس mine/other | gw_paid ∈ (0,2) (غير محصلة/ملغاة)
  وإلا: distributed=1, classified_manual=1, distributed_at=now
يرجع {mine, other, skipped} — لا مسار يتجاوز هذه الدالة، ولا قيد محاسبي هنا؛
التأثير الحسابي يظهر لاحقًا في التصفية اليومية ومستحق الأخرى.
↩ إرجاع للتوزيع undistribute_rows (1531-1556): المسدد يُتخطى (فكّه = حذف التسديد).
```

### 4.5 التصفية اليومية daily_clearing (413-537) — القفل الثلاثي S⇄G⇄bank_lines
```
لكل بوابة (profile): fee, tolerance(0.005), lag(T+1), late_days(3)
S (السيستم)  = Σ vouchers.receipt سارية (method LIKE أي كلمة من profile.methods)
               GROUP BY vdate ضمن الفترة
G (البوابة)  = gateway_ops WHERE gateway=? AND distributed=1
               AND (gw_paid IS NULL OR gw_paid=1) GROUP BY op_date,status
               (mine/other بعدّادات · «غير مصنّف» خارج التصفية تمامًا — 460)
expect        = g_total − n*fee          (صافي ما يجب أن يصل البنك)
my_share      = g_mine − n_mine*fee      · other_share كذلك
settle_date   = day + lag أيام عمل
ربط البنك     = أول bank_line ضمن [settle±1 يوم عمل] مع |amount−expect| ≤ tolerance
                (bank_account مطابق إن ضُبط) · الأقرب فوز · كل سطر بنك يُستعمل مرة (used)
gap = g_mine − s
status = |gap| > tol            ⇒ "diff"  (فرق سيستم/بوابة)
      | bank_hit                ⇒ "done"  (✅ مكتمل)
      | settle > today          ⇒ "pending" (⏳ منتظر)
      | today ≤ settle+late_days ⇒ "pending"
      | غير ذلك                 ⇒ "late"  (❌ متأخر)
مخرجات الصف: {gateway, day, sys, g_mine, g_other, gap, expect, settle_date,
              bank_amount, bank_date, bank_descr, my_share, other_share, status}
STATUS_LABEL (540-541): done/pending/diff/late
```
- «نصيبي/نصيب الأخرى» = أساس توزيع الإيداع البنكي الواحد بين الشركتين (قاعدة «حساب بنكي واحد يستقبل الكل»، ترويسة الملف 2-8).
- مكملات: `day_detail` (771-789: عمليات اليوم + سندات السيستم)، `unmatched_bank` (660-674)، `late_settlements` (763-768: آخر 60 يومًا، للتنبيهات)، `distributed_mine_rows` (544-574: صفوفنا الموزعة + حالة يومها البنكية).
- الواجهة: `ClearingPage` (clearing_page.py:320+) أعمدتها (19-21): **اليوم | البوابة | وارد السيستم | وارد البوابة | فرق التحصيل | المتوقع بنكيًا | تاريخ التسوية | الوارد البنكي | نصيبي | نصيب الأخرى | الحالة** + تاب «بنك غير مربوط» + حوار بيانات البوابة (الاسم/الحساب البنكي/طرق الدفع/T+N/عمولة العملية 85-119).
- جدول `schema_flags` (175-176): أعلام ترحيل لمرة واحدة.

### 4.6 payment_methods (database.py:1531-1556)
```sql
id PK, name TEXT UNIQUE, fee_type TEXT DEFAULT 'amount',   -- amount|percent
fee_value REAL DEFAULT 0, is_active INTEGER DEFAULT 1
-- البذور: نقدًا 0 · تحويل بنكي 0.150 (amount) · KNET 1.5 (percent) · شيك 0 · أخرى 0
```
(هذه رسوم سندات القبض `_reconcile_receipt_fees`؛ أما عمولة البوابة لكل عملية فهي `gateway_profiles.fee_fixed`).

---

## 5. تسديدات الشركة الأخرى (Other-Company Transfers)

### 5.1 الجداول الحرفية (settlement_service.py)
**other_company_transfers** (796-812):
```sql
id PK, tdate TEXT, amount REAL, ref TEXT, notes TEXT, created_at,
+ ALTER: method TEXT DEFAULT '', voucher_id INTEGER DEFAULT 0,
         voucher_number TEXT DEFAULT ''
```
**transfer_op_allocs** (845-857): `id PK, transfer_id INTEGER, op_id INTEGER, amount REAL` + فهارس `ix_allocs_op/ix_allocs_tr` — **تخصيصات السداد الجزئي** (عملية ← مجموعة توزيعاتها من عدة تسديدات).
**other_company_opening** (1245-1253): صف وحيد `id=1 CHECK`، `amount, note, updated_at` (لا يقبل سالبًا 1267-1268).
**gateway_fee_vouchers**: (أعلاه 4.1).

### 5.2 آلية add_other_transfer (925-1003)
```python
add_other_transfer(tdate, amount, ref, notes, method, op_ids, create_voucher=False)
# التحقق لكل op_id: موجود · محصَّل (gw_paid∉(0,2) وإلا "لا يمكن تسديد ما لم يدفعه العميل")
#                  · غير مسدد (paid_transfer_id=0 و _op_paid_total < الصافي)
#                  · موزَّع (distributed=1 وإلا "وزّعها أولًا")
# الصافي لكل عملية = amount − gateway_profiles.fee_fixed(gateway)   (V4.49: التوزيع على الصافي)
# إنشاء الصف في other_company_transfers ثم توزيع المبلغ على العمليات بـ min(المتبقي, المتبقي من الصافي)
# اكتمال عملية (الوصول لصافيها ±0.0005) ⇒ gateway_ops.paid_transfer_id = tid
# V4.5.13: الدفع فوق الصافي عادي — الفارق «فروقات عمولة» يظهر في الواجهة ويُحمل على رصيد الأخرى
#          (لا رفض عند التجاوز) — وcreate_voucher أُلغيت تمامًا: "لا يُنشأ سند صرف من هنا أبدًا"
#          التسديد بين الشركتين تسوية حسابية لا إيراد ولا مصروف
```
- `delete_other_transfer` (1048-1102): يُرفض إن كان مرتبطًا بسند صرف **نشط** أو بسند عمولة نشط (الملغى يسمح)؛ يحذف توزيعاته ويعيد حساب `paid_transfer_id` لكل عملية لمسّها (آخر transfer_id لو اكتملت وإلا 0).
- سند عمولة التسوية (مسار قديم فقط voucher_id>0): `_create_settlement_fee_voucher` (877-922) — سند صرف واحد مجمّع تحت **«عمولات بنكية»** (`ensure_bank_commission_account` 2644-2667، parent «مصروفات بنكية») ملاحظته `GATEWAY_FEE_MARK="[عمولة بوابات]"` (815).

### 5.3 دوال المستحق/الرصيد (أساس الشاشة)
- تعريف المستحق الموحد `_DUES_ELIGIBLE` (1659-1660): `status='other' AND distributed=1 AND (gw_paid IS NULL OR gw_paid=1)` — الصافي = الإجمالي − عمولة/عملية.
- `unpaid_other_items` (621-657): بنود ☐ للتسديد — `amount = صافي − مدفوع (جزئي)` و`total=الصافي` و`gross` وبيانات التحصيل.
- `other_statement` (677-705): كشف تراكمي `cumulative` للمستحق اليومي.
- `other_balance` (1040-1045): `{dues = افتتاحي + مستحق تراكمي, paid = Σ تحويلات, remaining}`.
- `other_ledger` (2187-2242): كشف حساب برصيد جارٍ (افتتاحي + سابق، خطوط `due/pay` مرتبة بالتاريخ والنوع).
- `other_daily_settlement` (1944-2014): تجميع بتاريخ العملية `{day, ops[], n, gross, fees, net, paid, remaining, status paid|partial|unpaid}` + totals + التحويلات.
- `other_ops_status` (1819-1892): تقرير العمليات `status: paid | partial | due` بالمتبقي وتاريخ التسديد ومرجعه ورقم سنده.
- `paid_other_items` (1767-1817): تبويب «المسدد» (اكتمال توزيعات أو علم قديم).
- `other_external_report` (708-760): تقرير مطابقة خارجي **قراءة فقط** (gross/fees/net/paid/تحويل/معلق/ملغى/متبقي) بلا تفاصيل داخلية.
- `list_upload_batches` (1605-1631) و`upload_batches_report` (1663-1762) و`batch_detail` (2037-2127): تقارير الرفعات (بوابة+ملف+يوم الرفع) بحالات `none|paid|partial|unpaid` وأسماء العملاء.
- `collection_status/expected_collection_date` (1917-1941): تحصيل البوابة المتوقع — الخميس/الجمعة/السبت ⇒ الأحد التالي، غيرها T+1 (V4.41، محسوب لحظيًا).
- `wipe_all_gateway_data` (2259-2296): مسح شامل بنسخة احتياطية تلقائية؛ يحذف سندات العمولة وقيودها و`transfer_op_allocs`/`other_company_transfers`/`gateway_ops`.

### 5.4 الشاشات
**OtherCompanyPage** (other_company_page.py:278+، تاب داخل PaymentGatewayPage):
- بطاقات: المستحق/المسدد/المتبقي من `other_balance()` + شارة «فروقات عمولة (مدفوع فوق المستحق)» أو «✅ لا فروقات» (467-491).
- مبدّل عرض (`_render` 506-518): **مستحق** (DueItemsPage مضمّن بمربعات ✓ + زر «💸 دفعة على الحساب»/«تسديد المحدد» 525-556) / **مسدد** / **العمليات** (`OPS_REP_HEADS` 30) / **التسوية اليومية** (`DAY_HEADS`/`DAY_OP_HEADS` 40-42 + تفاصيل يوم) / **كشف حساب** (`HEADS` 26-28: ✓ | التاريخ | الحركة | النوع | مستحق لها (+) | مسدد (−) | الرصيد، بنود قابلة للنقر: تسديد يفتح `TransferDetailDialog`، مستحق يفتح تفاصيل اليوم البنكي 963-1002).
- أزرار: تصدير/طباعة + «⚙️ الرصيد الافتتاحي» (OpeningDialog 71-106).
- **TransferDialog** (clearing_page.py:164-300): المستحق/المسدد/المتبقي + شارة الربط بعدد العمليات + `linked_ops_breakdown` (إجمالي/عمولة/صافي 1277-1301) + حقول التاريخ/المبلغ (مضبوط مسبقًا لمجموع المحدد)/الطريقة (من payment_methods)/المرجع/ملاحظات + معاينة «المتبقي بعد الحفظ» + تحذير الفارق = عمولة البوابة (263-289) ⇒ `st.add_other_transfer(..., op_ids=ids)`.

**OtherTransfersPage** (other_transfers_page.py — صفحة مستقلة IDX_TRANSFERS «مجمعات التواريخ»):
- أعمدتها `HEADS` (18-19): **التسديد | تاريخ الإرسال | الطريقة | المبلغ | المربوط | الباقي | العمليات | تواريخ العمليات | الحالة** — الحالة من `list_transfers_summary` (1190-1241): `full 🟢 مربوط كامل | partial 🟡 مربوط جزئي | open 🔵 على الحساب` (بتراكم التوزيعات + legacy `paid_transfer_id` بلا توزيع 1210-1227) + صف إجمالي (160-168).
- الضغط على تسديد يفتح لوحة `transfer_coverage` (1145-1187): عملياته **مجمعة بتاريخ العملية** `[تاريخ العمليات | عدد العمليات | الصافي | المدفوع]` (GROUP_HEADS 20) — التاريخ يُختصر `dd/mm` مدمجًا بفواصل (`dates_short`).
- فلاتر حالة + بحث + فترة + تصدير/طباعة.

### 5.5 دخولها التدفق النقدي (spec-8-b partner_net)
- حركات **جاري الشريك** (`party_type='partner'`) خارج الداخل/الخارج وتدخل **الرصيد فقط**: `partner_net += amount إذا receipt وإلا −amount` (report_service.py:1122-1124؛ يُجمع في الصافي عند 1171، وإجمالي `partner_net` 1181) — و`partner_balance` (lifecycle_service.py:2095-2105) = تمويل − مسحوبات بلا افتتاحي. إنشاء سند شريك/جاري الشريك **للمدير فقط** (add_voucher 2208-2211).
- تسديدات الشركة الأخرى **لا تدخل التدفق النقدي إطلاقًا** (جدول مستقل بلا سندات vouchers) — ظهورها النقدي الوحيد عبر سندات عمولة البوابات `[عمولة بوابات]` التي تُحسب ضمن الخارج مع `bank_fees` (report_service.py:1144-1149).
- استبعادات التقرير النقدي: التحويل الداخلي (1101-1104)، بنود تصفية العهدة (1105-1109)، خصم الراتب (1110-1112)، رد السلفة النقدي (1126-1129)، والرصيد السابق يستبعد عهدة/سلف أيضًا (1080-1092).

---

## 6. الصلاحيات (auth_service.py) لكل وحدة

| الوحدة | مفتاح الشاشة | افتراضي السكرتير | ملاحظات تنفيذ |
|---|---|---|---|
| العُهد (IDX_CUSTODY=13) | **لا مفتاح مستقل** — تاب داخل `screen_payments` + ميزة `custody` (main_window.py:792-796، feature_service.py:223-227) | مفتوح مع سندات الصرف | إخفاء الكلّ يتم بحذف البند من شجرة التنقل |
| سلف الموظفين (IDX_ADVANCES=18) | كذلك `screen_payments` + `custody` (797-799) | نفس البوابة | — |
| تعديل/حذف بنود تصفية | **مدير فقط** + ميزة `settle_edit` (custody_center.py:2126-2131، custody_settlements.py:405-411) | feature للمجموعة المالية | فحص `is_admin()` في القوائم |
| بوابة الدفع (IDX_GATEWAY=14) | **`screen_gateway`** (auth_service.py:250-254) — `secretary: False` | **للمدير فقط افتراضيًا** | + ميزة `payment_gateway` (feature_service.py:218-222) |
| تسديدات الشركة الأخرى (IDX_TRANSFERS=16) | `screen_gateway` أيضًا (main_window.py:630) | للمدير | — |
| سندات القبض/الصرف | `screen_receipts` / `screen_payments` (204-213) | True | تصفية/تسليم العهدة تنتمي لهما |
| إنشاء/إلغاء السندات | `action_add_receipt`/`action_add_payment` (318-327) / `action_cancel_voucher` (343-347) | True/False | الإلغاء افتراضيًا مدير |
| تعديل السندات | `action_edit_voucher` (333-337) + اعتماد المدير عند الحفظ | True | — |
| الفواتير | ميزة `invoices` (feature_service.py:49-53) — لا `screen_invoices` | مفتوحة مع العملاء | الحوار يعمل لمن يفتحه |
| جاري الشريك | مدير فقط بقوة الكود (add_voucher 2208-2211) | — | حارس في الخدمة لا الواجهة |

آلية عامة: `has_permission(key)` (485-501) — المدير/المطور: كل شيء دائمًا؛ السكرتير: تخصيصه المحفوظ في `user_permissions(user_id, perm_key, allowed)` وإلا افتراضيات دوره (`secretary` flag). **قاعدة معلنة: لا مفتاح بلا أثر فعلي في الواجهة** (188-190) — كل مفتاح يخفي زرًا/شاشة/بند قائمة. تخصيص المستخدم يُحفظ دفعة واحدة ويحذفه يعيده لافتراضيات دوره (447-469).

---

## 7. خلاصة pseudo-code للتنفيذ

```
# ============ العهد ============
handover(party, amount, date, custodyAccId):
  voucher(payment, expense_account_id=None, custody_account_id=custodyAccId,
          account=acc.full_path, method, description="تسليم عهدة")
  rule: acc.account_kind == 'advance'

settle(vdate, custodyAccId, lines[], groupDesc):
  rule: lines.length >= 1, acc advance
  ref = "PAY-GRP-" + today("YYYYMMDD") + "-" + seq   # seq = آخر مرجع بنفس اليوم + 1
  for i, l in lines:                                 # فحص الجميع ثم إنشاء الجميع (معاملة)
    voucher(payment, vdate=l.vdate||vdate, method="تصفية عهدة",
            expense_account_id=l.expense_account_id, amount=l.amount,
            party=l.party, expense_customer_id, contract_id,
            description = l.description || `${custName} — ${accName}` || party,
            expense_group_ref=ref, expense_group_line=i,
            custody_account_id, notes += "\nتصفية عهدة من حساب: ${acc.full_path}")

custody_return(date, custodyAccId, amount, method="الصندوق"):
  rule: amount <= balance(custodyAccId) = handed − spent − returned
  voucher(vtype='custody_return', account=البنك/الصندوق, custody_account_id)

cancel_voucher(id, reason):
  if payment && custody_account_id && !is_settlement(v):
     deps = count(active vouchers, same custody_account_id,
                  vtype='custody_return' OR expense_group_ref<>'' OR notes LIKE '%تصفية عهدة من حساب:%'
                  OR notes LIKE '%إغلاق عهدة من حساب:%')
     if deps: reject "لا يمكن إلغاء تسليم العهدة: توجد تصفية أو ردود سارية"
  if payment && advance_employee_id:
     if count(active custody_return|salary_deduction, same employee): reject
  ... المطالبات السارية للعقد ⇒ reject
  soft-cancel + cancel children + reverse journal entries

# ============ السلف ============
advance(date, empId, amount, method):     voucher(payment, advance_employee_id, acc="سلف موظفين / قرض راتب")
cashReturn(date, empId, amount, method):  voucher(custody_return, advance_employee_id, acc=السلف)
                                           rule: amount <= employee_balance(empId)
deduct(date, empId, amount):              voucher(salary_deduction, advance_employee_id, acc="رواتب")  # بلا نقد
employee_balance(empId) = Σpayment − Σ(custody_return+salary_deduction)   (غير الملغاة)
FIFO settling (تقارير): رتّب أحداث (vdate, is_return, id)؛ الرد يطفئ أقدم سلفة ⇒ مصروف السلفة = amount − recovered

# ============ الفواتير ============
invoice.amount <= contract.amount − Σinvoices(contract)      # حارس الإنشاء/التعديل فقط
statement: invoice يظهر "للعلم" بمدين=دائن=0 · remaining = current_value − collected

# ============ البوابة ============
import(file): rows = detectColumns(first 5 rows) → per-row paid_state_of →
              match (هاتف 5d / اسم 3d / alias / تلميح عقد+وصف، ترتيب hint>rank>gap) →
              auto mine/unmarked → restore manual → mark paid/seen → suggest →
              upsert gateway_ops (UNIQUE gateway+date+phone+amount+ref؛ الموزع/المسدد محميان)
distribute(keys): فقط status∈{mine,other} && !distributed && !paid && gw_paid∉{0,2}
                  ⇒ distributed=1, classified_manual=1, distributed_at=now
dailyClearing(d1,d2,gw): S=Σreceipts(method LIKE methods) · G=ops(distributed, تحصيل ≠ معلق/ملغى)
  expect = G − n×fee · settle = T+lag(أيام عمل، عطلة جمعة/سبت)
  bank_hit = أقرب bank_line خلال settle±1 يوم عمل مع |amount−expect|≤tolerance (يُستهلك مرة)
  status = |g_mine−S|>tol ⇒ diff | bank ⇒ done | settle>today ⇒ pending | ≤ settele+late ⇒ pending | late
otherDues(op) = status='other' && distributed && (gw_paid IS NULL || 1) ⇒ net = gross − fee
payOther(amount, ref, method, opIds[]): تحقق (محصلة/غير مسددة/موزعة) →
  alloc rows (min vs الصافي) → اكتمال ⇒ paid_transfer_id · الفارق فوق الصافي = فروقات عمولة
```

## 8. نصائح تنفيذ Next.js/Prisma
1. **نماذج جديدة**: `Employee`، وحقول على `Voucher`: `custodyAccountId?`, `custodyAccountSnapshot`, `advanceEmployeeId?`, `expenseGroupRef?`, `expenseGroupLine?`, `expenseAccountId?/Snapshot`, `expenseCustomerId?`, `cancelled/cancelReason/cancelledAt`, `chequeDueDate`, `allocation`. وحقل `accountKind` على `ExpenseAccount` (قيم `expense|advance`) + أب «العُهد» غير قابل للقيد.
2. **جداول البوابة** (Prisma): `GatewayProfile`, `GatewayOp` (**@@unique([gateway, opDate, phone, amount, ref])** + أعمدة distributed/classifiedManual/paidTransferId/gwPaid/gwPaidDate/gwToken/distributedAt/effectiveDate/batch/createdAt)، `BankLine` (**@@unique([bankAccount, cdate, amount, descr])** — الاستيراد idempotent دائم)، `GatewayFeeVoucher` (opId PK)، `OtherCompanyTransfer`, `TransferOpAlloc` (@@index)، `OtherCompanyOpening` (صف وحيد id=1)، `MatchAlias` (@@unique([filePhone, fileName])), `SchemaFlag`.
3. **كله معاملات API لا UI**: settle/cancel/transfer يجب أن تكون route handlers بمعاملات `prisma.$transaction` مع كل الحرس أعلاه في الخادم (الرقم التسلسلي PAY-GRP يُحسب داخل المعاملة من آخر مرجع بنفس اليوم — منافسة محتملة: أعد المحاولة عند تعارض).
4. **حساب قراءةً**: دوال balances (عهدة/سلفة/أخرى) كاستعلامات تجميعية — لا تخزن أرصدة. احتفظ بالعتبات: `EPS=0.001` (تقارير) و`0.0005` (اكتمال تسديد/سلفة).
5. **الاستيراد xlsx/csv**: `exceljs` للقراءة (أول 5 صفوف للكشف عن الأعمدة بمفاتيح عربية/إنجليزية كما في 4.2)، CSV بترميز `utf-8-sig` ثم `windows-1256`. الخزن النهائي في `GatewayOp/BankLine` مع `batch = اسم الملف` و`createdAt` — «قائمة الرفعات» = GROUP BY (gateway, batch, day(createdAt)).
6. **daily_clearing** دالة خالصة على الخادم (لا تخزين) — أعد بناءها حرفيًا بمنطق الأيام العمل (عطلة الجمعة/السبت)، الاستهلاك الواحد لسطر البنك (greedy best-fit) وحالات done/pending/diff/late.
7. **FIFO السلف** دالة قراءة للاستخدام في التقرير المالي فقط — لا تكتب شيئًا.
8. **الصلاحيات**: خذ نموذج `PERMISSIONS` بحقله `secretary` (افتراضي الدور) + جدول `UserPermission` overrides؛ افحص `screen_gateway` (secretary=false) و`settle_edit` (مدير فقط) في الـ API أيضًا لا الواجهة فقط.
9. **الطباعة**: أعد بناء القوالب الثلاثة (فاتورة/سند/كشف عهدة) — السند يحتاج تفقيطًا (`services/tafqeet.py` `amount_to_words` — انسخ المنطق)، وكشف العهدة يحتاج بنية الموازنة الثلاثية وتوقيعات (المستلم/المحاسب/المدير) وشرطة على الملغى.
10. **انتبه**: بنود تصفية العهدة يجب أن تُستبعد من قائمة سندات الصرف لكن **يظل تسليم العهدة ظاهرًا فيها**؛ وصفحات العُهد/البوابة تعتمد فلترة حساب/بوابة متزامنة بين التابات.
