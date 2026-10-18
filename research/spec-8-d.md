# spec-8-d — تحليل عميق: الملاحق/الأوامر التغييرية والمطالبات المالية والإلغاء الموحد
المصدر: ConTrack V9.15.18 الأصلي (PySide6) — /home/z/my-project/contrack_v9.15.18/
النطاق: addendums + addendum_items + claims + unified_cancel + التأثير المحاسبي
التاريخ: تحليل قراءة فقط — أساس «المرحلة 4» في النسخة الأونلاين (Next.js + Prisma)

---

## 0) خريطة الملفات المقروءة
| ملف | سطور | دور |
|---|---|---|
| app/services/addendum_service.py | 1387 | منطق بنود الأمر التغييري (إضافة/حذف/تنفيذ/إرجاع) |
| app/ui/addendum_dialog.py | 1146 | شاشة ChangeOrderDialog (عميل/مقاول) |
| app/services/claims_service.py | 501 | آلة حالات المطالبات + الأتمتة |
| app/ui/claims_page.py | 553 | صفحة المطالبات (تابان + فلاتر + إجراءات) |
| app/services/unified_cancel_service.py | 497 | خدمة إلغاء موحدة (V8.3) |
| app/ui/cancel_dialog.py | 308 | حوار إلغاء/استرجاع/أرشفة موحد |
| app/services/extras_service.py | 741 | خدمات متنوعة — فيها ربط السندات بالملحقات (allocation) |
| app/services/lifecycle_service.py | 6294 | add_addendum / approve_addendum / cancel_addendum / contract_current_value / cancel_voucher / log_event |
| app/services/statement_service.py | 335 | كشف الحساب — إدخال الملحقات مدين/دائن |
| app/services/report_service.py | 1679 | التقارير — صافي الملحقات في القيمة الحالية |
| app/database/database.py | 2333 | جداول addendums (719) / addendum_items (1622) / claims (1920) / vouchers (686) / payment_plan (770) / contract_events (737) |

---

## 1) الملحق / الأمر التغييري (Addendum)

### 1.1 جدول addendums (database.py:719-735 + أعمدة مرقّعة 1585-1607)
```
id              INTEGER PK AUTOINCREMENT
addendum_number TEXT NOT NULL                 -- 'ADD-001' لكل عقد (لا يُعاد استخدامه)
contract_id     INTEGER NOT NULL → contracts(id) ON DELETE CASCADE
addendum_type   TEXT DEFAULT 'أمر تغييري'      -- أحد ["عقد إضافي","أمر تغييري"]
adate           TEXT DEFAULT ''                -- تاريخ الملحق
reason          TEXT DEFAULT ''                -- السبب (مطلوب في الشاشة)
description     TEXT DEFAULT ''
amount_add      REAL DEFAULT 0                 -- الزيادة (جهة العميل فقط عند التنفيذ)
amount_deduct   REAL DEFAULT 0                 -- الخصم (جهة العميل فقط عند التنفيذ)
start_date      TEXT DEFAULT ''                -- أعمدة تواريخ موجودة لكن بلا منطق تمديد مدة في الكود
end_date        TEXT DEFAULT ''
status          TEXT DEFAULT 'مسودة'           -- مسودة | معتمد | ملغى
approved_date   TEXT DEFAULT ''                -- يُثبَّت عند الاعتماد
notes           TEXT DEFAULT ''
created_at      TEXT DEFAULT (datetime now)
-- مرقّعة (ALTER) في database.py:
cancel_reason   TEXT (1589-1591)   cancelled_at TEXT (1592-1594)
side            TEXT DEFAULT 'client' (1596-1598)   -- client | sub
sub_contract_id INTEGER → sub_contracts (1599-1601)
items_count     INTEGER DEFAULT 0 (1602-1604)
applied_at      TEXT DEFAULT '' (1605-1607)         -- تم التنفيذ؟ (idempotency)
```
فهرس: idx_addendums_contract_status ON addendums(contract_id, status) (database.py:1958).

### 1.2 جدول addendum_items (database.py:1621-1644 + ALTERs 1645-1657)
```
id               INTEGER PK
addendum_id      INTEGER NOT NULL → addendums(id) ON DELETE CASCADE
side             TEXT NOT NULL DEFAULT 'client'   -- 'client' | 'sub'  (SIDES, addendum_service.py:26)
action           TEXT NOT NULL DEFAULT 'add'      -- 'add' | 'delete' | 'unlink'
parent_part_id   INTEGER DEFAULT 0                -- لسطر unlink: يشير لسطر الحذف الأب
created_item     INTEGER DEFAULT 0                -- 1 = البند أُنشئ حديثًا بأمر تغييري (يُمحى عند الإرجاع)
restore_deleted_by INTEGER DEFAULT 0              -- رقم الملحق الذي حذف البند سابقًا (لاسترجاع الوسم)
applied          INTEGER DEFAULT 0
boq_item_id      INTEGER                          -- إذا كان السطر يلمس بند BOQ قائم
sub_contract_id  INTEGER                          -- جهة المقاول: عقد الباطن
subcontractor_id INTEGER → subcontractors (ALTER 1648-1650)
description/qty/unit/unit_price/amount
created_at
ref_kind         TEXT DEFAULT '' (ALTER 1652-1654) -- 'boq' | 'plan' | 'stage' | ''
ref_id           INTEGER DEFAULT 0 (ALTER 1655-1657)
```
فهرس: idx_addendum_items_addendum (1643-1644).

### 1.3 أنواع الملحق (الحرفي)
- `ADDENDUM_TYPES = ["عقد إضافي", "أمر تغييري"]` — lifecycle_service.py:461. لا يوجد نوع «تمديد مدة»؛ عمودا start_date/end_date موجودان لكن apply_parts لا يلمسهما إطلاقًا (التمديد الزمني الوحيد في النظام هو عقد الإشراف supervision، خارج نطاق الملحق).
- «عقد إضافي» شرطه `amount_add > 0` (lifecycle_service.py:492-493).
- بنود الأمر (ref_kind): **boq** (بند أعمال) / **plan** (دفعة من payment_plan) / **stage** (مرحلة) — أي أن الملحق يضيف/يحذف أي سطر من سطور العقد الثلاثة عبر contract_basis_info() (addendum_service.py:53-131).

### 1.4 دورة الحياة والقواعد (شبه-كود)
```
CREATE (مسودة):
  ensure_addendum() [addendum_dialog.py:1082-1098]
    └ lc.add_addendum(..., status='مسودة', allow_zero=True) [lifecycle_service.py:463-522]
       تحقق: type ∈ ADDENDUM_TYPES (472)
             side ∈ {client, sub} (474-476)؛ sub ⇒ sub_contract_id إلزامي ويعود لنفس العقد (477-487)
             amount_add/deduct ≥ 0 (488)؛ ليس اثنان صفرًا إلا allow_zero (490)
             «عقد إضافي» ⇒ amount_add > 0 (492)
             حارس الخصم: current + add − deduct ≥ المحصّل فعليًا
               (vouchers vtype='receipt' cancelled=0) وإلا رفض (494-506)
       رقم: next_addendum_number = f"ADD-{COUNT(*)+1:03d}" لكل عقد (456-459)
             — العد يشمل الملغاة ⇒ الرقم لا يُعاد استخدامه
       INSERT + log_event(contract, f"إضافة {type}", "{number}: صافي التعديل ±X · {reason}") (519-521)

ADD PART [addendum_service.py:526-620 add_part]:
  ممنوع إذا status='ملغى' أو applied_at (539-542)
  وصف إلزامي (أو boq/ref) · qty>0 · unit_price≥0 (543-552)
  side='sub' ⇒ subcontractor_id إلزامي (553-555)
  تطبيع: boq_item_id ⇒ ref_kind='boq', ref_id=boq_item_id (556-560)
  حصرية للمقاولين _check_exclusivity (623-647): السطر المسنَد لمقاول لا يُسنَد لآخر
  منع التكرار في نفس الأمر _check_pending_dup (650-670) + تكرار client add (586-592)
  INSERT ثم _refresh_counts → addendums.items_count (850-857)

ADD DELETE PART [addendum_service.py:673-773 add_delete_part]:
  نفس حواجز الحالة؛ boq ⇒ يجب أن يتبع العقد (697-705)؛ side=sub ⇒ البند لازم يكون
  على عقد الباطن المحدد (706-716)؛ منع تكرار الحذف (717-722 / 754-760)
  plan ⇒ amount من payment_plan؛ stage ⇒ amount=0 (733-768)

SYNC HEADER [addendum_service.py:860-891 sync_header]:
  قبل الاعتماد: تثبيت adate/reason/description/addendum_type/side/sub_contract_id
  side يُستنتج من الأجزاء (client إن وُجد أي جزء عميل) (868-871)

APPROVE [lifecycle_service.py:524-541 approve_addendum]:
  status='معتمد' + approved_date=today ثم addendum_service.apply_parts(aid)
  (ValidationError يمنع الاعتماد؛ بقية الاستثناءات تبتلع)
  log_event "اعتماد {type}"

APPLY PARTS [addendum_service.py:897-1242 apply_parts]:
  idempotent: applied_at موجود ⇒ {"already": True} (907-908)
  حارس 1: صافي خصم كل عقد باطن لا يجعل sub_contracts.amount ≤ 0 (915-938)
  حارس 2: خصم العميل لا يجعل قيمة العقد الحالية < المحصّل (940-955)
  V6.2: أجزاء مقاول بلا عقد باطن ⇒ يُنشأ sub_contracts بقيمة صافي أجزائه
        ووصف "عقد باطن — من أمر تغييري" + log_event (958-1008)
  side=client + add:
     boq موجود ⇒ إحياء: boq_items.deleted_addendum_id=NULL, deleted_at='' (1022-1033)
     plan/stage محذوف ⇒ إحياء بالمثل (1034-1057)
     بند يدوي جديد ⇒ INSERT boq_items + boq_item_id/ref_kind/ref_id/created_item=1 (1058-1071)
  side=client + delete:
     فك ارتباط sub_contract_items للبند + تسجيل أسطر action='unlink' للتراجع (1073-1096)
     boq ⇒ deleted_addendum_id=aid, deleted_at=today (1097-1099)
     plan ⇒ payment_plan.deleted_addendum_id=aid (+فك روابط مقاول) (1100-1122)
     stage ⇒ contract_stages.deleted_addendum_id=aid (+فك روابط) (1123-1145)
  side=sub + add ⇒ INSERT sub_contract_items (boq أو source_kind/source_id) (1146-1190)
     بند مقاول يدوي ⇒ ينشئ بند boq_items في العقد أولًا (1151-1163)
  side=sub + delete ⇒ DELETE sub_contract_items (1191-1200)
  أخيرًا: applied=1 لكل add/delete/unlink (1201-1203)
         addendums.applied_at=today, items_count=len(parts),
         amount_add=t.client.add, amount_deduct=t.client.deduct   (1204-1208)
         sub_contracts.amount += صافي أجزاء كل مقاول (1209-1224)
         addendums.sub_contract_id = أول sub في الأجزاء (1225-1230)
  log_event "تنفيذ أمر تغييري ADD-00X · عميل: +X/−Y · مقاول: +Z/−W" (1234-1238)

CANCEL [lifecycle_service.py:543-563 cancel_addendum]:
  status='ملغى' + cancel_reason + cancelled_at (551-553)
  addendum_service.restore_parts(aid) [1245-1384]:
    client add + created_item ⇒ DELETE boq_items (1270-1271)
    client add (إحياء) ⇒ إرجاع الوسم القديم restore_deleted_by (1272-1288)
    client delete ⇒ إزالة deleted_addendum_id من boq/plan/stage (1290-1303)
    sub unlink ⇒ إعادة إدخال sub_contract_items (1304-1328)
    sub add (created) ⇒ حذف الرابط والبند؛ sub add ⇒ حذف الرابط (1329-1350)
    sub delete ⇒ إعادة الرابط (1351-1372)
    sub_contracts.amount -= صافي أجزاء الباطن (1374-1378)
    addendums.applied_at='' + amount_add=0 + amount_deduct=0 (1379-1381)
  log_event "إلغاء {type}" + "إرجاع بنود أمر تغييري ملغى"
  ملاحظة: عقد الباطن المُنشأ من الأمر (V6.2) لا يُحذف عند الإلغاء.
```

### 1.5 التأثير على القيمة/الخطة/BOQ/الأحداث
- **contracts.amount لا يُعدَّل أبدًا.** القيمة الحالية محسوبة دائمًا:
  `contract_current_value` [lifecycle_service.py:629-659] =
  `amount + Σamount_add − Σamount_deduct (status='معتمد') + تمديد الإشراف`.
  النسخة المجمّعة `contract_values_map` [585-626].
- **payment_plan: لا توليد ولا إعادة توزيع.** الملحق لا ينشئ دفعات جديدة؛ يكتفي بحذف/إحياء ناعم (`deleted_addendum_id` — database.py:1658-1668). الزيادة تنعكس على القيمة الحالية فقط، والتحصيل الزائد عن مجموع الخطة يُفسَّر تلقائيًا كسداد على الأوامر التغييرية (extras_service.py:650-698 smart_receipt_description؛ 454-485 allocation_options).
- **BOQ:** إنشاء بنود يدوية جديدة (created_item=1) أو وسم/إحياء موجودة.
- **سجل الأحداث:** contract_events (database.py:737-744) عبر log_event (lifecycle_service.py:281-292) — أنواع الأحداث: `إضافة أمر تغييري/عقد إضافي`، `اعتماد ...`، `تنفيذ أمر تغييري`، `إلغاء ...`، `إرجاع بنود أمر تغييري ملغى`، `عقد باطن من أمر تغييري`.
- **حالات الملحق:** `مسودة` → `معتمد` → (أو) `ملغى`. لا حالة «مرفوض». الانتقال مسودة→معتمد فقط عبر approve_addendum؛ الإلغاء متاح من أي حالة (ولو غير منفَّذ — restore_parts يخرج مبكرًا إن لم يكن applied).
- **اعتماده:** من مركز العقد contract_hub (زر «✔ اعتماد» 1506-1518، `_approve_addendum` 1542-1564) أو مباشرة عند «💾 حفظ واعتماد الأمر» في الشاشة (addendum_dialog.py:1100-1137 — الحفظ = sync_header ثم approve_addendum في معاملة واحدة). لا يوجد gate صلاحية خاص بالاعتماد.
- **الطباعة:** **لا يوجد نموذج ملحق مستقل.** لا شيء باسم print_addendum/نموذج ملحق في الكود؛ batch_print_service يدعم invoice/voucher/statement فقط (batch_print_service.py:7-43). الملحق يظهر ضمن كشف الحساب المطبوع (أسطر ADD-) وجدول مركز العقد.

---

## 2) التسلسل المحاسبي للملحق
### 2.1 كشف الحساب — نعم يدخل
`statement_service.build_statement` [14-130]:
- يجلب الملحقات **المعتمدة فقط**: `WHERE contract_id=? AND status='معتمd' ORDER BY adate,id` (34-39).
- لكل ملحق: `net = amount_add − amount_deduct`؛ تجاهل إذا |net|<0.001 (59)؛
  net>0 ⇒ حركة **مدين** (وصف «{النوع}: {السبب}»، مرجع = addendum_number) (63-65)؛
  net<0 ⇒ حركة **دائن** بمقدار −net (66-68).
- `current_value = contract.amount + net_addendums + sup_extension` (109)؛
  `total_debit` يشمل أسطر ADD- المدينة و`total_deducts` يجمع أسطر ADD- الدائنة (110-117)؛
  **المتبقي = القيمة الحالية − المحصّل** (129) — الحسميات داخل القيمة مرة واحدة.
- القاعدة: الفواتير «للعلم» فقط ولا تخفض المديونية (73-77).
- كشف العميل الشامل build_customer_statement يستثني عقود بحالة ملغى/مسودة ثم يمر عبر build_statement (154-163).

### 2.2 التقارير — يدخل ضمن القيمة الحالية
- تقرير العملاء والأرصدة customers_balances: `net_addendum = Σ(amount_add−amount_deduct) WHERE status='معتمد'` والقيمة = amount + net_addendum (report_service.py:53-127، صيغة مشابهة 406-433 و702-741).
- التقرير المالي cash_flow_detail: «قيمة العقد تُشتق من contract_current_value (القاعدة 35) فتشمل الملحقات المعتمدة وتمديد الإشراف» (1212-1219).
- تقرير فجوة الخطة contract_gaps_report يستثني البنود المحذوفة بأمر تغييري من مجاميع البنود (report_service.py:22-27).
- **قيود journal_entries:** الملحق لا ينشئ قيدًا محاسبيًا؛ القيود للسندات فقط (_insert_voucher_journal). أي لا double-entry للملحق.

### 2.3 الربط بسندات القبض (allocation)
- `vouchers.allocation` (ALTER database.py:1683-1686) = رقم الملحق (ADD-00X).
- `allocation_options(contract_id)` [extras_service.py:454-485]: الأوامر المعتمدة net>0 مع المدفوع/المتبقي (من سندات غير ملغاة allocation!='' مجمّعة).
- `allocated_description` [488-518]: بيان سند القبض «سداد/سداد جزء/استكمال — العقد الإضافي ADD-001 (السبب)».

---

## 3) المطالبات المالية (Claims)

### 3.1 جدول claims (database.py:1918-1940)
```
id              INTEGER PK
claim_number    TEXT NOT NULL UNIQUE          -- 'CLM-0001' تسلسل عام (ليس لكل عقد)
direction       TEXT NOT NULL CHECK (direction IN ('out','in'))
                -- out = مطالبتنا على العميل | in = مطالبة المقاول علينا
contract_id     INTEGER NOT NULL → contracts(id)
sub_contract_id INTEGER → sub_contracts(id)   -- إلزامي عمليًا لجهة in
cust_line_id    INTEGER → payment_plan(id)    -- الدفعة المرتبطة (جهة out)
sub_line_id     INTEGER → sub_payment_plan(id)-- الدفعة المرتبطة (جهة in)
title           TEXT NOT NULL
amount          REAL NOT NULL CHECK (amount > 0)
due_date        TEXT DEFAULT ''
status          TEXT NOT NULL DEFAULT 'registered'
voucher_ref     TEXT DEFAULT ''               -- رقم سند التحصيل/الدفع
notes           TEXT DEFAULT ''               -- تُلحق بها أسطر تدقيق الانتقالات
postponed_until TEXT DEFAULT ''               -- (ALTER database.py:2079-2080)
created_by      TEXT DEFAULT ''               -- auth_service.display_name()
created_at, updated_at
```
فهارس: idx_claims_contract، idx_claims_dir_status (1939-1940).

### 3.2 الحالات والانتقالات (claims_service.py)
- تسميات الحالة STATUS_LABEL (16-26):
  `registered` 🆕 مسجلة · `sent` 📤 مرسلة · `in_review` 🔍 قيد المراجعة ·
  `approved` ✅ معتمدة · `refused` ⛔ مرفوضة · `collected` 💰 محصّلة ·
  `paid` 💸 مدفوعة · `postponed` ⏳ مؤجلة · `cancelled` ✕ ملغاة.
- عرض مختصر STATUS_DISPLAY (29-39): registered/sent/in_review/approved ⇒ «مستحقة»، collected/paid ⇒ «مسددة».
- الانتقالات NEXT (42-60):
```
out: registered → sent|postponed|cancelled
     sent       → approved|postponed|cancelled
     approved   → collected|postponed|cancelled
     postponed  → registered|sent|approved|cancelled
     collected/cancelled  ← نهائية
in:  registered → in_review|postponed|cancelled
     in_review  → approved|refused|postponed|cancelled
     approved   → paid|postponed|cancelled
     postponed  → registered|in_review|approved|cancelled
     refused/paid/cancelled ← نهائية
```
- الحالة النهائية للتسديد TERMINAL_PAID (62): out→collected، in→paid.
- المتأخر is_overdue (332-339): `status=='approved' AND due_date < today`.

### 3.3 قواعد التسجيل والتعديل (شبه-كود)
```
add_claim [77-159]:
  direction ∈ {out,in}؛ title إلزامي؛ amount>0؛ due_date ISO
  out: cust_line_id يتبع نفس العقد (113-119)؛ amount ≤ مبلغ الدفعة +0.001 (120-122)
       يصفّر sub_contract_id/sub_line_id (123-124)
  in:  sub_contract_id إلزامي ويتبع العقد (126-132)؛ sub_line_id يتبع عقد الباطن
       وamount ≤ مبلغ الدفعة (133-143)؛ يصفّر cust_line_id (144)
  الرقم: _next_number = CLM-{MAX(CAST(SUBSTR(claim_number,5) AS INT))+1:04d} عامًا (70-74)
  INSERT status='registered', created_by=display_name() (145-158)

update_claim [162-230]: ممنوع على النهائية collected/paid/refused/cancelled (175-177)
  سقف amount = مبلغ الدفعة المرتبطة (194-207)؛ updated_at

set_status [233-284]: يفرض جدول NEXT (247-252)
  postponed ⇒ postponed_until إلزامي وصحيح (255-263)
  سطر تدقيق داخل notes: "[yyyy-mm-dd مستخدم] قديم ← جديد · ملاحظة · مؤجلة حتى X" (265-272)
  collected/paid ⇒ _auto_complete_claim_tasks (287-301): إغلاق المهام المعلقة
  التي يحوي عنوانها رقم المطالبة

delete_claim [304-314]: فقط registered («ألغِ المرحّلة بدلًا من حذفها»)
reset_claims_for_contract [317-329]: للمطور — يحذف registered فقط
```

### 3.4 الأتمتة (V4.48)
- مطالبات تلقائية عند استحقاق دفعة: `auto_claim_for_customer_line` (419-435) و`auto_claim_for_sub_line` (438-457) — عنوان «مطالبة تلقائية: {title}» ومبلغ = مبلغ الدفعة وملاحظة «تلقائية من استحقاق دفعة بتاريخ …». يمنع الازدواج `_open_claim_for_line` (408-416) — المرفوضة/الملغاة لا تمنع إعادة التقديم. تُستدعى من workflow_service `_fire_auto_claims` (4420-4435) عند تحفيز دفعات بإتمام مرحلة.
- تسديد تلقائي: `auto_settle_contract(contract_id, voucher_number)` (460-500) تُنادى بعد حفظ سند من lifecycle_service.py:2464-2478 — إذا غطت سندات العقد/الباطن مبلغ المطالبة المرتبطة بسطر (covered ≥ amount) تُرحّل إلى collected/paid مع voucher_ref. تغطي كل الحالات المفتوحة (478).
- ملاحظة عيب في الأصل: ui/vouchers.py:2019 يستدعي `auto_update_claims_for_contract` غير الموجودة (ملفوفة try/except ⇒ no-op) — المسار الفعال هو auto_settle_contract أعلاه.

### 3.5 الأثر المالي للمطالبات
- **لا تدخل كشف الحساب** (statement_service بلا ذكر لـ claims)، **ولا تقرير المستحقات/الأرصدة/الربحية** (report_service بلا matches)، **ولا journal_entries**. هي سجل متابعة مستقل.
- التأثير الوحيد عبر الحواجز: **cancel_voucher يرفض إلغاء سند إذا كان العقد مرتبطًا بمطالبات سارية** (status NOT IN ('ملغاة','مسددة'→ الحرفي: 'ملغاة','مسجلة')) — lifecycle_service.py:4741-4751: «لا يمكن إلغاء السند: العقد مرتبط بـ N مطالبة سارية. ألغِ المطالبات أولًا».
- إجماليات الشاشة totals (392-406): المفتوح = كل غير (collected/paid/refused/cancelled)؛ المنجز = collected/paid؛ المتأخر.
- **رقم تسلسلي:** CLM-#### عام فريد. **طباعة:** لا نموذج مطالبة فردي — الطباعة جدول PDF للقائمة المصفّاة عبر tabular_pdf (claims_page.py:526-552) + تصدير Excel (518-524).

### 3.6 الشاشة (claims_page.py)
- تابان: «📤 مطالبتنا على العملاء» (out) و«📥 مطالبات المقاولين علينا» (in) (228-233)؛ تابات حالة مبنية من NEXT + «⚠ المتأخر» (282-285)؛ بحث نصي (237-242).
- ClaimDialog (30-189): العقد ← (عقد الباطن لجهة in) ← الدفعة المرتبطة (اختيارية «— بلا ربط —») ← العنوان/المبلغ/الاستحقاق/مرجع السند/ملاحظات. في التعديل: العقد والباطن والدفعة مقفلة (85-88).
- إجراءات: إرجاء بحوار تاريخ+سبب وينشئ مهمة تلقائية «⏳ مطالبة مرجأة: …» في شاشة المهام (408-467)؛ إلغاء المطالبة → set_status('cancelled') (469-485)؛ تعديل بنقرة مزدوجة (400-406)؛ قائمة سياق (379-397).
- تلوين: منجز أخضر، ملغى/مرفوض أحمر فاتح، مؤجل أصفر، متأخر نص أحمر (349-369).

---

## 4) الإلغاء الموحد (unified_cancel_service V8.3)

### 4.1 النطاق المعلن
- أنواع الحركات STATUSES (25-64): `voucher` · `contract` · `claim` · `sub_contract` · `custody`. **لا يشمل addendum.**
- عمليات: `cancel_transaction` (112-150) / `restore_transaction` (153-186) / `archive_transaction` (189-210).
- خطوات الإلغاء: تحقق (216-242) ⇒ نسخة JSON احتياطية في جدول `entity_backups` (290-326) ⇒ «عكس القيود» (329-344 — عمليًا placeholder pass للسندات فقط) ⇒ تحديث الحالة (357-382) ⇒ سجل تدقيق `cancel_audit_log` (385-452) بأعمدة entity_type/entity_id/action/reason/user_name/backup_id/reversed_amount.
- الانتقالات TRANSITIONS (67-106) — تشمل أضلاع استرجاع: voucher cancelled→active؛ contract cancelled→active؛ claim cancelled→registered؛ sub_contract cancelled→active؛ custody cancelled→active. الأرشفة متاحة فقط للملغى/المنتهي (_validate_archival 273-287).
- تحديث الحالة (357-382): voucher ⇒ cancelled=1 + cancelled_at؛ contract/claim/sub_contract ⇒ كتابة **التسمية العربية** في عمود status — تناقض مع claims التي حالاتها إنجليزية (بقعة خطر عند التطبيق).

### 4.2 الاستخدام الفعلي في الأصل (مهم)
- حوارات cancel_dialog.py (CancelDialog 23-176، سجل الإلغاءات 178-263، مساعدات 269-308) **غير مربوطة فعليًا** بالقوائم — لا منادي لـ cancel_contract_dialog/cancel_claim_dialog/cancel_voucher_dialog. الاستثناء: advances_page.py:391 يستورد restore_transaction لسلف الموظفين.
- المسار التشغيلي الحقيقي للسندات هو `lc.cancel_voucher` [lifecycle_service.py:4701-4770]:
```
cancel_voucher(vid, reason):
  يوجد وغير ملغى (4703-4708)
  تسليم عهدة ⇒ يمنع وجود تصفية/رد سارٍ (4709-4725)
  سلفة موظف ⇒ يمنع وجود رد/خصم سارٍ (4726-4738)
  _ensure_contract_accepts_financial_actions(contract_id) (4739)
  حارس المطالبات: مطالبات سارية على العقد ⇒ رفض (4741-4751)
  UPDATE vouchers cancelled=1 + cancel_reason + cancelled_at (4753-4756)
  الأبناء (رسوم بنكية parent_voucher_id) تُلغى تلقائيًا بنفس السبب (4757-4764)
  _reverse_voucher_journals لكل المجموعة (4765)  ← قيود عكسية فعلية
  log_event "إلغاء سند {رقم} · {مبلغ} · السبب" (4766-4769)
  _comment_receipt_cancel_reopens_plan (4650-4698): إلغاء القبض يعيد فتح الدفعات
  المغطاة سابقًا (notes على payment_plan + تعليق نظام للعميل)
```
- إلغاء عقد الباطن: change_contract_status/sub status عبر lifecycle_service.py:936-971 (status='ملغى' + cancel_reason + cancel_close_amount + cancelled_at) — ويطلب صلاحية مدير من الشاشة (contract_hub.py:708-711 perm='action_change_status' مع سبب ومبلغ إغلاق 714-726).
- إلغاء الملحق: lc.cancel_addendum (خارج الخدمة الموحدة — قسم 1.4).
- إلغاء المطالبة: claims_service.set_status('cancelled') (خارج الخدمة الموحدة).
- الاستنتاج: الخدمة الموحدة = إطار مفاهيمي (أرشفة + تدقيق + استرجاع)؛ التنفيذ الفعلي لكل كيان موزع في خدماته. المرحلة الأونلاين الحالية (إلغاء سندات) تعادل cancel_voucher.

### 4.3 ملخص التأثيرات المتسلسلة لكل نوع إلغاء
| النوع | ماذا يحدث | المرجع |
|---|---|---|
| سند | cancelled=1 + سبب + تاريخ؛ أبناء الرسوم يلغون؛ قيود عكسية؛ إعادة فتح دفعات مغطاة + تعليق؛ منع إن كانت مطالبات سارية/عهدة/سلف معلقة | lifecycle_service.py:4701-4770 |
| ملحق | status='ملغى' + cancel_reason + cancelled_at؛ restore_parts يعكس كل بنود العقد/الباطن ويصفّر المبالغ؛ أحداث إلغاء+إرجاع | lifecycle_service.py:543-563؛ addendum_service.py:1245-1384 |
| مطالبة | انتقال إلى cancelled (مسموح من كل حالة غير نهائية، وأيضًا من postponed)؛ لا حذف إلا registered | claims_service.py:42-60, 233-284, 304-314 |
| عقد | status='ملغى' + status_reason + cancel_close_amount + cancelled_at (يتطلب صلاحية action_change_status) | lifecycle_service.py:936-971؛ contract_hub.py:702-727 |
| عقد باطن | status='ملغى' + cancel_reason (قاعدة مشابهة database.py:1431-1435) | lifecycle_service.py:936-971 |

---

## 5) الصلاحيات
- الأدوار (auth_service.py:124-128): `admin` مدير · `secretary` سكرتير · `developer` مطور (المطور = صلاحيات المدير +). المدير والمطور دائمًا «كل شيء» (389-391، has_permission 485-501)؛ السكرتير حسب تخصيص مخزن وإلا افتراضي العمود `secretary` في PERMISSIONS.
- مفاتيح ذات صلة بالنطاق:
  - `screen_claims` «شاشة المطالبات المالية» — **سكرتير: مسموح افتراضيًا** (245-249)؛ بوابة القائمة main_window.py:612/631/804-805.
  - `action_cancel_voucher` «إلغاء السندات» — **سكرتير: ممنوع افتراضيًا** (343-347)؛ مفحوص في واجهة السندات (tests/test_permissions.py:78,118,148).
  - `action_change_status` «تغيير حالة العقد» (إلغاء/إغلاق) — **سكرتير: ممنوع افتراضيًا** (378-382)؛ enforce في contract_hub.py:708-711.
  - `action_edit_voucher` (333-337) سكرتير: مسموح لكن الحفظ يتطلب اعتماد مدير؛ `action_view_financial` (353-357) سكرتير: ممنوع (يخفي الربحية — contract_hub.py:2062).
- **الملحقات: لا مفتاح صلاحية مخصص.** إنشاء/اعتماد/إلغاء الأمر التغييري متاح لمن يصل لمركز العقد (screen_customers — سكرتير مسموح). لا require_admin على مسار الملحق.
- **المطالبات: إضافة/تعديل/إرجاء/إلغاء بلا gate إضافي** داخل الشاشة؛ الحماية الوحيدة بوابة screen_claims.
- اعتراض مصادقة عام: auth_service.admin_override (504-505) «موافقة مدير مؤقتة» تُستخدم عبر style.require_admin في مسارات أخرى (ليست في مسار الملحق/المطالبة).

---

## 6) سيناريو كامل متوقع: «إضافة ملحق زيادة 500 دينار» كما يفعلها الأصل
1. **فتح مركز العقد → تاب الملحقات → زر «＋ أمر تغييري» (جهة عميل)** → `open_change_order` (contract_hub.py:1523-1539) يفتح `ChangeOrderDialog` (addendum_dialog.py:80).
2. **رأس الشاشة:** النوع «أمر تغييري» (أو «عقد إضافي» — عندها الزيادة إلزامية)، التاريخ=اليوم، السبب (إلزامي عند الحفظ، 1101-1103)، الوصف. يظهر «العقد X — القيمة الحالية: …» المحسوبة من contract_current_value (458-462).
3. **إضافة بند يدوي:** وصف + كمية 1 + سعر 500 → `_add_manual` (646-660):
   - `ensure_addendum()` (1082-1098) ينشئ **الآن** سجل addendums: `addendum_number='ADD-00X'` (ترقيم بعدّ كل ملحقات العقد)، `status='مسودة'`، `amount_add=0, amount_deduct=0`، `side='client'`.
   - `add_part` (addendum_service.py:526-620) يدرج `addendum_items`: side='client'، action='add'، qty=1، unit_price=500، **amount=500**، ref_kind='' (يدوي). ثم `items_count=1`.
4. **💾 حفظ واعتماد الأمر** `_save` (1100-1137):
   - تحقق: سبب موجود + جزء واحد على الأقل (1101-1112).
   - `sync_header` (860-891): يثبّت adate/reason/description/type/side='client'.
   - `lc.approve_addendum` (524-541): `status='معتمد'`، `approved_date=اليوم` ⇒ `apply_parts` (897-1242):
     - الحارسان (خصم مقابل المحصّل / أرضية عقد الباطن) يمران (خصم=0).
     - client+add بدون ref ⇒ **INSERT boq_items**(contract_id, description, 1, unit, 500) ويحدّث السطر: boq_item_id=الجديد، ref_kind='boq'، ref_id=الجديد، **created_item=1** (1058-1071).
     - `applied=1` على الأسطر (1201-1203)؛ `addendums.applied_at=اليوم، amount_add=500، amount_deduct=0، items_count=1` (1204-1208).
     - **لا تغيير في payment_plan ولا في contracts.amount ولا في sub_contracts.**
     - حدثان في contract_events: «اعتماد أمر تغييري ADD-00X» (541) ثم «تنفيذ أمر تغييري ADD-00X · عميل: +500.000/−0.000 · مقاول: +0.000/−0.000» (1234-1238).
5. **الأثر اللاحق دون أي خطوة إضافية:**
   - `contract_current_value['current'] += 500` ⇒ لوحة العقد/لوحة المؤشرات/كل التقارير (أرصدة، ربحية، مالي) ترتفع 500.
   - كشف الحساب (statement_service.py:57-69) يضيف حركة: (تاريخ adate، «أمر تغييري: السبب»، **مرجع ADD-00X**، **مدين 500**) ⇒ الرصيد والمتبقي +500 (129).
   - بنود العقد (BOQ) يظهر فيها بند جديد 500.
   - عند تحصيل لاحق يتجاوز مجموع الخطة: `smart_receipt_description` يوزع الفائض على «الأمر التغييري ADD-00X (السبب)» ويكتب في سند القبض allocation=ADD-00X (extras_service.py:650-698)؛ و`allocation_options` يعرض المتبقي على الملحق (454-485).
6. **التراجع (اختياري):** زر «✕ إلغاء المحدد» في مركز العقد (1567-1593) → سبب → `cancel_addendum` (543-563): status='ملغى' + cancel_reason + cancelled_at ⇒ `restore_parts` (1245-1384): **يحذف بند boq_items المُنشأ** (created_item=1، 1270-1271)، يصفّر applied_at/amount_add/amount_deduct (1379-1381) ⇒ القيمة الحالية وكشف الحساب يرجعان كما كانا؛ حدثا «إلغاء أمر تغييري» و«إرجاع بنود أمر تغييري ملغى · أُعيد 1 بند/رابط». الرقم ADD-00X لا يُعاد استخدامه.

---

## 7) مخطط حقول مقترح للمرحلة 4 (Prisma — مطابق للأصل حرفيًا)
يستفيد من الموجود أصلًا في schema.prisma: `BoqItem.deletedAddendumId/deletedAt` (245-246)، `ContractStage.deletedAddendumId` (228)، `PaymentPlan.deletedAddendumId` (264)، `ContractEvent` (459-467)، `SubContractItem.sourceKind/sourceId` (334-335). المطلوب إضافته:

```prisma
model Addendum {
  id             Int          @id @default(autoincrement())
  addendumNumber String                                  // ADD-001 (لكل عقد)
  contractId     Int
  contract       Contract     @relation("ContractAddendums", fields: [contractId], references: [id], onDelete: Cascade)
  addendumType   String       @default("أمر تغييري")     // "عقد إضافي" | "أمر تغييري"
  adate          DateTime
  reason         String       @default("")
  description    String       @default("")
  amountAdd      Float        @default(0)                // يثبَّت عند التنفيذ = مجاميع جهة العميل
  amountDeduct   Float        @default(0)
  startDate      DateTime?                               // موجودان بالأصل بلا منطق تمديد
  endDate        DateTime?
  status         String       @default("مسودة")          // مسودة | معتمد | ملغى
  approvedDate   String       @default("")
  notes          String       @default("")
  cancelReason   String       @default("")
  cancelledAt    DateTime?
  side           String       @default("client")         // client | sub
  subContractId  Int?
  subContract    SubContract? @relation("SubContractAddendums", fields: [subContractId], references: [id])
  itemsCount     Int          @default(0)
  appliedAt      DateTime?                               // null = غير منفَّذ (idempotency)
  createdBy      String       @default("")
  createdAt      DateTime     @default(now())
  items          AddendumItem[]

  @@unique([contractId, addendumNumber])
  @@index([contractId, status])
}

model AddendumItem {
  id               Int        @id @default(autoincrement())
  addendumId       Int
  addendum         Addendum   @relation(fields: [addendumId], references: [id], onDelete: Cascade)
  side             String     @default("client")         // client | sub
  action           String     @default("add")            // add | delete | unlink
  parentPartId     Int        @default(0)                // لسطر unlink
  createdItem      Boolean    @default(false)            // بند أُنشئ بالأمر (يُمحى عند الإرجاع)
  restoreDeletedBy Int        @default(0)                // وسم الحذف القديم لإرجاعه
  applied          Boolean    @default(false)
  boqItemId        Int?
  boqItem          BoqItem?   @relation("BoqAddendumItems", fields: [boqItemId], references: [id])
  subContractId    Int?
  subContract      SubContract? @relation("SubAddendumItems", fields: [subContractId], references: [id])
  subcontractorId  Int?
  description      String     @default("")
  qty              Float      @default(0)
  unit             String     @default("")
  unitPrice        Float      @default(0)
  amount           Float      @default(0)
  refKind          String     @default("")               // "" | boq | plan | stage
  refId            Int        @default(0)
  createdAt        DateTime   @default(now())

  @@index([addendumId])
}

model Claim {
  id             Int       @id @default(autoincrement())
  claimNumber    String    @unique                        // CLM-0001 (تسلسل عام)
  direction      String                                       // out | in
  contractId     Int
  contract       Contract  @relation("ContractClaims", fields: [contractId], references: [id])
  subContractId  Int?
  subContract    SubContract? @relation("SubClaims", fields: [subContractId], references: [id])
  custLineId     Int?
  custLine       PaymentPlan?    @relation("ClaimCustLine", fields: [custLineId], references: [id])
  subLineId      Int?
  subLine        SubPaymentPlan? @relation("ClaimSubLine", fields: [subLineId], references: [id])
  title          String
  amount         Float                                        // > 0
  dueDate        String    @default("")                       // yyyy-mm-dd كالأصل
  status         String    @default("registered")             // registered|sent|in_review|approved|refused|collected|paid|postponed|cancelled
  voucherRef     String    @default("")
  notes          String    @default("")                       // أسطر تدقيق الانتقالات
  postponedUntil String    @default("")
  createdBy      String    @default("")
  createdAt      DateTime  @default(now())
  updatedAt      String    @default("")

  @@index([contractId])
  @@index([direction, status])
}
```
وتعديلات مكمّلة:
- `Voucher` أضف `allocation String @default("")` (تخصيص قبض على ADD-) — يقابل vouchers.allocation (database.py:1683-1686).
- `SubContract` يحتاج relation عكسية للنماذج الجديدة؛ وبالنهاية يبقى `Contract.amount` دون مساس.
- منطق القيمة الحالية = دالة حسابية فوق العلاقات (لا عمود مخزن): `amount + Σ amountAdd − Σ amountDeduct (status="معتمد") + supExtension`.

### API Routes المقترحة (تتبع نمط المشروع الحالي /api/...)
```
GET  /api/contracts/[id]/addendums            — قائمة + مجاميع (list_addendums + totals)
GET  /api/contracts/[id]/addendum-context     — سطور العقد الموحدة + المتاح للحذف/الإضافة
                                                 (contract_basis_info + available_items + sub_basis_info)
POST /api/contracts/[id]/addendums            — إنشاء مسودة (ensure_addendum) مع أول part
POST /api/addendums/[id]/parts                — add_part / add_delete_part (body: side, action, ref…)
DELETE /api/addendums/[id]/parts/[partId]     — remove_part (قبل التنفيذ فقط)
POST /api/addendums/[id]/approve              — approve_addendum (معاملة: اعتماد + applyParts + حارسا الخصم)
POST /api/addendums/[id]/cancel               — cancel_addendum (سبب إلزامي + restoreParts)
GET  /api/claims?direction&status&contractId&search&overdue
POST /api/claims                              — add_claim (سقف مبلغ الدفعة + الربط)
PATCH /api/claims/[id]                        — update_claim (منع على النهائية)
POST /api/claims/[id]/status                  — set_status (جدول الانتقالات + postponed_until + سطر تدقيق)
DELETE /api/claims/[id]                       — delete_claim (registered فقط)
POST /api/claims/auto-settle                  — تُستدعى داخليًا بعد حفظ/إلغاء السند (auto_settle_contract)
```
نقاط دمج إلزامية في الموجود: `/api/vouchers/[id]/cancel` يجب أن يضيف حارس «مطالبات سارية» و«إعادة فتح الدفعات المغطاة»؛ `/api/payments/[id]/trigger` يجب أن يطلق المطالبات التلقائية (_fire_auto_claims)؛ حساب القيمة الحالية في dashboard/reports يجب أن يعتمد Σ الملحقات المعتمدة.

### الشاشات المقترحة
1. **مركز العقد — تاب «أوامر تغييرية»**: جدولان (عميل/مقاول) بأعمدة الأصل: الرقم/النوع/(المقاول)/التاريخ/السبب/زيادة/خصم/الصافي/بنود/الحالة (contract_hub.py:1497-1498) + أزرار «✔ اعتماد» و«✕ إلغاء المحدد» (تظهر عند وجود غير معتمد/غير ملغى — 2378-2383).
2. **حوار الأمر التغييري**: رأس ثابت (نوع/تاريخ/سبب/وصف) + تابا «➕ إضافة / ➖ حذف» لجهة واحدة نشطة (client أو sub) + جدول أجزاء الأمر + إجماليات حية في الأسفل «قيمة العقد بعد الأمر / قيمة عقد الباطن بعد الأمر» (sum_lbl_fill 1053-1073). لجهة المقاول: اختيار مقاول + سعر المقاول قابل للتحرير في جدول البنود (989-1013).
3. **صفحة المطالبات**: تابان اتجاه + تابات حالة + بحث + شارات المتأخر + أزرار إرجاء/إلغاء + حوار مطالبة (عقد←باطن←دفعة←مبلغ) + تصدير/طباعة PDF.
4. **تفعيل الربط بالكشف**: أسطر ADD- مدين/دائن في كشف الحساب + net_addendum في تقرير الأرصدة/الربحية (كما في statement_service.py:34-69 وreport_service.py:406-433).

### قواعد يجب نقلها حرفيًا (check-list تنفيذ)
1. الترقيم: `ADD-{count+1:03d}` **لكل عقد** (العد يشمل الملغاة — لا إعادة رقم)؛ `CLM-{n:04d}` **عام**.
2. لا كتابة في contracts.amount إطلاقًا — القيمة دائمًا مشتقة.
3. حارسا الخصم: (أ) قيمة العقد الجديدة ≥ المحصّل غير الملغى، (ب) صافي خصم كل مقاول لا يجعل عقد باطنه ≤ 0.
4. «عقد إضافي» ⇒ زيادة فقط؛ «أمر تغييري» ⇒ زيادة/خصم/بنود.
5. الحذف ناعم دائمًا (deleted_addendum_id) والبند المحذوف يعود عند الإلغاء؛ البنود اليدوية المنشأة (createdItem) تُمحى فعليًا عند الإلغاء.
6. حصرية الإسناد للمقاولين + منع تكرار السطر في نفس الأمر.
7. sub-only order لا يلمس amount_add/amount_deduct (تبقى 0) — المبالغ تتحرك في sub_contracts.amount فقط ⇒ لا يظهر في كشف العميل (سلوك الأصل المقصود).
8. idempotency عبر applied_at؛ الاعتماد معاملة واحدة (اعتماد + تنفيذ).
9. المطالبات: سقف المبلغ بمبلغ الدفعة المرتبطة (تسامح 0.001)؛ الحذف فقط قبل أول ترحيل؛ الإرجاء يتطلب تاريخًا؛ سطر تدقيق داخل notes؛ الإلغاء متاح من أي حالة غير نهائية.
10. عدم إدخال المطالبات في كشف الحساب/المستحقات (سجل متابعة) — لكن حارس إلغاء السند يعتمد عليها.
11. الأسعار بفواصل عشرية 3 وخانات (3 decimals) في كل العرض (مطابقة _fmt).

---

## 8) أرقام الأسطر المهمة (فهرس سريع)
**lifecycle_service.py**: log_event 281-292 · next_addendum_number 456-459 · ADDENDUM_TYPES 461 · add_addendum 463-522 · approve_addendum 524-541 · cancel_addendum 543-563 · list_addendums 566-583 · contract_values_map 585-626 · contract_current_value 629-659 · list_boq 676-694 · sub cancel 936-971 · auto_settle hook 2464-2478 · _comment_receipt_cancel_reopens_plan 4650-4698 · cancel_voucher 4701-4770 (حارس مطالبات 4741-4751).
**addendum_service.py**: SIDES 26 · contract_basis_info 53-131 · available_items 227-375 · add_part 526-620 · _check_exclusivity 623-647 · _check_pending_dup 650-670 · add_delete_part 673-773 · list_parts 776-801 · remove_part 804-815 · totals 818-841 · _refresh_counts 850-857 · sync_header 860-891 · apply_parts 897-1242 · restore_parts 1245-1384.
**addendum_dialog.py**: ChangeOrderDialog 80 · بناء التابات 217-432 · reload_available 595-618 · _add_manual 646-660 · _mark_delete 729-767 · reload_sub_items 772-812 · _add_selected_sub 818-849 · _mark_delete_sub 880-911 · جدول سعر المقاول 916-1013 · sum_lbl_fill 1053-1073 · ensure_addendum 1082-1098 · _save 1100-1137 · open_change_order 1140-1146.
**claims_service.py**: DIR_OUT/DIR_IN 13-14 · STATUS_LABEL 16-26 · STATUS_DISPLAY 29-39 · NEXT 42-60 · _next_number 70-74 · add_claim 77-159 · update_claim 162-230 · set_status 233-284 · _auto_complete_claim_tasks 287-301 · delete_claim 304-314 · is_overdue 332-339 · list_claims 342-383 · totals 392-406 · _open_claim_for_line 408-416 · auto_claim_for_customer_line 419-435 · auto_claim_for_sub_line 438-457 · auto_settle_contract 460-500.
**claims_page.py**: HEADS 23-26 · ClaimDialog 30-189 · التابات والفلاتر 228-290 · التلوين 349-370 · _postpone (مهمة تلقائية) 408-467 · _cancel_claim 469-485 · تصدير/طباعة 488-552.
**unified_cancel_service.py**: STATUSES 25-64 · TRANSITIONS 67-106 · cancel_transaction 112-150 · restore 153-186 · archive 189-210 · _create_backup 290-326 · _update_status 357-382 · cancel_audit_log 385-452.
**cancel_dialog.py**: CancelDialog 23-176 · CancelHistoryDialog 178-263 · مساعدات 269-308.
**statement_service.py**: أسطر الملحقات 34-39 و57-69 · القيمة الحالية والمتبقي 109-129.
**report_service.py**: استبعاد بنود محذوفة 22-27 · net_addendum في الأرصدة 84-127 · ربحية العميل 406-433 · تقرير الباطن 702-741 · القاعدة 35 1212-1219.
**extras_service.py**: allocation_options 454-485 · allocated_description 488-518 · smart_receipt_description (توزيع الفائض على الأوامر) 650-698.
**database.py**: vouchers 686-717 (allocation 1683-1686) · addendums 719-735 (ALTER 1585-1607) · contract_events 737-744 · payment_plan 770-786 (deleted_addendum_id 1658-1663) · addendum_items 1621-1644 (ALTER 1645-1657) · claims 1918-1940 (postponed_until 2079-2080) · فهارس 1958-1959.
**auth_service.py**: الأدوار 124-128 · PERMISSIONS 192-383 (screen_claims 245-249 · action_cancel_voucher 343-347 · action_change_status 378-382) · has_permission 485-501.
**contract_hub.py**: زرا اعتماد/إلغاء 1506-1518 · _add_addendum_side 1523-1530 · _approve_addendum 1542-1564 · _cancel_addendum 1567-1593 · حارس تغيير الحالة 702-727 · إظهار الأزرار 2378-2383.
**workflow_service.py**: _fire_auto_claims 4420-4435.
