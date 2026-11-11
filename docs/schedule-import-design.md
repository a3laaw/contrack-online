# البرنامج الزمني (CPM) — استيراد «ارفعه فيسحبه» وربطه بالبنود

> **المصدر:** المالك أرسل البرنامج الزمني الحقيقي `upload/البرنامج الزمني للمشروع.pdf` — **CPM Detailed Schedule (24 صفحة)** لمستوصف صباح السالم الجنوبي — **نفس مشروع BOQ المستورد (CON-0001)**. وطلبه: «قولي الخطوات التالية لتكملة النواقص في المقاولات — أنا مش عاوز اعمل مقاولات صرف وقبض فقط، إحنا برنامج فريد منه نوعه للمقاولات».
> **العلاقة بالوثائق:** هذه الوثيقة تنفّذ وتطوّر §2 من `docs/project-dashboard-design.md` (الفجوة الأولى: الجدولة الزمنية) — القرار هناك كان «عمودان على البند + استيراد Excel بـitemNo»؛ وصول البرنامج الحقيقي يثبت أن المصدر **أنشطة CPM لا بنود BOQ**، فيتطور القرار إلى نموذج أنشطة كامل يبقي عقد العرضين (عمودا `plannedStart/plannedFinish`) قائماً كقيم مشتقة.

---

## 1) تشريح الملف الحقيقي (ما وصل فعلاً)

| العنصر | القيمة في الملف |
|---|---|
| المشروع | SABAH AL SALEM SOUTH HEALTH CENTER — **454 يوماً** |
| البداية / النهاية | 28-Feb-26 ← 27-May-27 |
| Data Date | 28-Feb-26 — المراجعة **Detailed Schedule-R01** (Baseline حقيقي) |
| الأعمدة | Activity ID · Activity Name · Original Duration · **Early Start/Finish · Late Start/Finish** |
| صفوف الملخص | WBS bands بتواريخ مجمّعة (FOUNDATION LEVEL 107 · GROUND LEVEL 278 · FIRST LEVEL 288 · ROOF LEVEL 202 · STAIR CASE 87 · FACADE WORK 96 · EXTERNAL 69 · TESTING & COMMISSIONING 23 · AUTHORITIES' APPROVAL 453 · CONTRACT CLOSEOUT 128 …) |
| حجم البيانات | ≈ 600 نشطة فعلية عبر 24 صفحة |

**عائلات الترميز (مفتاح التصنيف — بلا استثناء في الملف):**

| البادئة | العائلة | تحمل قيمة BOQ؟ |
|---|---|---|
| `P-FL / P-GF / P-FF / P-RF / P-ST` | أعمال مادية بالمستويات (أساسات/أرضي/أول/سطح/سلم) | **نعم** (work) |
| `P-CV / P-FA / X-GE` | مصاعد · واجهات · أعمال خارجية | **نعم** (work) |
| `T-GE` | Testing & Commissioning | عموماً ضمن General Requirements — بلا ربط افتراضي |
| `E-SC-SS / E-SC-AP` | تسليمات واعتمادات مقاولي الباطن | لا (submittal/approval) |
| `E-MA-SS / E-MA-AP / E-MA-PR` | تسليمات/اعتمادات/شراء مواد | لا (+ procurement) |
| `E-SD-*` | Shop Drawings | لا |
| `G-GE` | عام (mobilization / مدة العقد / تسليم) | لا |
| `U-GE` | موافقات الجهات (KMU/KFD/MPW/MEW) | لا |
| `R-GE` | إقفال العقد + As-Built | لا |

**ملاحظات للنقاوة (المصدر فيه أكواد ملتوية يجب تحمّلها):**
- أكواد ملتصقة باسمها: `U-GE-KMU-01006MUNICIPALITY CLEARANCE…` · `U-GE-KFD-15201 KFD INSP…` · `U-GE-MEW-002 SUB…`
- أكواد بنقص شرطات/حروف زائدة: `P-GF-GR15004` · `ESDGSS-00310` · `ESDFSS-00110` · `PFFGG-16315` · `PFFF2-09000` · `P-GE-GR-0305`
- أسطر الرسم/التذييل (Legend · «CPM Detailed Schedule (n of 24)» · HISTORY OF Submitals) تُسقط.
- التواريخ بصيغة `DD-MMM-YY` (28-Feb-26) — والأنشطة صفرية المدة (Milestones) قيمتها Start=Finish.

---

## 2) القرار المعماري — لماذا نموذج أنشطة لا عمودان؟

البرنامج الحقيقي يحتوي ≈600 نشطة مقابل 527 بند BOQ، والعلاقة ليست 1:1 إطلاقاً:
- أنشطة **بلا قيمة** (تسليمات/اعتمادات/شراء/جهات) لا تنعكس على أي بند لكنها حاسمة زمنياً (مسار تسليم المواد يحكم بدء التركيب).
- نشاط واحد (`INST. OF BLOCK WALLS`) يمتد على بنود متعددة، والبند الواحد يُنفّذ عبر عدة مستويات (`P-FL…P-FF`).
- تواريخ **Early وLate معاً** = Float مجاني — غير قابل للتخزين في عمودين.

**إذن — نموذجان جديدان (إضافية صرفة، G9: صفوف مؤرخة محفوظة أبدياً):**

```prisma
/// دفعة استيراد للبرنامج الزمني — أحدث دفعة = الحيّ، القديمة محفوظة (نمط Baseline R01/R02)
model ScheduleImport {
  companyId      Int      @default(1)
  id             Int      @id @default(autoincrement())
  contractId     Int
  contract       Contract @relation(fields: [contractId], references: [id], onDelete: Cascade)
  fileName       String
  revision       String   @default("")   // R01 من تذييل الملف إن وُجد
  dataDate       String   @default("")   // Data Date — لحظة صحة الجدول
  projectStart   String   @default("")   // 28-Feb-26
  projectFinish  String   @default("")   // 27-May-27
  activityCount  Int      @default(0)
  workCount      Int      @default(0)    // أنشطة تحمل قيمة (P-*/X-*)
  warnings       String   @default("")   // JSON تحذيرات المحلل
  importedBy     String   @default("")
  createdAt      DateTime @default(now())
  activities     ScheduleActivity[]
  @@index([contractId])
  @@map("schedule_imports")
}

/// نشطة البرنامج الزمني — تواريخ أصلية كما وصلت (لا مشتقات مخزنة)
model ScheduleActivity {
  companyId      Int             @default(1)
  id             Int             @id @default(autoincrement())
  importId       Int
  import         ScheduleImport  @relation(fields: [importId], references: [id], onDelete: Cascade)
  contractId     Int
  activityCode   String          @default("")  // كما ورد حرفياً بعد التطبيع
  name           String
  kind           String          @default("work") // work|submittal|approval|procurement|shopdrawing|testing|authority|closeout|general|summary
  family         String          @default("")  // P-FL | E-MA | U-GE … من البادئة
  durationDays   Int             @default(0)
  earlyStart     String          @default("")  // YYYY-MM-DD
  earlyFinish    String          @default("")
  lateStart      String          @default("")
  lateFinish     String          @default("")
  isSummary      Boolean         @default(false) // صف W band
  groupName      String          @default("")  // أقرب band حاوي (تقريبي — §3)
  divisionCode   String          @default("")  // من مطابقة القسم — §4
  boqItemId      Int?            // ربط مبكر اختياري (ب3) — الافتراضي مطابقة بالقسم
  sortOrder      Int             @default(0)
  @@index([importId])
  @@index([contractId, divisionCode])
  @@map("schedule_activities")
}
```

وعلى `BoqItem` (من قرار dashboard §2 — يبقى كما هو): `plannedStart / plannedFinish` — لكن الاستيراد **يملؤهما آلياً** من نافذة قسم البند (§4)، فيبقى عقد العرض في اللوحة سليماً بلا إدخال يدوي.

**لماذا هذا ليس «بناء نظام جديد»؟** جدولان صرف + محلل + روتين استيراد — نفس نمط `boq-parse`/`boq-import` المنجز والمجرّب حرفياً. كل ما عداها (PV/EV/SPI) مشتقات تُحسب لحظة العرض.

---

## 3) المحلل النقي `src/lib/import/schedule-parse.ts` (بلا db — مرآة boq-parse)

- **المدخلات المقبولة (v1):**
  1. **PDF مباشرة** — الملف الحالي: استخراج نص عبر `pdf-parse` (تبعية جديدة صغيرة pure-JS) ثم محلل نصي. بنيته الجدولية استخرجت من الاختبار بشكل ممتاز (كل سطر: كود + اسم + مدة + 4 تواريخ).
  2. **Excel/CSV من Primavera** — الأضمن للمستقبل (أي تحديث R02 يُصدَّر بنفس الأعمدة) — إعادة استخدام `exceljs` الموجود.
- **قواعد المسح:**
  - سطر نشطة: `[كود]? [اسم] [مدة رقمية] [تاريخ] [تاريخ] [تاريخ]? [تاريخ]?` — الصفوف بلا كود = **summary bands** (تلتقط اسمها كـgroup حاوي للأسطر التالية حتى band التالي، بلا تداخل مُدّعى — الـPDF يفقد الإزاحة فالتقسيم تقريبي ومعلن كحد).
  - تطبيع الكود: إزالة الالتصاق بالاسم (regex للأقسام المعروفة `^[A-Z]{1,2}(-[A-Z]{2,3})+[-]?\d+` ثم فصل الباقي)، توحيد الشرطات.
  - تواريخ `DD-MMM-YY → YYYY-MM-DD` بجدول أشهر ثابت (Feb/Mar/…) — لا اعتماد على locale.
  - صفر مدة + Start=Finish = Milestone (يُخزن كما هو).
- **التحقق بعد المسح (يُعرض في المعاينة):**
  - عدد الأنشطة الكلي / work / summary — و`projectStart/Finish` = min(earlyStart)/max(earlyFinish) يجب أن يطابقا 28-Feb-26/27-May-27 وإلا تحذير.
  - كل نشاط work حصل على divisionCode؟ (عدّاد غير المطابق يظهر بأسمائه — لا يُرفض الاستيراد، يُترك بلا قسم).
  - تواريخ ناقصة/غير قابلة للتحويل → تحذير مفرد.

---

## 4) المطابقة بالأقسام وتعبئة البنود (قلب «متأخرين فين متقدمين فين»)

- **قاموس مرادفات ثابت في المحلل** يربط أسماء bands المستويات بأقسام BOQ المستوردة (نفس القسمان الـ18 من الملف الحقيقي):

| Band في البرنامج | قسم BOQ (divisionCode) |
|---|---|
| CONCRETE WORK | 03 CONCRETE |
| MASONRY WORK | 04 MASONRY |
| METAL WORK | 05 METAL |
| THERMAL & MOISTURE PROTECTION | 07 THERMAL |
| WOODEN/STEEL/ALUMINUM DOORS & WINDOWS | 08 DOORS |
| WALL/FLOOR/CEILING FINISHES · SPECIALTIES · FURNISHING | 09 FINISHES |
| MECH. (PLUMBING/F.FIGHTING/HVAC) | 15 MECH |
| ELEC. (POWER/LIGHTING/DATA/FIRE ALARM/CCTV/…) | 16 ELEC |
| SITE WORK · EXCAVATION · LANDSCAPE · EXTERNAL | أقسام الأعمال الخارجية المقابلة |

- **شاشة معاينة المطابقة** (نمط معاينة BOQ): كل قسم BOQ × النافذة الزمنية المشتقة من أنشطة work لمطابقته `[min earlyStart → max earlyFinish]` + عدد الأنشطة + قيمة القسم من BOQ — المالك يرى كل شيء قبل التأكيد.
- **تعبئة `BoqItem.plannedStart/plannedFinish`:** لكل بند = نافذة قسمه (بدقة البند الواحد تُحسَّن في ب3 بربط مباشر). هكذا يتحقق حرفياً «عندي برنامج زمني معروف كل بند هيخلص امتي» — لكل بند تاريخا بدء ونهاية مخططان مشتقان من CPM الحقيقي لا من إدخال يدوي.
- **PV (القيمة المخططة) على مستوى القسم:** قيمة القسم (Σ مبالغ بنوده) توزَّع خطياً داخل نافذته — وهذا بالضبط مستوى دقة لوحة الاستشاري المرفقة سابقاً («تقدم بالأقسام» 16 قسماً). التوزيع داخل القسم على الأنشطة (منحنى أدق) = ب3.

---

## 5) ماذا يفتح الاستيراد (الإغلاق الفعلي للنواقص)

| المطلوب من المالك | ما بعد ب1 |
|---|---|
| «برنامج زمني معروف كل بند هيخلص امتي» | كل بند بنافذة مخططة مشتقة + شجرة الأنشطة كاملة قابلة للعرض |
| «تنبؤ زمني متأخرين فين متقدمين فين» | PV حقيقي من CPM مقابل EV (ميداني/رسمي) → **SPI + أيام التأخر** لكل بند/قسم — نواة ج1 |
| «سابق ولاحق في BOQ» | تواريخ Early/Late محفوظة أصلاً — Float لكل نشطة متاح للعرض |
| نمط السابق/الحالي زمنياً | Data Date + Revision R01 محفوظان بكل دفعة — تحديث R02 = دفعة جديدة، والقديم يبقى Baseline قابل للاسترجاع (نفس فلسفة as-of) |

**حد معماري صريح (G9 لا يُخترق):** النظام **يقرأ الجدول ولا يعيد حساب شبكة CPM** — لا حسب مسارات حرجة ولا إعادة جدولة؛ الشبكة حقيقة المصدر Primavera، ووظيفتنا استيرادها وربطها بالمال والميدان. أي تحديث يأتي كملف جديد (R02) وليس بتحرير أنشطة.

---

## 6) مراحل التنفيذ

| المرحلة | المحتوى | الاعتمادية |
|---|---|---|
| **ب1** | `ScheduleImport`+`ScheduleActivity` (schema) · `schedule-parse.ts` · `POST /api/contracts/[id]/schedule/import` (preview|run) · حوار استيراد بمعاينة المطابقة · تعبئة plannedStart/Finish | **مستقلة تماماً — تبدأ فوراً** |
| **ب2** | PV engine (شهري/تراكمي بالأقسام) + دمجه في نواة EVM (ج2 من dashboard-design) وبطاقة «تقدم مخطط» في اللوحة | ب1 |
| **ب3** | شجرة الأنشطة + ربط يدوي activity→boqItemId + Float/تعرض Late + توزيع داخل القسم على الأنشطة | ب1 + ز1 (للربط المالي) |

**تحديث الترتيب الكلي:** **ب1** ← ز1 ← ز2 ← ز3 (+د1) ← ج1 (يتطلب ب1+د1) ← م1 ← ج2 ← ج3 ← م2 ← م3 — ب1 يسبق كل شيء لأنه بلا اعتماديات ويفتح نصف اللوحة وحده.

## 7) حدود v1

1. الـgroup bands تقريبية (الـPDF يفقد الإزاحة) — كافية للتصنيف والمطابقة، والشجرة الكاملة النظيفة تحتاج Excel من Primavera (ب3).
2. لا تحرير للأنشطة داخل النظام — الجدول يُدار في Primavera ويُستورد من جديد بكل تحديث.
3. Milestones/أنشطة صفرية تُعرض كنقاط — لا وزن لها في PV.
4. T-GE (Testing) بلا ربط قسم افتراضياً — ربطها بGeneral Requirements قرار يُؤخذ في المعاينة.
