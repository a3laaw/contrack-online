# -*- coding: utf-8 -*-
"""مركز العقد · Contract Hub: كل شيء عن العقد في شاشة داخلية واحدة.

تبويبات مختصرة: نظرة عامة | الأوامر التغييرية | مقاولو الباطن | المستندات
"""
import os

from PySide6.QtCore import QDate, Qt, QTimer, Signal
from PySide6.QtGui import QColor, QFont
from PySide6.QtWidgets import (
    QBoxLayout, QComboBox, QDateEdit, QDialog, QDoubleSpinBox, QFormLayout, QFrame,
    QGridLayout, QHBoxLayout, QHeaderView, QLabel, QLineEdit, QListWidget,
    QListWidgetItem, QProgressBar, QPushButton, QScrollArea, QSpinBox,
    QStyledItemDelegate, QTableWidget, QTableWidgetItem, QTabWidget, QTextEdit,
    QTreeWidget, QTreeWidgetItem, QVBoxLayout, QWidget,
)

from services.db_facade_service import DatabaseError
from services import lifecycle_service as lc
from services import contract_service, invoice_service, settings_service
from services.customer_service import ValidationError
from ui import style
from ui.style import soft_shadow
from ui.widgets import SearchableComboBox, SafeDoubleSpinBox, SafeDateEdit, make_searchable

# ألوان الحالات مصدرها الوحيد ui/style.py (القاعدة 26) — لا تُعرَّف هنا
STATUS_COLORS = style.STATUS_COLORS


# الشارة الموحدة في ui.widgets.status_badge (يستخدمها رأس العقد) —
# نُسخة _badge/_rgba/_darken المكررة حُذفت (الدفعة 4: صفر مراجع).


def _make_table(headers: list[str]) -> QTableWidget:
    t = QTableWidget(0, len(headers))
    t.setHorizontalHeaderLabels(headers)
    t.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
    t.verticalHeader().setVisible(False)
    t.verticalHeader().setDefaultSectionSize(40)
    t.setSelectionBehavior(QTableWidget.SelectRows)
    t.setSelectionMode(QTableWidget.SingleSelection)
    t.setEditTriggers(QTableWidget.NoEditTriggers)
    t.setAlternatingRowColors(True)
    t.setShowGrid(True)
    return t


class ContractHubPage(QWidget):
    """الشاشة المركزية للعقد كصفحة داخلية (بدلاً من نافذة منبثقة)."""
    back_requested = Signal()  # إشارة للرجوع للصفحة السابقة
    data_changed = Signal()    # إشارة لتحديث البيانات عند التعديل

    def __init__(self, parent=None, embedded: bool = False):
        super().__init__(parent)
        self.embedded = embedded
        self.contract_id = None
        self._ctx: dict = {}
        self._dirty: dict[str, bool] = {}
        self.setLayoutDirection(Qt.RightToLeft)
        # تمت إزالة style.fit_window و style.center_on_screen لأن الصفحة تأخذ حجم النافذة الرئيسية

        root = QVBoxLayout(self)
        root.setContentsMargins(12, 8, 12, 8)
        root.setSpacing(8)

        # ===== شريط علوي: زر رجوع + عنوان =====
        top_bar = QHBoxLayout()
        
        back_btn = QPushButton("← رجوع")
        back_btn.setToolTip("رجوع للصفحة السابقة")
        back_btn.setProperty("flat", True)
        back_btn.setCursor(Qt.PointingHandCursor)
        back_btn.clicked.connect(self.back_requested.emit)
        top_bar.addWidget(back_btn)
        
        title = QLabel("مركز العقد")
        title.setProperty("pageTitle", True)
        top_bar.addWidget(title)
        top_bar.addStretch()
        from services import feature_service as _feat_gaps
        if _feat_gaps.enabled("contract_gaps"):
            gaps_btn = QPushButton("⚠️ الفروقات")
            gaps_btn.setToolTip("عقود تختلف قيمتها عن خطتها/بنودها")
            gaps_btn.setProperty("flat", True)
            gaps_btn.setCursor(Qt.PointingHandCursor)
            gaps_btn.clicked.connect(self._open_gaps)
            top_bar.addWidget(gaps_btn)
        self.top_bar = QWidget(self)
        self.top_bar.setObjectName("transparentHost")
        self.top_bar.setLayout(top_bar)
        self.top_bar.setVisible(not embedded)
        root.addWidget(self.top_bar)

        # ===== الرأس الموحّد =====
        from ui.widgets import ActionBar, EntityHeader, PageNav
        self.header = EntityHeader(self, icon="▤")
        self.customer_btn = self.header.add_button(
            "◉ ملف العميل", self._open_customer_file,
            tooltip="فتح ملف العميل صاحب هذا العقد")
        # داخل ملف العميل الموحد لا نعرض زر «ملف العميل» لأنه نفس السياق.
        self.customer_btn.setVisible(not embedded)
        self.header.setVisible(not embedded)
        root.addWidget(self.header)

        # ===== الصفحات =====
        from PySide6.QtWidgets import QStackedWidget
        self.stack = QStackedWidget()
        from services import feature_service as _feat
        # ترشيد التابات: النماذج والمرفقات أصبحت في «عام» بملف العميل؛
        # هنا نُبقي تفاصيل العقد العملية فقط.
        _all_pages = [
            ("stages", self._tab_stages, ""),
            ("info", self._tab_dashboard, ""),
            ("pay", self._tab_pay, ""),
            ("addendums", self._tab_addendums, "addendums"),
        ]
        pages = [(key, builder()) for key, builder, feat in _all_pages
                 if not feat or _feat.enabled(feat)]
        self._enabled_keys = {key for key, _w in pages}
        self._page_index = {}
        for i, (key, widget) in enumerate(pages):
            self.stack.addWidget(widget)
            self._page_index[key] = i

        def _grp(title, items):
            kept = [(k, t) for k, t in items if k in self._enabled_keys]
            return (title, "", kept) if kept else None

        _nav_groups = [
            _grp("مراحل التنفيذ", [("stages", "المسار الفني")]),
            _grp("ملخص العقد", [("info", "نظرة عامة")]),
            _grp("💵 الدفعات والبنود", [("pay", "الدفعات والمقاولون")]),
            _grp("الأوامر التغييرية", [("addendums", "الأوامر والتعديلات")]),
        ]
        self.nav = PageNav([g for g in _nav_groups if g])
        self.nav.page_changed.connect(self._switch_page)
        # الهيدر العملي المختصر: التنقل + قائمة إجراءات تظهر عند الطلب بدل
        # بطاقة أزرار ثابتة داخل مراحل التنفيذ.
        nav_row = QWidget()
        nav_row.setObjectName("transparentHost")
        nav_lay = QHBoxLayout(nav_row)
        nav_lay.setContentsMargins(0, 0, 0, 0)
        nav_lay.setSpacing(8)
        nav_lay.addWidget(self.nav, 1)
        nav_lay.addWidget(self._build_contract_actions_menu_button())
        root.addWidget(nav_row)

        # يسار ثابت: مراحل التنفيذ فقط. تعليقات العميل أصبحت لوحة واحدة
        # ثابتة في ملف العميل، فلا نكررها هنا حتى لا تصغر المراحل.
        # V4.56: المراحل صفحة كاملة — لا عمود جانبي ضيق.
        root.addWidget(self.stack, 1)
        self.nav.select("info")

        # ===== شريط الإجراءات =====
        # لا نكرر أزرار العمليات هنا: الأوامر التغييرية والمستندات ومقاولو
        # الباطن لها أزرارها داخل أقسامها، والسندات/الحسابات مكانها ملف العميل.
        # في الوضع المستقل نترك زر رجوع فقط. وفي الدمج لا يظهر شريط سفلي.
        bar = ActionBar()
        if not embedded:
            bar.add_close(self.back_requested.emit)
            root.addWidget(bar)
        self.action_bar = bar

        # لا زر يُضغط تحت مقاسه الطبيعي (قاعدة 33)
        from PySide6.QtWidgets import QPushButton as _QPB
        from ui.widgets import size_buttons as _size_btns
        _size_btns([b for b in self.findChildren(_QPB) if b.text().strip()],
                   uniform=False)

    def _build_side_comments_panel(self) -> QFrame:
        """عمود تعليقات العقد/العميل ثابت بطول الصفحة."""
        side = QFrame()
        side.setProperty("card", True)
        side.setMinimumWidth(340)
        side.setMaximumWidth(460)
        lay = QVBoxLayout(side)
        lay.setContentsMargins(10, 10, 10, 10)
        lay.setSpacing(8)
        title = QLabel("تعليقات العقد")
        title.setProperty("sectionTitle", True)
        lay.addWidget(title)
        self.side_comments_list = QListWidget()
        self.side_comments_list.setWordWrap(True)
        self.side_comments_list.setSpacing(5)
        lay.addWidget(self.side_comments_list, 1)
        self.side_comment_edit = QTextEdit()
        self.side_comment_edit.setPlaceholderText("اكتب تعليقًا على هذا العقد...")
        self.side_comment_edit.setFixedHeight(72)
        lay.addWidget(self.side_comment_edit)
        btn = QPushButton("＋ إضافة تعليق")
        btn.setObjectName("btnPrimary")
        btn.clicked.connect(self._add_side_comment)
        lay.addWidget(btn)
        return side

    def _refresh_side_comments(self):
        if not hasattr(self, "side_comments_list"):
            return
        self.side_comments_list.clear()
        contract = self._ctx.get("contract", {}) if self._ctx else {}
        cid = contract.get("customer_id")
        if not cid or not self.contract_id:
            self.side_comments_list.addItem("اختر عقدًا لعرض تعليقاته")
            return
        try:
            from services import comment_service as _cmt
            rows = _cmt.list_comments(cid, contract_id=self.contract_id)
        except Exception:
            rows = []
        if not rows:
            self.side_comments_list.addItem("لا توجد تعليقات على هذا العقد")
            return
        for r in rows[:80]:
            who = r.get("author") or r.get("created_by") or ""
            when = (r.get("created_at") or "")[:16]
            body = (r.get("body") or "").replace("\n", " ")
            self.side_comments_list.addItem(f"{when} · {who}\n{body}")

    def _add_side_comment(self):
        text = self.side_comment_edit.toPlainText().strip()
        if not text:
            style.info(self, "اكتب نص التعليق أولاً.")
            return
        contract = self._ctx.get("contract", {}) if self._ctx else {}
        cid = contract.get("customer_id")
        if not cid or not self.contract_id:
            return
        try:
            from services import comment_service as _cmt
            _cmt.add_comment(cid, text, contract_id=self.contract_id)
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
            return
        self.side_comment_edit.clear()
        self._refresh_side_comments()
        self.data_changed.emit()

    def _open_gaps(self):
        """V3.2 (ج): تقرير عقود بفروقات."""
        try:
            from ui.contracts import GapsDialog
            GapsDialog(self).exec()
            self.data_changed.emit()
        except Exception as exc:
            from ui import style as _style
            _style.error(self, f"تعذر فتح تقرير الفروقات:\n{exc}")

    def _build_contract_actions_menu_button(self):
        """زر إجراءات في هيدر العقد بدل تثبيت كل الأزرار داخل لوحة المراحل."""
        from PySide6.QtWidgets import QMenu
        btn = QPushButton("☰ إجراءات العقد")
        btn.setObjectName("btnPrimary")
        btn.setProperty("compact", True)
        btn.setCursor(Qt.PointingHandCursor)
        btn.setToolTip("إظهار إجراءات العقد عند الحاجة")
        menu = QMenu(btn)
        self.stage_edit_btn = menu.addAction("✎ تعديل البيانات")
        self.stage_edit_btn.triggered.connect(self._open_info_editor)
        # V6.4: حُذف من القائمة ما صار مكررًا في الشاشة — «سند قبض» و«سند صرف»
        # لهما الآن زرّان فوق جدولَي الدفعات مباشرة (قبض فوق العميل، صرف فوق
        # المقاولين)؛ فلا نُكرّر الإجراء نفسه في مكانين.
        self.stage_receipt_btn = None
        self.stage_payment_btn = None
        self.stage_statement_btn = menu.addAction("▦ كشف حساب")
        self.stage_statement_btn.triggered.connect(self._statement_pdf)
        from services import feature_service as _feat13h
        if _feat13h.enabled("documents"):   # V4.5.13: ربط فعلي
            self.stage_generate_btn = menu.addAction("▤ اختيار نموذج")
            self.stage_generate_btn.setToolTip("يفتح قائمة القوالب المناسبة للعقد ثم تختار النموذج")
            self.stage_generate_btn.triggered.connect(self._generate_contract_document)
        else:
            self.stage_generate_btn = None
        menu.addSeparator()
        self.stage_waive_btn = menu.addAction("✖ إلغاء أشهر تمديد")
        self.stage_waive_btn.triggered.connect(self._waive_supervision)
        self.stage_settle_btn = menu.addAction("✔ تصفية وإغلاق")
        self.stage_settle_btn.triggered.connect(self._settle_contract)
        btn.setMenu(menu)
        self.contract_actions_btn = btn
        self.contract_actions_menu = menu
        return btn

    def _tab_stages(self) -> QWidget:
        """V4.56: مراحل التنفيذ صفحة كاملة."""
        page = QWidget()
        page.setObjectName("transparentHost")
        lay = QVBoxLayout(page)
        lay.setContentsMargins(0, 8, 0, 0)
        lay.setSpacing(8)
        from ui.followup import FollowupPanel
        from services import workflow_service as _wf
        self.followup_panel = FollowupPanel(
            page, _wf.TX_CONTRACT, self.contract_id or 0,
            show_chat=False, show_history=False)
        self.followup_panel.changed.connect(self._followup_changed)
        lay.addWidget(self.followup_panel, 1)
        return page

    def load_contract(self, contract_id: int, open_page: str = "dashboard"):
        """تحميل عقد معين في الصفحة."""
        # V2.48: نطاق ذاكرة البناء — يعيش أثناء التحميل فقط.
        from services.qcache import build_cache
        with build_cache():
            self._load_contract_inner(contract_id, open_page)

    def _load_contract_inner(self, contract_id: int,
                             open_page: str = "dashboard"):
        """تحميل عقد معين في الصفحة."""
        self.contract_id = contract_id
        # لوح المتابعة بُني وقت الإنشاء بعقدٍ فارغ (None) — يُعاد توجيهه
        # للعقد المحمَّل هنا وإلا ظل فارغًا (باج التصميم الجديد)
        panel = getattr(self, "followup_panel", None)
        if panel is not None and contract_id:
            try:
                from services import workflow_service as _wf
                panel.set_transaction(_wf.TX_CONTRACT, contract_id)
            except Exception:
                pass
        alias = {
            "dashboard": "info", "overview": "info", "summary": "info",
            "info": "info", "followup": "stages", "timeline": "stages",
            "stages": "stages",
            "money": "addendums", "plan": "plan",
            "addendums": "addendums", "financial": "addendums",
            "items": "subs", "comments": "info",
        }
        if open_page == "dashboard":
            # V4.56: العقد اليدوي يفتح على مساره مباشرة.
            try:
                from services import workflow_service as _wf56
                start = ("stages" if _wf56.is_manual_path(contract_id)
                         else "info")
            except Exception:
                start = "info"
        else:
            start = alias.get(open_page, open_page)
        start = start if start in self._page_index else "info"
        self.nav.select(start)
        self.stack.setCurrentIndex(self._page_index[start])
        self.refresh()

    def _toggle_details(self, checked: bool):
        """طي/فتح بطاقات التفاصيل."""
        self.details_host.setVisible(checked)
        self.more_btn.setText("إخفاء التفاصيل" if checked else "تفاصيل أكثر")

    def _more_actions_menu(self):
        """الإجراءات الأقل استخدامًا."""
        from PySide6.QtGui import QCursor
        from PySide6.QtWidgets import QMenu
        menu = QMenu(self)
        act_forms = menu.addAction("فتح مركز النماذج")
        act_batch = menu.addAction("طباعة كل مستندات العقد")
        chosen = menu.exec(QCursor.pos())
        if chosen is act_forms:
            from ui.widgets import find_host
            main = find_host(self, "forms_page")
            if main is not None and hasattr(main, "_go"):
                main._go(2)
            else:
                style.info(self, "افتح مركز النماذج من القائمة الرئيسية.")
        elif chosen is act_batch:
            self._batch_print_contract()

    def _switch_nav(self, key: str):
        """تبديل الصفحة مع تحريك زر التنقّل."""
        self.nav.select(key)
        self._switch_page(key)

    def _switch_page(self, key: str):
        """تبديل الصفحة · تُعبأ فقط إن كانت بحاجة تحديث."""
        if key not in self._page_index:
            key = "info"
        self.stack.setCurrentIndex(self._page_index[key])
        self._refresh_section(key)

    def _as_section(self, title: str, widget: QWidget,
                    collapsible: bool = False, open_by_default: bool = True) -> QFrame:
        """غلاف قسم داخل تاب مدمج؛ يستخدم بدل التابات الفرعية المكررة."""
        card = QFrame()
        card.setProperty("card", True)
        lay = QVBoxLayout(card)
        lay.setContentsMargins(12, 10, 12, 10)
        lay.setSpacing(8)
        head = QHBoxLayout()
        title_lbl = QLabel(title)
        title_lbl.setProperty("sectionTitle", True)
        head.addWidget(title_lbl)
        head.addStretch()
        if collapsible:
            btn = QPushButton("إخفاء" if open_by_default else "عرض")
            btn.setProperty("flat", True)
            btn.setCheckable(True)
            btn.setChecked(open_by_default)
            btn.toggled.connect(
                lambda checked, w=widget, b=btn: (w.setVisible(checked),
                                                 b.setText("إخفاء" if checked else "عرض")))
            head.addWidget(btn)
        lay.addLayout(head)
        lay.addWidget(widget)
        if collapsible:
            # بعد الأبوة: لا نافذة عابرة على ويندوز.
            widget.setVisible(open_by_default)
        return card

    # ==================== Dashboard ====================
    def _tab_dashboard(self) -> QWidget:
        page = QWidget()
        page.setObjectName("transparentHost")
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        outer = QVBoxLayout(page)
        outer.setContentsMargins(0, 8, 0, 0)
        host = QWidget()
        host.setObjectName("transparentHost")
        # صفحة الملخص تستغل عرض المساحة المتاحة حتى لا تترك فراغًا كبيرًا
        # بين ملخص العقد ومراحل التنفيذ. التفاصيل الطويلة تظل مطوية افتراضيًا،
        # وهذا يحافظ على الاختصار بدون حصر البطاقة في عمود ضيق.
        from PySide6.QtWidgets import QSizePolicy as _QSizePolicy
        host.setSizePolicy(_QSizePolicy.Expanding, _QSizePolicy.Preferred)
        scroll.setAlignment(Qt.AlignTop)
        layout = QVBoxLayout(host)
        layout.setContentsMargins(4, 4, 4, 4)
        layout.setSpacing(12)

        head = QHBoxLayout()
        fin_title = QLabel("ملخص العقد")
        fin_title.setProperty("sectionTitle", True)
        head.addWidget(fin_title)
        head.addStretch()
        layout.addLayout(head)

        summary_card = QFrame()
        summary_card.setProperty("card", True)
        summary_lay = QVBoxLayout(summary_card)
        summary_lay.setContentsMargins(14, 10, 14, 10)
        summary_lay.setSpacing(6)
        self._dash: dict[str, QLabel] = {}
        self._dash_labels: dict[str, QLabel] = {}  # V3.25
        for key, label in (("to_collect", "المتبقي"),
                           ("current", "القيمة الحالية"),
                           ("receipts", "المحصّل"),
                           ("tstatus", "الحالة الزمنية")):
            row = QHBoxLayout()
            lab = QLabel(label)
            row.addWidget(lab)
            row.addStretch()
            val = QLabel("—")
            val.setStyleSheet("font-weight: 800; background: transparent;")
            row.addWidget(val)
            summary_lay.addLayout(row)
            self._dash[key] = val
            self._dash_labels[key] = lab
        layout.addWidget(summary_card)

        self.progress = QProgressBar()
        self.progress.setFixedHeight(26)
        self.progress.setFormat("نسبة الإنجاز الزمني: %p%")
        self.progress.setStyleSheet(f"""
            QProgressBar {{ background: #E9EEF5; border: 1px solid #DCE3EC;
                border-radius: 11px; text-align: center; font-weight: 700; }}
            QProgressBar::chunk {{ border-radius: 10px;
                background: {style.ACCENT}; }}""")
        layout.addWidget(self.progress)

        self.collect_bar = QProgressBar()
        self.collect_bar.setFixedHeight(26)
        self.collect_bar.setFormat("نسبة التحصيل المالي: %p%")
        self.collect_bar.setStyleSheet(f"""
            QProgressBar {{ background: #E9EEF5; border: 1px solid #DCE3EC;
                border-radius: 11px; text-align: center; font-weight: 700; }}
            QProgressBar::chunk {{ border-radius: 10px;
                background: {style.OK_GREEN}; }}""")
        layout.addWidget(self.collect_bar)

        self.pace_lbl = QLabel("")
        self.pace_lbl.setWordWrap(True)
        self.pace_lbl.setMinimumWidth(0)
        from PySide6.QtWidgets import QSizePolicy as _QSP
        self.pace_lbl.setSizePolicy(_QSP.Ignored, _QSP.Preferred)
        self.pace_lbl.setStyleSheet("font-weight: 700; background: transparent;")
        layout.addWidget(self.pace_lbl)

        self.more_btn = QPushButton("تفاصيل أكثر")
        self.more_btn.setToolTip("عرض المؤشرات التفصيلية للعقد")
        self.more_btn.setProperty("flat", True)
        self.more_btn.setCheckable(True)
        self.more_btn.setChecked(False)
        self.more_btn.setCursor(Qt.PointingHandCursor)
        self.more_btn.toggled.connect(self._toggle_details)
        self.pricing_lbl = QLabel("")
        self.pricing_lbl.setWordWrap(True)
        self.pricing_lbl.setObjectName("pricingLine")
        self.pricing_lbl.setStyleSheet(
            "background: transparent; border: none; font-weight: 700;"
            f" color: {style.theme()['TEXT_600']};")
        self.pricing_lbl.setVisible(False)
        layout.addWidget(self.pricing_lbl)

        more_row = QHBoxLayout()
        more_row.addWidget(self.more_btn)
        more_row.addStretch()
        layout.addLayout(more_row)

        self.details_host = QWidget()
        self.details_host.setObjectName("transparentHost")
        dlayout = QVBoxLayout(self.details_host)
        dlayout.setContentsMargins(0, 0, 0, 0)
        dlayout.setSpacing(10)
        dspecs = [
            ("payments", "إجمالي المنصرف الفعلي"),
            ("profit", "الربح الفعلي"),
            ("expected_profit", "الربح المتوقع"),
            ("original", "قيمة العقد الأصلية"),
            ("addendums", "صافي أوامر التغيير"),
            ("sup_extension", "تمديد الإشراف المستحق"),
            ("subs", "إجمالي عقود الباطن"),
            ("cdate", "تاريخ التعاقد"),
            ("start", "تاريخ البداية"),
            ("end", "تاريخ النهاية"),
            ("duration", "مدة العقد"),
            ("elapsed", "الأيام المنقضية"),
            ("remaining", "الأيام المتبقية"),
        ]
        for key, label in dspecs:
            row = QHBoxLayout()
            lab = QLabel(label)
            row.addWidget(lab)
            row.addStretch()
            val = QLabel("—")
            val.setStyleSheet("font-weight: 700; background: transparent;")
            row.addWidget(val)
            dlayout.addLayout(row)
            self._dash[key] = val
            self._dash_labels[key] = lab
        self.details_host.setVisible(False)
        layout.addWidget(self.details_host)

        self.sup_card = QFrame()
        self.sup_card.setStyleSheet(
            "QFrame { background: rgba(124,58,237,0.13);"
            " border: 1.5px solid rgba(124,58,237,0.25);"
            " border-radius: 12px; }"
            "QLabel { background: transparent; border: none; }")
        sup_layout = QVBoxLayout(self.sup_card)
        sup_layout.setContentsMargins(14, 10, 14, 10)
        sup_layout.setSpacing(6)
        sup_head = QHBoxLayout()
        sup_title = QLabel("عقد إشراف هندسي")
        sup_title.setStyleSheet(
            f"font-weight: 800; color: {style.PURPLE_DEEP}; font-size: 11.9px;")
        sup_head.addWidget(sup_title)
        sup_head.addStretch()
        self.sup_waive_btn = QPushButton("✕ إلغاء أشهر تمديد (مدير)")
        self.sup_waive_btn.setToolTip(
            "إلغاء أشهر التمديد غير المسددة (مدير)")
        self.sup_waive_btn.setVisible(False)
        self.sup_waive_btn.clicked.connect(self._waive_supervision)
        sup_layout.addLayout(sup_head)
        self.sup_info_lbl = QLabel("")
        self.sup_info_lbl.setWordWrap(True)
        self.sup_info_lbl.setStyleSheet("font-size: 11px;")
        sup_layout.addWidget(self.sup_info_lbl)
        self.sup_card.setVisible(False)
        layout.addWidget(self.sup_card)

        self.settle_card = QFrame()
        self.settle_card.setStyleSheet(
            "QFrame { background: rgba(34,197,94,0.10);"
            " border: 1.5px solid rgba(34,197,94,0.45);"
            " border-radius: 12px; }")
        settle_layout = QHBoxLayout(self.settle_card)
        settle_layout.setContentsMargins(14, 10, 14, 10)
        self.settle_lbl = QLabel("")
        self.settle_lbl.setStyleSheet(
            "background: transparent; border: none; font-weight: 700;")
        self.settle_btn = QPushButton("✔ تصفية وإغلاق العقد")
        self.settle_btn.setToolTip("تصفية العقد وإغلاقه نهائيًا")
        self.settle_btn.setVisible(False)
        self.settle_btn.clicked.connect(self._settle_contract)
        settle_layout.addWidget(self.settle_lbl, 1)
        self.settle_card.setVisible(False)
        layout.addWidget(self.settle_card)

        layout.addStretch()
        scroll.setWidget(host)
        outer.addWidget(scroll)
        return page

    # ==================== البيانات ====================
    def _open_info_editor(self):
        """نافذة تعديل بيانات العقد؛ لا تُعرض حقول البيانات داخل الصفحة."""
        if not self.contract_id:
            return
        dlg = QDialog(self)
        dlg.setWindowTitle("تعديل بيانات العقد")
        dlg.setLayoutDirection(Qt.RightToLeft)
        dlg.setMinimumWidth(520)
        outer = QVBoxLayout(dlg)
        outer.setContentsMargins(18, 16, 18, 14)
        outer.setSpacing(10)
        card = QFrame(dlg)
        card.setProperty("card", True)
        outer.addWidget(card)
        form = QFormLayout(card)
        form.setContentsMargins(18, 14, 18, 14)
        form.setSpacing(10)

        self.f_name = QLineEdit(dlg)
        self.f_name.setReadOnly(True)
        self.f_name.setToolTip("اسم العقد المعروض يتبع نوع العقد المختار ولا يُعدّل يدويًا")
        self.f_type = QComboBox(dlg)
        make_searchable(self.f_type, "")
        self.f_type.currentTextChanged.connect(
            lambda txt: self.f_name.setText((txt or "غير محدد").strip()))
        self.f_sign = SafeDateEdit(dlg); self._setup_date(self.f_sign)
        self.f_start = SafeDateEdit(dlg); self._setup_date(self.f_start)
        self.f_end = SafeDateEdit(dlg); self._setup_date(self.f_end)
        self.f_status = QComboBox(dlg)
        make_searchable(self.f_status, "")
        self.f_status.addItems(lc.CONTRACT_STATUSES)
        # حالة العقد نفسها لا تُعطل في واجهة التعديل؛ التعطيل في عقد الإشراف
        # يخص تاريخ البداية/النهاية فقط لأنها تأتي من مراحل الإشراف.
        self.f_status.setEnabled(True)
        self.f_status.setToolTip("حالة العقد قابلة للتعديل حسب الصلاحية؛ الإلغاء/الإغلاق يطلبان اعتمادًا")
        self.f_currency = QLineEdit(dlg)
        self.f_currency.setFixedWidth(120)

        form.addRow("اسم العقد (تلقائي من النوع)", self.f_name)
        form.addRow("نوع العقد", self.f_type)
        form.addRow("تاريخ التوقيع", self.f_sign)
        form.addRow("تاريخ البداية", self.f_start)
        form.addRow("تاريخ النهاية", self.f_end)
        form.addRow("حالة العقد", self.f_status)
        form.addRow("العملة", self.f_currency)

        from ui.widgets import SafeSpinBox as _SSpinH
        self.f_sup_start = SafeDateEdit(dlg)
        self.f_sup_start.setCalendarPopup(True)
        self.f_sup_start.setDisplayFormat("yyyy-MM-dd")
        self.f_sup_start.setToolTip(
            "تاريخ تعهد الإشراف من بلدية الكويت · منه تبدأ المدة ويُحسب التمديد")
        self.f_sup_months = _SSpinH(dlg)
        # V4.0: الصفر مسموح = لا تعهد (تخطي الحفظ بلا إجبار).
        self.f_sup_months.setRange(0, 120)
        self.f_sup_monthly = SafeDoubleSpinBox(dlg)
        self.f_sup_monthly.setDecimals(3)
        self.f_sup_monthly.setRange(0, 999_999)
        self.f_sup_monthly.setGroupSeparatorShown(True)
        self.f_sup_discount = SafeDoubleSpinBox(dlg)
        self.f_sup_discount.setDecimals(3)
        self.f_sup_discount.setRange(0, 999_999)
        self.f_sup_discount.setGroupSeparatorShown(True)
        self.f_sup_hint = QLabel("", dlg)
        self.f_sup_hint.setWordWrap(True)
        self.f_sup_hint.setStyleSheet(
            f"color: {style.theme()['TEXT_600']}; font-size: 11px;")
        self._sup_rows = []
        for label, widget in (("تاريخ تعهد الإشراف", self.f_sup_start),
                              ("مدة الإشراف (أشهر)", self.f_sup_months),
                              ("قيمة الشهر", self.f_sup_monthly),
                              ("خصم الإشراف", self.f_sup_discount),
                              ("", self.f_sup_hint)):
            lbl = QLabel(label, dlg)
            form.addRow(lbl, widget)
            self._sup_rows.append((lbl, widget))
        self._set_sup_rows_visible(False)
        self._fill_info_editor()

        actions = QHBoxLayout()
        actions.addStretch()
        cancel_btn = QPushButton("✕ إلغاء", dlg)
        cancel_btn.setProperty("flat", True)
        cancel_btn.clicked.connect(dlg.reject)
        save_btn = QPushButton("💾 حفظ التعديل", dlg)
        save_btn.setObjectName("btnPrimary")
        save_btn.clicked.connect(lambda: dlg.accept() if self._save_info() else None)
        actions.addWidget(cancel_btn)
        actions.addWidget(save_btn)
        outer.addLayout(actions)
        dlg.exec()

    @staticmethod
    def _setup_date(widget: QDateEdit):
        widget.setCalendarPopup(True)
        widget.setDisplayFormat("yyyy-MM-dd")
        widget.setMinimumDate(QDate(1900, 1, 1))
        widget.setSpecialValueText("غير محدد")
        widget.setDate(widget.minimumDate())

    @staticmethod
    def _date_or_empty(widget: QDateEdit) -> str:
        if widget.date() == widget.minimumDate():
            return ""
        return widget.date().toString("yyyy-MM-dd")

    def _set_sup_rows_visible(self, visible: bool):
        for lbl, widget in getattr(self, "_sup_rows", []):
            lbl.setVisible(visible)
            widget.setVisible(visible)

    def _save_info(self):
        try:
            from services import ui_data_service as ui_data
            old_status = ui_data.contract_status(self.contract_id)
            new_status = self.f_status.currentText() or old_status
            if new_status != old_status and new_status in ("ملغى", "مغلق"):
                if not style.require_admin(
                        self, f"تغيير حالة العقد إلى ({new_status})",
                        perm="action_change_status"):
                    return False
                reason = ""
                close_amount = 0.0
                if new_status == "ملغى":
                    from PySide6.QtWidgets import QInputDialog
                    reason, ok = QInputDialog.getText(
                        self, "سبب إلغاء العقد",
                        "اكتب سبب الإلغاء / التوضيح الذي سيظهر في سجل العقد:")
                    if not ok:
                        return False
                    close_amount, ok = QInputDialog.getDouble(
                        self, "مبلغ إغلاق الإلغاء",
                        "اكتب مبلغ الإغلاق/التسوية عند إلغاء العقد (0 إذا لا يوجد):",
                        0.0, 0.0, 1e9, 3)
                    if not ok:
                        return False
                lc.change_contract_status(self.contract_id, new_status, reason, close_amount)
            _ctype = (self.f_type.currentText() or "غير محدد").strip()
            lc_kwargs = dict(
                contract_name=_ctype,
                contract_type=_ctype,
                sign_date=self._date_or_empty(self.f_sign),
                status=self.f_status.currentText(),
                currency=self.f_currency.text() or "د.ك")
            if not getattr(self, "_is_sup_contract", False):
                lc_kwargs.update(start_date=self._date_or_empty(self.f_start),
                                 end_date=self._date_or_empty(self.f_end))
            lc.update_contract_lifecycle(self.contract_id, **lc_kwargs)
            if getattr(self, "_sup_rows_shown", False):
                from services import supervision_service as _sup
                old_st = _sup.supervision_status(self.contract_id)
                sup_start = (old_st or {}).get("start", "")
                _m4 = int(self.f_sup_months.value())
                # V4.0: الصفر = لا تعهد (تخطي بلا مساس) · والموجب يُحفظ.
                # قيمة العقد تُعاد كتابتها لعقود الإشراف فقط (السلوك القديم).
                if _m4 > 0:
                    if self.f_sup_monthly.value() <= 0:
                        style.error(self, "قيمة الشهر يجب أن تكون أكبر من صفر.")
                        return False
                    from services import contract_service as _cs4
                    _con4 = _cs4.get_contract(self.contract_id)
                    _touch4 = bool(_cs4.is_supervision_contract(_con4))
                    _sup.setup_supervision(self.contract_id, sup_start,
                                           _m4,
                                           self.f_sup_monthly.value(),
                                           self.f_sup_discount.value(),
                                           touch_amount=_touch4)
                    if sup_start:
                        lc.update_contract_lifecycle(
                            self.contract_id,
                            start_date=sup_start,
                            end_date=_sup.base_end_date(self.contract_id))
            style.toast(self, "تم حفظ بيانات العقد")
            self.refresh()
            self.data_changed.emit()
            return True
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
            return False

    # ==================== مقاولو الباطن ====================
    def _items_link_rows(self) -> list:
        """صفوف جدول الربط (بند ← عقد باطن ← مقاول) لهذا العقد."""
        try:
            from database.database import get_connection
            with get_connection() as conn:
                rows = conn.execute(
                    "SELECT si.boq_item_id AS bid, si.sub_contract_id AS scid, "
                    "s.name AS name FROM sub_contract_items si "
                    "JOIN sub_contracts sc ON sc.id = si.sub_contract_id "
                    "JOIN subcontractors s ON s.id = sc.subcontractor_id "
                    "WHERE sc.contract_id = ? AND COALESCE(sc.status,'') "
                    "<> 'ملغى' AND si.boq_item_id IS NOT NULL",
                    (self.contract_id,)).fetchall()
            return [dict(r) for r in rows]
        except Exception:
            return []

    def _sub_items_map(self) -> dict:
        """{معرّف عقد الباطن: مجموعة بنود عقد العميل التي يغطيها}."""
        out: dict = {}
        for r in self._items_link_rows():
            out.setdefault(int(r["scid"]), set()).add(int(r["bid"]))
        # V8.7.5: إضافة الدفعات بدون boq_item_id
        try:
            from database.database import get_connection
            with get_connection() as conn:
                rows = conn.execute(
                    "SELECT sc.id AS scid, COUNT(*) AS cnt "
                    "FROM sub_contract_items si "
                    "JOIN sub_contracts sc ON sc.id = si.sub_contract_id "
                    "WHERE sc.contract_id = ? AND COALESCE(sc.status,'') <> 'ملغى' "
                    "GROUP BY sc.id",
                    (self.contract_id,)).fetchall()
                for r in rows:
                    scid = int(r["scid"])
                    if scid not in out:
                        out[scid] = set()
        except Exception:
            pass
        return out

    # ==================== تاب الدفعات (عرض فقط) ====================
    _CLIENT_HEADS = ["الدفعة", "المرحلة", "المبلغ", "المسدَّد", "الحالة"]
    # V6.4: الجدولان 5 أعمدة متطابقة — أُزيل عمودا «المقاول» و«تحصيل
    # العميل»، واسم المقاول صار صفًا أفقيًا فوق مراحله، والكلمة موحّدة
    # «المسدَّد» في الجدولين، و«بانتظار المرحلة» → «انتظار».
    # والقاعدة: كل دفعة مقابل نظيرتها على نفس الصف.
    _SUB_HEADS = ["الدفعة", "المرحلة", "المبلغ", "المسدَّد", "الحالة"]
    # V9.1: بنود العقد المرتبطة بعقد الباطن — عمود واحد (الوصف فقط)
    _ITEM_HEADS = ["البند"]
    # V9.1: رؤوس الجدول الموحّد = 9 أعمدة (المرحلة + 4 عميل + 4 مقاول)
    _UNI_HEADS = (["المرحلة/البند"]
                  + ["الدفعة", "المبلغ", "المسدّد", "الحالة"]
                  + ["الدفعة", "المبلغ", "المسدّد", "الحالة"])
    _BAR_BG = "#EEF2FF"   # خلفية الصف الأفقي (اسم العميل/المقاول)

    def _make_pay_table(self, heads, weights, min_widths=None):
        t = QTableWidget(0, len(heads))
        t.setHorizontalHeaderLabels(heads)
        from ui.widgets import apply_column_weights as _acw
        _acw(t, weights, min_widths=min_widths or [92] * len(heads))
        t.verticalHeader().setVisible(False)
        t.setEditTriggers(QTableWidget.NoEditTriggers)
        t.setSelectionBehavior(QTableWidget.SelectRows)
        t.setSelectionMode(QTableWidget.SingleSelection)
        t.setAlternatingRowColors(True)
        t.setWordWrap(False)
        return t

    def _fit_table_height(self, t):
        """V6.4: ارتفاع الجدول = ارتفاع محتواه (بلا تمرير داخلي).

        الكتل صارت عدة جداول قصيرة، فيجب أن ينمو كل جدول بمحتواه بدل
        أن يُحبس في ارتفاع ثابت بتمرير داخلي مشتّت.
        """
        try:
            t.resizeRowsToContents()
            h = t.horizontalHeader().height() + 6
            for r in range(t.rowCount()):
                h += t.rowHeight(r)
            t.setFixedHeight(max(72, min(620, h + 6)))
        except Exception:
            pass

    def _pay_blocks_clear(self):
        """إفراغ كتل الدفعات قبل إعادة بنائها."""
        try:
            while self._pay_blocks_host.count():
                it = self._pay_blocks_host.takeAt(0)
                w = it.widget()
                if w is not None:
                    w.setParent(None)
                    w.deleteLater()
        except Exception:
            pass

    @staticmethod
    def _pay_hint(text):
        """تلميح رمادي صغير داخل كتل الدفعات."""
        lb = QLabel(text)
        lb.setProperty("hint", True)
        lb.setWordWrap(True)
        return lb

    def _new_pay_block(self, title, color, pay_btn=None):
        """كتلة طرف واحد (V9.1): رأس باسم المقاول وزر سنده، ثم **جدولين
        موحّدين**: جدول العميل (4 أعمدة) وجنبه جدول المقاول (4 أعمدة)،
        ثم بنود العقد المرتبطة أسفله.
        """
        # فاصل رفيع بين الكتل — «كل مقاول جدول منفصل أسفل الآخر»
        if self._pay_blocks:
            sep = QFrame()
            sep.setFixedHeight(2)
            sep.setStyleSheet(f"background: {style.BORDER}; border: none;")
            self._pay_blocks_host.addWidget(sep)
        frame = QFrame()
        frame.setObjectName("glassCard")
        frame.setStyleSheet("""
            QFrame#glassCard {
                background: #ECFDF5;
                border: 1px solid #6EE7B7;
                border-radius: 8px;
            }
        """)
        box = QVBoxLayout(frame)
        box.setContentsMargins(10, 8, 10, 8)
        box.setSpacing(6)
        head = QHBoxLayout()
        head.setSpacing(8)
        lbl = QLabel(title)
        lbl.setStyleSheet(f"font-weight: 800; color: {color};")
        lbl.setWordWrap(True)
        head.addWidget(lbl)
        head.addStretch()
        if pay_btn is not None:
            head.addWidget(pay_btn)
        box.addLayout(head)
        body = QVBoxLayout()
        body.setContentsMargins(0, 0, 0, 0)
        body.setSpacing(4)
        box.addLayout(body)
        self._pay_blocks_host.addWidget(frame)
        blk = {"frame": frame, "label": lbl, "body": body, "table": None,
               "items_label": None, "items_table": None, "title": title}
        self._pay_blocks.append(blk)
        return blk

    def _tab_pay(self) -> QWidget:
        """V4.5.08 + V6.5: عرض الدفعات — كتلة لكل مقاول، بلا أزرار إجراءات.

        داخل كل كتلة **جدول موحّد**: 8 أعمدة (4 عميل + 4 مقاول)،
        ثم صف الإجمالي، ثم بنود العقد المرتبطة أسفل الجدول.
        """
        page = QWidget()
        page.setObjectName("transparentHost")
        outer = QVBoxLayout(page)
        outer.setContentsMargins(0, 2, 0, 0)   # هامش أقل ⇒ الجداول لفوق
        outer.setSpacing(0)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QScrollArea.NoFrame)
        host = QWidget()
        host.setObjectName("transparentHost")
        lay = QVBoxLayout(host)
        lay.setContentsMargins(2, 0, 2, 4)
        lay.setSpacing(8)

        # ① الشريط العلوي المختصر + زر سند القبض (يخصّ العميل كله)
        summary = QFrame()
        summary.setObjectName("glassCard")
        summary.setStyleSheet("""
            QFrame#glassCard {
                background: #EFF6FF;
                border: 1px solid #93C5FD;
                border-radius: 8px;
            }
        """)
        sl = QHBoxLayout(summary)
        sl.setContentsMargins(10, 3, 10, 3)
        sl.setSpacing(10)
        self.pay_mode_lbl = QLabel("")
        self.pay_mode_lbl.setStyleSheet("font-weight: 800;")
        sl.addWidget(self.pay_mode_lbl)
        self.pay_sum_lbl = QLabel("")
        self.pay_sum_lbl.setWordWrap(True)
        self.pay_sum_lbl.setToolTip("عرض فقط — القبض من زر سند القبض هنا، "
                                    "والصرف من زر كل مقاول في كتلته")
        sl.addWidget(self.pay_sum_lbl, 1)
        rec_btn = QPushButton("＋ سند قبض")
        rec_btn.setObjectName("btnReceipt")
        rec_btn.setProperty("compact", True)
        rec_btn.setCursor(Qt.PointingHandCursor)
        rec_btn.setToolTip("تحصيل من العميل — تختار الدفعة المستحقة بنفسك "
                           "من داخل السند")
        rec_btn.clicked.connect(lambda: self._add_voucher_here("receipt"))
        sl.addWidget(rec_btn)
        exp_btn = QPushButton("📤")
        exp_btn.setObjectName("iconBtn")
        exp_btn.setToolTip("تصدير دفعات العميل والمقاولين إلى Excel")
        exp_btn.setCursor(Qt.PointingHandCursor)
        exp_btn.clicked.connect(self._export_pay_view)
        sl.addWidget(exp_btn)
        lay.addWidget(summary)

        # ② كتل الأطراف: كتلة لكل مقاول (أسفل بعضها) — ثم سطر الإجماليات
        self._pay_blocks_host = QVBoxLayout()
        self._pay_blocks_host.setSpacing(10)
        lay.addLayout(self._pay_blocks_host)
        self._pay_blocks = []
        self._pay_stacked = None
        self._pay_laid = False
        self.pay_tables = []
        self.client_tables = self.pay_tables     # أسماء قديمة (توافق)
        self.sub_tables = self.pay_tables
        self.items_tables = []
        self.client_table = None
        self.sub_table = None

        # كتلة ابتدائية قبل تحميل أي عقد: يبقى زر الصرف متاحًا (يُختار المقاول
        # من داخل السند) وتُستبدل هذه الكتلة عند تعبئة بيانات العقد.
        _pay0 = QPushButton("＋ سند صرف")
        _pay0.setObjectName("btnPrimary")
        _pay0.setProperty("compact", True)
        _pay0.setCursor(Qt.PointingHandCursor)
        _pay0.setToolTip("صرف لمقاول الباطن — تختار الدفعة المستحقة بنفسك "
                         "من داخل السند")
        _pay0.clicked.connect(lambda: self._add_voucher_here("payment"))
        _blk0 = self._new_pay_block("دفعاتنا على العميل", style.PRIMARY, _pay0)
        _blk0["body"].addWidget(self._pay_hint(
            "يُعرض هنا جدول واحد: كل دفعة من العميل مقابل دفعة المقاول "
            "المرتبطة بها على نفس السطر."))
        _blk0["body"].addWidget(self._pay_hint(
            "لا عقود باطن بعد — أنشئها من صفحة «مقاولو الباطن» ثم تُعرض "
            "دفعات كل مقاول هنا مقابل دفعاته من العميل."))

        foot_host = QWidget()
        foot_host.setObjectName("transparentHost")
        foot = QHBoxLayout(foot_host)
        foot.setContentsMargins(0, 0, 0, 0)
        foot.setSpacing(14)
        self.client_foot_lbl = QLabel("")
        self.client_foot_lbl.setProperty("hint", True)
        foot.addWidget(self.client_foot_lbl)
        foot.addStretch()
        self.sub_foot_lbl = QLabel("")
        self.sub_foot_lbl.setProperty("hint", True)
        foot.addWidget(self.sub_foot_lbl)
        lay.addWidget(foot_host)

        lay.addStretch()
        scroll.setWidget(host)
        outer.addWidget(scroll)
        _prev_page_resize = page.resizeEvent

        def _pay_page_resize(event, _prev=_prev_page_resize):
            _prev(event)
            self._pay_relayout()

        page.resizeEvent = _pay_page_resize
        return page

    def _pay_relayout(self):
        """V6.5: كل كتلة جدول واحد بعرض الصفحة — لا تكديس جدولين.

        يُبقى الحد (1120) لتحديد «عرض ضيق» فيُعاد توزيع الأعمدة وتُقصَّر
        العناوين فقط؛ الأعمدة لها حدود دنيا فلا تُضغط ولا تتراكب الكلمات.
        """
        try:
            if not hasattr(self, "_pay_blocks"):
                return
            self._pay_stacked = self.width() < 1120
            if self._pay_laid:
                return
            self._pay_laid = True
            for t in getattr(self, "pay_tables", []):
                fn = getattr(t, "_redistribute_columns", None)
                if fn is not None:
                    QTimer.singleShot(0, fn)
        except Exception:
            pass
    @staticmethod
    def _short_status(text: str) -> str:
        """اختصار أسماء الحالات الطويلة لعرضها كشارة صغيرة."""
        return {"بانتظار إنجاز المرحلة": "انتظار",
                "بانتظار المرحلة": "انتظار",
                "⚠ بلا مصدر": "بلا مصدر",
                "مستحقة": "مستحقّة",
                "غير مستحقة": "غير مستحقّة",
                "مغلقة": "مغلقة",
                "محصّلة": "محصّلة",
                "مدفوعة": "مدفوعة"}.get(text, text)

    def _pay_fill(self):
        """V6.5: **جدول واحد لكل مقاول** — صف لكل دفعة يجمع الطرفين.

        * يمين الجدول: البنود والدفعات (الدفعة + المرحلة).
        * ثم أعمدة العميل (المبلغ/المسدَّد/الحالة) لأعلى مرحلة وصلت.
        * ثم أعمدة المقاول نفسه (المبلغ/المسدَّد/الحالة) لنفس الدفعة.
        * صف إجمالي أسفل كل كتلة، وأسفله بنود العقد المرتبطة.
        * الدفعة التي تُغذّي أكثر من عقد باطن تُوسم «مشتركة» (تتكرر في كل
          كتلة بحكم أنها تخصّ الطرفين، والوسم يمنع القراءة الخاطئة).
        * ما لم يُربط بأي مقاول يبقى في كتلة أخيرة حتى لا تغيب أي دفعة.
        """
        if not self._ctx or not hasattr(self, "_pay_blocks_host"):
            return
        cid = self.contract_id
        self._pay_blocks_clear()
        self._pay_blocks = []
        self._pay_laid = False
        self.pay_tables = []
        self.client_tables = self.pay_tables
        self.sub_tables = self.pay_tables
        self.items_tables = []
        self.client_table = None
        self.sub_table = None

        def _item(text, color=None, bold=False, tip="", align=None,
                  bg=None):
            it = QTableWidgetItem("" if text is None else str(text))
            if tip:
                it.setToolTip(tip)
            it.setTextAlignment(align if align is not None
                                else (Qt.AlignCenter))
            if color:
                it.setForeground(QColor(color))
            if bold:
                f = it.font()
                f.setBold(True)
                it.setFont(f)
            if bg:
                it.setBackground(QColor(bg))
            return it

        def _hint_label(text):
            lb = QLabel(text)
            lb.setProperty("hint", True)
            lb.setWordWrap(True)
            return lb

        # ── بيانات العميل والمقاولين ─────────────────────────────────
        plan = [dict(x) for x in lc.contract_payment_plan(cid)]
        client_no = {int(x["id"]): i for i, x in enumerate(plan, 1)}
        plan_by_id = {int(x["id"]): x for x in plan}
        c_name = (self._ctx.get("contract", {})
                  .get("customer_name") or "").strip()
        try:
            items = [dict(x) for x in lc.list_boq(cid)]
        except Exception:
            items = []
        item_by_id = {int(x["id"]): x for x in items}
        sub_items = self._sub_items_map()

        # الدفعات المشتركة بين أكثر من عقد باطن (تُوسم «مشتركة»)
        shared_ids: set = set()
        try:
            from database.database import get_connection as _gc
            with _gc() as _c:
                _rows = _c.execute(
                    "SELECT s.cust_line_id AS clid, "
                    "sp.sub_contract_id AS scid "
                    "FROM sub_payment_sources s "
                    "JOIN sub_payment_plan sp ON sp.id = s.sub_line_id "
                    "JOIN sub_contracts sc ON sc.id = sp.sub_contract_id "
                    "WHERE sc.contract_id = ?", (cid,)).fetchall()
            _by = {}
            for _r in _rows:
                _by.setdefault(int(_r["clid"]), set()).add(int(_r["scid"]))
            shared_ids = {x for x, scs in _by.items() if len(scs) > 1}
        except Exception:
            shared_ids = set()

        subs = [dict(x) for x in lc.list_sub_contracts(contract_id=cid)]
        entries = []
        used: set = set()
        for s in subs:
            sc_id = int(s["id"])
            lines = [dict(x) for x in lc.sub_payment_plan(sc_id)]
            try:
                src = lc.sub_source_ids(sc_id)
            except Exception:
                src = {}
            nums = []
            for ln in lines:
                for _s in (src.get(int(ln["id"])) or []):
                    try:
                        _s = int(_s)
                    except (TypeError, ValueError):
                        continue
                    if _s in client_no and _s not in nums:
                        nums.append(_s)
            nums.sort(key=lambda x: client_no.get(x, 0))
            used.update(nums)
            entries.append({"sub": s, "sc_id": sc_id, "lines": lines,
                            "src": src, "nums": nums})
        entries.sort(key=lambda e: (client_no.get(e["nums"][0], 10 ** 6)
                                    if e["nums"] else 10 ** 6, e["sc_id"]))


        def _unified_table(blk, s, e):
            """الجدول الموحّد — منطقه في ui/sub_pay_blocks.py (مشترك مع شاشة المقاول)."""
            from ui.sub_pay_blocks import build_unified_table
            t, c_tot, c_paid, s_tot, s_paid = build_unified_table(
                plan_by_id=plan_by_id, client_no=client_no, shared_ids=shared_ids,
                c_name=c_name, sub_name=(s.get("sub_name") or "").strip(),
                lines=e["lines"], src=e["src"], nums=e["nums"],
                sub_cancelled=(s.get("status") or "") == "ملغى")
            self._fit_table_height(t)
            t.horizontalHeader().setStretchLastSection(False)
            blk["body"].addWidget(t)
            blk["table"] = t
            self.pay_tables.append(t)
            return c_tot, c_paid, s_tot, s_paid

        def _sub_items_table(blk, s, sc_id):
            """بنود العقد المرتبطة بعقد الباطن — منطقها في ui/sub_pay_blocks.py."""
            from ui.sub_pay_blocks import build_items_table
            text, t, tot = build_items_table(sub_items.get(sc_id, set()), item_by_id)
            if t is None:
                blk["items_label"] = None
                blk["items_table"] = None
                return
            lbl = _hint_label(text)
            blk["body"].addWidget(lbl)
            blk["items_label"] = lbl
            self._fit_table_height(t)
            blk["body"].addWidget(t)
            blk["items_table"] = t
            self.items_tables.append(t)
            return tot

        # ── بناء الكتل ───────────────────────────────────────────────
        s_tot = s_paid = s_wait = 0.0
        for e in entries:
            s = e["sub"]
            sc_id = e["sc_id"]
            pay_btn = QPushButton("＋ سند صرف")
            pay_btn.setObjectName("btnPrimary")
            pay_btn.setProperty("compact", True)
            pay_btn.setCursor(Qt.PointingHandCursor)
            pay_btn.setToolTip("صرف لمقاول الباطن — تختار الدفعة المستحقة "
                               "بنفسك من داخل السند")
            _sub_ref = (s.get("subcontractor_id") or s.get("sub_id"))
            pay_btn.clicked.connect(
                lambda _=False, a=int(_sub_ref or 0), b=int(sc_id):
                self._add_voucher_here("payment", sub_id=a, sc_id=b))
            mine = sub_items.get(sc_id, set())
            # V8.7.5: حساب كل البنود (بما فيها الدفعات بدون boq_item_id)
            _total_items = len(mine)
            if not _total_items:
                try:
                    from database.database import get_connection
                    with get_connection() as conn:
                        _cnt = conn.execute(
                            "SELECT COUNT(*) FROM sub_contract_items "
                            "WHERE sub_contract_id=?", (sc_id,)).fetchone()[0]
                        _total_items = int(_cnt)
                except Exception:
                    pass
            amt_contract = float(s["amount"] or 0)
            title = (f"{s.get('sub_name') or ''} · "
                     f"{'بنود: %d' % _total_items if _total_items else 'بلا بنود'} · "
                     f"قيمة العقد {amt_contract:,.3f} د.ك"
                     + (f" · {s.get('status')}" if s.get("status") else ""))
            blk = self._new_pay_block(
                title, STATUS_COLORS.get(s.get("status"),
                                         style.STATUS_DEFAULT), pay_btn)
            _c_tot, _c_paid, _s_tot, _s_paid = _unified_table(blk, s, e)
            _sub_items_table(blk, s, sc_id)
            s_tot += _s_tot
            s_paid += _s_paid
            try:
                _src = lc.sub_sources_status(sc_id)
            except Exception:
                _src = {}
            for ln in e["lines"]:
                st = _src.get(int(ln["id"]))
                if st is not None and not st["ready"]:
                    s_wait += float(ln.get("amount") or 0)

        # ما لم يُربط بأي مقاول من دفعات العميل — يبقى ظاهرًا
        free_ids = [int(x["id"]) for x in plan if int(x["id"]) not in used]
        if not subs:
            _pay0 = QPushButton("＋ سند صرف")
            _pay0.setObjectName("btnPrimary")
            _pay0.setProperty("compact", True)
            _pay0.setCursor(Qt.PointingHandCursor)
            _pay0.setToolTip("صرف لمقاول الباطن — تختار الدفعة المستحقة "
                             "بنفسك من داخل السند")
            _pay0.clicked.connect(lambda: self._add_voucher_here("payment"))
            blk = self._new_pay_block("دفعاتنا على العميل", style.PRIMARY,
                                      _pay0)
            # كل دفعات العميل في الجدول الموحّد — وأعمدة المقاول فارغة
            # (لا عقد باطن بعد) حتى لا تختفي أي دفعة عميل.
            _all_entry = {"lines": [], "src": {},
                          "nums": [int(x["id"]) for x in plan], "sc_id": 0}
            _unified_table(blk, {"sub_name": "", "status": "",
                                 "amount": 0, "subcontractor_id": 0,
                                 "sub_id": 0, "id": 0}, _all_entry)
            blk["body"].addWidget(self._pay_hint(
                "لا عقود باطن على هذا العقد بعد — أنشئها من صفحة "
                "«مقاولو الباطن» ثم يُعرض لكل مقاول جدوله الأول بدفعاته "
                "مقابل دفعاته من العميل."))
        elif free_ids:
            blk = self._new_pay_block("دفعات العميل غير المرتبطة بمقاول",
                                      style.MUTED)
            _free_entry = {"lines": [], "src": {}, "nums": free_ids,
                           "sc_id": 0}
            _unified_table(blk, {"sub_name": "", "status": "",
                                 "amount": 0, "subcontractor_id": 0,
                                 "sub_id": 0, "id": 0}, _free_entry)
            blk["body"].addWidget(self._pay_hint(
                "هذه الدفعات لم تُربط بأي مقاول بعد — تُربط عند إنشاء أو "
                "تعديل عقد الباطن من صفحة «مقاولو الباطن»."))

        # ── إجماليات عامة ────────────────────────────────────────────
        c_tot = sum(float(x.get("amount") or 0) for x in plan)
        c_paid = sum(float(x.get("covered") or 0) for x in plan)
        c_rem = sum(float(x.get("remaining") or 0) for x in plan)
        if plan:
            self.client_foot_lbl.setText(
                f"الإجمالي {c_tot:,.3f} د.ك · مسدَّد {c_paid:,.3f} · "
                f"متبقٍ {c_rem:,.3f}")
        else:
            self.client_foot_lbl.setText(
                "لا خطة دفعات لهذا العقد بعد · تُدخل من شاشة العقد")
        if subs:
            _unlinked_n = 0
            _unlinked_total = 0.0
            for e in entries:
                _l0 = (e["lines"] or [{}])[0]
                if int((_l0 or {}).get("unlinked_vouchers") or 0):
                    _unlinked_n += int(_l0.get("unlinked_vouchers") or 0)
                    _unlinked_total += float(_l0.get("unlinked_total") or 0)
            self.sub_foot_lbl.setText(
                f"الإجمالي {s_tot:,.3f} د.ك · مسدَّد {s_paid:,.3f} · "
                f"متبقٍ {s_tot - s_paid:,.3f}"
                + (f" · بانتظار تحصيل العميل {s_wait:,.3f}" if s_wait else "")
                + (f" · ⚠ {_unlinked_n} سندًا غير مرتبط بعقد باطن "
                   f"({_unlinked_total:,.3f})" if _unlinked_n else ""))
        else:
            self.sub_foot_lbl.setText("لا عقود باطن على هذا العقد بعد")
        self._pay_relayout()

    def _export_addendums(self):
        from ui.widgets import export_table_excel
        rows = [[a["addendum_number"], a.get("addendum_type") or "أمر تغييري",
                 "عميل" if (a.get("side") or "client") == "client" else "مقاول",
                 a["adate"], a["reason"], a["amount_add"], a["amount_deduct"],
                 a["amount_add"] - a["amount_deduct"],
                 int(a.get("items_count") or 0),
                 "نُفِّذ" if a.get("applied_at") else "—", a["status"],
                 a.get("cancel_reason") or ""]
                for a in getattr(self, "_addendums", [])]
        export_table_excel(
            self, "أوامر التغيير والعقود الإضافية",
            ["الرقم", "النوع", "الجهة", "التاريخ", "السبب", "زيادة", "خصم",
             "الصافي", "بنود", "مُنفَّذ", "الحالة", "سبب الإلغاء"], rows,
            "أوامر_التغيير", number_cols=[5, 6, 7])


    def _export_pay_view(self):
        """V6.5: تصدير كتل الدفعات — جدول موحّد لكل مقاول + بنوده."""
        from ui.widgets import export_table_excel
        heads = ["المقاول"] + list(self._UNI_HEADS)
        rows = []
        for blk in getattr(self, "_pay_blocks", []):
            t = blk.get("table")
            for r in range((t.rowCount() if t is not None else 0)):
                cells = [(t.item(r, c).text() if t.item(r, c) else "")
                         for c in range(t.columnCount())] \
                    if t is not None else []
                rows.append([blk.get("title") or ""] + cells)
            it = blk.get("items_table")
            if it is not None:
                rows.append([""] * len(heads))
                rows.append(["بنود " + (blk.get("title") or "")]
                            + list(self._ITEM_HEADS)
                            + [""] * (len(heads) - 1 - len(self._ITEM_HEADS)))
                for r in range(it.rowCount()):
                    cells = [(it.item(r, c).text() if it.item(r, c) else "")
                             for c in range(it.columnCount())]
                    rows.append([""] + cells
                                + [""] * (len(heads) - 1 - len(cells)))
            rows.append([""] * len(heads))
        export_table_excel(self, "دفعات العقد والمقاولين", heads, rows,
                           "دفعات_العقد_والمقاولين", number_cols=[3, 4, 7, 8])

    def _add_sub(self):
        """V5.2: فتح صفحة إنشاء عقد مقاول جديد."""
        main_win = self.window()
        # جلب المقاول المحدد إن وجد
        preset_sub = None
        try:
            _tables = getattr(self, "sub_tables", None) or (
                [self.sub_table] if self.sub_table else [])
            for _t in _tables:
                _r = _t.currentRow()
                _it = _t.item(_r, 0) if _r >= 0 else None
                if _it is not None and _it.data(Qt.UserRole):
                    preset_sub = int(_it.data(Qt.UserRole))
                    break
        except Exception:
            preset_sub = None

        if hasattr(main_win, 'open_subcontract_page'):
            main_win.open_subcontract_page(
                contract_id=self.contract_id, sub_id=preset_sub,
                on_done=lambda accepted: (self.refresh(), self.data_changed.emit()) if accepted else None)
        else:
            # Fallback للنظام القديم
            from ui.subcontractors import LinkSubContractDialog
            dlg = LinkSubContractDialog(self, self.contract_id,
                                        preset_sub_id=preset_sub)
            if dlg.exec() == QDialog.Accepted:
                self.refresh()
                self.data_changed.emit()

    def _sec_pay(self):
        from services import workflow_service as _wf
        cid = self.contract_id
        cur = self._ctx["cur"]
        data = lc.contract_payment_compare(cid)
        if _wf.is_manual_path(cid):
            g = _wf.manual_path_groups(cid)
            self.pay_mode_lbl.setText(
                f"🔧 مسار يدوي — المنجز {g['done']} من {g['total']} · "
                f"{g['pct']}٪")
        else:
            cur_st = _wf.get_current_stage(_wf.TX_CONTRACT, cid) or {}
            self.pay_mode_lbl.setText(
                "📏 مسار إجباري — الحالية: "
                + (cur_st.get("stage_name") or "اكتمل المسار ✓"))
        # V5.9: النوت الصغير — آخر ملاحظة على المعاملة قدام حالتها.
        try:
            _sn = _wf.latest_stage_note(_wf.TX_CONTRACT, cid) or {}
        except Exception:
            _sn = {}
        if _sn.get("note"):
            _txt = _sn["note"].strip()
            _short = _txt if len(_txt) <= 48 else _txt[:46] + "…"
            self.pay_mode_lbl.setText(
                self.pay_mode_lbl.text() + f" · 📝 {_short}")
            self.pay_mode_lbl.setToolTip(
                f"{_txt}\n\n— {_sn.get('author') or 'مستخدم'} · "
                f"{(_sn.get('created_at') or '')[:16]}")
        c = data["client"]
        t = data["subs_total"]
        self.pay_sum_lbl.setText(
            f"لنا: مستحق {c['due']:,.3f} · مسدَّد {c['collected']:,.3f} · "
            f"متبقٍ {c['remaining']:,.3f} {cur}"
            f"    |    عليهم (مقاولون): مستحق {t['due']:,.3f} · مسدَّد "
            f"{t['paid']:,.3f} · متبقٍ {t['remaining']:,.3f} {cur}"
            + (f" · بانتظار تحصيل العميل {t['waiting']:,.3f}"
               if t.get("waiting") else ""))
        self._pay_fill()

    def _tab_addendums(self) -> QWidget:
        page = QWidget()
        page.setObjectName("transparentHost")
        layout = QVBoxLayout(page)
        layout.setContentsMargins(0, 8, 0, 0)
        layout.setSpacing(8)

        # ===== العنوان =====
        bar = QHBoxLayout()
        title_col = QVBoxLayout()
        title_col.setSpacing(2)
        self.add_value_lbl = QLabel("")
        self.add_value_lbl.setProperty("sectionTitle", True)
        title_col.addWidget(self.add_value_lbl)
        add_desc = QLabel("الأوامر التغييرية والعقود الإضافية المعتمدة والملغاة")
        add_desc.setProperty("pageDesc", True)
        title_col.addWidget(add_desc)
        bar.addLayout(title_col)
        bar.addWidget(self.add_value_lbl)
        bar.addStretch()
        add_exp_btn = QPushButton("📤")
        add_exp_btn.setObjectName("iconBtn")
        add_exp_btn.setToolTip("تصدير الأوامر التغييرية إلى Excel")
        add_exp_btn.setCursor(Qt.PointingHandCursor)
        add_exp_btn.clicked.connect(self._export_addendums)
        bar.addWidget(add_exp_btn)
        layout.addLayout(bar)

        # ===== تابان: العميل / المقاول =====
        self._adx_tabs = QTabWidget()
        self._adx_tabs.setLayoutDirection(Qt.RightToLeft)

        # --- تاب العميل ---
        cli_page = QWidget()
        cli_page.setObjectName("transparentHost")
        cli_lay = QVBoxLayout(cli_page)
        cli_lay.setContentsMargins(0, 4, 0, 0)
        cli_lay.setSpacing(6)
        cli_bar = QHBoxLayout()
        self._cli_add_btn = QPushButton("＋ أمر تغييري للعميل")
        self._cli_add_btn.setObjectName("btnReceipt")
        self._cli_add_btn.setToolTip("إضافة أو تعديل بند من جهة العميل")
        self._cli_add_btn.clicked.connect(
            lambda: self._add_addendum_side("client"))
        cli_bar.addStretch()
        cli_bar.addWidget(self._cli_add_btn)
        cli_lay.addLayout(cli_bar)
        self._cli_add_table = _make_table(
            ["الرقم", "النوع", "التاريخ", "السبب", "زيادة", "خصم",
             "الصافي", "بنود", "مُنفَّذ", "الحالة"])
        cli_lay.addWidget(self._cli_add_table, 1)
        self._adx_tabs.addTab(cli_page, "👤 العميل")

        # --- تاب المقاول ---
        sub_page = QWidget()
        sub_page.setObjectName("transparentHost")
        sub_lay = QVBoxLayout(sub_page)
        sub_lay.setContentsMargins(0, 4, 0, 0)
        sub_lay.setSpacing(6)
        sub_bar = QHBoxLayout()
        self._sub_add_btn = QPushButton("＋ أمر تغييري للمقاول")
        self._sub_add_btn.setObjectName("btnPrimary")
        self._sub_add_btn.setToolTip("إضافة أو تعديل بند من جهة المقاول")
        self._sub_add_btn.clicked.connect(
            lambda: self._add_addendum_side("sub"))
        sub_bar.addStretch()
        sub_bar.addWidget(self._sub_add_btn)
        sub_lay.addLayout(sub_bar)
        self._sub_add_table = _make_table(
            ["الرقم", "النوع", "المقاول", "التاريخ", "السبب", "زيادة", "خصم",
             "الصافي", "بنود", "الحالة"])
        sub_lay.addWidget(self._sub_add_table, 1)
        self._adx_tabs.addTab(sub_page, "🔨 المقاول")

        layout.addWidget(self._adx_tabs, 1)

        # ===== أزرار الاعتماد/الإلغاء =====
        btn_bar = QHBoxLayout()
        self.approve_addendum_btn = QPushButton("✔ اعتماد")
        self.approve_addendum_btn.setToolTip("اعتماد الملحق المحدد")
        self.approve_addendum_btn.setObjectName("btnReceipt")
        self.approve_addendum_btn.setVisible(False)
        self.cancel_addendum_btn = QPushButton("✕ إلغاء المحدد")
        self.cancel_addendum_btn.setToolTip("إلغاء الملحق المحدد")
        self.cancel_addendum_btn.setObjectName("btnDangerSoft")
        self.cancel_addendum_btn.setVisible(False)
        self.approve_addendum_btn.clicked.connect(self._approve_addendum)
        self.cancel_addendum_btn.clicked.connect(self._cancel_addendum)
        btn_bar.addStretch()
        btn_bar.addWidget(self.approve_addendum_btn)
        btn_bar.addWidget(self.cancel_addendum_btn)
        layout.addLayout(btn_bar)

        return page

    def _add_addendum_side(self, side: str):
        """يفتح نافذة الأمر التغييري مباشرة على الجهة المحددة."""
        from ui.addendum_dialog import open_change_order
        open_change_order(
            self, self.contract_id,
            default_side=side,
            on_saved=lambda: (self.refresh(), self.data_changed.emit())
        ).exec()

    # ============================================================
    def _add_addendum(self):
        """V5.4 ④: شاشة الأمر التغييري بتابين (عميل/مقاول) وبنود إضافة/حذف."""
        from ui.addendum_dialog import open_change_order
        open_change_order(
            self, self.contract_id,
            on_saved=lambda: (self.refresh(), self.data_changed.emit())
        ).exec()
        return

    def _approve_addendum(self):
        # V8.9: نقرأ من التاب النشط
        if self._adx_tabs.currentIndex() == 0:
            tbl = self._cli_add_table
            src = getattr(self, "_cli_adx_list", [])
        else:
            tbl = self._sub_add_table
            src = getattr(self, "_sub_adx_list", [])
        row = tbl.currentRow()
        if row < 0 or row >= len(src):
            style.info(self, "اختر ملحقًا من الجدول أولاً.")
            return
        addendum = src[row]
        if addendum["status"] == "معتمد":
            style.info(self, "الملحق معتمد بالفعل.")
            return
        if not style.confirm(
                self, f"اعتماد الملحق «{addendum['addendum_number']}»؟\n"
                "سيتم تحديث قيمة العقد الحالية تلقائيًا."):
            return
        lc.approve_addendum(addendum["id"])
        self.refresh()
        self.data_changed.emit()


    def _cancel_addendum(self):
        # V8.9: نقرأ من التاب النشط
        if self._adx_tabs.currentIndex() == 0:
            tbl = self._cli_add_table
            src = getattr(self, "_cli_adx_list", [])
        else:
            tbl = self._sub_add_table
            src = getattr(self, "_sub_adx_list", [])
        row = tbl.currentRow()
        if row < 0 or row >= len(src):
            style.info(self, "اختر ملحقًا من الجدول أولاً.")
            return
        addendum = src[row]
        if addendum["status"] == "ملغى":
            style.info(self, "الملحق ملغى بالفعل.")
            return
        from PySide6.QtWidgets import QInputDialog
        reason, ok = QInputDialog.getText(
            self, "سبب إلغاء الملحق / الأمر التغييري",
            "اكتب سبب الإلغاء / التوضيح الذي سيظهر في سجل العقد:")
        if not ok:
            return
        if not style.confirm(self, f"إلغاء «{addendum['addendum_number']}»؟"):
            return
        lc.cancel_addendum(addendum["id"], reason)
        self.refresh()
        self.data_changed.emit()

    # ==================== خطة السداد ====================
    def _add_voucher(self, vtype: str):
        from ui.actions import open_voucher
        open_voucher(self, vtype, contract_id=self.contract_id,
                     on_saved=lambda: (self.refresh(), self.data_changed.emit()))

    def _add_voucher_here(self, vtype: str, sub_id: int | None = None,
                          sc_id: int | None = None):
        """V6.4: أزرار السندات في تاب الدفعات.

        «＋ سند قبض» في الشريط العلوي (يخص العميل) · «＋ سند صرف» في رأس كتلة
        كل مقاول فتُعبَّأ بياناته تلقائيًا؛ وإن لم يُمرَّر مقاول نأخذ المحدد
        في جدول المقاولين.
        """
        from ui.actions import open_voucher
        kw = {"contract_id": self.contract_id,
              "on_saved": lambda: (self.refresh(), self.data_changed.emit())}
        if vtype == "payment":
            _sub = int(sub_id or 0)
            _sc = int(sc_id or 0)
            if not _sc:
                for t in (getattr(self, "sub_tables", None)
                          or ([self.sub_table] if self.sub_table else [])):
                    try:
                        _r = t.currentRow()
                        _it = t.item(_r, 0) if _r >= 0 else None
                    except Exception:
                        _it = None
                    if _it is None:
                        continue
                    if _it.data(Qt.UserRole):
                        _sub = int(_it.data(Qt.UserRole))
                    if _it.data(Qt.UserRole + 1):
                        _sc = int(_it.data(Qt.UserRole + 1))
                    break
            if _sub:
                kw["subcontractor_id"] = _sub
            if _sc:
                kw["sub_contract_id"] = _sc
        open_voucher(self, vtype, **kw)


    def _statement_pdf(self):
        import tempfile
        from reports.statement_pdf import generate_statement_pdf
        from ui.pdf_preview import PdfPreviewDialog, make_temp_pdf_path
        contract = self._ctx.get("contract", {})
        try:
            path = make_temp_pdf_path(
                f"statement_{contract.get('contract_number', self.contract_id)}")
            generate_statement_pdf(self.contract_id, path)
            PdfPreviewDialog(self, path, "كشف حساب العقد",
                             os.path.basename(path)).exec()
        except Exception as exc:
            style.error(self, f"تعذر إنشاء كشف الحساب:\n{exc}")

    def _choose_contract_template(self) -> dict | None:
        from services import word_service
        try:
            templates = word_service.templates_for_contract(self.contract_id)
        except Exception:
            templates = []
        if not templates:
            style.info(self, "لا توجد قوالب عقود Word. ارفع قالبًا من مركز النماذج أولًا.")
            return None
        if len(templates) == 1:
            return templates[0]
        dlg = QDialog(self)
        dlg.setWindowTitle("اختيار قالب العقد")
        dlg.setLayoutDirection(Qt.RightToLeft)
        dlg.resize(620, 390)
        lay = QVBoxLayout(dlg)
        table = QTableWidget(len(templates), 3, dlg)
        table.setHorizontalHeaderLabels(["القالب", "النطاق", "المسار"])
        table.verticalHeader().setVisible(False)
        table.setSelectionBehavior(QTableWidget.SelectRows)
        table.setEditTriggers(QTableWidget.NoEditTriggers)
        from ui.widgets import apply_column_weights
        apply_column_weights(table, [36, 20, 44], min_widths=[160, 100, 200])
        for r, tpl in enumerate(templates):
            for c, val in enumerate([tpl.get("name"), tpl.get("scope"), tpl.get("path")]):
                table.setItem(r, c, QTableWidgetItem(str(val or "")))
        lay.addWidget(QLabel("اختر القالب المطلوب استخدامه لهذا العقد:"))
        lay.addWidget(table, 1)
        row = QHBoxLayout(); row.addStretch()
        cancel = QPushButton("✕ إلغاء"); cancel.setProperty("flat", True)
        ok = QPushButton("اختيار"); ok.setObjectName("btnPrimary")
        row.addWidget(cancel); row.addWidget(ok); lay.addLayout(row)
        cancel.clicked.connect(dlg.reject); ok.clicked.connect(dlg.accept)
        table.itemDoubleClicked.connect(lambda *_: dlg.accept())
        table.setCurrentCell(0, 0)
        if dlg.exec() != QDialog.Accepted or table.currentRow() < 0:
            return None
        return templates[table.currentRow()]

    def _generate_contract_document(self):
        """اختيار قالب وتجهيز مستند العقد من منطقة إجراءات المراحل بلا الحاجة لتاب مستقل."""
        tpl = self._choose_contract_template()
        if not tpl:
            return
        contract = self._ctx.get("contract", {})
        name = (contract.get("contract_name") or contract.get("description") or "عقد")
        safe = "".join(ch for ch in name if ch not in '\\/:*?"<>|')[:40]
        default = os.path.join(os.path.expanduser("~"), f"{safe}.docx")
        from PySide6.QtWidgets import QFileDialog
        path, selected_filter = QFileDialog.getSaveFileName(
            self, "حفظ مستند العقد", default, "Word (*.docx);;PDF (*.pdf)")
        if not path:
            return
        wants_pdf = "PDF" in (selected_filter or "") or path.lower().endswith(".pdf")
        try:
            from services import word_service
            if wants_pdf:
                if not path.lower().endswith(".pdf"):
                    path += ".pdf"
                import tempfile
                tmp_docx = os.path.join(tempfile.gettempdir(), f"contract_{self.contract_id}_{os.getpid()}.docx")
                word_service.fill_template(tpl["path"], self.contract_id, tmp_docx)
                word_service.word_to_pdf(tmp_docx, path)
            else:
                if not path.lower().endswith(".docx"):
                    path += ".docx"
                word_service.fill_template(tpl["path"], self.contract_id, path)
        except Exception as exc:
            style.error(self, str(exc))
            return
        lc.log_event(self.contract_id, "اختيار نموذج العقد", f"من قالب: {tpl['name']} · {'PDF' if wants_pdf else 'Word'}")
        style.info(self, f"تم توليد المستند:\n{path}", "تم")
        try:
            from ui.invoices import open_file_externally
            open_file_externally(path)
        except Exception:
            pass

    def _batch_print_contract(self):
        import re as _re
        from PySide6.QtWidgets import QFileDialog
        from services.batch_print_service import batch_export
        contract = self._ctx.get("contract", {})
        items = [{"kind": "statement", "contract_id": self.contract_id,
                  "contract_number": contract.get("contract_number", ""),
                  "label": "كشف الحساب"}]
        for v in lc.list_vouchers(contract_id=self.contract_id):
            items.append({"kind": "voucher", "voucher": v,
                          "label": v["voucher_number"]})
        from services import feature_service as _feat13inv
        _inv13 = (invoice_service.list_invoices(contract_id=self.contract_id)
                  if _feat13inv.enabled("invoices") else [])
        for inv in _inv13:
            items.append({"kind": "invoice", "invoice": inv,
                          "label": inv.invoice_number})
        folder = QFileDialog.getExistingDirectory(
            self, "اختر مجلد حفظ مستندات العقد")
        if not folder:
            return
        name = (contract.get("contract_name")
                or contract.get("description") or "العقد")
        safe = _re.sub(r'[\\/:*?"<>|]', "_", name)[:40]
        out_dir = os.path.join(folder, f"مستندات_{safe}")
        done, failed = batch_export(items, out_dir)
        msg = f"تم توليد {len(done)} مستندًا في:\n{out_dir}"
        if failed:
            msg += f"\n\nفشل: {len(failed)} · {', '.join(failed[:5])}"
        style.info(self, msg, "الطباعة الدفعية")
        from ui.invoices import open_file_externally
        open_file_externally(out_dir)

    # ==================== السجل الزمني ====================


    # ==================== التحديث الشامل ====================
    def _waive_supervision(self):
        from services.supervision_service import (supervision_status,
                                                  waive_extension_months)
        st = supervision_status(self.contract_id)
        if not st:
            return
        can = st["unpaid_extension_months"]
        if can <= 0.001:
            style.info(self, "كل أشهر التمديد تمت مخالصتها بالسداد · "
                       "لا يوجد ما يُلغى.")
            return
        if not style.require_admin(self, "إلغاء أشهر تمديد إشراف",
                                   perm="action_supervision_waive"):
            return
        from PySide6.QtWidgets import (QDialog, QDialogButtonBox, QDoubleSpinBox,
                                       QFormLayout, QLabel, QTextEdit)
        paid_ext = st["extension_value"] - st["unpaid_extension_value"]
        dlg = QDialog(self)
        dlg.setWindowTitle("إلغاء مدة إشراف")
        dlg.setLayoutDirection(Qt.RightToLeft)
        form = QFormLayout(dlg)
        info = (f"أشهر التمديد المحسوبة: {st['billable_extension']:g} "
                f"(قيمة الشهر {st['monthly']:,.3f})\n")
        if paid_ext > 0.001:
            info += (f"سدد العميل منها: {paid_ext:,.3f} "
                     f"({paid_ext / st['monthly']:g} شهر)\n")
        info += f"المتاح للإلغاء (غير المسدد): {can:g} شهر"
        lbl = QLabel(info)
        lbl.setWordWrap(True)
        form.addRow(lbl)
        months_w = QDoubleSpinBox()
        months_w.setRange(0.5, float(can))
        months_w.setSingleStep(0.5)
        months_w.setDecimals(1)
        months_w.setValue(float(can))
        reason_w = QTextEdit()
        reason_w.setFixedHeight(80)
        reason_w.setPlaceholderText("سبب الإلغاء / التوضيح الذي سيظهر في تقرير الإشراف...")
        form.addRow("المدة الملغاة:", months_w)
        form.addRow("سبب الإلغاء:", reason_w)
        bb = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        bb.button(QDialogButtonBox.Ok).setText("تأكيد الإلغاء")
        bb.button(QDialogButtonBox.Cancel).setText("إلغاء")
        bb.accepted.connect(dlg.accept)
        bb.rejected.connect(dlg.reject)
        form.addRow(bb)
        if dlg.exec() != QDialog.Accepted:
            return
        months = months_w.value()
        reason = reason_w.toPlainText().strip()
        if not style.confirm(
                self,
                f"إلغاء {months:g} شهر تمديد بقيمة "
                f"{months * st['monthly']:,.3f}؟\n"
                "سيُخصم من مديونية العميل نهائيًا ويُسجل في سجل العقد."):
            return
        try:
            new_st = waive_extension_months(self.contract_id, months, reason)
            style.info(self, "تم الإلغاء.\n"
                       f"المتبقي على العميل الآن: {new_st['remaining']:,.3f}",
                       "تمت المخالصة")
            self.refresh()
            self.data_changed.emit()
            return True
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
            return False

    def _settle_contract(self):
        dash = self._ctx.get("dash", {})
        cur = self._ctx.get("cur", "")
        warn_note = "يمكنك إعادة فتحه لاحقًا من صفحة البيانات إذا لزم."
        try:
            from services.extras_service import contract_sub_dues
            sd = contract_sub_dues(self.contract_id)
            if sd["count"]:
                warn_note += (
                    f"\n⚠ تنبيه: توجد {sd['count']} دفعة باطن مستحقة غير مدفوعة "
                    f"بإجمالي {sd['unpaid']:,.3f} {cur} — إغلاق العقد لا يسقطها.")
        except Exception:
            pass
        if not style.confirm_financial(
                self, "تصفية وإغلاق العقد",
                "تصفية العقد وإغلاقه نهائيًا؟",
                [("القيمة الحالية",
                  f"{dash.get('current_value', 0):,.3f} {cur}"),
                 ("المحصّل", f"{dash.get('total_receipts', 0):,.3f} {cur}"),
                 ("المتبقي",
                  f"{dash.get('current_value', 0) - dash.get('total_receipts', 0):,.3f} {cur}")],
                note=warn_note):
            return
        try:
            from services.extras_service import close_contract
            close_contract(self.contract_id)
            style.info(self, "تم إغلاق العقد · تصفية كاملة ✅", "تم")
            self.refresh()
            self.data_changed.emit()
            return True
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
            return False

    # ==================== التحديث الكسول ====================
    _SECTIONS = ("info", "pay", "addendums")

    def _current_key(self) -> str:
        idx = self.stack.currentIndex()
        for key, i in self._page_index.items():
            if i == idx:
                return key
        return "info"

    def refresh(self, only_current: bool = True):
        if not self.contract_id:
            return
        try:
            dash = lc.contract_dashboard(self.contract_id)
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
            return
        contract = dash["contract"]
        cur = contract.get("currency") or settings_service.get_settings().currency
        self._ctx = {"dash": dash, "contract": contract, "cur": cur,
                     "tl": dash["timeline"],
                     "status": contract.get("status") or "نشط"}
        self._refresh_header()
        self._refresh_side_comments()
        # عقد الإشراف الشهري لا يحتاج تاب الأوامر التغييرية؛ تمديد الإشراف
        # يظهر في ملخص العقد كسطر مستقل بنفس منطق الزيادة على القيمة.
        try:
            from services import contract_service as _contract_service
            is_supervision = _contract_service.is_supervision_contract(contract)
        except Exception:
            is_supervision = bool(str(contract.get("sup_start_date") or "").strip())

        add_btn = getattr(getattr(self, "nav", None), "buttons", {}).get("addendums")
        if add_btn is not None:
            add_btn.setVisible(not is_supervision)
            if add_btn.parentWidget() is not None:
                add_btn.parentWidget().setVisible(not is_supervision)
        if is_supervision and self._current_key() == "addendums":
            self.nav.select("info")
            self.stack.setCurrentIndex(self._page_index["info"])

        # V4.5.06: تاب الدفعات والبنود موحد ودائم — لا إخفاء شرطي.
        self._dirty = {k: True for k in self._SECTIONS
                       if k in getattr(self, "_enabled_keys", self._SECTIONS)}
        if only_current:
            self._refresh_section(self._current_key())
        else:
            for key in self._SECTIONS:
                self._refresh_section(key)

    def _sec_info(self):
        self._sec_dashboard()
        if hasattr(self, "followup_panel"):
            self._sec_followup_panel()

    def _sec_followup_panel(self):
        try:
            self.followup_panel.refresh()
        except Exception:
            pass

    def _followup_changed(self):
        """تحديث مركز العقد بعد تغيير مرحلة التنفيذ من اللوحة اليسرى."""
        try:
            self._dirty = {k: True for k in self._SECTIONS
                           if k in getattr(self, "_enabled_keys", self._SECTIONS)}
            if self._ctx:
                self.refresh(only_current=True)
            self.data_changed.emit()
        except Exception:
            # لا نكسر فتح ملف العميل إذا صدر حدث من لوحة المراحل قبل اكتمال تحميل العقد.
            pass

    def _refresh_section(self, key: str):
        key = {
            "dashboard": "info", "overview": "info", "summary": "info",
            "info": "info", "followup": "info", "timeline": "info",
            "money": "addendums",
            "addendums": "addendums", "financial": "addendums",
            # V4.5.06: خطة السداد والمقارنة والباطن والبنود كلها في تاب واحد
            "plan": "pay", "compare": "pay", "subs": "pay",
            "items": "pay", "comments": "info",
        }.get(key, key)
        if not self._ctx:
            return
        if key not in getattr(self, "_enabled_keys", {key}):
            return
        if not getattr(self, "_dirty", {}).get(key, True):
            return
        fn = getattr(self, "_sec_" + key, None)
        if fn is None:
            return
        fn()
        self._dirty[key] = False

    def _refresh_header(self):
        contract = self._ctx["contract"]
        cur = self._ctx["cur"]
        dash = self._ctx["dash"]
        name = (contract.get("contract_name")
                or contract.get("description") or "")
        status = contract.get("status") or "نشط"
        self.header.set_title(name or "عقد بلا اسم",
                              tooltip=contract["contract_number"])
        ctype = contract.get("contract_type") or "غير محدد"
        self.header.set_subtitle(
            f"العميل: {contract['customer_name']}   |   النوع: {ctype}")
        self.header.clear_badges()
        self.header.add_badge(status, STATUS_COLORS.get(status, style.NEUTRAL))
        remaining = dash["current_value"] - dash["total_receipts"]
        if remaining > 0.001:
            _late = any(
                i["remaining"] > 0.001 and i["days_diff"] < 0
                for i in lc.contract_payment_plan(self.contract_id))
            self.header.add_badge(f"متبقٍ {remaining:,.3f} {cur}",
                                  style.DANGER if _late else style.WARN)
        else:
            self.header.add_badge("محصّل بالكامل", style.OK_GREEN)

    def _open_customer_file(self):
        from services import customer_service
        from ui.widgets import find_host
        cid = self._ctx.get("contract", {}).get("customer_id")
        cust = customer_service.get_customer(cid) if cid else None
        if not cust:
            style.error(self, "تعذر العثور على بيانات العميل.")
            return
        host = find_host(self, "is_customer_file")
        if host is not None and getattr(
                getattr(host, "customer", None), "id", None) == cid:
            self.back_requested.emit()  # تم التغيير هنا
            return
        main = find_host(self, "open_customer_page")
        self.back_requested.emit()  # تم التغيير هنا
        if main is not None:
            QTimer.singleShot(0, lambda: main.open_customer_page(cid))
            return
        from ui.archive import CustomerArchiveDialog
        CustomerArchiveDialog(self.parent(), cust).exec()

    # ... (باقي دوال _sec_* تبقى كما هي في الكود الأصلي لأنها لا تتأثر بالتحويل) ...
    def _sec_dashboard(self):
        dash = self._ctx["dash"]
        contract = self._ctx["contract"]
        cur = self._ctx["cur"]
        tl = self._ctx["tl"]
        fmt = lambda v: f"{v:,.3f} {cur}"
        self._dash["original"].setText(fmt(dash["original_value"]))
        try:
            price = contract_service.contract_pricing(contract)
            if price["has_qty"]:
                self._dash["original"].setToolTip(price["text"])
                self.pricing_lbl.setText(price["text"])
                self.pricing_lbl.setVisible(True)
            else:
                self._dash["original"].setToolTip("")
                self.pricing_lbl.setVisible(False)
        except Exception:
            self.pricing_lbl.setVisible(False)
        self._dash["addendums"].setText(f"{dash['addendums_net']:+,.3f} {cur}")
        if "sup_extension" in self._dash:
            sup_ext = float(dash.get("sup_extension") or 0)
            self._dash["sup_extension"].setText(
                f"{sup_ext:+,.3f} {cur}" if abs(sup_ext) > 0.001 else f"0.000 {cur}")
            self._dash["sup_extension"].setToolTip(
                "يعامل كزيادة مستحقة على قيمة العقد بسبب تأخير/تمديد الإشراف")
        self._dash["current"].setText(fmt(dash["current_value"]))
        self._dash["receipts"].setText(fmt(dash["total_receipts"]))
        to_collect = dash["current_value"] - dash["total_receipts"]
        self._dash["to_collect"].setText(fmt(to_collect))
        late = 0
        try:
            for item in lc.contract_payment_plan(self.contract_id):
                if item["remaining"] > 0.001 and item["days_diff"] < 0:
                    late = max(late, -int(item["days_diff"]))
        except Exception:
            late = 0
        if to_collect <= 0.001:
            _c = style.MONEY_IN
        elif late:
            _c = style.MONEY_OVERDUE
        else:
            _c = style.MONEY_REMAIN
        self._dash["to_collect"].setStyleSheet(
            "font-size: 13.6px; font-weight: 800; background: transparent;"
            f"color: {_c};")
        self._dash["to_collect"].setToolTip(
            f"عليه دفعة متأخرة منذ {late} يومًا" if late else "")
        self._dash["payments"].setText(fmt(dash["total_payments"]))
        self._dash["subs"].setText(fmt(dash["total_subs"]))
        from services import auth_service as _auth
        profit = dash["profit"]
        expected_profit = dash.get("expected_profit", 0.0)
        can_profit = _auth.has_permission("action_view_financial")
        if can_profit:
            self._dash["profit"].setText(fmt(profit))
            self._dash["profit"].setToolTip("الفعلي = إجمالي المحصل - إجمالي المنصرف")
            self._dash["profit"].setStyleSheet(
                f"font-size: 13.6px; font-weight: 800; background: transparent;"
                f"color: {style.GREEN if profit >= 0 else style.RED};")
            if "expected_profit" in self._dash:
                self._dash["expected_profit"].setText(fmt(expected_profit))
                self._dash["expected_profit"].setToolTip(
                    "المتوقع = إجمالي العقد - عقود الباطن - المنصرف الآخر عليه")
                self._dash["expected_profit"].setStyleSheet(
                    f"font-size: 13.6px; font-weight: 800; background: transparent;"
                    f"color: {style.GREEN if expected_profit >= 0 else style.RED};")
        else:
            self._dash["profit"].setText("—")
            self._dash["profit"].setToolTip("رؤية الربحية غير متاحة لحسابك")
            if "expected_profit" in self._dash:
                self._dash["expected_profit"].setText("—")
        # V3.25-26: بلا صلاحية ربحية ← الصفوف تختفي تمامًا (لا حتى "—")
        for _k in ("payments", "profit", "expected_profit"):
            if _k in self._dash:
                self._dash[_k].setVisible(can_profit)
                if _k in self._dash_labels:
                    self._dash_labels[_k].setVisible(can_profit)
        current = dash["current_value"] or 0.0
        collected_pct = (dash["total_receipts"] / current * 100.0
                         if current > 0.001 else 0.0)
        self.collect_bar.setValue(int(min(100, max(0, collected_pct))))
        time_pct = float(tl["percent"] or 0)
        gap = time_pct - collected_pct
        if current <= 0.001:
            self.pace_lbl.setText("")
            self.pace_lbl.setToolTip("")
        elif gap > 15:
            self.pace_lbl.setText(
                f"⚠ التحصيل متأخر · الزمن {time_pct:.0f}% / التحصيل {collected_pct:.0f}%")
            self.pace_lbl.setToolTip(
                f"الفارق {gap:.0f} نقطة · المحصّل {dash['total_receipts']:,.3f} من {current:,.3f}")
            self.pace_lbl.setStyleSheet(
                f"font-weight: 700; background: transparent; color: {style.RED};")
        else:
            self.pace_lbl.setText(
                f"التحصيل متوازن · الزمن {time_pct:.0f}% / التحصيل {collected_pct:.0f}%")
            self.pace_lbl.setToolTip(
                f"المحصّل {dash['total_receipts']:,.3f} من {current:,.3f}")
            self.pace_lbl.setStyleSheet(
                "font-weight: 700; background: transparent; "
                f"color: {style.GREEN};")
        self._dash["cdate"].setText(contract.get("contract_date") or "-")
        self._dash["start"].setText(contract.get("start_date") or "-")
        self._dash["end"].setText(contract.get("end_date") or "-")
        self._dash["duration"].setText(f"{tl['duration']} يوم" if tl["duration"] else "-")
        self._dash["elapsed"].setText(f"{tl['elapsed']} يوم")
        self._dash["remaining"].setText(f"{tl['remaining']} يوم")
        self._dash["tstatus"].setText(tl["time_status"])
        self.progress.setValue(int(tl["percent"]))

        try:
            from services.supervision_service import supervision_status
            sup = supervision_status(self.contract_id)
        except Exception:
            sup = None
        self.sup_card.setVisible(sup is not None)
        if sup:
            lines = [
                f"بداية الإشراف: {sup['start']}  |  "
                f"نهاية الإشراف الفعلية: {sup.get('actual_end') or 'لم تُسجل بعد'}",
                f"المدة: {sup['months']} شهر × {sup['monthly']:,.3f} = "
                f"{sup.get('gross_value', sup['base_value']):,.3f}"
                f"{(' · خصم ' + format(sup.get('discount', 0), ',.3f')) if sup.get('discount') else ''}"
                f"  |  صافي الأساس: {sup['base_value']:,.3f}  |  "
                f"نهاية المدة: {sup['base_end']}",
                f"الوضع الزمني: {sup['time_left_text']}",
            ]
            if sup["extension_value"] > 0.001:
                paid_ext = sup["extension_value"] - sup["unpaid_extension_value"]
                ext_line = (f"تمديد مستحق: {sup['billable_extension']:g} شهر "
                            f"= {sup['extension_value']:,.3f}")
                if paid_ext > 0.001:
                    ext_line += f"  (سُدد منها {paid_ext:,.3f})"
                if sup["waived_months"]:
                    ext_line += f"  · مُلغى بتنازل: {sup['waived_months']:g} شهر"
                lines.append(ext_line)
            lines.append(
                f"المستحق الكلي: {sup['total_due']:,.3f}  |  "
                f"المحصّل: {sup['collected']:,.3f}  |  "
                f"المتبقي: {sup['remaining']:,.3f}")
            self.sup_info_lbl.setText("\n".join(lines))
            if hasattr(self, "stage_waive_btn"):
                self.stage_waive_btn.setVisible(sup["unpaid_extension_months"] > 0.001)
        elif hasattr(self, "stage_waive_btn"):
            self.stage_waive_btn.setVisible(False)

        try:
            from services.extras_service import contract_settlement
            settle = contract_settlement(self.contract_id)
            stages_done = bool(settle.get("stages_complete"))
            stage_required = bool(settle.get("stage_required"))
            # زر التصفية يظهر بعد اكتمال مسار المراحل في كل العقود.
            # أما التنفيذ نفسه فيبقى محميًا بقاعدة التحصيل الكامل داخل
            # extras_service.close_contract، فلا تتغير القواعد المالية.
            show_settle_action = stages_done and (
                stage_required or bool(settle.get("fully_collected")))
            if settle["closable"]:
                self.settle_lbl.setText(
                    "✅ اكتمل تحصيل كامل قيمة العقد "
                    f"({settle['collected']:,.3f} {cur}) · "
                    "ومسار المراحل مكتمل. يمكنك الآن تصفيته وإغلاقه.")
                if hasattr(self, "stage_settle_btn"):
                    self.stage_settle_btn.setVisible(True)
                    self.stage_settle_btn.setEnabled(True)
                    self.stage_settle_btn.setToolTip("جاهز للتصفية والإغلاق")
                self.settle_card.setVisible(True)
            elif show_settle_action and not settle.get("fully_collected"):
                self.settle_lbl.setText(
                    "✅ مسار المراحل مكتمل. سيُتاح الإغلاق النهائي بعد تحصيل "
                    f"المتبقي: {settle.get('remaining', 0):,.3f} {cur}.")
                if hasattr(self, "stage_settle_btn"):
                    self.stage_settle_btn.setVisible(True)
                    self.stage_settle_btn.setEnabled(False)
                    self.stage_settle_btn.setToolTip(
                        f"المراحل مكتملة، لكن يوجد متبقٍ: {settle.get('remaining', 0):,.3f} {cur}")
                self.settle_card.setVisible(True)
            elif settle.get("fully_collected") and stage_required and not stages_done:
                self.settle_lbl.setText(
                    "✅ التحصيل مكتمل، لكن الإغلاق النهائي ينتظر اكتمال مسار المراحل.")
                if hasattr(self, "stage_settle_btn"):
                    self.stage_settle_btn.setVisible(False)
                self.settle_card.setVisible(True)
            else:
                if hasattr(self, "stage_settle_btn"):
                    self.stage_settle_btn.setVisible(False)
                self.settle_card.setVisible(False)
        except Exception:
            if hasattr(self, "stage_settle_btn"):
                self.stage_settle_btn.setVisible(False)
            self.settle_card.setVisible(False)

    def _fill_info_editor(self):
        contract = self._ctx["contract"]
        cur = self._ctx["cur"]
        status = self._ctx["status"]
        from services import contract_type_service as _cts
        ctype = (contract.get("contract_type") or _cts.UNSPECIFIED).strip()
        names = [t["name"] for t in _cts.list_types()]
        if _cts.UNSPECIFIED not in names:
            names.insert(0, _cts.UNSPECIFIED)
        if ctype and ctype not in names:
            names.insert(0, ctype)
        self.f_type.blockSignals(True)
        self.f_type.clear()
        self.f_type.addItems(names)
        idx_type = self.f_type.findText(ctype)
        self.f_type.setCurrentIndex(idx_type if idx_type >= 0 else 0)
        self.f_type.blockSignals(False)
        self.f_name.setText(ctype or _cts.UNSPECIFIED)
        for widget, key in ((self.f_sign, "sign_date"), (self.f_start, "start_date"),
                            (self.f_end, "end_date")):
            val = contract.get(key) or ""
            if val:
                widget.setDate(QDate.fromString(val, "yyyy-MM-dd"))
            else:
                widget.setDate(widget.minimumDate())
        status = (status or "نشط").strip()
        legacy_map = {"معطل": "متوقف", "معطلة": "متوقف", "موقوف": "متوقف", "موقوفة": "متوقف"}
        status = legacy_map.get(status, status)
        idx = self.f_status.findText(status)
        if idx >= 0:
            self.f_status.setCurrentIndex(idx)
        else:
            self.f_status.setCurrentText("نشط")
        self.f_status.setEnabled(True)
        self.f_currency.setText(cur)

        from services import supervision_service as _sup
        st = None
        try:
            st = _sup.supervision_status(self.contract_id)
        except Exception:
            st = None
        self._is_sup_contract = st is not None
        # V4.0: صفوف الإشراف تظهر أيضًا لمن يملك مدة محفوظة أو قالبًا
        # فيه مراحل إشرافية — لضبط المدة والقيمة قبل بدء التعهد.
        # (قفل تواريخ العقد يبقى للتعهد النشط فقط.)
        _has_months = int(contract.get("sup_months") or 0) > 0
        _tpl_has_sup = False
        try:
            from services import workflow_service as _wf4
            _tpl_has_sup = bool(_wf4.template_has_supervision(
                _wf4.resolve_scope(_wf4.TX_CONTRACT, self.contract_id)))
        except Exception:
            _tpl_has_sup = False
        self._sup_rows_shown = bool(
            self._is_sup_contract or _has_months or _tpl_has_sup)
        self._set_sup_rows_visible(self._sup_rows_shown)
        for _w in (self.f_start, self.f_end):
            _w.setEnabled(not self._is_sup_contract)
            _w.setToolTip("يُحدَّد تلقائيًا من مرحلة بداية الإشراف" if self._is_sup_contract else "")
        if st:
            self.f_sup_start.setDate(
                QDate.fromString(st["start"], "yyyy-MM-dd"))
            self.f_sup_months.setValue(int(st["months"]))
            self.f_sup_monthly.setValue(float(st["monthly"]))
            self.f_sup_discount.setValue(float(st.get("discount", 0) or 0))
            self.f_sup_hint.setText(
                f"المدة الأساسية تنتهي في {st['base_end']} · "
                f"الإجمالي {st.get('gross_value', st['base_value']):,.3f} · الخصم {st.get('discount', 0):,.3f} · "
                f"الصافي {st['base_value']:,.3f} · "
                "تعديل التعهد يعيد حساب المدة والتمديد تلقائيًا")
        elif _has_months:
            # V4.0: مدة محفوظة بلا تعهد بدأ — تعبئة من العقد.
            self.f_sup_months.setValue(int(contract.get("sup_months") or 0))
            self.f_sup_monthly.setValue(float(contract.get("sup_monthly") or 0))
            self.f_sup_discount.setValue(float(contract.get("sup_discount") or 0))
            self.f_sup_hint.setText(
                "المدة والقيمة محفوظتان — تبدأ نوافذ التعهد عند إنهاء "
                "مرحلة بداية الإشراف.")
        else:
            # V4.1: شامل بلا مدة — تعبئة من بطاقة الإشراف في اللقطة
            # (ترحيل عقود V3.30) · الحفظ يفعّل التعهد.
            try:
                from services import contract_service as _cs41h
                _snap41h = _cs41h.get_contract_components(self.contract_id)
            except Exception:
                _snap41h = []
            _sup41h = [c for c in _snap41h if c.get("kind") == "supervision"
                       and c.get("enabled")
                       and int(c.get("months") or 0) > 0
                       and float(c.get("monthly") or 0) > 0]
            if _sup41h:
                self.f_sup_months.setValue(int(_sup41h[0]["months"]))
                self.f_sup_monthly.setValue(float(_sup41h[0]["monthly"]))
                self.f_sup_discount.setValue(0.0)
                self.f_sup_hint.setText(
                    "القيم من بطاقة الإشراف — احفظ لتفعيل التعهد.")

    def _sec_addendums(self):
        dash = self._ctx["dash"]
        cur = self._ctx["cur"]
        self._addendums = lc.list_addendums(self.contract_id)
        from ui.widgets import MONEY_ALIGN
        # فصل الأوامر حسب الجهة
        cli_adx = []
        sub_adx = []
        for a in self._addendums:
            _c = int(a.get("client_parts") or 0)
            _s = int(a.get("sub_parts") or 0)
            if _c:
                cli_adx.append(a)
            if _s:
                sub_adx.append(a)

        self._cli_adx_list = cli_adx
        self._sub_adx_list = sub_adx

        # --- جدول العميل ---
        if hasattr(self, "_cli_add_table"):
            self._cli_add_table.setRowCount(len(cli_adx))
            for r, a in enumerate(cli_adx):
                net = a["amount_add"] - a["amount_deduct"]
                atype = a.get("addendum_type") or "أمر تغييري"
                values = [a["addendum_number"], atype, a["adate"],
                          a["reason"],
                          f"{a['amount_add']:,.3f}", f"{a['amount_deduct']:,.3f}",
                          f"{net:+,.3f}", str(int(a.get("items_count") or 0)),
                          ("✔ " + (a.get("applied_at") or "")) if a.get("applied_at")
                          else "—",
                          a["status"]]
                for col, val in enumerate(values):
                    item = QTableWidgetItem(str(val))
                    item.setTextAlignment(
                        MONEY_ALIGN if col in (4, 5, 6) else Qt.AlignCenter)
                    if col == 1:
                        item.setForeground(QColor(
                            style.ACCENT if atype == "عقد إضافي" else style.WARN))
                    elif col == 6:
                        item.setForeground(QColor(style.GREEN if net >= 0 else style.RED))
                    elif col == 9:
                        item.setForeground(QColor(STATUS_COLORS.get(
                            a["status"], style.STATUS_DEFAULT)))
                    self._cli_add_table.setItem(r, col, item)

        # --- جدول المقاول ---
        if hasattr(self, "_sub_add_table"):
            self._sub_add_table.setRowCount(len(sub_adx))
            for r, a in enumerate(sub_adx):
                net = a["amount_add"] - a["amount_deduct"]
                atype = a.get("addendum_type") or "أمر تغييري"
                _sub_name = ""
                try:
                    _sid = int(a.get("sub_contract_id") or 0)
                    if _sid:
                        _sc = lc.get_sub_contract(_sid)
                        _sub_name = (_sc.get("sub_name") or "").strip()
                except Exception:
                    pass
                values = [a["addendum_number"], atype, _sub_name or "—",
                          a["adate"], a["reason"],
                          f"{a['amount_add']:,.3f}", f"{a['amount_deduct']:,.3f}",
                          f"{net:+,.3f}", str(int(a.get("items_count") or 0)),
                          a["status"]]
                for col, val in enumerate(values):
                    item = QTableWidgetItem(str(val))
                    item.setTextAlignment(
                        MONEY_ALIGN if col in (5, 6, 7) else Qt.AlignCenter)
                    if col == 1:
                        item.setForeground(QColor(
                            style.ACCENT if atype == "عقد إضافي" else style.WARN))
                    elif col == 7:
                        item.setForeground(QColor(style.GREEN if net >= 0 else style.RED))
                    elif col == 9:
                        item.setForeground(QColor(STATUS_COLORS.get(
                            a["status"], style.STATUS_DEFAULT)))
                    self._sub_add_table.setItem(r, col, item)

        # أزرار الاعتماد/الإلغاء
        self.approve_addendum_btn.setVisible(
            any(a["status"] not in ("معتمد", "ملغى") for a in self._addendums))
        if hasattr(self, "cancel_addendum_btn"):
            self.cancel_addendum_btn.setVisible(
                any(a["status"] != "ملغى" for a in self._addendums))
        self.add_value_lbl.setText(
            f"الأصلية: {dash['original_value']:,.3f} + ملحقات: "
            f"{dash['addendums_net']:+,.3f} = الحالية: {dash['current_value']:,.3f} {cur}")


