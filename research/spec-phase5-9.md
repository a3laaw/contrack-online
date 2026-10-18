# مواصفة المرحلة 5–9: العُهد · الفواتير · الإنتاجية · الحوكمة — ConTrack V9.15.18

> وثيقة بحث عميق (Task 2-d). المصدر: `contrack_v9.15.18/app/` (قراءة فقط).
> الهدف: أساس دقيق لبناء نسخة الويب Next.js/Prisma/TypeScript.
> كل قاعدة موثقة بمرجع `file:line`. المسارات النسبية من `app/`.

---

## 0) جداول القاعدة ذات الصلة (DDL مختصر من database/database.py)

| الجدول | المصدر (DDL) | الغرض | أعمدة مفصلية للمراحل 5–9 |
|---|---|---|---|
| `invoices` | database.py:264–274 | فواتير العقد | `invoice_number` UNIQUE، `customer_id`، `contract_id`، `invoice_date`، `description`، `amount>0`، `notes` |
| `users` | database.py:297–303 + أعمدة role/full_name/job_title (database.py:1833–1843) | الحسابات | `username` UNIQUE، `password_hash`، `salt`، `role` (admin/secretary/developer)، `full_name`، `job_title` |
| `user_permissions` | database.py:308–313 | صلاحيات دقيقة | `user_id`، `perm_key`، `allowed`، `UNIQUE(user_id,perm_key)` |
| `form_categories` / `form_templates` / `form_fields` / `form_documents` | database.py:320–392 | محرك النماذج (Word-First) | انظر القسم I |
| `employees` | database.py:397–403 + database.py:1563–1577 | سلف الموظفين (موظف = اسم فريد) | `name` UNIQUE، `phone`، `notes`، `active` |
| `visit_staff` | database.py:405–411 | أعمدة جدول الزيارات | `name`، `phone`، `active`، `sort` |
| `visits` | database.py:465–476 | الزيارات | `visit_date`، `hour_slot`، `staff_id`، `customer_id`، `note`، `task_id`، `created_by`، `UNIQUE(visit_date,hour_slot,staff_id)` |
| `expense_accounts` | database.py:672–684 | شجرة مصروفات + **العُهد** | `parent_id`، `name`، `full_path`، `allow_posting`، `include_in_profitability`، **`account_kind`** ('expense'/'advance')، `sort_order` |
| `vouchers` | database.py:686–717 | السندات (وتحمل العهد والسلف) | `voucher_number` UNIQUE، `vtype IN ('payment','receipt','transfer','custody_return','salary_deduction')`، `party/party_type/party_id`، `method`، `account`، `expense_account_id(+snapshot)`، `expense_group_ref/line`، **`custody_account_id(+snapshot)`**، **`advance_employee_id`**، `advance_amount`، `contract_id`، `expense_customer_id`، `cancelled/cancel_reason/cancelled_at`، `parent_voucher_id`، `cheque_due_date`، `allocation`، `receipt_group_ref/line` |
| `voucher_payment_links` | database.py:822–832 | ربط السند بخط دفعة | `voucher_id`، `kind('receipt','payment')`، `line_id`، `amount`، `UNIQUE(voucher_id,line_id)` |
| `tasks` | database.py:1819–1831 + أعمدة database.py:1845–1852 | المهام | `title`، `details`، `due_at`، `remind_minutes`، `source`، `status`، `notified_before/after`، `done_at`، `task_type('تذكير'/'موعد')`، `customer_id`، `contract_id` |
| `contract_attachments` | database.py:1718–1726 | مرفقات العقود | `contract_id`، `file_name`، `stored_path`، `added_at` |
| `customers` (أعمدة أرشيف) | database.py:1728–1737 | مجلد شبكة العميل | `folder_path`، `folder_seen` |
| `customer_comments` | services/comment_service.py:33–76 (الجدول لا يُبنى في database.py) | التعليقات | انظر القسم F |
| `feature_flags` | services/feature_service.py:281–287 | مفاتيح المزايا | `key` PK، `enabled` |
| `number_sequences` | database.py:1974–1976 | عدّادات الترقيم | `name` PK (`table.column.prefix`)، `last_no` |
| `audit_log` | database.py:2160–2176 | سجل تدقيق عام | `timestamp`، `username`، `action`، `entity_type/id/name`، `old_status/new_status`، `reason`، `ip_address` |
| `purge_audit` | services/purge_service.py:37–51 | لقطة الحذف (تنظيف المطور) | `purged_at/by`، `entity/id`، `label`، `reason`، `snapshot`(JSON) |
| `notifications` | database.py:561–572 | إشعارات المتابعة | `user_id`، `transaction_type/id`، `type`، `text`، `is_read` |
| `payment_methods` | database.py:1531–1538 | طرق الدفع ورسومها | `name` UNIQUE، `fee_type('amount'/'percent')`، `fee_value`، `is_active` |
| `settings` | database.py:276–295 (+أعمدة نسخ كامل full_backup_* تُضمن runtime) | إعدادات عامة + نسخ تلقائي | `auto_backup_enabled/interval/folder`، `last_backup_at`، `invoice_primary/accent`، `ui_prefs`، `max_users`، `license_key`، `stamp_size_mm`… |

فهارس موثوقة: `idx_vouchers_custody ON vouchers(custody_account_id, expense_group_ref)` (database.py:1956)، `idx_comments_customer_live/idx_comments_contract_live` (database.py:1960–1961)، `idx_tasks_customer_contract/idx_tasks_status_due` (database.py:1962–1963).

---

## A) العُهد (Custody)

### A.1 النموذج المفاهيمي — لا يوجد جدول "custody" مستقل
- **العهدة = حساب في شجرة `expense_accounts` بـ `account_kind='advance'`**، تحت الأب «العُهد» (عُهدة افتراضية «عهدة عامة») — services/expense_account_service.py:18–19، 81–96. أي حساب قديم اسمه/مساره يحوي «عهد» يُعاد تصنيفه advance (expense_account_service.py:49–52، 94–96).
- حساب العهدة لا يُعد مصروفًا: `posting_items()` يستبعده (expense_account_service.py:208–218)، و`custody_items()` يرجعه (221–227)، و`include_in_profitability=0`.
- **العهدة نقدية فقط** (لا عينية): كل الحركات عبارة سندات نقدية على الحساب؛ لا مفهوم كميات/أصناف في الكود كله.
- **لا تُطلب طريقة دفع في التصفية** لأنها ليست خروجًا نقديًا جديدًا — ui/custody_center.py:2–9 (ملاحظة المعمار) وservices/lifecycle_service.py:3047–3051.

### A.2 دورة الحياة (الحركات الثلاث)
1. **تسليم (Handover)**: سند `vtype='payment'` بـ `custody_account_id` مملوء و**`expense_group_ref` فارغ** — يخرج نقدًا من الخزينة ويبقى ظاهرًا في شاشة سندات الصرف (ui/custody_center.py:7–8). الافضلية `account=جاري الشريك` تتطلب admin (lifecycle_service.py:2208–2211).
   - قيد: مدين «سلف موظفين»-مثل العهدة، دائن الصندوق (اختبار tests/test_v452_bank_fees_custody_return.py:157–161: "التسليم: ذمة 1000").
2. **تصفية (Settlement)**: من شاشة العُهد فقط — `add_custody_settlement` (lifecycle_service.py:3044–3058) تستدعي `add_grouped_payments(..., custody_account_id=…)` (lifecycle_service.py:2979–3041):
   - تنشئ **سند صرف مستقل لكل بند** (`vtype='payment'`) تحت **مرجع مجموعة واحد** `expense_group_ref = 'PAY-GRP-YYYYMMDD-NNN'` (lifecycle_service.py:2962–2975) و`expense_group_line = i`.
   - كل بند: تاريخ فاتورة مستقل + **حساب مصروف فعلي** (إلزامي) + مورد/جهة نصي + عميل تحليلي (`expense_customer_id`) + عقد (`contract_id`) + مبلغ + بيان (فارغ ⇒ تلقائي «العميل — المصروف» ui/custody_center.py:59–64، 582–587).
   - ملاحظة السند تُوسم `تصفية عهدة من حساب: <اسم الحساب>` (lifecycle_service.py:3026–3027) وتُحفظ لقطة `custody_account_snapshot` عبر `add_voucher`.
   - لا يُمنع تجاوز الرصيد: «الرصيد بعد التصفية» السالب يظهر **أحمر تحذيريًا فقط** (ui/custody_center.py:562–574؛ test_v313_custody_entry.py:155–159 "تجاوز الرصيد أحمر (عرض فقط)")؛ الحفظ يقبل.
   - **تعديل تصفية قائمة (للمدير فقط)**: `SettlementEditDialog` (ui/custody_center.py:605–772) يحدّث بنودًا بـ `update_voucher` و**الحذف = إلغاء موثق** بـ `cancel_voucher(..., "حذف بند أثناء تعديل التصفية")` (ui/custody_center.py:762–768). الزر مخفي لغير المدير (ui/custody_settlements.py:238–247) وميزته `settle_edit` مقيّدة بـ `custody` (feature_service.py:261–265).
3. **إرجاع متبقٍ للخزينة (custody_return)**: `add_custody_return` (lifecycle_service.py:3061–3080) — سند `vtype='custody_return'` **ترقيم CV**، بلا سند قبض وبلا أثر إيرادي؛ قيد: مدين الصندوق/البنك دائن العهدة (test_v452:172–176). **المبلغ يُرفض إن تجاوز متبقي الحساب** (lifecycle_service.py:3067؛ اختبار test_v452:180–185 "تجاوز المتبقي مرفوض"). الحوار يقيّد المبلغ بالرصيد (ui/custody_center.py:1772–1782). لا يدخل تقرير المصروفات (test_v452:186–193).

### A.3 الأرصدة والتقارير
- `custody_balances` (lifecycle_service.py:3425–3480): لكل حساب `handed` (تسليم بلا مجموعة) + `spent` (تصفية بمجموعة) + `returned` ⇒ **balance = handed − spent − returned** (3471–3479).
- `custody_open_items` (3483–3525): العهد المعلقة = رصيد موجب > 0.005 مع أقدم تسليم وعدد الأيام (مرتبة تنازليًا بالأيام).
- `custody_ledger` (3544–3678): كشف موحد بثلاثة أنواع صفوف `handover/return/settlement` برصيد تراكمي، وتفاصيل التصفية تُحمّل مرة واحدة ثم توزَّع (3612–3623).
- `custody_detailed_report` (3681–3743) و`custody_monthly_summary` (3746–3799: رصيد أول/تسليم/صرف/مرتجع/رصيد آخر شهريًا لكل حساب) و`custody_handover_list` (3802–3827) و`custody_overview` (3830+).
- `list_custody_groups` (3325–3365) يجمع التصفيات من `expense_group_ref` مع fallback على ملاحظة «تصفية عهدة من حساب:» للقواعد القديمة (3316–3322).
- `custody_settlement(ref)` (3368–3422): كشف تصفية واحدة: المُسلَّم حتى تاريخ التصفية من سندات بلا مجموعة، المُنفَق من البنود السارية، **balance = handed − spent** (موجب متبقٍ لدى الموظف، سالب صُرف أكثر).

### A.4 الترقيم
- سندات: `PV-####` صرف، `RV` قبض، `TV` تحويل، **`CV` إرجاع عهدة**، **`SD` خصم راتب** — lifecycle_service.py:112–120 عبر عدّاد `number_sequences` ذري RETURNING (38–65).
- مرجع التصفية: `PAY-GRP-YYYYMMDD-NNN` يومي (lifecycle_service.py:2962–2975).
- الفواتير `INV-####`، المشاريع `PRJ`، العروض `QUO`، الباطن `SUB` (invoice_service.py:30–44؛ lifecycle_service.py:95–100).

### A.5 ربط العهدة بالموظف/العقد/المورد
- **العهدة لا ترتبط بموظف** كسجل — صاحبها نص حرة في `party` لسند التسليم (ui/custody_center.py:853 الحوار `تسليم عهدة` في vouchers). الربط بالموظف الفعلي هو نظام **السلف** (B).
- بنود التصفية تُربط بالعميل التحليلي `expense_customer_id` والعقد `contract_id` لكل بند (ui/custody_center.py:430–441؛ validate: العقد يجب أن يخص العميل — `add_voucher` lifecycle_service.py:2273–2274).
- `custody_account_id` + `advance_employee_id` لا يجتمعان في سند واحد (lifecycle_service.py:2201–2202)؛ و`custody_return` يتطلب أحدهما (2203–2205).

### A.6 رسوم بنكية عند إرجاع/قبض
- عمولة القبض تلقائية: `_receipt_bank_fee` (lifecycle_service.py:2714–2727) من `payment_methods` (قيمة ثابتة أو نسبة) أو إعداد `bank_fee_amount=0.150` بطريقة «تحويل بنكي» (2704–2712). سند رسوم ابن `parent_voucher_id` على حساب «مصروفات بنكية/عمولات بنكية» `ensure_bank_commission_account` (2644–2667)، موسوم BANK_FEE_MARK، ويتوزع على العقود النشطة إن لم يُربط بعقد (2730–2790).
- **إرجاع العهدة نفسه بلا رسوم** ولا سند قبض (lifecycle_service.py:3064–3067).

### A.7 المطبوعات (reports/custody_pdf.py + excel)
1. `generate_custody_pdf` — كشف تصفية عهدة واحدة (بيانات العهدة، بنود، موازنة المُسلَّم/المُنفَق/المتبقي) (custody_pdf.py:63–386).
2. `generate_custody_overview_pdf` — التقرير الشامل بصفوف مجمّعة (custody_pdf.py:388–686).
3. `generate_blank_custody_settlement_form` — نموذج تصفية فارغ يُسلَّم للموظف (custody_pdf.py:688–802) + نظير Excel `generate_blank_custody_settlement_excel` (custody_excel.py:5+).
4. `generate_custody_ledger_pdf` — كشف حساب عهدة موحّد (custody_pdf.py:804–930).
5. كشف تسليم عهدة (سند) وقائمة العهد المسلّمة تُطبع عبر `tabular_pdf.generate_table_pdf` (ui/custody_center.py:1529–1574).
- تقارير الواجهة الخمسة داخل `CustodyReportsWidget`: التصفيات المجمّع / أرصدة العهد / كشف موظف / تفصيلي بالحركة / الملخص الشهري (ui/custody_center.py:797–806) + تاب العهد المعلقة (1592+) — مع طباعة/تصدير Excel لكل تاب.
- صفحة العهد الموحدة: تابات «الكشف والحركات / التصفيات / التقارير» مع مزامنة الحساب (ui/custody_center.py:2356–2365).

### A.8 الصلاحيات
- لا مفتاح صلاحية مخصص للعهد؛ التقييد عبر: ميزة `custody` (feature_service.py:223–227) تُخفي الشاشة، تعديل التصفية للمدير فقط (ui/custody_settlements.py:240–243) + ميزة `settle_edit`، و«جاري الشريك» للمدير فقط (lifecycle_service.py:2208–2211).

---

## B) سلف الموظفين (advances_page) — علاقتها بالعهد

- **جدول `employees`**: موظف = اسم فريد + هاتف + ملاحظات + `active` (database.py:1563–1577؛ إضافة/تعديل/تعطيل في lifecycle_service.py:3086–3138). **الحذف ممنوع مع سلف نشطة** (3141–3159).
- **العلاقة بالعهد**: نفس البنية المحاسبية لكن بعمود `vouchers.advance_employee_id` (database.py:1714–1716). سند لا يجمع عهدة وسلفة (lifecycle_service.py:2201–2202). الحسابات تُضمن بالاسم: «سلف موظفين / قرض راتب» و«رواتب» تحت «مصروفات إدارية» (lifecycle_service.py:2670–2702).
- الحركات الثلاث (lifecycle_service.py:3257–3313):
  1. **صرف سلفة** `add_employee_advance` = سند `payment` PV على حساب السلف (مصروف) بربط الموظف؛ قيد مدين سلف دائن صندوق؛ يخفض النقدية (test_v453:72–86).
  2. **رد نقدي** `add_advance_cash_return` = سند `custody_return` **يرتبط بالموظف**؛ يدخل الخزينة ويخفض المصروف بلا إيراد (test_v453:88–105)؛ **مرفوض إن تجاوز المتبقي** (test_v453:105؛ لاحظ UI السلفة بلا سقف: test_v453:173).
  3. **خصم من راتب** `add_salary_deduction` = سند `salary_deduction` **SD** بلا نقدية: مدين رواتب دائن سلف (test_v453:107–127).
- **الأرصدة**: `employee_balances` (3162–3200) = advanced − recovered − deducted لكل موظف؛ `employee_balance` (3203–3213)؛ `employee_ledger` (3216–3254) كشف بحركات advance/recover/deduct برصيد جارٍ.
- **الخصم من التسويات؟** لا يوجد خصم تلقائي من تصفية العهدة — الخصم إجراء مستقل «خصم سلفة من راتب». الواجهة: بطاقات المسلَّم/المسترد+المخصوم/المتبقي، كشف حساب PDF/Excel، واستعادة سلفة ملغاة V8.4 (ui/advances_page.py:180–234، 350–398؛ حوار `_MoveDialog` يقيّد مبلغ الرد/الخصم بالرصيد advances_page.py:110–119).
- سندات السلف القديمة بلا `advance_employee_id` تبقى مصروفًا عاديًا (test_v453:142–153).

---

## C) الفواتير

- **الجدول**: `invoices` (database.py:264–274) — عميل + **عقد إجباريان** (RESTRICT)، مبلغ > 0.
- **الأنواع**: نوع واحد فقط (فاتورة من قيمة العقد). لا ضريبة/خصم على الفاتورة (الخصم/الضريبة موجودان في العروض quotations فقط).
- **الترقيم**: `INV-%04d` — أعلى رقم +1 مع retry 8 مرات عند تعارض UNIQUE (invoice_service.py:30–44، 122–142).
- **القاعدة الحاكمة — منع تجاوز المتبقي**: `contract_financials(contract_id, exclude_invoice_id)` = قيمة العقد − مجموع فواتيره (invoice_service.py:77–93)؛ `_validate` يرفض مبلغًا > remaining + 1e-9 (114–119)، ويشترط أن يخص العقد نفس العميل (107–112). الواجهة تعرض قيمة العقد/الفواتير السابقة/المتبقي بتلوين (ui/invoices.py:144–165).
- **علاقتها بالسندات**: لا علاقة مباشرة — السندات القبض تُخفض المتبقي في كشف الحساب المالي؛ الفاتورة مجرد إصدار مستندي.
- **كشف الحساب**: نعم — `statement_service` يضم الفواتير كسطور في حركة كشف عقد العميل (statement_service.py:24–77) مع `total_invoiced` (114–126).
- **مطبوعات PDF**: `generate_invoice_pdf` (reports/invoice_pdf.py:63–274): ترويسة صورة مخصصة أو مرسومة بألوان `invoice_primary/accent` من الإعدادات، شريط معلومات (رقم/تاريخ/عميل/عقد)، جدول بيان + إجمالي، **ملخص العقد** (قيمة/إجمالي فواتير/متبقي أخضر-أحمر)، ملاحظات، توقيعان، ختم (صورة أو دائرة «مكان الختم» بحجم `stamp_size_mm`)، تذييل.
- **الطباعة الدفعية**: `batch_export` يدعم invoice/voucher/statement في مجلد واحد (services/batch_print_service.py:7–43) وتُستدعى من ملف العميل (ui/archive.py:1875–1913؛ الفواتير تُخفى عند تعطيل ميزة `invoices` — archive.py:1894–1899).
- **الوصول في الواجهة**: صف الفواتير يظهر في ملف العميل (نظرة عامة/الطباعة الدفعية)؛ `InvoiceDialog` نفسه (ui/invoices.py:32–194) لم يعد يُفتح من صفحة مستقلة — أي في الويب نُبقيها شاشة/قسم ملف عميل.

---

## D) المهام

- **الجدول**: `tasks` (database.py:1819–1852). **لا أولوية وحالة بسيطة**: `status ∈ {مفتوحة, منجزة}` (task_service.py:15–16)؛ **النوع**: `task_type ∈ {تذكير, موعد}` (task_service.py:64–65).
- **الموعد**: `due_at` بصيغة `YYYY-MM-DD HH:MM` (16–17، 53–56)؛ تذكير `remind_minutes` (افتراضي 30).
- **الربط**: `customer_id` + `contract_id` اختياريان مع فلترة متسقة (العقد يخص العميل — `_validate_links` 33–42). **لا ربط بمستخدم/مسؤول**.
- **المصدر**: `source` نص («يدوية» افتراضيًا، «جدول الزيارات» عند ترحيل زيارة — visits_service.py:212–229).
- **التذكيرات**: `due_notifications` (216–247) — تنبيه **قبل الموعد مرة واحدة** (`notified_before` عند 0 ≤ دقائق حتى الموعد ≤ remind_minutes) وتنبيه **بعد الموعد مرة واحدة** (`notified_after`)؛ الإعادة عند تعديل المهمة تصفّر الأعلام (127–130).
- **الإتمام/الإعادة/الحذف**: complete/reopen/delete (133–149)؛ reopen يصفّر أعلام التنبيه.
- **أرشفة تلقائية**: عند وجود عميل، سجل المهمة يُكتب ملفًا نصيًا في مجلد أرشيف العميل `مهمة_<تاريخ>_<عنوان>.txt` (67–107).
- **واتساب**: قوالب `{العميل} {المهمة} {العقد} {التاريخ} {الوقت} {ملاحظات} {الشركة} {النوع}` — قالب موعد `wa_appt` / تذكير `wa_reminder` / القديمة task_wa_customer/manager (275–386)؛ هاتف الطرف يُستنتج من العميل أو صاحب العقد (389–429).
- **الميزة**: مفتاح `tasks` (feature_service.py:39–43). العد المفتوح `open_tasks_count` (209–213).

---

## E) الزيارات

- **النموذج**: جدول يومي — صفوف ساعات × أعمدة موظفين (`visit_staff`). ساعات العمل من الإعدادات `visits_start_hour/visits_end_hour/visits_slot_minutes`، الحصة من {15,20,30,60,90,120} (visits_service.py:16–17، 23–63).
- **الحجز**: `set_visit` (157–187) — الخانة الواحدة عميل واحد (`UNIQUE(visit_date,hour_slot,staff_id)`)؛ نفس العميل في ساعتين لنفس الموظف يومًا ما «تنبيه لا منع» (170–173)؛ تفريغ الخانة = حذف صف.
- **الربط**: عميل + موظف + ملاحظة؛ **لا ربط بعقد**.
- **الحالات**: لا حالات — الخانة محجوزة أو فارغة (سجل يحذف عند التفريغ).
- **الترحيل كمهمة**: `visit_to_task` (212–229) يخلق مهمة نوع «موعد» بمصدر «جدول الزيارات» وتُعلَّم الزيارة بـ `task_id` (203–206)؛ الترحيل المكرر مرفوض.
- **تذكير واتساب** للمهندس (بStaff phone) أو العميل بنص جاهز (232–268) مع رسالة غياب الهاتف.
- **تصدير PDF** لجدول اليوم landscape (274–338).
- **الحذف**: الموظف المستخدم يُعطَّل لا يُحذف (118–128). الميزة `visits` (feature_service.py:113–119) + صلاحية `screen_visits` (auth_service.py:214–219).

---

## F) التعليقات ومركزها

- **جدول `customer_comments`** (comment_service.py:33–76): `customer_id` إجباري، `contract_id` اختياري (SET NULL)، `body ≤ 2000` (19، 100–107)، `created_by` (اسم دخول للتدقيق) + `author` (اسم عرض)، `pinned`، `edited_at/editor`، وأعمدة المركز: `kind/priority/status/tags/followup_date/is_deleted/deleted_at/delete_reason/source` (57–67).
- **على أي كيانات**: العميل (+ عقد اختياري). لا تعليقات على سندات/فواتير.
- **القراءة/الصلاحيات**:
  - الحذف: لصاحبه أو مدير — soft delete فقط `is_deleted=1` + `status='ملغى'` (185–188، 238–248).
  - التعديل: **للمدير فقط وبلا مهلة** مع تسجيل `editor` (209–235؛ EDIT_WINDOW_MIN=10 بقيت كأثر تاريخي 79).
  - التثبيت: للمدير فقط (190–192، 251–262). الترتيب: مثبّت ثم الأحدث (154).
  - تعليقات مثبتة قديمة ≥14 يومًا بلا متابعة تنبيه رئيسية (313–331).
- **مركز التعليقات** (comment_center_service.py): نفس الجدول؛ أنواع {عام, مالية, بلدية, قانونية, تنفيذ, مستندات, اتصال} (16)، أولويات {عادي, مهم, عاجل} (15)، حالات {مفتوح, تم, مؤجل, ملغى} (14)؛ فلترة بحث/حالة/نوع/أولوية/وسم/مستحق اليوم (`due_only` 113–114)؛ ترتيب: مثبّت ← عاجل ← مهم ← الأحدث (121)؛ `update_meta` (127–152)؛ `soft_delete` مع سبب (155–164)؛ ملخص total/open/urgent/due (167–184). UI: ui/comments_center.py (حوار إضافة مع اختيار عقد، أزرار حالة/حذف).
- **الإشعارات**: تعليقات المركز **لا تولّد إشعارات**. الإشعارات نظام المتابعة فقط: `_push` → `notifications` (workflow_service.py:1334–1343) لـ«المشاركين + كل المديرين/المطور» (1321–1331)، والمشاركة تلقائية بأي تفاعل `auto_add_participant` (1300–1309)، والرؤية عبر `can_user_view` (1276–1297). «القراءة» عبر `is_read` وunread_count (2607+).
- **نظام visibility للمتابعة**: `transaction_visibility` (database.py:574–580).

---

## G) الأرشيف والمرفقات والمجلدات

1. **أرشيف العميل (ملفات القرص)** — services/archive_service.py:
   - مجلد لكل عميل: `data/archive/<customer_code>_<اسم-منظف>` (28–33؛ التطيع يتبع DATA_DIR الحالي محليًا أو شبكيًا 15–19).
   - `list_files` بالأحدث مع حجم/نوع، و`limit` حماية للشاشة (36–64).
   - `save_to_archive` ينسخ الملف (كتابة فوق عند overwrite وإلا لاحقة `_HHMMSS`) (67–84)؛ الحذف مقيّد بمجلد الأرشيف (91–96). أنواع الملفات: أي شيء (لا قيود امتداد هنا).
   - ما يُحفظ تلقائيًا: الفواتير، الكشوف، سجلات المهام النصية (task_service.py:77–107).
2. **مرفقات العقود** — `contract_attachments` (DDL database.py:1718–1726) + extras_service.py:157–213:
   - **التخزين**: ملفات منسوخة إلى `data/attachments/C<contract_id>_<stamp>_<name>` (160، 172–179).
   - **الامتدادات المسموحة**: pdf/jpg/jpeg/png/webp/bmp/doc/docx/xls/xlsx فقط (161–162).
   - إضافة/حذف يسجلان حدث عقد «إضافة مرفق/حذف مرفق» (186–187، 212–213). الحذف يمسح الملف (198–211).
3. **مجلد العميل على الشبكة** — services/folder_service.py:
   - `customers.folder_path` مسار UNC/محلي + `folder_seen` (أحدث mtime وقت آخر اطلاع) (database.py:1728–1734).
   - رصد التحديث: مسح حتى 5000 ملف، تجاهل `$`/`~$`/المخفي (53–89)؛ تنبيه إن `latest > seen + 1s` (120)؛ `mark_folder_seen` عند الفتح (128–142)؛ `folders_with_updates` لتنبيهات الرئيسية (145–164)؛ تطبيع مسارات UNC (167–190) وفتح آمن عبر Explorer (193–265). كاش 20 ثانية لكل عميل (20–21، 92–105).
4. **الربط بالكيانات**: أرشيف العميل ← عميل (بالمجلد)؛ المرفقات ← عقد؛ مجلد الشبكة ← عميل. البحث الشامل (services/search_service.py:19–130) يغطي: عميل/عقد/مشروع/مقاول/سند قبض-صرف/فاتورة، والنتيجة تفتح عبر `result_chosen` في ui/global_search.py:17–111 (debounce 220ms، ≥ حرفين).

---

## H) الحوكمة

### H.1 الأدوار وكلمات المطور
- ثلاثة أدوار: `developer` (أدوات تركيب وتخصيص، لا يُسلَّم للعميل)، `admin` (كل التشغيلي)، `secretary` (العمل اليومي) — auth_service.py:123–130. المدير لا يستطيع إنشاء مطور (`ASSIGNABLE_ROLES`).
- `is_admin()` يشمل المطور (166–168). المدير والمطور «كل الصلاحيات دائمًا ولا يمكن تقييدهما» (182–183، 389–394، 492–493).
- **كلمات المرور**: PBKDF2-SHA256 بـ 200,000 تكرار + Salt عشوائي 16 بايت (13، 20–23)؛ افتراضي أول تشغيل admin/admin (16–17، 26–41) مع تنبيه `is_default_password`. تغيير بيانات: اسم ≥3، كلمة ≥4 (68–106). تسجيل الدخول غير حساس للحالة COLLATE NOCASE (52–54).
- **حساب المطور**: كلمة عشوائية `secrets.token_urlsafe(9)` أو متغير البيئة `CONTRACK_DEV_PASSWORD` — لا كلمة داخل الكود (قاعدة 52) (632–683)؛ تُكتب مرة واحدة في `data/كلمة_مرور_المطور.txt` ويجب حذفها قبل التسليم (`dev_password_file_exists` 718–721). `reset_developer_password` يُستدعى **تلقائيًا بعد استعادة أي Backup** (database.py:2323–2331؛ auth_service.py:688–715).
- **حد المستخدمين**: `settings.max_users` يضبطه المطور (0=بلا حد) ولا يشمل حساب المطور (535–549، 603–626).
- إدارة مستخدمين: منع حذف آخر مدير ومنع حذف المطور لغير المطور (581–597)؛ إخفاء المطور عن قائمة غيره (519–532).

### H.2 مصفوفة الصلاحيات الكاملة (PERMISSIONS — auth_service.py:192–383) — 37 مفتاحًا حرفيًا (12 شاشة + 12 تقرير + 13 إجراء)

قيم العمود «سكرتير افتراضيًا» = `secretary:` في الكود. التخزين: `user_permissions(user_id, perm_key, allowed)` يُحفظ دفعة واحدة (set_user_perms 447–459)، والحذف يعيد افتراضيات الدور (reset_user_perms 462–469). المفاتيح غير المعروفة لا تقيّد شيئًا (490–501).

#### مجموعة «الشاشات» (screen_*)
| المفتاح | الاسم/المعنى | سكرتير؟ | نقطة التنفيذ في الواجهة |
|---|---|---|---|
| `screen_customers` | شاشة العملاء والعقود + ملفاتهم ومركز العقد | ✅ | main_window.py:810، 815 (زرّا العملاء وملف العميل) |
| `screen_subcontractors` | شاشة مقاولي الباطن | ✅ | main_window.py:817 (مع ميزة subcontractors) |
| `screen_receipts` | سندات القبض (عرض/طباعة) | ✅ | main_window.py:782 |
| `screen_payments` | سندات الصرف | ✅ | main_window.py:785، 793 (العُهد تتطلبها)، 1965 |
| `screen_visits` | جدول الزيارات اليومي | ✅ | main_window.py:825 (مع ميزة visits) |
| `screen_statement` | كشف حساب العقد | ✅ | main_window.py:789؛ زر الطباعة أيضًا `action_print_statement` (statement.py:102) |
| `screen_reports` | شاشة التقارير كاملة (كل تقرير له تأشيرة مستقلة أدناه) | ✅ | main_window.py:813؟ (الشاشة) — التقارير الفردية بمفاتيح rep_* |
| `screen_followup` | لوحة المتابعة والمراحل | ✅ | مفهرسة كشاشة في main_window (تاب المتابعة) |
| `screen_forms` | مركز النماذج | ✅ | main_window.py:813 |
| `screen_settings` | إعدادات محدودة (طباعة/عرض/كلمة مروره) — الباقي للمدير | ✅ | main_window.py:827؛ settings.py:508–532 (تابات الأمان/النسخ للمدير، أدوات المطور للمطور) |
| `screen_claims` | المطالبات المالية | ✅ | main_window.py:804؛ test_v447_claims.py:178 |
| `screen_gateway` | بوابة الدفع والمطابقة (للمدير افتراضيًا) | ❌ | main_window.py:347، 801؛ test_v327_gateway_closed.py:43–46 |

#### مجموعة «التقارير» (rep_*) — تأشيرة مستقلة لكل تقرير
| المفتاح | الاسم | سكرتير؟ |
|---|---|---|
| `rep_customers` | تقرير العملاء والأرصدة | ❌ |
| `rep_supervision_delay` | تقرير تأخير الإشراف | ✅ |
| `rep_subcontractors` | تقرير مقاولي الباطن | ✅ |
| `rep_dues_board` | لوحة مستحقات الباطن | ✅ |
| `rep_customer_profitability` | ربحية العميل | ❌ |
| `rep_expenses` | تقرير المصروفات | ❌ |
| `rep_vouchers` | تقرير حركة السندات | ❌ |
| `rep_journal` | دفتر اليومية (قيود مدين/دائن مع العكسية) | ❌ |
| `rep_contracts` | تقرير العقود | ✅ |
| `rep_cashflow` | التقرير المالي (كشف نقدي وأرصدة) | ❌ |
| `rep_leads` | الفرص البيعية (عملاء بلا عقود) | ✅ |
| `rep_execution` | مراحل التنفيذ (متأخرة/قاربة/مفقودة) | ✅ |

#### مجموعة «الإجراءات» (action_*)
| المفتاح | الاسم | سكرتير؟ | نقطة التنفيذ |
|---|---|---|---|
| `action_add_receipt` | إنشاء سندات قبض | ✅ | أزرار «سند قبض جديد» (الشاشة/مركز العقد/الرئيسية) |
| `action_add_payment` | إنشاء سندات صرف | ✅ | أزرار «سند صرف جديد» |
| `action_add_subcontractor` | إضافة مقاول باطن | ❌ | main_window.py:242، 1573، 1599؛ subcontractors.py:1353، 1629، 3868 |
| `action_edit_voucher` | تعديل السند كامل (الحفظ يتطلب اعتماد مدير) | ✅ | vouchers.py:2581، 2731 |
| `action_edit_voucher_description` | تعديل بيان السند فقط (احتياطي؛ يُعطَّل تلقائيًا إذا فُعّل تعديل السند كاملًا — settings.py:389–407) | ❌ | vouchers.py:2582، 2732 |
| `action_cancel_voucher` | إلغاء السندات (بلا طلب كلمة مدير) | ❌ | vouchers.py:2583، 2733 |
| `action_print_statement` | طباعة كشف الحساب PDF | ✅ | statement.py:102 |
| `action_view_financial` | رؤية الربحية والتكلفة | ❌ | reports_page.py:1718؛ contract_hub.py:2062 |
| `action_whatsapp` | إرسال واتساب | ✅ | vouchers.py:2728 |
| `action_delete` | حذف العملاء والعقود (بلا طلب كلمة مدير) | ❌ | قوائم الزر الأيمن في customers/contracts |
| `action_supervision_waive` | شطب أشهر تمديد الإشراف | ❌ | test_supervision_waive_delay.py |
| `action_form_design` | تصميم النماذج (إنشاء/تعديل/اعتماد) | ❌ | مركز النماذج |
| `action_change_status` | تغيير حالة العقد (إيقاف/تفعيل/إغلاق/إلغاء) | ❌ | lifecycle_service.change_contract_status مسارات الواجهة |

ملاحظات تشغيلية:
- تعديل السند كاملًا و**الحفظ يتطلب اعتماد المدير** (admin_override بكلمة أي مدير — auth_service.py:504–513؛ ذكر الوصف auth_service.py:333–341).
- رؤية مسار المتابعة للسكرتير مشروطة بملكية الشاشة (workflow_service.py:1276–1297).
- نافذة «صلاحيات الموظف» تظهر فقط عند تفعيل ميزة `user_permissions` (settings.py:2370–2374، 2532–2539).

### H.3 النسخ الاحتياطي
**تلقائي (قاعدة فقط)** — backup_service.py:
- إعدادات في `settings`: `auto_backup_enabled` (افتراضي 1)، `auto_backup_interval` ساعات (1–168، افتراضي 24)، `auto_backup_folder` (افتراضي `data/backups`) (database.py:287–290؛ backup_service.py:39–52).
- فحص كل 10 دقائق؛ اسم الملف `auto_backup_<stamp>.sqlite` عبر sqlite3 backup API (اتصال متسق حتى والبرنامج مفتوح — database.py:2226–2246)؛ **يحتفظ بآخر 30 نسخة** (backup_service.py:15–16، 61–74)؛ نسخة تعويضية عند بدء التشغيل إذا انقضت المدة والبرنامج مغلق (7–8).

**كاملة (ZIP دوّار)** — full_backup_service.py:
- **المحتوى**: `database.sqlite` (نسخة متسقة) + مجلدات: `data/archive` (أرشيف العملاء)، `data/attachments` (مرفقات العقود)، `assets/logo`، `assets/word_templates`، `assets/icon` + ملف `معلومات_النسخة.txt` (50–57، 206–249). **يستثني**: `__pycache__`، مجلد النسخ نفسه، `backups` (194)؛ نسخ تلقائية القاعدة القديمة غير مشمولة.
- **الجدولة**: يوم أسبوعي محدد (افتراضي الخميس) أو بالمدة كل N يوم (1–90) — أول تشغيل مستحق يعطي النسخة؛ تعويض غياب يوم النسخة بعد 7 أيام (272–301). أول نسخة في الشهر تُرقّى نسخة شهرية (نسختها) (329–363).
- **الاحتفاظ**: أسبوعية 4 + شهرية 3 افتراضيًا (32–33، 252–269)؛ تسمية `نسخة_كاملة_اسبوعية_<stamp>.zip` / `نسخة_كاملة_شهرية_…`.
- **الاستعادة**: `inspect_backup` (مطلوب وجود database.sqlite) ثم `restore_backup` = **نسخة أمان تلقائية قبل الاستعادة** + فك ZIP مؤقت + `restore_db` (فحص integrity + الجداول `customers,contracts,invoices,settings` إلزامية database.py:2250–2270) + نسخ المجلدات فوق أماكنها (390–424). بعد الاستعادة تُولَّد كلمة مطور جديدة (database.py:2323–2331).
- **الاستعادة المجدولة**: `schedule_restore_db` تكتب ملف انتظار وتُنفَّذ عند الإقلاع التالي بدل استبدال ملف مفتوح (database.py:2273–2306).
- **صحة النسخ** `backup_health`: ok/warn (متأخرة > حد+1 يوم)/danger (مجلد مفقود أو لا نسخة) (430–479).

### H.4 التنظيف (purge/cleanup) وإدارة البيانات
**purge_service.py — أداة المطور فقط** (`_require_developer` يرفض من الخدمة لا من الواجهة 54–61):
- مبادئ: لقطة JSON كاملة قبل كل حذف في `purge_audit`، معاينة `preview_*` بلا كتابة، حذف صريح بمعرفات وسبب، حذف الأبناء قبل الآباء (2–19).
- النطاقات: سندات (مع قيودها `journal_entries` وفك `parent_voucher_id` للأبناء 238–285)، عقد (`_CONTRACT_CHILDREN` 12 جدولًا: addendums, boq_items, contract_attachments, contract_components, contract_events, contract_group_items, contract_scope, payment_plan قبل contract_stages, sub_contracts, contract_stages, quotations, invoices — 83–96) + المطالبات المرتبطة (134–148)، عميل (`_CUSTOMER_CHILDREN` 99–105)، مقاول باطن (تقارير مالية 552–818)، عقد باطن (856–970)، مطالبات عقد (976–1020).
- **حواجز**: «لا يُحذف حساب المصروف — يُفكّ ارتباطه فقط» (803)؛ `list_entities` أنواع محصورة (157–159)؛ limit ≤1000.
- سجل التدقيق قابل للعرض `audit_log/audit_snapshot` (824–851).

**cleanup_service.py — إدارة البيانات** (UI: ui/data_management.py «بحث + تقرير + حذف + موظفين + سجل»):
- بحث موحد لكل الكيانات + تفاصيل كاملة (customer_details/subcontractor_details 260–480)، حذف سند/مطالبة/عقد/عميل/مقاول **مع لقطة في جدول تدقيق خاص** (`_ensure_audit` 585–598، `_require_dev` 609–617).
- `developer_report` تقرير شامل للمطور (889–988).
- **`full_reset`** (994–1073): حذف كل بيانات التشغيل بالترتيب الآمن (42 جدولًا: من transaction_stage_log حتى number_sequences) — **يستثني**: `settings`، `users`، `user_permissions`، `expense_accounts`، `contract_types`، `workflow_stages`، `payment_methods`، `form_*` … (القائمة تعكس المحذوف فقط)، مع لقطة عددية في السجل.

### H.5 إدارة البيانات في الإعدادات (ui/settings.py)
- تابات: الشركة/الطباعة/العرض/الترخيص/أدوات المطور؛ تاب «النسخ الاحتياطي» و«الأمان والمستخدمون» للمدير فقط (508–532)؛ «أدوات المطور» للمطور فقط: مزايا النظام (checkboxes من feature_service 1040–1075)، حد المستخدمين، الترخيص، **أداة التنظيف** وفتح «إدارة البيانات» (1245–1329)، بطاقة النسخة الكاملة (إن كانت مفعّلة `full_backup`) مع مجلد خارجي/قائمة نسخ/تنظيف/استعادة بمعاينة (1224–1228، 1388–1660). «رصيد أول المدة» للمطور فقط (627–645).

---

## I) القوالب والمطبوعات

### I.1 محرك النماذج العام (Word-First) — form_service.py + جداول form_*
- **الوضع الحالي: Word فقط** — «تم تنظيف مسار PDF بالإحداثيات القديم من الكود الحي» (form_service.py:1–7). القوالب: `data/forms/templates`، المولّدات: `data/forms/docs` (25–37).
- **دورة القالب**: رفع `.docx` ⇒ كشف تلقائي لحقول `{{...}}` من النص الظاهر لا XML الخام (scan_word_placeholders 429–465) ⇒ رسم/ربط الحقول ⇒ اعتماد. حالات القالب: مسودة/معتمد/معطل/مؤرشف (39). الحذف ممنوع إذا وُلّدت منه مستندات (أرشفة بدلًا) (401–427). إصدارات بـ `base_name` + `version` (DDL database.py:326–349).
- **هوية الطباعة** `print_identity`: none (النموذج كامل الهوية بنفسه — نماذج جهات رسمية) / logo / full (ترويسة وفوتر الشركة) (database.py:335–343؛ تطبيق الترويسة وclear footer في form_service.py:870–913، word_service.apply_system_letterhead 489–513).
- **أنواع الحقول** FIELD_TYPES: text/longtext/number/money/date/choice/bool/table/signature/image (40–45)؛ **مصادر** SOURCE_TYPES: manual/system/auto/calc (46–49).
- **خرائط الحقول (DATA_SOURCES)** (163–216): `customers` (name, customer_code, phone, address, address_governorate/area/block/plot, email)، `contracts` (contract_number, contract_name, contract_type, amount, contract_date, duration_days, customer_name, description)، `financial` (current_value(+_words تفقيط), original_value, collected(+_words), remaining(+_words), payments_table, payment_1..3_amount/_words) — التفقيط عبر services/tafqeet (84–91)، `settings` (company_name/phone/address/currency)، `system` (today, weekday عربي, year, user) (147–160).
- **سياق البناء** `build_context` (251–318): قيمة العقد الحالية (بالأوامر التغييرية) + المحصّل (قبض غير ملغى) + المتبقي + صفوف الدفعات من `payment_plan` (نسبة من notes «نسبة X%») أو معاينة قالب نوع العقد.
- **الحسابات في الإدخال** `_apply_input_calculations/_validate_input_calculations` (691–789) وmanual_total (629–663).
- **توليد Word**: fill_word (901–938) يستبدل placeholders في كل الفقرات (826–868)، Word→PDF عبر LibreOffice إن وُجد (940–1023)، المستند المحفوظ `form_documents` بـ values_json + مسارات pdf/word + عميل/عقد (DDL 378–390؛ create_document 1031–1091؛ ترقيم داخلي _next_doc_number 1025–1029).

### I.2 القوالب الرسمية (عقود/عروض) — word_service.py
- مجلد `assets/word_templates` + **خريطة ربط رسمية** في `_official_field_maps.json` بجانب القوالب (مفتاح = اسم الملف) (146–176) — ملف المصدر فارغ `{}` حاليًا (assets/word_templates/_official_field_maps.json:1).
- **official vs free**: النموذج الرسمي = قالب عقد/عرض يُملأ من قيم كيان حقيقي (`contract_field_values`/`quotation_field_values` 340–420، 559–624) مع ربط قابل للتعديل لكل placeholder (official_template_fields 178–202؛ update_official_field_mapping 205–222؛ official_field_values 225–257: manual يعرض القيمة المطابقة إن وُجدت للمراجعة). القوالب الحرة = مركز النماذج العام (I.1) بقيم يدوية/نظام.
- قيم العقود المولّدة تلقائيًا: `دفعة_N_اسم/قيمة/كتابة/نسبة/تاريخ` بالصيغتين (دفعة/الدفعة) + `جدول_الدفعات` + `عدد_الدفعات` (318–337) من payment_plan أو معاينة نوع العقد.
- النواتج: .docx قابل للتعديل + PDF (word_to_pdf 515+ عبر LibreOffice).

### I.3 مركز قوالب Word — word_forms_service.py + ui/word_forms_center.py
- استيراد ملف/مجلد docx مع **تخمين الحقل تلقائيًا** `guess_field` (86–144) ومصلح قوالب تالفة (213–245)؛ تحليل القالب (247–258)؛ مستندات منشأة `create_word_document` (310–324).
- الواجهة تابان: «العقود وعروض الأسعار» (OfficialTemplateFillDialog) و«باقي النماذج» (WordFormFillDialog + FieldMapDialog للمصمم) (ui/word_forms_center.py:855–956).

### I.4 Excel والطباعة المجمعة
- excel_service.py: تصدير العملاء مع مالية كل عميل (31–105).
- batch_print_service.py (كامل مذكور في C): invoice/voucher/statement بدوال PDF الخاصة بكل نوع.
- كشوف العهد/التصفيات Excel مباشر من الواجهة (custody_settlements.py:455–500؛ custody_center.py:2303+).

---

## J) feature_service — مفاتيح المزايا (Feature Flags)

جدول `feature_flags(key, enabled)` (281–287)؛ المطور يضبطها من الإعدادات. القواعد: الأساسيات `CORE = (customers, contracts, vouchers, settings)` بلا مفاتيح ولا تُعطّل (274–275)؛ `FORCED_ON = {followup, rep_execution}` (278)؛ تعطيل الأصل يعطّل التابعين (enabled يحسب سلسلة requires 314–334؛ dependents 344–360)؛ التعطيل يخفي الواجهة ويوقف الأثر ولا يمس البيانات (12–13).

| المفتاح | الاسم | المجموعة | يعتمد على | افتراضي |
|---|---|---|---|---|
| subcontractors | مقاولو الباطن | الشاشات | — | ✅ |
| statement | كشف الحساب | الشاشات | — | ✅ |
| reports | التقارير (الكل) | الشاشات | — | ✅ |
| tasks | المهام والتنبيهات | الشاشات | — | ✅ |
| projects | المشاريع | الشاشات | — | ✅ |
| invoices | الفواتير | الشاشات | — | ✅ |
| addendums | أوامر التغيير والعقود الإضافية | داخل العقد | — | ✅ |
| payment_plan | خطة السداد | داخل العقد | — | ✅ |
| boq_items | بنود العقد | داخل العقد | — | ✅ |
| supervision | الإشراف الهندسي | داخل العقد | — | ✅ |
| comments | تعليقات العميل | داخل العقد | — | ✅ |
| documents | الملفات والطباعة (مرفقات/Word/أرشيف) | داخل العقد | — | ✅ |
| followup | المتابعة ومراحل التنفيذ | أدوات | — | ✅ (مفروض) |
| rep_execution | تقرير مراحل التنفيذ | التقارير | reports | ✅ (مفروض) |
| forms_center | مركز النماذج | الشاشات | — | ✅ |
| word_forms | قوالب Word القابلة للتعديل | الشاشات | forms_center | ✅ |
| visits | جدول الزيارات | الشاشات | — | ✅ |
| user_permissions | صلاحيات الموظفين الدقيقة | أدوات | — | ✅ |
| rep_customers | تقرير العملاء والأرصدة | التقارير | reports | ✅ |
| rep_supervision_delay | تأخير الإشراف | التقارير | reports, supervision | ✅ |
| rep_subcontractors | مقاولو الباطن | التقارير | reports, subcontractors | ✅ |
| rep_dues_board | لوحة مستحقات الباطن | التقارير | reports | ✅ |
| rep_vouchers | حركة السندات | التقارير | reports | ✅ |
| rep_journal | دفتر اليومية | التقارير | reports | ✅ |
| rep_contracts | العقود | التقارير | reports | ✅ |
| rep_cashflow | تقرير مالي تفصيلي | التقارير | reports, cashflow | ✅ |
| rep_leads | الفرص البيعية | التقارير | reports | ✅ |
| cashflow | التقرير المالي (مدير) | المالية | reports | ✅ |
| bank_fee | رسوم التحويل البنكي | المالية | cashflow | ✅ |
| whatsapp | إرسال واتساب | أدوات | — | ✅ |
| full_backup | النسخة الكاملة | أدوات | — | ✅ |
| network_folder | العمل على مجلد شبكة | أدوات | — | ✅ |
| import_old | استيراد البيانات القديمة | أدوات | — | ✅ |
| payment_gateway | بوابة الدفع | الشاشات | — | ✅ |
| custody | العُهد والتصفيات | الشاشات | — | ✅ |
| contract_gaps | عقود بفروقات | داخل العقد | — | ✅ |
| template_plan_mode | وضع القالب في التعديل | داخل العقد | payment_plan | ✅ |
| amount_guard | تنبيه المبلغ باتجاهين | داخل العقد | — | ✅ |
| items_sync | مزامنة الدفعات من البنود | داخل العقد | boq_items, payment_plan | ✅ |
| mode_banner | شارة وضع العقد | داخل العقد | — | ✅ |
| settle_edit | تعديل التصفية (مدير) | المالية | custody | ✅ |
| notif_cleanup | تصفية الإشعارات | أدوات | followup | ✅ |

---

## خدمات مساعدة (للاستئناس في الويب)
- prefs_service: تفضيلات واجهة JSON في `settings.ui_prefs` لكل شاشة (ملف كامل 29 سطرًا).
- qcache: ذاكرة بناء صفحة مؤقتة بنطاق `build_cache()` + `memo` بنسخ عميقة (39 سطرًا) — في الويب يستبدلها كاش طلب Next.
- db_facade_service (11 سطرًا): واجهة رفيعة `backup_db/restore_db/schedule_restore_db/apply_pending_restore/network_mode/set_network_folder` لمنع وصول UI لقاعدة البيانات مباشرة.
- network_single_db_service: قاعدة واحدة مشتركة عبر `network_folder.txt`؛ تفعيل/تعطيل مع فحص صحة ورجوع تلقائي للمحلي عند الفشل (1–80)؛ SQLite على الشبكة يستخدم journal DELETE بدل WAL (database.py:916–948).
- icon_service: توليد أيقونة البرنامج من صورة (PNG/ICO بأحجام 16–256).

---

## اقتراح نماذج Prisma (Next.js)

```prisma
// ===== الفواتير =====
model Invoice {
  id            Int      @id @default(autoincrement())
  invoiceNumber String   @unique @map("invoice_number")      // INV-0001
  customerId    Int      @map("customer_id")
  contractId    Int      @map("contract_id")
  invoiceDate   DateTime @map("invoice_date")
  description   String   @default("")
  amount        Decimal  @db.Decimal(14, 3)
  notes         String   @default("")
  createdAt     DateTime @default(now()) @map("created_at")
  customer      Customer @relation(fields: [customerId], references: [id])
  contract      Contract @relation(fields: [contractId], references: [id])
  @@map("invoices")
}

// ===== شجرة الحسابات (مصروف + عهد) =====
model ExpenseAccount {
  id                    Int      @id @default(autoincrement())
  parentId              Int?     @map("parent_id")
  name                  String
  fullPath              String   @default("") @map("full_path")
  isActive              Boolean  @default(true) @map("is_active")
  allowPosting          Boolean  @default(true) @map("allow_posting")
  includeInProfitability Boolean @default(true) @map("include_in_profitability")
  accountKind           String   @default("expense") @map("account_kind") // expense | advance
  sortOrder             Int      @default(0) @map("sort_order")
  parent                ExpenseAccount? @relation("tree", fields: [parentId], references: [id])
  children              ExpenseAccount[] @relation("tree")
  vouchersAsExpense     Voucher[] @relation("expenseAccount")
  vouchersAsCustody     Voucher[] @relation("custodyAccount")
  @@map("expense_accounts")
}

// ===== السندات (تشمل العهد والسلف) =====
model Voucher {
  id                 Int       @id @default(autoincrement())
  voucherNumber      String    @unique @map("voucher_number")  // PV/RV/TV/CV/SD-#### أو INV لا
  vtype              String    // payment|receipt|transfer|custody_return|salary_deduction
  vdate              DateTime
  party              String    @default("")
  partyType          String    @default("") @map("party_type")  // customer|subcontractor|partner|transfer|""
  partyId            Int?      @map("party_id")
  method             String    @default("")
  account            String    @default("")
  expenseAccountId   Int?      @map("expense_account_id")
  expenseAccountSnapshot String @default("") @map("expense_account_snapshot")
  expenseGroupRef    String    @default("") @map("expense_group_ref")  // PAY-GRP-YYYYMMDD-NNN
  expenseGroupLine   Int?      @map("expense_group_line")
  custodyAccountId   Int?      @map("custody_account_id")
  custodyAccountSnapshot String @default("") @map("custody_account_snapshot")
  advanceEmployeeId  Int?      @map("advance_employee_id")
  amount             Decimal   @db.Decimal(14, 3)
  advanceAmount      Decimal   @default(0) @db.Decimal(14, 3) @map("advance_amount")
  description        String    @default("")
  contractId         Int?      @map("contract_id")
  expenseCustomerId  Int?      @map("expense_customer_id")
  parentVoucherId    Int?      @map("parent_voucher_id")     // سند الرسوم الابن
  cancelled          Boolean   @default(false)
  cancelReason       String    @default("") @map("cancel_reason")
  cancelledAt        DateTime? @map("cancelled_at")
  notes              String    @default("")
  // …project_id, boq_item_id, sub_contract_id, cost_center, allocation,
  //   receipt_group_ref/line, cheque_due_date كما في DDL
  custodyAccount     ExpenseAccount? @relation("custodyAccount", fields: [custodyAccountId], references: [id])
  expenseAccount     ExpenseAccount? @relation("expenseAccount", fields: [expenseAccountId], references: [id])
  employee           Employee?       @relation(fields: [advanceEmployeeId], references: [id])
  @@index([custodyAccountId, expenseGroupRef])
  @@index([vtype, cancelled, vdate])
  @@index([advanceEmployeeId])
  @@map("vouchers")
}

// ===== سلف الموظفين =====
model Employee {
  id       Int       @id @default(autoincrement())
  name     String    @unique
  phone    String    @default("")
  notes    String    @default("")
  active   Boolean   @default(true)
  vouchers Voucher[]
  @@map("employees")
}
// رصيد السلفة = sum(payment) − sum(custody_return) − sum(salary_deduction)
// حيث advanceEmployeeId = الموظف وcancelled = false  (lifecycle_service.py:3203–3213)

// ===== المهام =====
model Task {
  id             Int      @id @default(autoincrement())
  title          String
  details        String   @default("")
  dueAt          DateTime @map("due_at")           // yyyy-MM-dd HH:mm
  remindMinutes  Int      @default(30) @map("remind_minutes")
  source         String   @default("يدوية")
  taskType       String   @default("تذكير") @map("task_type") // تذكير|موعد
  status         String   @default("مفتوحة")        // مفتوحة|منجزة
  notifiedBefore Boolean  @default(false) @map("notified_before")
  notifiedAfter  Boolean  @default(false) @map("notified_after")
  doneAt         DateTime? @map("done_at")
  customerId     Int?     @map("customer_id")
  contractId     Int?     @map("contract_id")
  @@index([status, dueAt])
  @@map("tasks")
}

// ===== الزيارات =====
model VisitStaff { id Int @id @default(autoincrement()); name String; phone String @default(""); active Boolean @default(true); sort Int @default(0); visits Visit[]; @@map("visit_staff") }
model Visit {
  id         Int      @id @default(autoincrement())
  visitDate  DateTime @map("visit_date") @db.Date
  hourSlot   String   @map("hour_slot")   // "08:00"
  staffId    Int      @map("staff_id")
  customerId Int?     @map("customer_id")
  note       String   @default("")
  taskId     Int?     @map("task_id")
  createdBy  String   @default("") @map("created_by")
  staff      VisitStaff @relation(fields: [staffId], references: [id])
  @@unique([visitDate, hourSlot, staffId])
  @@map("visits")
}

// ===== التعليقات =====
model Comment {
  id           Int      @id @default(autoincrement())
  customerId   Int      @map("customer_id")
  contractId   Int?     @map("contract_id")
  body         String   @db.Text                 // ≤2000
  createdBy    String   @default("") @map("created_by") // username للتدقيق
  author       String   @default("")             // الاسم المعروض
  pinned       Boolean  @default(false)
  editedAt     DateTime? @map("edited_at")
  editor       String   @default("")
  kind         String   @default("عام")   // عام|مالية|بلدية|قانونية|تنفيذ|مستندات|اتصال
  priority     String   @default("عادي")  // عادي|مهم|عاجل
  status       String   @default("مفتوح") // مفتوح|تم|مؤجل|ملغى
  tags         String   @default("")
  followupDate String   @default("") @map("followup_date")
  isDeleted    Boolean  @default(false) @map("is_deleted")   // حذف ناعم فقط
  deletedAt    DateTime? @map("deleted_at")
  deleteReason String   @default("") @map("delete_reason")
  source       String   @default("")
  @@index([customerId, isDeleted, pinned, createdAt(sort: Desc)])
  @@map("customer_comments")
}

// ===== مرفقات العقود =====
model ContractAttachment {
  id         Int      @id @default(autoincrement())
  contractId Int      @map("contract_id")
  fileName   String   @map("file_name")
  storedPath String   @map("stored_path")   // data/attachments/C{id}_{stamp}_{name}
  addedAt    DateTime @default(now()) @map("added_at")
  @@map("contract_attachments")
}

// ===== الحوكمة =====
model User {
  id           Int    @id @default(autoincrement())
  username     String @unique
  passwordHash String @map("password_hash")   // PBKDF2-SHA256 200k
  salt         String
  role         String @default("admin")        // admin|secretary|developer
  fullName     String @default("") @map("full_name")
  jobTitle     String @default("") @map("job_title")
  permissions  UserPermission[]
  @@map("users")
}
model UserPermission {
  userId  Int     @map("user_id")
  permKey String  @map("perm_key")   // من كتالوج 37 مفتاحًا
  allowed Boolean @default(true)
  @@id([userId, permKey])
  @@map("user_permissions")
}
model FeatureFlag { key String @id; enabled Boolean @default(true); @@map("feature_flags") }
model NumberSequence { name String @id; lastNo Int @default(0) @map("last_no"); @@map("number_sequences") }
model AuditLog { // + purge_audit بنفس النمط مع snapshot Json
  id Int @id @default(autoincrement()); timestamp DateTime @default(now()); username String @default("")
  action String; entityType String @map("entity_type"); entityId Int @map("entity_id")
  entityName String @default("") @map("entity_name"); oldStatus String @default("") @map("old_status")
  newStatus String @default("") @map("new_status"); reason String @default(""); ipAddress String @default("") @map("ip_address")
  @@map("audit_log")
}
model PurgeAudit {
  id Int @id @default(autoincrement()); purgedAt DateTime @default(now()) @map("purged_at")
  purgedBy String @map("purged_by"); entity String; entityId Int @map("entity_id")
  label String @default(""); reason String @default(""); snapshot Json
  @@map("purge_audit")
}

// ===== النماذج (Word-First) =====
model FormCategory { id Int @id @default(autoincrement()); name String @unique; sort Int @default(0); templates FormTemplate[]; @@map("form_categories") }
model FormTemplate {
  id Int @id @default(autoincrement())
  baseName String @map("base_name"); version Int @default(1)
  description String @default("")
  categoryId Int? @map("category_id")
  status String @default("مسودة")   // مسودة|معتمد|معطل|مؤرشف
  pdfPath String @map("pdf_path")
  pagesCount Int @default(1) @map("pages_count")
  printIdentity String @default("none") @map("print_identity") // none|logo|full
  sourceType String @default("word") @map("source_type")      // pdf|word (الفعلي word)
  wordPath String @default("") @map("word_path")
  createdBy String @default("") @map("created_by"); updatedBy String @default("") @map("updated_by")
  fields FormField[]; documents FormDocument[]
  @@map("form_templates")
}
model FormField {
  id Int @id @default(autoincrement()); templateId Int @map("template_id")
  name String; fieldType String @default("text") @map("field_type")
  page Int @default(1); x Float @default(0); y Float @default(0); w Float @default(120); h Float @default(18)
  sourceType String @default("manual") @map("source_type") // manual|system|auto|calc
  sourceEntity String @default("") @map("source_entity")   // customers|contracts|financial|settings|system
  sourceKey String @default("") @map("source_key")
  context String @default(""); defaultValue String @default("") @map("default_value")
  options String @default(""); required Boolean @default(false); align String @default("right")
  sort Int @default(0); continuesFieldId Int? @map("continues_field_id")
  placeholder String @default("")   // {{...}} لقوالب Word
  @@map("form_fields")
}
model FormDocument {
  id Int @id @default(autoincrement()); templateId Int @map("template_id")
  templateVersion Int @default(1) @map("template_version")
  title String @default(""); valuesJson Json @map("values_json")
  pdfPath String @default("") @map("pdf_path"); wordPath String @default("") @map("word_path")
  customerId Int? @map("customer_id"); contractId Int? @map("contract_id")
  createdBy String @default("") @map("created_by")
  @@map("form_documents")
}
```

ملاحظات نماذج:
- **العهدة** ليست كيانًا: تُشتق من `ExpenseAccount(accountKind='advance')` + تجميع `Voucher` — أي API يجب أن يعيد `balance = handed − spent − returned` (القسم A.3).
- **التصفية** = مجموعة `Voucher` تشترك في `expenseGroupRef` (+`expenseGroupLine`)، وحذف بند منها = `cancelled=true` مع سبب، لا حذف فعلي.
- **الفاتورة**: التحقق «لا تجاوز المتبقي» يجب أن يُنفَّذ في service/API قبل الكتابة (لا يمكن تمثيله بـ FK).
- **سند الطباعة/الإلغاء**: إلغاء `cancelled` + سبب + طابع زمني (الرقم لا يُعاد للاستخدام).

---

## اقتراح مسارات API (App Router / Route Handlers)

```
# العُهد
GET    /api/custody/accounts                      # custody_accounts + أرصدة (A.3)
GET    /api/custody/balances?from&to              # custody_balances
GET    /api/custody/ledger?accountId&from&to&q    # custody_ledger (صفوف handover/return/settlement)
GET    /api/custody/ledger/detailed|monthly|open  # التفصيلي/الشهري/المعلقة
GET    /api/custody/settlements?q&accountId&from&to          # list_custody_groups
GET    /api/custody/settlements/{ref}             # custody_settlement (كشف واحد)
POST   /api/custody/settlements                   # add_custody_settlement {vdate, custodyAccountId, lines[], description}
PATCH  /api/custody/settlements/{ref}             # تعديل بنود (admin فقط) + إلغاء محذوفات
POST   /api/custody/returns                       # add_custody_return {vdate, accountId, amount, method, party} (سقف المتبقي)
GET    /api/custody/handovers?from&to             # custody_handover_list
GET    /api/custody/pdf/{settlementRef|ledger|overview|blank}   # المطبوعات الأربع + نموذج فارغ

# سلف الموظفين
GET    /api/employees?active                      # + balances
POST   /api/employees ; PATCH /api/employees/{id} ; DELETE /api/employees/{id}  # الحذف يرفض مع سلف نشطة
GET    /api/employees/{id}/ledger?from&to         # employee_ledger
POST   /api/advances        {employeeId, amount, method, vdate}      # صرف سلفة (PV)
POST   /api/advances/return {employeeId, amount, method, vdate}      # رد نقدي (CV) — سقف المتبقي
POST   /api/advances/deduction {employeeId, amount, vdate}           # خصم راتب (SD)

# الفواتير
GET    /api/invoices?q&customerId&contractId
POST   /api/invoices                              # ترقيم INV + منع تجاوز المتبقي
GET|PATCH|DELETE /api/invoices/{id}
GET    /api/invoices/{id}/pdf                     # generate_invoice_pdf
GET    /api/contracts/{id}/financials             # contract_financials (قيمة/مفوتر/متبقي)

# المهام
GET|POST /api/tasks?status&customerId&contractId
PATCH  /api/tasks/{id} ; POST /api/tasks/{id}/complete|reopen ; DELETE /api/tasks/{id}
GET    /api/tasks/due-notifications               # محرك التذكير (cron/interval في الويب)

# الزيارات
GET    /api/visits/config ; PUT /api/visits/config          # ساعات العمل والحصة
GET|POST|PATCH /api/visits/staff ; DELETE /api/visits/staff/{id}  # تعطيل إن مستخدم
GET    /api/visits?date                           # day_visits
PUT    /api/visits          {visitDate, hourSlot, staffId, customerId?, note}  # حجز/تحديث/تفريغ
POST   /api/visits/to-task                  {visitDate, hourSlot, staffId}
POST   /api/visits/reminder {…, toEngineer} # رسالة واتساب (نص فقط في الويب + رابط wa.me)
GET    /api/visits/day-pdf?date

# التعليقات
GET    /api/comments?customerId&contractId&q&status&kind&priority&tag&dueOnly&openOnly   # مركز + ملف عميل
POST   /api/comments        {customerId, contractId?, body, kind, priority, tags, followupDate}
PATCH  /api/comments/{id}/meta        {status?, kind?, priority?, tags?, followupDate?}
PATCH  /api/comments/{id}/body        (admin فقط)
DELETE /api/comments/{id}?reason=     (صاحبه أو admin — soft delete)
POST   /api/comments/{id}/pin         (admin فقط)

# الأرشيف والمرفقات
GET    /api/customers/{id}/archive                # list_files (قراءة من وحدة تخزين الويب)
POST   /api/customers/{id}/archive                # save_to_archive
DELETE /api/customers/{id}/archive?path=          # حذف داخل مجلد الأرشيف فقط
GET|POST /api/contracts/{id}/attachments ; DELETE /api/attachments/{id}   # قائمة الامتدادات المسموحة
GET|PUT /api/customers/{id}/network-folder        # folder_path + mark_seen + has_update

# الحوكمة
POST   /api/auth/login | /api/auth/logout | PATCH /api/auth/credentials
GET    /api/users ; POST /api/users ; PATCH /api/users/{id}/password|identity ; DELETE /api/users/{id}
GET    /api/users/{id}/permissions ; PUT /api/users/{id}/permissions ; DELETE /api/users/{id}/permissions
GET    /api/permissions/catalog                   # PERMISSIONS (37 مفتاحًا) للمواجهة
GET|PUT /api/features                             # feature_flags (developer فقط)
GET    /api/backups/auto-config ; POST /api/backups/auto-run
GET|POST /api/backups/full ; POST /api/backups/full/restore  # معاينة + استعادة + نسخة أمان
GET    /api/backup-health
GET    /api/audit?entity&limit ; GET /api/audit/{id}        # purge_audit/audit_log (developer)
POST   /api/purge/preview  {kind, ids}             # developer فقط
POST   /api/purge/execute  {kind, ids, reason}
POST   /api/data-mgmt/full-reset {reason}          # developer فقط — كشف صريح عالي الخطورة
GET    /api/search?q                              # البحث الشامل

# القوالب
GET    /api/forms/templates?q&categoryId&status
POST   /api/forms/templates (upload docx) ; PATCH /api/forms/templates/{id}/meta|status ; DELETE /api/forms/templates/{id}
GET    /api/forms/templates/{id}/fields ; POST /api/forms/templates/{id}/fields ; PATCH /api/forms/fields/{id}
POST   /api/forms/templates/{id}/documents        # fill_word (+pdf) — values يدوية/نظامية
GET    /api/word/official/{contractId|quotationId}    # official_field_values + fields
POST   /api/word/official/fill                        # fill_template
GET    /api/batch-print?customerId&kinds    # فواتير/سندات/كشوف بمجلد (zip في الويب)
```

---

## خلاصة القواعد الحاكمة للتنفيذ (Golden Rules)
1. التصفية لا تصرف نقدًا جديدًا — توزيع مبلغ سبق صرفه؛ لا method في التصفية (lifecycle_service.py:3047–3051).
2. `balance` العهدة دائمًا handed − spent − returned على مستوى الحساب (3471–3479).
3. الإرجاع/الرد النقدي/الخصم: **سقف المتبقي إلزامي** للعهدة والسلف (3067؛ 3288؛ test_v453:105).
4. سندات التصفية والسندات عمومًا **لا تُحذف** — إلغاء موثق بسبب (cancel_voucher)؛ والحذف الفعلي حكر على purge (developer + لقطة).
5. الفاتورة لا تتجاوز المتبقي من العقد ويجب أن تخص عميلَ عقدِها (invoice_service.py:107–119).
6. كل التعليقات حذف ناعم؛ التعديل والتثبيت للمدير (comment_service.py:209–262).
7. الصلاحيات: المدير/المطور دائمًا الكل؛ السكرتير يبدأ بافتراضيات الدور ويُخصص بندًا بندًا؛ المفتاح المجهول لا يقيّد (auth_service.py:485–501).
8. feature flags تخفي وتوقف ولا تمسّ بيانات؛ CORE لا تُعطّل (feature_service.py:8–13، 274–278).
9. أي استعادة نسخة تولّد كلمة مطور جديدة وتحفظها مرة واحدة (database.py:2323–2331).
10. المرفقات: امتدادات محصورة للعقود؛ مسارات التخزين تحت مجلد البيانات الفعلي (محلي/شبكي) (extras_service.py:160–179؛ archive_service.py:15–19).
