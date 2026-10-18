# مواصفة نظام التقارير وكشف الحساب والمتابعة — ConTrack V9.15.18

Task ID: 2-b · Agent: research-reports · المصدر: `/home/z/my-project/contrack_v9.15.18/app/` (قراءة فقط)
الهدف: مرجع صيغي دقيق لإعادة بناء منطقة التقارير/الكشف/المتابعة/الاستيراد/المطبوعات في نسخة الويب Next.js + Prisma + TypeScript.
كل صيغة أدناه موثقة بمرجع `ملف:سطر` على الملف الأصلي. القاعدة الذهبية المعلنة في المصدر: «كل دالة ترجع البيانات محسوبة من الحركات (لا أرصدة مخزنة)» — `services/report_service.py:4`.

---

## 0) فهرس التقارير (اسم → ملف → دالة → فلاتر → أعمدة → صيغة)

> مركز التقارير يعرض 8 تقارير فقط في `_REPORTS` (ui/reports_page.py:1301-1415)، ويحكم ظهورها `feature_service.enabled(key)` + `settings_service.cashflow_enabled()` + `auth_service.has_permission(key)` — `ui/reports_page.py:1417-1435`. البطاقات تُجمَّع حسب `module` (ui/reports_page.py:2274-2291).

| # | اسم التقرير (المفتاح) | المصدر | الدالة | الفلاتر | الأعمدة (heads) | الصيغة الحرفية |
|---|---|---|---|---|---|---|
| 1 | 👥 تقرير العملاء والأرصدة `rep_customers` | ui/reports_page.py:1112-1208 (`_data_customers_full`) ← report_service | `customers_balances` (report_service.py:53) + `dues_report` (391) + `overdue_installments(strict=True)` (455) + `due_now_by_customer` (497) | فترة (period=True، all_time=True) + عرض: all/with_balance/no_balance/due_only/by_stages (reports_page.py:1308-1315) | #, العميل, البيان, العقود, قيمة العقود, المحصّل, المستحق الآن, المتبقي, الحالة (reports_page.py:1130-1131) | القيمة الحالية = `contracts_value + net_addendum` (بعد الفترة تُصفَّر الملحقات: report_service.py:126-127)؛ `remaining = value − collected` (report_service.py:130)؛ المستحق الآن صارم = strict فقط (reports_page.py:50-53)؛ الحالة: «مستحق الآن» إن due>0.001 وإلا «عليه رصيد» إن remaining>0.001 وإلا «مسدّد بالكامل» (reports_page.py:1166-1173) |
| 1ب | — عرض «بالمراحل» `by_stages` | ui/reports_page.py:177-198 (`_data_stage_dues`) | `stage_dues(option)` (report_service.py:147) | all/due_only/overdue_only (reports_page.py:257-260) | العميل, العقد, المرحلة, انتهت بتاريخ, الدفعات, المستحق الآن, المتبقي, الحالة (reports_page.py:182-183) | المستحق = مجموع strict_due لسطور المرحلة؛ المتبقي = مجموع remaining لغير المتخطاة (report_service.py:234-256)؛ ترتيب: overdue أولًا ثم «مستحقة» ثم الكبر due (report_service.py:261-263) |
| 2 | 🧭 تقرير تأخير الإشراف `rep_supervision_delay` | ui/reports_page.py:350-402 (`_data_supervision_delays`) | `supervision_delays_report(only_unpaid)` (report_service.py:800) | بلا فترة؛ عرض: unpaid (الافتراضي)/all (reports_page.py:1323-1327) | العميل, العنوان, تاريخ بداية الإشراف, مدة العقد الأساسي, التمديد المدفوع, المدة الملغاة, سبب الإلغاء, نهاية المدة كاملة, التأخير (شهور وأيام), التأخير (مبالغ) (reports_page.py:367-370) | من `supervision_status` فقط: delay_text/delay_value؛ كل شهر يبدأ يُحسب كاملًا؛ المراحل الإشرافية (`is_supervision=1`) تُدمج كصفوف مستقلة (report_service.py:876-931)؛ ترتيب: الأكبر delay_value ثم delay_days (report_service.py:934) |
| 3 | 👷 تقرير مقاولي الباطن الشامل `rep_subcontractors` | ui/reports_page.py:1211-1298 (`_data_sub_full`) | `subcontractors_report()` (report_service.py:639) + `dues_board("all")` (272) | بلا فترة | #, المقاول, العقد/المرحلة, الدفعة, الاستحقاق, المبلغ, المدفوع, المتبقي, الحالة (reports_page.py:1226-1228) | قيمة العقود من sub_contracts بغير الملغى؛ paid = vouchers payment بparty_type='subcontractor' (report_service.py:657-664)؛ سطر إجمالي لكل مقاول بلون `#FEF3C7` (reports_page.py:1249-1254) |
| 4 | 💸 إيرادات ومصروفات `rep_expenses` | ui/reports_page.py:955-1035 (`_data_expenses`) | `vouchers_period` (report_service.py:602) / `expenses_report` (542) | فترة + عرض: all/income/expenses + فلتر vtype (قبض/صرف/إرجاع عهدة/خصم راتب — reports_page.py:1583-1588) | income: م, التاريخ, السند, الجهة, العقد, الدفع, المبلغ, البيان (970-971) · expenses: م, التاريخ, السند, الحساب, الجهة, الدفع, المبلغ, البيان (1025-1026) | الحساب = أول جزء وأخير جزء من `acc_path` مقسوم على `/` (reports_page.py:1005-1012)؛ النوع يشمل vtype∈(receipt,payment,custody_return,salary_deduction) وأي payment للشريك مستثنى من الإجماليات (report_service.py:617-628) |
| 5 | 🏦 التقرير المالي `rep_cashflow` | ui/reports_page.py:474-714 (`_data_cash_flow`) + `_cash_flow_summary` (669) + `_cash_flow_periods` (717) | `cash_flow_detail` (report_service.py:1212) / `cash_flow_report` (1034) | فترة (الافتراضي «اليوم») + عرض: detail/summary/receipts_only/payments_only/recoveries_only/transfers_only/daily/monthly/yearly (reports_page.py:1360-1371) | detail: م, التاريخ, العميل, العقد, المبلغ, البيان (616-617) · periods: الفترة, الوارد, المنصرف, المسترد, منها رسوم بنك, صافي الفترة, الرصيد (725-726) · summary: البيان, المبلغ (705) | انظر قسم E أدناه |
| 6 | 📋 تقرير العقود `rep_contracts` | ui/reports_page.py:746-883 (`_data_contracts`) | `contracts_overview` (1517) / `profitability_report` (689) / `cts.types_report()` / `expiring_contracts` (512) | فترة + عرض: all/profitability/profit_by_type/by_type/expiring (reports_page.py:1381-1388)؛ خيار profitability محجوب بلا صلاحية `action_view_financial` (reports_page.py:1716-1722) | all: العميل, العقد, تاريخ العقد, تاريخ الانتهاء, الحالة, قيمة العقد, المحصّل, المتبقي (869-871) · profitability: العميل, العقد, نوع العقد, قيمة العقد, المحصّل, المنصرف الفعلي, الربح الفعلي, تكلفة متوقعة, ربح متوقع, الهامش % (824-826) | القيمة من `lifecycle_service.contract_values_map` (القاعدة 35) لا من amount فقط (report_service.py:1520-1521)؛ الربحية انظر قسم B.7 |
| 7 | 🏗 تقرير مراحل التنفيذ `rep_execution` | ui/reports_page.py:890-951 (`_data_execution`) | `wf.execution_occupancy_report(option, contract_type, stage_name)` (workflow_service.py:5087) | بلا فترة؛ فلتر كيان: نوع العقد + المرحلة (`execution_filter_contract_types`/`execution_filter_stage_names` — workflow_service.py:5004/5014)؛ عرض: current/delayed/near/ok/no_stage/all | العميل, العقد, المرحلة الحالية, المرحلة التالية, متى بدأت المرحلة الحالية, بقالها كم يوم, المتوقع, الحالة, المسؤول, آخر ملاحظة (reports_page.py:937-939) | لا نسبة إنجاز مئوية — عدّاد أيام: `days_in` مقابل `expected_days`؛ الحالة over/near/ok (انظر قسم D)؛ ترتيب: (stage، الأطول days_in، اسم العميل) (workflow_service.py:5226) |
| 8 | 🎯 تقرير الفرص البيعية `rep_leads` | ui/reports_page.py:331-347 (`_data_prospects`) | `prospects_report` (report_service.py:774) | فترة (على created_at) | رقم العميل, الاسم, الهاتف, العنوان, تاريخ التسجيل, منذ (يوم), ملاحظات (335-336) | عملاء بلا أي عقد بغير الملغى (NOT EXISTS — report_service.py:790-792)؛ days_since = `julianday('now') − created_at` (report_service.py:787-788) |

تقارير خارج مركز التقارير (شاشات مستقلة):
- **كشف الحساب** (عميل/مقاول): `ui/statement.py` + `services/statement_service.py` — قسم A.
- **كشف الشركة الأخرى** (يومي × بوابة): `reports_page.py:1038-1109` (`_data_other_company`) — gateway_ops status='other'، الصافي = الإجمالي − (عدد × العمولة الثابتة)، والتراكمي = افتتاحي + تراكمي صافي، والرصيد = افتتاحي + إجمالي − المسدّد (1038-1087).
- **التسديد — الشركة الأخرى** (`ui/due_items_page.py:1-344`): تبويب «المستحق/المسدد» لعمليات البوابة غير المسددة، أعمدة: ✓، التاريخ، البوابة، العميل، الهاتف، الصافي، المتبقي، المدفوع، التحصيل (تاريخ+يوم عمل، خميس/جمعة/سبت ← الأحد: 250-252)، إجمالي الملف (14-15). ليست «مستحقات العملاء».
- **دفاتر إضافية**: `journal_report` (report_service.py:1573) قيود دفتر اليومية، `contract_gaps_report` (12) فروق قيمة العقد عن الخطة/بنود BOQ، `gateway_summary` (1608) ملخص البوابة T+1.

---

## A) كشف الحساب — services/statement_service.py

### A.1 كشف العقد الواحد `build_statement(contract_id)` (statement_service.py:14-130)

**ترتيب الصفوف حرفيًا:**
1. **صف افتتاحي عقدي**: «قيمة العقد» بمدين = `contract.amount` وتاريخه `contract.contract_date` ومرجعه `contract.contract_number` (statement_service.py:44-53). هذا الصف الوحيد قبل الفرز؛ **لا يوجد رصيد افتتاحي منفصل في كشف العقد**.
2. **الحركات** تُبنى ثم **تُفرز مشتركة** على `(التاريخ, المرجع)` (statement_service.py:97):
   - **الملحقات المعتمدة ADD-xxx**: من `addendums WHERE contract_id=? AND status='معتمد'` (34-39). لكل ملحق: `net = amount_add − amount_deduct`؛ إن `|net| < 0.001` يُتخطى؛ net>0 → **مدين** بوصف `{addendum_type}: {reason}` ومرجع `addendum_number` (ADD-xxx)؛ net<0 → **دائن** بمقدار `−net` (57-69). الأوامر التغييرية إذًا: **صافي زيادة = مدين، صافي خصم = دائن**.
   - **الفواتير**: من `invoices WHERE contract_id=?` (24-28) — ⚠️ **تدخل كشف الحساب لكن محايدة تمامًا (للعلم فقط)**: مدين=0 ودائن=0، ووصفها `فاتورة (للعلم): {description} · {amount:,.3f}` (72-77، تعليق V3.14: «الفاتورة مطالبة توثيقية — تُعرض للعلم ولا تخفض المديونية. المديونية يخفضها التحصيل فقط»). **استثناء/تنبيه**: هذا يعني أن جملة «الفواتير عمومًا لا تدخل كشف الحساب» غير دقيقة حرفيًا — تدخل كصف عرض محايد ولا تؤثر في الرصيد ولا في الإجماليات (total_invoiced تُحسب لكنها لا تدخل total_debit/total_credit: 114-117).
   - **سندات القبض**: من `vouchers WHERE vtype='receipt' AND cancelled=0` مرتبة `vdate,id` (29-33) → **دائن** كامل المبلغ بوصف `description أو «سند قبض»` ومرجع `voucher_number` (78-80).
   - **تمديد الإشراف**: من `supervision_status(contract_id)` — إن `extension_value > 0.001` صف **مدين** واحد بتاريخ `base_end`، وصفه `تمديد إشراف · {n} شهر ({monthly:,.3f} للشهر)` (+ `· بعد إلغاء {waived} شهر` إن وجدت)، ومرجعه الثابت «تمديد» (81-95). `billable_extension` = المحسوب − الملغاة (supervision_service.py:175).
3. **الرصيد التراكمي**: يبدأ 0، ويتحدث `balance += debit − credit` لكل صف بترتيب العرض (41-53 ثم 98-107). صيغة القاموس: `{date, description, ref, debit, credit, balance}`.

**الإجماليات المُرجَعة** (statement_service.py:109-130):
- `current_value = contract.amount + net_addendums + sup_extension` (109).
- `total_deducts = مجموع الدائن لصفوف مرجعها يبدأ بـ ADD-` (110-111).
- `total_debit = contract.amount + sup_extension + مجموع مدين صفوف ADD-` (115-116).
- `total_credit = rec_total + total_deducts` (117).
- `remaining = current_value − rec_total` (112-113, 129) — **قاعدة V3.14 الموحدة: المتبقي = القيمة الحالية − المحصّل فقط**؛ الفواتير محايدة والحسميات محسوبة مرة داخل القيمة.
- كذلك `total_invoiced = inv_total` (للعرض) و`original_amount` و`net_addendums` و`sup_extension`.

### A.2 كشف العميل الشامل `build_customer_statement(customer_id, contract_id?, date_from?, date_to?)` (statement_service.py:133-240)
- **النطاق**: عقد واحد إن مُرّر (مع تحقق ملكية 146-148) وإلا **كل عقود العميل مرتبة على (contract_date, id)** (151-153)، **مستبعدًا حالات `ملغى/ملغي/مسودة`** من عمود contracts.status (154-163).
- لكل عقد يُبنى كشف عقد كامل بمنطق A.1 (169) وتُوسم الصفوف `kind="move"` مع `contract_id/contract_number` (170-171).
- **فلتر الفترة**: الصفوف الأقدم من `date_from` تتحول إلى **«رصيد أول الفترة»** = رصيد آخر صف قبلها لكل عقد (172-177)؛ وإن لا date_from يُحصر فقط بـ date_to (179-181).
- صف افتتاحي إجمالي واحد `kind="opening"` بمدين/دائن حسب إشارة total_opening (191-200).
- الدمج الزمني: `merged.sort((date, contract_number, ref))` (185-187) ثم الرصيد الجاري الواحد `balance += debit − credit` (201-204).
- **إجمالي لكل عقد** `kind="subtotal"` (207-217) و**إجمالي عام** `kind="total"` (219-227)؛ `remaining = آخر رصيد` (221). أنواع الصفوف: move/opening/subtotal/total (140).
- إرجاع: `{customer, contracts, contract, rows, total_debit, total_credit, remaining, opening, contracts_count, date_from, date_to, per_contract}` (228-240).

### A.3 كشف مقاول الباطن `build_subcontractor_statement(sub_id, date_from?, date_to?)` (statement_service.py:243-334)
- **مدين**: كل عقود باطنه من `subcontractors_tree()` بغير الملغى — صف لكل عقد `عقد باطن {number} · {desc}` بمدين `amount` (252-273).
- **دائن**: `extras_service.subcontractor_payments(sub_id)` = سندات صرف `vtype='payment' AND party_type='subcontractor' AND party_id=? AND cancelled=0` (extras_service.py:281-289) — صف لكل سند `سند صرف {voucher_number}` (274-284).
- افتتاحية = مدين(قبل الفترة) − دائن(قبل الفترة) عند date_from (286-292)؛ فرز (date, ref) (297)؛ رصيد جارٍ (300-313)؛ إجمالي عام (315-322).

### A.4 شاشة الكشف ui/statement.py
- تبويب طرفين «عميل/مقاول باطن» (48-51)، فلتر فترة: كل الفترات/هذا الشهر/الربع الحالي/هذه السنة/مخصصة (74-75، 172-194)، عميل + «كل العقود (−1)» أو عقد محدد (280-300).
- جدول 7 أعمدة: التاريخ، العقد، البيان، المرجع، مدين، دائن، الرصيد (161-169). تلوين: مدين بـ MONEY_REMAIN، دائن بـ MONEY_IN، الرصيد بـ PRIMARY؛ الصفوف غير move (فتحية/إجماليات) بخلفية BRAND_50 وعريضة (381-411).
- أزرار: تصدير Excel (526-562 — نفس الأعمدة، number_cols=[4,5,6])، طباعة PDF عبر `generate_customer_statement_pdf` مع **أرشفة تلقائية** في ملف العميل (564-595) وبصلاحية `action_print_statement` (101-103).
- نقرة مزدوجة تفتح المستند: إن ref==رقم العقد → مركز العقد؛ وإلا مطابقة فاتورة ثم سند (458-505).

---

## B) report_service.py — تفصيل كل دالة

### B.1 `contract_gaps_report()` (report_service.py:12-50)
فروق قيمة العقد: `gap_plan = plan_total − amount` (مجموع payment_plan) و`gap_items = items_total − amount` (مجموع `qty*unit_price` لغير الم_deleted_addendum)؛ يستبعد الملغى ويُرجع فقط ما |gap|>0.001 (30-39).

### B.2 `customers_balances(date_from, date_to)` (53-141)
- CTEs: con (عقود بغير ملغى، بعدد وقيمة، فلتر contract_date)، addm (`SUM(amount_add−amount_deduct) WHERE status='معتمد'` بلا فلتر تاريخ — 70-71)، rec_con (قبض بواسطة عقد)، rec_party (قبض `party_type='customer' AND contract_id IS NULL`)، pay_con (صرف بواسطة عقد).
- `value = contracts_value + (addendum صفر عند وجود فترة)` (126-127)؛ `remaining = value − collected`؛ total_in لا يشمل صرف الشريك. ترتيب `cu.id`.

### B.3 `stage_dues(option)` (147-269) — مستحقات العملاء بالمراحل
- العقود بغير (مغلق/ملغى/ملغي/مسودة) (163). لكل عقد تُقرأ خطة الدفعات مع `linked_stage_skipped` واسم/نهاية المرحلة (169-176).
- **التحصيل pool-based**: `collected_map` = مجموع قبض غير مخصص allocation (177-183) ثم لكل دفعة بالترتيب: `covered = min(pool, amount)` و`remaining = amount − covered` (207-210).
- **القاعدة الصارمة strict** (214-229): `strict = not skipped and not waiting and remaining>0.001 and days_diff<=0` حيث `waiting = stage_linked and not triggered`؛ `overdue = strict and due_date < today`.
- حالة المرحلة المجمعة (240-247): «غير مستحقة» إن skipped_g؛ «مستحقة» إن due>0.001 أو (انتهت المرحلة وrem>0.001)؛ «مسددة» إن rem<=0.001؛ وإلا «لم تستحق بعد». عقد بلا خطة وله رصيد → صف واحد بمرحلة «—» والحالة «مستحقة» والمستحق = كامل المتبقي (194-202).

### B.4 `dues_board(option)` (272-388) — لوحة مستحقات الباطن
- سطور الصرف فقط؛ العقود بغير (مغلق/ملغى/ملغي) والباطن بغير الملغى (284-294).
- بلا خطة باطن → سطر مشتق «مستحق عقد الباطن (مشتق)» بحالات: مدفوع/متأخر (end_date<today)/مستحق قريبًا (≤7 أيام)/لم يحل (322-348).
- مع خطة: يعرض `sub_payment_plan` مع التحريك `(trig + " ✓")` (350-367).
- `_due_now`: متبقٍ>0.001 والحالة ليست من (لم يحل، بانتظار إنجاز المرحلة، مرحلة متخطاة، مدفوع) (369-371). فلتر overdue_only = status=='متأخر' (378-379). ترتيب: متأخر أولًا ثم الأكبر متبقيًا (381-382).

### B.5 `dues_report(date_from, date_to)` (391-449) — العقود ذات المتبقي
- يستبعد (ملغى، مسودة) وفلتر فترة على contract_date (419-421).
- **القيمة الحالية = amount + net_addendum(معتمد) + sup_extension من `extensions_map`** (قاعدة 35: report_service.py:423-433).
- `remaining = value − collected`؛ يُخفى ما ≤0.001 (436-437). أعمدة: contract_number, contract_name (=description إن وجد — 401-403), customer_name, value, collected, remaining, sup_extension, last_receipt (=MAX vdate). ترتيب `cu.name, c.id`.

### B.6 `overdue_installments` + `due_now_by_contract/customer` (455-506)
- الأقساط من `lc.overdue_plan_items(strict)`؛ الفترة تحصر due_date (461-465).
- `due_now_by_contract`: لعقد له خطة = مجموع strict remaining؛ ولعقد بلا خطة = كامل المتبقي من dues_report (476-494). `due_now_by_customer` يجمع بالاسم (497-506).

### B.7 `profitability_report(customer_id?, contract_id?)` (689-771) — الربحية
- العقود بغير (ملغى، مسودة). المصادر:
  - value = amount + net_addendum (معتمد) (741) — **لا يستخدم القيمة الحالية بالتمديد الإشرافي هنا**.
  - collected = قبض ساري (713-715).
  - paid (المنصرف الفعلي) = صرف ساري **بشرط `COALESCE(ea.include_in_profitability,1)=1`** من جدول expense_accounts (716-721).
  - other_paid = كذلك من غير subcontractor (722-728).
  - subs_total = مجموع sub_contracts بغير الملغى (729-731).
- **الصيغ الحرفية** (746-752):
  - `expected_cost = subs + other_paid`؛ `expected_profit = value − expected_cost`.
  - `actual_cost = paid`؛ `actual_profit = collected − actual_cost` (أي **الربح الفعلي = المحصّل − المنصرف**، وقيمة العقد للعرض فقط: تعليق 693-696).
  - `margin = actual_profit/collected*100` إن collected>0.001 وإلا 0.
- لا يوجد «الربحية حسب العميل» في مركز التقارير رسميًا (الدالة `_data_customer_profitability` موجودة لكنها خارج `_REPORTS` — reports_page.py:282-328). «ربحية حسب النوع» تجميع على نفس المصدر (reports_page.py:780-818).

### B.8 `expiring_contracts` (512-536)
بلا فترة: من lifecycle (أيام تنبيه مضبوطة)؛ مع فترة: end_date داخل الفترة وحالات بغير (مغلق، ملغى) وremaining أيام.

### B.9 `expenses_report(date_from, date_to)` (542-596)
UNION من 4 أجزاء:
1. سندات صرف سارية (vtype='payment') بعداء `party_type != 'partner'`، **مع استبعاد صرف العهد المجمّع** (`custody_account_id IS NOT NULL AND expense_group_ref=''` وnotes تحتوي «تصفية عهدة من حساب:» / «إغلاق عهدة من حساب:») (548-562).
2. `custody_return` مع advance_employee_id → **سالب** بوصف `{desc} (تخفيض السلفة)` (563-572).
3. `salary_deduction` موجب (573-582) وأخيرًا سالب `(تخفيض السلفة)` (583-592).
- الحساب مسار المصروف = `expense_account_snapshot إن وجد وإلا account` (550). الحساب الموظف للسلف = `ensure_employee_advance_account()[1]` (543-544).

### B.10 `vouchers_period` (602-633)
كل السندات السارية بالفترة (بفلتر vtype اختياري)؛ `total_in` = قبض بغير partner؛ `total_out` = صرف بغير partner وبغير سندات التصفية (`is_settlement_voucher`)؛ `recoveries` = custody_return؛ `net = in − out + rec` (624-633).

### B.11 `subcontractors_report` (639-683)
أعمدة كما بالفهرس؛ paid يشمل سندات الصرف حتى بلا عقد (`v2.contract_id IS NULL OR contract غير ملغى`) (657-664).

### B.12 `supervision_delays_report(only_unpaid)` (800-957)
انظر جدول الفهرس 2. عقود الإشراف: `sup_start_date≠'' AND sup_months>0 AND sup_monthly>0` بغير (مغلق/ملغى) (820-823)؛ يجرد كل من `in_extension` فقط؛ عنوان الموقع = عنوان العميل ← اسم المشروع ← اسم العقد (856-858). مجموعات totals شاملة (935-956).

### B.13 التدفق النقدي — القسم E.

### B.14 `contracts_overview` (1517-1567)
كل العقود بغير (ملغى/مسودة)، القيمة من `contract_values_map(...).current`، المحصّل من قبض group، المتبقي = value − collected، تسمية «رقم · اسم» مع إسقاط الاسم المتساوي/«غير محدد» (1554-1558).

### B.15 `journal_report` (1573-1602) و`gateway_summary` (1608-1678)
- اليومية من جدول `journal_entries` بالفترة؛ القيود العكسية (source_type='voucher_cancel') تُوسم «· (قيد عكسي)»؛ totals مدين=دائن=المجموع وbalanced=True دائمًا.
- gateway_summary: ops status='mine' تُقسم على effective_date ≤ اليوم (محصلة) أو > (معلقة pending_items).

---

## C) المتابعة — followup.py + due_items_page.py + ألوان الحالات

### C.1 FollowupPanel (ui/followup.py:487+)
- **Stepper المراحل**: كل مرحلة شريحة `_state_chip` (185-208): `done` → خلفية `SUCCESS_600` ونص أبيض؛ `skip` → نص NEUTRAL وحد متقطع؛ `current` → خلفية `color or BRAND_600` نص أبيض؛ `future` → نص NEUTRAL وحد عادي. الأيقونات: ✅/⏭️/🔵/⚪ (955-956، 1029).
- **عداد المرحلة الحالية** (979-995 للمعاملات عمومًا، 1073-1111 للعقود — `_load_steps_tail`):
  - `over`: `days_in > expected` → 🔴 بلون `DANGER_600` «متأخر: مر عليها {days} يومًا (المتوقع {expected}) — تجاوز {days−expected} يوم».
  - `near`: `days_in >= expected − 3` → 🟡 `WARNING_600` «قاربت على الانتهاء: {days} يومًا من أصل {expected} — بقي {expected−days} يوم».
  - غير ذلك `ok` → 🟢 `SUCCESS_700` «مر عليها {days} يومًا (المتوقع {expected})».
  - العتبات مصدرها `stage_status`/`_contract_stage_status` (workflow_service.py:4917-4926 و4983-4992: `over` إن days_in>expected، `near` إن days_in ≥ expected−3، وإلا ok؛ بلا expected → جارٍ/«ضمن الوقت» في تقرير الإشغال workflow_service.py:5160).
- **سطر إشراف المرحلة الحالية** يضاف للعداد (1143-1166): متأخر بالنص delay_text وقيمة delay_value، أو «في التمديد · النهاية الكاملة {full_end}»، أو «ضمن المدة · حتى {base_end}».
- إجراءات: إنهاء المرحلة (مع نوافذ تاريخ بداية/نهاية الإشراف عند مطابقة أسماء بدا/بدء أو انتهاء/نهاية + اشتراط تعهد sup_months>0 وsup_monthly>0 — 44-95 و123-182)، تخطي، تراجع (مدير + سبب إلزامي يظهر بتعليقات العميل وسجل العقد — 1327-1357)، سحب المراحل الناقصة من القالب (1185-1261)، ملاحظة مرحلة StageNoteDialog (395+)، شات وسجل (1277-1324).
- StageBar (1419-1610): شريط مدمج بنفس العداد والألوان للسندات وعقود الباطن + شارة آخر ملاحظة ⚠ بـ WARNING_600 (1518-1535). العقد الملغى: «العقد ملغى ومجمّد» وتعطيل الأزرار (1491-1495).

### C.2 المستحقات المالية (ما يعده النظام «مستحق اليوم»)
- **«مستحق اليوم» الصارم (V4.3)**: دفعة خطة متبقيها >0.001 وليست في مرحلة متخطاة، ولم يربطها trigger مراحل معلق، و`due_date <= today` (report_service.py:220-221). المتأخرة = strict وdue_date<today (229).
- «مستحقة» على مستوى المرحلة تُشمل كذلك المرحلة المنتهية ببقايا (report_service.py:242).
- الباطن: ألوان الحالة المرتبطة في dues_board: «متأخر» end_date<today، «مستحق قريبًا» ≤7 أيام، «لم يحل»، «مدفوع» (333-338)؛ والحالات المعتمدة للتحريك (triggered) تظهر بتاريخ + «✓» (360).

### C.3 due_items_page.py (344) — التسديد للشركة الأخرى
ليست متابعة عقود؛ إنها شاشة بنود مستحقة الدفع لعمليات بوابة الشركة الأخرى (Hesabe): تبويب «المستحق/المسدد»، فلتر بوابة وبحث وتحصيل (تاريخ العملية + يوم عمل: خميس/جمعة/سبت ← الأحد) — 20-31 و250-252؛ تحديد متعدد ثم «تسديد المحدد» بمبلغ مقفول عبر TransferDialog (331-344).

### C.4 cashflow_chart.py (109)
رسم أعمدة شهري بسيط RTL بلا مكتبات: أخضر وارد وأحمر منصرف من `extras_service.monthly_cashflow(months=6)` (extras_service.py:245-275 — تجميع `substr(vdate,1,7)` لكل vtype receipt/payment السارية؛ أسماء شهور عربية)؛ الرسم من اليمين (أول شهر يمين — cashflow_chart.py:56-93) وقيم مختصرة كـ «k» فوق الأعمدة.

---

## D) تقرير التنفيذ — نسبة الإنجاز من أين؟

**لا توجد نسبة إنجاز مئوية محسوبة من مراحل مكتملة أو BOQ أو مدفوعات في تقرير التنفيذ.** المعيار هو **زمني**:
- لكل عقد `stage_status(TX_CONTRACT, id)` من نسخة العقد (contract_stages): المرحلة الجارية = `start_date` موجودة و`end_date` فارغ (workflow_service.py:4960-4965)؛ `days_in = max(0, days_between(end or today, start))` (4957-4959)؛ `expected = expected_days`.
- الحالة: over/near/ok كما بالقسم C.1 (workflow_service.py:4983-4992)؛ `done` عند اكتمال المسار، `none` بلا مراحل.
- `execution_report(user_id)` (workflow_service.py:5030-5084): يرجع `delayed/near/missing` حيث missing = مراحل وُسمت تخطٍ «تخطّاها بلا مرور» (5071-5081)؛ ترتيب delayed تنازليًا على التجاوز وnear على الباقي (5082-5083).
- `execution_occupancy_report(option, contract_type, stage_name)` (5087-5227): صف لكل عقد بمرحلة جارية + rows بلا مرحلة (done/no_stage)؛ الحقول: stage, next_stage (أول future تالية — 5137-5147), start_date, days_in, expected, days_over, days_left, state, status_label (`متأخر {over} يوم` / `قارب · بقي {left} يوم` / `ضمن الوقت · بقي {left} يوم` / `جارٍ` — 5153-5161), responsible (moved_by_name أو closed_by — 5182), آخر ملاحظة (5215-5224).
- المتري الوحيد القريب من «نسبة»: شاشة مركز العقد تعرض «نسبة الإنجاز الزمني» progress bar (ui/contract_hub.py:458) — أي نسبة زمنية وليست إنجاز بنود.
- استحقاق الدفعات المرتبط بالمراحل: إنهاء مرحلة يُستحق دفعاتها (`manual_close_stage` يرجع triggered/triggered_sub/triggered_src — followup.py:901-913)، وإعادة الفتح تعيد الدفعات غير المحصلة تقديرية (915-930).

---

## E) التدفق النقدي — التقرير المالي

### E.1 `cash_flow_report` (بالملخصات الفترية) report_service.py:1034-1191
- **حدود الاحتساب**: `cash_start_date` (V5.9) أو `opening_balance_date` كحد أدنى floor؛ الحركات الأقدم مستبعدة كليًا (1049-1058).
- الفترات: `group ∈ daily/monthly/yearly` أو `auto_group`: ≤62 يوم → daily، ≤730 → monthly، وإلا yearly (979-992، 1095-1096). مفاتيح التجميع وعناوينها العربية بشهور «يناير…» (963-976).
- **مصادر الصفوف لكل فترة bucket** (1098-1159):
  - transfer داخلي: مستبعد (1101-1104). payment تصفية عهدة (`is_settlement_voucher`): مستبعد (1105-1109). salary_deduction: مستبعد بلا حركة نقدية (1110-1112).
  - partner: `partner_net += amount (قبض) أو −(صرف)` — خارج الداخل/الخارج ويدخل الرصيد (1122-1125).
  - receipt عادي: `inflow` (1126-1131)؛ receipt «رد سلفة» (advance_employee_id أو notes تبدأ «رد سلفة») مستبعد من الوارد ولا يغير الرصيد V8.5 (1128-1129).
  - payment سلفة موظف: `outflow = amount − المسترد (FIFO)` عبر `_advance_settlement` (995-1031) وتُسجَّل adv_paid/adv_expense/adv_returned (1133-1143).
  - payment عادي: `outflow` كامل؛ إن كان `BANK_FEE_MARK` أو `GATEWAY_FEE_MARK` بالوصف → `bank_fees` (1144-1149).
  - custody_return غير سلف: `recoveries` (1150-1156).
- **الصافي والرصيد** (1161-1191): `adv_adj = −adv_paid + adv_back + adv_expense`؛ `net = inflow − outflow + recoveries + adv_adj`؛ `balance` يتراكم من `opening + before (رصيد ما قبل الفترة من كل الحركات المطابقة استثناءات الأعلى — 1077-1093) + net + partner_net`.
- totals: inflow/outflow/bank_fees/recoveries/partner_net/advance_*/opening/closing/net (= مجموع صافي الفترات).

### E.2 `cash_flow_detail` (سند بسند) 1212-1512
- تصنيف المحفظة بطريقة الدفع لا النوع (1197-1209): `BANK_METHODS=("تحويل","شيك","KNET","بنك","البنك")` → bank؛ `CASH_METHODS=("نقد","نقدًا","نقدا","صندوق","الصندوق")` → cash؛ غير محدد → cash.
- افتتاحية كل محفظة: `opening_balance_bank` و`opening_balance_cash` (والافتتاحي العام يوضع بالصندوق إن لم يُفصَّل — 1473-1481) + أرصدة ما قبل الفترة per (vtype, method, account) مع معالجة transfer بين المحفظتين (1272-1299).
- الأقسام بالعرض (reports_page.py:553-647): الوارد → المنصرف → المسترد → سلف مسترجعة → تحويلات داخلية (اتجاهين + صافي) → حركات الشريك (مدير فقط) → صفوف ختامية: الرصيد الدفتري (بنك)، الرصيد الفعلي (بنك − معلق بوابة عبر `gateway_summary.pending`)، صافي الحركة، رصيد البنك، رصيد الصندوق، رصيد جاري الشريك (596-613).
- **تجميع شهري خاص V4.54/V9.15**: العمولات البنكية وصرف العهد لا تظهر سندًا-سندًا بل سطرًا مجمّعًا شهريًا «عمولات بنكية/صرف عهد — إجمالي N عملية خلال {شهر}» (1426-1468) مع احتساب أثرها النقدي لحظيًا.
- سند القيمة الحالية للعقد تُشتق `contract_current_value(...).current` (1218-1219، 1303-1323).
- `totals.net = in − out + recoveries − adv_paid + adv_back + adv_expense` (1498-1499) و`closing = bank + cash` (1508).

---

## F) الاستيراد — services/import_service.py

### F.1 القالب (8 أوراق عربية RTL) — SHEETS (22-101)
| الورقة | الأعمدة (نجمة = إجباري) |
|---|---|
| العملاء | اسم العميل *، رقم الهاتف *، العنوان، البريد الإلكتروني، ملاحظات |
| العقود | اسم العميل *، اسم العقد/وصفه، قيمة العقد *، تاريخ العقد *، تاريخ البداية، تاريخ النهاية، الحالة، نوع العقد * |
| مقاولو الباطن | اسم المقاول *، رقم الهاتف، نوع النشاط، ملاحظات |
| الدفعات (قديم) | اسم العميل *، اسم العقد، المبلغ *، التاريخ *، البيان، طريقة الدفع |
| سندات القبض | رقم السند القديم، اسم العميل *، اسم العقد، المبلغ *، التاريخ *، البيان، طريقة الدفع، ملاحظات |
| عقود الإشراف | اسم العميل *، اسم العقد/وصفه، تاريخ تعهد الإشراف *، المدة بالأشهر *، قيمة الشهر *، تاريخ العقد، الحالة |
| عقود الباطن | اسم المقاول *، اسم العميل *، اسم العقد الرئيسي *، قيمة عقد الباطن *، تاريخ البداية، تاريخ النهاية، الوصف |
| سندات الصرف | رقم السند القديم، حساب المصروف *، اسم المستفيد (مقاول/مورد) *، اسم العميل، اسم المشروع، اسم العقد الرئيسي، المبلغ *، التاريخ *، البيان، طريقة الدفع، ملاحظات |

- `CONTRACT_STATUSES = ["نشط","معتمد","متوقف","منتهي","مغلق"]` و`PAY_METHODS = ["نقدًا","KNET","شيك","تحويل بنكي","أخرى"]` (103-104) + قوائم منسدلة Excel في G/H/F/J (297-324).
- صف 2 = مثال يُتجاهل حرفيًا حتى لو بقيت أعمدته (446-452)؛ تواريخ تقبل (`%Y-%m-%d, %d/%m/%Y, %d-%m-%Y, %Y/%m/%d, %m/%d/%Y`) (384-396)؛ مبالغ تُنظف من غير الأرقام (399-406).

### F.2 التحققات (فحص مسبق Dry-Run — parse_excel 417-927)
- **مطابقة أسماء عربية مرنة** `_name_key`: إزالة تشكيل/زخارف + توحيد أ إ آ ى ة + casefold (107-115) — الاسم في العقود/السندات يقبل تطبيعًا مع ورقة العملاء أو قاعدة البيانات الحالية (461-479، 507-511).
- عملاء: اسم وهاتف إجباريان، تكرار داخل الملف خطأ (466-477).
- عقود: مبلغ>0 وتاريخ صالح واسم عميل معروف؛ **نوع العقد إجباري ومعتمد** — عمود نوع مفقود (492-496) أو نوع فارغ (534-540) أو مجهول (541-564) يوقف الاستيراد برسالة قرار (صحّح الاسم/أنشئ النوع/عدّل الملف) — «لن يُدخل أي عقد تحت غير محدد».
- إشراف: تعهد ومدة وقيمة شهر إجبارية؛ المبلغ المحسوب = months × monthly (629-634).
- سندات قبض: مبلغ/تاريخ/عميل؛ مطابقة عقد بالاسم — بدون اسم عقد يُقبل فقط لو للعميل عقد واحد (707-722)؛ **تجاوز مجموع القبض لقيمة العقد = تنبيه لا خطأ** (724-732، 894-924) ويسجل الزيادة «دفعة مقدمة». رقم سند قديم مكرر داخل الملف خطأ ومكرر مع القاعدة → تخطٍ بتنبيه (684-691).
- عقود باطن: المقاول موجود بورقة المقاولين، العقد الرئيسي مطابق، المبلغ>0 (753-787).
- سندات صرف: **حساب المصروف إجباري ويطابق إعدادات حسابات المصروفات بالاسم الكامل أو الفرعي** (791-834)؛ المستفيد غير مسجل يُقبل (سيتولد كمقاول تلقائيًا عند التنفيذ)؛ المشروع يجب أن يكون موجودًا (857-861)؛ كتابة اسم عقد بلا عميل خطأ (882-884)؛ **مجموع صرف المقاول على عقد باطن لا يتجاوز قيمته** وإلا خطأ (863-881).
- كشف تكرار سندات عند التنفيذ: قبض بـ (vdate, party_id, contract_id, amount±0.0005, description) أو رقم قديم؛ صرف كذلك بparty (1061-1073، 1125-1135).

### F.3 التنفيذ `execute_import` (933-1155) — بترتيب التبعية وما يُنشأ تلقائيًا
1. عملاء: المطابق بالاسم يُستخدم كما هو (`skipped_customers`)؛ الجديد يُنشأ برقم `CUS-####` تلقائي وملاحظة «[مستورد]» (949-967).
2. عقود: مطابقة (اسم عميل + اسم عقد من contract_name/description/contract_number) → ربط؛ الجديد `contract_service.add_contract` برقم تلقائي + notes=[مستورد] ثم تحديث start/end/status مباشرة (969-1015).
3. عقود إشراف: عقد جديد + `setup_supervision(con_id, sup_start, months, monthly)` (1017-1043).
4. باطن: `lc.add_sub_contract(...)` (1094-1105).
5. سندات القبض: `lc.add_voucher("receipt", ..., allow_overpay=True, _voucher_number=رقم قديم)` — التجاوز يُسجل في `stats["overpaid"]` كسند دفعة مقدمة (1056-1092).
6. سندات الصرف: **مستفيد غير مسجل يُنشأ مقاولًا تلقائيًا** بنشاط «مورد / مصروف عام» (1114-1121)؛ `add_voucher("payment", ..., expense_account_id=..., party_type='subcontractor', allow_overpay=True)` (1136-1146).
7. نهاية: `PRAGMA optimize` + `ANALYZE` (1148-1154).
- إحصائيات مرجعة: customers/contracts/subs/payments/sup_contracts/skipped_*/overpaid[] (942-946).

---

## G) مطبوعات PDF (reports/)

### G.0 الأساس المشترك pdf_utils.py
- خطوط: Amiri (Fallback Tajawal ثم arial/tahoma/dejavu) مسجلة مرة واحدة (74-109). ألوان الهوية: PRIMARY `#1e3a5f`, ACCENT `#2e86ab`, LIGHT_BG `#f2f6fa`, BORDER `#c9d6e3`, GREEN `#1e7d4f`, RED `#b03a2e` (30-35) وتُستبدل من الإعدادات `invoice_primary/invoice_accent` + وضع اقتصادي أبيض/أسود (statement_pdf.py:135-161).
- **RTL/تشكيل**: `ar(text)` = arabic_reshaper (تعطيل ligatures + استبدال ﷲ بـ «الله») + `bidi.get_display` (112-133)؛ كل النصوص تُرسم عبر ar() ويُقص النص بالعرض `fit_pdf_text` (137-154).
- ختم: `get_transparent_stamp` (إزالة الخلفية البيضاء) + قص حواف + رسم بمركز قابل للتحريك stamp_x_mm/stamp_y_mm (192-317). هيدر/فوتر صور مخصصة بعرض كامل (320-349). بيانات المستند باسم الشركة (366-384).
- **التفقيط** `services/tafqeet.py:63-88`: «فقط {عدد} {دينار كويتي} و{فلس} لا غير» (فلس=1000 د.ك) — يُستخدم في voucher_pdf (voucher_pdf.py:299-300).

### G.1 statement_pdf.py
- `generate_statement_pdf(contract_id)` (164-278): ترويسة (صورة مخصصة أو شريط PRIMARY بشعار واسم الشركة ومعلوماتها 31-70) + بطاقة عميل/عقد (180-214) + جدول `_COLS=[26,46,28,27,27,26]مم` برؤوس «التاريخ|البيان|المرجع|مدين|دائن|الرصيد» (73-75) + صفحة جديدة عند y<45مم مع عنوان «· تابع» (219-223) + صندوق إجماليات: إجمالي المدين (العقد والإضافات) / إجمالي الدائن (المحصّل والخصومات) / الرصيد المتبقي (أخضر/أحمر) (243-256) + فوتر (تاريخ إصدار + اسم الشركة 260-271).
- `generate_customer_statement_pdf` (281-396): نفس الشيء بجدول 7 أعمدة `_HEADS_FULL = ["التاريخ","العقد","البيان","المرجع","مدين","دائن","الرصيد"]` (77-78) مع تظليل صفوف kind≠move (341-342) وسطر «رصيد أول الفترة» عند فلتر تاريخ (356-357).

### G.2 tabular_pdf.py — مولد كل تقارير المركز
- `generate_table_pdf(title, heads, col_widths, rows, out_path, totals_row?, footer_note?, color_cols?, orientation?, row_kinds?, right_align_cols?, number_cols?, accent_rows?, keep_accents_in_economy?)` (43-618): A4 أفقي افتراضيًا (طباعة المركز رأسية — reports_page.py:2134)، خط موحد `F_CELL=10.5 / F_HEAD=11 / F_TOTAL=11.5` (81-83)، ترقيم صفحات «صفحة رقم X من Y» فوق شريط الفوتر (139-167)، ملاءمة أعمدة تلقائية بحاجة المحتوى مع مرن/جامد (323-422)، لف نصي على سطرين `_wrap2` (229-265) وقص عند حد الكلمة (540-545)، **أرقام لا تُقص أبدًا — تصغر حتى floor 5.5** (497-499)، `color_cols`: green/red/auto (`auto`= أحمر إن >0 وإلا أخضر 479-480)/profit (أخضر ≥−0.001 481-482)، صفوف العميل (kind='customer') خلفية `#DCE7F5` وعريضة (452-455, 486-491)، accent_rows بخلفية hex محددة (440-447)، صف الإجمالي بخلفية ACCENT (555-582)، footer_note يُقسم بسطر منفصل لكل جزء «|» (584-611).
- `generate_table_excel` (621-714): نفس التقرير Excel RTL (ورقة بعنوان الشركة + سطر تاريخ إصدار، number_format `#,##0.000`)؛ `generate_report_workbook` (717-800) لأكثر من ورقة.

### G.3 voucher_pdf.py — سند قبض/صرف A4 رأسي
- `generate_voucher_pdf(voucher, out_path)` (136-400): خلفية `#F4F5FA` وبطاقات بظل (25-31, 99-125)؛ شريط جانبي بلون primary للقبض وaccent للصرف (179-181)؛ بطاقتا «رقم السند» و«التاريخ» (197-214)؛ بطاقة الحقول: «استلمنا من السيد/السادة» أو «يُصرف إلى السيد/السادة» (سطر واحد مسطر) + «وذلك عن» (3 أسطر مسطرة) (216-256)؛ شريط المبلغ: رقم بحجم 22 + العملة + **التفقيط** (258-301)؛ «طريقة الدفع» كحبة pill (303-321)؛ ملاحظات على سطرين مسطرين (323-347)؛ ختم كبير افتراضي 55مم بمركز قابل للتحريك (349-375)؛ فوتر صورة أو «سند صادر إلكترونيًا ومعتمد رقميًا · v1.0» (377-393). تنظيف نصوص العميل من المراجع الداخلية `[تحويل مجمع: BT-n]` والأرقام قبل «الدفعة» (91-97).
- **توليد الأرقام المرجعية**: رقم السند يأتي من `voucher['voucher_number']` ولا يُولَّد هنا — يولده `lifecycle_service.add_voucher` (وفي الاستيراد يُحفظ الرقم القديم كما هو عبر `_voucher_number`، import_service.py:1085-1091).

### G.4 manual_contract_code.py — دوره الحقيقي
هذا الملف **ليس ترقيمًا يدويًا للعقود**؛ إنه مرجع تحليلي (V8.2) يجمع الأكواد المتعلقة بـ**نوع العقد اليدوي `manual_track=1`** من ui/contracts.py وui/subcontractors.py وcontract_type_service:
- `type_config` يقرأ `contract_types(name, is_supervision, manual_track)` (47-61) وبنية الجدول موثقة أسفل الملف (585-597).
- تصنيف: تلقائي = له شجرة مراحل وليس يدويًا وليس شاملًا `_auto_plan_ui/_client_contract_auto` (26-39, 109-133).
- سياسة صندوق البنود: تلقائي بلا بنود → يُخفى الصندوق ويُكتفى بدفعات الباطن (69-101)؛ **يدوي له قالب بلا بنود → وضع الخطة**: عرض payment_plan كبنود «الدفعة|المرحلة|الاستحقاق|المبلغ» (168-333, 340-400) وبناء دفعات عقد الباطن من الدفعات المحددة بمبالغ يدوية أو توزيع تلقائي بنسب العقد (408-484) ومطابقة المجموع بقيمة عقد الباطن بلوني نجاح/تحذير (492-575).
- ملخص الجدول: يدوي(1) = عرض الدفعات؛ تلقائي(0) = إخفاء وإضافة تلقائية؛ بلا قالب = بنود boq_items (605-635).

---

## H) البحث الشامل — search_service.py + search_utils.py

`global_search(query, limit_per_type=8)` (search_service.py:19-126) — يعمل فقط للاستعلام ≥ حرفين (21-23)، ويعيد `{type, type_label, icon, id, title, subtitle}`:

| الكيان | الحقول التي تُبحث فيها | أيقونة/نوع |
|---|---|---|
| customers (28-39) | name, customer_code, phone, email, address, address_governorate, address_area | 👥 customer |
| contracts (41-59) | contract_number, contract_name, description, اسم العميل وهاتفه وكوده — المبلغ المعروض = amount + ملحقات معتمدة (45-47) | 📑 contract |
| projects (61-74) | name, project_code, عميل | 🏗 project |
| subcontractors (76-89) | name, sub_code, phone, activity | 👷 subcontractor |
| vouchers (91-108) | voucher_number, party, description, account, expense_account_snapshot, custody_account_snapshot, رقم/اسم العقد | 📥 voucher_receipt / 📤 voucher_payment |
| invoices (110-124) | invoice_number, اسم العميل وهاتفه, description | 🧾 invoice |

**الخوارزمية** (search_utils.py): `normalize()` (16-23) = lowercase + إزالة تشكيل `ًٌٍَُِّْٰـ` + استبدالات `أإآٱ→ا، ة→ه، ى→ي، ؤ→و، ئ→ي، ـ→` (9-13) + توحيد مسافات؛ ثم `LIKE %q%` على تعبير SQL مطبَّع `sql_norm_expr` = سلسلة REPLACE بنفس القواعد (37-45)؛ الشرط OR عبر كل الأعمدة (11-12)، بحد 8 نتائج لكل نوع. البحث الداخلي بجداول التقارير يستخدم `contains()` على كل خلايا الصف (reports_page.py:1906-1927، مع إعادة حساب الإجماليات الرقمية لنتائج البحث). نفس التطبيع مستخدم في بحث العملاء (customer_service.py:95-104).

---

## I) extras_service.py — ما هي فعلًا؟

**ليست «البدلات/الإضافات على العقد»** — إنها حزمة خدمات مساندة (extras):

1. **تسمية العقود**: `contract_label` الأولوية: اسم العقد ← الوصف ← «العقد المبرم بتاريخ …» (12-60) مع ذاكرة qcache.
2. **بادئة بيانات تلقائية** من الإعدادات حسب النوع receipt/supervision/transfer/custody/stage_note (62-80).
3. **رسائل واتساب** لسند: قالب قابل للتخصيص `{الطرف}{المبلغ}{العملة}{التاريخ}{الرقم}{الشركة}` أو افتراضي يستخدم القيمة الحالية والمتبقي (87-154)؛ تطبيع أرقام الكويت 965 (375-387) وفتح wa.me (390-418).
4. **مرفقات العقد**: أنواع مسموحة pdf/صور/doc/xls، تخزين `data/attachments/C{id}_{timestamp}_{name}` + سجل حدث (160-213).
5. **تنبيه الشيكات**: سندات طريقة الدفع فيها «شيك» تستحق خلال N يوم (افتراضي 7) (219-239).
6. **بيانات رسم التدفق الشهري** `monthly_cashflow(6)` (245-275).
7. **سجل مدفوعات مقاول** (281-289).
8. **تصفية/إغلاق العقد** (295-352): `closable = التحصيل مكتمل (remaining≤0.001) ومسار المراحل مكتمل (بلا current) والحالة ليست مغلق/ملغى`؛ الإغلاق يضبط status='مغلق' ويسجل حدثًا. `contract_sub_dues` تحذير باطن غير مانع (354-369).
9. **خيارات تخصيص سند القبض على ملحق** `allocation_options`: الملحقات المعتمدة net>0 مع المدفوع عليها عبر vouchers.allocation (454-485) وبيانها «سداد {الأمر التغييري ADD-x (السبب)}» مع أجزاء «الجزء الثاني…» (488-518).
10. **البيان الذكي لسند القبض** (618-739): توزيع المبلغ على دفعات الخطة بالترتيب ثم أوامر التغيير عند تجاوز الخطة قيمة العقد، بصيغ ق1–ق12 (سداد كامل قيمة العقد/دفعة أولى/على الحساب/وزيادة مقدمة/جزء من…) عبر `vpl.describe_items`، وللإشراف `supervision_receipt_description` (629-632)؛ وملاحظة «مرحلة العمل: …» للسند (`smart_receipt_stage_note` 550-591) وبيان صرف غير مرتبط بدفعة (594-615).

---

## 0-bis) تقرير الشركة الأخرى + التسديد (مكملة للقسم B/C)
مذكورة أعلاه في نهاية الفهرس (صفوف 0-bis) — المصدر: reports_page.py:1038-1109 وdue_items_page.py.

---

## اقتراح نماذج Prisma (إن لزم)

الوكيل 2-a يوثق المخطط الكامل؛ هذه النماذج الخاصة بمسؤوليتي مع أبرز الحقول التي تعتمد عليها صيغ التقارير:

```prisma
model Customer { id Int @id; code String @unique @map("customer_code"); name String; phone String;
  gov String? @map("address_governorate"); area String? @map("address_area");
  block String? @map("address_block"); plot String? @map("address_plot");
  contracts Contract[]; createdAt DateTime @default(now()) }

model Contract { id Int @id; number String @map("contract_number"); customerId Int;
  contractDate String; startDate String?; endDate String?; status String; // نشط/متوقف/مغلق/ملغى/مسودة
  amount Float; contractType String; description String?; contractName String?;
  supStartDate String?; supMonths Float?; supMonthly Float?; supWaivedMonths Float?;
  addendums Addendum[]; vouchers Voucher[]; planRows PaymentPlanRow[];
  stages ContractStage[]; invoices Invoice[] }

model Addendum { id Int @id; contractId Int; number String @map("addendum_number"); // ADD-xxx
  type String @map("addendum_type"); reason String?; amountAdd Float; amountDeduct Float;
  status String; adate String } // الحساب يعتمد status='معتمد' فقط

model Voucher { id Int @id; number String @map("voucher_number"); vtype String; // receipt|payment|custody_return|salary_deduction|transfer
  vdate String; amount Float; method String?; description String?; notes String?;
  contractId Int?; partyType String?; partyId Int?; cancelled Int @default(0);
  allocation String?; // تخصيص على ADD-xxx
  expenseAccountId Int?; expenseAccountSnapshot String?; expenseCustomerId Int?; expenseGroupRef String?;
  custodyAccountId Int?; advanceEmployeeId Int?; chequeDueDate String?; projectId Int?;
  subContractId Int? }

model PaymentPlanRow { id Int @id; contractId Int; stageId Int?; title String;
  amount Float; dueDate String; sortOrder Int; triggeredAt String? }

model ContractStage { id Int @id; contractId Int; name String; sortOrder Int; level Int;
  startDate String?; endDate String?; isSkipped Int @default(0); expectedDays Int?;
  payPct Float?; payKind String?; isSupervision Int @default(0);
  supStart String?; supEnd String?; supMonthly Float? }

model ExpenseAccount { id Int @id; name String; fullPath String @map("full_path");
  includeInProfitability Boolean @default(true) }

model Setting { id Int @id; openingBalance Float @default(0); openingBalanceDate String?;
  openingBalanceCash Float?; openingBalanceBank Float?; cashStartDate String?;
  currency String @default("د.ك"); companyName String; /* header/footer/stamp/logo images… */ }

model JournalEntry { id Int @id; entryDate String; description String;
  debitAccount String; creditAccount String; amount Float;
  sourceType String?; sourceId Int? } // sourceType='voucher_cancel' = قيد عكسي

model GatewayOp { id Int @id; opDate String; gateway String; amount Float;
  status String; // 'mine' | 'other'
  effectiveDate String?; paidTransferId Int?; distributed Int?; gwPaid Int?;
  customer String?; phone String?; ref String? }
```

ملاحظات تصميمية للويب:
- كل الأرصدة **محسوبة لحظيًا من الحركات** (قاعدة 3 وقاعدة 35) — لا تخزن رصيدًا في جدول؛ طبقة service موحدة `contractCurrentValue = amount + Σ(addendums معتمد add−deduct) + supExtension`.
- أعمدة الفلترة بالحالات مع الهمزات/الصيغ المتعددة (ملغى/ملغي، مغلق/مغلق) يجب مساواتها كما وردت حرفيًا في الاستعلامات أعلاه.
- تطبيع البحث العربي: أعد تنفيذ `normalize` كما في search_utils.py:9-23 وطبّقه على الاستعلام والأعمدة (في Prisma: استخدم RAW query بـ REPLACE متسلسلة أو عمود مطبَّع مُفهرس).

## اقتراح مسارات API

```
# كشوف الحساب
GET  /api/statement/contract/[id]                     → build_statement
GET  /api/statement/customer/[customerId]?contractId&dateFrom&dateTo → build_customer_statement
GET  /api/statement/subcontractor/[subId]?dateFrom&dateTo             → build_subcontractor_statement
GET  /api/statements/customer/[id]/pdf?contractId&dateFrom&dateTo     → PDF (نفس بنية statement_pdf)

# التقارير (كل تقرير نفس العقد response: {heads, widths, rows, totals, note, colorCols, numberCols, accentRows, rowKinds})
GET /api/reports/customers-balances?from&to&option    # العملاء والأرصدة (all/with_balance/no_balance/due_only/by_stages)
GET /api/reports/stage-dues?option                    # مستحقات المراحل
GET /api/reports/supervision-delays?option            # تأخير الإشراف
GET /api/reports/subcontractors                       # المقاولون الشامل
GET /api/reports/vouchers?from&to&vtype               # إيرادات ومصروفات (all/income/expenses)
GET /api/reports/expenses?from&to                     # تفصيل المصروفات بشجرة الحسابات
GET /api/reports/cashflow?from&to&mode                # detail|summary|receipts|payments|recoveries|transfers|daily|monthly|yearly
GET /api/reports/contracts?from&to&option             # all|profitability|profit_by_type|by_type|expiring
GET /api/reports/execution?option&contractType&stage  # مراحل التنفيذ/الإشغال
GET /api/reports/prospects?from&to                    # الفرص البيعية
GET /api/reports/other-company?from&to                # كشف الشركة الأخرى
GET /api/reports/other-company/due-items?gateway&q&collected # التسديد
GET /api/reports/journal?from&to                      # دفتر اليومية
GET /api/reports/contract-gaps                        # فروق الخطة/BOQ
GET /api/reports/gateway-summary?from&to              # T+1

# التقارير الجدولية (تصدير موحد)
POST /api/reports/export/pdf   {report, params} → tabular_pdf-equivalent (رأسي A4)
POST /api/reports/export/xlsx  {report, params} → multi-sheet RTL

# المتابعة/المراحل (تغذية لوحة التنفيذ)
GET  /api/contracts/[id]/stages/status        → stage_status (state/days_in/expected/path)
POST /api/contracts/[id]/stages/advance       {skip?, note?, actionDate?}
POST /api/contracts/[id]/stages/revert        {reason}
POST /api/contracts/[id]/stages/pull-missing
POST /api/contracts/[id]/stages/[stageId]/supervision {start/end/waive}
POST /api/contracts/[id]/stages/note          {note}
GET  /api/workflow/execution/occupancy        → execution_occupancy_report
GET  /api/workflow/execution/alerts           → execution_alerts

# كشف الحساب المرتبط
GET /api/search?q=…&limitPerType=8            → global_search

# الاستيراد
GET  /api/import/template                     → توليد قالب xlsx (8 أوراق)
GET  /api/import/template/expenses            → قالب الصرف المستقل
POST /api/import/parse   (multipart xlsx)     → {data counts, errors[], warnings[]} (Dry-Run)
POST /api/import/execute                      → stats + overpaid[]
```

---
*نهاية مواصفة المهمة 2-b. الملفات المقروءة بالكامل: statement_service, report_service, customer_service, import_service, extras_service, ui_data_service, search_service, search_utils, statement_pdf, tabular_pdf, voucher_pdf, pdf_utils, manual_contract_code, ui/statement, ui/reports_page, ui/followup, ui/due_items_page, ui/cashflow_chart؛ وبتحديد وظيفي: workflow_service (تنفيذ/إشغال/حالة المراحل)، supervision_service (مراجع)، tafqeet.*
