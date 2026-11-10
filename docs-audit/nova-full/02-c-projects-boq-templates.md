# Task 2-c: مراجعة المشاريع + BOQ + نظام التغييريات VO + الشجرة المرجعية + القوالب الأربعة
**المشروع:** NOVA ERP (Next.js 15 + Firebase Firestore) — مفكوك في `/home/z/review-nova`
**المدقق:** Task 2-c — مراجعة سطراً بسطر
**التاريخ:** مراجعة كود ثابتة (Static Review)

---

## 0. نطاق المراجعة (27 ملفاً مباشراً + 7 ملفات مساندة)

| # | المسار | الحالة |
|---|--------|--------|
| 1 | `src/app/dashboard/projects/page.tsx` (180 سطر) | ✔ مراجع كامل |
| 2 | `src/app/dashboard/projects/[projectId]/page.tsx` (53 سطر) | ✔ مراجع كامل |
| 3 | `src/app/dashboard/projects/boqs/page.tsx` (129 سطر) | ✔ مراجع كامل |
| 4 | `src/app/dashboard/projects/reports/client-visits/page.tsx` (372 سطر) | ✔ مراجع كامل |
| 5 | `src/app/dashboard/settings/templates/page.tsx` (114 سطر) | ✔ مراجع كامل |
| 6 | `src/app/dashboard/settings/templates/boq/page.tsx` (224 سطر) | ✔ مراجع كامل |
| 7 | `src/app/dashboard/settings/templates/boq/boq-template-form.tsx` (522 سطر) | ✔ مراجع كامل |
| 8 | `src/app/dashboard/settings/templates/contracts/page.tsx` (271 سطر) | ✔ مراجع كامل |
| 9 | `src/app/dashboard/settings/templates/contracts/contract-template-form.tsx` (349 سطر) | ✔ مراجع كامل |
| 10 | `src/app/dashboard/settings/templates/quotations/page.tsx` (186 سطر) | ✔ مراجع كامل |
| 11 | `src/app/dashboard/settings/templates/quotations/quotation-template-form.tsx` (471 سطر) | ✔ مراجع كامل |
| 12 | `src/app/dashboard/settings/templates/subcon-contracts/page.tsx` (217 سطر) | ✔ مراجع كامل |
| 13 | `src/app/dashboard/settings/templates/subcon-contracts/subcon-contract-form.tsx` (433 سطر) | ✔ مراجع كامل |
| 14 | `src/components/settings/checklists/boq-master/boq-master-selector.tsx` (5 أسطر) | ⚠ ملف محذوف (Stub) |
| 15 | `src/components/settings/checklists/boq-reference/boq-reference-selector.tsx` (217 سطر) | ✔ مراجع كامل |
| 16 | `src/app/dashboard/settings/checklists/boq-master/page.tsx` (5 أسطر) | ⚠ ملف محذوف (Stub) |
| 17 | `src/app/dashboard/settings/checklists/boq-nodes/page.tsx` (706 أسطر) | ✔ مراجع كامل |
| 18 | `src/services/project-service.ts` (60 سطر) | ✔ مراجع كامل |
| 19 | `src/services/boq-execution-service.ts` (164 سطر) | ✔ مراجع كامل |
| 20 | `src/services/boq-inventory-link-service.ts` (67 سطر) | ✔ مراجع كامل |
| 21 | `src/services/boq-reference-service.ts` (171 سطر) | ✔ مراجع كامل |
| 22 | `src/services/boq-master-service.ts` (5 أسطر) | ⚠ ملف محذوف (Stub) |
| 23 | `src/services/template-service.ts` (169 سطر) | ✔ مراجع كامل |
| 24 | `src/services/variation-service.ts` (251 سطر) | ✔ مراجع كامل |
| 25 | `src/lib/boq-tree-utils.ts` (133 سطر) | ✔ مراجع كامل |
| 26 | `src/types/project.ts` (39 سطر) | ✔ مراجع كامل |
| 27 | `src/types/templates.ts` (145 سطر) | ✔ مراجع كامل |
| مساندة | `types/documents.ts`، `types/reference.ts`، `firebase/multi-tenant.ts`، `components/transactions/vo-manager-dialog.tsx`، `services/document-service.ts`، `services/transaction-service.ts`، `lib/counters.ts`، صفحة تنفيذ المعاملة `[tId]/page.tsx`، صفحة الموعد `[id]/page.tsx` | ✔ للتدقيق العرضي |

**ملاحظة مهمة:** الملفات المحذوفة (14، 16، 22) هي Stubs تعلن `export {}` — لا يوجد أي استيراد معلّق لها (تم التحقق بـ grep) — لكنها دليل هجرة غير مكتملة التنظيف.

---

## 1. بنية الشجرة المرجعية الكاملة (boqReferenceNodes)

### 1.1 المجموعة والمسار
- مسار Firestore: `companies/{companyId}/boqReferenceNodes` (via `paths.boqReferenceNodes`, `multi-tenant.ts:48`).
- الاستعلام القياسي: `orderBy('depth')` أو `orderBy('order')` ثم بناء الشجرة برمجياً في العميل (لا يوجد `parent` query مباشر).

### 1.2 حقول العقدة (`types/reference.ts` → `BOQReferenceNode`)
| الحقل | الغرض | ملاحظات المراجعة |
|-------|------|------------------|
| `code` | كود مرجعي هرمي `BOQ.01.02` | يُولّد آلياً في `boq-reference-service.ts:73-79` |
| `title` / `description` | اسم ومواصفة البند | description = المواصفة الفنية القياسية |
| `parentId` / `ancestorIds` | الربط الأبوي + سلسلة الأسلاف كاملة | الأساس لبناء الشجرة في العرض |
| `depth` | عمق العقدة | `= parent.depth + 1` (سطر 54) |
| `childrenCount` | عدّاد مُلغى (denormalized) | يُحدّث بـ `increment(±1)` (سطرا 104-107، 163-166) |
| `nodeRole` | `'group' \| 'work_item'` | افتراضي من `isExecutable` (سطر 92) |
| `isExecutable` | بند تنفيذي أم مجموعة | يتحكم بظهور زر "إضافة" في المنتقي |
| `isActive` | إتاحة الاستخدام | |
| `activityTypeId/Name`, `serviceId/Name`, `subServiceId/Name` | السياق الفني (النشاط→الخدمة→المسار) | **يُورَّث من الأب** إذا `inheritServices !== false` (سطرا 58-67) |
| `inheritServices` | مفتاح الوراثة | يُستخدم أيضاً في `resolveNodeEffectiveServices` |
| `unitTypeId/Name/Symbol` | وحدة القياس | إلزامي للبند التنفيذي (boq-nodes:204-207) |
| `technicalStageId` | المرحلة الافتراضية (رئيسية) | |
| `technicalStageIds[]` | **قائمة المراحل الميدانية المسموح فيها بالتنفيذ** | "قاعدة الظهور الميداني" — بدون ربط لا يرى المهندس البند |
| `estimatedRate` | سعر الوحدة المرجعي KWD | |
| `billingTriggerGroup`, `allowedItemCategoryIds` | مفاتيح فوترة وتصنيف | مُخزّنة لكن غير مستهلكة في هذا النطاق |
| `allowedServiceIds/Names`, `allowedActivityTypeIds/Names` | تعريف صريح للخدمات/الأنشطة | يوقف الوراثة عند وجوده (boq-tree-utils:91) |

### 1.3 محرك الوراثة (Effective Resolver) — `boq-tree-utils.ts:83-133`
```
resolveNodeEffectiveServices(nodeId):
  1) إن وجد allowedServiceIds مباشرة → استخدمه وأوقف الوراثة (isInherited=false)
  2) وإلا إن inheritServices !== false && parentId → اصعد للأب عودياً (isInherited=true)
  3) وإلا → فارغ
resolveNodeEffectiveActivities(): نفس المنطق بـ allowedActivityTypeIds
```
- ⚠ الدالة عودية عبر `allNodes.find()` → **O(n) لكل مستوى = O(n²) للشجرة الكاملة** (سطر 87).
- ⚠ لا يوجد كشف دورات (cycle) — شجرة تالفة (أب يشير لسليله) = Stack Overflow.

### 1.4 دورة حياة العقدة — `boq-reference-service.ts`
- **إنشاء (سطرا 38-120):** التحقق الصلاحي `ref:create` → جلب الأب → `depth` و`ancestorIds` و`parentCode` → وراثة السياق الفني → توليد كود `[parentCode].[NN]` من `siblingsSnap.size + 1` → batch (set العقدة + increment عدّاد الأب) → errorEmitter عند فشل الصلاحيات.
- **تحديث (سطرا 122-144):** `ref:edit` → **يحذف `parentId/ancestorIds/depth` من الحمولة** (سطرا 132-134) لحماية بنية الشجرة ✔ — لكنه يسمح بتعديل السياق الفني دون مزامنة الأبناء.
- **حذف (سطرا 146-170):** `ref:delete` → يمنع الحذف إذا `childrenCount > 0` (سطر 154) → batch (delete + decrement الأب).
  - ⚠ الاعتماد على `childrenCount` المُلغى: انزياح العدّاد = حذف عقدة لها أبناء فعلياً → شجرة يتيمة.
  - ⚠ لا يتحقق هل العقدة مستخدمة في قوالب BOQ/مقايسات رغم أن رسالة تأكيد الحذف في `boq-nodes/page.tsx:696` تعد بأنه "سيتم إزالة البند وكافة ارتباطاته" — **الوعد غير منفذ برمجياً**.

### 1.5 تدفق الشجرة → القوالب → المقايسة → التنفيذ
```
boqReferenceNodes (القاموس)
   │  (Import Registry Items — boq-template-form.tsx:139-178 addFromMaster)
   ▼
boqTemplates/{id}/items  ← BOQTemplateItem: ينسخ code/title/unit/technicalStageIds/ancestorIds
   │  (document-service.instantiateBoqFromTemplate:139-183 — نسخة كاملة + executedQuantity:0, billedQuantity:0)
   ▼
boqs/{id} (header: boqNumber, status, totalAmount) + boqs/{id}/items (BOQItem — العدادات الستة)
   │  (boq-execution-service.recordBOQItemExecution:37-138)
   ▼
executions (سجل تنفيذ + موارد) + increment(executedQuantity) + increment(stageInstance.currentCount) + timeline
```

### 1.6 منسق القاموس — `boq-nodes/page.tsx`
- بناء شجرة برمجي (سطرا 162-171) + بحث + توسيع/طي.
- سياق موروث معروض للقراءة فقط عندما `parentId` موجود (سطرا 418-438) — ممتاز مفاهيمياً.
- **ربط المراحل المتعدد** (سطرا 474-616): اختيار `technicalStageIds[]` من مراحل المسار الفني + تعيين "المرحلة الافتراضية" (primary) — إلزامي للبند التنفيذي (سطرا 212-215).
- تحقق قبل الحفظ: وحدة قياس + سياق كامل + مرحلة واحدة على الأقل (سطرا 203-216) ✔.

---

## 2. منطق العدادات (العدادات الستة + عدادات المراحل)

### 2.1 العدادات الستة على `BOQItem` (`types/documents.ts:67-91`)
| العدّاد | الغرض التصميمي | الواقع في الكود | الحكم |
|---------|----------------|------------------|-------|
| `contractQty` | كمية العقد الأصلية | **لا يُكتب أبداً** — `instantiateBoqFromTemplate` ينسخ بيانات القالب التي لا تحتويه (document-service:167-179) | 🔴 ميّت |
| `plannedQuantity` | الكمية المخططة | تُنسخ من القالب وتُعدّل يدوياً في وضع draft؛ **VO يعدّلها مباشرة** بدل `approvedVariationQty` | 🟠 مستهلك بشكل خاطئ |
| `approvedVariationQty` | كميات الأوامر التغييرية المعتمدة | **لا يوجد أي increment له في الكود كله** (grep شامل) | 🔴 ميّت |
| `executedQuantity` | المنفذ ميدانياً | الوحيد الحي — `increment` في recordBOQItemExecution (boq-execution-service:112) | 🟢 حي |
| `verifiedQuantity` | المعتمد بالتحقق | لا يوجد أي مسار تحقق (workflow) في الكود | 🔴 ميّت |
| `billedQuantity` | المفوتر | يُهيّأ 0 عند الإنشاء فقط (document-service:176)؛ الفوترة الفعلية تُحسب من IPCs في العميل (`[tId]/boq/page.tsx:74-83`) — **مصدرا حقيقة مزدوجان** | 🔴 ميّت/متناقض |

**الخلاصة: 4 من 6 عدادات ميّتة.** نموذج IPC المصمم في `InterimPaymentCertificate` (types/documents.ts:133-152 — `contractQty/approvedVariationQty/previousCumulativeQty/currentQty`) غير متصل بالعدادات نهائياً.

### 2.2 `recordBOQItemExecution` — `boq-execution-service.ts:37-138`
1. ينشئ وثيقة تنفيذ في `executions` بحالة `'executed'` ثابتة (سطر 92).
2. **محرك القيمة المضافة (Cost Snapping)** (سطرا 60-80): يجمد `hourlyCostRef/hourlyRateRef` وقت التنفيذ ويحسب `totalCost = count × hours × rate` — تصميم جيد لتحليل الربحية ✔.
3. batch: set التنفيذ + `increment(executedQuantity)` على البند + `increment(currentCount)` على StageInstance + timeline `numeric_update`.
4. ⚠ **الباب المفتوح الكبير:** المعامل `force: boolean = false` (سطر 46) **غير مستخدم إطلاقاً** — لا يوجد أي فحص `executed + quantity <= planned` داخل الخدمة. الحماية الوحيدة موجودة في واجهة واحدة فقط:
   - `clients/[id]/transactions/[tId]/page.tsx:186-191` (فحص UI + رسالة "أنشئ أمراً تغييرياً").
   - `appointments/[id]/page.tsx:150-158` — يمرر `force=false` لكن **بدأ أي فحص تجاوز** → تسجيل إنجاز من شاشة الزيارة يتجاوز المخطط بصمت.
5. ⚠ الخدمة تعمل من العميل ('use client') والصلاحيات تجميلية — الحماية الفعلية كله على قواعد أمان Firestore (غير موجودة في هذا النطاق).
6. ⚠ سطر 106: `itemData.clientId || (itemData as any).clientId` — سطر مكرر بلا معنى.

### 2.3 عدادات المراحل
- `initializeTechnicalPath` (transaction-service:156-176) يهيّئ `currentCount: 0` و`revisionCount: 0` لكل StageInstance.
- `recordBOQItemExecution` يزيد `currentCount` بكمية BOQ (سطرا 116-120) — **خلط دلالي**: العدّاد "عدّاد" يُستخدم كـ"كمية".
- `completeStage` (transaction-service:148-154) **يغلق المرحلة دون أي فحص** لـ `currentCount` أو `numericTarget` أو ربطها بإنجاز البنود.
- `getTechnicalStageProgress` (boq-execution-service:140-163) — دالة بوابة الإغلاق (`canComplete`) — **لا يوجد أي مستدعي لها في الكود كله** (grep) → البوابة ميّتة.
- سطر 144: `boqsSnap.docs[0].id` — يأخذ أول مقايسة اعتباطياً لو تعددت مقايسات المعاملة.
- سطر 150: لا بنود مرتبطة → `progressPercent: 100, canComplete: true` — دلالة "اكتمال تلقائي".

### 2.4 حساب التقدم في الواجهات
- `[tId]/page.tsx:214-229 getStageConstructionProgress`: يجمع planned/executed لكل بنود المرحلة → نسبة `Math.min(100, ...)` — القص عند 100 **يخفي التجاوز** بدل إظهاره.
- `[tId]/boq/page.tsx:144-145`: `currentToBill = Math.max(0, executed - previousBilled)` + `totalPct = Math.min(100,...)` — نفس النمط.
- `projects/page.tsx`: العدادات الثلاثة في الرأس (محفظة 2.4M / 12 نشط / 88% انضباط) وعمود "42%" و"15,400 KWD" **أرقام مكتوبة يدوياً (Fake)** — لا علاقة لها بالبيانات (سطرا 92، 99، 106، 151، 156).

---

## 3. نظام الأوامر التغييرية VO

### 3.1 الأنواع الأربعة (vo-manager-dialog.tsx:227-230)
| النوع | التأثير المالي في الحوار | التأثير الفعلي في الخدمة عند الاعتماد |
|-------|--------------------------|------------------------------------------|
| `increase_quantity` | total = q×r (+) | `planned += delta` ✔ صحيح |
| `decrease_quantity` | total = q×r (−) | `planned += delta` ❌ **يزيد بدل أن يخفض!** |
| `omit_item` | total = q×r (−) | `planned += delta` ❌ **يزيد بدل الحذف/الخفض!** |
| `new_item` | total = q×r (+) | بند جديد + `plannedQuantity = abs(delta)` ✔ |

**الجذر (P0):** الحوار يخزّن `quantityDelta` **موجباً دائماً** (`Math.abs` — vo-manager-dialog.tsx:126) ويضع الإشارة فقط في حقل `total` المالي، بينما الخدمة `applyQuantityChangeToBOQ` (variation-service.ts:217) تجمع `quantityDelta` كما هو **دون ضرب المُعاكس** → كل أمر خفض/حذف معتمد **يرفع** الكمية المخططة ويترك المال في رأس VO سالباً → تناقض صارخ بين الميزانية والبنود.

### 3.2 أنماط ربط التنفيذ `VOStageMode` (vo-manager-dialog.tsx:288-293)
- `existing_stage`: اختيار مرحلة قائمة من stageInstances (القيمة = `s.technicalStageId`).
- `new_local_stage`: **حقن مرحلة يدوية** — `injectNewManualStage` (variation-service.ts:163-191):
  - ينشئ StageInstance برمز `VO_INJ_XXXXXX`، `isTemporary: true`، `isComplementary`.
  - `order = afterStage.order + 1` وإزاحة كل ما بعده +1 (سطرا 184-188).
  - fallback: `order = currentStages.length` عند غياب `insertAfterStageId`.
  - ⚠ `currentCount` لا يُهيّأ عند الحقن (يُنشأ فقط لاحقاً بـ increment) — يعمل لكنه غير متناسق مع initializeTechnicalPath.

### 3.3 إعادة فتح المراحل — `reopenRequiredStages` (variation-service.ts:229-241)
- يجمع `stagesToReopen` من: بند جديد بمرحلة مرتبطة (سطر 143) + تغيير كمية جعل `newPlanned > executed` (سطرا 223-225).
- يعيد الحالة `completed → in-progress` ويمسح `completedAt/completedBy` ✔ — **لكن** لا يعيد فتح المراحل الأبوية التابعة ولا يعالج حالة `newPlanned < executed` (تجاوز يبقى معلقاً).

### 3.4 دورة حياة VO وتسلسلها الحقيقي
- `createVariation` (سطرا 45-109): تحقق "مهندس مسؤول أو صلاحية projects:edit" → header حالة `'draft'` + بنود في مجموعة فرعية. ⚠ لا يتحقق أن `boqId` يعود فعلاً لنفس `transactionId` ولا من حالة المقايسة.
- `approveVariation` (سطرا 111-161): فحص `status === 'draft'` (قراءة خارج الـ batch — **TOCTOU/سباق اعتماد مزدوج**) → حقن المراحل → تطبيق البنود → إعادة الفتح → تحديث الحالة → timeline.
- **🔴 عيب اتساق:** `addDoc` للـ timeline (سطرا 152-158) **خارج الـ batch وقبل commit** — لو فشل الـ batch يبقى سجل "تم اعتماد الأمر التغييري" مزيفاً دون أي تغيير فعلي.
- **🔴 عيب مالي:** الاعتماد **لا يحدّث `boqs.totalAmount` ولا `approvedVariationQty`** — رأس المقايسة يبقى بقيمة ما قبل التغيير.
- `rejectVariation` (سطرا 243-250): **لا فحص حالة** → يمكن "إلغاء" أمر معتمد أصلاً (status → 'cancelled').
- `getIsAssignedEngineer` (سطرا 34-43): يقرأ `global_users` **بمسار مكتوب يدوياً** بدل `paths.globalUser` (multi-tenant.ts:6)، ويقارن `assignedEngineerId` بـ `employeeId` — إذا كان `employeeId` غير موجود → false → يمر عبر الصلاحية فقط.

### 3.5 🔴 الزر الميت (الاكتشاف الأهم في ملف VO)
1. `VOManagerDialog` **غير مستورد في أي ملف بالمشروع** (grep: التعريف فقط، vo-manager-dialog.tsx:52) — الحوار الوحيد لإنشاء VO شашة ميتة.
2. `approveVariation` و`rejectVariation` **لا يوجد لهما أي مستدعي** — لا شاشة عرض للأوامر التغييرية ولا أزرار اعتماد/رفض.
3. صفحة مقايسة المعاملة `[tId]/boq/page.tsx` (293 سطراً) **لا تحتوي أي زر VO** — فقط تأكيد الميزانية وطباعة.
4. **النتيجة:** نظام VO كامل الأركان (4 أنواع + حقن مراحل + إعادة فتح) موجود برمجياً وميّت وظيفياً من الواجهة — VOs لا يمكن إنشاؤها أصلاً، ولو أُنشئت يدوياً في القاعدة ستبقى `'draft'` للأبد.

---

## 4. القوالب الأربعة (Templates)

### 4.1 الخدمة الموحدة — `template-service.ts`
- `getCollectionPath` يربط الأنواع الأربعة: `quotation/contract/subcon_contract/boq` (سطرا 34-41).
- `saveBOQTemplateWithItems` (سطرا 60-126): صلاحية `ref:edit` → حساب `itemsCount/sectionsCount` في الرأس → حذف كل البنود القديمة وإعادة كتابتها (سطرا 94-97) → batch واحد.
  - ⚠ حذف/إعادة كتابة كاملة = معرفات بنود جديدة كل حفظ + حجم batch قد يتجاوز 500 عملية في القوالب الكبيرة (Firestore limit).
  - ⚠ `sectionsCount = Set(ancestorIds).size` (سطر 70) — يعدّ كل مستويات التجميع "أقساماً" بما فيها الأقسام المتداخلة.
  - ⚠ استخدام `ref:edit` لإنشاء القوالب أيضاً — دلالة صلاحية غير دقيقة (لا يوجد `templates:create`).
- `deleteTemplate` (سطرا 137-143): `ref:delete` → حذف الرأس **فقط** — بنود المجموعة الفرعية تبقى يتيمة في Firestore (وثائق يتيمة دائمة).

### 4.2 قالب BOQ (`boq-template-form.tsx`)
- بناء القالب من القاموس فقط (لا بنود حرة) — `addFromMaster` يمنع التكرار بـ `boqReferenceNodeId` (سطرا 140-143) ✔.
- `isMathValid`: `|Σ(qty×rate) − baseAmount| < 0.01` (سطر 112) — **مؤشر بصري فقط**، الحفظ يمر حتى مع عدم التوازن.
- `handleSave`: `technicalStageId = technicalStageIds[0]` fallback (سطر 124) ✔.
- شجرة العرض `renderBOQTreeRows` (سطرا 246-322) — تحديث البنود عبر `originalIdx = findIndex(boqReferenceNodeId)` — يفشل لو تكرر المعرف.
- ⚠ `plannedQuantity` بلا `min={0}` ولا فحص سالب؛ `estimatedRate` كذلك.

### 4.3 قالب العقد (Contract) — نطاقان من نفس الصفحة (`?scope=CONSULTING|CONSTRUCTION`)
- تابات تلقائية من خدمات النشاط (contracts/page.tsx:138-149) ✔ تصميم جيد.
- `retentionRate`: افتراضي 5%، **يُصفّر آلياً للنشاط الاستشاري** (form:116-129) — لكن نفس الـ effect يعيد ضبط 5% إذا اختار المستخدم 0 يدوياً في المقاولات → **حرب مع إدخال المستخدم**.
- `pricingMode`: percentage (نسب من الإجمالي) / fixed (مبالغ مقطوعة) — الحفظ يحسب `finalAmount` (سطر 164) ✔.
- مراحل الدفعات: قيمة افتراضية وهمية `'SIGNING'` مخلوطة بمعرفات مراحل حقيقية (form:307) — تُخزّن كما هي → مطابقة لاحقة فاشلة.
- **عيب ترجمة أخطاء:** `handleSave` (سطرا 161-170) `try/finally` **بدون catch** → أي فشل Firestore = استدعاء مرفوض غير معالج ولا toast (نفس العيب في subcon form:142-155 وboq-nodes handleSave:219-241).
- ⚠ `ContractTemplate.clauses: string[]` حقل إلزامي في النوع ولا يُحرَّر في النموذج إطلاقاً.

### 4.4 قالب عرض السعر (Quotation)
- ثلاثة أنماط تسعير: `percentage/fixed/itemized` (form:330-337) — الأغنى بين القوالب.
- مزامنة تلقائية للمبالغ عند تغيير الميزانية (سطرا 118-130) بمقارنة `JSON.stringify` — يعمل لكنه عشوائي الترتيب.
- 🔴 عيب حسابي: `totalItemizedAmount = unitPrice × (quantity || 1)` (سطر 135) — **كمية 0 تُحسب 1** → إجمالي خاطئ في وضع itemized.
- 🔴 عيب متسع: قيمة `technicalStageId` الافتراضية `'SIGNING'` (سطر 391) — نفس مشكلة العقد.
- ربط اختياري بقالب BOQ (`boqTemplateId`) مع تنبيه فوترة (سطرا 283-301) ✔.

### 4.5 قالب عقد الباطن (SubCon)
- حقل `trade` حر (نص مجاني، سطر 238-239) — **لا قائمة تخصصات معيارية** → حرية كتابة تسبب تناثراً ("حدادة"/"الحدادة"/"Steel").
- نفس محرك الدفعات والنسب + `retentionRate` مع نص تفسيري (سطرا 278-285، 413-418).
- ⚠ سطر 368: `value={s.technicalStageId || s.id}` — `TechnicalStage` لا يملك `technicalStageId` → يعمل بالـ fallback لكنه مأخذ من نسخة أخرى من الكود دون تكييف.
- **لا يوجد ربط بقالب BOQ** (عكس العقد والعرض) — مقصود أم نقص؟ غير موثق.

### 4.6 بوابة القوالب (`templates/page.tsx`)
- 5 بطاقات: عروض/استشارات/مقاولات/باطن/BOQ — توجيه سليم، البطاقة "primary" بمقياس متضخم — تحسين شكلي فقط.

---

## 5. جدول الأعطال (P0 / P1 / P2) مع السطر والاقتباس

### 🔴 P0 — عطل حرج

| # | الملف:السطر | الاقتباس | الوصف والأثر |
|---|-------------|----------|---------------|
| P0-1 | `services/variation-service.ts:18` + `components/transactions/vo-manager-dialog.tsx:34` | `import { BOQVariation, BOQVariationItem, BOQ, VOStageMode } from '@/types/documents';` | **أنواع غير موجودة إطلاقاً** — `types/documents.ts` لا يعرف `BOQVariation`/`BOQVariationItem`/`VOStageMode` (grep شامل = صفر تعريفات). المشروع لا يترجم أصلاناً (`strict: true` → TS2305). أدلة النظام كاذبة. |
| P0-2 | `types/documents.ts:154-158` | `export interface BOQ extends BaseDocument { boqNumber: string; name: string; measurementMode: MeasurementMode; }` | نوع BOQ مجرد من الحقول المستخدمة فعلياً (`totalAmount`, `status`, `clientName`, `transactionId`, `clientId`, `activityTypeId`...) المستهلكة في boqs/page.tsx:105 و[tId]/boq/page.tsx:61 وdocument-service:160 — نفس عائلة العطل P0-1. |
| P0-3 | `variation-service.ts:217` | `const newPlanned = Math.max(0, (current.plannedQuantity || 0) + (Number(vItem.quantityDelta) || 0));` | **أوامر الخفض/الحذف تزيد الكمية** — الواجهة تخزن دلتا موجبة (`Math.abs` في vo-manager-dialog.tsx:126) والخدمة لا تعكس الإشارة حسب النوع → `decrease_quantity`/`omit_item` يرفعان plannedQuantity. عطل مالي جوهري في جوهر نظام VO. |
| P0-4 | `variation-service.ts:52` (VOManagerDialog) + `:111, :243` (الخدمات) | `export function VOManagerDialog(...)` / `async approveVariation(...)` / `async rejectVariation(...)` | **الزر الميت — نظام VO شبه معطّل طرفياً:** الحوار غير مستورد في أي مكان، والاعتماد/الرفض بلا أي مستدعي. لا توجد شاشة قائمة VOs. النظام بأكمله غير قابل للوصول من الواجهة. |
| P0-5 | `services/boq-execution-service.ts:46` | `force: boolean = false,` | **معامل `force` ميت + غياب حارس تجاوز الكمية على مستوى الخدمة:** لا فحص `executed+qty <= planned` داخل `recordBOQItemExecution`. الحارس موجود في واجهة واحدة فقط (`[tId]/page.tsx:188`) وغائب كلياً في مسار الزيارات (`appointments/[id]/page.tsx:150-158`) → تجاوز المخطط ممكن من شاشة الزيارة. |

### 🟠 P1 — عطل وظيفي/بياناتي عالي الخطورة

| # | الملف:السطر | الاقتباس | الوصف والأثر |
|---|-------------|----------|---------------|
| P1-1 | `variation-service.ts:152-160` | `await addDoc(timelineRef, {... 'تم اعتماد الأمر التغييري' ...}); ... await batch.commit();` | timeline **خارج الـ batch وقبل commit** → فشل الاعتماد يسجل رسالة نجاح كاذبة (تسلسل زمني غير موثوق). |
| P1-2 | `variation-service.ts:120 + 160` | `if (!voSnap.exists() || voSnap.data().status !== 'draft')` ... `await batch.commit()` | فحص الحالة بقراءة خارج معاملة → **سباق اعتماد مزدوج** (TOCTOU): اعتمادان متزامنان = حقن مراحل مزدوج وتطبيق كميات مزدوج. |
| P1-3 | `variation-service.ts:111-161` | (غياب أي تحديث لـ `boqs/{boqId}.totalAmount` أو `approvedVariationQty`) | اعتماد VO لا يحدّث رأس المقايسة ولا عدّاد الكميات المعتمدة → نموذج العدادات الستة/IPC مقطوع الربط (راجع §2.1). |
| P1-4 | `variation-service.ts:243-250` | `async rejectVariation(...) { ... await updateDoc(voRef, { status: 'cancelled', ...}); }` | **لا فحص حالة** → أمر معتمد ('approved') يمكن "رفضه/إلغاؤه" وبنوده ومراحله المحقونة تبقى سارية. |
| P1-5 | `variation-service.ts:39` | `const userSnap = await getDoc(doc(this.db, 'global_users', userId));` | مسار مكتوب يدوياً خارج طبقة `paths` (الموجود: `paths.globalUser`) — خرق نمط تعدد المستأجرين، وربما قواعد أمان مختلفة. |
| P1-6 | `services/project-service.ts:29-43 + page.tsx:36-53` | `orderBy('createdAt','desc')` + فلترة `activityTypeName?.includes('مقاولات')` | تعريف "مشروع" = نص حر داخل اسم النشاط (عربي/إنجليزي hardcoded) → مشاريع مقاولات ستفلت من الفلتر بأي صياغة أخرى. |
| P1-7 | `projects/page.tsx:92,99,106,151,156` | `<h3 ...>2.4M ...` / `>12<` / `>88%<` / `PROGRESS} 42%` / `>15,400 <` | **بيانات مزيفة مثبتة في الكود** — عدادات المحفظة والتقدم والفوترة كلها أرقام ثابتة لا تنبع من Firestore. تضليل إداري كامل. |
| P1-8 | `services/boq-inventory-link-service.ts:42` | `collection(this.db, 'purchase_orders_items'), // افتراض وجود مجموعة مسطحة` | استعلام على مجموعة **غير موجودة/غير موثقة** (والتعليق يعترف) → تحليل الانحراف يعيد دائماً 0 = "shortage" كاذبة. الخدمة بلا أي مستدعي أيضاً (grep). |
| P1-9 | `services/boq-execution-service.ts:116-120` + `transaction-service.ts:148-154` | `currentCount: increment(...)` مقابل `completeStage: updateDoc(status:'completed')` | عدّاد المرحلة يُغذّى بكميات BOQ ويُقاس بلا هدف: الإغلاق لا يفحص شيئاً، وبوابة `getTechnicalStageProgress` (سطر 140) بلا مستدعي — الحكم اليدوي فقط. |
| P1-10 | `services/document-service.ts:167-179` (سند) | `batch.set(itemRef, { ...d.data(), executedQuantity: 0, billedQuantity: 0 })` | تفكيك القالب لا يضبط `contractQty` من `plannedQuantity` ولا `verifiedQuantity` → عمودان من الستة يولدان فارغين للأبد. |
| P1-11 | `boqs/page.tsx:32-36` + `[tId]/boq/page.tsx:58-61` | `query(collection(db, paths.boqs(companyId)))` ثم فلترة بالعميل | جلب **كل** مقايسات الشركة لعرض/إيجاد واحدة — تكلفة قراءات تتفاقم خطياً (لا `where('transactionId')` في الصفحة الثانية رغم إمكانية index). |
| P1-12 | `projects/reports/client-visits/page.tsx:107-128` | `await Promise.all(merged.map(async item => { ...getDocs... getDocs... }))` | N+1: لكل سجل زيارة استعلامان (timeline + comments) — تقرير عميل بعشرات الزيارات = عشرات القراءات المتزامنة (فواتير + انهيار محتمل). |
| P1-13 | `projects/reports/client-visits/page.tsx:276` | `onClick={() => window.open(indexError.split(': ')[1], '_blank')}` | فتح URL مستخرج من **رسالة خطأ السيرفر** بنمط نصي هش — متجه هجوم (Open Redirect) وسيناريو فشل مع أي تغيير في صيغة الرسالة. |
| P1-14 | `contract-template-form.tsx:161-170` (+ subcon:142-155، boq-nodes:219-241) | `try { ... } finally { setLoading(false); }` | `try/finally` **بدون catch** → أخطاء Firestore تُبتلع بصمت دون toast ويبقى المستخدم ظانّاً أن الحفظ فشل فقط بالجمود. |
| P1-15 | `settings/templates/boq/page.tsx:62` (+ contracts:84، quotations:63، subcon:64) | `toast({ title: t('deleted') })` مقابل `t('common.deleted')` | مفاتيح i18n غير متسقة بين صفحات القوالب (`t('deleted')`/`t('search')`/`t('save')` مقابل `common.*`) — نصوص خام أو فارغة في الواجهة. |

### 🟡 P2 — جودة/أداء/توثيق

| # | الملف:السطر | الاقتباس | الوصف |
|---|-------------|----------|-------|
| P2-1 | `boq-tree-utils.ts:31` | `order: 0, // سيتم ترتيبه لاحقاً` | عقد التجميع تُنشأ بترتيب 0 دائماً والتعليق وعد غير منفذ → ترتيب الأقسام في عرض القالب يعتمد على ترتيب مصفوفة البنود لا على `order` الحقيقي. |
| P2-2 | `boq-tree-utils.ts:87-101` | `const node = allNodes.find(n => n.id === nodeId); ... resolveNodeEffectiveServices(node.parentId, ...)` | O(n²) بلا فهرسة ولا كشف دورات (أب=سليل → تجاوز مكدس). |
| P2-3 | `boq-reference-service.ts:74-79` | `const nextIndex = siblingsSnap.size + 1; data.code = `${parentCode}.${...}`` | توليد الكود من `size` → حذف الأخ الأوسط يعيد توليد نفس الكود لاحقاً (تكرار أكواد)، ولا فحص تفرد للمُدخل يدوياً. |
| P2-4 | `boq-reference-service.ts:154` | `if (node.childrenCount > 0) throw ...` | الحذف محمي بعدّاد مُلغى قابل للانزياح — لا إعادة فحص استعلامية ولا منع حذف عقدة مستخدمة في قوالب. |
| P2-5 | `template-service.ts:94-97,137-143` | `oldItemsSnap.docs.forEach(d => batch.delete(d.ref))` / `return deleteDoc(docRef)` | إعادة كتابة البنود بمعرفات جديدة كل حفظ + حذف الرأس دون بنوده المجمّعة → وثائق يتيمة دائمة + احتمال تجاوز حد 500 عملية بالـ batch. |
| P2-6 | `boq-execution-service.ts:144` | `const boqId = boqsSnap.docs[0].id;` | أخذ أول مقايسة اعتباطياً عند تعددها — لا فرز ولا اختيار صريح. |
| P2-7 | `boq-execution-service.ts:106` | `executionData.clientId = itemData.clientId || (itemData as any).clientId || '';` | تعبير مكرر بلا فائدة (نفس الحقل مرتين). |
| P2-8 | `[tId]/boq/page.tsx:144-145` + `[tId]/page.tsx:227` | `Math.max(0, totalExecuted - previousBilled)` / `Math.min(100, ...)` | قصّ النسب عند 100 وإخفاء السالب — **إخفاء نشط للتجاوزات** بدل إنذارها. |
| P2-9 | `client-visits/page.tsx:95,102` | `d.data().start.split('T')[0]` / `displayDate: d.data().visitDate` | انهيار (`split` على undefined) لو حقل `start` مفقود؛ وفرز `localeCompare` على تواريخ قد تكون غير متجانسة. |
| P2-10 | `client-visits/page.tsx:203-206` | `<img src={url} alt="Site" .../>` | `<img>` خام بروابط Firestore/Storage دون `next/image` ولا تحقق نطاق. |
| P2-11 | `projects/[projectId]/page.tsx:24-42` | `const snap = await getDoc(transRef);` | بلا try/catch: فشل صلاحية/شبكة = دوّامة تحميل أبداً؛ ولا فحص صلاحية قبل القراءة. |
| P2-12 | `contract-template-form.tsx:307` + `quotation-template-form.tsx:391` | `value={m.technicalStageId || 'SIGNING'}` | معرف شبه-ثابت `'SIGNING'` يُخزن كمرحلة فنية حقيقية — يجب أن يكون `contractualEvent` منفصلاً كما يوحي النوع (types/templates.ts:68). |
| P2-13 | `contract-template-form.tsx:124-126` | `else if (!isConsulting && formData.retentionRate === 0) setFormData(... 5)` | القسر الآلي يلغي إدخال 0% يدوياً للمقاولات — تعارض مع المستخدم. |
| P2-14 | `quotation-template-form.tsx:135` | `(Number(item.unitPrice) || 0) * (Number(item.quantity) || 1)` | كمية 0 تُحسب 1 في إجمالي itemized (مذكور في P0 عائلة VO لكنه هنا مستقل بالعرض). |
| P2-15 | `subcon-contract-form.tsx:238-239` | `<Input value={formData.trade || ''} ...>` | التخصص نص حر — لا قائمة معيارية → بيانات غير قابلة للتجميع/التحليل. |
| P2-16 | `subcon-contract-form.tsx:368` | `value={s.technicalStageId || s.id}` | حقل غير موجود في `TechnicalStage` — fallback ينجح لكنه بقايا نسخ ولصق. |
| P2-17 | `boq-nodes/page.tsx:649` | `value={editingNode.estimatedRate || ''} onChange={... === '' ? '' : Number(...) as any}` | تخزين `''` نصية في حقل رقمي عبر `as any` → قاعدة بيانات متسخة. |
| P2-18 | `boq-master/page.tsx:5` + `boq-master-selector.tsx:4` + `boq-master-service.ts:2` | `THIS PAGE/COMPONENT/FILE IS DELETED` | بقايا هجرة بلا تنظيف — تربك الملاحة والأرشفة. |
| P2-19 | `types/project.ts:23-39` مقابل `types/transaction.ts` | `export interface StageInstance ...` | تعريفان متنافران لـ StageInstance (واحد ميّت على الأقل) — variation-service يستخدم نسخة transaction. |
| P2-20 | `lib/permissions.ts:67` + `lib/permissions/engine.ts:65` | `export function ensureActionPermission(...)` مرتين | محركا صلاحيات مزدوجان بتوقيعين مختلفين (`PermissionCode` مقابل `string`) — انزلاق مستقبلي مضمون. |
| P2-21 | `projects/page.tsx:38` + `client-visits/page.tsx:47` | `orderBy('createdAt','desc')` / `orderBy('nameAr')` بلا `limit` | استعلامات غير محدودة بلا ترقيم — تكبر مع نمو البيانات. |
| P2-22 | `boqs/page.tsx:94` | `router.push(`/dashboard/clients/${boq.clientId}/transactions/${boq.transactionId}/boq`)` | بلا تحقق من `clientId/transactionId` → روابط مكسورة لبيانات ناقصة. |
| P2-23 | `template-service.ts:61` | `ensureActionPermission(this.userPermissions, 'ref:edit')` لحفظ قوالب BOQ | صلاحية القاموس تُستخدم للقوالب — لا تمييز صلاحيات `templates:*` رغم وجود مفهوم مستقل. |

---

## 6. ما يستحق النقل إلى ConTrack وما لا يستحق

### ✅ يُنقل (مع تحسينات)
| العنصر | السبب | شرط النقل |
|--------|-------|-----------|
| **بنية الشجرة المرجعية** (parentId/ancestorIds/depth/childrenCount + inheritServices + allowedServiceIds) | أفضل ما في الكود: مرجع موحد يغذي القوالب والمقايسات والتنفيذ | إضافة كشف دورات + فهرسة resolver + توليد كود من `max(order)` لا `size` + منع حذف عقدة مستخدمة |
| **ربط البند بالمراحل المتعدد** `technicalStageIds[]` + المرحلة الافتراضية | يحل مشكلة حقيقية (ظهور البند في المرحلة الصحيحة ميدانياً) | نقل الفحص الإلزامي كما هو، مع فرضه في الخدمة لا الواجهة فقط |
| **محرك Cost Snapping** في recordBOQItemExecution (boq-execution-service:60-80) | تجميد أسعار الموارد وقت التنفيذ = أساس تحليل ربحية سليم | إضافة حارس تجاوز الكمية داخل الخدمة مع `force` حقيقي + صلاحية ميدانية |
| **التصميم المفاهيمي للعدادات الستة + IPC** (contractQty/approvedVariationQty/executed/verified/billed + InterimPaymentCertificate) | نموذج مقاولات فني صحيح (FIDIC-style) | إعادة توصيله فعلياً: VO يحدّث `approvedVariationQty`، IPC يحدّث `billedQuantity`، workflow تحقق يحدّث `verifiedQuantity` |
| **القوالب الأربعة كبنية** (TemplateType موحد + sub-collection للبنود + ربط BOQTemplate↔Contract↔Quotation) | فصل رأس/بنود سليم ويمنع تضخم الوثائق | إصلاح الحذف (حذف المجموعة الفرعية) + دفعة مقسمة + صلاحيات `templates:*` مستقلة |
| **الأنماط الثلاثة للتسعير** (percentage/fixed/itemized) في عروض الأسعار | مرونة تجارية حقيقية | إصلاح حساب quantity=0 وإزالة 'SIGNING' المزيف |
| **حقن المراحل اليدوية من VO** (injectNewManualStage + isTemporary + الإزاحة) | فكرة ممتازة لأعمال خارج المسار المعياري | نقلها بعد إصلاح P0-3 وربطها بواجهة حية + فحص سباق |
| **إعادة فتح المراحل عند تغيير الكمية** (reopenRequiredStages) | منطق تشغيلي صحيح | توسيعه: إعادة فتح الأبويين + حالة التجاوز |
| **توجيه الصلاحيات المزدوج** (UI check + service ensureActionPermission) | نمط دفاعي جيد | توحيد المحركين في واحد |
| **صفحة سجل زيارات العميل** (دمج appointments + collectionGroup fieldVisits) | فكرة التقرير الموحد قوية | إعادة كتابة الاستعلامات (chunked) وإزالة فتح الرابط من رسالة الخطأ |

### ❌ لا يُنقل (يُهدر أو يُستبدل)
| العنصر | السبب |
|--------|-------|
| أرقام صفحة المشاريع المزيفة (2.4M/12/88%/42%/15,400) | ديكور ديمو — خطير إن وصل لإنتاج |
| تعريف "المشروع = Transaction نصه يحتوي مقاولات" | يحتاج كيان Project صريح أو enum للنشاط (types/project.ts نفسه ميت) |
| `purchase_orders_items` في boq-inventory-link-service | مجموعة وهمية — يُعاد بناؤه فوق مخطط المشتريات الحقيقي أو يُحذف |
| نظام `'SIGNING'` كمعرف مرحلة | يُستبدل بحقل `contractualEvent` الموجود أصلاً في النوع |
| النسخة الحالية من applyQuantityChangeToBOQ | إعادة كتابة كاملة بمنطق الإشارة حسب النوع (P0-3) |
| files stubs (boq-master/page + selector + service) | حذف نهائي قبل النقل |
| `types/project.ts` (Project + StageInstance المكرران) | ميتان ومتنافران — يُستبدلان بتعريف واحد في types/transaction |
| محركا الصلاحيات المتوازيان | توحيد إلزامي قبل أي نقل |
| `Math.min(100)`/`Math.max(0)` لإخفاء التجاوزات في العروض | يُستبدل بشارات تحذير صريحة + قفل حفظ |

---

## 7. خلاصة تنفيذية

1. **الشجرة المرجعية** هي الجوهرة المعمارية: نموذج وراثة ناضج (سياق فني + مراحل متعددة + أدوار group/work_item) لكن حماياتها (عدّاد الأبناء، توليد الأكواد، الحذف) هشّة.
2. **العدادات الستة** تصميم IPC محترم بتنفيذ مقطوع: 4 من 6 عدادات ميّتة، والوحيد الحي (executed) بلا حارس تجاوز في الخدمة.
3. **نظام VO** مكتمل على الورق (4 أنواع + حقن مراحل + إعادة فتح) ومكسور ثلاث كسرات: أنواعه غير معرفة (لا يترجم)، منطق الإشارة معكوس للخفض/الحذف، وأبوابه (الحوار + الاعتماد/الرفض) غير موصولة بأي واجهة — **الزر الميت حرفياً**.
4. **القوالب الأربعة** صلبة البنية (فصل رأس/بنود + ربط متبادل) بعيوب حفظ متكررة (try بلا catch، حذف يتيم، i18n مفاتيح متضاربة).
5. **الأمن** كله مفوض لقواعد Firestore غير المتوفرة في النطاق؛ كل فحوص الصلاحيات في الكود تجميلية من جانب العميل، ومسار `global_users` المكتوب يدوياً ثغرة نمطية.
