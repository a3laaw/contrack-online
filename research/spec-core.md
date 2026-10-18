# مواصفة القواعد المالية الجوهرية — ConTrack V9.15.18 (Task 2-a)

> المصدر: `/home/z/my-project/contrack_v9.15.18/app/` (PySide6 + SQLite). كل قاعدة أدناه موثقة بمرجع `ملف:سطر`.
> الهدف: مرجع حرفي لبناء نسخة الويب Next.js/Prisma/TypeScript.
> قواعد عامة في المصدر: عتبة الأرقام **0.001** (تظهر كـ `0.001/0.0005/1e-9` في المقارنات)، والتواريخ نصية `YYYY-MM-DD` (TEXT في SQLite)، والمبالغ REAL بثلاث خانات (تنسيق العرض `fmt_money` بثلاث خانات: `settings_service.py:221-224`).

---

## 0) جدول مخطط الجداول ذات الصلة (مصدر الحقيقة: database.py)

| الجدول | أعمدة جوهرية | المعنى/القيد | مرجع |
|---|---|---|---|
| `contracts` | `id, contract_number UNIQUE, customer_id→customers, contract_date, description, amount REAL CHECK(>0), notes, created_at` + أعمدة الترقية | `amount` = القيمة الأصلية فقط (لا تُخزَّن القيمة الحالية أبدًا) | database.py:253-262 |
| ↑ أعمدة مضافة | `contract_name, project_id, contract_type, manual_path, sign_date, start_date, end_date, status('نشط'), currency('د.ك'), sup_start_date, sup_months, sup_monthly, sup_discount, sup_waived_months, sup_waive_reason, status_reason, cancelled_at, cancel_close_amount, qty, unit_price, created_by, updated_at, updated_by` | دورة حياة العقد + بيانات الإشراف + التسعير بالكمية | database.py:1404-1430, 1862-1869 |
| ↑ trigger اسم العقد | `contract_name = COALESCE(NULLIF(TRIM(contract_type),''),'غير محدد')` على INSERT وعلى UPDATE OF contract_type | الاسم المعروض = نوع العقد، غير قابل للتحرير | database.py:1443-1463 |
| `customers` | `customer_code UNIQUE, name, phone, address*, email, notes, folder_path, folder_seen, created_by/updated_by/updated_at` | عميل + مجلد شبكي | database.py:238-251, 1727-1737, 1854-1861 |
| `invoices` | `invoice_number UNIQUE, customer_id, contract_id, invoice_date, amount CHECK(>0)` | فواتير (تُستخدم لمنع تخفيض قيمة العقد) | database.py:264-274 |
| `contract_stages` | `contract_id→contracts, name, level, parent_name, expected_days, pay_pct, pay_kind, sort_order, start_date, end_date, is_skipped, closed_by` + إشراف: `is_supervision, sup_start, sup_end, sup_actual_end, sup_monthly, sup_waived_months, sup_waive_reason` + `deleted_addendum_id` | **نسخة العقد** (Snapshot) من شجرة النوع — إنهاء المرحلة يستحق الدفعة المربوطة | database.py:417-438, 1254-1267, 1664-1668 |
| `payment_plan` | `contract_id CASCADE, title, due_date, amount CHECK(>0), sort_order, stage_id→contract_stages, notes, triggered_at, created_at` + `manual_amount` + `deleted_addendum_id` | خطة سداد العميل؛ `triggered_at` غير فارغ = استحقاق فعلي (انتهت المرحلة) | database.py:770-786, 1661-1663, 2015-2024 |
| `vouchers` | `voucher_number UNIQUE, vtype CHECK IN('payment','receipt','transfer','custody_return','salary_deduction'), vdate, party, party_type, party_id, method, account, expense_account_id/snapshot, expense_group_ref/line, custody_account_id/snapshot, advance_employee_id, amount CHECK(>0), advance_amount, description, project_id, expense_customer_id, contract_id, boq_item_id, sub_contract_id, cost_center, attachment, notes, receipt_group_ref, receipt_group_line` + `parent_voucher_id, cheque_due_date, cancelled, cancel_reason, cancelled_at, allocation` | السندات بأنواعها الخمسة؛ `cancelled` إلغاء ناعم؛ `advance_amount` = دفعة مقدمة/فائض الربط؛ `parent_voucher_id` يربط سند الرسوم بأبيه | database.py:686-717, 1495-1499, 1670-1716, 2029-2053 |
| `voucher_payment_links` | `voucher_id→vouchers, kind CHECK IN('receipt','payment'), line_id, amount CHECK(>0), created_at, UNIQUE(voucher_id, line_id)` | **الروابط الصريحة** سند↔خط دفعة (`line_id` = `payment_plan.id` للقبض أو `sub_payment_plan.id` للصرف) | database.py:822-832, 2055-2067 |
| `addendums` | `addendum_number, contract_id CASCADE, addendum_type('أمر تغييري'), adate, reason, description, amount_add, amount_deduct, start/end_date, status('مسودة'), approved_date, notes` + `addendum_type, cancel_reason, cancelled_at, side('client'), sub_contract_id, items_count, applied_at` | أوامر التغيير/العقود الإضافية؛ `status='معتمد'` هو ما يدخل القيمة الحالية | database.py:719-735, 1584-1608 |
| `addendum_items` | `addendum_id CASCADE, side, action('add'), parent_part_id, created_item, restore_deleted_by, applied, boq_item_id, sub_contract_id, subcontractor_id, description, qty, unit, unit_price, amount` + `ref_kind, ref_id` | بنود الأمر التغييري (إضافة/حذف/استرجاع) | database.py:1622-1657 |
| `sub_contracts` / `sub_payment_plan` / `sub_payment_sources` | باطن: `subcontractor_id, contract_id, amount, status`؛ خطة الباطن = مرآة payment_plan؛ `sub_payment_sources(sub_line_id, cust_line_id) UNIQUE` N:M | مصادر دفعة الباطن من دفعات العميل | database.py:648-670, 791-815 |
| `workflow_stages` | `transaction_type, stage_name, stage_order, color, parent_id, expected_days, is_pre_contract, contract_type(''=قالب عام), payment_pct, pay_kind(''/achieve/advance/final/days), is_supervision, sup_monthly, component_key, UNIQUE(transaction_type, contract_type, stage_name)` | قالب مراحل المتابعة (للعقد والصرف والباطن والعميل) | database.py:486-512, 1810-1815 |
| `type_payment_tpl` | `contract_type, pay_no, title, pct, amount_fixed, stage_id→workflow_stages, trigger_stage_id→workflow_stages, days_offset, link_keyword, UNIQUE(contract_type, pay_no)` | **قالب دفعات النوع**؛ `trigger_stage_id` = المرحلة المحفِّزة | database.py:440-454, 2082-2087 |
| `type_payment_stages` | `payment_id→type_payment_tpl, stage_id→workflow_stages, UNIQUE(stage_id)` | الدفعة تجمع عدة مراحل، والمرحلة تتبع دفعة واحدة | database.py:458-463 |
| `contract_types` | `name UNIQUE, default_amount, notes, active, manual_track, unit_label, unit_price, pricing_mode('lump/unit/items/bundle'), is_supervision` | أنواع العقود المعتمدة | database.py:1740-1774 |
| `type_bundle_components` / `contract_components` | تعريف مكوّن الشامل: `comp_key, label, kind('qty/supervision/items'), required, default_*`؛ لقطة العقد: `contract_id CASCADE, comp_key UNIQUE, enabled, qty, months, monthly` | العقد الشامل V3.30 | database.py:1778-1807 |
| `contract_scope` | `contract_id, template_stage_id, UNIQUE(contract_id, template_stage_id)` | نطاق العقد = مراحل القالب المختارة (فارغ = الكل) | database.py:1943-1948 |
| `claims` | `claim_number UNIQUE, direction IN('out','in'), contract_id, sub_contract_id, cust_line_id→payment_plan, sub_line_id→sub_payment_plan, title, amount CHECK(>0), due_date, status('registered'), voucher_ref, postponed_until` | المطالبات المالية | database.py:1920-1940, 2075-2080 |
| `journal_entries` | `entry_date, description, debit_account, credit_account, amount, project_id, contract_id, boq_item_id, sub_contract_id, cost_center, source_type, source_id` | قيود مولّدة آليًا (source_type='voucher…'/'contract') | database.py:746-761 |
| `settings` (id=1 صف واحد) | انظر القسم I | إعدادات الشركة والمفاتيح المالية | database.py:276-295, 1361-1556 |
| `payment_methods` | `name UNIQUE, fee_type('amount'/'percent'), fee_value, is_active` | طرق الدفع ورسومها | database.py:1532-1556 |
| `users` / `user_permissions` | `username UNIQUE, password_hash, salt, role('admin'), full_name, job_title`؛ صلاحيات: `user_id, perm_key, allowed, UNIQUE(user_id,perm_key)` | مستخدمون وصلاحيات دقيقة | database.py:297-313, 1832-1843 |
| `number_sequences` | `name PK('table.column.PREFIX'), last_no` | عدّادات ترقيم مفهرسة | database.py:1974-1976 |
| `audit_log` | `timestamp, username, action, entity_type, entity_id, entity_name, old_status, new_status, reason, ip_address` | سجل تدقيق عام | database.py:2161-2176 |
| `entity_backups` / `cancel_audit_log` | JSON snapshot + سجل إلغاء/استرجاع/أرشفة | خدمة الإلغاء الموحد V8.3 | unified_cancel_service.py:293-301, 388-452 |
| فهارس أداء | `idx_vpl_voucher/idx_vpl_line`, `idx_plan_contract(_status)`, `idx_vouchers_type_date/party/receipt_group/…`, `idx_contracts_customer_status` | أهم الفهارس للنسخة الويب | database.py:831-834, 1950-1964 |

---

## A) القيمة الحالية للعقد

**القاعدة الحرفية** (lifecycle_service.py:636-659، الدالة `contract_current_value` / `_contract_current_value_impl`):

```
current = original + additions − deductions + sup_extension
original     = contracts.amount                                   (lifecycle_service.py:638,644)
additions    = Σ addendums.amount_add   WHERE status='معتمد'      (lifecycle_service.py:641-643)
deductions   = Σ addendums.amount_deduct WHERE status='معتمد'     (نفس الاستعلام)
sup_extension = supervision_status(contract_id)["extension_value"] (lifecycle_service.py:646-651)
base_current = original + additions − deductions                  (lifecycle_service.py:654)
```

- **لا يوجد عمود مخزَّن للقيمة الحالية** — تُحسب دائمًا (شعار الملف: contract_service.py:2 «الرصيد يُحسب دائمًا من البيانات ولا يُخزَّن»).
- الاستثناء الوحيد للكتابة: `setup_supervision(touch_amount=True)` يكتب `contracts.amount = max(0, months×monthly − discount)` عند ضبط عقد إشراف (supervision_service.py:253-258)؛ و`touch_amount=False` للتعهد على عقد غير إشرافي دون المساس بالقيمة (supervision_service.py:259-264).
- نسخة مجمّعة للكل: `contract_values_map` بنفس المفاتيح (lifecycle_service.py:585-626).
- **تمديد الإشراف يدخل القيمة في كل التقارير** («قاعدة 35»): dashboard (contract_service.py:614-621)، تقرير الأنواع (contract_type_service.py:296-337)، تقرير المستحقات dues (report_service.py:423-435)، توزيع رسوم البنك على العقود (`_active_contracts_for_allocation`: `value = amount + net_addendum + sup_ext`، lifecycle_service.py:4166-4168).
- تعارض الاستحقاق: عند سند قبض، القيمة المستحقة = `max(contract_current_value, sup.total_due)` (lifecycle_service.py:2380-2384 و4539-4543) — لأن العقد الإشرافي قد تكون قيمته `amount` أقل من `total_due` (الأساس + التمديد).
- منع تخفيض القيمة تحت الفواتير: `update_contract` يرفض `amount < total_invoiced` (contract_service.py:475-481)؛ ومنع خصم من الملحق يجرّ القيمة تحت المحصّل (lifecycle_service.py:494-506).
- `dashboard_stats`: إجمالي العقود = Σ(amount حيث status≠'ملغى') + Σ(معتمد add net) + Σ extensions_map (contract_service.py:602-621).

## B) تغطية سندات القبض للدفعات (FIFO + روابط صريحة)

**المصدر:** `_contract_payment_plan_impl` (lifecycle_service.py:5718-5788) — **التغطية قراءةً (محسوبة لحظة القراءة)، لا تخزينًا**؛ الحالة لا تُخزَّن، فقط الروابط الصريحة ورصيد التقدّم مخزَّنان.

الخوارزمية الحرفية:
1. اجلب خطوط الخطة `ORDER BY pp.due_date, pp.sort_order` (lifecycle_service.py:5730) — **ترتيب FIFO = تاريخ الاستحقاق ثم sort_order**.
2. `collected` = Σ `vouchers.amount WHERE contract_id=? AND vtype='receipt' AND cancelled=0 AND (allocation IS NULL OR allocation='')` (5731-5736). (السندات ذات `allocation` مخصصة لبند أمر تغييري فتُستبعد من الخطة.)
3. `_links` = لكل `line_id`: Σ `voucher_payment_links.amount` للروابط `kind='receipt'` لسندات غير ملغاة بـ `allocation=''` (5738-5746).
4. `remaining_pool = max(0, collected − Σ_links)` (5748).
5. لكل خط بالترتيب: `covered = min(pool, amount); pool −= covered` ثم الروابط الصريحة `covered += min(link, amount − covered)` (5749-5754).
6. `remaining = amount − covered` (5756).

- الروابط الصريحة: جدول `voucher_payment_links` (أنواع الأعمدة أعلاه) — `UNIQUE(voucher_id, line_id)` وتوزيع الزيادة على أكثر من خط = صف مستقل لكل خط (database.py:822-832؛ voucher_payment_link_service.py:1-15, 298-303).
- **الإدخال**: `apply_links` (voucher_payment_link_service.py:372-436) داخل معاملة حفظ السند: يمسح روابط السند أولًا (`reverse_links` 339-344 — idempotent)، يُدخل ما لا يتجاوز `room_for` (المساحة = قيمة الخط − Σ روابط سندات سارية أخرى، وقيدة بالمتبقي المعروض: 306-336)، ثم **يوزّع الفائض** (`spread`) على الدفعات المستحقة التالية بالترتيب مع تخطي الموقوفة بالبوابة (408-428)، وما يبقى بعدها يُخزَّن في `vouchers.advance_amount` (429-436) = **دفعة مقدمة على السند** لا تُنسب لأي دفعة.
- **قاعدة التتابع** V9.15.17: المحدد يجب أن يكون بادئة من الدفعات غير المسددة (المفتوحة) بالترتيب، والموقوفة لا تمنع ما بعدها (`check_selection` 477-502)؛ والتوزيع الآلي `distribute` (505-562) مع «الجزء الثاني/الثالث…» حسب عدد السندات السابقة المرتبطة (`_prev_link_count` 463-474).
- استبعاد سند (تعديل/معاينة): `contract_payment_plan_excluding` / `sub_payment_plan_excluding` (lifecycle_service.py:5797-5808) — يُحسب المستحق كأن السند غير موجود.
- **عقد الباطن** (مرآة): `_sub_payment_plan_impl` (lifecycle_service.py:1230-1356) — ترتيب FIFO بـ `sort_order` (1241)، المدفوع = Σ سندات صرف `sub_contract_id=?` بلا allocation (1242-1247) + **سندات صرف قديمة غير مربوطة** تُحتسب فقط إذا كان للمقاول عقد باطن واحد على نفس عقد العميل (1251-1272)؛ وإلا تُذكر بعددها ومبلغها على أول خط (1276-1302). الروابط `kind='payment'` (1306-1316). **بوابة تحصيل العميل**: دفعة المقاول المستحقة تصبح `gated` إن كان لمصادرها من `payment_plan` (N:M في `sub_payment_sources`) متبقٍّ > 0.001 والمفتاح `sub_pay_client_gate` مفعّل (voucher_payment_link_service.py:31-48, 166-181).
- إعادة فتح الدفعات عند إلغاء قبض: `_comment_receipt_cancel_reopens_plan` يعيد حساب البواقي ويحدّث `notes` + تعليق نظام (lifecycle_service.py:4649-4698).

## C) سقف القبض (Overpay) — أين يُفحص، تحذيري أم قاطع؟

- **موضع الفحص 1 — إنشاء سند قبض على عقد** (`add_voucher`, lifecycle_service.py:2373-2391):
  `due_value = max(contract_current_value["current"], sup["total_due"])`؛ `remaining = due_value − Σ receipts(cancelled=0)`؛ إذا `amount > remaining + 1e-9`:
  - `allow_overpay=False` ⇒ يرمي `OverpayWarning` (رسالة: «قيمة السند تتجاوز المبلغ المتبقي من العقد… سيتم تسجيل الزيادة كـ (دفعة مقدمة) على العقد.»).
  - `OverpayWarning` فئة ترث `ValidationError` (lifecycle_service.py:17-19) — **تحذيري قابل للتجاوز**: الواجهة تعرض التأكيد وتعيد النداء بـ `allow_overpay=True`؛ ليس قاطعًا نهائيًا.
  - الزيادة لا تُخزَّن في عمود للعقد؛ تظهر طبيعيًا كـ `collected > current` ويصدرها تعليق تلقائي «يوجد دفع مقدم/زيادة: X» (`_auto_receipt_comment`, lifecycle_service.py:347-352).
- **موضع 2 — تعديل سند قبض** (`update_voucher`): نفس الفحص مع `collected_others` مستثنيًا السند نفسه (lifecycle_service.py:4532-4550).
- **موضع 3 — سند قبض مجمع** (`add_grouped_receipts`): فحص لكل سطر قبل إنشاء أي سند حتى لا يُحفظ جزئيًا (lifecycle_service.py:4011-4031).
- **موضع 4 — سقف الصرف للمقاول** (`_check_sub_payment_limit`): `remaining = Σ sub_contracts(غير ملغاة) − Σ سندات صرف للمقاول على العقد`؛ تجاوز ⇒ `OverpayWarning` بنفس النمط مع `allow_overpay` (lifecycle_service.py:1919-1944؛ يستدعى من add_voucher:2283-2284 وupdate_voucher:4528-4530).
- **سقف خطة السداد**: مجموع الدفعات ≤ القيمة الحالية + 0.001 في `add_plan_item` (5434-5442)، `update_plan_item` (5471-5479)، `validate_plan_amount_overrides` (5494-5521)، `update_plan_amount_overrides` (5593-5599).
- **سقوف قاطعة (ValidationError حقيقية)**: قيمة العقد > 0 (contract_service.py:366-367)، رصيد مصدر التحويل (`_ensure_transfer_source_balance`, lifecycle_service.py:2077+، فحص في 2234)، متبقي العهدة للإرجاع (2303-2310)، متبقي سلفة الموظف (2321-2338)، جاري الشريك للمدير فقط (2208-2211)، عقد ملغى مجمّد ماليًا (`_ensure_contract_accepts_financial_actions` 1948-1957)، عقد باطن ملغى لا يُصرف عليه (1960-1969).

## D) حالات الدفعة/المرحلة — الشروط الحرفية

المصدر: `_contract_payment_plan_impl` (lifecycle_service.py:5749-5787) وبالمثل `_sub_payment_plan_impl` (1318-1355). الحالة **تُحسب دائمًا** ولا تُخزَّن. الأعمدة الداخلة في القرار: `payment_plan.stage_id`, `triggered_at`, `amount`, `due_date` + `contract_stages.is_skipped/end_date`.

بالترتيب الحرفي للفحص:

| # | الحالة (حرفيًا) | الشرط بالضبط | مرجع |
|---|---|---|---|
| 1 | `مرحلة متخطاة` (skipped) | `stage_id` غير فارغ **و** `contract_stages.is_skipped=1` — ويُملأ notes: «غير مستحقة لأن المرحلة المرتبطة تم تخطيها» | 5763-5768 |
| 2 | `بانتظار إنجاز المرحلة` (awaiting_stage) | `stage_id` غير فارغ **و** `triggered_at=''` **و** `remaining > 0.001` — days_diff=999999 | 5769-5773 |
| 3 | `مدفوع` (paid) | `remaining ≤ 0.001` | 5775-5776 |
| 4 | `جزئي` (partial) أو `متأخر` (overdue) | `covered > 0.001`: `جزئي` إذا `due ≥ today` وإلا `متأخر` | 5777-5778 |
| 5 | `متأخر` (overdue) | بلا تغطية و`due < today` | 5779-5780 |
| 6 | `مستحقة` (due) | بلا تغطية و`triggered_at` غير فارغ (المُثارة وحلّ أجلها = مستحقة، V4.5.03) | 5781-5783 |
| 7 | `مستحق قريبًا` (upcoming≤7) | `(due − today).days ≤ 7` | 5784-5785 |
| 8 | `لم يحل` (upcoming>7) | غير ذلك | 5786-5787 |

- **تفعيل الاستحقاق `triggered_at`**: عند إنهاء مرحلة على العقد يستدعى `trigger_due_payments(contract_id, stage_id, finish_date)` (workflow_service.py:4600-4664): يجد سطور الخطة `stage_id=? AND triggered_at=''`، ويعيد حساب البواقي بنفس FIFO، ثم `UPDATE payment_plan SET due_date=finish_date, triggered_at=finish_date, notes='مستحقة لانتهاء مرحلة «X» بتاريخ Y'` (أو «…والدفعة كانت مسددة مسبقًا» إن كانت مغطاة) — ويطلق مطالبات تلقائية `_fire_auto_claims` (4663, 4420+). تراجع الاستحقاق عند إعادة فتح المرحلة: `UPDATE … SET triggered_at='', notes=''` (workflow_service.py:1604-1719, 2052-2130). تخطي مرحلة: `_mark_skipped_stage_payments` يسجل سبب عدم الاستحقاق (workflow_service.py:4373-4390).
- **بوابة المرحلة في الربط**: الدفعات القابلة للربط بسند = الحالات في `_REACHED = ("مستحقة","متأخر","جزئي","مستحق قريبًا")` مع `remaining>0.001`، و`مستحق قريبًا` تُعتبر وصلت فقط إذا `triggered_at` غير فارغ (`_reached`, voucher_payment_link_service.py:25, 86-94؛ eligible في 160-161).
- **تقرير المستحق الآن (strict)**: `_overdue_plan_items_impl` بنفس الاستثناءات، يستبعد العقود `('مغلق','ملغى')`، strict ⇒ `days_diff ≤ 0` فقط، غير strict ⇒ نافذة 7 أيام (lifecycle_service.py:5811-5923).
- حالات العقد نفسها: `CONTRACT_STATUSES = ["مسودة","تحت المراجعة","معتمد","نشط","متوقف","منتهي","مغلق","ملغى"]` (lifecycle_service.py:11-12)؛ إلغاء يحفظ `status_reason` و`cancel_close_amount` و`cancelled_at` (`change_contract_status` 230-276). الأرشفة التلقائية: منتهي المدة ⇒ `منتهي` (5332-5354).

## E) المستحقات (Dues) — الصيغة و«المستحق اليوم»

- **تقرير المستحقات لكل عقد** (`dues_report`, report_service.py:391-449):
  ```
  value     = contracts.amount + net_addendum(معتمد) + sup_extension   (report_service.py:433, 406-414, 423-428)
  collected = Σ vouchers(receipt, cancelled=0)                          (415-418)
  remaining = value − collected ; يُستبعد إذا remaining ≤ 0.001          (434-437)
  ```
  ويستبعد العقود بحالة `('ملغى','مسودة')` (419).
- **«المستحق الآن» (due_now)** (`due_now_by_contract`, report_service.py:470-494):
  - عقد **له خطة دفعات** ⇒ `Σ remaining` لسطور `overdue_plan_items(strict=True)` (ما حلّ أجله فعلًا: متأخر/جزئي متأخر/مستحقة) — lifecycle_service.py:5811-5923.
  - عقد **بلا خطة** وله رصيد ⇒ المستحق الآن = كامل المتبقي (report_service.py:474, 492-493).
  - لكل عميل: `due_now_by_customer` = مجموع عقوده (497-506).
- **تعريض التحصيل** (`overdue_collections`, lifecycle_service.py:5281-5325): عقد عليه متبقٍ و`days_since(last_receipt أو contract_date) ≥ collection_alert_days` (افتراضي 30، أدنى 7 — 5266-5279).
- دفعات الباطن في لوحة المستحقات: صف مشتق لكل عقد باطن بلا خطة (`مستحق عقد الباطن (مشتق)`) وبحالات مطابقة (report_service.py:315-367)، وفلتر `due_only` = `_due_now(r)` = متبقٍّ > 0.001 والحالة ليست من (لم يحل/بانتظار إنجاز المرحلة/مرحلة متخطاة/مدفوع) (369-371).

## F) الإشراف الهندسي

- **تعريف عقد إشراف**: له `sup_start_date` + `sup_months>0` + `sup_monthly>0` (`is_supervision`, supervision_service.py:38-45).
- **الحالة الكاملة** (`supervision_status`, supervision_service.py:71-201):
  ```
  gross_value   = sup_months × sup_monthly                          (100)
  base_value    = max(0, gross_value − sup_discount)                (101)
  base_end      = add_months(sup_start_date, sup_months)            (102, _add_months 26-35)
  extension_months: كل شهر «بدأ» بعد base_end يُحسب كاملًا (ولو يوم) (105-108)
  billable_ext  = max(0, extension_months − sup_waived_months)      (109) — waived يقبل كسورًا (1.5)
  extension_value = billable_ext × sup_monthly                      (110)
  total_due     = base_value + extension_value                      (112)
  collected     = Σ vouchers(receipt, cancelled=0)                  (84-87)
  remaining     = total_due − collected                             (113)
  ```
- تاريخ الإنهاء الفعلي: أغلق مرحلة اسمها يحوي «انهاء» و«اشراف» (تطبيع أ/إ/آ) ⇒ يوقف عدّ الأشهر بعدها (`_actual_supervision_end` 48-61، يُطبَّق 90-91).
- **التأخيرات**: `paid_ext = min(ext_value, collected − base_value)` (134-136)؛ `settled_ext_months = paid_ext_months + waived` (141)؛ `full_end = add_months(start, months + int(settled_ext))` (142)؛ `delay_months` = الشهور التي بدأت بعد `full_end` (144-147)؛ `delay_value = delay_months × monthly` (149)؛ والمدة الفعلية شهور+أيام للعرض فقط (150-159).
- **التنازل (waive)**: `waive_extension_months` — الحد الأقصى = `unpaid_extension_months` فقط (ما دفعه العميل لا يُلغى)، يقبل الكسور، يُلحق السبب بسجل `sup_waive_reason` كسطور (317-354).
- **ضبط الإشراف**: `setup_supervision` — `amount = max(0, gross − discount)` (touch_amount=True) وتحققات (خصم ≤ gross+0.001) (227-268). تحديد البداية/النهاية من مراحل «بداية/إنهاء الإشراف»: `set_supervision_start_from_stage` (271-290) و`set_supervision_end_from_stage` (293-314).
- **بيان سند القبض الإشرافي**: يفصّل الأساس ثم أشهر التمديد بالترتيب مع «جزء… والمتبقي منها X» و«وزيادة مقدمة» + بادئة `desc_prefix_supervision` (357-428).
- **إشراف المرحلة (V3.21)**: عمود `contract_stages.is_supervision/sup_start/sup_end/sup_actual_end/sup_monthly/sup_waived_months/sup_waive_reason`. `setup_stage_supervision` (532-553)، بداية (556-574)، إنهاء يوقف الساعة `sup_actual_end` (577-597)، تنازل (600-629)، إزالة (749-763). `stage_supervision_status` (652-746) بنفس معادلات العقد لكن **بلا سندات** (collected=0 دائمًا) و**التعهد يفوز**: إن كان للعقد `sup_months/sup_monthly` فالمرحلة تعيد None لمنع الازدواج (638-649, 663-667).
- خرائط جاهزة: `extensions_map` (كل عقد دخل التمديد، بلا فلتر متبقٍّ — للقيمة)، `contracts_in_extension` (مديونية قائمة فقط — للتنبيهات)، `contracts_near_base_end(30 يوم)` (479-501, 431-447, 450-476).

## G) الإلغاء الموحّد (unified_cancel_service.py — V8.3)

- **مبدأ**: لا حذف نهائي — الإلغاء = أرشفة + عكس قيد + سجل تدقيق (1-14).
- **مصفوفة الكيانات والحالات** (`STATUSES` 25-64): voucher (draft/active/cancelled/archived)، contract وsub_contract (draft/active/completed/cancelled/archived)، claim (registered/sent/in_review/approved/refused/collected/paid/cancelled/archived)، custody (active/settled/closed/cancelled/archived).
- **انتقالات مسموحة** (`TRANSITIONS` 67-106): الأهم — `cancelled → active` (استرجاع) متاح للسند والعقد والمطالبة والباطن والعهدة؛ `archived` قاطع (لا انتقالات).
- **مسار `cancel_transaction`** (112-150): ① `_validate_cancellation` (216-243: موجود وغير ملغى؛ العقد بحالة «ملغى» نصيًا) ② `_create_backup` — نسخة JSON كاملة للصف في `entity_backups` (290-326) ③ `_reverse_accounting_entries` (329-344: تعليق توضيحي — العكس الفعلي للقيود يتم في مسار lifecycle) ④ `_update_status` (357-382: للسند `cancelled=1 + cancelled_at`؛ للعقد/المطالبة/الباطن حالة نصية عربية) ⑤ `_log_cancellation` في `cancel_audit_log` (385-406).
- **`restore_transaction`** (153-186): عكس الحالة إلى active وإعادة القيود + تسجيل `restored_amount`. **`archive_transaction`** (189-210): أرشفة فقط (بشرط ملغى/منتهي — 273-287).
- **الإلغاء التشغيلي الفعلي للسندات** هو `lifecycle_service.cancel_voucher` (4701-4770): إلغاء ناعم `cancelled=1` + سبب + تاريخ؛ **إلغاء تلقائي للأبناء** (سندات الرسوم `parent_voucher_id`) (4757-4764)؛ **عكس قيود** كل المعرفات `_reverse_voucher_journals` (4765؛ الدالة 2611+)؛ منع إلغاء تسليم عهدة/سلفة عليها تصفية أو ردود سارية (4709-4738)؛ منع الإلغاء إذا للمطالبة سارية على العقد (4741-4751)؛ إعادة فتح الدفعات المغطاة بتعليق نظام (4770 → 4649-4698). المبادئ المماثلة في مطالبات: قاعدة 15 إلغاء الرسوم…
- **ترتيب التراجع عند حذف عقد** (`delete_contract`, contract_service.py:509-599): يُرفض وجود أي من: فواتير (521-529)، سندات سارية (531-540)، مطالبات سارية (542-551)، عقود باطن (553-561)، دفعات (563-571)، مراحل (573-581)؛ ثم حذف فعلي: `contract_stages` ثم `payment_plan` ثم `contracts` + حدث تدقيق (583-597).
- إلغاء أمر تغييري: `status='ملغى'` + `restore_parts` تعيد البنود المحذوفة (lifecycle_service.py:543-563).

## H) أنواع العقود (قوالب المراحل/الدفعات، الحقول المخصصة، أنماط الترقيم)

- **نموذج النوع**: جدول `contract_types` (database.py:1740-1774) + خدمة `contract_type_service.py`:
  - أنماط التسعير: `lump` مقطوع، `unit` وحدة×سعر (ومنه الإشراف: شهر×قيمة)، `items` بنود، `bundle` شامل (13-23). `_clean_mode` يشتق من سعر الوحدة إن كان فارغًا (146-151)؛ وهجرة اشتقاق لمرة واحدة (database.py:1770-1774).
  - `type_config` يرجع `{mode, unit_label, unit_price, default_amount, is_supervision, is_bundle, manual_track}` (37-71). قواعد: الشامل لا يكون إشرافيًا (167-171)؛ حذف نوع مستخدم مرفوض لغير المطور (244-281)؛ تغيير الاسم ينعكس على العقود وقالب المراحل وقالب الدفعات ومكوّنات الشامل (224-240).
  - **قرار نمط العقد** (`contract_mode`, contract_service.py:299-336): ① شامل من نوعه ② له بنود ⇒ items ③ له `sup_start_date` ⇒ unit ④ `unit_price>0` ⇒ unit ⑤ نمط نوعه ⑥ افتراضي lump. بيانات العقد تسبق إعدادات النوع (ثبات العقود القائمة).
- **قالب دفعات النوع** `type_payment_tpl`: لكل `pay_no`: `pct` نسبة من قيمة العقد، أو `amount_fixed` مبلغ ثابت، `stage_id` مرحلة تجميع، `trigger_stage_id` **المرحلة المحفِّزة** (إنهاؤها فعليًا يستحق الدفعة)، `days_offset` أيام بعد التوقيع، `link_keyword` كلمات ربط بالبيان مفصولة بـ«،»، و`بدون_مرحلة` = رمز دفعة بلا مرحلة (database.py:440-454؛ types_setup_service.py:36, 48). دفعة تجمع عدة مراحل عبر `type_payment_stages` مع `UNIQUE(stage_id)` (458-463). قواعد التحقق: المُحفِّزة من مراحل الدفعة نفسها، وأكثر من مرحلة تتطلب مُحفِّزة صريحة، والربط بخطوات التنفيذ فقط لا الرئيسية التجميعية (workflow_service.py:2777-2805). الافتراضي الاستحقاق التقديري = أقصى تاريخ متوقع لمراحلها (2936-2941).
- **التوليد للعقد**: `_generate_type_payments_from_template` (workflow_service.py:4266-4325): دفعة مراحلها خارج نطاق العقد لا تُخلق (4290-4293)؛ المبلغ = pct×القيمة أو amount_fixed؛ `due = توقيع + days_offset`؛ `stage_id` = نظيرة مرحلة القالب في **نسخة العقد** عبر ربط اسمي `_template_to_contract_stage_map` (4240-4263)؛ note يشرح النسبة/الثابت/الأيام (4301-4313). خطة أمان بلا قالب: «دفعة كاملة عند بداية التعاقد» مربوطة بأول خطوة و`triggered_at=start_day` (4339-4370). أعِد توزيع الخطة نسبيًا على قيمة جديدة: `rescale_payment_plan` (الدفعة الأخيرة تمتص الكسور) (lifecycle_service.py:5675-5708).
- **التأسيس من Excel** (`types_setup_service.py`): ثلاث أوراق (أنواع/مراحل/دفعات) بأعمدة محددة (59-96)؛ أنواع الدفعة: `نسبة، مبلغ ثابت، مقدمة، ختامية، بعد أيام` (48)؛ تحقق: نسب 0-100، مجموع نسب النوع ≤ 100% و< 100% تحذير (608-619)، `بدون_مرحلة` قاعدة استثناء (566-583)؛ **التنفيذ Add-only** لا يعدّل/يحذف الموجود، وإعادة ترقيم `stage_order` مطابقة للقالب (749-779)، والدفعات عبر `wf.add_type_payment` مع حفظ `link_keyword` (781-830).
- **مراحل نسخة العقد**: تُخزن Snapshot في `contract_stages` عند التوقيع — تعديل القالب لاحقًا لا يمس العقود القديمة (database.py:413-416). مراحل يدوية للشامل: `add_contract_main_stages` (كل مرحلة بدفعتها، المجموع ≤ المتبقي من القيمة) (lifecycle_service.py:1620-1703).
- **أنماط الترقيم**: عدّاد مفهرس `number_sequences` مع UPDATE ذري RETURNING وبذرة من أعلى رقم موجود (`_next_number` 38-65; `_peek_number` 80-92 لا يستهلك; `_sync_counter` 67-77 بعد أرقام صريحة). البادئات: `PRJ` مشاريع، `QUO` عروض (95-96)، `SUB` مقاولون (97-100)، السندات: **RV قبض، PV صرف، TV تحويل، CV إرجاع عهدة، SD خصم راتب** (112-120)، ملحق: `ADD-###` لكل عقد (456-459)، تحويل مجمع: `BT-####` (2810-2828)، عقد: `CON-####` بمسح `LIKE 'CON-%'` وإعادة توليد عند تضارب السباق حتى 8 محاولات (contract_service.py:53-67, 386-462)، وسند: إعادة توليد عند تضارب الرقم (lifecycle_service.py:2399-2426).

## I) الإعدادات — كل المفاتيح المالية المهمة وقيمها الافتراضية

المصدر: جدول `settings` (id=1) — database.py:276-295 + ترقيات 1361-1403 + 1464-1556؛ dataclass `Settings` models.py:73-125؛ تحميل/حفظ settings_service.py:46-218.

| المفتاح | النوع/الافتراضي | الدلالة | مرجع |
|---|---|---|---|
| `currency` | نص 'د.ك' | عملة العرض | database.py:284 |
| `bank_fee_amount` | REAL **0.150** | رسوم سند القبض بالتحويل البنكي | database.py:1467-1469; models.py:110 |
| `bank_fee_method` | نص **'تحويل بنكي'** | الطريقة الخاضعة للرسوم | database.py:1470-1472 |
| `bank_fee_enabled` | INT **1** | احتساب الرسوم (تابع لمديول cashflow) | database.py:1492-1494; settings_service.py:255-261 |
| `cashflow_enabled` | INT **1** | مفتاح مديول التقرير المالي (يخفي الرسوم معه) | database.py:1489-1491 |
| `payment_methods` | صفوف: نقدًا 0 · **تحويل بنكي amount 0.150** · **KNET percent 1.5** · شيك 0 · أخرى 0 | رسوم لكل طريقة (amount/percent) | database.py:1532-1556 |
| `opening_balance / _bank / _cash / _date` | REAL 0 / 0 / 0 / '' | رصيد أول المدة (الافتراضية القديمة كلها صندوق) | database.py:1473-1487; models.py:112-115 |
| `cash_start_date` | TEXT '' | بداية الاحتساب النقدي (الأقدم يُستبعد) | database.py:1397-1399 |
| `sub_pay_client_gate` | INT **1** | بوابة: لا صرف للمقاول قبل تحصيل دفعة العميل المقابلة | database.py:294, 2071-2073; voucher_payment_link_service.py:31-48 |
| `collection_alert_days` | INT **30** (أدنى 7) | نافذة تعريض التحصيل | lifecycle_service.py:5266-5279; database.py:1376 |
| `expiry_alerts` | TEXT **'90,60,30,7'** | تنبيهات انتهاء العقود | database.py:1500-1502 |
| `desc_prefix_receipt/supervision/transfer/custody/stage_note` | TEXT '' | بادئات البيانات التلقائية «بادئة: نص» | database.py:1392-1396; extras_service.py:62-80 |
| `auto_backup_enabled/interval/folder` | 1 / 24 (1-168) / '' | نسخ احتياطي تلقائي | database.py:287-289 |
| `full_backup_*` | enabled 1، كل 7 أيام، يوم الأربعاء(3)، احتفاظ أسبوعي 4/شهري 3 | نسخ كاملة | database.py:1381-1391 |
| `max_users` / `app_name` / `license_key` | 0 (بلا حد) / 'ConTrack' / '' | ترخيص | database.py:1379-1380; models.py:89-90,102 |
| `header_image/footer_image/print_economy/stamp_*/signature_image` | '' / 0 | هوية المطبوعات وموضع الختم mm (±100) | database.py:1503-1529; settings_service.py:190-192 |
| `stages_seeded`, `visits_*` (8-17 ساعة، 60 دقيقة) | 0 / 8,17,60 | بذور المراحل والزيارات | database.py:1384-1387 |
| `ui_prefs` / `ui_theme` | '{}' / 'light' | تفضيلات؛ الثيم الليلي ملغى نهائيًا | database.py:1369,1377 |
| `manager_phone`, قوالب واتساب `task_wa_*`, `wa_*` | '' | رسائل المهام | database.py:1371-1375 |
| تنسيق المبالغ | `f"{value:,.3f}"` | ثلاث خانات عشرية دائمًا | settings_service.py:221-224 |

## J) السندات (Vouchers)

- **الأنواع الخمسة** (CHECK): `payment` صرف، `receipt` قبض، `transfer` تحويل داخلي، `custody_return` إرجاع عهدة (V4.52)، `salary_deduction` خصم من راتب (V4.53) — database.py:689 + هجرات توسيع CHECK بلا فقد بيانات (1041-1168). تسمية عربية: `VOUCHER_TYPE_LABELS` (lifecycle_service.py:101-104).
- **ترقيم**: RV/PV/TV/CV/SD-#### من عدّاد مفهرس (112-120) مع إعادة توليد عند تضارب (2399-2426).
- **حقول جوهرية**: الطرف `party_type IN ('customer','subcontractor','partner')` (PARTY_TYPES 1917) + `party_id`؛ `method` طريقة الدفع و`account` الحساب المعروض (snapshot لحساب المصروف/العهدة)؛ `allocation` تخصيص السند لبند أمر تغييري (يستبعده من خطة السداد)؛ `cheque_due_date` يُحفظ فقط إذا «شيك» في الطريقة (2415, 4593)؛ `receipt_group_ref/line` للتحويل المجمع BT-؛ `parent_voucher_id` يربط سند الرسوم بأبيه (إلغاء الأب يلغي الأبناء)؛ `advance_amount` رصيد/سلفة الربط؛ `custody_account_id` بلا مصروف = «تسليم عهدة» لا مصروف (2340-2366).
- **القيود المحاسبية التلقائية**: عند الإنشاء `_insert_voucher_journal` (2443-2446؛ 2506+) — القاعدة: قبض مدين البنك/الصندوق دائن العملاء/إيرادات العقد، صرف مدين المصروف دائن البنك/الصندوق، تحويل بين الحسابين، تصفية عهدة دائنها العهدة (is_settlement_voucher 1981-2003)، شريك من/إلى «جاري الشريك» (4561-4569).
- **الرسوم البنكية**: `_receipt_bank_fee` (2714-2727): أولاً طريقة الدفع (`fee_type='percent'` ⇒ `round(amount×pct/100,3)`، `'amount'` ⇒ قيمة ثابتة)، وإلا إعداد `bank_fee_amount` إذا الطريقة = `bank_fee_method`، والمديول معطّل ⇒ 0. سند الرسوم = **سند صرف ابن** برقم PV جديد، طرفه «البنك»، `parent_voucher_id`، notes تحتوي `BANK_FEE_MARK`، حساب «عمولات بنكية» مضمون الإنشاء (2730-2807, ensure_bank_commission_account 2644+). بلا عقد ⇒ **توزيع بالقيمة** على العقود النشطة ذات الحركة (`_allocate_by_value`: نصيب = fee×value/Σvalue مع تصحيح الكسر على الأكبر) (4116-4189). **مجمع BT-**: عمولة واحدة على إجمالي التحويل تُقسم **بالتساوي** `_split_even` على السطور (4032-4035, 2951-2960). مزامنة بعد تعديل قبض: `_reconcile_receipt_fees` (إلغاء الأبناء القديم + إنشاء بديل) (2885-2930) و`_cancel_fee_children` (2864-2882).
- **قواعد الحركة**: `amount>0`؛ التحويل: من/إلى مختلفان فعليًا (بنك≠صندوق) ورصيد المصدر كافٍ (2225-2238)؛ إلغاء ناعم فقط (الرقم محفوظ للتسلسل) (1673-1682)؛ ممنوع تعديل الإرجاع/الخصم — ألغِ وأنشئ (4447-4451)؛ تعديل البيان فقط متاح لأدوار محددة (4627-4646)؛ إلغاء الأب يسحب الأبناء (4757-4764).
- **تحويل القالب إلى خطط**: دفعة القالب `days_offset` ⇒ تاريخ تقديري، `trigger_stage_id` ⇒ استحقاق فعلي عند الإنهاء (القسم D).

## K) التفقيط (tafqeet.py)

- تحويل المبلغ إلى «فقط … لا غير» بدعم الدينار الكويتي **3 خانات فلس** (63-87):
  - العملات: «د.ك/دينار» ⇒ دينار كويتي/فلس ×1000؛ «ر.س/ريال» ⇒ ريال/هللة ×100؛ «د.إ/درهم» ⇒ درهم/فلس ×100؛ «ج.م/جنيه» ⇒ جنيه/قرش ×100؛ غير ذلك: اسم العملة كما هو، فلس ×1000 (66-75).
  - التقريب: `total_subs = round(value × sub_per_main)` ثم `main, sub = divmod(total_subs, sub_per_main)` (77-78) — **يقرّب من الفلس أولًا ثم يفصل**.
  - عدد صحيح حتى المليارات: مئات/عشرات/آحاد مع «و» العطف، صيغ المثنى («ألفان، مليونان») وجمع 3-10 («آلاف، ملايين») (4-60)؛ صفر ⇒ «صفر» (46-47).
  - الصياغة النهائية: `فقط {عدد العملة} {وعدد الكسر الكسر} لا غير`، وصفر كلي ⇒ «صفر دينار كويتي لا غير» (80-87).
  - ملاحظة لغوية: `number_to_words(sub)` للفلس يستخدم مفرد/مثنى/جمع الفلس نفسها (لا صيغة تمييز خاصة).

---

## مقترح نماذج Prisma (نسخة الويب)

> مبادئ مستخلصة من المصدر: القيمة الحالية والمتبقي وحالات الدفعات **تُحسب لا تُخزَّن**؛ كل مبالغ REAL ⇒ `Decimal @db.Decimal(18,3)`؛ التواريخ نصية ⇒ `DateTime` مع إخراج ISO أو `String @db.VarChar(10)` حسب الحاجة؛ الإلغاء ناعم دائمًا (`cancelled` + reason + at)؛ عدّادات الترقيم في جدول مستقل بمعاملة ذرية.

```prisma
model Customer {
  id            Int      @id @default(autoincrement())
  customerCode  String   @unique @map("customer_code")
  name          String
  phone         String?  @default("")
  address       String?  @default("")
  // ...governorate/area/block/plot/email/notes/folderPath
  contracts     Contract[]
  createdAt     DateTime @default(now())
  @@map("customers")
}

model Contract {
  id             Int      @id @default(autoincrement())
  contractNumber String   @unique @map("contract_number")
  contractName   String   @default("")   // يُشتق من النوع (trigger) — يُحسب في الخدمة
  customerId     Int
  customer       Customer @relation(fields: [customerId], references: [id])
  contractDate   String   // YYYY-MM-DD
  description    String   @default("")
  amount         Decimal  @db.Decimal(18, 3)          // القيمة الأصلية فقط
  notes          String   @default("")
  contractType   String   @default("غير محدد")
  manualPath     Boolean  @default(false)
  signDate       String?  @default("")
  startDate      String?  @default("")
  endDate        String?  @default("")
  status         String   @default("نشط")             // مسودة|تحت المراجعة|معتمد|نشط|متوقف|منتهي|مغلق|ملغى
  currency       String   @default("د.ك")
  statusReason   String   @default("")
  cancelledAt    String   @default("")
  cancelCloseAmount Decimal @default(0) @db.Decimal(18, 3)
  // إشراف
  supStartDate   String?  @default("")
  supMonths      Int      @default(0)
  supMonthly     Decimal  @default(0) @db.Decimal(18, 3)
  supDiscount    Decimal  @default(0) @db.Decimal(18, 3)
  supWaivedMonths Decimal @default(0) @db.Decimal(18, 3)   // يقبل كسورًا
  supWaiveReason String   @default("")
  // تسعير
  qty            Decimal  @default(1) @db.Decimal(18, 3)
  unitPrice      Decimal  @default(0) @db.Decimal(18, 3)
  stages         ContractStage[]
  paymentPlan    PaymentPlanItem[]
  vouchers       Voucher[]
  addendums      Addendum[]
  createdAt      DateTime @default(now())
  updatedAt      DateTime?
  @@index([customerId, status])
  @@map("contracts")
}

model ContractStage {           // نسخة العقد (Snapshot)
  id           Int      @id @default(autoincrement())
  contractId   Int
  contract     Contract @relation(fields: [contractId], references: [id])
  name         String
  level        Int      @default(1)
  parentName   String   @default("")
  expectedDays Int      @default(0)
  payPct       Decimal  @default(0) @db.Decimal(18, 3)
  payKind      String   @default("")           // ""|achieve|advance|final|days
  sortOrder    Int      @default(0)
  startDate    String?  @default("")
  endDate      String?  @default("")
  isSkipped    Boolean  @default(false)
  closedBy     String   @default("")
  isSupervision Boolean @default(false)
  supStart     String?  @default("")
  supEnd       String?  @default("")
  supActualEnd String?  @default("")
  supMonthly   Decimal  @default(0) @db.Decimal(18, 3)
  supWaivedMonths Decimal @default(0) @db.Decimal(18, 3)
  supWaiveReason String @default("")
  deletedAddendumId Int?
  payments     PaymentPlanItem[]
  @@index([contractId])
  @@map("contract_stages")
}

model PaymentPlanItem {
  id          Int      @id @default(autoincrement())
  contractId  Int
  contract    Contract @relation(fields: [contractId], references: [id])
  title       String
  dueDate     String
  amount      Decimal  @db.Decimal(18, 3)
  sortOrder   Int      @default(0)
  stageId     Int?
  stage       ContractStage? @relation(fields: [stageId], references: [id])
  notes       String   @default("")
  triggeredAt String   @default("")      // غير فارغ = استحقاق فعلي (بداية البوابة)
  manualAmount Boolean @default(false)
  deletedAddendumId Int?
  links       VoucherPaymentLink[]
  claims      Claim[]
  createdAt   DateTime @default(now())
  @@index([contractId, dueDate, sortOrder])
  @@map("payment_plan")
}

model Voucher {
  id            Int      @id @default(autoincrement())
  voucherNumber String   @unique @map("voucher_number")
  vtype         String                                   // payment|receipt|transfer|custody_return|salary_deduction
  vdate         String
  party         String   @default("")
  partyType     String   @default("")                    // customer|subcontractor|partner|transfer|""
  partyId       Int?
  method        String   @default("")
  account       String   @default("")
  expenseAccountId Int?
  expenseAccountSnapshot String @default("")
  expenseGroupRef String @default("")
  expenseGroupLine Int?
  custodyAccountId Int?
  custodyAccountSnapshot String @default("")
  advanceEmployeeId Int?
  amount        Decimal  @db.Decimal(18, 3)
  advanceAmount Decimal  @default(0) @db.Decimal(18, 3)  // دفعة مقدمة/فائض الربط
  description   String   @default("")
  projectId     Int?
  expenseCustomerId Int?
  contractId    Int?
  contract      Contract? @relation(fields: [contractId], references: [id])
  boqItemId     Int?
  subContractId Int?
  costCenter    String   @default("")
  attachment    String   @default("")
  notes         String   @default("")
  parentVoucherId Int?                                   // سند الرسوم ابن القبض
  chequeDueDate String   @default("")
  allocation    String   @default("")                    // تخصيص لأمر تغييري
  receiptGroupRef  String @default("")
  receiptGroupLine Int?
  cancelled     Boolean  @default(false)
  cancelReason  String   @default("")
  cancelledAt   String   @default("")
  links         VoucherPaymentLink[]
  createdAt     DateTime @default(now())
  @@index([vtype, cancelled, vdate, id])
  @@index([contractId])
  @@index([partyType, partyId, vtype, cancelled])
  @@map("vouchers")
}

model VoucherPaymentLink {
  id        Int     @id @default(autoincrement())
  voucherId Int
  voucher   Voucher @relation(fields: [voucherId], references: [id])
  kind      String                                  // receipt|payment
  lineId    Int                                     // payment_plan.id أو sub_payment_plan.id
  amount    Decimal @db.Decimal(18, 3)
  createdAt DateTime @default(now())
  @@unique([voucherId, lineId])
  @@index([lineId])
  @@map("voucher_payment_links")
}

model Addendum {
  id            Int     @id @default(autoincrement())
  addendumNumber String
  contractId    Int
  contract      Contract @relation(fields: [contractId], references: [id])
  addendumType  String  @default("أمر تغييري")          // عقد إضافي|أمر تغييري
  adate         String  @default("")
  reason        String  @default("")
  description   String  @default("")
  amountAdd     Decimal @default(0) @db.Decimal(18, 3)
  amountDeduct  Decimal @default(0) @db.Decimal(18, 3)
  startDate     String  @default("")
  endDate       String  @default("")
  status        String  @default("مسودة")               // مسودة|تحت المراجعة|معتمد|ملغى
  approvedDate  String  @default("")
  side          String  @default("client")              // client|sub
  subContractId Int?
  itemsCount    Int     @default(0)
  appliedAt     String  @default("")
  cancelReason  String  @default("")
  cancelledAt   String  @default("")
  items         AddendumItem[]
  @@index([contractId, status])
  @@map("addendums")
}

model AddendumItem {
  id               Int    @id @default(autoincrement())
  addendumId       Int
  addendum         Addendum @relation(fields: [addendumId], references: [id], onDelete: Cascade)
  side             String @default("client")
  action           String @default("add")               // add|delete
  parentPartId     Int    @default(0)
  createdItem      Int    @default(0)
  restoreDeletedBy Int    @default(0)
  applied          Boolean @default(false)
  boqItemId        Int?
  subContractId    Int?
  subcontractorId  Int?
  description      String @default("")
  qty              Decimal @default(0) @db.Decimal(18, 3)
  unit             String @default("")
  unitPrice        Decimal @default(0) @db.Decimal(18, 3)
  amount           Decimal @default(0) @db.Decimal(18, 3)
  refKind          String @default("")
  refId            Int    @default(0)
  @@index([addendumId])
  @@map("addendum_items")
}

model SubContract {
  id              Int     @id @default(autoincrement())
  subcontractorId Int
  contractId      Int
  projectId       Int?
  amount          Decimal @default(0) @db.Decimal(18, 3)
  startDate       String  @default("")
  endDate         String  @default("")
  status          String  @default("نشط")
  description     String  @default("")
  cancelReason    String  @default("")
  cancelledAt     String  @default("")
  cancelCloseAmount Decimal @default(0) @db.Decimal(18, 3)
  paymentPlan     SubPaymentPlanItem[]
  @@map("sub_contracts")
}

model SubPaymentPlanItem {      // مرآة payment_plan
  id            Int      @id @default(autoincrement())
  subContractId Int
  subContract   SubContract @relation(fields: [subContractId], references: [id], onDelete: Cascade)
  title         String
  dueDate       String
  amount        Decimal  @db.Decimal(18, 3)
  sortOrder     Int      @default(0)
  stageId       Int?                                  // مرحلة من عقد العميل الأب
  notes         String   @default("")
  triggeredAt   String   @default("")
  sources       SubPaymentSource[]
  @@index([subContractId])
  @@map("sub_payment_plan")
}

model SubPaymentSource {
  id         Int @id @default(autoincrement())
  subLineId  Int
  custLineId Int
  @@unique([subLineId, custLineId])
  @@map("sub_payment_sources")
}

model ContractType {
  id            Int     @id @default(autoincrement())
  name          String  @unique
  defaultAmount Decimal @default(0) @db.Decimal(18, 3)
  notes         String  @default("")
  active        Boolean @default(true)
  manualTrack   Boolean @default(false)
  unitLabel     String  @default("")
  unitPrice     Decimal @default(0) @db.Decimal(18, 3)
  pricingMode   String  @default("lump")                // lump|unit|items|bundle
  isSupervision Boolean @default(false)
  paymentTemplates TypePaymentTemplate[]
  bundleComponents TypeBundleComponent[]
  @@map("contract_types")
}

model TypePaymentTemplate {
  id             Int     @id @default(autoincrement())
  contractType   String                                  // ربط بالاسم (كالمصدر)
  payNo          Int
  title          String  @default("")
  pct            Decimal @default(0) @db.Decimal(18, 3)
  amountFixed    Decimal @default(0) @db.Decimal(18, 3)
  stageId        Int?
  triggerStageId Int?
  daysOffset     Int     @default(0)
  linkKeyword    String  @default("")                    // مفصولة بـ«،» + بدون_مرحلة
  stageLinks     TypePaymentStage[]
  @@unique([contractType, payNo])
  @@map("type_payment_tpl")
}

model TypePaymentStage {
  id         Int @id @default(autoincrement())
  paymentId  Int
  stageId    Int
  @@unique([stageId])
  @@map("type_payment_stages")
}

model WorkflowStage {
  id              Int     @id @default(autoincrement())
  transactionType String                                  // contract|payment|subcontract|customer
  stageName       String
  stageOrder      Int
  color           String  @default("#3B82F6")
  parentId        Int?
  expectedDays    Int     @default(0)
  isPreContract   Boolean @default(false)
  contractType    String  @default("")                    // '' = القالب العام
  paymentPct      Decimal @default(0) @db.Decimal(18, 3)
  payKind         String  @default("")
  isSupervision   Boolean @default(false)
  supMonthly      Decimal @default(0) @db.Decimal(18, 3)
  componentKey    String  @default("")
  @@unique([transactionType, contractType, stageName])
  @@map("workflow_stages")
}

model ContractScope {
  contractId      Int
  templateStageId Int
  @@id([contractId, templateStageId])
  @@map("contract_scope")
}

model Setting {                 // صف واحد id=1
  id                Int     @id @default(1)
  companyName       String  @default("")
  currency          String  @default("د.ك")
  bankFeeAmount     Decimal @default(0.150) @db.Decimal(18, 3)
  bankFeeMethod     String  @default("تحويل بنكي")
  bankFeeEnabled    Boolean @default(true)
  cashflowEnabled   Boolean @default(true)
  openingBalanceBank Decimal @default(0) @db.Decimal(18, 3)
  openingBalanceCash Decimal @default(0) @db.Decimal(18, 3)
  openingBalanceDate String @default("")
  cashStartDate     String  @default("")
  subPayClientGate  Boolean @default(true)
  collectionAlertDays Int   @default(30)
  expiryAlerts      String  @default("90,60,30,7")
  descPrefixReceipt String  @default("")
  descPrefixSupervision String @default("")
  descPrefixTransfer String @default("")
  descPrefixCustody String  @default("")
  descPrefixStageNote String @default("")
  // …بقية حقول الهوية والنسخ الاحتياطي كما في القسم I
  @@map("settings")
}

model PaymentMethod {
  id       Int     @id @default(autoincrement())
  name     String  @unique
  feeType  String  @default("amount")                  // amount|percent
  feeValue Decimal @default(0) @db.Decimal(18, 3)
  isActive Boolean @default(true)
  @@map("payment_methods")
}

model Claim {
  id             Int     @id @default(autoincrement())
  claimNumber    String  @unique
  direction      String                                  // out|in
  contractId     Int
  subContractId  Int?
  custLineId     Int?
  subLineId      Int?
  title          String
  amount         Decimal @db.Decimal(18, 3)
  dueDate        String  @default("")
  status         String  @default("registered")          // registered|sent|in_review|approved|refused|collected|paid|cancelled|archived
  voucherRef     String  @default("")
  postponedUntil String  @default("")
  notes          String  @default("")
  createdAt      DateTime @default(now())
  @@index([contractId])
  @@index([direction, status])
  @@map("claims")
}

model NumberSequence {
  name   String @id                                  // "table.column.PREFIX"
  lastNo Int    @default(0)
  @@map("number_sequences")
}

model JournalEntry { … }        // database.py:746-761
model ContractEvent { … }       // database.py:737-744
model AuditLog { … }            // database.py:2161-2176
```

**دوال حسابية يجب نقلها حرفيًا كطبقة خدمة (TypeScript):**
1. `contractCurrentValue(cid)` = amount + Σ(معتمد addendums net) + supExtension (A).
2. `supervisionStatus(cid)` بكل مفاتيحه (F) — _add_months مع تقصير نهاية الشهر.
3. `contractPaymentPlan(cid, excludeVoucherId?)` — FIFO بالـ(dueDate, sortOrder) على pool = receipts بلا allocation − Σ روابط صريحة، ثم الروابط لكل خط (B) + آلة الحالات الثمانية (D).
4. `overduePlanItems(strict)` + `dueNowByContract` (E).
5. `applyLinks/distribute/checkSelection/roomFor` لروابط السندات (B) وقاعدة التتابع.
6. `receiptBankFee(method, amount)` و`allocateByValue` (J).
7. `tafqit(value, currency)` (K).
8. `nextNumber(prefix)` عبر `NumberSequence` داخل معاملة (upsert+increment ذري).

## مقترح مسارات API (Next.js App Router)

```
# العقود والقيمة
GET    /api/contracts?search=&customerId=&limit=&offset=      (contract_service.list_contracts — القيم المحسوبة في الـpayload)
POST   /api/contracts                                         (add_contract: توليد CON-#### + قيد إنشاء + snapshot مكوّنات/نطاق + بناء الخطة)
GET    /api/contracts/:id
PATCH  /api/contracts/:id                                     (منع amount < totalInvoiced)
POST   /api/contracts/:id/status                              (change_contract_status: ملغى يتطلب cancelCloseAmount؟)
GET    /api/contracts/:id/value                               (contract_current_value)
GET    /api/contracts/:id/dashboard                           (contract_dashboard)
GET    /api/contracts/:id/payment-plan                        (contract_payment_plan — يحوي status/covered/remaining/days_diff)
POST   /api/contracts/:id/payment-plan                        (add_plan_item — سقف القيمة)
PATCH  /api/contracts/:id/payment-plan/:lineId                (update_plan_item)
DELETE /api/contracts/:id/payment-plan/:lineId                (delete_plan_item)
POST   /api/contracts/:id/payment-plan/rescale                (rescale_payment_plan)
POST   /api/contracts/:id/stages/manual                       (add_contract_main_stages — للشامل)

# المراحل والاستحقاق
GET    /api/contracts/:id/stages
POST   /api/contracts/:id/stages/:stageId/finish              (← trigger_due_payments: يضبط triggered_at/dueDate/notes)
POST   /api/contracts/:id/stages/:stageId/skip                (← _mark_skipped_stage_payments)
POST   /api/contracts/:id/stages/:stageId/reopen              (← تصفير triggered_at)

# الإشراف
GET    /api/contracts/:id/supervision                          (supervision_status)
POST   /api/contracts/:id/supervision                          (setup_supervision)
POST   /api/contracts/:id/supervision/waive                    (waive_extension_months — سقف unpaid)
GET    /api/supervision/extensions | /in-extension | /near-end  (extensions_map/contracts_in_extension/near_base_end)
POST   /api/stages/:stageId/supervision | /start | /end | /waive | /clear  (إشراف المرحلة)

# السندات
GET    /api/vouchers?vtype=&contractId=&from=&to=              (list_vouchers)
POST   /api/vouchers                                           (add_voucher — يعيد 409/422 OverpayWarning عند التجاوز مع body.allowOverpay=true للمتابعة)
PATCH  /api/vouchers/:id                                       (update_voucher — نفس بروتوكول Overpay)
POST   /api/vouchers/:id/cancel                                (cancel_voucher — إلغاء ناعم + أبناء + عكس قيود + إعادة فتح الدفعات)
GET    /api/vouchers/:id/links | PUT …/links                   (voucher_links / _write_payment_links)
POST   /api/receipts/grouped                                   (add_grouped_receipts — BT-#### + تقسيم العمولة بالتساوي)

# الربط والمستحق
GET    /api/payment-links/candidates?kind=receipt&contractId=…  (plan_rows/due_lines — يشمل gated وgate_reason)
POST   /api/payment-links/preview-distribute                    (distribute — بدون كتابة: توزيع + advance + أخطاء التتابع)
GET    /api/dues?from=&to=                                      (dues_report)
GET    /api/dues/due-now?by=contract|customer                   (due_now_by_*)
GET    /api/dues/overdue?strict=0|1                             (overdue_plan_items)

# أنواع العقود
GET/POST/PATCH/DELETE /api/contract-types                        (مع منع حذف مستخدم)
GET/PUT  /api/contract-types/:name/payment-templates             (type_payments/add_type_payment بقيود المُحفِّزة)
GET/PUT  /api/contract-types/:name/bundle-components
GET/PUT  /api/contract-types/:name/stages                        (شجرة القالب)
POST   /api/contract-types/import-template                       (Excel تأسيس Add-only — يعيد تقرير أخطاء/تحذيرات)

# الإعدادات
GET/PUT /api/settings                                            (الصف الواحد — مفاتيح القسم I)
GET/POST/PATCH/DELETE /api/payment-methods                        (حذف = تعطيل)

# الإلغاء الموحد والتدقيق
POST   /api/cancel/:entityType/:id                               (cancel_transaction: backup → reverse → status → audit)
POST   /api/cancel/:entityType/:id/restore
POST   /api/cancel/:entityType/:id/archive
GET    /api/cancel/:entityType/:id/history | /api/cancel/recent  (cancel_audit_log)
```

**بروتوكول OverpayWarning في الويب (مقترح ربط بالمصدر):** أرسل `422` بـ `{code:"OVERPAY_WARNING", remaining, message}`؛ العميل يعيد الإرسال مع `allowOverpay:true` بعد التأكيد. نفس النمط لتجميّد العقد الملغى (`FROZEN_CONTRACT`) وعهدة/سلفة متبقية غير كافية (قاطعة 400).

---
*انتهى التقرير — أُعد بواسطة وكيل البحث 2-a من المصدر المستعاد حرفيًا دون أي تعديل على ملفات المشروع.*
