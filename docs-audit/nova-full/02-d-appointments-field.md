# Task 2-d: مراجعة الميدان والمواعيد — الرادار، الزيارات الميدانية، التنفيذ، المعدات

> مراجع: Task 2-d | المشروع: NOVA ERP (Next.js 15 + Firestore) المفكوك في `/home/z/review-nova`
> النطاق: جدول المواعيد والرادار (معماري/ميداني/قاعات)، الزيارات الميدانية، جانب التنفيذ (BOQ Execution)، المعدات والآليات.
> المنهجية: قراءة كاملة سطراً بسطر + تتبّع استدعاءات الخدمات (grep للتأكد من الموارد الميتة).

---

## 0. قائمة الملفات المُراجعة (26 ملفاً كاملاً + 9 داعمة)

| # | الملف | الأسطر | ملاحظة أولية |
|---|-------|--------|---------------|
| 1 | `src/types/appointment.ts` | 42 | 7 علاقات معرّفة هنا |
| 2 | `src/types/field-visit.ts` | 55 | الشبكة الرباعية `any[]` (فقدان نمطية) |
| 3 | `src/types/equipment.ts` | 69 | ~35 حقلاً، النموذج الفعلي يغطي ~8 |
| 4 | `src/types/work-hours.ts` | 67 | 4 جداول (general/arch/meetingRooms/field) |
| 5 | `src/services/appointment-service.ts` | 80 | `updateStatus` ميتة (P0-4) |
| 6 | `src/services/field-visit-service.ts` | 135 | WIP + قيد يومية |
| 7 | `src/services/equipment-service.ts` | 85 | حسابات أصل + مركز تكلفة |
| 8 | `src/services/boq-execution-service.ts` | 165 | Value Snap (مكسور نصفه) |
| 9 | `src/services/work-hours-engine.ts` | 173 | محرك الخانات سليم منطقياً |
| 10 | `src/services/work-hours-service.ts` | 99 | Defaults محصّنة (لا لوفر لا نهائي) |
| 11 | `src/services/client-service.ts` | 127 | **لا توجد `getNextFileNumber`** (P0-1) |
| 12 | `src/services/analytics-service.ts` (190–229) | جزئي | يستهلك `hourlyCostRef` الصفري |
| 13 | `src/app/dashboard/appointments/page.tsx` | 42 | غلاف + طباعة |
| 14 | `src/app/dashboard/appointments/new/page.tsx` | 26 | Redirect سليم للرادار المركزي |
| 15 | `src/app/dashboard/appointments/[id]/page.tsx` | 393 | تسجيل إنجاز وموارد |
| 16 | `src/components/appointments/architectural-appointments-view.tsx` | 1097 | الرادار المعماري الكامل |
| 17 | `src/app/dashboard/construction/page.tsx` | 25 | Redirect |
| 18 | `src/app/dashboard/construction/bookings/page.tsx` | 42 | غلاف رادار الميدان |
| 19 | `src/app/dashboard/construction/groups/page.tsx` | 127 | **زبر إنشاء الطواقم مكسور** (P0-7) |
| 20 | `src/app/dashboard/construction/field-visits/page.tsx` | 174 | أرشيف الزيارات |
| 21 | `src/app/dashboard/construction/field-visits/new/page.tsx` | 234 | **عاجزة عن الحفظ** (P0-5) |
| 22 | `src/app/dashboard/construction/field-visits/[id]/page.tsx` | 259 | عرض + اعتماد مالي |
| 23 | `src/components/construction/construction-bookings-view.tsx` | 403 | **لا يوجد Dialog** (P0-6) |
| 24 | `src/app/dashboard/equipment/page.tsx` | 144 | **انهيار CRASH** (P0-2) |
| 25 | `src/app/dashboard/equipment/new/page.tsx` | 53 | fire-and-forget |
| 26 | `src/app/dashboard/equipment/[id]/edit/page.tsx` | 68 | fire-and-forget |
| 27 | `src/components/equipment/equipment-form.tsx` | 148 | 8 حقول من أصل ~35 |
| داعم | `types/hr.ts`, `types/documents.ts`, `types/client.ts`, `types/transaction.ts`, `hooks/use-permissions.ts`, `firebase/multi-tenant.ts`, `components/meetings/meeting-rooms-view.tsx` (جانب القاعات), `app/dashboard/projects/reports/client-visits/page.tsx`, `lib/write-error.ts` | — | للتحقق من الحجب الثلاثي والمسارات |

---

## 1. خريطة علاقات الموعد والمنطق التسعة للرادار

### 1.1 العلاقات السباعية (نوع `Appointment` — `types/appointment.ts`)

| العلاقة | الحقول | من يكتبها | من يقرؤها | الحالة |
|---|---|---|---|---|
| 1. عميل | `clientId`, `clientName` | الرادار (`view:847-850`) أو عميل فوري | كل الشبكات + تقرير الزيارات | ✅ تعمل (إلا الفوري — P0-1) |
| 2. معاملة/مشروع | `transactionId`, `transactionNumber` | `view:853-854` بعد اختيار من `fetchClientTransactions` | صفحة `[id]` (سطر 65-76: stages + BOQ) | ✅ تعمل |
| 3. مرحلة | `stageId`, `stageName` | **لا أحد** — لا يوجد UI يكتبها إطلاقاً | لا أحد | ⚠️ حقل ميت |
| 4. قسم | `departmentId/Name/Color` | الرادار (`view:851-852`) | `checkEligibility` + بوابة الأقسام | ✅ يعمل؛ `departmentColor` لا تُكتب أبداً (ميتة) |
| 5. مهندس رئيسي | `engineerId`, `engineerName` | `view:855-856` (`targetEngineerId`) | بناء أعمدة الرادار | ✅ تعمل |
| 6. مهندسون إضافيون | `additionalEngineerIds/Names` | **لا يوجد UI** — يُقرأ فقط في فحص التعارض (`view:807`) | فحص التعارض | ⚠️ نصف علاقة (قراءة بلا كتابة) |
| 7. قاعة | `hallId`, `hallName` | لا يكتبها الرادار — تُكتب فقط في `meeting-rooms-view.tsx:639-642` (type=hall_meeting) | `meeting-rooms-view:330` (`a.hallId === room.id`) | ✅ معزولة في وحدة القاعات؛ الرادار يستبعدها (`view:253`) |

نموذج `busy_block`: `clientId='SYSTEM_BLOCK'` + `clientName` من الترجمة (`view:826-827`) — يلوّن برتقالياً `#f57c00` (`view:120`) ومتقطع الحدود (`view:132`).

### 1.2 المنطق التسعة للرادار المعماري (`architectural-appointments-view.tsx`)

1. **الخانات الزمنية**: `WorkHoursEngine.buildDaySlots(date, settings, 'architectural')` (`view:276`) → صباح/مساء مع `slotDurationMinutes + restDurationMinutes`. المحرك (`work-hours-engine.ts`) يعالج: عطلة أسبوعية/رسمية (`:66-72`) → رمضان أولوية عليا (`:113-129`) → نصف دوام (3 أنماط: morning_only/evening_only/custom cut-off `:134-152`) → دوام اعتيادي. **المحرك سليم** — `WorkHoursService.getSettings` تعيد defaults دائماً (`work-hours-service.ts:43-47`) فلا تعليق عند غياب الإعدادات.
2. **شبكة مهندسين × خانات**: أعمدة لكل مهندس معماري (فلترة بالاسم `includes('معماري')/('Arch')` على القسم والمسمى — `view:231-236`) — فلترة نصية هشّة (تسمية خاطئة = غياب عن الرادار، P2).
3. **حجب HR ثلاثي** (`getBlockedReason` `view:459-476`): إجازة معتمدة (نطاق تواريخ نصي `dateStr >= l.startDate`) + غياب (حضور بحالة absent لليوم) + استئذان (نافذة وقت ضمن الخانة). **خلل مؤكد**: مقارنة `p.userId !== engId` — `PermissionRequest.userId` هو UID مصادقة بينما `engId` هو `employeeId` (`types/hr.ts:92-95` تفصل الحقلين) → حجب الاستئذان لا يعمل أبداً (P1-3). نفس الخطأ مكرر حرفياً في `construction-bookings-view.tsx:320`.
4. **بوابة الأقسام `checkEligibility`** (`view:727-752`): تجلب `stageInstances` للمعاملة، تصفي مراحل القسم بـ `allowedDepartmentIds`، تأخذ أول مرحلة للقسم، وتحجب إن وُجدت مرحلة سابقة غير مكتملة (`previousIncomplete.name`). تُعرض كبطاقة "قيد تسلسلي (Locked)" (`view:1043-1055`) وتعطّل زر الحفظ (`view:1087`). ⚠️ الحجب client-side فقط (P2 أمن)، و`try/finally` بلا `catch` (`view:749`) — أي فشل استعلام = unhandled rejection.
5. **فحص التعارضات** (`view:791-813`): تداخل زمني `start < apptEnd && apptStart < end` على كل المواعيد (كل الأيام!)؛ تعارض عميل (نفس العميل متداخل) وتعارض مهندس (يشمل `additionalEngineerIds`). ملاحظة: الحلقة تفحص كل مواعيد النظام وليس يوم العرض فقط — أداء O(n) مقبول لكنها تفحص مواعيد القاعات أيضاً.
6. **عداد الزيارات وتلوينها**: `computeMeta` (`view:138-160`) يجمع مواعيد كل عميل عبر **كل التاريخ** مرتبة زمنياً، والترتيب = رقم الزيارة V1/V2/... التلوين في `getVisitColor` (`view:118-125`): أخضر مكتمل > برتقالي busy_block > أصفر `#facc15` زيارته الأولى > أخضر `#22c55e` تعدد زيارات (عميل غير متعاقد) > أزرق `#3b82f6` عميل متعاقد (`status==='contracted'`) > رمادي. الإحصاءات الأربع (`view:263-272`) تعتمد الألوان. ⚠️ `computeMeta` تُغذّى بـ `rawAppointments` **غير المفلترة** (`view:261`) — المواعيد الملغاة تُحتسب في تسلسل الزيارات (P2-2).
7. **إنشاء عميل فوري**: سويتش "عميل جديد" (`view:913`) → نموذج اسم/هاتف/محافظة → `handleSave` يستدعي `await clientService.getNextFileNumber()` (`view:830`) ثم `clientService.addClient(...)` — **`getNextFileNumber` غير موجودة في `ClientService`** (الموجود: `getProjectedNextNumber` و`addClient` التي تولّد الرقم داخلياً ذرياً `client-service.ts:33-84`) → `TypeError` → catch → toast خطأ → **إنشاء العميل الفوري من الرادار مكسور 100%** (P0-1). (واللافت: `addClient` أصلاً لا يقبل `fileNumber` ممرراً — الوسيط الثاني زائد.)
8. **حالة الموعد**: `createAppointment` يكتب `status:'scheduled'` دائماً؛ **`AppointmentService.updateStatus` (سطر 44) غير مستدعاة من أي مكان في المشروع** (تحقق grep: الاستدعاءات الوحيدة لـ `updateStatus` في recruitment) → لا إكمال ولا إلغاء من الرادار؛ عدّاد الزيارات في `updateStatus` (`appointment-service.ts:54-66` زد `client.visitCount` عند إكمال site_visit) **كود ميت**، و`visitCount` أصلاً ليس في سكيما `Client` (`types/client.ts`). الإكمال الوحيد المتاح هو مواعيد القاعات عبر `updateDoc` مباشر في `meeting-rooms-view.tsx:621`.
9. **التنقل والطباعة**: كارت الموعد → `/dashboard/appointments/[id]` (`view:563`)؛ `/appointments/new` redirect للرادار؛ `window.print()` مع طباعة محسّنة.

### 1.3 رادار الميدان (`construction-bookings-view.tsx`)
نسخة مبسّطة: نفس المحرك بنطاق `'fieldWork'`، فلترة مهندسين بكلمات ('موقع'، 'تنفيذ'، 'مقاولات') (`:156-161`)، نفس الحجب الثلاثي (بخطأ `p.userId` نفسه `:320`)، بطاقات بسيطة بلا قائمة حذف/تعديل. **لكن**: `handleAction` يضبط `dialogOpen=true` (`:208-211`) بينما **لا يوجد أي `<Dialog>` مرسوم في الملف** — النقر على خانة فارغة لا يفتح شيئاً (P0-6). عميل/معاملة/تعارضات غير متاحة أصلاً هنا.

---

## 2. دورة الزيارة الميدانية والتنفيذ

### 2.1 المسار المعتمد (Data Flow)
```
موعد (appointments/{id}) ──> [id]/page.tsx "تسجيل إنجاز وموارد"
   ├─ مراحل: stageInstances (orderBy order) → اختيار stage
   ├─ بنود: boqs(where transactionId)[0] → boqItems (فلترة technicalStageId)
   ├─ الموارد: عمالة GROUP_/EMP_/SUB_ + معدات (equipment)
   └─ BOQExecutionService.recordBOQItemExecution (لكل بند، batch مستقل!)
        ├─ executions/{id}: quantity + laborDetails + equipmentUsed (Value Snap)
        ├─ boqItems.executedQuantity += q
        ├─ stageInstances.currentCount += q
        └─ transactions/{id}/timeline: numeric_update

زيارة ميدانية (field-visits/new) ──> FieldVisitService.submitFieldLog
   ├─ fieldVisits/{id}: status='submitted', isVerified=false
   └─ boqItems.executedQuantity += q (دُفعة واحدة مع المستند)

اعتماد (field-visits/[id]) ──> approveFieldVisitForBilling
   ├─ totalLaborCost = Σ count×(hours||8)×hourlyCostRef   ← دائماً 0 (P0-3)
   ├─ totalEquipCost = Σ (count||1)×(hours||8)×hourlyRateRef
   ├─ fieldVisits: status='approved_for_billing', totalAllocatedCost
   └─ إذا التكلفة>0: WIP(1205 فرعي) مدينة / مستحقات(2204) دائنة + مراكز تكلفة cc_/pc_
```

### 2.2 الشبكة الرباعية للموارد
| المحور | الواجهة (appointments/[id]) | الواجهة (field-visits/new) | القراءة في الخدمات |
|---|---|---|---|
| عمالة GROUP_/EMP_/SUB_ | جدول مع Select مركب ومنع تكرار (`[id]:287-346`) — **بلا حقول ساعات أو تكلفة** (hours=8 ثابتة، hourlyCostRef=0) | **لا يوجد UI إطلاقاً** (`staffRows:102` ميتة) | `field-visit-service:74-76`, `boq-execution-service:63-70` |
| معدات | صفوف معدات مع HRS وسحب السعر المرجعي `equip?.hourlyRentalRate \|\| hourlyDepreciationRate` (`[id]:357-363`) — **الاسم `x.name` غير موجود في النوع** → قوائم فارغة (P1-4) | لا يوجد UI (`equipRows:103` ميتة) | `field-visit-service:79-81` |
| مواد | غائب | غائب (`materialsDelivered` لا تُكتب أبداً رغم وجودها في النوع `field-visit.ts:48`) | لا أحد يقرأها |
| توثيق مصور | غائب (`Camera` مستورد بلا استخدام) | غائب (`photoUrls` في `WorkItemLog` دائماً `[]`) | — |

### 2.3 Value Snap (hourlyCostRef) — التقييم المالي
- **المعدات**: الـ Snap يعمل جزئياً (`[id]:362` يجمّد سعر الساعة وقت التنفيذ) لكن لا يفرّق مملوكة/مستأجرة إلا بالترتيب، وعرض الاسم مكسور.
- **العمالة**: `hourlyCostRef` لا يُضبط في `updateLaborRow` (`[id]:120-136`) ولا يوجد حقل إدخال — يبقى 0 من التهيئة (`[id]:138-139`) → `totalCost = count × hours × 0` (`boq-execution-service:69`) → تحليل ربحية الموظف `generatedValue = hours × 0` (`analytics-service:215`) → اعتماد الزيارة المالي يحسب عمالة بصفر (`field-visit-service:75`) فقيد WIP يخرج بالمعدات فقط أو لا يخرج أصلاً (`:97 if totalVisitCost > 0`). **سلسلة تكلفة العمالة ميتة بالكامل (P0-3 مالي).**
- **بوابة الإكمال**: `getTechnicalStageProgress` (`boq-execution-service:140-163`) محسوبة و`canComplete` جاهزة لكن **لا أحد يستدعيها**؛ البارامتر `force` (سطر 46) يُمرر دائماً `false` ولا يُستخدم داخلياً → يمكن تنفيذ كميات فوق المخطط بلا حد (P1-6).

### 2.4 دورة حياة الزيارة
`submitFieldLog` → status=`submitted` → `approveFieldVisitForBilling` → status=`approved_for_billing` (غير معرّف في `FieldVisitStatus` — `types/field-visit.ts:4` يقول `draft|submitted|approved|verified`) → لا يوجد مسار رفض ولا `verified` → `isVerified=true` تُكتب. شارة القائمة تلوّن `'approved'` فقط (`field-visits/page.tsx:153-155`) فالحالة `approved_for_billing` تظهر زرقاء كالجديدة.

---

## 3. جدول الأعطال بالسطر (P0 / P1 / P2)

### P0 — عطل وظيفي/مالي كامل

| ID | الملف:السطر | الاقتباس | الأثر |
|---|---|---|---|
| P0-1 | `components/appointments/architectural-appointments-view.tsx:830` + `services/client-service.ts` (غياب) | `const nextFileNum = await clientService.getNextFileNumber();` | `getNextFileNumber` غير موجودة في `ClientService` (الموجود `getProjectedNextNumber`) → TypeError → إنشاء العميل الفوري من الرادار يفشل دائماً (toast خطأ عام). |
| P0-2 | `app/dashboard/equipment/page.tsx:40-41` | `e.name.toLowerCase().includes(...)` | النوع `Equipment` لا يحوي `name` (فقط `nameAr/nameEn` — `types/equipment.ts:21-22`) → `undefined.toLowerCase()` → **انهيار صفحة سجل المعدات بالكامل** (وأيضاً `:108 {item.name}` عرض فارغ). نفس الخطأ في `appointments/[id]:361,362,370` (`equip?.name`, `x.name`). |
| P0-3 | `app/dashboard/appointments/[id]/page.tsx:138-139,120-136` + `services/boq-execution-service.ts:69` + `services/field-visit-service.ts:75` | `hourlyCostRef: 0` (تهيئة، لا إدخال) / `totalCost: ... * (Number(l.hourlyCostRef) \|\| 0)` | تكلفة العمالة = صفر في كل السلسلة: التنفيذ، تحليل ربحية الموارد (`analytics-service:215`)، وترحيل WIP عند الاعتماد → قيود يومية ناقصة/ملغاة (`:97 if totalVisitCost > 0`). |
| P0-4 | `services/appointment-service.ts:44-69` | `async updateStatus(appointmentId, status, userId)` | **غير مستدعاة من أي مكان** (تحقق grep شامل) → لا يمكن إكمال/إلغاء أي موعد من الرادار؛ عدّاد `visitCount` للعميل (`:61 increment(1)`) كود ميت؛ فرع الألوان `completed` في الرادار (`view:119`) عملياً لا يُصل إليه إلا عبر القاعات. |
| P0-5 | `app/dashboard/construction/field-visits/new/page.tsx:156,102-103,141-153` | `if (!db \|\| ... !formData.activeStageId) return;` | **لا يوجد UI لاختيار المرحلة** (`activeStageId` يُصفّر فقط ولا يُضبط من أي حقل) → الحفظ يرجع صامتاً؛ وبنود BOQ لا تُحمّل (`:141` يشترط activeStageId)؛ كذلك `staffRows/equipRows` بلا UI → **صفحة الزيارة الميدانية الجديدة عاجزة عن أي توثيق**. |
| P0-6 | `components/construction/construction-bookings-view.tsx:208-211,393` | `setDialogData({...}); setDialogOpen(true);` / `onClick={() => onAction('create', eng, slot)}` | لا يوجد مكوّن Dialog في الملف (imports ميتة `ClientService/AppointmentService/Switch/Select`) → **إنشاء حجز ميداني من رادار الميدان لا يفتح نموذجاً ولا يفعل شيئاً**. |
| P0-7 | `app/dashboard/construction/groups/page.tsx:67,35` | `onClick={() => setIsAddOpen(true)}` | `isAddOpen` لا يرتبط بأي Dialog مرسوم (كل مكونات النموذج مستوردة وميتة: Dialog/Select/Checkbox/addDoc/toast) → **إنشاء طواقم العمل مستحيل من الواجهة**، فيتعطل مصدر `GROUP_` في الشبكة الرباعية. |

### P1 — خلل جوهري (بيانات/مال/أمن)

| ID | الملف:السطر | الاقتباس | الأثر |
|---|---|---|---|
| P1-1 | `components/appointments/architectural-appointments-view.tsx:860` | `status: 'scheduled' as AppointmentStatus,` | `savePayload` ثابت؛ **تعديل أي موعد يعيد حالته إلى scheduled** ويصفّر أي إكمال (فلو أُنجز عبر مسار آخر). |
| P1-2 | `view:467` + `construction-bookings-view.tsx:320` | `if (p.userId !== engId) return false;` | حجب الاستئذان يقارن UID مصادقة بمعرّف موظف → لا يحجب أبداً (الإجازة والغياب يعملان). مكرر في الرادارين. |
| P1-3 | `view:580` | `{appt.governorateName?.slice(0, 10)}` | `governorateName` ليست في نوع `Appointment` ولا تُكتب في `savePayload` → موقع الزيارة لا يظهر أبداً في الرادار. |
| P1-4 | `app/dashboard/appointments/[id]/page.tsx:150-159` | `for (const item of loggedItems) { await service.recordBOQItemExecution(...) }` | كل بند = batch/commit منفصل غير ذري → فشل منتصف الحلقة = حفظ جزئي (كميات نصف مسجلة) دون rollback. |
| P1-5 | `field-visits/new/page.tsx:160` | `engineerId: user.uid` | الزيارة تسجّل UID المصادقة كـ `engineerId` بينما الرادار والمواعيد تستخدم `employeeId` → انفصال الهوية يكسر أي ربط لاحق (تقارير لكل مهندس). |
| P1-6 | `services/boq-execution-service.ts:140-163,46` | `getTechnicalStageProgress` / `force: boolean = false` | بوابة الإكمال والحد الأعلى للكمية غير مستخدمين → تنفيذ فوق المخطط بلا حاجز ولا إنذار. |
| P1-7 | `services/field-visit-service.ts:89` | `status: 'approved_for_billing'` | قيمة حالة غير معرّفة في `FieldVisitStatus` (`types/field-visit.ts:4`) → انحراف نمطي؛ شارة القائمة تلوّن خاطئاً (`field-visits/page.tsx:153`). |
| P1-8 | `app/dashboard/equipment/new/page.tsx:29-31` | `equipmentService.createEquipment(formData, user.uid); toast(...); router.push(...)` | fire-and-forget بلا `await`: toast نجاح وتحويل قبل اكتمال الإنشاء؛ فشل إنشاء الحساب الأصلي (1101)/مركز التكلفة داخل `createEquipment` يمرّ صامتاً (`equipment-service.ts:38-61`). نفس النمط في `[id]/edit:41-44` (و`updateEquipment` أصلاً void). |
| P1-9 | أمن الرادار: `view:602,1077` + `GridSection` (`:454`) | `onClick={() => onDelete(appt.id)}` | قائمة الحذف تُعرض لكل المستخدمين — خاصية `isAdmin` تُمرر إلى `GridSection` لكن **لا تُفحص في القائمة المنسدلة**، و`deleteAppointment` حذف نهائي بلا تدقيق (audit) ولا soft-delete ولا قيد صلاحيات خدمي. |
| P1-10 | أمن الاعتماد المالي: `field-visits/[id]:38,45-57` | `const canApproveBilling = isAdmin \|\| check('accounting','approve').can;` | بوابة الاعتماد المالي (WIP/قيد يومية) client-side فقط؛ `approveFieldVisitForBilling` و`submitFieldLog` بلا تحقق صلاحيات في الخدمة → تجاوز كامل من أي عميل مباشر. |
| P1-11 | `field-visits/new/page.tsx:130` | `(allClients \|\| []).filter(...)` | قائمة العملاء كاملة للجميع بلا عزل معلوماتي (عكس رادار المعماريين الذي يفلتر `assignedEngineerId` `view:672-682`) → تسريب قاعدة عملاء لغير المسؤول. |

### P2 — جودة/بيانات/تزيين

| ID | الملف:السطر | الاقتباس | الملاحظة |
|---|---|---|---|
| P2-1 | `view:504` | `src={`https://picsum.photos/seed/${eng.id}/40/40`}` | **بيانات مزيفة**: صور عشوائية من picsum تُعرض كصور مهندسين (رادار الميدان يستخدم Fallback فقط — الصواب). |
| P2-2 | `view:261` | `computeMeta(rawAppointments, clientsMap)` | عدّاد V يحتسب المواعيد الملغاة (لا فلترة status) → أرقام زيارات مضخّمة. |
| P2-3 | `services/appointment-service.ts:61` | `visitCount: increment(1)` | يكتب حقلاً `visitCount` على العميل غير موجود في سكيما `types/client.ts` ولا يقرؤه أحد (الرادار يحسب بنفسه) — بيانات ميتة. |
| P2-4 | `view:1061-1064` | `<Label>{t('appointments.dialog.notes')}</Label><Input value={formData.title} .../>` | تسمية "ملاحظات" على حقل العنوان؛ `formData.notes` لا يُحرر من أي حقل → الملاحظات لا تُحفظ أبداً. |
| P2-5 | `view:651` | `endTime: ''` | حقل وقت النهاية بلا UI؛ يُقرأ من الموعد فقط عند التعديل. |
| P2-6 | `view:749` | `} finally { setEligibilityLoading(false); }` | `checkEligibility` بلا `catch` — فشل الاستعلام = unhandled rejection. |
| P2-7 | `appointments/[id]:212` | `<CommentSection transactionId={appt.transactionId \|\| apptId} path={paths.transactionComments(companyId!, ...)}>` | تعليقات الموعد بلا معاملة تُخزن تحت مسار `transactions/{appointmentId}` — خلط كيانات، و`companyId!` قد ينفجر إن غاب. |
| P2-8 | `services/boq-execution-service.ts:30` | `private permissions: string[] = []` | بارامتر الصلاحيات مُستقبل ثم غير مستخدم. |
| P2-9 | `components/equipment/equipment-form.tsx:42-45,111-127` | `{ code: '', nameAr: '', ... , ...initialData }` | النموذج يغطي ~8 حقول من ~35 في النوع (تأمين/تسجيل/تشاسي/إهلاك/تمويل/ضمان مفقودة)؛ القيم الرقمية تُخزن **strings** (`e.target.value`)؛ بلا تحقق إلزامي أو وحدانية `code`. |
| P2-10 | `field-visits/new/page.tsx:155-164` | `try { ... } finally { setLoading(false); }` | حفظ الزيارة بلا `catch` — فشل `MISSING_CONTEXT` أو batch = rejection صامت. |
| P2-11 | `construction-bookings-view.tsx:265` | `t('appointments.activeHalls').replace('Halls', 'Staff')` | إحصاءة "قاعات نشطة" تعرض عدّ المهندسين عبر replace نصّي هش. |
| P2-12 | `view:776` | `if (!data \|\| isSelectedDateHoliday \|\| eligibilityBlocker) return;` | حفظ يوم عطلة يرجع صامتاً بلا رسالة (زر معطّل فقط). |
| P2-13 | `view:231-236` / `:659-665` | `e.departmentName?.includes('معماري') \|\| ...` | عضوية المعماريين/الميدان تُحدد بـ includes نصية على الاسم/المسمى — هشّة أمام أي تسمية جديدة. |
| P2-14 | `types/field-visit.ts:45-48` | `staffDetails: any[]; laborDetails: any[]; ...` | الشبكة الرباعية بلا أنماط (any) — فقاعة أنماط تسمح بالبيانات المشوّهة (نفس الشيء في خدمات التنفيذ `resources?: { laborDetails: any[]... }`). |
| P2-15 | `field-visits/[id]:248` | `visit.createdAt?.toDate().toLocaleString()` | انفجار إذا كان `createdAt` Date عادياً (كتابة محلية) وليس Timestamp. |
| P2-16 | `types/appointment.ts:38` | `visitCount?: number;` | حقل على الموعد لا يكتبه أحد (العدّاد محسوب لحظياً) — حقل ميت مثل `stageId/stageName/departmentColor/location`. |

---

## 4. ما يستحق النقل إلى ConTrack (consulting/radar + EngineerAppointment) وما لا

> المقصود: الهدف في ConTrack رادار الاستشارات مع `EngineerAppointment`. هذا ما يجب ترحيله من نموذج NOVA وما يجب إسقاطه.

### ✅ يستحق النقل (بعد إصلاح الجذوع المذكورة)
1. **محرك الخانات `work-hours-engine.ts` كاملاً** (173 سطراً) — نظيف، نقي (pure functions)، يفهم رمضان/نصف الدوام/الراحة بين المواعيد/العطل الرسمية. أنسب مكان: `contrack/lib/schedule/` مع جدول إعدادات واحد (لا حاجة للـ 4 scopes إلا لاحقاً).
2. **منطق الحجب الثلاثي (إجازة/غياب/استئذان)** كمفهوم — لكن بعد توحيد المعرّف على `employeeId` (إصلاح P1-2) وإدخاله في ConTrack على مستوى الـ API وليس الواجهة.
3. **بوابة الأقسام/التسلسل `checkEligibility`** كقاعدة server-side على مراحل العقد (تُطابق فلسفة stage-gates الموجودة في ConTrack) — تُنقل كدالة تحقق في API لا كاستعلام من المتصفح.
4. **فحص التعارضات** (تداخل زمني + تعارض مهندس يشمل الإضافيين + تعارض عميل) — يُنقل إلى endpoint الإنشاء لضمان منع التضارب تحت التزامن (التحقق الحالي client-only قابل للتخطي).
5. **عدّاد الزيارات وتلوينها (V1 أصفر → متابعة أخضر → متعاقد أزرق → busy برتقالي → مكتمل زمردي)** — منطق `getVisitColor` بسيط وقابل للنقل مباشرة، مع قراءة العدّاد من مصدر واحد (تسلسل فعلي غير شامل الملغاة — إصلاح P2-2).
6. **نموذج `busy_block`** (حجز خانة بلا عميل `SYSTEM_BLOCK`) — مفيد جداً لرادار ConTrack ويُنقل كما هو مع لون مميز.
7. **Value Snap للمعدات** (تجميد سعر الساعة المرجعي لحظة التنفيذ `[id]:362`) — الفكرة سليمة وتُنقل مع ربط `hourlyRate` بسجل المعدة في ConTrack.
8. **قيد WIP عند الاعتماد المالي** (`field-visit-service:66-135`) — النمط (مدين WIP فرعي/دائن مستحقات + مراكز تكلفة cc_/pc_ لكل مشروع) يطابق بنية القيود في ConTrack ويُنقل منطقياً بعد إصلاح تكلفة العمالة.

### ❌ لا يستحق النقل (يُبنى من جديد أو يُسقط)
1. **`getNextFileNumber`/إنشاء العميل الفوري بنسخته الحالية** — إما يُعاد استخدام `addClient` الذرية وحدها أو يُبنى على بوابة ConTrack؛ نقل الكود الحالي = نقل عطل P0-1.
2. **فلترة المعماريين/الميدان بنصّ includes** (`view:231-236`, `bookings-view:156-161`) — في ConTrack تُستبدل بوسم صريح `departmentCode/team` على الموظف.
3. **`fields` ميتة في `Appointment`**: `stageId/stageName/departmentColor/visitCount/location/endTime` — تُسقط من مخطط ConTrack (YAGNI مؤكد بالميدان).
4. **قسم القاعات (hallId/hall_meeting)** — خارج نطاق ConTrack الاستشاري؛ يبقى ملك NOVA/meetings.
5. **حقل `hourlyCostRef` كإدخال يدوي** — في ConTrack يُسحب تلقائياً من كشف تكلفة الموظف/المعدة وقت الحفظ (سnap من مصدر واحد) بدل الاعتماد على مصفوفات `any[]` من الواجهة.
6. **الشبكة الرباعية بصيغة `any[]`** — تُنقل الفكرة فقط مع أنماط صارمة (LaborLine/EquipmentLine/MaterialLine) وإدخال مواد وتوثيق مصور (كلاهما غائب في NOVA).
7. **صفحات المعدات بنسختها الحالية** — انهيار العرض (P0-2) ونموذج 8/35 حقلاً؛ تُعاد بناء قائمة+نموذج في ConTrack بكامل الحقول المالية (إهلاك/تمويل/تأمين) التي عالجها النوع الأصلي جيداً.
8. **عزل الحجب client-side وصلاحيات الاعتماد على الواجهة** (P1-9/10) — لا يُنقل نمط "تعطيل زر = حماية".

### خلاصة القرار
- **ينقل كما هو تقريباً**: work-hours-engine، getVisitColor/computeMeta (بعد استبعاد الملغاة)، busy_block، فكرة Value Snap.
- **ينقل بعد إعادة تصميم**: الحجب الثلاثي (employeeId + server)، بوابة التسلسل (server-side)، فحص التعارضات (server)، دورة الزيارة (بشاشة تعمل فعلاً وإدخال موارد كامل)، WIP posting.
- **يُسقط**: حقول الميتة، فلترة النصوص، صفحات المعدات/الطواقم/الزيارة الحالية، عدّادات العميل الميتة.

---

## 5. أولويات الإصلاح المقترحة (لو استمر العمل على NOVA)
1. P0-2: استبدال `e.name` بـ `(e.nameAr || e.nameEn)` في 3 مواضع (قائمة المعدات + مختار المعدات في تسجيل الإنجاز).
2. P0-1: حذف استدعاء `getNextFileNumber` — `addClient` يولّد الرقم داخلياً.
3. P0-3: إضافة عمودي ساعات/تكلفة لعمالة الرادار أو سحب `hourlyCostRef` تلقائياً من كشف التكلفة عند اختيار المورد.
4. P0-4: توصيل `updateStatus` (زر إكمال/إلغاء في الرادار أو عند حفظ إنجاز الموعد).
5. P0-5/6/7: إكمال الشاشات الميتة الثلاث (اختيار مرحلة + موارد في الزيارة، Dialog رادار الميدان، Dialog الطواقم).
6. P1-1: عدم تمرير `status` في payload التعديل؛ P1-2: `p.employeeId ?? p.userId`.
