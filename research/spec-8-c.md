# spec-8-c — الباطن: خطة الدفع، مصادر التمويل، السقف، روابط السندات، بوابة الدفع
المصدر: ConTrack V9.15.18 (PySide6) — قراءة عميقة للشيفرة الأصلية.
الملفات: app/database/database.py · app/services/lifecycle_service.py · workflow_service.py · voucher_payment_link_service.py · gateway_service.py · settlement_service.py · extras_service.py · app/ui/subcontractors.py · sub_plan_editor.py · sub_pay_blocks.py · subcontractor_page.py · vouchers.py · gateway_page.py · clearing_page.py · payment_gateway_page.py · due_items_page.py.

> تنبيه مصطلحي مهم: **«pay blocks» ليس حظر دفع** — بل «كتل دفعات» UI (كتلة مستقلة لكل مقاول في تاب الدفع بمركز العقد وشاشة المقاول، ملف `ui/sub_pay_blocks.py`). الحظر/المنع الحقيقي ينفذ عبر: `OverpayWarning` (سقف ناعم)، `room_for` (سقف صارم على الخط)، **بوابة تحصيل العميل** `sub_pay_client_gate`، وحالات الملغى/المجمد.

---

## 1) مستحق مقاول الباطن — المعادلة الحرفية

لا توجد معادلة «قيمة عقد الباطن − المصروف». المستحق دائمًا على مستوى **خط خطة الدفعات** ويُحسب قراءةً (لا مخزّن):

```
# _sub_payment_plan_impl (lifecycle_service.py:1230-1356)
paid_pool   = SUM(vouchers.amount)
              WHERE sub_contract_id = :scid AND vtype='payment'
                AND cancelled=0 AND (allocation IS NULL OR allocation='')      # L1242-1247
legacy      = SUM(vouchers الصرف غير المرتبطة بعقد باطن sub_contract_id IS NULL/0
              بشرط party_type='subcontractor' AND party_id AND contract_id)
              — تُحتسب فقط إذا كان للمقاول عقد باطن **واحد** على نفس عقد العميل  # L1248-1272
links[line] = SUM(voucher_payment_links.amount WHERE kind='payment'
              AND line_id=:line AND vouchers.cancelled=0)                        # L1306-1316
remaining_pool = max(0, paid_pool + legacy − Σ links)                              # L1317
# توزيع FIFO على السطور بترتيب (due_date؟ لا — ORDER BY sort_order فقط في الاستعلام L1240-1241):
for item in items:
    covered = min(remaining_pool, item.amount); remaining_pool -= covered          # L1318-1320
    covered += min(links[item.id], max(0, item.amount − covered))                  # L1321-1323
    item.covered = covered; item.remaining = item.amount − covered                 # L1324-1325
```

- **مستحق المقاول (due)** = Σ amount للسطور المفعّلة فقط (`triggered_at != ''`) — `contract_payment_compare` (L1570-1603) و`sub_plan_unpaid_triggered` (L1902-1905).
- **المسدّد (paid)** = Σ covered (أو مباشرة من السندات في شاشات الكيبيات — بند 7).
- **المصروف لا يدخل معادلة مستحق المقاول**؛ المصروف يظهر فقط في ربحية العقد/القيد المحاسبي.
- **تواريخ الاستحقاق**: من `sub_payment_plan.due_date` + `triggered_at` (يُكتبان معًا عند التفعيل)، أو من **دفعة العميل** (`payment_plan.due_date`) في محرر السطور (`sub_plan_editor.py:141-151` — الاستحقاق مقفول للقراءة ويُنسخ من دفعة العميل)، أو من `sub_contracts.end_date` في التوزيع التلقائي (lifecycle:1744).

**متى تُستحق (triggering) — workflow_service.py:**
- سطر مربوط بمرحلة الأب **وبلا مصادر**: `trigger_due_sub_payments` (L4521-4598) عند إنهاء المرحلة → `due_date = triggered_at = finish_date` + notes «مستحقة لانتهاء مرحلة «X» بتاريخ Y» (L4584-4587). يُستثنى ما له مصادر (V4.5.04) L4540-4541.
- سطر له مصادر: `trigger_linked_sub_payments` (L4438-4518) — يستحق فقط إذا **كل** مصادره (سطور `payment_plan` للعميل) مفعّلة `triggered_at != ''` (منطق AND، L4488-4492) → notes «مستحقة لاكتمال مصادرها من عقد العميل (…)» (L4504-4507).
- سطر بالأيام فقط (بلا stage ولا مصادر): يستحق بتاريخه (`due_date`) عبر حالة «مستحقة/متأخر» في الحاسبة.
- التراجع عن إنهاء المرحلة يصفّر `triggered_at=''` (workflow_service L1643, 1678, 2094, 2130).

---

## 2) جدول sub_payment_plan

الأعمدة (database.py:791-803): `id, sub_contract_id (CASCADE), title, due_date, amount > 0, sort_order, stage_id → contract_stages (مرحلة من عقد العميل الأب!), notes, triggered_at, created_at`. تعليق الجدول: «مرآة payment_plan — بلا stage_id = دفعة بالأيام».

**التوليد:**
1. **تلقائي بالتوزيع**: `distribute_sub_plan` (lifecycle:1728-1778) — يشترط لا توجد سطور مفعّلة (L1737-1738)، يمسح السطور وينشئ صفًا من `_sub_client_payment_rows` (L1781-1876):
   - إن كانت بنود المقاول (`sub_contract_items` → `boq_items`) مربوطة بمراحل: **صف لكل مرحلة** بمبلغ = Σ(qty×unit_price) لبنود المقاول في المرحلة، ومصدرها = أقرب دفعة عميل لنفس المرحلة (L1803-1848).
   - وإلا: **صف لكل دفعة عميل** بمبلغ نسبي `total × client_amount / Σclient` والصف الأخير = الباقي (L1850-1876)، والعناوين عبر `_plan_title_for`.
   - إن لم توجد خطة عميل: سطر واحد «دفعة عقد الباطن» بقيمة العقد كاملة (L1753-1762).
   - المعاينة قبل الحفظ: `sub_plan_preview` (L1879-1899).
2. **يدوي**: `add_sub_plan_line` (L1384-1412) — عنوان إلزامي، تاريخ `yyyy-MM-dd`، مبلغ > 0، تحقق المرحلة `_validate_sub_plan_stage` (L1368-1381: المرحلة يجب أن تكون من عقد العميل الأب وغير متخطاة). `sort_order = MAX+1`.
3. **التعديل/الحذف ممنوعان للسطور المفعّلة** (`triggered_at` غير فارغ): update L1432-1433، delete L1449-1450.
4. **المصادر إلزامية عند الإنشاء/الإضافة** (V4.5.03): `_validate` في `LinkSubContractDialog._save` (subcontractors.py:2677-2696) يرفض أي صف بلا `sources` أو بمبلغ ≤ 0؛ و`set_sub_line_sources` (lifecycle:1454-1491) يرفض القائمة الفارغة «اختر دفعة عميل واحدة على الأقل» ويشترط أن تكون المصادر من **نفس عقد العميل** (L1484-1485).

**الحالات (enum محسوب في `_sub_payment_plan_impl` L1332-1355):**
`مرحلة متخطاة` (stage متخطاة؛ remaining=بانتظار، notes تُفرض) → `بانتظار إنجاز المرحلة` (stage-linked غير مفعّلة وremaining>0.001) → `مدفوع` (remaining ≤ 0.001) → `جزئي` (covered>0 وdue≥today) / `متأخر` (due<today أو جزئي متأخر) → `مستحقة` (مفعّلة غير مدفوعة) → `مستحق قريبًا` (≤ 7 أيام) → `لم يحل`. فشل تحليل التاريخ ⇒ due = اليوم (L1329-1331). وفي جدول الربط تظهر حالة إضافية `ملغى` لسطور عقد باطن ملغى (vpl L182-187).

**sub_payment_sources** (database.py:807-815): N:M بين `sub_payment_plan.id` (sub_line_id) و`payment_plan.id` (cust_line_id) مع `UNIQUE(sub_line_id, cust_line_id)` وحذف تلقائي مع أي طرف. هو **ربط تمويل**: دفعة المقاول تُموَّل من دفعة/دفعات العميل — تُستحق باكتمال **كل** مصادرها (AND). حالتها لكل سطر: `sub_sources_status` (lifecycle:1542-1567) → `{total, done, pending[], ready}` حيث `ready = done >= total` (والسطر بلا مصادر يُعد ready بالتعريف). **عند نقص التمويل**: السطر يبقى غير مفعّل (لا استحقاق)، وفي بوابة الصرف يظهر `gated` برسالة «بانتظار تحصيل دفعة العميل «X» — لا يمكن الصرف للمقاول قبل تحصيلها» (vpl L166-181) — انظر بند 4.

---

## 3) سقف الدفع (ceiling) والحواجز

**(أ) سقف المقاول على العقد — ناعم (OverpayWarning):**
```
_check_sub_payment_limit(sub_id, contract_id, amount, exclude_voucher_id?, allow_overpay)   # lifecycle:1919-1944
total = SUM(sub_contracts.amount) WHERE subcontractor_id=? AND contract_id=? AND status != 'ملغى'
paid  = SUM(vouchers.amount) WHERE vtype='payment' AND cancelled=0 AND contract_id=?
        AND party_type='subcontractor' AND party_id=?    # كل السندات للطرف على العقد (بمعزل sub_contract_id)
remaining = total − paid
amount > remaining + 1e-9  →  OverpayWarning (رسالة تعرض عقود الباطن/المنصرف/المسموح وتنوّه «سيتم تسجيل الزيادة كدفعة مقدمة»)
```
- يُستدعى في `add_voucher` (L2283-2284) وفي `update_voucher` (L4528-4530 مع `exclude_voucher_id`).
- الواجهة (`vouchers.py:2002-2012`): يعرض تأكيدًا، وعند الموافقة يعيد الحفظ بـ `allow_overpay=True` — **الزيادة تُسجل ولا تُرفض**.
- شروط قبضية سابقة في نفس الدالة: المقاول يجب أن يكون مرتبطًا بالعقد بعقد باطن غير ملغى (L2275-2282)، والعقد الملغى مجمّد `_ensure_contract_accepts_financial_actions` (L1948-1957)، وعقد الباطن الملغى يمنع الصرف `_ensure_sub_contract_accepts_payments` (L1960-1969، V9.15.17).
- سقف القبض الموازي للعميل: `due_value = max(قيمة العقد الحالية, مستحقات الإشراف) − المحصّل` (L2373-2391).
- عند إنشاء عقد باطن: تجاوز **مجموع عقود الباطن** لقيمة العقد = تحذير تأكيد فقط وليس منعًا (`LinkSubContractDialog._save`، subcontractors.py:2716-2730، عبر `total_sub_contracts` L1908-1912).

**(ب) سقف الخط الواحد — صارم (room_for):**
```
room_for(conn, kind, line_id, remaining?, exclude_voucher?)   # vpl:325-336
room = min(line_amount − Σ روابط سارية أخرى على نفس الخط , remaining المحسوب من حالة الخطة)
```
- `apply_links` (vpl:372-436): idempotent (يمسح روابط السند أولًا)، يأخذ `min(amount, room)` لكل خط، والزيادة تُوزَّع `spread` على الدفعات المستحقة **التالية بالترتيب** مع تخطي الموقوفة `gated` (L408-428)، وما يبقى → `vouchers.advance_amount` (L429-434) رصيدًا مقدَّمًا على السند.
- `distribute` (vpl:505-562) للواجهة: يوزع مبلغ السند على الدفعات المحددة بالترتيب؛ خطأ صريح إذا «المبلغ لا يكفي لتغطية الدفعة رقم N».
- **قاعدة التتابع** `check_selection` (vpl:477-502): المحدد يجب أن يكون **بادئة** من الدفعات المفتوحة غير المسددة بالترتيب — «لا يمكن تحديد دفعة مع تخطي دفعة سابقة غير مسدّدة». الموقوفة لا تُحدَّد ولا تمنع ما بعدها (تُحسب على المفتوحة فقط).

**(ج) بوابة تحصيل العميل (gate) — مفتاح الإعداد:**
- `settings.sub_pay_client_gate INTEGER DEFAULT 1` (database.py:294 + ALTER 2071-2073) — `gate_enabled()/set_gate()` (vpl:31-47)، تُفعَّل من شاشة الإعدادات (`settings.py:684`).
- عند `kind='payment'` وسطر مستحق: إذا لأي مصدر عميل `remaining > 0.001` (أي لم تُحصَّل فعليًا) → `gated=True` + `gate_reason` (vpl:166-181). الموقوفة: لا تُحدَّد في جدول السندات (checkbox معطل — vouchers.py:884-890)، مرفوضة في `validate_selections` (vpl:347-369)، تُتخطى في التوزيع، وتبقى مرشحة `due_lines(include_gated=True)` للعرض فقط.
- تمييز دقيق: **الاستحقاق** (triggering) يشترط تفعيل دفعة العميل مرحليًا (`triggered_at`)، أما **الصرف** فيشترط (افتراضيًا) تحصيلها نقديًا (`remaining ≤ 0`).

**(د) طبقات إضافية:**
- سند على عقد باطن ملغى: ممنوع (L1960-1969) + سطوره `cancelled` في بوابة الربط وتُعرض رمادية بلا checkbox مع tooltip «عقد الباطن ملغى: لا يمكن الصرف على هذه الدفعة» (vouchers.py:850-852, 900-907).
- إغلاق عقد باطن «منتهي/مغلق» ممنوع مع دفعات مفعّلة غير مسددة (`update_sub_contract` L947-957 + `sub_plan_unpaid_triggered`)؛ وتحذير غير مانع عند تسوية العقد: `contract_sub_dues` (extras_service:354-369).
- تعديل سند ملغى ممنوع؛ تعديل المرتجع/خصم الراتب ممنوع (update_voucher L4440-4451).
- تعديل عقد باطن: `EditSubContractDialog` (subcontractors.py:2787+) بنفس قواعد السطور والمصادر.

**(هـ) «pay blocks»**: `ui/sub_pay_blocks.py` — `build_unified_table` (L134-393): جدول موحد 9 أعمدة (البند | عميل: الدفعة/المبلغ/المسدّد/الحالة | مقاول: الأربعة نفسها) + صف مجموعات + صف إجمالي، `ProgressDelegate` شريط تقدم تحت «المسدّد» (L53-96)، `short_status` (L22-31) يختصر الحالات، `shared_client_line_ids` (L447-463) يوسم دفعات العميل المغذاة لأكثر من مقاول بـ«مشتركة»، وكتلة أخيرة لـ«دفعات العميل غير المرتبطة» (test_v64_pay_blocks.py:267-279). مصدر البيانات: `sub_contract_data` (L481-539) تجمع خطة العميل + خطة الباطن + المصادر + البنود. تُستخدم في شاشتين: contract_hub (تاب الدفع) وsubcontractor_page (`_on_contract_selected` L554-616).

---

## 4) روابط السندات voucher_payment_links

**الجدول** (database.py:822-832 + إعادة إنشاء 2056-2067): `voucher_id → vouchers, kind CHECK IN ('receipt','payment'), line_id (بلا FK — يشير إلى payment_plan أو sub_payment_plan حسب kind), amount > 0, UNIQUE(voucher_id, line_id)`.

- **الأنواع المدعومة نوعان فقط** (`KINDS` vpl:23): `receipt` → يغطي سطور `payment_plan` (دفعات العميل) — شرطه سند قبض بطرف عميل وعقد (vouchers.py `_link_kind` L829-842)؛ و`payment` → يغطي سطور `sub_payment_plan` (دفعات المقاولين) — شرطه سند صرف بطرف مقاول + `sub_contract_id`. لا يوجد نوع «إشراف» في هذا الجدول (الإشراف مساره `supervision_service` منفصل، ويدخل فقط في سقف القبض عبر `supervision_status` lifecycle L2381-2384).
- `UNIQUE(voucher_id, line_id)` — سند واحد لكل خط مرة واحدة، والسند الواحد قد يغطي عدة خطوط (صف لكل خط).
- **قواعد الربط عند الحفظ**: تحقق مسبق قبل إدراج السند (`add_voucher` L2256-2265: رفض الربط لا يترك سندًا بلا ربط) ثم `_apply_payment_link` (lifecycle:4382-4396) داخل نفس المعاملة. عند التعديل `_write_payment_links` (L4399-4418): `reverse_links` (حذف روابط السند) ثم إعادة التطبيق، مع حساب المستحق مرة بـ`exclude_voucher_id` لمنع الاحتساب المزدوج.
- `validate_selections` (vpl:347-369): يمنع الربط بدفعة غير مستحقة/مدفوعة/موقوفة بالبوابة.
- **البيان التلقائي**: `describe` (vpl:238-292) «سداد رسوم الدفعة الرابعة [المرحلة] — كاملة/ومتبقي منها X د.ك – عقد {الاسم} – المقاول {الاسم}»، و`describe_items` (vpl:604-619) مع «الجزء {الثاني…} من الدفعة رقم N» عبر `_prev_link_count` (L463-474) و«استكمال الدفعة…» للتتمة، و«وزيادة مقدمة» للفائض.

**الإلغاء وأثره (cancel_voucher lifecycle:4702-4770):**
- الحالات الحاجبة: سند ملغى سابقًا (L4707)؛ تسليم عهدة له تصفية/ردود سارية (L4709-4725)؛ سلفة موظف له رد/خصم سارٍ (L4726-4738)؛ العقد الملغى مجمّد (L4739)؛ مطالبات سارية على العقد (L4742-4751).
- التنفيذ: `cancelled=1 + cancel_reason + cancelled_at` (L4754-4756) → إلغاء السندات الأبناء (عمولات الرسوم `parent_voucher_id`) برسالة «إلغاء تلقائي بسبب إلغاء السند الأب» (L4757-4764) → عكس القيود `_reverse_voucher_journals` (L4765) → حدث + تعليق نظام للقبض (L4766-4770).
- **الروابط لا تُحذف عند الإلغاء**: كل قراءات التغطية تفلتر `COALESCE(v.cancelled,0)=0` (vpl:309-315، lifecycle:1312-1313، 5742) — فالخط «يعود» مستحقًا تلقائيًا لأن الحالة محسوبة لا مخزنة (`reverse_links` docstring vpl:339-341). أثر متسلسل: إلغاء قبض يخفض covered لخطة العميل → قد تُفتح دفعات عميل (تعليق «عادت مستحقة بعد إلغاء سند قبض…» `_comment_receipt_cancel_reopens_plan` L4649-4698) → وإن كانت مصادر سطور باطن، تعود هذه السطور غير مكتملة المصادر (gated/غير مفعّلة) ويظهر أثرها في `gated` مباشرة.

---

## 5) بوابة الدفع الموحدة (gateway) ودورة المطابقة/التصفية

الصفحة الأم: `payment_gateway_page.py` («بوابة الدفع» + زر «＋ تسوية جديدة») بتابين: **التصنيف والتوزيع** (GatewayPage) و**الشركة الأخرى** (OtherCompanyPage). داخل GatewayPage: تابات «📋 التصنيف» (gateway_page.py:279)، «📊 كشف حساب» (297)، «📅 كشف يومي مجمع» (317). ClearingPage: «التصفية اليومية» و«بنك غير مربوط» (clearing_page.py:374-375).

**دورة العمل:**
1. **استيراد كشف البوابة** (xlsx/csv): `read_settlement_file` (gateway_service:389) → `_extract_rows` (L295-364): يكتشف الأعمدة من أول 5 صفوف `detect_columns` (L193-239) — إلزامي: هاتف + مبلغ (L237-238)، اختياري: حالة/عميل/بيان/توكن/updated/created/مرجع. `paid_state_of` (L160-174): 1 محوَّلة · 0 معلقة · 2 ملغاة · −1 فاشلة (الفاشلة تُستبعد من الاستيراد L316-320).
2. **مطابقة آلية** `match_settlement` (L569-717): هوية = هاتف (مطابقة مرنة `phones_match` L67-76) أو اسم (توحيد عربي `normalize_name` L79-87 + جزئي `names_similar` L96-103) أو **رابط محفوظ** `match_aliases` (جدول تعلّم يدوي L431-491)؛ تلميحات عقد/وصف (`contract_hint` L110-117، `text_hint` L132-140) تُرقّي المرشح؛ **نوافذ تاريخ**: `WINDOW_DAYS=5` للهاتف/الرابط و`NAME_WINDOW_DAYS=3` للاسم (L47-48)؛ المطابق التام (هوية+مبلغ+نافذة) → `mine` + `via` («الهاتف والاسم/الهاتف/رابط محفوظ/الاسم/اسم جزئي» + «عقد + …/وصف + …»)، هوية صحيحة بمبلغ/تاريخ مخالف → `diff` مع تفصيل السبب (L682-714)، لا عميل → `other` «للشركة الأخرى». التصنيف الابتدائي `auto_classify` (L741-747): mine يبقى mine والباقي unmarked.
3. **تثبيت النتيجة** `save_gateway_ops` (settlement_service:189-232) في **جدول الحالة `gateway_ops`** (L136-186): مفتاح فريد `gateway+op_date+phone+amount+ref`، أعمدة: `status, receipt_no, customer, batch, classified_manual, distributed, distributed_at, paid_transfer_id, gw_paid, gw_paid_date, gw_token, effective_date` (T+N أيام عمل — `effective_date` L45-62). التحديث لا يلمس المسددة/الموزَّعة/المصنفة يدويًا (شروط UPDATE L209-217). إعادة الاستيراد تعلّم `seen_before`/`paid_before` (`mark_seen_before` L1559-1578).
4. **التصنيف اليدوي** `set_row_class` (L1459-1483): mine/other/unmarked — **مرفوض** على الموزَّعة («مقفلة — ارجعها للتصنيف أولًا») والمسددة؛ القفل يبدأ من لحظة التوزيع لا التصنيف. الربط اليدوي بسند: `link_row_manual` (gateway_service:494-522) يحدّث `status='mine'` + `receipt_no` ويحفظ الـalias.
5. **التوزيع الصريح** `distribute_rows` (L1499-1528): المصنف (mine/other) غير المسدد وغير الفاشل (`gw_paid in (0,2)` تُتخطى) → `distributed=1` — **لا مسار محاسبي يتجاوز هذه الدالة**. عكسه `undistribute_rows` (L1531-1556) إلا إذا كانت مسددة.
6. **التصفية (clearing)** `daily_clearing` (L413-537): لكل (بوابة، يوم):
   - **S** = سندات قبض السيستم السارية التي طريقتها تطابق كلمات `gateway_profiles.methods` (L405-411، 432-438).
   - **G** = عمليات `gateway_ops` الموزَّعة `distributed=1` و`(gw_paid IS NULL OR gw_paid=1)` مصنفة mine/other فقط («غير مصنّف خارج التصفية تمامًا» L460).
   - `expect = G_total − n × fee_fixed`؛ `gap = mine − sys` → `diff` إذا `|gap| > tolerance`.
   - **مطابقة بنكية**: `bank_lines` (كشف بنك مستورد `read_bank_file` L360-387 / `save_bank_lines` L389) داخل نافذة `[settle−1, settle+1]` أيام عمل وتسامح `tolerance` → `bank_hit`؛ الحالة: `done` (هبطت)، `pending` (تاريخ التسوية T+lag مستقبلًا أو قبل late_days)، `late` (تجاوز T+lag+late_days)، `diff`. الحصص: `my_share = mine − n_mine×fee` و`other_share` (L477-480).
   - «ماذا تُصفّى بالضبط»: وارد اليوم في السيستم مقابل وارد البوابة (عمليات) مقابل وارد البنك الفعلي — تقفيل ثلاثي (سيستم ⇄ بوابة ⇄ بنك) لكل يوم/بوابة.
7. **تسديد الشركة الأخرى**: العمليات `other` الموزَّعة تظهر مستحقة (`unpaid_other_items` L621) في `due_items_page.py` («💸 التسديد — الشركة الأخرى»: علّم بنودًا → «＋ تسديد المحدد») → `add_other_transfer` (L925-1005) ينشئ تحويلًا في `other_company_transfers` ويوزع المبلغ جزئيًا على العمليات عبر `transfer_op_allocs` (L845-863) ويقفل `gateway_ops.paid_transfer_id` (L996) + سند صرف + عمولة مجمعة `gateway_fee_vouchers` (`_create_settlement_fee_voucher` L877-923). حذف التسوية يفك الأقفال (L1048-1104).
8. **تحصيل البوابة المتأخر**: `refresh_gw_paid` (L235-275) يحدّث `gw_paid/gw_paid_date` من ملفات لاحقة (غير مقيد بالأقفال) — العملية الملغاة عند البوابة (gw_paid=2) تُستبعد من التوزيع والتصفية.

---

## 6) KPIs شاشة المقاول (subcontractor_page.py) ومصادرها

- **تبويب نظرة عامة** `_fill_overview` (L447-481):
  - «العقود الأخيرة» = أول 8 من `get_sub_contracts` (lifecycle:890-910) — أعمدة: رقم العقد/العميل/القيمة/الحالة.
  - «الدفعات الأخيرة» = أول 8 من `get_sub_payments` (lifecycle:912-931) — كل سندات الصرف عبر `v.sub_contract_id`، الحالة «مسددة/ملغاة» حسب `v.cancelled` (L922).
  - بطاقات الملخص: `الإجمالي = Σ sub_contracts.amount` (بلا استثناء الملغى هنا، L475)، `المدفوع = Σ paid_amount`، `المتبقي = الإجمالي − المدفوع`، `العقود: n`.
- **مصدر «المدفوع»**: subquery موحّد `SUM(vouchers) WHERE vtype='payment' AND cancelled=0 AND party_type='subcontractor' GROUP BY party_id, contract_id` (lifecycle:900-906) — أي **منصرف الطرف على العقد كله** لا حسب عقد باطن بعينه.
- **تبويب العقود** `_refresh_contracts` (L483-531): جدول `#, رقم العقد, العميل, القيمة, المدفوع, المتبقي, الحالة` + بحث/فلتر (نشطة/مغلقة)؛ ملخص «المعروض: N عقد · المتبقي X» — هنا **يستثني الملغى** من الإجمالي (L524-525) عكس نظرة عامة.
- **كتلة الدفعات للعقد المختار** `_on_contract_selected` (L554-616): `spb.sub_contract_data(cid, sc_id)` → `build_unified_table` (عميل⇄مقاول) → سطر «العميل: c_tot · مسدّد c_paid · المقاول: s_tot · مسدّد s_paid» + جدول بنود العقد المرتبطة `build_items_table` (sub_pay_blocks:396-444، الإجمالي Σ(qty×unit_price) أو total).
- **صفحة مقاولي الباطن** (`SubcontractorsPage` subcontractors.py:3811+): `subcontractors_tree` (lifecycle:835-888) — لكل مقاول: `total = Σ عقوده غير الملغاة`، `paid` = مجموع المنصرف لكل عقد (مُنزّع التكرار لكل contract_id — L878-885)، `remaining = total − paid`.
- **سجل المدفوعات** `SubPaymentsDialog` (subcontractors.py:4065-4113): كل سندات الصرف للمقاول (`extras_service.subcontractor_payments` L281) + تذييل «عدد السندات | إجمالي المنصرف له».
- **مقارنة العميل⇄المقاولين على العقد**: `contract_payment_compare` (lifecycle:1570-1603) — client{due/collected/remaining}، لكل باطن {due, paid, remaining, waiting} حيث `waiting` = عدد السطور التي مصادرها غير مكتملة.

---

## 7) الحالات الحدية والتحققات (قائمة فحص)

1. فشل تحليل `due_date` ⇒ يُستحق اليوم (lifecycle:1329-1331).
2. سندات صرف قديمة بلا `sub_contract_id`: تُحتسب للمقاول إذا كان له **عقد واحد فقط** على نفس عقد العميل، وإلا تُعرض كعدد/مبلغ «unlinked_vouchers/unlinked_total» على أول سطر (lifecycle:1248-1304).
3. `allocation` غير فارغ ⇒ السند خارج حساب التغطية تمامًا (سندات مخصصة لسداد سابق/دفعة مقدمة).
4. تسلسل FIFO للحساب بترتيب `sort_order` (استعلام L1240) بينما التوزيع التلقائي يعتمد `due_date, sort_order` — انسجام عمليًا لأن التوزيع يرقّم sort_order تصاعديًا بحسب due_date.
5. إنشاء عقد باطن: rollback كامل عند فشل حفظ الخطة (حذف السطور ثم العقد — subcontractors.py:2772-2784).
6. توزيع تلقائي ممنوع بعد وجود سطور مفعّلة (lifecycle:1737-1738).
7. المرحلة المرتبطة بدفعة باطن يجب أن تكون من عقد الأب وغير متخطاة (`_validate_sub_plan_stage` L1368-1381)، والمرحلة المتخطاة تجعل السطر «مرحلة متخطاة» بلا استحقاق.
8. تعديل سند يعيد كتابة روابطه (`payment_links is not None` ⇒ reverse+apply حتى لو فارغة = إلغاء ربط صريح — vouchers.py:2049-2051، lifecycle:4618-4624).
9. السند المجمع للقبض (`add_grouped_receipts`) والمطالبات (`claims_service.auto_settle_contract`) تعمل بعد كل حفظ سند (lifecycle:2464-2478).
10. بوابة: العملية بلا هاتف ولا اسم ⇒ «تعذر المطابقة» (gateway_service:605-607)؛ إعادة استيراد صف موجود لا يكرره (unique key) ويحدّث غير المقفل فقط.
11. بوابة: التصنيف `unmarked` خارج التصفية والفاشل (`gw_paid=-1`) مستبعد أصلاً من الاستيراد.
12. `check_selection`: تحديد دفعات متقطعة مرفوض ولو كانت كلها مستحقة.

---

## 8) توصيات تنفيذية للنسخة الأونلاين (Next.js/Prisma)

فجواتنا الحالية: سقف صرف بسيط فقط (party-level)، بلا `sub_payment_sources` ولا بوابة تحصيل ولا روابط سندات ولا بوابة الدفع/التصفية.

1. **نماذج Prisma جديدة**: `SubPaymentPlan` (subContractId, title, dueDate, amount, sortOrder, stageId→ContractStage, notes, triggeredAt) · `SubPaymentSource` (subLineId, custLineId, @@unique([subLineId, custLineId])) · `VoucherPaymentLink` (voucherId, kind enum receipt|payment, lineId, amount, @@unique([voucherId, lineId])) · `GatewayOp` (gateway, opDate, phone, amount, ref, status enum mine|other|unmarked, receiptNo, batch, distributed, distributedAt, classifiedManual, paidTransferId, gwPaid, gwPaidDate, gwToken, effectiveDate, @@unique([gateway, opDate, phone, amount, ref])) · `GatewayProfile` (methods CSV, bankAccount, lagDays, feeFixed, tolerance, lateDays) · `BankLine` · `MatchAlias` (filePhone, fileName→customerId) · `OtherCompanyTransfer` + `TransferOpAlloc`.
2. **حساب التغطية كدالة واحدة** `subPaymentPlanLines(scId, {excludeVoucherId})` تطبق حرفيًا: pool = Σ payments (cancelled=false, allocation='') + legacy-party، ثم links، ثم FIFO على sort_order — الحالات enum مطابقة (WAITING_STAGE / SKIPPED_STAGE / PAID / PARTIAL / OVERDUE / DUE / DUE_SOON / PENDING / CANCELLED). لا تخزّن covered.
3. **استحقاق (triggering)** في endpoint إنهاء المرحلة: (أ) سطور stage-linked بلا مصادر → triggeredAt=finishDate؛ (ب) سطور ذات مصادر → AND على `paymentPlan.triggeredAt`؛ وعند التراجع صفّر triggeredAt (مع ملاحظات مثل الأصل).
4. **السقف الثنائي**: (أ) `checkSubPaymentLimit` ناعم يُرجع 409 مع تفاصيل (total/paid/remaining) وخيار `allowOverpay` يرحّل الفائض إلى `vouchers.advanceAmount`؛ (ب) `roomFor(line)` صارم = min(amount − linkedActive, remaining) لكل ربط، مع `spread` للزائد وتخطي gated، وقاعدة بادئة التتابع `checkSelection`.
5. **بوابة تحصيل العميل**: إعداد `subPayClientGate` (افتراضي true) — سطر الصرف gated إذا لأي مصدر عميل `remaining > 0.001` (تحصيل فعلي، لا مجرد تفعيل مرحلي)؛ منع الربط/الاختيار/التوزيع على gated.
6. **الإلغاء**: إلغاء ناعم (cancelled, cancelReason, cancelledAt) + cascade للأبناء + عكس القيود؛ **لا تحذف روابط** — كل الاستعلامات تفلتر `voucher.cancelled = false` فتعود الدفعات مستحقة تلقائيًا؛ حاجبات: عهدة بسداد سارٍ، سلفة بخصم سارٍ، عقد/باطن ملغى، مطالبات سارية.
7. **قيود الحالة**: منع صرف/ربط على subContract ملغى؛ منع إغلاقه مع دفعات مفعّلة غير مسددة؛ منع تعديل/حذف سطر مفعّل؛ المصادر إلزامية غير فارغة ومن عقد العميل نفسه؛ الصفوف بلا مصادر قديمة تُعرض بتحذير «⚠ بلا دفعة عميل» دون حظر.
8. **بوابة الدفع الأونلاين**: استيراد كشف (SheetJS) بنفس `detectColumns` (هاتف+مبلغ إلزامي)؛ مطابقة بالهاتف المرن + الاسم الموحد + aliases + تلميحات عقد + نوافذ 5/3 أيام؛ سير حالة: مستورد → مصنف (يدوي/تلقائي) → موزَّع (قفل) → مسدَّد (بالفعل/تحويل)؛ التصفية اليومية view محسوب (S vs G vs bank_lines) بحالات done/pending/diff/late — تُنفَّذ استعلامًا لا جدولًا.
9. **KPIs**: استخدم استعلامات tree نفسها (paid group by party_id+contract_id مع نزع التكرار)، ووحّد الجدول العميل⇄مقاول في مكوّن React واحد يخدم مركز العقد وصفحة المقاول (بديل sub_pay_blocks).
10. **ترقيم الأرقام**: كل المبالغ round3 ومقارنات التسامح 0.0005/0.001/1e-9 كما في الأصل (أهم لعملة الكويت 3 كسور).

---

## 9) أرقام الأسطر المهمة (خريطة سريعة)

- database.py: subcontractors 636 · sub_contracts 648 · sub_contract_items 661 · vouchers 686 · payment_plan 770 · sub_payment_plan 791 · sub_payment_sources 807 · voucher_payment_links 822 (+2056) · sub_pay_client_gate 294/2071 · أعمدة vouchers الحرجة 2029-2053.
- lifecycle_service.py: add_sub_contract 767 · subcontractors_tree 835 · get_sub_contracts 890 · get_sub_payments 912 · update_sub_contract (منع الإغلاق) 933-957 · sub_payment_plan 1224 · الحساب الكامل 1230-1356 · _validate_sub_plan_stage 1368 · add/update/delete_sub_plan_line 1384/1415/1443 · set_sub_line_sources 1454 · sub_sources_status 1542 · contract_payment_compare 1570 · distribute_sub_plan 1728 · _sub_client_payment_rows 1781 · sub_plan_preview 1879 · sub_plan_unpaid_triggered 1902 · total_sub_contracts 1908 · **_check_sub_payment_limit 1919** · تجميد العقد 1948 · منع صرف باطن ملغى 1960 · add_voucher 2178 (سقف 2283، سقف قبض 2373، ربط 2256+2480) · _apply/_write_payment_links 4382/4399 · update_voucher 4422 (روابط 4618) · cancel_voucher 4702 · عكس القيود 2611 · contract_payment_plan 5711-5788 · overdue 5811.
- workflow_service.py: trigger_linked_sub_payments 4438 · trigger_due_sub_payments 4521 · trigger_due_payments 4600 · تصفير الاستحقاق 1618-1739, 2068-2130.
- voucher_payment_link_service.py: gate 31-47 · plan_rows 100-189 (gate 166-181، ملغى 182-187) · room_for 325 · reverse_links 339 · validate_selections 347 · apply_links 372 (advance 429) · check_selection 477 · distribute 505 · describe 238 · describe_items 604.
- gateway_service.py: أعمدة 13-35 · paid_state_of 160 · نوافذ 47-48 · detect_columns 193 · استيراد 295-393 · receipt_phones 396 · aliases 431-491 · link_row_manual 494 · match_settlement 569-717 · summary 720.
- settlement_service.py: gateway_ops 136-186 · save_gateway_ops 189 · refresh_gw_paid 235 · bank_lines 276-403 · daily_clearing 413-537 · unpaid_other_items 621 · other_company_transfers 796 · transfer_op_allocs 845 · fee voucher 877 · add_other_transfer 925 · set_row_class 1459 · distribute/undistribute 1499/1531.
- ui: sub_pay_blocks 22/134/396/447/466/481 · subcontractors.py: _client_state_cell 116 · _validate 2677 · _save 2698 (سقف المجموع 2716) · SubPlanDialog 3515 · SubcontractorsPage 3811 · SubPaymentsDialog 4065 · sub_plan_editor.py: SubPlanLineDialog 25 (استحقاق مقفول 63/141) · subcontractor_page.py: overview 447 · contracts 483 · blocks 554-616 · vouchers.py: _link_kind 829 · _reload_due 844 (معطلة/ملغاة 884-907) · OverpayWarning flow 2002-2012 · payment_gateway_page.py 12-40 · gateway_page.py tabs 279/297/317 · clearing_page.py 374-385 · due_items_page.py 43-141.
