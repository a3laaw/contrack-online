# مواصفة دقيقة: الباطن + البوابة المالية + التصفية + الشركة الأخرى — ConTrack V9.15.18

> Task ID: 2-c · وكيل بحث عميق (قراءة فقط) · المصدر: `contrack_v9.15.18/app/`
> الهدف: مرجع لاحق لبناء نسخة ويب Next.js / Prisma / TypeScript.
> كل صيغة/قاعدة مرجعها `ملف:سطر` كما هي في المصدر. **ملاحظة منهجية مهمة:** `services/settlement_service.py` المذكور في المهمة بوصفه «تسوية مقاولي الباطن» هو فعليًا **خدمة تسوية/تصفية بوابات الدفع مع البنك + الشركة الأخرى** (docstring السطر 1-9). منطق «التسوية» الخاص بالباطن مبعثر بين `lifecycle_service.py` (خطة الدفعات والتغطية FIFO) و`extras_service.py` (تسوية/إغلاق العقد). وُثّق الاثنان هنا.

---

## 0) جداول القاعدة ذات الصلة (DDL مستخرج)

### 0.1 جداول تُنشأ في `database/database.py` (المخطط الأساسي)

| الجدول | الأسطر | الحقول الجوهرية | ملاحظات |
|---|---|---|---|
| `subcontractors` | database.py:636-646 | `id, sub_code UNIQUE NOT NULL, name NOT NULL, phone, email, activity, notes, show_all_contracts (0/1), created_at` | `sub_code` يُولَّد آليًا `next_sub_code()` (lifecycle_service.py:97) |
| `sub_contracts` | database.py:648-659 | `subcontractor_id → subcontractors ON DELETE RESTRICT, contract_id → contracts ON DELETE RESTRICT, project_id, amount>0, start_date, end_date, status DEFAULT 'نشط', description` | أعمدة مُضافة لاحقًا: `cancel_reason, cancelled_at, cancel_close_amount` (database.py:1431-1441) |
| `sub_contract_items` | database.py:661-670 | `sub_contract_id CASCADE, boq_item_id CASCADE, qty, unit_price, amount, source_kind, source_id` | `source_kind/source_id` = البنود «المُنزَّلة» V8.3 (من بنود/دفعات العميل) — ui/subcontractors.py:671,693 |
| `sub_payment_plan` | database.py:791-803 | `sub_contract_id CASCADE, title, due_date, amount>0, sort_order, stage_id → contract_stages, notes, triggered_at` | «مرآة payment_plan»؛ `stage_id` يشير لمرحلة **عقد العميل الأب** (تعليق DDL 788-790) |
| `sub_payment_sources` | database.py:807-813 | `sub_line_id → sub_payment_plan CASCADE, cust_line_id → payment_plan CASCADE, UNIQUE(sub_line_id, cust_line_id)` | V4.6: N:M بين دفعة الباطن ودفعات العميل؛ تُستحق الدفعة باكتمال كل مصادرها |
| `payment_plan` (العميل) | database.py:770-786 | `contract_id CASCADE, title, due_date, amount>0, sort_order, stage_id, notes, triggered_at` | المصدر المالي للباطن |
| `vouchers` | database.py:686-717 | `voucher_number UNIQUE, vtype CHECK(payment/receipt/transfer/custody_return/salary_deduction), vdate, party/party_type/party_id (customer/subcontractor/partner), method, account, expense_account_id+snapshot, amount>0, advance_amount, contract_id, sub_contract_id, cost_center, receipt_group_ref/line` | أعمدة مُضافة: `parent_voucher_id, cheque_due_date, cancelled, cancelled_at, allocation` (database.py:1070-1075, 1670-1686) |
| `voucher_payment_links` | database.py:822-832 | `voucher_id, kind CHECK(receipt/payment), line_id, amount>0, UNIQUE(voucher_id, line_id)` | V6.2: ربط السند بخط دفعة بعينه (قبض=payment_plan · صرف=sub_payment_plan) |
| `expense_accounts` | database.py:672-684 | `parent_id SELF, name, full_path, is_active, allow_posting, include_in_profitability, account_kind ('expense'/'advance'), sort_order` | شجرة مستويان فقط |
| `journal_entries` | database.py:746-761 | `entry_date, debit_account, credit_account, amount, sub_contract_id, source_type/source_id` | القيود المولدة من السندات |
| `contract_groups` + `contract_group_items` | database.py:1897-1917 | `group_number, customer_id, group_name, notes, created_by` + `UNIQUE(group_id, contract_id)` | حزم متابعة تنظيمية |
| `claims` | database.py:1920 | `sub_contract_id` من بين الأعمدة | المطالبات تمنع حذف عقد الباطن |
| `payment_methods` | database.py:1532-1556 | `name UNIQUE, fee_type (amount/percent), fee_value, is_active` | افتراضيات: نقدًا 0 · تحويل بنكي 0.150 · KNET 1.5% · شيك 0 |
| `employees` | database.py:1564-1577 | `name UNIQUE, phone, notes, active` | لسلف الموظفين (V4.53) |

### 0.2 جداول تُنشأ وقت التشغيل في `services/settlement_service.py`

| الجدول | الأسطر | الحقول الجوهرية | ملاحظات |
|---|---|---|---|
| `gateway_profiles` | settlement_service.py:64-72 | `name UNIQUE, bank_account, methods DEFAULT 'KNET' (كلمات مفصولة بفاصلة), lag_days DEFAULT 1 (T+N), fee_fixed (عمولة/عملية), tolerance DEFAULT 0.005, late_days DEFAULT 3, is_active` | البوابة الافتراضية تُزرع آليًا (:89-94) |
| `gateway_ops` | settlement_service.py:136-186 | `gateway, op_date, phone, amount, ref, status, receipt_no, customer, batch, created_at` + `UNIQUE(gateway, op_date, phone, amount, ref)` (uq_gateway_ops :146-148) | أعمدة ALTER: `paid_transfer_id, classified_manual, distributed, gw_paid, gw_paid_date, gw_token, distributed_at, effective_date` (:150-174) |
| `bank_lines` | settlement_service.py:276-286 | `bank_account, cdate, amount, descr, batch` + `UNIQUE(bank_account, cdate, amount, descr)` | الإيداعات فقط من كشف البنك |
| `other_company_transfers` | settlement_service.py:796-812 | `tdate, amount, ref, notes` + ALTER: `method, voucher_id, voucher_number` | تسديداتنا للشركة الأخرى |
| `gateway_fee_vouchers` | settlement_service.py:818-824 | `op_id PRIMARY KEY, voucher_id, transfer_id, fee` | V4.52: منع ازدواج سند العمولة (مسار قديم) |
| `transfer_op_allocs` | settlement_service.py:845-857 | `transfer_id, op_id, amount` | توزيع التسديد على العمليات (دفع جزئي) |
| `other_company_opening` | settlement_service.py:1245-1253 | `id CHECK(id=1), amount, note` | رصيد افتتاحي صف واحد |
| `schema_flags` | settlement_service.py:175-186 | `name PK` | ترحيل لمرة واحدة `dist_migrated_v416`: المصنَّف قبل V4.16 يُعتبر موزَّعًا |

### 0.3 جدول تُنشئه `services/gateway_service.py`

| الجدول | الأسطر | الحقول |
|---|---|---|
| `match_aliases` | gateway_service.py:431-441 | `file_phone, file_name, customer_id` + `UNIQUE(file_phone, file_name)` — روابط مطابقة يدوية يتعلمها النظام |

---

## A) مقاولو الباطن

### A.1 نموذج البيانات
- **المقاول** `subcontractors` (database.py:636-646): كود/اسم/هاتف/بريد/نشاط/ملاحظات + `show_all_contracts` (V3.20: استثناء إظهار كل العملاء والمشاريع له في السندات — ui/subcontractors.py:48-52). إنشاء/تعديل: `lc.add_subcontractor` (lifecycle_service.py:707) و`lc.update_subcontractor` (:728)؛ الحوار `SubcontractorDialog` (ui/subcontractors.py:23-98) بتحقق إلزامي على الكود والاسم.
- **عقد الباطن** `sub_contracts` (database.py:648-659): مرتبط إلزاميًا بعقد عميل + مقاول. `add_sub_contract` (lifecycle_service.py:767-803): `amount>0` إلزامي؛ المشروع يُفرض من عقد العميل إن وُجد (:778-781)؛ يُسجَّل حدث على العقد الأب (:796-797) ويُشغَّل مسار دورة حياة `TX_SUBCONTRACT` (:799-801). التعديل `update_sub_contract` (:933-975): حالات `نشط/متوقف/منتهي/ملغى` (الواجهة تفرضها ui/subcontractors.py:3412) + `cancel_reason/cancel_close_amount` (سالب مرفوض :944-946).
- **تعدد المقاولين على نفس عقد العميل مسموح** — يُمنع فقط تكرار نفس (المقاول + العقد) بتحذير تأكيد (ui/subcontractors.py:2707-2715).
- **بنود العقد** `sub_contract_items` (database.py:661-670): إما ربط مباشر بـ`boq_item_id` أو بند مُنزَّل بحقول `source_kind/source_id` (V8.3؛ ui/subcontractors.py:2735-2747 يمرر `pulled_items`). `set_sub_contract_items` (lifecycle_service.py:1019+) يعيد بناء الارتباطات.

### A.2 مصادر تمويل الباطن (من دفعات العميل الأصلية — نعم)
- **القاعدة المركزية (V6.1/V4.6): عقد العميل هو الأساس.** كل دفعة باطن يجب أن تُربط بدفعة/دفعات عميل واحدة على الأقل عبر `sub_payment_sources` (N:M) — `set_sub_line_sources` يرفض القائمة الفارغة: «اختر دفعة عميل واحدة على الأقل» (lifecycle_service.py:1454-1491، التحقق من انتماء المصادر لعقد العميل نفسه :1482-1485).
- **الاستحقاق باكتمال كل المصادر:** خلية «حالة دفعة العميل» تعرض «محصّلة» فقط إذا كان `remaining ≤ 0.001` لكل مصادر الدفعة، وإلا «لم تُحصَّل: تُستحق دفعة المقاول بعد تحصيلها» (ui/subcontractors.py:116-141). المصدر الداخلي للمصادر مع `triggered_at`: `get_sub_line_sources` (lifecycle_service.py:1494-1503).
- **الربط التلقائي 1:1** في محرر الدفعات: `SubPlanLineDialog` يجعل «دفعة العميل» إلزامية ويقرأ منها المرحلة والاستحقاق (المستحق مقفول لا كتابة يدوية) (ui/sub_plan_editor.py:25-63, 145-155؛ add_line يرفض بلا مصادر :170-214).
- **النسب:** لا نسبة مئوية مخزنة. التوزيع التلقائي `distribute_sub_plan` (lifecycle_service.py:1728-1778) ينشئ **صف باطن لكل دفعة عميل** عبر `_sub_client_payment_rows` (:1781-1876):
  - وضع البنود (V6.6): إذا كانت بنود المقاول مربوطة بمراحل — صف لكل مرحلة، مبلغه = `Σ(qty × unit_price)` لبنود المقاول في تلك المرحلة من `boq_items` (:1804-1848).
  - وإلا: توزيع نسبي على دفعات العميل بوزن مبالغها، والصف الأخير = `total − Σالسابق` لضمان تساوي المجموع مع قيمة العقد (:1850-1876).
  - عقد العميل بلا خطة دفعات ⇒ سطر أيام واحد بقيمة العقد كاملة (:1753-1762) — ولا يمنع الحفظ.
- **شرط خطة العميل:** إنشاء سطر باطن يدوي يتطلب وجود دفعات عميل (ui/sub_plan_editor.py:177-183)؛ وحفظ عقد باطن يتطلب لكل سطر مصادر + قيمة > 0 (ui/subcontractors.py:2686-2695، نفس التحقق في التعديل :3415-3424).
- **البنود المرتبطة بالعقد الأصلي:** `sub_contract_items.boq_item_id → boq_items(stage_id → contract_stages)` — هي نفسها موجّهة التوزيع في وضع البنود أعلاه، وتُعرض في كتلة «📋 بنود العقد المرتبطة» بمجموعها (ui/sub_pay_blocks.py:396-444).

### A.3 خطة دفعات الباطن والتغطية (المعادلة الحرفية للمدفوع)
`_sub_payment_plan_impl` (lifecycle_service.py:1230-1356):
```
paid = Σ vouchers(amount) WHERE vtype='payment' AND cancelled=0
       AND sub_contract_id=? AND (allocation IS NULL OR allocation='')   (:1242-1247)
  + legacy: سندات صرف للمقاول (party_type='subcontractor', party_id, contract_id)
    بلا sub_contract_id — تُحتسب فقط إذا كان له عقد باطن واحد على نفس عقد العميل
    (:1248-1272)؛ عند التعدد تُعرض كعدد/مبلغ "سندات غير مرتبطة" على أول سطر (:1274-1304)
links = Σ voucher_payment_links(amount) kind='payment' لسندات سارية لكل خط (:1305-1316)
remaining_pool = max(0, paid − Σlinks)
لكل سطر بالترتيب: covered = min(remaining_pool, amount); remaining_pool -= covered;
covered += min(links[line], max(0, amount − covered)); remaining = amount − covered
```
الحالات (:1326-1355): `مرحلة متخطاة` (مرتبطة بمرحلة is_skipped) · `بانتظار إنجاز المرحلة` (مرتبطة وغير مفعّلة وremaining>0) · `مدفوع` (remaining≤0.001) · `جزئي/متأخر` · `مستحقة` (مفعّلة untriggered ولم يحل أجلها — V4.5.03) · `مستحق قريبًا` (≤7 أيام) · `لم يحل`.
قواعد الأسطر: إضافة/تعديل/حذف ترفض **السطر المفعّل مرحليًا** (`triggered_at`) (lifecycle_service.py:1432-1433, 1449-1450)؛ المرحلة يجب أن تكون من عقد العميل الأب وغير متخطاة (:1368-1381).

### A.4 سقف دفع الباطن (كيف يُحسب)
`_check_sub_payment_limit` (lifecycle_service.py:1919-1944) عند إنشاء/تعديل سند صرف لمقاول:
```
total = Σ sub_contracts.amount WHERE subcontractor_id=? AND contract_id=? AND status != 'ملغى'
paid  = Σ vouchers.amount WHERE vtype='payment' AND cancelled=0
        AND contract_id=? AND party_type='subcontractor' AND party_id=? (يستثنى السند المعدَّل)
remaining = total − paid
amount > remaining + 1e-9 ⇒ OverpayWarning برسالة "سيتم تسجيل الزيادة كـ(دفعة مقدمة)"
— يُمنع إلا إذا سُمِح بالتجاوز (allow_overpay=True من حوار السند)
```
استدعاؤه الإلزامي من `add_voucher` (:2283-2284) ومن تعديل السند (:4529). حواجز إضافية: المقاول يجب أن يكون مرتبطًا بعقد الباطن على ذلك العقد (:2275-2282)؛ **لا صرف على عقد باطن ملغى** `_ensure_sub_contract_accepts_payments` (:1960-1969، V9.15.17 القرار 6)؛ والعقد الأب الملغى مجمّد ماليًا (:1948-1957).

### A.5 بوابة الصرف للباطن (paid gate)
- **المفتاح:** `settings.sub_pay_client_gate` (افتراضي مفعّل) — `gate_enabled()/set_gate()` (voucher_payment_link_service.py:31-47): «بوابة تحصيل العميل قبل الصرف للمقاول».
- **الصفوف:** `plan_rows('payment', sub_contract_id=…)` (:100-189) تحسب لكل خط: `eligible` (وصلت مرحلته وباقي عليه مبلغ) و`gated` = إذا كانت مصادره (دفعات العميل) فيها أي دفعة غير محصَّلة ⇒ «بانتظار تحصيل دفعة العميل «…» — لا يمكن الصرف للمقاول قبل تحصيلها» (:166-181). عقد باطن ملغى ⇒ الخط `cancelled` لا يُصرف عليه (:182-187).
- **التحقق عند الحفظ:** `validate_selections` يرفض الربط بدفعة غير مستحقة/موقوفة بالبوابة (:347-369)، ويستدعى قبل إدراج السند داخل `add_voucher` (lifecycle_service.py:2256-2265).
- **التتابع (V9.15.17):** `check_selection` يمنع تحديد دفعة مع تخطي دفعة سابقة غير مسدّدة (الموقوفة لا تمنع ما بعدها) (:477-502)؛ `distribute` يوزع المبلغ بالترتيب والزيادة تُكمل الدفعات التالية حتى موقوفة، والباقي «رصيد مقدَّم» على السند `advance_amount` (:505-562؛ `apply_links` :372-436).
- **البيان التلقائي:** `describe/describe_items` — «سداد رسوم الدفعة الرابعة (المرحلة) – (ومتبقي منها X) — عقد الاسم — المقاول اسم» (:238-292, 604-619).

### A.6 التوطين في الواجهات
- شاشة المقاولين: شجرة/قائمة مع إجمالي العقود والمدفوع والمتبقي — `subcontractors_tree` (lifecycle_service.py:835-888): المدفوع لكل (party_id, contract_id) ويُعد مرة واحدة لكل عقد حتى مع تعدد عقود الباطن (:878-885)؛ الإجمالي يستثني «ملغى» (:877).
- سجل مدفوعات المقاول `SubPaymentsDialog` (ui/subcontractors.py:4065-4113) عبر `extras_service.subcontractor_payments`.
- صفحة المقاول `ui/subcontractor_page.py`: تبويبات (نظرة عامة/عقود/أوامر تغييرية) + كتلة دفعات موحّدة لكل عقد باطن (:554-616) + سند صرف مُعبَّأ بعقد الباطن المختار (:632-649).

---

## B) كتل الدفع `sub_pay_blocks`

- **ما هي:** ليست جدول قاعدة بيانات — بل «الجدول الموحّد العميل ⇄ المقاول» (V9.1، 9 أعمدة: البند/المرحلة | عميل 4 | مقاول 4) يُبنى لدورة حياة العقد في شاشتين: مركز العقد (كتلة لكل مقاول) وصفحة المقاول (ui/sub_pay_blocks.py:1-8).
- **البناء:** `build_unified_table(...)` (:134-393) يستقبل: خطة العميل `plan_by_id`، ترقيمها `client_no`، المشتركة `shared_ids`، خطوط الباطن `lines = lc.sub_payment_plan(sid)`، المصادر `src = lc.sub_source_ids(sid)`، وأرقام دفعات العميل المرتبطة `nums`. القاعدة V9.15.15: كل خط مقاول يظهر **مرة واحدة** تحت أول دفعة عميل مرتبطة به (أصغر رقم)، وكل دفعة عميل تُعرض في صف لكل خط مقاول عليها (:139-166)؛ الخطوط غير المرتبطة تُلحق أسفل الجدول (:164-166).
- **الإغلاق/الحالات:** لا «إغلاق» مخزّن — الحالة محسوبة لحظيًا من الخطة (أ.3). عقد باطن ملغى ⇒ خطوطه تظهر «ملغى» ولا تدخل الإجماليات (:340-345 عبر `sub_cancelled`).
- **العلاقة بالمراحل والدفعات:** العمود 0 = المرحلة/البند من `stage_name`؛ أعمدة العميل تعرض (الدفعة/المبلغ/المسدّد=`covered`/الحالة) من `contract_payment_plan`، وأعمدة المقاول مثلها من `sub_payment_plan`. شريط تقدم 3px تحت خلية المسدّد بنسبة `paid/amount` (ProgressDelegate :53-96).
- **دفعات العميل المشتركة:** `shared_client_line_ids` (:447-463) — دفعة عميل تغذي أكثر من عقد باطن تُوسم «مشتركة» في التلميح (:323-324).
- **مصدر البيانات الموحد:** `sub_contract_data(cid, sc_id)` (:481-539) — نفس مصادر شاشة العقد، تُستخدم من صفحة المقاول (ui/subcontractor_page.py:572-616).

---

## C) التسوية `settlement_service` (+ تسوية العقد في extras)

### C.0 تصحيح نطاق
`settlement_service.py` docstring (1-9): «تصفية بوابات الدفع مع البنك — ربط ثلاثي (سيستم × بوابة × بنك)» بقواعد: حساب بنكي واحد يستقبل الكل · عمولة ثابتة لكل عملية · تأخير T+1 بأيام العمل (الجمعة والسبت عطلة) · مطابقة البنك بمبلغ+تاريخ (± يوم عمل + تسامح). **لا علاقة له بمقاولي الباطن.**

### C.1 أنواع التسويات في النظام
1. **التصفية اليومية الثلاثية** `daily_clearing(date_from, date_to, gateway)` (:413-537) — صف لكل (بوابة، يوم تشغيل):
   - `sys` = Σ سندات قبض سارية (`cancelled=0`) تطابق كلمات طرق دفع البوابة (`_method_clause` :405-410 — `method LIKE %kw%`) بتاريخها (:432-438).
   - `g` = عمليات البوابة المثبتة **الموزَّعة** (`distributed=1`) غير الملغاة/المعلقة (`gw_paid IS NULL OR gw_paid=1`) مجمعة بحالة mine/other (:440-460). «غير مصنّف» خارج التصفية تمامًا (:460).
   - `expect = g_total − n×fee` · `my_share = mine − n_mine×fee` · `other_share = other − n_other×fee` (:477-480).
   - `settle_date = add_business_days(day, lag_days)` (:482-486؛ `add_business_days` :34-42).
   - **مطابقة البنك:** نافذة `[settle−1 يوم عمل, settle+1 يوم عمل]` + `|bank_amount − expect| ≤ tolerance`، اختيار أقرب حركة بـ(key = فرق الأيام ثم فرق المبلغ) والاستهلاك بمجموعة `used` (:487-509).
   - `gap = mine − sys` (:510)؛ الحالة (:511-522): `diff` (|gap|>tol) → `done` (ربط بنكي) → `pending` (settle لم يحن) → `late` (تجاوز settle+late_days) → `pending`. التسميات `STATUS_LABEL` (:540-541).
2. **التسوية اليومية للشركة الأخرى** `other_daily_settlement` (:1944-2014، V4.37): تجميع بتاريخ العملية للبنود المؤهلة `_DUES_ELIGIBLE` (:1659-1660) = `status='other' AND distributed=1 AND (gw_paid IS NULL OR gw_paid=1)`؛ لكل عملية: `net = gross − fee`، `paid = Σتوزيعاتها`، `remaining = net − paid`، حالة `paid/partial/unpaid` (:1973-2004)؛ يعود بـ`transfers` وإجماليات (:2005-2014).
3. **تسوية الصافي (V4.49):** كل مستحقات «الأخرى» صافية بعد عمولة البوابة — `unpaid_other_items` (:621-657): `amount (المتبقي) = (gross − fee) − paid_alloc` و`total = gross − fee`. الدفع فوق الصافي **مسموح** ويسجل «فروقات عمولة» (:973-977).
4. **الكشف الدفتري** `other_ledger` (:2187-2242): رصيد أول الفترة = افتتاحي + مستحق تراكمي قبله − مسدد قبله (:2194-2201)؛ أسطر `due` من `other_statement` (:677-705، تراكمي `other_share` صافي) وأسطر `pay` من التسديدات مع أسماء العمليات المغطاة (:2212-2227)؛ رصيد جارٍ `balance` (:2233-2238).
5. **رصيد الأخرى** `other_balance` (:1040-1045): `dues = opening + other_dues_total`، `paid = Σtransfers`، `remaining = dues − paid` (قد يصير سالبًا = فروقات عمولة).
6. **تقرير المطابقة الخارجي** `other_external_report` (:708-760): قراءة فقط بلا قيود؛ `remaining = opening + Σdues(حتى date_to) − Σtransfers(حتى date_to)` (:753-760)؛ الملغاة (gw_paid=2) خارج الإجماليات مع عدّها (:732-735)، المعلقة (gw_paid=0) في `pending` (:736-738).
7. **تسوية/إغلاق عقد العميل** (`extras_service.py:295-350`) — هذه «التسوية النهائية» الأخرى في النظام:
```
remaining = contract_current_value(current) − Σreceipts(cancelled=0)
fully_collected = remaining ≤ 0.001
stages_complete = لا توجد مرحلة حالية في مسار العقد (wf.stage_status)
closable = fully_collected AND stages_complete AND status ∉ (مغلق, ملغى)
close_contract يرفض: "ما زال عليه مبلغ متبقٍ" أو "التحصيل مكتمل لكن مسار المراحل لم يكتمل"
```
**منع التسوية بلا مراحل** = منع الإغلاق حتى اكتمال مسار المراحل (tests/test_settlement_requires_stages.py:1-4 و:60-64؛ test_settlement_action_visible_after_final_stage.py:1-3 — الزر يظهر بعد إنهاء آخر مرحلة).

### C.2 ماذا تنشئ التسوية من سندات؟
- **تسديد الشركة الأخرى لا ينشئ أي سند** (V4.5.13): `add_other_transfer` (:925-1003) — البارامتر `create_voucher` مقبول للتوافق ويُتجاهل تمامًا (:976-977)؛ «التسديد بين الشركتين تسوية حسابية لا إيراد ولا مصروف» (docstring :931-937، وui/clearing_page.py:235-237).
- **سند عمولة التسوية (قديم V4.52):** `_create_settlement_fee_voucher` (:877-922) ينشئ سند صرف تحت حساب «عمولات بنكية» (`ensure_bank_commission_account` lifecycle_service.py:2644) بوصف «عمولة بوابات عن التسوية ت{tid}» ويقيّده في `gateway_fee_vouchers`. **في الكود الحالي مسار ميت:** يُستدعى فقط عند `if voucher_id and _completed:` (:999) بينما `voucher_id=0` دائمًا (:975). القراءة `transfer_fee_voucher` (:827-842) تعرض سندات العمولة القديمة، وحذف التسديد المرتبط بسند عمولة سارٍ مرفوض (:1066-1075).
- القيد المحاسبي للسندات يُولَّد في `journal_entries` عبر `_insert_voucher_journal` (lifecycle_service.py:2506+) ويُعكس عند الإلغاء (:2611+).

### C.3 تعديل/تراجع تسوية سابقة
- لا «تعديل» للتسديد — **حذف فقط**: `delete_other_transfer` (:1048-1102): يرفض إن كان مرتبطًا بسند سارٍ (قديم) أو بسند عمولة سارٍ (:1058-1075)؛ يحذف توزيعاته ويعيد حساب `paid_transfer_id` لكل عملية ماسة (إعادة تعيين لآخر transfer مغطٍّ أو صفر) (:1076-1100).
- إعادة التصنيف قبل التوزيع: `set_row_class` (:1459-1483) — مرحلة مؤقتة بلا أثر حسابي؛ الموزَّع/المسدد/غير المثبت مرفوض. إرجاع الموزَّع `undistribute_rows` (:1531-1556) — المسدد يُتخطى (فكّه = حذف التسديد).
- **تعديل تسوية العقد** = إلغاء/تعديل السندات عبر `cancel_voucher`/`update_voucher` (lifecycle_service.py:4702+, 4422+) وفتح ما عُلّق به تلقائيًا (`_comment_receipt_cancel_reopens_plan` :4649+).

### C.4 عدّاد اليوم الفعلي T+1 (حسب PLAN_GATEWAY_FINANCIAL.md)
- `effective_date(payment_date, method)` (:45-60): T+1 بأيام عمل للطرق `("بوابة","تحويل بنكي","gateway")` فقط؛ **KNET/نقدي/شيك = فوري**. يُحسب عند التثبيت في `save_gateway_ops` (:204) ويُخزّن في عمود `gateway_ops.effective_date` (:172-174)؛ ويعاد في تقارير العمليات `other_ops_status` (:1890).
- `expected_collection_date` (:1917-1928، V4.41): تاريخ تحصيل متوقع «ثاني يوم» — الخميس/الجمعة/السبت ⇒ الأحد (عطلة بنوك مختلفة!). `collection_status` (:1931-1941): المخزَّن أولًا ثم المحسوب.
- `report_service.gateway_summary` (report_service.py:1606-1670): T+1 محسوبة فعليًا vs في الانتظار (تقسيم جاهز للنسخة الويب).

---

## D) البوابة المالية: `gateway_service` + شاشات التصنيف والتصفية

### D.1 الدور الحرفي
docstring (gateway_service.py:1-6): «مطابقة تسوية بوابة الدفع مع سندات القبض. نبحث في عملائنا فقط برقم الهاتف والمبلغ — ما يطابق فهو لشركتنا، وما لا يظهر معنا فهو للشركة الأخرى». أي: ملف كشف بوابة الدفع (Hesabe/KNET…) يُطابق بسندات القبض لتحديد ملكية كل عملية: ✅ شركتنا (مطابقة) / 🏢 شركة أخرى / ⚪ غير مصنّف.

### D.2 دورة حياة عنصر البوابة `gateway_ops`
| المرحلة | الأعمدة | الدالة (ملف:سطر) |
|---|---|---|
| 1. قراءة الملف | — | `read_settlement_file` (gateway_service.py:389-393 → `_extract_rows` :295-364): اكتشاف أعمدة (:193-239)، تخطي الفاشل/المنتهي (UNPAID_PATTERNS :34-35)، `gw_paid = paid_state_of` (1 محوَّلة/0 معلقة/2 ملغاة/−1 فاشلة/None) (:160-174)، تاريخ الدفع من `updated` للمدفوع و`created` للمعلق (:328-335) |
| 2. مطابقة تلقائية | status/receipt_no/via | `match_settlement` (:569-717) — التفاصيل أدناه؛ ثم `auto_classify` (:741-748): المطابق الواضح فقط يبقى mine والباقي unmarked |
| 3. تثبيت تراكمي | batch/effective_date | `save_gateway_ops` (settlement_service.py:189-232): تحديث الموجود غير المسدد وغير الموزَّع وغير اليدوي؛ `INSERT OR IGNORE` بالمفتاح الفريد؛ الموزَّع/المسدد لا يُمسان؛ بلا أثر حسابي |
| 4. تحديث التحصيل | gw_paid/gw_paid_date/gw_token | `refresh_gw_paid` (:235-272): بالمطابقة على المرجع+المبلغ (التاريخ يتغير عند التحصيل)؛ تُستثنى المسددة للشركة الأخرى |
| 5. تصنيف يدوي | classified_manual | `set_row_class` (:1459-1483) + اقتراح `suggest_row_classes` (:1369-1439) + استرجاع اليدوي فوق التلقائي `restore_manual` (:1442-1456) |
| 6. توزيع ◆ (الاعتماد المحاسبي) | distributed=1, classified_manual=1, distributed_at | `distribute_rows` (:1499-1528): يتخطى المعلّق/الموزَّع/المسدد/غير المحصَّل (gw_paid∈{0,2})/المفقود — «لا مسار يتجاوز هذه الدالة» |
| 7. إرجاع ↩ | distributed=0 | `undistribute_rows` (:1531-1556) — المسدد يُتخطى |
| 8. تسديد | paid_transfer_id + transfer_op_allocs | `add_other_transfer` (:925-1003) — توزيع على **الصافي**؛ اكتمال التغطية ⇒ `paid_transfer_id` |
| 9. مسح شامل | — | `wipe_all_gateway_data` (:2259-2296) بنسخة احتياطية آلية + حذف سندات/قيود التسديدات القديمة |

حالات العرض في الواجهة (ui/gateway_page.py:29-44): «🔒 موزَّعة / ⏭ مسددة / ✓ جاهزة / … تُتخطى»، مفتاح الصف `_row_key = (date, phone, amount, ref)` (:58-62)، دورة التصنيف بالنقر `[unmarked → mine → other]` (:22, :640-674)، شارات «مقترح/سوابق متعارضة» (:80-86).

### D.3 خوارزمية المطابقة التلقائية (match_settlement — gateway_service.py:569-717)
- **مرشحو الهوية** (سندات قبض سارية + عميلها عبر `receipt_phones` :396-415): هاتف (`phones_match` :67-76: تساوٍ أو لاحقة ≥7 أرقام بعد تجريد غير الأرقام)، اسم مطابق (`names_match` :90-93 بعد توحيد عربي: تشكيل/ألف/ة→ه/ى→ي :79-87)، اسم جزئي (`names_similar` :96-103: كلمات الأقصر كلها في الأطول)، رابط محفوظ `match_aliases` (:475-491).
- **الترتيب:** (هاتف+اسم)=0 ← هاتف=1 ← رابط محفوظ=1 ← اسم=2 ← اسم جزئي=3 (:636-648)؛ تلميح رقم العقد في البيان/المرجع `contract_hint` (:110-117) أو كلمة مشتركة `text_hint` (:132-140) يرفعان المرشح ويسبقان النافذة (:649-662).
- **النافذة الزمنية:** `WINDOW_DAYS=5` (هاتف/رابط) و`NAME_WINDOW_DAYS=3` (اسم) (:47-48)؛ `within_window` :418-427.
- **المبلغ:** تطابق تام بتحمل 0.001 (:667)؛
- **النتائج:** تام ⇒ `mine` مع `via` («عقد + الهاتف…»)؛ هوية صحيحة ومبلغ يطابق لكن التاريخ خارج النافذة ⇒ `diff` بملاحظة مفصلة (:683-698)؛ هوية صحيحة والمبلغ مختلف ⇒ `diff` بفرق المبلغ (:700-707)؛ هوية عميلنا بلا سند ⇒ `diff` «لا سند بهذا المبلغ» (:710-714)؛ لا هوية ⇒ `other` «لا يوجد عميل بهذه الهوية — للشركة الأخرى» (:602-606). لاحقًا `auto_classify` يحول كل diff إلى unmarked (:741-748).
- **روابط يدوية:** `link_row_manual` (:494-522) يحدّث العملية إلى mine + رقم السند ويحفظ alias يتعلمه للملفات القادمة؛ `unlink_row_manual` (:533-550) يعيدها إلى other ويحذف الرابط.
- **علم "مسدد مسبقًا":** `mark_paid_before` (settlement_service.py:1321-1335) بالمفتاح (تاريخ، هاتف، مبلغ، مرجع) — الصفوف المسددة تُخفى من التصنيف (ui/gateway_page.py:613-617)؛ و`mark_seen_before` (:1559-1578) يعرض «📌 مسجَّلة من قبل» بحالتها المحفوظة.

### D.4 التصفية clearing (`ui/clearing_page.py`)
- **لوحة التصفية اليومية** (:320-529): جدول `daily_clearing` (HEADS :19-21) بفلاتر حالة + عرض «بنك غير مربوط» `unmatched_bank` (settlement_service.py:660-674)؛ ضغط مزدوج = `DayDetailDialog` (عمليات البوابة + سندات السيستم لليوم) (:123-161).
- **استيراد كشف البنك** (:476-507): xlsx/csv (ترميز cp1256 احتياطًا — settlement_service.py:370-379)؛ استخراج **الإيداعات فقط** (`_extract_bank_lines` :331-357، اكتشاف أعمدة d/credit :294-314)؛ حفظ بمنع تكرار `save_bank_lines` (:389-401).
- **إعدادات البوابات** `GatewayProfilesDialog` (:24-120): الاسم/الحساب البنكي/طرق الدفع (كلمات مفصولة بفاصلة تُطابَق على `vouchers.method`)/T+N/العمولة. **ملاحظة:** `tolerance` و`late_days` موجودة في `save_profile` (settlement_service.py:97-119) لكن الحوار لا يعرضهما (يُمرر القيم الافتراضية 0.005/3).
- **ماذا تنشئ التصفية؟** لا تنشئ سندات رسوم تلقائيًا في الحالة الراهنة: العمولة تُخصم حسابيًا في `expect/my_share/other_share` (:478-480) وفي صافي مستحق الأخرى؛ رسوم سندات القبض البنكية منفصلة عبر `_reconcile_receipt_fees` (lifecycle_service.py:2885+) وإعدادات `bank_fee_amount/bank_fee_method` (database.py:1467-1472).

### D.5 تراجع المطابقة/التصفية وتأثيره على الآخرين (undo_other)
- إرجاع الموزَّع إلى التصنيف: `undistribute_rows` (settlement_service.py:1531-1556) — يعمل على صفوف **شركتنا وشركة الأخرى** معًا (V4.5.12.1 أضاف `distributed_other_rows` :577-618 لتظهر صفوف «الأخرى» الموزَّعة في كارت 🔒 لتُرجَع؛ الافتراضي `include_paid=False`: «المسدَّد خارج الموزَّع»). المسدد يُتخطى ويُرشد المستخدم لحذف التسديد من شاشة الأخرى أولًا (ui/gateway_page.py:827-864).
- حذف التسديد يعيد العمليات لمكانها تلقائيًا (`delete_other_transfer` :1048-1102) — بلا أي أثر على سندات العميل/الباطن.
- اختبار مرجعي: `tests/test_v4512_gateway_undo_other.py`، ومطابقة `tests/test_gateway_match.py`، `test_v411_matching.py`، `test_v4504_sourced_gate.py` (بوابة مصدر العملية)، `test_v4505_autolink.py` (الربط الآلي).

### D.6 حالة «البوابة المغلقة»
ليست حالة بيانات — **صلاحية شاشة**: `screen_gateway` (خريطة `PAGE_PERMS[IDX_GATEWAY]`)؛ السكرتير ممنوع افتراضيًا (لا زر ولا دخول ولا تنبيهات «تسوية بوابة»)، المدير مسموح — tests/test_v327_gateway_closed.py:1-46. **تنبيهات التأخير:** `late_settlements` (settlement_service.py:763-768) تجلب أيام `late` خلال آخر 60 يومًا.

### D.7 تعارضات PLAN_GATEWAY_FINANCIAL.md ↔ الكود (وثّق إلزامي)
1. **KNET في T+1؟** الخطة §1 تدرج "KNET/بنك" ضمن طرق T+1 (PLAN:40) بينما الكود يُلغي KNET من القائمة ويجعله فوريًا (settlement_service.py:53-55 مع docstring :48-49). **الكود هو المعتمد.**
2. **تقويمان للعطلة:** T+1 يتخطى الجمعة+السبت (`WEEKEND=(4,5)` :17-18) بينما تاريخ التحصيل المتوقع V4.41 يعامل الخميس+الجمعة+السبت (:1924). في نسخة الويب يلزم توحيد/فصل النظامين صراحة كما هما.
3. **سلف الموظفين:** الخطة §3 تقترح جدول `employee_advances` + `advance_service.py` + `advances_screen.py` (PLAN:109-121,175-177) — **غير مطبق كما هو**؛ الفعلي: سندات (`advance_employee_id` في vouchers — database.py:702) + جدول `employees` + دوال `add_employee_advance`/`add_advance_cash_return`/`add_salary_deduction` (lifecycle_service.py:3257-3313) + `ui/advances_page.py`. **قواعد الخطة المحاسبية §3.2 مطبقة فعليًا:** الصرف مصروف يحسب في المصروفات ويخفض البنك (:3259 «مصروف يخفضه الاسترداد لاحقًا»)؛ الرد النقدي يدخل الخزينة ويخفض المصروف **بلا إيراد** (:3280)؛ الخصم من الراتب بلا نقدية (:3299). حساب السلف `advance` kind ضمن شجرة المصروفات (`ensure_employee_advance_account` :2695).
4. **`ui/financial_report.py`** المذكور في الخطة (PLAN:101,183) غير موجود؛ التقرير المالي نُفذ في `ui/reports_page.py` (`_data_cash_flow` + قسم البوابة) و`report_service.gateway_summary` (report_service.py:1608) — متوافق مع «المرحلة 2» من الخطة.
5. ما تطابق: `effective_date` عمود + حساب آلي (PLAN:228-230 ↔ settlement_service.py:172-174, 204) · `other_ops_status` يعيد effective_date (PLAN:236 ↔ :1890) · دوال `other_ops_status/other_daily_settlement/other_ledger/other_balance` كلها موجودة (PLAN:17).

---

## E) الشركة الأخرى `other_company`

- **دورها:** الجهة المالكة لبوابة الدفع المشتركة (وسيط تحصيل بين العملاء والشركتين) — العمليات التي لا تطابق عملاءنا تُصنَّف لها، وتُستحق منها **صافي** (بعد عمولة البوابة) ويُسدَّد بتحويلات. ليست «شريكًا» في الأرباح ولا حسابًا في شجرة المصروفات (حساب «تسويات بوابات الدفع — الشركة الأخرى» `OTHER_EXPENSE_ACCOUNT` تعريفه موجود settlement_service.py:793,866-874 لكنه **غير مستخدم في المسار الحالي** — فقط في test_v480_other_account.py:125).
- **بياناتها:** عمليات `gateway_ops` status='other' + `other_company_transfers` + `transfer_op_allocs` + `other_company_opening` (رصيد افتتاحي صف واحد، سالب مرفوض :1265-1273).
- **التحويلات بين الشركتين** = تسديداتنا لها: `add_other_transfer` (:925-1003) بقواعد: تاريخ ISO صالح (:939-942)؛ مبلغ>0 (:943-945)؛ كل عملية يجب أن تكون: موجودة، محصَّلة (gw_paid∉{0,2}) «لا يمكن تسديد ما لم يدفعه العميل» (:960-962)، غير مسددة (:963-964)، موزَّعة (:965-966)؛ التوزيع على الصافي (`gross − fee`) بدعم الجزئي عبر `transfer_op_allocs` (:986-998)؛ **الدفع الكامل بأكثر من الصافي طبيعي** والفارق «فروقات عمولة» يظهر في الواجهة ويحمل رصيد الأخرى للسالب (:973-977 وui/other_company_page.py:474-491).
- **الشاشات:**
  - `ui/other_company_page.py` (مضمّنة في PaymentGatewayPage — ui/payment_gateway_page.py:12-46): تبويبات المستحق (DueItemsPage مضمّنة مع تحديد وتسديد ذكي :525-563) / المسدد (`paid_other_items` :537-546) / التقرير (`other_ops_status` بحالات paid/partial/due + effective_date :810-891) / الكشف المالي (`other_ledger` مع تحديد أسطر للتسديد :565-611) / التسوية اليومية بمستويين (أيام ← عمليات) ومصنف Excel (:613-806). بطاقات: مستحق/مسدد/متبقي من `other_balance` (:328-347). حوارات: الرصيد الافتتاحي (:71-107)، تفاصيل تسديد + حذفه (`TransferDetailDialog` :109-192)، تسديدات عملية (`OpPaymentsDialog` :194-225)، تصدير/طباعة متعدد الأوراق (:227-276, 1004-1236).
  - `ui/other_transfers_page.py`: «مجمعات التسديدات» — كل تسديد بتغطيته (مربوط كامل/جزئي/على الحساب) وتفصيل مجموعات بتاريخ العملية (`list_transfers_summary`/`transfer_coverage` settlement_service.py:1190-1241, 1145-1187؛ `unallocated_transfer_amount` «دفعات على الحساب» :2174-2184).
- **التقارير الخاصة بها:** تقرير المطابقة الخارجي `other_external_report` (:708-760) — قراءة فقط «بلا أي تفاصيل داخلية» لسطر الرسوم والإجماليات؛ تقرير الرفعات `upload_batches_report` (:1663-1762) و`batch_detail`/`batch_mine_detail` (:2037-2171)؛ كشف حساب `other_ledger`.

---

## F) حسابات المصاريف `expense_account_service`

- **الشجرة:** مستويان فقط (أب/ابن) — يُمنع ابن تحت ابن (add_account :244-256، update_account :267-275) وتُمنع تسمية مكررة تحت نفس الأب (:251-252). الافتراضيات `DEFAULT_TREE` (:10-17): تشغيلية/إدارية/مشاريع/تسويق/حكومية/بنكية (عمولات بنكية). الآباء `allow_posting=0`.
- **أنواع الحسابات:** `account_kind='expense'` مقابل `'advance'` (العُهد: «العُهد/عهدة عامة» :18-19, 81-91) مع `include_in_profitability=0` للعهد؛ أي حساب اسمه/مساره يحوي «عهدة» يُعاد تصنيفه advance حتى لو كان مستوردًا (:92-96)؛ **حساب العهدة لا يجوز استخدامه كحساب مصروف** (`account_snapshot` :288-294).
- **الترحيل:** الحسابات القديمة المستخدمة في السندات وغير موجودة تُستورد تحت «حسابات مستوردة / غير مصنفة» (:74-108).
- **المسار الكامل** `full_path` يُحسب ويُحدَّث عند التغيير فقط (refresh_paths :141-185)؛ العرض للنشر يعرض اسم الابن فقط V5.9 (:208-218).
- **الربط بالسندات:** `vouchers.expense_account_id + expense_account_snapshot` (database.py:696-697) — snapshot يُكتب لحظة الحفظ (account_snapshot)؛ مجموعات الصرف عبر `expense_group_ref/line` (database.py:698-699)؛ تصفية/إغلاق العهدة بحساب `custody_account_id` (database.py:700-701) مع `SETTLEMENT_NOTES_MARKS` (lifecycle_service.py:1978).
- **الإلغاء والإغلاق:** `toggle_active` (is_active 0/1) (:282-285) — الإخفاء من الاختيار عبر `posting_only`؛ اختبار مرجعي tests/test_expense_accounts_and_cancel_closing.py.

---

## G) التعاملات `ui/dealings.py`

- **ما هي:** ليست شيكات/علاقات متكررة — شاشة «التعاملات» الموحّدة = قائمة العملاء مع ملخصهم المالي وعقودهم (docstring :1-8): سطر عميل = إجمالي/محصّل/متبقي، والدخول للعقد عبر ملف العميل/مركز العقد.
- **القواعد:**
  - القيمة الحالية لكل عقد من `contract_current_value` (أصلي + أوامر تغييرية) والملخص: `total = Σcurrent للعقود غير الملغاة`، `collected = Σقبض سارٍ`، `remaining = total − collected` (:462-469).
  - تأخر فعلي: `overdue_plan_items` ⇒ تلوين المتبقي أحمر مع «عليه قسط متأخر منذ X يومًا» (:443-460, :556-565).
  - فلاتر: الكل/لهم عقود نشطة/عليهم متبقٍ/بلا عقود (:71-77)؛ فرز 4 خيارات (:80-85)؛ ترقيم 50/صف (:495-497)؛ بحث مؤجل 420ms (:61-67).
  - شريط إجراءات عند التحديد: فتح الملف/عقد جديد/قبض/صرف/كشف حساب/أكثر (:146-177)؛ مؤشرات مجلد الشير 💬/📌/🔴 (:511-540).
- **الدفع من هنا:** `open_voucher` (ui/actions.py) يمرر العميل/العقد — وبالنسبة للباطن تمرر `sub_contract_id` (ui/subcontractor_page.py:632-649).

---

## H) مجموعات العقود `contract_group_service`

- **الغرض (docstring :1-6):** ضم عدة عقود مستقلة في حزمة متابعة واحدة — «ربط تنظيمي فقط» لا يدمج ماليًا ولا يغيّر نوع العقود (تصميم + إشراف + كتاب بلدية كعقود مستقلة تُعرض كملف واحد).
- **قواعد الإنشاء:** رقم آلي `GRP-%04d` (:11-25)؛ عقدين على الأقل (:31-32)؛ نفس العميل (:43-44)؛ لا عقد ملغى (:45-46)؛ إعادة محاولة عند تكرار الرقم حتى 8 مرات (:59-77).
- **الملخص المالي** `list_groups` (:81-151): لكل عقد غير ملغى: `current = contract_current_value`، `collected = Σقبض سارٍ`، `paid = Σصرف سارٍ`، `subs = total_sub_contracts`، **`cost = paid + max(0, subs − paid)`** (التكلفة = المنصرف + باقي التزامات الباطن :134)، `profit = collected − cost`، `margin% = profit/collected×100` (:139-148). منع التكرار داخل المجموعة بـUNIQUE (تعليق :86-87).
- تُستخدم في شاشة مجموعات العميل (contract_hub) وليس في مالية البوابة.

---

## I) حذف/إلغاء الباطن `sub_delete_service` + `sub_delete_dialog`

- **الفلسفة (docstring :1-13):** خيارات منفصلة بدل حذف المقاول كاملًا؛ «لا يمسّ بنود عقد العميل أبدًا».
- **① حذف عقود باطن محددة** `delete_contracts` (:167-181) → `lc.delete_sub_contract` (lifecycle_service.py:1135-1190):
  - **حالات الرفض:** سند صرف **سارٍ** مرتبط بعقد الباطن (:1140-1142) أو سند سارٍ للمقاول على نفس عقد العميل **بلا** ربط بعقد باطن (قديم/غامض) (:1144-1152) ⇒ «ألغِ السندات أولًا»؛ مطالبات `claims` (:1157-1164).
  - **ماذا يفعل:** السندات الملغاة تُفكّ (`sub_contract_id=NULL`) وتبقى في السجل (:1165-1167)؛ تُحذف `sub_payment_sources` ثم `sub_payment_plan` (:1169-1177)؛ أوامر التغييرية الجانبية (side='sub') تُحذف وتُفكّ addendums (:1178-1186)؛ `sub_contract_items` ثم صف العقد (:1187-1188)؛ حدث «حذف عقد باطن» على العقد الأب (:1189-1190).
- **② حذف/إلغاء سندات المقاول** `delete_vouchers` (:184-215): **حساب المطور فقط = حذف نهائي** موثّق (`purge_service.purge_vouchers`)؛ غيره = **إلغاء موثّق** (`lc.cancel_voucher`) ويُفتح ما عُلّق به؛ السبب إلزامي ويُحفظ في سجل التدقيق (:197-200).
- **③ حذف سجل المقاول** `delete_record` (:218-235): **يُرفض ما دام عليه أي عقد أو سند** (`overview.can_delete_record` :148-161 — «احذفها من هذه الشاشة أولًا»)؛ حتى لو فارغ: الزر متاح **للمطور فقط** في الواجهة (sub_delete_dialog.py:273-284)؛ ينفّذ `purge_subcontractor(delete_contracts=False, delete_vouchers=False)` مع سبب.
- **نظرة الحذف** `overview` (:51-161): عدادات لكل عقد (بنود/دفعات/سندات سارية/مطالبات) + سبب المنع لكل سطر (`can_delete/block_reason` :101-107) + ملخص القيم؛ الواجهة تعطّل ✔ المعطوب وتعلّل (sub_delete_dialog.py:42-55, 207-284).
- لا «حذف شجري كاسكيد» للمقاول إطلاقًا — الكاسكيد الوحيد على مستوى DB هو `sub_contract_items/sub_payment_plan/sub_payment_sources` مع عقد الباطن (database.py:663,793,809).

---

## اقتراح نماذج Prisma (Next.js/Prisma)

> اصطلاحات: `Decimal` للنقود (3 خانات)؛ الأسماء إنجليزية مع الحفاظ على القيم العربية كما هي؛ الفهارس الفريدة مطابقة للأصل.

```prisma
model Subcontractor {
  id                Int      @id @default(autoincrement())
  subCode           String   @unique // sub_code
  name              String
  phone             String?  @default("")
  email             String?  @default("")
  activity          String?  @default("")
  notes             String?  @default("")
  showAllContracts  Boolean  @default(false)
  createdAt         DateTime @default(now())
  subContracts      SubContract[]
}

model SubContract {
  id               Int       @id @default(autoincrement())
  subcontractorId  Int
  contractId       Int
  projectId        Int?
  amount           Decimal   @db.Decimal(14, 3)
  startDate        String?   @default("") // نص في الأصل؛ يفضَّل Date?
  endDate          String?   @default("")
  status           String    @default("نشط") // نشط/متوقف/منتهي/ملغى
  description      String?   @default("")
  cancelReason     String?   @default("")
  cancelledAt      String?   @default("")
  cancelCloseAmount Decimal  @default(0) @db.Decimal(14, 3)
  createdAt        DateTime  @default(now())
  subcontractor    Subcontract @relation(fields: [subcontractorId], references: [id]) // RESTRICT
  contract         Contract    @relation(fields: [contractId], references: [id])
  items            SubContractItem[]
  planLines        SubPaymentPlan[]
  @@Index([contractId])
}

model SubContractItem {   // يبقى بلا تغيير دلالي
  id            Int     @id @default(autoincrement())
  subContractId Int
  boqItemId     Int?
  qty           Decimal @default(0)  @db.Decimal(14, 3)
  unitPrice     Decimal @default(0)  @db.Decimal(14, 3)
  amount        Decimal @default(0)  @db.Decimal(14, 3)
  sourceKind    String? @default("") // 'boq' | 'plan' للبنود المنزّلة V8.3
  sourceId      Int     @default(0)
  subContract   SubContract @relation(fields: [subContractId], references: [id], onDelete: Cascade)
  boqItem       BoqItem?    @relation(fields: [boqItemId], references: [id], onDelete: Cascade)
}

model SubPaymentPlan {
  id            Int      @id @default(autoincrement())
  subContractId Int
  title         String
  dueDate       String
  amount        Decimal  @db.Decimal(14, 3)
  sortOrder     Int      @default(0)
  stageId       Int?     // → contract_stages لعقد العميل الأب
  notes         String?  @default("")
  triggeredAt   String?  @default("")
  createdAt     DateTime @default(now())
  subContract   SubContract @relation(fields: [subContractId], references: [id], onDelete: Cascade)
  stage         ContractStage? @relation(fields: [stageId], references: [id])
  sources       SubPaymentSource[]
  links         VoucherPaymentLink[]
  @@Index([subContractId])
}

model SubPaymentSource { // N:M — الاستحقاق باكتمال كل المصادر
  id         Int @id @default(autoincrement())
  subLineId  Int
  custLineId Int
  subLine    SubPaymentPlan @relation(fields: [subLineId],  references: [id], onDelete: Cascade)
  custLine   PaymentPlan    @relation(fields: [custLineId], references: [id], onDelete: Cascade)
  @@unique([subLineId, custLineId])
}

model GatewayProfile {
  id          Int     @id @default(autoincrement())
  name        String  @unique
  bankAccount String  @default("")
  methods     String  @default("KNET") // كلمات مفصولة بفاصلة
  lagDays     Int     @default(1)
  feeFixed    Decimal @default(0) @db.Decimal(14, 3)
  tolerance   Decimal @default(0.005) @db.Decimal(14, 3)
  lateDays    Int     @default(3)
  isActive    Boolean @default(true)
}

model GatewayOp {
  id               Int     @id @default(autoincrement())
  gateway          String  @default("")
  opDate           String  @default("")
  phone            String  @default("")
  amount           Decimal @default(0) @db.Decimal(14, 3)
  ref              String  @default("")
  status           String  @default("")   // mine/other/unmarked/diff(legacy)
  receiptNo        String  @default("")
  customer         String  @default("")
  batch            String  @default("")
  paidTransferId   Int?    @default(0)
  classifiedManual Boolean @default(false)
  distributed      Boolean @default(false)
  distributedAt    String? @default("")
  gwPaid           Int?    // 1 محوّلة 0 معلقة 2 ملغاة -1 فاشلة NULL غير معروفة
  gwPaidDate       String  @default("")
  gwToken          String  @default("")
  effectiveDate    String  @default("")   // T+1 للأخرى
  createdAt        DateTime @default(now())
  allocs           TransferOpAlloc[]
  feeLinks         GatewayFeeVoucher[]
  @@unique([gateway, opDate, phone, amount, ref])
  @@Index([gateway, distributed, status])
}

model BankLine {
  id          Int     @id @default(autoincrement())
  bankAccount String  @default("")
  cdate       String  @default("")
  amount      Decimal @default(0) @db.Decimal(14, 3)
  descr       String  @default("")
  batch       String  @default("")
  createdAt   DateTime @default(now())
  @@unique([bankAccount, cdate, amount, descr])
}

model OtherCompanyTransfer {
  id            Int     @id @default(autoincrement())
  tdate         String  @default("")
  amount        Decimal @default(0) @db.Decimal(14, 3)
  ref           String  @default("")
  notes         String? @default("")
  method        String? @default("")
  voucherId     Int     @default(0)  // legacy — لا يُنشأ سند في المسار الحالي
  voucherNumber String? @default("")
  createdAt     DateTime @default(now())
  allocs        TransferOpAlloc[]
}

model TransferOpAlloc { // توزيع التسديد على العمليات (جزئي)
  id          Int     @id @default(autoincrement())
  transferId  Int     @default(0)
  opId        Int     @default(0)
  amount      Decimal @default(0) @db.Decimal(14, 3)
  transfer    OtherCompanyTransfer? @relation(fields: [transferId], references: [id])
  op          GatewayOp?            @relation(fields: [opId], references: [id])
  @@Index([opId]); @@Index([transferId])
}

model OtherCompanyOpening { @id Int // id=1 دائمًا
  id        Int     @id
  amount    Decimal @default(0) @db.Decimal(14, 3)
  note      String? @default("")
  updatedAt DateTime @updatedAt
}

model GatewayFeeVoucher { // legacy V4.52
  opId       Int @id
  voucherId  Int
  transferId Int
  fee        Decimal @db.Decimal(14, 3)
}

model MatchAlias {
  id         Int     @id @default(autoincrement())
  filePhone  String  @default("")
  fileName   String  @default("")
  customerId Int     @default(0)
  createdAt  DateTime @default(now())
  @@unique([filePhone, fileName])
}

model VoucherPaymentLink { // مشترك قبض/صرف
  id        Int     @id @default(autoincrement())
  voucherId Int
  kind      String  // receipt | payment
  lineId    Int     // payment_plan.id أو sub_payment_plan.id
  amount    Decimal @db.Decimal(14, 3)
  createdAt DateTime @default(now())
  voucher   Voucher @relation(fields: [voucherId], references: [id])
  subLine   SubPaymentPlan? @relation(fields: [lineId], references: [id]) // عند kind=payment
  @@unique([voucherId, lineId]); @@Index([voucherId]); @@Index([lineId])
}

model ExpenseAccount {
  id                     Int     @id @default(autoincrement())
  parentId               Int?
  name                   String
  fullPath               String? @default("")
  isActive               Boolean @default(true)
  allowPosting           Boolean @default(true)
  includeInProfitability Boolean @default(true)
  accountKind            String  @default("expense") // expense | advance
  sortOrder              Int     @default(0)
  parent                 ExpenseAccount?  @relation("tree", fields: [parentId], references: [id], onDelete: SetNull)
  children               ExpenseAccount[] @relation("tree")
}

model ContractGroup {
  id          Int    @id @default(autoincrement())
  groupNumber String @unique // GRP-0001
  customerId  Int
  groupName   String
  notes       String? @default("")
  createdBy   String? @default("")
  items       ContractGroupItem[]
}
model ContractGroupItem {
  id         Int @id @default(autoincrement())
  groupId    Int
  contractId Int
  @@unique([groupId, contractId])
}
```
ملاحظات ترحيل: أنواع `sub_pay_client_gate` و`bank_fee_amount/bank_fee_method` و`opening_balance` تذهب إلى جدول `Setting` مفرد؛ أرقام السندات عبر `NumberSequence` (database.py:1975)؛ `schema_flags` تُستبدل بجداول migration حقيقية؛ الأعمدة النصية للتواريخ في المصدر تُستقبل كما هي ثم تُطبَّع في حدود الـAPI.

## اقتراح مسارات API

**الباطن**
- `GET/POST /api/subcontractors` · `GET/PATCH/DELETE /api/subcontractors/:id`
- `GET /api/subcontractors/tree?search=` (شجرة + مدفوع/متبقي — lifecycle:835)
- `GET/POST /api/sub-contracts` · `GET/PATCH/DELETE /api/sub-contracts/:id` (DELETE = قواعد I)
- `PUT /api/sub-contracts/:id/items` (بنود + منزّلة) · `GET /api/sub-contracts/:id/plan`
- `POST /api/sub-contracts/:id/plan/lines` · `PATCH/DELETE /api/sub-contracts/:id/plan/lines/:lineId`
- `POST /api/sub-contracts/:id/plan/distribute` (V6.1/V6.6) · `GET /api/sub-contracts/:id/plan/preview?total=&boqItemIds=`
- `GET /api/sub-contracts/:id/pay-blocks` (كتلة الجدول الموحّد B) · `GET /api/subcontracts/:id/payments` (SubPaymentsDialog)
- `GET /api/contracts/:id/sub-payment-limit` (سقف الدفع A.4 — يعرض total/paid/remaining)
- `GET /api/payment-link/due-lines?kind=payment&subContractId=` (بوابة الصرف + gated) · `POST /api/payment-link/validate` · `POST /api/payment-link/distribute`
- `POST /api/sub-delete/overview` · `POST /api/sub-delete/contracts` · `POST /api/sub-delete/vouchers` · `POST /api/sub-delete/record`

**البوابة والتصفية**
- `GET/POST /api/gateway/profiles` · `PATCH/DELETE /api/gateway/profiles/:id`
- `POST /api/gateway/settlement-file` (رفع ملف: قراءة+مطابقة+تثبيت — يعيد rows+summary+checklist)
- `GET /api/gateway/ops?gateway=&filter=&q=` · `PATCH /api/gateway/ops/classify` (set_row_class/bulk)
- `POST /api/gateway/ops/distribute` · `POST /api/gateway/ops/undistribute` (undo incl. other)
- `POST /api/gateway/ops/link-manual` · `POST /api/gateway/ops/unlink-manual` · `GET/DELETE /api/gateway/aliases`
- `GET /api/gateway/daily-clearing?from=&to=&gateway=` · `GET /api/gateway/day-detail?gateway=&day=`
- `GET /api/gateway/unmatched-bank` · `POST /api/gateway/bank-lines` (استيراد كشف)
- `GET /api/gateway/late-settlements` · `DELETE /api/gateway/all` (مسح شامل بتأكيد نصي)
- `GET /api/gateway/summary` (T+1 pending vs collected — report_service:1608)

**الشركة الأخرى**
- `GET /api/other-company/balance` · `GET/PUT /api/other-company/opening`
- `GET /api/other-company/due-items` (صافي) · `GET /api/other-company/paid-items` · `GET /api/other-company/ops-report?from=&to=`
- `GET /api/other-company/ledger?from=&to=` · `GET /api/other-company/daily-settlement?from=&to=`
- `POST /api/other-company/transfers` (opIds اختياري) · `GET /api/other-company/transfers?from=&to=`
- `GET /api/other-company/transfers/:id/coverage` · `DELETE /api/other-company/transfers/:id`
- `GET /api/other-company/external-report?from=&to=` · `GET /api/other-company/upload-batches`

**مجموعات العقود / الحسابات / التعاملات**
- `GET/POST /api/contract-groups` · `GET /api/contract-groups/:id` · `GET /api/contract-groups/by-contract/:contractId`
- `GET/POST /api/expense-accounts` · `PATCH /api/expense-accounts/:id` · `POST /api/expense-accounts/:id/toggle-active`
- `GET /api/dealings?chip=&sort=&q=&page=` (ملخص العميل + تأخر)
- `GET /api/contracts/:id/settlement` (closable) · `POST /api/contracts/:id/close`
