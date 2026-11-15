# جرد الألوان في ConTrack — color-audit.md

> الجرد النصي الكامل قبل تطبيق الهوية البصرية الجديدة (جلسة 2026-11-16).
> الأداة: بحث نصي (ripgrep) على `src/**` بأنماط: hex `#FFF` / `rgb(a)` / `hsl(a)` /
> كلاسات Tailwind الثابتة (`bg-emerald-100`…) / الكلاسات المضمنة `bg-[#…]`.

## الخلاصة

| الفئة | العدد | القرار |
|---|---|---|
| لوحة NOVA المركزية في `globals.css` | ~40 متغيرًا | **تستبدل كاملة** بالباليت الجديدة (tokens واحدة) |
| كلاسات لونية ثابتة في الشاشات | **~450 موضعًا في ~40 ملفًا** | تُحوَّل إلى tokens (مرحلة 5) |
| ألوان hex مضمنة في كود الواجهة | ~35 موضعًا | تُحوَّل أو توثَّق كاستثناء بيانات |
| ملفات الطباعة/PDF (HTML مولَّد) | ~110 موضعًا | **لا تُمس** — طباعة بخلفية بيضاء (قرار تسليم مرحلة 5) |
| أخطاء CSS قائمة | 3 أنماط | `hsl(var(--x))` على متغيرات hex = إعلان ملغى — يُصلَّح |

---

## 1) المصدر المركزي الحالي — `src/app/globals.css` (لوحة NOVA الكريمية)

المتغيرات المعلنة حاليًا وستُستبدل بالهوية الجديدة:

| المتغير | القيمة الحالية | المشكلة |
|---|---|---|
| `--background` | `#FDF8F3` | **الخلفية الكريمية** — تُستبدل بـ `--bg-page: #F4F6F8` |
| `--card` / `--popover` / `--sidebar` | `#FFFDF9` | سطح دافئ — يُستبدل بأبيض نقي `#FFFFFF` |
| `--secondary` / `--muted` / `--accent` | `#F5EFE3` / `#FFF8E1` | **بيج/أصفر باهت** — يُستبدل برمادي بارد `#EEF1F4` |
| `--border` / `--input` | `#EDE4D3` / `#E0D5C0` | حدود ورقية دافئة — تُستبدل بـ `#E5E7EB` |
| `--primary` | `#FFB000` | يُستبدل بالذهبي `#FFA311` |
| `--primary-foreground` | `#0F172A` | نص فوق الذهبي = غامق `#1F2937` دائمًا |
| `--brand-flame` / `--brand-flame-ink` | `#FF5722` / `#BF360C` | يُستبدلان بـ `--brand-orange: #F5800E` |
| `--brand-sun` | `#FFD600` | يُستبدل بـ `--brand-yellow: #FFC929` |
| `--status-info` | `#2563EB` | يُستبدل بالأزرق المعلوماتي `#089BE5` ونصه `#0678B4` |
| `--destructive` / `--status-danger` | `#B91C1C` | يُستبدل بالخطر `#C93B1E` (الأحمر وحده للحالات الحرجة) |
| `--status-done` | `#334155` (رمادي) | «مكتمل/متوفر» يصبح **أخضر النجاح** `#14804A` |
| `--ring` | `#B45309` | حلقة التركيز تصبح `#089BE5` |
| شريط التمرير | `#D8CCB8` / `#C4B49C` | دافئ — يُستبدل برمادي بارد `#D1D5DB`/`#9CA3AF` |

**أخطاء قائمة تُصلَّح مع المرحلة 1:**
- أنماط محرر المستندات في `globals.css` (سطر 230-347) تستخدم `hsl(var(--border))` و`hsl(var(--muted))` — المتغيرات قيم hex وليست ثلاثية HSL، فالإعلان **ملغى فعليًا** في CSS. يُكتب مرجعًا مباشرًا `var(--border)`.
- `src/components/ui/sidebar.tsx:483` نفس الخطأ `hsl(var(--sidebar-border))`.
- ألوان المحرر الثابتة `#f59e0b` (تحديد/مقبض العمود) تتحول إلى `--brand-orange`.

## 2) المكوّنات المشتركة

| الملف | المواضع | القرار |
|---|---|---|
| `ui/button.tsx` | ظل الشعلة `var(--brand-flame)`، ظل التدمير `#7F1D1D`، الروابط `text-status-info` | hover رئيسي = `--brand-orange` · التدمير = `--danger` · الروابط = `--info-blue-text` · الثانوي أبيض بحد رمادي |
| `ui/badge.tsx` | 4 متغيرات فقط (tokens) | إضافة متغيرات حالة ناعمة (success/warn/info/danger) بخلفية 12% ونص غامق |
| `ui/toast.tsx:80` | `text-red-300 / red-50 / ring-red-400` (variant destructive) | → tokens الخطر |
| `ui/chart.tsx:58` | `stroke='#ccc'` داخل محددات recharts | خلفي للرسوم — يُترك (رمادي محايد) |
| `ui/sidebar.tsx:483` | `hsl(var(--sidebar-…))` | إصلاح المرجع (غير مستخدم فعليًا في ConTrack) |
| `contrack/dropdown.tsx:74` | `hover:bg-[#E9ECEF]` (مرتين نصًا وتعليقًا) | → token `--hover: #EEF1F4`، والـ ✓ للعنصر النشط = `--brand-orange` |
| `contrack/AppShell.tsx:208,260` | `bg-[#E9ECEF]` (القسم المفتوح/زر التطبيقات) | → token الهوية الجديدة |
| `contrack/StatusBadge.tsx` + `lib/format.ts` STATUS_STYLES | جدول الحالات المركزي (tokens حاليًا لكن قيمها NOVA، والمكتمل رمادي) | قيم جديدة: مكتمل=أخضر، معلومة=أزرق، تحذير=أصفر، خطر=أحمر — بادج ناعم 12% |

## 3) ألوان hex مضمنة في الواجهة

| الملف | الألوان | القرار |
|---|---|---|
| `lib/dashboard-core.ts:39-55` | ALERT_HEX: `#DC2626 / #D97706 / #4F46E5 (بنفسجي-نيلي!) / #7C3AED / #B45309` · ACTIVITY_HEX: `#15803D / #B91C1C / #4F46E5` · EMPTY_FEED_CLASS `text-[#0F7A38] bg-[rgba(22,163,74,0.10)]` | → الباليت: خطر/تحذير-نص/أزرق-نص/برتقالي تمييز/نجاح — استهلاكها في `DashboardView` عبر نفس الثوابت |
| `contrack/CashflowChart.tsx:11-14` | GREEN `#16A34A` · RED `#DC2626` · TEXT `#334155` · MUTED `#64748B` | → `#14804A / #C93B1E / #1F2937 / #4B5563` |
| `contrack/settings/workflow-tab.tsx:231,248` + `api/workflow-stages/route.ts` + `lib/seed-defaults.ts` | `#3B82F6` **لون مرحلة مخزّن في قاعدة البيانات** (بيانات مستخدم لا تنسيق واجهة) | **استثناء بيانات** — لا يُمس (قابل للتعديل من المستخدم) |
| `contrack/doc-templates/doc-template-editor.tsx:317` | `#dc2626` لون نص يختاره المستخدم داخل مستند Word-مثل | **استثناء بيانات** — ميزة تلوين نص المستند |
| `contrack/StatementTable.tsx:42` | `background: #fff` داخل CSS الطباعة | طباعة — تبقى بيضاء (مطلوب) |
| `contrack/print/*.tsx` (3 ملفات) | `text-gray-500/600/800`, `bg-gray-50`, `border-gray-800`, `text-teal-700`, `text-red-700` | أوراق الطباعة A4 — تُبقى بيضاء؛ الرماديات توحَّد بالرمادي المحايد فقط دون تغيير شكل الطباعة |

## 4) كلاسات Tailwind الثابتة في الشاشات (~450 موضعًا — المرحلة 5)

الاستخدام كلُّه دلالي (حالات): الأخضر=إيجابي، الكهرماني=تحذير، الأحمر=خطر، البنفسجي/التركواز/السماوي=تمييز معلوماتي، السليت/الحجري=محايد. الخريطة الموحدة للتحويل:

| الكلاس الحالي (كل درجاته) | يصبح | ملاحظة |
|---|---|---|
| `bg-emerald-50/100/950` + `text-emerald-300/400/600/700/800` + `border-emerald-200/300/500/900` | بادج/سطح ناجح: `bg-success-soft` + `text-success-ink` + `border-success/30` | «متوفر/مكتمل/مقبول» |
| `bg-amber-*` + `text-amber-*` + `border-amber-*` | تحذير: `bg-warn-soft` + `text-warn-ink` + `border-warn/40` | «منخفض/مسودة/متبقٍ» |
| `bg-red-*` + `text-red-*` + `border-red-*` | خطر: `bg-danger-soft` + `text-danger` + `border-danger/40` | «نافد/متأخر/خطأ» |
| `bg-purple-*` + `text-purple-*` + `border-purple-*` | معلوماتي: `bg-info-soft` + `text-info-ink` + `border-info/40` | تمييز أنواع/مراحل |
| `bg-teal-*`, `bg-sky-900` | معلوماتي نفسه | |
| `bg-orange-*`, `text-orange-*` | العائلة البرتقالية: `--brand-orange` عائلة العلامة | |
| `text-slate-*`, `bg-slate-*`, `border-slate-*`, `bg-stone-*`, `text-stone-*`, `border-stone-*` | الرماديات المحايدة من tokens (`--text-secondary`, `--muted`, `--border`) | |
| `bg-emerald-500/600`, `bg-red-500`, `bg-amber-500`, `bg-teal-500` (نقاط وأزرار صلبة) | `bg-success / bg-danger / bg-warn / bg-info` صلبة | |

### التوزيع حسب الملف (عدّاد المواضع)

الملفات الثقيلة: `CustomerDetailView` (85) · `BoqTab` (43) · `SupervisionTab` (34) · `GroupsView` (34) · `SubContractsTab` (30) · `PaymentsTab` (30) · `StagesTab` (23) · `boq-doc-import-dialog` (19) · `InvoicePrintDialog` (19) · `BoqImportDialog` (19) · `ContractPrintDialog` (17) · `ScheduleImportDialog` (17) · `boq-docs-tab` (14) · `ContractNewPage` (14) · `NewContractDialog` (12) · `DevConsoleView` (11) · `VoucherPrintDialog` (10) · `TypesView` (10) · `ArchiveView` (10) · `BankReconView` (9) · `LoginView` (7) · `ContractDetailView` (6) · والبقية ≤6 لكل ملف (developer tools، حوارات السندات، WorkflowEditor، VisitsView، FollowupView، DataManagementView، CustodyReports، StagePaymentsView، ui/toast).

## 5) خارج نطاق الشاشات (استثناءات موثقة)

- `lib/pdf/*.ts` (statement/bank-recon/financial-statements/invoice/gl = 74 موضعًا) و`app/api/customer-file/[id]/print/route.ts` (21) و`lib/xbrl-core.ts` (11): HTML مولَّد للطباعة/التصدير — **لا يُلمس** مطلقًا (شرط التسليم: الطباعة بيضاء وغير متأثرة).
- `lib/seed-defaults.ts` / `api/workflow-stages` / محرر المستندات: ألوان **بيانات** يديرها المستخدم.
- `CashflowChart`/`dashboard-core`: تُحوَّل قيمها للباليت لأنها عرض شاشة وليست طباعة.

## 6) التباين (WCAG AA) للتركيبات الجديدة المعتمدة

| التركيبة | النسبة |
|---|---|
| نص `#1F2937` على `#F4F6F8` / `#FFFFFF` | 13.5:1 / 14.7:1 |
| نص `#4B5563` على `#FFFFFF` / `#EEF1F4` | 7.6:1 / 6.9:1 |
| نص `#1F2937` فوق الذهبي `#FFA311` / البرتقالي `#F5800E` | 8.2:1 / 6.3:1 (نص غامق إلزامي — لا أبيض) |
| نص `#0678B4` على `#E1F3FC` | 4.9:1 |
| نص `#11673C` على `#E3F0E9` (نجاح ناعم) | 6.0:1 |
| نص `#B45309` على `#FFF9E5` (تحذير ناعم) | 4.7:1 |
| نص `#C93B1E` على `#F9E8E4` (خطر ناعم) | 4.7:1 |
| أبيض على `#C93B1E` (زر التدمير الصلب) | 5.1:1 |
