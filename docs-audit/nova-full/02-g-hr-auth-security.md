# Task 2-g: مراجعة HR الكامل + المصادقة والأمان والبنية — NOVA ERP
> المراجع: خبير كود | النطاق: موديول HR (قانون العمل الكويتي 6/2010) + Auth + Firestore Rules + بنية التطبيق
> المشروع: `/home/z/review-nova` (Next.js 15 + Firebase) | المشروع القديم المعاد هندسته لاحقاً في ConTrack
> عدد الملفات المقروءة بالكامل: **~85 ملفاً** (29 صفحة HR، 4 مكوّنات HR، 11 صفحة دخول/بنية، 4 إعدادات نشر/قواعد، 3 سياقات، 10 ملفات firebase/*، 10 خدمات، 4 أنواع، 3 hooks، 5 مكونات Layout، محرك الصلاحيات)

---

## القسم 0: خريطة الموديول والعلاقات

```
global_users/{uid}  ←→  companies/{cid}/
   (roleCode, companyId,     employees/  → {id}/auditLogs/
    employeeId, departmentId) leaveRequests/   permissionRequests/
                              attendance/      payroll/{batchId}/records/
                              applications/    invitations/  roles/  departments/{d}/jobs/
```
- الهوية المزدوجة: Firebase Auth (uid) + وثيقة `global_users` تحمل `companyId/roleId/roleCode/employeeId/departmentId`.
- كل استعلام HR يُبنى عبر `paths()` في `src/firebase/multi-tenant.ts` (س1–74) → `companies/{cid}/...`.
- ربط الموظف↔الحساب: `employee.roleId` يحدد دور الوصول، و`syncGlobalUserData` في hr-service يزامن `global_users`.

---

## القسم 1: محركات قانون العمل الكويتي — المعادلات كما هي مكتوبة في الكود

### 1.1 مكافأة نهاية الخدمة — `src/services/gratuity-service.ts` (المواد 51/53/44)
الملف الوحيد الفعّال (`end-of-service-calculator.ts` س1–7 مجرد stub كُتب فيه حرفياً: *"THIS FILE IS DELETED... moved to GratuityService"*).

| المكوّن القانوني | السطر | المعادلة في الكود | الحكم |
|---|---|---|---|
| م51: أول 5 سنوات | 57–58 | `serviceYears * (dailyWage * 15)` حيث `dailyWage = totalSalary / 26` | ✅ صحيح (15 يوم/سنة بقاعدة الـ26) |
| م51: ما بعد 5 سنوات | 59–63 | `5*(dailyWage*15) + (serviceYears-5) * totalSalary` (الشهر = 26×الأجر اليومي = الراتب) | ✅ صحيح رياضياً |
| التناسب الجزئي | 49 | `serviceYears = totalDays / 365.25` | ✅ تقريب مقبول |
| سقف 18 شهراً | 66–71 | `cap = totalSalary * 18; isCapped = baseGratuity > cap` | ✅ مطابق لمادة 51 أخيراً |
| م53 استقالة <3 سنوات | 76–78 | `factor = 0` | ✅ |
| م53 استقالة 3–5 | 79–81 | `factor = 0.5` | ✅ (نصف) |
| م53 استقالة 5–10 | 82–84 | `factor = 0.6666` | ⚠️ يجب 2/3 = 0.66667 (خطأ تقريب يضيع فلسات على مدة 10 سنوات) |
| م53 استقالة ≥10 | 85–88 | `factor = 1` | ✅ |
| م41 فصل تأديبي | 89–92 | `factor = 0` | ✅ |
| م44 بدل الإنذار | 104–110 | `± totalSalary * 3` (3 أشهر) | ✅ لكن لا يطبق م45 (يوم بحث عن عمل أسبوعياً) إلا كنص UI فقط |
| مقابل رصيد الإجازات | 98–100 | `remainingLeaveDays * (totalSalary/26)` | ✅ قاعدة الـ26 صحيحة |
| الإجمالي | 112 | `finalGratuity + leaveBalancePay + noticeIndemnity` | ✅ |

**الثغرات القانونية في المحرك:**
1. **الراتب الشامل مصدره أساساً صفر** — `gratuity/page.tsx` س57 و`gratuity-calculator/page.tsx` س58 يحسبان: `basic + housing + transport + other`، لكن **نموذج الموظف `employee-form.tsx` لا يحتوي أي حقل لإدخال housing/transport/otherAllowances إطلاقاً** (س43–68 يعرّف basicSalary فقط). النتيجة: التصفية تُحسب على الأساسي وحده → عجز قانوني في مستحقات الموظف (P1).
2. حالات م52 (وفاة/عجز) وم53/فقرة الاستقالة بسبب إخلال صاحب العمل (استحقاق كامل) غير مُنمذجة.
3. لا يوجد أي حفظ/سجل لعملية التسوية — حاسبة فقط، النتيجة تضيع عند refresh.

### 1.2 حسبة الـ26
- تستخدم في: الأجر اليومي للتصفية (gratuity-service س52)، الخصم في الرواتب (payroll-service س72)، مخصصات الشهر (س92–94)، إعادة تقييم المخصصات (hr-service س100–108).
- ⚠️ في payroll الخصم يُحسب على `basicSalary/26` فقط بينما القانون يخصم الغياب من **الأجر الشامل** — والبدلات تُضاف للصافي (س88–105) → خصم ناقص عن يوم الغياب.

### 1.3 الإجازات (م69/70) — `working-days-service.ts`
- **م70 الاستحقاق**: `calculateAccruedLeave` س54–70: `(totalDays/365.25)*30` = 2.5 يوم/شهر ✅، لكنه **غير مربوط برصيد الموظف**: النموذج يبدأ `annualLeaveBalance: 30` مُسبقاً (employee-form س66 و125–126 "ضمان عدم البدء بصفر") بينما كشف الحركة (statement/[id] س74) يبني دفتراً مستقلاً بـ +2.5/شهر → **تضارب حتمي بين الرصيد المعروض وكشف الحركة الرسمي**.
- **قاعدة الـ6 أشهر**: `isEligibleForLeave` س75–90: `months = days/30.44 >= 6` ✅، مفروضة في الواجهة فقط (leaves/new س133–142) وليست في الخدمة/القواعد.
- **م70 استبعاد الجمعة والعطلات**: `calculateWorkingDays` س18–48 يستثني `holidays` الأسبوعية و`publicHolidays` ✅.
- **م69 المرضية**: `calculateSickLeaveBreakdown` س95–140 يبني الشرائح (15 كامل/10 بـ75%/10 بـ50%/10 بـ25%/الباقي بدون) ✅ — **لكن grep يثبت أنها غير مستدعاة في أي مكان** (`LeaveTiersDisplay` + التعريف فقط). عملياً `leave-service.ts` س163–164 يخصم المرضية من `sickLeaveBalance` (الافتراضي 15) بدون شرائح، وpayroll يتخطى أيام الإجازة المعتمدة **بأجر كامل** (س79) → موظف مريض 60 يوماً يتقاضى كاملاً = مخالفة صريحة لمادة 69 (P1 قانوني).
- الاستئذان (`permission-service.ts`): سقف 3 ساعات/طلب (س30–32) و12 ساعة/شهر (س34–37) ومنع التعارض مع إجازة معتمدة (س39–42) — قواعد داخلية للشركة، منطقية، لكن `getMonthlyUsedHours` يسحب كل طلبات المستخدم بلا فلترة تاريخ في الاستعلام (س64–69) — كلفة قراءة تتصاعد.
- أنواع الإجازة: `annual | sick | emergency | unpaid` — **emergency لا يخصم أي رصيد** (leave-service س161–165 يخصم annual/sick فقط) و**unpaid لا يُعالج في payroll** (تُدفع) — تسريب مالي.

### 1.4 المخصصات المحاسبية
- **payroll-service س90–94**: `leaveProvision = dailyWage * 2.5` ✅ (2.5 يوم/شهر)، `gratuityProvision = dailyWage * 1.25` ✅ (1.25 يوم/شهر = 15 يوم/سنة) — **لكن ثابتة حتى بعد 5 سنوات** (المفروض 2.5/شهر = 30 يوم للسنة السادسة+) → مخصص مكافآت ناقص تراكمياً لكل موظف تجاوز 5 سنوات (P1).
- **الخصم على الأساسي لا الشامل**: المخصص يُبنى على `basicSalary/26` بينما التعهد المالي يجب أن يُحتسب على الأجر الشامل.
- **قيد المخصص لا يُسجَّل فعلياً**: payroll-service س149–165 يبني `jvData` ثم **يتركه كتعليق ميت** (تعليق المطور نفسه س163–164: "في بيئة حقيقية سنبحث عن المعرفات") — المخصصات المعلنة في الواجهة لا تصل للقيود أبداً (P1).
- `hr-service.revalueEmployeeProvisions` س94–122: يعيد التقييم عند زيادة الراتب بفارق الأجر اليومي × الأيام المتراكمة، لكن `gratuityDays = (accruedDays/30)*15` (س105) يفترض شريحة الـ5 سنوات للجميع → فجوة تقييم لمن تجاوز 5 سنوات.

---

## القسم 2: التدقيق الأمني الكامل

### 2.1 الجلسة والمصادقة
- **الدخول** (`login/page.tsx` س30–32): `signInWithEmailAndPassword` ثم يكتب كوكي **مزيف**: `document.cookie = "session=true; path=/; max-age=604800"`.
- **middleware.ts (س3–16) = no-op**: يعيد `NextResponse.next()` دائماً؛ فرع `if (pathname.startsWith('/dashboard')...)` فارغ تماماً. الكوكي المزيف لا يُفحص ولا يُستخدم. أي حماية مسارية server-side = **صفر**.
- **auth-context.tsx**: مصدر الحقيقة هو `onSnapshot(global_users/{uid})` (س68–96) + شيفرة المطور الصلبة س74: `if (user.email === 'admin@novaflow.com') → isDeveloper: true` — **البريد الإلكتروني المجاني هو مفتاح السيادة** في الواجهة وفي الـRules معاً.
- **developer/layout.tsx س25–31**: حماية لوحة المطور = فحص `globalUser?.isDeveloper` في العميل فقط.
- كوكي `session` يُحذف عند logout (auth-context س129) — لا قيمة أمنية أصلاً.

### 2.2 firestore.rules — سطراً بسطر (34 سطراً فعّالاً فقط!)
| الأسطر | القاعدة | التقييم |
|---|---|---|
| 12–14 | `isSovereignDev()`: `request.auth.token.email == 'admin@novaflow.com'` | 🔴 مفتاح سيد ببريد إلكتروني معروف في الريبو (config.ts س8 يكشف المشروع) |
| 23–30 | `isGlobalAdmin()`: roleCode/role == 'ADMIN' **بدون فحص companyId** | 🔴 أدمن شركة A = أدمن كل الشركات (اختراق مستأجرين) |
| 43–47 | `global_users`: `read/update` لصاحب الوثيقة نفسها | 🔴 **الجوهرة**: أي مستخدم مسجل يقدر يكتب `update` على وثيقته ويضع `roleCode: 'ADMIN'` أو يغيّر `companyId` لشركة أخرى → ترقية ذاتية + عبور مستأجرين |
| 46 | `allow write: if isSovereignDev()` | 🔴 `write` يشمل create → إنشاء `global_users` للموظف الجديد في **join page س64** مرفوض بالقواعد → **مسار التفعيل معطّل** (كما هو مكتوب) |
| 51–60 | `companies/{cid}` + `match /{allSubCollections=**} { read, write: belongsToCompany }` | 🔴 أي عضو في الشركة (USER) يقرأ/يكتب **كل شيء**: الرواتب، IBAN، الرقم المدني، الأدوار، الدعوات، payroll |
| 65–95 | collection-group للـ stages/fieldVisits/jobs/attendance... `read: belongsToCompany(resource.data.companyId)` | ⚠️ تكرار جزئي للـwildcard أعلاه؛ بدون قواعد كتابة مستقلة |
| 99–102 | `company_requests`: `create: if true` | 🔴 إنشاء مجهول بلا حدود (سبام)، والقراءة لكل "أدمن عالمي" (انظر 2.3) |

### 2.3 سلاسل اختراق كاملة (Chains) — مُستنتجة من الكود الحالي
1. **ترقية ذاتية P0**: عضو عادي → SDK → `update global_users/{uid} {roleCode:'ADMIN'}` (قاعدة س45 تسمح) → `isGlobalAdmin()` صار true في **كل** القواعد → قراءة/كتابة كل الشركات (س38: `belongsToCompany = isGlobalAdmin() || ...`).
2. **عبور مستأجرين P0**: نفس الآلية بتغيير `companyId` في وثيقة `global_users` إلى `companyId` ضحية.
3. **بريد كلمة المرور P0**: `register/page.tsx` س58 يخزن `proposedPassword: formData.password` **بنص صريح** في `company_requests` — والوثيقة تُقرأ بواسطة أي أدمن شركة أخرى (قاعدة س101)، وصفحة المطور تمسكها في `handleActivate` (developer/page.tsx س125: `password: req.proposedPassword`).
4. **تلاعب بالرواتب P1**: أي موظف يقدر يكتب على `companies/{cid}/payroll/**` و `employees/**` و `attendance/**` (قاعدة س58) — لا قاعدة field-level واحدة في الملف.
5. **المنفذ العملي**: كل ما سبق ساري ما لم تُنشر قواعد أخرى؛ الملف الحالي في الريبو هو المعيار الوحيد المتاح للمراجعة.

### 2.4 الصلاحيات في الكود (طبقة العميل)
- `use-permissions.ts` س15–31: `isAdmin` = developer || ownerUid || roleCode 'ADMIN' → يفتح `['*']` (س33–36).
- محرك `lib/permissions/engine.ts`: `hasResourceAccess` (س16–51) يقرأ `role.matrix`، و`canPerformOnRecord` (س77–102) يطبق own/dept/all على السجل.
- **ازدواجية نظامين**: `ensureActionPermission` يفحص مصفوفة `permissions: string[]` القديمة بينما الواجهة تفحص `matrix` — دور مُعرّف بالـmatrix فقط (permissions فارغة) سيرمي `UNAUTHORIZED_ACTION` في الخدمات رغم سماح الواجهة.
- **خدمات بلا فحص**: `LeaveService.updateRequestStatus` (س98–177) و`PayrollService.updateBatchStatus` (س170–173) و`HRService.terminateEmployee` (س146–150) وكل `AttendanceImportService`/`RecruitmentService` — الاعتماد على أزرار الواجهة فقط (`isAdmin`/`canApprove`).

---

## القسم 3: جدول الأعطال P0/P1/P2 (بالسطر والاقتباس)

### 🔴 P0 — حجب/تلف/بيانات مزيفة في الأرقام المالية
| # | الملف:السطر | الاقتباس | الأثر |
|---|---|---|---|
| P0-1 | `reports/payroll/individual/[id]/page.tsx:47-48` | `deductions: Math.floor(Math.random() * 20), net: (employee?.basicSalary \|\| 0) - Math.floor(Math.random() * 20)` | **سجل رواتب الموظف الرسمي القابل للطباعة يعرض خصومات وصافي عشوائي** — بيانات مزيفة في مستند مالي رسمي؛ يستورد `PayrollRecord` ولا يقرأ subcollection records أصلاً |
| P0-2 | `payroll-service.ts:82-85` + `attendance-import-service.ts:223-237` | `if (!record \|\| record.status === 'absent') { unjustifiedAbsenceDays++; totalDeductions += dailyWage; }` / `batch.set(docRef, ...)` بمعرّف تلقائي بلا upsert | **خصم راتب غير مشروع**: كل يوم تقويمي بلا سجل = غياب. الاستيراد لا يولّد أسجّل لعمود إكسل غير الموجود → عطلات/جُمَع غير مرفوعة في الملف تُخصم كغياب؛ وأيام ما قبل `hireDate` تُخصم أيضاً (لا فحص للتعيين)؛ وإعادة رفع نفس الشهر تضاعف السجلات (لا dedup على employeeId+date) |
| P0-3 | `firestore.rules:45` | `allow update: if isAuthenticated() && (request.auth.uid == uid \|\| isGlobalAdmin());` | ترقية ذاتية إلى ADMIN عبر SDK (سلسلة 2.3-1) + تبديل companyId (عبور مستأجرين) |
| P0-4 | `firestore.rules:57-59` | `match /{allSubCollections=**} { allow read, write: if belongsToCompany(companyId); }` | تسريب رواتب/IBAN/هويات لكل أعضاء الشركة؛ الكتابة تسمح بتخريب payroll وattendance مباشرة |
| P0-5 | `register/page.tsx:58` | `proposedPassword: formData.password` | كلمة مرور نص صريح في Firestore، مقروءة لأي أدمن شركة أخرى (rules:101) وتُستهلك في developer/page.tsx:125 |
| P0-6 | `join/[companyId]/[inviteId]/page.tsx:64-99` + `rules:46` | `batch.set(doc(db,'global_users',uid),...)` مقابل `allow write: if isSovereignDev()` | تفعيل حساب الموظف مرفوض بالقواعد (create ضمن write) — مسار الانضمام ميت، وإلا فالقواعد المنشورة تختلف عن الريبو (كلاهما خطر) |

### 🟠 P1 — أعطال وظيفية/قانونية/أمنية مؤثرة
| # | الملف:السطر | الاقتباس/الوصف |
|---|---|---|
| P1-1 | `middleware.ts:9-13` | فرع الحماية فارغ تماماً — لا حماية server-side للمسارات |
| P1-2 | `rules:23-30` | `isGlobalAdmin()` بلا نطاق شركة → أدمنية الشركات متساوون في كل البيانات + يقرأون كلمات مرور التأسيس |
| P1-3 | `leave-service.ts:98` | `updateRequestStatus` بلا `ensureActionPermission` — أي عضو يوافق/يرفض ويخصم الأرصدة عبر SDK (الواجهة تمنع بـisAdmin فقط، leaves/[id]:139) |
| P1-4 | `hr-service.ts:146-150` | `terminateEmployee` بلا فحص صلاحية إطلاقاً (خلافاً لـaddEmployee:39) |
| P1-5 | `payroll-service.ts:149-165` | كود القيد المحاسبي ميت — المخصصات لا تُقيَّد (`// في بيئة حقيقية سنبحث...`) |
| P1-6 | `payroll-service.ts:94` | `gratuityProvision = dailyWage * 1.25` ثابت — يخالف شريحة 30 يوم/سنة بعد 5 سنوات (مخصص ناقص) |
| P1-7 | `employee-form.tsx:43-68` | لا حقول housing/transport/otherAllowances → التصفية والمخصصات على الأساسي فقط (تفاوت مع gratuity/page.tsx:57) |
| P1-8 | `working-days-service.ts:95-140` | شرائح م69 معرّفة وغير مستدعاة؛ المرضية تُدفع كاملة في payroll-service:79 |
| P1-9 | `attendance-import-service.ts:224-236` | `writeBatch` بلا تقطيع — أي شهر لفريق >~30 موظف يتجاوز حد 500 عملية ويفشل الرفع كله |
| P1-10 | `dossier/[id]/page.tsx:42` | `const canAccess = isOwn \|\| hrView.scope === 'all' \|\| (hrView.scope === 'dept' && true);` — مقارنة القسم مُبطلّة بـ `&& true`، مستخدم dept يرى ملفات كل الأقسام |
| P1-11 | `leave-service.ts:161-165` | emergency/unpaid لا تخصم رصيداً؛ لا فحص رصيد كافٍ قبل الاعتماد؛ `payload.workingDays` يدخل في `increment(-diff)` بلا تحقق (قيمة سالبة = زيادة رصيد) |
| P1-12 | `hr-service.ts:105` | `gratuityDays = (accruedDays/30)*15` في إعادة تقييم المخصصات — شريحة أول 5 سنوات للجميع |
| P1-13 | `firestore.rules` (غياب) | لا قواعد لـ`invitations` و`users` و`employees` مستقلة — كل شيء يمر عبر wildcard السخي |
| P1-14 | `apply/[companyId]/page.tsx:36-37` | زائر مجهول يقرأ `companies/{cid}` بينما `rules:52` تشترط `belongsToCompany` → صفحة التقديم العامة تفشل بالصلاحيات (أو كانت القواعد المنشورة أوسع!) |
| P1-15 | `payroll/[id]/page.tsx:43-55` | `handleAction` يعرّف تغيير حالة دفعية بلا فحص صلاحية في الصفحة، و`records` تُحمَّل (س38–41) ولا تُعرض أبداً |
| P1-16 | `attendance/import/page.tsx:79-155` | صفحة استيراد البصمات بلا أي فحص `check('hr',...)` — أي موظف يرفع/يستبدل حضور الشركة |
| P1-17 | `recruitment/page.tsx:53-62` | تحديث/حذف طلبات التوظيف بلا صلاحيات، والتطبيق العام `applications` مكتوب من مجهولين عبر wildcard |

### 🟡 P2 — جودة/اتساق
| # | الملف:السطر | الملاحظة |
|---|---|---|
| P2-1 | `dashboard/page.tsx:29-36,53-90` | `chartData` وإحصاءات "1.2M/24/142/84%" مكتوبة يدوياً — لوحة رئيسية مزيفة بالكامل |
| P2-2 | `notification-bell.tsx:29-33` | إشعارات ثابتة (hardcoded) بلا مصدر |
| P2-3 | `gratuity-service.ts:83` | `0.6666` بدل 2/3 الدقيق |
| P2-4 | `employee-form.tsx:66` | رصيد ابتدائي 30 يوم إجازة و15 مرضية عند التعيين يخالف التراكم الفعلي (م70) ويتعارض مع دفتر الحركة |
| P2-5 | `leaves/[id]:139` + `leaves-manager.tsx` | تكرار شبه كامل لمنطق التنفيذ (dialog×4 حالات) في ملفين — صيانة مزدوجة |
| P2-6 | `payroll-service.ts:115-147` | لا منع لتكرار دفعة (نفس الشهر/السنة) — دفعات متعددة ممكنة |
| P2-7 | `leave-service.ts:32-46` | فحص التعارض يقرأ كل طلبات الموظف بلا فلترة تاريخ + بدون transaction (سباق تسجيل متزامن) |
| P2-8 | `permission-service.ts:59-69` | قراءة كل طلبات الاستئذان لحساب حصة الشهر |
| P2-9 | `attendance-import-service.ts:150-151` | `isArch = departmentName.includes('arch')` — جدولة قسم حسب اسم نصي مهمل |
| P2-10 | `login/page.tsx:31` / `auth-context.tsx:129` | كوكي جلسة شكلي لا يقرأه أحد |
| P2-11 | `developer/page.tsx:64-65` | `comp_x898l4i70` و`8MbfW3Aexh8Nkz2adHOI` مكتوبة يدوياً في أداة تشخيص |
| P2-12 | `hr-service.ts:152-155` | `addAuditLog` بدون await/معالجة خطأ — سجلات تدقيق قد تضيع صامتة |
| P2-13 | `use-permissions.ts` vs `engine.ts` | ازدواج matrix/permissions[] (انظر 2.4) — أدوار matrix-only تُمنع في الخدمات |
| P2-14 | `employees/page.tsx:45` | فلتر dept في الواجهة فقط؛ البيانات كاملة تُحمّل للمتصفح (تسريب عرضي مع rules السخية) |
| P2-15 | `language-context.tsx` (2217 سطراً) | قاموس أحادي الضخم بكل السياقات — قابل للتقسيم، والاقتصاد `t()` بحالة حساسة (س2169: lowercase lookup) قد يعطي ترجمة خاطئة |

**ملخص البيانات المزيفة**: dashboard/page.tsx (إحصاءات+رسم)، reports/payroll/individual (Math.random)، notification-bell، و"Recent Activity" في dashboard (س148–152) — كلها UI ديكوري يعرض أرقاماً لا وجود لها.

---

## القسم 4: ما يستحق النقل إلى ConTrack وما لا

> ConTrack لديه بالفعل: `EmployeeLeave / EmployeePermission / EmployeeAttendance / PayrollBatch` — أي أن النقل هو **استيراد منطق** لا بنية.

### ✅ انقل (منطق مُثبت وقيمته عالية)
1. **`GratuityService.calculate`** (gratuity-service.ts كاملاً) — أصدق تنفيذ في المشروع لم51/53/44/السقف 18 شهراً؛ انقل مع: إصلاح 2/3 الدقيقة، إضافة حالات م52 والاستقالة بالإخلال، وربط الأجر الشامل من حقول بدلات موجودة فعلاً.
2. **`WorkingDaysService`** (working-days-service.ts) — حساب أيام العمل باستبعاد الجمعة/العطلات (م70)، قاعدة 6 أشهر، التراكم 2.5/شهر، **وفعّل `calculateSickLeaveBreakdown`** (م69) في مسار المرضية وPayrollBatch.
3. **قاعدة الـ26 مركزياً**: helper واحد `dailyWage(total) = total/26` يُستخدم في التصفية والخصم والمخصصات — بدل تكرار `/26` في 4 ملفات.
4. **المخصصات**: 2.5 يوم إجازة + تدرّج مكافأة (1.25 للـ5 سنوات الأولى ثم 2.5) كدالة على سنوات الخدمة، مع إلزام توليد القيد المحاسبي (استبدال الكود الميت payroll-service:149–165).
5. **حالة دورة الإجازة** `pending→approved→on-leave→returned→commenced` + تسجيل المغادرة/العودة الفعلية (types/hr.ts س6, LeaveService) — ناضجة وواقعية ميدانياً.
6. **رادار كثافة القسم** `getDepartmentLeaveDensity` (leave-service.ts:69–96) — فكرة ممتازة، انقلها كتحذير اعتماد.
7. **سقوف الاستئذان** (3س/طلب، 12س/شهر، منع التعارض مع إجازة) — permission-service.ts:30–42.
8. **مستورد البصمة**: تحليل التواريخ المرن (Excel serial + صيغ متعددة، attendance-import-service:40–109) والشفتين — مع إعادة كتابة الحفظ: upsert على (employeeId,date)، تقطيع دفعات 500، وتوليد سجلات weekend/holiday للشهر كاملاً (يصلح P0-2 من الجذر).
9. **سجل تدقيق الموظف** (`{empId}/auditLogs` + حقول criticalFields في hr-service:83–88).
10. **دوسيه الموظف** كبوابة تجميع تقارير (بنية dossier) — مفهوم موفق.

### ❌ لا تنقل (أعد بناءه من الصفر في ConTrack)
1. **firestore.rules الحالي** — أعد كتابة قواعد منفصلة لكل collection مع: منع self-update على roleCode/companyId في global_users (أو نقلها لـCloud Function)، تحديد isGlobalAdmin بنفس companyId، قواعد دقيقة لـpayroll/employees/attendance/invitations، وحماية `company_requests` (لا كلمات مرور إطلاقاً — استخدم تدفق Admin SDK من الخادم).
2. **middleware/session cookie** — لا معنى له؛ في ConTrack إما جلسة Firebase حقيقية (session cookie من Admin SDK) أو اعتماد كامل على قواعد Firestore.
3. **نظام الصلاحيات المزدوج** (permissions[] + matrix) — وحّد على matrix واحدة مع منفّذ خادمي.
4. **حساب الخصومات من "كل يوم بلا سجل = غياب"** — أصل ثغرة P0-2؛ ConTrack يجب أن يبني الراتب من تقويم العمل الرسمي (وجود سجل عطلة/إجازة/عطلة أسبوعية لكل يوم).
5. **صفحة payroll/[id]** — نصف مبنية (records لا تُعرض، أزرار حالة بلا صلاحية، زر طباعة ميت س84).
6. **`reports/payroll/individual`** — مزيف بالكامل (Math.random)؛ أعد بناءه على subcollection records.
7. **dashboard/page.tsx** — لوحة ديكور 100% ثابتة.
8. **gratuity-calculator + gratuity (نسختان متوازيتان)** — ادمجهما في حاسبة واحدة؛ التكرار أسفر عن تصرفات مختلفة لنفس خيار "المعالجة".
9. **شيفرة المطور في العميل** (developer/page.tsx يُنشئ شركات وأدوارًا وحسابات من المتصفح) — يجب أن يصبح Admin/Cloud Function.
10. **`end-of-service-calculator.ts`** stub و`HRClientVisitsRedirect` (client-visits: تحويل فقط) — لا تنقل.

### ⚠️ انقل بحذر (يعتمد على قرار تصميمي)
- افتراض رصيد 30 يوم ابتدائياً (اختر: تراكم 2.5/شهر مع إتاحة سلف رصيد موقّعة).
- خصم الغياب على الأساسي فقط (قرّر: الأساسي أم الشامل — ووثّق الاختيار قانونياً).
- نوع emergency بلا رصيد (اربطه بسقف سنوي قانوني داخلي).

---

## القسم 5: الخلاصة التنفيذية
- محرك نهاية الخدمة سليم قانونياً في هيكله (م51/53/44/26/سقف18) لكنه يُطعَم ببيانات ناقصة (لا بدلات في النموذج) ويُقدَّم في نسختين متضاربتين.
- الرواتب تحتوي أخطر عيب تشغيلي: **خصم تلقائي لكل يوم بلا بصمة** (عطلات/ما قبل التعيين) + مخصصات لا تُقيَّد وثابتة بعد 5 سنوات.
- الأمان: قواعد Firestore من 3 دوال متساهلة فقط؛ **ترقية ذاتية إلى ADMIN ممكنة من أي مستخدم مسجل**، ولا حماية server-side إطلاقاً (middleware no-op، شيفرة المطور في العميل).
- كلمات مرور نص صريح في Firestore (company_requests.proposedPassword).
- معدل الجاهزية للنقل: المنطق الحسابي ~70% جاهز بتعديلات، والبنية الأمنية ~10% (إعادة بناء كاملة).
