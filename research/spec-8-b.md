# spec-8-b · كشف الحساب والتقارير — قواعد العمل الحقيقية من ConTrack V9.15.18
Agent: deep-research-statements · نطاق: statement_service / report_service / ui.statement / ui.reports_page / reports (statement_pdf, tabular_pdf, pdf_utils)
جميع أرقام الأسطر أدناه من الملفات المعاد بناؤها في `/home/z/my-project/contrack_v9.15.18/app/`.

---

## 0) خريطة الملفات المقروءة

| الملف | الأسطر | الدور |
|---|---|---|
| `services/statement_service.py` | 334 | كشف الحساب: عقد واحد / عميل شامل / مقاول باطن |
| `services/report_service.py` | 1679 | بيانات كل تقارير المركز (محسوبة من الحركات دائمًا — لا أرصدة مخزّنة، سطر 4) |
| `ui/statement.py` | 595 | شاشة كشف الحساب (عميل/مقاول باطن، فلتر عقد، فترات) |
| `ui/reports_page.py` | 2353 | مركز التقارير: دوال `_data_*` + تعريف `_REPORTS` + عرض/طباعة/تصدير |
| `reports/statement_pdf.py` | 397 | مطبوعة كشف الحساب PDF |
| `reports/tabular_pdf.py` | 801 | مولّد PDF/Excel جدولي موحّد لكل تقارير المركز |
| `reports/pdf_utils.py` | 384 | أدوات RTL مشتركة (خطوط، ألوان، ترويسة/تذييل صور، ختم) |
| مراجع مساندة: `services/supervision_service.py` (64–216) · `services/lifecycle_service.py` (585–659, 5790–5919, BANK_FEE_MARK=2639) · `services/extras_service.py` (281–289, 295–335) |

---

## 1) كشف الحساب (البيان) — القاعدة الحرفية

### 1.1 كشف عقد واحد `build_statement(contract_id)` (statement_service.py:14–130)
الرصيد **محسوب دائمًا من البيانات** (docstring سطر 2–8). القيود:

**مدين (على العميل):**
1. **قيمة العقد** `contract.amount` — صف افتتاحي **دائمًا أول الجدول** بتاريخ `contract.contract_date` ووصف «قيمة العقد» والمرجع `contract_number` (سطور 44–53). *لا يخضع لترتيب الحركات الزمني.*
2. **الملحقات المعتمدة فقط** `addendums WHERE status='معتمد'` (سطور 34–39): الصافي `net = amount_add − amount_deduct`؛ إذا `|net| >= 0.001`:
   - `net > 0` → **مدين**، `net < 0` → **دائن** (سطور 57–69). البيان: `"{addendum_type أو 'أمر تغييري'}: {reason}"`، المرجع `addendum_number` (بادئة `ADD-`).
   - الملحقات غير المعتمدة/المسودات **لا تدخل** إطلاقًا.
3. **مديونية تمديد الإشراف** (سطور 81–95): من `supervision_status(contract_id)`؛ إذا `extension_value > 0.001` حركة مدين واحدة بتاريخ `base_end` (نهاية المدة الأساسية) ووصف `تمديد إشراف · {n} شهر ({monthly} للشهر) [+ بعد إلغاء X شهر]` والمرجع الحرفي `"تمديد"`.

**دائن (من العميل):**
4. **سندات القبض السارية** `vouchers WHERE vtype='receipt' AND cancelled=0` → دائن كامل المبلغ (سطور 29–33, 78–80). البيان = `description` أو «سند قبض».

**محايد (للعلم فقط — V3.14):**
5. **الفواتير** `invoices` (سطور 24–28, 72–77): تظهر بمدين=0 **ودائن=0** بوصف `فاتورة (للعلم): {description} · {amount:,.3f}` — *لا تخفض المديونية؛ المديونية يخفضها التحصيل فقط* (تعليق سطور 73–74).

**استُبعد تمامًا من كشف العقد:** سندات الصرف، المطالبات (claims)، المراحل، الباطن، العهد. المطالبات لا تُذكر إطلاقًا في الملف (لا توجد أي إشارة لها في statement_service).

**الترتيب الزمني:** الحركات (ملحقات + فواتير + قبض + تمديد) تُجمَع في `movements` ثم `movements.sort(key=lambda x: (x[0], x[2]))` = (التاريخ نصيًا ISO، المرجع نصًا) (سطر 97). الرصيد الجاري: `balance += debit − credit` لكل صف (سطور 98–107).

**الإجماليات** (سطور 109–130):
```python
current_value = contract.amount + net_addendums + sup_extension   # القيمة الحالية
total_deducts = Σ credit للصفوف التي ref يبدأ بـ "ADD-"            # حسميات الملحقات
total_debit   = amount + sup_extension + Σ(مدين ADD-*)
total_credit  = rec_total + total_deducts
remaining     = current_value − rec_total     # القاعدة الموحّدة V3.14 (سطر 112–113, 129)
```
- لا **رصيد افتتاحي** في كشف العقد المفرد (أول صف هو قيمة العقد).
- ملاحظة: `remaining` يخصم القبض فقط؛ الفواتير محايدة؛ الحسميات مضمنة داخل `current_value` عبر `net_addendums` (سطر 113: «الحسميات محسوبة مرة واحدة داخل القيمة»).

### 1.2 كشف العميل الشامل `build_customer_statement(customer_id, contract_id=None, date_from="", date_to="")` (سطور 133–240)
- **النطاق**: كل عقود العميل مرتبة بـ `(contract_date, id)` (سطر 151–153)؛ أو عقد واحد إذا مُرّر `contract_id` (يجب أن يعود للعميل نفسه — تحقق سطر 146–148).
- **استبعاد العقود**: عند «كل العقود» تُستبعد الحالات `('ملغى','ملغي','مسودة')` من `contracts.status` (V3.6، سطور 154–163). عند فلتر عقد واحد **لا يوجد** استبعاد حالة.
- يُبنى كل عقد بـ `build_statement` نفسها (نفس القيود أعلاه)، ثم:
  - **فلتر الفترة**: ما قبله يتحول لـ«رصيد أول الفترة» **لكل عقد** = رصيد آخر صف قبله (`before[-1]["balance"]`، سطر 177) — ليست إعادة جمع. بدون `date_from`: يُعرض حتى `date_to` فقط والافتتاحي 0.
  - **الدمج**: `merged.sort(key=(date, contract_number, ref))` (سطور 186–187) — رصيد جارٍ واحد `balance = total_opening + Σ(debit−credit)`.
  - **صفوف خاصة** `kind`: `opening` («رصيد أول الفترة» — يُدرج إذا `date_from` أو `|total_opening|>0.0005`، سطور 191–200) / `move` / `subtotal` («إجمالي عقد X» لكل عقد — مدين/دائن **الفترة المعروضة فقط** + الختامي، سطور 206–217) / `total` («الإجمالي العام»، سطور 222–227).
  - `remaining = الرصيد الختامي الجاري` (سطر 221) وليس معادلة مستقلة.
- مع عقد مفلتر: نفس الدالة لكن بقائمة واحدة، فتظهر subtotal لعقد واحد + الإجمالي العام.

### 1.3 كشف مقاول الباطن `build_subcontractor_statement(sub_id, date_from, date_to)` (سطور 243–334)
- **مدين**: عقود باطنه من `lifecycle_service.subcontractors_tree()` (غير «ملغى») بمبلغ العقد بتاريخ `start_date` (سطور 257–273).
- **دائن**: `extras_service.subcontractor_payments(sub_id)` = `vouchers vtype='payment' AND cancelled=0 AND party_type='subcontractor' AND party_id=?` (extras_service.py:281–289) بوصف `description` أو `سند صرف {number}`.
- افتتاحي = إعادة جمع (مدين−دائن) لما قبل `date_from` (سطور 286–292)؛ ترتيب `(date, ref)`؛ صف «الإجمالي العام». لا فواتير ولا ملحقات هنا.

### 1.4 واجهة الشاشة `StatementPage` (ui/statement.py)
- **تبويب الطرف**: `customer` / `sub` (سطر 27, 47–51). الوضع دائمًا «شامل» — فلتر العقد يغطي حالة العقد الواحد (`_mode="full"`، سطر 28؛ تعليق «عقد واحد أُلغي»).
- **فلتر العقد**: عنصر أول `("كل العقود", -1)` ثم كل العقود؛ `-1` → `None` (سطور 280–286, 293–300).
- **خيارات الفترة الحرفية** (سطر 74–75): `["كل الفترات", "هذا الشهر", "الربع الحالي", "هذه السنة", "فترة مخصصة"]` — الربع = `((month-1)//3)*3+1` (سطر 178). «فترة مخصصة» يُبادل التاريخين إذا start>end (سطر 212–213).
- **أعمدة الجدول (7)** (سطر 162–165): `التاريخ | العقد | البيان | المرجع | مدين | دائن | الرصيد`. الصفوف غير `move` (افتتاحي/إجماليات) bold بخلفية BRAND_50 (سطور 391–403)؛ مدين بلون MONEY_REMAIN، دائن MONEY_IN، رصيد PRIMARY (سطور 404–411).
- **البطاقة العلوية**: العميل (كود)، النطاق (`العقد: X` أو `النطاق: كل العقود (n)`)، الفترة (سطور 431–442).
- **شريط الإجماليات** (سطور 448–456): مع فلتر تاريخ: `رصيد أول الفترة` وإلا `إجمالي المدين`؛ ثم `إجمالي الدائن`؛ ثم `الرصيد المتبقي`. العملة من `settings.currency`. الصيغة `{:,.3f}` (3 خانات عشرية — دينار كويتي) في كل مكان.
- **نقرة مزدوجة** تفتح المستند: مطابقة رقم العقد → مركز العقد، وإلا فاتورة/سند برقم المرجع (سطور 458–505).
- **الطباعة** مشروطة بصلاحية `action_print_statement` (سطور 101–103) → `generate_customer_statement_pdf` + أرشفة تلقائية في ملف العميل `كشف_حساب_{number}.pdf` (سطور 564–595). كشف الباطن: طباعة PDF غير متاحة («من تصدير Excel حاليًا»، سطر 568–570).
- **Excel**: نفس الأعمدة السبعة `number_cols=[4,5,6]`، الوسم `كشف_حساب_{رقم العقد}` أو `كشف_حساب_شامل_{كود العميل}` (سطور 526–562).
- **حالة الفراغ**: بلا طرف = إرشاد للاختيار؛ طرف بلا حركات = «لا حركات مطابقة في النطاق والفترة المحددة» (سطور 356–379). لا اختيار تلقائي للعميل عند الفتح (سطر 223–224).

---

## 2) هل يدخل الإشراف/الملحقات/المطالبات في كشف الحساب؟ (جواب حاسم من الكود)

| العنصر | الحكم | الدليل |
|---|---|---|
| **الملحقات المعتمدة** | ✅ تُضاف كقيود: إضافة=مدين، حسمي=دائن (صافي فقط، يُهمل ما < 0.001) | statement_service.py:34–39, 57–69 |
| **ملحقات غير معتمدة** | ❌ لا تُقرأ أصلًا (فلتر `status='معتمد'`) | سطر 37 |
| **تمديد الإشراف (عقد)** | ✅ قيد مدين واحد تلقائي بتاريخ `base_end` بقيمة `extension_value = billable_extension × monthly` حيث `billable = كل شهر «بدأ» بعد نهاية المدة − الملغى بتنازل` | سطور 81–95 + supervision_service.py:104–110 |
| **إشراف مرحلة (is_supervision)** | ❌ **لا يدخل كشف الحساب** — `build_statement` ينادي `supervision_status(contract_id)` للعقد فقط؛ `stage_supervision_status` لا يُستدعى فيه (يدخل فقط في تقرير تأخير الإشراف) | statement_service.py:82–95 مقابل report_service.py:876–931 |
| **الفواتير** | ⚠️ تُعرض للعلم فقط بمدين=دائن=0 ولا تؤثر في الرصيد أو المتبقي (V3.14) | سطور 72–77, 112–114 |
| **سندات القبض** | ✅ دائن كامل (سارية فقط `cancelled=0`) | سطور 29–33 |
| **سندات الصرف (للعميل)** | ❌ غير موجودة في كشف العميل (الصرف كله للباطن في كشفه المنفصل) | — |
| **المطالبات (claims)** | ❌ لا أي ذكر لها في statement_service (لا قيود ولا عرض) | فحص الملف كاملًا |
| **عقود الملغاة/المسودة (الشامل)** | ❌ مستبعدة من كشف العميل الشامل (V3.6) | سطور 154–163 |

---

## 3) تقارير المستحقات

### 3.1 `dues_report(date_from, date_to)` (report_service.py:391–449) — «مستحقات العقود» (للمستحقات/العملاء)
- الاستعلام: عقود `status NOT IN ('ملغى','مسودة')` — *«مغلق» يبقى داخل التقرير* (سطر 419)، فلتر الفترة على `contract_date` (سطر 420).
- **المعادلة** (سطور 423–437):
```python
value     = amount + net_addendum(معتمد) + sup_extension   # قاعدة 35: مديونية التمديد داخل القيمة
collected = Σ vouchers(receipt, cancelled=0)               # بلا تفريط على allocation هنا
remaining = value − collected
# الصف يُعرض فقط إذا remaining > 0.001 (سطر 436)
```
- `sup_extension` من `extensions_map()` (سطور 424–428).

### 3.2 `stage_dues(option)` (report_service.py:147–269) — «مستحقات العملاء بالمراحل» V4.4
- **عقود مشمولة**: `status NOT IN ('مغلق','ملغى','ملغي','مسودة')` (سطر 163).
- **المصادر**: `payment_plan` مع المرحلة المرتبطة (`stage_id` → `contract_stages`: name/end/is_skipped)، وترتيب `(contract_id, due_date, sort_order)` (سطور 169–176).
- **بركة التحصيل**: `collected_map` = قبض سارٍ **بشرط `allocation IS NULL OR allocation=''`** (غير موزّع على دفعات بعينها) (سطور 177–183).
- **التوزيع FIFO**: لكل دفعة بالترتيب: `covered = min(pool, amount); pool -= covered; remaining = amount − covered` (سطور 204–210).
- **الاستحقاق الصارم (V4.3)** لكل سطر (سطور 211–230):
```python
skipped  = stage_linked and linked_stage_skipped
waiting  = stage_linked and not triggered_at and remaining > 0.001   # معلّقة على إنجاز مرحلة
strict   = not skipped and not waiting and remaining > 0.001 and (due_date − today) <= 0
strict_due = remaining if strict else 0
overdue    = strict and due_date < today
```
- **تجميع بالمرحلة** (سطور 231–256): مجموعة = `stage_id`؛ الحالة:
  - `غير مستحقة` إذا أي سطر متخطى؛ `مستحقة` إذا `due>0.001` أو (انتهت المرحلة بتاريخ والمتبقي>0)؛ `مسددة` إذا المتبقي≤0.001 (غير المتخطى)؛ وإلا `لم تستحق بعد`.
  - `due` = Σ strict_due للمجموعة؛ `remaining` = Σ remaining لغير المتخطى؛ `overdue` = أي سطر متأخر.
- **عقد بلا خطة دفعات**: صف واحد بمرحلة «—» وعنوان «عقد بلا خطة دفعات» و`due = remaining = dues_report()[contract_number]` إذا المتبقي > 0.001، و`overdue=True` (سطور 192–203).
- **الفلاتر الحرفية** (سطور 156, 257–260): `option = "all"` (افتراضي) | `"due_only"` (due>0.001) | `"overdue_only"` (overdue).
- **الترتيب** (سطور 261–263): المتأخر أولًا (0)، ثم «مستحقة» (1)، ثم البقية (2)، ثم تنازليًا بحسب `due`.
- **الإجماليات**: `n, due_now=Σdue, remaining=Σremaining, overdue_n` (سطور 264–269).

### 3.3 `dues_board(option)` (report_service.py:272–388) — «لوحة مستحقات الباطن» V4.3 (صرف فقط)
- **عقود**: `NOT IN ('مغلق','ملغى','ملغي')`؛ **عقود الباطن**: `sc.status NOT IN ('ملغى','ملغي')` (سطور 284–294).
- **المنصرف**: `vouchers sub_contract_id IN (...) AND vtype='payment' AND cancelled=0 AND (allocation فارغ)` مجمّع لكل sub_contract (سطور 295–305).
- **سطور الخطة**: من `lifecycle_service.sub_payment_plan(sub_contract_id)`؛ الاستحقاق يعرض `triggered_at + " ✓"` إذا مشغّلة وإلا `due_date`؛ المصدر `"مرحلة"` إذا stage_id وإلا `"أيام"`؛ عمود «مصادر التحصيل» من `sub_payment_sources ⋈ payment_plan.title` (سطور 306–312, 350–367).
- **بلا خطة**: سطر مشتق واحد «مستحق عقد الباطن (مشتق)» بـ `remaining = max(0, amount − paid)` والاستحقاق = `sc.end_date` والحالة (سطور 322–349):
```python
مدفوع        إذا remaining ≤ 0.001
متأخر        إذا due_date < today
مستحق قريبًا إذا (due_date − today) ≤ 7 أيام
لم يحل       غير ذلك
```
- **المستحق الآن** `_due_now` (سطور 369–371): `remaining > 0.001 AND status NOT IN ("لم يحل","بانتظار إنجاز المرحلة","مرحلة متخطاة","مدفوع")`.
- **الفلاتر الحرفية** (سطور 282, 373–379): `"all"` | `"customers"` → **قائمة فارغة** (بقايا V4.2: «لم يعد لها سطور» و"subs" مرادف للكل) | `"due_only"` | `"overdue_only"` (status=="متأخر" حرفيًا).
- **الترتيب**: متأخر أولًا ثم `-remaining` (سطور 381–382). الإجماليات: `n, sub_remaining, overdue_n` (سطور 383–387).

### 3.4 المستحق الآن بالعقد/العميل (سطور 470–506)
- `due_now_by_contract`: لكل عقد له خطة = Σ بواقي `overdue_installments(strict=True)`؛ عقد بلا خطة = كامل متبقّيه من dues_report.
- `overdue_installments(strict)` (سطور 455–467) يفوّض `lifecycle_service.overdue_plan_items` (lifecycle_service.py:5811–5919): نفس FIFO لكن يستبعد أيضًا المبالغ الموجّهة لدفعات بعينها (`voucher_payment_links` يُخصم من البركة ويدفع الدفعة المقصودة مباشرة، سطور 5878–5884)؛ يُسقط المتخطاة وغير المشغّلة المرتبطة بمرحلة (5890–5893)؛ `strict`: `days_diff<=0` فقط؛ غير strict: حتى 7 أيام قادمة؛ الحالة: `جزئي` (covered>0 و due>=today) / `متأخر` (due<today) / `مستحق قريبًا`.

### 3.5 أعمدة الجداول في الواجهة
- **`_data_stage_dues`** (reports_page.py:177–198): `العميل | العقد | المرحلة | انتهت بتاريخ | الدفعات (عناوين مفصولة بـ"، ") | المستحق الآن | المتبقي | الحالة` — color: المستحق auto، الحالة status؛ `number_cols=[5,6]`.
- **`_data_dues_board`** (reports_page.py:201–225): `العقد | المقاول | المرحلة | الدفعة | الاستحقاق | المبلغ | المدفوع | المتبقي | الحالة | المصدر | مصادر التحصيل` — إجماليات: Σ amount, Σ paid, sub_remaining.
- **`_data_customers` (الشجري القديم)** (reports_page.py:26–145): `اسم العميل | البيان | الهاتف | الاستحقاق | العقود | قيمة العقود | المحصّل | المستحق الآن | المتبقي | الحالة` — شجرة أب (عميل)/أبناء (عقد «متبقٍ عقد» أو دفعة مجدولة)؛ `_data_dues` و`_data_installments` **أسماء قديمة** تعيد نفسها (سطور 148–154).

### 3.6 تقرير «العملاء والأرصدة» الفعلي في المركز `_data_customers_full` (reports_page.py:1112–1208)
مسطّح: صف عميل (accent أزرق `#DBEAFE` «إجمالي {اسم}») ثم أبناؤه (عقد/دفعة) ثم «الإجمالي العام» (`#EEF2FF`).
- الأعمدة: `# | العميل | البيان | العقود | قيمة العقود | المحصّل | المستحق الآن | المتبقي | الحالة`.
- مصدر الأعمدة: `customers_balances()` (تالٍ) + `dues_report` + `overdue_installments(strict)` + `due_now_by_customer`.
- حالات العميل (سطور 1166–1173): `مستحق الآن` (due>0.001) → `عليه رصيد` (remaining>0.001) → `مسدّد بالكامل` (value>0.001) → "".
- **`customers_balances`** (report_service.py:53–141): CTEs — عقود `status != 'ملغى'` (عدد وقيمة)؛ ملحقات معتمدة (صافي) **تُضاف فقط عند عدم تحديد فترة** (`addendum = 0.0 if date_from else net`، سطر 126)؛ المحصّل = قبض مرتبط بعقد + قبض غير مرتبط `party_type='customer' AND contract_id IS NULL`؛ المنصرف = صرف مرتبط بعقد. `remaining = value − collected`.

---

## 4) الربحية

### 4.1 `profitability_report(customer_id, contract_id)` (report_service.py:689–771)
لكل عقد `status NOT IN ('ملغى','مسودة')` (مغلق مشمول):
```python
value          = amount + net_addendum(معتمد)          # بلا تمديد الإشراف هنا!
collected      = Σ receipts (سارية)
paid           = Σ payments (سارية) JOIN expense_accounts
                  WHERE COALESCE(include_in_profitability,1)=1   # حسابات مستثناة من الربحية
other_paid     = نفس paid لكن party_type != 'subcontractor'
subs_total     = Σ sub_contracts (غير ملغاة) للعقد
expected_cost  = subs_total + other_paid                 # المتوقع
expected_profit= value − expected_cost
actual_cost    = paid
actual_profit  = collected − paid                        # الربح الفعلي (قاعدة docstring سطر 693)
margin         = actual_profit/collected*100 إذا collected>0.001 وإلا 0
```
- **ما يُخصم**: كل مدفوعات الصرف السارية على حسابات `include_in_profitability=1` (الافتراضي 1 — أي حساب بلا صف في expense_accounts يُحتسب). **المدفوعات الباطلة (cancelled=1) لا تُخصم**. المدفوعات على حسابات معطَّلة الاشتمال (include_in_profitability=0) تخرج من الربحية.
- **قيمة العقد للعرض فقط ولا تدخل حساب الربح** (docstring سطور 694–696) — حتى لا يقل الربح عند تجاوز التحصيل للقيمة.
- الإجماليات: value/collected/cost(فعلي)/profit(فعلي)/expected_cost/expected_profit.
- ⚠️ فرق مهم: الربحية **لا تُدخل مديونية تمديد الإشراف** في `value` (عكس dues_report/contract_current_value).

### 4.2 عروض الواجهة
- **`_data_profitability`** (reports_page.py:253–279): `العميل | العقد | نوع العقد | قيمة العقد | المحصّل | المنصرف الفعلي | الربح الفعلي | تكلفة متوقعة | ربح متوقع | الهامش %` — هامش الإجمالي = `t.profit/t.collected*100`. color: collected green، المنصرف red، الربح profit، التكلفة المتوقعة red.
- **ربحية العقود كخيار في تقرير العقود** (`_data_contracts option="profitability"`, سطور 820–844) نفس الأعمدة — التقرير المستقل حُذف وأُدمج (تعليق سطور 1336–1338).
- **`profit_by_type`** (سطور 780–818): تجميع نفس بيانات profitability حسب `contract_type` (نوع فارغ → «غير محدد»): `نوع العقد | عدد العقود | إجمالي القيمة | متوسط قيمة العقد | المحصّل | المنصرف الفعلي | الربح الفعلي | الهامش %`.
- **`_data_customer_profitability`** (سطور 282–328): تجميع بالعميل مع صف «إجمالي العميل» وصفوف «↳ عقد» — **مُزال من `_REPORTS`** (مكرر) والدالة محفوظة للتوافق (docstring سطور 285–289).
- **فلتر الصلاحية**: خيار `profitability` يُخفى ممن لا يملك `action_view_financial` (سطور 1715–1722).

---

## 5) التدفق النقدي (التقرير المالي)

### 5.1 التفصيلي `cash_flow_detail(date_from, date_to)` (report_service.py:1212–1512)
- **الأرضية**: `cash_start_date` (V5.9) أو `opening_balance_date` — كل ما قبله خارج الكشف كليًا (سطور 1230–1246).
- **تصنيف المحفظة بطريقة الدفع لا نوع السند** (سطور 1198–1209):
```python
BANK_METHODS = ("تحويل","شيك","KNET","بنك","البنك") → "bank"
CASH_METHODS = ("نقد","نقدًا","نقدا","صندوق","الصندوق") → "cash"
غير محدد/أخرى → "cash"
```
- **أرصدة ما قبل الفترة** لكل محفظة (سطور 1270–1299): قبض/مرتجع يزيد، صرف ينقص، تحويل ينقل بين المحفظتين، `salary_deduction` بلا أثر. (استبعاد تصفيات العهد؛ سلف الموظفين V8.4 خارج الرصيد السابق في الملخص فقط.)
- **تصنيف كل سند** (سطور 1335–1446):
  - `receipt` (party_type='partner') → `partner_moves` (جاري الشريك: أثر نقدي على المحفظة، خارج الوارد/المنصرف) (1358–1364).
  - `custody_return`: إذا `advance_employee_id` → «رد سلفة» بلا مصروف (1371–1374)؛ وإلا **مسترد** (recoveries) نقد داخل (1375–1379).
  - `salary_deduction`: يُذكر ضمن `advance_returned` فقط إن كان لسلفة («سلفة مسترجعة بخصم الراتب — غير محسوبة مصروفًا») وإلا يُهمل (1381–1388).
  - `receipt` لسلفة (رد سلفة) → يرفع المحفظة ولا يُحسب إيرادًا (V8.5، 1389–1393).
  - `receipt` عادي → **الوارد** (receipts).
  - `transfer` → **تحويلات داخلية** (من حساب ← إلى حساب + اتجاه المحفظتين) لا تدخل الوارد/المنصرف (1396–1406).
  - `payment`:
    - تصفية عهدة (`is_settlement_voucher`) → **لا تظهر** في التقرير (V4.54، 1408–1411).
    - سلفة موظف: الخروج النقدي كامل من المحفظة، ويُدرج بالمنصرف **بالجزء غير المسترَد فقط** (FIFO عبر `_advance_settlement` سطور 995–1031) (1412–1425).
    - صرف عهدة (`custody_account_id` ليس NULL) → يُجمَّع شهريًا بسطر واحد «صرف عهد» (V9.15، 1426–1434, 1459–1468).
    - عمولات (`BANK_FEE_MARK="[رسوم بنك]"` lifecycle:2639 أو `GATEWAY_FEE_MARK`) → سطر مجمّع شهري «عمولات بنكية» (1435–1444, 1448–1457).
    - غير ذلك → **المنصرف**.
- **قيمة العقد** في كل سطر من `contract_current_value` (قاعدة 35: `current = amount + ملحقات معتمدة − حسمياتها + sup_extension`) مع كاش دفعي `contract_values_map` (سطور 1301–1323).
- **الأرصدة الختامية** (سطور 1473–1509): `opening_cash = opening_balance_cash أو opening_balance`؛ `opening_bank = opening_balance_bank`؛ `bank = opening_bank + Σحركات bank`؛ `cash = opening_cash + Σحركات cash`؛ `closing = bank + cash`.
- **totals** (1494–1511):
```python
in  = Σ receipts · out = Σ payments (بعد تجميع العمولات/العهد وتقنين السلف)
recoveries = Σ المسترد
net = in − out + recoveries − adv_paid + adv_back + adv_expense
partner_net = Σ(قبض شريك − صرف شريك) · partner_balance = lifecycle.partner_balance(date_to)
opening / bank / cash / closing / cash_start_date
```

### 5.2 عرض التفصيلي `_data_cash_flow(option="detail")` (reports_page.py:474–647)
أقسام مدمجة في جدول واحد `م | التاريخ | العميل | العقد | المبلغ | البيان`:
1. `◀ الوارد` + إجمالي (accent `#DCFCE7`)
2. `◀ المنصرف` + إجمالي (`#FEE2E2`)
3. `◀ المسترد` + إجمالي (`#D1FAE5`)
4. `◀ سلف مسترجعة (غير محسوبة مصروفًا)` (إن وجدت)
5. `◀ تحويلات داخلية` + سطور: تحويلات بنك→صندوق، صندوق→بنك، داخل نفس المحفظة، صافي التحويلات (= طرح لا جمع، V4.33)
6. `◀ حركات الشريك` (**للمدير فقط**، `#F1F5F9`)
7. أسطر ختامية: `الرصيد الدفتري (بنك)` = t.bank · `الرصيد الفعلي (بنك − معلّق)` = `t.bank − gateway_summary.pending` (T+1، report_service.py:1608–1678) · `صافي الحركة` · `رصيد البنك` · `رصيد الصندوق` · `رصيد جاري الشريك` (مدير فقط).
- **خيارات الفلتر الحرفية** `_REPORTS` (سطور 1360–1371): `detail` (بالحركات) | `summary` (بالإجمالي) | `receipts_only` | `payments_only` | `recoveries_only` | `transfers_only` | `daily` | `monthly` | `yearly`.
- ⚠️ **فجوة حقيقية**: `_data_cash_flow` تعالج `summary` والخيارات الأربعة _only فقط؛ **`daily/monthly/yearly` تسقط افتراضيًا إلى العرض التفصيلي** (لا تحويل إلى `_cash_flow_periods` سطر 717) — الدالة موجودة لكنها غير قابلة للوصول من القائمة.

### 5.3 الملخص `_cash_flow_summary` (سطور 669–714)
جدول سطرين: `إجمالي الوارد | إجمالي المنصرف | إجمالي المسترد | صافي الحركة | رصيد البنك | رصيد الصندوق | الرصيد الدفتري (بنك) | الرصيد الفعلي (بنك − معلّق)`.

### 5.4 الملخص بالفترات `cash_flow_report(group="auto")` (report_service.py:1034–1191) + `_cash_flow_periods` (reports_page.py:717–735)
- **auto** (`auto_group` سطور 979–992): `≤62 يوم → daily`، `≤730 → monthly`، غير ذلك `yearly`؛ أو تمرير صريح.
- استبعاد: `transfer`، تصفيات العهدة، `salary_deduction` (V4.54)؛ الشريك → `partner_net`؛ رد سلفة (قبض بسلفة) بلا وارد؛ السلفة: outflow = الجزء غير المسترَد فقط؛ المرتجع النقدي (عهدة) = recoveries.
- أعمدة: `الفترة | الوارد | المنصرف | المسترد | منها رسوم بنك | صافي الفترة | الرصيد` — `net = inflow − outflow + recoveries + advance_net`؛ `balance = opening(+before) + Σ(net + partner_net)` تراكمي؛ `before` = صافي كل ما قبل الفترة (سطور 1078–1093) مع استبعادات التصفيات والسلف.

### 5.5 الشركة الأخرى / البوابة
- `gateway_summary` (1608–1678): عمليات `status='mine'` و`amount>0`؛ إذا `effective_date ≤ اليوم` أو فارغ → محسوبة، وإلا معلّقة (تُستخدم للرصيد الفعلي).
- `_data_other_company` (reports_page.py:1038–1109): كشف «الشركة الأخرى» — تجميع `gateway_ops status='other' AND distributed=1 AND (gw_paid فارغ أو 1)` يوميًا×بوابة: `اليوم | البوابة | العدد | الإجمالي | العمولة (عدد×fee_fixed) | الصافي | التحويل | التراكمي` + أسطر الإجمالي/الافتتاحي/المسدّد للشركة (other_transfers_total)/المتبقي. **غير مدرجة في `_REPORTS` حاليًا** (استُبدلت بشاشة مستقلة) — الدالة متاحة.
- ⚠️ «تسديدات الشركة الأخرى» **لا تدخل التقرير المالي التفصيلي** إطلاقًا (لا partner ولا other في cash_flow_detail) — تُدار في مسارات مستقلة (other_transfers/بوابة).

---

## 6) تأخير الإشراف `_data_supervision_delays` (reports_page.py:350–402 ← report_service.py:800–957)

**الجمع** (report_service.py:813–823): عقود بـ `sup_start_date != '' AND sup_months > 0 AND sup_monthly > 0 AND status NOT IN ('مغلق','ملغى')`.
**+ المراحل الإشرافية** (V3.21، سطور 876–931): `contract_stages.is_supervision=1 AND sup_start != '' AND sup_end != '' AND sup_monthly > 0 AND is_skipped=0` وعقد غير مغلق/ملغى — تُدمج كصفوف بعلامة `is_stage=True` و`collected=0` وعنوان `👁 {رقم العقد} — {اسم المرحلة}`.

**الحساب** (supervision_service.py:71–201):
```python
base_end      = start + sup_months (بشهور تقويمية _add_months)
in_extension  = today >= base_end
extension_months = عدد الشهور التي «بدأت» بعد base_end حتى اليوم   # كل شهر بدأ = شهر كامل (سطر 74)
billable      = max(0, extension_months − waived_months)           # التنازل يخصم
extension_value  = billable × monthly
total_due     = (sup_months×monthly − sup_discount) + extension_value
paid_ext_value   = max(0, min(extension_value, collected − base_value))   # المدفوع من التمديد
settled_ext      = paid_ext_months + waived_months
full_end         = start + (months + int(settled_ext))               # نهاية المدة كاملة
delay_months     = عدد الشهور التي بدأت بعد full_end                 # مالي
delay_value      = delay_months × monthly
delay_text       = «X أشهر وY يومًا» (عرض فعلي elapsed)
```
- **العرض في التقرير** (`only_unpaid = option != "all"`): يُسقط ما ليس في التمديد (`in_extension`)؛ وعند unpaid يُسقط `delay_months<=0 و waivied_months==0` (سطور 830–834, 890–895).
- **الترتيب**: `-delay_value ثم -delay_days` (سطر 934).
- **أعمدة الواجهة** (سطور 366–371): `العميل | العنوان (عنوان العميل ← اسم المشروع ← اسم العقد) | تاريخ بداية الإشراف | مدة العقد الأساسي | التمديد المدفوع | المدة الملغاة | سبب الإلغاء | نهاية المدة كاملة | التأخير (شهور وأيام) | التأخير (مبالغ)`.
- **الإجماليات** (سطور 935–956): أشهر أساسية/مدفوعة/ملغاة/تأخير + قيمها + تفصيل المراحل (`stage_count, stage_delay_months, stage_delay_value`)؛ الملاحظة تذكّر قاعدة «أي شهر يبدأ يُحسب شهرًا كاملًا» (سطر 392).
- **فلاتر `_REPORTS` الحرفية** (سطور 1323–1327): `unpaid` («عليهم متبقٍ فقط»، الافتراضي) | `all` («كل العقود في التمديد»). بلا فلتر فترة (`period: False`).

---

## 7) باقي تقارير النطاق (مختصر للسياق)

- **`_data_contracts`** (سطور 746–883): `all` → `contracts_overview` (report_service.py:1517–1567): عقود `NOT IN ('ملغى','مسودة')`، `value = contract_current_value.current`، `collected` من القبض، `remaining = value − collected`؛ أعمدة `العميل | العقد (رقم · اسم) | تاريخ العقد | تاريخ الانتهاء | الحالة | قيمة العقد | المحصّل | المتبقي`. `expiring` → `expiring_contracts` (بفترة: end_date داخلها؛ بلا فترة: أيام التنبيه، سطور 512–536). `by_type` → `contract_type_service.types_report()`.
- **`_data_execution`** (سطور 890–951): مراحل التنفيذ من `workflow_service.execution_occupancy_report` — أعمدة `العميل | العقد | المرحلة الحالية | التالية | متى بدأت | بقالها كم يوم | المتوقع | الحالة | المسؤول | آخر ملاحظة (نص + تاريخ)`؛ فلاتر `current/delayed/near/ok/no_stage/all` + فلتري نوع العقد والمرحلة (`entity_filter="execution"`).
- **`_data_expenses`** (سطور 955–1035): `income` → سندات قبض فقط؛ `all` → كل السندات (`vouchers_period` 602–633: `total_in` يستثني الشريك، `total_out` يستثني الشريك وتصفيات العهدة، `recoveries` = custody_return، `net = in − out + recoveries`)؛ `expenses` → `expenses_report` (report_service.py:542–596): صرف سارٍ غير شريك، باستثناء صرف عهدة المُسوّى بتصفية (نفي مضاعف شرطي سطور 559–562)، **+** مرتجع سلفة سالب «(تخفيض السلفة)» على حساب السلفة، **+** `salary_deduction` مرتين: مرة موجبة على حسابها المقتطع منه (snapshot) ومرة سالبة على حساب سلف الموظف (الطابق المزدوج للعرض). أعمدة: `م | التاريخ | السند | الحساب (أب/فرعي من acc_path) | الجهة | الدفع | المبلغ | البيان (+العقد)`.
- **`_data_subcontractors`** (سطور 157–174): `رقم المقاول | الاسم | الهاتف | عدد عقود الباطن | قيمة العقود | المنصرف له | المتبقي له` من `subcontractors_report` (report_service.py:639–683: عقود غير ملغاة؛ المنصرف = vouchers payment party_type='subcontractor' حتى بعقود غير ملغاة أو بلا عقد؛ المتبقي = قيمة − منصرف).
- **`_data_sub_full`** (سطور 1211–1298): مسطّح: ملخص المقاول (accent أصفر) + أسطر `dues_board("all")` تفصيلية + «الإجمالي العام».
- **`_data_prospects`** (سطور 331–347): عملاء بلا أي عقد غير ملغى (`NOT EXISTS`, report_service.py:774–797) مع أيام التسجيل.

---

## 8) بنية المطبوعات

### 8.1 كشف الحساب `statement_pdf.py`
- **دالتان**: `generate_statement_pdf(contract_id)` (سطر 164 — كشف عقد مفرد) و`generate_customer_statement_pdf(customer_id, contract_id=None, date_from, date_to)` (سطر 281 — المستخدمة فعليًا من الشاشة).
- **الترويسة `_header`** (سطور 31–70): صورة ترويسة مرفوعة (`settings.header_image`) وإلا شريط ملوّن 34مم بلون `invoice_primary` + شعار 22مم يسار + اسم الشركة (بولد 15) + سطر معلومات `العنوان | هاتف: … | بريد` + العنوان «كشف حساب عميل» / «كشف حساب عميل — شامل» (تابع: «… · تابع» في الصفحات الجديدة، سطور 221, 339).
- **بطاقة البيانات** (سطور 300–333): `العميل: {name} ({customer_code})` · `هاتف: …  العنوان` · `النطاق: العقد {رقم} | الفترة: … ← …` أو `النطاق: كل العقود (n) | الفترة: الكل`.
- **أعمدة الجدول** (سطور 73–78):
  - شامل (7 أعمدة): `التاريخ 20مم | العقد 24مم | البيان 38مم | المرجع 24مم | مدين 24مم | دائن 24مم | الرصيد 22مم` (المجموع 176مم ≤ 180مم).
  - عقد مفرد (6 أعمدة): `التاريخ 26مم | البيان 46مم | المرجع 28مم | مدين 27مم | دائن 27مم | الرصيد 26مم`.
- **صفوف**: تظليل `#d8e4ef` + خط بولد للصفوف غير `move` (افتتاحي/إجمالي عقد/إجمالي عام، سطر 341–342)؛ تبديل خلفية فاتحة للزوجي؛ صفر يظهر «—» للمدين/الدائن؛ أرقام `{:,.3f}`؛ القطع بـ `fit_pdf_text` مع «…».
- **صندوق الإجماليات** (سطور 350–375): `رصيد أول الفترة` (فقط مع date_from) · `إجمالي المدين` · `إجمالي الدائن` · `الرصيد المتبقي` (أخضر إذا ≥0 أحمر إذا سالب) — `draw_label_value_row` مع فاصل عمودي (pdf_utils.py:157–178).
- **التذييل** (سطور 377–390): صورة فوتر مرفوعة، وإلا خط + `تاريخ الإصدار: YYYY-MM-DD HH:MM · اسم الشركة`.
- ❌ **لا تفقيط ولا خانة توقيع/ختم في كشف الحساب** — التفقيط (`amount_to_words`) يظهر في **سندات القبض/الصرف فقط** (voucher_pdf.py:14, 299–300) والختم `draw_stamp` في **الفواتير فقط** (invoice_pdf.py:241). `pdf_utils.get_transparent_stamp/_cropped_stamp_path/draw_stamp` (سطور 192–317) تجهّز الختم بقص الحواف وشفافية 0.92 وحد 30مم.
- **وضع اقتصادي** (`print_economy`): كل الألوان أسود/أبيض (سطور 144–161).
- تعريب: خط Amiri/Tajawal (pdf_utils.py:74–109) + `ar()` = reshaping بدون ligatures + bidi (سطور 112–133)؛ `apply_pdf_metadata` يوقّع المستند باسم الشركة (سطور 366–384).

### 8.2 التقارير الجدولية `tabular_pdf.generate_table_pdf` (سطور 43–618)
- A4 **رأسي** من مركز التقارير (`_export_pdf` يفرض `orientation="portrait"`, reports_page.py:2134)؛ رأسي: خطوط 9/9.5/10 وصف 9مم؛ أفقي: 10.5/11/11.5 وصف 10مم.
- ترويسة موحّدة (سطور 188–221): صورة الهيدر أو شريط 26مم (اسم الشركة + العنوان يمينًا، `تاريخ الإصدار` يسارًا)؛ **ترقيم «صفحة رقم X من Y»** عبر `_NumberedCanvas` فوق شريط الفوتر (سطور 139–167)؛ صورة فوتر بحجز شريط `_band` (سطور 175–186).
- **إعادة توزيع عرض الأعمدة تلقائيًا** (V3.17/3.18، سطور 324–421): قياس أعرض محتوى، الجامد (تاريخ/هاتف/رقم) يأخذ حاجته أولًا، المرن (به مسافة) يقبل اللفّ على سطرين (`_wrap2`)، والأرقام لا تُقص أبدًا (تُصغَّر حتى 5.5pt، سطور 496–500).
- ألوان الأعمدة: `green/red/auto (أحمر إذا>0 وإلا أخضر)/profit (أخضر إذا≥0)` (سطور 474–484)؛ صفوف accent حسب نص الخلية الثانية (439–451)؛ صف «عميل» الشجري بخلفية `#DCE7F5` وحد أسمك (452–462)؛ الوضع الاقتصادي يبيّض كل شيء (والتقرير المالي وحده يحتفظ بالألوان `keep_accents_in_economy`، 445–447).
- صف الإجمالي بشريط `accent` (555–582)؛ `footer_note` يُقسَّم على أسطر بالفاصل `|` (584–611).
- `generate_table_excel` (621–714): openpyxl RTL، رقمي `#,##0.000`، accent للصفوف المميزة، صف إجمالي؛ و`generate_report_workbook` (717–801) لأوراق متعددة.
- العرض على الشاشة: ترقيم صفحات 50 صفًا (المعاينة فقط — الطباعة/التصدير كل الصفوف دائمًا، سطور 1645–1654 و2126–2128)، بحث نصي يعيد حساب الإجماليات الرقمية (سطور 1906–1927)، شجرة تبدأ مطوية (1890–1892).

### 8.3 صلاحيات ومفاتيح العرض
- التقارير تُفلتر بـ `feature_service.enabled(key/module)` + `auth_service.has_permission(key)` + `cashflow_enabled()` (سطور 1417–1435). مفاتيح: `rep_customers, rep_supervision_delay, rep_subcontractors, rep_expenses, rep_cashflow, rep_contracts, rep_execution, rep_leads` + مديولات `supervision/cashflow/followup`.
- فترات المركز الحرفية `_PERIODS` (سطر 1438–1439): `["كل الفترات","اليوم","هذا الشهر","الشهر الماضي","هذه السنة","السنة الماضية","فترة مخصصة"]`؛ الافتراضي: «كل الفترات» للتقارير الدورية العامة، «اليوم» للتقرير المالي، «هذا الشهر» لغير الدوري بفترة (سطر 1752).

---

## 9) الحالات الحدية والفخاخ الموثقة (للنسخ أونلاين)

1. عتبة الـ**0.001** (3 خانات عشرية) تُستخدم حرفيًا في كل المقارنات المالية (`remaining<=0.001` إخفاء، `abs(net)<0.001` إسقاط ملحق).
2. `contract_name` مفروض بـ TRIGGER = نوع العقد؛ **الاسم الحقيقي = description** (`COALESCE(NULLIF(TRIM(description),''), NULLIF(TRIM(contract_name),''), contract_number)`) — dues_report سطور 399–403 و`_contract_label` يتجاهل «غير محدد»/المساوي للرقم (reports_page.py:405–421).
3. تناسق الاستثناءات **غير موحّد** عمدًا: dues_report يشمل «مغلق»؛ stage_dues/dues_board يوقّفه؛ customers_balances يستثني «ملغى» فقط؛ profitability/contracts_overview تستثني («ملغى»،«مسودة»).
4. الملحقات: الاعتماد (`status='معتمد'`) شرط في كل تقرير؛ لكن customers_balances يتجاهلها **حين تحدد فترة** (سطر 126).
5. `dues_report.collected` يشمل القبض الموجَّه لدفعات (allocation) — بينما `stage_dues` و`overdue_plan_items` يستثنيانه من البركة العامة ويعوضه بالروابط `voucher_payment_links` (V6.2). لا تستخدم استعلامًا واحدًا للاثنين.
6. كشف العميل الشامل: الافتتاحي لكل عقد = رصيد آخر صف قبل الفترة؛ **الإجماليات (subtotal/total) تخص الفترة المعروضة** — طابق ذلك حرفيًا في Next.js.
7. `_data_cash_flow`: خيارات `daily/monthly/yearly` لا تُوجَّه لـ`_cash_flow_periods` (سقوط صامت إلى detail).
8. `expenses_report`: صفوف `salary_deduction` مزدوجة (+ على الحساب و− على حساب السلفة) — الإجمالي يتأثر بضربها جميعًا.
9. التقرير المالي يفرّق بنك/صندوق بنص `method` (ليس كودًا) — حساس لصياغة النص العربي.
10. الترحيل للأرشيف: طباعة الكشف تحفظ نسخة PDF في أرشيف العميل باسم `كشف_حساب_{رقم}.pdf` (overwrite).

---

## 10) توصيات تنفيذية للنسخة الأونلاين (Next.js + Prisma)

**يبنى فورًا من البيانات الموجودة (بدون أي أعمدة جديدة):**
1. **كشف حساب عميل موحّد (API واحد)**: `GET /api/customers/[id]/statement?contractId&from&to` يعيد نفس بنية `build_customer_statement`: صفوف `{date, contractNumber, description, ref, debit, credit, balance, kind}` + إجماليات. القيود: قيمة العقد مدين افتتاحي، ملحقات معتمدة صافي، قبض سارٍ دائن، فواتير للعلم (0/0)، تمديد إشراف عقد كقيد مدين عند `base_end`. استبعاد عقود `ملغى/مسودة` عند «كل العقود».
2. **طبقة «القيمة الحالية» (قاعدة 35)** كدالة مشتركة (`amount + Σملحقات معتمدة + تمديد إشراف`) — تخدم الكشف والمستحقات والعقود والتقرير المالي دفعة واحدة؛ يمنع انحراف الأرقام بين الشاشات كما في الأصل.
3. **تقارير المستحقات**: `stage_dues` (عميل×عقد×مرحلة بفلاتر all/due_only/overdue_only) و`dues_board` (باطن) و«العملاء والأرصدة» المسطّح — كلها قابلة للاشتقاق من `payment_plan + contract_stages + vouchers(allocation) + voucher_payment_links + sub_payment_sources` بنفس FIFO والعتبة 0.001.
4. **الربحية**: عقد/عميل/نوع — بشرط عمود `include_in_profitability` على جدول حسابات المصروف (أضفه من الآن حتى لو boolean افتراضي true) وشرط استبعاد `party_type='subcontractor'` لعمود «المنصرف الآخر».
5. **التدفق النقدي**: التفصيلي بأقسامه (وارد/منصرف/مسترد/سلف/تحويلات/شريك للأدمن) + الملخص + الرصيد الفعلي = بنك − معلّق البوابة (T+1). طبّق جدول إعدادات: `opening_balance, opening_balance_bank, opening_balance_cash, opening_balance_date, cash_start_date`.
6. **تأخير الإشراف**: استخرج `supervision_status` كما هو (شهر بدأ = شهر كامل، full_end يشمل المدفوع والملغى) — دوال نقية قابلة للنقل حرفيًا إلى TS.
7. **المطبوعات**: بدل reportlab → توليد PDF من HTML (Puppeteer/React-PDF) بنفس البنية: ترويسة (شعار/صورة)، بطاقة عميل ونطاق، جدول 7 أعمدة للشامل، صندوق إجماليات، تذييل بتاريخ الإصدار وترقيم «صفحة X من Y»، وضع «اقتصادي» بالأبيض والأسود، وExcel RTL بـ`#,##0.000`. **أضف اختياريًا تفقيطًا وتوقيعات للكشف** (غير موجودة في الأصل — فرصة تحسين واضحة يطلبها العملاء عادة).
8. **إصلاحات موصى بها عند النقل** (لا تحاكي العيوب): وجّه خيارات daily/monthly/yearly لمولّد الفترات أو احذفها من القائمة؛ وحّد استثناء «مغلق» بمعامل صريح لكل تقرير؛ اجعل تصنيف bank/cash حقلًا محسوبًا على السند لا نصًا حرًا؛ وثّق صفوف salary_deduction المزدوجة في تقرير المصروفات كقيد مزدوج مقصود أو صحّحها.

---

## 11) مراجع سريعة (أهم أرقام الأسطر)

| القاعدة | الموقع |
|---|---|
| قيود كشف العقد وترتيبها | statement_service.py:41–107 |
| «الفاتورة للعلم فقط» V3.14 | statement_service.py:72–77, 112–114 |
| `remaining = current_value − rec_total` | statement_service.py:129 |
| استبعاد ملغى/مسودة من الشامل V3.6 | statement_service.py:154–163 |
| افتتاحي الفترة لكل عقد | statement_service.py:172–182, 191–200 |
| كشف الباطن | statement_service.py:243–334 (+extras_service.py:281–289) |
| أعمدة شاشة الكشف وفتراته | ui/statement.py:74–75, 161–169, 431–456 |
| صلاحية الطباعة والأرشفة | ui/statement.py:101–103, 564–595 |
| تمديد الإشراف (شهر بدأ = كامل) | supervision_service.py:104–113, 141–149 |
| dues_report (قاعدة 35) | report_service.py:391–449 |
| stage_dues (strict/waiting/skipped) | report_service.py:147–269 |
| dues_board (باطن + _due_now) | report_service.py:272–388 |
| due_now بالعقد/العميل | report_service.py:470–506 |
| overdue_plan_items (روابط الدفعات V6.2) | lifecycle_service.py:5811–5919 |
| العملاء والأرصدة CTEs | report_service.py:53–141 |
| الربحية (فعلي/متوقع/include_in_profitability) | report_service.py:689–771 |
| التدفق النقدي التفصيلي (محافظ/تجميع شهري) | report_service.py:1198–1512 |
| ملخص الفترات + auto_group | report_service.py:979–992, 1034–1191 |
| gateway_summary (معلّق T+1) | report_service.py:1608–1678 |
| تأخير الإشراف (عقد + مراحل) | report_service.py:800–957 |
| أعمدة تقرير العملاء المسطّح | reports_page.py:1112–1208 |
| أعمدة stage_dues / dues_board / profitability / supervision / cashflow | reports_page.py:177–225, 253–279, 350–402, 474–647 |
| فلاتر _REPORTS الحرفية | reports_page.py:1301–1415 |
| طباعة الجداول portrait + ترقيم + إعادة توزيع الأعمدة | tabular_pdf.py:43–618 (+reports_page.py:2118–2150) |
| كشف PDF: أعمدة/بطاقة/إجماليات/تذييل | statement_pdf.py:73–78, 300–375, 377–390 |
| التفقيط في السندات فقط · الختم في الفواتير فقط | voucher_pdf.py:299–300 · invoice_pdf.py:241 |
| أدوات RTL/الخطوط/الختم | pdf_utils.py:74–133, 192–317 |

— نهاية spec-8-b —
