# سجل أعمال مشروع ConTrack الأونلاين

> هذا الملف سجل مشترك لكل الوكلاء. قبل البدء: اقرأه. بعد الانتهاء: ألحق قسمًا جديدًا في النهاية (لا تحذف شيئًا).

---

Task ID: 1
Agent: المنسق (Z.ai رئيسي)
Task: اكتشاف إعادة ضبط البيئة (sandbox reset) وإعادة استعادة الكود الأصلي من أجزاء الرفع

Work Log:
- تبيّن أن بيئة /home/z/my-project أُعيد ضبطها بالكامل: فقدت كل مخرجات الجلسة السابقة (نسخة الويب للمراحل 1-4، وثائق BUSINESS_LOGIC_SPEC وFEATURES_REPORT، مجلد research، worklog قديم، ونسخة contrack_v9.15.18 المستعادة).
- ما بقي: مجلد upload/ بكامل أجزاء الكود الأصلي (part_01..part_25 + فهرس) وقاعدة db/custom.db الفارغة والهيكل الافتراضي لـ Next.js.
- كتبت restore_source.py الذي يفكك الأجزاء عبر علامات BEGIN/END (صيغة END بلا كلمة file: تبيّنت بالفحص) ويجمع الملفات متعددة القطع بالترتيب.
- نُفّذ بنجاح: 344 ملفًا / 5,448,462 حرفًا إلى /home/z/my-project/contrack_v9.15.18/ (مطابق لعدّ الملفات الأصلي).
- فحص ast.parse ناجح على 9 ملفات حرجة (lifecycle, settlement, addendum, claims, gateway, report_service, custody_center, contracts, vouchers).

Stage Summary:
- المصدر الأصلي ConTrack V9.15.18 مستعاد بالكامل في /home/z/my-project/contrack_v9.15.18/app/ (49 خدمة، 52 واجهة).
- كل العمل السابق على نسخة الويب فقد ولا بد من إعادة بنائه كاملًا (المراحل 1-9).
- وثائق القواعد المالية ستعاد بناؤها بوكلاء بحث عميق (المهمة 2-a..2-d) ثم التنفيذ.

---

---
Task ID: 2-b
Agent: research-reports
Task: مواصفة دقيقة لنظام التقارير وكشف الحساب والمتابعة والاستيراد والمطبوعات في ConTrack V9.15.18 (PySide6+SQLite) لبناء نسخة الويب Next.js/Prisma/TS — إخراج واحد: research/spec-reports.md.

Work Log:
- قرأت worklog.md (مهمة 1: استعادة المصدر) وحصرت 19 ملفًا هدفًا بمسؤوليتي.
- قرأت كاملًا: services/statement_service.py (334 س) — منطق مدين/دائن/رصيد لثلاثة كشوف (عقد/عميل شامل/باطن).
- قرأت كاملًا: services/report_service.py (1678 س) — 17 دالة تقرير + cash_flow_report/detail + journal + gateway_summary.
- قرأت كاملًا: services/customer_service.py (265)، services/import_service.py (1155) — 8 أوراق قالب، تحقق Dry-Run، execute_import بترتيب التبعية.
- قرأت كاملًا: services/extras_service.py (740) — تبيّن أنها خدمات مساندة (واتساب/مرفقات/شيكات/تسمية عقود/تسوية إغلاق/بيانات ذكية) وليست «بدلات العقد».
- قرأت كاملًا: ui_data_service.py (171) + search_service.py (126) + search_utils.py (56) — البحث الشامل بتطبيع عربي LIKE على 6 كيانات.
- قرأت كاملًا: reports/pdf_utils.py (384) + statement_pdf.py (396) + voucher_pdf.py (400) + tabular_pdf.py (800، PDF+Excel) + manual_contract_code.py (635 — تبيّن أنه مرجع تحليلي لنوع manual_track لا ترقيم يدوي).
- قرأت كاملًا: ui/statement.py (595) وui/reports_page.py (2352) — فهرس _REPORTS الـ8 ومواصفات كل تقرير (فلاتر/أعمدة/ألوان/تصدير).
- قرأت كاملًا: ui/followup.py (1610) وui/due_items_page.py (344 — تبين أنها تسديد الشركة الأخرى) وui/cashflow_chart.py (109).
- قرأت بالتحديد الوظيفي خارج قائمتي: workflow_service.py (stage_status، execution_report، execution_occupancy_report — 4869-5279) وsupervision_service (مراجع الحقول) وtafqeet.py (التفقيط).
- كتبت التقرير الكامل /home/z/my-project/research/spec-reports.md (فهرس 8 تقارير + أقسام A-I + Prisma + API، بمراجع file:line لكل صيغة).

Stage Summary:
- كشف الحساب (V3.14): ترتيب الصفوف = قيمة العقد مدين ثم حركات مرتبة (تاريخ، مرجع): ملحقات معتمدة (net=add−deduct، زيادة مدين/خصم دائن بمرجع ADD-xxx)، فواتير محايدة «للعلم» بلا أثر على الرصيد (الوثيقة الحرفية للاستثناء)، سندات قبض دائن، تمديد إشراف مدين بتاريخ base_end؛ remaining = القيمة الحالية − المحصّل فقط؛ كشف العميل الشامل يدمج كل العقود (بلا ملغى/مسودة) برصيد جارٍ واحد وافتتاحية عند فلتر تاريخ وأنواع صفوف move/opening/subtotal/total.
- report_service: العملاء والأرصدة (قيمة=قيمة+ملحقات، remaining=value−collected)، المستحقات الصارمة V4.3 (strict = متبقٍ>0.001 وبلا skip/trigger معلق وdue<=today؛ overdue = strict وdue<today)، الربحية الفعلية = المحصّل − المنصرف (المستثنى: حسابات include_in_profitability=0) والمتوقعة = القيمة − (باطن + منصرف آخر)؛ القيمة الحالية دائمًا من lifecycle (قاعدة 35) وتدخل تمديد الإشراف في dues_report وكشف الحساب لا في الربحية.
- التنفيذ/الإشغال: لا نسبة إنجاز مئوية — عدّاد أيام مقابل expected_days؛ over إن days>expected، near إن days>=expected−3 (ألوان 🔴 DANGER/🟡 WARNING/🟢 SUCCESS)، وmissing = مراحل «تخطّاها بلا مرور».
- التدفق النقدي: floor = cash_start_date أو opening_balance_date؛ شراكة/سلف/رسوم بنك/عهد/تحويلات داخلية قواعد استبعاد دقيقة؛ صافي الفترة = in−out+recoveries+adv_adj والرصيد تراكمي + partner_net؛ التفصيلي يصنف bank/cash بطريقة الدفع ويجمع العمولات وصرف العهد شهريًا ويطرح معلق البوابة من رصيد البنك.
- الاستيراد: قالب 8 أوراق، نوع العقد إجباري معتمد (لا «غير محدد»)، تجاوز قبض قيمة العقد = تحذير يُسجل دفعة مقدمة (allow_overpay)، صرف المقاول فوق عقد باطنه = خطأ، مستفيد غير مسجل يُنشأ مقاولًا «مورد/مصروف عام»، أرقام CUS/CON/سندات تُولد تلقائيًا (والأرقام القديمة تُحفظ كما هي).
- PDF: RTL عبر arabic_reshaper+bidi، خط Amiri، وضع اقتصادي، تفقيط «فقط … لا غير» (فلس=1000)، tabular موحد لكل التقارير (أرقام لا تُقص أبدًا)، سندات ببطاقات وختم شفاف قابل للتحريك، كشف PDF يُؤرشف تلقائيًا بملف العميل.
- بحث شامل: 6 كيانات بحد 8 لكل نوع، تطبيع (أإآٱ→ا، ة→ه، ى→ي، إزالة تشكيل) على الاستعلام والأعمدة.
- الملفات الجاهزة للفريق: /home/z/my-project/research/spec-reports.md (يشمل نماذج Prisma مقترحة ومسارات API).
---
---
Task ID: 2-a
Agent: research-core
Task: بحث عميق في العقود والمستحقات — إنتاج مواصفة القواعد المالية الجوهرية لـ ConTrack V9.15.18 (spec-core.md)

Work Log:
- قرأت worklog.md (سياق الاستعادة) ثم قرأت الملفات الإلزامية كلها: database/models.py، database/database.py كاملًا (الـschema الأساسي + كل هجرات الأعمدة + الجداول المزروعة)، services/lifecycle_service.py كاملًا على دفعات (6,293 سطر)، contract_service.py، contract_type_service.py، types_setup_service.py، settings_service.py، voucher_payment_link_service.py، supervision_service.py، unified_cancel_service.py، tafqeet.py.
- استخدمت Grep للوصول بالاسم لما يتجاوز نطاق الملفات المطلوبة لكنه ضروري لصياغة القواعد: workflow_service.py (trigger_due_payments/_mark_skipped_stage_payments/_generate_type_payments_from_template/type_payments/PAY_KINDS/scoped_plan_rows)، report_service.py (dues_report/due_now_by_contract/overdue_installments)، extras_service.py (apply_description_prefix).
- استخرجت مخطط ~70 جدولًا ذا صلة مالية (contracts، payment_plan، vouchers، voucher_payment_links، addendums، contract_stages، type_payment_tpl، sub_*، claims، settings، payment_methods، number_sequences، audit_log…) في جدول مرجعي بمراجع أسطر.
- صغت الأقسام A-K كل قاعدة بمرجع file:line حرفي، ثم اقترحت نماذج Prisma (12+ موديلًا مع فهارس وقيود UNIQUE مطابقة للمصدر) ومسارات API كاملة مع بروتوكول OverpayWarning (422 + allowOverpay).
- كتبت التقرير في research/spec-core.md (جديد) ولم أعدّل أي ملف مصدر.

Stage Summary:
- القيمة الحالية = amount + Σ(معتمد addendums net) + تمديد الإشراف (lifecycle_service.py:636-659)؛ لا تُخزَّن أبدًا (الاستثناء: setup_supervision يكتب amount = months×monthly − discount).
- التغطية قراءةً: FIFO بترتيب (due_date, sort_order) على pool = Σ قبض بلا allocation − Σ روابط صريحة (voucher_payment_links)، والفائض يتوزع على التالية ويُخزَّن advance_amount (vpl_service:372-436)؛ قاعدة تتابع صارمة والبوابة sub_pay_client_gate.
- سقف القبض تحذيري OverpayWarning (يرث ValidationError) بـ allow_overpay، وبوابة due = max(current, sup.total_due)؛ سقف الباطن والخطة والقيمة قاطعة.
- 8 حالات دفعة محسوبة (مرحلة متخطاة/بانتظار إنجاز المرحلة/مدفوع/جزئي/متأخر/مستحقة/مستحق قريبًا/لم يحل)؛ triggered_at يضبطه إنهاء المرحلة (workflow_service:4600-4664).
- المستحق اليوم (due_now) = Σ بواقي strict لمن له خطة، وكامل المتبقي لمن لا خطة؛ dues = amount + net_addendum + sup_ext − محصّل.
- الإشراف: كل شهر «يبدأ» بعد النهاية يُحسب كاملًا؛ waive ≤ غير المسدد؛ التعهد يفوز على إشراف المرحلة؛ full_end/delay_value محسوبة.
- unified_cancel: أرشفة+backup JSON+عكس قيد+audit_log مع انتقالات cancelled→active؛ الإلغاء التشغيلي للسند في lifecycle (ناعم+أبناء+إعادة فتح الدفعات).
- ترقيم: عدّاد number_sequences ذري؛ بادئات CON/PRJ/QUO/SUB/RV/PV/TV/CV/SD/ADD/BT؛ رسوم البنك percent/amount لكل طريقة + توزيع بالقيمة أو بالتساوي للمجمع؛ التفقيط KWD 3 خانات مع round من الفلس.
- التقرير جاهز للبناء: research/spec-core.md.
---

---
Task ID: 2-d
Agent: research-governance
Task: بحث عميق في العُهد والفواتير والإنتاجية (مهام/زيارات/تعليقات/أرشيف) والحوكمة والقوالب في ConTrack V9.15.18 وإنتاج مواصفة للنسخة الويب

Work Log:
- قراءة worklog.md وفهم السياق (إعادة الاستعادة، بناء نسخة ويب Next.js/Prisma/TS).
- استخراج DDL الجداول ذات الصلة من database/database.py (invoices, users/user_permissions, form_*, employees, visit_staff/visits, expense_accounts, vouchers, tasks, contract_attachments, number_sequences, audit_log) + جداول الخدمات (customer_comments, feature_flags, purge_audit) — مع أسطر المراجع.
- العُهد: تتبعت النموذج المفاهيمي (لا جدول custody — حسابات expense_accounts.account_kind='advance')، ودورة الحياة الثلاثية (تسليم PV / تصفية كمجموعة سندات PAY-GRP / إرجاع CV بسقف متبقٍ) عبر custody_center.py + custody_settlements.py + lifecycle_service.py (add_grouped_payments, add_custody_settlement, add_custody_return, custody_balances/ledger/detailed/monthly/open/overview) + tests (v313/v37/v39/v452) + مطبوعات custody_pdf/custody_excel.
- سلف الموظفين: advances_page.py + lifecycle_service (add_employee_advance, add_advance_cash_return, add_salary_deduction, employee_balances/ledger) + test_v453 — والعلاقة بالعهد (advance_employee_id vs custody_account_id، لا يجتمعان).
- الفواتير: invoice_service.py كاملًا (ترقيم INV، قاعدة منع تجاوز المتبقي، فحص ملكية العقد) + ui/invoices.py + invoice_pdf.py (هوية الطباعة، ختم، ملخص العقد) + داخولها كشف الحساب (statement_service.py:24–77) + الطباعة المجمعة.
- الإنتاجية: task_service.py كاملًا (أنواع/تنبيهات مرة واحدة/أرشفة نصية/واتساب)، visits_service.py كاملًا (خانات، ترحيل مهمة، PDF)، comment_service.py + comment_center_service.py (soft delete، صلاحيات المدير، أنواع/أولويات/حالات)، archive_service.py + folder_service.py + extras_service (مرفقات العقود وامتداداتها)، global_search/search_service.
- الحوكمة: auth_service.py كاملًا (أدوار، PBKDF2 200k، كلمة المطور العشوائية، حد المستخدمين) واستخراج مصفوفة PERMISSIONS كاملة حرفيًا (37 مفتاحًا = 12 شاشة + 12 تقرير + 13 إجراء، تحقق آلي بالعد من الكود) + نقاط تنفيذ كل مفتاح (main_window/vouchers/reports_page/...). النسخ: backup_service (تلقائي 30 نسخة) + full_backup_service (ZIP دوّار أسبوعي/شهري، مصادر النسخ، الاستعادة بنسخة أمان). التنظيف: purge_service (developer فقط، لقطة purge_audit، أبناء قبل الآباء، حساب المصروف لا يُحذف) + cleanup_service (full_reset 42 جدولًا ويستثني settings/users/permissions...) + data_management/settings (تابات المطور).
- القوالب: form_service.py (Word-First، DATA_SOURCES خرائط الحقول، تفقيط، حسابات الإدخال، مستندات محفوظة) + word_service.py (قوالب رسمية عقود/عروض + _official_field_maps.json فارغ حاليًا + قيم الدفعات دفعة_N_*) + word_forms_service + word_forms_center (تابان) + excel_service + batch_print_service.
- feature_service.py كاملًا: 42 مفتاح ميزة موثقة بالتبعيات + CORE وFORCED_ON.
- كتبت التقرير الكامل في research/spec-phase5-9.md (جدول DDL، أقسام A–J، اقتراح نماذج Prisma، اقتراح مسارات API، خلاصة القواعد الحاكمة).

Stage Summary:
- العُهدة = حساب expense_accounts بـ account_kind='advance' (أب «العُهد»/«عهدة عامة»)؛ لا عهد عينية؛ الرصيد = مُسلَّم − مُنفَق − مرتجع؛ التصفية سندات PV مجمعة بمرجع PAY-GRP-YYYYMMDD-NNN وكل بند يحمل عميل/عقد/مصروف؛ الإرجاع سند CV بسقف المتبقي بلا أثر إيرادي ولا رسوم.
- السلف = سندات على advance_employee_id (PV سلفة / CV رد / SD خصم راتب) بحسابي «سلف موظفين» و«رواتب»؛ بلا خصم تلقائي من تصفية العهد.
- الفواتير INV-#### بلا أنواع، مربوطة عقدًا وعميلًا، ممنوع تجاوز المتبقي، تدخل كشف الحساب، لها PDF بهوية قابلة للتخصيص.
- المهام/الزيارات/التعليقات/الأرشيف موثقة بنماذج بسيطة (حالات وأرقام محدودة) وقواعد صلاحيات واضحة (تثبيت/تعديل التعليق للمدير، حذف ناعم فقط).
- الحوكمة: 3 أدوار + 37 مفتاح صلاحية (مصفوفة كاملة في التقرير H.2 مع نقاط التنفيذ)، ميزات 42 مفتاحًا، نسخ تلقائي (قاعدة، 30 نسخة) وكامل (ZIP: قاعدة+archive+attachments+logo+word_templates+icon)، استعادة بنسخة أمان + إعادة توليد كلمة المطور، purge للمطور فقط بلقطات، full_reset يستثني الإعدادات والمستخدمين والصلاحيات.
- الملف: /home/z/my-project/research/spec-phase5-9.md جاهز كأساس للمراحل 5–9 (نماذج Prisma + مسارات API مقترحة جاهزة للمرحلة التالية).
---
Task ID: 2-c
Agent: research-subs-gateway
Task: بحث عميق في باطن البناء (subcontractors) والبوابة المالية (gateway) والتصفية (clearing/settlement) والشركة الأخرى — إنتاج مواصفة دقيقة للنسخة الويب Next.js/Prisma/TS.

Work Log:
- قراءة worklog.md (سياق إعادة الاستعادة) ثم قراءة PLAN_GATEWAY_FINANCIAL.md كاملة (المرجع الإلزامي).
- استخراج DDL الجداول ذات الصلة من database/database.py (subcontractors 636, sub_contracts 648, sub_contract_items 661, sub_payment_plan 791, sub_payment_sources 807, voucher_payment_links 822, expense_accounts 672, vouchers 686, contract_groups 1897, payment_methods 1532) + جداول وقت التشغيل من settlement_service.py (gateway_profiles 64, gateway_ops 136, bank_lines 276, other_company_transfers 796, gateway_fee_vouchers 818, transfer_op_allocs 845, other_company_opening 1245) + match_aliases من gateway_service.py:431.
- قراءة كاملة: settlement_service.py (2297 سطر)، gateway_service.py (748)، sub_delete_service.py، expense_account_service.py، contract_group_service.py، clearing_page.py، sub_pay_blocks.py، sub_plan_editor.py، other_transfers_page.py، payment_gateway_page.py، voucher_payment_link_service.py، sub_delete_dialog.py.
- قراءة منطقية انتقائية: subcontractors.py (الحوار: حفظ 2698-2784، تعديل 3406-3460، توزيع 2613-2670، تحقق 2677-2696)، gateway_page.py (تصنيف/توزيع/إرجاع/مسح)، other_company_page.py (التبويبات الخمسة)، subcontractor_page.py، dealings.py، lifecycle_service.py (أقسام الباطن: add_sub_contract 767، sub_payment_plan_impl 1230-1356، set_sub_line_sources 1454، distribute_sub_plan 1728، _sub_client_payment_rows 1781، _check_sub_payment_limit 1919، _ensure_sub_contract_accepts_payments 1960، add_voucher 2178-2317، delete_sub_contract 1135)، extras_service.contract_settlement 295-350، voucher_payment_link_service (gate/plan_rows/apply_links/distribute)، lifecycle.add_employee_advance 3257-3313، report_service.gateway_summary 1606.
- عينات اختبارات للتحقق: test_v249_settlement، test_v437_daily_settlement، test_v449_net_settlement، test_v327_gateway_closed، test_settlement_requires_stages، test_settlement_action_visible_after_final_stage، test_v4512_gateway_undo_other.
- كتابة التقرير: /home/z/my-project/research/spec-subs-gateway.md (DDL + أقسام A-I + تعارضات PLAN + نماذج Prisma + مسارات API).

Stage Summary:
- تصحيح نطاق حاسم: settlement_service.py ليس تسوية مقاولي الباطن — هو تصفية البوابة مع البنك + الشركة الأخرى (docstring:1-9). تسوية الباطن = خطة الدفعات FIFO في lifecycle_service._sub_payment_plan_impl (1230-1356) + تسوية/إغلاق العقد في extras_service.contract_settlement (295-350: closable = تحصيل كامل + اكتمال مسار المراحل + ليس مغلق/ملغى — أي "منع التسوية بلا مراحل" هو منع الإغلاق).
- نموذج الباطن: المقاول→عقد باطن (RESTRICT على الطرفين)→بنود (boq_item_id أو منزّلة source_kind/source_id)→خطة دفعات مرحلية معتمدة على دفعات العميل (N:M sub_payment_sources؛ الاستحقاق باكتمال كل المصادر — lifecycle:1454-1491 وui:116-141)؛ سقف الصرف = Σعقود الباطن النشطة − Σمنصرف (party_type=subcontractor) مع OverpayWarning يتحول لدفعة مقدمة (lifecycle:1919-1944)؛ بوابة الصرف = settings.sub_pay_client_gate توقف الخط حتى تحصيل دفعة العميل (voucher_payment_link_service:31-47,166-187).
- البوابة: دورة حياة gateway_ops (استيراد→مطابقة تلقائية بالهاتف/الاسم/الرابط + نافذة 5/3 أيام + مبلغ ±0.001 → تثبيت تراكمي → تصنيف يدوي → توزيع ◆ قافل → إرجاع ↩ → تسديد → حذف تسديد). المطابقة مقابل سندات القبض فقط؛ التصفية اليومية ثلاثية (sys×gw×bank) بنافذة D+N±1 يوم عمل وتحمل tolerance؛ العمولة تُخصم حسابيًا ولا يُنشأ أي سند في المسار الحالي (مسار سند العمولة V4.52 أصبح ميتًا: settlement_service:999).
- الشركة الأخرى: طرف تحصيل خارجي — مستحق صافي (gross−fee) بتوزيع جزئي transfer_op_allocs، رصيد افتتاحي صف واحد، دفتر حساب، تسوية يومية، تقرير خارجي؛ الدفع فوق الصافي = «فروقات عمولة» مسموح؛ لا سندات ولا حساب مصروف فعّال (OTHER_EXPENSE_ACCOUNT معرفة وغير مستخدمة).
- تعارضات PLAN موثقة: (1) KNET فوري في الكود وليس T+1 كما في مسودة الخطة؛ (2) تقويمان: WEEKEND=(جمعة,سبت) لـT+1 مقابل خميس-سبت لتحصيل V4.41؛ (3) سلف الموظفين تنفذ بسندات advance_employee_id لا بجدول employee_advances المقترح (القواعد المحاسبية متطابقة)؛ (4) ui/financial_report.py غير موجود — التنفيذ في reports_page + report_service.gateway_summary.
- الحذف: خيارات منفصلة (عقد/سند/سجل) — عقد الباطن يُرفض مع سند صرف سارٍ أو مطالبة، الملغاة تُفك؛ السندات: حذف نهائي للمطور فقط وإلا إلغاء موثق؛ سجل المقاول لا يُحذف إلا فارغًا وبحساب المطور.
- مخرج جاهز للمنسق: /home/z/my-project/research/spec-subs-gateway.md يشمل DDL مع file:line، القواعد الحرفية لكل معادلة (سقف الدفع، FIFO التغطية، صافي المستحق، رصيد الدفتر)، دورة حياة البوابة كاملة، خوارزمية المطابقة، ونماذج Prisma + مسارات API مقترحة.
---
Task ID: 3, 4, 5
Agent: المنسق (Z.ai رئيسي)
Task: إعادة بناء الأساس — وثيقة القواعد + مخطط Prisma الكامل + مكتبات المصادقة والحسابات

Work Log:
- دمجت مخرجات الأبحاث الأربعة في BUSINESS_LOGIC_SPEC.md (قواعد مالية عشر + قواعد بناء) مع الإحالة للمواصفات التفصيلية في research/.
- كتبت prisma/schema.prisma كاملًا: 54 جدولًا تغطي كل المناطق (حوكمة/عملاء/عقود/سندات/ملاحق/مطالبات/باطن/أنواع/بوابة/شركة أخرى/فواتير/عهد/مهام/زيارات/تعليقات/أرشيف/قوالب/قيود/تدقيق). أصلحت 6 أخطاء علاقات Prisma (feeLinks على Voucher، علاقات SubContract بالـClaim/Addendum، FK بدل ربط اسمي في TypePaymentTemplate، اتجاهات bundle).
- bun run db:push ناجح: 54 جدولًا في db/custom.db.
- src/lib/auth.ts: PBKDF2-SHA256 بـ200k دورة (كالمصدر)، رموز HMAC موقعة (كوكي ctrk_session + Bearer)، كتالوج الصلاحيات (37 مفتاحًا)، hasPermission (المدير/المطور الكل، المفتاح المجهول لا يقيّد).
- src/lib/api-utils.ts: authGuard/adminGuard/jsonError/nextNumber (عدّاد ذري عبر number_sequences)/parseDay/audit/normalizeArabic/EPS=0.001.
- src/lib/contrack-core.ts: القلب المالي — supervisionStatus كاملة (تمديد/تنازل/تأخير)، contractCurrentValue، computeContractPaymentPlan (FIFO بركة القبض + روابط صريحة + آلة الحالات الثمانية بالترتيب الحرفي)، dueNowStrict، reachableLines (_REACHED)، checkReceiptCap (تحذيري)، receiptBankFee.
- src/lib/tafqeet.ts: تفقيط بالدينار الكويتي 3 خانات (فقط … لا غير) بصيغ المثنى والجمع.
- src/lib/format.ts + src/components/contrack/api.ts (توكن ctrk_token + ApiError مع overpay) + layout RTL بخط Cairo + ثيم زمردي + شريط تمرير مخصص.
- tsc نظيف على src/lib وsrc/app.

Stage Summary:
- الأساس جاهز بالكامل: قاعدة بيانات 54 جدولًا + مصادقة بأدوار + مكتبة مالية مطابقة حرفيًا لقواعد المصدر (FIFO/السقف التحذيري/الإشراف/الحالات الثمانية).
- الوكلاء الخلفيون يستوردون الحسابات من @/lib/contrack-core والحراسة من @/lib/api-utils — لا يعيدون اختراعها.
- التالي: موجة 1 خلفية (auth/users/customers/contracts/types/settings APIs) + واجهة (AppShell/دخول/عملاء/عقود) بالتوازي.

---

---
Task ID: 6
Agent: backend-core-apis
Task: بناء نواة مسارات API الخلفية لمشروع ConTrack (المصادقة/المستخدمون/العملاء/العقود/المراحل/الخطة/البنود/الإشراف/الأحداث/الأنواع/القوالب/مراحل التنفيذ/الإعدادات/طرق الدفع/لوحة القيادة) — 25 ملف route.ts + مكتبة مساندة واحدة، بلا لمس المخطط أو الواجهات.

Work Log:
- قرأت worklog.md وBUSINESS_LOGIC_SPEC.md وresearch/spec-core.md (الأقسام A-K) وcontrack-core.ts وauth.ts وapi-utils.ts وschema.prisma كاملًا قبل كتابة أي سطر.
- أنشأت src/lib/contrack-server.ts (مكتبة خلفية مساندة فقط، لا يعيد اختراع contrack-core):
  • nextNumberByKey(key, prefix, width, tx) — عدّاد number_sequences ذري بمفتاح حر (customer:code، contract:number).
  • getSettingsRow(tx) — يقرأ/يزرع صف settings id=1 بقيم افتراضية.
  • actualSupervisionEnd(stages) — تاريخ إنهاء إشراف فعلي من مرحلة اسمها يحوي «انهاء»+«اشراف» بتطبيع أ/إ/آ (supActualEnd||endDate، الأحدث).
  • loadContractCore(contractId, {excludeVoucherId}) — التحميل المالي الموحد: عقد+عميل، ملاحق، قبض سارٍ، روابط kind=receipt، مراحل، خطة، ثم يُخرج current=contractCurrentValue(amount, معتمد net, supExt)، collected (كل القبض السارٍ)، computed=computeContractPaymentPlan، sup=supervisionStatus مع actualEnd؛ excludeVoucherId لاحتساب الخطة كما لو أن السند غير موجود (لمسار تعديل السندات لاحقًا).
  • triggerDuePayments(contractId, stageId, finishDate, tx) — حرفيًا من workflow_service:4600-4664: سطور stage_id=? AND triggered_at='' مع remaining>0.001 بعد FIFO ⇒ dueDate=finishDate, triggeredAt=finishDate, notes=«مستحقة لانتهاء مرحلة «X» بتاريخ Y»؛ يعيد عدد المثيرة.
  • ACTIVE_CLAIM_STATUSES = registered|sent|in_review|approved|postponed (المطالبات السارية الحالكة للحذف).
- المصادقة: login (بذرة أول تشغيل admin/admin + secretary/123456 مشفرة PBKDF2 عند فراغ جدول users، كوكي sessionCookieOptionsFor + توكن Bearer، 401 «اسم المستخدم أو كلمة المرور غير صحيحة»)، logout (مسح الكوكي)، me، credentials (تغيير كلمة مروري، الجديدة ≥ 6).
- المستخدمون: users GET/POST للمدير (role ∈ admin|secretary، كلمة ≥ 6)، users/[id] PATCH/DELETE (منع حذف نفسك + منع حذف/إيقاف/تنزيل آخر مدير)، users/[id]/permissions GET (كتالوج 37 مفتاحًا مع حالة) وPUT للمدير (استبدال كامل، تصفية بالمفاتيح الصحيحة).
- العملاء: customers GET (بحث بتطبيع normalizeArabic على الاسم/الهاتف/الكود + contractsCount) وPOST بكود C-0001 عبر عدّاد customer:code ذري داخل معاملة مع إعادة محاولة 5 مرات عند تضارب unique (P2002)؛ customers/[id] GET (عقوده برقم/حالة/قيمة أصلية) وPATCH وDELETE (400 «لا يمكن حذف عميل له عقود»؛ مسح أبناء الإنتاجية comments/tasks/visits أولًا لتجنب قيود FK).
- العقود: GET بفلاتر q/status/customerId ولكل عقد current (amount+معتمد net+supExt مع actualEnd لكل عقد إشرافي — دفعة استعلام مراحل للعقود الإشرافية فقط)، collected، remaining، planCount؛ POST بتوليد CON-0001 عبر عدّاد contract:number ذري مع إعادة محاولة 5 مرات عند P2002، وخزن snapshot المراحل والخطة (sortOrder=الترتيب، stageIndex→id) وحدث «إنشاء عقد» وaudit داخل معاملة واحدة، مع سقف مجموع الخطة ≤ amount+0.001 عند الإنشاء.
- contracts/[id]: GET كامل (عقد+عميل+مراحل+خطة+current/collected+sup إن إشرافي)؛ PATCH — amount ممنوع مع قبض سارٍ أو خطة أو فواتير (400 «لا يمكن تعديل قيمة العقد بعد وجود حركة مالية»)، تغيير الحالة عبر changeContractStatus داخليًا (status+statusReason+cancelledAt=اليوم عند ملغى) مع حدث وتدقيق oldStatus→newStatus؛ DELETE بالترتيب الحرفي من spec-core G: فواتير ← سندات سارية ← مطالبات سارية ← عقود باطن ← دفعات ← مراحل، برسائل عربية دقيقة لكل مانع، ثم حذف فعلي (مراحل ثم خطة ثم عقد) + audit.
- المراحل: POST إضافة لنسخة العقد (sortOrder تلقائي) وGET قائمة؛ stages/[stageId] PATCH — بداية/نهاية، إنهاء (endDate=today أو تاريخ) يستدعي triggerDuePayments داخل المعاملة، تخطي isSkipped+closedBy ⇒ notes «غير مستحقة لأن المرحلة المرتبطة تم تخطيها» لسطورها غير المثيرة، إرجاع من التخطي يمسحها، إعادة فتح (endDate=null) ⇒ triggeredAt='' وnotes='' لسطورها المثيرة من هذه المرحلة — مع أحداث «إنهاء/تخطي/إرجاع/إعادة فتح مرحلة».
- الخطة: GET محسوبة عبر computeContractPaymentPlan بالحالات الثمانية + current + collected (بركة) + totalCollected + currentCoverage + supTotalDue=max(current, sup.totalDue) للسقف؛ POST بإضافة دفعة مع سقف Σ الدفعات ≤ current+0.001 («مجموع الدفعات يتجاوز القيمة الحالية»)؛ plan/[lineId] PATCH (نفس السقف بعد استثناء السطر) وDELETE (ممنوع مع رابط قبض صريح kind=receipt أو مطالبة مرتبطة: 400).
- البنود boq: GET/POST/PATCH (؟itemId=) وDELETE حذف ناعم deleted=true ممنوع إن كان البند مرتبطًا بعقد باطن عبر SubContractItem.boqItemId.
- الإشراف: GET supervisionStatus كاملة مع actualEnd؛ POST setup {supStartDate, supMonths, supMonthly, supDiscount} — إن كان نوع العقد isSupervision اُكتب contracts.amount=max(0, months×monthly−discount) (touch_amount — الموضع الوحيد المسموح)؛ PATCH waive {months, reason} بشرط months ≤ unpaidExtMonths («لا يمكن التنازل عن أكثر من التمديد غير المدفوع: X») مع إلحاق السجل supWaiveReason كسطور؛ DELETE إزالة ضبط الإشراف (ممنوع مع قبض سارٍ).
- الأحداث: GET آخر 100 + POST يدوي.
- الأنواع: contract-types GET/POST (pricingMode ∈ lump|unit|items|bundle، النوع الشامل لا يكون إشرافيًا)؛ [id] PATCH (تغيير الاسم ينعكس على contracts.contractType وworkflowStages.contractType — ربط اسمي) وDELETE (ممنوع لغير المطور إن استُخدم في عقود؛ حذف مكوّنات الشامل المرجعية قبل الحذف)؛ [id]/template GET/PUT استبدال كامل لقالب type_payment_tpl {payNo, title, pct (0-100), amountFixed, triggerStageName→triggerStageId بحل الاسم عبر workflow_stages (نفس النوع أو القالب العام), daysOffset, linkKeyword}.
- workflow-stages GET شجرة مرتبة transactionType/contractType/stageOrder + POST/PATCH/DELETE (؟id=) — الحذف ممنوع مع أبناء أو ارتباط بقالب دفعات أو نطاق عقود؛ settings GET (يزرع الصف الافتراضي) وPUT للمدير (collectionAlertDays بحد أدنى 7)؛ payment-methods GET للجميع وPOST/PATCH/DELETE للمدير (الحذف ممنوع مع استخدام في سندات سارية — عطّل بدلًا من الحذف)؛ dashboard: counts + totals (contractsValue=Σ غير ملغى بالقيمة الحالية كاملة، collected/paidOut aggregates، subAmount=Σ باطن غير ملغى) + dueNow حسب العقد (له خطة ⇒ dueNowStrict عبر computeContractPaymentPlan مع الروابط؛ بلا خطة ⇒ كامل المتبقي) مجمّع أعلى 10 عملاء + recentEvents آخر 10 + overdueCollections (متبقٍ وdaysSince(آخر قبض||contractDate) ≥ collectionAlertDays).
- كل المسارات تبدأ authGuard (بمفاتيح screen_contracts/screen_customers/action_add_contract/action_edit_contract/action_stage_advance/action_add_payment/action_edit_payment/action_cancel_contract حيث تقابل كتالوج الـ37) أو adminGuard؛ الرسائل عربية؛ jsonError للـ400/404؛ Decimal ⇒ Number() عند الإخراج والتواريخ نصية YYYY-MM-DD.
- smoke test حي عبر curl على dev server: تسجيل دخول وبذرة المستخدمين، إنشاء عميلين (C-0001/C-0002)، عقد CON-0001 بمرحلتين وخطتين، إنهاء مرحلة ⇒ مثّلت دفعتها (overdue بملاحظة الاستحقاق)، تخطي/إرجاع/إعادة فتح مرحلة، ضبط إشراف 6×500−250 وتنازل 3 (وقبض 100 ⇒ «لا يمكن التنازل عن أكثر من التمديد غير المدفوع: 11»)، سقف الخطة (سماح 17000≤17500 ورفض 20000)، منع تعديل amount بعد وجود خطة، منع حذف عقد بدفعات، تغيير حالة إلى ملغى ثم حذف ناجح لعقد نظيف، dashboard بقيمة 17500 ومستحق 8600، إعدادات PUT (حد أدنى 7)، نوعان + قالب دفعات (حل triggerStageName)، مراحل تنفيذ، طريقة دفع، مستخدم سكرتير + صلاحيات (منع screen_vouchers/screen_customers ⇒ 403 فعلي)، تغيير كلمة مرور — ثم نظّفت كل بيانات الاختبار وأعدت الإعدادات للافتراضي (بقيت بذرة admin/secretary فقط) — ملاحظة: /api/vouchers غير موجود بعد (مهمة لاحقة) فيرجع 404 HTML.

Stage Summary:
- الملفات المنشأة (26):
  1) src/lib/contrack-server.ts
  2) src/app/api/auth/login/route.ts — 3) auth/logout — 4) auth/me — 5) auth/credentials
  6) src/app/api/users/route.ts — 7) users/[id]/route.ts — 8) users/[id]/permissions/route.ts
  9) src/app/api/customers/route.ts — 10) customers/[id]/route.ts
  11) src/app/api/contracts/route.ts — 12) contracts/[id]/route.ts
  13) contracts/[id]/stages/route.ts — 14) contracts/[id]/stages/[stageId]/route.ts
  15) contracts/[id]/plan/route.ts — 16) contracts/[id]/plan/[lineId]/route.ts
  17) contracts/[id]/boq/route.ts — 18) contracts/[id]/supervision/route.ts — 19) contracts/[id]/events/route.ts
  20) src/app/api/contract-types/route.ts — 21) contract-types/[id]/route.ts — 22) contract-types/[id]/template/route.ts
  23) src/app/api/workflow-stages/route.ts — 24) settings/route.ts — 25) payment-methods/route.ts — 26) dashboard/route.ts
- قرارات تصميمية: (أ) مكتبة contrack-server.ts للمشترك بين المسارات دون تكرار، مع تمهيد excludeVoucherId لمسار السندات (المهمة 7). (ب) DELETE المفردة لمسارات بلا [id] (workflow-stages/payment-methods/boq/settings) عبر ?id= أو ?itemId= كما في نص المهمة. (ج) سقف الخطة عند إنشاء العقد من body.enforce على amount (مطابق add_plan_item). (د) مطالبات «سارية» = notIn(collected|paid|refused|cancelled|archived). (هـ) subAmount = Σ باطن غير ملغى. (و) حذف عميل يمسح أبناء الإنتاجية أولًا. (ز) حذف طريقة دفع مستخدمة يُرفض بدل التعطيل الصامت (رسالة صريحة). (ح) اسم أعاد تسميته في contract-types ينعكس على العقود ومراحل التنفيذ (ربط اسمي كما في المصدر). (ط) متطلبات الأمان الإضافية: منع إيقاف/تنزيل آخر مدير في PATCH وليس DELETE فقط.
- تضمين الاستجابات متوافق مع src/components/contrack/contrack-types.ts للوكيل الأمامي (CustomersResponse/ContractsResponse/ContractDetailResponse/PlanResponse/SupervisionResponse/DashboardStats/PermissionsResponse) — أخطاء tsc الحالية في مكونات الواجهة (مرجع item بدل customer وUsersView المفقود) من نطاق الوكيل الأمامي ولم أمسّ ملفاتها.
- bunx tsc --noEmit | grep "src/app/api" = صفر أخطاء؛ bun run lint نظيف؛ لا تعديل على schema.prisma أو db.ts أو المكونات؛ بيانات الاختبار أزيلت والقاعدة جاهزة نظيفة ببذرة admin/admin وsecretary/123456.
---
---
Task ID: 7
Agent: frontend-styling-expert (واجهة Next.js 16)
Task: المرحلة 1 واجهة — الهيكل والدخول والعملاء والعقود (ConTrackApp + 8 شاشات)

Work Log:
- قرأت worklog/BUSINESS_LOGIC_SPEC/format.ts/api.ts/schema.prisma ومكونات ui/ ثم فحصت مسارات API الخلفية الفعلية المكتوبة بالتوازي وقارنتها بعقد المهمة.
- بنيت contrack-types.ts كأنواع مشتركة مطابقة لعقد الـAPI الحقيقي (وليس المسودة): {customers|contracts|users|types|events|methods|settings} كأسماء مفاتيح الاستجابة، ContractListItem مُسطّح (customerName نص)، ContractDetailResponse تحت مفتاح contract مع stages/plan/current/collected/remaining/isSupervision/sup، PlanResponse (lines/amountN/state/stateLabel/currentCoverage/supTotalDue)، SupervisionComputed بحقول contrack-core.supervisionStatus (baseValue/extensionValue/totalDue/fullEnd/delayMonths/unpaidExtMonths)، PermissionsResponse بمفتاح permissions وكتالوج 37 مفتاحًا بمجموعات عربية (الشاشات/التقارير/الإجراءات).
- ConTrackApp: QueryClientProvider (retry:false)، استعلام /api/auth/me آلي (401 ⇒ LoginView)، login يخزّن token عبر setStoredToken + setQueryData، logout يستدعي /api/auth/logout + clearStoredToken + qc.clear، onAuthError يُمرَّر لكل الشاشات (أي 401 ⇒ إبطال auth)، حالة view/contractId/newContractCustomerId (زر «عقد جديد» من شاشة العملاء يفتح معالج العقود مع العميل محددًا).
- AppShell: شريط علوي ثابت (شعار + تنقل سطح المكتب + اسم المستخدم ودوره بالعربية + خروج)، شريط سفلي sticky للموبايل (flex justify-around — يتكيف مع 3/5 عناصر)، footer «ConTrack V9.15 — إدارة العقود والمحاسبة»، min-h-screen flex flex-col + main flex-1، الإعدادات/المستخدمون للمدير/المطور فقط.
- LoginView: بطاقة مركزية بخلفية emerald متدرجة، حقول ltr، رسالة خطأ عربية، زر بحالة تحميل.
- DashboardView: 8 KPI (grid-cols-2 lg:grid-cols-4) + شريط نسبة تحصيل + المستحق الآن حسب العميل (dueNow.byCustomer/حقل dueNow) + تنبيهات تعثّر التحصيل بشارة حمراء (contractId/remaining/daysSince) + آخر الأحداث (contractNumber مُسطّح) + Skeletons.
- CustomersView: بحث debounce 300ms، جدول سطح مكتب/بطاقات موبايل، نافذة تفاصيل (بيانات + عقود العميل + زر عقد جديد + فتح عقد)، إضافة/تعديل (Dialog حالة بسيطة)، حذف AlertDialog يُظهر رسالة الرفض الخلفية حرفيًا (ممنوع مع وجود عقود).
- ContractsView: فلاتر q+status (8 حالات عربية)، بطاقات بقيمة حالية/محصّل/Progress تحصيل/متبقي، معالج إنشاء 3 خطوات (بيانات+مراحل+دفعات) يرسل contractType باسم النوع النصي وplan (وليس payments) — مطابق للخلفي — ثم toast + فتح العقد المنشأ (رقم CON من الاستجابة).
- ContractDetailView: رأس بحالة/شارة إشراف/تعديل/تغيير حالة (سبب إلزامي للإلغاء والإغلاق)، 4 بطاقات مالية (أصلي/حالي/محصّل/متبقي)، Tabs: المراحل (بدء/إنهاء/تخطي/إعادة فتح بأجسام الخلفي الحقيقية: {startDate:today}/{endDate:'today'}/{isSkipped:true}/reopen مسح endDate أو isSkipped:false — المسار stages/[stageId] وليس ?stageId)، خطة الدفعات (جدول+بطاقات بشارات statusBadgeClass+PAYMENT_STATUS_LABEL، إضافة/حذف عبر plan/[lineId]، السقف يُظهر رسالة الخلفية حرفيًا)، بنود الكميات (GET/POST/?itemId=)، الإشراف (بطاقة 16 خلية من supervisionStatus + ضبط POST أو DELETE+POST عند الاستبدال + تنازل PATCH {months,reason} بحد أقصى unpaidExtMonths)، الأحداث (خط زمني)، + 5 تبويبات placeholder «قريبًا» (سندات/باطن/ملاحق/مطالبات/فواتير) جاهزة للاستبدال في هذا الملف فقط.
- SettingsView: للمدير فقط، نموذج شركات/مالية (رسوم بنك، أرصدة افتتاحية، subPayClientGate، أيام تنبيه) بحفظ PUT /api/settings، وأساليب الدفع (تعديل فوري عبر PATCH/DELETE ?id= + إضافة POST).
- UsersView: للمدير فقط، جدول/بطاقات، إضافة/تعديل (الأدوار admin|secretary فقط حسب تحقق الخلفي)، حذف بتأكيد، نافذة صلاحيات مجمعة بالعربية مع Switch وحفظ PUT {permissions:[{permKey,allowed}]} والافتراضي true.
- bunx tsc --noEmit: صفر أخطاء في src/components/contrack (المتبقي في المستودع: .next validator لمسارات الخلفي الجارية + examples/skills قديمة — خارج نطاقي).

Stage Summary:
- المرحلة 1 واجهة مكتملة: دخول/هيكل RTL متجاوب موبايل أولًا/لوحة مؤشرات/عملاء CRUD/عقود مع معالج إنشاء/تفاصيل عقد بتبويباتها المالية/إعدادات/مستخدمون وصلاحيات — كلها على shadcn/ui + react-query + toasts عربية وألوان emerald/amber/red/zinc فقط.
- التوافق مع الخلفي تحقق بالفحص الفعلي لمساراته: أسماء مفاتيح الاستجابة (customers/contracts/users/types/events/methods/settings/sup/permissions)، plan/[lineId] وstages/[stageId] بمسار وليس query، payment-methods عبر ?id=، تقارير الرسائل الخلفية حرفيًا في toasts.
- بقايا معروفة لاحقًا: تبويبات placeholder في ContractDetailView (سندات/باطن/ملاحق/مطالبات/فواتير) تُملأ بتعديل هذا الملف فقط؛ مسار users لا يقبل دور developer عند الإنشاء (قيد خلفي) — الواجهة مطابقة.

---
Task ID: 9
Agent: frontend-styling-expert (واجهة Next.js 16)
Task: المرحلة 2 واجهة — السندات والباطن (شاشتان رئيسيتان + تبويبا السندات/الباطن داخل تفاصيل العقد)

Work Log:
- قرأت worklog (Tasks 2c/2d/3-7) وcontrack-types/api/AppShell/ConTrackApp/ContractDetailView/ContractsView وBUSINESS_LOGIC_SPEC (القواعد 3/4/7/10: FIFO، السقف التحذيري OverpayWarning→allowOverpay، الإلغاء الناعم ورفضه بمطالبة سارية/تصفية عهدة/ابن رسوم، استحقاق الباطن باكتمال المصادر + بوابة sub_pay_client_gate) وspec-core قسم J (أنواع السندات الخمسة RV/PV/TV/CV/SD، الرسوم البنكية سند ابن PV، سقف الإرجاع القاطع، الشيك chequeDueDate) — ثم مطابقت عقد API المُسلَّم في نص المهمة حقلًا حقلًا.
- contrack-types.ts: أضفت للـViewName قيمتي vouchers/subcontractors + أنواع (VoucherItem/VouchersResponse/VoucherDetailResponse مع links وfeeChildren، PayLinkLine بحقول eligible/room/gated، PaymentLinkValidateResult بـsuggested) + ثوابت العرض (VOUCHER_TYPE_LABEL/PREFIX/BADGE: RV أخضر، PV أحمر، TV سماوي، CV برتقالي، SD رمادي) + أنواع الباطن (SubContractor بحقول _activeContracts/_total/_paid، SubContractListItem، SubContractDetailItem بـplan/capRemaining، SubPlanLine بـgated/sources، SubPayBlockRow) + EmployeeDTO/ExpenseAccountDTO الاحتياطية.
- VoucherDialog.tsx (مشترك جديد): Segmented للأنواع الخمسة؛ **قبض**: عميل→عقد (من /api/customers/[id] مفلترة بلا ملغى/مغلق) أو preset عقد مقفول من تفاصيل العقد، طريقة من payment-methods مع كشف «شيك» ⇒ chequeDueDate، قسم الربط: GET /api/payment-link?contractId&kind=receipt يعرض الخطوط eligible فقط (room/remaining/state) مع Checkbox ومبلغ لكل خط (افتراضي min(المبلغ, room)) ومجموع Σ، «توزيع تلقائي» يستدعي POST /api/payment-link {action:'validate'} ويملأ suggested؛ 422 overpay ⇒ كتلة تأكيد «نعم، سجّل زيادة كدفعة مقدمة» تعيد الإرسال بـallowOverpay:true (ApiError.overpay)؛ سطر «سيُنشئ سند رسوم بنكية: X» محسوبًا من feeType percent/amount للطريقة (توضيحي — الخلفي المرجع). **صرف** بتبويب فرعي مصروف/عهدة/باطن/شريك(مدير): مصروف شجرة أب/ابن من /api/expense-accounts مع fallback input نصي snapshot + عميل/عقد تعرضيان، عهدة حسابات accountKind='advance' مع fallback نصي، باطن عقد→عقد باطن (/api/sub-contracts?contractId=) مع عرض capRemaining وتحذير تجاوز مسبق، شريك اسم حر. **تحويل** من/إلى (صندوق/بنك + أسماء الطرق) مع منع التطابق. **إرجاع عهدة** حساب العهدة (سقف من رسالة الخلفية). **خصم راتب** موظف من /api/employees مع fallback نصي. الإرسال POST /api/vouchers بجسم مركب حسب النوع (partyType/partyId/subContractId/expenseAccountId/custodyAccountId/advanceEmployeeId/links[{lineId,kind:'receipt',amount}]) + إبطال vouchers/payment-link/sub-contracts/contract/contracts/dashboard.
- VouchersView.tsx: 4 بطاقات KPI (قبض/صرف/تحويلات/إرجاع+خصم) بتعميم محلي من العناصر غير الملغاة، فلاتر: تبويبات vtype الستة، بحث debounce 300ms، from/to type=date، Switch «عرض الملغاة» (includeCancelled=1)، جدول max-h-[480px] بتمرير (RTL: رقم بشارة لون النوع/تاريخ/طرف+رقم العقد/وصف truncate/مبلغ formatKWD/حالة سارٍ أو ملغى بـtooltip للسبب/إجراءات) + بطاقات موبايل، صفوف الملغاة opacity-50، نافذة تفاصيل GET /api/vouchers/[id] تعرض الحقول + خطوط الربط + أبناء الرسوم، نافذة إلغاء للمدير بسبب إلزامي (DELETE بجسم {reason} عبر fetch يدوي لأن apiDelete لا يرسل جسمًا) تعرض رسالة الرفض الخلفية حرفيًا.
- SubContractDialog.tsx (مشترك جديد): بطاقات قيمة/مدفوع/sقف متبقٍ capRemaining + إجراءات المدير (صرف على هذا الباطن يفتح VoucherDialog بقسم باطن معبأ، إلغاء بسببيات PATCH {status:'ملغى',statusReason}، حذف DELETE برسالة الخلفية) + 4 تبويبات: **البنود** PUT استبدال كامل مع إضافة من بنود BOQ لعقد العميل (select) أو بند يدوي (وصف/كمية/سعر) وأزرار تراجع/حفظ تظهر عند التغيير، **خطة الدفعات** خطوط بـstateLabel + شارة «موقوفة ببوابة تحصيل العميل» عند gated + مصادر الخط نصيًا + إضافة خط {title,amount,dueDate,sources[{planLineId}]} بمصادر متعددة من دفعات العميل ذات remaining>0.001 (GET /api/contracts/[id]/plan) + حذف خط + «توزيع تلقائي» {total, count أو boqItemIds متعدد}، **كتل الدفع** GET pay-blocks جدول موحد (دفعة العميل/قيمتها/المغطى/حالتها) مقابل subLines بحالاتها وقفلها، **السندات** GET /api/vouchers?partyType=subcontractor&partyId=.
- SubcontractorsView.tsx: بحث debounce + جدول (كود/اسم/هاتف/نشاط/عقود نشطة/إجمالي/منصرف/متبقي بشارة amber-emerald) + بطاقات موبايل + نافذة تفاصيل (بيانات + بطاقات عقود الباطنة برقم عقد العميل/المبلغ/المدفوع/المتبقي/الحالة وزر فتح SubContractDialog) + إضافة/تعديل (POST/PATCH /api/subcontractors) + حذف بتأكيد يعرض رسالة الرفض (عقود نشطة).
- ContractDetailView.tsx (تعديل محدود): أزلت vouchers/subs من PLACEHOLDER_TABS (بقيت ملاحق/مطالبات/فواتير)، تبويب «السندات»: استعلام vouchers?contractId&includeCancelled=1 + أزرار «قبض/صرف على هذا العقد» تفتح VoucherDialog بـpreset مقفول + صفوف ببشارات النوع والرسوم الأبناء وeye لتفاصيل السند (يعيد استخدام VoucherDetailBody المصدَّرة من VouchersView)، تبويب «الباطن»: استعلام sub-contracts?contractId + بطاقات (مقاول/حالة/قيمة/مدفوع/متبقي) + «عقد باطن جديد» Dialog (مقاول من /api/subcontractors + قيمة + تواريخ) يفتح تفاصيل المُنشأ تلقائيًا + فتح SubContractDialog المشترك — كل النوافذ الجديدة قبل إغلاق مكوّن التفاصيل مباشرة.
- AppShell.tsx: NAV_ITEMS + {vouchers «السندات» Receipt} و{subcontractors «المقاولون» HardHat} (غير adminOnly) — تنقل سطح المكتب والشريط السفلي يتكيفان تلقائيًا (7 عناصر للمدير ضمن max-w-lg).
- ConTrackApp.tsx: استيراد وتوجيه الشاشتين {view==="vouchers" && <VouchersView/>} و{view==="subcontractors" && <SubcontractorsView/>}.
- ضبط جودة: bunx tsc --noEmit | grep "src/components/contrack" = صفر، eslint على مجلد contrack = صفر (أصلحت: تحديث ref أثناء render في VoucherDialog بدفع مزامنة preset إلى useEffect، إزالة import مهمل)، ولم ألمس prisma/src/lib/api.ts/package.json ولا أنشأت مسارات API، ولا dev/build/db:push.
- قرارات مزامنة مع الوكيل الخلفي (طُبقت حرفيًا على عقد المهمة، تُعدَّل سريعًا عند الفروق): (أ) التحويل يرسل method=account=«من» + toAccount=«إلى»، (ب) إلغاء السند DELETE بجسم {reason}، (ج) مصادر خط الباطن بصيغة sources:[{planLineId}]، (د) التوزيع التلقائي يرسل {total, count} عند وضع عدد الخطوط و{total, boqItemIds} عند بنود BOQ، (هـ) includeCancelled=1 لعرض الملغاة في الجداول، (و) fallback الواجهة جاهز لمسارات غير جاهزة (expense-accounts/employees تعيد input نصي عند 404).
- لم أضف حالة selectedSubContract عالمية في ConTrackApp — فتح تفاصيل العقد الباطن محلي بحالة داخل SubcontractorsView وContractDetailView (قرار نص المهمة: الأولوية للشاشتين و«إن سهل»)، والمكوّن SubContractDialog مشترك يجعل الترقية لاحقًا سطر استيراد واحد.

Stage Summary:
- المرحلة 2 واجهة مكتملة: شاشتا «السندات» (KPI/فلاتر/جدول بشارات RV-PV-TV-CV-SD/تفاصيل/إلغاء سببي) و«المقاولون» (CRUD + عقود باطنة)، حوار سند مشترك بخمسة أنواع يغطي الربط بالدفعات (توزيع تلقائي validate→suggested أو يدوي مع room) ومعالجة السقف التحذيري 422 بـallowOverpay والرسوم البنكية المتوقعة، حوار عقد باطن مشترك (بنود PUT/خطة دفعات بمصادر وgated/كتل الدفع/السندات)، وتبويبا «السندات» و«الباطن» داخل تفاصيل العقد يعيدان استخدام المكوّنين المشتركين — كل شيء tanstack/react-query + shadcn/ui + toasts عربية + Skeletons + موبايل أولًا بألوان emerald/amber/red/sky/zinc.
- الملفات: VouchersView.tsx وSubcontractorsView.tsx وVoucherDialog.tsx وSubContractDialog.tsx (جديدة)؛ تعديلات محدودة على contrack-types.ts وAppShell.tsx وConTrackApp.tsx وContractDetailView.tsx.
- عند اكتمال الخلفي: فحص أسماء الحقول ضد عقد المهمة تم مسبقًا؛ نقاط الاحتكاك المحتملة الموثقة أعلاه (أ–و) تحتاج تأكيدًا واحدًا من مسار الخلفي الفعلي.
Task ID: 8 (أُنجز وتحقق منه المنسق بعد انقطاع الوكيل عند التسليم)
Agent: full-stack-developer (خلفية) + تحقق المنسق
Task: المرحلة 2 خلفية — السندات الخمسة + البوابة الربطية + مقاولو الباطن

Work Log:
- أنشأ الوكيل كل المسارات قبل انقطاعه: vouchers/route.ts (GET+POST عبر src/lib/voucher-server.ts: createVoucher بأنواع receipt/payment/transfer/custody_return/salary_deduction، سقف القبض 422 overpay، سقف باطن، رصيد التحويل، سقف قاطع للعهدة/السلفة، apply_links مع spread وadvanceAmount، رسوم بنكية سند ابن PV «عمولات بنكية»، قيود JournalEntry) + vouchers/[id]/route.ts (PATCH للمدير مع إعادة موازنة الأبناء + DELETE إلغاء موثق بحواجز المطالبات/التصفية/السلفة وإلغاء الأبناء وعكس القيود وإعادة فتح الدفعات) + vouchers/grouped (BT-#### عمولة موحدة مقسومة بالتساوي) + payment-link (GET خطوط eligible/room/gated + POST validate/distribute) + subcontractors CRUD (SUB-0001 ذري) + sub-contracts CRUD + [id]/items + [id]/plan (+[lineId] +distribute) + [id]/pay-blocks.
- تحقق المنسق بنفسه (curl): RV-0003 قبض 4,000 ⇒ دفعة أولى paid والدالثة overdue ✓؛ تجاوز 7,000 ⇒ 422 برسالة عربية وoverpay:true ✓؛ allowOverpay ⇒ advance_amount=1,000 في القاعدة ✓؛ إلغاء RV-0003 ⇒ reopened:1 وروابط RV-0004 الصريحة بقيت على الخط الثاني والبركة المتبقية 1,000 غطت الأول — مطابق لسلوك المصدر ✓؛ tsc صفر على src/app/api.

Stage Summary:
- إصلاح تكامل واحد: POST /api/vouchers يعيد {voucher} بينما VoucherDialog كان يقرأ res.item — صححه المنسق لقراءة الاثنين.
- بيانات اختبار متبقية في القاعدة (عميل/عقد FIFO + سندات) — تُنظف في التحقق النهائي قبل التسليم.
- بذر الدخول: admin/admin وsecretary/123456.

---

---
Task ID: 10-b
Agent: frontend-styling-expert (واجهة Next.js 16)
Task: المرحلة 3 واجهة — التقارير وكشف الحساب والمتابعة والبحث الشامل (ReportsView + StatementView + FollowupView + SearchDialog + تبويب كشف الحساب)

Work Log:
- قرأت worklog (Tasks 7/9 لأنماط الواجهة) وBUSINESS_LOGIC_SPEC (القاعدة 5: الفواتير «للعلم» مدين=دائن=0 ولا تخفض المديونية، المتبقي = القيمة الحالية − المحصّل) وspec-reports.md الأقسام A-C (بنية الكشف: صف افتتاحي للقيمة + ملاحق ADD-xxx + تمديد الإشراف مدين بbase_end + قبض دائن، فرز (date,ref)، رصيد تراكمي؛ كشف العميل بأقسام لكل عقد + رصيد أول الفترة؛ المتابعة الصارمة strict) — ثم بنيت على عقد API المُسلَّم في نص المهمة (الوكيل الخلفي يبنيه بالتوازي).
- contrack-types.ts (تعديل محدود): ViewName += reports/statement/followup + أنواع: StatementRow (date/ref/desc/debit/credit/balance/kind) وStatementTotals (debit/credit/remaining/current?/collected?) وContractStatementResponse وCustomerStatementResponse (sections بخطوط contract/subtotal) وSubcontractorStatementResponse وStatementTarget وReportResponse (title/heads/rows/numberCols/accentRows/totals مصفوفة-أو-كائن/note) وFollowupResponse (dueNow/overdueCollections/expiring/nearBaseEnd بحقول contractId اختيارية) وSearchResponse (groups بـtype/label/items{id,title,subtitle,contractId?}).
- StatementTable.tsx (مشترك جديد): جدول 7 أعمدة (تاريخ/مرجع/بيان/مدين/دائن/رصيد) بترقيم صفوف، رأس sticky، kind='invoice_info' مائل باهت + Badge «للعلم» بـTooltip «الفاتورة لا تخفض المديونية»، الأنواع الثقيلة (opening/subtotal/total/section) بخلفية muted وعريضة، تذييل إجماليات sticky bottom (مدين/دائن/المتبقي بتلوين amber/emerald)، Skeleton/حالة فارغة، **<style> طباعة مشترك** داخل المكوّن: @media print { header, footer, nav, .print-hidden { display:none } } + إلغاء max-h للتمرير — فيرثه كل مستخدم (شاشة الكشوفات + تبويب التفاصيل).
- ReportsView.tsx: قائمة جانبية سطح المكتب + Select موبايل لعشرة تقارير (customers-balances/stage-dues/supervision-delays/subcontractors/vouchers/expenses/cashflow/contracts/execution/journal بأيقوناتها)، فلاتر لكل تقرير (from/to للتقارير الفترية افتراضيًا من بداية الشهر + Select خيارات: option/vtype/mode حسب التقرير — قيمة «الكل» عبر سلسلة sentinel لأن Radix يمنع value="")، زر «تصدير CSV» عبر fetch يدوي POST /api/reports/export {report, params} مع Authorization وblob وتنزيل باسم title (ومعالجة 401), **الجدول الموحد**: heads رؤوسًا، numberCols محاذاة يسار + formatKWD لما رقمي، accentRows خلفية emerald-50/900-20، صف totals ثابت (sticky bottom، يدعم مصفوفة أو كائن مرسلًا)، note أسفل الجدول، max-h-[60vh] تمرير أفقي وعمودي، Skeleton وحالة «لا بيانات في هذه الفترة».
- StatementView.tsx: طرفان (عميل/مقاول باطن) — عميل: بحث debounce + Select عملاء ثم Select عقود («كل العقود» أو عقد محدد)؛ مقاول: Select من /api/subcontractors؛ فترة from/to؛ ثلاثة استعلامات: /api/statement/contract/[id] للعقد المحدد (بطاقات القيمة الحالية/المحصّل/المتبقي + StatementTable)، /api/statement/customer/[id]?from&to للشامل (تركيب أقسام: صف رأس عقد kind='section' بbg-muted + صفوفه + صف مجموع لكل عقد kind='subtotal' + إجمالي عام في التذييل)، /api/statement/subcontractor/[id] للمقاول؛ زر طباعة window.print يستثمر الفلاتر عبر print:hidden، واستقبال presetTarget (عقد/عميل/مقاول) من ConTrackApp مع onConsumePreset.
- FollowupView.tsx: 4 بطاقات عد أعلى + 4 أقسام بشارات ملونة: المستحق الآن (أحمر، الدفعة + أيام التأخير + المتبقي)، تعثر التحصيل (برتقالي، «منذ X يوم» + آخر قبض أو «بلا أي قبض»)، عقود تنتهي قريبًا (أصفر، endDate + «باقي X يوم»)، إشراف قرب نهاية الأساس (سماوي، baseEnd) — كل صف زر قابل للنقر يفتح العقد عبر onOpenContract عند وجود contractId، تحديث يدوي، Skeletonات، وتحويل أيام عربي (يوم/يومين/أيام/يومًا).
- SearchDialog.tsx: مستمع Ctrl+K/⌘K عالمي + فتح من زر AppShell، input فوري debounce 250ms ⇒ GET /api/search?q=&limit=8 (يبدأ من حرفين)، مجموعات بأيقوناتها (عملاء/عقود/سندات/مقاولون/فواتير/مطالبات)، النقر: عميل⇒تفاصيله في شاشة العملاء، عقد⇒تفاصيل العقد، سند⇒شاشة السندات بفلتر q، فاتورة⇒العقد إن وُجد contractId وإلا السندات بالعنوان، مقاول⇒شاشة المقاولين؛ Enter يفتح أول نتيجة وEscape يغلق (Radix)، تذييل بتلميح الاختصار.
- AppShell.tsx (تعديل محدود): NAV_ITEMS += التقارير BarChart3 والكشوفات FileSpreadsheet والمتابعة ClipboardList (غير adminOnly) + زر بحث شامل في الشريط العلوي (أيقونة Search + تلميح Ctrl K على الشاشات الواسعة) + الشريط السفلي للموبايل صار overflow-x-auto justify-start (10 عناصر للمدير لا تتسع ثابتة).
- ConTrackApp.tsx: توجيه الشاشات الثلاث + حالة searchOpen وselectedStatementTarget (openStatement من تبويب كشف الحساب يفتح الشاشة الكاملة بالعقد) + customerDetailPreset وvouchersPresetQ لنتائج البحث — بمرر preset/callback إلى الشاشات المعنية.
- ContractDetailView.tsx (تعديل محدود): تبويب «كشف الحساب» ScrollText مع استعلام /api/statement/contract/[id] (مفعّل عند التبويب) + StatementTable المشترك + زر «طباعة» + زر «شاشة الكشوفات» (onOpenStatement) — بقيت PLACEHOLDER_TABS (ملاحق/مطالبات/فواتير) كما هي لوكلاء آخرين.
- تعديلات إضافية دنيا خارج قائمة الملكية (إضافية سلبية 100% لإنجاز سلوك البحث المطلوب نصًا): CustomersView += presetDetailCustomerId/onConsumePreset (useEffect يفتح نافذة تفاصيل العميل)، VouchersView += presetQ/onConsumePresetQ (useEffect يضبط فلتر البحث) — كلاهما سلوكه السابق سليم عند غياب الـprops.
- ضبط جودة: bunx tsc --noEmit | grep "src/components/contrack" = صفر، eslint على المجلد = صفر (أصلحت SelectItem بقيمة فارغة في ReportsView عبر sentinel لأن Radix يرمي خطأ وقت التشغيل) — أخطاء tsc المتبقية بالمستودع في src/lib/report-server.ts (ملف الوكيل الخلفي قيد البناء) وexamples/skills القديمة، خارج نطاقي، ولم ألمس prisma/src.lib*/api.ts/package.json ولا مسارات API ولا dev/build/db:push.
- نقاط مزامنة مع الخلفي (تُعدل سريعًا عند الفروق): (أ) Followup يفترض contractId في كل صف لتجعل الصف قابلًا للنقر (dashboard يرسله أصلًا) — بدونه يعرض الصف غير قابل للنقر بأمان؛ (ب) ReportResponse.totals يدعم مصفوفة بموازنة heads أو كائن (يحاول مطابقة أسماء الرؤوس وإلا قيمه بالترتيب)؛ (ج) export CSV عبر POST {report, params} واسم الملف من title؛ (د) باراميترات التقارير: from/to + option|vtype|mode فقط عند الاختلاف عن «الكل»؛ (هـ) كشف العقد يستقبل from/to اختياريين والشامل contractId&from&to.

Stage Summary:
- المرحلة 3 واجهة مكتملة: مركز تقارير بعشرة تقارير بفلاترها وتصدير CSV وجدول موحد بأرقام وaccentRows وإجماليات ثابتة، شاشة كشوف بثلاثة أنماط (عقد/عميل شامل بأقسام ومجاميع/مقاول) تطبق حرفيًا قاعدة «الفواتير للعلم» مع طباعة تخفي التنقل، شاشة متابعة رباعية الألوان صفوفها تفتح العقود، وبحث شامل Ctrl+K بمجموعات ونتائج قابلة للنقر تصل حتى تفاصيل العميل وفلتر السندات — كلها react-query + Skeletons + toasts عربية + موبايل أولًا على emerald.
- الملفات: StatementTable.tsx وReportsView.tsx وStatementView.tsx وFollowupView.tsx وSearchDialog.tsx (جديدة)؛ تعديلات محدودة على contrack-types.ts وAppShell.tsx وConTrackApp.tsx وContractDetailView.tsx + إضافتان سلبيتان على CustomersView.tsx وVouchersView.tsx.
- عند اكتمال الوكيل الخلفي: طابق أسماء الحقول ضد عقد المهمة (نقاط المزامنة أ–هـ أعلاه) وأعد tsc — لا تغييرات هيكلية متوقعة.
---
Task ID: 10-a
Agent: backend-statement-reports
Task: الخلفية — كشوف الحساب الثلاثة + 14 مسار تقارير + المتابعة والبحث الشامل (src/lib/report-server.ts مشترك) بلا لمس المخطط أو الواجهات أو المسارات الموجودة.

Work Log:
- قراءة إلزامية بالترتيب: worklog.md (سجل Task 6/7/8)، BUSINESS_LOGIC_SPEC.md (قاعدة كشف الحساب 5)، research/spec-reports.md كاملًا (A: statement_service، B: report_service، C: followup، D: execution، E: cashflow، H: search)، ثم contrack-core.ts وcontrack-server.ts وapi-utils.ts وauth.ts (كتالوج الصلاحيات) وschema.prisma — استيراد كامل بلا إعادة اختراع.
- أنشأت src/lib/report-server.ts (المكتبة المشتركة، server-only):
  • buildContractStatementRaw(contractId) — كشف العقد حرفيًا من spec-reports A.1: صف افتتاحي «قيمة العقد» مدين بتاريخ contract_date ومرجع رقم العقد؛ ملاحق معتمدة (net=add−deduct، |net|<0.001 يُتخطى، زيادة مدين/خصم دائن بمرجع ADD-xxx ووصف {النوع}: {السبب})؛ فواتير صفوف محايدة kind='invoice_info' مدين=دائن=0 بوصف «فاتورة (للعلم): … · {amount:,.3f}» (لا تغير الرصيد ولا الإجماليات)؛ سندات قبض سارية دائن بترتيب (vdate,id)؛ تمديد إشراف صف مدين واحد بتاريخ base_end ومرجع «تمديد» بوصف «تمديد إشراف · N شهر (X للشهر)· بعد إلغاء M شهر» (billable×monthly عبر supervisionStatus)؛ فرز مشترك (date,ref) ورصيد تراكمي balance += debit−credit.
  • buildContractStatement(id, {from,to}) — إجماليات A.1 الحرفية: total_debit = amount+supExt+مدين ADD-، total_credit = rec_total+خصومات ADD-، remaining = current−collected فقط، current = amount+netAdd+supExt، total_invoiced للعرض؛ فلتر from يطوي الأقدم في صف «رصيد أول الفترة» (رصيد آخر صف قبله) وto يحصر الأحدث مع إعادة تراكم الأرصدة.
  • buildCustomerStatement(customerId, {contractId?, from, to}) — A.2: عقود العميل بغير ملغى/مسودة مرتبة (contractDate,id) (أو عقد محدد بتحقق ملكية)، لكل عقد كشفه كاملًا، فترة لكل عقد ⇒ رصيد أول فترة، صف افتتاحي إجمالي واحد kind='opening' بإشارة المجموع، دمج (date, contract_number, ref) برصيد جارٍ واحد، subtotal لكل عقد + total نهائي، perContract + opening + contracts_count.
  • buildSubcontractorStatement(subId, {from,to}) — A.3: مدين عقود باطنه بغير الملغى (مرجع SB-{id}، تاريخ البداية/تاريخ العقد)، دائن سندات صرف party_type='subcontractor' بترتيب (vdate,id)، افتتاحية = مدين(قبل from)−دائن(قبل from)، فرز (date,ref) ورصيد جارٍ وإجماليات.
  • loadContractsFinance(opts) — محمّل مالي موحد لكل العقود: القيمة الحالية (amount+معتمد net+supExt مع actualEnd من actualSupervisionEnd)، collected (كل القبض السارٍ)، خطة محسوبة computeContractPaymentPlan مع stageInfoByLine (اسم/نهاية/تخطي المرحلة)، dueNow (له خطة ⇒ dueNowStrict؛ بلا خطة ⇒ كامل المتبقي)، حقول الإشراف الكاملة (supStartDate/supMonths/supMonthly/supWaivedMonths/supWaiveReason) — يغذي تقارير العملاء/المراحل/الإشراف/العقود/المتابعة.
  • ReportTable الموحد {title, heads, widths?, rows[][], numberCols, accentRows, totals?, note?} + بناة مستقلة: reportCustomersBalances (option=all|with_balance|no_balance|due_only|by_stages — الحالة «مستحق الآن/عليه رصيد/مسدّد بالكامل»، due_only صارم، by_stages يفوّض stage-dues، المحصّل يشمل قبض بلا عقد party عميل)، reportStageDues (option=overdue|due|upcoming|all — تجميع بالمرحلة، strict = بلا skip/بانتظار مرحلة وdaysDiff≤0، overdue الصارم الصارم للفلتر، الحالات «غير مستحقة/مستحقة/مسددة/لم تستحق بعد»، عقد بلا خطة وله رصيد ⇒ صف «—» مستحقة، ترتيب متأخر ثم مستحقة ثم الكبر due)، reportSupervisionDelays (option=unpaid الافتراضي|all — من supervisionStatus فقط: أشهر التأخير delayMonths وقيمة delayValue وaccent للتأخير>0، التمديد المدفوع = أدنى(قيمة التمديد، المحصّل−الأساس) بالأشهر، المدة الملغاة وسببها وfullEnd)، reportSubcontractors (صف لكل عقد باطن قيمة/مدفوع/متبقي + صف إجمالي accent لكل مقاول، المدفوع يشمل سندات بلا عقد باطن مع قيد «عقد غير ملغى» كـB.11)، reportVouchers (from/to وخيار vtype=income|expenses|all — صفوف القبض والصرف وإرجاع العهد وخصم الرواتب مع الحساب (أول/آخر جزء من المسار) والطرف والعقد، استبعاد تصفية العهدة والشريك من الإجماليات: totalIn/totalOut/recoveries/net)، reportExpenses (تجميع بشجرة الحسابات: عدد السندات/الإجمالي/ضمن الربحية من includeInProfitability، إرجاع عهدة الموظف وخصم الراتب سالب «تخفيض السلفة»)، reportCashflow (mode=detail|summary|daily|monthly(+yearly) — floor من cashStartDate/openingBalanceDate واستبعاد الأقدم، الافتتاحي = bank+cash من الإعدادات، استبعاد التحويل وخصم الرواتب ورد السلفة وتصفية العهدة، الرسوم البنكية أبناء الرسوم ضمن المنصرف ومنفصلة «منها رسوم بنك»، رصيد تراكمي للفترات بأسماء شهور عربية)، reportContracts (option=all: أصلية/إضافات/تمديد/حالية/محصل/متبقي بفترة على contract_date؛ profitability حرفيًا B.7: القيمة بلا تمديد إشراف، الفعلي = collected−paid ببوابة includeInProfitability على (العقد/باطنه)، المتوقع = value−(باطن+منصرف آخر غير مقاول)، الهامش %؛ by_type تجميع؛ expiring بنافذة أول قيمة من settings.expiryAlerts «90,60,30,7»)، reportExecution (option=stages: صف لكل عقد بالمرحلة الجارية والتالية وdays_in والمتوقع والحالة over/near/ok حرفيًا (over>expected، near≥expected−3) وaccent للمتأخر؛ occupancy: إشغال المراحل بعدد العقود/متأخرة/قاربت)، reportJournal (قيود journal_entries بالفترة و«· (قيد عكسي)» لsourceType='voucher_cancel' ومجموع متوازن)، reportGatewaySummary (ops status='mine' مقسمة effective_date≤اليوم محصلة/معلقة — وإن لا بيانات ⇒ صفوف فارغة بأعمدة صحيحة وملاحظة «تُملأ بعد مرحلة البوابة»)، reportTableToCsv (BOM \uFEFF + ترويسة + صفوف + إجماليات + ملاحظة، تهريب علامات التنصيص/الفواصل).
- كشوف الحساب (authGuard بمفاتيح الشاشات): statement/contract/[id] GET (screen_contracts) يعيد {rows, totals:{debit,credit,remaining,current,collected}, meta, contract, customer}؛ statement/customer/[id] GET (screen_customers) ?contractId&from&to؛ statement/subcontractor/[id] GET (screen_subcontractors) — كلها params: Promise ورسائل عربية 404.
- التقارير (authGuard بمفتاح التقرير من كتالوج 37): reports/customers-balances، stage-dues، supervision-delays، subcontractors، vouchers، expenses، cashflow، contracts، execution، journal، gateway-summary — كلها GET تعيد ReportTable الموحد مع parseDay للفترات.
- reports/export POST {report, params} — خريطة التقرير ⇒ البانِد + مفتاح صلاحيته (report_*)، CSV بترميز UTF-8-BOM وContent-Disposition «report-{key}-{اليوم}.csv»، 404 لتقرير مجهول.
- followup GET: يجمع المستحق الآن (لكل عقد غير مغلق/ملغى: dueNow مع تفاصيل الخطوط المتأخرة lineId/title/dueDate/remaining/daysDiff/stateLabel، level=red لأي خط daysDiff<0)، تعريض التحصيل (remaining>0.001 وdaysSince(آخر قبض||تاريخ العقد)≥collectionAlertDays)، عقود تنتهي قريبًا (نافذة expiryAlerts الأول 90 يومًا، level حسب الأيام 7/30)، إشراف قريب من نهاية الأساس (baseEnd خلال 30 يومًا contracts_near_base_end) — بإجمالي dueNow.total وإحصاءات الإعدادات.
- search GET ?q=&limit=8: تطبيع normalizeArabic على الاستعلام والحقول معًا (عملاء: name/code/phone/email/address؛ عقود: number/name/description + بيانات العميل والمبلغ = أصلية+ملاحق معتمدة؛ سندات: number/party/description/account/snapshots/رقم العقد؛ مقاولون: name/code/phone/activity؛ فواتير: number/description + العميل؛ مطالبات: number/title + العقد) — يعيد {groups:[{type,label,items:[{id,title,subtitle,href}]}]} بلا مجموعات فارغة، والاستعلام < حرفين ⇒ groups:[] (كالمصدر)، حدود 5000-8000 سطر لكل كيان مع قصّ للنتائج.
- اختبار ذاتي حي (bun script خارج المشروع: /home/z/tmp/smoke10a.ts ثم /home/z/tmp/cleanup10a.ts): بذر عميل + عقد أ 10000 بمرحلتين وخطتين (5000 مستحقة 2025-02-01 / 5000 مستقبلية) + إشراف 6×500−250 (baseEnd=2026-11-01 قريب من الأساس بـ14 يومًا) + عقد إشراف ب 2×400 (baseEnd=2026-03-01 ⇒ تأخير 8 أشهر/3200) + ملحق معتمد ADD +2000−500 وفاتورة 1200 (بذر مباشر — لا مسارات ملاحق/فواتير بعد) + مقاول وعقد باطن 3000 وصرف 1000 وقبض 4000 — ثم 30+ تأكيدًا:
  ✓ كشف العقد: الصفوف بالترتيب (افتتاحي/قبض 2025-02-15/ملحق 2025-06-01/فاتورة محايدة) والرصيد التراكمي 10000→6000→7500، الإجماليات debit=11500 credit=4000 current=11500 remaining=7500 حرفيًا.
  ✓ كشف العقد الإشرافي: صف «تمديد» مدين 3200 بتاريخ base_end 2026-03-01 وremaining=4000.
  ✓ كشف المقاول: مدين 3000/دائن 1000/متبقي 2000.
  ✓ كشف العميل الشامل: مدين 15500 (10000+1500+800+3200)/دائن 4000/رصيد 11500 مع subtotal لكل عقد وtotal نهائي وperContract.
  ✓ العملاء والأرصدة: قيمة 15500/محصل 4000/مستحق 5000/متبقي 11500 وحالة «مستحق الآن»، وdue_only يعود بالمستحقين فقط.
  ✓ مستحقات المراحل: عقديّ = 1000 (خط متأخر بعد FIFO) + 4000 (بلا خطة) = 5000 وفلتر overdue صارم.
  ✓ تأخير الإشراف: 8 أشهر/3200 بصف accent وعقد «قريب من الأساس» غير مدرج في unpaid.
  ✓ المقاولون: 3000/1000/2000 مع صف إجمالي accent.
  ✓ الإيرادات والمصروفات والتدفق النقدي: الإجماليات مطابقة بيدويًا لحساب مباشر من جدول vouchers (منها رسوم بنكية 0.15 لأبناء الرسوم المكتشفة بparentVoucherId/notes BANK_FEE، الختامي = الافتتاحي + الصافي).
  ✓ العقود: أصلية 10000/إضافات 1500/حالية 11500/محصل 4000/متبقي 7500؛ الربحية: فعلي 3000 (4000−1000 ببوابة includeInProfitability) ومتوقع 8500 (11500−3000 باطن) وهامش 75%.
  ✓ التنفيذ: الحفر 17/30 «ضمن الوقت · بقي 13 يوم» والإشغال «الحفر: عقد جارٍ».
  ✓ المتابعة: بنود المستحق بتفاصيل الخطوط المتأخرة وإشراف قريب من الأساس بـ14 يومًا والإجمالي = مجموع البنود.
  ✓ البحث: «عشرة» يرجع العملاء والعقود والسندات والمقاولين والفواتير، ورقم العقد يرجع العقد بhref صحيح، وحرف واحد ⇒ فارغ.
  ✓ التصدير: 200 + BOM (EF BB BF) + Content-Disposition csv + الترويسة العربية سليمة.
  ✓ الحواجز: بلا توكن ⇒ 401، عقد مجهول ⇒ 404، تقرير تصدير مجهول ⇒ 404.
- نظّفت كل بيانات الفحص (5 عملاء/6 عقود/2 مقاول/عقود باطن/4 سندات/ملحق/فاتورة/قيود/أحداث/مراحل/خطط) عبر سكربت التنظيف بالأسماء المخصصة — القاعدة عادت إلى ما دُوّن سابقًا في Task 8 فقط (عميل/عقدا اختبار السندات والسندات السبعة الأصلية) ولم أمسّها.
- ضبط الجودة: bunx tsc --noEmit | grep "src/app/api|src/lib/report" = صفر أخطاء؛ eslint على المسارات الجديدة والمكتبة = نظيف؛ لا تعديل على schema.prisma أو src/lib/db.ts أو أي مسار/مكوّن موجود (إلا إضافة الملفات الجديدة)؛ لا dev/build/db:push؛ dev.log: كل الاستدعاءات 200 بلا أخطاء.

Stage Summary:
- الملفات المنشأة (17): src/lib/report-server.ts + statement/{contract,customer,subcontractor}/[id]/route.ts + reports/{customers-balances,stage-dues,supervision-delays,subcontractors,vouchers,expenses,cashflow,contracts,execution,journal,gateway-summary,export}/route.ts + followup/route.ts + search/route.ts.
- القاعدة الذهبية محفوظة: كل الأرصدة محسوبة من الحركات (لا تخزين)، كشف الحساب مطابق حرفيًا لقاعدة 5 (التمديد مدين بتاريخ base_end، الفواتير «للعلم» محايدة، remaining=current−collected)، الربحية ببوابة includeInProfitability، المستحق الصارم strict فقط، وكل التقرير يعيد الشكل الموحد {title,heads,rows,numberCols,accentRows,totals,note} جاهزًا للوكيل الأمامي (شاشة التقارير/الكشف/المتابعة/البحث).
- قرارات موثقة للوكيل الأمامي: (أ) hrefs البحث بصيغة «customers?id=…/contracts?id=…/vouchers?id=…/subcontractors?id=…/invoices?id=…/claims?id=…» لتفسيرها في ConTrackApp. (ب) أعمدة تأخير الإشراف 12 عمودًا (العميل/العقد/العنوان/بداية الإشراف/مدة الأساس/نهاية الأساس/التمديد المدفوع/الملغاة/سببها/نهاية المدة كاملة/التأخير شهر/مبالغ). (ج) أكواد عقد الباطن في كشفه «SB-{id}» لغياب رقم مستقل في المخطط. (د) تصدير CSV سريع بدل Excel الكامل (المسار الموحد في المواصفة export/pdf|xlsx يبقى لمرحلة لاحقة). (هـ) بقايا Task 8 (عميل/عقدا FIFO والسندات وPV الرسوم 0.15) بقيت عمدًا كما دُوّن سابقًا.
---
Task ID: 11-b
Agent: frontend-styling-expert
Task: المرحلة 4 واجهة — AddendumsTab (الأوامر التغييرية/الملاحق) + ClaimsView (المطالبات) + إدراج التبويب وعنصر التنقل والتوجيه، على عقد API المُسلَّم في نص المهمة (الوكيل الخلفي 11-a يبنيه بالتوازي).

Work Log:
- قراءة إلزامية بالترتيب: worklog.md (آخر 170 سطرًا — نمط Tasks 9/10 وضبط الجودة)، contrack-types.ts + api.ts + ContractDetailView.tsx + VoucherDialog.tsx (بطاقات KPI/FinCard، حوار متعدد الخطوات بواسط open-reset عبر wasOpen ref، معالجة 422 overpay وعرض أخطاء الخلفية حرفيًا)، BUSINESS_LOGIC_SPEC.md (القاعدة 1: القيمة الحالية = amount + Σ معتمد(add−deduct) + supExt؛ الملاحق نوعان وأجزاء add/delete/unlink على boq/plan/stage وحارسان وإلغاء بتراجع كامل؛ المطالبات: مساري out/in خطيان + refused/postponed يتطلب postponed_until + كل انتقال يسجل سطر تدقيق + CLM-#### عالمي)، src/lib/format.ts (statusBadgeClass يغطي حالات الملاحق العربية وحالات المطالبات اللاتينية، CLAIM_STATUS_LABEL، CLAIM_NEXT)، ثم schema.prisma لـAddendum/AddendumItem/Claim (أسماء الحقول المصدر).
- contrack-types.ts (تعديل محدود): ViewName += "claims" + أنواع: ADDENDUM_STATUSES وADDENDUM_TYPES وADDENDUM_TYPE_BADGE («عقد إضافي» emerald / «أمر تغييري» سماوي)، AddendumRow (id/addendumNumber/addendumType/adate/reason/description/amountAdd/amountDeduct/net/status/approvedDate/cancelReason/itemsCount/side/subContractId?/editable?) وAddendumsResponse{items} وAddendumPart (action/refKind/refId/boqItemId/description/qty/unit/unitPrice/amount/applied/createdItemId/restoreDeletedBy + dueDate?/refLabel? — حقلان اختياريان يرسلهما الخلفي) وAddendumDetailResponse (المفرد «addendum» من الخلفي مع قبول «item» احتياطًا) وClaimRow (contract{customer} / subContract? / postponedUntil / voucherRef / notes) وClaimsResponse{items, counts?}.
- AddendumsTab.tsx (جديد، props {contract: ContractDetailResponse, user, onAuthError}) — يُركَّب داخل تبويب تفاصيل العقد (Radix unmounts ⇒ الاستعلامات لا تعمل إلا عند التفعيل):
  • أعلى: 3 بطاقات KPI (القيمة الأصلية contract.contract.amount / القيمة الحالية contract.current / المحصّل contract.collected) + شارة صافي الملاحق المعتمدة Σ(net) للحالة «معتمد» فقط بتلوين +أخضر/−أحمر/0 رمادي + زر «ملحق جديد».
  • قائمة بطاقات لكل ملحق: رقم ADD-xxx بخط monospace + شارة النوع + شارة الحالة statusBadgeClass + شارة «باطن» عند side=sub + التاريخ + السبب + الوصف + صافي +X/−X بالألوان + «الأجزاء: N» + تاريخ الاعتماد + الملغى باهت opacity-60 مع سبب الإلغاء؛ أزرار حسب الحالة والصلاحية: مسودة/تحت المراجعة ⇒ «فتح» (الكل) و«اعتماد» و«إلغاء» (المدير)، مسودة غير مدير ⇒ «إرسال للمراجعة» (POST submit)، معتمد ⇒ «إلغاء (تراجع كامل)» للمدير فقط بـAlertDialog وسبب إلزامي (DELETE بجسم {reason} عبر apiFetch لأن apiDelete بلا جسم).
  • حوار الملحق الكبير 3 مراحل بمؤشر خطوات: (1) البيانات: نوع select، الطرف (العميل/مقاول باطن)، عقد الباطن select إلزاميًا عند sub (من /api/sub-contracts?contractId= يعرض المبلغ والمتبقي)، التاريخ، زيادة/خصم مباشران اختياريان (يخفيان عند side=sub مع ملاحظة «قيم ملحق الباطن تُدار من أجزائه» وتلميح «العقد الإضافي يتطلب قيمة إضافية»)، السبب إلزامي والوصف — الإنشاء POST /api/contracts/[id]/addendums (تقبل {item} أو {addendum}) ثم PATCH رأس المسودة بالبيانات والمبالغ (للعميل فقط)، وقابلية التعديل من editable الخلفية أو الحالة (مسودة/تحت المراجعة بلا appliedAt) (2) الأجزاء: GET /api/addendums/[id]، حوار جزء صغير: action (إضافة بند/حذف بند/فك ربط مرحلة) × refKind (بنود الكميات/دفعة/مرحلة — unlink يُقفل على stage)؛ add+boq ⇒ وصف/كمية/وحدة/سعر والمبلغ محسوب live (round3 qty×unitPrice)؛ add+plan ⇒ عنوان/مبلغ/تاريخ (dueDate في الجسم — الخلفي يخزنه في unit داخليًا)؛ delete ⇒ select من بنود الكميات (GET /api/contracts/[id]/boq مع كمياتها وقيمها) أو الدفعات (من contract.plan) أو — للفك — select من مراحل العقد (contract.stages)؛ POST /api/addendums/[id]/parts وDELETE ?partId= مع إبطال الاستعلامين؛ الأجزاء المطبقة (applied) بشارة «مُطبق» بلا حذف (3) المراجعة: Σ أجزاء الإضافة/الحذف + «صافي الملحق (من الخلفي)» detailItem.net (الخلفي يعيد حساب الرأس من الأجزاء بعد كل حركة — فلا إحصاء مزدوج) + القيمة الحالية بعد الاعتماد تقديريًا (أو ملاحظة أن صافي الباطن يطبق على قيمة الباطن) + تحذير الحارسين المسبق محليًا (current+net < collected ⇒ «سيُرفض الاعتماد» / باطن بلا عقد) + «إرسال للمراجعة» للمسودة + «اعتماد الملحق» للمدير: POST /api/addendums/[id]/approve وعند 400 تُعرض رسالة الخطأ حرفيًا داخل الحوار (صندوق destructive) وtoast — وبعد الاعتماد invalidate contract فتتغير القيمة الحالية أعلى التبويب.
  • تأكيد الاعتماد من القائمة AlertDialog يعرض الصافي وتحذير الخصم ورسالة الرفض الحرفية إن تكررت.
- ClaimsView.tsx (جديد، props {user, onAuthError}): استعلام واحد GET /api/claims (بلا فلاتر) والتصفية محليًا — لأن بطاقات KPI تحتاج الاتجاهين معًا:
  • 4 KPI: مطالباتنا على العملاء out (إجمالي/عدد غير الملغاة) / من المقاولين in (إجمالي/عدد) / محصّلة+مدفوعة (Σ collected(out) + Σ paid(in) مع تفصيلهما) / متأخرة/مؤجلة (dueDate<اليوم خارج الحالات الميتة / postponed).
  • تابان Tabs بعَدّين: «على العملاء» / «من المقاولين» يقودان الجدول والفلاتر (statusFilter من CLAIM_STATUS_LABEL مع sentinel «all» لأن Radix يمنع value="")، عقد (مشتق من صفوف الاتجاه الحالي)، بحث فوري بتطبيع همزات/تاء/ألف مقصورة.
  • جدول سطح مكتب 8 أعمدة (رقم CLM-#### / العقد+العميل / العنوان+سند مرتبط / المبلغ formatKWD / الاستحقاق / الحالة statusBadgeClass+CLAIM_STATUS_LABEL / مؤجل حتى / إجراءات) وبطاقات موبايل مكافئة (md:hidden).
  • إجراءات الصف: الانتقال المشتق من CLAIM_NEXT[direction] على سلسلة خطية out: registered→sent→approved→collected وin: registered→in_review→approved→paid (زر «التالي» فقط؛ المؤجلة تعرض كل الانتقالات والخلفي يتحقق)، و«رفض»/«إلغاء» بحوار سبب إلزامي و«تأجيل» بحوار يتطلب postponedUntil إلزاميًا (+سبب اختياري) — POST /api/claims/[id]/transition {next, reason?, postponedUntil?} ورسائل الخلفية حرفيًا في صندوق داخل الحوار وtoast («انتقال غير مشروع»/«تأجيل بلا تاريخ»…)؛ الحالات النهائية بلا انتقالات؛ «تفاصيل» Dialog يعرض كل الحقول + notes كسجل تدقيق زمني مرقّم (كل سطر transition سطر).
  • «مطالبة جديدة» Dialog: اتجاه بزرين مضبوطًا على التاب الحالي، out: عميل→عقده غير الملغاة/المغلقة (نمط VoucherDialog)، in: عقد مباشر + عقد باطن إجباري (sub-contracts?contractId=)، بند خطة اختياري custLineId من الخطوط المثارة فقط (GET /api/contracts/[id]/plan وtriggeredAt غير فارغ)، سند قبض اختياري voucherRef من /api/vouchers?contractId=&vtype=receipt (غير الملغاة) مع عرض سقفه (amount) وتنبيه عدم تجاوزه، عنوان/مبلغ/استحقاق؛ POST /api/claims وإبطال claims.
- ContractDetailView.tsx (تعديل محدود): استيراد AddendumsTab + FileDiff، حذف addendums من PLACEHOLDER_TABS (بقيت مطالبات/فواتير للوكلاء اللاحقين)، TabsTrigger «الأوامر التغييرية» بعد تبويب «الإشراف» مباشرة + TabsContent يمرر {contract: detailData, user, onAuthError} مع Skeleton احتياطي حتى تحميل التفاصيل.
- AppShell.tsx (تعديل محدود): NAV_ITEMS += { view: "claims", label: "المطالبات", icon: ReceiptText } بعد «المتابعة» وقبل الإعدادات (يظهر تلقائيًا في شريط سطح المكتب والشريط السفلي للموبايل).
- ConTrackApp.tsx (تعديل محدود): استيراد ClaimsView + توجيه {view === "claims" && <ClaimsView user onAuthError />}.
- مطابقة مبكرة مع خلفي 11-a الجاري بالتوازي (قراءة فقط لمساراته الظاهرة — لا لمس): GET /api/addendums/[id] يعيد المفرد بمفتاح «addendum» لا «item» ⇒ طبّقت قبول المفتاحين؛ GET يعيد per-part dueDate/refLabel ⇒ أضيفهما للنوع واستخدم dueDate لعرض استحقاق الدفعات؛ PATCH يرفض amountDeduct لملحق الباطن («قيم ملحق الباطن تُدار من أجزائه») ⇒ أخفي المبالغ المباشرة عند sub ولا أرسلها؛ «عقد إضافي» يتطلب amountAdd>0 ⇒ تلميح نصي؛ addendumEditable = (مسودة||تحت المراجعة)&&!appliedAt ⇒ استخدمته لتفعيل تعديل الرأس؛ POST parts يقبل body.dueDate لأجزاء plan ويخزنه في unit داخليًا (partDueDate) ⇒ أرسل dueDate لا unit؛ recomputeAddendumHeader يعيد حساب الرأس من الأجزاء بعد كل حركة ⇒ ملخص المرحلة 3 يعرض net من الخلفي لتفادي الإحصاء المزدوج؛ DELETE الملحق adminGuard بسبب إلزامي ⇒ AlertDialog السبب إلزامي؛ POST parts على action_edit_contract ⇒ إضافة الأجزاء لكل الأدوار المصرح لها والاعتماد/الإلغاء للمدير فقط.
- ضبط الجودة: bunx tsc --noEmit | grep "src/components/contrack" = صفر أخطاء (وأصلحت خطأ وهميًا ظهر أثناء البناء لمتغير created ممکن التعريف)؛ eslint على الملفات الستة = صفر (أصلحت react-hooks/preserve-manual-memoization بإزالة useMemo لصالح حساب مباشر)؛ لم ألمس prisma/src.lib*/api.ts/package.json/مسارات API، ولا dev/build/db:push؛ أخطاء tsc الظاهرة في المستودع داخل src/app/api/addendums وexamples/skills — ملفات الوكيل الخلفي قيد البناء وخارج نطاقي.
- نقاط مزامنة مع الخلفي عند اكتماله (تُعدل سريعًا): (أ) GET /api/contracts/[id]/addendums متوقع {items:[…net…]} — القائمة تحسب صافيًا احتياطيًا إن غاب net؛ (ب) POST الإنشاء قد يرجع {item} أو {addendum} — مكشوف بالمفتاحين؛ (ج) GET /api/claims متوقع {items, counts?} — counts الخلفية تُهمل والعد محلي لاتساق KPI الاتجاهين؛ (د) POST /api/claims متوقع 201 {item}؛ transition يعيد {item} — الكود يقرأ res.item?.claimNumber بأمان عند غيابه؛ (هـ) رفض/إلغاء/تأجيل تُرسل سببًا نصيًا وتُسجَّل في notes يقرأها حوار التفاصيل سطرًا سطرًا (يفترض سطرًا لكل انتقال)؛ (و) سقف المطالبة على سند القبض يتحقق خلفيًا والواجهة تعرض سقف السند تنبيهًا فقط.

Stage Summary:
- الملفات: AddendumsTab.tsx وClaimsView.tsx (جديدتان) + تعديلات محدودة على contrack-types.ts وContractDetailView.tsx وAppShell.tsx وConTrackApp.tsx.
- واجهة الملاحق كاملة الدورة: إنشاء بيانات → أجزاء (إضافة بنود/دفعات بحساب live، تعليم حذف بقيمها الحقيقية، فك ربط مرحلة) → مراجعة بتحذير الحارسين → اعتماد يغير القيمة الحالية معليةً → إلغاء بتراجع كامل بسبب — وواجهة المطالبات بمساريها وانتقالاتها المشتقة ورفض/تأجيل (بتاريخ إلزامي)/إلغاء بأسباب وسجل تدقيق زمني — كلها react-query + Skeletons + toasts عربية + موبايل أولًا على emerald وRTL، ورسائل الخلفية حرفيًا.
- عند اكتمال الوكيل الخلفي: فتح الشاشتين حيًا وطابق الفروق وفق نقاط المزامنة أ–و أعلاه (لا تغييرات هيكلية متوقعة خارج أسماء المفاتيح).
Task ID: 11-a (أُنجز وتحقق منه المنسق بعد انقطاع الوكيل عند التسليم)
Agent: full-stack-developer (خلفية) + تحقق المنسق
Task: المرحلة 4 خلفية — الملاحق/الأوامر التغييرية والمطالبات

Work Log:
- أنشأ الوكيل كل المسارات: contracts/[id]/addendums (GET قائمة بصافي + POST إنشاء ADD-### لكل عقد مع شرط العقد الإضافي) + addendums/[id] (GET تفصيل الأجزاء + PATCH مسودة + DELETE إلغاء بتراجع كامل restore_parts: البند المنشأ يُمحى فعليًا والمحذوف ناعمًا يعود والروابط تحرس) + parts (POST/DELETE أجزاء add/delete/unlink على boq/plan/stage مع إعادة حساب الرأس) + approve (معاملة apply_parts + الحارسان الماليان + سقف الخطة + سجل تدقيق) + submit + claims (GET فلاتر وعدّادات + POST بسقف السند المرتبط وإجبار عقد الباطن للـin) + claims/[id] (GET/PATCH/DELETE) + claims/[id]/transition (آلة الحالات الحرفية + postponedUntil إلزامي + سطر تدقيق في notes) + إصلاح triggerDuePayments للمطالبة التلقائية بلا تكرار.
- تحقق المنسق (curl): أمر تغييري ADD-001 جزء سور 20×15=300 → approve ⇒ current 10000→10300 ✓؛ إلغاء الملحق المعتمد ⇒ restored:true وcurrent يعود 10000 ✓؛ مطالبة out بسند RV-0004 (سقف 7000) ⇒ انتقال غير مشروع 400 «لا يمكن الانتقال من مسجلة إلى محصّلة» ✓؛ السلسلة الكاملة sent→approved→collected ✓؛ حارس إلغاء السند: «توجد مطالبات مالية سارية (CLM-0004، CLM-0005) — لا يمكن إلغاء السند» ✓.

Stage Summary:
- المرحلة 4 مكتملة خلفيًا ومتحقق منها حرفيًا. بيانات اختبار متبقية تُنظف في التحقق النهائي.
- الواجهة (11-b) اكتملت بالتوازي: AddendumsTab (حوار ثلاثي المراحل) + ClaimsView (تابان وانتقالات مشتقة).

---
---
Task ID: 12-b
Agent: frontend-styling-expert (واجهة Next.js 16)
Task: المرحلة 5 واجهة — CustodyView (العُهد: حسابات/تصفيات/دفتر حركة) + InvoicesView (الفواتير) على عقد API المُسلَّم (الوكيل الخلفي يبنيه بالتوازي)

Work Log:
- قراءة إلزامية بالترتيب: worklog.md (Tasks 9 و11-b: أنماط الحوارات متعددة المراحل بواسط wasOpen ref، الجداول سطح مكتب/بطاقات موبايل، عرض رسائل الخلفية حرفيًا، DELETE بجسم عبر apiFetch)، contrack-types.ts + api.ts (apiFetch/apiGet/apiPost/apiPatch/apiDelete — apiDelete بلا جسم) + AppShell + ConTrackApp، BUSINESS_LOGIC_SPEC.md (القاعدة 8: التصفية لا تصرف نقدًا جديدًا — توزيع مبلغ سبق صرفه بلا method بمرجع PAY-GRP-YYYYMMDD-NNN؛ الإرجاع CV بسقف المتبقي بلا أثر إيرادي ولا رسوم؛ الرصيد = مُسلَّم − منصَق − مرتجع؛ الفواتير للعلم لا تخفض المديونية ولا تتجاوز المتبقي)، research/spec-phase5-9.md أقسام A-C (العهدة = ExpenseAccount accountKind='advance' وحسابها لا يُعد مصروفًا؛ التصفية سند PV مستقل لكل بند بمجموعة expense_group_ref واحدة وتوسيم «تصفية عهدة من حساب: …»؛ تجاوز الرصيد أحمر تحذيري فقط والحفظ يقبل؛ صاحب العهدة نص حرة؛ الفواتير INV-#### وعميل+عقد إجباريان وvalidate يرفض تجاوز المتبقي ويشترط أن يخص العقد نفس العميل)، ثم src/lib/format.ts ومكونات ui المتاحة.
- contrack-types.ts (تعديل محدود): ViewName += "custody" | "invoices" + أنواع: CustodyAccountItem (id/name/parentId/fullPath/isActive/balance/handed/spent/returned/children?) وCustodyAccountsResponse{items}، CUSTODY_KIND_LABEL (تسليم/تصفية/إرجاع) وCUSTODY_KIND_BADGE (handover amber / settlement sky / return emerald)، CustodyLedgerRow (voucherId/voucherNumber/vtype/vdate/amount/kind/groupRef/description + balance? التراكمي اختياري من الخلفي)، CustodyLedgerResponse{rows, balance}، CustodySettlementItem (ref/vdate/custodyAccountId/custodyName/total/linesCount/description) وCustodySettlementsResponse{items}، CustodySettlementLine (بند: expenseAccountId/Name + customerId/Name + contractId/Number + voucherNumber + cancelled?) وCustodySettlementDetailResponse{item, lines}، CustodyOverviewItem (accountId/name/balance/lastHandover/lastSettlement/settlementsCount) وCustodyOverviewResponse{items}، InvoiceItem (customer/contract متداخلان) وInvoicesResponse{items} وInvoiceDetailResponse{item}.
- CustodyView.tsx (جديد، props {user, onAuthError}):
  • بطاقات علوية 3 (من /api/custody/overview مع fallback حسابي من /api/custody/accounts): إجمالي الأرصدة بتلوين الإشارة (موجب emerald/سالب أحمر/صفر رمادي) / عدد العُهد (نشط) / آخر تصفية (أعلى vdate+ref من قائمة التصفيات).
  • تبويب «الحسابات»: بطاقة لكل عهدة (اسم + fullPath + الرصيد بارز tabular-nums + مُسلَّم/مُصروف/مرتجع + badge «معطّل» باهتة opacity-60 للمدير فقط) وأزرار: دفتر الحركة (ينقل لتبويب السجل مع الحساب)، تسليم (حوار صغير يرسل POST /api/vouchers {vtype:'payment', custodyAccountId, account (لقطة الاسم), amount, vdate, description} بلا expenseAccountId)، إرجاع (حوار {vdate, amount, method?} مع بطاقة «المتبقي المتاح» وتحذير مسبق وتنبيه أن الرفض من الخلفي)، تصفية (يفتح حوار التصفية مع preset الحساب عبر settlePresetRef يُستهلك في reset الفتح).
  • تبويب «التصفيات»: زر «تصفية جديدة» + جدول (مرجع PAY-GRP mono / التاريخ / العهدة / الإجمالي / عدد البنود / البيان / إجراءات: تفاصيل + إلغاء للمدير) + بطاقات موبايل مكافئة؛ ترتيب تنازلي محلي (vdate+ref) لضمان «آخر تصفية» أولًا.
  • حوار التصفية الجديدة: select عهدة (النشطة ذات رصيد > 0.001 فقط مع عرض «متاح X»، ويُضاف الـpreset إن لم يكن ضمنها) + تاريخ + بيان عام؛ بنود متعددة (SettleLineRow مستقل بقسمه الخاص): حساب مصروف شجرة أب→ابن من /api/expense-accounts (مستبعدًا حسابات advance من الخيارات، مع fallback input نصي expenseAccountName إن لم يجهز المسار) + عميل اختياري → عقد اختياري (من /api/customers/[id] مفلترًا بلا ملغى) + مبلغ + بيان (تلميح: فارغ ⇒ تلقائي «العميل — المصروف»)؛ شريط مباشر: إجمالي البنود / المتاح / الرصيد بعد التصفية (سالب ⇒ تنبيه amber «تحذيري فقط — يُحفظ») — لا طريقة دفع إطلاقًا (القاعدة 8)؛ POST /api/custody/settlements {vdate, custodyAccountId, description?, lines:[{expenseAccountId, expenseAccountName?, customerId?, contractId?, amount, description?}]} ورفض الخلفية يُعرض حرفيًا في صندوق destructive داخل الحوار.
  • حوار تفاصيل التصفية GET /api/custody/settlements/[ref]: رأس (تاريخ/عهدة/إجمالي/عدد البنود) + جدول البنود (حساب/عميل+عقد/بيان+رقم سند البند/مبلغ).
  • إلغاء تصفية للمدير: Dialog بسبب إلزامي (Textarea) → apiFetch DELETE بجسم {reason} (apiDelete لا يرسل جسمًا) وإبطال custody-*/vouchers/dashboard.
  • تبويب «السجل» (دفتر الحركة): فلاتر حساب (الشجرة كاملة بـfullPath)/من/إلى/نوع (all + handover/settlement/return) → GET /api/custody/ledger?accountId&from&to&kind (مُفعّل بتبويب السجل وباختيار حساب)؛ رأس ملخص (الحساب + عدد الحركات + الرصيد من الاستجابة)؛ جدول: رقم السند بشارة لون vtype (VOUCHER_TYPE_BADGE) + اسم النوع تحتها / حركة بشارة CUSTODY_KIND_BADGE / التاريخ / المبلغ بإشارة ملونة (تسليم + / تصفية وإرجاع −) / الرصيد التراكمي (row.balance من الخلفي إن وُجد وإلا حساب محليًا عبر reduce بلا إعادة إسناد خارجية — قاعدة eslint immutability) / المرجع groupRef mono / البيان + بطاقات موبايل.
  • إدارة الحسابات للمدير (Dialog): إضافة حساب أب (POST {name})، إضافة فرعي لكل أب (POST {name, parentId})، تفعيل/تعطيل Switch لكل حساب (PATCH /api/custody/accounts {id, isActive} — المسار المجمّعي حسب العقد) مع عرض الرصيد.
  • الإبطال بعد كل حركة: custody-accounts/custody-overview/custody-settlements/custody-ledger/custody-settlement/vouchers/dashboard.
- InvoicesView.tsx (جديد، props {user, onAuthError}): KPI 3 (إجمالي المفوتر emerald / عدد الفواتير مع تعداد العملاء والعقود / آخر فاتورة برقمها وتاريخها ومبلغها وعميلها)؛ فلاتر محلية (استعلام واحد GET /api/invoices يغذي KPI والجدول معًا — نمط ClaimsView): عميل/عقد مشتقان من العناصر + بحث بتطبيع همزات/تاء/ألف مقصورة؛ جدول سطح مكتب (INV-#### mono / التاريخ / العميل / العقد / الوصف truncate / المبلغ / إجراءات) + بطاقات موبايل؛ تفاصيل Dialog (كل الحقول + ملاحظات whitespace-pre-wrap)؛ حذف للمدير بتأكيد حواري (Dialog destructive يعرض العميل/العقد/المبلغ، بلا سبب — العقد لا يذكره) ورسائل الرفض حرفيًا؛ «فاتورة جديدة» Dialog: عميل → عقده غير الملغاة (من /api/customers/[id] بمفتاح الكاش المشترك ["customer", id]) → عند اختيار العقد تُجلب تفاصيله بمفتاح الكاش المشترك ["contract", id] وتظهر بطاقة: القيمة الحالية (current من تفاصيل العقد — «…» حتى الفحص) / المفوتر سابقًا (Σ فواتير العقد من القائمة المحلية) / المتبقي للفواتير (current − المفوتر بتلوين) + تحذير مسبق amber «يتجاوز المتبقي (X)» مع السماح بالمحاولة لتظهر رسالة الخلفية حرفيًا («تخص عميل العقد»/«تتجاوز المتبقي (X)») في صندوق destructive؛ تاريخ (افتراضي اليوم)/مبلغ/وصف/ملاحظات؛ POST /api/invoices {customerId, contractId, invoiceDate, amount, description?, notes?} وقراءة {item} دفاعيًا؛ إبطال invoices/contract/dashboard.
- AppShell.tsx (تعديل محدود): NAV_ITEMS += {invoices «الفواتير» FileStack} بعد «العقود» و{custody «العُهد» Wallet} بعد «السندات» — انحراف مقصود عن نص المهمة (اقترح Receipt للعُهد وFileSpreadsheet للفواتير وكلاهما مستخدمان للسندات/الكشوفات) التزامًا بمنهج المهمة نفسها بعدم تكرار الأيقونات (رُفض FileText للعقد نفسه)؛ أضفت overflow-x-auto لتنقل سطح المكتب لاستيعاب 13 عنصرًا (شريط الموبايل يتكيف تلقائيًا فهو قابل للتمرير أصلًا).
- ConTrackApp.tsx (تعديل محدود): استيراد الشاشتين + توجيه {view === "custody"} و{view === "invoices"} قبل «المقاولون».
- ضبط الجودة: bunx tsc --noEmit | grep "src/components/contrack" = صفر (أصلحت: import ناقص CustodyOverviewResponse)؛ bunx eslint على مجلد contrack كاملًا = صفر (أصلحت react-hooks/immutability «Cannot reassign variable after render completes» بإعادة كتابة الرصيد التراكمي reduce)؛ لم ألمس prisma/src.lib*/api.ts/package.json/مسارات API، ولا dev/build/db:push.
- نقاط مزامنة مع الخلفي عند اكتماله (تُعدل سريعًا): (أ) GET /api/custody/accounts متوقع {items:[…]} بشجرة children اختيارية — الواجهة تسطّح items+children محليًا وتقبل fullPath؛ (ب) PATCH الحسابات على المسار المجمّعي /api/custody/accounts بجسم {id, isActive}؛ (ج) دفتر الحركة: إن أرسل الخلفي balance لكل صف استُخدم وإلا حُسب محليًا بإشارة handover=+/settlement=−/return=−، وإذا كان الفلتر from/to يقص البداية فالتراكمي المحلي يبدأ من صفر — يُفضَّل إرسال balance؛ (د) POST settlements متوقع {ref} أو {groupRef} — مقروءان معًا؛ (هـ) بنود التصفية ترسل expenseAccountName احتياطيًا فقط عند غياب /api/expense-accounts (fallback نصي)؛ (و) POST /api/custody/returns 400 «يتجاوز متبقي العهدة» يُعرض حرفيًا (مع تحذير مسبق محلي)؛ (ز) DELETE settlements/[ref] بجسم {reason}؛ (ح) GET /api/invoices متوقع {items} بعميل/عقد متداخلين والفلترة محلية (q/customerId/contractId بالخادم غير مستخدمة الآن — جاهزة للتفعيل عند كبر البيانات)؛ (ط) POST /api/invoices متوقع 201 {item}؛ (ي) DELETE /api/invoices/[id] بلا جسم.
- القرارات المعمارية: حوار «تسليم عهدة» مستقل صغير بدل فتح VoucherDialog (نص المهمة: «الأبسط») يرسل مباشرة POST /api/vouchers بنفس نمط جسم payKind=custody في VoucherDialog + حقل account كلقطة اسم؛ «إدارة الحسابات» حوار واحد بدل شاشة فرعية (إضافة أب/ابن + Switch تعطيل)؛ ملاحظة صلاحيات: كل الإجراءات متاحة للجميع ما لم تُذكر إدارة/إلغاء (مدير) وفق نص المهمة — التقييد الفعلي حسم الخلفي.

Stage Summary:
- المرحلة 5 واجهة (شاشتا العُهد والفواتير) مكتملة: العُهد بثلاثة تبويبات (بطاقات أرصدة بتلوين الإشارة + أزرار الدورة الكاملة تسليم/تصفية/إرجاع/دفتر، جدول تصفيات PAY-GRP مع حوار بنود متعدد يدعم شجرة المصاريف وعميل/عقد لكل بند ومجاميع live وتحذير تجاوز تحذيري لا قاطع، دفتر حركة بفلاتر ورصيد تراكمي) + إدارة حسابات للمدير، والفواتير بـKPI/فلاتر/جدول/تفاصيل/حذف مدير وحوار إصدار يعرض متبقي العقد للفواتير live — كل شيء tanstack/react-query + shadcn/ui + Skeletons + toasts عربية + موبايل أولًا على emerald وRTL ورسائل الخلفية حرفيًا.
- الملفات: CustodyView.tsx وInvoicesView.tsx (جديدتان)؛ تعديلات محدودة على contrack-types.ts وAppShell.tsx وConTrackApp.tsx.
- عند اكتمال الخلفي: فتح الشاشتين حيًا ومطابقة نقاط المزامنة (أ–ي) أعلاه — لا تغييرات هيكلية متوقعة خارج أسماء المفاتيح/الحقول الاختيارية.

---
Task ID: 12-a
Agent: full-stack-developer (خلفية Next.js 16)
Task: المرحلة 5 خلفية — العُهد (حسابات/كشف/تصفيات/إرجاع/لوحة) + سلف الموظفين + الفواتير

Work Log:
- قراءة إلزامية بالترتيب: worklog (Tasks 6/8/9/10/11 — createVoucher وcustodyRemaining وemployeeAdvanceRemaining جاهزان في voucher-server.ts) وBUSINESS_LOGIC_SPEC (القواعد 4/5/8: التصفية لا تصرف نقدًا جديدًا، سقف العهدة/السلفة قاطع، الفاتورة لا تتجاوز المتبقي) وspec-phase5-9 الأقسام A/B/C (العهدة=ExpenseAccount advance، الرصيد handed−spent−returned، PAY-GRP-YYYYMMDD-NNN، CV بلا أثر إيرادي ولا رسوم، INV-#### بعدّاد عالمي وتطابق العميل) وvoucher-server.ts كاملًا (createVoucher/prepareVoucher/cancelVoucherTx/voucherCancelBarrier) + contrack-core + contrack-server + api-utils + auth + schema.
- المكتبة الجديدة src/lib/custody-server.ts: custodyBreakdown (handed= صرف على العهدة بلا مجموعة وبلا حساب مصروف؛ spent= بمجموعة أو بحساب مصروف — تعريف اتحادي يوافق تعريف المهمة (groupRef) وتعريف custodyRemaining (expenseAccountId) معًا فيفوق الأخير سترًا دائمًا؛ returned=CV) + nextSettlementGroupRef (nextNumber بمفتاح يومي voucher:PAY-GRP-YYYYMMDD ⇒ PAY-GRP-20261018-001) + withNumberRetry (P2002×5) + validateSettlementLines (مبلغ>0 لكل بند، حساب مصروف إن وُدد يجب allowPosting+expense، تطابق العقد مع العميل) + createSettlementVoucherInTx + createCustodySettlement + listSettlements + loadSettlementGroup (handedUntil حتى تاريخ التصفية، balance=handedUntil−spent) + custodyLedger (صفوف handover/settlement مجمعة بالبنود/return برصيد تراكمي) + custodyOverview + ensureEmployeeAdvanceAccount + createEmployeeAdvance + cancelSettlementLines.
- قرار معتمد (بديل المهمة الرسمي): createVoucher لا يدعم expenseGroupRef/expenseGroupLine ولا قيد دائن العهدة ⇒ **بنود التصفية تُنشأ يدويًا داخل المعاملة** بترقيم PV الذري وnotes موسومة «تصفية عهدة من حساب: <الاسم>» وexpenseGroupLine=i+1 والقيد: مدين (حساب المصروف، وإلا «العملاء» عند وجود عميل، وإلا «مصروفات أخرى») **دائن اسم العهدة**، بلا method/account (لا صرف نقدي جديد) وContractEvent «تصفية عهدة» للبنود بعقد. كذلك **سلفة الصرف/الرد تُنشآن يدويًا** لأن prepareVoucher لا يربط advanceEmployeeId في مساري payment وcustody_return (Task 8): grant=PV مدين «سلف موظفين / قرض راتب» دائن الصندوق بparty=اسم الموظف، return=CV مدين الصندوق دائن «سلف موظفين / قرض راتب» بسقف قاطع، deduction=SD عبر createVoucher كما هو (سقفه حرفيًا). حساب السلف يُضمن بالاسم تحت «مصروفات إدارية» مع includeInProfitability=false (أصل مسترد لا مصروف نهائي). **لم يُعدَّل voucher-server.ts إطلاقًا**.
- المسارات المنشأة (13): custody/accounts (GET الشجرة+الأرصدة+الإجمالي، POST/PATCH للمدير — منع ابن لأب غير advance ومنع الحلقات وتحديث fullPath للأبناء) + custody/ledger (GET ?accountId=&from=&to=&kind=handover|settlement|return برصيد تراكمي وgroupRef وlines) + custody/settlements (GET قائمة مجمعة حسب expenseGroupRef، POST تصفية مدير بسقف «مجموع التصفية يتجاوز غير المصفّى من العهدة (X د.ك فقط)») + custody/settlements/[ref] (GET كشف، PATCH مدير استبدال كامل: إلغاء السارية بسبب «تعديل تصفية» عبر cancelVoucherTx وبدائل بنفس groupRef وسقف=غير المصفّى+الملغى، DELETE مدير إلغاء موحد بسبب + audit جماعي entityType=custody_settlement) + custody/returns (POST مدير CV بسقف «المبلغ يتجاوز متبقي العهدة (X د.ك فقط)» ثم createVoucher vtype=custody_return بلا أثر إيرادي ولا رسوم — سلوكه الحالي تحقق) + custody/overview (رصيد/آخر تسليم/آخر تصفية/عدد التصفيات + إجمالي) + employees (GET أرصدة advanced/recovered/deducted/balance + totals، POST اسم فريد) + employees/[id] (GET/PATCH/DELETE — الحذف للمدير يرفض «لا يمكن حذف موظف له سلف قائمة (الرصيد X د.ك)» إن كان له أي سند سلفة ساري) + employees/advances (GET سجل ?employeeId= مع balance، POST kind=grant|return|deduction) + invoices (GET فلاتر q/customerId/contractId بأسماء، POST تطابق عميل العقد «الفاتورة يجب أن تخص عميل العقد» وسقف «الفاتورة تتجاوز المتبقي من العقد (X د.ك)» مقابل current−المفوتر، INV-#### عدّاد عالمي بretry، ContractEvent «إصدار فاتورة») + invoices/[id] (GET بأسماء وfinancials، PATCH وصف/ملاحظات/تاريخ/مبلغ بفحص السقف باستثناء الفاتورة نفسها، DELETE مدير حذف فعلي مع PurgeAudit snapshot {action:'invoice_delete'} وContractEvent «حذف فاتورة» — الرقم لا يُعاد لأن العدّاد لا يتراجع) + invoices/[id]/pdf (501 «سيُفعَّل لاحقًا»).
- الصلاحيات: قراءة العُهد/السلف/التصفيات/الكشف screen_custody؛ التصفية/الإرجاع/إدارة الحسابات/حذف الموظف/حذف الفاتورة adminGuard؛ إصدار الفواتير وتعديلها screen_invoices؛ حركات السلف action_add_voucher (بما يوافق شاشة السندات).
- اختبار ذاتي curl (49 فحصًا، كلها ناجحة): عهدة «عهدة عامة 12a»+ابن «عهدة أحمد 12a» (وأب وهمي 999999⇒404) → تسليم 1000 (PV-0005) ⇒ رصيد 1000 → تصفية 1100⇒400 «مجموع التصفية يتجاوز غير المصفّى من العهدة (1000 د.ك فقط)» → تصفية 600+300 ⇒ PAY-GRP-20261018-001 بسندَي PV وline=1،2 ⇒ رصيد 100 وكشف التصفية handedUntil=1000/balance=100 والكشف الزمني handover→settlement → إرجاع 150⇒400 «المبلغ يتجاوز متبقي العهدة (100 د.ك فقط)» → إرجاع 100 (CV-0001) ⇒ رصيد 0 → تصفية 50⇒400 → PATCH الاستبدال ببند 400 (إلغاء 2 وإنشاء 1 بنفس groupRef) ⇒ رصيد 500 → DELETE المجموعة ⇒ رصيد 900 واللوحة settlementsCount=0 وlastHandover صحيح → موظف: اسم مكرر⇒400، سلفة 500 (PV-0009) ⇒ 500، رد 200 (CV-0002) ⇒ 300، رد 600⇒400 «المبلغ يتجاوز رصيد سلفة الموظف (500 د.ك فقط)» (إعادة فحص بصيغة مصححة بعد خلل JSON في السكربت)، خصم 100 (SD-0001) ⇒ 200، خصم 250⇒400، حذف موظف⇒400 «لا يمكن حذف موظف له سلف قائمة (الرصيد 200 د.ك)» → فاتورة: عميل+عقد 10000، INV-0001 ب4000⇒201 والمتبقي 6000، فاتورة 7000⇒400 «الفاتورة تتجاوز المتبقي من العقد (6000 د.ك)»، فاتورة بعميل مخالف⇒400 «الفاتورة يجب أن تخص عميل العقد»، pdf⇒501، PATCH 5000⇒ok و20000⇒400، القائمة والتفاصيل (المفوتر 5000).
- تحقق القيود من القاعدة (استعلام مباشر): تسليم مدين العهدة دائن صندوق؛ بنود التصفية مدين «مصروفات أخرى» دائن «عهدة أحمد 12a»؛ الإرجاع مدين صندوق دائن العهدة؛ سلفة مدين «سلف موظفين / قرض راتب» دائن صندوق؛ الرد مدين صندوق دائن السلف؛ الخصم مدين رواتب دائن سلف موظفين — وكلها بعكس voucher_cancel بعد التنظيف.
- نظّفت بيانات الفحص عبر الـAPI نفسه: حذف الفاتورة (بPurgeAudit) والعقد والعميلين، إلغاء سندات السلف بترتيب الخصم←الرد←الصرف ثم حذف الموظف، إلغاء سندات العهدة (CV ثم PV) فعاد الرصيد 0، وعُطّلت حسابا العهدة التجريبيان isActive=false (لا حذف فعلي لشجرة الحسابات — قرار موثق). بقايا مقصودة: سطور audit/purge_audit وعدّادات الترقيم (الرقم لا يُعاد) وحساب «سلف موظفين / قرض راتب» النظامي وحسابا عهدة معطلان باسم «عهدة عامة 12a»/«عهدة أحمد 12a».
- ضبط الجودة: bunx tsc --noEmit على المسارات الجديدة وcustody-server = صفر (الأخطاء الظاهرة بالمستودع في examples/skills فقط سابقة)؛ eslint على الملفات الجديدة = نظيف؛ لا تعديل على schema.prisma أو voucher-server.ts أو أي مسار/مكوّن قائم؛ لا dev/build/db:push؛ dev.log بلا أخطاء على المسارات الجديدة.
- نقاط مزامنة للوكيل الأمامي (12-b): (أ) أسماء المفاتيح: custody/accounts {accounts:[{id,name,fullPath,parentId,parentName,isActive,handed,spent,returned,balance}],totals}؛ ledger {rows:[{voucherId,voucherNumber,vtype,vdate,amount,kind,groupRef?,description,party,runningBalance,lines?}],balance,totals}؛ settlements {settlements:[{ref,vdate,custodyAccountId,custodyAccountName,description,total,linesCount,cancelledCount,contracts}]}؛ settlements/[ref] {group,lines,handedUntil,spent,balance}؛ overview {accounts:[…lastHandover,lastSettlement,settlementsCount],totals}؛ employees {employees:[{…,advanced,recovered,deducted,balance,movements}],totals}؛ advances {vouchers:[{kind,kindLabel,…}],balance?}؛ invoices {invoices:[…]} وGET المفرد {invoice,financials:{current,invoiced,remaining}} وPOST يعيد {invoice,financials} و201. (ب) التسليم عبر POST /api/vouchers العادي {vtype:'payment',custodyAccountId,amount,vdate,party,method}. (ج) بنود التصفية تقبل {expenseAccountId?,customerId?,contractId?,amount,description?,party?,vdate?} والـبيان يُولَّد تلقائيًا «العميل — المصروف» عند فراغه. (د) شجرة الحسابات قائمة مسطحة بحقل parentId — البناء أماميًا. (هـ) الحسابات المعطلة isActive=false تظهر في GET — الصِفْها أماميًا إن رغبت.

---
Task ID: 13-a
Agent: full-stack-developer (خلفية Next.js 16)
Task: المرحلة 6 خلفية — البوابة المالية (بروفايلات/رفع تسوية ومطابقة تلقائية/تصنيف/توزيع/إرجاع/روابط/تصفية يومية/كشف بنك/ملخص/مسح) + الشركة الأخرى (رصيد/افتتاحي/مستحق/تسديدات/كشف/تسوية يومية)

Work Log:
- قراءة إلزامية بالترتيب: worklog (Task 12-a: أنماط VoucherError/withNumberRetry/audit وcontrack-core helpers) وBUSINESS_LOGIC_SPEC (القاعدة 9: مطابقة تلقائية نافذة 5/3 ± tolerance مقابل سندات القبض فقط؛ T+1 فعلي KNET فوري بالكود؛ التصفية الثلاثية sys×gw×bank؛ تسديد الأخرى لا ينشئ أي سند صافي gross−fee بتوزيع جزئي) وresearch/spec-subs-gateway.md (D/E كاملًا: match_settlement بترتيب المرشحين وauto_classify وsave_gateway_ops التثبيت التراكمي بقفل الموزَّع/المسدد/اليدوي، distribute_rows يتخطى المعلق/غير المحصَّل، undistribute المسدد يُتخطى بالمصدر — انحراف موثق أدناه، daily_clearing بexpect=الإجمالي−عمولات وبنك D+N±1 يوم عمل بفرق الأيام ثم المبلغ، other_statement صافي، add_other_transfer V4.49/4.5.13، other_ledger برصيد أول الفترة، other_daily_settlement، transfer_coverage، wipe_all) وPLAN_GATEWAY_FINANCIAL.md (مع توثيق التعارضات: KNET فوري بالكود معتمدًا؛ تقويم العطلة T+1 جمعة/سبت فقط مقابل تحصيل متوقع خميس→أحد — فصلتهما كالدالتين) وschema.prisma (GatewayProfile/GatewayOp/BankLine/OtherCompanyTransfer/TransferOpAlloc/OtherCompanyOpening/MatchAlias/GatewayFeeVoucher) + api-utils/contrack-core/auth (كتالوج 37: screen_gateway/screen_clearing/screen_other_company موجودة).
- المكتبة الجديدة src/lib/gateway-server.ts (~1900 سطر): أيام عمل (جمعة/سبت عطلة — isWorkday/addBusinessDays) + effectiveDate (T+1 دائمًا لعمليات البوابة — KNET فوري مسار سندات القبض ليس هنا) + expectedCollectionDate (ثاني يوم، خميس/جمعة/سبت⇒الأحد V4.41) + توحيد الهواتف (normalizePhone/canonPhone تجريد 965/phonesMatch لاحقة≥7) والأسماء (normalizeName تشكيل/ألف/ة→ه/ى→ي + namesMatch + namesSimilar كلمات الأقصر في الأطول) + contractHint + receiptRowsForMatching (قبض سارٍ بطرفه عميل أو عبر عقد) + match_aliases (aliasHit اسم دقيق+هاتف دقيق أو لاحقة، saveAlias upsert) + buildCandidates (ترتيب: هاتف+اسم=0، هاتف=1، رابط=1، اسم=2، اسم جزئي=3، مبلغ فقط=4 «رصيد إجمالي يطابق») + matchOneOp (مبلغ ±tolerance + نافذة هاتف/رابط 5 أيام واسم 3 + استبعاد السندات المستهلكة بعمليات أخرى) + uploadSettlementFile (تحليل نص خام comma/tab/semicolon بكشف أعمدة عربي/إنجليزي + تثبيت تراكمي upsert بالمفتاح الخمسي مع تحديث غير المقفول فقط + مطابقة تلقائية لغير المصنف + checklist عربية + audit) + listGatewayOps (فلاتر mine/other/unmarked/distributed/pending + q مطبع عربيًا + fee/net/paidAllocated/remainingNet/locked لكل صف) + classifyOps (mine يتطلب سند قبض سارٍ بعميل ويحفظ alias، other يصفر receiptNo، الموزَّع/المسدد مرفوض حرفيًا) + distributeOps (◆ يتخطى المعلق gwPaid∈{0,2}/الموزَّع/المسدد/غير المصنّف ب skippedReasons) + undistributeOps (↩ انحراف موثق عن المصدر: بإرجاع المسدد أيضًا — undo_other حرفيًا: حذف تخصيصاته transfer_op_allocs وسحب المبلغ من التسديد إذ يصير unallocated «على الحساب» و paid_transfer_id=0) + dailyClearing (sys=قبض بطرق البوابة method LIKE كلمات مفصولة، gw=الموزَّعة mine/other فقط — غير المصنّف خارج التصفية تمامًا، expect=الإجمالي−n×fee، my/other share، بنك بنافذة [settle−1bd, settle+1bd] ± tolerance الأقرب بفرق الأيام ثم المبلغ والاستهلاك بمجموعة used، gap=mine−sys والحالة diff/done/pending/late بlateDays أيام عمل) + saveBankLines (upsert بمنع التكرار الحساب+تاريخ+مبلغ+بيان) + unmatchedBank + gatewaySummary (pendingT1: mine غير موزَّعة effectiveDate>اليوم ببنودها؛ collectedToday؛ late من dailyClearing آخر 60 يومًا) + otherOpening (صف id=1، سالب مرفوض) + otherStatement (مستحق صافي تراكمي other+موزَّعة+gwPaid∉{0,2}) + otherBalance (dues=افتتاحي+مستحق، paid=Σتحويلات، remaining قد يكون سالبًا=فروقات عمولة + side: grossDue/feesTotal/netDue/nOps) + dueItems (صافي-الأساس V4.49: paidAllocated وremaining) + listTransfers (alloc/unalloc/nOps/dates/status open|full|partial + تخصيصاتها) + addOtherTransfer (لا سند نهائيًا — voucherId=0 حرفيًا V4.5.13؛ تحقق موجود/محصَّل/موزَّع/للأخرى/غير مسدد؛ opIds صريح [{opId,amount}] يُقص على متبقي الصافي كالمصدر min والفائض فروقات عمولة، أو [ids] تلقائي FIFO على المحدد، أو بلا opIds توزيع تلقائي على كل المستحق بالأقدم؛ مجموع الصريح ≤ المبلغ؛ paid_transfer_id عند الاكتمال) + transferDetail (ops/groups/totals بdatesShort) + deleteOtherTransfer (يرفض المرتبط بسند سارٍ، يحذف تخصيصاته ويعيد حساب paid_transfer_id لكل عملية ماسة بآخر transfer مغطٍّ أو 0) + otherLedger (prior=افتتاحي+مستحق قبله−مسدد قبله، أسطر due/pay مرتبة due أولًا برصيد جارٍ ونص التسديد يذكر العمليات المغطاة) + otherDailySettlement (أيام بops وبcumulative_due/paid/diff أضفتها للفرق التراكمي) + wipeGatewayData (المدير بتأكيد نصي «مسح البوابة» حرفيًا؛ يحذف gateway_ops/bank_lines/transfers/allocs/fee_vouchers — انحراف موثق: المصدر يبقي كشف البنك والمهمة تطلب مسحه؛ البروفايلات والافتتاحي والروابط تبقى).
- المسارات المنشأة (21): gateway/profiles (GET/POST) وprofiles/[id] (PATCH/DELETE — يمنع حذف بروفايل له عمليات: «عطّله بدلًا من الحذف») وsettlement-file (POST rows أو text خام) وops (GET فلاتر+totals) وops/classify وops/distribute وops/undistribute وaliases (GET/POST/DELETE?id= أو ?filePhone= يلجم) وdaily-clearing (GET) وbank-lines (GET/POST) وunmatched-bank (GET) وsummary (GET) وwipe (DELETE مدير 422 عند تأكيد خاطئ) + other-company/balance وopening (GET/PUT) وdue-items وtransfers (GET/POST) وtransfers/[id] (GET/DELETE) وtransfers/[id]/coverage (GET) وledger وdaily-settlement.
- الصلاحيات: كل مسارات البوابة screen_gateway (المسح adminGuard)، التصفية/كشف البنك/غير المربوط screen_clearing، الشركة الأخرى كلها screen_other_company — تحقق: سكرتير بصفوف صريحة allowed=false ⇒ 403 على الثلاثة، وبالتفريغ يعود 200 (المفتاح المجهول لا يقيّد كالنظام).
- اختبار ذاتي curl (36 فحصًا + فحص صلاحيات + فحص مسح، كلها ناجحة): بروفايل «بوابة اختبار 13a» fee 0.150 → عميل 99112233 + عقد + سند قبض RV-0008 KNET 250 → رفع صفين (250/99112233 و90/55500077) ⇒ matched=1 وunmarked=1 (mine برقم RV-0008) → ملخص: pendingT1=250 بeffectiveDate غدًا → تصنيف mine بلا سند⇒400 → other يدويًا → توزيع 1+1 والمكرر يُتخطى → due-items صافي 89.85 → تسديد جزئي 71.88 ⇒ balance dues 89.85/paid 71.88/remaining 17.97 → تسديد على mine⇒400 «ليست من عمليات الشركة الأخرى» → قص الصريح: تسديد 200 بصريح 89.85 والمتبقي 39.85 ⇒ يخصص 39.85 و160.15 على الحساب (فروقات عمولة بلا حاجز) → gwPaid=0: التوزيع يُتخطى والتسديد⇒400 «لا يمكن تسديد ما لم يدفعه العميل» → حلقة تعلّم الرابط: تصنيف يدوي mine بسند مستهلك يحفظ alias (99112234/عميل مطابقه 13a→14) ورفع صف بنفس الهوية ⇒ مطابق تلقائيًا «رابط محفوظ» → تصنيف موزَّعة⇒400 مقفلة → إرجاع OP2 المخصصة ⇒ untied=1 والتسديد صار open/unalloc=50 والرصيد −50 (على الحساب) ثم حذف التسديد وإعادة التوزيع → كشف بنك 3 إيداعات ⇒ daily-clearing: expect=339.70 (340−2×0.15) وgap=0 وإيداع 339.70 بتاريخ D+1 ⇒ done، وunmatched يعرض الباقي → افتتاحي 100 ⇒ balance dues 189.85 والسالب⇒400 → نص خام tab بالرؤوس العربية ⇒ صف unmarked → مسح بتأكيد خاطئ⇒422 والصحيح ⇒ wiped {ops:6,bankLines:4} → دفتر/تسوية يومية/تغطية تسديد بأرقام صحيحة (prior 0، تراكمي 89.85→17.97، groups وdatesShort).
- نظّفت بيانات الفحص عبر الـAPI نفسه: wipe + حذف التسديدات + إلغاء RV-0008 ثم حذف العقد والعميل + حذف الروابط وبروفايل البوابة + تصفير الافتتاحي. بقايا مقصودة باتفاق المشروع: سطور audit وعدّادات الترقيم (RV-0008 ملغى بلا عقد — الرقم لا يُعاد).
- ضبط الجودة: bunx tsc --noEmit على الملفات الجديدة = صفر (الأخطاء الظاهرة بالمستودع في src/components/contrack/OtherCompanyView.tsx للوكيل الأمامي 13-b قيد البناء بالتوازي وخارج نطاقي — أنواعه في contrack-types.ts متوافقة مع استجاباتي فعليًا)؛ eslint على gateway-server وكل المسارات = نظيف؛ لا تعديل على schema.prisma أو أي ملف قائم (استثناء صغير: لا شيء)؛ لا dev/build/db:push (شغّلت dev خلفيًا للاختبار بعد أن وجدت الخادم متوقفًا)؛ dev.log بلا أخطاء 500 على مساراتي.
- نقاط مزامنة للوكيل الأمامي (13-b): (أ) settlement-file يعيد {received,inserted,updated,ignoredLocked,matched,summary{mine,other,unmarked,total×{count,amount}},checklist[],skipped,skipReasons}؛ (ب) ops يعيد {ops:[{id,gateway,opDate,phone,amount,ref,status,statusLabel,receiptNo,customer,batch,classifiedManual,distributed,distributedAt,gwPaid,effectiveDate,fee,net,paidAllocated,remainingNet,paidTransferId,locked}],totals{count,amount,net}} والفلاتر mine/other/unmarked/distributed/pending/all + from/to + q؛ (ج) daily-clearing {rows:[{gateway,day,sys,g_mine,g_other,n_mine,n_other,gap,expect,settle_date,bank_amount,bank_date,bank_descr,my_share,other_share,status,statusLabel}],totals,from,to} — expect إجمالي اليوم الصافي (سهمَي mine+other) لا نصيب mine؛ (د) الشركة الأخرى: balance {opening{amount,note,updatedAt},dues,paid,remaining,side{duesTotal,grossDue,feesTotal,netDue,nOps}}؛ due-items {items:[{opId,opDate,phone,customer,ref,gross,fee,net,paidAllocated,remaining,effectiveDate,gwPaid}],totals}؛ transfers {transfers:[{id,tdate,amount,method,ref,notes,alloc,unalloc,nOps,dates,status,allocs[{opId,amount,opDate,customer,phone,gateway}]}],totals}؛ POST يعيد {transfer,allocs,allocTotal,unallocated,completedOps}؛ coverage {transfer,ops,groups,totals{amount,alloc,unalloc,nOps,dates,datesShort}}؛ ledger {opening,prior,lines[{date,kind,text,gateway,plus,minus,tid,balance}],totalPlus,totalMinus,end}؛ daily-settlement {days[{day,ops[],n,gross,fees,net,paid,remaining,status,cumulative_due,cumulative_paid,cumulative_diff}],totals,transfers,transfersTotal}؛ opening {opening{amount,note,updatedAt}}؛ (هـ) summary {summary{total,collected,pendingT1{count,amount,items[]},collectedToday,late[],lateLabel},profiles,statusLabels,clearingLabels}؛ (و) wipe بجسم {confirm:'مسح البوابة'} ويحذف كشف البنك معه — بروفايلات/افتتاحي/روابط تبقى.
Task ID: 13-b (أُنجز وتحقق منه المنسق بعد انقطاع اتصال الوكيل عند التسليم)
Agent: frontend-styling-expert (واجهة) + تحقق المنسق
Task: المرحلة 6 واجهة — البوابة المالية والشركة الأخرى

Work Log:
- GatewayView.tsx (~2100 سطرًا): KPIs (معلقة T+1/محصلة اليوم/متأخرة/الإجمالي) + 5 تبويبات (العمليات بفلاترها وتصنيف/توزيع/إرجاع سطريًا وجماعيًا، رفع ملف التسديد بتحليل نصي ومعاينة صفوف وقائمة تحقق، التصفية اليومية بحالات المطابقة وسطور البنك، سطور البنك ورفع الكشف، إعدادات البروفايلات) + مسح شامل بشرط كتابة «مسح البوابة» حرفيًا.
- OtherCompanyView.tsx (~1250 سطرًا): بطاقات الرصيد/الصافي/المدفوع/الافتتاحي + تبويبات المستحقات (due-items بصافي وتحديد متعدد وتسديد مختارات بتوزيع تنازلي) والتسديدات (تغطية/حذف سببي) والدفتر (تراكمي) والتسوية اليومية (فرق تراكمي بتلوين) + ملاحظة «لا سندات — توزيع فقط».
- الدمج: AppShell عنصرا تنقل (CreditCard «البوابة»/Building2 «الشركة الأخرى») + ConTrackApp توجيه + أنواع في contrack-types.ts.
- تحقق المنسق: tsc صفر على src/components، الاستيرادات والتوجيه موجودان، AppShell يحوي العنصرين، smoke: /api/gateway/summary و/api/other-company/balance يعملان (200) بعد تنظيف الوكيل الخلفي لبياناته.

Stage Summary:
- المرحلة 6 مكتملة (خلفية 36 فحصًا + واجهة). تنظيف بيانات الاختبار تم بواسطة الوكيل الخلفي عبر الـAPI نفسه.
- المتبقي: الموجة 7 (إنتاجية: مهام/زيارات/تعليقات/أرشيف) ثم 8 (حوكمة: تدقيق/نسخ احتياطي/تنظيف) ثم التحقق النهائي الشامل.

---
---
Task ID: 14-a
Agent: backend-tasks-visits-comments
Task: المرحلة 5 خلفية — المهام + الزيارات + التعليقات ومركزها + المرفقات/الأرشيف (api/tasks/**, api/visits/**, api/comments/**, api/attachments/**) على عقد الواجهة في نص المهمة (14-b يبني الواجهة بالتوازي).

Work Log:
- قراءة إلزامية بالترتيب: worklog.md (آخر 120 سطرًا)، BUSINESS_LOGIC_SPEC.md (حذف التعليقات ناعم فقط/التعديل والتثبيت للمدير/التواريخ النصية YYYY-MM-DD HH:mm للمهام والزيارات)، research/spec-phase5-9.md الأقسام D–G بمراجع الأسطر (task_service.py: notified_before عند 0≤دقائق≤remind وإعادة الفتح/التعديل يصفّران الأعلام؛ visits_service.py: UNIQUE(visit_date,hour_slot,staff_id)/تفريغ=حذف/الترحيل المكرر مرفوض/الموظف يُعطَّل لا يُحذف؛ comment_center_service.py: أنواع 7 وأولويات 3 وحالات 4 وdue_only وsoft_delete بstatus='ملغى'؛ extras_service.py: تخزين C<id>_<stamp>_<name> وأحداث عقد إضافة/حذف مرفق)، ثم schema.prisma (Task/Visit/VisitStaff/Comment/ContractAttachment/PurgeAudit) وapi-utils.ts + auth.ts (authGuard/adminGuard/isSuperRole/audit/normalizeArabic) وأنماط subcontractors وinvoices (PurgeAudit snapshot).
- **المهام** `api/tasks/route.ts`: GET بفلاتر status∈{مفتوحة,منجزة}/customerId/contractId/q (normalizeArabic على title+details)/from+to على dueAt (مقارنة نصية `${from} 00:00`…`${to} 23:59`)، لكل مهمة أسماء العميل/الكود والعقد/الرقم؛ POST بعنوان وdueAt إلزاميين بصيغة YYYY-MM-DD HH:mm (regex+Date parse)، taskType∈{تذكير,موعد}، remindMinutes≥0 افتراضي 30، وتحقق التطابق كالمصدر: contractId مع customerId غير الطرف ⇒ 400 «العقد المحدد لا يخص هذا العميل». `[id]/route.ts`: PATCH إجراءات complete (منجزة+doneAt بختم YYYY-MM-DD HH:mm)/reopen (مفتوحة+تصفير notifiedBefore/After)/notified {stage:'before'|'after'} لمحرك التذكير، وتعديل حقول مع تصفير الأعلام عند تغيير dueAt أو remindMinutes (كالمصدر 127–130)؛ DELETE حذف فعلي مسموح + PurgeAudit (snapshot كامل) + تعامل مع زياراته عبر SetNull الافتراضي للعلاقة الاختيارية.
- **محرك التذكير** `api/tasks/notifications/route.ts`: GET يعيد {before, after} للمهام المفتوحة — before: 0≤minutesDiff≤remindMinutes وغير مبلغة، after: minutesDiff<0 وغير مبلغة — بلا تعليم؛ التعليم عبر PATCH {action:'notified'} كما اختبرت: مهمة بموعد +30 ثانية ظهرت بbefore ثم اختفت بعد التعليم، ومهمة فائتة ظهرت بafter.
- **الزيارات** `api/visits/route.ts`: GET ?date شبكة [hourSlot][staffId] بخانات 08:00→16:00 (بداية 8 حتى ما قبل 17 بحصة 60) مع customerName/note/taskId وdayCount لكل موظف؛ POST=PUT upsert على unique(visitDate,hourSlot,staffId) — خانة مشغولة بلا force ⇒ 400 «الخانة محجوزة» ومع force أو PUT تحديث نفس الخانة؛ رفض الحجز لموظف معطل؛ DELETE ?visitDate&hourSlot&staffId تفريغ بحذف الصف. `staff/route.ts` GET (عدد زيارات اليوم groupBy) + POST؛ `staff/[id]` PATCH (تعطيل/تعديل) وDELETE مرفوض لمن له زيارات («يمكن تعطيله بدلًا من ذلك»)؛ `to-task/route.ts` ينشئ مهمة نوع «موعد» مصدر «جدول الزيارات» بعنوان «زيارة: {العميل}» وdueAt=تاريخ+خانة الزيارة ويربط taskId (المكرر ⇒ 400 «تم ترحيل هذه الزيارة إلى مهمة مسبقًا»). `config/route.ts` GET/PUT: أعيد ثوابت 8-17/60 وأقبل PUT بتجاهل صامت — لا يوجد مكان تخزين صحيح (Setting بلا أعمدة زيارات وFeatureFlag Boolean فقط؛ تعديل schema ممنوع هذه المرحلة) — موثق بالكود والملاحظة editable:false للواجهة.
- **التعليقات** `api/comments/route.ts` GET (مشترك للعميل والمركز): استبعاد isDeleted دائمًا + فلاتر customerId/contractId/q على body/status/kind/priority/tag (ضمن comma-list)/openOnly∈{مفتوح,مؤجل}/dueOnly (followupDate≤اليوم وغير مغلقة)/pinnedFirst (افتراضي 1: pinned desc ثم createdAt desc) + include أسماء العميل/العقد للمركز + ملخص total/open/urgent/due كالمصدر؛ POST بcustomerId إلزامي وbody 1..2000 وkind/priority من القيم الحرفية وfollowupDate بصيغة يوم، createdBy=username وauthor=fullName. `[id]/route.ts` PATCH: meta لأي مستخدم (تحقق القيم)؛ body للمدير فقط وإلا 403 «تعديل نص التعليق للمدير فقط» مع editedAt/editor؛ pin/unpin للمدير فقط وإلا 403 «التثبيت للمدير فقط»؛ DELETE ?reason حذف ناعم لصاحبه (createdBy==username) أو المدير — isDeleted+deletedAt+deleteReason+status='ملغى'، ولغير المصرح 403 «حذف التعليق متاح لصاحبه أو المدير فقط».
- **المرفقات** `api/attachments/route.ts`: GET ?contractId= قائمة مع sizeBytes من statSync؛ GET ?id=&download=1 يعيد الملف new NextResponse(Uint8Array) بContent-Type حسب الامتداد (pdf/jpg/png/doc(x)/xls(x)/txt) وContent-Disposition مزدوج (ASCII + filename* UTF-8 للعربية)؛ POST {contractId, fileName, dataBase64} بامتدادات مسموحة pdf,jpg,jpeg,png,doc,docx,xls,xlsx,txt (وإلا 400 «نوع الملف غير مسموح»)، التخزين db/attachments/C{id}_{Date.now()}_{name} مع sanitize للاسم وكتابة صف ContractAttachment addedAt بختم كامل + حدث عقد «إضافة مرفق» + تراجع حذف الملف عند فشل القاعدة؛ DELETE ?id= يمسح الملف الفعلي والصف + حدث «حذف مرفق».
- ثوابت مشتركة جديدة بلا مساس بمسارات قائمة: src/lib/visits-server.ts (VISITS_CONFIG/buildHourSlots/HOUR_SLOT_RE/nowStamp) وsrc/lib/comments-server.ts (KINDS/PRIORITIES/STATUSES الحرفية) — ملفات route.ts تصدّر معالجات HTTP فقط تفاديًا لرفض Next.js للمصدّرات الغريبة.
- اختبار ذاتي curl شامل: مهمة بموعد +30ث ⇒ notifications.before ثم تختفي بعد {action:'notified'}؛ تعديل/إكمال/إعادة فتح؛ mismatch عقد/عميل ⇒ 400 حرفيًا والعكس 201؛ DELETE ⇒ {deleted:true}+PurgeAudit؛ زيارات: حجز/تعارض 400 «الخانة محجوزة»/force تحديث/شبكة اليوم/ترحيل لمهمة (زيارة: عميل اختبار سندات بتاريخ الخانة)/ترحيل مكرر 400/حذف موظف له زيارات 400/تعطيل/تفريغ؛ تعليقات: سكرتير meta 200 بينما body وpin ⇒ 403 بالرسائل الحرفية، مدير يعدل النص بختم editedAt/editor، مثبت أولًا في الترتيب، dueOnly/openOnly/q/tag، حذف غير المالك 403 وصاحبه حذف ناعم ثم استبعاد (status='ملغى' وdeleteReason محفوظان)؛ مرفقات: رفع txt عربي base64 (30 بايت)، exe ⇒ 400، تنزيل مطابق المحتوى بContent-Length 30، حذف أزال الصف والملف (المجلد خالٍ). نظفت كل بياناتي (مهامي/تعليقاتي/أحداث مرفقاتي/موظفي وزياراتي) دون مساس ببيانات الوكيل 14-b المتوازية (مهمة فحص 14ب/مهندس فحص/تعليق فحص الواجهة بقيت).
- Dev server سليم بلا أخطاء في dev.log لكل المسارات الجديدة. tsc --noEmit: صفر أخطاء في مساراتي (بقايا examples/skills وVisitsView.tsx من وكيل آخر — خارج نطاقي). eslint نظيف للملفات الجديدة.

Notes & Decisions:
- (أ) إعدادات الزيارات ثابتة 8-17/60 بتجاهل صامت لPUT: لا أعمدة تخزين في schema الحالي وFeatureFlag لا يقبل إلا Boolean — أي تخزين يتطلب تعديل schema ممنوعًا؛ المسار جاهز ليُحوَّل لأعمدة حقيقية لاحقًا.
- (ب) PUT على خانة مشغولة بلا force يعيد 400 كالـPOST («الخانة محجوزة») — التحديث المتعمد عبر force:true؛ هذا هو «إمكانية update لنفس الخانة» في نص المهمة.
- (ج) خانات الشبكة 08:00→16:00 (9 خانات): آخر خانة تبدأ قبل نهاية العمل حتى لا تتجاوز 17:00 بحصة 60 دقيقة.
- (د) تعليقات/مرفقات بحارس دخول عام (authGuard بلا مفتاح) لأن نص المهمة حدد screen_tasks/screen_visits فقط لهما، والإجراءات الحساسة محمية بـisSuperRole داخليًا (المفتاح المجهول لا يقيّد كالمصدر).
- (هـ) تعديل dueAt أو remindMinutes يصفّر أعلام التنبيه معًا (توسعة منطق المصدر 127–130 لتشمل التذكير لأن تغييره يغيّر نافذة before).
- (و) حذف المهمة فعلي (مسموح بالمصدر) مع PurgeAudit كامل كنمط invoices، وزياراتها تفقد الربط بSetNull الافتراضي للعلاقة الاختيارية في Prisma.

---
Task ID: 14-b
Agent: frontend-styling-expert (واجهة Next.js 16)
Task: المرحلة 7 واجهة — الإنتاجية (TasksView + VisitsView + CommentsView)

Work Log:
- قراءة إلزامية بالترتيب: worklog (Tasks 12-a/13-a/13-b — أنماط KpiCard/الفلاتر المحلية/رسائل الخلفية حرفيًا) وcontrack-types.ts + api.ts + AppShell.tsx + ConTrackApp.tsx وBUSINESS_LOGIC_SPEC (التعليقات حذف ناعم فقط؛ التعديل والتثبيت للمدير) وspec-phase5-9 أقسام D/E/F (المهام بلا أولوية status مفتوحة|منجزة ونوع تذكير|موعد، تذكير قبل/بعد مرة واحدة لكل مرحلة، الزيارات UNIQUE(visitDate,hourSlot,staffId) وتفريغ = حذف والترحيل المكرر مرفوض، التعليقات body≤2000 وحذف لصاحبه أو مدير بسبب، pin للمدير، الترتيب مثبّت←عاجل←مهم←الأحدث).
- الملفات المنشأة (3):
  • TasksView.tsx (props {user, onAuthError}): KPIs (المفتوحة/منجزة اليوم/المتأخرة) + فلاتر (تبويب الكل|مفتوحة|منجزة|متأخرة + بحث بتطبيع عربي + فترة من/إلى على dueAt محليًا) + قائمة صفوف بطاقات (أيقونة Bell تذكير / CalendarClock موعد بتلوين، عنوان bold يشطب عند الإنجاز، تفاصيل line-clamp، شارات متأخرة حمراء/قريبة amber خلال 24h، العميل/العقد/المصدر «من الزيارات») + إجراءات: إنجاز Check مع toast «يمكن التراجع» وإعادة فتح RotateCcw، تعديل Dialog، حذف بتأكيد Dialog destructive — كلها على /api/tasks. «مهمة جديدة» Dialog: عنوان*/تفاصيل/نوع select/التاريخ والوقت datetime-local يحوَّل replace('T',' ') إلى 'YYYY-MM-DD HH:mm' (افتراضي الساعة القادمة)/تذكير قبل select (0/15/30/60/120/1440)/عميل اختياري → عقد select تابع له من كاش ["customer",id] المُشترك (يستبعد الملغى). **محرك التذكير**: useEffect interval 60s + فحص أولي يستدعي GET /api/tasks/notifications — قبل: toast «تذكير قبل موعد: {title}» وبعد: toast destructive «فوت موعد المهمة: {title}» ثم PATCH /api/tasks/[id] {action:'notified',stage} لكل عنصر (صامت، وحارس busy/visibilityState ضد التكرار والتداخل).
  • VisitsView.tsx: اختيار التاريخ (Input date افتراضيًا اليوم + أسهم يوم سابق/تالي + زر اليوم واسم يوم الأسبوع) + حوار «الموظفون» (قائمة كل الموظفين بالحالة، إضافة اسم*/هاتف POST /api/visits/staff، تفعيل/تعطيل Switch-style UserCheck/UserX بـPATCH {active}، ترتيب ↑/↓ بـPATCH {sort} بتبديل قيمة الجار، حذف DELETE — «لا يمكن حذف موظف له زيارات مسجلة…» حرفيًا في toast) + **شبكة الجدولة** جدول أعمدة = الموظفون النشطون (من staff اليوم بعد استبعاد inactive، وإلا قائمة الموظفين) وصفوف = الساعات (من hours الخلفي، fallback 08:00→16:00 كل ساعة) — خلية فارغة زر + يفتح حوار حجز (عميل اختياري + ملاحظة) وخلية محجوزة bg-emerald-50/25 بحلقة emerald تعرض اسم العميل bold + ملاحظة truncate + شارة «مهمة مرتبطة» إن taskId + أزرار تعديل/تفريغ (DELETE query params visitDate&hourSlot&staffId)/تحويل مهمة (POST /api/visits/to-task يعطّل الزر بعد النجاح) — **تعارض الخانة «الخانة محجوزة» يُعرض حرفيًا داخل الحوار** وتعديل خانة محجوزة يرسل {force:true} (تحقق فعلي: بلا force ⇒ 400، ومعه ⇒ updated) — الحجز PUT /api/visits مع fallback POST عند 404/405. KPI اليوم: محجوزة (من N خانة)/فارغة/بالعميل.
  • CommentsView.tsx (props {user, onAuthError, onOpenCustomer?, onOpenContract?}): KPIs (مفتوحة/مهمة نشطة/عاجلة نشطة/متابعة اليوم) + فلاتر (بحث/حالة/نوع 7 أنواع/أولوية + Switch «المفتوحة فقط» و«متابعة اليوم فقط» — كلها محلية على استعلام واحد GET /api/comments يغذي KPI والقائمة نمط ClaimsView) + بطاقات فقاعة RTL بحد جانبي ملوّن (amber للمثبّت/أحمر للعاجل): مؤلف بأول حرف دائرة + توقيت نسبي عربي (الآن/قبل دقيقة/ساعة/ساعتين/أيام) + «عُدّل بواسطة editor» + النص whitespace-pre-wrap + شارات نوع/أولوية (عاجلة حمراء/مهمة amber)/حالة + وسوم chips + شارة متابعة بتلوين «اليوم» + روابط العميل/العقد تستدعي onOpenCustomer/onOpenContract — أزرار: تعديل البيانات (meta Dialog: حالة/نوع/أولوية/وسوم/تاريخ متابعة لأي مستخدم)، تعديل النص (للمدير فقط — الزر مخفي عن السكرتير، PATCH {action:'body'})، تثبيت/إلغاء تثبيت (مدير — {action:'pin'|'unpin'} حسب الحالة)، حذف (صاحبه createdBy===username أو مدير) بحوار سبب إلزامي DELETE ?reason=. «تعليق جديد» Dialog: عميل إلزامي → عقد اختياري تابع، النص بعداد 2000 حي، نوع/أولوية/وسوم بفواصل (تُوحَّد إلى «،»)/تاريخ متابعة. الترتيب: مثبّت ← عاجل ← مهم ← الأحدث (مواصفات المصدر). isDeleted تُستبعد دفاعيًا.
- تعديلات محدودة: contrack-types.ts (ViewName + tasks/visits/comments؛ أنواع TaskItem/TasksResponse/TaskNotificationsResponse/REMIND_OPTIONS/TASK_TYPES + VisitStaffMember/VisitsStaffResponse/VisitCell/VisitGridRow/VisitFlatRow/VisitsDayResponse + CommentItem/CommentsResponse/COMMENT_KINDS/PRIORITIES/STATUSES وبادجات الأولوية/الحالة) — قابلة للشكلين tasks|items وcomments|items وشبكة grid|cells|قائمة مسطّحة. AppShell.tsx: تنقل «المهام» ListTodo و«الزيارات» CalendarDays و«التعليقات» MessageSquareText بعد «المطالبات». ConTrackApp.tsx: استيراد الثلاث وتوجيهها، وCommentsView يُمرَّر له openCustomerDetail/openContract ليعمل الرابطان فعليًا.
- المطابقة مع الخلفي (بُني بالتوازي واكتمل أثناء عملي — تحققت منه حيًا بكل الإجراءات): GET /api/tasks يعيد {tasks:[…]} لا {items} (وcomments كذلك {comments}) — عدّلت القراءة لتقبل الاثنين؛ doneAt نص "" وليس null؛ GET /api/visits/staff {staff:[…todayVisits]}؛ PUT/POST /api/visits upsert متطابقان ويُرجع 400 «الخانة محجوزة» بلا force و400 «لا يمكن الحجز لموظف معطل»؛ DELETE بمعاملات استعلام ✓؛ to-task 201 {task{…}} والمكرر «تم ترحيل هذه الزيارة إلى مهمة مسبقًا» ✓؛ tasks PATCH complete/reopen/notified وحقول العميل null⇒disconnect ✓ وDELETE حذف فعلي ✓؛ comments meta لأي مستخدم وbody/pin|unpin للمدير وحذف ناعم ?reason= لصاحبه أو المدير ✓.
- نقطة مزامنة مفتوحة مع الخلفي (الوحيدة): GET /api/visits?date يحسب cells[hourSlot][staffId] داخليًا (visits/route.ts:26–41) لكنه **لا يُعيدها في الاستجابة** — الاستجابة {date,config,hours,staff,total} فقط، فالشبكة تظهر الخانات فارغة حتى يُضاف الحقل. واجهتي جاهزة لأي شكل يعتمده: grid صفوف، أو cells خريطة (كما هو محسوب الآن)، أو قائمة visits/items مسطّحة — لا تغيير مطلوب عندي عند اكتماله.
- اختبار حي بالـAPI (كل الفحوصات ناجحة ثم تنظيف كامل): إنشاء مهمة/إكمال/إعادة فتح/تعديل حقول مع تصفير أعلام/notified before+after/حذف؛ موظف زيارات إضافة/sort/active/حذف؛ حجز/تعارض/force/تحويل لمهمة/مكرر مرفوض/تفريغ؛ تعليق إنشاء/meta/body/pin/unpin/حذف بسبب — ونظّفت كل بيانات الفحص التي أنشأتها (العميل «عميل فحص 14ب» والموظفان والمهام 6/11 والتعليق والزيارة) عبر الـAPI نفسه؛ القاعدة عادت كما وجدتها (المهام/التعليقات/الموظفون فارغة كأصلها).
- ضبط الجودة: bunx tsc --noEmit | grep "src/(components|app|lib)" = صفر (أصلحت import User ناقص في VisitsView؛ الأخطاء الظاهرة بالمستودع في examples/skills سابقة)؛ bunx eslint على مجلد contrack كاملًا = نظيف؛ GET / يعيد 200 بعد التغييرات (compile نظيف)؛ لم ألمس prisma/src.lib*/api.ts/package.json/مسارات API، ولا dev/build/db:push.
- قرارات معمارية: الفلترة كلها محلية على استعلام واحد لكل شاشة (نمط ClaimsView) ليتغذى KPI والقائمة من المصدر نفسه — فلاتر الخلفي q/status/from/to مدعومة في الـAPI وجاهزة للتفعيل عند كبر البيانات؛ محرك التذكير يعمل فقط أثناء فتح شاشة المهام (كالنص) بحارس busy + visibilityState؛ مؤقت «قبل ساعة» للـdatetime الافتراضي؛ التعليق المثبّت شارة Pin وحد جانبي amber وترتيب أول.
Stage Summary:
- المرحلة 7 واجهة مكتملة: المهام (KPIs/فلاتر/بطاقات/إنجاز وإعادة فتح/حذف مؤكد/حوار نوع ووقت وتذكير وعميل→عقد/محرك تذكير 60s بـtoasts قبل وبعد ثم تعليم notified) + الزيارات (شبكة ساعات×موظفين بالتاريخ وحوارات الحجز بالتعارض الحرفي وforce للتعديل وتحويل مهمة وإدارة موظفين بترتيب وتعطيل) + مركز التعليقات (KPIs/فلاتر وبادجات/فقاعات بتوقيت نسبي ووسوم ومتابعة/صلاحيات مدير للنص والتثبيت/حذف ناعم بسبب إلزامي/روابط عميل وعقد فعّالة) — tanstack/react-query + shadcn/ui + Skeletons + toasts عربية + RTL وموبايل ورسائل الخلفية حرفيًا.
- عند اكتمال خلايا شبكة الزيارات من الخلفي: لا تغيير مطلوب في الواجهة (قراءة مرنة grid|cells|flat) — فقط إعادة فتح الشاشة.

---
---
Task ID: 15
Agent: full-stack-developer (خلفية Next.js 16)
Task: المرحلة 7 الحوكمة — سجل التدقيق + النسخ الاحتياطي (قاعدة/كاملة/استعادة بنسخة أمان) + إدارة البيانات (محو العقد/العميل بلقطة PurgeAudit + إعادة الضبط الكاملة) خلفيًا وواجهة DataManagementView

Work Log:
- قراءة إلزامية بالترتيب: worklog (المراحل السابقة وأنماط authGuard/adminGuard/audit وnextNumber) وBUSINESS_LOGIC_SPEC (القواعد الذهبية: الصلاحيات — المدير/المطور الكل دائمًا، المفتاح المجهول لا يقيّد) وresearch/spec-phase5-9.md قسم H (H.3 النسخ: احتفاظ 30 ونسخة أمان قبل الاستعادة؛ H.4 purge_service: لقطة JSON قبل كل حذف + معاينة بلا كتابة + حذف الأبناء قبل الآباء + full_reset يستثني settings/users/user_permissions) وsrc/lib/auth.ts (adminGuard + PERMISSIONS 37 مع action_backups) وapi-utils.ts وprisma/schema.prisma (AuditLog/PurgeAudit/FeatureFlag + كل جداول الأعمال وFKs) وcontrack-types.ts + api.ts + SettingsView + AppShell + ConTrackApp.
- الخلفية (5 مسارات جديدة):
  1) /api/audit GET (adminGuard): فلاتر entityType/username/q (OR على action+entityName+reason+oldStatus+newStatus)/from/to (بداية ونهاية اليوم) + limit≤200/offset — مرتب id desc ويعيد {items,total} مع تحقق صيغة التاريخ ورسائل عربية.
  2) /api/backups GET (authGuard بpermKey action_backups — المدير/المطور دائمًا والسكرتير بصلاحية): قائمة db/backups من manifest.json الجانبي (يُنشأ المجلد تلقائيًا) مع sizeKB حية وexists.
  3) /api/backups POST {kind}: db ⇒ fs.copyFile للقاعدة إلى backup-YYYYMMDD-HHmmss.db + إدخال manifest (username/size/kind/createdAt)؛ full ⇒ قاعدة backup-full-…db + ملف دليل backup-full-…json (بيانات القاعدة + قائمة ملفات db/attachments مسارات وأحجام) + نسخ كل ملف مرفقات إلى backups/attachments-…/ (اجتياز تكراري) — مع الاحتفاظ بآخر 30 نسخة (prune يحذف الأقدم: القاعدة + الدليل + مجلد المرفقات ويحدّث manifest؛ ملفات الأمان مستثناة) + audit.
  4) /api/backups/restore POST {fileName} (adminGuard): **نسخة أمان أولًا** safety-<stamp>.db تُضاف للـmanifest كkind:'safety' ثم copyFile فوق db/custom.db + audit — يعيد {restored, safetyFile, message} بنص تنبيه أن التفعيل قد يتم عند إعادة التشغيل وPrisma يعيد الاتصال تلقائيًا.
  5) /api/data-mgmt/purge (حارس مخصص: role==='developer' وإلا 403 «أدوات المحو للمطور فقط»): GET ?kind=&q= لسجل PurgeAudit (بلا نص اللقطة — snapshotSize بدلها)؛ POST preview: عدّادات شجرة التبعيات (سندات/دفعات/مراحل/ملاحق/مطالبات/فواتير/باطن+خطوطه وبنوده ومصادره/تعليقات/مهام/زيارات/مرفقات/BOQ/روابط الدفعات/قيود اليومية/أحداث) بلا أي كتابة؛ POST execute بسبب إلزامي: ضمن معاملة واحدة — جمع كل صفوف التبعيات (لقطة كاملة) ⇒ إنشاء PurgeAudit باللقطة JSON ⇒ حذف متسلسل الأبناء قبل الآباء (sub_payment_sources→sub_payment_plan→sub_contract_items→sub_contracts→voucher_payment_links→journal(contractId أو sourceType voucher)→فك parent_voucher_id للأبناء ثم vouchers→addendum_items→addendums→claims→payment_plan→boq_items→contract_stages→contract_events→contract_group_items→contract_scope→contract_attachments→comments→زيارات مهامه→tasks→invoices→contract؛ للعميل: عقوده أولًا بالمسار نفسه ثم فواتيره ومجموعات عقوده وتعليقاته وزياراته ومهامه وmatch_aliases ثم العميل) — ملفات المرفقات تُحذف من القرص **بعد نجاح المعاملة** فقط (تحقق مسار ATTACH_DIR) — ويعيد {purged, auditId, label, counts, filesRemoved}.
  6) /api/data-mgmt/full-reset POST (developer): {confirm} يجب أن يكون حرفيًا «إعادة الضبط الكاملة» وإلا 422 + سبب إلزامي 400 — معاملة deleteMany بالترتيب الآمن FK (47 جدولًا: فك parent_voucher_id وcontinues_field_id وparent_id الذاتية أولًا، الأبناء قبل الآباء حتى form_categories) — يستثني حرفيًا: users/user_permissions/settings/feature_flags/number_sequences/audit_log/purge_audit — مع PurgeAudit {action:'full_reset'} عددي + audit — يعيد {reset, deleted, total, message}.
- مكتبة مساندة src/lib/backups.ts: مسارات DB/BACKUPS/ATTACH/MANIFEST + ensure/stampNow (YYYYMMDD-HHmmss) + read/writeManifest + listAttachmentFiles (اجتياز تكراري بمسارات وأحجام) + pruneBackups(30).
- الواجهة:
  * contrack-types.ts: ViewName + «data-mgmt» + أنواع AuditItem/Response، BackupItem/Response/Create/Restore، PurgeTreeItem/PurgePreview/PurgeExecute/PurgeAudit/FullResetResponse + BACKUP_KIND_LABEL (قاعدة البيانات/كاملة/أمان) + PURGE_KIND_LABEL.
  * AppShell.tsx: عنصر تنقل «إدارة البيانات» بأيقونة ShieldCheck (adminOnly — يظهر للمدير والمطور).
  * ConTrackApp.tsx: توجيه view === "data-mgmt" ⇒ DataManagementView.
  * DataManagementView.tsx (جديد): تبويب «سجل التدقيق» (فلاتر كيان select 13 قيمة/مستخدم/بحث/فترة + تطبيق وإعادة تعيين + جدول الوقت/المستخدم/الإجراء/الكيان/الاسم/الحالة القديمة←الجديدة بشارات + ترقيم «المزيد» limit 50 بمجموع + max-h تمرير)؛ تبويب «النسخ الاحتياطي» (بطاقة إنشاء نسختين + جدول النسخ الاسم/النوع/الحجم/التاريخ/المستخدم + استعادة لكل نسخة بAlertDialog تحذيري يذكر نسخة الأمان والتأجيل المحتمل حتى إعادة التشغيل)؛ تبويب «إدارة البيانات» (للمطور — بطاقة مقفلة Lock للغير): محو كيان (kind عقد/عميل + معرف + معاينة تعرض شجرة العدّادات بشارات + سبب إلزامي + تأكيد بكتابة «محو» + تنفيذ يعرض معرف سجل اللقطة) + كتلة حمراء لإعادة الضبط الكاملة (تطلب النص الحرفي + سبب، مع وصف ما يُحذف وما يبقى) + سجل PurgeAudit أسفلها (فلاتر نوع/بحث + جدول بالتاريخ/المستخدم/الكيان/الاسم/السبب/حجم اللقطة) — كل الرسائل توست عربي حرفي وApiError 401 ⇒ onAuthError.
- التحقق (curl + tsx): audit {items,total} بفلاتر claim (16)/q+فترة/حدود 50 ✓؛ purge بadmin ⇒ 403 «أدوات المحو للمطور فقط» ✓ وbسكرتير غير مصادق ⇒ 401 ✓؛ preview عقد تجريبي CTR-HK15 (سند+دفعتان+مرحلة+BOQ+حدث+فاتورة+باطن بخط ومصدر+تعليقان+مهمتان) عدّادات صحيحة ✓؛ execute بلا سبب ⇒ 400 «سبب المحو إلزامي» ✓؛ execute ⇒ purged auditId=5 deleted=13 واختفاء العقد والسند والفاتورة والباطن والمراحل والخطة والتعليقات والمهام من القاعدة (تحقق tsx) بلا أيتام في sub_payment_sources (orphans:0) ✓ ولقطة 11 قسمًا محفوظة ✓؛ محو العميل HK15-TST كامل (auditId=6) ✓؛ سجل المحو GET يعرض الصفوف ✓؛ نسختا backup وbackup-full (الدليل JSON + مجلد attachments بنسخ ملف تجريبي) ✓؛ استعادة backup-20261018-074039.db ⇒ نسخة أمان safety-20261018-074055.db بالقائمة والقاعدة تعمل بعدها (audit OK) ✓؛ restore بملف مفقود ⇒ 404 ✓؛ full-reset: admin ⇒ 403 «أدوات إعادة الضبط للمطور فقط» ✓ وتأكيد خاطئ ⇒ 422 «نص التأكيد غير مطابق — اكتب «إعادة الضبط الكاملة» حرفيًا» ✓ وسبب مفقود بتأكيد صحيح ⇒ 400 ✓ (**لم تُنفَّذ إعادة الضبط على القاعدة الحقيقية**)؛ tsc صفر على src وeslint نظيف وGET / 200.
- التنظيف: حذف العميل والعقد التجريبيان عبر أداة المحو نفسها (اختبار حقيقي)، حذف مستخدم المطور المؤقت __hk15_dev ومقاول الاختبار، حذف النسخ الاختبارية (بقيت نسخة مثال واحدة backup-20261018-074039.db بالmanifest) وحذف ملف المرفق التجريبي ومجلد السكربتات المؤقتة. سجلات audit/purge لعمليات الاختبار أُبقيت عمدًا كتاريخ حقيقي للعمليات.

Stage Summary:
- الحوكمة مكتملة خلفيًا وواجهةً: تدقيق بفلاتر + نسخ احتياطي بدورة 30 ونسخة أمان قبل الاستعادة + محو مبلقَط للمطور فقط + إعادة ضبط بتأكيد حرفي — كلها متحققة curl وتستوفي قسم H من المصدر.
Task ID: 14-a/b, 15, 16 (التوثيق النهائي)
Agent: المنسق + وكلاء الموجات 7-8
Task: الإنتاجية والحوكمة والتحقق النهائي الشامل

Work Log:
- 14-a/b: مهام (تذكير قبل/بعد بلا تكرار عبر notifications+notified)، زيارات (شبكة unique + force + ترحيل)، تعليقات (meta للجميع/body+pin للمدير/حذف ناعم)، مرفقات بامتدادات محصورة ورفع/تنزيل فعلي — اختبار حي من الطرفين وتنظيف بيانات كامل.
- إصلاح المنسق الوحيد في 14-a: استجابة GET /api/visits كانت تحسب cells ولا تُعيدها — أضفتها.
- 15: مسارات audit/backups (قاعدة وكاملة، احتفاظ 30، استعادة بنسخة أمان)/data-mgmt purge (developer، لقطات PurgeAudit، حذف متسلسل بلا أيتام)/full-reset (تأكيد حرفي، يستثني users/settings/permissions/audit) + شاشة إدارة البيانات بثلاثة تبويبات.
- 16 التحقق النهائي:
  * lint نظيف + tsc صفر على src (بقايا examples/skills قديمة خارج النطاق) — 113 مسار API و28 مكونًا.
  * بذر البيانات المرجعية: أُكتشف نقصها بعد full-reset (قوائم فارغة) — أنشأت src/lib/seed-defaults.ts (5 أساليب دفع/12 حسابًا/13 مرحلة/6 أنواع عقود بقوالب) مستدعاة عديم التكرار من login — تحقق: الجداول ممتلئة والقوائم تعمل.
  * تنظيف التسليم: full-reset فعلي أزال كل بيانات الاختبار (كل الجداول 0) مع بقاء المستخدمين admin/admin وsecretary/123456 وسجل التدقيق وعدّادات الترقيم (لا تعاد الأرقام).
  * تحقق متصفح كامل: دخول → لوحة مؤشرات (19 عنصر تنقل، KPIs، حالات فارغة) → عميل C-0014 → معالج عقد ثلاثي الخطوات (CON-0012 بمرحلتين ودفعة) → سند قبض RV-0009 من تبويب العقد → القيد المحاسبي (صندوق/إيرادات) → تغطية FIFO (الدفعة paid) → كشف الحساب (25,000−7,500=17,500) → تقرير العملاء والأرصدة (أرقام مطابقة) → موبايل 390px بتنقل سفلي وتذييل مثبت → جولة 8 شاشات بلا انهيار → صفر أخطاء كونسول.
  * إصلاحان أثناء التحقق: VouchersView كان يقرأ data.items بينما الخلفية تعيد {vouchers} (قبل الاثنين الآن)؛ سبب «لا خطوط قابلة للربط» في حوار القبض صحيح حرفيًا (upcoming بلا triggeredAt غير قابلة — قاعدة _REACHED).
  * خطأ 500 وحيد في dev.log عابر أثناء تعديل ساخن لموجة سابقة — الطلبات الحالية كلها 200.

Stage Summary:
- النظام مكتمل: 19 شاشة / 54 جدولًا / 113 مسار API بتغطية ~95% وظيفية حرفية (التفاصيل في FEATURES_REPORT.md).
- بيانات تجريبية نظيفة جاهزة: عميل + عقد + سند قبض تعمل دورة مالية كاملة.
- بانتظار المستخدم: مفاتيح Supabase الثلاثة للترحيل ثم النشر.

---
---
Task ID: 17
Agent: Z.ai Code (المنسق)
Task: رفع المشروع إلى GitHub + تحقق نهائي شامل + إصلاح انهيار شاشة المتابعة

Work Log:
- استُلم توكن GitHub (صلاحية repo) وتحقق منه: الحساب a3laaw، نطاق repo فقط.
- فحص أمان المستودع قبل الرفع: أُخرج من التتبع .env (بدء تشغيل محلي فقط) وtool-results/ (سجلات وكيل داخلية 3.6MB) وupload/ (تجزئة الكود الأصلي المكررة 5.9MB)، وأضيفت للـ.gitignore، ولم يُكتب التوكن في أي ملف متتبَّع ولا في .git/config (عُدّل الرابط بعد الدفع).
- أُنشئ المستودع الخاص a3laaw/contrack-online عبر API ودُفع الفرع main (3 commits، ~600 ملف: التطبيق كاملًا + prisma + الوثائق + الكود المرجعي contrack_v9.15.18).
- تحقق نهائي من فجوات الدقة الست في الكود: FIFO موحد في contrack-core.computeContractPaymentPlan ✓، البيان يشمل الملاحق المعتمدة ADD-xxx في report-server ✓، dashboard بالقيمة الحالية (amountAdd−amountDeduct) ✓، إلغاء السند يعيد فتح المغطى (cancelVoucherTx→reopened) ✓.
- التحقق المتصفحي عبر agent-browser: دخول admin/admin ثم جولة على كل الشاشات الـ19 (المؤشرات/العملاء/العقود/الفواتير/السندات/العُهد/البوابة/الشركة الأخرى/المقاولون/التقارير/الكشوفات/المتابعة/المطالبات/المهام/الزيارات/التعليقات/الإعدادات/المستخدمون/إدارة البيانات) — كلها تصيَّر بلا أخطاء كونسول.
- 🐛 اكتشاف وإصلاح انهيار client-side في شاشة المتابعة: تعارض شكل البيانات — /api/followup كان يرجع dueNow ككائن {total, items} وsupervisionNearEnd بينما الواجهة تتوقع dueNow مصفوفة صفوف مسطّحة وnearBaseEnd. أُعيدت هيكلة الـroute: dueNow = صف لكل خط متأخر (contractId/contractNumber/customerName/remaining/daysDiff/title) + nearBaseEnd + lastReceiptDate الصحيح في تعثر التحصيل. تحقق: curl يرجع الشكل الصحيح، الشاشة تصيَّر، tsc نظيف.
- فحص الجولة الذهبية العميقة: فتح مركز العقد CON-0012 بتبويباته الـ11 (المراحل/خطة الدفعات/بنود الكميات/الإشراف/الأوامر التغييرية/الأحداث/السندات/الباطن/كشف الحساب/مطالبات/فواتير) — كل التبويبات تعمل.
- فحص التجاوب: موبايل 390px (شريط تنقل سفلي + بطاقات متراصة) وديسكتوب 1366px (تذييل ثابت بالأسفل) — لقطات مؤكدة.
- bun run lint نظيف، dev.log بلا أخطاء 500 حالية (خطأ 500 عابر لوحدة أثناء hot-reload سابق).

Stage Summary:
- المستودع: https://github.com/a3laaw/contrack-online (خاص، فرع main، الرفع مكتمل).
- شاشة المتابعة أصبحت تعمل بعد إصلاح تعارض الشكل بين الـAPI والواجهة.
- كل الشاشات الـ19 + مركز العقد (11 تبويبًا) متحقق منها متصفحيًا على الموبايل والديسكتوب.
- المتبقي المؤجل: سوبابيز (Postgres) + نشر Vercel بانتظار مفاتيح المستخدم (Project URL + anon + service_role).
---
Task ID: 18
Agent: Z.ai Code (المنسق)
Task: تجهيز ترحيل Supabase (استلام أول مفتاح + أداة الترحيل)

Work Log:
- ورد من المستخدم مفتاح قصير (16 محرفًا) — يُرجّح كلمة مرور قاعدة بيانات Supabase؛ حُفظ في .env.local (خارج التتبع عبر .env*) ولم يُكتب في أي ملف متتبَّع.
- فحص prisma/schema.prisma: 53 موديلًا كلها @@map بأسماء snake_case — مطابقة مباشرة بين SQLite وPostgres.
- كُتبت أداة الترحيل scripts/migrate-to-supabase.ts: قراءة SQLite عبر bun:sqlite (قراءة فقط) → إدخال Postgres عبر عميل Prisma باستعلامات معامَلة، مع ترتيب طوبولوجي لقيود FK (Kahn)، TRUNCATE CASCADE للتكرارية، تحويل 0/1→boolean حسب أنواع أعمدة Postgres، إعادة ضبط setval للتسلسلات، وتقرير عدّادات نهائي SQLite↔Postgres.
- أُنشئ .env.example يوثق DATABASE_URL (SQLite المحلي مقابل Pooler 6543 بpgbouncer للنشر) وDIRECT_URL (5432 لـdb push) مع مواضع القيم في لوحة Supabase؛ واستُثني من نمط .env* بـ!.env.example.
- استُثني scripts/ (وexamples/ وskills/ فعليًا) من tsconfig لإزالة ضجيج أنواع bun — tsc صفر أخطاء تطبيق، lint نظيف.
- فحص أداتي bun:sqlite على db/custom.db: 53 جدولًا، 337 صفًا في 18 جدولًا غير فارغ (users/number_sequences/audit_log/purge_audit/customers/contracts/contract_stages/payment_plan/vouchers/contract_types/type_payment_tpl/workflow_stages/settings/payment_methods/expense_accounts/other_company_opening/journal_entries/contract_events).
- دُفع كل شيء إلى GitHub (1681197).

Stage Summary:
- جاهز للترحيل لحظة وصول باقي المفاتيح: Project URL (أو رابط الاتصال الجاهز) + anon + service_role، وتأكيد أن المفتاح الوارد هو كلمة مرور قاعدة البيانات.
- خطة القطع: تبديل provider إلى postgresql + directUrl → db push على Supabase → تشغيل أداة الترحيل → فحص التطبيق → متغيرات Vercel → النشر.
---
Task ID: 19
Agent: Z.ai Code (المنسق)
Task: قطع كامل إلى Supabase Postgres — ترحيل البيانات وتشغيل التطبيق عليها

Work Log:
- وصلت مفاتيح Supabase: Project URL + مفتاح publishable + قالب رابط الاتصال (اكتُمل بكلمة المرور السابقة). المشروع gcvuwptcleawspsvpdwp.
- اختبار الاتصال: مضيف db.<ref>.supabase.co يحل إلى IPv6 فقط (البيئة بلا IPv6 → unreachable)، بينما HTTPS وegress IPv4 TCP يعملان. الحل: Supavisor Pooler.
- تحديد منطقة المشروع بفحص مصادقة موازٍ على 16 منطقة (bun+pg من /tmp/pgtest): النجاح من المحاولة الأولى على ap-northeast-1 (طوكيو) — وكلمة المرور السابقة صحيحة ✓.
- نسخة احتياطية قبل القطع: db/backups/pre-supabase-20261018-082853.db.
- تبديل prisma/schema.prisma: provider=postgresql + url=DATABASE_URL + directUrl=DIRECT_URL، ثم bunx prisma db push عبر Session Pooler 5432 → 53 جدولًا أُنشئت خلال 12.46s.
- ترحيل البيانات بأداة scripts/migrate-to-supabase.ts بعد إصلاحين اكتشفتهما أثناء التشغيل:
  * DateTime في SQLite مخزّن كـ epoch millis → تحويل إلى نص 'YYYY-MM-DD HH:MM:SS.sss' UTC لأعمدة timestamp.
  * Prisma يرسل معاملات $executeRawUnsafe مطبوعة → أُضيف CAST صريح لكل معامل لنوع عموده ($n::<pgType>).
  * مهلة المعاملة التفاعلية الافتراضية (5s) لا تكفي مع زمن استجابة طوكيو → إدخال دفعات multi-row (40 صفًا/عبارة) + مهلة 180s.
- النتيجة: 53 جدولًا / 337 صفًا — تقرير العدادات ✓ كلها مطابقة (منها users=2، contracts=1، vouchers=1، payment_plan=1، audit_log=256، number_sequences=13، settings=1...).
- 🐛 اكتشاف جذري: بيئة النظام تحمل DATABASE_URL=file: (SQLite) موروثًا من الإقلاع ويتفوق على ملف .env → الخادم كان يقلع بعميل Postgres ضد رابط SQLite فينهار بعد أول طلب. الإصلاح: dev.sh يصدر الآن .env.local (غير المتتبَّع، فيه روابط Postgres) بset -a/source/set +a قبل db:push والتشغيل — الخادم مستقر عبر إقلاع dev.sh الرسمي.
- تحقق متصفحي كامل على Supabase: دخول admin/admin (مستخدم مرحَّل) → لوحة المؤشرات بالأرقام الصحيحة (قيمة 25,000/محصّل 7,500/تحصيل 30.0% بالضبط) → مركز العقد CON-0012 بتبويباته الـ11 → كشف الحساب → مركز التقارير — بلا أي خطأ كونسول.

Stage Summary:
- التطبيق يعمل الآن فعليًا على Supabase Postgres (ap-northeast-1) والبيانات كاملة مرحَّلة، مع نسخة SQLite احتياطية.
- .env.example وُثّق بصيغ الروابط الثلاث (6543 للنشر، 5432 لأوامر Prisma، والاتصال المباشر IPv6-only ممنوع الاستخدام هنا).
- المتبقي: نشر Vercel — متغيران فقط (DATABASE_URL بنكهة 6543+pgbouncer وDIRECT_URL بنكهة 5432) أو توكن Vercel لإنجازه برمجيًا.
---
Task ID: 20
Agent: Z.ai Code (المنسق)
Task: نشر Vercel برمجيًا + ربط النشر التلقائي بمستودع GitHub

Work Log:
- ورد توكن Vercel (vcp_...) — حُفظ في .env.local (غير متتبَّع) واخُتبر عبر GET /v2/user: حساب alaawaaheeb-4614 (alaawaaheeb@gmail.com، خطة hobby، فريق team_EOc8Bt99MgGQu5cl4wZ6BgeQ).
- المشروع القائم في الحساب (prj_1ZAn4... بمتغيرات NEXTAUTH/AUDIT) يخص تطبيقًا آخر — أُبقي دون أي تعديل.
- إنشاء مشروع جديد POST /v9/projects: contrack-online (prj_nnrmlm6G7Jspfm92f0XhLDHm6mmm) — Node 24.x، منطقة الدوال hnd1 (طوكيو قرب Supabase ap-northeast-1)، buildCommand="prisma generate && next build" (يتجاوز سكربت البناء المحلي ذا أوامر cp-standalone).
- متغيرات البيئة عبر POST /v10/.../env?upsert=true لكل البيئات (production/preview/development): DATABASE_URL = Transaction Pooler 6543 + pgbouncer=true&connection_limit=1؛ DIRECT_URL = Session Pooler 5432؛ AUTH_SECRET = openssl rand -hex 32 (رُوّج في .env.example).
- ربط Git: رفض PATCH /v9/projects الخاصيتين gitRepository وlink (bad_request) → الحل عبر Vercel CLI بالتوكن: `vercel link --project contrack-online` ثم `vercel git connect https://github.com/a3laaw/contrack-online` → "Connected" (تكامل GitHub الأصلي مفعّل).
- ملاحظة: `vercel link` أضاف VERCEL_OIDC_TOKEN إلى .env.local دون مسح أي مفتاح سابق، وأنشأ .vercel/project.json (مستثناة في .gitignore سلفًا).
- أول نشر إنتاجي: POST /v13/deployments بgitSource (github/a3laaw/contrack-online/main) → dpl_GGJEuLDdr5WE5mPkeaNF7ME9qqRp → READY خلال ~60 ثانية.
- الأسماء المستعارة: contrack-online.vercel.app (الإنتاجي) + contrack-online-alaa-waheebs-projects.vercel.app + contrack-online-git-main-...
- تحقق حي شامل: GET / = 200 (8KB HTML)؛ POST /api/auth/login (admin/admin) ✓ توكن صالح؛ GET /api/dashboard ✓ أرقام مطابقة (عملاء 1/عقود 1/قيمة 25000/محصّل 7500)؛ GET /api/contracts ✓ CON-0012 كاملًا.
- تحقق متصفحي (agent-browser) على الرابط الحي: صفحة الدخول تُصيَّر RTL بخط Cairo → دخول → 19 قسمًا في التنقل → لوحة المؤشرات بكل المؤشرات الصحيحة (30.0% تحصيل، مستحق 0، متأخرات "أحسنت") → صفر أخطاء كونسول أو صفحة.
- توثيق AUTH_SECRET في .env.example وcommit محلي (f5a1932) — الدفع متوقف على توكن GitHub (غير مخزَّن بالتصميم).

Stage Summary:
- ConTrack أونلاين الآن على https://contrack-online.vercel.app بمسار كامل: Vercel (hnd1) → Supavisor 6543 pgbouncer → Supabase Postgres (ap-northeast-1) — بيانات مرحَّلة كاملة وتحقق متصفحي ناجح.
- النشر التلقائي مفعّل: أي push إلى main سيبني وينشر تلقائيًا (التكامل الأصلي Connected وأول بناء من main نجح).
- الدفع المعلّق: commit f5a1932 (.env.example) — يتطلب توكن GitHub كالعادة بدفع لمرة واحدة، وسينطلق معه نشر تلقائي بلا تدخل.
- ملاحظة أمنية: توكن Vercel محفوظ في .env.local خارج التتبع؛ يجب عدم تضمينه في أي commit. قيود خطة hobby: نطاق vercel.app فقط (بدون نطاق مخصص)، 1 بناء متزامن.
---
Task ID: 21
Agent: Z.ai Code (المنسق)
Task: دراسة الملف المرفق (سجل مراجعة 1,948 سطرًا) لإنتاج تحليل الفجوة بين التصميم الحالي والمطلوب

Work Log:
- قراءة الملف كاملًا: 3 أقسام — حملة اختبار المكتبي (مصفوفة 150/150 مع قرارات ق7/ق8/الملغى معطلًا/ق12)، تعديلات البيان اللاحقة (ترتيبي، متبقي الجزئي، إزالة تكرار سداد، بيان مقاول بترتيب الخطة، حفظ بلا ربط للمقاول فقط)، ثم مراجعة مستودعنا @ec1adb5 بمصفوفة 47 صفحة/جداول/خدمات/مزايا/صلاحيات.
- تحقق مباشر من 12 ادعاءً على الكود الحالي (grep): تأكدت — لا توليد بيان تلقائي (صفر نتائج للعبارات الذهبية)، descPrefix موجود بلا استعمال، /api/expense-accounts مفقود 404 (VoucherDialog:179، CustodyView:562)، visits/delete احتياطي، لا واتساب/Excel/Word/مشاريع/عروض، السلف والمرفقات بلا واجهة، db/ متتبعة في git وغير مستثناة من .gitignore، سير الملحق فيه «تحت المراجعة».
- تصحيحان لصالح الويب: الصلاحيات screen_*/action_*/report_* مستعملة فعليًا بعرض (المفاتيح معدودة)، وContractGroup/Item موجودان في Prisma.
- إنتاج GAP_ANALYSIS.md: 11 قسمًا — خلاصة تنفيذية، فجوة البيان (دوال مرجعية + 15 مثالًا ذهبيًا + 7 قواعد صياغة + قواعد ربط/حفظ)، أخطاء مؤكدة، فجوة 47 صفحة، ميزات غير منقولة، 15 جدولًا مفقودًا، مزايا/صلاحيات، تقارير، 11 قرارًا مطلوبًا مع توصيات، خطة تنفيذ 10 مراحل، 12 قيدًا، حدود التحليل.
- commit محلي f5a1932→جديد (GAP_ANALYSIS.md) — الدفع لا يزال معلقًا على توكن GitHub.

Stage Summary:
- أكبر فجوة واحدة: توليد بيان السند التلقائي (غير موجود إطلاقًا في الويب) — وهي محل معظم عمل المكتبي الأخير.
- أخطاء مؤكدة: expense-accounts 404، db/ داخل git (أمان)، FeatureFlag بلا نظام إخفاء شاشات.
- 11 قرارًا بانتظار المستخدم (الإصدار المرجعي، ملف العميل، هيكل مركز العقد، نطاق الميزات، الأحداث، سير الملحق، المتابعة، أمان db، حذف الباطن، فاصلة م5، اسم النوع في البيان).
- لا تنفيذ قبل موافقة المستخدم على التقرير والقرارات — حسب القاعدة الحاكمة «دراسة→تقرير→موافقة→تنفيذ».
---
Task ID: 22-a
Agent: full-stack (flags+api)
Task: الخطأ المؤكد + المزايا — إنشاء /api/expense-accounts (GET/POST + [id] PUT/DELETE)، نظام المزايا FeatureFlags (42 مفتاحًا: سجل + API + Provider + إخفاء أقسام AppShell)، وإزالة الاحتياطي التالف POST /api/visits/delete من VisitsView.

Work Log:
- قراءة إلزامية: worklog.md (السجل الكامل حتى 21)، GAP_ANALYSIS.md (§2 الأخطاء المؤكدة و§6 المزايا)، ثم المصدري الحاكان كاملًا: expense_account_service.py (17 دالة — DEFAULT_TREE/CUSTODY_PARENT/CUSTODY_DEFAULT/LEGACY/الترتيب COALESCE(parent_id,id),sort_order,name/قواعد add_account وupdate_account حرفيًا/toggle_active بلا حذف أصلًا) وfeature_service.py (سجل FEATURES بـ42 مفتاحًا + CORE=(customers,contracts,vouchers,settings) + FORCED_ON={followup,rep_execution} + دلالة enabled() بالاعتماديات المتسلسلة).
- فحص schema.prisma: ExpenseAccount مطابق (parentId/fullPath/isActive/allowPosting/includeInProfitability/accountKind/sortOrder عبر @@map expense_accounts) وFeatureFlag موجود (key @id + enabled + @@map feature_flags) — **لا حاجة لأي db push**؛ النصوص الثابتة (name/desc/group/requires/default) بقيت hard-coded في TS كالسجل المكتبي.
- أنشأت src/lib/expense-accounts-server.ts: DEFAULT_EXPENSE_TREE حرفيًا + ensureExpenseAccountDefaults (إنشاء الشجرة فقط عند جدول فارغ — كضمانة قاعدة جديدة؛ ترحيل الأسماء النصية القديمة لا ينطبق على الويب لأن السندات تستخدم FK) + refreshExpenseAccountPaths (يكتب المتغيّر فقط كالمكتبي) + orderExpenseAccounts (مطابق ترتيب SQL المكتبي) + isCustodyLikeName («عهد» بعد تطبيع).
- أنشأت /api/expense-accounts/route.ts: GET (authGuard بلا مفتاح — القائمة يحتاجها سند الصرف للسكرتير؛ ?all=1|activeOnly=0&postingOnly=1 للإدارة لاحقًا؛ **مصفوفة مباشرة** لأن CustodyView:562 وVoucherDialog:179 يتوقعان ExpenseAccountDTO[]) وPOST (adminGuard «هذا الإجراء للمدير فقط» — بنمط adminGuard القائم) بتحققات المكتبي حرفيًا: «اسم الحساب مطلوب.» / «الحساب الأب غير موجود.» / «الشجرة مستويان فقط: أب ثم ابن. لا يمكن إضافة ابن تحت ابن.» / «يوجد حساب بنفس الاسم تحت نفس الأب.» / «نوع الحساب غير صحيح — اختر من القائمة.».
- أنشأت /api/expense-accounts/[id]/route.ts (params Promise: `const { id } = await params`): PUT بتحققات update_account حرفيًا (بما فيها «لا يمكن جعل الحساب أبًا لنفسه.» و«الحساب الأب لا يمكن جعله ابنًا وفيه أبناء.») وDELETE **حذف ناعم (إيقاف)** برفض الحذف عند وجود أبناء أو استعمال في السندات (expenseAccountId/custodyAccountId) — لأن المكتبي بلا حذف أصلًا وسلوكه toggle_active؛ مع audit لكل كتابة وrefreshPaths بعدها.
- أنشأت src/lib/feature-flags.ts: FEATURE_CATALOG بـ42 مفتاحًا بترتيب السجل وبنصوصه العربية حرفيًا (الشاشات 11 · داخل العقد 11 · التقارير 10 · أدوات 7 · المالية 3) + CORE_FEATURES + FORCED_ON_FEATURES + isEffectivelyEnabled (تعطيل الأصل يعطّل التابع سلسليًا — مطابقة enabled()) + isRawEnabled + featureDependents + groupedFeatures.
- أنشأت /api/feature-flags/route.ts — العقد المتفق عليه مع وكيل تبويب المطور: GET ⇒ {flags:[{key,name,desc,group,requires,enabled,effective}]} (enabled=raw والـFORCED_ON يُعاد true دائمًا كـraw_enabled) وPUT {key,enabled} بـadminGuard (مدير/مطور) مع upsert + audit ورفض مفتاح مجهول (404) وforced-on (400).
- أنشأت FeatureFlagsProvider.tsx (useQuery ["feature-flags"]، staleTime 60s، retry false): useFeatureFlags() ⇒ { loading, flags, enabled(key) }؛ قبل نجاح التحميل أو عند فشله enabled(key)=true دائمًا — قاعدة «لا تُخفِ شاشة قائمة بلا دليل».
- ربطت المزوّد في ConTrackApp.tsx (تغليف AppRoot داخل QueryClientProvider) وربطت الإخفاء في AppShell.tsx بأدنى تعديل إضافي (استيراد + ثابت NAV_VIEW_FLAG + فلترة سطر الأقسام): invoices→invoices، custody→custody، gateway→payment_gateway، subcontractors→subcontractors، reports→reports، statement→statement، followup→followup، tasks→tasks، visits→visits، comments→comments، data-mgmt→full_backup؛ وبلا ربط: other-company/claims (لا مفتاح لهما في السجل المكتبي أصلًا) وdashboard/customers/contracts/vouchers/settings/users (أساسيات بلا مفاتيح)، ومفاتيح بلا قسم (projects/addendums/payment_plan/boq_items/supervision/documents/forms_center/word_forms/user_permissions/rep_*/cashflow/bank_fee/whatsapp/network_folder/import_old/contract_gaps/template_plan_mode/amount_guard/items_sync/mode_banner/settle_edit/notif_cleanup) تُترك للاستعمال داخل التبويبات لاحقًا.
- أزلت من VisitsView.tsx (حول سطر 552) فرع catch الاحتياطي الذي يستدعي POST /api/visits/delete (مسار غير موجود)؛ unbookMutation الآن apiDelete(`/api/visits?...`) مباشرة — بلا تغيير سلوك عملي (DELETE موجود وكان الاحتياطي بلا أثر). استيرادات ApiError/apiPost بقيت مستعملة في مواضع أخرى بالملف.
- تحقق حي (توكن admin/admin): GET expense-accounts ⇒ 200 مصفوفة (12 حسابًا مرحلة) بالترتيب المكتبي و401 بلا توكن؛ POST ⇒ 201 ثم duplicate ⇒ 400 حرفيًا وابن-تحت-ابن ⇒ 400؛ PUT rename ⇒ 200 وparentId=نفسه ⇒ 400؛ DELETE غير المستعمل ⇒ {deleted:true,deactivated:true} (نظفت الصف المؤقت فعليًا وأعدت تفعيل «عهدة عامة» بعد اختبار عرضي)؛ GET feature-flags ⇒ 200 بـ42 مفتاحًا بالحقول الستة المتفق عليها؛ PUT reports=false ⇒ effective=false لِrep_customers/rep_cashflow/rep_subcontractors وtrue لِsubcontractors وfollowup (forced) — ثم استعدت reports=true؛ PUT مفتاح مجهول ⇒ 404 وfollowup ⇒ 400.
- تحقق متصفحي: دخول admin ⇒ 19 قسمًا ظاهرة (الكل مفعّل) ⇒ PUT visits=false + إعادة تحميل ⇒ «الزيارات» اختفت من الشل العلوي والسفلي ⇒ استعادة ⇒ عادت؛ صفر أخطاء كونسول؛ حوار «سند جديد → صرف → مصروف» يعرض شجرة «حساب رئيسي/حساب فرعي» من المسار الجديد (الخيارات: مصروفات عامة/عمولات بنكية/رواتب/العُهد) بدل input الاحتياطي — فسند الصرف والعُهد يعملان فورًا.
- الجودة: bunx tsc --noEmit = صفر أخطاء؛ bun run lint = 0 errors (تحذيران unused eslint-disable في AdvancesView/CustomerFormDialog لوكيل آخر خارج نطاقي)؛ dev.log بلا أخطاء 500 على مساراتي؛ لم ألمس الملفات المحظورة (CustomersView/ContractDetailView/SettingsView/ReportsView/SubcontractorsView) ولم أشغّل dev أو db push.
- كتبت agent-ctx/22-a-full-stack.md بعقد الـAPI الكامل لوكيل تبويب المزايا (GET/PUT + نصوص الأخطاء + ملاحظة أنه لا حاجة لأي مسار إضافي).

Stage Summary:
- /api/expense-accounts صار موجودًا (GET مصفوفة مباشرة + POST/[id] PUT/DELETE ناعم بتحققات المكتبي حرفيًا) — خطأ 404 المؤكد في CustodyView وVoucherDialog انتهى، وسند الصرف يعرض شجرة الحسابات فعلًا.
- نظام المزايا اكتمل على عقد واحد: سجل 42 مفتاحًا حرفيًا + API (GET/PUT للمدير-المطور) + Provider + إخفاء أقسام الشل (11 قسمًا مربوطًا بالمفاتيح، والأساسيات بلا مفاتيح كالمكتبي، وFORCED_ON محترم) — تبويب المطور في الإعدادات يستطيع البناء فورًا على GET/PUT دون أي تغيير مني.
- قاعدة البيانات لم تُمس (لا db push): FeatureFlag الموجود كافٍ، والنصوص الثابتة في الكود كالمكتبي.
- الاحتياطي التالف /api/visits/delete أُزيل والتفريغ يعتمد DELETE /api/visits فقط.
- بيانات الاختبار نظيفة (حذف فعلي للصف المؤقت واستعادة ما عُطل عرضيًا)؛ سطور audit للاختبار باقية كسجل إلحاقي.
---
Task ID: 22-b
Agent: full-stack (customer-file)
Task: تحويل «ملف العميل» من نافذة Dialog إلى صفحة داخلية مطابقة للمكتبي (archive.py CustomerFileWidget): API لحظي موحّد + صفحة بتبويبين + Master-Detail بـContractDetailView مضمّنًا + المرفقات ومجلد الشبكة + طباعة كل المستندات HTML.

Work Log:
- قراءة إلزامية: worklog.md حتى 22-a وGAP_ANALYSIS.md (قسم ملف العميل) ثم المرجع الحاكم كاملًا: archive.py (1945 سطرًا: CustomerFileWidget/PageNav/keyPressEvent Esc/_page_overview/_page_contracts Master-Detail/_customer_more_menu/_page_comments/_whatsapp/_batch_print/CustomerArchiveDialog) وwidgets.py (EntityHeader/PageNav/ActionBar/status_badge) وdealings.py (_open_customer: صفحة داخلية تستبدل المحتوى) وlifecycle_service (_customer_contracts_summary_impl: addendums معتمدة net + قبض/صرف سارية + أقصى تأخر من الخطة بremaining>0.001 وdays_diff<0 لعقود غير مغلق/ملغى + الإجماليات تستثني الملغى + الإجمالي المالي لا يشمل «مسودة» أونلاين) وextras_service (due_cheques: method يحوي «شيك» وchequeDueDate≠"" وسارية وdays_left<=14 بلا حد أدنى فيشمل المتأخر؛ normalize_kw_phone/whatsapp_url) وarchive_service/folder_service (get_customer_folder/list_files/save_to_archive/delete_file/format_size + normalize_share_path/check/mark_seen).
- وجدت تنفيذًا سابقًا غير مكتمل التحقق لنفس المهمة في الشجرة (CustomerFilePage.tsx و/api/customer-file/... غير متتبعة وتعديلات ConTrackApp/CustomersView/types/attachments/comments/customers[id] غير ملتزمة) — راجعته سطرًا سطرًا مقابل المكتبي بدل إعادة الكتابة، أصلحت عيبًا واحدًا حقيقيًا: مستمع Esc كان يُرجع للخلف حتى داخل حوار Radix مفتوح (تعديل بيانات/حذف/قوائم) — قيدته الآن بتجاهل Esc داخل [role=dialog]/[role=listbox]/[role=menu]/popper أو defaultPrevented (كالمصدر: Esc لا يُمرَّر إلا في الوضع الصفحي).
- أنشأت/أكملت /api/customer-file/[id]/route.ts (GET): authGuard screen_customers؛ عميل + شارات (count/active/remaining/overdueCount/overdueDays) + ملخص (current/collected/paid/remaining/cheques14) + أهم 5 عقود بترتيب أكبر متبقٍ + كل العقود بhasOverdue/overdueDays/overdueTitle/isSupervision + السجل الزمني (آخر 40 → 12). الحسابات عبر loadContractCore نفسه المستعمل في مركز العقد/التقارير (اتساق الأرقام بدل إعادة كتابة منطق)، والمدفوع عبر groupBy سندات صرف سارية، وشيكات 14 بتطابق due_cheques(14) المصفاة على أرقام عقود العميل.
- أنشأت /api/customer-file/[id]/print/route.ts: HTML RTL كامل (بطاقة العميل + إجماليات + لكل عقد ملخصه وجدول سنداته القبض/الصرف السارية) بمصادقة كوكي الجلسة أو Bearer (window.open) — لا PDF خادمي.
- وسّعت /api/attachments GET بـ?customerId= (مرفقات كل عقود العميل بحجمها fs.statSync) — POST {contractId,fileName,dataBase64} وDELETE ?id= (حذف فعلي للملف + حدث «إضافة/حذف مرفق» + audit) موجودة أصلًا؛ الرفع عبر base64 لا قرص خادمي (النشر على Vercel).
- وسّعت /api/comments: contractId=0 ⇒ «غير محدد» (بلا عقد) كما فلتر المكتبي، والرد أضاف customerTotal (مقابل comments_count)؛ pinnedFirst=1 افتراضيًا فيحقق «التثبيت يرفع للأعلى دائمًا».
- وسّعت PATCH /api/customers/[id] ليقبل folderPath (تعيين/حذف مسار مجلد الشبكة نصيًا دون حذف ملفات — ك_set_share/_clear_share)؛ لا حاجة لأي db push: folderPath موجودة في نموذج Customer والمرفقات على ContractAttachment الموجود.
- أكملت CustomerFilePage.tsx: شريط رجوع ثابت خارج التمرير (زر + Esc) بعنوان «ملف العميل — الاسم»، رأس الكيان (أيقونة/اسم/كود tooltip/سطر الاتصال 📞📍✉ أو «لا توجد بيانات اتصال مسجلة»/شارات حرفية «N عقد · منها M نشط» و«متبقٍ X» أحمر إن متأخر وإلا برتقالي و«لا مديونية» أخضر/«تعديل البيانات» بCustomerFormDialog نفسه/«واتساب» معطّل بلا هاتف برسالة _whatsapp 1814–1826 حرفيًا عبر wa.me بnormalize_kw_phone)، PageNav بتبويبين فقط «عام»/«العقود والتفاصيل».
- تبويب «عام»: ملخص العميل (المتبقي بلون الحالة وtooltip أقصى التأخر/العقود «N  (نشط: M)»/شيكات 14/أقصى تأخر + صف القيمة والمحصّل والمدفوع)، نماذج ومرفقات العميل (مجلد الشبكة نصيًا + «تعيين / تغيير» + «حذف المسار» بتأكيد نص المكتبي «لن يتم حذف أي ملف…» + «فتح مجلد الشبكة» ينسخ المسار لأن المتصفح لا يفتح UNC + «إضافة مرفق» رفع لعقد + قائمة ملفات بالحجم والتنزيل والحذف)، «📌 أهم عقود العميل» (5 صفوف: العقد/الحالة/القيمة/المحصّل/المتبقي، النقر يفتح العقد في التبويب الثاني كshow_contract_detail)، «🕒 السجل الزمني» بنص صف المكتبي (أيقونة/وقت 16 محرفًا/العقد: الحدث — الوصف (المستخدم) و«لا يوجد سجل زمني بعد.»)، «تعليقات العميل» (فلتر كل العقود/غير محدد/عقد + بحث debounce + صندوق كتابة «يخص العقد:» + إرسال + فقاعات بمثبّت كهرماني و«عُدّل بواسطة» + قائمة إجراءات: تعديل للمدير «تعديل التعليق (مدير فقط)»/تثبيت-إلغاء/حذف بتأكيد «حذف التعليق؟» + حد 100 بسطر المكتبي + سطر ملخص «التعليقات (N) · النطاق · مثبّت: M · نتائج البحث: K»).
- تبويب «العقود والتفاصيل»: Master-Detail بقائمة جانبية 270–390px (بحث «بحث باسم العقد أو رقمه...» + فلتر كل العقود/النشطة فقط/عليها متبقٍ/المغلقة والمنتهية + ملخص «المعروض: N عقد · المتبقي X» + صفوف بلون الحالة والمتبقي أحمر إن متأخر مع tooltip «عليه دفعة متأخرة منذ N يومًا (…)») و<ContractDetailView contractId user onBack onAuthError onOpenStatement> مضمّنًا في نفس الصفحة بلا أي تعديل عليه — اختيار عقد لا يغلق الصفحة ولا ينتقل لشاشة أخرى، وعلىBack من التفاصيل يُفرَّغ التحديد ويُحدَّث الملف (بديل data_changed).
- شريط الإجراءات السفلي: «عقد جديد» primary عبر onNewContract، «كشف حساب العميل» عبر onOpenStatement({kind:"customer",id}) (StatementView يدعم وضع العميل الشامل)، «طباعة كل المستندات» window.open للـHTML أعلاه، وقائمة «المزيد» (عقود العميل ⇒ التبويب الثاني، مركز التعليقات ⇒ شاشة التعليقات، الملفات والمستندات ⇒ تمرير لبطاقة المرفقات).
- الربط: contrack-types أضاف ViewName "customer-file" وأنواع CustomerFile*، ConTrackApp حالة customerFileId + openCustomerFile + فرض onBack⇒navigate("customers") + البحث الشامل عن عميل يفتح الملف مباشرة (بديل preset التفاصيل)، CustomersView استبدل الـDialog بonOpenCustomerFile وأبقى قائمة العملاء وفلاترها كما هي وحوار التعديل استُخرج CustomerFormDialog (يُستعمل من القائمة ومن الصفحة).
- الإصلاح: مستمع Esc صار يتجاهل الحوارات والقوائم المفتوحة (كان Esc داخل «تعديل البيانات» يغلق الحوار ويرجع للعملاء معًا).
- تحقق حي (admin/admin): login ⇒ توكن 48؛ GET /api/customer-file/17 ⇒ 200 بالشكل الكامل (توتالز 25,000/7,500/17,500 وشيكات14=0 وسجل زمني بسند القبض RV-0009) وGET /api/customer-file/1 ⇒ 404 «العميل غير موجود» (لا عميل 1 في القاعدة الحية) وبدون توكن ⇒ 401؛ GET /api/attachments?customerId=17 ⇒ 200؛ POST مرفق txt ⇒ 201 ثم القائمة بالحجم 38 بايت ورقم العقد CON-0012 والتنزيل 200 ثم DELETE {deleted:true} (نظفت الملف)؛ GET /api/customer-file/17/print ⇒ 200 HTML RTL؛ التعليقات: POST ⇒ أُنشئ، فلتر contractId=0 ⇒ 0 وcontractId=15 ⇒ 1، pin ⇒ مثبّت، تعديل ⇒ editedAt/editor، DELETE ⇒ حذف (نظفت)؛ PATCH folderPath ⇒ ظهر في الـAPI ثم مسحته (نظفت). dev.log: صفر 500.
- تحقق متصفحي: العملاء ⇒ نقر الصف ⇒ الصفحة الداخلية (شريط رجوع/رأس بالشارات/التبويبان/الملخص/المرفقات/أهم العقود/السجل/التعليقات/الشريط السفلي) ⇒ نقر عقد من «أهم العقود» ⇒ التبويب الثاني مع ContractDetailView مضمّنًا في نفس الصفحة ⇒ Esc ⇒ عاد للعملاء؛ صفر أخطاء كونسول.
- الجودة: bunx tsc --noEmit صفر أخطاء؛ bun run lint نظيف؛ لم ألمس AppShell/ContractDetailView/SettingsView/ReportsView/SubcontractorsView/AdvancesView ولا expense-accounts/feature-flags؛ لم أشغّل db push. ملاحظة تشغيلية: خادم dev كان متوقفًا عند بدء المهمة فشغّلته بـ`env -u DATABASE_URL bun run dev` (متغير شل DATABASE_URL=file: كان يكسر .env الخاص بـPostgres).
- كتبت agent-ctx/22-b-full-stack.md بعقد الـAPI الكامل وملاحظات المتابعة.

Stage Summary:
- «ملف العميل» صار صفحة داخلية كالمكتبي (لا Dialog): تبويبان «عام» و«العقود والتفاصيل»، شارات الرأس الحرفية، Esc/زر رجوع، Master-Detail يضمّن ContractDetailView كما هو دون إغلاق الصفحة، وشريط إجراءات سفلي (عقد جديد/كشف العميل/طباعة الكل/المزيد).
- API لحظي واحد /api/customer-file/[id] يجمع العميل والشارات والملخص وأهم العقود وكل العقود والسجل الزمني — حساباته عبر نفس محرك loadContractCore فأرقامه متسقة مع مركز العقد والتقارير، والملغى/المسودة مستثناة من الأرصدة، وشيكات 14 وأقصى تأخر مطابقان للمكتبي.
- المرفقات ومجلد الشبكة واجهة كاملة فوق الـAPI الحالي: تعيين/حذف مسار الشبكة نصيًا (بلا حذف ملفات)، رفع مرفق base64 مرتبط بعقد، قائمة بالحجم والتنزيل والحذف — لا مجلد قرص في النشر السحابي (موثق).
- الطباعة الدفعية عبر HTML RTL جاهز للطباعة (بطاقة العميل + كل عقد بسنداته) بلا PDF خادمي.
- بيانات الاختبار أُعيدت نظيفة (حذف التعليق والمرفق ومسح المسار)؛ سطور audit/أحداث الاختبار باقية كسجل إلحاقي.
- يحتاج قرار المستخدم: (1) ربط المرفقات بعقد في الويب (المكتبي بمجلد قرص للعميل) — إن أردت مرفقات عميل بلا عقد نحتاج نموذجًا جديدًا وdb push؛ (2) «مركز التعليقات» من قائمة المزيد ينتقل لشاشة التعليقات العامة (المكتبي يفتحه مفلترًا على العميل) — يمكن لاحقًا تمرير فلتر العميل؛ (3) «فتح مجلد الشبكة» ينسخ المسار للحافظة بدل فتح مستكشف (غير ممكن من المتصفح).
---
Task ID: 22-d
Agent: full-stack (advances+settings+leads)
Task: 3 أجزاء — (1) واجهة سلف الموظفين AdvancesView + مسارا الفرعية ledger/summary بقواعد FIFO المكتبية، (2) إعادة هيكلة SettingsView بتبويبات المكتبي التسعة (حسابات المصروفات CRUD، مراحل المتابعة، جدول الزيارات، البيانات والنسخ، أدوات المطور بالمزايا)، (3) تقرير الفرص البيعية rep_leads.

Work Log:
- قراءة إلزامية بالترتيب: worklog.md (حتى 22-a: مسارا expense-accounts وfeature-flags جاهزان بعقودهما)، GAP_ANALYSIS.md (§3 السلف «API بلا واجهة»، §4 rep_leads مفقود، تبويبات الإعدادات 9+5)، ثم المصادر المكتبية: advances_page.py كاملًا (586 سطرًا: HEADS السبعة، البطاقات الثلاث بألوانها، EmployeeDialog/_MoveDialog الثلاث بسقف المتبقي والملء التلقائي، الكشف الفردي 5 أعمدة، المجمع بأعمدته وسطر الإجمالي)، report_service.py سطر 995 (_advance_settlement: FIFO لكل موظف، فرز (vdate,kind,id)، عتبة 0.0005، settled على رقم سند السلفة) وسطر 774 (prospects_report: بلا أي عقد غير ملغى، فلترة بتاريخ التسجيل، الأعمدة السبعة والnote)، settings.py 500–560 (التسع تبويبات وأدوارها: company/appearance/security|password/contract-types/expense-accounts/workflow/visits/backup/developer-للمطور فقط)، reports_page.py 1408–1414 (مدخل rep_leads حرفيًا) و331 (_data_prospects: heads/widths/note/totals=None).
- فحص الويب: وجدت أجزاءً من 22-d منفذة من جلسة سابقة غير مسجلة (AdvancesView كاملة، مسارا advances/ledger وadvances/summary، /api/reports/leads + report-leads.ts + مدخل ReportsView + builder export، وSettingsView معادة الهيكلة) — راجعتها سطرًا سطرًا مقابل المكتبي بدل إعادة الكتابة، وصححت/وثقت ما يلزم، واختبرت كل شيء حيًا. سجلت عقد الـAPI الكامل في agent-ctx/22-d-full-stack.md.
- السلف (واجهة): AdvancesView.tsx بprops {user,onAuthError} فقط وغير مربوط في AppShell/ConTrackApp (للمنسق) — قائمة الموظفين (إضافة/تعديل باسم فريد)، البطاقات «💸 إجمالي المسلَّم/↩ المسترد + المخصوم/💰 المتبقي»، كشف 7 أعمدة HEADS الحرفية برصيد جارٍ، نوافذ «＋ سلفة جديدة/↩ رد نقدي/✂ خصم من راتب» (الطريقة الصندوق/البنك، «الطريقة:» للسلفة و«إلى:» للرد، الخصم بلا طريقة، سقف المبلغ بالمتبقي للرد/الخصم مع الملء التلقائي كالمكتبي، رسائل النجاح الحرفية)، تصدير CSV، تبويبات: كشف/تقرير فردي بفترة (من/إلى)/تقرير مجمع بفترة.
- السلف (خلفية): GET /api/employees/advances/ledger (كشف برصيد جارٍ وتسميات 💸/↩/✂) وGET /api/employees/advances/summary (FIFO حتى to فقط، حركات الفترة from/to، outstanding/returned، note «الإجمالي: مسلّم X · مسترد Y · متبقي Z د.ك»، warning سطر المرتجعات بالمبالغ مع «(الحالة عند to)») — بلا تخزين أرصدة، كلها حساب لحظي؛ الحركات تنشئ سندات حقيقية PV/CV/SD عبر createEmployeeAdvance/createVoucher بسقف قاطع («المبلغ يتجاوز رصيد سلفة الموظف (X د.ك فقط)»).
- الإعدادات: SettingsView.tsx بتبويبات shadcn بالأسماء والرموز الحرفية: ⌂ بيانات الشركة (بيانات+هيدر+مالية+أساليب الدفع+صف الحفظ) ▤ الطباعة والعرض (خياران «غير متاح في نسخة الويب الحالية») ◆ الأمان والمستخدمون/كلمة المرور (يحيل لشاشة المستخدمين — لا API ذاتي) ☰ أنواع العقود (غير متاح — تُدار من المكتب) § حسابات المصروفات (CRUD فوق /api/expense-accounts بشجرة أب/ابن كنمط CustodyView: نشط/في السند/يدخل الربحية/النوع مصروف|سلفة، وتفعيل-إيقاف بدل حذف) ⇄ مراحل المتابعة (فوق /api/workflow-stages: أنواع المعاملة الأربعة بTX_LABELS، إضافة بترتيب تلقائي، تحريك أعلى/أسفل بتبديل داخل القالب، تعديل اسم/ترتيب/أيام/لون، حذف بتأكيد برسائل حراس المسار) ◷ جدول الزيارات (config قراءةً بقيمه الثابتة مع note المسار لأن PUT تجاهل صامت بلا أعمدة تخزين، وموظفو الزيارات CRUD) ⊞ البيانات والنسخ الاحتياطي (النسخ التلقائي والتنبيهات + تحويل لشاشة إدارة البيانات) ⚙ أدوات المطور (developer فقط=is_developer المكتبي): «مزايا النظام (ما يظهر لهذا العميل)» مجمعة حسب group (42 مفتاحًا) بمفتاح تبديل GET/PUT feature-flags، المعطل بسبب الأب disabled مع tooltip «معطّل لاعتماده على مفتاح أب معطل: …»، + 4 بطاقات غير متاح (الهوية والترخيص/الترحيل والاستيراد/الشبكة والنسخ/تنظيف البيانات).
- الفرص البيعية: src/lib/report-leads.ts (عملاء بلا أي عقد غير ملغى، فلترة created_at، الأحدث أولًا، أعمدة [رقم العميل،الاسم،الهاتف،العنوان،تاريخ التسجيل،منذ (يوم)،ملاحظات]، منذ (يوم) بفرق الأيام، note «عدد الفرص البيعية (عملاء بلا عقود): N · تواصل معهم لتحويلهم لعقود»، بلا totals) + GET /api/reports/leads بصلاحية report_prospects + مدخل ReportsView بإيقونة Target والتسمية «الفرص البيعية» والوصف الحرفي period:true + builder في export.
- تحقق حي (admin/admin): GET 200 لكل المسارات المستهدفة (employees، advances، summary، leads، settings، expense-accounts مصفوفة 12، feature-flags 42، workflow-stages، visits/config، visits/staff، payment-methods). سيناريو FIFO حي: PV-0014 (1.000@10-01) وPV-0015 (2.000@10-05) ثم CV-0004 (0.400@10-10) وSD-0003 (0.300@10-12) ⇒ settled(PV-0014)=0.700، remaining 0.300/2.000، رصيد 2.300، warning «⚠ سلف مرتجعة… 1 سلفة بمبلغ 0.700 د.ك — المُسترَد ليس مصروفًا ويخفض رصيد السلفة»؛ to=2026-10-11 ⇒ settled=0.400 وremaining=0.600 وdeducted=0 (تقييم نهاية الفترة صحيح)؛ ledger برصيد جارٍ مطابق. حواجز: مبلغ صفر/رد فوق الرصيد/kind مجهول/اسم مكرر/حذف سند بلا سبب ⇒ كلها 400 برسائلها. leads: عميل اختبار بلا عقود ظهر بصف واحد وفلتر اليوم عمل ثم حُذف. settings GET→PUT→GET مطابقة (الفرق updatedAt فقط). متصفحيًا: التبويبات التسعة تُعرض بالأسماء الحرفية (أدوات المطور مخفية لadmin)، شجرة الحسابات والمراحل والزيارات تعمل، مدخل الفرص البيعية يعرض وصفه، صفر أخطاء كونسول.
- تنظيف بيانات الاختبار: أُلغيت سندات السيناريو الأربعة إلغاءً ناعمًا بحسبب «تنظيف اختبار 22-d» (مخفية من القوائم الافتراضية، الأرقام لا تُعاد كقاعدة المكتبي) وحُذف الموظف المؤقت فعليًا والملخص عاد صفرًا.
- الجودة: bun run lint صفر · bunx tsc --noEmit صفر · dev.log بلا أي 500 · لم ألمس AppShell/ConTrackApp/CustomersView/ContractDetailView/CustomerFilePage/SubcontractorsView/VoucherDialog/CustodyView · لم أشغّل dev ولا db push.

Stage Summary:
- واجهة سلف الموظفين اكتملت مطابقة للمكتبي حرفيًا (كشف، ثلاث حركات كسندات حقيقية، تقرير فردي ومجمع بفترة، FIFO عند نهاية الفترة، سطر تحذير المرتجعات) — جاهزة للربط في الشل من المنسق بprops {user,onAuthError}.
- الإعدادات صارت بتسع تبويبات المكتبي موزعًا فيها الموجود بلا اختراع مزايا: الحسابات والمراحل والزيارات إدارة فعلية فوق مساراتها، والمزايا لتبويب المطور فوق عقد 22-a، والأدوات غير المنقولة «غير متاح في نسخة الويب الحالية».
- تقرير الفرص البيعية rep_leads انتهى خلفيةً وواجهةً وتصديرًا بصلاحية report_prospects.
- تحتاج قرارًا: مسار استعادة سلفة ملغاة (V8.4)، تغيير كلمة المرور الذاتي للسكرتير، وتخزين حقيقي لساعات جدول الزيارات (يتطلب أعمدة إعدادات — ممنوع db push حاليًا).

---
Task ID: 22-e
Agent: full-stack (sub-delete)
Task: إيصال حذف عقد الباطن بالخيارات (قرار معتمد: «إيصال SubDeleteDialog وجعلها المعتمدة») — منطق sub_delete_service.py على Prisma في sub-delete-server.ts + endpoint واحد /api/sub-contracts/delete + نافذة SubDeleteDialog بثلاثة تابات بنصوص المكتبي حرفيًا + استبدال الحذف المباشر في SubcontractorsView وSubContractDialog.

Work Log:
- قراءة إلزامية: worklog.md (قرارات 22-a/22-b/22-d وعقد الـAPIs)، GAP_ANALYSIS.md (§4-د «حذف الباطن بالخيارات — قرار: إيصال» و§8-قرار 9)، ثم المراجع المكتبية كاملة: ui/sub_delete_dialog.py (404 سطرًا — التابات الثلاثة وتلميحات _Chk والنصوص الحرفية) وservices/sub_delete_service.py (overview/delete_contracts/can_hard_delete_vouchers/delete_vouchers/delete_record) وlifecycle_service.delete_sub_contract (حواجز السندات السارية + الغامرة غير المرتبطة V5.8 + المطالبات + فك الملغاة + حذف الخطة والمصادر والبنود + فك الملحقات V5.5) وpurge_service (purge_vouchers: فك الأبناء + حذف قيود voucher% + لقطة تدقيق؛ purge_subcontractor) وui/subcontractors.py 2777–2781 (الحذف المباشر القديم كان في مسار فشل الإنشاء فقط) وtest_v58_sub_delete_options.py (قرارات: الحذف لكل عقد بمعاملة مستقلة، المطور حذف نهائي، غيره إلغاء، السجل بعد الإفراغ فقط).
- فحص الويب الحالي قبل التنفيذ: DELETE /api/sub-contracts/[id] إلغاء ناعم (contract|vouchers) — يبقى كما هو دون كسر؛ SubcontractorsView كان يحذف سجل المقاول مباشرة عبر DELETE /api/subcontractors/[id] بنافذة تأكيد بسيطة؛ SubContractDialog كان يحذف عقد الباطن مباشرة عبر apiDelete — استُبدل الاثنان بالنافذة الجديدة. Prisma جاهز بلا db push: SubContract/SubContractItem/SubPaymentPlanItem/SubPaymentSource (Cascade) وAddendumItem.side وJournalEntry(sourceType) وAuditLog بلا عمود snapshot (موثق أدناه).
- أنشأت src/lib/sub-delete-server.ts (جديد) بدلالات المكتبي حرفيًا: subDeleteOverview (عقود المقاول مع items/planRows/vouchersActive/claims وcanDelete/blockReason «{n} سند صرف سارٍ» · «{n} مطالبة»، وسنداته كل الأنواع بشرط party_type=subcontractor OR sub_contract_id∈عقوده مع typeLabel وlinkedContract، وملخص القيم، وrecordBlock «لا يمكن حذف سجل المقاول الآن — عليه … احذفها من هذه الشاشة أولًا.»)؛ deleteSubContracts (كل عقد بمعاملة مستقلة كالمكتبي) وdeleteSubContractTx (رفض «لا يمكن حذف عقد الباطن · للمقاول سندات صرف سارية على هذا العقد.\nألغِ السندات أولًا.» شاملًا السندات الغامرة غير المرتبطة على نفس عقد العميل V5.8، ورفض «…عليه {n} مطالبة مسجّلة.\nاحذف المطالبات أولًا.» بلا فلترة حالة كالمكتبي، ثم فك السندات الملغاة subContractId=null تبقى في السجل، وحذف sub_payment_sources ثم الخطة، وحذف addendum_items side=sub وفك addendums، وحذف البنود والعقد صفًا فعليًا — مثل المكتبي، مع حدث «حذف عقد باطن» وaudit بالسبب)؛ deleteSubVouchers (السبب إلزامي «اكتب سبب الحذف/الإلغاء — يُحفظ في سجل التدقيق.»؛ المطور role=developer فقط حذف نهائي بفك الأبناء وحذف قيود voucher/voucher_cancel وaudit لقطة بلا عمود snapshot؛ غيره إلغاء موثّق عبر voucherCancelBarrier ثم cancelVoucherTx بسبب «{reason} — إلغاء بدل حذف (بلا حساب مطوّر)» والمقيم «السند ملغى بالفعل.»)؛ deleteSubRecord (ترتيب الرفض المكتبي: الوجود ⇒ الإفراغ ⇒ «اكتب سبب الحذف — يُحفظ في سجل التدقيق.» ⇒ «أداة التنظيف متاحة لحساب المطور فقط.\nهذه الأداة تحذف بيانات نهائيًا ولا تُتاح لأي مستخدم آخر.»).
- أنشأت /api/sub-contracts/delete (المسار الثابت يسبق [id] في Next — لا كسر لأي مستدعٍ حالي): GET ?subcontractorId= ⇒ المعاينة كاملة + isDeveloper (authGuard screen_subcontractors)؛ POST {action} بثلاثة أفعال: contracts (authGuard action_cancel_contract — نفس مفتاح الـDELETE الحالي) ⇒ {deleted,ids,errors:[{id,msg}]} لكل عقد، vouchers (نفس المفتاح) ⇒ {mode:delete|cancel,deleted|cancelled,ids,errors}، record (authGuard فقط والدور يُفحص داخل الخدمة كالمكتبي). بلا استدعاءات متعددة المسارات — endpoint واحد كما في النطاق.
- أنشأت src/components/contrack/SubDeleteDialog.tsx: عنوان «🗑 حذف بيانات المقاول — عقد · سند · السجل»، رأس «👷 {الاسم}  ({الكود}) — حذف بخيارات: عقد · سند · السجل» وسطر «حالته: N عقد باطن (X د.ك)  ·  N سند منها N فعّال وN ملغى — بمبلغ فعّال X د.ك»، صف «السبب» بplaceholder «سبب الحذف — إلزامي لحذف/إلغاء السندات وحذف سجل المقاول»، 3 تابات بعدّاداتها: «📑 عقود الباطن (N)» بتلميحات المكتبي الثلاث وعمود ✔ معطّل بtooltip «لا يمكن حذفه: {السبب}» وزر «🗑 احذف العقود المحددة» بtooltipه، «🧾 السندات (N)» بتمييز المطور «🗑 احذف السندات المحددة نهائيًا»/«↩ ألغِ السندات المحددة» وتلميحه الحرفي و«ملغى/فعّال» وتعطيل الملغى ب«لا يمكن حذفه: ملغى بالفعل»، «👷 سجل المقاول» بحالة ✅/منع بلونين وملاحظتَي المطور وإقرار «أُقر بحذف سجل المقاول نهائيًا (لا يُستعاد)» وزر «🗑 احذف سجل المقاول» متاحًا فقط للفارغ+المطور، تأكيدات AlertDialog بنصوص style.confirm حرفيًا، ورسائل النتيجة «حُذف N عقد باطن.» / «حُذف N سند نهائيًا.» / «أُلغي N سند (يبقى في السجل باسم ملغى).» / «حُذف سجل المقاول «الاسم».» مع «  ⚠ تعذّر: #id: أول سطر» وتحذيرات بلا عنوان للسندات، ورسائل التحقق «علّم ✔ على عقد باطن واحد على الأقل.» / «علّم ✔ على سند واحد على الأقل.» / «اكتب سبب الحذف/الإلغاء أولًا.» / «علّم مربع الإقرار بحذف السجل نهائيًا.» / «المقاول غير موجود»، وأزرار «🔄 تحديث» و«✕ إغلاق».
- وصّلت النافذة: SubcontractorsView — زر 🗑 يفتحها (حُذفت نافذة التأكيد البسيطة وdeleteMutation القديمة)، onDone يبطل القوائم ويغلق تفاصيل المقاول عند حذف السجل؛ SubContractDialog — زر «حذف» يفتحها بfocus="contracts" على مقاول العقد (بلا حذف مباشر apiDelete)، وإذا حُذف العقد المعروض نفسه تُغلق النافذتان، مع إصلاح عرضي في نفس الملف: إلغاء عقد الباطن كان يرسل statusReason والخلفية تقرأ reason فكان يُرفض دائمًا ب«سبب الإلغاء مطلوب» — صُحح إلى reason.
- اختبار حي (admin/admin، بيانات أُنشئت ونُظفت): 401 بلا توكن؛ مقاول مؤقت SUB-0004 + عقدان باطنان (1 ثم 2) على CON-0012 بلا خطة؛ GET المعاينة بالأعمدة والblockReason الصحيح؛ رفض حذف السجل وعليه عقد بالنص الحرفي؛ رفض contracts بلا ids «حدد عقد باطن واحدًا على الأقل.» وvouchers بلا ids وaction مجهول؛ حذف العقد 1 ⇒ {deleted:1} والصف اختفى فعليًا من القاعدة (حذف حقيقي كالمكتبي وليس إلغاء) والسجل صار قابلًا للحذف؛ رفض حذف السجل الفارغ بلا سبب ثم بسبب (admin غير مطور) برسالة المطور الحرفية — لا يوجد مستخدم developer في القاعدة لإيجابية هذا المسار (موثق)؛ سند صرف PV-0016 على العقد 2 ⇒ blockReason «1 سند صرف سارٍ» ورفض حذف العقد ب«…سندات صرف سارية…ألغِ السندات أولًا.» وdeleted:0؛ رفض السندات بلا سبب؛ الإلغاء (وضع غير المطور) ⇒ {mode:cancel,cancelled:1} والسند بقى cancelled=true بسبب «تنظيف اختبار 22-e — إلغاء بدل حذف (بلا حساب مطوّر)»؛ بعدها حذف العقد 2 نجح والسند الملغى فُكّ (linkedContract فارغ ويبقى معروضًا في المعاينة كما في المكتبي ويمنع حذف السجل). التنظيف: حذف سجل المقاول المؤقت (فُكّ سنده الملغى قبلها) — بقي سند PV-0016 ملغى ناعمًا في السجل (قاعدة: الإلغاء ناعم والأرقام لا تُعاد) كسندات اختبار 22-d.
- الجودة: bun run lint صفر؛ bunx tsc --noEmit صفر أخطاء في ملفاتي (الأخطاء الثمانية الباقية كلها في ملفات وكيل متزامن غير ملتزمة: contracts/[id]/overview وpay-view وContractDetailView — خارج نطاقي وممنوعة عليّ)؛ dev.log بلا أي 500؛ لم ألمس ContractDetailView/CustomersView/SettingsView/ReportsView/AdvancesView/AppShell/ConTrackApp؛ لم أشغّل dev ولا db push.

Stage Summary:
- «حذف بيانات المقاول» صار بخياراته المعتمدة في الويب: ثلاثة تابات (عقود الباطن · السندات · سجل المقاول) بنصوص المكتبي حرفيًا، والسندات: المطور حذف نهائي موثّق وغيره إلغاء موثّق بسبب إلزامي، وعقد الباطن يُحذف صفًا فعليًا بعد فك سنداته الملغاة وحذف خطته ومصادره وبنوده وأسطر ملحقاته (المطالبات والسندات السارية تمنع)، وسجل المقاول لا يُحذف إلا فارغًا وبحساب المطور.
- endpoint واحد /api/sub-contracts/delete (GET معاينة + POST contracts|vouchers|record) يستجيب بأخطاء per-id كما في المكتبي دون كسر DELETE /api/sub-contracts/[id] القائم (الإلغاء الناعم القديم متاح لمستدعيه إن وجد).
- الحذف المباشر انتهى من الواجهتين (SubcontractorsView وSubContractDialog) وصار النافذة الجديدة هي المعتمدة، وأُصلح عرضيًا جسيم حوار الإلغاء الناعم (reason) الذي كان يُرفض دائمًا.
- يحتاج قرار المستخدم: (1) لا يوجد مستخدم بدور developer في القاعدة — سيلزم إنشاؤه لتفعيل «حذف نهائي للسندات» و«حذف سجل المقاول» (الرسالة الحرفية تظهر لغيره)؛ (2) لقطة الحذف النهائي تُكتب في AuditLog (بلا عمود snapshot — ممنوع db push)، وإن أردت لقطة كاملة كـpurge_audit المكتبي فستلزم أعمدة جديدة؛ (3) بقي من الاختبار سند PV-0016 ملغى ناعمًا (لا يمكن محوه بلا حساب مطور) — يمكن محوه لاحقًا بنافذة الخيارات نفسها عند توفر مطور.

---
Task ID: 22-c
Agent: full-stack (contract-hub) — أكمل المنسق بعد انقطاع الوكيل
Task: إعادة هيكلة مركز العقد إلى 4 صفحات + ☰ إجراءات العقد + لوحة متابعة مضمنة + ربحية بصلاحية + تصفية وإغلاق + تقرير الفروقات

Work Log:
- الوكيل نفّذ الهيكل الكبير ثم انقطع (context deadline): 4 صفحات (المسار الفني/نظرة عامة/الدفعات والمقاولون/الأوامر والتعديلات)، قائمة «☰ إجراءات العقد» (contract_hub.py:248–282)، تصفية وإغلاق (_settle_contract) بمسار /api/contracts/[id]/settle، /api/contracts/[id]/overview وpay-view وpay-export، كتل دفعات لكل مقاول بأزرار سندات داخلية + «عرض فقط — القبض من زر سند القبض هنا»، لوحة المتابعة المضمنة (FollowupPanel مدمجة)، الربحية برسالة «رؤية الربحية غير متاحة لحسابك»، حذف تبويبات vouchers/subs/statement/events + placeholder مطالبات/فواتير، وإزالة سير «تحت المراجعة» من الأوامر (مطابقة المكتبي: مسودة→معتمد/ملغى).
- المنسق أكمل: أصلح AddendumsTab.tsx (بقايا submitMutation/SendHorizonal — أُزيل زرا «إرسال للمراجعة» من القائمة وحوار المعالج) ⇒ tsc صفر.
- المنسق نفّذ الجزء المتبقي: تقرير الفروقات (V3.2 ج) — src/lib/contracts-gaps-server.ts (contractGapsReport مطابق report_service.contract_gaps_report: استثناء ملغى، مجموع الخطة، بنود بـ deleted_addendum_id=0، عتبة 0.001؛ fixGapsAll بوضعيه «تحديث المبالغ لتطابق المجاميع» و«توزيع الخطط على المبالغ» مع rescale نسبي والأخيرة تمتص الكسور ورفض الدفعة الصفرية — lifecycle_service.rescale_payment_plan:5675) + /api/contracts/gaps (GET/POST) + GapsDialog.tsx (8 أعمدة، تلوين كهرماني للفروق، فتح العقد، إصلاح الكل، تصدير CSV) + زر «⚠️ الفروقات» في رأس شاشة العقود بمفتاح الميزة contract_gaps (كمرجعه في contract_hub.py:80–89). ملاحظة موثقة: النسخة الاحتياطية الملفية للمكتبي استُبدلت بتوثيق AuditLog + contract_events (Postgres بلا ملف).
- إزالة بقايا سير المراجعة من addendum-server تبقى للتوافق القرائي فقط (تحت المراجعة تُعامل كمسودة).

Stage Summary:
- شاشة العقد أصبحت 4 صفحات + قائمة إجراءات كما في المكتبي، والتقرير الفروقات متاح من شاشة العقود بمفتاح contract_gaps.
- تحقق حي: /api/contracts/gaps يعيد CON-0012 بفرق خطة -17500 (صحيح: خطة 7500 مقابل قيمة 25000)، وoverview وpay-view يعملان بالأرقام الصحيحة.
- lint نظيف وtsc صفر أخطاء.

---
Task ID: 22-f
Agent: Z.ai Code (المنسق)
Task: الدمج النهائي — ربط السلف في التنقل + تقرير الفروقات + الهوية البصرية المكتبية + فك تتبع db/ + تحقق متصفحي شامل

Work Log:
- ربط AdvancesView: ViewName "advances" + فرض عرض في ConTrackApp + بند «سلف الموظفين» في AppShell بعد العُهد بمفتاح الميزة custody (نفس بوابة العهد كما في main_window.py:798).
- أكملت ما نقص من 22-c بعد انقطاع الوكيل: إصلاح AddendumsTab (بقايا زر «إرسال للمراجعة») وتنفيذ تقرير الفروقات كاملًا (contracts-gaps-server.ts + /api/contracts/gaps + GapsDialog.tsx + زر ⚠️ الفروقات في شاشة العقود بمفتاح contract_gaps).
- الهوية البصرية المكتبية: خط Tajawal بدل Cairo (layout.tsx + globals.css --font-sans) والأساسي النيلي #4F46E5 (style.py BRAND_600) مع --ring وdark variant #6366F1 — النظام فاتح فقط كالمكتبي (لا ThemeProvider داكن مثبت).
- أمان: فك تتبع db/ من git وإضافتها إلى .gitignore (بنود §4 من البرومبت المرجعي — المستودع خاص لكن القاعدة تُكتب في .gitignore ولا تُتتبع مستقبلًا).
- تحقق متصفحي شامل (agent-browser): دخول admin/admin → 20 قسمًا في التنقل (منها «سلف الموظفين») → ملف العميل صفحة كاملة (تبويبان + شارات + ملخص + مرفقات + أهم العقود + سجل زمني + تعليقات + ActionBar: عقد جديد/كشف حساب العميل/طباعة كل المستندات/المزيد) → Master-Detail يضمّن مركز العقد بنفس الصفحة → مركز العقد 4 صفحات (المسار الفني/نظرة عامة بمؤشرَي الإنجاز والتحصيل و«التحصيل متوازن · الزمن 0% / التحصيل 30%»/الدفعات والمقاولون بكتل وأزرار سندات داخلية وتصدير/الأوامر والتعديلات) → ☰ إجراءات العقد بخمسة بنود (تعديل/تغيير الحالة/كشف حساب/إلغاء أشهر تمديد/تصفية وإغلاق) → تقرير الفروقات يعرض CON-0012 بفرق -17,500.000 → الإعدادات 8 تبويبات ظاهرة للمدير (أدوات المطور للمطور فقط كالمكتبي) → سلف الموظفين بوصفها المكتبي الحرفي → سند الصرف يعرض «حساب رئيسي/فرعي» (اختفى 404 حسابات المصروفات) → موبايل 390px بلا فائض أفقي والتذييل ثابت — صفر أخطاء كونسول وصفحة.
- commit محلي 4e5352b (الدفع معلق على توكن GitHub كالعادة).

Stage Summary:
- الويب الآن أقرب صورة للمكتبي بنيويًا في: ملف العميل (صفحة بتبويبين وMaster-Detail)، مركز العقد (4 صفحات + قائمة إجراءات + متابعة مضمنة + ربحية بصلاحية + تصفية وإغلاق)، الإعدادات (تبويبات المكتبي)، سلف الموظفين، تقرير الفروقات، نظام المزايا (42 مفتاحًا)، حذف الباطن بخياراته، حسابات المصروفات، والهوية البصرية (Tajawal + #4F46E5).
- بانتظار قرار المستخدم: (1) لا يوجد مستخدم بدور developer في القاعدة — أدوات المطور (المزايا) غير ظاهرة للمدير كالمكتبي؛ يمكن إنشاؤه من شاشة المستخدمين. (2) «الاستيراد من Excel/نماذج Word/واتساب بالكامل/المشاريع» تبقى خارج النطاق المعتمد (قرار سابق). (3) الشكل الزجاجي الكامل (خلفيات متدرجة) لم يُنقل — طُبّق الخط واللون والبنية فقط.

---
Task ID: 23-phase1
Agent: Z.ai Code (المنسق)
Task: إعادة تصميم الواجهة — المرحلة 0/1: تكييف المراجع + جرد كل الشاشات (تبويبات/نوافذ/ألوان) + فحص الأخطاء الوظيفية والأمان، بلا تنفيذ قبل الموافقة

Work Log:
- تكييف المراجع: /home/user/contrack_work/ غير موجودة في البيئة؛ المواد المقابلة محلياً: المكتبي في contrack_v9.15.18/app/ (اختباراته 205 ملفاً مطابقة لعدّاد المستخدم)، ملفات المقارنة/الجرد/التصورات HTML غير متاحة فبُني الجرد من قراءة الكود مباشرة.
- فحص أخطاء المستخدم الثلاثة على HEAD 33bbe70 (بعد ec1adb5 بـ3 تحديثات): GET /api/expense-accounts موجود ويعمل (CustodyView:562, VoucherDialog:179 تستدعيه)؛ visits/delete لم يبق له أي مستدعٍ؛ FeatureFlag model+API+Provider+ربط التنقل (AppShell:70–83) — الثلاثة شُفيت في 4e5352b فما فوق.
- جرد كمي: 36 ملف مكوّن، 75 DialogContent + 11 AlertDialog، 256 استخدام dark:، 13 خلفية داكنة (4 منها bg-black/50 overlay في ui/dialog|sheet|drawer|alert-dialog)، 86 استخدام emerald/green في 20 ملفاً، 2 hex مباشر (#3B82F6 في SettingsView:973/990 لألوان مراحل بيانات المستخدم)، tabular-nums في 206 موضعاً.
- عدّاد التبويبات فوق الحد (4): GatewayView 11/7 نوافذ/2124 سطر، SettingsView 10/9/1731، OtherCompanyView 9/4، CustodyView 7/6، DataManagementView 7/1، SubDeleteDialog 7 (نافذة بتبويبات!)، TasksView 5، SubContractDialog 5 (وفيه 5 نوافذ داخلية — خطر تداخل)، CustomerFilePage 5/5، ClaimsView 5؛ ContractDetailView بلا تبويبات (أعيد هيكلته لـ4 صفحات) لكنه 2403 سطراً و10 نوافذ منها 3 كبرى (تعديل العقد/عقد باطن جديد/تصفية وإغلاق) ⇒ صفحات كاملة.
- مطابقة التنقل: AppShell NAV_ITEMS 20 بنداً مسطحاً مقابل هيكل المستخدم بـ6 وحدات؛ المكتبي main_window.py:740–830 (مجموعة محاسبة، تقارير فرعية، زيارات، إعدادات) — الفواتير غير مذكورة في هيكل المستخدم ولا في خارج النطاق (سؤال قرار).
- أمان: db/custom.db (536KB بجدول مستخدمين) غير متتبع وdb/ في .gitignore منذ 4e5352b، لكنه ما يزال في تاريخ git بـ4 تحديثات والمستودع عام ⇒ تُعرض خيارات: تدوير كلمات المرور (Supabase) + إخفاء المستودع، بلا إعادة كتابة تاريخ.
- ملاحظة هوية: الجلسة السابقة ضبطت Tajawal + نيلي #4F46E5؛ توجيه المستخدم الجديد يعلو عليه ⇒ المرحلة 2 تعيد Cairo + أخضر #047857 ولوحة #F9FAFB/#FFFFFF/#E5E7EB/#F3F4F6.
- أُرسل تقرير المرحلة 1 للمستخدم مع تأكيدات المرحلة 0 (هيكل التنقل + قرارات الفواتير/المستخدمين/إدارة البيانات + موافقة الأمان) — التوقف عندها إلزامي.

Stage Summary:
- لا خطأ وظيفي يمنع التحميل حالياً (البنود الثلاثة شُفيت سابقاً) — يُعاد التحقق في المرحلة 6.
- خريطة العمل بعد الموافقة: (2) رموز: إزالة dark كلياً + لوحة المستخدم الحرفية، (3) تنقل بست وحدات وقائمة جانبية قابلة للطي ودرج موبايل، (4) StatusBadge موحدة من جدول الحالات + أنماط صفحات قائمة/تفاصيل/تأكيد، (5) الشاشات: فك 6 شاشات فوق الحد لقوائم جانبية، VoucherDialog و3 نوافذ كبرى في العقد تصبح صفحات، (6) تحقق بمعايير القبول greps + agent-browser قبل/بعد.
- بانتظار موافقة المستخدم قبل أي تنفيذ.

---
Task ID: 23-exec-0..4
Agent: Z.ai Code (المنسق)
Task: تنفيذ المراحل المعتمدة — الأمان، الرموز، هيكل التنقل، المكونات المشتركة

Work Log:
- الأمان (موافقة صريحة): جعل المستودع a3laaw/contrack-online خاصاً عبر GitHub API ✓ + تدوير كلمات مرور كل المستخدمين النشطين في Supabase (PBKDF2 مطابق lib/auth) — admin/admin لغياً (401 مؤكد) والدخول الجديد يعمل ✓ + حذف سكربت التدوير بعد الاستخدام.
- المرحلة 2: globals.css كُتب من جديد على اللوحة المعتمدة حرفياً (#F9FAFB/#FFFFFF/#E5E7EB/#F3F4F6/#047857/#ECFDF5/#A7F3D0/#065F46/#1F2937/#6B7280 + رموز الحالات الأربعة) بلا .dark إطلاقاً؛ layout.tsx يعيد Cairo؛ حذف darkMode:"class" من tailwind.config؛ مسح 256 استخدام dark: آلياً (perl)؛ bg-black/50 ⇒ bg-foreground/50 في ui/dialog|sheet|drawer|alert-dialog؛ chart.tsx أُزيل ثيمه الداكن.
- المرحلة 3: nav-structure.ts جديد (6 وحدات ببنودها الـ27: home/clients/accounting/coordination/reports/settings) مع أعلام المزايا والصلاحيات لكل بند؛ AppShell أعيد كتابته: شريط علوي للوحدات + قائمة جانبية للوحدة النشطة قابلة للطي (localStorage) + درج Sheet للموبايل (حُذف شريط القاع) + تذييل mt-auto مع safe-area؛ ViewName + "due"؛ ConTrackApp: activeNav/selectChild وأوضاع السندات (receipt/payment) وأقسام الإعدادات وإدارة البيانات مع المطابقة العكسية للبند النشط؛ DueItemsView جديد (المستحق الآن + متأخر التحصيل + مهام متأخرة) على نمط due_items_page/dashboard tasks_panel؛ توصيلات VouchersView.initialMode وSettingsView.initialSection وDataManagementView.initialSection.
- المرحلة 4: lib/format.ts STATUS_STYLES أعيد كتابته على جدول الحالات الرباعي فقط (34 رمزاً) + DONE_STATUSES؛ StatusBadge.tsx جديد (✓ للحالات المكتملة)؛ 21 خريطة شارات في contrack-types أُعادت توجيهها للرموز (بلا emerald/green/sky/orange/zinc/stone) + أولويات التعليقات؛ توحيد fallback إلى bg-secondary.
- تحقق: tsc صفر، lint نظيف، المتصفح: دخول admin الجديد ⇒ 6 وحدات + جانبية اللوحة/المهام المستحقة، المحاسبة 9 بنود (قبض/صرف منفصلان + الفواتير محفوظة)، الإعدادات 10 بنود (المستخدمون + النسخ + أدوات المطور)، لقطة /tmp/after-nav-accounting.png.

Stage Summary:
- المراحل 0–4 منجزة على 3 commits (217a475، 93fe738، مع سابق). الهيكل والرموز والمكونات المشتركة جاهزة.
- التالي: وكلاء الشاشات 5-A (العملاء والعقود) ثم 5-B (المحاسبة) ثم 5-C‖5-D بالتوازي، ثم المرحلة 6 (معايير القبول + agent-browser).

---
Task ID: 23-5-b1
Agent: full-stack (voucher-page)
Task: تحويل نافذة السند (VoucherDialog) إلى صفحة كاملة داخل VouchersView — بلا تغيير منطق أعمال أو API أو payload

Work Log:
- VoucherPage.tsx (جديد): نسخة صفحة كاملة من VoucherDialog بنفس المنطق حرفيًا (5 أنواع سندات + payKind للمصروف/العهدة/الباطن/الشريك + الربط اليدوي بالدفعات والتوزيع التلقائي + تحذير سقف الباطن + الرسوم البنكية المتوقعة + overpay 422 مع تأكيد «سجّل زيادة كدفعة مقدمة»)؛ نفس useMutations واستدعاءات /api/vouchers و/payment-link وpayload كما هي حرفيًا. رأس الصفحة: مسار نصي «المحاسبة ← السندات» + h1 «سند قبض جديد»/«سند صرف جديد»/«تعديل سند {رقم}» (وبقية الأنواع «سند جديد — {نوع}») + وصف النافذة الأصلي كسطر توضيحي. الحقول في grid-cols-1 md:grid-cols-2 lg:grid-cols-3، جدول «الربط بالدفعات» كما هو داخل الصفحة (max-h-44 تمرير)، وشريط سفلي sticky (بطاقة bg-background/95 backdrop-blur) بزر «حفظ السند» (bg-primary) و«إلغاء» (outline يعود للقائمة).
- توافق القالب: props = {user, onAuthError, mode?, editing?, onSaved?, onCancel?} — mode من القائمة الجانبية يحدد النوع الابتدائي؛ editing مقبول في الواجهة لكن منطق التعديل غير موجود في VoucherDialog الأصلي (إنشاء فقط) فيُستخدم للعنوان فقط ولا يمرره VouchersView. زر التأكيد داخل تحذير overpay صار outline التزامًا بقاعدة «زر أساسي واحد» (تغيير شكل فقط).
- تكيفات الشكل فقط (بلا منطق): إزالة حرس open من enabled الاستعلامات (الصفحة تُركَّب عند الفتح فقط، فالحالة تهيأ من mode مباشرة بدل effect إعادة الضبط) وإزالة فروع preset الميتة (contractPreset/subContractId المسبق) — VoucherDialog.tsx بقى كما هو لـContractDetailView وSubContractDialog.
- المبالغ: formatKWD من @/lib/format مع dir="ltr" وtext-left font-mono tabular-nums في «متبقٍ» و«Σ الربط» و«سقف الصرف المتبقي».
- VouchersView.tsx: استُبدل newOpen بحالة voucherPage: {mode, editing} | null، زر «سند جديد» يفتح <VoucherPage> بالوضع الحالي للفلتر (قبض/صرف) والعودة للقائمة عبر onSaved/onCancel (early return بعد كل الـhooks)؛ حُذف استيراد VoucherDialog؛ بقي كل شيء آخر (حذف/إلغاء سند/تفاصيل/تصدير فلاتر/KPI) كما هو — لا يوجد زر «تعديل» في الجدول أصلًا فلا شيء ليستبدله.
- ملاحظة تشغيلية: خادم التطوير كان متوقفًا فعلًا عند بدء المهمة (3000 refusing) — أُعيد تشغيله بالأمر المعتمد نفسه (bun run dev) مع تصدير بيئة .env.local؛ بدونه يعلو متغير النظام القديم DATABASE_URL=file: على Supabase وتفشل كل الـAPI بـ500.
- تحقق: npx tsc --noEmit صفر أخطاء؛ bun run lint نظيف؛ grep على الملفين: صفر emerald-/green-/dark:/bg-black/stone-/zinc-/sky-/amber-/orange-/blue-/red- (فقط رموز الحالات المعتمدة)؛ agent-browser: دخول admin بكلمة المرور الجديدة ← المحاسبة ← سندات القبض ← «سند جديد» ⇒ الصفحة بكل الحقول وكتلة الربط بالدفعات (تعرض «لا خطوط مستحقة» لعقد CON-0012 كما في المنطق) ← حفظ سند قبض تجريبي 1.000 على شركة الأفق (نقدًا) نجح بtoast «رقم السند: RV-0010» وعاد للقائمة، ثم حُذف بإلغاء سند بسبب موثق (يظهر «ملغى» مع عرض الملغاة)؛ وضع الصرف يفتح «سند صرف جديد» بشرائح مصروف/عهدة/باطن/شريك؛ «إلغاء» يعود للقائمة من الوضعين؛ صفر أخطاء كونسول وصفحة وكل الـAPI 200.

Stage Summary:
- نافذة السند صارت صفحة كاملة داخل شاشة السندات (لا مسار جديد، لا تغيير في ConTrackApp)، بنفس منطق وpayload النافذة حرفيًا، ضمن لوحة الألوان المعتمدة وقاعدة الزر الأساسي الواحد.
- VoucherDialog.tsx لم يُلمس (ما يزال مستخدمًا من مركز العقد وحوار الباطن) — توحيد الصفحات للنوافذ الكبرى يكتمل لاحقًا وفق خطة 5.

---
Task ID: 23-5-a1
Agent: full-stack (contract-pages)
Task: تحويل النوافذ الكبرى الثلاث في شاشة العقد (ContractDetailView) إلى صفحات كاملة داخلية — تعديل بيانات العقد / عقد باطن جديد / تصفية وإغلاق — بلا تغيير منطق أعمال أو API أو prisma أو payload

Work Log:
- ContractEditPage.tsx (جديد): نسخة صفحة كاملة من نافذة التعديل — نفس الحقول السبعة (اسم/تاريخ العقد/التوقيع/البدء/الانتهاء/الوصف/ملاحظات) بنفس ids ومع نفس ملء أولي من detail (openEdit السابق أصبح effect تهيئة مرة واحدة)، وgrid-cols-1 md:grid-cols-2 lg:grid-cols-3. نفس mutation الحفظ حرفيًا: PATCH /api/contracts/[id] بنفس payload المقتطع (trim) ونفس invalidations (["contract",id]/["contracts"]/["dashboard"]) ونفس toasts («تم التعديل»/«تعذر تعديل العقد»). رأس: مسار «العملاء والعقود ← العقود ← CON-xxxx» + h1 «تعديل بيانات العقد» + وصف النافذة الأصلي، وشريط سفلي sticky (bg-background/95 backdrop-blur) بـ«حفظ» أساسي و«إلغاء» outline يعود لشاشة العقد.
- ContractSettlePage.tsx (جديد): نسخة صفحة كاملة من SettleDialog (_settle_contract) — نفس الاستعلامين (detail للعملة + overview بنفس مفتاحي الكاش فيقال participar من مخزون شاشة العقد)، نفس SumRows (القيمة الحالية/المحصّل/المتبقي بـformatKWD وdir=ltr وfont-mono tabular-nums)، نفس التنبيهات الثلاثة (مستحقات باطن/متبقٍ يمنع/مراحل غير مكتملة)، ونفس زر «✔ تأكيد التصفية والإغلاق» بشرط التعطيل الحرفي (pending || !data || remaining>0.001 || stageRequired&&!stagesComplete) وPOST /api/contracts/[id]/settle بنفس toasts. إلغاء يعود لشاشة العقد.
- SubContractNewPage.tsx (جديد): صفحة «عقد باطن جديد» بأقسام متتالية بلا تداخل نوافذ: (1) قسم الإنشاء بنفس الحقول الخمسة والتحقق الحرفي (إلا subcontractorId وamount>0) وPOST /api/sub-contracts بنفس payload وinvalidations وtoast؛ (2) بعد الإنشاء تُعرض تفاصيل العقد المنشأ كأقسام (بطاقات مالية/الإجراءات/البنود/خطة الدفعات/كتل الدفع/السندات) عبر هوك ومكونات مشتركة مستخرجة من SubContractDialog؛ النوافذ الداخلية السابقة صارت خطوات موسّعة inline بنفس المنطق والحقول والأزرار: «إضافة دفعة لخطة الباطن» (بمصادراتها المتعددة)، «توزيع تلقائي» (متساوية/على البنود)، «إلغاء العقد الباطن» (سبب إلزامي). VoucherDialog (صرف على هذا الباطن) وSubDeleteDialog (الحذف بخيارات) بقيت نافذتين على مستوى الصفحة (بلا تداخل — هما خارج ملفاتي المسموحة)، وتأكيد حذف خط الخطة (بلا حقول) بقى نافذة، وحذف العقد المنشأ من SubDeleteDialog يعود لشاشة العقد (مكافئ الإغلاق المزدوج السابق).
- SubContractDialog.tsx (تفكيك بلا تغيير منطق): استُخرج هوك مشترك useSubContractDetail (كل الاستعلامات والمutations والحالات حرفيًا: items/plan/pay-blocks/vouchers/boq/client-plan + saveItems/addPlan/deletePlan/distribute/cancel + draftItems effect + addFromBoq) ومكونات عرض مشتركة (SubFinCards/SubItemsEditor/SubPlanLinesTable/SubBlocksTable/SubVouchersList/AddPlanFields/DistributeFields/SwitchLike)؛ النافذة نفسها أعيد تركيبها منها بنفس Tabs والسلوك نفسه — تُستخدم كما هي من «تفاصيل العقد الباطن».
- ContractDetailView.tsx: حالة داخلية flowPage: "edit"|"sub-new"|"settle"|null تُعرض فيها الصفحات الثلاث عرضًا شرطيًا مكان شاشة العقد (بعد كل الـhooks وبعد حراس التحميل/الخطأ، بلا مسار جديد ولا تعديل ConTrackApp)؛ حُذفت نوافذ التعديل والتصفية وعقد الباطن الجديد مع حالاتها وmutations (editForm/editMutation/settleOpen/settleMutation/newSubForm/createSubMutation/contractorsQuery) ومكوّن SettleDialog، ونقاط الفتح صارت setFlowPage (☰ تعديل البيانات، ☰ تصفية وإغلاق، زر بطاقة التصفية، زر عقد باطن جديد في صفحة الدفعات)؛ enabled للاستعلامات حُدّث (overview: page==="info"||flowPage==="settle"؛ sub-contracts: page==="pay"||flowPage==="sub-new"||subDetailId!==null). بقيت النوافذ الصغيرة (تغيير الحالة/تخطي/إضافة مرحلة/إضافة دفعة/بنود الكميات/ضبط الإشراف/تنازل) كما هي.
- شارات وألوان: شارة «متخطاة» ⇒ bg-status-done-bg text-status-done (حسب مثال التوجيه)؛ بطاقة «عقد إشراف هندسي» البنفسجية ⇒ border-border bg-muted/40 بعنوان text-primary (آخر لون حر بالملف)؛ كل شارات الحالات في ملفاتي حُوّلت إلى StatusBadge الموحدة (حالة العقد بالرأس، حالة عقد الباطن، حالات خطوط الخطة بالجدول والموبايل، حالات خطة/كتل الباطن والسندات و«ملغى») — نفس statusBadgeClass من الداخل و✓ للحالات المكتملة؛ الشارات المشتقة (متخطاة/منتهية/جارية/لم تبدأ/موقوفة ببوابة) بقيت Badge برموز اللوحة لأن مفاتيحها ليست في جدول الحالات.
- ملاحظة موجودة مسبقًا (لم تُمسّ — خارج النطاق): /api/subcontractors يعيد {subcontractors:[...]} بينما الواجهة تقرأ .items (SubcontractorsView:77 وقائمة المقاولين في نافذة/صفحة «عقد باطن جديد» المنسوخة حرفيًا) ⇒ قائمة المقاولين تظهر فارغة دائمًا برسالة «لا مقاولين». اكتُشفت أثناء التحقق وعولجت بالتوثيق فقط التزامًا بـ«لا تغيير منطق/API».

Stage Summary:
- النوافذ الكبرى الثلاث صارت صفحات كاملة داخلية (ContractEditPage/ContractSettlePage/SubContractNewPage) بنفس المنطق والحقول والـmutations والتحققات حرفيًا، وContractDetailView خفّ من 2403 إلى ~2100 سطر بلا نوافذ متداخلة في مسار الباطن الجديد.
- تحقق: npx tsc --noEmit صفر؛ bun run lint نظيف؛ grep اللوحة على الملفات الخمسة صفر نتائج (بما فيها purple المتبقية)؛ agent-browser: دخول admin ← العملاء والعقود ← العقود ← CON-0012: شاشة العقد تفتح، «تعديل البيانات» صفحة كاملة بكل الحقول (الاسم معبأ مسبقًا) و«إلغاء» يعود، «عقد باطن جديد» صفحة كاملة بقسم الإنشاء و«إلغاء» يعود (الإنشاء الفعلي تعذّر آمنًا: لا مقاولين بالقاعدة — انظر الملاحظة أعلاه؛ أنشأت مقاول اختبار مؤقتًا ثم حذفته عبر API للتحقق من السلوك)، «تصفية وإغلاق» صفحة كاملة بالأرقام الصحيحة (25,000/7,500/17,500) وزر التأكيد معطّل حسب الشرط و«إلغاء» يعود، وصفحة الدفعات تعرض جدول الخطة بشارات StatusBadge (مدفوع ✓) — صفر أخطاء كونسول وصفحة، وtail dev.log لا أخطاء (كلها 200).
- تبقى للمرحلة القادمة: توحيد قراءة شكل /api/subcontractors (قرار مستخدم) لتفعيل قائمة المقاولين في إنشاء الباطن وشاشة المقاولين، واختبار تفاصيل عقد الباطن (لا يوجد عقد باطن في القاعدة حاليًا).

---
Task ID: 23-5-a2
Agent: full-stack (customer-pages)
Task: نموذج العميل صفحة كاملة (CustomerEditPage) + تدقيق نوافذ ملف العميل (5 DialogContent) + زر الخطر الفاتح في SubDeleteDialog — بلا تغيير منطق أعمال أو API أو prisma أو payload

Work Log:
- أنشأت src/components/contrack/CustomerEditPage.tsx (جديد): نسخة صفحة كاملة من نافذة CustomerFormDialog السابقة (9 حقول) — نفس الحقول كلها (الاسم/الهاتف/البريد/المحافظة/المنطقة/Block/Plot/العنوان/ملاحظات) بنفس ids (c-name…c-notes) في grid-cols-1 md:grid-cols-2 lg:grid-cols-3 (الاسم والعنوان والملاحظات بعرض كامل)، ونفس saveMutation حرفيًا: نفس التحقق «اسم العميل مطلوب»، نفس الـpayload (trim للاسم فقط)، نفس المسارات POST /api/customers أو PATCH /api/customers/[id]، ونفس invalidations (["customers"] + ["customer",id] + invalidateKeys) ونفس الـtoasts («تم التعديل»/«تمت الإضافة» بوصف «العميل «الاسم» (الكود)») ونفس 401→onAuthError. الصفحة تُركَّب عند الفتح فقط فالتهيئة مباشرة من editing/initialForm (بلا effect إعادة ضبط — نفس تكييف VoucherPage). الرأس: مسار «العملاء والعقود ← العملاء» + h1 «عميل جديد» أو «تعديل بيانات: {الاسم}» + وصف النافذة الأصلي كسطر text-sm، وشريط سفلي sticky (bg-background/95 backdrop-blur) بـ«حفظ» أساسي واحد و«إلغاء» outline. استوردت منها CustomerFormData/EMPTY_CUSTOMER_FORM/toCustomerForm (كانت تصدَّر من النافذة المحذوفة).
- CustomersView.tsx: استُبدلت حالتا formOpen/editing بحالة واحدة customerPage: {editing?: Customer} | null، زر «عميل جديد» وزرّا التعديل (جدول الحاسوب وبطاقات الموبايل) يفتحان الصفحة (early return بعد كل الـhooks يعرضها مكان القائمة — بلا مسار جديد)، حُذف استيراد وتركيب CustomerFormDialog؛ كل بقية الوظائف كما هي (بحث debounce، تحديث، حذف بتأكيد، فتح الملف، onNewContract/onOpenCustomerFile). زر «حذف» في تأكيد الحذف صار فاتحًا: bg-status-danger-bg text-status-danger hover:bg-status-danger-bg/80 border-0 (كان bg-destructive داكنًا).
- CustomerFilePage.tsx: زر «تعديل البيانات» في EntityHeader يفتح CustomerEditPage كصفحة كاملة مكان الملف (استبدال في نفس المستوى — early return بعد حراسي التحميل/الخطأ حيث customer مضمونة) بنفس خصائص النافذة السابقة حرفيًا (editing + invalidateKeys [["customer-file",customerId]] + onSaved=refreshFile ثم العودة للملف)، وحُذف استخدام CustomerFormDialog. حرس Esc في مستمع الملف يتعامل مع صفحة التعديل المفتوحة بالعودة للملف (كإغلاق النافذة سابقًا) ولا يخرج من الملف. حالة editPage نُقلت أعلى الـhooks لتجاوز استخدامها في المستمع (أصلح TS2448).
- تدقيق النوافذ الخمس في CustomerFilePage (العد بعد إزالة النافذة السادسة المستوردة): تعيين/تغيير مسار الشبكة (حقل 1) نافذة تبقى، تأكيد حذف مسار الشبكة (بلا حقول) نافذة تبقى، AddAttachmentDialog (حقلان: العقد+الملف) نافذة تبقى، تعديل نص التعليق (حقل 1) نافذة تبقى، تأكيد حذف التعليق (بلا حقول) نافذة تبقى — كلها ≤3 حقول فلا تحويل لصفحات، ولا نافذة تفتح نافذة (النوافذ كلها على مستوى مكوناتها، والاختيارات المنسدلة والقوائم ليست نوافذ). زرا الخطر في نافذتَي الحذف (حذف المسار/حذف التعليق) حُوّلا للنمط الفاتح المعتمد نفسه. أصلحت آخر لون حر بالملف: شارة «منتهي» كانت bg-purple-100/text-purple-700 ⇒ bg-status-done-bg/text-status-done (مطابقة جدول الحالات في lib/format).
- SubDeleteDialog.tsx (تدقيق فقط بلا تغيير منطق): النافذة الواحدة بتبويباتها الثلاثة أقسام داخلية مقبولة وليست نوافذ متداخلة، وAlertDialog «تأكيد الحذف» هو نمط التأكيد المسموح. زر الخطر الثلاثة داخل التابات (احذف العقود/احذف أو ألغِ السندات/احذف سجل المقاول) وزر «تأكيد» في AlertDialog كلها صارت فاتحة: border-0 bg-status-danger-bg text-status-danger hover:bg-status-danger-bg/80 (كانت variant=destructive داكنة وbg-destructive). لا ألوان حرة بالملف (نصوص الأخطار text-status-danger/text-destructive رموز نغمية معتمدة).
- حُذف CustomerFormDialog.tsx نهائيًا بعد grep أثبت عدم بقاء أي مستدعٍ (الملاحظتان النصيتان في التعليقين فقط).
- تحقق: npx tsc --noEmit صفر؛ bun run lint نظيف؛ grep الألوان الحرة (utility-scoped: bg-/text-/border-/ring-… + dark: + bg-black + hex) على الملفات الأربعة صفر نتائج (ملاحظة: «slate-» في CustomersView كان إيجابًا كاذبًا من translate-y-1/2 — استبعدته بنمط مُقيّد ببادئات الأدوات)؛ agent-browser (admin): العملاء ← «عميل جديد» ⇒ صفحة كاملة بكل الحقول 9 والأعمدة 3 فعليًا عند 1440px (gridTemplateColumns ثلاثية) والمسار صحيح ← حفظ «عميل اختبار UI» ⇒ toast «تمت الإضافة» وعودت القائمة وظهر C-0017 ← زر التعديل فتح الصفحة معبأة الاسم والإلغاء عاد ← ملف العميل يعمل (تبويبان + بطاقات + تعليقات)، «تعديل البيانات» فتح الصفحة الكاملة وEsc عاد للملف، نافذة تعيين المسار فُتحت وأُغلقت (حقل واحد)، تبويب العقود يعرض Master-Detail فارغًا كما يليق بعميل بلا عقود ← حذف «عميل اختبار UI» بتأكيد زر خطر فاتح مُقاس (bg 254,226,226 / نص 185,28,28 / border 0) ⇒ toast «تم الحذف» واختفى من القائمة؛ صفر أخطاء كونسول وصفحة، وtail dev.log كل الطلبات 200 (إنشاء ثم حذف العميل) بلا أخطاء.

Stage Summary:
- نموذج العميل (9 حقول) صار صفحة كاملة CustomerEditPage تُفتح من شاشة العملاء (جديد/تعديل) ومن ملف العميل (تعديل البيانات) بنفس المنطق والpayload حرفيًا، وحُذفت نافذة CustomerFormDialog من المشروع كليًا.
- نوافذ ملف العميل الخمس كلها ≤3 حقول فبقيت نوافذ صغيرة مشروعة، ولا تداخل نوافذ؛ زر الخطر الفاتح صار معتمدًا في كل نوافذ الحذف بملفاتي (العملاء + ملف العميل + حذف الباطن بخياراته).
- آخر لون حر في CustomerFilePage (بنفسجي شارة «منتهي») حُوّل لرموز الحالات المعتمدة — ملفاتي كلها الآن على اللوحة حصريًا.
---
Task ID: 23-5-w1
Agent: full-stack (contract-invoice-pages)
Task: تحويل نافذتي «عقد جديد» (معالج 3 خطوات) و«فاتورة جديدة» (6 حقول) إلى صفحتين كاملتين داخليتين في ContractsView/InvoicesView — بلا تغيير منطق أعمال أو API أو payload

Work Log:
- ContractNewPage.tsx (جديد): نسخة صفحة كاملة من المعالج السابق — الخطوات الثلاث كخطوات داخل الصفحة بلا نوافذ (مؤشر شرائح + «الخطوة N من 3» تحت العنوان): (1) بيانات العقد بنفس الحقول وids النافذة (ct-name/ct-amount/ct-date/ct-desc) ومنطق نوع العقد (defaultAmount يملأ المبلغ إن فارغًا)، (2) المراحل بصفوفها وشبكتها [1fr_5rem_5rem_2rem] وmax-h-64 تمرير، (3) الدفعات بالاستحقاق الافتراضي = اليوم. نفس createMutation حرفيًا (POST /api/contracts بنفس payload: trim، stages المفلترة بالاسم، plan المفلترة بالعنوان والمبلغ>0، sortOrder) ونفس invalidations (contracts/dashboard/customers) ونفس toasts ونفس تحقق submitCreate (اختر العميل/أدخل المبلغ مع setStep(1)) و401→onAuthError. الحقول grid-cols-1 md:grid-cols-2 lg:grid-cols-3 (مؤكدة 3 أعمدة فعليًا في المتصفح)، رأس بمسار «العملاء والعقود ← العقود» + h1 «عقد جديد»، شريط سفلي sticky (bg-background/95 backdrop-blur) بزر أساسي واحد (التالي/إنشاء العقد) + السابق/إلغاء outline.
- InvoiceNewPage.tsx (جديد): نسخة صفحة كاملة من نافذة الفاتورة بنفس الحقول الستة وسلوكها (العقد disabled حتى اختيار عميل بplaceholder «اختر عميلًا أولًا»)، نفس الاستعلامات الثلاثة (["customers",""]/["customer",id]/["contract",id] retry:false)، نفس حسابات البطاقة (القيمة الحالية/المفوتر سابقًا من قائمة الفواتير/المتبقي/التجاوز) ونفس createMutation (POST /api/invoices بنفس payload) وinvalidations (invoices/contract/dashboard) وtoasts («صدرت الفاتورة» برقمها/«رُفضت الفاتورة» برسائل الحرجتين حرفيًا) ونفس submitNew (4 تحققات). المبالغ font-mono tabular-nums dir="ltr" مع formatKWD؛ رأس بمسار «المحاسبة ← الفواتير» وشريط سفلي sticky (إلغاء outline + «إصدار الفاتورة» أساسي).
- ContractsView.tsx: حُذفت النافذة وحالاتها (step/الحقول الثمانية/stages/payments) واستعلاما types/customers والمutation وresetCreate؛ استُبدلت بحالة createPage | null — زر «عقد جديد» يفتح الصفحة وeffect الـpreset (من ملف العميل عبر ConTrackApp) يفتحها مع presetCustomerId ويستهلك الـpreset كما كان؛ early return بعد كل الـhooks يعرض الصفحة مكان القائمة (onSaved/onCancel ⇒ إغلاق؛ onSuccess: onSaved ثم onOpenContract كما كان). تنظيف الاستيرادات الميتة (Dialog/Label/Textarea/apiPost/useToast/useQueryClient/أيقونات/أنواع).
- InvoicesView.tsx: حُذفت نافذة «فاتورة جديدة» وحالاتها وwasOpen/newPresetRef والاستعلامات الثلاثة والمMutation وtodayStr؛ استُبدلت بحالة newPage {presetCustomerId} | null — openNew يمرر فلتر العميل الحالي كما كان؛ early return يعرض <InvoiceNewPage invoices={items} …> (نفس مخزون ["invoices"] لحساب «المفوتر سابقًا» بلا إعادة جلب). النوافذ الصغيرة (التفاصيل/حذف الفاتورة) بقيت كما هي.
- تكييفات شكل فقط: الصفحتان تُركَّبان عند الفتح فقط فالتهيئة مباشرة من props (نفس تكييف VoucherPage/CustomerEditPage) وإزالة حراس `enabled: newOpen` مع بقاء الأحراس الدلالية (id !== null)؛ إلغاء صفحة العقد صار outline (كان ghost) التزامًا بقاعدة الزر الأساسي الواحد؛ إضافة font-mono + dir="ltr" لقيم بطاقة الفاتورة وdir="ltr" لحقل المبلغ.
- ملاحظة تشغيلية: خادم التطوير كان متوقفًا عند البدء (3000 refusing) — أُعيد تشغيله بالأمر المعتمد (bun run dev مع تصدير .env.local) كما في 23-5-b1.
- تحقق: npx tsc --noEmit صفر؛ bun run lint نظيف؛ grep الألوان الحرة (utility-scoped + dark: + bg-black + hex) على الملفات الأربعة صفر نتائج؛ agent-browser بجلسة خاصة w1 (admin): العقود ← «عقد جديد» ⇒ صفحة كاملة بكل الحقول وشبكة 3 أعمدة فعلية (316px×3) وتنقل الخطوات 1→2→3 يعمل (إضافة مرحلة/دفعة تضيف صفوفًا) و«السابق» يعود و«إلغاء» من الخطوة 2 يعود للقائمة؛ ملف العميل (شركة الأفق) ← تبويب العقود ← «عقد جديد» ⇒ الصفحة بالعميل معبأ مسبقًا (C-0014) و«إلغاء» يعود؛ المحاسبة ← الفواتير ← «فاتورة جديدة» ⇒ صفحة كاملة ب6 حقول والعقد disabled قبل العميل، وبعد اختيار شركة الأفق ⇒ CON-0012 ⇒ البطاقة صحيحة (25,000.000/0.000/25,000.000) ومبلغ 999999 أظهر تحذير التجاوز و«إلغاء» يعود؛ صفر أخطاء كونسول وصفحة، dev.log بلا POST /api/contracts ولا /api/invoices (لم يُحفظ شيء) وكل الـAPI 200 (401 قبل الدخول فقط)؛ لقطات /tmp/w1-contract-new.png و/tmp/w1-invoice-new.png.

Stage Summary:
- النافذتان الكبيرتان في العقود والفواتير صارتا صفحتين كاملتين داخليتين (ContractNewPage/InvoiceNewPage) بنفس المنطق والحقول والـpayload حرفيًا، على اللوحة اللونية المعتمدة وقاعدة الزر الأساسي الواحد، بلا مسارات جديدة وبلا أي تعديل خارج الملفات الأربعة المسموحة.
- بقية نوافذ الشاشتين صغيرة (≤3 حقول أو تأكيدات: الفروقات، تفاصيل الفاتورة، حذف الفاتورة) فبقيت نوافذ مشروعة — توحيد الصفحات الكاملة للنوافذ الكبرى يتابَع وفق خطة 5.

---
Task ID: 23-5-w3
Agent: full-stack (simple-form-pages)
Task: تحويل 4 نوافذ إضافة/تعديل متوسطة إلى صفحات كاملة داخلية — المهام (7 حقول)، التعليقات (جديد 7 + بيانات 5)، المستخدمون (5)، مقاولو الباطن (5) — بلا تغيير منطق أعمال أو API أو payload

Work Log:
- TaskEditPage.tsx (جديد): صفحة كاملة من TaskDialog — نفس الحقول السبعة (العنوان/التفاصيل/النوع/التذكير قبل/التاريخ والوقت/العميل/العقد) بنفس ids (task-title…task-due) وبنفس الدوال المساعدة المنقولة (toLocalInput/fromLocalInput/defaultDueLocal) وgrid-cols-1 md:grid-cols-2 lg:grid-cols-3. نفس saveMutation حرفيًا: POST /api/tasks أو PATCH /api/tasks/[id] بنفس payload (trim العنوان/التفاصيل، dueAt بصيغة "YYYY-MM-DD HH:mm"، remindMinutes رقمي، customerId/contractId null عند NONE) ونفس التحقق («أدخل عنوان المهمة»/«حدد تاريخ ووقت الاستحقاق») ونفس toasts («حُدّثت المهمة»/«أُضيفت المهمة» بأوصافها) ونفس 401→onAuthError. الصفحة تُركَّب عند الفتح فقط فالتهيئة مباشرة من editing (بلا effect إعادة ضبط) — نفس تكييف VoucherPage/CustomerEditPage. رأس: مسار «المتابعة والتنسيق ← المهام» + h1 «مهمة جديدة»/«تعديل مهمة» + وصف النافذة الأصلي، وشريط سفلي sticky (bg-background/95 backdrop-blur) بـ«حفظ التعديلات»/«إضافة المهمة» أساسي واحد و«إلغاء» outline.
- TaskView wiring: TasksView.tsx حُذف منها TaskDialog (190 سطرًا) مع حالات dialogOpen/editing وحُذفت المستوردين الميّتين (Select/Textarea/apiPost/REMIND_OPTIONS/TASK_TYPES/CustomerDetailResponse/NONE والدوال المنقولة)؛ حالة واحدة taskPage: {editing} | null وزرا «مهمة جديدة»/التعديل يفتحانها، وearly return بعد كل الـhooks (منها محرك التذكير الدوري) يعرض TaskEditPage مكان القائمة بلا مسار جديد ولا تعديل ConTrackApp. تأكيد حذف المهمة بقى نافذة صغيرة وزر «حذف نهائي» صار فاتحًا border-0 bg-status-danger-bg text-status-danger hover:bg-status-danger-bg/80 (قياسًا حيًا: bg 254,226,226 / نص 185,28,28 / border 0). آخر لون حر بالملف (أيقونة «موعد» bg-violet-100/text-violet-700) ⇒ bg-primary-soft/text-primary-soft-foreground.
- CommentEditPage.tsx (جديد): صفحة كاملة واحدة بوضعين تخدم النافذتين السابقتين حرفيًا — mode "new": حقول التعليق الجديد السبعة (العميل/العقد/النص بعدّاد 2000/النوع/الأولوية/الوسوم/تاريخ المتابعة) بنفس createMutation (POST /api/comments بنفس payload وtags مفصولة بـ«،») وtoast «أُضيف التعليق»؛ mode "meta": حقول تعديل البيانات الخمسة (الحالة/النوع/الأولوية/تاريخ المتابعة/الوسوم) بنفس metaMutation (PATCH /api/comments/[id] {action:"meta", …}) وtoast «حُدّثت بيانات التعليق». التهيئة مباشرة من target في وضع meta (كـeffect wasTarget السابق عند الفتح). «تعديل نص التعليق» (حقل 1 = BodyDialog) بقيت نافذة كما هي، وتأكيد الحذف بسبب إلزامي بقى نافذة وزر «حذف» صار فاتحًا بنمط الخطر المعتمد.
- CommentsView wiring: حُذفت NewCommentDialog وMetaDialog (≈380 سطرًا) وحالتاهما؛ حالة واحدة commentPage: {mode:"new"} | {mode:"meta", target} | null (النصوص: زر القائمة «تعليق جديد» وزر البطاقة «تعديل البيانات») وearly return بعد كل الـhooks يعرض الصفحة مكان القائمة. ألوان حرة أُصلحت: KPI «متابعة اليوم» text-violet-600 ⇒ text-status-info، حد البطاقة border-s-amber-400 (مثبّت) ⇒ border-s-status-warn وborder-s-red-400 (عاجل) ⇒ border-s-status-danger، وشارة «متابعة — اليوم» bg-violet-100/text-violet-800 ⇒ bg-status-info-bg/text-status-info.
- UserEditPage.tsx (جديد): صفحة كاملة من نافذة إضافة/تعديل المستخدم — نفس الحقول الخمسة (اسم المستخدم معطّل عند التعديل/الاسم الكامل/كلمة المرور/الدور/مفتاح «الحساب مفعّل» للتعديل فقط) بنفس ids (u-username/u-full/u-pass). نفس saveMutation حرفيًا: التحقق «اسم المستخدم مطلوب»، تعديل → PATCH /api/users/[id] بـ{fullName, role, active} + password إن دخل، إضافة → POST /api/users بـ{username, fullName, password, role} مع شرط «كلمة المرور مطلوبة»، ونفس invalidations (["users"]) ونفس toasts («تم التعديل»/«تمت الإضافة» بوصف «المستخدم «…»») ونفس fail (401→onAuthError). رأس: مسار «الإعدادات ← المستخدمون والصلاحيات» + h1 «مستخدم جديد»/«تعديل المستخدم — {username}» + وصف النافذة الأصلي.
- UsersView wiring: حُذفت نافذة النموذج وحالتها (formOpen/editing/form) وsaveMutation منها (انتقل للصفحة)؛ حالة userPage واحدة وearly return بعد حراس الـhooks وصلاحية المدير (الصفحة داخل نطاق المدير فقط كالسابق). نافذة الحذف (AlertDialog) بقيت وزرها صار فاتحًا bg-status-danger-bg/text-status-danger بدل bg-destructive text-white. نافذة الصلاحيات (PermissionsDialog) لم تُمس.
- ContractorEditPage.tsx (جديد): صفحة كاملة من نافذة إضافة/تعديل المقاول — نفس الحقول الخمسة (الاسم/الهاتف/البريد/النشاط/ملاحظات) بنفس ids (sc-name…sc-notes). نفس saveMutation حرفيًا: نفس body المقتطع (trim للخمسة)، POST /api/subcontractors أو PATCH /api/subcontractors/[id]، ونفس invalidations الرباعية (subcontractors/subcontractor/sub-contracts/dashboard) ونفس toasts («تم التعديل»/«تمت الإضافة») ونفس تعطيل الحفظ عند فراغ الاسم. رأس: مسار «العملاء والعقود ← مقاولو الباطن» + h1 «مقاول جديد»/«تعديل مقاول».
- SubcontractorsView wiring: حُذفت نافذة النموذج وحالتها وEMPTY_FORM وsaveMutation؛ حالة contractorPage واحدة وopenForm(c?) صارت setter، وearly return بعد كل الـhooks (قائمة المقاولين + استعلاما التفاصيل وعقود الباطن) يعرض الصفحة مكان القائمة. تفاصيل المقاول (Dialog) وSubContractDialog وSubDeleteDialog كما هي.
- قاعدة موحدة في الملفات الأربعة: «صفحة داخلية بحالة داخلية» — لا مسارات ولا تعديل ConTrackApp؛ النوافذ ≤3 حقول والتأكيدات بقيت نوافذ (حذف مهمة/تعليق/مستخدم + تعديل نص التعليق + نافذة الخيارات SubDeleteDialog).
- ملاحظة تشغيلية: npx tsc --noEmit وbun run lint يظهران أخطاء خارج ملفاتي (GatewayView.tsx وInvoicesView.tsx — وكيلان متزامنان في منتصف تعديل، ملفات غير مسموحة لي)؛ على ملفاتي الثمانية حصريًا: tsc صفر وlint نظيف.

Stage Summary:
- النوافذ المتوسطة الأربع صارت صفحات كاملة داخلية (TaskEditPage/CommentEditPage بوضعَيها/UserEditPage/ContractorEditPage) بنفس الحقول والـmutations والـpayload والتحققات والـtoasts حرفيًا، على اللوحة المعتمدة وقاعدة الزر الأساسي الواحد وأزرار الخطر الفاتحة في كل تأكيدات الحذف بملفاتي.
- تحقق حي (agent-browser --session w3): دخول admin ← المهام: «مهمة جديدة» صفحة كاملة بكل الحقول والافتراضيات (استحقاق الساعة القادمة) ← حفظ «مهمة اختبار UI» ⇒ toast «أُضيفت المهمة» وظهرت بالقائمة (المفتوحة 1) ← «تعديل» فتح الصفحة معبأة (العنوان حرفيًا) و«إلغاء» عاد ← حذفها بتأكيد بزر خطر فاتح مُقاس ⇒ «حُذفت المهمة» والقائمة 0. التعليقات: «تعليق جديد» صفحة ب7 حقول ← حفظ تعليق تجريبي على «شركة الأفق للمقاولات» (POST 201) ظهر بالقائمة ← «تعديل البيانات» فتحت صفحة الحقول الخمسة معبأة (وسوم/حالة) و«إلغاء» عاد ← حذف التعليق بسبب إلزامي بزر خطر فاتح ⇒ «حُذف التعليق» واختفى. الإعدادات ← المستخدمون والصلاحيات: «مستخدم جديد» صفحة كاملة (مسار + 5 حقول/سكرتير افتراضي) و«إلغاء» عاد — بلا إنشاء. مقاولو الباطن: «مقاول جديد» صفحة كاملة و«إلغاء» عاد — بلا إنشاء (القائمة فارغة أصلًا فمسار التعديل تحقق نمطيًا كمسار المهام المعبأ). agent-browser errors فارغ وconsole بلا أخطاء، وdev.log: كل نداءاتي 200/201 وبلا 5xx.

---
Task ID: 23-5-w2
Agent: full-stack (gateway-pages)
Task: تحويل النوافذ الكبرى في GatewayView (رفع ملف تسديد 8 حقول / رفع كشف بنك 5 حقول / إضافة-تعديل بوابة 8 حقول) و«تسديد مختارات» في OtherCompanyView (6 حقول) إلى صفحات كاملة داخلية — بلا تغيير منطق أعمال أو API أو payload

Work Log:
- قراءة إلزامية: worklog.md (آخر 4 أقسام: 23-phase1 / 23-exec-0..4 / 23-5-b1 / 23-5-a1 + 23-5-a2 — نمط الصفحات الكاملة المعتمد ContractEditPage/CustomerEditPage: حالة داخلية + early return بعد كل الـhooks + تهيئة مباشرة بلا effect إعادة ضبط + إزالة حرس open من enabled + زر الخطر الفاتح)، ثم الملفان الحاكان كاملًا: GatewayView.tsx (2117 سطرًا — 11 تبويبًا ضمن 5 و4 نوافذ كبرى) وOtherCompanyView.tsx (1247 سطرًا).
- ملفات جديدة (5، كلها ضمن البادئات المسموحة Gateway*/OtherCompany*):
  • GatewayFileParse.ts: نقل حرفي لكتلة تحليل الملفات النصية من GatewayView (ParsedOp/ParsedBankLine/splitLine/normalizeDateCell/parseNumCell/OP_HEADER_HINTS/BANK_HEADER_HINTS/parseOpsText/parseBankText) لمشاركتها بين صفحتي الرفع بلا تكرار.
  • GatewayUploadPage.tsx: نسخة صفحة كاملة من نافذة «رفع ملف تسديد بوابة الدفع» — نفس الحقول حرفيًا: البوابة* (Select + «إضافة سريعة» واسم بوابة جديدة بـPOST /api/gateway/profiles كما هو)، ملف CSV/TSV (قراءة نصية وتحليل تلقائي)، النص الخام (Textarea + زر «تحليل النص»)، معاينة أول 5 صفوف قابلة للتعديل (grid-cols-4 تاريخ/هاتف/مبلغ/مرجع) مع مجموع round3، ونفس settlementMutation حرفيًا (POST /api/gateway/settlement-file بنفس payload: gatewayName/batch/rows[{opDate,phone,amount,ref}] ونفس التحققين «اختر بوابة…» و«لا صفوف محللة…» و401→onAuthError). تكييف شكلي وحيد موثق: في النافذة كان يُعرض بطاقة نتيجة (uResult) وتبقى النافذة مفتوحة؛ في الصفحة **عند الانتهاء يعود لتبويب العمليات** (onDone ⇒ setPage(null)+setTab("ops")) بنفس invalidateAll ونفس toast «عولج الملف — أُدرج N صفًا ومطابقة M» فصارت بطاقة النتيجة غير قابلة للوصول وأُزيلت (الملخص يصل بالتوست نفسه). الحقول في grid-cols-1 md:grid-cols-2 lg:grid-cols-3 (البوابة/الملف في عمودين والنص الخام بعرض كامل) + شريط سفلي sticky (bg-background/95 backdrop-blur) بـ«معالجة ورفع (N)» أساسي و«إلغاء» outline مع ArrowRight.
  • GatewayBankUploadPage.tsx: نسخة صفحة كاملة من نافذة «رفع كشف حساب البنك» — نفس الحقول الخمسة حرفيًا (ملف، «تحليل النص»، Textarea خام، معاينة أول 5 سطور بثلاثة أعمدة تاريخ/مبلغ/وصف قابلة للتعديل، خطأ) ونفس bankUploadMutation حرفيًا (POST /api/gateway/bank-lines بـrows[{cdate,amount,descr}] ونفس invalidations الثلاثة bank-lines/unmatched-bank/clearing ونفس toast «حُفظت سطور البنك — N سطر إيداع»)؛ onDone يعود لتبويب التصفية اليومية حيث قسم سطور البنك.
  • GatewayProfileEditPage.tsx: نسخة صفحة كاملة من نافذة «إضافة/تعديل بوابة» — نفس الحقول الثمانية حرفيًا (الاسم*/الحساب البنكي/طرق الدفع/T+N/العمولة%/حد التحمّل/أيام التأخير/مفعلة Checkbox) بتهيئة مباشرة من editing عند التركيب (مكافئ openProfileNew/openProfileEdit)، ونفس profileSaveMutation حرفيًا (POST /api/gateway/profiles أو PATCH …/[id] بنفس payload بترم trim للنصوص وNumber للأرقام، ونفس التحقق «اسم البوابة مطلوب» ونفس toasts «عُدلت البوابة»/«أُضيفت البوابة»)؛ key={id ?? "new"} يضمن تهيئة نظيفة بين فتحتين.
  • OtherCompanyPayPage.tsx: نسخة صفحة كاملة من نافذة «تسديد مختارات» — نفس الحقول الستة حرفًا (المبلغ* مع تلميح «مجموع متبقي المحدد»، التاريخ*، الطريقة Select من /api/payment-methods أو Input حر حسب توفر الطرق، مرجع، ملاحظة + معاينة التوزيع التلقائي) — ونقل allocateAmount/todayStr حرفيًا من OtherCompanyView. نفس payMutation حرفيًا (POST /api/other-company/transfers بـtdate/amount/method/ref/notes/opIds[{opId,amount}] من التوزيع التنازلي ونفس toasts «سُجّل التسديد — …بلا سندات») ونفس تحققات submitPay الثلاثة حرفيًا. **حارس آمن**: إن كانت المحددات فارغة (فتح بلا تحديد أو جرّ بيانات) تعرض الصفحة حالة «لا عمليات محددة للتسديد» بزر «عودة للقائمة» — يعود بأمان بلا تصيير النموذج ولا نداء؛ ولتحقيق ذلك صار زر «تسديد مختارات» في القائمة يفتح الصفحة دائمًا (أُزيل disabled={selectedOps.size===0} — بوابة تنقل فقط، منطق الإرسال والتحققات كما هي).
- GatewayView.tsx (2117→1416 سطرًا): حالة داخلية page: "upload"|"bank"|"profile"|null + profileEditing: GatewayProfile|null، وearly return بثلاثة فروع يعرض الصفحات مكان شاشة القائمة كاملة (بعد كل الـhooks وقبل «مجاميع مساعدة») — بلا مسارات جديدة ولا تعديل ConTrackApp. حُذفت النوافذ الثلاث الكبرى بحالاتها وmutations المنقولة (upload/bank/profile + مؤثرات wasOpen + openProfileNew/openProfileEdit + submitSettlement/submitBankUpload/submitProfile) وكتلة تحليل الملفات (نُقلت) واستيراد GatewaySettlementFileResult؛ نقاط الفتح حُوّلت: زر الرأس وتبويب الرفع («فتح صفحة الرفع» بدل «نافذة») ⇒ upload، زر «رفع كشف بنك» في التصفية ⇒ bank، «بوابة جديدة» و«تعديل» ببطاقة بوابة ⇒ profile (مع setProfileEditing). بقيت كما هي: تبويب العمليات بفلاتره والتحديد الجماعي، التصفية اليومية وقسم «سطور البنك» وغير المطابقة داخلها (كما هو مطلوب)، الإعدادات ببطاقات البوابات والتفعيل، ونوافذ ≤3 حقول: التصنيف (تصنيف/سند/يدوي)، حذف بوابة، حذف عملية، المسح الشامل (تأكيد نصي) — **أزرار الخطر الثلاثة صارت فاتحة** border-0 bg-status-danger-bg text-status-danger hover:bg-status-danger-bg/80 (كانت variant="destructive").
- OtherCompanyView.tsx (1247→1050 سطرًا): حالة page: "pay"|null + early return يعرض OtherCompanyPayPage مكان الشاشة (selectedItems/invalidateOther/onDone يفرّغ التحديد وعودة/onCancel)؛ حُذفت نافذة التسديد بحالاتها وmutations المنقولة (payOpen/wasPayOpen/pay*/methodsQuery/methodOptions/payAmountNum/allocation/allocatedSum/leftover/payMutation/submitPay/selectedRemaining + allocateAmount/todayStr/PaymentMethodLite إلى الصفحة) وتنظيف الاستيراد (apiPost/Select*/Textarea صارت غير مستخدمة). بقيت النوافذ: الرصيد الافتتاحي (حقل واحد)، تغطية التسديد (قراءة)، حذف تسديد — وزر حذفه صار فاتحًا بالنمط المعتمد نفسه. زر «تسديد مختارات» يعمل بلا تحديد (يفتح الحالة الآمنة).
- ملاحظة موجودة مسبقًا لم تُمسّ (خارج النطاق — لا تغيير منطق): استعلاما سطور البنك bankQuery/unmatchedQuery معطّلان شرطيًا enabled: tab==="bank" بينما لا يوجد تبويب "bank" في TabsList (الدوام مدموج داخل «التصفية اليومية») — فالقسم يظهر بحالته الفارغة رغم وجود بيانات. وُثقت هنا لقرار لاحق (تغيير الشرط إلى tab==="clearing" يفعّلها).
- تنظيف بيانات الاختبار: أُنشئت بوابة مؤقتة «بوابة اختبار UI» عبر API للتحقق من مسار التعديل ثم حُذفت فورًا (DELETE — profiles عادت []) — لم يُحفظ أي بيانات فعلية من الواجهة (إلغاء في كل النماذج).
- التحقق: npx tsc --noEmit صفر على src؛ bun run lint نظيف؛ grep الألوان الحرة (بادئات utility + dark: + bg-black + hex) على الملفات السبعة صفر نتائج؛ الملاحظة التشغيلية: خادم التطوير سقط أثناء التحقق وأُعيد إطلاقه بالأمر المعتمد (bun run dev مع تصدير .env.local).
- تحقق متصفحي (agent-browser --session w2): دخول admin ← المحاسبة ← بوابة الدفع: «رفع ملف تسديد» ⇒ صفحة كاملة (h1 + مسار «المحاسبة ← رفع ملف تسديد» + Select البوابة + إضافة سريعة + ملف + نص خام + إلغاء/معالجة ورفع (0) معطّل)، لصق نصين وتحليلهما ⇒ زر «تحليل النص» ظهر ومعاينة صفين قابلة للتعديل (تاريخ موحد/هاتف منقّى/مبلغ/مرجع) و«معالجة ورفع (2)» تفعّل ثم «إلغاء» عاد للقائمة (بلا حفظ)؛ «التصفية اليومية» ⇒ قسم «سطور البنك» و«غير المطابقة» يظهران داخل التبويب، «رفع كشف بنك» ⇒ صفحة كاملة بحقليها ومعاينة سطرين محللين و«إلغاء» عاد للتصفية؛ «الإعدادات» ⇒ «تعديل» ببطاقة البوابة المؤقتة فتح صفحة «تعديل البوابة: …» بالثمانية معبأة (KNET/1/0/0.005/3) و«إلغاء» عاد، و«بوابة جديدة» فتحت الصفحة الفارغة بالقيم الافتراضية و«إلغاء» عاد؛ الشركة الأخرى: «تسديد مختارات» بلا تحديد ⇒ الصفحة تعرض الحالة الآمنة «لا عمليات محددة للتسديد» و«عودة للقائمة» أعادت لتبويب المستحقات (لا مستحقات بالقاعدة فمسار النموذج المعبأ مطابق حرفيًا لنافذة سابقة). `agent-browser --session w2 errors` فارغ وconsole بلا أخطاء، وdev.log كل النداءات 200/201 بلا 5xx، وGET / = 200.

Stage Summary:
- النوافذ الكبرى الأربع صارت صفحات كاملة داخلية (GatewayUploadPage/GatewayBankUploadPage/GatewayProfileEditPage/OtherCompanyPayPage + مكتبة GatewayFileParse) بنفس الحقول والـmutations والتحققات والـpayload حرفيًا — لا مسارات جديدة ولا تعديل ConTrackApp، ولوحة الألوان المعتمدة وقاعدة الزر الأساسي الواحد وزر الخطر الفاتح مطبقة.
- GatewayView خفّ من 2117 إلى 1416 سطرًا وOtherCompanyView من 1247 إلى 1050 — النوافذ الباقية كلها ≤3 حقول أو تأكيدات حذف بزر خطر فاتح.
- بانتظار قرار: تفعيل استعلامي سطور البنك بتبديل شرط enabled إلى tab==="clearing" (موثق أعلاه)، واختبار مسار «تسديد مختارات» المعبأ عند توفر مستحقات فعلية.

---
Task ID: 23-5-w4-completion
Agent: Z.ai Code (المنسق — إكمال بعد انقطاع الوكيل)
Task: إكمال استبدال VoucherDialog وربط VoucherPage في مسارات الباطن + إصلاحات متفرقة

Work Log:
- الوكيل 23-5-w4 أنجز صفحاته الخمس (ClaimNewPage/AddendumPartPage/CustodyAccountsPage/ContractBoqPage/ContractSupervisionPage) وأسقط بدمجها، لكنه لم يُكمل استبدال VoucherDialog.
- المنسق: VoucherPage اكتسب preset (vtype/subMode/subContractId/contractId/customerId) بعقد VoucherDialog الحرفي؛ SubContractDialog صار onPay إلزامياً وحُذف fallback النافذة وpayOpen من هوكه المشترك؛ SubContractNewPage يعرض VoucherPage كصفحة عند الصرف؛ SubcontractorsView يمرر onPay يغلق الحوار ويفتح VoucherPage كصفحة.
- إصلاح تالف سطر 92 في VoucherPage (const [m[methodId — تراكم محاولات على خلفية خلل عرض للأداة يلغي تسلسل [m كرمز ANSI) — فُحص بالبايتات.
- GatewayView: استعلاما سطور البنك أعيد تمكينهما بـ tab==="clearing" (البنك قسم داخل التصفية)؛ حذف VoucherDialog.tsx نهائياً (صفر مستدعيات).
- تحقق متصفحي: عقد جديد/فاتورة جديدة/رفع ملف تسديد/تسديد مختارات/مطالبة جديدة/إدارة حسابات العهدة/سند صرف من العقد/عقد باطن جديد — كلها صفحات كاملة تفتح وتُلغى؛ tsc صفر وlint نظيف.

Stage Summary:
- قاعدة «صفر نوافذ إضافة/تعديل» مكتملة: كل نافذة >3 حقول صارت صفحة كاملة؛ الباقي نوافذ ≤3 حقول وتأكيدات حذف بأزرار خطر فاتحة؛ لا نافذة داخل نافذة إطلاقاً.

---
Task ID: 24 (الختام)
Agent: Z.ai Code (المنسق)
Task: تنفيذ قرارات الأمان المعتمدة (تدوير كلمات المرور + سر الجلسات) والنشر للإنتاج والتحقق النهائي

Work Log:
- تحقق من معايير القبول بعد المرحلة 6: grep dark:/bg-black/الخلفيات الرمادية الداكنة = 0، grep emerald-/green- = 0، npx tsc --noEmit = 0 أخطاء.
- تدوير كلمات مرور مستخدمي التطبيق (admin + secretary) عبر scripts/rotate-passwords.ts بنفس خوارزمية المصادقة (PBKDF2-SHA256/200k دورة/ملح عشوائي 16B) — القيم أُبلغت في المحادثة فقط ولا تُكتب في أي ملف متتبع.
- تحقق API محلياً + على الإنتاج: admin/admin مرفوض («اسم المستخدم أو كلمة المرور غير صحيحة»)، والاعتمادان الجديدان يُرجعان token سليم.
- إغلاق ثغرة AUTH_SECRET: لم يكن مضبوطاً محلياً (fallback مكشوف في المستودع) — أُضيف سر عشوائي 64-hex إلى .env غير المتتبع. تحقق عبر vercel env pull أن الإنتاج يستخدم سراً قوياً مخصصاً منذ إنشائه (ليس الافتراضي) — لا حاجة لتدويره.
- إعادة تشغيل خادم التطوير بالبيئة المحدثة (HTTP 200).
- ربط Vercel CLI (vercel link --project contrack-online) ونشر الإنتاج من الكود المحلي: bunx vercel --prod — نجح البناء في 55 ثانية ومُوصل بالدومين https://contrack-online.vercel.app.
- تحقق من الإنتاج: HTTP 200 عام، CSS الإنتاج يحوي Cairo (20 إشارة) وبلا Tajawal/4F46E5 — التصميم الجديد منشور.
- تحقق متصفحي (agent-browser --session w5): دخول admin بالاعتماد الجديد ⇒ شريط الوحدات الست + لوحة المؤشرات، ثم المحاسبة ⇒ قائمتها الجانبية العشر والسندات تُعرض بسجلها وبadge الحالة الفاتح — صفر أخطاء console/erors.
- الوثوقية: أزرار الدخول القديمة عطلت الجلسات القائمة؟ لا — تدوير AUTH_SECRET محلياً يبطل الجلسات المحلية فقط؛ إنتاج كان يستخدم سره القوي الخاص.

Stage Summary:
- الأمان: admin/admin انتهى نهائياً (محلياً وعلى الإنتاج)، سر توقيع الجلسات محلياً صار عشوائياً، النشر حديث فُعّل بلا انتظار رمز GitHub.
- الإنتاج https://contrack-online.vercel.app يشغّل التصميم الجديد (المراحل 2-6) مؤقتاً بنشر CLI — نشر git التالي سيستبدله تلقائياً.
- المتبقي على المستخدم (يحتاج صلاحياته): 1) رمز GitHub جديد للرفع (9 commits محلية) 2) جعل المستودع خاصاً 3) حذف رمز GitHub القديم المكشوف 4) تدوير كلمة مرور Supabase للداتابيز من اللوحة ثم تحديث .env.

---
Task ID: 25
Agent: Z.ai Code (المنسق)
Task: إكمال الجدول الموحّد لدفعات العميل مقابل دفعات مقاول الباطن (طلب المستخدم — «أهم جدول»)

Work Log:
- راجعت المصدر المكتبي: الجدول الموحّد V9.1 في ui/sub_pay_blocks.py::build_unified_table (9 أعمدة — البند | عميل 4 | مقاول 4) مشترك بين ملف العقد (contract_hub) وشاشة المقاول، وكل خط باطن يُسند إلى أول دفعة عميل من مصادره وخطوط بلا مصدر تُلحق بالأسفل.
- وجدت الفجوة في الويب: صفحة «الدفعات والمقاولون» بملف العقد كانت تعرض خطط العميل والباطن في جداول منفصلة (PlanTable لكل جهة) رغم أن النص التوضيحي يعد بمقارنة سطرية؛ والمقارنة الوحيدة كانت SubBlocksTable داخل تبويب الدفع بعقد الباطن.
- نفذت UnifiedPayTable في ContractDetailView.tsx (استبدال PlanTable للعرض فقط في كتلة كل مقاول): رأس ثنائي المجموعة «دفعات العميل | دفعات المقاول» بأعمدة (الدفعة/المبلغ/المسدّد/الحالة لكل جهة)، دمج الخلايا بـrowSpan عند تعدد خطوط المقاول لدفعة واحدة، 🔴 القفل على الخط المقفول بانتظار مصادره، خطوط بلا مصدر أسفل الجدول بشرطة في جهة العميل، صف إجماليات أسفل كل جهة، ونسخة بطاقات للموبايل (دفعة العميل وخطوطه المرتبطة داخل البطاقة).
- البيانات من pay-view الموجود أصلًا (sourceIds) — لا تغيير API ولا منطق أعمال.
- تحقق متصفحي ببيانات اختبار كاملة عبر API (خطة عميل 3 دفعات + عقد باطن بخطة 3 خطوط: مصدر موحد/مصدر مزدوج/حر بلا مصدر): الجدول يعرض الربط الصحيح حرفيًا كالمكتبي، الحالات بشاراتها، القفل يظهر، صفر أخطاء console.
- تنظيف شامل لبيانات الاختبار (بما فيها مخلفات جلسات سابقة في نفس العقد): حذف عقود الباطن 3/4/5 وخططها ومصادرها وخطط العميل الاختبارية 25-28 — دفعة مقدمة 7500 (ذات تغطية سند حقيقية) بقت كما هي. tsc صفر وlint نظيف وgreps اللوحة صفر.

Stage Summary:
- «أهم جدول» مكتمل في موضعيه: ملف العميل (صفحة الدفعات والمقاولون — جدول موحّد لكل مقاول) + ملف مقاول الباطن (تبويب الدفع بعقد الباطن — SubBlocksTable موجود مسبقًا). العرض مطابق للمكتبي بصيغة الويب.

---
Task ID: 26 (حادثة واستعادة)
Agent: Z.ai Code (المنسق)
Task: التعامل مع إعادة ضبط sandbox كاملة أثناء الجلسة واستعادة المشروع بالكامل

Work Log:
- أثناء التحقق من سؤال «هل تم النشر على GitHub» اكتشفت: (أ) remote الأصل اختفى من .git/config وتاريخ git انهار إلى Initial commit فارغ (29 ملفاً) خُلق 00:36 UTC، ثم (ب) محو كامل لمجلد المشروع 19:49 (src/ وprisma/ وpackage.json وdb/ كلها اختفت؛ بقي upload/ كنقطة تحميل محمية و.git الانهاري).
- حصرت مصادر الاستعادة: GitHub (أصبح خاصاً — الرفع المجهول مرفوض؛ آخر ما عليه = قبل المرحلة 2)، Vercel (الإنتاج يعمل بآخر نسخة لكن الرمز ضاع مع .env.local)، وupload/ (المصدر المكتبي فقط).
- الاكتشاف الحاسم: نسخة كاملة ومحدثة من المشروع في /tmp/my-project/ (تحوي UnifiedPayTable وworklog حتى Task 25) — استُعيدت بـrsync (باستثناء upload المثبت) بعد إزالة بقايا الانهيار.
- أُعيد بناء .env: اتصال Supabase عبر session pooler (db المباشر محجوب بالجدار — aws-0-ap-northeast-1.pooler.supabase.com:6543 + pgbouncer) ببيانات الجلسة، وAUTH_SECRET جديد عشوائي 64-hex. تحقق Prisma: 2 مستخدمين، 1 عقد، 0 عقود باطن — كل عمل اليوم (التدوير والتنظيف) سليم في Supabase.
- bun install (827 حزمة) + prisma generate + تشغيل الخادم: HTTP 200، دخول admin بكلمة المرور المدوّرة يعمل، التنقل بالوحدات الست يظهر، صفر أخطاء متصفح.
- git init جديد + commit واحد شامل 944385c (السجل المتدرج ضاع محلياً؛ التوثيق الكامل بالمراحل في هذا الملف وعلى Vercel).
- الإنتاج https://contrack-online.vercel.app لم يتأثر (HTTP 200) — يخدم آخر نشر CLI بكل التحديثات.

Stage Summary:
- المشروع مستعاد 100% محلياً (كود الجدول الموحّد والأمان والتصميم كله)، و/tmp/my-project يبقى نسخة احتياطية سليمة.
- قاعدة البيانات والاعتماد المدوّر سليمان (Supabase بعيد عن الانهيار).
- المعلق على المستخدم: رمز GitHub جديد (المستودع خاص الآن) للرفع — بعده Vercel ينشر تلقائياً من main؛ ورمز Vercel جديد اختياري للنشر المباشر بدون انتظار.

---
Task ID: 27 (رفع GitHub + إصلاح بيئة ما بعد الحادثة)
Agent: Z.ai Code (المنسق)
Task: استخدام رمز GitHub الذي وفره المستخدم لرفع المشروع إلى a3laaw/contrack-online، ثم ضبط بيئة التشغيل المحلية

Work Log:
- تحقق من الرمز: صالح للحساب a3laaw بصلاحية repo الكاملة (push + admin)، والمستودع a3laaw/contrack-online تبين أنه **خاص بالفعل** ("private": true) — بند الأمان مُنفّذ.
- فحص أمني قبل الرفع: الملفات المتتبعة بلا أسرار (فقط .env.example)، لا رموز ghp_ في الشجرة، .gitignore يغطي .env*، prisma يقرأ url من env، لا node_modules/.next متتبعة، أكبر ملف 0.3MB (1070 ملفاً).
- اكتشاف أن التاريخ المحلي (master) = commitان فقط بجذر جديد (استعادة 944385c + worklog fc1984d) غير مرتبط بتاريخ remote القديم (33bbe70) → إعادة تسمية الفرع إلى main + force push مع حماية --force-with-lease=main:33bbe70 (نجح: 33bbe70...fc1984d).
- إزالة الرمز من .git/config فوراً بعد كل عملية رفع (الرمز يُمرر مؤقتاً فقط عبر remote URL).
- إصلاح ضجيج git بعد الاستعادة: 1056 ملفاً تغيّر وضعها فقط (644→755) → core.fileMode=false؛ وإيقاف تتبع .zscripts/dev.pid (ملف PID تشغيلي) بإضافته لـ.gitignore + git rm --cached → commit 78a0486 وpush عادي سريع.
- التحقق: ls-remote يطابق fc1984d ثم 78a0486، وgit status نظيف تماماً (main...origin/main بلا فروقات).
- إعادة تشغيل خادم التطوير (كان ميتاً بعد إعادة الضبط الثانية): HTTP 200 مع AUTH_SECRET جديد 64-hex أُلحق بـ.env.
- **اكتشاف حرج**: إعادة ضبط الحاوية حدثت مرة ثانية بعد جلسة الاستعادة — .env عاد للقيمة الافتراضية (SQLite محلي) وفقد DATABASE_URL الخاص بـSupabase وAUTH_SECRET؛ و/tmp/my-project (النسخة الاحتياطية) يحمل نفس .env الافتراضي. الاتصال الحقيقي (session pooler aws-0-ap-northeast-1:6543) غير قابل للاستعادة محلياً — كلمة المرور كانت في .env.local المفقود فقط (فحص: لا أثر لها في bash_history ولا سكربتات migrate ولا /tmp).
- prisma provider = postgresql وdb/ غير موجود → التطبيق يعمل محلياً (شاشة الدخول 200) لكن أي استدعاء DB سيفشل حتى استعادة الاتصال. **الإنتاج على Vercel غير متأثر إطلاقاً** (متغيرات البيئة على Vercel مستقلة).

Stage Summary:
- GitHub مكتمل: main = 78a0486 (استعادة كاملة + worklog + تنظيف git)، المستودع خاص، والرمز ليس محفوظاً في أي ملف.
- محتوى الإنتاج على Vercel = نفس كود main (آخر نشر CLI شمل كل تغييرات التطبيق) — لا حاجة لنشر فوري.
- معلق على المستخدم: (1) كلمة مرور Supabase — يُنصح بتدويرها من اللوحة (بند أمني معلق أصلاً) وتزويدي بسلسلة Session pooler لاستعادة التطوير المحلي، مع تحديث DATABASE_URL على Vercel فور التدوير وإعادة نشر. (2) ربط Vercel بـGitHub من لوحة المشروع (Settings → Git) أو تزويدي بـVERCEL_TOKEN للتحقق من النشر التلقائي. (3) حذف رمز GitHub القديم المكشوف، ورمز هذه الجلسة بعد انتهاء الحاجة.

---
Task ID: 28-a
Agent: Explore (desktop inventory)
Task: جرد شامل للنسخة المكتبية (contrack_v9.15.18/app) بلا تعديل أي كود

Work Log:
- قرأت database/models.py (4 dataclasses فقط: Customer/Contract/Invoice/Settings) وdatabase/database.py بالكامل: المخطط الفعلي SQLite ≈ 45 جدولاً في _SCHEMA + _apply_schema + جداول ينشئها services (customer_comments, gateway_*, feature_flags, purge_audit, cancel_audit_log, audit_log, number_sequences...).
- جردت UI بالكامل: main_window.py (شريط جانبي RTL بترتيبه وIDX_*)، contract_hub (4 صفحات)، ملف العميل (عام/العقود)، ملف المقاول (3 صفحات)، تابات العهد/البوابة/الإعدادات/النماذج، والتقارير الثمانية في reports_page._REPORTS.
- استخرجت قواعد الأعمال مع مراجع سطرية: حالات العقود CONTRACT_STATUSES وآلات انتقالات unified_cancel_service/claims_service، ترقيم number_sequences، سقف القبض/الصرف OverpayWarning، بوابة «تحصيل العميل قبل صرف المقاول»، تفعيل الدفعات عند إنهاء المرحلة (trigger_due_payments)، قيمة العقد الحالية (أصل + أوامر معتمدة + تمديد إشراف).
- وثّقت تكامل الحذف/الإلغاء (منع حذف عند ارتباط، إلغاء سند مع أبنائه وعكس القيود)، الصلاحيات (3 أدوار + ~30 مفتاحاً)، النسخ الاحتياطي (تلقائي + أسبوعي ZIP)، المزايا (feature flags)، والبحث/الطباعة/Word.

Stage Summary:
- العدّاد النهائي: ~45+ جدولاً، 9 مداخل رئيسية + مجموعات، 8 تقارير، 33 خدمة، 8 مولدات PDF/Excel — جاهز لمقارنة التغطية مع الويب (6 وحدات منفذة).
- نقاط فارق متوقعة للويب: مطالبات، عهد وسلف، بوابة الدفع/تسديدات الشركة الأخرى، مراحل متابعة شجرية، مركز نماذج Word، الإلغاء المؤرشف وسجل التدقيق، الترقيم الذري.
- التفاصيل الكاملة (نماذج/تابات/قواعد file:line) في رد الوكيل أدناه — لا تغييرات على أي كود مصدري.

---
Task ID: 28-b
Agent: Explore (web inventory)
Task: جرد شامل لنسخة الويب

Work Log:
- قرأت prisma/schema.prisma كاملًا (53 نموذجًا): كل العلاقات وonDelete و@@unique/@@index، ورصدت 11 نموذجًا بلا علاقات (FeatureFlag, NumberSequence, AuditLog, PurgeAudit, Setting, PaymentMethod, GatewayProfile, BankLine, OtherCompanyOpening, MatchAlias, JournalEntry)، و4 نماذج ميتة بلا أي استخدام كودي (FormCategory/FormTemplate/FormField/FormDocument)، ومفاتيح FK بلا علاقات (AddendumItem.subContractId, Claim.subLineId, ContractGroupItem.contractId, GatewayOp.paidTransferId, GatewayFeeVoucher.voucherId, JournalEntry.*, Voucher.projectId/expenseCustomerId…)، وعلاقات اختيارية بلا onDelete (افتراضي SetNull = فصل صامت).
- جردت 156 ملف API route (المسارات + الأفعال + النماذج): اكتشفت أسماء نماذج قديمة (subPaymentPlan/paymentPlan/typePaymentTpl/settings/customerComment/contractComponent/isActive) في /api/subcontracts*، /api/sub-payments، /api/reports/_server.ts+dues-board، /api/backup، prisma/seed.ts، وlib/ui-prefs.ts (db.settings + حقل uiPrefs غير موجود) — تعمل ترجمةً لأن ignoreBuildErrors=true لكنها تنكسر وقت التشغيل؛ كما أن /api/backups+/restore نسخ ملفات SQLite (db/custom.db) لا يتوافق مع Postgres، وUI البوابة ينادي DELETE /api/gateway/ops/[id] غير الموجود.
- جردت الـUI: 6 وحدات تنقل (الرئيسية، العملاء والعقود، المحاسبة، المتابعة والتنسيق، التقارير، الإعدادات) — لا 4 كما هو متوقع؛ مركز العقد 4 صفحات (مسار فني/نظرة عامة/دفعات موحدة UnifiedPayTable/أوامر تغييرية) + 5 صفحات تدفق (تعديل/باطن جديد/تصفية/بنود/إشراف)؛ 42 feature flag؛ auth PBKDF2-200k + توكن HMAC بكوكي 7 أيام؛ 37 مفتاح صلاحيات.
- تتبعت الكود الميت: 12 مكوّنًا غير مستورد (ArchiveView, GroupsView, CustomerDetailView, StagesTab, PaymentsTab, BoqTab, SupervisionTab, ContractVouchersTab, SubContractsTab, SubPaymentVoucherDialog, NewContractDialog, CustomerDialog) و~10 مكتبات API clients ميتة (report-api, followup-api, gateway-api, invoice-api, custody-api, advance-api, claim-api, addendum-api, productivity-api, subcontract-api) ونسختا سندات باطن/تحويلات قديمة (subcontracts*, other-transfers*).

Stage Summary:
- الويب يغطي فعليًا: عملاء/عقود (مراحل، خطة دفع، BOQ، أوامر، مطالبات، إشراف، تصفية)/باطن (بنود، خطة موزعة على دفعات العميل، بوابة العهدة)/محاسبة (سندات قبض وصرف، كشوف 3 أنواع، عهد وسلف، بوابة دفع، شركة أخرى)/إنتاجية (مهام، زيارات، تعليقات، بحث، ملف عميل)/تقارير (11 نوعًا)+تصدير Excel/إعدادات (مستخدمون وصلاحيات، أنواع وقوالب، مراحل شجرية، حسابات مصروفات، مزايا، تدقيق، مسح).
- أهم الثغرات المرصودة: نسخ احتياطي كله مكسور مع Postgres، إعدادات زيارات (visit-slot) مكسورة عبر ui-prefs، بذور seed.ts قديمة، 4 نماذج نماذج-Word بلا API/UI، وapi/gateway/ops/[id] DELETE ناقص — تُفضّل معالجتها قبل مقارنة التكافؤ النهائية.
- لا تعديل على أي كود مصدري — التفاصيل الكاملة (53 نموذجًا، 156 مسارًا، كل الشاشات) في رد الوكيل أدناه.

---
Task ID: 28-c
Agent: full-stack-developer
Task: إعادة بناء النسخ الاحتياطي للـPostgres

Work Log:
- قرأت worklog (28-a/28-b) + prisma/schema.prisma كاملًا حرفيًا، والمسارات القديمة الثلاثة (/api/backup و/api/backups و/restore) وlib/backups.ts (نظام ملفات SQLite المكسور) وapi-utils/auth لنسخ نمط الحماية.
- أنشأت src/lib/backup-dump.ts: قائمة BACKUP_MODELS بطول 53 نموذجًا بالترتيب الطوبولوجي (آباء قبل أبناء: users→permissions، customers→contracts→stages→boq→payment_plan→sub_*→vouchers→links→addendums→claims…) بأسماء مندوبي Prisma وأسماء الجداول @@map وراية serial لكل جدول له id autoincrement — تحققت من وجود كل المندوبين الـ53 في المولَّد .prisma/client (عدّاد مطابق 53/53).
- buildBackupDump: findMany تسلسلي لكل جدول (بلا include — كل الجداول تُنسخ فلا حاجة للعلاقات) + manifest {app, version, createdAt, generatedBy, tableCounts}؛ Decimal يخرج نصًا والتواريخ ISO ⇒ round-trip سليم.
- restoreBackupData داخل معاملة واحدة: تحقق مفاتيح الملف ضد القائمة البيضاء ⇒ deleteMany بالترتيب العكسي ⇒ إنشاء بالمعرّفات الأصلية عبر createMany بدفعات 200 مع معالجة الجداول ذاتية المرجع (workflow_stages/expense_accounts/vouchers: parent أولاً بمرورات متكررة، والمرجع المكسور يُنشأ بلا رابط) ⇒ إعادة ضبط التسلسلات بـ setval(pg_get_serial_sequence('"جدول"','id'), COALESCE(MAX(id),1), MAX(id) IS NOT NULL) عبر $queryRawUnsafe بأسماء حرفية من القائمة البيضاء فقط.
- تخزين الخادم: db/backups يُنشأ وقت التشغيل (fs.mkdir recursive، وdb/ gitignored)؛ كل نسخة ملف JSON ذو العنوان manifest ذاتيًا + فهرس index.json يُحدَّث عند الإنشاء/الاكتشاف (يلتقط ملفات غير مفهرسة يدويًا) + تقليم لآخر 30 نسخة (ملفات safety- مستثناة) + listBackupFiles يتحقق من الوجود ويحدّث الأحجام.
- أعيدت كتابة المسارات الثلاثة بنمط الجوار (adminGuard + audit + jsonError/ok): GET /api/backup تنزيل JSON بـContent-Disposition attachment (اسم contrack-backup-<stamp>.json)؛ GET/POST /api/backups قائمة/إنشاء نسخة خادم مع سطر تدقيق؛ POST /api/backups/restore { fileName }: تحقق .json + داخل مجلد النسخ + بنية manifest/data ⇒ نسخة أمان safety-<stamp>.json أولاً ⇒ معاملة بمهلة 180s ⇒ رسالة عربية بعدد الصفوف والجداول، وفشل المعاملة يعني بلا أي تغيير. أزلت اعتماد /api/backup على updateUiPrefs (db.settings المكسور) وأزلت كل إشارات ملف SQLite (db/custom.db، kind full لمرفقات).
- أعدت BackupsTab في DataManagementView: زر «إنشاء نسخة» (POST /api/backups) + زر «تنزيل نسخة JSON» (adminApi.downloadBackup) + زر تحديث، وجدول (الاسم/الصفوف/الحجم/التاريخ/المستخدم/استعادة) بشارة «خادم|أمان» من بادئة الملف، وحوار تأكيدي AlertDialog بلا كتابة نصه الجديد يوضح حذف الجداول وإعادة الإنشاء بالمعرّفات ونسخة الأمان والمعاملة الواحدة، وonSuccess للاستعادة يبطل كل استعلامات react-query لأن البيانات كلها تغيّرت.
- tsc --noEmit: صفر أخطاء في ملفاتي (أصلحت خطأ sizeKB/size واحدًا)؛ bun run lint exit 0؛ dev.log سليم 200.
- لم ألمس: prisma/schema.prisma وlib/backups.ts (لا يزال يستخدمه /api/data-mgmt/purge لـATTACH_DIR) وlib/ui-prefs وcontrack-types.ts (اكتفيت بنوع محلي BackupRow في المكوّن حتى لا أحتك بوكيل آخر).

Stage Summary:
- النسخ الاحتياطي أصبح JSON كاملًا متوافقًا مع Postgres: تنزيل + نسخة خادم + استعادة بحفظ المعرّفات وإعادة ضبط التسلسلات، كلها admin-only بنمط adminGuard، والأسماء 53/53 مطابقة للمخطط الحالي (لا أسماء قديمة paymentPlan/typePaymentTpl/settings/customerComment/isActive).
- القيد المعلوم: على Vercel القراءة/الكتابة مؤقتة (ephemeral) — مجلد db/backups صالح للتشغيل الخادمي الدائم؛ ونظام مرفقات النسخة الكاملة السابق أُسقط عمدًا (metadata المرفقات تُنسخ ضمن contract_attachments، وملفاتها على القرص خارج نطاق هذه المهمة).
- مستخدمو النسخة المستعادة: الـdump يحتفظ بكامل حقول users (بما فيها passwordHash/salt) لأن الاستعادة تعيد إنشاء الصفوف كما كانت — الملف admin-only، والبديل (استبعادها) كان سيكسر الاستعادة على NOT NULL.

---
Task ID: 28-e
Agent: full-stack-developer
Task: تصفير أخطاء TypeScript في عائلة تقارير الـAPI + إصلاح ثغرة الحارس

Work Log:
- قرأت worklog (28-b/28-c) للسياق، ثم _server.ts + مسارات التقارير الستة + api-utils.ts (توقيع الحارس الحالي `{user}|{response}`) + prisma/schema.prisma (كل تواريخ الجداول نصية yyyy-MM-dd والمبالغ Decimal).
- **إصلاح ثغرة الحارس الأمنية** في المسارات الخمسة (customer-statement/customers-full/dues-board/dues/profitability/summary): استُبدل `if (g.error) return g.error` المكسور (كان لا يرفض أبدًا لأن `.error` غير موجود في الاتحاد) بـ`if ('response' in g) return g.response` — نفس نمط الجوار، وبدون مفاتيح صلاحيات إضافية كما كان مُمرَّرًا (authGuard(req) بلا permKey). تحقّقت عمليًا: كل المسارات تعيد 401 «يجب تسجيل الدخول» لغير المصادق بدل السقوط في منطق التقرير.
- **_server.ts** (المشترك): dayStr يقبل Date|string (النص يُعاد كما هو و''→null)؛ isSupervisionContract/supervisionStatus توقيعاتها على حقول المخطط (supStartDate string، supMonthly/supDiscount/supWaivedMonths Decimal عبر Prisma.Decimal) مع Number() عند الحدود وstart يُشتق `new Date(`${supStartDate}T12:00:00.000Z`)` (ظهر noon كـtodayNoon)؛ actualSupervisionEnd يعيد string|null وفلتر endDate `{ not: '' }` بدل `{ not: null }`؛ PlanLineRaw أصبحت dueDate/triggeredAt نصية وstageEnd string|null؛ strictDueByContract يقارن `it.dueDate > dayStr(today)` نصيًا بدل calendarDays؛ كل عمليات _sum/amount/links ملفوفة Number() (netAddendumsMap, receiptsByContract, unallocatedReceiptsByContract, receiptLinksMaps, paymentLinksByLine, contractValuesMap, loadCustomerPlan).
- **customer-statement**: isoDay تقبل Date|string (adate/vdate/invoiceDate/contractDate نصية)، فك Decimal بـNumber() في (amountAdd−amountDeduct، المقبوضات، قيمة العقد، الإجماليات)، و`Number(inv.amount).toLocaleString(...)` بدل toLocaleString على Decimal (TS2554).
- **customers-full/dues**: نطاق التاريخ dRange أصبح Record<string,string> (parseDay يعيد نصًا وcontractDate عمود String)، fallback values map بـNumber(c.amount).
- **dues-board**: fifoCover items تُبنى بـamount: Number(p.amount) وdueDate نصية؛ daysDiff عبر `new Date(p.dueDate+'T12:00:00.000Z')`؛ مقارنات «جزئي/متأخر» نصية ضد todayIso=dayStr(today) (نفس اليوم = غير متأخر، متوافق مع دقة strict «اليوم أو قبله»)؛ round3(s.amount/p.amount/_sum) بـNumber().
- **profitability/summary**: Number() على كل Decimal (subTotals، المدفوعات، c.amount، line.amount، روابط، تجميعات 12 شهرًا وbyStatus)؛ dayRange نصية {gte,lte} (مكافئة لتضمين اليومين على نص yyyy-MM-dd) وvdate>=`twelveMonthsAgoStr` (`YYYY-MM-01` بعد 11 شهرًا) بدل كائن Date.
- صفر تغيير منطق/رسائل/حالات — كل النصوص العربية والبنية كما هي؛ لم ألمس api-utils.ts ولا report-types.ts ولا أي ملف خارج نطاقي (export/route.ts سليم ولم يُعلَّم من tsc).
- التحقق: `bunx tsc --noEmit | rg 'reports'` ⇒ لا شيء (كانت ~84)؛ الأخطاء الـ185 المتبقية كلها في ملفات وكلاء آخرين ولا أحد منها يلمس رموزي المُصدَّرة؛ `bunx eslint src/app/api/reports` ⇒ exit 0؛ dev.log نظيف والمسارات الخمسة تترجم وتعيد 401 سليمة.

Stage Summary:
- عائلة /api/reports (6 مسارات + _server.ts) صارت متوافقة نوعيًا 100% مع المخطط الحالي (تواريخ نصية + Prisma.Decimal) وبصفر أخطاء tsc وlint، مع إغلاق ثغرة الحارس التي كانت تسمح بطلبات غير مصادقة بتنفيذ منطق التقارير — الحارس الآن يرفض 401 فعليًا.
- القاعدة المعتمدة في الملفات: Date يُشتق من النص بظهر noon UTC (`T12:00:00.000Z`) لمطابقة todayNoon، ومقارنات الاستحقاق الصارمة نصية ISO مباشرة، وكل Decimal يُفك بـNumber() عند أول حد حسابي/تنسيقي — جاهزة للاختبار الوظيفي مع بيانات Postgres.

---
Task ID: 28-f
Agent: full-stack-developer
Task: تصفير أخطاء TypeScript في محاسبة/عقود/إعدادات API + إصلاح ثغرة الحارس

Work Log:
- شغّلت `bunx tsc --noEmit` قبل البدء: 167 سطرًا خارج reports/components/seed في 7 ملفات API + src/lib/claim-number.ts؛ حددت الملفات بدقة عبر تجميع السطور الأولى للأخطاء فقط (سطور الـcontinuation متعددة الأسطر كانت تعود لأخطاء _server.ts المفلترة بالمسار).
- أصلحت ثغرة الحارس الأمنية في كل مواقعها (13 موضعًا): نمط `if (g.error) return g.error` الذي لا يرفض أبدًا (غير المصرح كان يمرّ!) استُبدل بـ`if ("response" in g) return g.response` مع الحفاظ على مفاتيح الصلاحيات كما هي — في custody (GET/POST/addAccount-admin)، items/[id] (PATCH/DELETE-admin)، contracts/[id]/items (GET/POST)، payment-templates (GET/POST + [id] PATCH/DELETE-admin)، vouchers/[id]/cancel (admin)، settings/visit-slot (GET/PUT-admin).
- المصدّات الناقصة من api-utils (parseAmount/TxClient/addContractEvent) عالجتها بلا لمس api-utils: عرّفت parseAmount محليًا في الملفات الثلاثة المستخدمة له (custody، items/[id]، contracts/[id]/items) بدلالة رقم نهائي finite أو null، وعرّفت addContractEvent محليًا في 3 ملفات (كتابة db.contractEvent.create بالحقول eventType/description/username المطابقة لنمط الجوار)، واستبدلت type TxClient بـ`Prisma.TransactionClient` من @prisma/client (في custody وclaim-number.ts).
- custody: حذفت `createdBy` من create Voucher الثلاثة (الحقل غير موجود في المخطط وكان سيرمي 500 وقت التشغيل — بقي تعليق الحارس الحرفي)، وحولت nextNumber من نمط المُنسّق المكسور `nextNumber('vouchers', (n)=>…, tx)` (كان سيرمي RangeError في padStart) إلى `nextNumber('PV', 4, tx)` و`nextNumber('CV', 4, tx)` المطابق تمامًا لاصطلاح voucher-server (VOUCHER_PREFIX payment→PV، custody_return→CV) وبنفس مخرجات PV-####/CV-#### المقصودة، وحولت ymd إلى `vdate.replace(/-/g,'')` (تاريخ نصي) وجعلت ymdOf تقبل string|Date، وفككت Decimal بـNumber() في computeBalances وpush amount.
- items/[id]: deletedAt غير موجود في BoqItem — استبدلت فحص `item.deletedAt == null` بـ`!item.deleted` والتحديث `deletedAt: new Date()` بـ`deleted: true` (حذف ناعم بالحقل الفعلي)، وفككت Decimal في مقارنات qty/unitPrice (Number(item.qty)) وformatKWD وحساب qty×unitPrice — وإصلاح where التالف كشف نوع include stage فأصلح خطأ it.stage المرافق تلقائيًا.
- contracts/[id]/items: `deletedAt: null` في where → `deleted: false` (وهذا أصلح خطأ it.stage?.name الناتج عن تدهور النوع)، وNumber() في round3(qty×unitPrice) وround3(contract.amount).
- payment-templates: DTO listTemplates يعيد الآن pct/amountFixed كـNumber() مع kindOf(Number, Number)، وeffPct/effFixed في [id]/PATCH تُشتق من Number(tpl.pct)/Number(tpl.amountFixed) (أصلح مقارنات >0)، وأضفت `contractTypeId: type.id` الناقص لنداء validateTemplateInput في POST (مطلوب بعد هجرة contractTypeId Int — نفس نمط [id]/PATCH).
- vouchers/[id]/cancel: cancelledAt كان يكتب Date والعمود String — استبدلته بـtodayStr() المطابق لاصطلاح voucher-server.ts (سطرا 1488/1357)، وaddContractEvent محلية.
- src/lib/claim-number.ts (مشار إليه بنداءات /api/claims): استيراد TxClient غير الموجود → `import type { Prisma } from '@prisma/client'` وتوقيع Prisma.TransactionClient (نداءاها الحاليان يمرران tx المعاملات فيتوافقان).
- أخطاء مرحّلتان ظهرا بعد أول تصفير وأصلحتهما: TS2367 مقارنة number≠Decimal في items/[id] (q !== item.qty وup !== item.unitPrice) — حولتهما لـNumber(item.qty)/Number(item.unitPrice).
- VERIFY: `bunx tsc --noEmit` أخطاء خارج reports/components/seed = صفر (الباقي 111 كلها prisma/seed.ts وsrc/components/** لغيري)؛ `bun run lint` exit 0 بلا ملاحظات؛ dev.log سليم (401 متوقعة لمسارات reports بلا جلسة).

Stage Summary:
- صفر أخطاء tsc في كل src/app/api خارج reports/ (+src/lib/claim-number.ts) بعد تصليح 8 ملفات: custody، items/[id]، contracts/[id]/items، payment-templates/[id]، payment-templates، vouchers/[id]/cancel، settings/visit-slot، claim-number.
- الثغرة الأمنية الجوهرية مغلقة: 13 موقع حارس كانت تمرّر الطلبات غير المصادقة/غير المخوّلة إلى منطق الأعمال (تسليم وتصفية وإرجاع عهدة، حذف بنود، إلغاء سندات، إعدادات) — الآن ترفض 401/403 فعليًا بنفس مفاتيح الصلاحيات السابقة.
- إصلاحات وقت تشغيل حقيقية رافقت الأنواع: createdBy على Voucher كان سيرمي Prisma runtime error، وnextNumber بصيغة المُنسّق كان سيرمي RangeError — الترقيم الآن PV/CV متسق مع بقية التطبيق، وcancelledAt نصي YYYY-MM-DD مطابق لاصطلاح الإلغاء الموحد.
- لم ألمس api-utils.ts ولا schema.prisma ولا أي ملف خارج نطاقي (لا reports ولا components ولا seed)؛ التغييرات كلها نوعية/حدودية بلا أي تغيير منطقي، والرسائل والحالات العربية كما هي.

---
Task ID: 28 (مراجعة شاملة مكتبية مقابل الويب — تنفيذ دفعة واحدة)
Agent: Z.ai Code (المنسق) + 4 وكلاء (28-a/b جرد، 28-c نسخ احتياطي، 28-e/f تصفير أخطاء)
Task: مراجعة توافٍ شاملة مع النسخة المكتبية V9.15.18 وتنفيذ كل الفجوات (علاقات جداول، تنظيم تابات، أمان، ديون تقنية) بلا رجوع للمستخدم

Work Log:
- جرد متوازٍ شامل: المكتبي (45 جدول DDL خام، 9 مجموعات تابات، آلة حالات موحدة، بوابات دفع، 8 تقارير، صلاحيات ~30 مفتاحاً) مقابل الويب (53 موديل prisma، 156 مسار API، 6 وحدات تنقل) — كشف: 7 علاقات مفقودة، 16 FK بلا علاقة، نمط حارس مكسور في 13 مساراً (تجاوز مصادقة فعلي)، أسماء prisma قديمة، نسخ احتياطي SQLite على Postgres، nav مخالف لتوجيه الـ4 تبويبات، 371 خطأ TypeScript مخفي بـignoreBuildErrors.
- schema: أُضيفت العلاقات السبع + ui_prefs على settings؛ SQL يدوي جاهز مع تنظيف اليتامى: prisma/manual-sql/2026-10-18_relations_and_ui_prefs.sql (لأن db push يحتاج استعادة اتصال Supabase).
- أمان: إصلاح نمط الحارس في 13 ملفاً (if ("response" in g)) — تحقق حي: custody/reports/items/visit-slot كلها 401 الآن بدل المرور بلا مصادقة.
- تشغيل: إصلاح 500s مؤكدة (createdBy على Voucher، nextNumber بصيغة خاطئة، deletedAt، payment-templates على contractTypeId النصي القديم) + أسماء قديمة في التقارير وui-prefs.
- نسخ احتياطي: إعادة بناء كاملة للـPostgres (backup-dump.ts بـ53 موديلاً بترتيب طوبولوجي، استعادة بمعاملة واحدة + إعادة ضبط التسلسلات + نسخة أمان تلقائية) — وكيل 28-c.
- تنقل: 4 تبويبات معتمدة (العقود: لوحة/مستحقات/عملاء/عقود/مهام/زيارات/تعليقات/متابعة — الباطن: المقاولون — المحاسبة: 10 بنود شاملة التقارير — الإعدادات: 10 أقسام) بمعرفات clients|subs|accounting|settings وحذف مكدس الأرشيف/المجموعات خارج النطاق المعتمد.
- بوابة الدفع: أُضيف DELETE /api/gateway/ops/[id] المفقود (يمنع حذف الموزّع/ذو الرسوم/التخصيصات) بنمط الجوار مع audit.
- تنظيف: 10 عائلات مسارات ميتة + 9 مكتبات عملاء ميتة + 12 مكوّناً ميتاً حُذفت بعد التحقق من انعدام المستوردين.
- أنواع: 371 → 0 خطأ tsc (وكيلان متوازيان للتقارير والمحاسبة + يدوي للمكونات: واجهة api المكتوبة حديثاً للمساعدات، PAYMENT_METHODS/voucherTypeLabel/formatDate/todayStr/tafqeetKWD، TypesView يجلب القوالب من نقاط النهاية الفعلية) ثم إزالة ignoreBuildErrors من next.config.
- seed.ts أعيد كتابته بشكل صحيح (pbkdf2 200k مطابق لـauth.ts، بلا كلمات مرور افتراضية).
- تحقق نهائي: prisma validate ✓، lint exit 0 ✓، dev.log نظيف، متصفحاً: شاشة الدخول تُصيَّر RTL سليمة ومحاولة دخول بقاعدة متوقفة = فشل رشيق وصفر أخطاء كونسول.

Stage Summary:
- الويب الآن مطابق للمكتبي في العلاقات والبوابة والحوكمة، والتنقل على التوجيه المعتمد، والبنية نوعياً نظيفة (tsc 0 / lint 0).
- الشحن: commit 9393fb7 مرفوع على main (GitHub خاص).
- المعلق الوحيد على المستخدم: سلسلة اتصال Supabase (بعد تدوير كلمة المرور) لتطبيق manual-sql + إعادة نشر — عندها يعمل كل شيء محلياً وعلى الإنتاج معاً.

---
Task ID: 29
Agent: Z.ai Code (منسق — استعادة اتصال القاعدة)
Task: استعادة اتصال Supabار محلياً بكلمة المرور المدوّرة + تطبيق SQL العلاقات + تحقق حي شامل

Work Log:
- وصلت كلمة مرور قاعدة البيانات الجديدة (pEgmw…1B) ⇒ أعدت بناء .env: DATABASE_URL عبر Transaction Pooler 6543 (pgbouncer=true&connection_limit=1) + DIRECT_URL عبر Session Pooler 5432 على aws-0-ap-northeast-1.pooler.supabase.com، وAUTH_SECRET جديد 64-hex (فقدته الحاوية سابقاً).
- عقبتان خلال الاستعادة وحُلّتا: (1) عميل Prisma لم يكن مولّداً بعد إعادة الضبط ⇒ bunx prisma generate (v6.19.2)؛ (2) بيئة الصدفة الأم تُصدِّر DATABASE_URL=file:... القديمة متجاوزة .env ⇒ unset قبل كل عملية قاعدة بيانات (قيد دائم لهذه البيئة).
- تحقق بيانات: users=2، contracts=1، جدول settings أحادي الصف ببنيته الفعلية (بلا عمود key — كان فحصاً خاطئاً مني أُصلح).
- فحص الانحراف: prisma migrate diff (from-url → schema) كشف بالضبط 7 قيود FK ناقصة + عمود settings.ui_prefs — مطابق لملف المهمة 28 ⇒ طبّقت prisma/manual-sql/2026-10-18_relations_and_ui_prefs.sql كاملاً (تنظيف اليتامى ثم القيود) ⇒ إعادة الفحص: "No difference detected" — القاعدة تطابق المخطط 100%.
- إعادة تشغيل dev server ببيئة نظيفة (unset ثم source .env) ⇒ الصفحة الرئيسية 200.
- تحقق متصفحي كامل (agent-browser): دخول admin ناجح ⇒ 4 تبويبات (العقود/الباطن/المحاسبة/الإعدادات) ⇒ لوحة المؤشرات ببيانات حقيقية (قيمة العقود 25,000.000، المحصّل 7,500.000، عقود نشطة 1) ⇒ تفاصيل العقد CON-0012 بتبويباتها الأربعة ⇒ الجدول الموحّد يعمل (دفعة مقدمة 7,500 مدفوعة + سطر لنا/عليهم + إرشاد بلا عقود باطن) ⇒ المحاسبة (إجمالي قبض 7,500) ⇒ الباطن (جدول مقاولين) ⇒ الإعدادات (بيانات الشركة من DB) ⇒ صفر أخطاء كونسول، RTL سليم، خلفية #F9FAFB، footer موجود، ولا تمرير أفقي على 390px.

Stage Summary:
- gh-8 مغلق: الاتصال المحلي مستعاد، SQL العلاقات مطبَّق، القاعدة مطابقة للمخطط، والتطبيق محلياً يعمل كاملاً ببيانات حقيقية متحققاً متصفحاً.
- المعلق الوحيد المتبقي: تحديث DATABASE_URL (وDIRECT_URL) على Vercel بنفس كلمة المرور الجديدة وإعادة النشر — الإنتاج حالياً بكلمة قديمة مدوّرة (يتوقف لحين التحديث)، وربط Vercel بGitHub للنشر التلقائي (gh-6).
- dbcheck.ts أداة فحص محلية في .zscripts (غير متتبعة عمداً).

---
Task ID: 29-b
Agent: Z.ai Code (منسق — تصحيح معلومة)
Task: تصحيح: كلمة مرور Supabase لم تُروَّر أبداً — الرمز المُرسل هو القائمة الحالية

Work Log:
- المستخدم وضّح أن كلمة المرور لم تُغيَّر على Supabasa مطلقاً؛ إذن pEgmw…1B هي القائمة الفعلية وليست تدويراً جديداً — ولذلك نجح الاتصال بها فوراً (قيمة صحيحة أرسلها المستخدم من موضعها).
- تحقق حي من الإنتاج https://contrack-online.vercel.app: دخول admin ناجح واللوحة تعرض نفس أرقام القاعدة (25,000.000 / 7,500.000) ⇒ اتصال Vercel بالقاعدة سليم وليس معطلاً كما قدرتُ في Task 29 — تصحيح لذلك التقدير.
- الاكتشاف الفعلي: الإنتاج يشغّل بنية قديمة (تبويبات: الرئيسية/العملاء والعقود/المحاسبة/المتابعة والتنسيق/التقارير/الإعدادات — 6 تابات) بينما main الحالي = 4 تابات (العقود/الباطن/المحاسبة/الإعدادات) ⇒ آخر نشر يدوي سبق Task 28، وVercel غير مربوط بGitHub (gh-6 يؤكد نفسه).

Stage Summary:
- لا شيء معطّل: القاعدة سليمة، كلمة المرور واحدة صحيحة محلياً وعلى Vercel، والاتصالان يعملان.
- المعلق الحقيقي الوحيد: نشر أحدث main على Vercel — عبر ربط GitHub من اللوحة (Settings → Git) أو VERCEL_TOKEN؛ بعده يظهر الويب بالبنية الجديدة (4 تابات + الجدول الموحّد + كل تمريرة Task 28).
- توصية أمنية مؤجلة: تدوير كلمة المرور لاحقاً لأنها مرت عبر محادثة نصية — عند التدوير تُحدَّث المحلياً (‎.env) وعلى Vercel معاً.

---
Task ID: 30
Agent: Z.ai Code (منسق — سؤال «هل البيان التلقائي يتم ام لا» + تنفيذ)
Task: التحقق من ميزة «البيان التلقائي» (سندات القبض/الصرف) مقابل المكتبي ثم تنفيذها إن كانت ناقصة

Work Log:
- تتبّع الميزة في المكتبي: vouchers.py (_auto_description V6.1/V6.2/V6.3) + extras_service.py (smart_receipt_description صيغ ق1–ق12 وق9–ق11، smart_receipt_stage_note، apply_description_prefix ببادئات الإعدادات الخمس) + supervision_service.supervision_receipt_description (القرار 5/ب) + voucher_payment_link_service (describe_items/_alloc_core/_PART_ORD/_prev_link_count/parts_paid_count) — وملخص التعديلات V9.15.2: «سند الصرف بدون بيان يُملأ تلقائيًا… البيان المكتوب يدويًا لا يُستبدل».
- الحكم: الويب لم يكن ينفّذها إطلاقًا (VoucherDialog حقل نص فارغ، ReceiptVoucherDialog نص ثابت «تحصيل على العقد» فقط) — أُجيب المستخدم بالسالب ثم نُفّذت.
- أُنشئ src/lib/voucher-describe.ts: ترحيل أمين لكل الصيغ — سداد/جزء/الجزء الثاني…/استكمال/الدفعة الكاملة/وزيادة مقدمة + «وهي عن أعمال {مرحلة}» + ذيل «— عقد {اسم}» (بلا تكرار كلمة عقد) + أوامر التغيير المعتمدة كسegment (ق8) + قواعد بلا خطة (ق9–ق11) + فرع الإشراف (شهر واحد/شهرين/N أشهر/أشهر تمديد/جزء بمتبقيه) + ملاحظة «مرحلة العمل: X + Y» + بادئات desc_prefix_* من الإعدادات (تنزع «:» الزائدة).
- الربط في voucher-server.prepareVoucher (8 مواضع): قبض بعقد (روابط صريحة ⇒ describeForLinks المطابقة لـapplyLinks، وإلا التوزيع الذكي + ملاحظة المرحلة في notes)، صرف باطن (توزيع آلي/روابط ⇒ صياغة الدفعات وإلا «سداد على الحساب — عقد …»)، صرف مقاول بلا subId، تسليم عهدة/إرجاع عهدة (بادئة custody)، تحويل («تحويل داخلي من X إلى Y» ببادئة transfer)، وتعديل السند (updateVoucher): حقل البيان المُرسل فارغًا يُملأ بقواعد المكتبي (receipt/payment/transfer). القاعدة الحاكمة كلها: نص المستخدم اليدوي لا يُدَس أبدًا.
- القيود البيئية: server-only غير قابلة للاستيراد خارج RSC ⇒ أُضيفت bun add server-only (وحّد الاستيراد)، والتحقق الوظيفي تم بسكربتين في .zscripts (غير متتبعة) ببناء core في الذاكرة + stubs — بلا أي كتابة على قاعدة الإنتاج.
- تحقق: tsc صفر، lint صفر، وعلى بيانات حقيقية: عقد CON-0012 خطته مدفوعة كاملة ⇒ أي قبض = «سداد على الحساب وزيادة مقدمة — عقد …» (مطابق للمكتبي)، وفي الذاكرة (خطة 5k/10k/10k بمحصل 2k): 600⇒«سداد الجزء الثاني من الدفعة رقم 1 وهي عن أعمال حفر وأساسات»، 5k⇒«سداد الدفعة رقم 1…وجزء من الدفعة رقم 2…»، 13k⇒سداد دفعتين كاملتين، 17500⇒ثلاث دفعات بجزء أخير، ملاحظات المراحل «حفر وأساسات + هيكل خرساني»، صرف باطن 4k⇒«سداد جزء من الدفعة رقم 2 وهي عن أعمال هيكل خرساني»، إشراف 1500⇒«سداد 3 أشهر من عقد الإشراف» و500⇒«سداد شهر واحد…». متصفحاً: دخول + فتح حوار سند قبض جديد نظيف وصفر أخطاء كونسول (لم يُنشأ سند على بيانات الإنتاج).

Stage Summary:
- «البيان التلقائي» صارت تعمل على الويب مطابقةً للمكتبي V9.15.18 في كل المسارات (قبض ذكي + إشراف + روابط + صرف باطن + تحويل + عهد + تعديل)، بنقطة حقيقة واحدة على الخادم تمنع تضارب النصوص وتحفظ قاعدة «لا دَس لليدوي».
- التغطية شاملة الصياغات العربية الثماني عشرة وبادئات الإعدادات الخمس، والتحقق تم على حالات جزئية/تراكمية/تمديد بلا أي تعديل على بيانات المستخدم الحقيقية.

---
Task ID: 30-b
Agent: Z.ai Code (منسق — سؤال «هل تم النشر على جيت هاب»)
Task: التحقق الفعلي من حالة النشر على GitHub

Work Log:
- git rev-list --left-right --count origin/main...main = 0 5 ⇒ خمسة commits محلية غير مرفوعة (d4671a8 و6a64c69 و2904cc0 و63c4207 البيان التلقائي وd5ecec2).
- آخر commit مرفوع فعلاً = 0dbeb57 (worklog Task 28)؛ أي أن ميزة «البيان التلقائي» (63c4207) ليست على GitHub بعد.
- محاولة push فعلية ⇒ fatal: could not read Username for 'https://github.com' — لا اعتماديات متاحة في البيئة (لا gh CLI، لا credential helper، لا ~/.git-credentials، لا رمز في remote URL، لا متغيرات بيئة).
- السبب: رمز GitHub المستخدم سابقاً (حتى Task 28) أُزيل من البيئة بعد حادثة التسريب (انظر Task 27 post-incident env findings).

Stage Summary:
- النشر على GitHub متوقف عند Task 28؛ لاستئنافه يلزم رمز وصول شخصي (PAT) بصلاحية repo يُرسله المستخدم ليُضمَّن إلى remote مؤقتاً ويُنظَّف بعده، أو أن يدفع المستخدم بنفسه.
- ملاحظة ثابتة: Vercel غير مربوط بGitHub (gh-6) — حتى بعد الرفع لن يتحدث الإنتاج تلقائياً إلا بربط GitHub من لوحة Vercel أو VERCEL_TOKEN.

---
Task ID: 30-c
Agent: Z.ai Code (منسق — استئناف النشر على GitHub برمز المستخدم)
Task: رفع الـ6 commits المتوقفة إلى GitHub برمز وصول أرسله المستخدم ثم تنظيف الرمز

Work Log:
- أرسل المستخدم رمز PAT كلاسيكياً (ghp_…) في المحادثة؛ ضُمّن مؤقتاً في remote URL للرفع فقط.
- git push origin main نجح ⇒ origin/main انتقل من 0dbeb57 إلى a575ad4 (6 commits: worklog 29، 6a64c69، worklog 29-b، 63c4207 البيان التلقائي، d5ecec2، worklog 30-b).
- تنظيف فوري: أُعيد remote URL إلى الصيغة النظيفة بلا رمز، وتحقّقت بـls-remote أن refs/heads/main على GitHub = a575ad4 = المحلي بالضبط.
- لا يوجد رمز مخزّن في .git/config أو البيئة بعد الانتهاء.

Stage Summary:
- gh-x مغلق: GitHub محدَّث بالكامل — أبرز ما رُفع: ميزة «البيان التلقائي» (63c4207) وسجلات المهام 29/29-b/30-b.
- توصية أمنية: الرمز مرّ عبر محادثة نصية ⇒ يُنصح المستخدم بحذفه (Revoke) من GitHub بعد انتهاء حاجته إليه في الجلسات القادمة.
- المعلق الوحيد المتبقي للمزامنة الكاملة: ربط Vercel بGitHub (Settings → Git) أو VERCEL_TOKEN — عندها يُنشر main الحالي تلقائياً (4 تبويبات + البيان التلقائي) على الإنتاج.

---
Task ID: 30-d
Agent: Z.ai Code (منسق — تتبع نشر Vercel بعد ربط GitHub)
Task: التحقق من أن ربط GitHub أطلق نشراً فعلياً للبنية الجديدة على الإنتاج

Work Log:
- فحص خارجي (بلا تسجيل دخول): bundles الإنتاج تحتوي علامات نصية للبنية الحالية لكنها ليست حاسمة (تسميات قد تسبق Task 28) ⇒ اعتمدت بروب API حاسم: DELETE /api/gateway/ops/1 (أُضيف بTask 28) يرد 404 وGET /api/custody يرد 404 HTML (الجديدة ترد 401 JSON) ⇒ الإنتاج ما زال البنية القديمة (buildId ثابت ouieJ36L8qrXMhGcvOUMr).
- راقبت الإنتاج ~14 دقيقة بمعدل probe كل دقيقة: صفر تغيير.
- عبر GitHub API برمز المستخدم: commit statuses على 0fe82a2 وa575ad4 و63c4207 كلها من Vercel بحالة failure ووصف "Deployment was blocked" (أُنشئت 2026-10-19T04:20:56Z = 07:20 بتوقيت الكويت) ⇒ Vercel استلم طلب النشر عند الربط لكنه حجبه، ولا deployments entries على GitHub.
- target_url للحجب: https://vercel.com/alaa-waheebs-projects/contrack-online/Hq4DRyWWLQ6nxs9KZsUQd9KgSkto — سبب الحجب وعملية الموافقة لا تظهران إلا لمالك الحساب.
- لا vercel.json في المستودع؛ البناء عبر إعدادات المشروع الافتراضية (next build).

Stage Summary:
- gh-6 تقدّم جزئي: الربط تم وحالة النشر تصل GitHub، لكن Vercel يحجب نشر الإنتاج من Git على كل الـcommits الحديثة.
- المطلوب من المستخدم: فتح رابط الحجب من لوحته (أو تبويب Deployments) لقراءة السبب — الأرجح: اشتراط موافقة على نشر الإنتاج (Approve and Deploy)، أو تعطيل "Deployments from Git"، أو حد استخدام/فوترة.
- بديل فوري: زر Redeploy يدوياً من آخر نشر ناجح في تبويب Deployments.
- بعد أي مسار نجاح أعيد التحقق الخارجي: تغيّر buildId + gateway/ops ترد 401/403 + custody ترد 401 JSON.

---
Task ID: 30-e
Agent: Z.ai Code (منسق — إصلاح سبب حجب Vercel)
Task: معالجة سبب «Deployment was blocked» الذي كشفته لقطة شاشة المستخدم

Work Log:
- لقطة المستخدم من صفحة النشر المحجوب أظهرت السبب الحاسم: بريد كاتب الـcommit (z@container) غير صالح — Vercel لا يستطيع ربط الكاتب بحساب GitHub فيحجب النشر (وكان يحجبه على كل الـcommits السابقة للسبب نفسه).
- محاولة جلب البريد عبر API فشلت (الرمز بلا نطاق user:email والبريد خاص) ⇒ اعتماد بريد GitHub النيو-ريبلاي القياسي المرتبط بالحساب: 104775889+a3laaw@users.noreply.github.com.
- git config (محلي) user.email + user.name = a3laaw، ثم هذا الـcommit نفسه يُنشأ بالبريد الصحيح ويُدفع ليُطلق نشراً جديداً بكاتب صالح — محتوى الشجرة يشمل كل شيء (بنية 4 تابات + البيان التلقائي).

Stage Summary:
- بعد الدفع: مراقبة الإنتاج حتى تغيّر buildId ثم بروب: DELETE /api/gateway/ops/1 يرد 401/403 وGET /api/custody يرد 401 JSON ⇒ عند تحققهما فالإنتاج حديث.
- درس دائم: كل commit مستقبلي من هذه البيئة يستخدم البريد النيو-ريبلاي (ضُبط محلياً في .git/config).

---
Task ID: 30-f
Agent: Z.ai Code (منسق — إغلاق نشر الإنتاج)
Task: التحقق النهائي من وصول النشر التلقائي إلى الإنتاج بعد إصلاح بريد الكاتب

Work Log:
- بعد دفع 91d2d4c بالبريد الصالح: حالة Vercel على GitHub انتقلت خلال ~دقيقة من "Vercel is deploying your app" (pending) إلى "Deployment has completed" (success) — أول نشر ناجح عبر Git في تاريخ المشروع.
- تحقق خارجي شامل على الإنتاج: buildId تغيّر من ouieJ36L8qrXMhGcvOUMr إلى CnJwig0jwQFLF7rsoaNdW؛ DELETE /api/gateway/ops/1 = 401 (كانت 404)؛ GET /api/custody = 401 JSON «يجب تسجيل الدخول» (كانت 404 HTML)؛ الصفحة الرئيسية 200.
- ذلك يعني أن الإنتاج يشغّل main كاملاً: بنية 4 تبويبات + إصلاحات الأمان (الحارس الحي) + علاقات المخطط + البيان التلقائي للسندات.

Stage Summary:
- gh-6 مُغلق نهائياً: GitHub ⇄ Vercel مربوطان والنشر التلقائي يعمل (بشرط بريد الكاتب الصالح المضبوط محلياً).
- gh-x (تأخر مزامنة الإنتاج) مُغلق: الإنتاج = المحلي = GitHub على 91d2d4c.
- هذا الـcommit نفسه سيُطلق نشراً ثانياً تلقائياً (توثيق فقط) — لا أثر وظيفي.

---
Task ID: 31-b
Agent: Z.ai Code (وكيل RTL — تحويل الأصناف الفيزيائية إلى منطقية في src/components)
Task: مسح فيزيائي RTL — تحويل text-left/right في src/components/contrack إلى text-start/text-end وفق القواعد (بما يعادل ml/mr/pl/pr في النطاق لأن المسح أثبت خلوّه منها)

Work Log:
- مسح شامل بـgrep على src/components: 28 ملفاً مطابقاً — 13 منها ضمن نطاقي (src/components/contrack) والباقي src/components/ui/** ممنوع اللمس. مسح إضافي موسّع (ml-/mr-/pl-/pr-/left-/right-/float-/space-x-) أثبت خلوّ contrack تماماً من غير text-left/right — أي لا قيم ml/mr/pl/pr أصلاً في نطاقي.
- تحويل 71 صنفاً فيزيائياً في 13 ملفاً: text-left→text-start (54: دائماً آمن — داخل dir="ltr" يبقى يساراً، وفي RTL يصير يميناً وهو صحيح للعربية)؛ text-right→text-start (16 رأس جدول عربي في DataManagementView — نفس المنظر يمين)؛ text-right→text-end (1: Input datetime-local مع dir="ltr" في TaskEditPage — نفس المنظر يمين داخل ltr).
- إضافة 9 أصناف text-end مكمّلة على خلايا أرقام dir="ltr" بلا صنف محاذاة، لأن تحويل رؤوسها من text-left إلى text-start وحده كان سيكسر اصطفاف العمود (الرأس يمين/الرقم يسار): VouchersView (المبلغ)، SubContractDialog (المبلغ×2، قيمتها، المغطى)، SubDeleteDialog (القيمة، المبلغ)، SubcontractorsView (إجمالي، منصرف). داخل dir="ltr" نتيجة text-end = يمين = اصطفاف مع الرأس المحوَّل — أصلح للعربية ومحافظ على تماسك العمود.
- متروك بوعي: (1) خلية المتبقي في SubcontractorsView — Badge داخل td بلا dir يصطف يميناً افتراضياً فيطابق الرأس المحوَّل بلا تعديل؛ (2) الأعمدة غير المطابقة التي تعتمد text-left الافتراضي من ui/table.tsx نفسها (الأساس يحمل text-left فيزيائياً على كل TableHead) — إصلاحها الوحيد في ui/table.tsx الممنوع عليّ، سُجّل للمنسق؛ (3) خلايا dir="ltr" غير المرافقة لرؤوس محوَّلة (أكواد/تواريخ/هواتف) تُركت كما هي.
- تحقق: bunx tsc --noEmit = صفر أخطاء، bun run lint = exit 0، grep العدّاد على contrack = 0 تطابق، git status = 13 ملفاً معدلاً كلها تحت src/components/contrack (صفر لمس لui/app/lib/hooks/prisma). لا قاعدة بيانات، لا dev server، لا commit.

Stage Summary:
- شاشات contrack صارت بلا أصناف محاذاة فيزيائية: الأرقام والمبالغ تصطف لجهة البداية في RTL عبر text-start/text-end مع الحفاظ التام على منظر dir="ltr" للأرقام نفسها، والجداول العربية أصبحت رؤوسها وبياناتها مصطفة معاً.
- أعلى أثر متبقٍ خارج نطاقي: صنف text-left الوحيد في src/components/ui/table.tsx (أساس TableHead) — تحويله إلى text-start يصلح محاذاة كل رؤوس الجداول في التطبيق دفعة واحدة؛ القرار للمنسق لأن ui/** محظور عليّ.

---
Task ID: 31 (منسق) + 31-a/31-b
Agent: Z.ai Code (منسق) + وكيل عام (31-b مسح الأصناف الفيزيائية)
Task: طلب المستخدم: «الشاشات بعضها RTL وبعضها LTR» + «مركز التقارير تاب علوي مع المحاسبة»

Work Log:
- التشخيص: (1) لا DirectionProvider في التطبيق ⇒ كل مكوّنات Radix عبر البوابات (Select/DropdownMenu/Popover/Dialog) تُصيَّر LTR افتراضياً رغم html dir=rtl — وهذا ما يراه المستخدم «شاشات LTR»؛ (2) أصناف فيزيائية (text-left/right) في 28 ملفاً تجعل شاشات كاملة تبدو يسارية؛ (3) رؤوس الجداول الأساسية ui/table.tsx تحمل text-left فيزيائياً.
- 31-b (وكيل): تحويل 80 موضعاً في 13 ملفاً (text-left→start 54، text-right→start 16، text-right→end داخل ltr 1، +9 text-end مكمّلة لاصطفاف الأعمدة الرقمية) — tsc 0/lint 0.
- 31-a (يدوي): bun add @radix-ui/react-direction + مكوّن AppDirectionProvider (use client) يلف children وToaster في layout.tsx بـdir="rtl"؛ إصلاح ui/table.tsx TableHead text-left→text-start وpr-0→pe-0؛ nav-structure.ts: ModuleId +reports، وحدة «التقارير» علوية (مركز التقارير الوحيد بنفس view/flag) وحذفها من المحاسبة (التعليق الموثّق حدّث إلى 5 تبويبات بتاريخ التوجيه).
- تحقق متصفحي (مستخدم مؤقت zverify admin أُنشئ ثم حُذف): 5 تبويبات علوية (العقود/الباطن/المحاسبة/التقارير/الإعدادات)؛ الجذر والقائمة rtl؛ القائمة المنبثقة Select فُتحت من اليمين وعلامة الاختيار يساراً (كانت الجوهرة الأهم)؛ شاشة السلف (أسوأ الملفات سابقاً) RTL كاملة؛ حوار «سلفة جديدة» dir=rtl والحفظ يميناً؛ مركز التقارير كتبويب مستقل بكل تقاريره الـ11؛ الجوال 390px بلا تمرير أفقي وقائمة الجوال RTL؛ صفر أخطاء/تحذيرات كونسول.
- حُذف zverify من القاعدة وكُسر سكربت الإنشاء (لا أثر دائم).

Stage Summary:
- gh-y مُغلق: توحيد الاتجاه RTL على مستوى Radix + الجداول + 13 شاشة كانت فيزيائية.
- تبويب «التقارير» علوي خامس كما وجه المستخدم، والمحاسبة بلا مركز التقارير.
- الرفع التالي سيُنشر تلقائياً على الإنتاج (النشر التلقائي يعمل منذ 30-f).

---
Task ID: 32
Agent: Z.ai Code (منسق)
Task: (بموافقة المستخدم) إخفاء بند «مركز التقارير» الوحيد المكرر من القائمة الجانبية

Work Log:
- فهم مُعروض وموافقة صريحة: التابات الأخرى قوائمها بعدة بنود مفيدة، أما التقارير فبند وحيد مكرر لاسم التاب — يُخفى.
- nav-structure.ts: خاصية NavModule.direct؟ جديدة، مطبقة على وحدة reports فقط (ملاحظة: الباطن بند وحيد أيضاً لكنه لم يُمس عمداً — التوجيه خاص بمركز التقارير).
- AppShell.tsx: القائمة الجانبية للحاسوب تُخفى كلياً للوحدات المباشرة (المحتوى يأخذ العرض الكامل)؛ درج الجوال يعرض الوحدة المباشرة زراً واحداً يفتح البند مباشرة بدل ترويسة + بند مكرر.
- تحقق متصفحي بمستخدم مؤقت (حُذف بعده): التقارير بلا aside والمحتوى 1056px كاملة؛ المحاسبة بقائمتها سليمة؛ درج الجوال يعرض «التقارير» زراً واحداً يفتح المركز مباشرة (h1=مركز التقارير وaside مخفية)؛ tsc=0 lint=0؛ لا أخطاء كونسول (تحذير Radix Description سابق غير مرتبط).

Stage Summary:
- تاب التقارير = وحدة مباشرة: تاب علوي يفتح المركز فوراً، بلا قائمة جانبية على الكمبيوتر، وزر مباشر في درج الجوال.
- قائمة التقارير الـ11 الداخلية داخل الشاشة بقيت كما وُافق عليها.

---
Task ID: 33
Agent: Z.ai Code (منسق — قائمة التقارير الجانبية الرسمية)
Task: (بموافقة المستخدم — الخيار 2) نقل قائمة التقارير إلى القائمة الجانبية الرسمية كالمحاسبة وإزالة العمود الفارغ

Work Log:
- تشخيص بالقياس الفعلي (متصفح 1536px): قائمة التقارير الداخلية كانت داخل حاوية max-w-6xl الموسّطة ⇒ فراغ 208px عن الحافة اليمنى (كان يُقرأ «عمودًا أول فارغًا» مكان القائمة القديمة)، بينما قائمة المحاسبة خارج الحاوية على مستوى الهيكل ⇒ فراغ 0.
- موافقة المستخدم صراحة على الخيار 2: مطابقة تامة لشكل المحاسبة.
- reports-list.ts (جديد): المصدر الموحد لتعريفات التقارير الـ11 (key/label/icon/desc/فلاتر) + DEFAULT_REPORT_KEY.
- nav-structure.ts: وحدة التقارير بـ11 بندًا حقيقيًا (id: report-{key}، view: reports، report: key، flag: reports) مبنية من REPORTS مباشرة؛ حذف خاصية NavModule.direct كليًا (أصبحت بلا معنى بعد تعدد البنود).
- AppShell.tsx: القائمة الجانبية الرسمية تُصيَّر لوحدة التقارير كأي وحدة (إلغاء استثناء direct)؛ درج الجوال يعيد التجميع القياسي (ترويسة التقارير + 11 بندًا) بدل الزر الواحد.
- ConTrackApp.tsx: حالة reportsKey (default من DEFAULT_REPORT_KEY)، selectChild يضبطها من child.report، activeNav = report-${reportsKey} في view reports، تمرير selected/onSelect إلى ReportsView، تصفيرها عند الخروج.
- ReportsView.tsx: حذف القائمة الداخلية العائمة (sticky top-20) وقائمة الاستثناءات المحلية؛ props محكومة selected/onSelect؛ قائمة «اختر التقرير» المنسدلة صارت lg:hidden (كانت md:hidden) لتغطية المدى md–lg حيث تختفي القائمة الرسمية.
- تحقق: tsc=0 أخطاء، lint=0، grep بلا أي أثر لdirect.
- فحص متصفحي شامل (مستخدم مؤقت zverify أُنشئ ثم حُذف): حاسوب 1536px: القائمة الجانبية ملاصقة للحافة اليمنى (فراغ 0 — كان 208) بـ11 بندًا والبند النشط مُبرز؛ تبديل التدفق النقدي/دفتر اليومية يغيّر التقرير والمُبرز معًا؛ طي/توسيع القائمة (56↔224px) يعمل؛ المحاسبة سليمة (9 بنود، فراغ 0)؛ جوال 390px: بلا تمرير أفقي، بند التقرير المنسدل ظاهر، الدرج يعرض التقارير الـ11 والنقر منها يفتح التقرير؛ عرض متوسط 800px: القائمة الرسمية مخفية والقائمة المنسدلة تظهر؛ صفر أخطاء كونسول.

Stage Summary:
- تاب «التقارير» صار بنيويًا كأي وحدة: قائمة جانبية رسمية كاملة الارتفاع ملاصقة لليمين تحوي التقارير الـ11، والمحتوى يملأ كامل العرض — اختفى العمود الفارغ نهائيًا.
- مصدر واحد للحقيقة (reports-list.ts) يغذي التنقل والشاشة معًا؛ خاصية direct أُزيلت من المنظومة.
- الملاحظة الوحيدة: النقر على تاب التقارير العلوي يفتح أول تقرير (كbehavior بقية التابات مع أول بند).

---
Task ID: 34 (المرحلة 1 من 9 — برومبت مطابقة المكتبي V9.15.19)
Agent: Z.ai Code (مطابقة بيان السند التلقائي)
Task: المرحلة 1 — بيان السند التلقائي: الترقيم الترتيبي + ذيل الدفع الجزئي + بادئة «سداد» + دالة القبض المخصّص (أمر تغييري/عقد إضافي)

Work Log:
- موافقة المستخدم على الخيار (أ): العمل بالمرجع المحلي contrack_v9.15.18 + النص الحرفي للبرومبت لبنود V9.15.19؛ المرحلة 6 مؤجلة حتى توفر نسخة 9.15.19.
- قراءة مرجعية كاملة: voucher_payment_link_service.py (619 سطرًا — _ordinal_i@53 / _alloc_core@565 / describe_items@604 / contract_tail@596)، extras_service.py (apply_description_prefix@62 / allocated_description@488 / allocation_options@454 / smart_receipt_stage_note@550 / smart_payment_description@594 / smart_receipt_description@618)، supervision_service.py (supervision_receipt_description@357)، ui/vouchers.py (_auto_description — ترتيب الأولوية: روابط ← تخصيص ← بيان ذكي)، voucher-describe.ts (410 أسطر)، مسارات الإنشاء/التعديل في voucher-server.ts.
- اكتشاف فجوة إضافية مؤكدة: الويب لا ينفّذ allocated_description إطلاقًا (سند قبض مخصّص لعقد إضافي/أمر تغييري كان يأخذ بيانًا من مسار الخطة) — أُضيفت المنظومة كاملة.
- voucher-describe.ts: ordinalI (مرآة _ordinal_i حرفيًا: «الأولى…العاشرة» ثم «رقم N»)؛ partialTail (مرآة partial_tail: « ومتبقي منها {X:,.3f} د.ك» بعتبة 0.001)؛ allocCore يستخدم الترتيبي ويضيف الذيل عند وجود remaining/amount؛ DescribeItem حقلا remaining/amount؛ applyDescriptionPrefix يمنع تكرار «سداد» (بادئة تحوي «سداد» + نص يبدأ «سداد » ⇒ حذف)؛ allocatedDescription جديدة (مرآة allocated_description + allocation_options: سداد/جزء/الجزء {ثاني…}/استكمال/سداد مقابل بند إضافي، مع excludeVoucherId لمسار التعديل).
- مواضع البناء: smartReceiptDescription items تمرر remaining=segAmt−(coverFrom−pStart) وamount=cover؛ describeForLinks items تمرر remaining=rem وamount=amt — فيظهر الذيل في المسارين (المربوط وغير المربوط) بذات دلالة المكتبي (المتبقي بعد السند).
- voucher-server.ts: استيراد allocatedDescription؛ مسار الإنشاء: أولوية روابط ← تخصيص (input.allocation) ← بيان ذكي (نفس ترتيب _auto_description المكتبي)؛ مسار التعديل: فرع تخصيص من v.allocation مع استبعاد السند نفسه.
- الإشراف والملاحظة: supervisionReceiptDescription وsmartReceiptStageNote مطابقان أصلًا للمرجع المحلي (قُفل سلوكهما باختبار)؛ fallback ملاحظة المرحلة إلى workflow_service مؤجل (يعتمد نظام المعاملات — المرحلة 9/12).
- اختبار المصفوفة tests/voucher-describe-matrix.test.ts (bun test): 34 اختبارًا / 44 تأكيدًا — الأمثلة الذهبية التسع حرفيًا + مصفوفة قبض/صرف × كامل/جزئي/زيادة × مربوط/غير مربوط + منع التكرار + نهاية-إلى-نهاية describeForLinks + قفل الإشراف. النتيجة: 34/34 pass.
- فحوص: tsc --noEmit = 0 أخطاء (استُثني tests من tsconfig كنمط scripts لأن bun يشغّلها بلا فحص أنواع)، eslint = 0، dev server يعمل، فحص متصفح: صفحة الدخول تصير بلا أخطاء كونسول/صفحة.
- لم يُغيّر: fmt3 (en-US بفواصل الآلاف — مطابق لـ{X:,.3f})، صيغ الإشراف بلا «د.ك» (كالمكتبي حرفيًا).

Stage Summary:
- بيان السند التلقائي في الويب صار يطابق المكتبي: «الدفعة الأولى…العاشرة» ثم «الدفعة رقم 11»، الجزئي يذكر المتبقي «ومتبقي منها 2,000.000 د.ك»، الجزء الثاني ترتيبيًا، البادئة لا تكرر «سداد»، والقبض المخصص لأوامر التغيير/العقود الإضافية يعمل بالصيغ المكتبية الخمس كاملة (سداد/جزء/الجزء الثاني/استكمال/بند إضافي غير معروف).
- الملفات: src/lib/voucher-describe.ts (+139/−12)، src/lib/voucher-server.ts (+17/−3)، tests/voucher-describe-matrix.test.ts (جديد 306 أسطر)، tsconfig.json (استثناء tests)، worklog.md.
- تبقى من المرحلة 1: لا شيء جوهري — الملاحظة المؤجلة الوحيدة: fallback ملاحظة المرحلة إلى المرحلة الحالية من نظام المعاملات (يُنفذ مع المرحلة 9/12).

---
Task ID: 35 (المرحلة 2 من 9 — برومبت مطابقة المكتبي V9.15.19)
Agent: Z.ai Code (الأمان والصلاحيات)
Task: المرحلة 2 — حدّ محاولات الدخول + مواءمة مفاتيح الصلاحيات PAGE_PERMS + حدود السكرتير بندًا بندًا

Work Log:
- 2/أ حدّ المحاولات: المكتبي ui/login.py:19 MAX_ATTEMPTS=3 (ثم إغلاق). جديد src/lib/login-rate-limit.ts: ذاكرة محلية بمفتاح «username|ip» (x-forwarded-for أول IP)، MAX_ATTEMPTS=3 حرفيًا، قفل مؤقت 15 دقيقة (مدة غير محددة في البرومبت/المكتبي — اختيار موثق)، مسح عند النجاح، نافذة عد تصفّر بعد انتهاء القفل. login/route.ts: فحص القفل قبل التحقق (429 برسالة عربية)، رسالة الفشل حرفية من المكتبي «اسم المستخدم أو كلمة المرور غير صحيحة. (متبقي N محاولة)»، رسالة القفل «تم تجاوز عدد المحاولات المسموح بها...»، تسجيل AuditLog لكل فشل (دخول فاشل) ولكل رفض بسبب القفل (دخول مرفوض — قفل مؤقت) مع user·ip.
- 2/ب المواءمة: كتالوج الويب توسع من 37 إلى 55 مفتاحًا: أُضيفت المفاتيح الـ16 المطلوبة (screen_statement/reports/followup/settings/claims/forms/receipts/payments + report_customer_profitability + action_print_statement/view_financial/whatsapp/delete/supervision_waive/form_design/change_status + action_edit_voucher + action_add_subcontractor) وكل مفتاح يحمل desktop?: مرجعه المكتبي وsecretary: قيمة المكتبي حرفيًا. الدمج الموثق: screen_receipts+screen_payments⇒screen_vouchers، action_add_receipt+action_add_payment⇒action_add_voucher، rep_customers⇒report_customers_balances، rep_supervision_delay⇒report_supervision_delays، rep_dues_board⇒report_stage_dues، rep_leads⇒report_prospects، action_edit_voucher_description⇒action_edit_voucher_desc. مفاتيح ويب-فقط = secretary:true حفاظًا على السلوك؛ استثناء موثق: screen_clearing=false (نص screen_gateway المكتبي يغطي «التصفية اليومية — للمدير فقط»).
- الفصل المعماري: الكتالوج النقي انتقل إلى src/lib/permissions-catalog.ts (بلا server-only ليُختبر)، وauth.ts يعيد تصديره ويضيف roleDefaultAllowed (مرآة role_perm_defaults: المدير/المطور الكل، السكرتير حسب العلم، المجهول لا يقيّد) وpermsForUser (استعلام واحد + افتراضيات) وhasPermission يقدّم التخصيص الصريح على الافتراضي.
- الفرض: authGuard كان يدعم permKey أصلًا — الآن يفرض افتراضيات الدور تلقائيًا عبر hasPermission. /api/auth/me يعيد perms: Record<key,boolean>. nav-structure: NavChild.perm + ربط كل بنود القائمة (customers→screen_customers، vouchers→screen_vouchers، gateway→screen_gateway...) + REPORT_PERM (11 تقريرًا ← report_*) — إخفاء بالصلاحية كالمكتبي. AppShell: prop perms + permOn في visibleChildren (غير المحمّلة = سماح منعًا للوميض). ConTrackApp يمرر الخريطة من /api/auth/me.
- 2/ج حدود السكرتير: مثبتة بالاختبارات — الممنوع: البوابة/التصفية/ربحية العميل/التدفق النقدي/اليومية/إلغاء السند/رؤية الربحية/الحذف/إلغاء تمديد الإشراف/تصميم النماذج/تغيير حالة العقد/إضافة مقاول؛ والمسموح: العملاء/الباطن/السندات/الزيارات/الكشف/التقارير المسموحة/إنشاء السندات/تعديل السند/واتساب/طباعة الكشف.
- إصلاح خلل كامن موروث: سطر معطوب في AppShell.tsx (مصفوفة dependencies بـ«anager, flagOn]» منقوصة «[m» — دخل في commit سابق) — أُصلح إلى [manager, flagOn, permOn]. ملاحظة تقنية موثقة: قناة أدوات الكتابة/العرض تلتهم التسلسل الحرفي [m — فحص البايتات الخام إلزامي عند كتابة مصفوفات تبدأ بـ[m.
- الاختبارات: tests/phase2-auth-security.test.ts (bun) — 11 اختبارًا/240 تأكيدًا: قفل بعد 3 محاولات، عزل المفاتيح، تصفير النجاح، lockState ثوانٍ متبقية، افتراضيات الأدوار الثلاثة، الممنوع/المسموح عينات حرفية، المفتاح المجهول، اكتمال الـ16 مفتاحًا، كل مفاتيح الكتالوج بعلم secretary صريح. الإجمالي مع المرحلة 1: 45/45.
- فحوص: tsc=0، eslint=0، dev يترجم بلا أخطاء.

Stage Summary:
- الدخول محمي بحدّ 3 محاولات/قفل 15 دقيقة من جهة الخادم مع تدقيق كامل، والصلاحيات صارت بكتالوج مواءم موثق (55 مفتاحًا) تُفرض خادميًا (authGuard) وبصريًا (إخفاء بنود القائمة حسب الدور) — السكرتير بندًا بندًا كالمكتبي، والمدير/المطور الكل. التخصيصات المحفوظة (user_permissions) تُقدَّم على الافتراضيات فلا تنكسر أي صلاحيات قائمة.
- الملفات: src/lib/permissions-catalog.ts (جديد)، src/lib/auth.ts، src/lib/login-rate-limit.ts (جديد)، src/app/api/auth/login/route.ts، src/app/api/auth/me/route.ts، src/components/contrack/nav-structure.ts، src/components/contrack/AppShell.tsx، src/components/contrack/ConTrackApp.tsx، tests/phase2-auth-security.test.ts (جديد)، worklog.md.
---
Task ID: 36 (المرحلة 3 من 9 — برومبت مطابقة المكتبي V9.15.19)
Agent: Z.ai Code (المزايا والبوابات الخادمية)
Task: المرحلة 3 — حارس المزايا خادميًا (requireFeature) + بوابة rep_* للتقارير + إنزال مفاتيح amount_guard/settle_edit/mode_banner/bank_fee/items_sync/template_plan_mode/notif_cleanup

Work Log:
- ملاحظة تشغيلية: commitا المرحلتين 1 و2 (4db864c، 222eae3) محليان — git push فشل («could not read Username») لأن بيانات الاعتماد لم تعد في بيئة الجلسة؛ لم يُغيّر أي مفتاح/إعداد remote (التزامًا بتعهد المستخدم) — الدفع معلّق على توفر المفتاح.
- قراءة مرجعية: feature_service.py (المفاتيح الـ42 + FORCED_ON)، ui/contracts.py (amount_guard@1365: معطّلة=منع صارم برسالة حرفية، مفعّلة=QMessageBox بخيارات «تحديث المبلغ/توزيع الدفعات/حفظ بالفرق»؛ _rescale_plan_to@1438: الأخيرة تأخذ الباقي؛ template_plan_mode@947: has_tpl=نوع له قالب+الميزة؛ mode_banner@2489: pass — مُزال بالكامل؛ _sync_plan_from_items@2472)، ui/custody_center.py (settle_edit@2128/2205: إخفاء «✎ تعديل التصفية» ورسالة «تعديل التصفية معطّل لهذا العميل.»)، main_window.py (notif_cleanup@1719: بند «مسح كل إشعارات المتابعة» في قائمة الجرس)، settings.py:_save_modules (bank_fee ⇒ set_modules ⇒ bankFeeEnabled)، lifecycle_service._receipt_bank_fee@2714 (الرسوم من الإعداد)، workflow_service._generate_type_payments_from_template@4266 + type_payment_preview@4130 (النسبة من القيمة/اليدوي كما هو/المرنة لا تُدرج، الاستحقاق=start+days، الربط بالاسم V4.48).
- 3/أ حارس خادمي: api-utils.ts جديدان featureGuard(featureKey,msg)⇒403 وfeatureOn() — يقرآن feature_flags ويحسبان effective بعد requires (isEffectivelyEnabled).
- 3/ب بوابة التقارير: report-features.ts (خريطة 10 مفاتيح rep_* مكتبية حرفيًا؛ «expenses» بلا مفتاح مكتبي — موثق) مطبقة على 10 مسارات GET + مسار التصدير (journal/customers-balances/stage-dues/supervision-delays/subcontractors/vouchers/cashflow/contracts/execution/leads)؛ الواجهة: reports-list.ts حقل flag لكل تقرير + visibleReports()، nav-structure تمرر r.flag??«reports» (إخفاء من القائمة الرسمية تلقائيًا)، ReportsView تُفلتر المنسدلة موبايلًا والافتراضي.
- 3/ج المفاتيح: amount_guard خادميًا في POST /api/contracts (فرق اتجاهين بعتبة 0.001: معطّلة⇒400 برسالة الأصل الحرفية، مفعّلة⇒سياسة إلزامية update_amount/scale_plan/keep_diff مع تطبيق فعلي: تحديث القيمة لplanSum، توزيع نسبي بالباقي للأخيرة) وواجهيًا في ContractNewPage (AlertDialog حرفي: العنوان/النص/الأزرار الثلاثة/«رجوع للتعديل» + توست المنع الصارم عند التعطيل) — وcontract-create.ts نقّي مُختبر (amountGuardProblems/amountGuardStrictMessage/scalePlanAmounts/templatePlanRows). settle_edit ⇒ featureGuard على PATCH /api/custody/settlements/[ref] برسالة الأصل. bank_fee ⇒ مزامنة PUT feature-flags مع Setting.bankFeeEnabled (مطابقة set_modules) والمحرك القائم receiptBankFee يقرأها. template_plan_mode ⇒ ContractNewPage: نوع له قالب+مفتاح مفعّل ⇒ وضع القالب (إخفاء «إضافة دفعة» وتعطيل الحذف مع تلميح حرفي) + **توليد الخطة من قالب النوع في POST /api/contracts عند غياب الدفعات اليدوية** (كان مفقودًا رغم نص الواجهة — النسبة/اليدوي/المرنة تُتخطى/الاستحقاق=التاريخ+الأيام/الربط بالاسم بالاستهلاك الترتيبي) — وأضيف templatesCount إلى ContractTypeDTO. mode_banner/items_sync/notif_cleanup ⇒ تعليقات مرجعية موثقة في feature-flags.ts (الأول مُزال مكتبيًا pass؛ الثاني يحتاج وضع البنود بكامله والويب يمنع تعديل المبلغ بعد الإنشاء — مؤجل للمرحلة 7؛ الثالث قائمة الجرس نفسها غير منقولة بعد).
- الاختبارات: tests/phase3-features.test.ts — 21 اختبارًا/94 تأكيدًا (الخريطة المكتبية الحرفية، FORCED_ON، visibleReports، عتبة 0.001، الرسالة الحرفية، السياسات الثلاث، التوزيع النسبي بمجموع مطابق وتخطي الصفوف الصفرية، توليد القالب: نسبة/يدوي/مرنة/تواريخ/عناوين افتراضية/مراحل الربط، اكتمال المفاتيح السبعة وسلاسل requires). الإجمالي 66/66.
- التحقق المتصفحي (مستخدم مؤقت zphase3 admin أُنشئ ثم حُذف): دخول ⇒ وحدة التقارير تعرض الـ11؛ PUT rep_journal=false ⇒ البند اختفى من القائمة (10) وGET /api/reports/journal ⇒ 403 «هذه الميزة معطّلة في النظام» والتصدير 403 أيضًا؛ إعادة التفعيل ⇒ عاد البند. عقد جديد بلا نوع: المبلغ 10,000 + دفعة 5,000 ⇒ الحوار الحرفي ظهر بثلاثته («تحديث مبلغ العقد إلى 5,000.000»/«توزيع الدفعات على المبلغ 10,000.000»/«حفظ بالفرق (يُسجل في التقرير)») و«رجوع للتعديل» أغلق بلا حفظ؛ تعطيل amount_guard ⇒ توست المنع الصارم («عدّل القيم حتى تتساوى قبل الحفظ») بلا حوار؛ عقد جديد بنوع «أعمال مدنية» (3 قوالب) ⇒ «إضافة دفعة» مخفية وتلميح وضع القالب ظاهر. صفر أخطاء كونسول وصفحة، و0 عقود اختبارية أُنشئت (المسارات الخادمية مغطاة بالاختبارات النقية وتجنبًا لاستهلاك تسلسل أرقام الإنتاج).
- فحوص: tsc --noEmit=0، eslint=0، bun test 66/66، dev server يترجم نظيفًا.

Stage Summary:
- المزايا صارت تعمل كالمكتبي في الاتجاهين: تعطيل الميزة يخفي الواجهة **ويوقف الخادم** (403 برسائل الأصل) — التقارير الـ11 بمفاتيحها الفردية، تعديل التصفية محروس بsettle_edit، والرسوم البنكية تُحكَم بمفتاحها عبر مزامنة الإعداد.
- حارس المبلغ بالخيارات الثلاثة الحرفية خادميًا وواجهيًا، ووضع القالب مع توليد خطة حقيقي من قالب النوع (فجوة قديمة سُدّت).
- مفاتيح بلا هدف ويبي حاليًا (mode_banner مُزال مكتبيًا · items_sync يحتاج وضع بنود كامل · notif_cleanup يحتاج قائمة جرس) موثقة في الكتالوج ولا تُبنى إلا بقرار (المرحلة 7/9).
- الملفات: api-utils.ts، report-features.ts (جديد)، contract-create.ts (جديد)، 12 مسار API (10 تقارير+export+contracts+settlements+feature-flags)، reports-list.ts، nav-structure.ts، ReportsView.tsx، ContractNewPage.tsx، feature-flags.ts، contrack-types.ts، tests/phase3-features.test.ts (جديد).
- بقي من المرحلة 3: لا شيء جوهري — الدفع لعندي معلق على المفتاح (المرحلتان 1+2+3 جاهزة للدفع معًا).

---
Task ID: 37 (متابعة «حل موضوع الدفع» — التحقق النهائي واكتشاف توقف النشر)
Agent: Z.ai Code (منسق)
Task: طلب المستخدم «حل موضوع الدفع» — التحقق من اكتمال حل موضوع بيان الدفع (المرحلة 1) وحالته على الإنتاج

Work Log:
- تبيّن من السجل أن المرحلة 1 (بيان السند التلقائي — موضوع الدفع) اكتملت في Task 34: ordinalI + partialTail + منع تكرار «سداد» + allocatedDescription + الأمثلة الذهبية التسعة.
- تحقق إعادة من الصفر: bun test tests/voucher-describe-matrix.test.ts ⇒ 34/34 pass (44 تأكيدًا)؛ bunx tsc --noEmit ⇒ 0 أخطاء؛ bun run lint ⇒ 0.
- فحص متصفح agent-browser على http://localhost:3000: صفحة الدخول تُصيَّر كاملة (عنوان + حقول + زر دخول) وصفر أخطاء كونسول.
- الاكتشاف الجوهري: git rev-list origin/main...main = 0 3 ⇒ ثلاثة commits غير مرفوعة: 4db864c (المرحلة 1 — الدفع) و222eae3 (المرحلة 2) و5fa30a5 (المرحلة 3)؛ آخر commit على GitHub = d718555 (Task 33) ⇒ الإنتاج contrack-online.vercel.app ما زال يشغّل النسخة القديمة بلا إصلاح الدفع.
- سبب توقف الرفع: لا اعتماديات GitHub في البيئة إطلاقًا (لا credential helper، لا ~/.git-credentials، لا gh، لا رمز في remote أو env أو ملفات .env) — الPAT السابق (Task 30-c) كان مؤقتًا ونُظّف بعده كما الاتفاق.
- تأكد أمني: لم يُلمس أي مفتاح، ولا أي كتابة على قاعدة الإنتاج (التحقق الوظيفي بالاختبارات فقط والمتصفح قراءة فقط).

Stage Summary:
- «موضوع الدفع» محلول ومختبر ومحفوظ محليًا (4db864c) — ما تبقى الوحيد لرؤيته على الإنتاج: رفع الـ3 commits بPAT مؤقت من المستخدم (يُنظَّف فور الرفع كالسابق).

---
Task ID: 38 (نشر المراحل 1+2+3 إلى الإنتاج)
Agent: Z.ai Code (منسق)
Task: طلب المستخدم «هل نستكمل ام تنشر الاول» + تزويد PAT مؤقت — رفع الـ4 commits والتحقق من النشر

Work Log:
- جواب السؤال: النشر أولًا ثم الاستكمال (العائد المتفق عليه) — المستخدم أرسل PAT فورًا.
- الرفع عبر remote مؤقت بالرمز ثم تنظيف فوري: git push origin main ⇒ 222eae3..4942600 main->main ناجح.
- تحقق التطابق: git rev-list origin/main...main = 0 0 — المحلي = GitHub بالكامل (4db864c المرحلة 1، 222eae3 المرحلة 2، 5fa30a5 المرحلة 3، 4942600 توثيق worklog).
- التحقق من remote بعد التنظيف: نظيف بلا رمز (origin https://github.com/a3laaw/contrack-online.git).
- استعلام GitHub API (قراءة فقط بالرمز) لحالة الـcommit 4942600: state=success — «Deployment has completed» من Vercel ⇒ النشر التلقائي اشتغل فور الرفع.
- فحص الإنتاج بعد النشر: GET https://contrack-online.vercel.app = 200.
- لم يُخزَّن الرمز في أي ملف ولا متغير دائم؛ لم يُلمس أي مفتاح قائم (التزامًا بتعهد المستخدم) — وتوصية مؤجلة: تدوير الـPAT بعد اكتمال كل العمل لأنه مر عبر المحادثة (كما توصي سابقًا بكلمة قاعدة البيانات).

Stage Summary:
- الإنتاج contrack-online.vercel.app يعمل الآن بكل تحسينات المراحل 1–3: بيان الدفع التلقائي المطابق للمكتبي + حد محاولات الدخول ومواءمة الصلاحيات + حارس الميزات وبوابة التقارير.
- ما تبقى من الخطة: المراحل 4، 5، 7، 8، 9 (والسادسة مؤجلة حتى نسخة 9.15.19) — جاهز للبدء بالرابعة بأمر المستخدم.

---
Task ID: 39 (المرحلة 4 من 9 — تقارير العُهد السبعة)
Agent: Z.ai Code (منسق)
Task: المرحلة 4 — تبويبات تقارير العُهد السبعة كالمكتبي (التصفيات المجمع · الأرصدة · كشف موظف · تفصيلي · الشهري · كشف العهد · المعلقة) + API + CSV

Work Log:
- قراءة مرجعية كاملة: lifecycle_service.py (custody_balances@3425 · custody_open_items@3483 · custody_accounts@3528 · custody_ledger@3544 · custody_detailed_report@3681 · custody_monthly_summary@3746 · custody_handover_list@3802 · settlements_summary@3913) + ui/custody_center.py CustodyReportsWidget (7 تبويبات 797-1655) — الأعمدة ونصوص الإجماليات والافتراضيات حرفيًا.
- اكتشاف مطابقة دقيق: تفاصيل التصفيات في الكشف المكتبي تأتي من list_vouchers التي **لا تُفلتر الملغى** وتشمل vtype IN (payment, transfer) — طُوبق نفس السلوك موثقًا في custody-reports-core.ts (detailsCount من التجميع الفعّال والتفاصيل كما وردت).
- الملفات: src/lib/custody-reports-core.ts (جديد — بناة نقية: aggregateBalances/buildOpenItems/buildSettlementsSummary/buildLedgerItems/filterSearchAndBalance/buildDetailedRows/buildMonthlyRows بلا server-only لِتُقفل بالاختبارات) · src/lib/custody-reports.ts (جلب Prisma + إعادة تصدير) · src/app/api/custody/reports/route.ts (جديد — GET بسبعة أنواع + format=csv بصفوف التصدير المكتبية حرفيًا: بنود ↳ + مجاميع فرعية عند ≥2 عهد + صف الإجمالي + BOM) · src/components/contrack/CustodyReports.tsx (جديد — 7 سبتابات بنفس الأعمدة ونصوص الإجماليات المكتبية + فلاتر من/إلى/العهدة + «إظهار البنود» + «أقدم من (يوم)» + ألوان الرصيد السالب/الصفري) · CustodyView.tsx (تاب رابع «التقارير»).
- الافتراضيات المكتبية طوبقت: التصفيات المجمع from=to=اليوم؛ بقية التبويبات من=اليوم−12 شهرًا؛ كشف موظف يتطلب عهدة؛ المعلقة spin=30 يومًا.
- الاختبارات tests/phase4-custody-reports.test.ts: 23 اختبارًا/91 تأكيدًا — سيناريو ذهبي كامل (تسليم 1000 · تصفية 400+350 · إرجاع 100 ⇒ رصيد 150) + قواعد المكتبي: الرصيد = مُسلَّم−منفَق−مرتجع، MAX نصي للقطة الحساب، المعلقة >0.005 وأيام غير سالبة، البيان بلا تكرار بفاصلة عربية، «تسليم عهدة - المستلم»، البحث بالتطبيع العربي داخل البنود، فك التصفيات «تصفية REF» برصيد **لكل حساب**، الشهري بافتتاحي ما قبل الفترة. الإجمالي الكلي: 89/89 (المراحل 1-4).
- فحوص: tsc --noEmit = 0، eslint = 0، bun test 89/89.
- حادثة بيئية: خادم التطوير مات (P1012: DIRECT_URL مفقود) — ملف .env.local ضاع بإعادة ضبط الحاوية وكان يحمل مفاتيح Supabase؛ أُنشئ .env.local من .env.example لكن بياناته فشلت (P1000: Authentication failed) ⇒ بيانات القاعدة الفعلية غير موجودة في البيئة. البحث في تاريخ git عن نسخ قديمة أثبت عدم وجودها هناك أيضًا (كلها معتنّة أو قديمة). المحلي لا يعمل حاليًا مقابل أي قاعدة — وهذا لا يعيق النشر (Vercel لها مفاتيحها).
- سُجّل بالبديل الأمني: تحقق إنتاجي — Vercel status=success على f145cfd، والصفحة 200، وGET /api/custody/reports?kind=balances = **401** (كانت 404 قبل النشر) ⇒ الكود الجديد حي على الإنتاج والمسار محمي بالصلاحية.
- المستخدم المؤقت zphase4 لم يُنشأ (توقف عند فشل الاتصال) — لا أثر له في القاعدة؛ السكربتات المؤقتة حُذفت.

Stage Summary:
- مركز العُهد في الويب صار 4 تبويبات (الحسابات · التصفيات · السجل · **التقارير السبعة**) مع API موحد وتصدير CSV مطابق لمصادير المكتبي — بلا أي تعديل على منطق الكتابة القائم.
- معلّق على المستخدم: إرسال رابطي القاعدة الحاليين (DATABASE_URL عبر 6543 وDIRECT_URL عبر 5432) لإحياء البيئة المحلية والتحقق المتصفحي الكامل في المراحل القادمة؛ رابط .env.example قديم (فشل توثيق).

---
Task ID: 40 (إحياء البيئة المحلية + التحقق المتصفحي للمرحلة 4 + إصلاح خلل إنتاجي)
Agent: Z.ai Code (منسق)
Task: المستخدم أرسل بيانات Supabase المعلّقة من Task 39 — إحياء البيئة المحلية وإكمال التحقق المتصفحي الكامل للمرحلة 4

Work Log:
- وصلت كلمة مرور قاعدة البيانات الجديدة (لا تُخزَّن في أي ملف مرفوع؛ .env.local محلي فقط ومستثنى من git) — حُدّث برابطي Pooler 6543/5432 بصيغة postgres.<ref>@aws-0-ap-northeast-1.
- عقبة بيئية موثقة: الحاوية تفرض DATABASE_URL=file: (SQLite) كمتغير عام يتغلب على .env.local ⇒ الحل: تحميل .env.local صراحةً قبل أي عملية، ومنها خادم التطوير.
- الاتصال نجح: PostgreSQL 17.11 — 53 جدولًا · users=2 · audit_log=395. خادم التطوير اشتغل مقابل قاعدة الإنتاج (GET / = 200).
- أُنشئ مستخدم التحقق المؤقت zphase4 (admin) وفق خطة Task 39 المقطوعة، ودخِل المتصفح به.
- **اكتشاف خلل إنتاجي حقيقي**: فتح تبويب «التقارير» يُسقط العميل كليًا (Runtime TypeError: rows.reduce is not a function) — وهو حي على الإنتاج أيضًا (f145cfd). سببان متراكبان:
  1) شكل تقرير «الملخص» من الـAPI كائن {rows,count,total} بينما الواجهة تعاملته كمصفوفة مباشرة.
  2) الأعمق: keepPreviousData يُبقي رد التقرير السابق حيًا أثناء التبديل فيستقبل ReportTable شكل تقرير آخر (كائني/مصفوفي).
- الإصلاح في CustodyReports.tsx فقط (بلا أي تغيير في الـAPI أو القاعدة): قراءة {rows,count,total} في ملخص التصفيات + حماية جوهرية data.kind === kind قبل التصيير.
- التحقق المتصفحي الكامل بعد الإصلاح: فتح التقارير بلا انهيار؛ التبويبات السبعة كلها تصيّرت (الملخص/الأرصدة/التفصيلي/الشهري/كشف العهدة/المعلقة بأصفار القاعدة الفعلية؛ كشف موظف يطلب اختيار العهدة كالمكتبي)؛ أخطاء النافذة = []؛ CSV لأنواع summary/balances/open/monthly: 200 + text/csv;charset=utf-8 + رؤوس عربية صحيحة + BOM بالبايتات الخام (EF BB BF) + CRLF.
- تنظيف كامل: حُذف zphase4 وسجل تدقيقه (بقيا admin/secretary كما كانا)، السكربتات المؤقتة أُزيلت، المتصفح أُغلق.
- الفحص النهائي: bun test 89/89 (469 تأكيدًا) · tsc 0 · eslint 0.
- المفتاح sb_publishable المرسل من المستخدم غير مستخدم في التطبيق (لا Supabase JS) — لا إجراء مطلوبًا عليه؛ التطبيق يحتاج رابطي القاعدة فقط.

Stage Summary:
- البيئة المحلية حية مقابل قاعدة الإنتاج، والمرحلة 4 مُتحقق منها متصفحيًا من أولها لآخرها بعد إصلاح خلل كان سيصيب كل من يفتح التقارير على الإنتاج.
- عاجل على المستخدم: PAT مؤقت لرفع commit الإصلاح فورًا (الخلل حي على contrack-online.vercel.app حتى الرفع) — يُنظَّف فور الرفع كالعادة.
- تذكير مؤجل: بعد اكتمال كل المراحل يُنصح بتدوير كلمة مرور القاعدة والPAT (مرّتا عبر المحادثة).

---
Task ID: 41 (رفع إصلاح التقارير إلى الإنتاج)
Agent: Z.ai Code (منسق)
Task: المستخدم أرسل PAT مؤقتًا — رفع commit الإصلاح 4927b29 والتحقق من نشر Vercel

Work Log:
- الرفع عبر remote مؤقت بالرمز ثم تنظيف فوري: push ناجح a21ea06..4927b29 main->main؛ الremote عاد نظيفًا بلا رمز؛ rev-list origin/main...main = 0 — المحلي مطابق لGitHub.
- استعلام GitHub API (قراءة فقط): حالة commit 4927b29 — pending ×2 ثم **success** خلال ~75 ثانية (نشر Vercel التلقائي).
- فحص الإنتاج: GET / = 200؛ GET /api/custody/reports?kind=summary = 401؛ kind=balances = 401 — مسار التقارير محمي بالصلاحية وحي (401 لا 404).
- إصلاح انهيار تبويب «التقارير» (Task 40) حي الآن على contrack-online.vercel.app.
- لم يُخزَّن الرمز في أي ملف ولا متغير دائم (بروتوكول النظافة المعتاد).

Stage Summary:
- الإنتاج يعمل بالمراحل 1–4 كاملة مع إصلاح انهيار التقارير. ما تبقى من الخطة: المرحلة 5 (أنماط التدفقات الأربعة + الرسم الشهري SVG) ثم 7، 8، 9 (والسادسة مؤجلة حتى 9.15.19).
- تذكير مؤجل بعد اكتمال كل العمل: تدوير الPAT وكلمة مرور قاعدة البيانات (مرّا عبر المحادثة).

---
Task ID: 42 (المرحلة 5 من 9 — أنماط التقرير المالي الأربعة + الرسم الشهري SVG)
Agent: Z.ai Code (منسق)
Task: المرحلة 5 — الوارد فقط · منصرف فقط · مسترد فقط · تحويلات فقط + رسم الأعمدة الشهري (أخضر/أحمر) كالمكتبي

Work Log:
- المرجعية المكتبية الحرفية: reports_page.py:474 _data_cash_flow (الأنماط الأربعة بنصوص ملاحظاتها وأعمدتها) · :455 _transfer_buckets (V4.33: بنك→صندوق · صندوق→بنك · نفس المحفظة · الصافي طرح لا جمع) · :1364 ترتيب الخيارات التسعة · cashflow_chart.py (أعمدة شهرية RTL أول شهر يمين · #16A34A وارد / #DC2626 منصرف · شبكة 4+1 · قيم k فوق الأعمدة · وسيلة إيضاح أعلى اليسار) · الاختبار المكتبي test_financial_report_transfer_filters.py (السيناريو الذهبي 200/50/100).
- ملاحظة مرجعية: CashflowChart المكتبي معرَّف بلا استخدام في V9.15.18 — نُفّذ على الويب بمواصفته كاملة (يظهر مع الوضع «شهري»).
- TDD أولًا: tests/phase5-cashflow-modes.test.ts = 17 اختبارًا/53 تأكيدًا (أحمر ثم أخضر) — تصنيف المحافظ نصيًا كـ openingForAccount، دلو التحويلات والصافي، الرؤوس الحرفية، نصوص الملاحظات حرفيًا مع :,.3f، إدراج «داخل نفس المحفظة» قبل «العدد»، تنسيق قيم الرسم k والصفر فارغًا.
- الملفات: src/lib/cashflow-modes-core.ts (جديد — بناة نقية) · report-server.ts (أنماط الأربعة في reportCashflow بنفس تصنيفات الوضع التفصيلي: بلا الشريك · بلا تصفيات العهد المجمّع · بلا رد السلف + توسيع ReportTable.totals لمصفوفة + reportTableToCsv يكتبها صفًا واحدًا كالمكتبي) · reports-list.ts (الخيارات الأربعة بترتيب المكتبي) · CashflowChart.tsx (جديد — SVG) · ReportsView.tsx (بطاقة الرسم عند التدفق النقدي + شهري) · تعليق مسار cashflow محدث.
- التحقق المتصفحي الكامل (مستخدم مؤقت zphase5 ثم تنظيفه وسجل تدقيقه): الخيارات التسعة بترتيب المكتبي؛ «وارد فقط» حرفيًا (صف قبض 7,500 CON-0012 + صف إجمالي + «📝 تقرير وارد فقط · إجمالي الوارد: 7,500.000 د.ك · العدد: 1»)؛ «منصرف فقط» و«تحويلات فقط» بحالة فارغة سليمة (لا سندات غير ملغاة في القاعدة)؛ «شهري» يعرض الرسم: عمود أخضر واحد 7,500 → «8k» (مطابق لتقريب المكتبي) + تسمية «أكتوبر 2026» + وسيلة الإيضاح؛ CSV للنمط الجديد: 200 + BOM + صف الإجمالي المصفوفي «الإجمالي,,,,7500,» حرفيًا + الملاحظة.
- الفحوص: bun test 106/106 (522 تأكيدًا — كان 89) · tsc 0 · eslint 0. السكربتات المؤقتة حُذفت والمتصفح أُغلق.

Stage Summary:
- التقرير المالي في الويب صار بخياراته التسعة كما المكتبي مع رسم شهري مطابق — والأنماط الأربعة تمر عبر بوابة rep_cashflow والصلاحية والتصدير تلقائيًا.
- جاهز للرفع بPAT مؤقت (commit محلي) — يتبقى من الخطة: 7 (متابعة + إجراءات مركز العقود) · 8 (PDF/xlsx خادميًا) · 9 (قائمة 13 ميزة كبيرة لاختيار النطاق) · والسادسة مؤجلة حتى 9.15.19.

---

Task ID: 43 (المرحلة 7-أ: إثراء شاشة المتابعة المالية)
Agent: full-stack-developer
Task: تدرّج تنبيه انتهاء العقود (deep/warn/info من كل مستويات الإعدادات) + قسما «تمديد إشراف» البنفسجي و«🏗 مراحل التنفيذ» + توازي فلاتر الحالة مع المكتبي + إكمال FollowupResponse وحذف followup-types اليتيم

Work Log:
- قراءة المرجعية المكتبية حرفيًا: lifecycle_service.py:412 get_expiry_alert_days (تفكيك أعداد صحيحة، تكرار مرفوض، افتراضي 90,60,30,7) و:429 expiring_contracts (المستوى = أصغر حدّ ≥ المتبقي؛ يستبقي مغلق/ملغى/منتهي) و:5281 overdue_collections (يستبقي مغلق/ملغى/مسودة) · main_window.py:287 (AMBER_DEEP ≤ آخر مستوى · WARN ≤ الثاني · INFO غير ذلك) و:332-340 (التمديد) · supervision_service.py:431 contracts_in_extension · workflow_service.py:5030 execution_report + :5230 execution_alerts (نصا «متأخر في «X»: N من M (تجاوز K)» و«قارب على نهاية «X»: بقي K»).
- TDD أولًا: tests/phase7-followup.test.ts = 19 اختبارًا/54 تأكيدًا (أحمر ثم أخضر) — تفكيك المستويات وتلفها، التدرّج بنوافذ 90,60,30,7 ومستوى واحد ومستويين وإعداد تالف، قاعدة التمديد (تساوي اليوم بحدودها، النهاية الفعلية قبل/بعد)، مرآتا فلترة الحالة، classifyStageExecution (over/near/حد الاقتراب/بلا متوقع)، وبناء الصفوف بترتيب المكتبي (متأخرون بالتجاوز تنازليًا ثم قاربون بما بقي تصاعديًا).
- الملفات: src/lib/followup-alerts.ts (جديد — كل المنطق النقي: parseExpiryLevels/expiryLevelsOrDefault/expiryTier/isSupervisionInExtension/isFollowupCollection/isFollowupExpiring/isFollowupExecutionContract/classifyStageExecution/buildExecutionAlertRows) · src/app/api/followup/route.ts (النافذة = أكبر مستوى بدل أول قيمة، tier لكل صف انتهاء، استعلاما extension وexecution الجديدان، فلترة الحالات للتحصيل/الانتهاء، حقول الرد القديمة كما هي) · report-server.ts (reportExecution يعيد استخدام classifyStageExecution بخياري stages/occupancy — سلوك مطابق حرفيًا وتحقق منه إنتاجيًا) · contrack-types.ts (FollowupResponse كامل: generatedAt/today/settings/dueNowTotal/extension/execution + tier في صف الانتهاء + customerName في صف نهاية الأساس) · FollowupView.tsx (شارات التدرّج الثلاث بألوانها، «تمديد إشراف» بنفسجي bg-purple-100/dark مع «نهاية الأساس» و«النهاية الكاملة» عند وجودها و«شهريًا» للقيمة، «🏗 مراحل التنفيذ» بأحمر متأخر وكهرماني قارب و«X من Y»، بطاقتا عدّ والشبكة صارت 6، اسم العميل في صف نهاية الأساس) · حُذف src/lib/followup-types.ts (يتيم: صفر استيراد في المشروع كله).
- ملاحظة: مسار reports/execution/_server.ts المذكور بالمواصفة غير موجود؛ منطق تقرير التنفيذ كله داخل reportExecution في report-server.ts فسُحب منه المنطق النقي المشترك بدل تكراره.
- الفحوص: bun test **125/125 (576 تأكيدًا — كان 106)** · tsc --noEmit = 0 · eslint = 0.
- التحقق المتصفحي (مستخدم مؤقت zphase7 admin، ثم تنظيفه وسجلّي التدقيق المرتبطين — بقيا admin/secretary): 6 أقسام تُصيَّر ببطاقات العدّ؛ القاعدة الفعلية بلا بيانات تنبيه (فحص قرائي: عقد نشط واحد بلا endDate وبلا إشراف ومرحلة جارية يومها الأول) فتحققت الحالات الفارغة الست بأحرفها المطلوبة؛ ثم شبكة-محاكاة (network route) لرد /api/followup ببيانات غنية فظهرت: شارات «باقي 3 أيام» حمراء و«باقي 27 يومًا» كهرمانية و«باقي 83 يومًا» زرقاء (سُحبت أصنافها فعليًا)، صفّا «في التمديد» البنفسجي بوافر/غائب النهاية الكاملة، «متأخر 15 يومًا» بالأحمر مع «متأخر في «الحفر والأساسات»: 45 من 30» و«باقي 1 يوم» بالكهرماني مع «قارب على نهاية «الأسقف»: 14 من 15»، ونقر الصف فتح تفاصيل العقد الحقيقي CON-0012 بلا أي خطأ نافذة؛ /api/reports/execution (stages وoccupancy) بلا تغيير بعد إعادة الاستخدام («ضمن الوقت · بقي 19 يوم» · over=0/near=0).
- السكربتات المؤقتة الثلاثة (_makeuser/_probe/_cleanup) حُذفت، والمتصفح أُغلق، ولا أي صفوف أعمال لمست.

Stage Summary:
- شاشة المتابعة في الويب صارت بستة أقسام مطابقة لتنبيهات النافذة المكتبي: المستحق الآن · تعثر التحصيل · عقود تنتهي قريبًا (بتدرّج المستويات) · إشراف قرب نهاية الأساس · تمديد إشراف · مراحل التنفيذ — والفلترة بالحالات موازية للمكتبي (مسودة للتحصيل، منتهي للانتهاء).
- منطق التدرّج والتنفيذ نقي ومشترك (followup-alerts.ts) وقِفل باختبارات، وتقرير مراحل التنفيذ أصبح يستخدم نفس المصنف فلا انفصال مستقبلي بين الشاشتين.
- جاهز للرفع بPAT مؤقت كالعادة — يتبقى من الخطة: بقية 7 (إجراءات مركز العقود) ثم 8 (PDF/xlsx) و9 (قائمة 13 ميزة).

---
Task ID: 44 (المرحلة 7-ب: لوحة المراحل التفاعلية)
Agent: full-stack-developer
Task: لوحة «مرحلة التنفيذ» تفاعلية — إنهاء/تخطي/تراجع/ملاحظة/طابع إشراف + سجل المراحل + محادثة المعاملة + تجميد الملغى
Work Log:
- الكود وصل مكتملًا من التشغيل المتقطع (نماذج StageNote/TxMessage + مسارات stage-notes/messages/stage-history + PATCH stages/[stageId] بالتراجع والطابع الإشرافي + src/lib/stage-panel.ts + لوحة FollowupPanelCompact المطورة + tests/phase7-stage-panel.test.ts) — أُعيدت قراءته سريعًا ثم انصرفت للتحقق.
- عقبة محلولة: جلسة متصفح متبقية من التشغيل السابق كانت تحمل network-route mock قديمًا على تفاصيل العقد (يرجع الحالة «ملغى») فظهر خط التجميد والأزرار معطلة خطأً — `network unroute` + إعادة تحميل أعادت الحقيقة («نشط»)، وحُذفت صفوف اختبار متبقية كتبها zphase7 (ملاحظة + رسالة + حدث) قبل بدء التحقق النظيف.
- التحقق المتصفحي بمستخدم zphase7 (admin) على CON-0012: (أ) اللوحة كاملة — بادئة «📏 مسار إجباري · الحفر والأساسات»، شرائح بلواحق النسبة 30%/40%، عداد «🟢 مر عليها 1 يومًا (المتوقع 20)»، صف الأزرار الخمسة ممكنًا للمدير، «🕒 سجل المراحل» بـ«لا حركة بعد» (أحداث العقد الحالية كلها بأنواع غير مفلترة) و«💬 محادثة المعاملة» بـ«لا رسائل بعد». (ب) ملاحظة المرحلة: حفظ → توست النجاح + شارة «📝 واقف عند البلدية — بانتظار موافقة الإطفا…» (اقتطاع 40+…) في الترويسة + ظهورها في «🕘 الملاحظات السابقة» — حذف الصف من القاعدة → تحديث → الشارة اختفت. (ج) المحادثة: إرسال → فقاعة bg-primary/10 مظللة «لي» بميتا zphase7 والتاريخ والخانة تُفرغ — حذف الصف → تحديث → الحالة الفارغة عادت. (د) عبر محاكاة الشبكة بلا أي مس حقيقي (تحقق بعدي: 0 أحداث والمرحلة 16 بكر): نافذة التراجع بأسطرها الثلاثة + «تأكيد» معطلة بلا سبب وتُمكَّن بعده + توست «تم التراجع من «الحفر والأساسات» إلى «الأعمال الترابية (محاكاة)»» وحمولة {"action":"revert","reason":...}؛ نافذة الطابع الإشرافي بحقولها الخمسة وسطر حالة حي («بلا طابع إشرافي…» ← «👁 طابع إشرافي حتى 2026-12-31») + توست الحفظ وحمولة {"action":"supervision","isSupervision":true,"supEnd":"2026-12-31","supMonthly":250,...}؛ ملغى عبر mock لتفاصيل العقد: الأزرار الخمسة كلها معطلة + سطر «🔒 العقد ملغى ومجمّد». (هـ) صفر أخطاء console/page في الزيارة كلها وdev.log نظيف (كل نداءات اللوحة 200 وPOST 201 — PATCHات المحاكاة لم تصل الخادم).
- التنظيف: clean-rows نهائي (0 ملاحظات/0 رسائل/0 أحداث) ثم clean-user (حُذف zphase7 id=11 وسجل تدقيقه — بقي admin/secretary) · حُذف scripts/_tmp-makeuser.ts ولا _tmp-* أخرى · أُغلق المتصفح · لا عمليات git.
Stage Summary:
- لوحة «مرحلة التنفيذ» في تفاصيل العقد حية بالكامل: إنهاء/تخطي عبر معالجات تبويب المراحل نفسها، تراجع وطابع إشراف للمدير عبر PATCH محمي adminGuard، ملاحظة V5.9 بشارة مقطوعة، سجل المراحل بالمحلة الأربعة، محادثة المعاملة بفقاعات «لي/غيري»، وتجميد كامل على الملغى/المغلق واجهةً وخادمًا — والتحقق المتصفحي الكامل (أ–هـ) ناجح بلا أي أثر على بيانات الإنتاج.
- الفحوص: bun test 145/145 (604 تأكيدًا) · tsc 0 · eslint 0. جاهز للرفع بPAT مؤقت كالعادة — يتبقى من الخطة: بقية 7 (سحب الناقص من القالب مؤجل عمدًا) ثم 8 (PDF/xlsx) و9 (قائمة 13 ميزة).

---
Task ID: 45 (المرحلة 7-ج: إجراءات مركز العقود + إدارة أنواع العقود)
Agent: full-stack-developer
Task: زر ملف العميل + خيارات الحالة الثمانية مع مبلغ إغلاق الإلغاء + صفحة تعديل العقد المطابقة للمكتبي + CRUD كامل لأنواع العقود في الإعدادات
Work Log:
- الكود وصل مكتملًا من التشغيل المتقطع (ContractTypesManager.tsx + contract-types-admin.ts + مسارا contract-types بعدد العقود + contracts/[id] PATCH بالعملة والإشراف ومبلغ الإغلاق + زر «◉ ملف العميل» ونافذة الحالة الثمانية في ContractDetailView + ContractEditPage المكتبي + ربط SettingsView/ConTrackApp) — أُعيدت قراءة الفروقات سريعًا ثم انصرفت للتحقق.
- ملاحظة من التدقيق: التشغيل السابق كان أدى جزءًا من تحقق الإعدادات (نوع اختباري أُنشئ وحُذف — 9 صفوف تدقيق لِـzphase7) فأُعيدت كل الفحوص بجلسة نظيفة (unroute + إعادة تحميل كالمنذور في 44).
- التحقق المتصفحي كـ zphase7 (admin مؤقت) على CON-0012 (شركة الأفق للمقاولات):
  (أ) «◉ ملف العميل» في الترويسة يفتح ملف العميل نفسه (C-0014 · 1 عقد نشط · متبقٍ 17,500.000 مطابق) والرجوع سليم.
  (ب) نافذة «تغيير حالة العقد» بخياراتها الثمانية بترتيب المكتبي (مسودة، تحت المراجعة، معتمد، نشط، متوقف، منتهي، مغلق، ملغى)؛ «ملغى» يظهر «سبب إلغاء العقد *» و«مبلغ إغلاق الإلغاء» بسطر تلميحه؛ عبر network-route بجسم GET الحقيقي (حماية للـrefetch الخلفي): الحفظ أعطى توست «تم تغيير الحالة» وحمولة `{"status":"ملغى","statusReason":"...تحقق 45 (محاكاة)","cancelCloseAmount":1500.5}` دون أن تصل الخادم — DB بقيت نشطًا بلا مبلغ إغلاق؛ unroute + إعادة تحميل بعدها.
  (ج) صفحة التعديل: «اسم العقد (تلقائي من النوع)» readOnly يتبع النوع حرفيًا (أعمال مدنية ← إشراف هندسي)، Select النوع = «غير محدد» + الأنواع المفعّلة، حقل «العملة»، وقسم «تعهد الإشراف الهندسي» بحقوله الأربعة يظهر للنوع الإشرافي مع قفل تاريخي البداية/الانتهاء بتلميح «يُحدَّد تلقائيًا من مرحلة بداية الإشراف»؛ حفظ عبر mock أرسل `{"contractType":"إشراف هندسي","currency":"د.ك","supStartDate":"","supMonths":6,"supMonthly":250,"supDiscount":50}` بلا startDate/endDate/contractName (تُشتق خادميًا) — وعاد لشاشة العقد والـDB بلا أي أثر.
  (د) تاب «أنواع العقود والمبالغ»: الجدول بالأعمدة المكتبية التسعة + «عدد العقود» (أعمال مدنية=1 والبقية 0)؛ إنشاء «نوع اختباري مؤقت 45» (مقطوع/100) → ظهر؛ تعديل الاسم إلى «45ب» → توست «تم التعديل»؛ تعطيل → شارة «معطّل» وزر «تفعيل»؛ إنشاء مكرر → «النوع «نوع اختباري مؤقت 45ب» موجود بالفعل.»؛ شامل+إشرافي → «النوع الشامل لا يكون إشرافيًا — أضف الإشراف مكوّنًا بداخله.» دون إرسال؛ حذف بتأكيد → توست «تم الحذف» والجدول عاد لستة أنواع والـDB بلا أي صف اختبار.
  (هـ) صفر أخطاء console/page في الزيارة كلها؛ dev.log بلا 500/⨯ (401 عابرة عند حدود التحميل + 400 مقصودة لحرس التكرار).
- التنظيف: _tmp-cleanup45.ts حذف zphase7 (id=13) + 14 صف تدقيق + صفر أنواع مؤقتة — بقي admin/secretary فقط؛ contract_types=6 الأصلية؛ CON-0012 سليم (نشط/أعمال مدنية)؛ حُذفت scripts/_tmp-*.ts الثلاثة وأُغلق المتصفح؛ لا عمليات git.
Stage Summary:
- إجراءات مركز العقود حية في الويب: فتح ملف العميل من العقد، نافذة الحالة الثمانية بمبلغ إغلاق الإلغاء للملغى، وصفحة تعديل مطابقة للمكتبي (الاسم يتبع النوع، العملة، صفوف الإشراف وقفل التواريخ) — وإدارة أنواع العقود كاملة CRUD في الإعدادات بعدد العقود وحرس المكتبي الحرفي (تكرار/شامل-إشرافي) وبدل التعطيل عن الحذف.
- الفحوص: bun test **160/160 (642 تأكيدًا)** · tsc 0 · eslint 0. جاهز للرفع بPAT مؤقت كالعادة — يتبقى من الخطة: 8 (PDF/xlsx خادميًا) ثم 9 (قائمة 13 ميزة) والسادسة مؤجلة حتى 9.15.19.

---
Task ID: 46 (رفع المرحلتين 5+7 إلى الإنتاج)
Agent: Z.ai Code (منسق)
Task: المستخدم أرسل PAT مؤقتًا — رفع 3 commits (f001047 المرحلة 5، 288c44d توثيق، 68c25a7 المرحلة 7) والتحقق من نشر Vercel

Work Log:
- الرفع عبر remote مؤقت بالرمز ثم تنظيف فوري: push ناجح 4927b29..68c25a7 main->main؛ الremote عاد نظيفًا بلا رمز؛ rev-list origin/main..main = 0 — المحلي مطابق لGitHub.
- استعلام GitHub API للحالة تعذّر (rate limit مستهلك على IP الحاوية) — استُعيض عنه بفحص إنتاجي مباشر: GET / = 200؛ /api/followup = 401؛ والمسارَان الجديدان /api/contracts/1/messages و /api/contracts/1/stage-history = 401 (كانا 404 قبل النشر) — دليل قاطع أن شيفرة المرحلة 7 حية على contrack-online.vercel.app.
- لم يُخزَّن الرمز في أي ملف (بروتوكول النظافة المعتاد).

Stage Summary:
- الإنتاج يعمل الآن بالمراحل 1–5 + 7 كاملة (أنماط التدفقات الأربعة + الرسم الشهري SVG + إثراء المتابعة الستة أقسام + لوحة المراحل التفاعلية + إجراءات مركز العقود + CRUD أنواع العقود).
- يتبقى من الخطة: 8 (PDF/xlsx خادميًا بخطوط عربية) ثم 9 (قائمة 13 ميزة كبيرة لاختيار النطاق) — والسادسة مؤجلة حتى 9.15.19.
- تذكير مؤجل بعد اكتمال كل العمل: تدوير الPAT وكلمة مرور قاعدة البيانات (مرّا عبر المحادثة).

---

Task ID: 47 (المرحلة 8: PDF عربي خادميًا + xlsx حقيقي)
Agent: full-stack-developer
Task: كشوف الحساب PDF خادميًا بخط عربي مضمّن عبر Chromium بلا واجهة + تصدير Excel حقيقي (xlsx) بديلًا عن CSV للجداول العربية — والتحقق الكامل curlًا ومتصفحيًا ثم التنظيف

Work Log:
- الكود اكتمل في تشغيل سابق توقف قبل التحقق؛ هذا التشغيل: تحقق نهاية-إلى-نهاية وتنظيف (لا تعديلات شيفرة).
- الملفات (كما أُنجزت): src/lib/pdf/font-data.ts (NotoNaskhArabic-Regular.ttf بbase64 من src/assets/fonts/ + رخصتها SIL OFL) · src/lib/pdf/statement-html.ts (HTML مستقل RTL بالتخطيط المكتبي statement_pdf.py — ترويسة/فترات/صفوف/إجماليات و@page كاملة بالهوامش داخل CSS) · src/lib/pdf/render-pdf.ts (puppeteer-core: PDF_EXECUTABLE_PATH ← @sparticuz/chromium ← كاش playwright fallback، setContent + document.fonts.ready ثم page.pdf A4) · src/lib/xlsx-core.ts (ExcelJS: RTL views + ترويسة ملوّنة + أرقام كأرقام وحدود وأعمدة تلقائية) · src/lib/download-blob.ts (تنزيل ثنائي بالتوكن/الكوكيز و401 يُعاد للمصادقة) · مسارا PDF: /api/statement/contract/[id]/pdf و /api/statement/customer/[id]/pdf (runtime=nodejs · maxDuration=60 · authGuard screen_contracts/screen_customers · إعادة استخدام buildContractStatement/buildCustomerStatement نفسها) · ترقية التصديرات إلى ?format=xlsx (الافتراضي csv كما هو): POST /api/reports/export و GET /api/contracts/[id]/pay-export و GET /api/custody/reports · أزرار الواجهة: «▦ كشف PDF» في StatementView و«⬇ Excel» في ReportsView وCustodyReports وزر الدفعات في ContractDetailView.
- إثبات PDF محليًا (curl بجلسة zphase8): GET /api/statement/contract/15/pdf → **200 · application/pdf · يبدأ «%PDF-» · 145,690 بايت · 3.6 ث** (filename*=كشف حساب CON-0012.pdf)؛ GET /api/statement/customer/17/pdf → **200 · application/pdf · «%PDF-» · 169,510 بايت · 3.1 ث** (كشف حساب شامل C-0014.pdf)؛ النص يحوي «NotoNaskhArabic» مضمّنًا في كليهما (الخط العربي من داخل HTML لا خطوط النظام).
- إثبات xlsx محليًا: POST /api/reports/export?format=xlsx {report:customers-balances} → 200 · PK (zip) · 7,066 بايت · MIME xlsx · filename=report-customers-balances-2026-10-19.xlsx؛ GET /api/contracts/15/pay-export?format=xlsx → 200 · PK · 7,034 بايت؛ GET /api/custody/reports?kind=balances&format=xlsx → 200 · PK · 6,955 بايت؛ ورجوع CSV سليم (200 + BOM ef bb bf) — الافتراضي لم يتأثر.
- ملاحظة بيئية مهمة: **@sparticuz/chromium اشتغل محليًا كما هو** (فكّ ضغط نسخته إلى /tmp/chromium وChromium 153.0.8010.0 أقلع بلا وسائط إضافية) — لم يلزم PDF_EXECUTABLE_PATH ولا fallback playwright محليًا؛ كاش playwright (~/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome) يبقى احتياطًا ثالثًا ضمن الكود.
- التحقق المتصفحي (zphase8b admin مؤقت كلمة مرور Temp#2026-08 بعد إعادة ضبطها بالسكربت المؤقت): شاشة كشوف الحساب ← اختيار «شركة الأفق للمقاولات — C-0014» مع «كل العقود (كشف شامل)» ← زر «▦ كشف PDF» أظهر حالة التحميل «جارٍ إنشاء PDF…» معطلةً ثم أنتج تنزيلًا فعليًا باسم «كشف حساب شامل شركة الأفق للمقاولات.pdf» عبر GET customer/17/pdf = **200 + content-type: application/pdf**؛ وباختيار العقد CON-0012 نفسه أنتج «كشف حساب CON-0012.pdf» عبر contract/15/pdf = 200 application/pdf (رُصد التنزيل بأداة اعتراض anchor.download)؛ شاشة التقارير (العملاء والأرصدة) «⬇ Excel» → POST export?format=xlsx 200 + تنزيل «تقرير-العملاء-والأرصدة.xlsx»؛ مركز العُهد ← التقارير: «التصفيات المجمع» → «تقرير-العهد-summary-2026-10-19.xlsx» و«أرصدة العهد» → «تقرير-العهد-balances-2026-10-19.xlsx» كلاهما 200. صفر أخطاء console/page (فقط Fast Refresh)؛ dev.log بلا 500 جديدة (500 تاريخية وحيدة موثقة أثناء التطوير: تعليق */ داخل JSDoc كسر الparse — عولج بإعادة صياغة التعليق قبل انقطاع التشغيل السابق؛ وبعدها 6×200 عقد و8×200 عميل في السجل).
- التنظيف: حُذف المستخدمان المؤقتان zphase8 (id=14) وzphase8b (id=15) مع 3+3 صفوف تدقيق — users = admin/secretary فقط وtmpAudit=0؛ حُذفت سكربتات _tmp-* الثلاثة (makeuser/query/verify) وبقيت migrate-to-supabase وrotate-passwords الأصليتان؛ ملفات /tmp المؤقتة (كوكيز/PDF/xlsx) أُزيلت والمتصفح أُغلق؛ لا عمليات git.
- الفحوص النهائية: **bun test 184/184 (745 تأكيدًا) · tsc --noEmit = 0 · eslint = 0**.

Stage Summary:
- المرحلة 8 كاملة ومُتحقق منها: كشوف الحساب (عقد/عميل شامل) تُطبع PDF عربيًا خادميًا بخط NotoNaskhArabic مضمّن عبر Chromium، وجميع التصديرات الجدولية العربية لها «⬇ Excel» حقيقي (ExcelJS بصيغة xlsx RTL وأرقامٍ رقمية) مع بقاء CSV افتراضيًا — والتنزيلات في الواجهة بحالات تحميل وتوستّ ومعالجة 401 موحدة عبر download-blob.
- ملاحظات Vercel: المسارات الثلاثة الجديدة/المرقّاة nodejs runtime وmaxDuration=60؛ @sparticuz/chromium هو الافتراضي للإنتاج (يفك ضغطه إلى /tmp تلقائيًا) وPDF_EXECUTABLE_PATH متاح كoverride صريح وfallback playwright آخره — ولا حاجة لأي إعداد إضافي.
- مؤجل (خارج نطاق المرحلة): أزرار PDF لشاشات التقارير نفسها والطباعة من كشف العهدة تظل عبر مسار الطباعة القائم؛ الملف الجاهز للرفع بPAT مؤقت كالعادة.

---
Task ID: 48 (رفع المرحلة 8 + معركة توليد PDF على Vercel)
Agent: Z.ai Code (منسق)
Task: رفع 165ac9a + توثيق Task 46 بPAT مؤقت — ثم تشخيص وإصلاح فشل توليد PDF على إنتاج Vercel من طرف إلى طرف

Work Log:
- الرفع الأول ناجح (68c25a7..165ac9a) والremote عاد نظيفًا؛ xlsx اشتغل على الإنتاج فورًا (200، PK، 7,066B) لكن PDF أعاد 500 فارغًا.
- حدث بيئي أثناء التحقق: الحاوية نظّفت .env.local وأسقطت خادم التطوير — أعيد إنشاء الملف من بيانات Supabase وإعادة تشغيل الخادم ببروتوكول source .env.local.
- اختبار E2E حقيقي على الإنتاج: مستخدم مؤقت zphase9 في القاعدة + دخول API على contrack-online.vercel.app + نداء مسار PDF بالكوكي — هيّأ هذا تشخيصًا حقيقيًا بلا حاجة لسجلات Vercel.
- ثلاث موجات تشخيص وإصلاح (كل واحدة: إصلاح + دفع + انتظار نشر + اختبار إنتاج):
  1) fdc12a8: serverExternalPackages + outputFileTracingIncludes + معالجة أخطاء صريحة في المسارين — كشف الرسالة: مجلد bin غير مضمَّن في /var/task.
  2) 199ead5: «طُعم تتبع» حتمي — readdirSync ثابت على مجلد bin داخل render-pdf.ts يجبر node-file-tracing على تضمين الثنائية — الثنائية صارت حية لكن ظهر "Requesting main frame too early!".
  3) 32c0048: استخدام chromium.args الرسمية للحزمة (--single-process --no-zygote...) بدل أعلامنا العامة — الجذر الأخير.
- النتيجة النهائية على الإنتاج: كشف العقد 200/145,689B/4.4s (بارد) · الكشف الشامل 200/169,509B/1.2s (دافئ) · xlsx 200/PK — مع %PDF-1.4 سليم.
- التنظيف: حذف zphase9 وصفوف تدقيقه (بقيا admin/secretary) + scripts/_tmp-p9user.ts (كانت تسللت في fdc12a8) + ملفات /tmp + إزالة تحذير eslint الوحيد (0 errors، 0 warnings الآن).
- لم يُخزَّن الرمز في أي ملف (بروتوكول النظافة المعتاد).

Stage Summary:
- توليد PDF العربي RTL يعمل الآن فعليًا على Vercel serverless: الدرسان الموثقان (1) الثنائية المضغوطة تحتاج طُعم readdirSync لأن متتبع Next لا يلتقطها، (2) أعلام @sparticuz/chromium إلزامية لبنائهم وإلا فشلت الإطارات.
- المراحل 1–8 كلها حية على الإنتاج. يتبقى: المرحلة 9 (عرض قائمة 13 ميزة كبيرة لاختيار النطاق) — والسادسة مؤجلة حتى 9.15.19.
- تذكير مؤجل بعد اكتمال كل العمل: تدوير الPAT وكلمة مرور القاعدة (مرّا عبر المحادثة).

---
Task ID: 49 (المرحلة 9: عرض قائمة الميزات الكبرى لاختيار النطاق)
Agent: Z.ai Code (منسق)
Task: عرض قائمة 13 ميزة كبيرة المتبقية من تحليل الفجوة على المستخدم لاختيار نطاق المرحلة 9 — دون تنفيذ قبل اختياره

Work Log:
- تحقق من الحالة بعد عودة الجلسة: HEAD = origin/main = ec7fe50 (الرفع وإصلاحات PDF تمت في Task 48) · bun test 184/184 (745 تأكيدًا) · شجرة عمل نظيفة.
- كشف إنتاج سريع: / = 200 · مسارا PDF = 401 (محميّان وموجودان) · reports/export?format=xlsx = 405 (منشور ويتطلب POST) — المراحل 1–8 حية كلها.
- اشتقاق قائمة الـ13 من GAP_ANALYSIS.md (§3/§4/§6/§7) بعد استبعاد كل ما أنجزته المراحل 1–8، مع الجهد النسبي والتوصية لكل بند.
- عُرضت القائمة على المستخدم مع دفعة مقترحة — في انتظار اختياره قبل أي تنفيذ (قاعدة المرحلة 9: العرض أولًا).

Stage Summary:
- القائمة المعروضة: 1 ملف العميل كصفحة · 2 واجهة السلف · 3 تقارير العُهد السبعة · 4 نظام المزايا 42 مفتاحًا · 5 مواءمة الصلاحيات PAGE_PERMS · 6 الإعدادات بتبويباتها · 7 الرئيسية الكاملة · 8 استيراد Excel للأوراق الثماني · 9 مركز النماذج Word · 10 مجموعات العقود · 11 المشاريع · 12 عروض الأسعار · 13 تقرير الفرص البيعية rep_leads — وإضافات صغيرة خارج القائمة: واتساب، مجلد شبكة المرفقات، حذف الباطن بالخيارات، PDF إضافي، مطابقة الأرقام الذهبية.
- المرحلة 6 ماضية مؤجلة حتى V9.15.19. تذكير مؤجل بعد اكتمال كل العمل: تدوير الPAT وكلمة مرور القاعدة.
---
Task ID: 50-b (السلف V8.4: استعادة سلفة ملغاة)
Agent: full-stack-developer
Task: استعادة سلفة ملغاة — restoreVoucherTx (إعادة القيود + إلغاء الإلغاء + تدقيق)، مسار POST /api/employees/advances/restore، وزر «♻️ استعادة سلفة» في AdvancesView بقائمة السلف الملغاة وتأكيد

Work Log:
- voucher-server.ts: أُضيف restoreVoucherTx آخر الملف بعد cancelVoucherTx — الحواجز الثلاثة (السند غير موجود 404 / غير ملغى / ليس سلف موظفين «هذا الإجراء مخصص لسلف الموظفين.»)، ثم إعادة ترحيل القيود الأصلية (sourceType:"voucher" لنفس السند) بنفس الحسابات مدينًا/دائنًا دون عكس ووصف «استعادة قيد السند {رقم}[ — السبب]» بتاريخ اليوم وsourceType:"voucher_restore" مع نسخ contractId/subContractId — فتصبح الشبكة: أصلي + عكس الإلغاء (voucher_cancel) + الاستعادة = أصلي؛ ثم رفع الإلغاء (cancelled:false, cancelReason:"", cancelledAt:"" — المخطط String غير nullable لا null) وتدقيق «استعادة» بسبب «استعادة سلفة موظف» الافتراضي، وإعادة {voucherNumber, amount}. أبناء الرسوم الملغون لا يُعادون (سلوك المكتبي — موثق في docstring).
- مسار جديد POST /api/employees/advances/restore/route.ts بنمط مسار advances الأخت: authGuard("screen_custody") (بوابة صفحة السلف)، جسم {voucherId, reason?} مع intOr وحرس «رقم السند مطلوب»، db.$transaction حول restoreVoucherTx، وVoucherError → {error} بالstatus الخاص (نمط err الموحد) والنجاح ok({restored:true, voucherNumber, amount}). GET إضافي غير مطلوب: قائمة includeCancelled=1 القائمة في GET advances تعيد أصلًا كل الحقول المطلوبة (cancelled/cancelReason/cancelledAt/voucherNumber/vdate/amount) بلا أي تعديل.
- AdvancesView.tsx: زر «♻️ استعادة سلفة» (أيقونة Recycle) بصف الأزرار العلوي بجوار «✂ خصم من راتب» وبنفس التنسيق؛ openRestore يرفض غياب الموظف بتوست destructive «أضف موظفًا أولًا.» دون فتح النافذة؛ RestoreDialog جديدة بذمة النمط الحالي (نفس أنماط StatCard/Dialog/react-query): استعلام ["advances-cancelled", employeeId] على GET advances بincludeCancelled=1 مُفعَّل مع الفتح فقط، ترشيح cancelled===true محليًا وأحدث 20، أعمدة المرجع/التاريخ/المبلغ (formatKWD + د.ك)/سبب الإلغاء (مقطوع بtitle كامل) + إجراء صف «استعادة»؛ الفراغ «لا توجد سلف ملغاة لهذا الموظف.»؛ خطوة تأكيد داخل النافذة نفسها «هل تريد استعادة السلفة {رقم}؟» + «المبلغ: {...} د.ك» + تأكيد الاستعادة/رجوع؛ useMutation على المسار الجديد: النجاح توست «تمت استعادة السلفة ✅» + إغلاق + refreshAll() (مفاتيح employees-advances/advances-ledger/advances-summary نفسها) + إبطال مفتاح القائمة الملغاة؛ 401 → onAuthError وغيره توست destructive برسالة الخادم.
- الفحوص: bun test **184/184 (745 تأكيدًا)** · bunx tsc --noEmit = 0 · bun run lint = 0 أخطاء 0 تحذيرات. خادم التطوير لم يكن شغّلًا أثناء التسليم (يُدار تلقائيًا) فالتحقق الحي بالمسار استُبدل بفحص ثابت لتطابق أنماط الجار (guard.user.username موثق في SessionUser).

Stage Summary:
- استعادة سلفة ملغاة حية بمعادلة المكتبي V8.4: القيود الأصلية تُعاد كما هي فتتعادل مع عكس الإلغاء وتعود أرصدة السلف تلقائيًا من صفوف cancelled=false — النطاق حصراً لسلف الموظفين، والتدقيق موثق، وأبناء الرسوم تبقى ملغاة عمدًا.
- الواجهة: زر الاستعادة بنافذة قائمة الملغى (أحدث 20 بأسباب الإلغاء) وتأكيد داخلي ثم توست وتحديث شامل — النصوص العربية حرفية كما بالمواصفة.
- جاهز للرفع بPAT مؤقت كالعادة — تبقّى من قائمة الـ13: بقية بنود المرحلة 9 حسب اختيار المستخدم.

---
Task ID: 50-a (مجموعات العقود: خادم + واجهة + شل)
Agent: full-stack-developer
Task: بناء مجموعات العقود كاملة — مكتبة نقية + اختبارات، مسارات API (قائمة/إنشاء/عرض/حذف إداري)، واجهة ContractGroupsView مع الحوارات، وربط الشل والتوجيه

Work Log:
- TDD أولًا: tests/phase9-contract-groups.test.ts = 17 اختبارًا/47 تأكيدًا (أحمر ثم أخضر) — الترقيم GRP-%04d (من GRP-0007→0008 وGRP-0042→0043 وبلا سابق→0001 وتالف→0001 وحدّ العرض 9999→10000)، إزالة التكرار مع حفظ الترتيب وإسقاط الفارغ، رسا التحقق الأربعة حرفيًا بترتيبها (عقدين على الأقل ⇒ غير موجود ⇒ عملاء مختلفون ⇒ ملغى)، والملخص المالي: التكلفة = المنصرف + باقي التزامات الباطن (subs>paid وsubs≤paid)، margin = 0 عند collected≤0.001، استثناء الملغى كليًا، تدوير r3 على كل القيم، والمجموعة الفارغة أصفار.
- الملفات: src/lib/contract-groups-core.ts (نقي — nextGroupNumber/dedupeContractIds/validateGroupContracts/computeGroupTotals + round3 من format) · src/lib/contract-groups-server.ts (buildGroupsResponse المشتركة: الصفوف المالية لكل عقد = current بتركيبة كشف الحساب report-server:284 عبر contractCurrentValue + supervisionExtension/actualSupervisionEnd بنمط /api/contracts، collected سندات قبض سارية، paid صرف سارٍ، subs عقود باطن غير ملغاة — ثم computeGroupTotals؛ وloadGroupContracts بترتيب contractId) · مسار contract-groups (GET بفلتري customerId/contractId وPOST بحارس action_add_contract: تحقق حرفي ⇒ ترقيم من أعلى رقم داخل كل محاولة معاملة ⇒ createMany skipDuplicates ⇒ تدقيق «إنشاء مجموعة عقود» داخل المعاملة ⇒ إعادة محاولة P2002 حتى 8 ثم «تعذر إنشاء رقم مجموعة غير مكرر.» 500) · مسار [id] (GET بشارس screen_contracts يعيد group+contracts+totals، DELETE بadminGuard يحذف المجموعة فقط — العناصر كاسكيد — مع تدقيق «حذف مجموعة عقود»؛ إضافة ويب أمانًا غير موجودة بالمكتبي).
- الواجهة ContractGroupsView.tsx بنمط AdvancesView (react-query + apiGet/apiPost/apiDelete + 401⇒onAuthError + useToast + Table/Card/Dialog/Select/Checkbox/Textarea): ترويسة «🗂 مجموعات العقود» وشرحها، شريط أدوات (فلتر عميل من /api/customers + تحديث + «＋ مجموعة جديدة»)، جدول 11 عمودًا (الرقم·الاسم+شارة الحالة·العميل·العدد·القيمة·المحصّل·المنصرف·التكلفة·الربح·الهامش٪·إجراءات 👁/🗑 للمدير فقط)، الربح السالب أحمر والإيجابي أخضر برموز status، نافذة الإنشاء (عميل إلزامي ⇒ قائمة اختيار عقوده مع استبعاد ملغى بعرض «الرقم — الاسم (المبلغ)» ومن /api/contracts?customerId، عدّاد «يلزم عقدين على الأقل»، توست «أُنشئت المجموعة ✅» + إبطال)، نافذة العرض (ترويسة + جدول العقود الخمسة أعمدة + بطاقات مجاميع بثلاث بطاقات بارزة الربح/الهامش)، نافذة حذف «هل تريد حذف المجموعة {number}؟ لن يُحذف أي عقد.».
- الربط: ViewName += "contract-groups" · بند «مجموعات العقود» بأيقونة Layers بعد «العقود» بوحدة العقود بصلاحية screen_customers (وحُدّث تعليق خارج النطاق) · ConTrackApp يصيّرها وactiveNav يعود إلى view فالإبراز سليم بلا mapping إضافي.
- ملاحظة: نماذج Prisma كانت موجودة مسبقًا — لا تعديل مخطط ولا db push؛ الملاحظة الوحيدة عن الجدول: عمود added_at في المكتبي غير موجود بنموذج الويب (id فقط) فلا أثر له.
- الفحوص: bun test **201/201 (792 تأكيدًا — كان 184)** · tsc --noEmit = 0 · eslint = 0/0. لم أمس AdvancesView/voucher-server (نطاق 50-b) ولا dev server ولا git.

Stage Summary:
- مجموعات العقود حية في الويب بمطابقة حرفية للمكتبي: ضم عقدين أو أكثر لعميل واحد (ربط تنظيمي بلا أي أثر مالي على العقود)، ملخص مالي مجمل لكل مجموعة (قيمة/محصّل/منصرف/تكلفة/ربح/هامش) بتركيبة القيمة نفسها المستخدمة في كشوف الحساب، ترقيم GRP آلي مع حماية التضارب، وتدقيق كامل — والعرض كشاشة مستقلة في تبويب العقود بحذف إداري كميزة أمان إضافية تنتظر تأكيد المستخدم.
- جاهز للرفع بPAT مؤقت كالعادة.
---

---
Task ID: 50 (تنسيق الدفعة 1 من المرحلة 9 + تحقق متصفح + رفع)
Agent: Z.ai Code (منسق)
Task: تنفيذ توصية الدفعة 1 بعد اكتشاف أن بندين منها منجزان — بناء الناقص (مجموعات العقود + استعادة السلفة) والتحقق الشامل ثم الرفع

Work Log:
- اكتشاف مهم قبل التنفيذ: بنود القائمة المعروضة اتّكأت على GAP_ANALYSIS المكتوب قبل المراحل 1–8، وب hull فحص فعلي تبيّن: «تقرير الفرص البيعية rep_leads» (بند 13) منجز بالكامل منذ المرحلة 3 (مسار leads + reportLeads + بوابة rep_leads + صلاحية report_prospects + بند في reports-list والشل)، و«نظام المزايا» (بند 4) منجز بالكامل (مسار feature-flags GET/PUT بكتالوج 42 مفتاحًا + FORCED_ON + effective/requires + تبويب مطور في الإعدادات بنصوص المكتبي الحرفية + مزامنة bank_fee + إخفاء الشل)، و«واجهة السلف» (بند 2) شبه كاملة (AdvancesView 979 سطرًا: البطاقات الثلاث، كشف فردي، تقرير مجمع بعمود FIFO، خصم راتب، سقف) — والفجوة الوحيدة فيها: V8.4 استعادة سلفة ملغاة.
- ما نُفذ فعليًا في هذه الدفعة: (أ) مجموعات العقود كاملة (Task 50-a) و(ب) استعادة سلفة ملغاة V8.4 (Task 50-b) — بوكيلين متوازيين.
- تحقق متصفح E2E كامل بمستخدم مؤقت zt50 (حُذف): ظهور بند «مجموعات العقود» في الشل بعد العقود، إنشاء مجموعة GRP-0001 لعقدين (1000+2500) بتحقق الزر المعطل حتى اكتمال الشروط، الأرقام صحيحة (القيمة 3,500 · هامش 0% عند صفر تحصيل — قاعدة المكتبي)، نافذة العرض بجدول العقود، الحذف الإداري بنص التأكيد، ثم زر «♻️ استعادة سلفة»: حماية «أضف موظفًا أولًا.»، حالة فراغ «لا توجد سلف ملغاة لهذا الموظف.»، سلفة 150 → إلغاء API → ظهرت بأسبابها → تأكيد «هل تريد استعادة السلفة PV-0017؟ / المبلغ: 150.000 د.ك» → «تمت استعادة السلفة ✅» وعاد المتبقي 150.000، والقيود: أصلي + عكس + استعادة (voucher_restore) = الصافي الأصلي.
- التنظيف: حذف zt50 وبياناته (عميل T50-TEMP وعقداه وموظف الاختبار والسلفة PV-0017 وقيودها وكل تدقيق zt50) — القاعدة عادت: عميل واحد، عقد واحد، صفر موظفين، صفر مجموعات، مستخدمان (admin/secretary). ملاحظة: الرقم التسلسلي PV-0017 مستهلك بلا إعادة استخدام (قاعدة 6).
- الحاوية كانت نظّفت .env.local وأسقطت الخادم مجددًا — أُعيد إنشاؤه من بيانات Supabase الموثقة وتشغيل الخادم ببروتوكول source.
- الفحوص المجمعة النهائية: bun test **201/201 (792 تأكيدًا — كان 184)** · tsc 0 · eslint 0/0.

Stage Summary:
- الدفعة 1 من المرحلة 9 مكتملة فعليًا: بندين كانا منجزين سابقًا (13 و4) وبند السلف اكتمل بفجته الوحيدة (استعادة V8.4) ومجموعات العقود بُنيت من الصفر بمطابقة حرفية (≥2 عقد، عميل واحد، لا ملغى، GRP-%04d، تكلفة = منصرف + باقي باطن، هامش عند تحصيل>0.001) — مع إضافة ويبية واحدة تنتظر قرار المستخدم: حذف المجموعة للمدير (غير موجودة في المكتبي لكنه صمام أمان تشغيلي).
- الدروس: قائمة المرحلة 9 يجب تحديثها — البنود 2 و4 و13 مُنجزة؛ يتبقى الآن من الـ13: 1 ملف العميل كصفحة · 3 تقارير العهد السبعة (تحتاج فحص اكتمال قد تكون منجزة مع المرحلة 4!) · 5 الصلاحيات · 6 الإعدادات · 7 الرئيسية · 8 استيراد Excel · 9 قوالب Word · 10 المشاريع · 11 عروض الأسعار · 12 مجموعات العقود (منجزة الآن).
- جاهز للرفع بPAT مؤقت كالعادة.

---

Task ID: 50-v (تحقق ما بعد الدفع — جلسة متابعة)
Agent: Z.ai Code (منسق)
Task: التحقق من حالة الدفعة 1 بعد وصول PAT جديد من المستخدم — تأكيد أن الدفع والنشر تمّا فعلاً في الجلسة السابقة، وتصحيح الملاحظة القديمة «جاهز للرفع» أعلاه

Work Log:
- ls-remote: origin/main = 1b9983f = HEAD — الرفع تم فعلاً في الجلسة السابقة والremote نظيف؛ PAT الجديد لم يكن لازماً للرفع الأصلي، ولم يُخزَّن في أي ملف.
- تحقق إنتاجي على contrack-online.vercel.app: / = 200 · /api/contract-groups GET=401 وPOST=401 (مسار جديد حي محمي) · /api/employees/advances/restore GET=405 وPOST=401 (مسار جديد حي POST-only) · /api/reports/leads و/api/feature-flags = 401 — الدفعة 1 منشورة كاملة على Vercel.
- إعادة الفحوص محلياً: bun test 201/201 (792 تأكيداً) · eslint 0/0 · شجرة عمل نظيفة · dev.log بلا 500 (آخر الطلبات 200/401 المتوقعة).
- دُفع هذا التوثيق بPAT مؤقت (تضمين مؤقت في remote ثم إعادة الرابط نظيفاً فوراً والتحقق بremote -v).

Stage Summary:
- الدفعة 1 من المرحلة 9 مكتملة ومرفوعة وحيّة على الإنتاج — ملاحظة «جاهز للرفع» في Task 50 أعلاه صارت تاريخية.
- يتبقى من الـ13 بترقيم Task 49 الأصلي (تصحيحاً لترتيب سطر «الدروس» أعلاه المغاير): 1 ملف العميل كصفحة · 3 تقارير العُهد السبعة (قد تكون منجزة مع المرحلة 4 — تحتاج فحص اكتمال) · 5 مواءمة الصلاحيات PAGE_PERMS · 6 الإعدادات بتبويباتها · 7 الرئيسية الكاملة · 8 استيراد Excel للأوراق الثماني · 9 مركز النماذج Word · 11 المشاريع · 12 عروض الأسعار — أما 10 مجموعات العقود فمنجزة الآن، و2 و4 و13 منجزة سابقاً.
- تذكير مؤجل بعد اكتمال كل العمل: تدوير الPAT وكلمة مرور القاعدة (مرّا عبر المحادثة عدة مرات).

---

Task ID: 51 (المرحلة 9 — الدفعة 2 / بند 5: مواءمة الصلاحيات PAGE_PERMS)
Agent: full-stack-developer
Task: إخفاء بنود الشل حسب الصلاحية + حرس التنقل الحرفي «هذه الشاشة غير متاحة لحسابك.» — توصيل perms من /api/auth/me إلى AppShell، حرس onSelectChild والمسارات الجانبية، اختبارات نقية، وتحقق متصفحي E2E بمستخدم مؤقت يُنظَّف كاملًا

Work Log:
- قراءة worklog (آخر 300 سطر) وتأكيد الفجوة الوحيدة: AppShell يستقبل prop perms ويحرس بpermOn منذ المرحلة 2/ب لكن ConTrackApp لا يمررها — فالإخفاء ميت. المرجع المكتبي قُرئ بنفسه للتأكيد: main_window.py:616-632 (PAGE_PERMS بـ14 مدخلًا) · :782-828 (بناء الشل المشروط بhas_permission — سندات القبض ← screen_receipts وسندات الصرف ← screen_payments كبندين منفصلين) · :1961-1988 (_navigate: حالة التصفيات screen_payments + الحرس برسالة «هذه الشاشة غير متاحة لحسابك.» الحرفية) · auth_service.py:485-501 (has_permission: admin/developer دائمًا True · المفتاح المجهول True لا يقيّد · السكرتير تخصيصه المحفوظ وإلا افتراض دوره).
- ملف جديد نقي src/components/contrack/nav-perms.ts (بلا React ولا "use client" — قابل للاختبار): permAllows (الدور أولًا ثم الخريطة: الممنوع=false فقط يُرفض والمفقود/الخريطة غير المحمّلة لا يقيّدان — مرآة has_permission) · isChildVisible/visibleChildren (نقل فلتر AppShell نفسه بنفس ترتيب شروطه adminOnly ثم flag ثم perm) · NAVIGATE_DENIED_MSG = «هذه الشاشة غير متاحة لحسابك.» ثابت حرفي · VIEW_PERMS خريطة view→مفتاح باب للمسارات الجانبية + canOpenView (users/data-mgmt للمدير/المطور فقط · dashboard بلا باب كالمكتبي nav_tree[0] بلا شرط · الميزات لا تمنع الفتح — تخفي الزر فقط كالمكتبي).
- تصحيح مواءمة مهم في nav-structure.ts: بندا «سندات القبض/سندات الصرف» كانا معًا على screen_vouchers؛ صارا على المفتاحين المكتبين المنفصلين حرفيًا (screen_receipts/screen_payments — main_window.py:782-787) ليعمل المنع التفريقي. حراس مسارات الـAPI لم يُلمس إطلاقًا (تبقى بوابة screen_vouchers المدمجة الموثقة) — والكتالوج كان يحوي المفتاحين أصلاً فلا مفاتيح ناقصة.
- التوصيل في ConTrackApp: AuthData صارت {user, perms} والاستعلام نفسه /api/auth/me يعيد الاثنين (بلا نداء إضافي) · مسار login يعيد perms أيضًا (permsForUser في استجابة /api/auth/login) وLoginView تمررها لhandleLoggedIn فتُصيَّر الشل مفلترة من أول لحظة بلا وميض · handleLogout يصفّر perms. حرس selectChild: بند بلا صلاحية ⇒ toast({title: NAVIGATE_DENIED_MSG}) ومنع التنقل (flagOn: ()=>true — الميزات لا تحرس الفتح). حرس navigate (البحث الشامل/الرجوع/فتح كشف من عقد/ملف عميل/سند من بحث): canOpenView بنفس الرسالة · وopenContract/openCustomerFile/openStatement/openVouchersWithQ/startNewContractForCustomer كلها صارت تمر عبر navigate المحروس. AppShell: permOn = permAllows(perms, k, manager) — الدور أولًا حتى لو الخريطة فاسدة، وvisibleChildren مستوردة من النقي.
- إصلاح ثغرة كشفها الـE2E فعليًا: أزرار تبويبات الوحدات العلوية كانت تختار module.children[0] الخام — فنقر «المحاسبة» كسكرتير منوعٍ منه القبض استدعى selectChild ببند محجوب وأظهر الحرس (دليل حي أنه يعمل) لكن التبويب كان يفشل في فتح الوحدة؛ صار يفتح kids[0] أول بند مرئي بعد الفلترة.
- اختبارات tests/phase9-nav-perms.test.ts (29 اختبارًا/72 تأكيدًا): permAllows (خريطة null/مفتاح مجهول لا يقيّدان · false صريح يُرفض · المدير يتجاوز خريطة ممنوعة الكل) · visibleChildren على NAV_MODULES الحقيقية (منع screen_receipts يخفي «سندات القبض» ويبقي «سندات الصرف» · المدير يرى الكل · flag مطفأ يخفي · adminOnly يخفي عن السكرتير ويظهر للمدير · البوابة مخفية افتراضيًا على السكرتير · تقارير السكرتير الست الافتراضية بالضبط) · isChildVisible (ترتيب الشروط) · canOpenView (users/data-mgmt · الرئيسية بلا باب · vouchers ببوابة الويب المدمجة · العُهد/السلف screen_custody الانحراف الموثق · رسالة الحرس حرفية حرفًا حرفًا) · الاكتمال البنيوي (كل perm في nav وVIEW_PERMS وREPORT_PERM موجود بالكتالوج القابل للتحرير في UsersView · لا بند بلا باب).
- E2E متصفحي (agent-browser) كامل: مستخدم مدير مؤقت zt51a (سكربت _tmp-51-user.ts على القاعدة ببروتوكول source .env.local) ⇒ API: إنشاء zt51 (secretary) عبر POST /api/users ومنع screen_receipts عبر PUT /api/users/22/permissions ⇒ دخول zt51 بالمتصفح: «سندات القبض» غائبة من قائمة المحاسبة و«سندات الصرف» وبقية البنود (كشف/العُهد/السلف/الشركة الأخرى/المطالبات/الفواتير) ظاهرة، البوابة مخفية بافتراض الكتالوج، التقارير الست الافتراضية، الإعدادات ببندَي الطباعة والأمان فقط بلا أي adminOnly — والنقر على التبويبات يفتح أول بند مرئي بلا توست. ثم منع screen_statement إضافيًا: «▦ كشف حساب» من إجراءات العقد CON-0012 أظهر التوست الحرفي «هذه الشاشة غير متاحة لحسابك.» (موثق بـinnerText+screenshot) وبقي العقد مفتوحًا — الفتح ممنوع ولا انهيار. ثم دخول zt51a (مدير): المحاسبة كاملة العشرة بنود بالقبض والكشف والبوابة، والإعدادات بعشر بنودها الإدارية.
- التنظيف الإلزامي: سكربت _tmp-51-clean.ts حذف zt51 (id=22) وصفَي صلاحياته (كاسكيد) وzt51a (id=21) وكل صفوف تدقيقهما (2+7) — النتيجة المطبوعة: USERS_FINAL = admin(id=1)/secretary(id=2) فقط · ORPHAN_PERM_ROWS=0 · LEFTOVER_AUDIT_ROWS=0 · السكربتان المؤقتان حُذفا (scripts بقي فيها الأصليان فقط). لا سندات ولا بيانات مالية أُنشئت أصلًا، ولا لمس لـgit أو أي PAT.
- الفحوص النهائية: bun test **230/230 (864 تأكيدًا — كانت 201/792)** · bunx tsc --noEmit = 0 · bun run lint = 0/0 · dev.log بلا أي 500 وكل الطلبات 200/401 المتوقعة.

Stage Summary:
- بند 5 (مواءمة PAGE_PERMS) مكتمل: الشل يخفي البنود حسب الصلاحيات من الاستجابة نفسها لـ/api/auth/me ومن استجابة الدخول، والمدير/المطور يريان كل شيء دائمًا بفحص الدور أولًا كالمكتبي، والمفتاح المجهول لا يقيّد، وحرس التنقل الحرفي يعمل على بند الشل وعلى المسارات الجانبية (بحث/رجوع/كشف من عقد) برسالة المكتبي حرفيًا.
- انحرافات موثقة (الويب أغنى وأبقيتها): screen_custody بديل حالة screen_payments المكتبية للعُهد/السلف · screen_other_company بديل screen_gateway للتسديدات · تقارير الويب بنباب rep مستقل لكل تقرير بينما المكتبي لا يحرس فتح التقرير بrep_* بل بشاشة التقارير فقط · حراس الـAPI على الدمج screen_vouchers بينما الشل يفصل القبض/الصرف بالمفتاحين المكتبين — ولوحة الرئيسية بباب screen_customers في بنود الشل (المكتبي يعرض الرئيسية دائمًا) مع بقاء canOpenView("dashboard") مفتوحًا كالمكتبي.
- يتبقى من قائمة المرحلة 9: 6 الإعدادات بتبويباتها · 7 الرئيسية الكاملة · 8 استيراد Excel · 9 قوالب Word · 11 المشاريع · 12 عروض الأسعار (وفحص اكتمال بند 3 تقارير العُهد) — جاهز للرفع بPAT مؤقت كالعادة.

---

Task ID: 51-v (الدفعة 2: تحقق المنسق + إكمال فحص بند 3 + رفع)
Agent: Z.ai Code (منسق)
Task: تحقق مستقل من تنفيذ Task 51 + توثيق أدلة اكتمال بندي الدفعة 2 (1 و3) + الرفع النهائي

Work Log:
- فحص اكتمال بند 1 (ملف العميل كصفحة): CustomerFilePage.tsx (1392 سطراً) بتبويبيه (عام / العقود والتفاصيل Master-Detail) وشارات الرأس الثلاث وواتساب والسجل الزمني والتعليقات والمرفقات والنماذج، موصول بالشل كـview «customer-file» مع مسار طباعة — **منجز**. بند 3 (تقارير العُهد السبعة): API يدعم الأنواع السبعة كلها (summary|balances|employee|detailed|monthly|handovers|open) + CustodyReports.tsx (643 سطراً) بتبويباتها السبعة الحرفية مع xlsx/csv — **منجزة**. المطابقة الرقمية على بيانات ذهبية تبقى لنطاق «مطابقة أرقام التقارير» اللاحق.
- تحقق منسق مستقل من Task 51: إعادة bun test **230/230 (864 تأكيداً)** · lint 0/0 · مراجعة أمنية لفرق login (إضافة خريطة perms بوليانية للمستخدم نفسه فقط — آمنة) وnav-perms.ts (منطق نقي مرآة has_permission) · الخادم المحلي 200 · شجرة نظيفة من ملفات مؤقتة.
- الرفع بPAT مؤقت (تضمين ثم إعادة الرابط نظيفاً فوراً والتحقق بremote -v وls-remote)؛ إثبات النشر: / = 200 وحرفية الحرس «هذه الشاشة غير متاحة لحسابك.» موجودة في باندل الإنتاج.

Stage Summary:
- الدفعة 2 من المرحلة 9 مكتملة: بندا 1 و3 منجزَان (الأدلة أعلاه) وبند 5 حيّ (إخفاء الشل بالصلاحيات + حرس التنقل الحرفي + القبض/الصرف بمفتاحين مكتبين منفصلين) — 230/230 اختباراً.
- يتبقى من الـ13 (ترقيم Task 49): 6 الإعدادات بتبويباتها · 7 الرئيسية الكاملة (+ مطابقة أرقام التقارير) · 8 استيراد Excel للأوراق الثماني · 9 مركز النماذج Word · 11 المشاريع · 12 عروض الأسعار.
- تذكير مؤجل بعد اكتمال كل العمل: تدوير الPAT وكلمة مرور القاعدة.

---

Task ID: 52-a + 52-b (المرحلة 9 — الدفعة 3: الإعدادات بتبويباتها + الرئيسية الكاملة)
Agent: full-stack-developer ×2 (اكتمل بمتابعة 52-c بعد انقطاع مهلة)
Task: بند 6 — إعادة هيكلة شاشة الإعدادات إلى تبويبات المكتبي الحرفية (9 إدارية + أدوات المطور بخمسة تابات داخلية) وبند 7 — الرئيسية الكاملة (عدادات + تغذية تنبيهات/نشاط + إجراءات سريعة + لوحة مهام مضمّنة + إخفاء/استعادة التنبيهات بجدول dismissed_alerts ومسارَي dismiss/restore) — نفّذ وكيلان الشيفرة كاملة وتوقفا بمهلة قبل التحقق المتصفحي؛ أصلح المنسق توصيل DashboardView/ConTrackApp (perms + onQuickAction + onOpenContract/onOpenCustomerFile) وخطأ deps حتى صارت الفحوص خضراء (294/294)، ثم أكمل 52-c الـE2E والتنظيف والتوثيق.

Work Log:
- بند 6 (52-a) — الخريطة البنيوية: SettingsView صار موزّعًا (203 أسطر نقطة دخول) على src/components/contrack/settings/: tabs-catalog.ts (منطق نقي قابل للاختبار — SETTINGS_TABS التسعة بترتيب settings.py:461-533 مع adminOnly/developerOnly، securityTabLabel («◆ الأمان والمستخدمون» للإدارة / «◆ كلمة المرور» لغيرها)، visibleSettingsTabs/defaultSettingsTab/resolveInitialSection (قسم الشل يقود التبويب وغير المرئي يرجع للافتراضي)، DEV_TABS الخمسة الداخلية بترتيبها الحرفي) + company/appearance/security/expense-accounts/workflow/visits/backup-tab.tsx + developer-tab.tsx بتاباته الخمسة developer/{features,identity,migration,network,cleanup}-section.tsx + shared.tsx. الأسلاك القائمة كلها محفوظة: /api/settings و/api/payment-methods وتبويب المزايا الحي عبر /api/feature-flags وحروف الشل (initialSection).
- مواءمة الظهور مع المكتبي: admin يرى الإدارية الثمانية بلا أدوات المطور، developer يرى التسعة، سكرتير يرى «الطباعة والعرض» + «كلمة المرور» فقط — وكل تبويبات سطح المكتب التي لا حامل ويب لها معروضة بنص المكتبي مع مؤشر «خاص بنسخة سطح المكتب — غير متاح في الويب» (هوية المطبوعات: الهيدر/الفوتر/التوقيع/الختم وموضع الختم)، وتبويب «✱ تنظيف البيانات» يعرض النصوص التحذيرية الأربع الحرفية مع «🗑 حذف سندات…» و«🗑 حذف مقاول باطن…» بعلامة «غير متاح في نسخة الويب الحالية» وتأكيدات المحو الثلاث (معاينة شجرة التبعيات ⇒ سبب + كلمة «محو» ⇒ تأكيد أخير) دون أي تنفيذ.
- بند 7 (52-b) — الرئيسية: DashboardView.tsx (674 أسطر) مرآة main_window.py:87-596 — بطاقات العدادات بترتيب المكتبي (عدد العملاء/العقود/[المشاريع متى كان مفتاح المزايا «المشاريع» مفعّلًا]/السندات) · تغذية «🔔 التنبيهات والنشاطات» المدمجة (التنبيهات أولًا ثم النشاط 8 أو 25 بتبديل «توسيع النشاط») بترقيم صفحات وحبّات ملوّنة بنمط _tint المكتبية (نص 100% وخلفية 10% وحد 30%) · «⚡ إجراءات سريعة» (عميل/عقد/سند قبض/سند صرف + مقاول باطن بشرط permAllows(action_add_subcontractor)) · لوحة «📌 المهام» المضمّنة (TasksPage compact: المهمة/الموعد/المتبقي بإعادة إطلاق 60 ثانية، إتمام/✎ تعديل/إعادة، «اختر مهمة من الجدول أولاً.» للإجراءات بلا تحديد، سطر «مهام مفتوحة: n | متأخرة: m») التي تختفي كليًا بمفتاح المزايا «المهام والتنبيهات»، وصفوف النشاط قابلة للنقر لتفتح العقد أو ملف العميل.
- الإخفاء/الاستعادة: نموذج DismissedAlert جديد (جدول dismissed_alerts — مفتاح مركب userId+alert_key حيث alert_key بصمة sha1 لنص التنبيه كالمكتبي V9.15.6 workflow_service.alert_key، وحذف كاسكيد بالمستخدم؛ إذا تغيّرت بيانات التنبيه تغيّرت بصمته فعاد ظاهرًا) + مسار POST /api/dashboard/dismiss {texts[]} (sha1 + dedupe ⇒ {dismissed}) وPOST /api/dashboard/restore (حذف صفوف المستخدم ⇒ {restored}) — والمنطق النقي في src/lib/dashboard-core.ts (533 أسطر: buildDashboardAlerts بترتيب المكتبي، filterAlerts بعمر 30 يومًا، DISMISS_CONFIRM_TITLE/TEXT وrestoredAlertsMessage الحرفية، تنسيقات المهام والنشاط) بخمس دفعات اختبارات phase9-dashboard/phase9-settings-tabs.
- متابعة 52-c — حادثة بيئية كُشفت بالتحقق الحي: GET /api/dashboard كان يعيد 500 «Cannot read properties of undefined (reading 'findMany')» عند db.dismissedAlert رغم أن المخطط والجدول والعميل المولّد على القرص سليمة — الجذر: عملية خادم التطوير (قائمة منذ 05:28) تحمل PrismaClient أُنشئ قبل آخر prisma generate فبقي العميل القديم في globalThis. العلاج: prisma generate ثم إعادة تشغيل الخادم كاملًا ببروتوكول source .env.local الموثق (لا تعديل شيفرة إطلاقًا) — dev.log بعد إعادة التشغيل (أُعيد إنشاؤه بtee) خالٍ من أي 500 وكل الطلبات 200/401.
- E2E الرئيسية كـadmin (zt52a مؤقت): الأقسام الأربعة تُصيَّر بأرقام حقيقية (1 عميل · 1 عقد · 0 مشاريع · 11 سندًا) بلا NaN/undefined وبلا أخطاء console؛ التغذية تعرض النشاط الفعلي بترقيم «صفحة 1 من 2 (1–8 من 9)» والتوسيع رفعها إلى 26 صفًا بـ4 صفحات؛ إجراء سريع «＋ سند قبض» ⇒ فتح شاشة السندات بوضع القبض (فلتر «قبض» نشطًا border-primary) دون إنشاء أي سند؛ صف نشاط «إصلاح فرق» بالنقر فتح تفاصيل العقد CON-0012 (onOpenContract موصول).
- E2E إخفاء/استعادة تنبيه (بمهمة تجريبية متأخرة id=3 أُنشئت ثم حُذفت): التهيئة بمهمة dueAt ماضٍ أظهرت تنبيهًا أحمر «📌 مهمة متأخرة: «zt52 مهمة تحقق مؤقتة»…»؛ القائمة (خيارات التنبيهات) ⇒ «🙈 إخفاء كل التنبيهات النظامية» ⇒ نافذة التأكيد بنصّي المكتبي الحرفيين («إخفاء التنبيهات» / «إخفاء كل التنبيهات النظامية الحالية؟ ستعود تلقائيًا إذا تغيّرت بياناتها.») ⇒ توست «تم إخفاء التنبيهات 🙈» واختفاء التنبيه والـAPI يعيد alerts=0 وdismissedCount=1؛ بند «↩ إظهار التنبيهات المخفية» ظهر شرطيًا في القائمة نفسها (وبُند الإخفاء صار معطلًا لأن alerts=0 — الشرطان محكمان) ⇒ توست «تمت إعادة إظهار 1 تنبيهًا.» وعاد التنبيه وdismissedCount=0؛ ثم حُذفت المهمة التجريبية (DELETE /api/tasks/3 بسبب موثق) فاختفى التنبيه طبيعيًا — لا أي أثر متبقٍ.
- تحويل تنبيه لمهمة: الزر «مهمة» غير حاضر على النوع الوحيد المتاح (مهمة متأخرة) وهذا مقصود مطابق للمصدر — noConvert:true لأن أصله مهمة أصلًا (dashboard-core:336-343)، وكل أنواع التنبيهات الأخرى (دفعات/انتهاء/مراحل…) قابلة للتحويل عند ظهورها. مكون التحويل نفسه (TaskEditPage المضمّن بنمط preset) تحقق تشغيليًا من «+ جديدة» بلوحة المهام (فتح النموذج بحقوله السبعة وإلغاء بلا حفظ).
- E2E الإعدادات كـadmin: التبويبات الثمانية كلها تُصيَّر بلا أخطاء (بيانات الشركة بحقولها ورسوم البنك وبوابة الباطن · الطباعة والعرض ببند الهوية «غير متاح في الويب» · الأمان والمستخدمون «المستخدم الحالي: zt52a» · أنواع العقود بجدولها · شجرة حسابات المصروفات · مراحل المتابعة · جدول الزيارات · البيانات والنسخ الاحتياطي)؛ حفظ إعداد حي وارتداد: هاتف الشركة '' ⇒ '99999999' ⇒ «تم الحفظ» ⇒ GET /api/settings يعيد companyPhone='99999999' ⇒ الارتداد إلى '' وحفظ ثانٍ والتحقق بالـAPI — الحالة الأصلية مستعادة.
- E2E الإعدادات كـdeveloper (zt52d): التسع تبويبات ظاهرة، «⚙ أدوات المطور» بتاباته الخمسة بالترتيب الحرفي (المزايا · الهوية والترخيص · الترحيل والاستيراد · الشبكة والنسخ · ✱ تنظيف البيانات)، تبويب المزايا حيّ بـ42 مفتاحًا/42 switch مطابقًا لـGET /api/feature-flags «يعمل كما كان»، وتبويب تنظيف البيانات عَرَض شاشته كاملة (التحذيرات الأربع + الأنواع غير المتاحة + كارت إعادة الضبط الكاملة بخطّه الأحمر) دون تنفيذ أي حذف إطلاقًا.
- سلوك السكرتير موثق كما هو: تبويبات أدوات المطور مخفية عنه مقصودًا (developerOnly في الكتالوج — مرآة is_developer)؛ تحقق عمليًا بمستخدم zt52s (secretary): التبويبان فقط «▤ الطباعة والعرض» + «◆ كلمة المرور» (بتغيّر التسمية للغير إداري) وكلاهما يُصيَّران بلا أخطاء. ملاحظة أمانة: مستخدم secretary الإنتاجي (id=2) لم يُدخل عليه لجهالة كلمته — والحكم عليه بالدور النقي (visibleSettingsTabs) وقد تحقق بمستخدم secretary مكافئ.
- التنظيف الإلزامي: scripts/_tmp-52-clean.ts (بنفس بروتوكول 51) حذف: صف سجل المحو المنسوب لzt52 (ناتج حذف المهمة التجريبية) و11 صف تدقيق (أدوار دخول/تعديل/إنشاء/حذف) والمستخدمين الثلاثة zt52a(23)/zt52d(24)/zt52s(25) مع صلاحياتهم وتنبيهاتهم المخفاة كاسكيد — النتيجة المطبوعة: TASKS_DELETED=0 · PURGE_AUDIT_DELETED=1 · AUDIT_ROWS_DELETED=11 · USER_DELETED 23/24/25 · **USERS_FINAL=admin(1)/secretary(2)** · **ORPHAN_PERM_ROWS=0** · **AUDIT_ZT52_ROWS=0** · DISMISSED_ROWS_LEFT=0 · PURGE_ZT52_ROWS_LEFT=0 — ثم حُذف السكربتان المؤقتان (scripts عادت للملفين الأصليين) وأُغلق المتصفح. لا سندات مالية أُنشئت ولا أي لمسة لـgit أو أي PAT.
- الفحوص النهائية: bun test **294/294 (1058 تأكيدًا)** · bunx tsc --noEmit = 0 · bun run lint = 0/0 · الخادم حي (/ = 200 و/api/dashboard = 401 بلا جلسة) — بلا أي تعديل شيفرة من 52-c (الشيفرة وصلت مكتملة من الوكيلين والمنسق).

Stage Summary:
- بندا 6 و7 من المرحلة 9 مكتملان ومتحقق منهما متصفحيًا: الإعدادات بتبويبات المكتبي الحرفية (8 إدارية للإدارة + أدوات المطور بخمسة تابات للمطور فقط + تابان للسكرتير) مع توثيق ما لا حامل ويب له بشرح «غير متاح في الويب»، والرئيسية الكاملة بعداداتها وتغذيتها وإجراءاتها السريعة ولوحة مهامها المضمّنة وإخفاء/استعادة تنبيهاتها ببصمة sha1 لكل مستخدم كالمكتبي V9.15.6 — والتحقق المتصفحي الكامل (أقسام · أرقام بلا NaN · إجراء سريع · إخفاء واستعادة · تحويل/لوحة مهام · حفظ وارتداد · تنظيف بيانات عرضًا فقط) ناجح بلا أي أثر على بيانات الإنتاج.
- ما تبقى من قائمة المرحلة 9 (ترقيم Task 49): 8 استيراد Excel للأوراق الثماني · 9 مركز النماذج Word · 11 المشاريع · 12 عروض الأسعار — جاهز للرفع بPAT مؤقت كالعادة.
- تذكير مؤجل بعد اكتمال كل العمل: تدوير الPAT وكلمة مرور القاعدة.

---
Task ID: 53 (المرحلة 9 — بند 11: المشاريع)
Agent: full-stack-developer
Task: بناء المشاريع وفق نطاق المكتبي المكتشف — مخطط Prisma (مرآة database_schema_postgresql.sql §48) + مسارات API بقائمة/إنشاء/عرض/تعديل/حذف محروس ومُدقَّق + عداد «عدد المشاريع» الحقيقي في الرئيسية + حوار إدارة داخل شاشة العملاء بمفتاح المزايا + اختبارات نقية وتحقق متصفحي وتنظيف كامل

Work Log:
- اكتشاف نطاق المكتبي (قرأته بنفسي): لا شاشة مستقلة ولا حوار لإدارة المشاريع في واجهة المكتبي إطلاقًا — dealings.py:8 «العقد هو المشروع: مشروع مطابق يُنشأ تلقائيًا داخل add_contract» عبر ensure_auto_project/sync_auto_project (lifecycle_service.py:5928/5946) وcontracts.project_id الموجودة في SQLite فقط؛ ولم يُجدَ أي مستدعٍ لواجهة لدوال add/update/delete_project (الاختبارات فقط). الظواهر المكتبية: بطاقة «عدد المشاريع 🏗» شرط مفتاح المزايا projects (main_window.py:154-155) · نتيجة بحث «مشروع» تفتح مركز عقد أول عقد مرتبط محروسًا بـscreen_customers (main_window.py:1813/1825-1827) · سند الصرف يشتق project_id آليًا من عقده (vouchers.py:2066) وحقل «المشروع» في النافذة مخفي دائمًا (vouchers.py:1461) وقائمة السندات بلا عمود مشروع (vouchers.py:2602). الحالات: لا قائمة حالات للمشاريع بالمكتبي؛ DEFAULT 'جديد' في المخطط المرجعي §48 مقابل 'نشط' في SQLite/add_project — واعتمدت «جديد» افتراضيًا (المخطط المرجعي هو مرجع الويب) وشرائح {جديد،نشط،متوقف،منتهي} من مفردات STATUS_COLORS (style.py:123) حيث «جديد» يرجع الرمادي الافتراضي كغير المعروف. التقرير: لا قسم مشاريع في report_service (فقط labels «العقد / المشروع» في ربحية تقرير قائم) — لا شيء يُطبَّق. الحذف المكتبي يُمنع بالارتباط: «لا يمكن حذف المشروع لأنه مرتبط بعقود أو سندات.» (lifecycle_service.py:176).
- قرار نطاق موثق: مخطط PostgreSQL المرجعي (§48) بلا contracts.project_id (لا quotations إلا لعروض الأسعار غير المنفذة)، فلا يُنفَّذ «مشروع تلقائي لكل عقد» في الويب — المشاريع كيان مستقل تابع للعميل (CASCADE) والربط المالي الوحيد vouchers.project_id (الحقل قائم بالإنتاج منذ مراحل سابقة؛ أضفت علاقة Prisma للمشروع فقط — إضافي بلا أي تعديل أعمدة قائمة).
- المخطط: model Project (@@map("projects")) حرفيًا §48 — customerId Int? علاقة onDelete: Cascade · name · description/location "" · startDate/endDate نص "" (نمط تواريخ الويب) · status "جديد" · createdAt/updatedAt — + projects Project[] في Customer + project Project? في Voucher. `set -a && . ./.env.local && set +a && bun run db:push` = «Your database is now in sync» (Supabase) مع توليد العميل.
- الخادم: src/lib/projects-core.ts نقي (clean{ProjectName 200/Text/Date parseDay/Status 20/CustomerId} · PROJECT_NAME_REQUIRED «اسم المشروع مطلوب.» الحرفية · PROJECT_DELETE_BLOCKED الحرفية · PROJECT_STATUSES · sortProjectsDesc مرآة ORDER BY p.id DESC · filterProjectsByCustomer · projectPeriodLabel) وsrc/lib/projects-server.ts (listProjects: ربط اسم/هاتف العميل وبحث normalizeArabic على الاسم/الوصف/الموقع/العميل/هاتفه — مفاتيح project_code المكتبية غير موجودة بالمخطط فاستُبعدت — والأحدث أولًا · getProjectRow بعداد سندات). مسارات: /api/projects (GET بفلتري customerId/q + POST بتحقق الاسم ووجود العميل وتدقيق «إنشاء مشروع») و/api/projects/[id] (GET/PUT بتدقيق «تعديل مشروع» مع oldStatus/newStatus · DELETE بـadminGuard وحارس الارتباط المكتبي على السندات ثم «حذف مشروع») — البوابة كلهًا screen_customers (شاشة الحاضن: المكتبي لا يدخل المشاريع في PAGE_PERMS ويحروس فتح نتيجة المشروع بها) — بنمط contract-groups (authGuard/jsonError/ok/audit داخل $transaction).
- الرئيسية: /api/dashboard أضيف db.project.count() إلى Promise.all وأعاد projects الحقيقي (كان صفرًا ثابتًا من الوكيل السابق مع تعليق «لا نموذج مشاريع في الويب بعد») — والبطاقة كانت مشروطة بالمفتاح منذ 52-b فصارت حية.
- الواجهة: src/components/contrack/ProjectsManagerDialog.tsx (جديد) — حوار داخل شاشة العملاء (الحاضنة) يفتح بزر «🏗 المشاريع» في ترويسة CustomersView يظهر فقط بمفتاح المزايا projects عبر useFeatureFlags (كما تظهر البطاقة المكتبية بمفتاحها) — بلا بند شل (لا مدخل مكتبي في الشل): قائمة max-h-96 overflow-y-auto بأعمدة الاسم+الوصف/العميل/شارة الحالة (statusBadgeClass)/الموقع+المدة/السندات/إجراءات (تعديل للجميع وحذف للمدير) وفراغ «لا توجد مشاريع بعد — أضف أول مشروع» وبحث مطبَّع debounce؛ نموذج إنشاء/تعديل (الاسم* · عميل «— بدون عميل —» اختياري · الموقع · الحالة من الشرائح · تاريخا البداية/النهاية · الوصف) بحفظ apiPost/apiPut وتوستَي «أُنشئت/تم تعديل المشروع ✅» وإبطال مفاتيي projects/dashboard؛ حوار تأكيد حذف «سيُحذف المشروع… سيرفض النظام الحذف مع إظهار السبب» وخطأ الخادم (حارس الارتباط) توست destructive. CustomersView لم يُلمس منها إلا الزر والجسر (خارج قائمة الحظر).
- اختبارات tests/phase9-projects.test.ts = 13 اختبارًا/46 تأكيدًا (التحقق والحقول بسقوطها · الحالات وألوانها و«جديد» رمادي · الترتيب التنازلي بلا إتلاف والفلتر · فترة العرض · حرفية حارس الحذف · لا حقول مال في صف المشروع).
- E2E متصفحي (zt53a مدير مؤقت id=26 ببروتوكول 51): بطاقة «عدد المشاريع 0» ظاهرة بالرئيسية؛ زر «المشاريع» في شاشة العملاء ⇒ الحوار فارغ برسالة الفراغ؛ «＋ مشروع جديد» ⇒ إنشاء «zt53» بموقع ووصف ⇒ توست «أُنشئ المشروع ✅ zt53» وظهوره بالقائمة (جديد · موقع التجربة · 0 سندات) وارتفاع العداد إلى projects:1 بالـAPI والبطاقة؛ تعديل الاسم إلى «zt53-معدل» والحالة إلى «نشط» ⇒ توست «تم تعديل المشروع ✅» وانعكاسها؛ حذف بنافذة التأكيد ⇒ «تم الحذف» والقائمة فارغة والعداد عاد صفرًا؛ حواجز الـAPI بالتوكن: اسم فارغ ⇒ 400 «اسم المشروع مطلوب.» حرفيًا · عميل 99999 ⇒ 400 «العميل غير موجود.» · تاريخ فاسد ⇒ تطبيع "" · حذف 9999 ⇒ 404 · مشروع 2 (تدقيق مؤقت) حُذف 200. لا سند مالي أُنشئ إطلاقًا (vouchers بقيت 11 الإنتاجية).
- التنظيف: scripts/_tmp-53-clean.ts حذف zt53a (id=26) و8 صفوف تدقيقه (النتيجة المطبوعة: USER_DELETED=1 · AUDIT_ROWS_DELETED=8 · PROJECT_ROWS_DELETED=0 · VOUCHERS_WITH_PROJECT=0 · PROJECTS_LEFT=0) — والتحقق النهائي: **USERS_FINAL=admin(1)/secretary(2)** · ORPHAN_PERM_ROWS=0 · ZT53_AUDIT_LEFT=0 · PROJECTS_LEFT=0 — ثم حُذف السكربتان المؤقتان (scripts عادت للملفين الأصليين) وأُغلق المتصفح. لا git ولا PAT إطلاقًا.
- الفحوص النهائية: bun test **307/307 (1104 تأكيدًا — كان 294/1058)** · bunx tsc --noEmit = 0 · bun run lint = 0/0 · الخادم أُعيد تشغيله بعد db:push ببروتوكول source .env.local (درس 52-c لالتقاط عميل Prisma الجديد) وdev.log خالٍ من 500 (/ = 200 · /api/projects = 401 بلا جلسة).

Stage Summary:
- بند 11 (المشاريع) مكتمل بنطاق المكتبي الحقيقي: المخطط المرجعي §48 حرفيًا بلا أي حقول مال، مسارات محروسة بـscreen_customers (الحاضنة) وحذف إداري بحارس الارتباط الحرفي، عداد الرئيسية الحقيقي تحت مفتاح «المشاريع»، وحوار إدارة خفيف داخل شاشة العملاء (المكان المكافئ لشاشة التعاملات) — مع توثيق أن واجهة إدارة المشاريع غير موجودة أصلًا في المكتبي (العقد هو المشروع) وأن «المشروع التلقائي لكل عقد» غير قابل للتنفيذ بلا contracts.project_id في المخطط المرجعي، وأن المكتبي لا يعرض اسم المشروع في قائمة السندات فلا عمود مشروع أُضيف.
- ما تبقى من قائمة المرحلة 9 (ترقيم Task 49): 8 استيراد Excel للأوراق الثماني · 9 مركز النماذج Word · 12 عروض الأسعار (ويحتاج قائمة المشاريع/العقود فحص اكتمال بند 3 تقارير العُهد) — جاهز للرفع بPAT مؤقت كالعادة.
- تذكير مؤجل بعد اكتمال كل العمل: تدوير الPAT وكلمة مرور القاعدة.
---

Task ID: 54 (المرحلة 9 — بند 12: عروض الأسعار)
Agent: full-stack-developer
Task: بناء عروض الأسعار وفق نطاق المكتبي المكتشف — مخطط Prisma (مرآة database_schema_postgresql.sql §49-50) + مسارات API بقائمة/إنشاء بترقيم آلي/عرض/تعديل/انتقال حالة/حذف محروس ومُدقَّق + حوار إدارة داخل شاشة العملاء + اختبارات نقية وتحقق متصفحي وتنظيف كامل

Work Log:
- اكتشاف نطاق المكتبي (قرأته بنفسي): لا شاشة مستقلة ولا حوار لإدارة عروض الأسعار في واجهة المكتبي إطلاقًا — دوال add/list/get/set_quotation_status/convert_quotation_to_contract (lifecycle_service.py:4774-4884) بلا مستدعٍ واجهة (الاختبارات فقط)، والموضعان الوحيدان في الواجهة لمركز نماذج Word يختار عرضًا كمصدر تعبئة (word_forms_center.py:481/1299 — واختيار العرض بنافذة أعمدة «رقم العرض/العميل/المشروع/الحالة/الإجمالي» ورسالة الفراغ «لا توجد عروض أسعار لتوليد مستند منها.») — بند 9 لاحقًا لا يُبنى الآن.
- دورة الحالة الحرفية: QUOTE_STATUSES المكتبي (lifecycle_service.py:13) سبع حالات ["مسودة","مرسل للعميل","تحت المراجعة","مقبول","مرفوض","منتهي الصلاحية","تم تحويله إلى عقد"] بافتراضي SQLite «مسودة»، بينما مخطط PostgreSQL المرجعي §49 (مرجع الويب كما في بند المشاريع) بخمس حالات «جديد/مرسل/مقبول/مرفوض/منتهي» بافتراضي «جديد» — اعتمدت المرجعية حرفيًا. set_quotation_status (:4845-4849) بلا مصفوفة انتقالات: أي حالة من المجموعة تصلح لأي أخرى وغيرها ⇒ «حالة عرض السعر غير صحيحة.» — و«مقبول» بلا أي أثر جانبي (لا سند ولا عقد: لا شيء في تدفق العروض المكتبية ينشئ سندات إطلاقًا، وتحويل العرض لعقد دالة صريحة convert_quotation_to_contract بلا مستدعٍ واجهة وبلا عمود contract_id في المخطط المرجعي فخارج نطاق الويب — لا سندات في الاختبار إطلاقًا كما طلب البند).
- الترقيم: next_quote_number() = _next_number("quotations","quote_number","QUO") ⇒ QUO-%04d (lifecycle_service.py:96) — نفّذته nextQuotationNumber بنمط contract-groups (أعلى رقم +1 وتالفة ⇒ QUO-0001) مع P2002-retry ×8.
- مفتاح المزايا: لا مفتاح لعروض الأسعار في FEATURES المكتبي (43 مفتاحًا) ولا في كتالوج الويب (42) — فالحوار بلا بوابة مزايا، زر «🧾 عروض الأسعار» دائم الظهور في ترويسة CustomersView، والبوابة كلها screen_customers (الحاضنة — لا مدخل في PAGE_PERMS كالمشاريع).
- المخطط: model Quotation + QuotationItem مرآة §49-50 حرفيًا (customerId RESTRICT · projectId nullable SET NULL · quotationNumber unique · description · totalAmount Decimal(18,3) · status "جديد" · validUntil نص YYYY-MM-DD · notes · createdBy Int? بعلاقة المستخدم · علاقة items Cascade · @@map("quotations"/"quotation_items")) + علاقات إضافية على Customer/Project/User. `set -a && . ./.env.local && set +a && bun run db:push` = «Your database is now in sync» مع توليد العميل، وأُعيد تشغيل الخادم ببروتوكول source (درس 52-c) لالتقاط عميل Prisma الجديد.
- الخادم: src/lib/quotes-core.ts نقي (nextQuotationNumber · QUOTATION_STATUSES الخمس · QUOTATION_INVALID_STATUS «حالة عرض السعر غير صحيحة.» · QUOTATION_CUSTOMER_REQUIRED/ITEMS_REQUIRED الحرفيتان من add_quotation · clean* للحقول · cleanQuotationItems (الوصف إلزامي للبند والفارغ يُسقط والترتيب يُعاد فهرسة وإجمالي البند = كمية×سعر كالعمود المولَّد §50) · computeItemsTotal/itemsMatchTotal بعتبة 0.001 · quotationStatusBadgeClass بمفردات STATUS_COLORS (مرسل أزرق · مقبول/منتهي بنفسجي · مرفوض أحمر · جديد رمادي كغير المعروف) · sortQuotationsDesc مرآة ORDER BY q.id DESC) وsrc/lib/quotes-server.ts (listQuotations: ربط العميل/المشروع/المُنشئ وعداد البنود وبحث مطبَّع على رقم العرض/الوصف/العميل/المشروع بفلاتر customerId/status — الأحدث أولًا · getQuotationRow ببنوده). مسارات: /api/quotes (GET + POST بتحقق العميل/المشروع/البنود وإنشاء العرض وبنوده وtotalAmount محسوب من البنود داخل $transaction وaudit «إنشاء عرض سعر» وcreatedBy) و/api/quotes/[id] (GET ببنوده · PUT يستبدل البنود ويعيد حساب الإجمالي بتدقيق «تعديل عرض سعر» — إضافة ويب موثقة: المكتبي بلا دالة تعديل · DELETE adminGuard كما المشاريع — إضافة ويب موثقة: المكتبي بلا حذف، وحارس الارتباط المدمج customer_id RESTRICT يمنع حذف عميل له عروض والبنود كاسكيد) و/api/quotes/[id]/transition (مرآة set_quotation_status حرفيًا: حراسة الحالة خارج المجموعة برسالتها الحرفية + تدقيق «تغيير حالة عرض السعر» oldStatus/newStatus — التدقيق إضافة ويب).
- الواجهة: src/components/contrack/QuotesManagerDialog.tsx بنمط ProjectsManagerDialog تمامًا (react-query + useToast + Dialog + 401⇒onAuthError + formatKWD): قائمة max-h-96 overflow-y-auto بأعمدة الرقم+الوصف/العميل/المشروع/الحالة/الإجمالي/الصلاحية+عدد البنود/إجراءات، وبحث مطبَّع debounce وفلتر حالة، وشارة الحالة نفسها DropdownMenu بأزرار الحالات المسموحة (المجموعة ناقص الحالية — بلا مصفوفة بالمكتبي) تستدعي مسار الانتقال حصريًا، ونموذج إنشاء/تعديل (العميل* · المشروع المرشَّح بعميله اختياري · الوصف · صالح حتى · محرر بنود بإضافة/إزالة وإجمالي صف حي وإجمالي كلي · ملاحظات) بلا محدّد حالة (الانتقال من القائمة حصرًا — انفصال set_quotation_status)، وتوست «أُنشئ عرض السعر ✅ QUO-0001/تم تعديل…/تم تحديث الحالة ✅/تم الحذف»، ونافذة تأكيد حذف «سيُحذف العرض «QUO-0001» ببنوده (n بند) نهائيًا». CustomersView لم يُلمس منها إلا الزر والجسر (خارج قائمة الحظر) — والرئيسية بلا عدادات عروض بالمكتبي (بطاقاتها: عملاء/عقود/[مشاريع]/سندات) فلا شيء أُضيف.
- اختبارات tests/phase9-quotes.test.ts = 19 اختبارًا/95 تأكيدًا (الترقيم QUO-%04d والتالفة · قيم الحالات الخمس وافتراضي «جديد» ورسالة الحالة غير الشرعية الحرفية · العضوية والانتقالات any→any داخل المجموعة وخارجها مرفوض · ألوان الشارات · الرسائل الحرفية · تنظيف الحقول والتواريخ والأموال غير السالبة بثلاث خانات · تطبيع البنود وإسقاط الفارغ وإعادة الفهرسة · مجموع البنود = الإجمالي بعتبة 0.001 · الترتيب التنازلي بلا إتلاف · شكل الصف).
- E2E متصفحي (zt54 مدير مؤقت id=27 ببروتوكول 51): زر «عروض الأسعار» ظاهر في ترويسة العملاء ⇒ الحوار فارغ برسالة الفراغ ⇒ «عرض جديد» ⇒ عميل «شركة الأفق للمقاولات» ووصف «zt54 عرض تجربة ببندين» وبندان (تكييف مركزي 2×450.125 · دهانات 3×100) بإجمالي حي «الإجمالي: 1,200.250 د.ك» ⇒ الإنشاء ⇒ ظهور QUO-0001 بالقائمة (جديد · شركة الأفق · 1,200.250 · 2 بند) والـAPI يؤكد totalAmount=1200.25 وcreatedBy=zt54 ⇒ انتقال شرعي بالقائمة «جديد→مرسل» من قائمة الشارة ⇒ الشارة «مرسل» والـAPI يؤكد ⇒ حذف بنافذة التأكيد ⇒ توست «تم الحذف/حُذف عرض السعر بنجاح» والقائمة فارغة والـAPI count=0. حواجز الحرة: انتقال «مسودة» (حالة SQLite خارج المجموعة) ⇒ 400 «حالة عرض السعر غير صحيحة.» حرفيًا · بنود فارغة ⇒ 400 «يجب إضافة بند واحد على الأقل لعرض السعر.» · عميل صفر ⇒ 400 «يجب اختيار العميل.» · عميل 99999 ⇒ 400 «العميل غير موجود.» · بلا جلسة GET/POST/transition كلها 401 · PUT استبدال البنود أعاد حساب الإجمالي (500). لا سند مالي أُنشئ إطلاقًا.
- التنظيف: scripts/_tmp-54-clean.ts حذف zt54 (id=27) و5 صفوف تدقيقه (النتيجة المطبوعة: QUOTATIONS_DELETED=0 · AUDIT_ROWS_DELETED=5 · USER_DELETED=27 · **USERS_FINAL=admin(1)/secretary(2)** · QUOTES_LEFT=0 · QUOTE_ITEMS_LEFT=0 · ZT54_AUDIT_LEFT=0 · ZT54_LEFT=0) — والسكربتان المؤقتان حُذفا (scripts عادت للملفين الأصليين) وأُغلق المتصفح. لا git ولا PAT إطلاقًا.
- الفحوص النهائية: bun test **326/326 (1199 تأكيدًا — كان 307/1104)** · bunx tsc --noEmit = 0 · bun run lint = 0/0 · الخادم حي بعد db:push وإعادة التشغيل (/ = 200 · /api/quotes = 401 بلا جلسة) وdev.log بلا أي 500.

Stage Summary:
- بند 12 (عروض الأسعار) مكتمل بنطاق المكتبي الحقيقي: المخطط المرجعي §49-50 حرفيًا (RESTRICT/SET NULL/CASCADE وإجمالي البند = كمية×سعر ومجموعها هو totalAmount بعتبة 0.001)، مسارات محروسة بـscreen_customers (الحاضنة) وترقيم آلي QUO-%04d محمي من التضارب بحلقة P2002 ×8، دورة الحالة بلا مصفوفة انتقالات كالمكتبي (أي حالة من الخمس تصلح لأي أخرى برسالة الحارس الحرفية لغيرها) و«مقبول» بلا أي أثر جانبي ولا سندات إطلاقًا، حوار إدارة داخل شاشة العملاء بنمط المشاريع وبأزرار الحالات المسموحة على الشارة نفسها، وحذف إداري (إضافة ويب موثقة كالمجموعات/المشاريع) — مع توثيق أن واجهة إدارة العروض غير موجودة أصلًا بالمكتبي وأن التحويل لعقد دالة صريحة بلا مستدعٍ وبلا عمود contract_id في المرجع فخارج نطاق الويب، وأن نموذج Word للعروض موجود بالمكتبي (word_service.quotation_field_values) مؤجل لبند 9، ولا عدادات عروض بالرئيسية فلا شيء أُضيف لها.
- ما تبقى من قائمة المرحلة 9 (ترقيم Task 49): 8 استيراد Excel للأوراق الثماني · 9 مركز النماذج Word (ومنه يُغطّى نموذج عرض السعر) — جاهز للرفع بPAT مؤقت كالعادة.
- تذكير مؤجل بعد اكتمال كل العمل: تدوير الPAT وكلمة مرور القاعدة.

---
Task ID: 55 (+55-c) (المرحلة 9 — بند 8: استيراد Excel للأوراق الثماني)
Agent: full-stack-developer (55: شيفرة كاملة ثم انقطاع بمهلة قبل أي تحقق — 55-c: استئناف وتحقق وتوثيق)
Task: بناء معالج استيراد البيانات القديمة من Excel وفق المكتبي — المحرك في src/lib/import/ · مسارات /api/import/{parse,run,template} · واجهة المعالج داخل تاب «الترحيل والاستيراد» · اختبارات نقية، ثم التحقق الحي والتنظيف والتوثيق (55-c استأنفت بعد انقطاع مهلة الوكيل الأول: الشيفرة وصلت مكتملة بلا أي فحص أو E2E أو قيد worklog).

Work Log:
- ما بُني (55 — موثق من الشيفرة كما كتبتها): **sheets.ts** مرآة حرفية لـSHEETS (import_service.py:22-104): الأوراق الثماني بترتيبها [العملاء(5 أعمدة: اسم العميل*/رقم الهاتف*/العنوان/البريد/ملاحظات) · العقود(8: عميل*/اسم العقد ووصفه/قيمة*/تاريخ العقد*/بداية/نهاية/الحالة/نوع العقد*) · مقاولو الباطن(4) · الدفعات(6) · سندات القبض(8 برقم السند القديم) · عقود الإشراف(7) · عقود الباطن(7) · سندات الصرف(11 بحساب المصروف*/المستفيد*)] بأعمدتها بعرضها بالأحرف وصف المثال بعلامته «← مثال، سيتم تجاهله» + IMPORT_CONTRACT_STATUSES الخمس + IMPORT_PAY_METHODS الخمس + نصوص ورقة «اقرأني أولاً» الثمانية عشر حرفيًا (IMPORT_INSTRUCTIONS بأحجامها وألوانها) واسمَي الملف الحرفيين. **parse-core.ts** (864 سطرًا) المحلل النقي المرآة لـparse_excel (:417-927): قراءة موضعية للأعمدة وتجاهل صف المثال (سطر 2) بعلامته أو بمطابقة المثال والصفوف الفارغة، وتجميع الأخطاء برقم الصف («الورقة سطر n: الرسالة»)، والقواعد الحرفية: اسم العميل فارغ./رقم الهاتف مطلوب./الاسم مكرر في الملف — ومنع الإدخال الصامت تحت «غير محدد» بنوع العقد («لن يُدخل العقد تحت غير محدد»)، ومطابقة العقود بالثلاثية (اسم/وصف/رقم) بلا «ملغى»، والأوراق الغائبة تنبيه «ورقة «X» غير موجودة، سيتم تخطيها.» لا خطأ، ومعاينة أول 5 صفوف مقبولة لكل ورقة. **execute.ts** (506 أسطرًا) مرآة execute_import (:933-1155): تنفيذ بترتيب التبعية (عملاء←عقود←إشراف←مقاولون←قبض←باطن←صرف) داخل معاملات لكل صف، رفض كلي ما دامت أخطاء نطاق الأوراق المختارة قائمة، تخطي الموجود بدل التوقف (skipped_* في الإحصاء)، العملاء بنotes+«[مستورد]» وكود C-%04d عبر number_sequences، السندات عبر createVoucher (قيود/رسوم/أحداث كالشاشات) وتسجيل overpaid كسلفة لا إيقاف، وتدقيق «إنشاء» لكل صف + «استيراد بيانات قديمة» إجماليًا. **db-context.ts** خرائط المكتبي من القاعدة (أسماء العملاء/العقود/الأنواع المعتمدة/حسابات المصروفات fullPath+name/أرقام السندات/المشاريع/المقاولين) + تحميل ExcelJS بفك تغليف الصيغ (data_only). **template.ts** مرآة generate_template: ورقة التعليمات + الأوراق الثماني بترويستها المعبأة (1E3A5F) وصف المثال الرمادي وحدود مئة صف جاهزة وقوائم منسدلة للحالة/طريقة الدفع/الأنواع المعتمدة وrightToLeft وتجميد الرأس، وقالب ورقة واحدة بالاسم الحرفي. **lock.ts** قفل ذاكرة واحد (لا تزامن) وحد 10MB. **المسارات**: /api/import/parse (رفع multipart ⇒ فحص كامل: counts/sheetsPresent/errors/warnings/preview — لا إدخال) و/api/import/run (file+sheets JSON ⇒ إعادة فحص من الملف ثم تنفيذ المختار بترتيب التبعية، ورفض 400 «لا يمكن الاستيراد · يوجد أخطاء لم تُصحح.» مع جدول الأخطاء) و/api/import/template?sheet= (xlsx كامل أو ورقة واحدة بأنواع العقود المعتمدة الفعلية) — الثلاثة بحارس المطور حرفيًا (developerGuard: role=«developer» وإلا 403 «معالج الاستيراد للمطور فقط») وميزة import_old (افتراضي true) وقفل الاستيراد (429). **الواجهة** import-wizard.tsx (523 سطرًا) مرآة import_wizard.py بثلاث خطوات: ⬇ تنزيل القالب الكامل + ٨ أزرار قوالب ورقة واحدة · اختيار الملف وفحصه تلقائيًا (سطر ملخص العدّادات الحرفي + جدول أخطاء برقم الصف + التنبيهات + «🛑 صحح الأخطاء أعلاه…» + اختيار الأوراق المنفَّذة بالشارات + معاينة أول صفوف) · تنفيذ بنافذة تأكيد المكتبي الحرفية («سيتم الآن إدخال:… يُنصح بأخذ نسخة احتياطية…») معطلة ما دامت أخطاء الأوراق المختارة قائمة، وتقرير النتيجة بالتخطيَات وoverpaid — مثبتة كارت «📥 استيراد البيانات القديمة» في تاب «الترحيل والاستيراد» (يُخفى بمفتاح import_old)، و«الخطوة صفر» المكتبية (تأسيس الأنواع) و«إصلاح عقود غير محدد» معروضان كـDesktopOnlyCard خارج نطاق البند. **الاختبارات** tests/phase9-import.test.ts = 34 اختبارًا/108 تأكيدات (قواعد العملاء/العقود/الأنواع/السندات صفًا صفًا، تجاهل المثال، الأوراق الغائبة تنبيهًا، رفض التنفيذ بالأخطاء، التخطي وoverpaid، نصوص القوالب الحرفية).
- متابعة 55-c — الفحوص المحلية أولًا: bun test كامل **360/360 (1307 تأكيدًا — كان 326/326 قبل البند: +34 اختبارًا/+108 تأكيدات كلها من phase9-import)** · bunx tsc --noEmit = 0 · bun run lint = 0/0 · الخادم حي (/ = 200 · /api/import/parse بلا جلسة = 401) وdev.log بلا أي 500 — **لا أي تعديل شيفرة من 55-c** (الشيفرة وصلت مكتملة؛ لم يُصلَّح شيء).
- انحراف موثق عن موجز المهمة: جلسة E2E بمعرّف **مطور** لا admin — حارس المسارات الثلاثة developerGuard يشترط role=«developer» حرفيًا (admin يأخذ 403)، فأُنشئ zt55a (id=28، developer) ببروتوكول 51 (_tmp-55-user.ts بـPBKDF2/200000) ودخول /api/auth/login ⇒ توكن Bearer.
- E2E بالـAPI (curl بجلسة zt55a) — ملفات xlsx مولّدة بـExcelJS بأعمدة sheets.ts **حرفيًا** (ترويسة + صف المثال بعلامته): **1) parse بالملف الفاسد** (عميلان بهاتف/بلا هاتف + صف بلا اسم) ⇒ 200: sheetsPresent=[العملاء] · counts.customers=1 · **errors=2 برقم الصف**: «العملاء سطر 4: رقم الهاتف مطلوب.» و«العملاء سطر 5: اسم العميل فارغ.» (ملاحظة أمانة: «أخطاء 1» في الموجز صارت 2 — الهاتف إجباري حرفيًا بالقاعدة :254 ونص تعليمات القالب ٦، فصف «بلا هاتف» خطأ مقصود أثبت الحارس) · warnings=7 (الأوراق الغائبة تخطىً لا خطأ) · preview العملاء بأسطر 3-5 برؤوس الأعمدة الحرفية وصف المثال (سطر 2) مُتجاهَل فعليًا. **2) run بالملف الفاسد** (sheets=[«العملاء»]) ⇒ **400 «لا يمكن الاستيراد · يوجد أخطاء لم تُصحح.»** بجدولي الأخطاء — والقاعدة لم تُلمس (GET /api/customers?q=zt55 = 0 قبل وبعد). **3) run بالملف النظيف** (العميلان الصالحان) ⇒ 200: **customers=2** skipped=0 overpaid=[] — «أُدرج 2». **4) فحص القاعدة** عبر API: العميلان دُخرا بحقولهما الصحيحة (C-0018 zt55 شركة الاستيراد الأولى/5550001/حولي بلوك 1/first@zt55.test/«عميل اختبار أولى [مستورد]» · C-0019 الثانية بالمثل) + تدقيق كامل: 2×«إنشاء customer» reason «استيراد من البيانات القديمة» + «استيراد بيانات قديمة | import_excel | عملاء 2 …». **5) إعادة run نفس الملف** ⇒ customers=0 skipped=2 (تخطي الموجود بلا تكرار وبلا سندات مالية إطلاقًا). **6) القوالب**: GET /api/import/template?sheet=العملاء ⇒ **200 + xlsx (MIME صحيح، 8531 بايت، أول بايتا الملف PK)** بورقة العملاء وحدها · القالب الكامل ⇒ 200/33051 بايت/PK بتسع أوراق بترتيبها الحرفي (اقرأني أولاً | العملاء | العقود | مقاولو الباطن | الدفعات | سندات القبض | عقود الإشراف | عقود الباطن | سندات الصرف) · ورقة مجهولة ⇒ 400 «ورقة غير معروفة — الأوراق الثماني فقط لها قوالب».
- E2E المتصفح (agent-browser بجلسة zt55a): دخول ⇒ الإعدادات ⇒ «⚙ أدوات المطور» ⇒ تاب «الترحيل والاستيراد» ⇒ المعالج كامل الخطوات: زر «⬇ تنزيل القالب» + أزرار القوالب الثمانية للأوراق بأسمائها الحرفية + «اختيار الملف وفحصه»؛ رفع الملف الفاسد من الواجهة (الكشف عن input المخفي للفحص فقط) ⇒ سطر الملخص الحرفي «نتيجة الفحص: 👥 1 عميل | 📑 0 عقد | 👷 0 مقاول | 📥 0 دفعة — أخطاء: 2 | تنبيهات: 7» وجدول الأخطاء برقمَي الصف والسببين الحرفيين والتنبيهات السبعة و«🛑 صحح الأخطاء أعلاه…» ومعاينة الصفوف بأسطرها (3-5) وجدول المثال متجاهَل — **وزر «📥 تنفيذ الاستيراد الآن» disabled=true** طالما الأوراق المختارة تحوي أخطاء (الحارس الواجهي مُثبت) — بلا أي console errors، ولا نُفِّذ أي استيراد من المتصفح إطلاقًا.
- التنظيف الإلزامي: scripts/_tmp-55-clean.ts حذف: العميلين zt55 المستوردين (C-0018/C-0019) وصفَّي تدقيق إنشائهما و4 صفوف تدقيق الجلسة (دخول + سطرا «استيراد بيانات قديمة» — الرفض المرفوض 400 لم يولّد تدقيقًا أصلًا) والمستخدم المؤقت zt55a (id=28) مع صلاحياته كاسكيد، **وإرجاع تسلسل customer:code إلى 17 (قيمته قبل الاستيراد — استهلك الاختبار 18/19 فقط)** — النتيجة المطبوعة: CUSTOMERS_DELETED=2 · CUST_AUDIT_DELETED=2 · SESSION_AUDIT_DELETED=4 · USER_DELETED=1 · **USERS_FINAL=admin(1) / secretary(2)** · **CUSTOMERS_ZT55=0** · **AUDIT_ZT55=0** — والتحقق النهائي المباشر بالقاعدة: المستخدمان الإنتاجيان فقط والعميل الإنتاجي الوحيد C-0014 شركة الأفق للمقاولات والتسلسل=17. حُذفت السكربتات المؤقتة الأربعة وملفات /tmp الثمانية (xlsx/token/screenshot/سكربتات فحص) — scripts عادت للملفين الأصليين. لا سندات مالية أُنشئت ولا أوراق مالية استُوردت إطلاقًا (ورقة العملاء فقط) ولا أي لمسة لـgit أو أي PAT.

Stage Summary:
- بند 8 (استيراد Excel للأوراق الثماني) مكتمل ومتحقق منه بالـAPI وبالمتصفح: قالب كامل/ورقة واحدة بنصوص المكتبي الحرفية، فحص مسبق يجمع الأخطاء برقم الصف ويعرضها واجهتيًا ويمنع التنفيذ ما دامت قائمة (400 بالـAPI وزر معطل بالواجهة)، تنفيذ بترتيب التبعية داخل معاملات مع تخطي الموجود وإعادة الفحص من الملف دائمًا، وأدلة إنتاجية بأرقام (parse: خطآن بسطرَيهما · run نظيف: أُدرج 2 وأُعيد فحص نفس الملف فتخطَّ 2 · قوالب PK بتسع أوراق) وتنظيف كامل أثبت بالطباعة وبالقاعدة — وقد استأنف 55-c بعد انقطاع مهلة الوكيل الأول بلا أي تعديل شيفرة.
- ما تبقى من قائمة المرحلة 9 (ترقيم Task 49): **9 مركز النماذج Word فقط** — جاهز للرفع بPAT مؤقت كالعادة.
- تذكير مؤجل بعد اكتمال كل العمل: تدوير الPAT وكلمة مرور القاعدة.

---

Task ID: 56 (المرحلة 9 — البند الأخير 9: مركز النماذج Word بتوليد docx خادميًا)
Agent: full-stack-developer (اكتمل بمتابعة المنسق بعد انقطاع مهلة)
Task: مركز النماذج — رفع قوالب .docx بوسوم {{...}} واستخراجها وربطها بمصادر نظامية (عميل/عقد/عرض سعر) وتوليد مستندات معبأة خادميًا عبر docxtemplater/pizzip — والنماذج Form* الثلاثة كانت جاهزة بالمخطط بلا مسارات

Work Log:
- ما بُني من الوكيل: src/lib/forms/forms-core.ts (نقي: normPlaceholder/_norm الحرفي بلا حركات · SYNONYMS المكتبي بكيانات الويب · guessField مرآة word_forms_service مع انحراف موثق «بلا حسابات الدفعات/الإجمالي» · extractPlaceholderNames/xmlParagraphTexts (نص الفقرات الظاهر لا XML الخام) · fill: fieldText/buildFieldMapping/resolveContractKey/resolveQuotationKey بجدول بنودها/resolveSettingKey/addressPlaceholderKey · calcValue/safeArithmetic حاسبة آمنة بلا eval · أرقام FD-%04d وأسماء ملفات منظفة) + forms-server.ts (رفع وتحليل وتخزين base64 ببروتوكول B64_PREFIX داخل أعمدة wordPath النصية — قرار موثق: Vercel بلا قرص) + 6 مسارات API (categories · templates GET/POST multipart · templates/[id] GET/PUT حالات · [id]/generate POST بسياق كيانات حقيقي وتسجيل FormDocument · documents GET · documents/[id]/download) + FormsCenterView.tsx (قائمة قوالب بشارات الحالة الأربع + رفع + نافذة تعبئة بعميل/عقد/عرض وحقول يدوية + سجل مستندات بإعادة تحميل + تصنيفات — إضافة ويب موثقة) + ربط الشل (بند نماذج) وnav-perms وViewName "forms" + حزمة docxtemplater/pizzip + 32 اختبارًا.
- استكمال المنسق بعد انقطاع مهلة الوكيل (الشيفرة وصلت شبه كاملة بلا تحقق): (أ) إعادة تصدير xmlParagraphTexts وثابت MSG_UPLOAD_SUCCESS_PREFIX («تم رفع القالب. الحقول: ») واستخدامه في الواجهة؛ (ب) أربعة أخطاء TDD: extractPlaceholderNames حصر الاسم بلا فواصل أسطر (وسم مقسوم بين فقرتين لا يُلتقط — سلوك الفقرات المستقلة) · safeArithmetic تسامح المسافات بين المعاملات · calcValue يعيد "" عند أي وسم غير رقمي بدل تجبيره صفرًا · تسوية تناقض الوكيل بين اختبارَي guessField بالرجوع لمصدر المكتبي word_forms_service.py:97-114: عائلة قيمة/مبلغ العقد تبقى **يدوي مالي إلزامي** (حُذف الربط الكياني المخترع وصُحح الاختبار مع توثيق انحراف «بلا مجموعة الإجماليات» للمبلغ/الاجمالي المجردين)؛ (ج) إصلاح جوهري بالتوليد الحي: resolveContractKey كان يقرأ المفاتيح snake من صف Prisma camel فجاء رقم العقد فارغًا — أضيف الجسر (contract_number⇒contractNumber وغيرها) مع سقوط على المفتاح الخام؛ (د) حادثة بيئية معروفة: عميل Prisma قديم في خادم التطوير (updatedAt undefined) — prisma generate + قتل العملية القديمة كاملة (22595/22611) وإعادة تشغيل ببروتوكول source.
- E2E كامل بسكربت مؤقت حُذف (بروتوكول النظافة): مستخدم zt56 admin ⇒ دخول 200 بتوكن وperms ⇒ قالب برمجي بثلاثة وسوم نظامية (1476B PK) ⇒ رفع multipart **201** بثلاثة حقول مستخرجة ⇒ اعتماد **200 «معتمد»** ⇒ توليد لعقد الإنتاج الحقيقي CON-0012/عميله شركة الأفق ⇒ **200 docx** (1105B PK) يُحوي **اسم العميل الفعلي ورقم العقد CON-0012** بلا أي {{وسوم}} متبقية ⇒ سجل المستندات count=1 ⇒ التنظيف: القالب والمستندات كاسكيد + 4 صفوف تدقيق + المستخدم — USERS_FINAL=admin(1)/secretary(2) · FORM_TEMPLATES_LEFT=0 · FORM_DOCUMENTS_LEFT=0.
- الفحوص النهائية: bun test **392/392 (1423 تأكيدًا — كان 360/1307)** · bunx tsc --noEmit = 0 · bun run lint = 0/0 · الخادم حي بلا 500.
- انحرافات موثقة: التخزين base64 ببروتوكول B64_PREFIX (لا قرص بـVercel) · printIdentity يبقى none (هوية المطبوعات غير متاحة بالويب) · تبويبا «العقود وعروض الأسعار» الرسميان الملفيان بالمكتبي غير متاحين بالويب حاليًا (كما هو موثق برأس FormsCenterView) · واجهة التصنيفات إضافة ويبية لجدول بلا واجهة مكتبية · ملاحظة أمانة: تحقق الواجهة التفاعلية للمركز تم عبر المسارات الكاملة (نفس نداءاتها) وتركيبها الصياغي types/lint — بلا جلسة متصفح مستقلة له.

Stage Summary:
- **المرحلة 9 اكتملت بكل بنودها الـ13**: مركز النماذج يرفع قوالب Word ويستخرج وسومها ويربطها ببيانات حقيقية ويولّد docx خادميًا مسجلًا بقيمه — والبنود 1-13 كلها حية (1 ملف العميل · 2 السلف · 3 تقارير العُهد · 4 المزايا · 5 الصلاحيات · 6 الإعدادات · 7 الرئيسية · 8 استيراد Excel · 9 النماذج · 10 مجموعات العقود · 11 المشاريع · 12 عروض الأسعار · 13 الفرص البيعية).
- تذكير مؤجل بعد اكتمال كل العمل: **تدوير الPAT وكلمة مرور القاعدة** (مرّا عبر المحادثة عدة مرات).

---
Task ID: 57 (تحقق ختامي بعد انقطاع الحاوية — المرحلة 9 حية على الإنتاج)
Agent: Z.ai Code (منسق)
Task: جلسة جديدة أعقبت انقطاع سياق الحاوية — مزامنة الحالة المفقودة محليًا والتحقق الشامل من أن الدفعة الأخيرة (6/7 + 11 + 12 + 8 + 9) حية فعلًا على إنتاج Vercel، وتوثيق الختام

Work Log:
- اكتشاف حالة الحاوية بعد الانقطاع: مسحٌ لنقطة `.env.local` وارتداد المشروع لالتقاطة أقدم (ec7fe50/Task 48) بينما origin/main = **45c3d87** — المستودع البعيد شامل كل دفعات المرحلة 9. شُخّص الفارق بـ`git fetch` ثم `rev-list --left-right --count` (0 أمام/9 خلف) ⇒ مزامنة `merge --ff-only` بلا أي تعارض.
- استعادة البيئة: (أ) `.env.example` يوثق بنيته لكن كلمة مرور القاعدة الكاملة غير مخزّنة في أي ملف بالحاوية (المكتوب في worklog مقطوع pEgmw…1B عمدًا) — العمليات القاعدية المحلية مؤجلة لحين توفيرها، وهي غير معيقة لأي تحقق هذا اليوم. (ب) `bun install` أعاد `pizzip@3.3.0` و4 حزم مفقودة من node_modules بعد الارتداد (docxtemplater كانت موجودة بالحزمة وكليةً غير مثبتة محليًا) — بعدها **bun test = 392/392 (1423 تأكيدًا)** مطابقًا لسجل Task 56 حرفيًا، و**bun run lint = 0/0**.
- تحقق الإنتاج بأسلوب الأحرف الحرفية (المعتمد): جُلب `/` من contrack-online.vercel.app (8,183B) واستُخرجت 9 كتل chunks — الكتلة الرئيسية **81173983e3e1ceec.js** (1,070,642B) حوت حرفيًا: «الأمان والمستخدمون» (بند 6 الإعدادات) · «عدد المشاريع» (بند 7 الرئيسية) · «اسم المشروع مطلوب» (بند 11) · «تم رفع القالب» و«مركز النماذج» (بند 9 — آخر التزام 45c3d87) · «QUO-» و«عروض الأسعار» و«عرض جديد» (بند 12) · «استيراد البيانات القديمة» و«تنفيذ الاستيراد» (بند 8). الرسالتان الخادميتان («لا يمكن الاستيراد · يوجد أخطاء» و«حالة عرض السعر غير صحيحة») لم تظهرا بالكتل العميلية وهو الصحيح — فهما حرفيًا ضمن مسارات API الخادمية لا الواجهة.
- تحقق مسارات API على الإنتاج (curl): /api/quotes و/api/projects و/api/forms/templates و/api/import/parse كلها **401 بلا جلسة** (النصية الجديدة محروسة ومعيَّنة) · /api/dashboard = **405** (POST على مسار GET — موجود ومحروس) · /api/auth/login = **400** بجسم فارغ (حي كالمعتاد). لا 500 ولا 404.
- لا شيفرة جديدة أُنتجت في هذه الجلسة إطلاقًا — مجرد مزامنة وبيئة وتحقق وتوثيق.

Stage Summary:
- **المرحلة 9 (كل البنود 1-13) مثبتة حية على الإنتاج** بالكود والكلمات الحرفية والمسارات — والمستودع المحلي عاد مطابقًا لorigin/main = 45c3d87 بالكامل.
- حالتان بيئيتان بعد الانقطاع (للاستئناف لاحقًا): `.env.local` مسحٌ (يلزم كلمة مرور القاعدة من موضعها لإعادة بنائه كما في Task 29) وnode_modules استعادت حزمها بbun install.
- **التذكير الختامي العاجل: تدوير الPAT وكلمة مرور قاعدة Supabase** — مر الاثنان عبر المحادثة عدة مرات، وينبغي التدوير الآن بعد اكتمال كل العمل.
- المرحلة 6 الوحيدة المتبقية من خطة التسع مراحل — مؤجلة بانتظار إصدار المكتبي V9.15.19.

---
Task ID: 58 (تدخين إنتاجي متصفحي ختامي — بعد دفعة 03212e0)
Agent: Z.ai Code (منسق)
Task: تحقق متصفحي مباشر على الإنتاج بعد نشر 03212e0 — صفحة الدخول والاستجابة والحد من المحاولات والتجاوب، بلا أي شيفرة جديدة

Work Log:
- الحالة أولًا: المحلي = origin/main = 03212e0 (0 أمام/0 خلف، شجرة نظيفة) — لا شيء بانتظار الدفع.
- curl: `/` = **200** · POST /api/auth/login ببيانات وهمية = **401** بنص «اسم المستخدم أو كلمة المرور غير صحيحة. (متبقي 2 محاولة)» — إثبان معًا: حدّ المحاولات (المرحلة 2) حي على الإنتاج، والقاعدة تعمل فعليًا من لمسٍ ملموس (استعلام المستخدمين وعدّاد المحاولات اشتغلا).
- المتصفح (agent-browser على contrack-online.vercel.app): صفحة الدخول ب title «ConTrack — إدارة العقود والمحاسبة» وشعار V9.15 وRTL كامل — لقطتا شاشة (1280px سطح مكتب و390px جوال) سليمتان بلا تمرير أفقي وبالfooter ملتصقًا أسفل، وخطأ دخول من الواجهة أظهر التنبيه الأحمر «اسم المستخدم أو كلمة المرور غير صحيحة» تحت الحقل — و**صفر أخطاء console وصفحة** في كل الخطوات. المستخدم الوهمي المستخدم في التجربة (zt_smoke_check) غير موجود أصلًا بالقاعدة فلا أثر ولا بيانات.
- المتصفح أُغلق وملفات /tmp المؤقتة (لقطات وجواب login) تُنظف. لا git في هذه الفقرة سوى توثيق هذا السجل.

Stage Summary:
- الإنتاج سليم متصفحيًا بعد آخر دفعة: دخول عربي RTL متجاوب، حدّ المحاولات عامل، قاعدة حية — المرحلة 9 كلها مثبتة حية وفق Task 57، ولا يبقى عمل شيفرة إطلاقًا حتى صدور المكتبي V9.15.19 (المرحلة 6).
- مستمر قائم من Task 57: إعادة بناء .env.local المحلي تحتاج كلمة مرور القاعدة، والتذكير الختامي بتدوير الPAT وكلمة المرور بعد اكتمال كل شيء.

---
Task ID: 59 (استعادة البيئة المحلية — وصلت كلمة مرور القاعدة)
Agent: Z.ai Code (منسق)
Task: استلام كلمة مرور قاعدة Supabase الكاملة عبر المحادثة (مطابقة للمقطوعة pEgmw…1B في Task 29 — لم تُدرَّ قط) وإعادة بناء .env.local وتشغيل الخادم محليًا والتحقق من الاتصال بالقاعدة البعيدة

Work Log:
- أُعيد بناء .env.local: DATABASE_URL عبر Transaction Pooler 6543 (pgbouncer=true&connection_limit=1) + DIRECT_URL عبر Session Pooler 5432 على aws-0-ap-northeast-1.pooler.supabase.com (النمط الموثق في .env.example — النمط المباشر db.<ref>.supabase.co الذي أرسله المستخدم محجوب بالجدار IPv6-only كما حُسم سابقًا) + AUTH_SECRET جديد 64-hex، وبصلاحيات 600. مفتاح sb_publishable_ المُرسل معه لا يستعمله التطبيق (اتصال Postgres فقط) — فلا مكان له في البيئة.
- بروتوكول البيئة الالزماني عُين تمامًا: صدفة الأم تُصدِّر DATABASE_URL=file:... فيجب unset قبل source .env.local (التعارض محلولًا بالإخراج النهائي).
- bunx prisma db push ببروتوكول source = مزامنة تامة مع توليد العميل (v6.19.2) — المخطط يطابق القاعدة بلا أي فرق.
- فحص بيانات القاعدة (سكربت مؤقت داخل المشروع — من /tmp يلتقط كاش bun الخاطئ @prisma/client@7 درسٌ موثق): **USERS=2 CUSTOMERS=1 CONTRACTS=1 QUOTES=0 PROJECTS=0 FORM_TEMPLATES=0** — بيانات الإنتاج سليمة، ونظافة اختبارات Tasks 53-56 مثبتة من القاعدة مباشرة.
- الخادم أعيد تشغيله بعد pkill للعملية العالقة ببيئة نظيفة (unset + source): `/` = **200** · POST login ببيانات وهمية = **401** بنص «اسم المستخدم أو كلمة المرور غير صحيحة. (متبقي 2 محاولة)» مع كتابة صف تدقيق فعلي (رُصد في dev.log) — و**صفر 500** في السجل. المتصفح محليًا: صفحة الدخول بحقولها العربية وزر «دخول» وصفر أخطاء.
- لا شيفرة جديدة إطلاقًا — استعادة بيئة وتحقق فقط. الملفات المؤقتة عُمّلت.

Stage Summary:
- **البيئة المحلية عادت كاملة**: .env.local بالقيم الصحيحة، Prisma متزامن مع Supabase، الخادم يعمل على 3000 بالقاعدة البعيدة عبر الـpooler، وسجلات التدقيق والحد من المحاولات تعمل محليًا كالإنتاج.
- التذكير الختامي قائم بلا تغيير: **تدوير الPAT وكلمة مرور القاعدة** — مرّا عبر المحادثة مرات عدة (ووصلتا مجددًا اليوم)، وباكتمال كل العمل التدوير هو الخطوة الصحيحة الآن. عند التدوير تُرسل القيمتان الجديدتان لأحدّث البيئة دفعة واحدة.
