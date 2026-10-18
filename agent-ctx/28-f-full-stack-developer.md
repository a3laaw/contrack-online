# Task 28-f — full-stack-developer

## المهمة
تصفير أخطاء TypeScript في ملفات API المحاسبة/العقود/الإعدادات خارج reports/components/seed، مع إصلاح الثغرة الأمنية في حارس المصادقة — بدون أي تغيير منطقي (أنواع وحدود فقط).

## الملفات المعدلة (داخل النطاق حصريًا)
1. `src/app/api/custody/route.ts` (25 خطأ)
2. `src/app/api/items/[id]/route.ts` (14)
3. `src/app/api/contracts/[id]/items/route.ts` (12)
4. `src/app/api/payment-templates/route.ts` (7)
5. `src/app/api/payment-templates/[id]/route.ts` (6)
6. `src/app/api/vouchers/[id]/cancel/route.ts` (5)
7. `src/app/api/settings/visit-slot/route.ts` (4)
8. `src/lib/claim-number.ts` (1 — مشار إليه من /api/claims، بند TxClient)

## الإصلاحات حسب الأولويات الممنوحة
1. **ثغرة الحارس (SECURITY-CRITICAL)**: 13 موقعًا بنمط `if (g.error) return g.error` الذي لا يرفض أبدًا → `if ("response" in g) return g.response` ثم `g.user`. شملت: custody GET/POST + adminGuard(addAccount)، items/[id] PATCH + DELETE-admin، contracts/[id]/items GET/POST، payment-templates GET/POST و[id] PATCH/DELETE-admin، vouchers/[id]/cancel admin، visit-slot GET/PUT-admin. مفاتيح الصلاحيات كما هي.
2. **Decimal vs number**: Number() عند الحدود الحسابية/التنسيقية — computeBalances (custody)، qty×unitPrice (items/contracts items)، round3(contract.amount)، مقارنات q !== Number(item.qty)، formatKWD(Number(...))، DTO قوالب الدفع (pct/amountFixed)، kindOf(Number, Number)، effPct/effFixed في PATCH.
3. **حقول Prisma غير موجودة**: حذف `createdBy` من create Voucher ×3 في custody (كان سيرمي 500 وقت التشغيل). `deletedAt` على BoqItem → الحقل الفعلي `deleted` (فحص + تحديث + where).
4. **التواريخ النصية**: `cancelledAt: new Date()` → `todayStr()` (اصطلاح voucher-server)، `ymd` من vdate النصي `replace(/-/g,'')`، ymdOf تقبل string|Date.
5. **مصدّات api-utils الناقصة** (بلا لمس api-utils.ts): parseAmount محلية (custody + الملفان), addContractEvent محلية ×3 (contractEvent.create بنمط الجوار)، TxClient → `Prisma.TransactionClient`.
6. **nextNumber**: نمط المُنسّق المكسور `nextNumber('vouchers', (n)=>…, tx)` (RangeError وقت التشغيل) → `nextNumber('PV', 4, tx)` / `nextNumber('CV', 4, tx)` — مطابق لـVOUCHER_PREFIX في voucher-server وبنفس المخرجات المقصودة PV-####/CV-####.
7. **payment-templates**: إضافة `contractTypeId: type.id` الناقص لنداء validateTemplateInput في POST (تكملة هجرة contractTypeId Int).

## التحقق
- `bunx tsc --noEmit | rg 'error TS' | rg -v 'reports|components|seed'` ⇒ **صفر** (الباقي 111 كلها prisma/seed.ts وsrc/components/** لوكيل آخر).
- `bun run lint` ⇒ exit 0 بلا ملاحظات جديدة.
- dev.log سليم (401 متوقعة على مسارات reports بلا جلسة).

## ملاحظات
- إصلاح where `deleted: false` في contracts/[id]/items أصلح تلقائيًا خطأ `it.stage?.name` (تدهور النوع الناتج عن where التالف).
- خطآن مرحّلان ظهرا بعد أول تصفير (TS2367 مقارنات number≠Decimal في items/[id]) وأصلحا بـNumber().
- لا تغيير على api-utils.ts ولا schema.prisma ولا أي ملف خارج النطاق؛ الرسائل العربية وأكواد الحالة كما هي.
- التفاصيل الكاملة في worklog.md (قسم Task ID: 28-f).
