# مراجعة دورة العملاء والعقود والفوترة (IPC) — Task 2-b
**المشروع:** NOVA ERP (Next.js 15 + Firebase Firestore) — التفكيك في `/home/z/review-nova`
**النطاق:** 31 ملفاً (~6,600 سطر) — صفحات العملاء/المعاملات/العقود/العروض/BOQ + CRM + 8 مكونات + 8 خدمات + counters + 4 أنواع.
**منهجية:** قراءة كاملة سطراً بسطر + تتبع الاستدعاءات عبر grep للتحقق من الكود الميت (dead code).

---

## 1) مخطط العلاقات الكامل للدورة (Entity Graph)

```
Client (clients/{id})
 │  fileNumber: C-0001/2025 (counter companies/{cId}/counters/client — runTransaction)
 │  status: new → contracted (يُفرض عند اعتماد العقد)
 │  sub: clients/{id}/history (ClientHistory)
 ├──1:N──► Transaction (transactions/{tId})
 │          transactionNumber = fileNumber-01 (عداد على عمود العميل transactionCounter — بدون قفل!)
 │          الأتمتة المالية: WIP 1205 + حساب فرعي + Profit Center + Cost Center
 │          sub: transactions/{tId}/stageInstances (StageInstance)
 │          sub: transactions/{tId}/timeline، /comments
 │
 │          ┌──(بوابة: عقد معتمد)──► مسار فني stages (من technicalStages قالب المسار)
 │          ├──1:1──► BOQ (boqs/{bId}) من boqTemplates
 │          │         sub: boqs/{bId}/items (BOQItem: planned/executed/estimatedRate/technicalStageId)
 │          │         sub: boqs/{bId}/variations/{voId}/items  ← أمر تغييري VO (ميت — انظر P0-2)
 │          │         دورة BOQ: draft (STUDY MODE، تعديل كميات/أسعار) → approveBOQ (baseline = Σ planned×rate)
 │          │
 │          ├──1:N──► Quotation (quotations/{qId}) من quotationTemplates
 │          │         draft → (حفظ أول = approved تلقائياً) → convertQuotationToContract
 │          │
 │          └──1:N──► Contract (contracts/{cId}) من contractTemplates أو تحويل العرض
 │                    milestones[] ← بند الدفعات (name/percentage/amount/timing/technicalStageId=SIGNING أو مرحلة)
 │                    retentionRate (افتراضي 5%)
 │                    draft → (حفظ أول = approved + فرض client.status=contracted + إنشاء ذمم 1202)
 │                    → markAsPaid (isPaid=true) → triggerMilestoneBilling('SIGNING','at') → IPC
 │
 └──────────────────────► IPC (ipcs/{id}) — مطالبة مالك (InterimPaymentCertificate)
                           status: draft ←(لا يوجد أي مسار اعتماد!)— يجب أن يكون: draft→clientCertified→approved
                           gross = Σ milestone amounts − retention(5%) = netPayable
                           ⚠ لا يحتوي lineItems رغم أن النوع والصفحات تتوقعها
                           Sub-IPC (subIpcs) — تُنشأ عبر generateSubcontractorIPC (ميتة — لا مستدعي)
```

**مسار الحالات (State Machines) الفعلية:**
| الكيان | الحالات | الانتقالات الموجودة | الانتقالات المفقودة |
|---|---|---|---|
| Client | new / prospective / contracted / inactive | new→contracted (تلقائي عند اعتماد عقد) | prospective لا يُستخدم، inactive لا يُطبق |
| Transaction | new / in-progress / completed / on-hold / cancelled | status يُقرأ فقط؛ لا يوجد كود يغيّر status المعاملة نفسها! | new→in-progress→completed **لا يحدث أبداً** (badge يبقى new للأبد) |
| BOQ | draft → approved | approveBOQ (batch واحد مع timeline) | لا إلغاء/إعادة فتح baseline |
| Quotation | draft → approved | حفظ أول مسودة = approved تلقائياً (page:138) | sent/rejected (موجودة بالنوع، غير مستخدمة) |
| Contract | draft → approved/signed → paid | حفظ أول = approved (page:142)؛ markAsPaid = paid | clientCertified، active، completed لا تُستخدم |
| VO | draft → approved / cancelled | approveVariation/rejectVariation | **لا UI يستطيع الوصول إليها أصلاً (P0-2)** |
| IPC | draft → clientCertified → approved | **فقط draft — جامدة** | الاعتماد كله مفقود (P0-1) |

---

## 2) سير العمل خطوة بخطوة (كما هو مُنفَّذ فعلياً)

1. **فتح ملف عميل** (`clients/new` + `client-form`): رقم الملف يُعرض من `getProjectedNextNumber` (عرض فقط)، والحفظ عبر `ClientService.addClient` = `runTransaction` على عداد `counters/client` → `C-0001/2025` + سجل history. ⚠ لا يوجد فحص تكرار رغم أن الصفحة تتعامل مع خطأ `DUPLICATE_FILE` (خطأ ميت — new/page.tsx:40).
2. **فتح معاملة** (`transactions/new`): نشاط→خدمة→مسار فني + قسم + مهندس → `TransactionService.createTransaction`: رقم `fileNumber-NN` من عمود `transactionCounter` بالعميل (read-then-batch — سباق P1)، ثم 4 نداءات محاسبية (WIP 1205، حساب فرعي، مركز ربحية، مركز تكلفة) **خارج الـ batch** (P1).
3. **بوابة العقد** (`transactions/[tId]`): `hasApprovedContract` (سطر 94-96) يقفل رادار التنفيذ وزر BOQ حتى يوجد عقد approved/paid/active/signed.
4. **BOQ** (`transactions/[tId]/boq`): تفعيل من قالب (فلاتر subServiceId) → وضع STUDY (تعديل plannedQuantity/estimatedRate مباشرة على Firestore) → "تأكيد الميزانية المرجعية" = `approveBOQ(total = Σ planned×rate)`. بعد الاعتماد: الأعمدة Prev (من IPCs معتمدة lineItems) وCurr (executed−prev) وإجمالي المنفذ×السعر.
5. **التنفيذ** (`transactions/[tId]`): `initializeTechnicalPath` ينسخ مراحل المسار الفني → مباشرة/تسجيل إنجاز (كميات من بنود BOQ، رفض تجاوز المخطط مع رسالة "أنشئ أمر تغييري" — **ميزة الـ VO غير موجودة في الـ UI، P0-2**) → إتمام مرحلة → تراجع Admin (تصفير executed، أرشفة executions وتعليقات المرحلة).
6. **عرض السعر** (`quotations/[qId]`): توليد من قالب → تعديل بنود (نسبة/بندية) → حفظ أول = approved. ⚠ الصفحة **منهارة بـ ReferenceError** (`formData`/`m` غير معرفة — P0-1).
7. **تحويل إلى عقد** (`convertQuotationToContract`): نسخ كامل حقول العرض + بناء milestones من items + فرض status:'approved' على العرض.
8. **العقد** (`contracts/[cId]`): تعديل (نمط تسعير، محتجزات، دفعات مرتبطة بـ SIGNING أو مرحلة فنية، نص قانوني) → حفظ أول مسودة = **approved تلقائياً** + فرض client=contracted + إنشاء حساب ذمم 1202 فرعي للعميل → زر "توثيق السداد" (Admin فقط، بشرط approved/signed) → `triggerMilestoneBilling('SIGNING','at')` → IPC بحالة **draft** ← **طريق مسدود (P0-1)**.
9. **الفوترة** (`billing-service`): IPC للمالك (gross من الدفعات، retention 5%، net) — لا اعتماد، لا lineItems، لا ترحيل محاسبي. مستخلصات الباطن (subIpcs) دالة توليدها بلا مستدعي (P0-4).
10. **CRM** (`crm/page`): leads جدول بسيط + إضافة lead — لا تحويل lead→client، زر فلتر ديكور.

---

## 3) جدول الأعطال (بالسطر والاقتباس)

### P0 — انهيار / ميزة ميتة / خطر مالي جوهري

| # | الملف:السطر | الاقتباس | الأثر |
|---|---|---|---|
| **P0-1** | `quotations/[qId]/page.tsx:425,427,429,431,439,440` (وأيضاً `:399`) | `{formData.pricingMode === 'itemized' ? (` / `value={m.quantity === 0 ? ...}` / `m.technicalStageId ? ...` | متغيرات `formData` و`m` **غير معرفة** في المكوّن (المسمى `editData`/`item`). ReferenceError فوري عند عرض أي بند → **صفحة عرض السعر منهارة بالكامل** (يفشل `next build` type-check أيضاً). دورة العرض→العقد ميتة من الواجهة. |
| **P0-2** | `vo-manager-dialog.tsx:52` + `variation-service.ts:45,111,243` + `transactions/[tId]/page.tsx:189` | `export function VOManagerDialog(...)` — **لا يوجد أي import له في المشروع كله**؛ و«يرجى إنشاء أمر تغييري» | سلسلة أوامر التغيير (VO) **ميتة بالكامل**: لا UI لإنشاء/اعتماد/رفض VO، و`VariationService.createVariation/approveVariation/rejectVariation` كود لا يمكن الوصول إليه. النتيجة: بعد اعتماد BOQ لا يمكن رفع plannedQuantity أبداً → أي حاجة لكمية إضافية **تجمّد المشروع عند 100%**. |
| **P0-3** | `billing-service.ts:95` + grep على `status: 'approved'` | `status: 'draft'` (ipcData) — لا يوجد أي كود يرفع IPC إلى approved/clientCertified | **لا يوجد مسار اعتماد لمستخلصات المالك**: صفحة `accounting/claims` للعرض فقط (122 سطراً بلا أزرار). كل IPC يبقى draft للأبد → `boq/page.tsx:70` (فلتر `status=='approved'`) يعطي Prev=0 دائماً → **currentToBill = كامل المنفذ في كل مطالبة → خطر فوترة مكررة عند إضافة أي مسار اعتماد مستقبلاً**، و`analytics-service.ts:93` يقرأ إيرادات = 0 دائماً. |
| **P0-4** | `billing-trigger-service.ts:24-108` + `payment-milestone-service.ts:28-136` + `billing-service.ts:129-182` | `export class BillingTriggerService` / `export class PaymentMilestoneService` / `async generateSubcontractorIPC` — grep: **لا مستدعي إطلاقاً** | ثلاث مكوّنات مالية ميتة: (أ) فوترة الدفعات المرتبطة بمراحل فنية (BillingTriggerService) — أي دفعة غير SIGNING **لا تُفوتر أبداً**؛ (ب) توزيع سندات القبض FIFO على الدفعات + بيان السرد (PaymentMilestoneService) — السداد غير موصول بالعقد؛ (ج) مستخلصات مقاول الباطن — صفحة `procurement/sub-claims` فارغة دائماً. |
| **P0-5** | `billing-service.ts:88-107` مقابل `types/documents.ts:137-146` و `boq/page.tsx:77-80` | ipcData **بدون** `lineItems` بينما `lineItems: { boqItemId, currentQty, ... }[]` مطلوبة بالنوع | IPC يُنشأ بلا بنود، بينما صفحة BOQ وanalytics تقرأ `ipc.lineItems[].currentQty` لحساب المفوتر سابقاً → النوع مكسور والمزامنة IPC↔BOQ غير موجودة تصميمياً. |

### P1 — منطق / مالي / تكامل بيانات

| # | الملف:السطر | الاقتباس | الأثر |
|---|---|---|---|
| **P1-1** | `document-manager-dialog.tsx:171-187` | `await updateDoc(docRef, { status: 'paid', isPaid: true, ... })` مباشرة على Firestore | "توثيق سداد" من الديالوج **يتجاوز DocumentService بالكامل**: لا إنشاء ذمم 1202، لا فرض client=contracted، لا إطلاق IPC، ولا تحقق من حالة العقد (شرط العرض `:289` يسمح بتمييز **مسودة** كمدفوعة). حالة شاذة: عقد paid بلا حسابات ولا مطالبة. |
| **P1-2** | `transaction-service.ts:54-63` | `const clientSnap = await getDoc(clientRef); const nextCounter = (clientData.transactionCounter||0)+1` ثم `batch.update` | **سباق (race condition)** على رقم المعاملة: قراءة ثم كتابة بلا `runTransaction` → رقمَا معاملة متطابقان تحت التزامن (تناقض مع وعد "الترقيم الصارم" في client-service). |
| **P1-3** | `transaction-service.ts:97-121` | `await accService.ensureControlAccount(...); await accService.createAutomaticSubAccount(...)` قبل `batch.commit():130` | الأتمتة المحاسبية (4 كائنات) **خارج الـ batch**: فشل الـ commit يترك حسابات WIP/مراكز ربح ويتيمة، وبلا أي تراجع compensating. |
| **P1-4** | `document-service.ts:108-126,130` | `contractData = { ...quote, ... milestones: (quote.items||[]).map(...) }` + `batch.update(quoteRef, { status: 'approved' })` | (أ) نسخ حقول العرض كلها للعقد (items, defaultTerms, boqTemplateId...) تلوث المستند؛ (ب) `milestone.amount` قد تكون **قديمة** إذا غيّر المستخدم totalAmount بعد ضبط النسب (إعادة حساب amount تتم فقط عند تعديل النسبة لكل بند) → دفعات بعIncorrect amounts؛ (ج) فرض approved على العرض حتى لو كان مسودة. |
| **P1-5** | `contracts/[cId]/page.tsx:142` | `const newStatus = (contract?.status === 'draft' && !contract.isHistoryRecorded) ? 'approved' : editData.status;` | **اعتماد ذاتي بدون بوابة مراجعة**: أول حفظ لمسودة العقد = approved فوري من نفس المحرر (لا دور موافقات)، ويقفل أثر isHistoryRecorded. |
| **P1-6** | `client-service.ts:112-120` + `transaction-service.ts:134-138` + `document-service.ts:321-329` | `return deleteDoc(...)` | حذف عميل/معاملة/عقد/عرض = حذف مستند واحد **بلا cascade**: history، stages، timeline، comments، contracts، BOQs، IPCs، حسابات 1202/1205 تبقى يتيمة (والحذف يتم من العميل مباشرة). |
| **P1-7** | `billing-service.ts:69` | `alreadyBilledMilestones.has(m.name)` | منع التكرار بمسمى الدفعة (نص حر): دفعتان بنفس الاسم → الثانية **لا تُفوتر أبداً**؛ إعادة تسمية الدفعة بعد الفوترة → **فوترة مكررة**. المفتاح الصحيح هو معرّف ثابت للدفعة. |
| **P1-8** | `billing-service.ts:83-84` + غياب كلي | `netPayable = totalGrossAmount - retentionAmount` | **لا توجد أي آلية إفراج عن المحتجزات** (retention release/final account) في المشروع كله → 5% تُخصم من كل مطالبة ولا يعاد صرفها مطلقاً. |
| **P1-9** | `transaction-documents-view.tsx:124-125` | `instantiateQuotationFromTemplate(..., 'SYSTEM', 'Admin')` | المستندات تُنشأ باسم **'SYSTEM'/'Admin'** بدل المستخدم الحقيقي → تدمير سجل التدقيق createdBy/updatedBy. |
| **P1-10** | `transaction-documents-view.tsx:178-181,141-146` | `else router.push(.../${type === 'quotation' ? 'quotations' : 'contracts'}/${item.id})` و `if type==='quotation'... else if 'contract'... else if 'subcon_contract'` | صفوف IPC/subipc في القوائم: النقر ينقل إلى **مسار عقد خاطئ** `/contracts/{ipcId}` (404)، والحذف **no-op صامت** لكن تُعرض رسالة "تم الحذف بنجاح". |
| **P1-11** | `transactions/[tId]/page.tsx:287-290` | `await commentService.archiveStageComments(...)` ثم `await batch.commit()` | أرشفة التعليقات **خارج الـ batch**: فشل الـ batch بعد الأرشفة = تعليقات مؤرشفة بينما المرحلة لم تُصفَّر (لا rollback). |
| **P1-12** | `comment-service.ts:72-78` | `type: 'visit_logged', content: '[ملاحظة فنية] ...'` | كل تعليق فني يُسجَّل في تاريخ العميل كـ **"زيارة"** وهمية → تلوث سجل الزيارات (أثر على تقارير الحقول). |
| **P1-13** | `clients/[id]/page.tsx:69` | `query(..., where('clientId','==',clientId))` | عزل المعلوماتي ناقص: صفحة العميل تعرض **كل** المعاملات (بما فيها معاملات مهندسين آخرين) لأي مهندس معيَّن على العميل — عكس فلتر `assignedEngineerId` المطبق في قائمة العملاء (`clients/page.tsx:65-67`). |
| **P1-14** | `billing-trigger-service.ts:50-51` | `const contractsSnap = await getDocs(contractsRef)` | فحص الأثر المالي يجلب **كل عقود الشركة** بلا فلترة transactionId (أداء + خطر تطابق milestone keys عبر عقود). (كود ميت حالياً لكنه مصمم خطأ). |
| **P1-15** | `types/documents.ts:56-60` + grep | `advancePayment: { amount, recoveryRate, recoveredToDate }` | **حقل ميت**: الدفعة المقدمة واستردادها المتناسب غير منفذين في أي خدمة/صفحة — عقد بسلفة لا يُسترد منها شيء آلياً. كذلك `billedQuantity/verifiedQuantity` على BOQItem تُصفَّر فقط (`document-service.ts:176`) ولا تُحدَّث بعدها أبداً. |

### P2 — جودة / أداء / أمان ثانوي

| # | الملف:السطر | المشكلة |
|---|---|---|
| P2-1 | `transactions/[tId]/page.tsx:98-99,109-110` و `boq/page.tsx:58-59,87-88` | جلب **كل** BOQs/كل القوالب للشركة ثم فلترة client-side (بلا where transactionId) — يتفاقم مع عدد المشاريع. |
| P2-2 | `transactions/[tId]/page.tsx:214-229` | `getStageConstructionProgress` يجمع planned/executed **عبر وحدات قياس مختلفة** (م² + عدد + طن) في نسبة واحدة — نتيجة لافت县级以上معنى. |
| P2-3 | `transactions/[tId]/page.tsx:186-191` | تحقق الكمية client-side فقط ولا يرفض صفر/سالب (`!logForm.quantity` يمنع الفراغ لكن `0.00-` يمر بخطوة واحدة عبر Number) — و`transaction-service.startStage/completeStage (:140-154)` لا يتحققان من التسلسل أو الصلاحية إطلاقاً. |
| P2-4 | `client-form.tsx:103-108` | فلتر المهندسين hardcoded: `departmentName?.includes('معماري') || includes('Arch')` — قاعدة عمل مدفونة في الواجهة؛ أي قسم معماري بتسمية أخرى لا يظهر. |
| P2-5 | `location-picker-dialog.tsx:85-87` | نداء **Nominatim العام** من المتصفح (انتهاك Usage Policy + إرسال عناوين العملاء لطرف ثالث بلا وسيط)؛ `map-view.tsx:9-14` وstatic: أيقونات من unpkg CDN وقت التشغيل. |
| P2-6 | `comment-section.tsx:287` | `AvatarImage src={`https://picsum.photos/seed/${item.createdBy}/40/40`}` — **صور وهمية** + تسريب uid لطرف ثالث، ولا علاقة للصورة بالشخص. |
| P2-7 | `comment-section.tsx:174-179` مقابل `:185,200` | تبان "الأرشيف" و"الوقت" (chat_archive/time_archive) في التبويبات لكن **لا يوجد TabsContent لهما** → `currentStream`/`paginatedStream` للأرشيف محسوبة ولا تُعرض أبداً (ميزة ميتة UI). |
| P2-8 | `clients/page.tsx:134` و `crm/page.tsx:143-146` | زر "فلترة" ديكور بلا أي منطق. |
| P2-9 | `new/page.tsx:40-42` | معالجة خطأ `DUPLICATE_FILE` — الخدمة لا تُطلقه أبداً (فحص التكرار غير موجود رغم التحقق الزائف من الوحدانية بالتعليق `client-service.ts:46-49`). |
| P2-10 | `client-service.ts:127` | `import { updateDoc, deleteDoc, addDoc }` **في نهاية الملف** بعد الكلاس (يعمل بالهوستنج لكنه خطر صيانة). |
| P2-11 | `crm/page.tsx:50-69` | Lead: لا تحويل إلى عميل، لا حالات، لا owner scope عند الإنشاء (`departmentId: 'general'` fallback) — CRM شبه ميت. |
| P2-12 | `contracts/[cId]/page.tsx:451-461` | حساب colSpan في tfoot غير متطابق مع عدد الأعمدة الفعلية (خلل تنسيق طباعي). |
| P2-13 | `contracts/[cId]/page.tsx:120` و `quotations/[qId]/page.tsx:116` | في نمط `fixed` لا يوجد أي تحقق أن Σ الدفعات = الإجمالي (البوابة للنسب فقط) → عقد fixed بدفعات لا تجمع قيمته. |
| P2-14 | `quotations/[qId]/page.tsx:216` | بند جديد باسم ثابت بالإنجليزية `Installment ${n}` بغض النظر عن لغة الواجهة. |
| P2-15 | `transactions/[tId]/page.tsx:358` | نص مثبت باسم عميل حقيقي في رسالة عامة: «بناءً على بروتوكول "معاملة العميل عبدالحميد البكري"...» — **بيانات مزيفة/تسريب اسم عميل في الكود**. |
| P2-16 | `clients/[id]/page.tsx:77` و `location-picker-dialog.tsx:56` | تحليل الإحداثيات بـ regex من رابط Google Maps (`q=` أو `@`) — أي تنسيق آخر (place/!3d) يُتجاهل بصمت. |
| P2-17 | `client-form.tsx:148` | رقم الملف المعروض (`projectedNumber`) غير مرتبط بالنموذج ولا يُحفظ — عرضي فقط وقد يظهر نفس الرقم لمستخدمين متزامنين. |
| P2-18 | `transactions/new/page.tsx:97-101` | أسماء النشاط/الخدمة تُخزن **حسب لغة منشئ المعاملة** (`isRtl ? name : nameEn`) → بيانات غير محايدة للغة تؤثر على `isDesignProject` (`transactions/[tId]:117-120` يفحص النص العربي/الإنجليزي). |

---

## 4) المنطق المالي المفصل (كما هو مكتوب فعلياً)

### 4.1 قيمة العقد
- ثلاثة أنماط (`PricingMode`): `percentage` / `fixed` / `itemized`.
- percentage: بوابة صارمة `|Σ% − 100| < 0.1` (contracts page:117-120,126-133)؛ قيمة السطر = `totalAmount × %/100` (page:373-375)، والتعديل على النسبة يحدّث المبلغ والعكس (page:188-203).
- itemized (عروض): `Σ unitPrice×quantity` (quotation page:114) وtotalAmount النهائي = هذا المجموع عند الحفظ (page:134-136). التقريب: `Math.round(x*1000)/1000` (quotation page:200) — 3 خانات عشرية متوافق مع الدينار الكويتي (فils).
- fixed: لا بوابة مجموع (P2-13).
- المحتجزات: `retentionRate` من القالب/التعديل، افتراضي 5 (`?? 5` في contract page:90 و billing-service:82,154 — nullish فيحفظ 0 الصريح).

### 4.2 BOQ Baseline
- عند الاعتماد: `total = Σ(plannedQuantity × estimatedRate)` للبنود ذات planned>0 (boq page:125) → يُختم على BOQ مع approvedBy/approvedAt (document-service:188-211).
- التعديل بعد الاعتماد **مستحيل** (handleUpdateDraft يُخرج مبكراً إذا status≠draft — boq page:111) والسبيل الوحيد هو VO — **ميت (P0-2)**.
- حماية التنفيذ: `executed + qty > planned` → رفض مع طلب VO (transactions page:188-191) — client-side فقط.

### 4.3 IPC (مطالبة المالك) — المحرك الوحيد الحي
- الزناد الوحيد: `updateContract` عند `finalStatus === 'paid' || data.isPaid` → `triggerMilestoneBilling(tId,'SIGNING','at',...)` (document-service:74-76).
- المطابقة: دفعات العقد حيث `technicalStageId==='SIGNING' && timing==='at'` (billing-service:53-55).
- منع التكرار: مجموعة `milestonesTriggered` (أسماء) من كل IPCs المعاملة+العقد (billing-service:59-70) — هشاشة الاسم (P1-7).
- الاحتساب: `gross = Σ(m.amount || totalAmount×%/100)` → `retention = round3(gross × rate/100)` → `net = gross − retention` (billing-service:76-84).
- الترقيم: `nextSequential('ipc_owner_'+tId, 'IPC-', 4)` عبر عداد ذري (counters.ts:9-26) — سليم.
- الحالة النهائية: **draft للأبد** (P0-3)، بلا lineItems (P0-5)، بلا ترحيل قيود (`isJournalPosted` حقل ميت).

### 4.4 مستخلص الباطن (Sub-IPC)
- `generateSubcontractorIPC`: gross = amount مُمرَّر، retention من عقد الباطن أو 5%، `deductions: 0`، net = gross − retention (billing-service:129-182). **لا مستدعي** (P0-4) → عمود "مستخلصات الباطن" فارغ دائماً.
- لا ربط ببنود BOQ ولا بكميات منفذة (برسم مبالغ يدوية نظرياً).

### 4.5 السداد والتوزيع
- `PaymentMilestoneService.getMilestonesStatus`: توزيع FIFO لسندات القبض (`vouchers` type=receipt على contractId) على الدفعات بالترتيب، مع round3 (payment-milestone:51-68) — **كود ميت لم يُوصل بأي UI**.
- `generateReceiptDescription`: سرد عربي للتوزيع + كشف الفائض >0.01 — ميت أيضاً.
- زر "توثيق السداد" الحقيقي يكتفي بعلم isPaid=true (مع تحوّطيّة P1-1) — لا سند قبض، لا قيد، لا ربط بمستحقات.

### 4.6 المحاسبة المرافقة
- عند إنشاء المعاملة: WIP 1205 + حساب فرعي `(client − service) (WIP)` + مركز ربحية `PC-{number}` + مركز تكلفة `CC-{number}` (transaction-service:97-121).
- عند اعتماد العقد: ذمم 1202 + حساب فرعي `{clientName} - ذمم (AR)` (document-service:60-70).
- **الانقطاع**: لا قيد عند IPC، لا قيد عند السداد، لا إيراد/تكوين — الحلقة المحاسبية تُترك مفتوحة (هذا دور accounting-integration-service خارج نطاق المهمة، لكن لا نداء إليه من هذه الدورة).

### 4.7 خلاصة الأرقام المالية
> القاعدة المالية الصحيحة المطلوبة: **المفوتر الحالي = المنفذ المعتمد − المفوتر سابقاً**، مع retention يُخصم ويُفرج عنه. الواقع: Prev يُحسب من IPCs معتمدة لا وجود لها (دائماً 0)، والمنفذ موجود، والإفراج غير موجود، والاعتماد غير موجود — أي أن الدورة `تنفيذ→مطالبة→تحصيل` **مقطوعة في ثلاث نقاط**.

---

## 5) البيانات المزيفة / hardcoded / ملاحظات أمنية

1. اسم عميل حقيقي داخل رسالة نظام عامة: `transactions/[tId]/page.tsx:358` («بروتوكول معاملة العميل عبدالحميد البكري»).
2. صور أفاتار عشوائية picsum موصولة بـ uid المستخدمين: `comment-section.tsx:287`.
3. `userName: 'NovaFlow Finance Engine'` كصانع أحداث timeline (billing-service:117) و`'Finance Auto-Pilot'` (document-service:75) و`'SYSTEM'/'Admin'` (transaction-documents-view:124) — تلف نسب الإسناد.
4. أسماء أمثلة بنود `Installment N` (quotation page:216) و`الدفعة N` (contract page:210).
5. Nominatim/picsum/unpkg/OSM — أربع خدمات خارجية وقت التشغيل بلا proxy أو مفاتيح (خصوصية عناوين العملاء + توفر).
6. صلاحيات الواجهة فقط: كل العمليات المالية (markAsPaid المباشر، approveBOQ، updateContract) تنفَّذ من العميل؛ الحماية الفعلية تتوقف على قواعد Firestore (خارج النطاق) — خدمة markAsPaid المباشرة في document-manager-dialog تلتف حتى على ضوابط الخدمة.
7. `getIsAssignedEngineer` (variation-service:39) يقرأ `global_users/{uid}` — مسار عبر مستأجرين يجب ضبط قواعده بعناية.
8. حذف نهائي بلا سلة/تدقيق للعملاء والعقود من الواجهة (AlertDialog نصه يعد بأنه "لا يمكن التراجع" — فعلاً).

---

## 6) ما يستحق النقل إلى ConTrack (Prisma) وما لا يستحق

### ✅ يستحق النقل (جوهرة التصميم — أعد البناء عليها)
| العنصر | لماذا |
|---|---|
| **نموذج Client + fileNumber التسلسلي** | بنية سليمة: `C-####/YYYY` عبر عداد ذري. في Prisma: جدول `Client` + جدول `Counter(counterKey, seq)` بـ `SELECT ... FOR UPDATE` داخل transaction — نفس الضمانة ببساطة أكبر. أضف unique constraint على fileNumber (الفحص المفقود P2-9). |
| **علاقة Client↔Transaction↔Contract↔Quotation↔BOQ↔IPC** | الرسم المفاهيمي صحيح ومتعدد المستأجرين (`companyId` في كل مستند). في Prisma تصبح FKs حقيقية + `onDelete: Cascade` يحل مشاكل الحذف اليتيم (P1-6) مجاناً. |
| **Contract.milestones + retentionRate** | الفكرة (دفعات مرتبطة بمراحل فنية + timing before/at/during/after + محتجزات) هي قلب ConTrack — انقلها كجدول `ContractMilestone` مستقل (ليس JSON) مع `unique(contractId, milestoneKey)` يعالج P1-7 من الجذور. |
| **BOQ: baseline + items(planned/executed/rate) + قفل التعديل بعد الاعتماد** | نموذج ناضج (STUDY MODE → baseline). انقله كجدولين `Boq/BoqItem` مع versioning بدل الحالة الواحدة. |
| **ترقيم IPC/SIPC عبر counters** | منطق `nextSequential` سليم — يتحول لـ sequence لكل (company, type, year). |
| **قاعدة المحتجزات 5% + الصيغة round3** | الصيغة المالية نفسها سليمة — انقلها كـ domain service مع إضافة **آلية الإفراج** (P1-8) المفقودة. |
| **نسخ الأسماء الثنائية (name/nameEn) على المستندات** | تقرير ثبّت اللغة وقت الإنشاء — لكن خزّن الاثنين دائماً (يعالج P2-18). |

### ⚠️ يستحق النقل **بعد إعادة تصميم** (لا تنقل كما هو)
| العنصر | المشكلة الحالية | التصميم المقترح في ConTrack |
|---|---|---|
| IPC | بلا اعتماد/بنود/قيود (P0-1, P0-3, P0-5) | `Ipc → IpcLineItem(boqItemId, previousCumulative, currentQty, rate, amount)` + state machine draft→submitted→certified→approved→posted، وحساب Prev من مجموع lineItems المعتمدة (transactional). |
| VO (أوامر التغيير) | ميت بالكامل (P0-2) | أعِد بناءه ككيان أول-فئة: `Variation → VariationItem(type, sourceItemId, delta, rate)` + تأثيره على plannedQuantity داخل نفس الـ DB transaction (سهل في Prisma، مستحيل ضمانه في Firestore client-side). |
| دورة اعتماد العقود/العروض | اعتماد ذاتي عند أول حفظ (P1-5) | جدول `ApprovalStep` (approver, action, at) — مسار draft→review→approved صريح. |
| الأتمتة المحاسبية عند الإنشاء | خارج الـ transaction (P1-3) | في Prisma كل شيء في transaction واحدة: Transaction + WIP account + profit/cost center ذرّياً. |
| BillingTrigger | كود ميت بتصميم خاطئ (P0-4, P1-14) | انتقل لـ domain events داخل الخادم: `StageCompleted → schedule MilestoneBilling` (cron/queue) بدل مسح كل العقود من العميل. |
| Sub-IPC | دالة بلا مستدعي (P0-4) | اربطها بـ BoqItem.subcontractorId الموجود فعلاً — توليد من كميات الباطن مع retention من عقد الباطن. |
| PaymentMilestoneService (FIFO) | منطق سليم لكنه معزول (P0-4) | انقل الخوارزمية كما هي إلى `ReceiptAllocation` table (voucherId, milestoneId, appliedAmount) — تصبح دائمة وقابلة للتدقيق بدل حساب لحظي. |

### ❌ لا يستحق النقل (ألغِه أو استبدله)
| العنصر | السبب |
|---|---|
| `BillingTriggerService.instantiateTechnicalStages` (نسخة موازية لإنشاء المراحل) | مكررة ومختلفة الحقول عن `TransactionService.initializeTechnicalPath` — توحيد على نسخة واحدة فقط. |
| حقل `advancePayment/recoveryRate/recoveredToDate` بلا تنفيذ + `billedQuantity/verifiedQuantity` بلا تحديث + `clauses`/`requiresClientCertification` | مخطط زائف يضلل — إما تنفيذها في ConTrack أو لا تنقل الحقول. |
| `DocumentManagerDialog` (ديالوج المستندات القديم) | استُبدل بـ `TransactionDocumentsView` — كود ميت مع أخطر عطل (P1-1)؛ النسخة الجديدة أيضاً بها أعطال IPC (P1-10) لكنها الأساس الصحيح. |
| واجهة CRM/leads الحالية | بلا دورة حياة — إما تكامل حقيقي (lead→client مع سجل) أو لا تنقل. |
| حيل الواجهة المالية (حساب Prev/Curr من collections متفرقة client-side، جلب كل BOQs) | في ConTrack تُحسب بـ SQL aggregate منفردة (views) — لا تُنقل منطق الجلب الجانبي إطلاقاً. |
| `settlement.ts` | ليس من هذه الدورة (تسوية نهاية خدمة HR) — خارج نطاق 2-b. |

---

## 7) خلاصة تنفيذية
- الدورة **مبنية بتسلسل صحيح** (عميل→معاملة→BOQ→عقد→IPC) وبتصميم متعدد المستأجرين جيد، لكنها **مقطوعة عند الفوترة**: لا اعتماد IPC، لا VO، لا فوترة مراحل، لا مستخلصات باطن، لا إفراج محتجزات، لا ربط تحصيل.
- أخطر خمسة أعطال: (P0-1) انهيار صفحة العروض بمتغيرات غير معرفة، (P0-2) سلسلة VO ميتة تجمّد المشاريع، (P0-3) IPC بلا مسار اعتماد → Prev=0 دائماً وخطر فوترة مكررة، (P0-4) ثلاثة محركات مالية ميتة، (P1-1) "توثيق سداد" يتجاوز الخدمة والضوابط.
- الأولوية لإعادة البناء في ConTrack: كيانات IPC/VO/milestones كجداول حقيقية مع transactions خادمية و state machine صريح، بدل منطق client-side فوق Firestore.
