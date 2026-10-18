# -*- coding: utf-8 -*-
"""معالج استيراد البيانات القديمة من Excel · 3 خطوات واضحة.

1) تنزيل القالب وإعطاؤه للعميل
2) اختيار الملف المعبأ ← فحص تلقائي يعرض الأخطاء بوضوح
3) تنفيذ الاستيراد بعد خلو الملف من الأخطاء

إضافة: «الخطوة صفر» لتأسيس أنواع العقود ومراحلها ودفعاتها من قالب
مستقل قبل رفع بيانات العملاء والعقود — حتى لا تدخل العقود تحت
«غير محدد» بمراحل غير صحيحة.
"""
import os

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QDialog, QFileDialog, QHBoxLayout, QLabel, QListWidget, QListWidgetItem,
    QPushButton, QVBoxLayout, QFrame,
)

from services.customer_service import ValidationError
from ui import style
from ui.style import soft_shadow


class ImportWizardDialog(QDialog):
    """نافذة الاستيراد الكاملة."""

    def __init__(self, parent=None):
        super().__init__(parent)
        style.ensure_light_background(self)
        self.setWindowTitle("استيراد البيانات القديمة من Excel")
        self.setLayoutDirection(Qt.RightToLeft)
        style.fit_window(self, 760, 640, min_w=620, min_h=460)
        self._parsed = None

        layout = QVBoxLayout(self)
        layout.setContentsMargins(24, 20, 24, 20)
        layout.setSpacing(14)

        title = QLabel("📥 استيراد البيانات القديمة")
        title.setProperty("pageTitle", True)
        layout.addWidget(title)

        # ===== الخطوة صفر: تأسيس أنواع العقود والمراحل والدفعات =====
        # تُنفَّذ قبل رفع بيانات العملاء والعقود حتى تكون الأنواع
        # ومراحلها ودفعاتها جاهزة، فلا يقع أي عقد تحت «غير محدد».
        step0 = QFrame()
        step0.setProperty("card", True)
        s0 = QVBoxLayout(step0)
        s0.setContentsMargins(18, 14, 18, 14)
        s0.setSpacing(8)
        lbl0 = QLabel(
            "<b>الخطوة صفر (تُنفَّذ أولاً):</b> أسّس أنواع العقود ومراحلها "
            "ودفعاتها · بدونها تدخل العقود تحت «غير محدد» بمراحل غير صحيحة")
        lbl0.setWordWrap(True)
        s0.addWidget(lbl0)
        s0row = QHBoxLayout()
        types_template_btn = QPushButton("⬇ تنزيل قالب الأنواع والمراحل والدفعات")
        types_template_btn.clicked.connect(self._download_types_template)
        self.types_upload_btn = QPushButton(
            "رفع أنواع العقود والمراحل والدفعات من Excel")
        self.types_upload_btn.setObjectName("btnPrimary")
        self.types_upload_btn.clicked.connect(self._upload_types_template)
        s0row.addWidget(types_template_btn)
        s0row.addWidget(self.types_upload_btn)
        s0row.addStretch()
        s0.addLayout(s0row)
        layout.addWidget(step0)

        # ===== أداة الإصلاح: عقود دخلت سابقًا تحت «غير محدد» =====
        stepfix = QFrame()
        stepfix.setProperty("card", True)
        sf = QHBoxLayout(stepfix)
        sf.setContentsMargins(18, 14, 18, 14)
        lblfix = QLabel(
            "<b>إصلاح ما سبق:</b> عقود رُفعت سابقًا بلا نوع ودخلت تحت "
            "«غير محدد» · راجعها وحدّد نوعها الصحيح")
        lblfix.setWordWrap(True)
        self.fix_btn = QPushButton("🔧 إصلاح عقود غير محدد")
        self.fix_btn.clicked.connect(self._open_fix_unspecified)
        sf.addWidget(lblfix, 1)
        sf.addWidget(self.fix_btn)
        layout.addWidget(stepfix)

        # ===== الخطوة 1: القالب =====
        step1 = QFrame()
        step1.setProperty("card", True)
        s1 = QHBoxLayout(step1)
        s1.setContentsMargins(18, 14, 18, 14)
        lbl1 = QLabel("<b>الخطوة ١:</b> نزّل القالب وسلّمه للعميل ليملأه "
                      "ببياناته (عملاء، عقود، مقاولون، دفعات)")
        lbl1.setWordWrap(True)
        template_btn = QPushButton("⬇ تنزيل القالب")
        template_btn.clicked.connect(self._download_template)
        expense_template_btn = QPushButton("⬇ تنزيل قالب المصروفات")
        expense_template_btn.setToolTip(
            "ينزّل قالب سندات الصرف فارغًا لتعبئته")
        expense_template_btn.clicked.connect(self._download_expenses_template)
        # زر الرفع: كان الزران كلاهما ينزّلان القالب، فلا توجد وسيلة
        # لرفع ملف المصروفات بعد تعبئته.
        expense_upload_btn = QPushButton("⬆ رفع ملف المصروفات")
        expense_upload_btn.setObjectName("btnPrimary")
        expense_upload_btn.setToolTip(
            "اختر ملف المصروفات المعبّأ · يُفحص أولًا ثم يُدخل بعد تأكيدك")
        expense_upload_btn.clicked.connect(self._upload_expenses_file)
        s1.addWidget(lbl1, 1)
        s1.addWidget(expense_template_btn)
        s1.addWidget(expense_upload_btn)
        s1.addWidget(template_btn)
        layout.addWidget(step1)

        # ===== الخطوة 2: الفحص =====
        step2 = QFrame()
        step2.setProperty("card", True)
        s2 = QHBoxLayout(step2)
        s2.setContentsMargins(18, 14, 18, 14)
        lbl2 = QLabel("<b>الخطوة ٢:</b> اختر الملف المعبأ · سيُفحص بالكامل "
                      "وتُعرض أي أخطاء قبل إدخال أي شيء")
        lbl2.setWordWrap(True)
        pick_btn = QPushButton("اختيار الملف وفحصه")
        pick_btn.clicked.connect(self._pick_and_check)
        s2.addWidget(lbl2, 1)
        s2.addWidget(pick_btn)
        layout.addWidget(step2)

        # ===== نتائج الفحص =====
        self.summary_lbl = QLabel("لم يُفحص أي ملف بعد.")
        self.summary_lbl.setProperty("sectionTitle", True)
        layout.addWidget(self.summary_lbl)

        self.results = QListWidget()
        soft_shadow(self.results, radius=24, y=5)
        layout.addWidget(self.results, 1)

        # ===== الخطوة 3: التنفيذ =====
        bottom = QHBoxLayout()
        self.import_btn = QPushButton("📥 تنفيذ الاستيراد الآن")
        self.import_btn.setObjectName("btnPrimary")
        self.import_btn.setEnabled(False)
        self.import_btn.clicked.connect(self._execute)
        close_btn = QPushButton("✕ إغلاق")
        close_btn.setProperty("flat", True)
        close_btn.clicked.connect(self.reject)
        bottom.addWidget(self.import_btn)
        bottom.addStretch()
        bottom.addWidget(close_btn)
        layout.addLayout(bottom)

    # ---------- الخطوة 1 ----------
    def _download_template(self):
        from services.import_service import generate_template
        default = os.path.join(os.path.expanduser("~"),
                               "قالب_البيانات_القديمة.xlsx")
        path, _ = QFileDialog.getSaveFileName(
            self, "حفظ القالب", default, "Excel (*.xlsx)")
        if not path:
            return
        try:
            generate_template(path)
            style.info(self, f"تم إنشاء القالب:\n{path}\n\n"
                       "سلّمه للعميل مع تنبيهه بقراءة ورقة «اقرأني أولاً».",
                       "تم")
            from ui.invoices import open_file_externally
            open_file_externally(path)
        except Exception:
            style.error(self, "تعذر إنشاء القالب.")

    def _upload_expenses_file(self):
        """رفع ملف المصروفات المعبّأ: فحص ثم إدخال بعد تأكيد صريح.

        يستخدم نفس محرك الفحص (parse_excel) والإدخال (execute_import)،
        فورقة «سندات الصرف» تُقرأ والأوراق الأخرى الغائبة تُتخطى بتنبيه
        لا بخطأ. لا يُدخل أي شيء قبل خلو الملف من الأخطاء وموافقتك.
        """
        from services.import_service import parse_excel, execute_import
        path, _ = QFileDialog.getOpenFileName(
            self, "اختيار ملف المصروفات المعبأ", "", "Excel (*.xlsx)")
        if not path:
            return
        self.results.clear()
        try:
            parsed = parse_excel(path)
        except ValidationError as exc:
            style.error(self, str(exc))
            return
        except Exception:
            style.error(self, "تعذر قراءة الملف · تأكد أنه بنفس بنية القالب.")
            return

        counts = parsed["counts"]
        errors = parsed["errors"]
        n_exp = counts.get("expenses", 0)
        # أظهر نتيجة الفحص في نفس قائمة النتائج
        self.summary_lbl.setText(
            f"فحص ملف المصروفات:  📤 {n_exp} سند صرف  —  "
            f"أخطاء: {len(errors)}  |  تنبيهات: {len(parsed['warnings'])}")
        if not errors and not parsed["warnings"]:
            item = QListWidgetItem("✅ الملف سليم · جاهز للرفع")
            item.setForeground(QColor(style.GREEN))
            self.results.addItem(item)
        for w in parsed["warnings"]:
            item = QListWidgetItem(f"⚠ {w}")
            item.setForeground(QColor(style.WARN))
            self.results.addItem(item)
        for e in errors:
            item = QListWidgetItem(f"❌ {e}")
            item.setForeground(QColor(style.RED))
            self.results.addItem(item)
        if errors:
            item = QListWidgetItem(
                "🛑 صحح الأخطاء أعلاه ثم أعد المحاولة · لم يُدخل أي شيء.")
            item.setForeground(QColor(style.RED))
            self.results.addItem(item)
            return
        if not n_exp:
            style.info(self, "لا توجد سندات صرف في هذا الملف.",
                       "لا يوجد ما يُرفع")
            return
        if not style.confirm(
                self,
                f"سيتم إدخال {n_exp} سند صرف.\n\n"
                "يُنصح بأخذ نسخة احتياطية قبل المتابعة.\nهل أنت متأكد؟",
                "رفع ملف المصروفات"):
            return
        try:
            stats = execute_import(parsed)
        except (ValidationError, Exception) as exc:
            style.error(self, f"توقف الرفع: {exc}")
            return
        msg = (f"تم رفع المصروفات ✅\n\n"
               f"• سندات صرف جديدة: {stats.get('expenses', 0)}")
        if stats.get("skipped_expenses"):
            msg += f"\n• تم تخطي {stats['skipped_expenses']} موجود مسبقًا"
        over = stats.get("overpaid") or []
        if over:
            msg += (f"\n\n⚠ {len(over)} سند تجاوز المتبقي وسُجّل كدفعة "
                    "مقدمة (راجعها).")
            for line in over:
                it = QListWidgetItem(f"⚠ {line}")
                it.setForeground(QColor(style.WARN))
                self.results.addItem(it)
        style.info(self, msg, "اكتمل رفع المصروفات")

    def _download_expenses_template(self):
        from services.import_service import generate_expenses_template
        default = os.path.join(os.path.expanduser("~"),
                               "قالب_رفع_المصروفات_فقط.xlsx")
        path, _ = QFileDialog.getSaveFileName(
            self, "حفظ قالب المصروفات", default, "Excel (*.xlsx)")
        if not path:
            return
        try:
            generate_expenses_template(path)
            style.info(self, f"تم إنشاء قالب المصروفات فقط:\n{path}", "تم")
            from ui.invoices import open_file_externally
            open_file_externally(path)
        except Exception:
            style.error(self, "تعذر إنشاء قالب المصروفات.")

    # ---------- الخطوة صفر: الأنواع والمراحل والدفعات ----------
    def _download_types_template(self):
        """حفظ قالب تأسيس الأنواع والمراحل والدفعات وفتحه للمستخدم."""
        from services.types_setup_service import (TEMPLATE_FILENAME,
                                                  generate_types_template)
        default = os.path.join(os.path.expanduser("~"), TEMPLATE_FILENAME)
        path, _ = QFileDialog.getSaveFileName(
            self, "حفظ قالب الأنواع والمراحل والدفعات", default,
            "Excel (*.xlsx)")
        if not path:
            return
        try:
            generate_types_template(path)
            style.info(self, f"تم إنشاء القالب:\n{path}\n\n"
                       "اقرأ ورقة «اقرأني أولاً» قبل التعبئة.", "تم")
            from ui.invoices import open_file_externally
            open_file_externally(path)
        except Exception:
            style.error(self, "تعذر إنشاء قالب الأنواع والمراحل والدفعات.")

    def _upload_types_template(self):
        """فحص قالب الأنواع ثم تنفيذ الرفع بعد موافقة صريحة.

        الرفع «إضافة فقط»: لا يحذف ولا يعدّل أي نوع أو مرحلة أو دفعة
        موجودة مسبقًا؛ الموجود يُتخطّى ويُذكر في تقرير النتيجة.
        """
        from services.types_setup_service import (TemplateError,
                                                  execute_template,
                                                  read_template)
        path, _ = QFileDialog.getOpenFileName(
            self, "اختيار قالب الأنواع والمراحل والدفعات", "",
            "Excel (*.xlsx)")
        if not path:
            return
        self.results.clear()
        try:
            parsed = read_template(path)
        except TemplateError as exc:
            style.error(self, str(exc))
            return
        except Exception:
            style.error(self, "تعذر قراءة الملف · تأكد أنه بنفس بنية القالب.")
            return

        counts = parsed["counts"]
        errors = parsed["errors"]
        warnings = parsed["warnings"]
        self.summary_lbl.setText(
            f"فحص قالب الأنواع:  🏷 {counts['types']} نوع  |  "
            f"🧩 {counts['stages']} مرحلة  |  "
            f"💰 {counts['payments']} دفعة  —  "
            f"أخطاء: {len(errors)}  |  تنبيهات: {len(warnings)}")

        if not errors and not warnings:
            item = QListWidgetItem("✅ القالب سليم تمامًا · جاهز للرفع")
            item.setForeground(QColor(style.GREEN))
            self.results.addItem(item)
        for w in warnings:
            item = QListWidgetItem(f"⚠ {w}")
            item.setForeground(QColor(style.WARN))
            self.results.addItem(item)
        for e in errors:
            item = QListWidgetItem(f"❌ {e}")
            item.setForeground(QColor(style.RED))
            self.results.addItem(item)

        if errors:
            item = QListWidgetItem(
                "🛑 صحح الأخطاء أعلاه في ملف الإكسل ثم أعد المحاولة · "
                "لم يُدخل أي شيء.")
            item.setForeground(QColor(style.RED))
            self.results.addItem(item)
            return

        if not style.confirm(
                self,
                "سيتم الآن إنشاء غير الموجود فقط:\n"
                f"• {counts['types']} نوع عقد\n"
                f"• {counts['stages']} مرحلة\n"
                f"• {counts['payments']} دفعة\n\n"
                "لن يُحذف أو يُعدَّل أي نوع أو مرحلة أو دفعة موجودة "
                "مسبقًا · الموجود سيُتخطى.\n\n"
                "يُنصح بأخذ نسخة احتياطية قبل المتابعة.\nهل أنت متأكد؟",
                "رفع الأنواع والمراحل والدفعات"):
            return
        try:
            stats = execute_template(parsed)
        except TemplateError as exc:
            style.error(self, str(exc))
            return
        except Exception as exc:
            style.error(self, f"توقف الرفع: {exc}")
            return

        msg = ("تم الرفع بنجاح! 🎉\n\n"
               f"• أنواع عقود جديدة: {stats['types_added']}"
               + (f" (تم تخطي {stats['types_skipped']} موجود مسبقًا)"
                  if stats['types_skipped'] else "") + "\n"
               f"• مراحل جديدة: {stats['stages_added']}"
               + (f" (تم تخطي {stats['stages_skipped']} موجودة مسبقًا)"
                  if stats['stages_skipped'] else "") + "\n"
               f"• دفعات جديدة: {stats['payments_added']}"
               + (f" (تم تخطي {stats['payments_skipped']} موجودة مسبقًا)"
                  if stats['payments_skipped'] else "")
               + (f"\n• منها {stats['payments_no_stage']} دفعة بلا مرحلة "
                  "(مقبولة حسب قاعدة الاستثناء)"
                  if stats['payments_no_stage'] else ""))
        if stats["problems"]:
            msg += ("\n\n⚠ صفوف لم تُنفَّذ:\n- "
                    + "\n- ".join(stats["problems"][:15]))
            if len(stats["problems"]) > 15:
                msg += f"\n… و{len(stats['problems']) - 15} غيرها"
        for p in stats["problems"]:
            item = QListWidgetItem(f"⚠ {p}")
            item.setForeground(QColor(style.WARN))
            self.results.addItem(item)
        style.info(self, msg, "اكتمل رفع الأنواع والمراحل والدفعات")

    # ---------- أداة إصلاح عقود «غير محدد» ----------
    def _open_fix_unspecified(self):
        """يفتح شاشة مراجعة عقود «غير محدد» · لا تنفّذ شيئًا بنفسها."""
        from ui.fix_unspecified import FixUnspecifiedDialog
        try:
            dlg = FixUnspecifiedDialog(self)
        except Exception as exc:
            style.error(self, f"تعذّر فتح شاشة الإصلاح: {exc}")
            return
        dlg.exec()

    # ---------- الخطوة 2 ----------
    def _pick_and_check(self):
        from services.import_service import parse_excel
        path, _ = QFileDialog.getOpenFileName(
            self, "اختيار ملف البيانات المعبأ", "", "Excel (*.xlsx)")
        if not path:
            return
        self.results.clear()
        self._parsed = None
        self.import_btn.setEnabled(False)
        try:
            parsed = parse_excel(path)
        except ValidationError as exc:
            style.error(self, str(exc))
            return
        except Exception:
            style.error(self, "تعذر قراءة الملف، تأكد أنه بنفس بنية القالب.")
            return

        counts = parsed["counts"]
        errors = parsed["errors"]
        warnings = parsed["warnings"]

        # الملخص
        sup_n = counts.get("sup_contracts", 0)
        sc_n = counts.get("sub_contracts", 0)
        ex_n = counts.get("expenses", 0)
        self.summary_lbl.setText(
            f"نتيجة الفحص:  👥 {counts['customers']} عميل  |  "
            f"📑 {counts['contracts']} عقد  |  "
            + (f"🏗 {sup_n} عقد إشراف  |  " if sup_n else "")
            + f"👷 {counts['subs']} مقاول  |  "
            + (f"🔗 {sc_n} عقد باطن  |  " if sc_n else "")
            + f"📥 {counts['payments']} دفعة  "
            + (f"|  📤 {ex_n} سند صرف  " if ex_n else "")
            + f"—  أخطاء: {len(errors)}  |  تنبيهات: {len(warnings)}")

        # القائمة
        if not errors and not warnings:
            item = QListWidgetItem("✅ الملف سليم تمامًا · جاهز للاستيراد")
            item.setForeground(QColor(style.GREEN))
            self.results.addItem(item)
        for w in warnings:
            item = QListWidgetItem(f"⚠ {w}")
            item.setForeground(QColor(style.WARN))
            self.results.addItem(item)
        for e in errors:
            item = QListWidgetItem(f"❌ {e}")
            item.setForeground(QColor(style.RED))
            self.results.addItem(item)

        if errors:
            item = QListWidgetItem(
                "🛑 صحح الأخطاء أعلاه في ملف الإكسل ثم أعد الفحص · "
                "لن يُدخل أي شيء قبل ذلك.")
            item.setForeground(QColor(style.RED))
            self.results.addItem(item)
        else:
            self._parsed = parsed
            self.import_btn.setEnabled(True)

    # ---------- الخطوة 3 ----------
    def _execute(self):
        from services.import_service import execute_import
        if not self._parsed:
            return
        counts = self._parsed["counts"]
        sup_line = (f"• {counts.get('sup_contracts', 0)} عقد إشراف هندسي\n"
                    if counts.get("sup_contracts") else "")
        sc_line = (f"• {counts.get('sub_contracts', 0)} عقد باطن\n"
                   if counts.get("sub_contracts") else "")
        ex_line = (f"• {counts.get('expenses', 0)} سند صرف "
                   "(دفعات مقاولين ومصروفات)\n"
                   if counts.get("expenses") else "")
        if not style.confirm(
                self,
                "سيتم الآن إدخال:\n"
                f"• {counts['customers']} عميل\n"
                f"• {counts['contracts']} عقد\n"
                + sup_line +
                f"• {counts['subs']} مقاول باطن\n"
                + sc_line +
                f"• {counts['payments']} سند قبض / دفعة\n"
                + ex_line +
                "\nيُنصح بأخذ نسخة احتياطية قبل المتابعة.\nهل أنت متأكد؟",
                "تنفيذ الاستيراد"):
            return
        try:
            stats = execute_import(self._parsed)
        except (ValidationError, Exception) as exc:
            style.error(self, f"توقف الاستيراد: {exc}")
            return
        msg = (f"تم الاستيراد بنجاح! 🎉\n\n"
               f"• عملاء جدد: {stats['customers']}"
               + (f" (تم تخطي {stats['skipped_customers']} موجود مسبقًا)"
                  if stats['skipped_customers'] else "") + "\n"
               f"• عقود جديدة: {stats['contracts']}"
               + (f" (تم تخطي {stats.get('skipped_contracts', 0)} موجود مسبقًا)" if stats.get('skipped_contracts') else "") + "\n"
               + (f"• عقود إشراف جديدة: {stats.get('sup_contracts', 0)}\n"
                  if stats.get("sup_contracts") else "")
               + f"• مقاولو باطن: {stats['subs']}"
               + (f" (تم تخطي {stats['skipped_subs']})"
                  if stats['skipped_subs'] else "") + "\n"
               f"• سندات قبض / دفعات: {stats['payments']}"
               + (f" (تم تخطي {stats.get('skipped_payments', 0)} موجود مسبقًا)" if stats.get('skipped_payments') else "")
               + (f"\n• عقود باطن: {stats.get('sub_contracts', 0)}"
                  if stats.get("sub_contracts") else "")
               + (f"\n• سندات صرف: {stats.get('expenses', 0)}"
                  if stats.get("expenses") else "")
               + (f" (تم تخطي {stats.get('skipped_expenses', 0)} موجود مسبقًا)"
                  if stats.get("skipped_expenses") else ""))
        # سندات تجاوزت المتبقي وسُجّلت كدفعة مقدمة — تُعرض للمراجعة
        overpaid = stats.get("overpaid") or []
        if overpaid:
            msg += (f"\n\n⚠ {len(overpaid)} سند تجاوز المتبقي على عقده "
                    "وسُجّل كدفعة مقدمة (لم يتوقف الاستيراد):\n- "
                    + "\n- ".join(overpaid[:12]))
            if len(overpaid) > 12:
                msg += f"\n… و{len(overpaid) - 12} غيرها"
            msg += ("\n\nراجع قيمة هذه العقود أو تحقق من تكرار السندات.")
            for line in overpaid:
                item = QListWidgetItem(f"⚠ {line}")
                item.setForeground(QColor(style.WARN))
                self.results.addItem(item)
        style.info(self, msg, "اكتمل الاستيراد")
        self.accept()
