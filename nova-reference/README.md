# مرجع NOVA الأساسي — كود مالك المشروع

> **حالة: المرجع الأساسي المعتمد من المالك** (2026-11-14) — «سوف يكون مرجعنا الأساسي».
> المصدر: `upload/project (1).zip` المرفوع من المالك (فرع nova2026-erp، آخر commit: «عاوز كود ملف قواعد العمل كامل»).
> النسخة الديسكتوب القديمة `contrack_v9.15.18` **مُستبعدة من المرجعية** بقرار المالك.

## بطاقة النسخة

| البند | القيمة |
|---|---|
| المسار الكامل | `/home/z/my-project/nova-reference/nova-erp/` |
| النوع | Next.js 15 + Firebase (App Router) + shadcn |
| ملفات `src/` | **296 ملفاً** / **48,304 سطراً** TS+TSX — مطابق لمراجعة `docs/nova-full-review.md` |
| تاريخ آخر تعديل | 2026-11-14 (سليم ومحفوظ مع `.git` كامل: سجل commits ومستخدم) |
| الحجم | 17MB (بلا node_modules) |

## خريطة الكود (كود قواعد العمل)

| المجلد | المحتوى | أهمية للمرجعية |
|---|---|---|
| `src/services/` (44 ملفاً) | **لب قواعد العمل**: accounting-service, billing-service, billing-trigger-service, payment-milestone-service, boq-execution-service, boq-master-service, boq-reference-service, variation-service, procurement-service, payroll-service, gratuity-service, working-days-service, work-hours-engine, end-of-service-calculator, transaction-service, seed-service, technical-path-service... | **الأهم** — كل قواعد العمل المكتوبة |
| `src/lib/` | counters.ts (الترقيم الذري), permissions + permissions/, default-coa.ts, seed-data.ts, boq-tree-utils.ts | القواعد العابرة للوحدات |
| `src/firebase/` + `firestore.rules` (34 سطراً) | الإعدادات وقواعد الأمن | مرجع الأمن — مع مراجعة الثغرات الموثقة |
| `src/app/` | login/register/join/dashboard/developer | البنية والشاشات |
| `src/components/` | كل المكوّنات والشاشات | مرجع الواجهات |
| `src/types/` | كل نماذج البيانات | مرجع المخطط |
| `src/ai/` | مسارات الذكاء الاصطناعي (8) | مرجع AI |
| `docs/` + `GEMINI.md` | وثائق المشروع الداخلية | سياق المشروع الأصلي |

## كيف تُستخدم مع الوثائق الموجودة

1. **المراجعة السطرية الجاهزة**: `docs-audit/nova-full/02-a → 02-g` (1,908 سطراً بمراجع أسطر لكل ملف من هذا الكود) — أي قاعدة تُطلب، يُفتح ملفها هنا على السطر المذكور.
2. **القواعد الذهبية المستخرجة**: `BUSINESS_LOGIC_SPEC.md` (القواعد المالية العشر + قواعد البناء) — المرجع الإلزامي للتنفيذ في ConTrack.
3. **قاعدة النقل الثابتة** (من `nova-full-review.md` §5): كل ما يُنقل من NOVA **يُعاد بناؤه خادمياً** (API routes + Prisma + صلاحيات خادمية) — لا نقل client-side ولا قواعد Firestore.
4. **ما لا يُنقل أبداً** (موثق بالأسباب في §4 من المراجعة الكاملة): قواعد firestore الحالية، البريد السحري `admin@novaflow.com`، default-coa.ts، اللوحات المزيفة، كشف الراتب العشوائي، العدادات المخزنة.

## حماية المشروع الحالي

- المجلد **مستثنى** من `tsconfig.json` (exclude) ومن `eslint.config.mjs` (ignores) — لا يؤثر على lint ولا typecheck ولا build لمشروع ConTrack.
- لا يُشغَّل ولا يُبنى — مرجع قراءة فقط.
