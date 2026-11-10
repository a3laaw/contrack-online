# تقرير المراجعة الشاملة (2-a): وحدة الإعدادات والقوائم المرجعية — NOVA ERP

> **نطاق المراجعة:** كل صفحات `/dashboard/settings/*` (بما فيها checklists بنسختيها القديمة والجديدة)، ومكوّنات الإعدادات، والاجتماعات/القاعات، وكل الخدمات المرجعية في `src/services/`، وأنواع البيانات في `src/types/`، ومحرك الصلاحيات `src/lib/permissions/`، وبيانات البذر `src/lib/seed-data.ts`.
> **المنهجية:** قراءة كاملة سطراً بسطر + تتبع الاستهلاك الفعلي لكل قائمة عبر Grep على كامل `src/`.
> **العدد الإجمالي للملفات المفحوصة: ~65 ملفاً** (55 قراءة كاملة + 10 قراءات جزئية/مقارنات diff).

---

## 1) الخريطة العامة للوحدة (Architecture Map)

```
/dashboard/settings
├── page.tsx                    → مركز الإعدادات (بطاقات تنقّل) [بوابات جزئية]
├── company/                    → هوية الشركة ( Firestore: companies/{id} )
├── profile/                    → الملف الشخصي ( global_users + companies/{cid}/users )
├── users/                      → إدارة حسابات الدخول ( Auth + global_users + users )
├── roles/                      → مصفوفة الصلاحيات ( roles ) [RoleForm ميت، RoleMatrixForm حي]
│   ├── role-form.tsx           → ❌ مكوّن ميت (لا يُستورد في أي مكان)
│   ├── role-matrix-form.tsx    → النموذج الحي (matrix + permissions)
│   └── permissions-list.ts     → ⚠️ تصنيف صلاحيات قديم متوازٍ (7 وحدات) يتعارض مع catalog.ts (12 مورداً)
├── reference-lists/            → ❌ صفحة يتيمة (لا يوجد رابط لها في أي مكان — مكررة لـ general-lists)
├── cost-centers/ profit-centers/ → أبعاد مالية (متاحة من السايدبار فقط، لا من مركز الإعدادات)
├── cost-rates/                 → ❌ صفحة ملغاة (redirect فقط) — لكن الخدمة والصلاحية ما زالت حية
├── work-hours/                 → مواعيد العمل ( settings/work_hours )
└── checklists/                 → «لب النظام» — 7 تبويبات:
    ├── general-lists/  boq-nodes/  halls/  departments/  technical-paths/  geo/  seed-tool
/dashboard/checklists (النسخة القديمة الموازية) → ❌ يتيمة بالكامل (لا روابط)، وتحتوي
    └── service-types/ → الوحيدة التي تكتب في مجموعة serviceTypes المهجورة
```

**ملاحظة معمارية جوهرية:** النظام يعتمدFirestore متعدد المستأجرين عبر `getTenantPath(companyId, ...)` (`lib/utils.ts:8-10`) — كل شيء تحت `companies/{companyId}/...`. التسلسل الفني الرباعي: `activityTypes/{act}/services/{srv}/subServices/{sub}/stages` (متداخل 4 مستويات — مصدر تعقيد كبير في الاستعلامات والحذف).

---

## 2) الجرد الكامل للقوائم المرجعية (مع الاستهلاك الفعلي)

| # | القائمة | مسار Firestore | الحقول | تُستهلك في | الحالة |
|---|---------|----------------|--------|------------|--------|
| 1 | **unitTypes** (وحدات القياس) | `companies/{cid}/unitTypes` | code, name, nameEn, symbol, category + أساس (isSystem/isEditable/isActive/order) | `boq-nodes/page.tsx:79` (وحدة البند التنفيذي)، `BOQReferenceSelector` (عرض الرمز) | ✅ حية — لكن **لا تُبذر آلياً** (انظر §6) |
| 2 | **paymentMethods** (طرق الدفع) | `companies/{cid}/paymentMethods` | + feePercentage, feeFixedAmount | `accounting/vouchers/payment:receipt` | ⚠️ حية — **حقلا العمولة يُعرضان ولا يمكن تعديلهما من أي واجهة، ولا يستهلكهما أي حساب** |
| 3 | **paymentConditionTypes** (شروط الدفع) | `companies/{cid}/paymentConditionTypes` | أساس فقط | ❌ لا يوجد مستهلك على الإطلاق (Grep صفر نتائج خارج الإعدادات) | ❌ قاموس ميت |
| 4 | **milestoneTimingTypes** (توقيت الدفعات) | `companies/{cid}/milestoneTimingTypes` | أساس فقط | ❌ لا مستهلك — القوالب تستخدم `MilestoneTiming = 'at'\|'before'\|'during'\|'after'` كنص ثابت (`types/templates.ts:14`) | ❌ قاموس ميت (ويُبذر بـ isEditable=false!) |
| 5 | **itemCategories** (تصنيفات المواد) | `companies/{cid}/itemCategories` | أساس فقط | ❌ لا مستهلك. الحقل `allowedItemCategoryIds` على عقدة BOQ موجود في النوع فقط (`types/reference.ts:173`) بلا أي واجهة أو قراءة | ❌ قاموس ميت |
| 6 | **costTypeCategories** (أنواع التكاليف) | `companies/{cid}/costTypeCategories` | أساس فقط | ❌ لا مستهلك | ❌ قاموس ميت |
| 7 | **governorates/areas** (الجغرافيا) | `governorates` + `governorates/{gid}/areas` | name, nameEn, order, isActive | العملاء/المشاريع (خارج النطاق)، صفحة geo | ✅ حية |
| 8 | **departments/jobs** (الهيكل التنظيمي) | `departments` + `departments/{did}/jobs` | Dept: name, nameEn, description, color? / Job: name, nameEn, roleId?, roleName?, roleCode?, hourlyCost? | الموظفون، المستخدمون (`users/page.tsx:67,92`)، الصلاحيات الميدانية (stage.allowedDepartmentIds)، اجتماعات القاعات | ✅ حية — لكن **ربط الوظيفة بالدور والتكلفة الساعية ميتان** (انظر P1-5) |
| 9 | **activityTypes/services/subServices/technicalStages** (المسار الفني) | متداخل 4 مستويات | Stage: isTimed/timeTargetDays, isNumeric/numericTarget, isRequired, isEditable, nextStageIds, allowedDepartmentIds, fullPathName | `transaction-service.ts` (مراحل المعاملات)، `meeting-rooms-view.tsx:519-548` (القيد التسلسلي)، boq-nodes | ✅ حية وهي عمود النظام |
| 10 | **boqReferenceNodes** (شجرة بنود الأعمال) | `boqReferenceNodes` (مسطّح مع parentId/depth/ancestorIds) | title, code, isExecutable, unitTypeId/unitSymbol, estimatedRate, technicalStageIds[], وراثة النشاط/الخدمة/المسار | القوالب (`template-service.ts`)، المقايسات، التنفيذ الميداني | ✅ حية — «لب اللب» |
| 11 | **meetingRooms** (القاعات) | `meetingRooms` | name, nameEn, capacity, order, isActive | `meeting-rooms-view.tsx:93` (رادار القاعات) | ✅ حية |
| 12 | **serviceTypes** (أنشطة الأعمال القديمة) | `serviceTypes` | + color, moduleScope | ❌ فقط الصفحة اليتيمة `dashboard/checklists/service-types` (خارج التبويبات أصلاً) | ❌ مجموعة وصفحة ميتتان |
| 13 | **costRateCards** (تعرفة العمالة) | `costRateCards` | name, effectiveFrom, laborRates[{jobTitle, hourlyCost}] | ❌ `CostRateService` غير مستورد في أي مكان — رغم أن صفحتها حُذفت، **ما زالت صلاحية `cost_rates` معروضة في مصفوفة الصلاحيات** (`catalog.ts:60-65`) | ❌ ميزة ميتة بالكامل (خدمة+نوع+صلاحية) |
| 14 | **roles** (الأدوار) | `roles` | code, name, nameEn, permissions[], matrix[PermissionRule], isSystemRole, order | `use-permissions` → كل النظام | ✅ حية |
| 15 | **customReferenceLists** (قوائم مخصصة قابلة للإنشاء) | `customReferenceLists/{code}/items` | تعريف قائمة ديناميكي | ❌ `createCustomList/getCustomListsMetadata` غير مستدعيان — **ميزة القوائم المخصصة كود ميت 100%** | ❌ ميزة ميتة |

### مستهلكو القوائم (خلاصة Grep)
- `paymentMethods` ← سندات القبض/الدفع فقط.
- `unitTypes` ← شجرة BOQ فقط.
- القوائم 3-6: **صفر استهلاك تشغيلي** — تُدار وتُبذر ولا يقرأها أحد.
- `seedAllLists()` في `reference-list-service.ts:176-207` (التي كانت ستزرع القوائم الست) **غير مستدعاة من أي مكان** ⇒ حتى القائمتان الحيتان (unitTypes/paymentMethods) لا تُبذر آلياً ويجب إدخالهما يدوياً.

---

## 3) مراجعة صفحة-صفحة (الغرض، الحقول، الحمايات، الأعطال)

### 3.1 `settings/page.tsx` (134 سطراً) — مركز الإعدادات
- **الغرض:** بطاقات تنقّل مع بوابات `isAdmin` / `check('ref','view')`.
- **الأعطال:**
  - **P1 سطر 57 & 77 & 87:** بطاقات `templates` و`work-hours` و`profile` بـ `visible: true` بلا أي بوابة صلاحيات — عدم اتساق مع البقية.
  - **P2:** لا توجد بطاقات لـ `cost-centers`/`profit-centers`/`reference-lists` رغم وجودها كصفحات (تنقّل مجزأ بين المركز والسايدبار).
  - **P2 سطر 62:** وصف بطاقة الأدوار = عنوانها (`description: t('rolespermissions')`).

### 3.2 `settings/company/page.tsx` (102 سطراً)
- **الغرض:** تعديل `companies/{cid}` — الاسم والسجل التجاري (يستهلكهما `print-wrapper.tsx:48,50` في الترويسة المطبوعة).
- **الحقول المحمّلة بلا واجهة:** `address, logoUrl, headerImageUrl, footerImageUrl, headerText, footerText` (أسطر 29-45) — تُحمّل وتُعيد كتابتها عند الحفظ!
- **الأعطال:**
  - **P1 سطر 66:** `updateDoc(companyRef, { ...formData })` يعيد كتابة كل الحقول المحمّلة؛ لو كانت الحقول غير موجودة (شركة قديمة) سيُنشئها فارغة، والأخطر: أي تعديل من شاشة أخرى على هذه الحقول يُكتب فوقه.
  - **P1:** `headerText/footerText` تُطبع في كل مستند (`print-wrapper.tsx:57,96`) لكن **لا توجد حقول إدخال لها في الواجهة** — ميزة ميتة من الطرف الواجهي.
  - **P2 سطر 49-59:** `handleFileUpload` + أيقونات `UploadCloud, X` كود ميت — لا يوجد أي `<input type="file">` في الصفحة (رفع الشعار غير ممكن رغم أن `print-wrapper.tsx:41` يعرض `logoUrl`).
  - **P2:** حقلا `headerImageUrl/footerImageUrl` لا يستهلكهما أي ملف آخر (Grep).

### 3.3 `settings/profile/page.tsx` (114 سطراً)
- **الغرض:** تعديل الاسم/اسم المستخدم/الصورة في **3 أماكن متزامنة**: Firebase Auth profile + `global_users/{uid}` + `companies/{cid}/users/{uid}` (أسطر 60-62).
- **الأعطال:**
  - **P1 سطر 61:** لا فحص لتفرد `username` — يمكن لمستخدمين مشاركة نفس معرف الدخول.
  - **P2:** أيقونة `Lock` مستوردة بلا استخدام — لا توجد أي وظيفة تغيير كلمة مرور للملف الشخصي.
  - **P2 سطر 60:** تخزين الصورة كـ DataURL (حتى 1MB) في `photoURL` الخاص بـ Auth — ممارسة خطرة على حجم التوكن.
  - **P2 سطر 105:** البريد للقراءة فقط (سليم) لكن لا مسار تحقق/تغيير بريد.

### 3.4 `settings/users/page.tsx` (390 سطراً) ⚠️ أخطر صفحة
- **الغرض:** إنشاء حسابات دخول من الموظفين «المؤهلين» (الذين لهم `roleId`) عبر `UserService` (إنشاء Auth من المتصفح بتطبيق مؤقت)، وربط الدور، وتعطيل الحساب.
- **الأعطال:**
  - **P0 سطر 306:** `{showPassMap[u.id] ? u.initialPassword : '••••••••'}` — عمود «كلمة المرور» يقرأ حقلاً **غير موجود إطلاقاً** في مستند المستخدم (`user-service.ts:90` يخزن `initialPasswordSetAt` طابعاً زمنياً فقط). النتيجة: زر العين يعرض `undefined`. **والأسوأ:** وجود هذا العمود دليل على أن تصميماً سابقاً كان يخزّن كلمة المرور نصاً صريحاً — يجب حذف العمود نهائياً.
  - **P0 سطر 288:** صور المستخدمين الافتراضية `https://picsum.photos/seed/{u.id}/100/100` — **بيانات مزيفة** تُسرب معرّفات المستخدمين لخدمة خارجية في كل تحميل للصفحة.
  - **P1 سطر 65:** استعلام المستخدمين بلا فلتر `isActive` ولا `orderBy` — كل الحسابات المعطلة تظهر دائماً.
  - **P1 أسطر 92-94:** `if (!emp || !role) return;` عودة صامتة داخل try — المستخدم يرى النافذة تغلق بلا إنشاء حساب وبلا رسالة (الـ toast لن يظهر).
  - **P1:** لا فحص تردد البريد/اسم المستخدم قبل الإنشاء (البريد سيُرفض من Auth برسالة إنجليزية خام).
  - **P1:** الصفحة نفسها بلا بوابة صلاحيات (فقط البطاقة في المركز مخفية) — أي مستخدم يعرف الرابط يفتحها؛ الحماية الحقيقية الوحيدة قواعد Firestore.
  - **P2:** أيقونات `UserX, RefreshCcw, Copy, Key` ... مستوردة بلا استخدام — لا حذف حساب ولا إعادة تعيين حالة.
  - **P2 سطر 246:** placeholder `P@ssw0rd123` بلا أي سياسة قوة كلمة مرور.

### 3.5 `settings/roles/` — مصفوفة الصلاحيات
- **`page.tsx` (195 سطراً):** قائمة أدوار + `RoleMatrixForm`. بوابة `isAdmin` حقيقية (أسطر 70-87).
  - **P2 أسطر 40-44:** useEffect فارغ بتعليق «Redirect handled by permissions» — كود ميت.
  - **P1 أسطر 58-66:** `handleRunSeed` معرّف وغير مربوط بأي زر — **زر البذر ميت**، لكن الدالة نفسها `seedInitialRoles()` **بلا حماية تكرار** (`role-service.ts:160-170` ينشئ ADMIN/ENGINEER/ACCOUNTANT بمعرفات جديدة كل مرة) — قنبلة تكرار أدوار.
  - **P1 سطر 171:** نص إرشادي «يتم ربط القالب بالموظف عبر (الهيكل التنظيمي -> تعديل الوظيفة)» — **الميزة المُشار إليها غير موجودة** (انظر 3.9).
- **`role-form.tsx` (187 سطراً):** ❌ **ملف ميت بالكامل** — لا يُستورد في أي مكان (يعتمد `permissions-list.ts` القديم).
- **`role-matrix-form.tsx` (272 سطراً):** النموذج الحي: matrix[resource+action+scope] + توليد `permissions` تلقائياً كـ `resource:action` (سطر 84-90).
  - **P1 سطر 84-89:** عند أي تعديل بالمصفوفة تُعاد كتابة `permissions` من المصفوفة فقط — أي صلاحية كلاسيكية خارج نمط `resource:action` (مثل `hr:payroll` المبذورة في `role-service.ts:136`) **تُمسح صامتة** عند أول حفظ للدور.
  - **P2 سطر 101:** `const { id, ...saveData } = formData` ثم حفظ بقية الحقول كما هي (يشمل `isSystemRole` القادم من الواجهة) — دور نظام يمكن جعله غير نظامي من الواجهة (الحماية منطقية فقط).
- **`permissions-list.ts` (134 سطراً):** ⚠️ تصنيف متوازٍ قديم (7 وحدات: dashboard/projects/crm/hr/accounting/inventory/reference بأكواد مثل `projects:archive`, `accounting:close_period`) يتعارض مع `lib/permissions/catalog.ts` (12 مورداً بأفعال مختلفة). لا يستهلكه إلا الملف الميت role-form — **يجب حذفه**.

### 3.6 `settings/reference-lists/page.tsx` (349 سطراً) — ❌ صفحة يتيمة
- نسخة مطابقة تقريباً لـ `checklists/general-lists/page.tsx` على نفس البيانات والخدمة.
- **Grep: لا يوجد أي رابط/توجيه إليها** (`settings/reference-lists` صفر نتائج في السايدبار والمركز) — مسار حي بنفس الاستعلامات والخدمة = ازدواجية كاملة.
- **بوابات:** canEdit/canCreate/canDelete عبر `check('ref',...)` (أسطر 55-57) + حماية `isEditable` في الحذف (سطر 239).
- **P2 سطر 273:** قفل حقل الكود فقط للعناصر غير القابلة للتعديل — الاسم/الترتيب قابلان للتعديل حتى للعناصر النظامية (مقبول لكنه غير موثق).
- **P1:** لا فحص تفرّد `code` داخل نفس القائمة (الخدمة أيضاً لا تفحص) — يمكن إنشاء كودين متطابقين فيفسدان الربط.

### 3.7 `settings/cost-centers/page.tsx` (173 سطراً) و `profit-centers/page.tsx` (219 سطراً)
- **الغرض:** أبعاد تحليلية مالية مرتبطة اختيارياً بمشروع (`projectId` → القائمة تعرض `transactions` وتقرأ `subServiceName/clientName` — «المعاملات» هي مجموعة المشاريع فعلياً، تسمية مضللة).
- **الأعطال:**
  - **P0/P1:** الصفحتان **بلا أي بوابة صلاحيات** (لا `usePermissions` ولا `isAdmin`) — أي مستخدم مسجّل يعدّل البنية التحليلية المالية من المتصفح.
  - **P1 (cost-centers سطر 68):** `updateDoc` يكتب حقل `id` داخل المستند نفسه (تلوث بيانات)؛ ونفس النمط في profit-centers (سطر 68) و halls (سطر 77).
  - **P1:** لا حماية حذف لمركز تكلفة مرتبط بمعاملات (في profit-centers المستوردان `deleteDoc, Trash2` **غير مستخدمين** أصلاً — لا حذف بالواجهة، ويعني بقايا كود).
  - **P2:** كود المركز غير مُفحوص التفرّد؛ `name` يُشتق من `nameAr` فقط (سطر 60) فيصبح الاسم الإنجليزي غير متسق.
  - **ملاحظة:** مركز «الإدارة العامة» يُبذر من `seedConstructionCOA` (`seed-service.ts:146-157`) بمعرف ثابت `cc_admin_general` — إعادة تشغيل البذر تُحدّثه لا تكرره (سلوك صحيح هنا فقط).

### 3.8 `settings/cost-rates/page.tsx` (15 سطراً) — صفحة ملغاة (redirect إلى checklists)
- لكن: `CostRateService` (90 سطراً) + `types/cost-rate.ts` + `paths.costRateCards` + **مورد صلاحية `cost_rates` في مصفوفة الأدوار** (`catalog.ts:60-65`) كلها حية بلا مستهلك. تفعيل الجدول (`activateCard:48-75`) غير ذرّي فعلياً (قراءة ثم batch — سباق قد يترك جدولين نشطين لو تحقق).

### 3.9 `settings/checklists/` — «لب النظام»

#### `page.tsx` (115 سطراً) — حاوية 7 تبويبات
- **P0:** لا بوابة صلاحيات على مستوى الحاوية (التبويبات تُدار داخلياً جزئياً) — وانظر seed-tool.

#### `seed-tool.tsx` (168 سطراً) ⚠️
- **P0 سطر 64-77:** «التطهير الشامل» — زر واحد + تأكيد نصي فقط، **بلا بوابة صلاحيات** (يكفي `ref:view` لرؤية التبويب، والاستدعاء نفسه بلا أي تحقق) يحذف كل المعاملات/العملاء/المقايسات.
- **P1 سطر 38-49:** «تشغيل محرك التهيئة» يستدعي `runSeed()` **مباشرة دون فحص `isSystemSeeded()`** (عكس الأداة القديمة `dashboard/checklists/seed-tool.tsx:34-38`) — كل زيارة جديدة للتبويب تُصفّر `isDone` وكل نقرة تكرر الأقسام/الوظائف.
- **P1 سطر 116:** الوعد النصي «ضخ القواعد الجغرافية والتنظيمية الموحدة» **مضلل** — `runSeed()` يزرع الأقسام والوظائف فقط (`seed-service.ts:206-218`)؛ الجغرافيا والمسارات الفنية والقوائم الست لا تُزرع من أي مكان.
- **P1 سطر 51-62:** `handleSyncBalances` بلا `catch` — أي خطأ = unhandled rejection بلا إشعار؛ والنص يقول «2.5 يوم/شهر» بينما المحرك الفعلي يحسب 30/365.25 = 2.474 يوم/شهر (`working-days-service.ts:64`) — تباين بين العرض والحساب.

#### `general-lists/page.tsx` (232 سطراً) — القوائم الست
- النسخة الحية الوحيدة (reference-lists يتيمة). نفس البوابات والحمايات.
- **P1 سطر 151 + 160 + 174-180:** عمود «العمولة» لطرق الدفع يعرض `feePercentage/feeFixedAmount` ويُهيّئان صفراً عند الإنشاء، لكن **نافذة التحرير (199-216) لا تحتوي أي حقل لهما** — لا يمكن ضبط عمولة من الواجهة، ولا يستهلكها أي حساب في السندات. ميزة معطوبة الطرفين.
- **P1:** لا تفرّد كود (كما سبق). **P2:** بحث يعمل، حذف يحمى بـ `isEditable` (سطر 187).

#### `departments/page.tsx` (192 سطراً) ⚠️
- **P1 أسطر 38 + 63-85:** `jobForm` يهيئ `roleId: '', hourlyCost: 0` ويبحث عن الدور المختار (سطر 67) — لكن **نافذة إضافة/تعديل الوظيفة (174-189) تحتوي حقلي الاسم فقط**؛ `roleId` يبقى '' دائماً ⇒ كل وظيفة تُحفظ بـ `roleName: ''` و `roleCode: ''` و `hourlyCost: 0`. **هذا يكسر سلسلة مهمة:** إنشاء مستخدم من `users/page.tsx` يعتمد `emp.roleId` لتصفية «الموظفين المؤهلين» (سطر 74) — لكن انظر: الموظف يأخذ `roleId` من شاشة الموظفين نفسها لا من الوظيفة، فالعمود ميت في الوظيفة ويُدار في مكان آخر (تعارض مصدرين).
- **P1 أسطر 161-164:** بطاقات الوظائف المعروضة **بلا أزرار تعديل أو حذف** — الوظيفة تُضاف ولا يمكن تعديلها/حذفها من هذه الشاشة (`deleteJob` في الخدمة غير مستدعى).
- **P2 سطر 128:** البحث `d.name.includes(searchTerm)` حساس لحالة الأحرف ويبحث بالعربي فقط.
- **P1:** لا بوابة صلاحيات (لا `usePermissions`) — عكس بقية تبويبات الحاوية.
- **الحذف:** `deleteDepartment` يحذف القسم فقط — **الوظائف التابعة (subcollection) تبقى يتيمة**، والموظفون المرتبطون يفقدون قسمهم بلا تحذير.

#### `geo/page.tsx` (182 سطراً)
- حذف المحافظة **لا يحذف مناطقها** (`location-service.ts:46-54` حذف فردي) — المناطق اليتيمة تظل قابلة للعرض إذا اختيرت محافظة بمعرف قديم من سجل عميل.
- **P2 سطر 89:** `locationService.deleteArea(selectedGov!.id!, deletingId)` — استخدام `!` غير آمن؛ لو نُفّذ الحذف بعد مسح التحديد ينهار.
- **P1:** لا بوابة صلاحيات. **P2:** لا حماية حذف محافظة مستخدمة في عملاء/مشاريع.

#### `halls/page.tsx` (246 سطراً)
- CRUD كامل مع بوابات `ref:*` (سطور 48-50) — الأفضل بنيوياً في الحاوية.
- **P1 سطر 97:** حذف القاعة `deleteDoc` مباشر — لا فحص لمواعيد مرتبطة (`appointments.hallId`) رغم أن نص التأكيد (سطر 235) يعترف بالخطورة.
- **P2:** البحث في `name` و `nameEn` فقط.

#### `boq-master/page.tsx` (6 أسطر) — Stub محذوف يوجه للتبويب. ✅ نظيف.

#### `boq-nodes/page.tsx` (707 سطراً) — شجرة بنود الأعمال (الأهم)
- **بنية:** شجرة مسطّحة تُبنى في الذاكرة (`buildTree` 162-171)، وراثة سياق النشاط/الخدمة/المسار من الأب (`resolveInheritedContext` 88-104)، بند تنفيذي يتطلب: وحدة قياس + سياق كامل + مرحلة فنية واحدة على الأقل (تحقق 203-215)، ربط متعدد المراحل `technicalStageIds` مع مرحلة افتراضية `technicalStageId` (173-194, 587-616)، سعر مرجعي KWD (649).
- **الحمايات:** بوابات `ref:*` (74-76) + إنفاذ مزدوج في الخدمة (`ensureActionPermission`) + منع حذف عقدة لها أبناء (خدمة سطر 154 + تعطيل الزر سطر 315).
- **الأعطال:**
  - **P2 سطر 63 + 347:** حقل البحث `searchTerm` **مربوط بواجهة ولا يُستخدم في أي فلترة** — صندوق بحث شكلي (واجهة شجرة بلا بحث فعلي لألف بند).
  - **P1 سطر 302-308:** إضافة ابن تنقل `node.activityTypeId...` الخام — العقدة الأب الموروثة (حقولها '') تنقل فراغات للابن، فتُخزَّن حقول سياق فارغة في الابن وتعتمد الحقيقة على الوراثة وقت العرض (ازدواجية مصدر حقيقة).
  - **P2 سطر 545:** خطأ إملائي «لم يتم العور على مراحل» (العثور).
  - **P1 (خدمة) `boq-reference-service.ts:73-79`:** توليد الكود التلقائي `siblingsSnap.size + 1` — بعد حذف أي شقيق يُعاد توليد نفس الكود (تكرار أكواد مرجعية تستخدم في القوالب والمقايسات).
  - **P1:** تغيير `parentId` ممنوع في التحديث (حذف من الحمولة `service:132-134`) لكن الواجهة لا تحذّر — لا إعادة ترتيب شجرة حقيقية.
  - **P2:** حقول مخططة بلا واجهة: `billingTriggerGroup`, `allowedItemCategoryIds`, `allowedServiceIds`, `allowedActivityTypeIds` (`types/reference.ts:172-177`) — تُقرأ في `BOQReferenceSelector` (allowedActivityTypeIds سطر 68) لكن لا تُحرَّر من أي شاشة.

#### `technical-paths/page.tsx` (261 سطراً) + `technical-stages-manager.tsx` (384 سطراً)
- ثلاثية النشاط → الخدمة → المسار + مدير المراحل (ترتيب يدوي، ربط تسلسلي DAG عبر `nextStageIds` مع منع الحلقات بحساب الأسلاف 155-164، أقسام مسؤولة `allowedDepartmentIds`، تتبع زمني/عددي).
- **الأعطال:**
  - **P0/P1 (خدمة `technical-path-service.ts:63-66, 79-82, 95-98`):** حذف النشاط/الخدمة/المسار **حذف فردي بلا Cascade** بينما الواجهة تعد صراحة (سطر 248: «سيؤدي هذا لحذف كافة العناصر والخدمات التابعة») — النتيجة: خدمات ومسارات ومراحل يتيمة تظل قابلة للاختيار في المعاملات الجديدة والقوالب.
  - **P1 (مدير المراحل سطر 92-93):** `isRequired/isEditable` يُحفظان (افتراضي true) **بلا أي مفتاح تبديل في الواجهة** — حقلان ميتان.
  - **P1:** لا بوابة صلاحيات على الصفحة ولا على مدير المراحل.
  - **P2:** `GripVertical, Save, Settings2` أيقونات ميتة؛ حقل `code` يُولّد تلقائياً من الاسم (سطر 86) بلا تفرّد.

### 3.10 `/dashboard/checklists/` — النسخة القديمة الموازية (1175 سطراً)
- **P1:** الحاوية نفسها **يتيمة** (لا روابط)، لكنها تُرضي نفس المجموعات — أي تعديل فيها يتصادم مع الجديدة (نفس الخدمات).
- **`service-types/page.tsx` (162 سطراً):** الوحيدة التي تكتب في مجموعة `serviceTypes` المنفصلة (مع color/moduleScope) — **غير موجودة في تبويبات حاويتها** ⇒ صفحة+مجموعة+خدمة (`service-type-service.ts`) ميتة كاملة. **كما أنها الوحيدة التي تتيح تعديل لون النشاط وترتيبه ووصفه — ميزة فقدتها النسخة الجديدة.**
- الفروقات عن الجديدة (diff): بلا ترتيب `order` في الاستعلامات القديمة (orderBy name بدلاً من order في التقنية)، بلا أزرار حذف/بحث في departments القديمة، بلا AlertDialog في geo القديمة — النسخة الجديدة أكثر نضجاً.

### 3.11 `components/settings/work-hours-manager.tsx` (375 سطراً)
- ثلاث جداول (architectural / meetingRooms / fieldWork) + نصف دوام + عطل أسبوعية ورسمية. حفظ عبر `WorkHoursService.setDoc(merge)`.
- **الأعطال:**
  - **P1:** **لا توجد واجهة لرمضان إطلاقاً** رغم أن المحرك يدعمه بأولوية قصوى (`work-hours-engine.ts:50-61, 112-129`) والإعدادات الافتراضية تعرّفه (`work-hours-service.ts:84-96` مع enabled:false) — ميزة مخفية معطلة.
  - **P1:** جدول `general` موجود في النوع والافتراضيات (`types/work-hours.ts:45`) لكن `buildDaySlots` يقبل 3 نطاقات فقط — جدول ميت.
  - **P1:** `bufferMinutes` (فترة السماح) تُحرَّر في الواجهة (سطر 192) لكن **محرك البناء يتجاهلها تماماً** (`generateTimeSlots` يستخدم duration+rest فقط) — قيمة تجميلية تخدع المستخدم (تُستهلك في `attendance-import-service.ts` فقط).
  - **P2 سطر 69:** وصف toast للحفظ يستخدم `t('entryAdded')` — نص غير مناسب («تمت إضافة إدخال» عند حفظ الإعدادات).
  - **P1:** الصفحة بلا بوابة صلاحيات — أي مستخدم يغيّر دوام الشركة كله.

### 3.12 `components/settings/checklists/boq-master/boq-master-selector.tsx` — Stub محذوف (5 أسطر). ✅
### 3.13 `components/settings/checklists/boq-reference/boq-reference-selector.tsx` (217 سطراً)
- منتقي بند BOQ بمستويين (قسم جذري → أبناء)، فلترة بـ `resolveNodeEffectiveServices` من `lib/boq-tree-utils`.
- **P2 سطر 174-183:** النقر على مجموعة يغوص لمستوى أعمق **بلا زر رجوع** ولا مسار تنقّل — الأشجار الأعمق من مستويين شبه عصيّ على التنقل.
- **P2 سطر 137,203:** نصوص إنجليزية ثابتة «No matches / No items» بلا ترجمة.

### 3.14 `dashboard/meetings/page.tsx` (40 سطراً) + `components/meetings/meeting-rooms-view.tsx` (841 سطراً)
- **الغرض:** رادار حجز القاعات: شبكة خانات زمنية مبنية من `WorkHoursEngine.buildDaySlots(..., 'meetingRooms')`، حجز موعد قاعة (hall_meeting) مع تعارضات (قاعة/عميل/مهندس) وسلسلة إنجاز.
- **قواعد عمل حقيقية:** منع الحجز الماضي لغير الأدمن (567-570)، فحص تعارض القاعة/العميل/المهندسين (574-587)، **القيد التسلسلي** عبر `transactionStages` + `allowedDepartmentIds` (519-548): لا حجز لقسم قبل إنجاز مرحلة سابقة تخصّه.
- **الأعطال:**
  - **P1 سطر 425-432:** فلترة الأقسام بـ **تخمين الأسماء**: `nAr.includes('معماري') || nEn.toLowerCase().includes('arch')` لاستبعاد القسم المعماري من حجز القاعات — قاعدة عمل hardcoded بالاسم تكسر نفسها لو غيّر العميل اسم القسم (مثال: قسم «Research» سيُستبعد خطأً).
  - **P2 سطر 210:** نسبة الإشغال = المواعيد ÷ (عدد القاعات × **8**) — الرقم 8 ثابت لا يعكس إعدادات الخانات الفعلية.
  - **P2 سطر 813-816:** الحقل المسمّى «ملاحظات» (Label notes) مرتبط بـ `formData.title` — تسمية خاطئة تربك المستخدم.
  - **P1 سطر 614,644:** التدقيق (`createdBy/recordedByName`) يخزن **اسم** المستخدم النصي لا uid — مراجعة تاريخية ضعيفة.
  - **P2:** نقرات الشبكة تفتح حجزاً قبل فحص الصلاحيات (لا check لـ `ref`/`appointments`).

---

## 4) الخدمات (src/services/) — خلاصة التحليل

| الخدمة | السطور | الحمايات | المشاكل الجوهرية |
|--------|--------|----------|------------------|
| `reference-list-service.ts` | 208 | update يرفض !isEditable (125-133)، delete يرفض isSystem&&!isEditable (160-162) | **عدم تماثل**: عنصر isSystem=true وisEditable=true **يمكن حذفه**؛ `seedAllLists` ميتة؛ `createCustomList/getCustomListsMetadata` ميتة |
| `reference-service.ts` | 118 | لا شيء | بديل قديم متوازٍ لـ TechnicalPathService — بلا إنفاذ ولا حماية (بقي مستهلك وحيد: تعليقات) |
| `technical-path-service.ts` | 137 | لا شيء | **حذف بلا Cascade** (P0/P1)؛ `getAllCompanyStages` collectionGroup مع where companyId (سليم) |
| `department-service.ts` | 100 | handleWriteError فقط | حذف قسم لا يحذف وظائفه؛ لا فحص ارتباط موظفين |
| `location-service.ts` | 93 | handleWriteError فقط | حذف محافظة لا يحذف مناطقها |
| `service-type-service.ts` | 66 | errorEmitter | تخدم مجموعة ميتة |
| `boq-reference-service.ts` | 171 | ensureActionPermission ×3 + منع حذف أب | تكرار كود التوليد الآلي (73-79)؛ الوراثة تُخزَّن فراغات من الواجهة |
| `boq-master-service.ts` | 5 | — | Stub محذوف ✅ |
| `work-hours-service.ts` | 99 | — | defaults سليمة؛ إخفاء أخطاء القراءة بنص console.warn فقط (44-47) |
| `work-hours-engine.ts` | 172 | — | يتجاهل bufferMinutes؛ رمضان يعمل بلا واجهة |
| `working-days-service.ts` | 141 | — | قانون العمل الكويتي (م70: 30يوم/سنة، م69: شرائح مرضي 15/25/35/45، أهلية 6 أشهر بـ 30.44) — **منطق سليم ومهم جداً للنقل** |
| `cost-rate-service.ts` | 90 | — | ميتة بالكامل؛ activateCard بسباق |
| `role-service.ts` | 174 | فحص '*' من طرف العميل | seedInitialRoles بلا تكرار-حماية؛ الاعتماد على client-side فقط |
| `permission-service.ts` | 116 | hr:edit للاعتماد | «الاستئذان» (3سا/12سا شهرياً/تعارض إجازة) إنفاذ عميل فقط؛ **تسمية مضللة** (موارد بشرية لا صلاحيات أمنية) |
| `user-service.ts` | 175 | — | إنشاء Auth من المتصفح بتطبيق مؤقت + تراجع يدوي (95-101)؛ لا تفرّد username؛ toggle يحدّث الوثيقتين |
| `seed-service.ts` | 237 | — | **purgeSystemData: batch بلا حد 500 + لا يحذف المجموعات الفرعية** (stageInstances/timeline/comments تحت كل معاملة) ⇒ فشل على بيانات حقيقية وبيانات يتيمة؛ runSeed بلا حماية تكرار ولا يزرع إلا أقساماً |
| `template-service.ts` | 168 | ensureActionPermission ref:edit/delete | سليمة نسبياً — أفضل مثال على نمط الرأس/البنود |

---

## 5) جدول الأعطال الموحّد (بالسطر)

### P0 — انهيار / ميزة ميتة / خطر أمني مباشر
| # | الملف : السطر | الاقتباس | الأثر |
|---|----------------|-----------|-------|
| P0-1 | `settings/users/page.tsx:306` | `{showPassMap[u.id] ? u.initialPassword : '••••••••'}` | عمود كلمة المرور يقرأ حقلًا غير موجود (undefined) — ميزة ميتة ومضللة، وأثر تصميمي خطير (تخزين كلمة مرور نصياً سابقاً) |
| P0-2 | `lib/permissions/engine.ts:28` + `hooks/use-permissions.ts:20` + `context/auth-context.tsx:74` | `userEmail === 'admin@novaflow.com'` | بريد إداري سحري hardcoded يمنح صلاحية مطلقة في كل النظام لمن يسجّل به |
| P0-3 | `settings/checklists/seed-tool.tsx:64-77` + `seed-service.ts:57-71` | `await service.purgeSystemData();` | تطهير شامل بلا بوابة صلاحيات + batch بلا حد 500 (يفشل على >500 سجل) + **لا يحذف المجموعات الفرعية** (stageInstances/timeline/comments) ⇒ بيانات يتيمة تُرجع السجلات جزئياً |
| P0-4 | `technical-path-service.ts:63-98,119-122` (وعد الواجهة `technical-paths/page.tsx:248`) | `deleteDoc(doc(this.db, path, id));` فقط | حذف نشاط/خدمة/مسار بلا Cascade ⇒ عناصر مرجعية يتيمة تظل قابلة للربط في مشاريع وقوالب جديدة |
| P0-5 | `settings/checklists/departments/page.tsx:63-85` مع `174-189` | `const selectedRole = roles?.find(r => r.id === jobForm.roleId);` | ربط الوظيفة بالدور/التكلفة الساعية **بلا أي حقول إدخال** — roleName/roleCode/hourlyCost تُحفظ '' دائماً؛ ونص الأدوار (`roles/page.tsx:171`) يوجّه المستخدم لميزة غير موجودة |

### P1 — منطق/مالي
| # | الملف : السطر | الاقتباس | الأثر |
|---|----------------|-----------|-------|
| P1-1 | `role-service.ts:160-170` + `roles/page.tsx:58-66` | `initialRoles.forEach(r => { const newRef = doc(rolesRef); batch.set(...) })` | بذر الأدوار يكرر ADMIN/ENGINEER/ACCOUNTANT في كل تشغيل (الزر ميت حالياً لكن الدالة معرّضة) |
| P1-2 | `role-matrix-form.tsx:84-89` | `permissions: Array.from(new Set(generatedPerms))` | إعادة توليد permissions من المصفوفة تمسح أي صلاحية كلاسيكية خارج النمط (مثل `hr:payroll` المبذورة) |
| P1-3 | `boq-reference-service.ts:73-79` | `const nextIndex = siblingsSnap.size + 1;` | تكرار الأكواد المرجعية بعد أي حذف شقيق |
| P1-4 | `general-lists/page.tsx:151,160,174-180` | `{item.feePercentage ? ... : '-'}` | عمولات طرق الدفع تُعرض ولا تُحرَّر ولا تُستهلك في أي حساب — ميزة ميتة من الطرفين |
| P1-5 | `meeting-rooms-view.tsx:429` | `nAr.includes('معماري') \|\| nEn.toLowerCase().includes('arch')` | قاعدة عمل hardcoded بتخمين اسم القسم |
| P1-6 | `work-hours-manager.tsx` (غياب تام) + `work-hours-engine.ts:50-61` | `isWithinRamadan(...)` | محرك رمضان كامل بلا أي واجهة — ميزة مخفية معطلة |
| P1-7 | `work-hours-manager.tsx:192` + `work-hours-engine.ts:16-45` | `bufferMinutes` | فترة السماح تُحرَّر ولا يدخلها المحرك — قيمة وهمية |
| P1-8 | `seed-tool.tsx:38-49` + `seed-service.ts:206-218` | `await service.runSeed();` | بذر بلا حماية تكرار + وعد نصي بضخ جغرافيا/تقنية/قوائم لا يُنفَّذ (القوائم الست `seedAllLists` ميتة أصلاً) |
| P1-9 | `cost-centers/page.tsx` و `profit-centers/page.tsx` (كاملان) | لا `usePermissions` | تعديل البنية المالية التحليلية بلا بوابات (وheat: `seed-tool`, `departments`, `geo`, `technical-paths`, `work-hours`, `users` بنفس الوضع) |
| P1-10 | `users/page.tsx` (كاملة) | — | إنشاء حسابات Auth من المتصفح + لا تفرّد username + بوابة صلاحيات غائبة عن الصفحة |
| P1-11 | `company/page.tsx:66` | `updateDoc(companyRef, { ...formData, ... })` | إعادة كتابة 8 حقول منها 6 بلا واجهة (headerText/footerText تُطبع ولا تُحرَّر) |
| P1-12 | `profile/page.tsx:61` + `users/page.tsx` | `username` | لا تفرّد اسم مستخدم في أي مسار |
| P1-13 | `working-days-service.ts:64` مقابل `seed-tool.tsx:95` | `30/365.25` مقابل «2.5 يوم/شهر» | تعارض صيغ الاستحقاق بين النص والمحرك (2.474 vs 2.5) |
| P1-14 | `reference-list-service.ts:160` مقابل `general-lists/page.tsx:187` | `if (current.isSystem && !current.isEditable)` | عدم تماثل حماية الحذف: عنصر نظامي قابل للتعديل قابل للحذف من الواجهة |
| P1-15 | `locations/departments` حذف | `deleteDoc` فردي | أيتام مناطق/وظائف عند حذف الأب |

### P2 — تجربة مستخدم / نظافة كود
| # | الملف : السطر | الملاحظة |
|---|----------------|----------|
| P2-1 | `users/page.tsx:288` | صور مزيفة `picsum.photos` بمعرف المستخدم (تسريب خارجي) |
| P2-2 | `boq-nodes/page.tsx:63,347` | صندوق بحث شكلي لا يفلتر |
| P2-3 | `boq-nodes/page.tsx:545` | «لم يتم العور» خطأ إملائي |
| P2-4 | `role-form.tsx` + `permissions-list.ts` | مكونات ميتة (تصنيف صلاحيات متوازٍ قديم) |
| P2-5 | `settings/reference-lists/page.tsx` كاملة | صفحة يتيمة مكررة لـ general-lists |
| P2-6 | `dashboard/checklists/*` (1175 سطراً) | نسخة قديمة كاملة يتيمة بما فيها service-types (المصدر الوحيد لمجموعة serviceTypes الميتة) |
| P2-7 | `CostRateService` + `types/cost-rate.ts` + `catalog.ts:60-65` | خدمة ونوع وصلاحية `cost_rates` لميزة محذوفة |
| P2-8 | `company/page.tsx:49-59` | handleFileUpload كود ميت (لا رفع شعار رغم عرضه في الطباعة) |
| P2-9 | `roles/page.tsx:40-44` | useEffect فارغ |
| P2-10 | `technical-stages-manager.tsx:92-93` | isRequired/isEditable بلا UI |
| P2-11 | `work-hours-manager.tsx:69` | toast حفظ بنص «entryAdded» |
| P2-12 | `meeting-rooms-view.tsx:210` | إشغال ÷ 8 ثابت؛ `:813-816` حقل «ملاحظات» مرتبط بالعنوان |
| P2-13 | `boq-reference-selector.tsx:174-203` | تنقل بلا رجوع + نصوص غير مترجمة |
| P2-14 | `departments/page.tsx:128` | بحث case-sensitive بالعربي فقط |
| P2-15 | حقول ميتة في `types/reference.ts:172-177` | billingTriggerGroup / allowedItemCategoryIds / allowedServiceIds بلا واجهات |
| P2-16 | cost-centers/profit-centers/halls | كتابة حقل `id` داخل المستند عند التعديل |
| P2-17 | `work-hours-service.ts:45` + `types/work-hours.ts:45` | جدول `general` ميت + أخطاء القراءة تبتلع بصمت |

---

## 6) المزايا المخفية التي لم تُذكر في المراجعات السابقة

1. **القيد التسلسلي للحجز الميداني** (`meeting-rooms-view.tsx:519-548`): لا يمكن حجز اجتماع لقسم قبل إنجاز المراحل السابقة التي يشارك فيها — منطق مخفي ذكي يعتمد `stageInstances.allowedDepartmentIds` ويستحق التوثيق والنقل كما هو.
2. **مصفوفة النطاقات (Scope) الحقيقية** (`engine.ts:77-102`): التنفيذ الميداني `canPerformOnRecord` يقارن `dept` عبر `departmentId` و`own` عبر `createdBy` — طبقة إذن على مستوى السجل لا تظهر في أي شاشة.
3. **محرك قانون العمل الكويتي الكامل** (`working-days-service.ts`): شرائح الإجازة المرضية 15/25/35/45 بأربع نسب رواتب (م69)، استحقاق 30/365.25 (م70)، استبعاد عطل أسبوعية/رسمية من الحساب (م70)، بوابة الأهلية 6 أشهر — منطق جاهز للنقل حرفياً إلى Prisma/Service layer.
4. **رمضان في محرك المواعيد** (engine:50-61,112-129 بأولوية عليا) — موجود ومكتمل المنطق ويتيم بلا واجهة.
5. **التوليد التلقائي الهرمي لأكواد BOQ** (`boq-reference-service.ts:71-80`): `[كود الأب].[التسلسل]` مع عدّاد أبناء `childrenCount` و`increment` — نمط عدّادات جيد (نظيره الآمن `lib/counters.ts` بـ runTransaction مستخدم في 5 خدمات مالية).
6. **«مفتاح الأدمن السيادي» بالمصفوفة** (`role-service.ts:129`): دور ADMIN يبذر `matrix: [{resourceId:'*', action:'view', scope:'all'}]` + wildcard في hasResourceAccess — تصميم يجب توحيده في ConTrack.
7. **بوابة مزدوجة للمرجعيات**: UI (`check('ref',...)`) + خدمة (`ensureActionPermission`) — النمط الوحيد المنفّذ بشكل صحيح طبقة-طبقة في `boq-reference-service` و`template-service` و`role-service`.
8. **أداة `SmartDateInput`** في إضافة العطلات (`work-hours-manager.tsx:340`) — مكوّن ذكي للتحويل بين صيغ التواريخ.
9. **الوراثة التشغيلية في شجرة BOQ** (`resolveInheritedContext`): البند اليتيم يرث نشاط أبيه وقت العرض — مفهوم مركزي لنموذج البيانات الجديد.
10. **عرض كلمات المرور «المبدئية» كفكرة تصميمية** — وإن كانت معطلة الآن، وجودها كعمود دائم في جدول المستخدمين خطر متكرر يجب منعه بنيوياً في ConTrack.

---

## 7) البيانات المزيفة / Hardcoded

| الموضع | القيمة | التصنيف |
|--------|--------|---------|
| `users/page.tsx:288` | `https://picsum.photos/seed/{uid}/100/100` | بيانات مزيفة خارجية |
| `engine.ts:28`, `use-permissions.ts:20`, `auth-context.tsx:74` | `admin@novaflow.com` | هوية سحرية hardcoded |
| `meeting-rooms-view.tsx:429` | `'معماري' / 'arch'` | قاعدة عمل بتخمين اسم |
| `meeting-rooms-view.tsx:210` | `* 8` خانات | رقم سحري للإشغال |
| `seed-service.ts:93-117,146-169` | شجرة حسابات + مركزا افتراض (CC-100/PC-100) | بذر مرجعي مقصود (مقبول لكنه كويتي-محدد) |
| `seed-data.ts` كاملاً | أقسام/جغرافيا/قوائم/مسارات «النموذج الهندسي الكويتي» | بذر مرجعي (جزء منه لا يُبذر فعلياً — §2) |
| `work-hours-service.ts:60-98` | دوام 08:00-13:00، جمعة عطلة، خميس نصف دوام | افتراضيات منطقية لكنها ترث افتراضات ثقافية ثابتة |
| `role-service.ts:123-158` | أدوار ADMIN/ENGINEER/ACCOUNTANT بترجمة وصلاحيات | بذر مرجعي |
| `roles/page.tsx:252` | نص «N نجمة» | عرض رمزي للمصفوفة |
| `users/page.tsx:246` | `P@ssw0rd123` | placeholder بلا سياسة |

---

## 8) ملاحظات أمنية (خلاصة)

1. **كل الإنفاذ من طرف العميل**: `hasResourceAccess/ensureActionPermission/role-service '*'` كلها JS في المتصفح — الحماية الفعلية الوحيدة قواعد Firestore (خارج نطاق هذا التقرير، يجب تدقيقها). أي صفحة نسيت بوابتها (users, cost-centers, profit-centers, checklists hub, work-hours, technical-paths, departments, geo) هي مفتوحة وظيفياً إن سمحت القواعد.
2. **إنشاء مستخدمي Auth من المتصفح** (`user-service.ts:50-103`) يكشف `firebaseConfig` وسلوك الحذف اليدوي عند فشل batch — في ConTrack يجب أن يكون عبر Admin API خلفي حصراً.
3. **البريد السحري** `admin@novaflow.com` في 3 مواضع = باب خلفي توثيقي.
4. **عمود كلمة المرور** في جدول المستخدمين (حتى لو معطلاً) يجب حذفه بنيوياً.
5. **التدقيق بالأسماء لا بالمعرفات** (`recordedByName/createdBy` نص) يضعف التتبع.
6. **الحذف الشامل (purge)** بلا RBA ولا تأكيد كتابي (type-to-confirm) ولا نسخ احتياطي.
7. سجل تجاري/بيانات هوية تُطبع في كل مستند بلا تحقق إدخال.

---

## 9) ما يستحق النقل إلى ConTrack (Prisma/PostgreSQL) وما لا يستحق

### ✅ يستحق النقل (اللب الحقيقي)
| العنصر | لماذا | شكل مقترح في ConTrack |
|--------|-------|------------------------|
| الشجرة الفنية الرباعية (ActivityType→Service→SubService→TechnicalStage) | عمود النظام؛ Firestore 4 مستويات متداخلة سبب الأيتام والاستعلامات المعقدة | 4 جداول بـ FK + `ON DELETE CASCADE` صريح (يُصلح P0-4 بنيوياً) + UNIQUE(code, scope) |
| شجرة boqReferenceNodes (المسطّحة) | «لب اللب»؛ المسطّح مع parentId/depth/ancestorIds ينقل كما هو مع CHECK + FK ذاتي + منع حذف أب بـ trigger أو قيد | جدول واحد + recursive CTE بدل buildTree بالذاكرة |
| القوائم الست المرجعية (unitTypes, paymentMethods...) | قواميس معيارية؛ النقل يتيح FKs حقيقية وإنهاء الأكواد المتكررة | جداول lookup عامة أو جداول منفصلة + FK من كل المستهلكين (يشترط توظيف paymentConditionTypes وmilestoneTimingTypes فعلياً أو إسقاطها) |
| مراكز التكلفة/الربحية | أبعاد مالية تحتاج تكامل مع ledger | جدولان + FK إلى Project + UNIQUE(code) |
| مواعيد العمل (بما فيها رمضان وbuffer) | منطق مكتمل ناقص واجهة؛ في SQL يسهل استخراج الخانات بـ generate_series | جدول work_hours_config (JSONB أو أعمدة) + جدول public_holidays |
| working-days-service (قانون العمل) | منطق مالي-قانوني صحيح ومستقل — أفضل مرشح للنقل | دوال/خدمة تُختبر unit-tests |
| الأدوار والمصفوفة (roles + matrix + scopes) | مصدر الحقيقة الأمني | جداول roles/permission_rules(resource, action, scope) + إنفاذ خادمي حصرياً + إسقاط بريد novaflow |
| users/global_users | هوية مزدوجة تسببت بتزامن يدوي في 3 أماكن | جدول users واحد + membership (company_id, role) — ينهي ثنائية global/tenant |
| القيد التسلسلي للحجز (stages+allowedDepartmentIds) | منطق مخفي عالي القيمة | علاقة stage_departments + فحص خادمي عند الحجز |
| عدّادات nextSequential/counters | نمط سليم جاهز | جدول counters + SELECT FOR UPDATE |

### ❌ لا يستحق النقل (يُسقط أو يُستبدل)
| العنصر | لماذا |
|--------|-------|
| `permissions-list.ts` + `role-form.tsx` | تصنيف قديم متوازٍ وكود ميت — يتعارضان مع catalog |
| `CostRateService` + `types/cost-rate.ts` + صلاحية `cost_rates` | ميزة محذوفة بالكامل |
| `serviceTypes` (مجموعة+صفحة+خدمة) | ميتة؛ دمج ما يلزم منها (color/moduleScope) في activityTypes إن طُلب |
| `customReferenceLists` + createCustomList | ميزة قوائم ديناميكية ميتة — إن أُريدت لاحقاً تُبنى metadata-driven بجدول واحد |
| `reference-service.ts` | بديل قديم لـ TechnicalPathService |
| `/dashboard/checklists/*` بالكامل | نسخة موازية يتيمة |
| `/dashboard/settings/reference-lists` | مكررة لـ general-lists |
| `initialPassword` (العمود والمفهوم) | خطر أمني دائم |
| `headerImageUrl/footerImageUrl` | بلا مستهلك |
| حقول BOQ الوهمية غير المحرَّرة (billingTriggerGroup, allowedItemCategoryIds, allowedServiceIds) | إما تنفيذ واجهاتها في ConTrack أو إسقاطها من النوع |
| إعادة تنفيذ بذر مكرر (runSeed/seedInitialRoles بدون dedup) | في ConTrack تُستبدل migrations/seed idempotent |

### ⚠️ يُنقل بعد إصلاح
- **الحذف المتسلسل** في كل الخدمات المرجعية → CASCADE/soft-delete + فحص ارتباطات.
- **تفرّد الأكواد** (reference lists, BOQ codes, cost centers, stages) → قيود UNIQUE في SQL.
- **بوابات الصلاحيات** في الصفحات الثماني غير المحمية → middleware خادمي.
- **فلاتر الأسماء hardcoded** (معماري/arch) → وصف بنيوي على القسم (مثلاً dept.kind).

---

## 10) الخلاصة التنفيذية

- الوحدة هي فعلاً «لب النظام»: كل شيء يبدأ من القوائم المرجعية، لكن **4 من 6 قوائم عامة ميتة تشغيلياً**، والبذر الآلي للقوائم **معطّل بالكامل** (`seedAllLists` بلا مستدعٍ)، وأداة البذر الجديدة تزرع الأقسام فقط مع وعد نصي أوسع.
- أخطر ثلاثية: **عمود كلمة المرور الميت/الخطير**، **البريد السحري الممنوح صلاحية مطلقة**، **التطهير الشامل غير المحمي وغير الذري**.
- النمط المتكرر الأذى: **حذف بلا Cascade** (خدمات المسار الفني، الجغرافيا، الأقسام) + **غياب تفرّد الأكواد** + **صفحات بلا بوابات**.
- كود ميت بحجم مقلق: نسخة checklists قديمة كاملة (1175 سطراً)، صفحة reference-lists مكررة، role-form + permissions-list، CostRateService، serviceTypes، customReferenceLists — **≈ 2,000 سطر قابل للحذف فوراً**.
- أفضل أنماط الوحدة الجاهزة للنقل: boq-reference-service (إنفاذ مزدوج + عدّادات أبناء)، template-service (رأس/بنود)، working-days-service (قانون العمل)، work-hours-engine (بعد إضافة واجهة رمضان وbuffer)، counters (transactional).

**التوصية الأولى للتنفيذ في ConTrack:** نموذج بيانات علائقي بشجرة فنية بـ CASCADE + UNIQUE، قاموس lookup موحّد مع FKs من المستهلكين، إنفاذ صلاحيات خادمي واحد يغني عن بوابات الواجهة، وإسقاط كل ما عُدّ ميتاً أعلاه.
