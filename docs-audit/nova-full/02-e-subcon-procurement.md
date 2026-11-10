# تقرير المراجعة 02-e: مقاولو الباطن والمشتريات والمخزون (NOVA ERP)

> **المهمة:** 2-e — مراجعة سطراً بسطر لمقاولي الباطن وعقودهم ومستخلصاتهم SubIPC، وأوامر الشراء PO والموردين والمخزون.
> **المراجع:** مراجع كود خبير | **التاريخ:** 2025-11-10 | **النسخة المدروسة:** NOVA ERP (Next.js 15 + Firebase Firestore) المفكوكة في `/home/z/review-nova`

---

## 0. نطاق المراجعة والمنهجية

### 0.1 الملفات الأساسية المقروءة بالكامل (17 ملفاً — 3,115 سطراً)

| # | الملف | الأسطر | الغرض |
|---|-------|--------|-------|
| 1 | `src/app/dashboard/procurement/page.tsx` | 143 | لوحة المشتريات (إحصاءات + إجراءات سريعة) |
| 2 | `src/app/dashboard/procurement/orders/page.tsx` | 139 | قائمة أوامر الشراء |
| 3 | `src/app/dashboard/procurement/orders/new/page.tsx` | 248 | إنشاء أمر شراء مع ربط BOQ |
| 4 | `src/app/dashboard/procurement/quotes/page.tsx` | 144 | محلل عروض الأسعار بالذكاء الاصطناعي |
| 5 | `src/app/dashboard/procurement/contracts/page.tsx` | 178 | قائمة عقود المالك الموحدة |
| 6 | `src/app/dashboard/procurement/sub-claims/page.tsx` | 122 | رقابة مستحقات مقاولي الباطن (SubIPC) |
| 7 | `src/app/dashboard/procurement/subcontractors/page.tsx` | 216 | سجل مقاولي الباطن |
| 8 | `src/app/dashboard/procurement/subcontractors/[id]/page.tsx` | 263 | ملف المقاول (Dossier) |
| 9 | `src/app/dashboard/procurement/subcontractors/contracts/page.tsx` | 138 | قائمة عقود الباطن |
| 10 | `src/app/dashboard/procurement/subcontractors/contracts/new/page.tsx` | 400 | تأسيس اتفاقية باطن (بوابة الأهلية) |
| 11 | `src/app/dashboard/procurement/subcontractors/contracts/[id]/page.tsx` | 280 | عرض/تعديل عقد الباطن + طباعة |
| 12 | `src/app/dashboard/procurement/suppliers/page.tsx` | 206 | سجل الموردين |
| 13 | `src/app/dashboard/inventory/page.tsx` | 188 | المخازن والعهد الميدانية |
| 14 | `src/services/procurement-service.ts` | 95 | خدمة أوامر الشراء |
| 15 | `src/services/inventory-service.ts` | 134 | خدمة المخزون والعهد |
| 16 | `src/services/billing-service.ts` | 183 | محرك الفوترة (جانب SubIPC) |
| 17 | `src/types/procurement.ts` | 76 | أنواع بيانات المشتريات |

### 0.2 ملفات دعم مُتحقَّق منها للعلاقات المتقاطعة (14 ملفاً)

`lib/counters.ts` (الترقيم التسلسلي)، `firebase/multi-tenant.ts` (المسارات)، `lib/permissions.ts` + `lib/permissions/catalog.ts` (الصلاحيات)، `hooks/use-permissions.ts`، `firebase/firestore/use-collection.tsx`، `services/document-service.ts` (تأسيس عقد باطن من قالب + استدعاء الفوترة)، `services/boq-inventory-link-service.ts`، `components/transactions/transaction-documents-view.tsx` (عرض مستخلصات الباطن داخل المعاملة)، `ai/flows/analyze-supplier-quotes-flow.ts`، `types/templates.ts`، `components/layout/dashboard-sidebar.tsx`، `app/dashboard/accounting/claims/page.tsx` (مقارنة)، `settings/templates/subcon-contracts/*` (قوالب بتخصص).

---

## 1. مخطط علاقات الباطن والمشتريات (ERD)

### 1.1 المجموعات في Firestore (مسارات متعددة المنشآت: `companies/{companyId}/...`)

```
subcontractors (المقاولون)                    suppliers (الموردون)
 ├─ status: active|inactive|blacklisted        ├─ name, category, phone, email, rating
 ├─ trade (تخصص نصي حر)                        └─ (لا واجهة تفصيل ولا ربط فعلي بـ PO)
 ├─ rating, civilId, phone, email
 │
 └──< subconContracts (عقود الباطن) ──────────────────────────────────────┐
        ├─ subcontractorId/Name  ──> subcontractors                       │
        ├─ transactionId/Number  ──> transactions/{tId}/stageInstances    │
        ├─ clientId/Name         ──> clients                              │
        ├─ templateId/Name       ──> subconContractTemplates (قوالب بتخصص │
        │                            trade + retentionRate + legalText)   │
        ├─ milestones[]: {name, percentage, amount, timing(at|before|     │
        │    during|after), technicalStageId|'SIGNING'}  ← خطة الدفعات    │
        ├─ retentionRate (افتراضي 5)                                      │
        ├─ pricingMode: fixed|itemized|percentage                         │
        └─ status: 'active' (يُفرض مباشرة عند الحفظ — لا مسودة)           │
                                                                        │
purchaseOrders (أوامر الشراء)                                           │
 ├─ poNumber: PO-{YYYY}-{####} عبر counters/po                          │
 ├─ supplierId/Name ──> suppliers                                       │
 ├─ projectId?, transactionId? (لا يُملأ إطلاقاً من الواجهة)             │
 ├─ status: draft→(pending→approved→ordered→received→cancelled)         │
 │           ‼️ لا انتقال فعلي: تظل draft للأبد                          │
 └──< purchaseOrders/{poId}/items (poItems)                             │
        ├─ itemId ──> inventoryItems  ├─ boqId ──> boqs                  │
        ├─ quantity/receivedQuantity(=0 دائماً)  ├─ boqItemId (يُخزن '') │
        └─ technicalStageId? (لا يُملأ)                                  │
                                                                        │
subIpcs (مستخلصات الباطن S-IPC)  ← تُنشأ من دالة ميتة فقط               │
 ├─ ipcNumber: S-IPC-{####} عبر counters/ipc_sub_{subcontractorId}  <───┘ (لا contractId!)
 ├─ subcontractorId/Name  ├─ transactionId/Number  ├─ clientId/Name
 ├─ grossAmount, retentionAmount, retentionRate, deductions=0, netPayable
 ├─ status: draft→approved→paid→cancelled ‼️ لا انتقال فعلي
 └─ items[] (معرّفة في النوع فقط — لا تُكتب أبداً)

inventoryItems (المخزون)
 ├─ name, sku, quantity, unit, warehouseId
 ├─ ‼️ لا واجهة إضافة أصناف (addItem/addWarehouse بلا مستدعٍ)
 ├─ ‼️ لا تتغذى من استلام PO إطلاقاً
 └──< assetAssignments (العهد): صرف عهدة لموظف {employeeId, itemId,
      quantity, status: in-use|returned} — خصم/إرجاع كمية مباشر

counters/{po | ipc_owner_{tId} | ipc_sub_{subId}}  ← ترقيم آمن بـ runTransaction
```

### 1.2 حلقات الربط المفقودة (روابط مطلوبة في المهمة غير المطبقة)

| رابط | الحالة | الدليل |
|------|--------|--------|
| Subcontractor ↔ SubconContract | ✅ يعمل | `subcontractors/[id]/page.tsx:44` |
| SubconContract ↔ SubIPC | ❌ **مفقود** | `billing-service.ts:158-178` لا يكتب `contractId` في المستخلص، والبند الوحيد للربط هو بحث `where('subcontractorId'+'transactionId')` داخل الدالة الميتة نفسها (L144-149) |
| SubIPC ↔ بنود (poItems/BOQ) | ❌ مفقود | النوع `SubIPC.items` (types/procurement.ts:68-74) لا يُكتب مطلقاً |
| PO ↔ BOQ | 🟡 جزئي | `boqId` يُخزن لكل البنود (orders/new:95) لكن `boqItemId` يبقى `''` — القائمة `availableBOQItems` تُجلب (L66-73) ولا تُعرض أبداً |
| PO ↔ استلام ↔ مخزون | ❌ مفقود كلياً | لا دالة استلام، `receivedQuantity=0` (procurement-service.ts:61)، المخزون لا يزيد أبداً |
| supplier ↔ quotes ↔ orders | ❌ غير موجود | "quotes" أداة AI نصية بلا حفظ ولا كيان `Quote` في الأنواع |
| BOQ ↔ تحليل انحراف المخزون | ❌ ميت ومعطوب | `boq-inventory-link-service.ts:42` يستعلم مجموعة غير موجودة `'purchase_orders_items'` (المسار الحقيقي `companies/{cid}/purchaseOrders/{poId}/items`) + بلا أي مستدعٍ |

---

## 2. دورة الباطن الكاملة (كما هي مبنية فعلياً)

### 2.1 القوالب بالتخصص
- قوالب `subconContractTemplates` بحقل `trade` (التخصص) و`retentionRate` و`pricingMode` و`defaultMilestones` و`legalText` — تُدار من `settings/templates/subcon-contracts` (`subcon-contract-form.tsx:53-66`) وتُفلتر بـ `where('isActive','==',true)` في `contracts/new/page.tsx:82-84`.
- عند اختيار قالب تُنسخ بياناته للنموذج (`contracts/new/page.tsx:120-135`) مع `retentionRate: template.retentionRate ?? 5`.
- قوالب أخرى مرتبطة بنوع النشاط داخل المعاملات: `transaction-documents-view.tsx:88-106` (فرز "مطابقة مباشرة" بـ subServiceId).

### 2.2 بوابة الأهلية (Sovereign Eligibility Gate) — تعمل جزئياً
- `contracts/new/page.tsx:91-118`: قبل السماح بإسناد عمل باطن لعميل، تفحص وجود **عقد مالك** معتمد:
```
where('clientId','==',form.clientId), where('status','in',['approved','active','signed','paid'])
→ snap.empty ⇒ eligibilityError: "لا يمكن التعاقد مع مقاول باطن لهذا العميل..."
```
- الإنفاذ: زر الحفظ معطّل عند `eligibilityError` (L200) وحفظ المحتوى يمنع (L169). ✅
- **الثغرات:** الفحص لحظي على الواجهة فقط (getDocs) ولا يُعاد عند وقت إصدار المستخلص؛ `generateSubcontractorIPC` لا يفحص الأهلية أصلاً؛ المعاملة نفسها قد تُنشأ لعميل بلا عقد لاحقاً دون أي تحذير في مستخلصات الباطن.

### 2.3 ترقيم S-IPC
- `billing-service.ts:138`: `nextSequential(db, companyId, 'ipc_sub_${subcontractorId}', 'S-IPC-', 4)` — عدّاد **لكل مقاول** (ليس مركزياً/سنوياً)، آمن عبر `runTransaction` (`lib/counters.ts:18-24`). ✅ الترقيم سليم تقنياً.
- ⚠️ العداد يُزاد قبل كتابة المستخلص في عملية منفصلة (setDoc بعد المعاملة) — فشل الكتابة يترك فجوة ترقيم (P2).
- ⚠️ **الدالة كلها ميتة**: لا يوجد أي استدعاء لـ `generateSubcontractorIPC` في المشروع كله ⇒ لا يمكن إنشاء أي S-IPC من أي واجهة (P0).

### 2.4 بنود المستخلص وقيد المحتجزات والصرف
- **البنود:** النوع يعرّف `items[]` بـ `boqItemId/description/quantity/unitPrice/total` (types/procurement.ts:68-74) لكن `subIpcData` في `billing-service.ts:158-178` لا يتضمن `items` إطلاقاً — المستخلص قيمة إجمالية عمياء `amount` تمرَّر كوسيط.
- **المحتجزات:** L154-156: `subRetentionRate = subContract?.retentionRate ?? 5` ثم `retentionAmount = round(amount×rate/100, 3)` و`netPayable = amount − retention`. الرياضيات سليمة (تقريب 3 منازل = فلساً للدينار الكويتي) ✅.
- **اعتماد/صرف:** الحالة تُفرض `'draft'` (L167) ولا يوجد **أي** `updateDoc` على `subIpcs` في المشروع ⇒ لا اعتماد، لا صرف، لا قيد محاسبي (لا ربط بـ vouchers/journalEntries). المستخلصات — لو وُجدت — ستبقى عالقة draft إلى الأبد (P0).
- `deductions: 0` ثابتة (L171) — لا خصومات (غرامات/تأمينات/مستخلصات سابقة).
- لا سجل timeline للمستخلص (المالك فقط له: L111-120) — تفاوت تدقيقي.
- لا سقف تعاقدي: يمكن نظرياً إصدار مستخلصات يتجاوز مجموعها قيمة العقد (لا مقارنة مع totalAmount أو milestoneAmounts).

### 2.5 دورة العقد نفسها
- التأسيس: `contracts/new/page.tsx:172-182` — `setDoc` بحالة `'active'` مباشرة (لا مسودة/اعتماد) **ولا رقم عقد** (لا nextSequential) و**بلا اسم**: `form.name` يُعرَّف `''` (L60) ولا يوجد أي حقل إدخال له في الصفحة كلها ⇒ كل عقود الباطن تُحفظ باسم فارغ وتظهر في القوائم بعنوان أعمى (تعوّض جزئي بـ `projectTitle`) (P1).
- التعديل: `contracts/[id]/page.tsx:110-124` يفرض توازن 100% للدفعات ✅ لكن `contracts/new` لا يفرضه رغم حسابه (`stats.isValid` في L149-154 بلا استخدام في handleSave L168) (P1).
- لا إكمال/إنهاء/إلغاء عقد، ولا أرشفة، وحذف عقود الباطن يتم مباشرة من `transaction-documents-view.tsx:144` بـ `deleteDoc` بدون أي فحص وجود مستخلصات مرتبطة (حذف أعمى).

---

## 3. دورة المشتريات (كما هي مبنية فعلياً)

```
[عرض مورد AI نصي]  →  لا حفظ، لا كيان Quote، لا ربط بالمورد
        ↓ (لا صلة فعلية)
[أمر شراء PO] orders/new:
  - ترقيم PO-{YYYY}-{####} آمن (counters) ✅
  - بنود من المخزون + ربط boqId (شكلي) 
  - status: draft — بلا فحص بنود/كميات
        ↓ ‼️ انقطاع
[اعتماد] updatePOStatus() موجودة (procurement-service.ts:78-94) بلا أي مستدعٍ
  → لا pending → approved → ordered أبداً
        ↓ ‼️ انقطاع
[استلام] لا وجود لدالة استلام؛ receivedQuantity=0 دائماً؛
  حالة 'received' تعريفياً بلا تطبيق
        ↓ ‼️ انقطاع
[قيد محاسبي/مخزني] لا transactionId ولا قيد دفتري —
  النص "postedToLedgerHint" (orders/new:241) ادعاء بلا تنفيذ؛
  المخزون لا يتغذى؛ inventoryTransactions غير مستخدم (لا سجل حركة)
```

**دورة العهدة (وحيدة العاملة في المخزون):** صرف عهدة لموظف (`assignAsset` inventory-service.ts:53-100) مع فحص رصيد قبل الخصم ✅ ثم استرجاع (`returnAsset` L107-133). لكنها تنشئ سجل عهدة فقط — لا سجل حركة مخزنية مستقلة، ولا تكلفة بند، ولا ربط بموقع/معاملة.

---

## 4. جدول الأعطال (P0/P1/P2) بالسطر والاقتباس

### 4.1 أعطال حرجة P0 (كسر دورة كاملة أو أمن)

| # | الملف:السطر | الاقتباس | العطل |
|---|-------------|----------|-------|
| P0-1 | `procurement/orders/new/page.tsx:107` + `orders/page.tsx:95` + `procurement/page.tsx:112` | `router.push(\`/dashboard/procurement/orders/${poId}\`)` | **مسار `orders/[id]` غير موجود أصلاً** (لا مجلد `[id]` تحت orders) ⇒ بعد حفظ أي أمر شراء أو النقر على أي صف → **404 حتمي**. ثلاث نقاط دخول كلها مكسورة |
| P0-2 | `services/billing-service.ts:129` | `async generateSubcontractorIPC(...)` | **دالة بلا مستدعٍ في المشروع كله** (تحقق grep شامل) ⇒ لا يمكن توليد أي S-IPC من أي واجهة؛ صفحتا `sub-claims` و`transaction-documents-view` تعرضان دائماً "لا نتائج". دورة مستخلصات الباطن **غير قابلة للبدء** |
| P0-3 | `services/procurement-service.ts:78` | `async updatePOStatus(poId, status, userId)` | **بلا مستدعٍ** ⇒ كل أوامر الشراء عالقة في `draft`؛ الاعتماد/الإرسال/الاستلام/الإلغاء منتفية؛ حالة `receivedQuantity` ميتة |
| P0-4 | `firestore.rules:57-59` | `match /{allSubCollections=**} { allow read, write: if belongsToCompany(companyId); }` | **صلاحية كتابة شاملة** لأي مستخدم في الشركة على كل شيء: subIpcs، subconContracts، purchaseOrders، counters، inventoryItems. أي موظف يستطيع عبر الـ SDK مباشرة: تعديل `netPayable`، وضع `status:'paid'`، تصفير محتجزات، حذف عقود، التلاعب بعدّادات الترقيم. فحوصات `ensureActionPermission` كلها **client-side** قابلة للتجاوز |
| P0-5 | `components/transactions/transaction-documents-view.tsx:178-181` | `onClick={() => { if (type === 'subcon_contract') router.push(...contracts/${item.id}); else router.push(\`/dashboard/clients/${clientId}/${type === 'quotation' ? 'quotations' : 'contracts'}/${item.id}\`); }}` | النقر على صف **مستخلص باطن** (`type='subipc'`) ينقل إلى صفحة **عقد المالك** بمعرّف المستخلص ⇒ 404 أو عقد شخص آخر. نفس الخطأ لمستخلصات المالك (`type='ipc'`). مسار العرض الوحيد لمستخلصات الباطن داخل المعاملة مكسور |

### 4.2 أعطال عالية P1 (خلل وظيفي/حوكمة جوهري)

| # | الملف:السطر | الاقتباس | العطل |
|---|-------------|----------|-------|
| P1-1 | `subcontractors/contracts/new/page.tsx:60,172-182` | `name: ''` ثم `await setDoc(contractRef, { ...form, ... })` | عقد الباطن يُحفظ **بلا اسم نهائياً** — لا يوجد حقل إدخال للاسم في الصفحة كلها؛ القوائم تعرض عنواناً فارغاً |
| P1-2 | `subcontractors/contracts/new/page.tsx:168-188` مقابل `[id]/page.tsx:112-115` | `handleSave` الجديد لا يفحص `stats.isValid` | إنشاء عقد بدفعات **لا تساوي 100%** يمر بلا مانع (التحقق محسوب ومُهمَل)، بينما صفحة التعديل تفرضه — تضارب يسمح بتحايل عبر الإنشاء |
| P1-3 | `subcontractors/contracts/new/page.tsx:176` | `status: 'active'` | إفراد عقد الباطن لحالة "نشط" مباشرة — **لا مسودة ولا اعتماد ولا دورة حياة** (draft/approved/terminated) ولا رقم عقد تعاقدي |
| P1-4 | `billing-service.ts:158-178` | `const subIpcData: any = {...}` | المستخلص **بلا `contractId` وبلا `items`** — ربط المستخلص بعقده وبنوده الميدانية منتفٍ؛ يستحيل لاحقاً حساب المستخلص مقابل العقد أو منع الصرف الزائد |
| P1-5 | `billing-service.ts:151-154` | `const subContract = subContractsSnap.empty ? null : ...; const subRetentionRate = subContract?.retentionRate ?? 5;` | عدم وجود عقد باطن **لا يمنع** إنشاء المستخلص — يصدر مستخلص بلا سند تعاقدي وبمحتجزات افتراضية 5% بصمت |
| P1-6 | `billing-service.ts:167` + غياب أي `updateDoc` على `subIpcs` | `status: 'draft'` | لا مسار اعتماد/صرف/قيد لمستخلصات الباطن — كل ما يُنشأ يبقى draft عالقاً (لا قيد دفتري ولا ربط بسندات الصرف) |
| P1-7 | `services/inventory-service.ts:65-73` ثم `88-91` | `if (data.quantity > available) throw ...` ثم `batch.update(itemRef, { quantity: increment(-data.quantity) })` | **سباق TOCTOU**: فحص الرصيد بـ getDoc ثم الخصم في batch منفصلة بدون `runTransaction` ⇒ صرفان متوازيان يجعلان الرصيد **سالباً** (القواعد لا تمنع السالب) |
| P1-8 | `services/inventory-service.ts:107-133` | `batch.update(itemRef, { quantity: increment(quantity) })` | الاسترجاع يزيد أي كمية يمررها العميل دون التحقق من مطابقتها للكمية المصروفة أو أن `itemId` يعود لنفس العهدة ⇒ تضخيم مخزون بلا أثر |
| P1-9 | `services/inventory-service.ts:27-46` | `addWarehouse` / `addItem` | **بلا أي مستدعٍ** — لا واجهة إضافة أصناف أو مستودعات في `inventory/page.tsx` ⇒ المخزون فارغ بنيوياً ولا تتغذى إلا يدوياً من الكونسول |
| P1-10 | `firebase/multi-tenant.ts:34` | `inventoryTransactions: ...` | المسار معرّف و**غير مستخدم في أي مكان** ⇒ لا سجل حركة مخزنية (audit) لأي صرف/استرجاع/استلام |
| P1-11 | `services/boq-inventory-link-service.ts:42` | `collection(this.db, 'purchase_orders_items')` | استعلام عن **مجموعة وهمية غير موجودة** (المسار الصحيح `companies/{cid}/purchaseOrders/{poId}/items`) + `where('id','==',boqItemId)` anti-pattern + الخدمة بلا مستدعٍ — تحليل الانحراف ميّت ومكسور معاً |
| P1-12 | `subcontractors/page.tsx:50-58` و `suppliers/page.tsx:51-56` | `await addDoc(collection(db, paths.subcontractors(companyId)), {...})` | إنشاء المقاول/المورد **مباشر من العميل بلا فحص صلاحية** (`procurement:create` غير مفحوص) — تضارب مع الخدمات التي تفحص؛ عملياً أي موظف يملك القاعدة تسمح له |
| P1-13 | `subcontractors/[id]/page.tsx:54-63` | `pending: totalAwarded - totalPaid` | الرصيد المتبقي = قيمة العقود − المدفوع، لكن **لا شيء يصل 'paid' أبداً** (P0-2/P1-6) ⇒ "الرصيد المتبقي" يساوي دائماً كامل قيمة العقود — مؤشر مالي مضلل؛ كما أنه يهمل حالة `approved` غير المصروف |
| P1-14 | `orders/new/page.tsx:66-73,92-97` | `getDocs(...boqItems...)` ثم `boqItemId: ''` | بنود PO تُحفظ بـ `boqItemId: ''` دائماً — ربط بند الشراء ببند المقايسة (المعلن "الربط السيادي") غير مطبق في الواجهة؛ البيانات تُجلب وتُهمل |
| P1-15 | `orders/new/page.tsx:85-104` | `const poId = await service.createPurchaseOrder(...)` | لا تحقق من وجود بنود أو كميات موجبة ⇒ يمكن حفظ أمر شراء **فارغ بقيمة 0** يدخل الترقيم ويشوّه الإحصاءات |

### 4.3 أعطال متوسطة P2 (جودة بيانات/تجربة/تلميحات كاذبة)

| # | الملف:السطر | الاقتباس | العطل |
|---|-------------|----------|-------|
| P2-1 | `procurement/page.tsx:44` | `val: '5'` | إحصاء "عروض الأسعار المعلقة" **رقم ثابت مزيف** |
| P2-2 | `procurement/page.tsx:30,43` | `limit(5)` ثم `orders?.reduce(...totalSpend)` | "إجمالي الإنفاق" محسوب من **5 أوامر فقط** — مؤشر مضلل هيكلياً |
| P2-3 | `subcontractors/page.tsx:190` | `<span ...>0 <span>KWD</span></span>` | عمود "المطالبات المالية" **0 ثابت مزيف** رغم وجود `totalPayable/totalPaid` في النوع (types/procurement.ts:51-52) |
| P2-4 | `subcontractors/page.tsx:146-148` | `<Button variant="outline"...><Filter/>` | زر فلترة **بلا وظيفة** |
| P2-5 | `subcontractors/page.tsx:40-42` | `query(collection(...), orderBy('name'))` | لا فلترة status ⇒ **المقاولون المسودّون (blacklisted)** يظهرون كأي مقاول، وحالة 'blacklisted' في النوع بلا أي إنفاذ كبوابة أهلية |
| P2-6 | `suppliers/page.tsx:44` | `activeOrders: 0` | إحصاء ثابت مزيف (وأصلاً بطاقة واحدة في شبكة رباعية) |
| P2-7 | `suppliers/page.tsx:193-197` | `<Button variant="ghost" ...><ArrowRight/></Button>` | زر صف المورد **بلا onClick** — لا صفحة مورد تفصيلية ولا تعديل/حذف |
| P2-8 | `subcontractors/[id]/page.tsx:246-254` | `<span className="font-black text-xl">0</span>` (مرتين) | "الزيارات الموثقة" و"عمالة موقع جارية" **أصفار ثابتة** بلا استعلام |
| P2-9 | `subcontractors/[id]/page.tsx:202-210` | `tSafe('subcon.complianceDesc', 'يتم مراجعة كافة المبالغ...')` | بطاقة "امتثال القوى العاملة" **نصية زخرفية** — لا يوجد أي فحص امتثال فعلي |
| P2-10 | `subcontractors/[id]/page.tsx:233` | `{subcontractor.rating || '5.0'}` | التقييم الافتراضي 5 المفروض عند الإنشاء (`subcontractors/page.tsx:54`) يُعرض كـ"تقييم أداء" حقيقي |
| P2-11 | `sub-claims/page.tsx:95` | `-{ipc.retentionAmount?.toLocaleString()}` | عند غياب الحقل تُعرض `-undefined` |
| P2-12 | `sub-claims/page.tsx:79` | `\`/dashboard/clients/${ipc.clientId || 'none'}/...\`` | fallback `'none'` يولد رابطاً مكسوراً لبيانات ناقصة |
| P2-13 | `quotes/page.tsx:116-133` | `result.comparisonSummary.bestOverallSupplier` | النتيجة تعرض حقليْن فقط؛ `analysisPerQuote` و`keyDifferences` (flow:47-49) **تُهمل**؛ التحليل لا يُحفظ ولا يرتبط بموردين/أوامر — لا أثر تدقيقي |
| P2-14 | `subcontractors/contracts/new/page.tsx:74-76` | `orderBy('nameAr')` | Firestore يستبعد من النتائج أي عميل **بلا حقل nameAr** — عملاء يختفون من القائمة بصمت |
| P2-15 | `subcontractors/contracts/[id]/page.tsx:118` | `updateDoc(..., { ...editData, ... })` | الكتابة بـ spread كامل لكل الحقول بما فيها `id/createdAt` — last-write-wins شامل قد يطمس تحديثات متزامنة |
| P2-16 | `subcontractors/contracts/new/page.tsx:296-299` و `[id]/page.tsx:183` | `<Input type="number" value={form.retentionRate}...>` | نسبة المحتجزات **بلا حدود** (يقبل 0 أو سالب أو 100) وينعكس مباشرة على حسابات المستخلص |
| P2-17 | `billing-service.ts:65-69` | `alreadyBilledMilestones.has(m.name)` | منع تكرار الفوترة بمطابقة **اسم** المرحلة — مرحلتان بنفس الاسم تُختصران ثانيتهما (المالك) |
| P2-18 | `billing-service.ts:74,138` مقابل `122,180` | `nextSequential(...)` ثم `batch.commit()`/`setDoc(...)` | العداد يُزاد في معاملة مستقلة قبل كتابة المستند — فشل الكتابة يترك فجوة ترقيم |
| P2-19 | `procurement/contracts/page.tsx:80` | `t('hr.reports.payroll.individualTitle')` | مفتاح ترجمة غريب (عنوان رواتب فردية) لبطاقة إجمالي قيمة العقود |
| P2-20 | `procurement/page.tsx:41` | `suppliers?.length || 0` | "الموردون النشطون" بلا فلترة status (لا يوجد أصلاً حقل status للمورد) |
| P2-21 | `types/procurement.ts:3-77` | `export interface Subcontractor ... SubIPC` | لا واجهات `Supplier` ولا `Quote` ولا `SubconContract` — كل التعامل في الواجهات بـ `any` (مثال: sub-claims:31، contracts:37) |
| P2-22 | `subcontractors/contracts/page.tsx:94-131` | القائمة | لا إكمال/إنهاء/إلغاء عقد من القائمة، ولا عرض محتجزات/مستخلصات مرتبطة بالعقد |
| P2-23 | `inventory/page.tsx:124,172` | `i.quantity < 3` | حد نقص المخزون **ثابت مبرمج 3** بلا إعداد لكل صنف |
| P2-24 | `inventory/page.tsx:176-179` | `<Button ...><Edit3/></Button>` | زر تعديل الصنف **بلا وظيفة** |
| P2-25 | `orders/new/page.tsx:45,50` | `searchParams.get('projectId')` | `projectId` يُستقبل ويُحفظ لكن لا يُفلتر به BOQ ولا شيء — بارامتر شكلي؛ كما أن PO لا يُربط بمعاملة (transactionId فارغ دائماً) |

---

## 5. منطق المحتجزات والمستخلصات (تحليل تفصيلي)

### 5.1 الصيغة الحالية

| المسار | الموقع | القاعدة |
|--------|--------|---------|
| مطالبة المالك (IPC) | `billing-service.ts:82-84` | `retentionRate = contract.retentionRate ?? 5` → `retention = round(gross × rate/100, 3)` → `net = gross − retention` |
| مطالبة الباطن (S-IPC) | `billing-service.ts:154-156` | `subRetentionRate = subContract?.retentionRate ?? 5` → نفس الصيغة |
| قيمة الدفعة | `billing-service.ts:76-79` | `m.amount \|\| (contract.totalAmount × m.percentage / 100)` |
| تزامن %↔مبلغ في الواجهة | `contracts/new:159-163` و `[id]:101-105` | تقريب 3 منازل عند التحويل، مقبول للـ KWD |

### 5.2 ما هو سليم
1. الترقيم التسلسلي عبر `runTransaction` على `counters` (`lib/counters.ts:18-24`) — مقاوم للتزامن.
2. التقريب 3 منازل عشرية متسق مع الدينار الكويتي.
3. بوابة الأهلية تمنع التعاقد مع باطن قبل عقد مالك معتمد (الواجهة).
4. قيمة الدفعة تُحتسب fallback من النسبة عند غياب المبلغ.

### 5.3 ما هو مكسور/ناقص
1. **لا دورة حياة:** المستخلص يولد `'draft'` ويموت فيه — لا اعتماد (مع صلاحية `procurement:approve` معرفة في الكتالوج catalog.ts:78 وغير مستخدمة)، لا صرف، لا قيد محاسبي، لا تحديث لـ `Subcontractor.totalPayable/totalPaid`.
2. **لا بنود:** المستخلص قيمة عمياء — لا علاقة بإنجاز ميداني (`executedQuantity`) ولا ببنود المقايسة؛ نص الإحالة الميدانية في `SubIPC.items` ميت.
3. **لا تحرير محتجزات:** لا آلية release عند التسليم/ضمان حسن التنفيذ — المحتجزات تُحتج فقط ولا تُفرج أبداً.
4. **لا خصومات:** `deductions: 0` ثابت (billing-service.ts:171) — لا غرامات/تأمينات/ضريبة.
5. **لا سقف تعاقدي:** لا مقارنة تراكمية مع `totalAmount` أو مع جدول الدفعات (milestones) — المستخلص مبلغ حر.
6. **لا فصل ثنائي الاتجاه:** مطالبة المالك ومطالبة الباطن لا يربطهما شيء (back-to-back billing غائب) — لا يمكن معرفة أي مطالبة مالك تُغطي أي مستخلص باطن.
7. **لا تحقق أن العقد نشط:** الدالة تلتقط أول عقد بـ `limit(1)` بلا فلترة حالة العقد (billing-service.ts:144-149) — عقد ملغى نظرياً يُستخدم لمحتجزاته.
8. **تفاوت الترقيم:** S-IPC لكل مقاول (`ipc_sub_{subId}`) بينما IPC المالك لكل معاملة (`ipc_owner_{transactionId}`) — لا تسلسل مركزي للمطابقة أو التقارير المجمعة.

---

## 6. بيانات مزيفة / واجهات كشفية (خصوصاً للمراجعة المالية)

| الموقع | الادعاء المعروض | الواقع |
|--------|------------------|--------|
| `procurement/page.tsx:44` | "عروض معلقة: 5" | ثابت مبرمج |
| `procurement/page.tsx:43` | "إجمالي الإنفاق" | 5 أوامر فقط (limit 5) |
| `subcontractors/page.tsx:190` | "المطالبات: 0 KWD" | ثابت لكل المقاولين |
| `subcontractors/[id]:249,253` | "زيارات: 0 / عمالة: 0" | ثابتان |
| `subcontractors/[id]:233` + `page.tsx:54` | "تقييم أداء 5.0" | قيمة مفروضة عند الإنشاء لا تتغير |
| `suppliers/page.tsx:44` | "أوامر نشطة: 0" | ثابت |
| `subcontractors/[id]:202-210` | "يتم مراجعة كافة المبالغ... لضمان صحة الصرف" | لا توجد أي مراجعة — نص تسويقي |
| `orders/new/page.tsx:241` | "postedToLedgerHint" (ستُرحّل للدفتر) | لا ترحيل دفتري لأوامر الشراء إطلاقاً |

---

## 7. الأمن (firestore.rules + الصلاحيات)

1. **قاعدة شاملة مفتوحة (P0-4):** `firestore.rules:57-59` تمنح read/write لكل المجموعات الفرعية بشرط الانتماء للشركة فقط — لا فصل أدوار على مستوى البيانات. فحوصات `ensureActionPermission` في الخدمات تُنفَّذ في متصفح العميل (`'use client'` في أعلى procurement-service.ts:1 وinventory-service.ts:1 وbilling-service.ts:1) وتُتجاوز بالكامل بأي استدعاء SDK مباشر.
2. **عدادات الترقيم قابلة للتلاعب:** `companies/{cid}/counters/*` مكتوبة بقاعدة الشاملة — يمكن لأي مستخدم تصفير `po` أو `ipc_sub_*` لإنتاج أرقام مكررة.
3. **لا تحقق حقول:** لا قاعدة تتحقق من `netPayable = grossAmount − retentionAmount` أو من `quantity >= 0` أو من عدم تعديل `companyId` — كل سلامة الأرقام تقع على عاتق كود العميل.
4. **isGlobalAdmin عابر للمنشآت:** `firestore.rules:23-39` يمنح أي `roleCode=ADMIN` قراءة/كتابة **كل** الشركات (مقصود "سيادياً" لكنه يستحق بوابات إضافية).
5. **حذف أعمى لعقود الباطن:** `transaction-documents-view.tsx:144` `deleteDoc` مباشر بلا فحص مستخلصات مرتبطة أو صلاحية متخصصة (فقط `isAdmin` واجهةً).
6. **نقاط مضيئة:** `errorEmitter` + `FirestorePermissionError` لتشخيص أخطاء القواعد؛ فحص الرصيد قبل صرف العهدة؛ عدادات آمنة؛ حماية `global_users` جيدة (L43-47).

---

## 8. ما يستحق النقل إلى ConTrack وما لا يستحق

> المرجع: ConTrack يمتلك أصلاً `SubContract` / `SubContractItem` / `SubPaymentPlanItem`.

### 8.1 يُنقل (مع تحسينات)

| كيان NOVA | إلى ConTrack | ملاحظات النقل |
|-----------|--------------|----------------|
| `subconContracts` | **SubContract** ✅ | الحقول الناضجة: `subcontractorId/Name, transactionId, clientId, templateId/Name, pricingMode, retentionRate, legalText, projectTitle`. **يجب إضافة:** رقم عقد تسلسلي (nextSequential)، دورة حياة `draft→approved→active→completed→terminated` بدل فرض `active`، منع الحفظ بلا `name`، فرض توازن 100% عند الإنشاء (كما في التعديل)، حدود 0–30 لنسبة المحتجزات |
| `milestones[]` في عقد الباطن | **SubPaymentPlanItem** ✅ | البنية جاهزة: `{name, percentage, amount, timing, technicalStageId, 'SIGNING'}`. **إضافة جوهرية:** حالة لكل دفعة (`pending/approved/paid`) وربطها بمعرّفات المستخلصات الفعلية بدل الاعتماد على أسماء المراحل (خلية تكرار الأسماء P2-17)، وتحويل `'SIGNING'` إلى قيمة enum موثقة |
| `SubIPC.items[]` (النوع) | **SubContractItem** ✅ | التعريف الصحيح موجود في `types/procurement.ts:68-74` (`boqItemId, description, quantity, unitPrice, total`) لكنه لا يُكتب أبداً — يُنقل كبنية ملزمة: مستخلص بلا بنود يُرفض، و`boqItemId` إجباري للربط بالإنجاز الميداني |
| `SubIPC` (الهيكل + رياضيات المحتجزات) | **SubIPC/SubClaim** ✅ بعد إصلاح | الصيغة `gross − round(gross×rate/100,3)` سليمة؛ **إضافة:** `contractId` إجباري، فحص أن العقد `active`، سقف تراكمي ≤ totalAmount، حقل `deductions` بتفصيل، رفض الإنشاء بلا عقد (حالياً `?? 5` يصمت — P1-5)، حالة `approved/paid` مع صلاحيات، قيد timeline وقيد دفتري |
| `subcontractors` | **Subcontractor** ✅ | نقل مع: كود `trade` كمرجع معياري (وليس نصاً حراً)، إنفاذ `blacklisted` كبوابة في الإسناد والمستخلصات، حساب `totalPayable/totalPaid` فعلياً بدل الأصفار الثابتة |
| ترقيم `S-IPC-####` + عدادات | ✅ | `nextSequential` ناضج — يُنقل كما هو مع توحيد مفتاح العداد (سنوي/مركزي حسب سياسة ConTrack) |

### 8.2 لا يُنقل (يعاد بناؤه أو يُسقط)

| كيان/سلوك NOVA | القرار | السبب |
|-----------------|--------|-------|
| `generateSubcontractorIPC` كما هي | ❌ يعاد بناؤها | دالة ميتة بلا استدعاء، بلا بنود، بلا عقد إجباري، بلا بوابة أهلية (P0-2/P1-4/P1-5) |
| `updatePOStatus` كما هي | ❌ يعاد بناؤها | بلا آلة حالات (يسمح cancelled→approved)، بلا مستدعٍ (P0-3) |
| دورة الاستلام بالكامل | 🔁 يعاد بناؤها | غير موجونة: لا استلام PO، لا تحديث `receivedQuantity`، لا تغذية مخزون، لا `inventoryTransactions` |
| `BOQInventoryLinkService` | ❌ يُسقط/يُعاد | مجموعة وهمية `purchase_orders_items` + بلا مستدعٍ (P1-11)؛ إن لزم يُبنى على `collectionGroup('items')` مع فلتر companyId |
| `quotes/page.tsx` (محلل AI) | ⏸️ يُؤجل | أداة نصية بلا حفظ ولا كيان — لو نُقلت تحتاج كيان Quote + حفظ التحليل + ربط بالمورد |
| `contracts/page.tsx` (عقود المالك تحت مسار procurement) | 🔁 يُعاد تموضعه | خلل معماري: عقود المالك ليست مشتريات — تُربط بـ ConTrack كعقد مالك مقابل SubContract (back-to-back) |
| بطاقات الامتثال والأصفار الزخرفية | ❌ تُسقط | بيانات مزيفة تضلل مراجع الحسابات (P2-8/9، P2-3/6، P2-1/2) |
| `inventory-service.assignAsset` بوضعها | 🔁 يُعاد كـ transaction | فحص-ثم-خصم بلا `runTransaction` (P1-7) والاسترجاع بلا تحقق (P1-8) |
| `assetAssignments` كبديل حركة مخزون | ❌ | العهدة سجل عهدة لا حركة مخزنية — ConTrack يحتاج `SubMaterialIssue` أو ما يعادله بسجل ثنائي القيد |

### 8.3 خريطة أولويات النقل

1. **أولاً (العمود الفقري):** SubContract + SubPaymentPlanItem + بوابة الأهلية على الخادم (Cloud Function أو Rules تتحقق من وجود عقد مالك معتمد) — لأن بوابة NOVA واجهية فقط.
2. **ثانياً:** SubIPC مع بنود SubContractItem إجبارية + آلة حالات draft→approved→paid + قيد.
3. **ثالثاً:** تحرير المحتجزات + back-to-back مع مطالبات المالك.
4. **رابعاً:** دورة المشتريات (اعتماد→استلام→مخزون) إن كان ConTrack سيتكفل بها.

---

## 9. خلاصة تنفيذية

| المحور | الحكم |
|--------|-------|
| بنية العلاقات (Types + Paths) | 🟢 التصميم الورقي ناضج ومتسق (7/10) |
| دورة الباطن: عقد | 🟡 إنشاء يعمل، بلا اسم، بلا دورة حياة، بلا ترقيم (5/10) |
| دورة الباطن: مستخلص S-IPC | 🔴 **ميت بنيوياً** — دالة بلا مستدعٍ، بلا بنود، بلا اعتماد/صرف (1/10) |
| دورة المشتريات PO | 🔴 تنشأ وتعلق draft، مسار التفاصيل 404، لا اعتماد/استلام/قيد (2/10) |
| الموردون/العرض AI | 🔴 سجل عرض فقط، لا كيانات ولا روابط (2/10) |
| المخزون/العهد | 🟡 صرف/استرجاع عهدة يعملان شكلياً مع سباق تزامن؛ لا إدخال ولا استلام ولا سجل حركة (3/10) |
| المحتجزات (الرياضيات) | 🟢 الصيغة والتقريب سليمان، كل ما حولها منتفٍ (6/10) |
| الأمن | 🔴 قواعد شاملة مفتوحة + صلاحيات واجهة قابلة للتجاوز (1/10) |
| بيانات مزيفة | 🔴 8 مواضع موثقة أعلاه |

**إجمالي الأعطال الموثقة: 5×P0 + 15×P1 + 25×P2 = 45 عطلاً.**

*انتهى التقرير — أُعد بمراجعة سطرية كاملة للملفات المذكورة في القسم 0.1 مع تتبع الاستدعاءات في 0.2.*
