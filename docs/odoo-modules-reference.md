# مرجع مديولات Odoo + بروتوكول القرار (جديد / موجود / امتداد)

> **اعتماد المالك (2026-11-16):** «هذا المرفق يعتبر خريطة للتطوير القادم» —
> هذا الملف هو **بروتوكول القرار الرسمي** لأي مديول جديد في ConTrack، وتطبيقه الحي على
> المشروع (المطابقة + الفجوات + قواعد الإنشاء المعدلة) في **`docs/development-roadmap.md`**.
> **سجل المديولات §7 أدناه معبّأ بمديولات ConTrack الفعلية** — أي AI لازم يفحصه قبل اقتراح مديول جديد.

> **الغرض:** أي AI بيصمم معايا نظام لازم يرجع للملف ده قبل ما يقترح مديول. يحدد الأول: المطلوب **موجود في Odoo** ولا **امتداد لمديول موجود** ولا **مديول جديد فعلاً**.
> **تنبيه:** الأسماء التقنية (technical names) دقيقة في الغالب لكنها بتتغير بين الإصدارات (17 / 18 / 19 / 20). لازم يتأكد من الإصدار والإيديشن (Community / Enterprise) المستخدم، ولو عنده وصول للكود يفحص `__manifest__.py` أو Apps list قبل الحسم.

---

## 0) معلومات لازم تتحدد قبل أي تصميم

1. إصدار Odoo (مثلاً 17 / 18 / 19 / 20).
2. الإيديشن: **CE** (مجاني) ولا **EE** (Enterprise) — بعض المديولات EE فقط (معلّمة بـ 🅔 تحت).
3. المديولات المركّبة فعلاً + المديولات المخصصة (Custom) الموجودة (جدول القسم 7).
4. البلد (للـ Localization والضرائب والفاتورة الإلكترونية).
5. نوع النشر: Odoo Online / Odoo.sh / On-Premise (Online ما بيسمح بكود Python مخصص).

---

## 1) بروتوكول القرار (الخطوات بالترتيب — توقف عند أول تطابق)

### الخطوة 1: هل المطلوب متغطي بالفعل (Standard)؟
دور في الأقسام 3–6. لو الوظيفة موجودة في مديول قياسي → **القرار: A = "موجود"**.
- استخدم الموجود بالـ Configuration (Settings، أنواع، Routes، Pricelists، Stages…).
- لو محتاج حقل/شاشة بسيطة: Studio 🅔 أو Custom Fields من Settings > Technical (بدون كود).
- لو محتاج منطق تلقائي بسيط: **Automation Rules** (`base_automation`) أو Server Actions.

### الخطوة 2: هل يتبع مديول موجود (Extension)؟
لو الكيان الأساسي (Model) موجود والمطلوب يضيف عليه حقول/سلوك/خطوات → **القرار: B = "امتداد"**.
- مديول مخصص جديد صغير بيعمل `_inherit` على الـ Model الأصلي (لا تعدل الكود الأساسي أبداً).
- يعتمد (depends) على المديول الأصلي في `__manifest__.py`.
- امتداد الواجهة عبر View Inheritance (xpath).
- الاسم: `<prefix>_<original_module>_<feature>` مثل `x_sale_approval`.

### الخطوة 3: هل هو كيان جديد تماماً؟
لو مفيش Model قريب في Odoo ومفيش workflow يغطي الفكرة → **القرار: C = "مديول جديد"**.
- يعمل Models جديدة، ويفضّل يربط بالمحوريات الموجودة: `res.partner` (جهات الاتصال)، `res.users`، `res.company`، `product.product/template`، `account.analytic.account`، `mail.thread` (للـ chatter)، `mail.activity.mixin`.
- لازم يوضح: ليه مفيش حاجة موجودة تكفي؟

### الخطوة 4: هل يحتاج تكامل خارجي؟
API / Webhooks / مزوّد دفع / شحن / فاتورة إلكترونية → اتأكد الأول من وجود Connector قياسي (قسم 5) قبل بناء جديد. → **D = "تكامل"**.

### قواعد حاسمة (Gotchas)
- ❌ لا تنسخ Model موجود باسم جديد. ✅ استخدم `_inherit`.
- ❌ لا تعمل جدول عملاء/موردين جديد. ✅ `res.partner` فيه Customer/Vendor rank.
- ❌ لا تعمل جدول موظفين جديد. ✅ `hr.employee`.
- ❌ لا تعمل مخزون يدوي بجانب `stock.quant`. ✅ مديول Inventory.
- ❌ لا تعمل قيود محاسبية مباشرة بـ SQL. ✅ `account.move` / `account.move.line`.
- ✅ فصل الصلاحيات بـ Groups + Access Rights + Record Rules (⚠️ في الإصدار 20 تم تبسيط Record Rules وإضافة domain مباشرة على Access Right — راجع الأمان عند الترقية).
- ✅ Multi-company و Multi-currency بيتعاملوا في الـ Core؛ لا تعيد اختراعهم.

### قالب مخرجات القرار (الـ AI لازم يعبّيه لكل طلب)

```
طلب: <وصف المديول/الميزة>
التصنيف: A موجود | B امتداد | C جديد | D تكامل
المديول/المديولات الأقرب: <technical name(s)> (CE/EE)
Models المتأثرة: <res.partner, sale.order, ...>
المبرر: <ليه الموجود مش كفاية / ليه كافي>
الحل المقترح: <Config / Studio / Automation / _inherit / مديول جديد>
dependencies: [...]
أثر على: صلاحيات | تقارير | ترقيات | أداء
مخاطر: ...
```

---

## 2) الأساس (Core / Technical)

| مديول | Technical | ماذا يغطي |
|---|---|---|
| Base | `base` | المستخدمين، الشركات، الشركاء `res.partner`، العملات، اللغات، الصلاحيات |
| Web | `web` | الواجهة، Views (list/form/kanban/pivot/graph/calendar/gantt…) |
| Mail / Discuss | `mail` | Chatter، الرسائل، الأنشطة، القنوات، الإشعارات |
| Contacts | `contacts` | دليل جهات الاتصال |
| Portal | `portal` | بوابة العملاء/الموردين |
| Product | `product` | المنتجات، Pricelists، Variants، Attributes |
| UoM | `uom` | وحدات القياس |
| Resource | `resource` | جداول العمل والعطلات |
| Calendar | `calendar` | الأحداث والاجتماعات (+ مزامنة Google/Outlook) |
| Analytic | `analytic` | المحاسبة التحليلية، Plans |
| Automation | `base_automation` | Automation Rules |
| Studio 🅔 | `web_studio` | تخصيص بدون كود |
| IAP | `iap` | خدمات مدفوعة (OCR، SMS، Enrichment، AI credits) |
| SMS | `sms` | إرسال SMS |
| UTM | `utm` | تتبع الحملات والمصادر |
| Rating | `rating` | تقييمات |
| Auth | `auth_signup`, `auth_oauth`, `auth_totp` | تسجيل، OAuth، 2FA |
| Spreadsheet Dashboard | `spreadsheet_dashboard` | لوحات معلومات |
| Digest | `digest` | تقارير KPI بالإيميل |

---

## 3) التطبيقات الرئيسية حسب المجال

### 3.1 المبيعات (Sales)
| مديول | Technical | ماذا يغطي |
|---|---|---|
| Sales | `sale`, `sale_management` | عروض الأسعار، أوامر البيع، Templates، Pricelists |
| Sale Margin | `sale_margin` | هامش الربح |
| Sale Stock | `sale_stock` | ربط البيع بالمخزون والتسليم |
| Sale Loyalty | `sale_loyalty`, `loyalty` | كوبونات، ولاء، هدايا، Gift cards |
| Sale Project / Timesheet | `sale_project`, `sale_timesheet` | بيع خدمات وإنشاء مشاريع/مهام وفوترة بالساعات |
| Sale Purchase | `sale_purchase` | شراء تلقائي من البيع |
| Sale CRM | `sale_crm` | ربط الفرص بعروض الأسعار |
| Quote Builder | `sale_pdf_quote_builder` | عروض PDF مخصصة |
| Subscriptions 🅔 | `sale_subscription` | اشتراكات ومتكرر |
| Rental 🅔 | `sale_renting` | تأجير |
| Delivery | `delivery` | طرق الشحن |
| Expense re-invoicing | `sale_expense` | إعادة فوترة المصروفات |

### 3.2 CRM
| مديول | Technical | ماذا يغطي |
|---|---|---|
| CRM | `crm` | Leads، Opportunities، Pipeline، Teams، Lost reasons |
| Lead Mining/Enrich 🅔 | `crm_iap_mine`, `crm_iap_enrich` | تنقيب وإثراء |
| VoIP 🅔 | `voip` | مكالمات |
| Livechat → CRM | `crm_livechat` | تحويل المحادثات لفرص |
| Website → CRM | `website_crm` | فورم تواصل → Lead |

### 3.3 المحاسبة والمالية (Accounting / Finance)
| مديول | Technical | ماذا يغطي |
|---|---|---|
| Invoicing | `account` | فواتير العملاء والموردين، المدفوعات، Journals، الضرائب، Chart of Accounts |
| Accounting 🅔 | `account_accountant` | التسويات البنكية، Fiscal Year، Lock Dates |
| Assets 🅔 | `account_asset` | الأصول الثابتة والإهلاك (في 20: Depreciation models) |
| Budgets 🅔 | `account_budget` | الموازنات |
| Reports 🅔 | `account_reports` | قوائم مالية، Tax report، Aged، Consolidation |
| Follow-up 🅔 | `account_followup` | متابعة التحصيل |
| Batch payments 🅔 | `account_batch_payment` | دفعات مجمعة، SEPA |
| Payment | `account_payment`, `payment` | الدفع الإلكتروني |
| Check printing | `account_check_printing` | طباعة الشيكات |
| 3-Way Match | `account_3way_match` | مطابقة PO/استلام/فاتورة |
| E-invoicing (EDI) | `account_edi` + `l10n_*` | الفاتورة الإلكترونية حسب البلد |
| Bank sync 🅔 | `account_online_synchronization` | مزامنة بنكية |
| Expenses | `hr_expense` | مصروفات الموظفين |
| Consolidation 🅔 | `account_consolidation` | توحيد شركات |
| Landed costs | `stock_landed_costs` | تكاليف إضافية على المخزون |
| Loans 🅔 | `account_loans` | القروض |
| Document extraction 🅔 | `account_invoice_extract` | OCR للفواتير |

### 3.4 المشتريات والمخزون وسلسلة الإمداد
| مديول | Technical | ماذا يغطي |
|---|---|---|
| Purchase | `purchase`, `purchase_stock` | RFQ، أوامر شراء، موردين، Vendor pricelists |
| Purchase Agreements | `purchase_requisition` | اتفاقيات/مناقصات |
| Inventory | `stock`, `stock_account` | مخازن، Locations، Routes، Picking، Lots/Serials، التقييم |
| Barcode 🅔 | `stock_barcode` | عمليات بالباركود |
| Batch / Wave | `stock_picking_batch` | تجميع الشحنات |
| Dropshipping | `stock_dropshipping` | توريد مباشر |
| Expiry | `product_expiry` | تواريخ الصلاحية |
| Delivery connectors | `delivery_*` (UPS, FedEx, DHL, USPS, bpost, Easypost, Sendcloud…) | شركات شحن |
| Manufacturing (MRP) | `mrp`, `mrp_account` | BoM، أوامر تصنيع، Work Centers، Routing |
| Subcontracting | `mrp_subcontracting` | تصنيع خارجي |
| Shop Floor 🅔 | `mrp_workorder` | أرضية المصنع |
| PLM 🅔 | `mrp_plm` | إدارة التغييرات والإصدارات |
| MPS 🅔 | `mrp_mps` | جدول الإنتاج الرئيسي |
| Quality 🅔 | `quality_control`, `quality` | الجودة ونقاط التحكم |
| Maintenance | `maintenance` | صيانة المعدات |
| Repairs | `repair` | الإصلاحات |
| Fleet | `fleet` | المركبات والعقود |
| Landed Costs | `stock_landed_costs` | |

### 3.5 الموارد البشرية (HR)
| مديول | Technical | ماذا يغطي |
|---|---|---|
| Employees | `hr` | ملف الموظف، الأقسام، الوظائف |
| Contracts | `hr_contract` | العقود (في بعض الإصدارات دمج جزئي في hr) |
| Time Off | `hr_holidays` | الإجازات والرصيد |
| Attendance | `hr_attendance` | الحضور والانصراف |
| Recruitment | `hr_recruitment` | التوظيف، Pipeline المتقدمين |
| Skills | `hr_skills` | المهارات والسيرة |
| Org Chart | `hr_org_chart` | الهيكل |
| Payroll 🅔 | `hr_payroll`, `hr_payroll_account` | الرواتب، Salary Rules، Structures |
| Work Entries | `hr_work_entry` | مدخلات العمل |
| Appraisals 🅔 | `hr_appraisal` | التقييمات |
| Referrals 🅔 | `hr_referral` | الإحالات |
| Timesheets | `hr_timesheet` | سجلات الوقت |
| Expenses | `hr_expense` | المصروفات |
| Lunch | `lunch` | طلبات الغداء |
| Fleet link | `hr_fleet` | |
| eLearning link | `hr_skills_slides` | |
| Planning 🅔 | `planning` | جدولة الورديات |
| Gamification | `gamification` | الأهداف والشارات |

### 3.6 المشاريع والخدمات
| مديول | Technical | ماذا يغطي |
|---|---|---|
| Project | `project` | مشاريع، مهام، Stages، Milestones، Gantt 🅔 |
| To-do | `project_todo` | المهام الشخصية |
| Timesheets | `hr_timesheet` | |
| Field Service 🅔 | `industry_fsm` | الخدمة الميدانية |
| Helpdesk 🅔 | `helpdesk` | تذاكر الدعم، SLA |
| Planning 🅔 | `planning` | تخطيط الموارد |
| Appointments | `appointment` | حجز مواعيد |

### 3.7 نقاط البيع (POS)
| مديول | Technical | ماذا يغطي |
|---|---|---|
| Point of Sale | `point_of_sale` | الكاشير، Sessions، طرق الدفع |
| Restaurant | `pos_restaurant` | طاولات، مطبخ، Tips |
| Loyalty / Coupons | `pos_loyalty` | |
| Discount | `pos_discount` | |
| Employees | `pos_hr` | تسجيل كاشير |
| Self Order | `pos_self_order` | طلب ذاتي/Kiosk |
| Sale link | `pos_sale` | |
| Payment terminals | `pos_adyen`, `pos_stripe`, `pos_six`, `pos_razorpay`… | |
| IoT 🅔 | `iot` | أجهزة |

### 3.8 الويب والتجارة الإلكترونية
| مديول | Technical | ماذا يغطي |
|---|---|---|
| Website | `website` | موقع، Builder، SEO، Themes |
| eCommerce | `website_sale` | متجر، سلة، Checkout |
| eCommerce add-ons | `website_sale_stock`, `website_sale_delivery`, `website_sale_wishlist`, `website_sale_comparison`, `website_sale_loyalty`, `website_sale_collect` | |
| Blog | `website_blog` | |
| Forum | `website_forum` | |
| eLearning | `website_slides` | دورات |
| Live Chat | `im_livechat` | |
| Events (web) | `website_event*` | |
| Website forms | `website_form`/`website_crm` | |
| Payment providers | `payment_stripe`, `payment_paypal`, `payment_adyen`, `payment_authorize`, `payment_mollie`, `payment_razorpay`, `payment_flutterwave`, `payment_aps`، `payment_custom` | |

### 3.9 التسويق
| مديول | Technical | ماذا يغطي |
|---|---|---|
| Email Marketing | `mass_mailing` | |
| SMS Marketing | `mass_mailing_sms` | |
| Marketing Automation 🅔 | `marketing_automation` | |
| Social Marketing 🅔 | `social` | |
| Events | `event`, `event_sale`, `event_booth`, `event_track` | |
| Surveys | `survey` | |
| Link Tracker | `link_tracker` | |

### 3.10 الإنتاجية والمستندات
| مديول | Technical | ماذا يغطي |
|---|---|---|
| Discuss | `mail` | رسائل، قنوات |
| Documents 🅔 | `documents` | DMS |
| Sign 🅔 | `sign` | توقيع إلكتروني |
| Knowledge 🅔 | `knowledge` | ويكي داخلي |
| Approvals 🅔 | `approvals` | موافقات عامة |
| Spreadsheet 🅔 | `documents_spreadsheet` | |
| WhatsApp 🅔 | `whatsapp` | |
| Google / Microsoft | `google_calendar`, `google_gmail`, `microsoft_calendar`, `microsoft_outlook` | |
| Data cleaning | `data_recycle`, `data_merge` 🅔 | |
| Frontdesk 🅔 | `frontdesk` | استقبال |

### 3.11 الذكاء الاصطناعي (إصدار 19+)
وظائف AI Agents / Server actions بـ AI / Search / Fields بـ AI. في 20: وكلاء يقدروا ينشئوا ويحدّثوا Records، دعم MCP، ومتطلب IAP credits. (فحص الأسماء التقنية الدقيقة في الإصدار المستخدم.)

---

## 4) التوطين (Localization)
- المديولات `l10n_<country_code>` (مثال: `l10n_eg`, `l10n_sa`, `l10n_ae`) = شجرة حسابات + ضرائب + Fiscal positions.
- فاتورة إلكترونية: `l10n_eg_edi_eta` 🅔 (مصر ETA)، `l10n_sa_edi` 🅔 (السعودية ZATCA)… الاسم يختلف بالبلد والإصدار.
- قبل بناء أي ضريبة/فاتورة إلكترونية: ابحث عن `l10n_<country>*` أولاً.
- **الكويت:** ConTrack ينفّذ الزكاة/XBRL (`api/xbrl/*`) — الفاتورة الإلكترونية الكويتية لم تصدر نظاميًا بعد؛ تُبنى D-تكامل عند صدورها.

---

## 5) التكاملات الجاهزة (قبل ما تبني تكامل جديد)
دفع (Stripe, PayPal, Adyen, Razorpay…)، شحن (UPS, FedEx, DHL…)، تقويم/بريد (Google, Microsoft)، SMS، OCR/IAP، توقيع، VoIP، IoT، أجهزة POS، WhatsApp 🅔. لو مش موجود: **REST/JSON-RPC/XML-RPC** أو Webhooks عبر Automation Rules.
- **في ConTrack:** بوابة الدفع موجودة (`api/gateway/*`) — أي تكامل جديد يمر على الخطوة 4 (D) قبل البناء.

---

## 6) أمثلة قرارات سريعة

| الطلب | التصنيف | الحل |
|---|---|---|
| موافقة على أوامر البيع فوق مبلغ معين | B | Automation/`sale_management` approvals أو مديول `_inherit` على `sale.order` (أو Approvals 🅔) |
| إدارة عقارات وإيجارات وحدات | C (جزئي) | مديول جديد يعتمد على `account`, `contacts`, ويستخدم `sale_renting` 🅔 لو متاح |
| تتبع مركبات الشركة | A | `fleet` |
| سلفة موظف تُخصم من الراتب | B | امتداد `hr_payroll` + Salary Rule + Input Type |
| جدولة صيانة وقائية | A | `maintenance` |
| تقييم موردين | B | `_inherit` على `res.partner` + `purchase` أو `survey` |
| إدارة عيادة (مرضى/مواعيد) | C | مديول جديد + `appointment` + `account` |
| حقل إضافي في العميل | A | Custom field / Studio |
| فاتورة إلكترونية لبلد معين | D/A | `l10n_<country>_edi*` |

---

## 7) سجل المديولات المخصصة — **معبّأ بمديولات ConTrack الفعلية (2026-11-16)**

> أي AI لازم يفحص الجدول ده قبل اقتراح مديول جديد، عشان ما يكرر شيء اتبنى.
> المرجع الحي لما هو منفّذ: `docs/development-roadmap.md` §المطابقة.

| الاسم (ConTrack) | Technical (الجداول الأساسية) | يعتمد على | مكافئ Odoo | وظيفته | الحالة |
|---|---|---|---|---|---|
| **العقود وعروض الأسعار** (`qc`) | `quotations`+`quotation_items` · `contracts`+`contract_stages`+`payment_plan` | customers, contract_types, workflow_stages, boq_items | `sale_management` | دورة عرض السعر ← العقد ← المراحل والدفعات + التحويل بزر واحد | ✅ منفذ (b10a6e1) |
| **العملاء** (`clients`) | `customers` (+`tasks`,`visits`,`comments`) | — | `contacts` (`res.partner`) | ملف العميل والمهام والزيارات والمتابعة | ✅ منفذ |
| **المشاريع** (`projects`) | `projects`+`field_executions` (+CPM `schedule_imports`) | customers, contracts, boq_items | `project` | لوحة المشاريع + التقرير اليومي + تنفيذ البنود | ✅ منفذ |
| **الباطن** (`subs`) | `subcontractors`+`sub_contracts`+`sub_payment_plan`+`sub_certificates` | contracts, boq_items, customers | `purchase`+`mrp_subcontracting` | عقود الباطن وخطط الدفع وشهادات IPC | ✅ منفذ |
| **المحاسبة** (`accounting`) | `accounts`+`journal_entries`+`vouchers`+`invoices`+`fiscal_periods` | contracts, customers | `account`+`account_accountant` | الأستاذ والقوائم والسندات والفواتير والتسوية والزكاة | ✅ منفذ |
| **المخازن** (`warehouses`) | `warehouses`+`stock_items`+`stock_docs`+`stock_doc_lines` | contracts | `stock` | الأصناف والمستودعات وأذون الإدخال/الصرف/الجرد | ✅ منفذ |
| **الموارد البشرية** (`hr`) | `employees`+`payroll_batches`+`employee_attendance`+`employee_leaves` | — | `hr`+`hr_payroll` | الموظفون والحضور والإجازات والرواتب والسلف ونهاية الخدمة | ✅ منفذ |
| **الاستشارات** (`consulting`) | `engineers`+`engineer_assignments`+`engineer_timesheets`+`consulting_revisions` | hr, projects | `project`+`hr_timesheet` | الفريق الهندسي والإسناد والساعات ومراجعات المخططات | ✅ منفذ |
| **المبيعات** (`sales`) | نقاط البيع (فورية فوق vouchers+invoices) | customers | `point_of_sale` | POS بمعاملة واحدة (فاتورة + سند + إذن صرف) | ✅ منفذ |
| **الصيانة والتشغيل** (`maintenance`) | `maintenance_plans`+`maintenance_occurrences`+`work_orders` | contracts, warehouses | `maintenance` | عقود الصيانة الدورية والجدول الوقائي وأوامر العمل | ✅ منفذ |
| **التقارير** (`reports`) | تقارير اشتقاقية بلا جداول (dues, profitability, cashflow…) | الكل | `account_reports` | 15+ تقريرًا تشغيليًا وماليًا | ✅ منفذ |
| **القوائم المرجعية** (`refs`) | `contract_types`+`workflow_stages`+`type_payment_tpl`+`ref_lists`+`ref_items`+`boq_docs`+`doc_templates` | — | البيانات الرئيسية (`product`/Settings) | الماستر داتا: أنواع العقود ومراحلها وقوالب دفعاتها + القوائم العامة + مصمم القوالب | ✅ منفذ |

**جداول محورية مشتركة** (تخدم كل المديولات — لا تكررها أبداً): `companies` (multi-company عبر `companyId` في ~85 جدولاً) · `users`+`user_permissions` · `number_sequences` (ترقيم ذري) · `audit_logs` · `feature_flags` · `attachments` · `app_notifications` · `entity_backups`.

---

## 8) قواعد بناء أي مديول جديد/امتداد

> **النسخة المعدلة لـ ConTrack** (القواعد الأصلية أدناه محفوظة كمرجع Odoo) — انظر `docs/development-roadmap.md` §قواعد الإنشاء.

1. هيكل: `__manifest__.py`, `models/`, `views/`, `security/ir.model.access.csv`, `security/*.xml`, `data/`, `report/`, `static/`, `tests/`.
2. `depends` أصغر قائمة ممكنة؛ تجنب `depends` على EE لو العميل CE.
3. Models: اسم بالصيغة `module.object`، وراثة `mail.thread` و `mail.activity.mixin` عند الحاجة، حقل `company_id` للـ multi-company.
4. صلاحيات: Groups + Access + Record Rules (وتحقق من تغييرات الإصدار 20).
5. لا تعدّل الكود الأساسي. استخدم `_inherit` / View inheritance / Hooks.
6. Migration scripts عند الترقية (`migrations/`).
7. اختبارات (Tests) للمنطق المالي والمخزني بالذات.
8. تسمية: prefix ثابت للمشروع (`x_` أو اسم الشركة).

---

## 9) تحديث المرجع
- كل ما تغيّر الإصدار أو ركّبت مديول: حدّث القسم 0 و 7.
- قبل الحسم النهائي: راجع الوثائق الرسمية (odoo.com/documentation) و Apps في قاعدة البيانات الفعلية.
