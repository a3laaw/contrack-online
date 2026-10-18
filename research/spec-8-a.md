# تقرير بحث معمّق 8-a — منطق العقود والمراحل وخطة الدفعات ومستحقات العميل والبيان التلقائي
المصدر: كود ConTrack V9.15.18 الأصلي (PySide6 + SQLite) — `/home/z/my-project/contrack_v9.15.18/`
الملفات المفحوصة بعمق: `app/services/lifecycle_service.py` (6293 سطرًا)، `app/services/contract_service.py`، `app/services/workflow_service.py` (5468)، `app/services/voucher_payment_link_service.py`، `app/services/statement_service.py`، `app/services/supervision_service.py`، `app/services/claims_service.py`، `app/ui/followup.py`، `app/ui/due_items_page.py`، `app/ui/contract_hub.py`، `app/ui/main_window.py`، `app/database/database.py`، `app/ui/contracts.py` (مسارات الاستدعاء).

> **تنبيه مهم:** `app/ui/due_items_page.py` ليس جدول مستحقات العميل! هو شاشة «التسديد — الشركة الأخرى» (تسوية عمليات بوابات الدفع الأخرى عبر settlement_service). جدول المستحقات الحقيقي للعملاء = `lifecycle_service._contract_payment_plan_impl` + `overdue_plan_items` المعروضان في لوحة المؤشرات (`main_window.refresh`) ومركز العقد (`contract_hub`) وشاشة العقود.

---

## 1) خريطة الجداول والحقول الحرجة (schema فعلي من database.py)

| الجدول (رقم سطر التعريف) | الأعمدة الحرجة | دلالة |
|---|---|---|
| `contracts` (253 + ترقية 1420-1446) | `amount REAL>0`, `contract_date TEXT`, `contract_type TEXT`, `contract_name`, `sign_date`, `start_date`, `end_date`, `status TEXT DEFAULT 'نشط'`, `currency`, `qty`, `unit_price`, `manual_path INTEGER`, `sup_start_date/sup_months/sup_monthly/sup_discount/sup_waived_months/sup_waive_reason`, `status_reason`, `cancelled_at`, `cancel_close_amount` | حالة العقد الإدارية وقيمته الأصلية وإشرافه |
| `contract_stages` (417) | `contract_id`, `name`, `level` (0=عنوان تجميعي، 1=خطوة تنفيذ), `parent_name`, `expected_days`, `pay_pct`, `pay_kind`, `sort_order`, `start_date`, `end_date`, `is_skipped`, `closed_by`, `is_supervision`, `sup_start/sup_end/sup_actual_end/sup_monthly/sup_waived_months/sup_waive_reason`, `deleted_addendum_id` | **نسخة العقد المستقلة (Snapshot)** من شجرة نوع العقد — مصدر حالة التنفيذ |
| `workflow_stages` (486) | `transaction_type` (contract/payment/subcontract/customer), `stage_name`, `stage_order`, `color`, `parent_id`, `expected_days`, `is_pre_contract`, `contract_type`, `payment_pct`, `pay_kind`, `is_supervision`, `sup_monthly`, `UNIQUE(transaction_type, contract_type, stage_name)` | **قالب** مراحل التنفيذ (لكل نوع عقد أو القالب العام `''`) |
| `type_payment_tpl` (440) | `contract_type`, `pay_no`, `title`, `pct`, `amount_fixed`, `stage_id→workflow_stages`, `trigger_stage_id→workflow_stages`, `days_offset`, `link_keyword`, `UNIQUE(contract_type, pay_no)` | قالب دفعات النوع — المرحلة المُحفِّزة إنهاؤها يستحق الدفعة، وNULL = دفعة بالأيام |
| `type_payment_stages` (458) | `payment_id→type_payment_tpl`, `stage_id→workflow_stages`, `UNIQUE(stage_id)` | دفعة تجمع عدة مراحل؛ **المرحلة الواحدة تتبع دفعة واحدة فقط** |
| `payment_plan` (770 + ترقية 1288-1305 و1660-1668) | `contract_id`, `title`, `due_date TEXT NOT NULL`, `amount REAL>0 CHECK`, `sort_order`, `stage_id→contract_stages`, `notes`, `triggered_at TEXT` (فارغ = تقديري), `manual_amount INTEGER DEFAULT 0`, `deleted_addendum_id` | خطة سداد العميل — **الجدول الأساس لمستحقات العميل** |
| `sub_payment_plan` (791) | مرآة payment_plan لـ `sub_contract_id` (stage_id يشير لمرحلة عقد العميل الأب) | خطة دفعات المقاول |
| `vouchers` (686) | `vtype CHECK IN ('payment','receipt','transfer','custody_return','salary_deduction')`, `vdate`, `amount>0`, `party_type` (customer/subcontractor/partner), `party_id`, `contract_id`, `sub_contract_id`, `allocation TEXT`, `advance_amount REAL DEFAULT 0`, `cancelled INTEGER`, `cancel_reason`, `cancelled_at`, `cheque_due_date`, `receipt_group_ref/line`, `parent_voucher_id` | السندات المالية (قبض/صرف/تحويل/إرجاع عهدة/خصم راتب) |
| `voucher_payment_links` (822) | `voucher_id→vouchers`, `kind CHECK IN ('receipt','payment')`, `line_id INTEGER` (→ payment_plan عند receipt / sub_payment_plan عند payment), `amount>0`, `UNIQUE(voucher_id, line_id)` | توجيه صريح لمبلغ السند نحو خط دفعة بعينها |
| `contract_events` (737) | `contract_id`, `event_time`, `event_type`, `description`, `username` | السجل الزمني للعقد (log_event) |
| `transaction_stage_log` (514) | `transaction_type`, `transaction_id`, `stage_id→workflow_stages` (NULL لحركات العقود), `moved_by→users`, `moved_at`, `note`, `start_date`, `end_date`, `is_skipped` | سجل تدقيق حركة المراحل؛ **مصدر الحالة للأنواع غير العقد** (سند صرف/باطن/عميل)، وللعقود سجل تدقيق فقط (الحالة في contract_stages) |
| `stage_notes` (532) | `transaction_type/transaction_id/stage_name/note/created_by` | ملاحظات المرحلة (سبب التأخير) منفصلة عن العدادات |
| `notifications` (561) | `user_id`, `transaction_type/transaction_id`, `type` ('stage_change'/'new_message'), `text`, `is_read` | إشعارات المحرك |
| `addendums` (719) | `amount_add`, `amount_deduct`, `status` (مسودة/تحت المراجعة/معتمد/ملغى), `side` (client/sub) | الملحقات — تُحتسب في قيمة العقد فقط عند `status='معتمد'` |
| `claims` (1920) | `direction` (out/in), `cust_line_id`/`sub_line_id`, `status` | مطالبات مرتبطة بخطوط الدفعات |

---

## 2) حساب مستحقات العميل — الصيغة الحرفية

### 2.1 المصدر الأساسي: `payment_plan` لا المراحل مباشرة
المستحق يُبنى من **صفوف payment_plan** (الدالة `_contract_payment_plan_impl` — lifecycle_service.py:5718-5787). المراحل (contract_stages) لا تدخل المعادلة ماليًا إلا بوصفها **بوابة استحقاق** عبر `stage_id` + `triggered_at`:

```
# مدخلات الصف (لكل payment_plan):
#   amount, due_date, stage_id, triggered_at, sort_order
#   linked_stage_skipped = COALESCE(contract_stages.is_skipped, 0) عبر LEFT JOIN

# 1) المحصّل العام (pool):
collected = SUM(vouchers.amount)
            WHERE contract_id = :cid AND vtype='receipt'
              AND cancelled=0 AND (allocation IS NULL OR allocation='')

# 2) الروابط الصريحة لكل خط (V6.2):
links[line_id] = SUM(vpl.amount)
                 FROM voucher_payment_links l JOIN vouchers v ON v.id=l.voucher_id
                 JOIN payment_plan pp ON pp.id=l.line_id
                 WHERE l.kind='receipt' AND v.cancelled=0
                   AND v.allocation='' AND pp.contract_id=:cid
                 GROUP BY l.line_id

# 3) التغطية التسلسلية FIFO (بترتيب due_date ثم sort_order):
pool = max(0, collected - Σlinks)
لكل صف بالترتيب:
    covered = min(pool, amount); pool -= covered
    covered += min(links[id], max(0, amount - covered))   # الرابط الصريح فوق التسلسلي
    remaining = amount - covered
```
**ملاحظة جوهرية:** السندات غير الموجّهة (`allocation=''` وبلا روابط) تُغطّي الدفعات **تسلسليًا بالترتيب الزمني** — لا يوجد ربط مدين/دائن حقيقي بين سند معين ودفعة معينة إلا عبر `voucher_payment_links`.

### 2.2 حالات الصف (status strings عربية حرفية) — lifecycle_service.py:5746-5785
```
إن stage_id مربوطة و linked_stage_skipped=1:
    days_diff = 999999 ; status = "مرحلة متخطاة"   # لا تدخل المتأخرات أبدًا
إن stage_id مربوطة و triggered_at='' و remaining > 0.001:
    days_diff = 999999 ; status = "بانتظار إنجاز المرحلة"   # غير مستحقة في التقارير
غير ذلك:
    days_diff = (due_date - today).days
    remaining <= 0.001            → "مدفوع"
    covered > 0.001               → due >= today ? "جزئي" : "متأخر"
    due_date < today              → "متأخر"
    triggered_at <> ''            → "مستحقة"            # مثارة وحلّ أجلها (V4.5.03)
    days_diff <= 7                → "مستحق قريبًا"        # نافذة أسبوع
    غير ذلك                       → "لم يحل"
```
- **عدد أيام التأخير** = `-days_diff` أيام (يُعرض «تأخر N يوم») — main_window.py:294-298، contract_hub.py:2041-2045.
- يوم الاستحقاق يُحلَّل بـ `strptime(due_date, "%Y-%m-%d")`؛ عند فشل التحليل يعامل كـ today (safe fallback، سطر 5760-5763).

### 2.3 المستحق الإجمالي (Aggregate) — ثلاث دوال بثلاث دلالات
1. **مقارنة المستحق × المحصّل** `contract_payment_compare` (1570-1605):
```
due      = Σ payment_plan.amount WHERE triggered_at <> ''     # المحركة فعليًا فقط
collected = Σ covered (نفس خوارزمية 2.1)
remaining = due - collected
```
2. **سقف التحصيل للعقد** (يُستخدم في سند القبض والتعليق الآلي) `_auto_receipt_comment` (309-356) و`add_voucher` (~2390):
```
due_value = max(contract_current_value().current, supervision_status().total_due)
collected = Σ vouchers(receipt, cancelled=0)
remaining = due_value - collected        # سالب ⇒ «يوجد دفع مقدم/زيادة»
```
3. **ملخص مالي للعميل** `customer_financial_summary` (5991) و`_customer_contracts_summary_impl` (6016-6113):
```
current_value = contracts.amount + Σ addendums(amount_add-amount_deduct, معتمد) + sup_extension
collected = Σ vouchers(receipt, cancelled=0) عبر عقود العميل
remaining = current_value - collected
percent_collected = collected / current * 100
overdue = أكبر days_late بين صفوف الخطة remaining>0.001 و days_diff<0 (لعقود غير مغلق/ملغى)
```
**قيمة العقد الحالية** `_contract_current_value_impl` (636-663):
```
current = contracts.amount
        + Σ addendums.amount_add - Σ addendums.amount_deduct  (status='معتمد' فقط)
        + supervision_status().extension_value                 # تمديد إشراف مستحق
```
**الفواتير لا تخفض المديونية** (قاعدة موحدة V3.14): `invoices` تظهر «للعلم» فقط في الكشوف (statement_service.py:72-77) ولا تدخل أي معادلة مستحق — التحصيل فقط يخفض.

### 2.4 جدول المتأخرات المركزي — `_overdue_plan_items_impl` (5811-5926)
```
النطاق: عقود status NOT IN ('مغلق','ملغى')  (والاستبعاد عند العرض يشمل 'مسودة')
لكل صف خطة (بنفس خوارزمية 2.1 مع خرائط مجمّعة للأداء):
    استبعاد: مرحلة متخطاة، أو (stage_id و triggered_at='' و remaining>0.001)
    strict=True  («المستحق الآن» V4.3): days_diff <= 0 فقط
    strict=False (الافتراضي): days_diff <= 7        # متأخر + نافذة 7 أيام
    الحالة: "جزئي" (covered>0 و due>=today) / "متأخر" (due<today) / "مستحق قريبًا"
    الترتيب حسب days_diff تصاعديًا
```
تُستهلك في لوحة المؤشرات (main_window.py:295-299): `days_diff<0` → تنبيه أحمر «دفعة متأخرة … متبقٍ منه X · تأخر N يوم»، وإلا تنبيه كهرماني «تستحق خلال N يوم».

### 2.5 تقرير «التحصيل المتعثر» `overdue_collections` (5281-5330)
```
alert_days = settings.collection_alert_days (min 7, default 30)
لكل عقد status NOT IN ('مغلق','ملغى','مسودة'):
    current_value = amount + net_addendum (معتمد)
    remaining = current_value - collected ; skip إذا remaining <= 0.001
    ref_date = آخر vdate قبض أو contract_date
    days_since = today - ref_date ; يظهر إذا days_since >= alert_days
```
هذا تقرير «رصيد راكد» حسب آخر حركة قبض، مختلف عن المتأخرات حسب استحقاقات الخطة.

### 2.6 الخصم/المحتجزات (retention)
**لا يوجد أي مفهوم retention/محتجزات في النظام** (بحث شامل بلا نتائج). أقرب الأشياء: (أ) حسميات الملحقات `amount_deduct` تُخصم من قيمة العقد مرة واحدة في `current_value`؛ (ب) خصم الإشراف `sup_discount` يُخصم من قيمة التعهد؛ (ج) `vouchers.advance_amount` سجل الزيادة المدفوعة سلفًا.

### 2.7 مستحقات الباطن (مرآة) — `_sub_payment_plan_impl` (1230-1358)
نفس خوارزمية 2.1 حرفيًا مع: مصدر السندات `vtype='payment'` بـ `sub_contract_id` (+ سندات قديمة غير مرتبطة تُحتسب إذا كان للمقاول عقد باطن واحد على العقد — V5.4③)، وروابط `kind='payment'`، وشرط استحقاق إضافي: دفعات ذات `sub_payment_sources` لا تُستحق إلا باكتمال **كل** مصادرها من دفعات العميل (`trigger_linked_sub_payments` V4.6، و4438-4520)، وبوابة `settings.sub_pay_client_gate` (1 افتراضيًا) تمنع الصرف للمقاول قبل تحصيل دفعة العميل المقابلة (`voucher_payment_link_service.gate_enabled` 31-47 و`plan_rows` 166-181).

---

## 3) توليد خطة الدفعات تلقائيًا (من القالب)

### 3.1 المسار الكامل عند التوقيع — `on_contract_signed` (workflow_service.py:3162-3223)
```
1) إغلاق مرحلة ما قبل التعاقد للعميل (transaction_stage_log.end_date=today)
2) Snapshot مرة واحدة: get_contract_stages(contract_id) فارغة؟
   → _build_contract_snapshot (3956-4026): نسخ شجرة workflow_stages للنوع
     (بعد استبعاد مكوّنات الشامل المطفأة _enabled_bundle_keys ونطاق V4.48)
     إلى contract_stages مع:
       level 0 للرئيسية التجميعية (لها أبناء) — عنوان فقط
       pay_kind='advance' → start=end=start_day (مقدمة تُقفل فور التوقيع)
       أول خطوة level=1 → start=start_day (تبدأ فورًا)
       وراثة is_supervision/sup_monthly من القالب (V3.23)
3) توليد خطة السداد بالأولوية:
   a. _generate_type_payments_from_template (4266-4327)  ← القالب الصريح type_payment_tpl
   b. وإلا (لا قالب) _generate_payments_from_snapshot (4060-4122) ← من pay_pct/pay_kind على مراحل النسخة
   c. وإلا _ensure_single_full_contract_payment (4339-4372) ← «دفعة كاملة عند بداية التعاقد»
      بمبلغ العقد كاملًا مربوطة بأول خطوة، due=triggered_at=تاريخ البداية
4) تعليق تلقائي في ملف العميل _auto_comment («تم إنشاء العقد … وتولّدت خطة سداد من N دفعة»)
```

### 3.2 معاينة/توليد موحد — `type_payment_preview` (4130-4198)
```
لكل type_payment_tpl ORDER BY pay_no:
    pct>0          → mode='percent' ; amount = round(contract_value * pct / 100, 3)
    amount_fixed>0 → mode='fixed'    ; amount = round(amount_fixed, 3)   # مبلغ يدوي للنوع
    غير ذلك        → mode='flexible' ; amount = 0 → لا يُنشأ صف في الخطة (CHECK amount>0 يمنع الصف الصفري)
    trigger_stage_id محدد؟ وإلا (تساوي عدد الدفعات مع الخطوات) الدفعة i تُحفَّز بخطوة i تلقائيًا
    days_offset: القيمة المخزنة، أو stage_cumulative_days = Σ expected_days حتى المرحلة المُحفِّزة (3092-3101)
    due_text: «عن مرحلة «X» · تقديريًا +N يوم» أو «بعد N يوم من التوقيع»
```
عنوان الصف `_plan_title_for(seq,row)` (2856-2870): `"{seq}. {auto_pay_core}"` — الأسماء الآلية («الدفعة الرابعة»/«دفعة 3») تُعاد بالرقم الجديد، وأسماء المستخدم تبقى (V5.4/V5.6). الترقيم المتسلسل بعد النطاق 1..n عبر `renumber_plan_rows` (4200-4226، V4.5.10).

### 3.3 الربط بالمراحل — `_template_to_contract_stage_map` (4240-4265)
`type_payment_tpl.trigger_stage_id` يشير إلى `workflow_stages` (القالب)، بينما `payment_plan.stage_id` يشير إلى `contract_stages` (النسخة) — المطابقة **بالأسماء** (normalized: تجاهل أ/إ/آ/ة/ى) بالترتيب مع استهلاك المكرر، لا موضعيًا (V4.48). الدفعات المربوطة بمرحلة خارج نطاق العقد لا تُخلق أصلًا (4277-4280).

### 3.4 ماذا يحدث عند تعديل قيمة العقد لاحقًا؟
- `contract_service.update_contract` (471-497) **لا يعيد التوزيع تلقائيًا** — يحدّث contracts فقط (ويمنع النزول تحت إجمالي الفواتير).
- الأدوات اليدوية:
  1. `rescale_payment_plan` (5675-5710): توزيع نسبي `new = round(amount/total × target, 3)` لكل الصفوف ما عدا **الأخير يمتص الكسور** `= target - acc`؛ يرفض النتيجة الصفرية؛ يسجّل حدث «إعادة توزيع الدفعات». يُستخدم في «إصلاح الكل» لشاشة فروقات القيمة×الخطة (contracts.py:3224).
  2. `sync_plan_from_template` (3484-3545) مع المحرك المشترك `_compute_plan_sync` (3305-3483): مطابقة `sort_order == pay_no` (الأول يفوز) ثم بالمُحفِّزة:
     - صف قالب بمبلغ>0: **update** كامل (title/due/amount/sort_order/stage_id/notes)
     - `manual_amount=1` أو `triggered_at<>''`: **update_lite** (عنوان+ربط+رقم فقط — المبلغ لا يُلمس؛ `overridden_kept`/`triggered_kept`)
     - صف مرن (0): لا مبلغ، يُصحَّح اسمه فقط (`rename`)
     - الزوائد (مكرر/خارج القالب): **delete** ما لم تكن مثارة `triggered_at<>''` فتُترك
     - الناقص: **insert**
     - المراحل لا تُمس، والسندات مربوطة بالعقد لا بالصف فلا تتأثر. تعليق تلقائي بالقبل/بعد.
  3. `update_plan_amount_overrides` (5527-5673): مبالغ مخصصة للعقد عند الإنشاء (مفتاح = رقم الدفعة/sort_order)؛ يعلّم المخالف للقالب `manual_amount=1`؛ يُنشئ الصفوف الناقصة (`_will`) ولو لمرحلة **مغلقة أصلًا** بتحفيز رجعي `triggered_at = end_date` (V4.5.03) ثم `_fire_auto_claims`. يستبدل صف «الدفعة الكاملة» بالخطة الصريحة إن لم توجد مطالبات مرتبطة.
  4. `validate_plan_amount_overrides` (5494-5524): `Σ (overrides ∪ current) > value + 0.001` → رفض.

### 3.5 قيود المجاميع (خطأ واضح للمستخدم)
- `add_plan_item` (5423-5453) / `update_plan_item` (5455-5483): `planned + amount > current + 0.001` → «مجموع أقساط الخطة يتجاوز قيمة العقد … المتاح: X» + تحقق تاريخ ISO وamount>0 وعنوان مطلوب. كل عملية تُسجَّل في `contract_events` («إضافة/تعديل/حذف دفعة مجدولة»).
- `link_plan_stage` (4682-4712): كل مرحلة تُربط بدفعة واحدة فقط داخل العقد (رفض التكرار) ويجب أن تكون من مراحل العقد نفسه.

### 3.6 قالب الدفعات نفسه — قواعد `add_type_payment`/`update_type_payment` (2927-3091)
- نسبة بين 0 و100 (`pct` أو `amount_fixed` بدلها — ثنائية حصرية: `amount_fixed>0 ⇒ pct=0`).
- `_validate_payment_stages` (2777-2807): الربط بخطوات تنفيذ فعلية فقط (لا رئيسية تجميعية)؛ المرحلة الواحنة ↔ دفعة واحدة (UNIQUE stage_id)؛ الدفعة متعددة المراحل تتطلب `trigger_stage_id` صريحًا من مراحلها؛ الدفعة الحرة (بلا مراحل) = بالأيام ولا لها مُحفِّز.
- `days_offset` الافتراضي = `stage_cumulative_days` للمُحفِّزة أو max لمراحلها؛ لا يقبل سالبًا.
- `type_payments_total_pct` (3103-3106) يجمع النسب (لا يُفرض ≤100 آليًا عند الإضافة — يُعرض للمستخدم).

---

## 4) حالات المراحل ومحرك الانتقال

### 4.1 مستويان منفصلان
- **حالة إدارية للعقد** `contracts.status` — `CONTRACT_STATUSES = ["مسودة","تحت المراجعة","معتمد","نشط","متوقف","منتهي","مغلق","ملغى"]` (lifecycle_service.py:11-12). التغيير عبر `change_contract_status` (230-279) يكتب `status_reason` و`cancel_close_amount` و`cancelled_at` عند الإلغاء، ويمنع الإلغاء بأن يصبح `current - deducts < collected` ضمنيًا عبر منع حسميات الملحقات دون المحصّل (add_addendum 500-511)، ويسجّل حدثًا بأسماء عربية («اعتماد العقد»…). `update_contract_lifecycle` (184-228) يمنع `end_date < start_date`.
- **مرحلة تشغيلية** (Snapshot) — «مرحلة المتابعة ليست حالة العقد» (ترويسة workflow_service.py:4-15).

### 4.2 حالة سطر المرحلة في contract_stages (`_contract_stage_status` 4937-5002)
```
start=''                    → "future"
start && !end               → "current" (days_in = today - start)
start && end && is_skipped=0 → "done"
start && end && is_skipped=1 → "skip"
الحالة العامة للمسار: "over" إذا days_in > expected_days
                      "near" إذا days_in >= expected_days - 3
                      "ok" وإلا / "done" بلا جارية / "none" بلا مسار
```
`pay_kind` (ثابت PAY_KINDS سطر 79-85): `''` بلا دفعة · `achieve` عند الإنجاز · `advance` مقدمة عند التوقيع · `final` ختامية · `days` بعد أيام.

### 4.3 من يبدّل الحالة وماذا يولّد؟
**المسار الإجباري** `_advance_contract_stage` (1401-1554) عبر `advance_stage`/زر الواجهة (followup.py:1359-1400 يسمح بـ `action_date` بديلة عن اليوم للإشراف):
```
شروط: ليس مسارًا يدويًا (is_manual_path) + ليس ملغى (_ensure_contract_stage_not_frozen 1383-1390)
      + توجد مرحلة جارية + تاريخ ISO صحيح
التنفيذ:
  contract_stages: الجارية → end_date=action_date, is_skipped, closed_by=display_name
                   التالية → start_date=action_date, closed_by
  transaction_stage_log: صف تدقيق (stage_id=NULL للعقود) بنفس التاريخ
إنهاء (لا تخطي):
  1) trigger_due_payments(contract, stage_id, action_date)   ← استحقاق مالي
  2) trigger_due_sub_payments + trigger_linked_sub_payments   ← باطن
  3) مراحل الإشراف: _is_supervision_end_stage_name (تصفية أحرف) يفتح
     set_supervision_end_from_stage إذا التعهد القديم (_contract_can_pledge 1368-1382)
  4) notifications لكل مشاركين: «استحقت دفعة «X» (مبلغ) بإنهاء مرحلة «Y»»
     أو «… المسددة مسبقًا»
  5) تعليق تلقائي 🤖 في تعليقات العميل بنص موحد
تخطي (skip=True):
  1) _mark_skipped_stage_payments (4373-4394): notes لكل دفعة غير مثارة للمرحلة
     = «غير مستحقة لأن مرحلة «X» تم تخطيها بتاريخ Y» — لا استحقاق ولا مطالبة
  2) مرآة الباطن _mark_skipped_sub_stage_payments
```
**الاستحقاق المالي** `trigger_due_payments` (4600-4666):
```
rows = payment_plan WHERE contract_id AND stage_id AND triggered_at=''
collected_pool (سندات قبض سارية غير allocation) → remaining_by_id عبر FIFO
لكل صف: due_date = triggered_at = finish_date   # التاريخ التقديري يُستبدل بالفعلي
         notes = "مستحقة لانتهاء مرحلة «X» بتاريخ Y" أو "… والدفعة كانت مسددة مسبقًا"
         ثم _fire_auto_claims → auto_claim_for_customer_line (مطالبة out بحالة registered،
         بلا ازدواج، المبلغ ≤ مبلغ السطر)
```
**التراجع (مدير)** `revert_contract_stage` (1556-1805):
```
يعيد المرحلة السابقة جارية ويمحو بداية التالية؛ يعكس الاستحقاق التلقائي:
  أي payment_plan مثارة لمَرْحلتها: إذا وُجد سند قبض ساري vdate >= triggered_at
  → يُترك استحقاقها (kept_payments) وإلا triggered_at='' notes='' (reverted)
فحص شامل V9.5.3: كل دفعة مثارة مرحلتها لم تعد مكتملة تُمسح بنفس الحارس
ويعكس دفعات الباطن وباحث المصادر؛ يحذف المطالبات غير النهائية المرتبطة
(collected/paid تبقى)؛ يكتب transaction_stage_log «تراجع عن مرحلة» + إشعار + تعليق.
```
**المسار اليدوي** (`contracts.manual_path=1`): `manual_close_stage` (1948-2030) يُنهي أي عنصر بلا ترتيب بنفس محرك التحفيز، و`manual_reopen_stage` (2031-2189) بنفس ضوابط revert. `stage_finish_order` (2190-2202) يرقّم الإنهاء العرضي من (end_date, id) — لا يُخزَّن.

### 4.4 transaction_stage_log — دلالته
- للعقود: صف تدقيق لكل حركة (stage_id=NULL) — **الحالة الفعلية في contract_stages** لا هنا.
- للأنواع الأخرى (سند صرف/باطن/عميل محتمل): **هو مصدر الحالة** — `get_current_stage` يأخذ آخر صف بلا end_date؛ `start_transaction` (2258) يفتح أول مرحلة (سند الصرف يبدأ «مطلوب» تلقائيًا عند إنشائه — lifecycle_service.py:2459-2462)، `move_to_stage` (2283) و`advance_stage` (4726) يغلقان الجارية بـ end_date ويفتحان التالية.
- مسار سند الصرف الافتراضي (56-62): «مطلوب → بانتظار اعتماد المدير → معتمد للصرف → تم الصرف» — **اعتماد يدوي بزر، لا يمنع ماليًا** (لا يوجد رفض آلي ولا بوابة صرف صارمة على مستوى المحرك؛ البوابة المالية الوحيدة هي بوابة تحصيل العميل للباطن وقيود السقف).
- قاعدة الصلاحيات: «المشاركة = الرؤية» — `transaction_visibility` + `auto_add_participant` عند أي تفاعل (1300-1332).

---

## 5) سقف القبض و voucher_payment_links

### 5.1 السلوك في add_voucher (2178-2487) — الفحص عند 2390-2403
```
if vtype=='receipt' and contract_id:
    due_value = max(contract_current_value().current, supervision_status().total_due)
    collected = Σ vouchers(receipt, cancelled=0)          # بلا استثناء allocation هنا
    remaining = due_value - collected
    if amount > remaining + 1e-9 and not allow_overpay:
        raise OverpayWarning(                            # استثناء خاص (سطر 17) ليس ValidationError
          "قيمة السند تتجاوز المبلغ المتبقي من العقد.\n"
          f"المتبقي: {remaining:,.3f}\n"
          "سيتم تسجيل الزيادة كـ (دفعة مقدمة) على العقد.")
```
**ليس منعًا قاطعًا**: الواجهة تلتقط OverpayWarning وتعرض تأكيدًا؛ موافقته تعيد المحاولة بـ `allow_overpay=True` فيُسجّل السند والزيادة تظهر كـ«دفع مقدم» في كل التقارير (مثال `_auto_receipt_comment` 350-352: «يوجد دفع مقدم/زيادة: X د.ك»). نفس الفحص في `update_voucher` (4553-4570) مع استبعاد السند المعدَّل من المحصّل.

### 5.2 سقف الصرف للمقاول `_check_sub_payment_limit` (1919-1946)
```
total = Σ sub_contracts.amount (غير ملغاة) للمقاول على العقد
paid  = Σ vouchers(payment, cancelled=0, party_type='subcontractor', party_id)
remaining = total - paid ; تجاوز → OverpayWarning بنص «سيتم تسجيل الزيادة كـ (دفعة مقدمة) أو سداد زيادة»
```

### 5.3 تجميد الملغى
`_ensure_contract_accepts_financial_actions` (1948-1958): عقد `status='ملغى'` → ممنوع إضافة/تعديل أي سند له. مرآة الباطن (1960-1979). إلغاء سند `cancel_voucher` (4702-4773): ملغي منطقيًا `cancelled=1` + سبب + عكس قيود journal_children + إلغاء أبناء الرسوم تلقائيًا + ممنوع مع مطالبات سارية (4736-4746) + `_comment_receipt_cancel_reopens_plan` (4649-4700): يعيد توزيع القبض FIFO ويكتب في notes «عادت مستحقة بعد إلغاء سند قبض … المتبقي X» + تعليق.

### 5.4 voucher_payment_links — الحقول والدلالة (voucher_payment_link_service.py كاملًا)
```
(id, voucher_id, kind 'receipt'|'payment', line_id, amount>0) UNIQUE(voucher_id,line_id)
- kind='receipt'  → line_id ∈ payment_plan (دفعاتنا على العميل)
- kind='payment'  → line_id ∈ sub_payment_plan (دفعات المقاولين علينا)
- amount = الجزء الموجّه من السند لهذا الخط (سند واحد يوزَّع على عدة خطوط، صف لكل خط)
- room_for (325-336): مساحة الربط = min(line.amount - linked_other, remaining المحسوب)
- apply_links (372-436): reverse ثم إدخال؛ الزيادة فوق متبقي المحدد تنتشر (spread)
  على الدفعات المستحقة التالية بالترتيب (تتخطى الموقوفة gated)؛ ما يبقى
  → UPDATE vouchers SET advance_amount += rest   # رصيد مقدم على السند
- validate_selections (347-369): ممنوع الربط بدفعة غير مستحقة/مدفوعة/موقوفة
- check_selection (477-502): قاعدة التتابع — المحدد بادئة من المفتوح
  («لا يمكن تحديد دفعة مع تخطي دفعة سابقة غير مسدّدة»)
- eligible/_reached (86-94): status ∈ (مستحقة, متأخر, جزئي) + «مستحق قريبًا» فقط إن مثارة
  ؛ مستبعد: مدفوع/لم يحل/بانتظار إنجاز المرحلة/مرحلة متخطاة + remaining>0.001
```

---

## 6) البيان التلقائي للعقد (statement) — ثلاث طبقات

### 6.1 البيان المالي الموحد للعقد `contract_statement_full` (lifecycle_service.py:5034-5111)
يولّد دفترًا أعمى برصيد جارٍ من: قيمة العقد (مدين) → ملحقات معتمدة (±) → فواتير (دائن/علم) → سندات قبض (دائن) → سندات صرف (مدين) → عقود باطن سارية (مدين) → **تمديد إشراف مدين** (`billable_extension × monthly` بعد إلغاء الشهور) — مرتبة (d, ref) برصيد تراكمي. يُستخدم مع `contract_dashboard` (4898-4951: current_value/addendums_net/receipts/payments/total_subs/expected_cost/expected_profit/actual_profit/remaining_to_invoice) في مركز العقد وPDF.

### 6.2 كشف حساب العقد/العميل `statement_service.py`
- `build_statement` (14-130): قاعدة محاسبية — **قيمة العقد مدين، القبض دائن، الرصيد = المدين − الدائن = المتبقي**؛ الملحقات المعتمدة ±؛ الفواتير «للعلم» لا تخفض (V3.14)؛ تمديد الإشراف مدينة تلقائية عند base_end. المتبقي = `current_value − rec_total` حصرًا.
- `build_customer_statement` (133-240): دمج كل عقود العميل (باستثناء ملغى/مسودة) برصيد جارٍ واحد + «رصيد أول الفترة» عند فلتر تاريخ + إجماليات لكل عقد.
- `build_subcontractor_statement` (243-334): مرآة للمقاول (عقود باطن مدين / سندات صرف دائن).

### 6.3 البيان التلقائي لنص السند `describe`/`describe_items` (vpl_service 238-292 و604-619)
عند ربط سند بدفعات يُبنى البيان آليًا: «سداد الدفعة الثالثة وهي عن أعمال {المرحلة} {كاملة|ومتبقي منها X د.ك} — عقد {الاسم}»، ولجُزء من دفعة سبق سداد جزء منها: «الجزء الثاني من الدفعة الرابعة…»، و«استكمال الدفعة…» إذا كانت إكمالًا، وللزيادة: «سداد على الحساب وزيادة مقدمة» — بلا مبلغ ولا رقم عقد، اسم العقد فقط (`contract_tail`).

---

## 7) workflow_stages ومحرك سير المعاملات (خلاصة)
- أربعة أنواع معاملات `TX_CONTRACT/TX_PAYMENT/TX_SUBCONTRACT/TX_CUSTOMER` (42-48).
- القالب شجري (`parent_id`) لكل نوع عقد (`contract_type=''` = العام) مع إعداد مالي على المرحلة (`payment_pct/pay_kind/is_supervision/sup_monthly`) يستخدم في التوليد الاحتياطي فقط.
- «العميل المحتمل» يبدأ في مرحلة «غير متعاقد» المقفولة (`is_pre_contract=1`) وتُغلق تلقائيًا عند توقيع عقد.
- الحالة محسوبة دائمًا من البيانات (`stage_status` 4869-4935 للأنواع الأخرى من transaction_stage_log)، **لا يوجد enum مخزَّن للحالة**.
- الإشعارات `_push` → notifications (stage_change/new_message) لـ `_notify_targets` (المشاركون ما عدا الفاعل).
- تقرير التنفيذ `execution_report/execution_alerts` (5030-5254) يستخرج العقود المتأخرة/القاربة في مراحلها للتنبيهات الحمراء/الكهرمانية.
- المطالبات (آلة حالات صارمة منفصلة — claims_service.py:26-61): out: registered→sent→approved→collected (مع postponed/cancelled)، in: registered→in_review→approved→paid (أو refused). `is_overdue` = approved وتجاوز due_date.

---

## 8) قواعد التواريخ
- التخزين: TEXT بصيغة ISO `YYYY-MM-DD` (القراءة دائمًا `[:10]`)؛ الطوابع الزمنية `datetime('now','localtime')`.
- `_days_between(d1,d2) = (d1 - d2).days` صفرًا عند فشل التحليل (3117-3127).
- `_stage_dates` (4862-4868): البدء = start_date وإلا moved_at؛ النهاية = end_date وإلا اليوم.
- **due_date المحسوب vs المدخل**: عند التوليد `due = start_day + days_offset` (تقديري، base = `COALESCE(NULLIF(start_date,''), NULLIF(contract_date,''))` أو اليوم). عند إنهاء المرحلة المُحفِّزة يُستبدل `due_date = triggered_at = تاريخ الإنهاء الفعلي` (trigger_due_payments). الدفعات الحرة (بالأيام) تُستحق بتاريخها ولا تتأثر بالإنجاز.
- `add_months` (supervision_service.py:26-36): إضافة أشهر تقويمية مع **تثبيت اليوم وتقصيره لآخر الشهر عند اللزوم** (مثال 31 يناير + شهر = 28/29 فبراير). كل شهر تمديد «بدأ» يُحسب كاملًا («حسب اتفاق العمل»، 71-104)؛ الإلغاء (تنازل) بالكسور (1.5 شهر) يُخصم من المستحق لا من التأخير المحسوب `full_end`.
- `expiring_contracts` (429-454): `remaining = end_date - today` ضمن عتبات قابلة للضبط (`expiry_alert_days`). `auto_archive_expired` (5332-5357): `end_date < today AND status ∈ (نشط,معتمد)` → «منتهي» + حدث.
- الإنهاء يقبل `action_date` صريحة (يجب ISO صالح) — تُستخدم لتمرير تاريخ إنهاء إشراف حقيقي.
- تواريخ السند: `vdate` مطلوب؛ `cheque_due_date` يُحفظ فقط إذا `"شيك" in method` (2445).

---

## 9) الحالات الحدية والتحققات (قائمة تحقق للنسخة الأونلاين)
1. `contracts.amount > 0` (CHECK) — و`_validate`: رقم/عميل/تاريخ/مبلغ إلزامية (contract_service.py:359-368).
2. `payment_plan.amount > 0` (CHECK) ⇒ لا صف دفعة صفري؛ «المرنة» لا تُولَّد.
3. مجموع الخطة ≤ قيمة العقد الحالية + 0.001 (إضافة/تعديل/overrides).
4. سقف القبض: `amount > max(current_value, sup_total_due) − collected + 1e-9` ⇒ تحذير OverpayWarning قابل للتأكيد (وليس رفضًا).
5. سقف الصرف للمقاول مقابل عقود الباطن السارية (نفس النمط).
6. العقد الملغى: تجميد مالي كامل (سندات جديدة/تعديل) + تجميد مراحل (إنهاء/تخطي/نقل/تراجع) + منع الصرف على باطن ملغى.
7. الحسميات (addendums معتمدة): `new_value < collected − 0.001` ⇒ رفض («ستصبح قيمة العقد أقل من المحصّل»).
8. تعديل العقد: ممنوع النزول تحت إجمالي الفواتير الصادرة؛ الحذف ممنوع مع أي فواتير/سندات سارية/مطالبات سارية/باطن/دفعات/مراحل (contract_service.py:509-600).
9. مرحلة ↔ دفعة واحدة (في القالب UNIQUE(stage_id) وفي العقد فحص link_plan_stage).
10. قاعدة التتابع في ربط السند بالدفعات + منع الربط بدفعة غير مستحقة/موقوفة بالبوابة.
11. رفع تجميد التعهد: إنهاء مرحلة اسمها يطابق (إنهاء/انتهاء + إشراف) يشغّل set_supervision_end_from_stage.
12. التراجع: يحمي أي استحقاق له سند قبض لاحق (vdate ≥ triggered_at) ولا يلغي السندات أبدًا.
13. ترقيم آلي مقاوم للسباق (retry 8×) للعقود CON والسندات RV/PV وملحقات ADD-؛ فريد UNIQUE.
14. `triggered_at` هو راية «الاستحقاق الفعلي» — فارغ يعني تقديري وغير مستحق في التقارير.

## 10) توصيات تنفيذية للنسخة الأونلاين (Next.js/Prisma)
1. **موديلات Prisma**: انقل الأعمدة كما هي: PaymentPlan{stageId?, triggeredAt?, manualAmount, notes, deletedAddendumId?}، ContractStage{level,isSkipped,closedBy,payKind,payPct,sup*}، Voucher{cancelled,cancelReason,cancelledAt,advanceAmount,allocation,chequeDueDate}، VoucherPaymentLink{kind,lineId polymorphic: paymentPlanId?/subPaymentPlanId?، @@unique([voucherId,lineId])}، TransactionStageLog، ContractEvent، StageNote، Notification.
2. **خوارزمية التغطية** فوق نفّذها دالة واحدة مشتركة (TS) تُستدعى من: جدول خطة السداد، شارة «المستحق الآن»، الكشوف، وربط السند — لا تُخزّن covered/remaining مطلقًا (قاعدة «الرصيد يُحسب دائمًا» في ترويسة contract_service).
3. **سقف القبض**: أعده كفحص server-side في route سند القبض يعيد 409 بقيمة remaining ونص «الزيادة ستُسجل دفعة مقدمة» + حقل `allowOverpay` في الجسم (مطابق لـ OverpayWarning).
4. **تحفيز الدفعات**: عند إنهاء مرحلة (transaction واحد): حدّث contract_stages ثم حدّث payment_plan (dueDate=triggeredAt=finishDate) ثم أنشئ Claim (status registered) وNotification وComment — بنفس النصوص العربية الحرفية. التخطي يكتب notes فقط.
5. **المزامنة/إعادة التوزيع**: طبّق `sync_plan_from_template` كـ endpoint «مزامنة من القالب» بمعاينة قبل التنفيذ (Preview=Exec)، و`rescale` كخيار صريح؛ لا تُعد التوزيع تلقائيًا عند تغيير المبلغ.
6. **booleans العودة**: احترم manualAmount وtriggeredAt في المزامنة (update_lite) — هذا ما يمنع إفساد خطط المستخدمين.
7. **بوابة الباطن**: settings.subPayClientGate + مصادر sub_payment_sources (AND) — بدونها تُصرف أموال المقاول قبل تحصيل العميل.
8. **التواريخ**: خزّن `YYYY-MM-DD` نصًا أو Date بدون وقت، وطابق `_add_months` بقاعدة clamp نهاية الشهر، وخلي «الشهر بدأ = مستحق كامل» للإشراف.
9. **عدّادات الأداء**: اعتمد الاستعلامات المجمّعة الثلاثة في `_overdue_plan_items_impl` بدل استعلام لكل عقد (كان 1400 استعلام على 700 عقد).
10. **لا retention**: لا تبتكر محتجزات غير موجودة؛ الحسميات عبر addendums فقط.

## 11) مراجع أسطر سريعة
- dues core: lifecycle 5718-5787 (plan impl)، 5811-5926 (overdue)، 5746-5785 (statuses)، 5266-5330 (collection report)، 5991-6113 (customer summary)
- cap: lifecycle 2390-2403 (add)، 4553-4570 (update)، 1919-1946 (sub)، 17 (OverpayWarning)، 1948-1979 (freeze)
- value: lifecycle 629-663 (current value)، 1570-1605 (compare)
- plan CRUD: lifecycle 5423-5493، 5494-5527 (validate)، 5527-5674 (overrides)، 5675-5710 (rescale)
- generation: workflow 3162-3223 (signed)، 3956-4026 (snapshot)، 4266-4327 (template)، 4060-4122 (snapshot pay)، 4339-4372 (fallback)، 4130-4198 (preview)، 4240-4265 (map)، 2856-2926 (titles)
- stage engine: workflow 1401-1554 (advance)، 1556-1805 (revert)، 1948-2189 (manual)، 4600-4666 (trigger)، 4373-4394 (skip notes)، 4438-4599 (sub triggers)، 4869-5002 (status)، 4682-4712 (link)
- template rules: workflow 2736-2855 (type_payments/validate)، 2927-3091 (add/update)
- links: vpl 100-208 (plan_rows/due_lines)، 325-336 (room)، 347-369 (validate)، 372-436 (apply)، 477-502 (order)، 505-562 (distribute)، 604-619 (describe_items)
- statements: lifecycle 5034-5111 (contract full)، statement_service 14-130 (contract)، 133-240 (customer unified)
- supervision: supervision_service 26-36 (add_months)، 71-201 (status)
- schema: database 253-262، 417-463، 486-512، 514-530، 686-718، 737-745، 770-826
- dashboard alerts: main_window 293-299؛ contract hub dues: contract_hub 1112-1290
