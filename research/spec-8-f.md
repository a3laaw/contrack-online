# spec-8-f — تحليل عميق: المهام · الزيارات · التعليقات/الإشعارات · الأرشيف · البحث الشامل · مجموعات العقود · تهيئة الأنواع · audit_log · ملف العميل · المزايا/التفضيلات
المصدر: ConTrack V9.15.18 الأصلي (PySide6) — /home/z/my-project/contrack_v9.15.18/
النطاق: الوحدات الإنتاجية المتبقية (خارج النطاق المالي المغطى في spec-8-a..d)
التاريخ: قراءة عميقة بمراجع أسطر — أساس وحدات Next.js القادمة

---

## 0) خريطة الملفات المقروءة
| ملف | سطور | دور |
|---|---|---|
| app/services/task_service.py | 430 | المهام: CRUD + تنبيهات قبل/بعد الموعد + واتساب |
| app/ui/tasks.py | 484 | شاشة المهام + لوحة المهام المدمجة (compact) |
| app/services/visits_service.py | 339 | جدول الزيارات: ساعات × موظفين + ترحيل كمهمة + PDF |
| app/ui/visits.py | 317 | شاشة جدول الزيارات |
| app/services/comment_service.py | 332 | تعليقات ملف العميل (customer_comments) |
| app/services/comment_center_service.py | 185 | مركز التعليقات الموحد (meta: نوع/أولوية/حالة/وسوم/متابعة) |
| app/ui/comments_center.py | 214 | شاشة مركز التعليقات |
| app/services/workflow_service.py | 5469 | المتابعة: شات transaction_messages + stage_notes + notifications + transaction_visibility + dismissed_alerts + قالب الدفعات + شجرة المراحل |
| app/ui/archive.py | 1946 | ملف العميل التفصيلي (CustomerFileWidget: overview/contracts/comments) |
| app/services/archive_service.py | 105 | أرشيف ملفات العميل على نظام الملفات |
| app/services/search_service.py | 127 + app/services/search_utils.py 57 | البحث الشامل + تطبيع العربية |
| app/ui/global_search.py | 112 | نافذة البحث الشامل |
| app/services/contract_group_service.py | 166 | مجموعات العقود |
| app/services/types_setup_service.py | 1288 | تأسيس الأنواع/المراحل/الدفعات عبر Excel |
| app/ui/type_workflow.py | 772 | ربط مراحل ودفعات نوع العقد |
| app/ui/settings.py | 4351 | تبويبات: أنواع العقود (1851) · سير العمل (2549) · الزيارات (3342) · المزايا (1098) |
| app/services/feature_service.py | 402 | مفاتيح المزايا |
| app/services/prefs_service.py | 30 | تفضيلات الواجهة في settings.ui_prefs |
| app/services/purge_service.py | 1021 | سجل تدقيق الحذف purge_audit |
| app/services/unified_cancel_service.py | 497 | سجل تدقيق الإلغاء cancel_audit_log |
| app/database/database.py | 2333 | كل أعمدة الجداول (مراجع أدناه) |

---

## 1) قائمة المهام (Tasks)

### 1.1 جدول tasks (database.py:1819-1831 + أعمدة مرقّعة 1844-1852)
```
id              INTEGER PK AUTOINCREMENT
title           TEXT NOT NULL
details         TEXT DEFAULT ''
due_at          TEXT NOT NULL            -- 'YYYY-MM-DD HH:MM' (نص!)
remind_minutes  INTEGER DEFAULT 30
source          TEXT DEFAULT 'يدوية'      -- 'يدوية' | 'جدول الزيارات' | ...
status          TEXT DEFAULT 'مفتوحة'     -- 'مفتوحة' | 'منجزة' (نص عربي!)
notified_before INTEGER DEFAULT 0         -- علم رفع تنبيه قبل الموعد (مرة واحدة)
notified_after  INTEGER DEFAULT 0         -- علم رفع تنبيه بعد الموعد (مرة واحدة)
created_at      TEXT DEFAULT (datetime('now','localtime'))
done_at         TEXT DEFAULT ''           -- يُملأ عند الإتمام (datetime localtime)
task_type       TEXT DEFAULT 'تذكير'      -- 'موعد' | 'تذكير' (مرقّع 1846-1848)
customer_id     INTEGER                   -- ربط اختياري بعميل (1849-1850)
contract_id     INTEGER                   -- ربط اختياري بعقد (1851-1852)
```
فهارس (1962-1963): `idx_tasks_customer_contract(customer_id, contract_id, status, due_at)` + `idx_tasks_status_due(status, due_at)`.

### 1.2 القواعد الحرفية (task_service.py)
- الحالات نصية عربية: `STATUS_OPEN = "مفتوحة"` (س15) و`STATUS_DONE = "منجزة"` (س16)؛ صيغة التخزين `_FMT = "%Y-%m-%d %H:%M"` (س17).
- **إضافة** `add_task` (س45-74): العنوان إلزامي؛ التحقق من صيغة due_at؛ `_validate_links` (س33-42): العقد المرتبط يجب أن يخص العميل المرتبط («العقد المحدد لا يخص هذا العميل.»)؛ `remind_minutes = max(0, …)`؛ task_type يُقبل فقط «موعد/تذكير» وإلا «تذكير» (س65).
- **أرشفة تلقائية** `_archive_task` (س77-107): كل مهمة لها customer_id تُكتب كملف نصي `مهمة_{date}_{title}[40]`.txt داخل مجلد أرشيف العميل (فشلها لا يعطل الإضافة).
- **تحديث** `update_task` (س110-130): يصفّر `notified_before/notified_after=0` (تنبيه جديد بعد أي تعديل).
- **إتمام** `complete_task` (س133-137): status=«منجزة» + done_at=الآن. **إعادة فتح** `reopen_task` (س140-144): status=«مفتوحة» + done_at='' + تصفير الأعلام. **حذف فعلي** `delete_task` (س147-149).
- `list_tasks` (س165-180): LEFT JOIN customers/contracts لجلب `customer_name` و`contract_number`؛ ترتيب `status DESC, due_at` (المفتوحة أولًا لأن «مفتوحة» > «منجزة» معجميًا)؛ `_decorate_tasks` (س152-162) يضيف `overdue` (مفتوحة + موعد فائت) و`minutes_left`.
- `list_customer_tasks` (س183-206): مهام عميل محدد + عقود اختيارية بحد 300 (لا تُحمّل كل مهام النظام في ملف العميل).
- `open_tasks_count` (س209-213): عداد المهام المفتوحة (الرئيسية).
- **محرك التنبيه** `due_notifications` (س216-247): لكل مهمة مفتوحة — (أ) قبل الموعد إذا `0 <= minutes_to <= remind_minutes` ولم تُرفع `notified_before` ⇒ رفع + وسم `kind:'before'`؛ (ب) بعد الموعد إذا فات ولم تُرفع `notified_after` ⇒ `kind:'after'`. **كل نوع تنبيه يُرفع مرة واحدة فقط** (علماً في الجدول). يُستهلك من مؤقّت الرئيسية كل 60 ثانية (main_window.py:933-936).
- **واتساب** (س275-386): قالبان حسب task_type — «موعد» ← settings.wa_appt، «تذكير» ← settings.wa_reminder (وقوالب قديمة task_wa_customer/task_wa_manager احتياطًا)؛ حقول `{العميل} {المهمة} {العقد} {التاريخ} {الوقت} {ملاحظات} {الشركة} {النوع}`؛ بالأسماء فقط بلا أرقام؛ `arabic_time` «09:34 ص» (س253-262) و`arabic_date` «30 أغسطس 2026» (س265-272).
- `task_customer_phone` (س389-406): هاتف العميل المربوط، أو هاتف صاحب العقد تلقائيًا لو المهمة مربوطة بعقد فقط. `task_party_name` (س409-429) بنفس المنطق.

### 1.3 الواجهة (tasks.py)
- حوار المهمة (س23-175): نوع المهمة إلزامي («📌 موعد — مع العميل» / «📝 تذكير — عام»)، العنوان، التفاصيل، التاريخ والوقت في خانتين منفصلتين (تخزين موحد yyyy-MM-dd hh:mm)، التذكير من قائمة: 15/30/60/120/1440 دقيقة، عميل وعقد مع **فلترة ذكية**: عقود العميل المختار فقط (`_reload_contracts` س126-133).
- شاشة المهام `TasksPage` (س178-484): جدول 5 أعمدة (المهمة، الموعد، المصدر، الحالة، المتبقي) — أو 3 أعمدة في اللوحة المدمجة (compact: المهمة/الموعد/المتبقي)؛ عنوان المهمة يُلحق «(عميل · عقد)» (س348-355)؛ «المتبقي» نصوص: متأخرة X س/د · بعد X يوم/س/د (س336-347)؛ تلوين: منجزة رمادي، متأخرة أحمر عريض، مفتوحة أزرق (س364-377)؛ سطر ملخص «مهام مفتوحة: N | متأخرة: M» (س379-383).
- أزرار: إتمام (btnReceipt) · تعديل (نقرة مزدوجة أيضًا) · إعادة فتح · واتساب (مخفي إذا `feature_service.enabled("whatsapp")=false` — س287-291) · حذف (قائمة يمين بس11-302). إرسال واتساب: قائمة طرفين «ملخص للمدير (manager_phone من الإعدادات)» أو «تذكير للعميل» (س433-483) — تُنسخ الرسالة للحافظة وفتح واتساب يفشل بهدوء مع hint.
- **لوحة الداشبورد**: نفس TasksPage بـ compact=True مضافة في بطاقة بالرئيسية (main_window.py:111-127) يخفيها مفتاح الميزة `tasks` (س131-132)؛ تنبيهات المهام المتأخرة تظهر في «سجل التنبيهات» بلا زر تحويل (`no_convert` س397-400)، وزر «مهمة» في التنبيهات النظامية يحوّل النص لمهمة عبر `convert_alert` (س528-536).

---

## 2) جدول الزيارات اليومي (Visits)

### 2.1 الجداول (database.py)
```
employees  (397-403): id, name UNIQUE, phone, notes, active — جدول قديم غير مستخدم في وحدة الزيارات
visit_staff (405-411): id, name, phone, active(1), sort(0)   -- أعمدة الجدول = الموظفون/المهندسون
visits     (465-476): id, visit_date TEXT NOT NULL, hour_slot TEXT NOT NULL ('08:00'),
                      staff_id → visit_staff(id), customer_id → customers(id),
                      note TEXT DEFAULT '', task_id INTEGER (الزيارة المرحَّلة كمهمة),
                      created_by TEXT, created_at, UNIQUE(visit_date, hour_slot, staff_id)
```
إعدادات الساعات في settings (ترقيع 1384-1387): `visits_start_hour=8 · visits_end_hour=17 · visits_slot_minutes=60`.

### 2.2 القواعد الحرفية (visits_service.py)
- ساعات العمل (س23-39): start∈[0,23], end∈[1,24], end>start (وإلا start+1)؛ **slot مسموح حصرًا ∈ {15,20,30,60,90,120}** وإلا 60. `hour_slots()` (س55-63) يبني ["08:00","08:15",…] حتى قبل النهاية.
- الموظفون: `add_staff` (س78-95): اسم إلزامي + منع تكرار الاسم النشط («الموظف موجود بالفعل.») + sort = MAX(sort)+1. `delete_staff` (س118-128): **إذا له زيارات ⇒ تعطيل (active=0) بلا حذف فعلي**، وإلا حذف فعلي. `staff_usage` (س131-135): عدد الزيارات المسجلة (عمود «زيارات مسجلة» في الإعدادات).
- `set_visit` (س157-187): حجز/تفريغ خانة (ساعة×موظف) — الخانة الواحدة لعميل واحد (قيد UNIQUE)؛ اختيار عميل في خانة موجودة = تحديث؛ تفريغ = DELETE فعلي؛ **عميل واحد في خانتين لنفس الموظف بنفس اليوم = مسموح (تنبيه بسيط لا منع)** (تعليق س170-172)؛ created_by = اسم المستخدم الحالي (يُمرر من الواجهة visits.py:249-251).
- `day_visits` (س141-154): يوم واحد JOIN موظف+عميل (staff_name/staff_phone/customer_name/customer_phone) مرتب بالساعة.
- **ترحيل زيارة كمهمة** `visit_to_task` (س212-229): الخانة يجب أن تحوي عميلًا («الخانة فاضية — لا زيارة للترحيل.») وغير مرحّلة («هذه الزيارة مرحَّلة كمهمة بالفعل.»)؛ ينشئ مهمة `task_type='موعد'` و`source='جدول الزيارات'` وdue_at=`{visit_date} {HH:MM}` وعنوان `زيارة: {customer_name}` وتفاصيل `المهندس: X · {note}` ثم يثبّت `visits.task_id`. **ترحيل يوم كامل**: زر «➤ ترحيل كمهام» يرحّل كل زيارات اليوم غير المرحّلة بعد تأكيد (visits.py:296-316).
- تذكير واتساب (س232-268): رسالة مهندس (هاتف الموظف) ورسالة عميل (هاتف العميل) بصيغة ثابتة مع الساعة والتاريخ والملاحظة؛ لا هاتف ⇒ خطأ مع إرشاد («أضف هاتف الموظف من: الإعدادات ← جدول الزيارات»).
- `export_day_pdf` (س274-338): A4 أفقي، صفوف الساعات × أعمدة الموظفين، الخانة = اسم العميل + أول 60 حرف من الملاحظة، ترويسة بهوية الشركة.

### 2.3 الواجهة (visits.py + settings.py تبويب الزيارات)
- شاشة الزيارات (visits.py:21-317): شريط علوي (◷ اليوم · تاريخ بمنتقي · ⬇ تصدير PDF · ➤ ترحيل كمهام)؛ الجدول يُبنى ديناميكيًا: عمود «الساعة» + عمود لكل موظف نشط؛ خانة محجوزة = اسم العميل + «✓ مهمة» إن مرحّلة + الملاحظة (س128-144)؛ نقرة مزدوجة تفتح حوار الخانة: اختيار عميل بالبحث + ملاحظة + (حفظ · ترحيل كمهمة · تذكير المهندس · تذكير العميل — الأخيران مخفيان بمفاتيح whatsapp/tasks س218-240)؛ الفارغة «—» بتلميح «نقرة مزدوجة لحجز زيارة».
- تبويب الزيارات في الإعدادات (settings.py:3342-3481): بطاقة «ساعات عمل جدول الزيارات» (من الساعة/إلى الساعة/مدة الحصة من القائمة الست + حفظ) وبطاقة «الموظفون (أعمدة الجدول)» جدول (الموظف · الهاتف · زيارات مسجلة) + إضافة موظف بالاسم والهاتف + تعديل/حذف-تعطيل من قائمة الصف.

---

## 3) التعليقات والإشعارات والمتابعة

### 3.1 جدول customer_comments (comment_service.py:33-76 — تُنشأ خارجه عن _SCHEMA)
```
id           INTEGER PK
customer_id  INTEGER NOT NULL → customers(id) ON DELETE CASCADE
contract_id  INTEGER → contracts(id) ON DELETE SET NULL
body         TEXT NOT NULL            -- حد أقصى MAX_LEN = 2000 حرف (س19)
created_by   TEXT DEFAULT ''          -- اسم الدخول (للتدقيق)
author       TEXT DEFAULT ''          -- الاسم المعروض (يُكتب في الفقاعة)
created_at   TEXT NOT NULL DEFAULT (datetime localtime)
pinned       INTEGER DEFAULT 0
edited_at    TEXT DEFAULT '' ; editor TEXT DEFAULT ''     -- من عدّل ومتى
-- أعمدة مركز التعليقات (additions س57-67):
kind         TEXT DEFAULT 'عام'       -- ('عام','مالية','بلدية','قانونية','تنفيذ','مستندات','اتصال')
priority     TEXT DEFAULT 'عادي'      -- ('عادي','مهم','عاجل')
status       TEXT DEFAULT 'مفتوح'     -- ('مفتوح','تم','مؤجل','ملغى')
tags         TEXT DEFAULT ''          -- نص حر «بلدية، تحصيل، رخصة»
followup_date TEXT DEFAULT ''         -- تاريخ متابعة (due filter)
is_deleted   INTEGER DEFAULT 0        -- حذف ناعم فقط — لا حذف فعلي
deleted_at   TEXT DEFAULT '' ; delete_reason TEXT DEFAULT ''
source       TEXT DEFAULT ''          -- 'comments_center' أو فراغ (تلقائي)
```
فهارس (72-75): `idx_comments_customer_live(customer_id, is_deleted, pinned, created_at DESC, id DESC)` و`idx_comments_contract_live(contract_id, is_deleted, created_at DESC, id DESC)`.

### 3.2 قواعد التعليقات الحرفية (comment_service.py)
- **الإضافة** `add_comment` (س110-123): نص إلزامي ≤2000 (س100-107)؛ يحتاج عميلًا؛ created_by = اسم الدخول وauthor = الاسم المعروض.
- **الترتيب** (س154): `pinned DESC, created_at DESC, id DESC`.
- **الصلاحيات**:
  - الحذف `can_delete` (س185-187): **صاحب التعليق (مقارنة created_by باسم الدخول لا الاسم المعروض — س170-174) أو مدير فقط**؛ الحذف ناعم `is_deleted=1 + deleted_at + status='ملغى'` (س238-248).
  - التعديل `can_edit` (س209-215): **للمدير فقط بلا مهلة زمنية** (طلب المستخدم) + تسجيل edited_at/editor (س222-235). (يوجد ثابت قديم EDIT_WINDOW_MIN=10 س79 لم يعد مستخدمًا في can_edit.)
  - التثبيت `can_pin` (س190-192): **للمدير فقط**؛ toggle يعيد الحالة الجديدة (س251-262).
- **عرض مركّب**: `customers_with_comments` (س279-300): لكل عميل {عدد، has_pinned، آخر نص/كاتب/وقت} — مصدر شارة 💬/📌 في شاشة العملاء.
- `stale_pinned` (س313-331): تعليقات مثبّتة عمرها ≥ 14 يوم (STALE_PINNED_DAYS) — تنبيه الرئيسية.
- `contract_comments(contract_id)` (س303-310): لدمج تعليقات العقد في سجله الزمني.

### 3.3 مركز التعليقات (comment_center_service.py)
- نفس الجدول (الحفاظ على البيانات — س1-6) + `ensure_schema` (س19-39) يضمن الأعمدة الإضافية.
- الثوابت (س14-16): `STATUSES=("مفتوح","تم","مؤجل","ملغى") · PRIORITIES=("عادي","مهم","عاجل") · KINDS=("عام","مالية","بلدية","قانونية","تنفيذ","مستندات","اتصال")` — غير صالح ⇒ قيمة افتراضية (س50-54).
- `add_comment` (س57-73): source='comments_center'؛ created_by وauthor = الاسم المعروض.
- `list_comments` (س76-124): فلاتر عميل/عقد/حالة/نوع/أولوية/وسم/بحث مع **تطبيع عربي** (normalized_search_clause على body/author/اسم العميل/رقم العقد/contract_name/description/tags)؛ `due_only`: `followup_date <= اليوم AND status != 'تم'` (س114)؛ `open_only`: status IN ('مفتوح','مؤجل')؛ ترتيب: `pinned DESC ثم priority (عاجل=0, مهم=1, غير=2) ثم created_at DESC` (س121)؛ LIMIT 1..2000 (افتراضي 500).
- `update_meta` (س127-152) · `soft_delete(reason)` (س155-164) · `summary` (س167-184): {total, open, urgent, due}.
- الواجهة comments_center.py: فلاتر أعلى (بحث مع debounce 420ms، عميل، عقد يُفلتر بالعميل، حالة، نوع، ☐ تحتاج متابعة الآن)؛ جدول 8 أعمدة (التاريخ، العميل، العقد، النوع، الأولوية، الحالة، متابعة، التعليق)؛ أزرار: ✔ تعليم تم · ↩ إعادة فتح · ✕ إلغاء/إخفاء (يبقى في القاعدة)؛ `load_filter(customer_id, contract_id)` لفتحه مفلترًا من ملف العميل/مركز العقد (س130-137).

### 3.4 شات المعاملات + ملاحظات المراحل + الإشعارات (workflow_service.py — وحدة «المتابعة» followup)
- أنواع المعاملات (س24-34): `contract=عقد · payment=سند صرف · subcontract=عقد باطن · customer=عميل (ما قبل التعاقد)`؛ أنواع الإشعار (س112-113): `NOTIF_STAGE="stage_change" · NOTIF_MESSAGE="new_message"`.
- **transaction_messages** (database.py:549-559): id, transaction_type, transaction_id, user_id→users, message, attachment_path, created_at — فهرس idx_tx_messages.
  - `add_message` (س2551-2572): رسالة فارغة ممنوعة؛ **يضيف الكاتب مشاركًا تلقائيًا** ثم إشعار «رسالة جديدة من {who}: {أول 60 حرف…}» لكل المشتركين والمديرين إلا الكاتب.
  - `get_messages` (س2575-2589): **تُرجع [] لمن لا يملك صلاحية الرؤية**؛ الاسم المعروض للكاتب JOIN users.
- **stage_notes** (database.py:532-547): id, transaction_type, transaction_id, contract_id, customer_id, stage_name, note, created_by→users, author, created_at.
  - `add_stage_note` (س2402-2453): ملاحظة على المعاملة **بلا تغيير مرحلتها**؛ تُسجل باسم المرحلة الحالية (س2394-2399)؛ **تنزل تلقائيًا تعليق عميل** بصيغة «📝 [ملاحظة مرحلة «X»] … — {سياق المعاملة}» (س2437-2443) + إشعار «📝 ملاحظة جديدة…: {أول 80 حرف}» (س2446-2451).
  - تُدمج في سجل المراحل كسطور kind='note' بعنوان «📝 ملاحظة — {stage_name}» (س2499-2528)؛ `stage_notes_by_contract` (س2476-2496) لآخر ملاحظة لكل عقد في تقرير التنفيذ.
- **transaction_visibility** (database.py:574-580): UNIQUE(transaction_type, transaction_id, user_id) — جدول المشاركة.
  - **قاعدة «المشاركة = الرؤية»** (س1-15 و1276-1297): المدير/المطوّر يرى كل شيء؛ صاحب شاشة المعاملة (screen_contracts/screen_customers/screen_subcontractors حسب النوع) يرى مسارها الفني؛ وإلا فقط إن كان سطرًا في transaction_visibility.
  - `auto_add_participant` (س1300-1309): أي تفاعل (فتح تبويب متابعة/رسالة/نقل مرحلة/ملاحظة) يضيف المستخدم مشاركًا.
  - `participants` (س1312-1318) · `_notify_targets` (س1321-1331): **المشتركون + كل users.role IN ('admin','developer') — يُستثنى مُفعّل الفعل**.
- **notifications** (database.py:561-572): id, user_id→users, transaction_type, transaction_id, type, text, is_read(0), created_at — فهرس (user_id, is_read).
  - متى تُنشأ (كلها عبر `_push` س1334-1343): (1) إنهاء/تخطي مرحلة: «{who} أنهى مرحلة «X» وبدأت «Y»» (س1488-1492)؛ (2) استحقاق دفعة بالإنهاء: «استحقت دفعة «X» (مبلغ) بإنهاء مرحلة «Y»» أو رسالة «مسددة مسبقًا» (س1493-1501)؛ (3) استحقاق دفعة باطن بالمرحلة (س1503-1510)؛ (4) اكتمال مصادر دفعة باطن (س1512-1519)؛ (5) ملاحظة مرحلة جديدة (س2447-2450)؛ (6) رسالة شات جديدة (س2569-2571)؛ (7) تراجع عن مرحلة (س1791)؛ (8) انتقالات المراحل غير التعاقدية (س2314، 4785-4791، 4854).
  - **تعليق تلقائي موازٍ** `_auto_comment` (س4667-4678): كل حركة مرحلة تُلحق بتعليق عميل «🤖 [متابعة تلقائية] …» (إثراء لا يعطل).
  - القراءة: `get_unread_notifications` (س2595-2604: آخر 100 غير مقروء) · `unread_count` (س2607) · `mark_read`/`mark_all_read` (س2617-2631) · `clear_all_notifications` حذف فعلي لكل إشعارات المستخدم (س2634-2641) · `clear_old_notifications` للمقروءة الأقدم من 30 يوم (س2697+).
- **dismissed_alerts** (س2644-2694): جدول (user_id, alert_key=sha1(نص التنبيه), created_at) — إخفاء التنبيهات النظامية المحسوبة لكل مستخدم؛ المفتاح بصمة النص فتغيّر البيانات يعيدها ظاهرة؛ `restore_dismissed_alerts` يزيل الإخفاء.

---

## 4) الأرشيف (Archive)

### 4.1 ما هو الأرشيف فعلًا — **مجلد ملفات على القرص، لا جداول**
`archive_service.py`: كل عميل له مجلد `data/archive/{customer_code}_{اسم آمن[60]}` يُنشأ تلقائيًا (`get_customer_folder` س28-33)؛ يتبع مجلد البيانات الفعلي (محلي/شبكي) لحظة الاستخدام (س15-19).
- `list_files` (س36-64): ملفات المجلد مع {name, path, size, modified, ext} الأحدث أولًا مع limit حماية.
- `save_to_archive` (س67-84): نسخ ملف إلى أرشيف العميل؛ overwrite=False يضيف طابعًا زمنيًا HHMMSS عند تعارض الاسم؛ overwrite=True للمستندات المولدة تلقائيًا (أحدث نسخة تحل محل القديمة).
- `delete_file` (س91-96): **حارس مسار**: يجب أن يكون الملف داخل مجلد الأرشيف (realpath) وإلا يُرفض.
- **من يكتب في الأرشيف تلقائيًا**: المهام المرتبطة بعميل (task_service.py:67-107 ملف «مهمة_YYYY-MM-DD_….txt») · كشوف الحساب عند الطباعة (statement.py:586) · سندات القبض الزجاجية (glass_receipt.py:301) · معاينة PDF «حفظ بالأرشيف» (pdf_preview.py:197-200) · نماذج Word/PDF المعبأة (form_service.py:1077-1080) · إضافة مرفق يدوي من ملف العميل (archive.py:1694-1717).

### 4.2 ملف العميل التفصيلي — CustomerFileWidget (ui/archive.py) — «كل شيء عن العميل في شاشة واحدة»
يُفتح من شاشة العملاء (dealings) عبر `open_customer_file` → `main_window.open_customer_page(customer_id, "overview")` (main_window.py:1454-1474، حارس صلاحية screen_customers) كصفحة داخلية embedded بشريط رجوع دائم.
- **الصفحات** `PAGES = ("overview", "contracts")` (س100) + لوحة تعليقات جانبية (بشرط ميزة `comments` س472-489) وقائمة إضافية (س921-935): عقود العميل · مركز التعليقات · الملفات والمستندات.
- **نظرة عامة (overview)** `_page_overview` (س322-492):
  1. بطاقة «ملخص العميل»: 3 مقاييس معروضة **المتبقي / العقود (N · نشط: M) / شيكات 14 يوم** (س356-381؛ القيم الحقيقية من `totals` س494-511؛ لون المتبقي: أخضر ≤0.001، أحمر لو عقد متأخر مع tooltip «على العميل N عقد بقسط متأخر (أقصى تأخر X يومًا)»، كهرماني غير ذلك).
  2. بطاقة «نماذج ومرفقات العميل»: اختيار نموذج (يفتح قائمة القوالب المناسبة للعميل/العقد — بلا توليد عشوائي) · ＋ إضافة مرفق · 📂 فتح مجلد المرفقات · مجلد الشبكة (مسار يدوي لكل عميل — تعيين/فتح/حذف المسار فقط من بطاقة العميل: س1723-1801).
  3. «📌 أهم عقود العميل»: أعلى 5 عقود بالأكبر متبقي، أعمدة (العقد، الحالة، القيمة، المحصّل، المتبقي) ونقرة مزدوجة تفتح العقد (س447-455، 513-525).
  4. «🕒 السجل الزمني»: آخر 12 حدثًا من `contract_events` لكل عقود العميل مع أيقونات ثابتة (🟢 إنشاء، ✅ اعتماد، 📎 ملحق، 📥 قبض، 📤 صرف، ⏸ إيقاف، ▶ تفعيل، 🔒 إغلاق، ❌ إلغاء، 🏁 انتهاء، 🚫 إلغاء سند، 🏗 ضبط إشراف…) (س544-578).
  5. لوحة «تعليقات العميل» (شرط الميزة): صندوق كتابة سريع (فلتر «يخص العقد:» + نص + زر ➤) وفقاعات مؤرخة؛ قائمة يمين: تثبيت/حذف · التعديل للمدير فقط (س1225-1307، 1288-1306)؛ البحث والعرض الكامل في مركز التعليقات (س1309-1319).
- **صفحة العقود (contracts)** `_page_contracts`/`_sec_contracts_inner` (س810-1050): بحث نصي + فلتر (كل/نشط/بمتبقٍ/مغلقة-منتهية-ملغاة عبر normalize_contract_status)؛ أعمدة (الاسم، الحالة ملونة من STATUS_COLORS، المتبقي أحمر لو has_overdue مع tooltip «عليه دفعة متأخرة منذ X يومًا»، زر ✎ تعديل لكل صف)؛ سطر ملخص «المعروض: N عقد · المتبقي X»؛ **تستثني الملغاة من الإجماليات** (س991-993)؛ تحديد صف يعرض تفاصيل العقد داخل الصفحة (ContractDetail).
- إجراءات العميل الإضافية: تعديل العميل · واتساب (س1814-1829) · سند سريع (قبض/صرف — `_quick_voucher` س1831-1844) · عقد جديد (س1846) · كشف حساب (س1850) · طباعة دفعة (س1875+).
- **عبارات العملاء في القائمة** (dealings.py): شجرة (الاسم، الهاتف، عدد العقود، القيمة الحالية، المحصّل، المتبقي، فراغ)؛ شارات: 🔴 تحديث في مجلد الشير (س511-522) · 💬 له تعليقات مع تلميح «N تعليق · آخرها: كاتب وقت + نص[120]» و📌 لو مثبّت (س523-540)؛ ألوان المتبقي: رمادي مسدّد/أحمر متأخر فعلًا (أقصى تأخير من overdue_plan_items س443-460)/كهرماني.

---

## 5) البحث الشامل (Global Search)

### 5.1 المُطبّع العربي (search_utils.py)
- `normalize` (س16-23): lowercase + إزالة تشكيل («ًٌٍَُِّْٰـ») + استبدالات `(أ,إ,آ,ٱ)→ا · ة→ه · ى→ي · ؤ→و · ئ→ي · ـ→(حذف)` + تقليص المسافات.
- `sql_norm_expr` (س37-45): نفس القواعد داخل SQL عبر REPLACE متداخلة على `LOWER(COALESCE(col,''))`.
- `normalized_search_clause(cols, q)` (س53-56): `(expr LIKE ? OR …)` بمعامل `%q%` مطبّع.

### 5.2 الكيانات المبحوثة (search_service.py:19-126) — `global_search(query, limit_per_type=8)`
| النوع | type_label | أيقونة | الأعمدة المبحوثة | النتيجة (title / subtitle) |
|---|---|---|---|---|
| customer | عميل | 👥 | name, customer_code, phone, email, address, address_governorate, address_area (س28-39) | «name (code)» / هاتف |
| contract | عقد | 📑 | contract_number, contract_name, description, اسم العميل، هاتفه، كوده (س42-59) | «رقم · اسم» / «العميل • القيمة الحالية = amount + Σ(add−deduct للأوامر المعتمدة)» — **القيمة محسوبة داخل SQL** |
| project | مشروع | 🏗 | p.name, project_code, اسم العميل، هاتفه (س62-74) | «code · name» / عميل |
| subcontractor | مقاول باطن | 👷 | name, sub_code, phone, activity (س77-89) | «name (code)» / نشاط • هاتف |
| voucher_receipt / voucher_payment | سند قبض/صرف | 📥/📤 | voucher_number, party, description, account, expense_account_snapshot, custody_account_snapshot, رقم/اسم العقد (س92-108) | «رقم · طرف» / «مبلغ • تاريخ» |
| invoice | فاتورة | 🧾 | invoice_number, اسم العميل، هاتفه, description (س111-124) | «رقم · عميل» / «مبلغ • تاريخ» |

قواعد: أقل من حرفين ⇒ [] (س22-23)؛ حد 8 نتائج لكل نوع؛ **لا صلاحيات داخل الخدمة** — النافذة متاحة حسب القوائم (البحث يُفتح من الرئيسية للجميع والنتيجة تفتح عبر حارس الصلاحية في شاشة الهدف).

### 5.3 النافذة (global_search.py)
Debounce 220ms (س52-57)؛ النتائج مجمّعة بعناوين الأنواع مع عدّاد («N نتيجة · M نوع» س78-79)؛ أيقونات آمنة نصية بدل الإيموجي `_SAFE_ICONS` (س12-13)؛ اختيار (Enter/نقرة مزدوجة) يبعث `result_chosen(type, id)` والنافذة الرئيسية تتصرف بالفتح (س105-111)؛ Enter بلا تحديد يفتح أول نتيجة (س98-103).

---

## 6) مجموعات العقود (Contract Groups)

### 6.1 الجداول (database.py:1894-1917)
```
contract_groups      (1897-1906): id, group_number TEXT UNIQUE, customer_id → customers,
                                  group_name, notes, status TEXT DEFAULT 'نشط', created_at, created_by
contract_group_items (1908-1914): id, group_id → contract_groups, contract_id → contracts,
                                  added_at, UNIQUE(group_id, contract_id)
```
فهارس: customer على المجموعات + group وcontract على العناصر (1915-1917).

### 6.2 القواعد الحرفية (contract_group_service.py)
- **الفلسفة** (س1-6): «ضم عدة عقود مستقلة في حزمة متابعة واحدة… لا تدمج العقود ماليًا ولا تغيّر نوعها؛ ربط تنظيمي فقط» (تصميم + إشراف + كتب بلدية كعقود مستقلة تُعرض كملف واحد).
- الترقيم `next_group_number` (س11-25): `GRP-%04d` بقراءة أعلى رقم موجود (قابل للاستبدال عند تصادم UNIQUE حتى 8 محاولات س59-77).
- `create_group` (س50-78) و`_validate_contracts` (س28-47): **عقدين على الأقل** («اختر عقدين على الأقل») · كل العقود لنفس العميل («لا يمكن ضم عقود عملاء مختلفين») · **يُمنع ضم عقد ملغى** («لا يمكن ضم عقد ملغى داخل مجموعة جديدة») · إزالة تكرار الاختيار؛ created_by = المستخدم الحالي.
- `list_groups` (س81-151): ملخص مالي لكل مجموعة (العقود الملغاة مستثناة): `current_total` = Σ contract_current_value (س121) · `collected_total` = Σ سندات قبض غير ملغاة (س125-128) · `paid_total` = Σ سندات صرف (س129-132) · `subs_total` = Σ عقد باطن (س133) · **`cost_total` = paid + max(0, subs − paid)** (س134) · **`profit_total` = collected − cost** و`margin%` من المحصّل (س139-148) — نفس منطق تقرير الربحية؛ UNIQUE يمنع عدّ العقد مرتين.
- `group_contracts` (س154-165): عقود المجموعة (رقم/اسم/نوع/حالة/مبلغ/عميل) بترتيب id.
- **الاستخدام في التقارير/الواجهة**: تُعرض كمجموعات في شاشة التقارير/العقود (وُصفت في spec-8-a)؛ جدول العقد يحمل اختيار مجموعة اختياريًا. لا تأثير مالي على أي عقد.

---

## 7) تهيئة الأنواع وسير العمل (Types Setup / Workflow)

### 7.1 الجداول (database.py)
```
contract_types (1739-1769): id, name UNIQUE, default_amount, notes, active(1), manual_track(0),
                            unit_label '', unit_price 0, pricing_mode '' (lump|unit|items), is_supervision(0)
type_bundle_components (1777-1793): id, type_name, comp_key, label, kind ('qty'|'supervision'|'items'),
                            required(0), default_enabled(1), default_qty(1), unit_label,
                            ref_price(0), default_months(0), default_monthly(0), sort_order,
                            UNIQUE(type_name, comp_key)   -- مكوّنات العقد الشامل (تعريف النوع)
contract_components (1794-1807): id, contract_id, comp_key, label, kind, enabled(1), qty(1),
                            months(0), monthly(0), UNIQUE(contract_id, comp_key)  -- لقطة العقد
workflow_stages (486-512): id, transaction_type, stage_name, stage_order, color '#3B82F6',
                            parent_id → self, expected_days(0), is_pre_contract(0),
                            contract_type '' (فارغ=قالب عام قديم — لكن add_stage يمنعه الآن),
                            payment_pct(0), pay_kind (''|achieve|advance|final|days),
                            is_supervision(0), sup_monthly(0), component_key '' (V3.30, 1810-1815),
                            UNIQUE(transaction_type, contract_type, stage_name)
type_payment_tpl (440-454): id, contract_type, pay_no, title, pct, amount_fixed(0),
                            stage_id → workflow_stages, trigger_stage_id → workflow_stages,
                            days_offset(0), UNIQUE(contract_type, pay_no) + link_keyword '' (2082-2087)
type_payment_stages (458-463): id, payment_id → type_payment_tpl, stage_id → workflow_stages,
                            UNIQUE(stage_id)   -- المرحلة الواحدة تتبع دفعة واحدة فقط
transaction_stage_log (514-526): id, transaction_type, transaction_id, stage_id, moved_by→users,
                            moved_at, note, start_date, end_date, is_skipped
contract_scope (1941-1948): contract_id + template_stage_id UNIQUE — نطاق العقد (مراحل القالب المختارة)
```
+ زرع نوع «غير محدد» لعقود بلا نوع (1870-1878) وتعطيل الأنواع الثابتة التجريبية غير المستخدمة (1879-1887) واشتقاق pricing_mode من unit_price (1888-1892). settings.stages_seeded علم الزرع الواحد (1385).

### 7.2 قواعد شجرة المراحل (workflow_service.py)
- **الزرع مرة واحدة في عمر القاعدة** `ensure_default_stages` (س230-252): مراحل سند الصرف (مطلوب/بانتظار اعتماد المدير/معتمد للصرف/تم الصرف) وباطن (جديد/بانتظار عرض السعر/تم التعاقد/جارٍ التنفيذ/مكتمل) س38-52، وشجرة تنفيذ افتراضية شجرية (س57-72: أعمال ما قبل التنفيذ→فحص التربة7/التصميم المعماري20/استخراج رخصة البناء30؛ أعمال التنفيذ→الأساسات30/الهيكل والأعمدة45/المباني والتشطيبات60؛ التسليم→ابتدائي7/نهائي14) وعميل محتمل («غير متعاقد» 30 يوم is_pre_contract=1 س76-79) — علم stages_seeded يمنع العودة بعد حذف المستخدم لها.
- `add_stage` (س1065-1130): الاسم إلزامي وفريد لكل (نوع معاملة، contract_type)؛ الأيام ≥0؛ النسبة 0-100؛ pay_kind ∈ PAY_KINDS وإن وُجد وجب 0<نسبة≤100؛ **مراحل العقد تُربط بنوع عقد إلزاميًا** («مراحل تنفيذ العقد تُربط بنوع عقد»)؛ الفرعية تحت رئيسية من نفس النوع فقط (والرئيسية بلا أب — س1100-1109)؛ stage_order = MAX+1.
- `update_stage` (س1133-1188): None = لا تغيير؛ `delete_stage` (س1223-1250): المرحلة الرئيسية ذات أبناء لا تُحذف إلا للمطوّر؛ **مرحلة مرّت بها معاملات لا تُحذف** («لا يمكن حذف هذه المرحلة لأن N معاملة مرّت بها» — stage_usage س1191+) ويُفكّ ربط payment_plan.stage_id قبل الحذف.
- `reorder_stages` (س1253-1260) · `restore_default_for_type` (س255-271): استعادة الافتراضية فقط لنوع بلا مراحل · `copy_contract_type_template` (س278-360): نسخ شجرة+دفعات من نوع لآخر **بلا حذف ولا خلط** (الهدف يجب أن يكون بلا مراحل وبلا دفعات).
- **قواعد ربط الدفعات بالمراحل** `_validate_payment_stages` (س2777-2805): (1) الربط بخطوات تنفيذ فعلية فقط — ممنوع الرئيسية التجميعية؛ (2) المرحلة الواحدة تتبع دفعة واحدة فقط (UNIQUE stage_id + فحص dup في `_set_payment_stages` س2808-2833 مع رسالة «مرحلة «X» مربوطة بالفعل بالدفعة رقم N»)؛ (3) المرحلة المُحفِّزة يجب أن تكون من مراحل الدفعة نفسها؛ (4) دفعة تجمع >1 مرحلة تتطلب تحديد المحفِّزة صراحةً؛ (5) بلا مراحل = دفعة بالأيام بلا مُحفِّز؛ (6) مُحفِّز بلا مراحل ممنوع.
- `add_type_payment` (س2927-2985): pay_no فريد لكل نوع («رقم الدفعة N مستخدم»)؛ **مرحلة واحدة = هي المُحفِّزة تلقائيًا** (س2949-2950)؛ amount_fixed>0 يصفّر pct (س2963-2964)؛ days_offset الافتراضي = الأيام التراكمية للمرحلة المحفزة (س2954-2959)؛ العنوان الافتراضي «الدفعة {ترتيب عربي}» (س42-55 في type_workflow.py وس2836-2865).
- `type_payments` (س2736-2774): القالب بترتيب pay_no مع مجموعة مراحل كل دفعة + `kind`: «إنجاز» لو لها trigger_stage_id وإلا «تاريخ يدوي».
- **لقطة القالب عند إنشاء العقد**: تعليق database.py:413-416 — «نسخة العقد من شجرة مراحل نوعه + إعداداتها المالية تُؤخذ Snapshot عند إنشاء العقد — فتعديل القالب لاحقًا لا يمس العقود القديمة أبدًا» (تفصيلها في spec-8-a).

### 7.3 التأسيس عبر Excel (types_setup_service.py)
- قالب رسمي بثلاث أوراق + «اقرأني أولاً» (س7-15، 42-45): أنواع العقود (نوع · طريقة التسعير · نشط · عقد إشراف · ملاحظات) / مراحل العقود (نوع · رئيسية · فرعية · ترتيب · مدة بالأيام · لون) / دفعات أنواع العقود (نوع · رقم · اسم · النوع نسبة/ثابت · نسبة · مبلغ ثابت · المرحلة المحفزة · أيام بعد المرحلة · كلمة ربط).
- **قاعدة الاستثناء**: `NO_STAGE_TOKEN = "بدون_مرحلة"` (س36) — دفعة بلا مرحلة محفزة تُكتب بها كلمة الربط وتُعد صحيحة (تُخزن في link_keyword مع «بدون_مرحلة» — س813-815).
- `read_template` (س357+): فحص شامل قبل التنفيذ (أسماء/تكرار/نسب/مراحل محفزة تنتمي لمراحل الدفعة…) — التنفيذ **مرفوض مع أي خطأ** (execute_template س648-649).
- `execute_template` (س638-830): **إضافة فقط — لا يحذف ولا يعدل الموجود**؛ الأنواع المكررة تُتخطى وتُحسب؛ المراحل: الرئيسيات أولًا ثم الفرعيات ثم **إعادة ترقيم stage_order ليطابق ترتيب القالب** (رئيسية ثم فرعياتها — س749-779)؛ الدفعات: رقم مستخدم = تخطٍ؛ كلمات الربط تُحفظ في link_keyword (س812-821)؛ نتيجة {types_added/skipped, stages_added/skipped, payments_added/skipped, payments_no_stage, problems[]}.
- **أداة «عقود غير محدد»** (س833-927+): تحليل قراءة فقط — مصادر الاقتراح: اسم العقد (SRC_NAME) / كلمة الربط من عناوين الدفعات وlink_keyword (SRC_LINK س859-887) / أوصاف سندات القبض (SRC_VOUCHER س894-908)؛ أفضل مطابقة أطول كلمة ≥3 أحرف بعد التطبيع (س911-925)؛ القرارات الثلاثة (س842-850): skip · type_only · type_stages (تحديث النوع + إعادة بناء مراحل العقد) — الكتابة حصرًا في `apply_fixes` بعد اختيار المستخدم الصريح، مع حراسة (عقد له حركة تنفيذ ⇒ لا إعادة بناء إتلافية — allow_destructive، س1214+).
- أزرار التبويب (settings.py:1992-2050): ⬇ تحميل القالب · رفع القالب · «تحديد نوع العقود القديمة» (fix_unspecified) · زر «ربط مراحل ودفعات هذا النوع» يفتح type_workflow.py.

### 7.4 الواجهة (type_workflow.py + settings تبويب سير العمل)
- type_workflow (نقطة الدخول الرئيسية للربط — س1-8): شجرة مراحل النوع للعرض + جدول قالب الدفعات (رقم · الاسم · القيمة نسبة/ثابت · المراحل المجمعة · المرحلة المُحفِّزة · الاستحقاق المقدّر بالأيام)؛ حوار الدفعة (س58+): رقم 1-99 · اسم · ☐ «دفعة كاملة / بدون ترتيب» (تُسجل باسم ثابت «دفعة كاملة» س85-87) · ☐ نسبة من قيمة العقد (0-100، دقة عشرية 1) أو ☐ مبلغ يدوي (3 كسور) · ☐ ربط الدفعة بمرحلة (اختيار مجموعة مراحل) مع تحديد **المرحلة المُحفِّزة** و☐ استحقاق يدوي/بالأيام؛ حفظ فوري برسالة تأكيد.
- تبويب سير العمل في الإعدادات (settings.py:2549-2668+): اختيار نوع المعاملة (عقد/سند صرف/باطن/عميل) + «قائمة الأشجار» (شجرة لكل نوع عقد) + «＋ شجرة جديدة / ربط نوع عقد» + ⬇ تحميل نموذج رفع شجرة Excel + رفع شجرة (استبدال شجرة النوع المحدد فقط)؛ جدول (#، المرحلة، الأيام المتوقعة، اللون، مرّت بها) بإجراءات: تعديل · تحريك أعلى/أسفل · حذف؛ إضافة: اسم + أيام + لون (رمادي محايد/كهرماني انتظار/أزرق جارٍ/بنفسجي خاص/أخضر مكتمل/أحمر متعثّر — س2645-2650) + ＋ إضافة رئيسية أو ＋ إضافة فرعية تحت المحدد.

---

## 8) سجل التدقيق (audit_log) — والسجلات الحقيقية المستخدمة

### 8.1 جدول audit_log (database.py:2159-2176) — **مُنشأ بلا كاتب ولا قارئ في V9.15.18**
```
id INTEGER PK, timestamp TEXT DEFAULT (datetime localtime), username TEXT DEFAULT '',
action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL,
entity_name TEXT DEFAULT '', old_status TEXT DEFAULT '', new_status TEXT DEFAULT '',
reason TEXT DEFAULT '', ip_address TEXT DEFAULT ''
-- فهارس: idx_audit_entity(entity_type, entity_id) · idx_audit_time(timestamp)
```
**تحقق شامل**: لا يوجد أي `INSERT INTO audit_log` ولا `SELECT FROM audit_log` في كل الشيفرة (بحث حرفي على كل الملفات). الجدول بنية مستقبلية (مخطط PostgreSQL القديم يذكره أيضًا بتصميم مختلف database_schema_postgresql.sql:678). ⇒ في النسخة الأونلاين يمكن اعتماد تصميمه كمصدر وحيد للتدقيق وتغذيته فعليًا.

### 8.2 السجلات الفعلية التي تُستخدم:
1. **purge_audit** (purge_service.py:39-51): كل عملية حذف (عميل/عقد/سند/مقاول…) تُسجل `purged_at, purged_by, entity, entity_id, label, reason, snapshot(JSON بكل الصفوف المحذوفة)` عبر `_log` (س68-74)؛ القارئ: شاشة «📜 سجل عمليات الحذف» في أداة التنظيف (purge_tool.py:430-489) — أعمدة (#/التاريخ/بواسطة/النوع/الوصف/السبب) + `audit_snapshot(id)` يعرض تفاصيل المحذوف بالكامل (س839-850)؛ متاح أيضًا من إدارة البيانات (data_management.py:540).
2. **cancel_audit_log** (unified_cancel_service.py:385-452): سجل الإلغاء/الاسترجاع/الأرشفة الموحد — `entity_type, entity_id, action('cancel'|'restore'|'archive'), reason, user_name, backup_id, reversed_amount/restored_amount, created_at`؛ قراءة: `get_cancel_history(entity_type, entity_id)` و`get_all_cancellations(limit=100)` (س458-497).
3. **contract_events** (lifecycle_service): السجل الزمني للعقد (إنشاء/اعتماد/ملحق/سند/إيقاف/إلغاء/تغيير حالة…) — يقرؤه السجل الزمني في ملف العميل (archive.py:544-578) و«النشاط» في الرئيسية (main_window.py:449).
4. أعمدة تدقيق الخلق/التعديل: `created_by/updated_by/updated_at` على customers وcontracts (database.py:1853-1869).
5. تدقيق التعليقات: edited_at/editor على customer_comments، وdelete_reason عند الحذف الناعم.

---

## 9) مفاتيح المزايا (feature_service.py) والتفضيلات (prefs_service.py)

### 9.1 البنية (feature_service.py)
- جدول `feature_flags(key TEXT PK, enabled INTEGER DEFAULT 1)` (س283-287)؛ سجل FEATURES (س21-272) يحدد لكل ميزة: name · desc · group · requires[] · default(True للجميع).
- **الأساسيات غير قابلة للتعطيل**: `CORE = ("customers","contracts","vouchers","settings")` (س275) — لا مفاتيح لها.
- **إجبارية التشغيل**: `FORCED_ON = {"followup", "rep_execution"}` (س278) — تعود True دائمًا مهما عُطّلت.
- `enabled(key)` (س314-334): قيمة المفتاح **مع كل سلسلة تبعياته** (تعطيل الأصل يعطّل التابع تلقائيًا)؛ مفتاح غير معروف ⇒ True؛ التعطيل **يخفي الواجهة ويوقف الأثر في الخلفية بلا مساس بالبيانات** (قاعدة 38 — س12-13).
- `raw_enabled` (لعرض شاشة المطور) · `dependents` (ما سيتعطل) · `set_enabled/set_many` · `grouped` (العرض بمجموعاتها) · `disabled_summary` (س396-402).
- شاشة الضبط: الإعدادات ← أدوات المطور ← تبويب «المزايا» (settings.py:1098).

### 9.2 قائمة المفاتيح (كلها default=True عدا ما ذُكر)
- **الشاشات**: subcontractors · statement · reports · **tasks (المهام والتنبيهات — لوحة الرئيسية وترحيل التنبيهات)** · projects · invoices · forms_center · word_forms (يتطلب forms_center) · **visits (جدول الزيارات اليومي)** · payment_gateway · custody.
- **داخل العقد**: addendums · payment_plan · boq_items · supervision · **comments (تعليقات العميل — لوحة ملف العميل)** · documents · contract_gaps · template_plan_mode (يتطلب payment_plan) · amount_guard · items_sync (يتطلب boq_items+payment_plan) · mode_banner.
- **أدوات**: **followup (المتابعة ومراحل التنفيذ — شجرة/شات/جرس إشعارات — إجباري ON)** · user_permissions · whatsapp (أزرار واتساب في السندات والمهام والزيارات) · full_backup · network_folder · import_old · notif_cleanup (يتطلب followup).
- **التقارير** (كل تقرير مفتاح مستقل، كلها تتطلب reports وبعضها supervision/subcontractors/cashflow): rep_execution (إجباري ON) · rep_customers · rep_supervision_delay · rep_subcontractors · rep_dues_board · rep_vouchers · rep_journal · rep_contracts · rep_cashflow · rep_leads.
- **المالية**: cashflow (يتطلب reports) · bank_fee (يتطلب cashflow) · settle_edit (يتطلب custody).
> المفاتيح القديمة المتجاهلة عمدًا (مدمجة في غيرها): rep_profitability، مفاتيح مستحقات العملاء/العقود القاربة/أنواع العقود (س134-137، 156-158، 260).

### 9.3 prefs_service.py (س1-30)
تفضيلات واجهة per-screen (آخر ترتيب/فلتر/حالة توسيع…) تُخزن JSON في عمود واحد `settings.ui_prefs TEXT DEFAULT '{}'` (س1377) — `get_pref(key, default)` / `set_pref(key, value)`؛ فشل الكتابة صامت. (لا يخص الأعمال — يخص تخطيط الواجهة فقط.)

---

## 10) ما يُنفَّذ في Next.js مباشرة من البيانات الحالية (بلا جداول جديدة)
1. **المهام**: جدول tasks موجود بالنموذج (نموذج Task) — الشاشة + لوحة الداشبورد + محرك التنبيه (بولينجات before/after علماً في السجل) + واتساب كقالب نصي منسوخ — كلها من نفس الأعمدة. مصدر «جدول الزيارات» يظهر تلقائيًا في source.
2. **الزيارات**: جدولا visits وvisit_staff موجودان + إعدادات الساعات الثلاثة على Settings — شبكة ساعات×موظفين تُبنى client-side من hour_slots، والترحيل كمهمة = إنشاء Task بـ task_type='موعد' وsource='جدول الزيارات' وtask_id في الزيارة. تصدير PDF أفق يمكن توليده من نفس البيانات.
3. **التعليقات**: جدول customer_comments موجود بكل أعمدة meta — فقاعات ملف العميل + مركز التعليقات بالفلاتر والحالات والأولويات والوسوم وdue_only — كلها استعلامات على الجدول الواحد (الترتيب pinned→priority→created_at).
4. **الإشعارات/المتابعة**: notifications + transaction_messages + stage_notes + transaction_visibility + dismissed_alerts — قاعدة «المشاركة = الرؤية» والـ push للمشتركين + المديرين قابلة للنقل حرفيًا (Server Actions/Route Handlers) — لا جداول إضافية.
5. **الأرشيف**: في الأصل مجلدات ملفات؛ في Next.js يكفي Supabase Storage ببكت لكل عميل `{customer_code}_{name}` + حفظ metadata (اسم/حجم/تاريخ) — لا حاجة لجدول أرشيف جديد إن اكتفت بقائمة الـ storage (أو جدول خفيف واحد للmetadata إن أريد البحث).
6. **البحث الشامل**: استعلامات SQL على الجداول الموجودة + تطبيع عربي مكتبة TS (نفس REPLACEMENTS) — العملة المشتركة: نتائج {type, type_label, icon, id, title, subtitle} وتوجيه فتح الهدف.
7. **مجموعات العقود**: جدولا contract_groups/contract_group_items موجودان — التحقق (عقدين+نفس العميل+لا ملغى) والترقيم GRP-%04d والملخص المالي (current/collected/paid/cost=paid+max(0,subs-paid)/profit/margin) يحسب قراءةً.
8. **تهيئة الأنواع**: contract_types + workflow_stages + type_payment_tpl + type_payment_stages + type_bundle_components + contract_components + contract_scope موجودة — قواعد add_stage/add_type_payment/_validate_payment_stages تُنقل حرفيًا؛ قالب Excel يمكن استبداله بـ CSV/جدول رفع بنفس الأوراق الثلاثة وقاعدة «بدون_مرحلة».
9. **audit_log**: الجدول تصميمه جاهز وغير مستخدم في الأصل — يُبنى في Next.js بكتابة فعلية من نقاط الحساسة (إلغاء/حذف/تغيير حالة) وقراءته شاشة مدير — أو الاكتفاء ببديلَي الأصل (purge_audit + cancel_audit_log) ثم توحيده.
10. **المزايا**: جدول feature_flags + قائمة FEATURES — تُنقل كما هي (client provider + حارس مسارات) مع CORE وFORCED_ON والتبعيات؛ prefs_service عمود ui_prefs واحد.

---

## 11) ملاحظات تنفيذية دقيقة (فروق يجب مراعاتها)
- نصوص الحالات **عربية مخزنة** في tasks («مفتوحة/منجزة») وcustomer_comments («مفتوح/تم/مؤجل/ملغى») — في النسخة الأونلاين اعتُمد الإنجليزية في حقول مطابقة للمطالبات؛ هنا يجب إما الحفاظ على العربية (للتوافق) أو تعريب طبقة عرض مع تخزين إنجليزي — قرار موثق مطلوب قبل التنفيذ (الأصل يخزن عربيًا).
- due_at نص `%Y-%m-%d %H:%M` — في Prisma نستخدم DateTime مع صيغة عرض موحدة «dd-MM-yyyy hh:mm AP» و«ص/م» عربية.
- `due_notifications` سيرفر-سايد في الأصل داخل عملية UI؛ أونلاين: cron أو عند فتح الرئيسية، مع أعلام notified_before/notified_after لضمان مرة واحدة.
- إشعارات المتابعة ترتبط بـ user_id — النسخة الأونلاين لها مستخدمون حقيقيون فيجب ربط User أصلاً.
- الأرشفة في المهام والنماذج ملفات — استبدالها برابط Storage يلغي الحاجة لمجلدات شبكة، مع الحفاظ على «مجلد الشبكة اليدوي» كحقل نصي في بطاقة العميل إن طُلب.
- تعطيل ميزة يخفي أزرارًا فقط (tasks/whatsapp/comments/visits) — لا يحذف بيانات؛ حارسات الواجهة في الأصل بعد الإضافة للأب (قاعدة 53 — بلا وميض).
