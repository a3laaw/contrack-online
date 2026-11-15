# قائمة شاشات ConTrack — screens.md

> مستخرجة من الراوتر الفعلي: `nav-structure.ts` (الوحدات والأقسام) + `contrack-types.ts` (ViewName)
> + `ConTrackApp.tsx` (خريطة العرض) + `reports-list.ts` + `settings/tabs-catalog.ts`.
> النظام SPA على المسار `/` — التنقل داخلي بلا URLs منفصلة، ولا يُمس أي مسار.
> عمود «مجموعة الهوية» = التلوين المعتمد لأيقونات الوحدة في شاشة التطبيقات (مرحلة 3):
> 🟡 ذهبي/برتقالي = المالية والتجارة · 🔵 أزرق = التشغيل · 🟡 أصفر = الموارد البشرية والاستشارات · ⚫ رمادي غامق = التقارير والمرجعية والإعدادات.

## ما قبل الدخول

| الشاشة | المكوّن |
|---|---|
| شاشة الدخول وتفعيل الشركات | `LoginView.tsx` |

## 1) وحدة العقود 🟡 ذهبي

| البند | الشاشة/المكوّن |
|---|---|
| اللوحة | `DashboardView` |
| المهام المستحقة | `DueItemsView` |
| العملاء | `CustomersView` |
| ملف العميل (تفصيلي) | `CustomerDetailView` |
| العقود | `ContractsView` |
| تفاصيل/تحرير العقد | `ContractDetailView` / `ContractEditPage` / تبويباته (BoqTab, StagesTab, PaymentsTab, SubContractsTab, AddendumsTab, SupervisionTab, ContractVouchersTab, ScheduleSection) |
| المراحل والدفعات | `StagePaymentsView` (+ TypesStagesPaymentsView) |
| مجموعات العقود | `ContractGroupsView` (+ GroupsView) |
| مركز النماذج | `FormsCenterView` |
| المهام | `TasksView` / `TaskEditPage` |
| جدول الزيارات | `VisitsView` |
| التعليقات | `CommentsView` / `CommentEditPage` |
| المتابعة | `FollowupView` |
| عقود جديدة | `ContractNewPage` / `NewContractDialog` |

## 2) وحدة المشاريع 🔵 أزرق

| البند | المكوّن |
|---|---|
| لوحة المشاريع (hub) | `ProjectsView` / `ProjectsManagerDialog` |
| التقرير اليومي (daily) | `ProjectsView` |
| تنفيذ البنود (takeoff) | `ProjectsView` |

## 3) وحدة الباطن 🔵 أزرق

| البند | المكوّن |
|---|---|
| مقاولو الباطن | `SubcontractorsView` / `SubcontractorFilePage` / `SubcontractorLedger` / `SubContractNewPage` / `SubContractDialog` |

## 4) وحدة الاستشارات 🟡 أصفر

الفريق الهندسي · إسناد المشاريع · ساعات العمل · مراجعات المخططات · الإجازات · رادار المواعيد — `ConsultingView` (6 أقسام) + `ConsultingRadar` + `ConsultingSummary`.

## 5) وحدة الموارد البشرية 🟡 أصفر

الموظفون · الحضور · الإجازات · الأذونات · مسير الرواتب · سلف الموظفين (`AdvancesView`) · نهاية الخدمة · الأطقم والتكليفات · التقارير — `HRView` (9 أقسام) + `LaborSection`.

## 6) وحدة المخازن 🔵 أزرق

| البند | المكوّن |
|---|---|
| الأصناف والمستودعات | `WarehousesView` → `ItemsSection` |
| أذون المخازن | `DocsSection` |
| الأرصدة والتقارير | `BalancesSection` (بطاقات إحصائية + «تحت الحد الأدنى») |

## 7) وحدة المبيعات 🟡 ذهبي

عروض الأسعار (`QuotesSection`/`QuotesManagerDialog`) · نقاط البيع (`PosSection`) — `SalesView`.

## 8) وحدة الصيانة والتشغيل 🔵 أزرق

عقود الصيانة · الجدول الوقائي · أوامر العمل — `MaintenanceView` (+ أوامر/مواد/فاتورة) + `ScheduleSection`.

## 9) وحدة المحاسبة 🟡 ذهبي

| البند | المكوّن |
|---|---|
| دليل الحسابات | `ChartOfAccountsView` |
| القيود اليومية | `JournalEntriesView` |
| دفتر الأستاذ والميزان | `LedgerView` |
| القوائم المالية | `FinancialStatementsView` |
| التسوية البنكية | `BankReconView` / `GatewayBankUploadPage` |
| الزكاة والتقديم | `ZakatXbrlView` |
| الفترات والإقفال | `FiscalPeriodsView` |
| سندات القبض/الصرف | `VouchersView` / `VoucherPage` / `ReceiptVoucherDialog` / `PaymentVoucherDialog` / `CancelVoucherDialog` / طباعة السند `print/VoucherPrintDialog` |
| كشف الحساب | `StatementView` / `StatementTable` |
| العُهد | `CustodyView` / `CustodyAccountsPage` / `CustodyReports` |
| سلف الموظفين | `AdvancesView` |
| بوابة الدفع | `GatewayView` / `GatewayUploadPage` / `GatewayProfileEditPage` / `GatewayFileParse` |
| الشركة الأخرى | `OtherCompanyView` / `OtherCompanyPayPage` |
| المطالبات المالية | `ClaimsView` / `ClaimNewPage` |
| الفواتير | `InvoicesView` / `InvoiceNewPage` / `print/InvoicePrintDialog` |

## 10) وحدة التقارير ⚫ رمادي غامق

- **نظرة عامة** (مركز التقارير — `ReportsHomeView`): صفحة كروت مصنفة — هدف المرحلة 4.
- التقارير الـ11 (`ReportsView` + `CashflowChart`): العملاء والأرصدة · مستحقات المراحل · الفرص البيعية · تقارير العقود · مراحل التنفيذ · تأخير الإشراف · المقاولون · الإيرادات والمصروفات · تفصيل المصروفات · التدفق النقدي · دفتر اليومية.
- روابط شاشات الدفاتر من المركز: كشف الحساب · الأستاذ والميزان · القوائم المالية · التسوية البنكية · الزكاة.

## 11) وحدة القوائم المرجعية ⚫ رمادي غامق

الأنواع والمراحل والدفعات · الوظائف والإدارات والأقسام (`OrgStructureView`) · المناطق (`AreasStructureView`) · جدول الكميات BOQ (`settings/boq-docs-tab` + محرر البنود) · مصمم القوالب (`doc-templates/*` — TipTap) · القوائم العامة (`RefListsView`/`TypesView`).

## 12) وحدة الإعدادات ⚫ رمادي غامق

بيانات الشركة · الشركات (مطور) · الطباعة والعرض (`appearance-tab`) · الأمان · المستخدمون والصلاحيات (`UsersView`/`UserEditPage`) · إعدادات الزيارات · قواعد الترحيل · النسخ الاحتياطي · إدارة البيانات (`DataManagementView` + `ArchiveView` + `FixUnspecifiedPanel`) · أدوات المطور (المزايا/الهوية/الترحيل/الشبكة/التنظيف + `DevConsoleView` + `WorkflowEditor` + `workflow-tab`).

## 13) مكونات عابرة للشاشات (تتلوَّن من الـ tokens تلقائيًا)

الشريط العلوي وطبقة التطبيقات (`AppShell`) · مبدّل الشركات · جرس الإشعارات (`NotificationBell`) · البحث الشامل (`SearchDialog`) · حوارات العملاء (`CustomerDialog`/`CustomerFormDialog`) · سند الباطن · فجوات العقود (`GapsDialog`) · `PhaseAPayCard` · جداول الدفع (`pay-tables`) · حوارات الطباعة الثلاثة · `SearchableSelect` · تنبيهات التوست · تذييل النظام الثابت.

---

**الإجمالي: 12 وحدة + شاشة دخول + لوحة المطور ≈ 70 وجهة عرض** — كلها ضمن `/` ولا تُمس مساراتها.
