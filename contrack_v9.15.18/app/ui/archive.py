# -*- coding: utf-8 -*-
"""ملف العميل · كل شيء عن العميل في شاشة واحدة.

الصفحات: نظرة عامة | العقود وتفاصيلها
التعليقات زر سريع للكتابة فقط، ومركز التعليقات للعرض والبحث.
"""
import os
import subprocess
import sys

from PySide6.QtCore import QRect, QSize, Qt, QTimer, Signal
from PySide6.QtGui import QColor, QFont, QTextOption
from PySide6.QtWidgets import (
    QComboBox, QDialog, QFileDialog, QFrame, QGridLayout, QHBoxLayout, QLabel,
    QTextEdit,
    QHeaderView, QLineEdit, QListWidget, QListWidgetItem, QPushButton, QScrollArea,
    QSizePolicy,
    QSplitter, QStackedWidget, QTableWidget, QTableWidgetItem, QVBoxLayout, QWidget,
)
try:
    from shiboken6 import isValid as _qt_is_valid
except Exception:  # pragma: no cover
    def _qt_is_valid(obj):
        return obj is not None

from database.models import Customer
from services.db_facade_service import DatabaseError
from services import archive_service, contract_service
from services.customer_service import ValidationError
from services import lifecycle_service as lc
from services.search_utils import contains as search_contains
from ui import style
from ui.widgets import (MONEY_ALIGN, ActionBar, EntityHeader, PageNav,
                        apply_column_weights, make_searchable)

_ICONS = {
    ".pdf": "📄", ".png": "🖼", ".jpg": "🖼", ".jpeg": "🖼", ".bmp": "🖼",
    ".doc": "📝", ".docx": "📝", ".xls": "📊", ".xlsx": "📊",
    ".txt": "📃", ".zip": "🗜", ".rar": "🗜",
}

# ألوان الحالات مصدرها الوحيد ui/style.py (القاعدة 26) — لا تُعرَّف هنا
STATUS_COLORS = style.STATUS_COLORS


def _open_externally(path: str) -> bool:
    """فتح ملف/مجلد أرشيف العميل مع دعم مسارات الشبكة."""
    try:
        from services.folder_service import open_path
        return open_path(path)
    except Exception:
        return False


def _table(headers: list[str]) -> QTableWidget:
    t = QTableWidget(0, len(headers))
    t.setHorizontalHeaderLabels(headers)
    t.verticalHeader().setVisible(False)
    t.verticalHeader().setDefaultSectionSize(34)
    t.setSelectionBehavior(QTableWidget.SelectRows)
    t.setSelectionMode(QTableWidget.SingleSelection)
    t.setEditTriggers(QTableWidget.NoEditTriggers)
    t.setAlternatingRowColors(True)
    t.setShowGrid(True)
    try:
        t.horizontalHeader().setSectionsMovable(False)
        t.horizontalHeader().setFirstSectionMovable(False)
    except Exception:
        pass
    t.setHorizontalScrollBarPolicy(Qt.ScrollBarAsNeeded)
    return t


def _fill(table: QTableWidget, rows: list[list], center_from: int = 1,
          colors: dict | None = None, money_cols: tuple = ()):
    """تعبئة جدول: rows صفوف نصية · money_cols أعمدة أرقام بمحاذاة موحّدة."""
    table.setRowCount(len(rows))
    for r, row in enumerate(rows):
        for c, val in enumerate(row):
            item = QTableWidgetItem(str(val))
            if c in money_cols:
                item.setTextAlignment(MONEY_ALIGN)
            elif c >= center_from:
                item.setTextAlignment(Qt.AlignCenter)
            if colors and (r, c) in colors:
                item.setForeground(QColor(colors[(r, c)]))
            table.setItem(r, c, item)
    # رأس كل عمود يأخذ محاذاة بياناته (قاعدة 34)
    from ui.widgets import sync_header_alignment
    sync_header_alignment(table)


class CustomerFileWidget(QWidget):
    """محتوى ملف العميل · يعمل كصفحة داخلية أو داخل غلاف Dialog.

    embedded=True ⇒ صفحة داخل النافذة الرئيسية: يظهر شريط رجوع دائم
    أعلى الصفحة، ويصير زر «إغلاق» السفلي «رجوع».
    """

    PAGES = ("overview", "contracts")
    back_requested = Signal()
    data_changed = Signal()
    # علامة يتعرّف بها مركز العقد على أنه مفتوح من داخل ملف عميل
    # فيستبدل بدل أن يكدّس نافذة جديدة (القاعدة 54)
    is_customer_file = True

    def __init__(self, parent=None, customer: Customer | None = None,
                 open_page: str = "overview", embedded: bool = False):
        super().__init__(parent)
        style.ensure_light_background(self)
        self.customer = customer
        self.embedded = embedded
        self._ctx: dict = {}
        self._dirty: dict[str, bool] = {}
        self.setLayoutDirection(Qt.RightToLeft)

        root = QVBoxLayout(self)
        root.setContentsMargins(12, 8, 12, 8)
        root.setSpacing(8)

        # ===== شريط الرجوع الدائم (الوضع الصفحي فقط) =====
        # خارج أي QScrollArea فلا يختفي مع التمرير (شرط الاعتماد)
        self.back_bar = QWidget(self)
        self.back_bar.setObjectName("transparentHost")
        back_row = QHBoxLayout(self.back_bar)
        back_row.setContentsMargins(0, 0, 0, 0)
        back_row.setSpacing(10)
        self.back_btn = QPushButton("→  رجوع")
        self.back_btn.setCursor(Qt.PointingHandCursor)
        self.back_btn.setMinimumHeight(36)
        self.back_btn.setToolTip("العودة للصفحة السابقة (أو اضغط Esc)")
        self.back_btn.clicked.connect(self.back_requested.emit)
        self.page_title = QLabel("")
        self.page_title.setProperty("pageTitle", True)
        back_row.addWidget(self.back_btn)
        back_row.addWidget(self.page_title, 1)
        self.back_bar.setVisible(embedded)
        root.addWidget(self.back_bar)

        # ===== الرأس =====
        self.header = EntityHeader(self, icon="👤")
        self.header.add_button("تعديل البيانات", self._edit_customer)
        self.wa_btn = self.header.add_button("واتساب", self._whatsapp)
        # V4.5.13: مفتاح «إرسال واتساب» يخفي الزر فعليًا
        from services import feature_service as _feat13a
        if not _feat13a.enabled("whatsapp"):
            self.wa_btn.setVisible(False)

        # ===== شريط التنقّل =====
        from services import feature_service as _feat
        comments_enabled = _feat.enabled("comments")
        _nav_spec = [
            ("نظرة عامة", "", [("overview", "عام")]),
            ("العقود", "", [("contracts", "العقود والتفاصيل")]),
        ]
        self._enabled_pages = {k for _t, _i, items in _nav_spec
                               for k, _lbl in items}
        self.nav = PageNav(_nav_spec)
        self.nav.page_changed.connect(self._switch_page)

        top_compact = QWidget()
        top_compact.setObjectName("transparentHost")
        top_row = QHBoxLayout(top_compact)
        top_row.setContentsMargins(0, 0, 0, 0)
        top_row.setSpacing(8)
        top_row.addWidget(self.header, 2)
        top_row.addWidget(self.nav, 1)
        root.addWidget(top_compact)

        self.stack = QStackedWidget()
        self._page_index = {}
        _page_builders = [
            ("overview", self._page_overview, ""),
            ("contracts", self._page_contracts, ""),
        ]
        _built = [(key, builder()) for key, builder, feat in _page_builders
                  if not feat or _feat.enabled(feat)]
        for i, (key, widget) in enumerate(_built):
            self.stack.addWidget(widget)
            self._page_index[key] = i
        content_row = QHBoxLayout()
        content_row.setContentsMargins(0, 0, 0, 0)
        content_row.setSpacing(10)
        content_row.addWidget(self.stack, 1)
        root.addLayout(content_row, 1)

        # التعليقات مدمجة داخل «عام»؛ فلا نضع زرًا عائمًا أو تابًا مكررًا.
        self.quick_comment_btn = None

        # ===== شريط الإجراءات =====
        bar = ActionBar()
        # لا نكرر سند القبض/الصرف هنا؛ مكانها داخل إجراءات العقد بجانب المراحل.
        bar.add("عقد جديد", self._new_contract, key="contract",
                level="primary")
        bar.add("كشف حساب العميل", self._customer_statement, prop="flat",
                key="statement")
        bar.add("طباعة كل المستندات", self._batch_print, prop="flat",
                key="batch")
        # في الوضع الصفحي يوجد زر رجوع ثابت أعلى الصفحة؛ لا نكرر زر رجوع آخر في شريط الإجراءات.
        self.close_btn = None
        if not embedded:
            self.close_btn = bar.add("إغلاق", self.back_requested.emit,
                                     key="close", level="ghost")
        self.action_bar = bar
        root.addWidget(bar)

        if customer is not None:
            self.load_customer(customer, open_page)

    # ==================== تحميل عميل ====================
    def load_customer(self, customer: Customer, open_page: str = "overview"):
        """تهيئة الشاشة لعميل (يُعاد استخدام نفس الويدجت لعميل مختلف)."""
        self.customer = customer
        self.page_title.setText("ملف العميل")
        # التابات القديمة للمتابعة/الملفات/التعليقات أُزيلت لتقليل التكرار؛
        # التعليقات مدمجة الآن داخل صفحة عام.
        open_page = {"files": "overview", "tasks": "overview", "notes": "overview", "comments": "overview"}.get(open_page, open_page)
        start = open_page if open_page in self._page_index else "overview"
        self.nav.select(start)
        self.stack.setCurrentIndex(self._page_index[start])
        self._dirty = {k: True for k in self.PAGES
                       if k in self._page_index}
        self.refresh()

    def show_contract_detail(self, contract_id: int):
        """اختيار عقد وعرض تفاصيله داخل نفس ملف العميل (Master-Detail)."""
        if "contracts" not in self._page_index:
            return
        self.nav.select("contracts")
        self.stack.setCurrentIndex(self._page_index["contracts"])
        self._refresh_section("contracts")
        items = getattr(self, "_visible_contracts", [])
        for i, con in enumerate(items):
            if int(con.get("id") or 0) == int(contract_id):
                self.cons_table.setCurrentCell(i, 0)
                self._load_selected_contract_detail(silent=True)
                return
        if hasattr(self, "contract_detail"):
            self.contract_detail.load_contract(contract_id)
            self.contract_detail.setVisible(True)
            self.no_contract_lbl.setVisible(False)

    def keyPressEvent(self, event):   # noqa: N802
        """Esc = رجوع · في الوضع الصفحي فقط ولا يُمرَّر للنافذة الأم."""
        if self.embedded and event.key() == Qt.Key_Escape:
            event.accept()
            self.back_requested.emit()
            return
        super().keyPressEvent(event)

    # ==================== التنقّل والتحديث الكسول ====================
    def _current_key(self) -> str:
        idx = self.stack.currentIndex()
        for key, i in self._page_index.items():
            if i == idx:
                return key
        return "overview"

    def _switch_page(self, key: str):
        self.stack.setCurrentIndex(self._page_index[key])
        self._refresh_section(key)

    def refresh(self, only_current: bool = True):
        """يعيد تحميل بيانات العميل ويحدّث الرأس + الصفحة المعروضة."""
        try:
            summary = lc.customer_contracts_summary(self.customer.id)
        except Exception as exc:
            style.error(self, f"تعذر قراءة بيانات العميل:\n{exc}")
            return
        self._ctx = {"summary": summary, "totals": summary["totals"],
                     "contracts": summary["contracts"]}
        self._refresh_header()
        if hasattr(self, "comments_list"):
            self._sec_comments()
        if hasattr(self, "share_path"):
            self._refresh_share()
        self._dirty = {k: True for k in self.PAGES
                       if k in self._page_index}
        if only_current:
            self._refresh_section(self._current_key())
        else:
            for key in [k for k in self.PAGES if k in self._page_index]:
                self._refresh_section(key)

    def _refresh_section(self, key: str):
        key = {"files": "overview", "tasks": "overview", "notes": "overview"}.get(key, key)
        if not self._ctx or not self._dirty.get(key, True):
            return
        if key not in self._page_index:
            return          # صفحة معطّلة من مزايا المطور (لم تُبنَ أصلًا)
        fn = getattr(self, "_sec_" + key, None)
        if fn is None:
            return
        fn()
        self._dirty[key] = False

    def _refresh_header(self):
        cust = self.customer
        totals = self._ctx["totals"]
        self.header.set_title(cust.name, tooltip=cust.customer_code or "")
        contact = "   ".join(x for x in [
            f"📞 {cust.phone}" if cust.phone else "",
            f"📍 {cust.address}" if cust.address else "",
            f"✉ {cust.email}" if cust.email else ""] if x)
        self.header.set_subtitle(contact or "لا توجد بيانات اتصال مسجلة")
        self.header.clear_badges()
        if totals["count"]:
            self.header.add_badge(
                f"{totals['count']} عقد · منها {totals['active']} نشط",
                style.INFO)
        else:
            self.header.add_badge("لا توجد عقود", style.NEUTRAL_SOFT)
        if totals["remaining"] > 0.001:
            self.header.add_badge(
                f"متبقٍ {totals['remaining']:,.3f}",
                style.DANGER if totals.get("overdue_count") else style.WARN)
        else:
            self.header.add_badge("لا مديونية", style.OK_GREEN)
        self.wa_btn.setEnabled(bool((cust.phone or "").strip()))

    # ==================== 1) نظرة عامة ====================
    def _page_overview(self) -> QWidget:
        page = QWidget()
        page.setObjectName("transparentHost")
        outer = QVBoxLayout(page)
        outer.setContentsMargins(0, 8, 0, 0)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        host = QWidget()
        host.setObjectName("transparentHost")
        columns = QHBoxLayout(host)
        columns.setContentsMargins(4, 4, 4, 4)
        columns.setSpacing(12)

        main_host = QWidget()
        main_host.setObjectName("transparentHost")
        main_layout = QVBoxLayout(main_host)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(12)

        top_row = QHBoxLayout()
        top_row.setContentsMargins(0, 0, 0, 0)
        top_row.setSpacing(10)

        summary = QFrame()
        summary.setProperty("card", True)
        summary.setMaximumHeight(78)
        sl = QHBoxLayout(summary)
        sl.setContentsMargins(8, 6, 8, 6)
        sl.setSpacing(6)
        title = QLabel("ملخص العميل")
        title.setProperty("sectionTitle", True)
        title.setMaximumWidth(92)
        title.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
        sl.addWidget(title)
        self._cards: dict[str, QLabel] = {}
        for key, label in (("remaining", "المتبقي"),
                           ("contracts", "العقود"),
                           ("cheques", "شيكات 14 يوم")):
            metric = QFrame()
            metric.setObjectName("customerOverviewMetric")
            metric.setStyleSheet(
                "#customerOverviewMetric { background: rgba(248,250,252,0.92); "
                "border: 1px solid rgba(203,213,225,0.75); border-radius: 10px; }")
            ml = QVBoxLayout(metric)
            ml.setContentsMargins(8, 4, 8, 4)
            ml.setSpacing(0)
            lbl = QLabel(label)
            lbl.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
            lbl.setStyleSheet("background: transparent; border: none; font-size: 10.8px;")
            val = QLabel("—")
            val.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
            val.setStyleSheet("font-weight: 900; background: transparent; border: none; font-size: 12.5px;")
            ml.addWidget(lbl)
            ml.addWidget(val)
            sl.addWidget(metric, 1)
            self._cards[key] = val
        # مفاتيح محفوظة للتوافق مع refresh لكن غير معروضة كبطاقات
        for key in ("value", "collected", "paid"):
            self._cards[key] = QLabel("—")
        top_row.addWidget(summary, 3)

        docs_card = QFrame()
        docs_card.setProperty("card", True)
        docs_card.setMinimumHeight(166)
        docs_card.setMaximumHeight(190)
        docs_lay = QVBoxLayout(docs_card)
        docs_lay.setContentsMargins(12, 8, 12, 8)
        docs_lay.setSpacing(5)
        docs_title = QLabel("نماذج ومرفقات العميل")
        docs_title.setProperty("sectionTitle", True)
        docs_lay.addWidget(docs_title)
        docs_hint = QLabel("اختيار نموذج أو مرفق ومجلد الشبكة.")
        docs_hint.setProperty("hint", True)
        docs_hint.setWordWrap(True)
        docs_lay.addWidget(docs_hint)
        share_row = QHBoxLayout()
        share_row.setSpacing(6)
        share_row.addWidget(QLabel("مجلد الشبكة:"))
        self.share_path = QLabel("")
        self.share_path.setProperty("hint", True)
        self.share_path.setWordWrap(False)
        share_row.addWidget(self.share_path, 1)
        docs_lay.addLayout(share_row)

        self.share_open_btn = QPushButton("📂 فتح مجلد الشبكة")
        self.share_open_btn.setProperty("flat", True)
        self.share_open_btn.clicked.connect(self._open_share)
        self.share_set_btn = QPushButton("تعيين / تغيير")
        self.share_set_btn.setProperty("flat", True)
        self.share_set_btn.clicked.connect(self._set_share)
        self.share_clear_btn = QPushButton("🗑 حذف المسار")
        self.share_clear_btn.setObjectName("btnDangerSoft")
        self.share_clear_btn.setToolTip("يمسح مسار مجلد الشبكة من بطاقة العميل فقط ولا يحذف أي ملفات")
        self.share_clear_btn.clicked.connect(self._clear_share)
        gen_model_btn = QPushButton("اختيار نموذج")
        gen_model_btn.setObjectName("btnPrimary")
        gen_model_btn.setToolTip("لا يولد عشوائيًا: يفتح قائمة القوالب المناسبة للعميل/العقد ثم تختار النموذج")
        gen_model_btn.clicked.connect(self._generate_customer_form)
        add_archive_btn = QPushButton("＋ إضافة مرفق")
        add_archive_btn.setProperty("flat", True)
        add_archive_btn.clicked.connect(self._add_file)
        open_archive_btn = QPushButton("📂 فتح مجلد المرفقات")
        open_archive_btn.setProperty("flat", True)
        open_archive_btn.clicked.connect(self._open_archive_folder)

        actions_grid = QGridLayout()
        actions_grid.setContentsMargins(0, 2, 0, 0)
        actions_grid.setHorizontalSpacing(8)
        actions_grid.setVerticalSpacing(6)
        for btn in (gen_model_btn, add_archive_btn, open_archive_btn,
                    self.share_open_btn, self.share_set_btn, self.share_clear_btn):
            btn.setMinimumHeight(30)
            btn.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        actions_grid.addWidget(gen_model_btn, 0, 0)
        actions_grid.addWidget(add_archive_btn, 1, 0)
        actions_grid.addWidget(open_archive_btn, 2, 0)
        actions_grid.addWidget(self.share_open_btn, 0, 1)
        actions_grid.addWidget(self.share_set_btn, 1, 1)
        actions_grid.addWidget(self.share_clear_btn, 2, 1)
        actions_grid.setColumnStretch(0, 1)
        actions_grid.setColumnStretch(1, 1)
        docs_lay.addLayout(actions_grid)
        top_row.addWidget(docs_card, 4)
        main_layout.addLayout(top_row)

        contracts_title = QLabel("📌 أهم عقود العميل")
        contracts_title.setProperty("sectionTitle", True)
        main_layout.addWidget(contracts_title)
        self.overview_contracts_table = _table(["العقد", "الحالة", "القيمة", "المحصّل", "المتبقي"])
        apply_column_weights(self.overview_contracts_table, [30, 16, 18, 18, 18],
                             min_widths=[160, 80, 90, 90, 90])
        self.overview_contracts_table.setMinimumHeight(145)
        self.overview_contracts_table.itemDoubleClicked.connect(lambda *_: self._open_overview_contract())
        main_layout.addWidget(self.overview_contracts_table)

        # لا نعرض آخر تعليق هنا لتخفيف الزحمة؛ زر «تعليق سريع» يكفي للكتابة،
        # ومركز التعليقات هو مكان القراءة والبحث والإدارة.
        self.last_comment_lbl = None

        timeline_title = QLabel("🕒 السجل الزمني")
        timeline_title.setProperty("sectionTitle", True)
        main_layout.addWidget(timeline_title)
        self.customer_timeline_list = QListWidget()
        self.customer_timeline_list.setMinimumHeight(180)
        self.customer_timeline_list.setAlternatingRowColors(True)
        main_layout.addWidget(self.customer_timeline_list)

        main_layout.addStretch()

        columns.addWidget(main_host, 3)
        try:
            from services import feature_service as _feat
            show_comments = _feat.enabled("comments")
        except Exception:
            show_comments = True
        if show_comments:
            comments_panel = QFrame()
            comments_panel.setProperty("card", True)
            comments_panel.setMinimumWidth(380)
            comments_panel.setMaximumWidth(560)
            comments_lay = QVBoxLayout(comments_panel)
            comments_lay.setContentsMargins(10, 8, 10, 8)
            comments_lay.setSpacing(6)
            comments_title = QLabel("تعليقات العميل")
            comments_title.setProperty("sectionTitle", True)
            comments_lay.addWidget(comments_title)
            comments_lay.addWidget(self._page_comments(), 1)
            columns.addWidget(comments_panel, 2)
        scroll.setWidget(host)
        outer.addWidget(scroll)
        return page

    def _sec_overview(self):
        totals = self._ctx["totals"]
        self._cards["contracts"].setText(
            f"{totals['count']}  (نشط: {totals['active']})")
        self._cards["value"].setText(f"{totals['current']:,.3f}")
        self._cards["collected"].setText(f"{totals['collected']:,.3f}")
        self._cards["remaining"].setText(f"{totals['remaining']:,.3f}")
        overdue = bool(totals.get("overdue_count"))
        remain_color = (style.MONEY_IN if totals["remaining"] <= 0.001
                        else style.MONEY_OVERDUE if overdue
                        else style.MONEY_REMAIN)
        self._cards["remaining"].setStyleSheet(
            "font-size: 13.6px; font-weight: 800; background: transparent;"
            f"color: {remain_color};")
        self._cards["remaining"].setToolTip(
            f"على العميل {totals['overdue_count']} عقد بقسط متأخر "
            f"(أقصى تأخر {totals['overdue_days']} يومًا)" if overdue else "")
        self._cards["paid"].setText(f"{totals['paid']:,.3f}")

        # أهم العقود: المتبقي الأكبر أولًا، والنقر المزدوج يفتح مركز العقد.
        contracts = sorted(self._ctx.get("contracts", []),
                           key=lambda c: float(c.get("remaining") or 0),
                           reverse=True)[:5]
        self._overview_contracts = contracts
        con_rows = [[c.get("name") or c.get("contract_number") or "عقد",
                     c.get("status") or "نشط",
                     f"{float(c.get('current') or 0):,.3f}",
                     f"{float(c.get('collected') or 0):,.3f}",
                     f"{float(c.get('remaining') or 0):,.3f}"]
                    for c in contracts]
        _fill(self.overview_contracts_table, con_rows, center_from=1,
              money_cols=(2, 3, 4))

        # لا نستدعي customer_alerts هنا لأنه يعيد حساب ملخص العميل وخطط
        # السداد مرة ثانية. المطلوب في البطاقة هو عدد الشيكات فقط.
        cheques = 0
        try:
            from services.extras_service import due_cheques
            numbers = {c.get("contract_number") for c in self._ctx.get("contracts", [])}
            cheques = sum(1 for ch in due_cheques(14)
                          if ch.get("contract_number") in numbers)
        except Exception:
            cheques = 0
        self._alerts = []
        self._cards["cheques"].setText(str(cheques))

        self._fill_customer_timeline()
        if hasattr(self, "share_path"):
            self._refresh_share()

    def _fill_customer_timeline(self):
        """السجل الزمني العام في نظرة عامة: أحداث عقود العميل بدل آخر الحركات المالية."""
        lst = getattr(self, "customer_timeline_list", None)
        if lst is None:
            return
        lst.clear()
        events = []
        icons = {"إنشاء العقد": "🟢", "اعتماد العقد": "✅",
                 "إضافة ملحق": "📎", "إضافة أمر تغييري": "📎",
                 "إنشاء سند قبض": "📥", "إنشاء سند صرف": "📤",
                 "إيقاف العقد": "⏸", "تفعيل العقد": "▶",
                 "إغلاق العقد": "🔒", "إلغاء العقد": "❌",
                 "انتهاء العقد": "🏁", "إلغاء سند": "🚫",
                 "ضبط عقد إشراف": "🏗", "إلغاء أشهر تمديد إشراف": "🤝",
                 "تغيير الحالة": "🚦"}
        contracts = self._ctx.get("contracts", [])
        names = {int(c["id"]): (c.get("name") or c.get("contract_number") or "عقد")
                 for c in contracts if c.get("id")}
        try:
            for e in lc.list_events_for_contracts(list(names.keys()), limit=40):
                events.append({**e, "contract_name": names.get(int(e.get("contract_id") or 0), "عقد")})
        except Exception:
            events = []
        events.sort(key=lambda e: e.get("event_time") or "", reverse=True)
        for e in events[:12]:
            icon = icons.get(e.get("event_type"), "•")
            txt = (f"{icon} {(e.get('event_time') or '')[:16]} · "
                   f"{e.get('contract_name')}: {e.get('event_type') or ''}")
            if e.get("description"):
                txt += f" — {e['description']}"
            if e.get("username"):
                txt += f" ({e['username']})"
            QListWidgetItem(txt, lst)
        if not events:
            QListWidgetItem("لا يوجد سجل زمني بعد.", lst)

    def _current_context_contract_id(self) -> int | None:
        detail = getattr(self, "contract_detail", None)
        try:
            if detail is not None and detail.isVisible() and getattr(detail, "contract_id", None):
                return int(detail.contract_id)
        except Exception:
            pass
        try:
            con = self._selected_contract(show_message=False)
            if con:
                return int(con["id"])
        except Exception:
            pass
        return None

    def _choose_contract_for_form(self) -> int | None:
        contracts = list(self._ctx.get("contracts", []))
        if not contracts:
            style.info(self, "لا توجد عقود لهذا العميل لاختيار نموذج عقد.")
            return None
        current = self._current_context_contract_id()
        if current:
            return current
        if len(contracts) == 1:
            return int(contracts[0]["id"])
        dlg = QDialog(self)
        dlg.setWindowTitle("اختيار عقد للنموذج")
        dlg.setLayoutDirection(Qt.RightToLeft)
        dlg.resize(620, 390)
        lay = QVBoxLayout(dlg)
        table = QTableWidget(len(contracts), 4, dlg)
        table.setHorizontalHeaderLabels(["العقد", "الحالة", "القيمة", "المتبقي"])
        table.verticalHeader().setVisible(False)
        table.setSelectionBehavior(QTableWidget.SelectRows)
        table.setEditTriggers(QTableWidget.NoEditTriggers)
        apply_column_weights(table, [42, 16, 21, 21], min_widths=[180, 80, 100, 100])
        for r, c in enumerate(contracts):
            vals = [c.get("name") or c.get("contract_number") or "عقد",
                    c.get("status") or "نشط",
                    f"{float(c.get('current') or 0):,.3f}",
                    f"{float(c.get('remaining') or 0):,.3f}"]
            for col, val in enumerate(vals):
                item = QTableWidgetItem(str(val))
                item.setTextAlignment(MONEY_ALIGN if col in (2, 3) else Qt.AlignCenter)
                table.setItem(r, col, item)
        lay.addWidget(QLabel("اختر العقد المطلوب تجهيز النموذج له:"))
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
        return int(contracts[table.currentRow()]["id"])

    def _choose_contract_template(self, contract_id: int) -> dict | None:
        from services import word_service
        templates = word_service.templates_for_contract(contract_id)
        if not templates:
            style.info(self, "لا توجد قوالب عقود Word. ارفع قالبًا من مركز النماذج أولًا.")
            return None
        if len(templates) == 1:
            return templates[0]
        dlg = QDialog(self)
        dlg.setWindowTitle("اختيار قالب")
        dlg.setLayoutDirection(Qt.RightToLeft)
        dlg.resize(620, 390)
        lay = QVBoxLayout(dlg)
        table = QTableWidget(len(templates), 3, dlg)
        table.setHorizontalHeaderLabels(["القالب", "النطاق", "المسار"])
        table.verticalHeader().setVisible(False)
        table.setSelectionBehavior(QTableWidget.SelectRows)
        table.setEditTriggers(QTableWidget.NoEditTriggers)
        apply_column_weights(table, [36, 20, 44], min_widths=[160, 100, 200])
        for r, t in enumerate(templates):
            for col, val in enumerate([t.get("name"), t.get("scope"), t.get("path")]):
                table.setItem(r, col, QTableWidgetItem(str(val or "")))
        lay.addWidget(QLabel("اختر قالب العقد:")); lay.addWidget(table, 1)
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

    def _choose_customer_any_template(self) -> dict | None:
        """اختيار أي نموذج من داخل ملف العميل.

        لا نملأ أول قالب تلقائيًا؛ نعرض كل القوالب في جدول واحد:
        نماذج Word العامة الحديثة + قوالب العقود/عروض السعر الرسمية القديمة.
        """
        from services import word_forms_service as wfs, word_service
        from services import feature_service as _feat13f
        rows = []
        try:
            # V4.5.13: مفتاح «قوالب Word» يخفي نماذجه من قائمة الاختيار
            for t in (wfs.list_word_templates()
                      if _feat13f.enabled("word_forms") else []):
                rows.append({
                    "engine": "forms", "id": int(t["id"]),
                    "name": t.get("base_name") or "نموذج",
                    "kind_label": t.get("category_name") or "نموذج عام",
                    "status": t.get("status") or "",
                    "path": t.get("word_path") or t.get("pdf_path") or "",
                })
        except Exception:
            pass
        try:
            for t in word_service.list_templates(None):
                kind = t.get("kind") or "contract"
                label = "عرض سعر" if kind == "quotation" else "عقد"
                rows.append({
                    "engine": "official", "id": None,
                    "name": t.get("name") or "قالب",
                    "kind": kind, "kind_label": label, "status": "رسمي",
                    "path": t.get("path") or "",
                })
        except Exception:
            pass
        if not rows:
            style.info(self, "لا توجد نماذج Word. ارفع النماذج من مركز النماذج أولًا.")
            return None

        dlg = QDialog(self)
        dlg.setWindowTitle("اختيار نموذج للعميل")
        dlg.setLayoutDirection(Qt.RightToLeft)
        dlg.resize(760, 480)
        lay = QVBoxLayout(dlg)
        hint = QLabel("اختر النموذج المطلوب. سيتم تمرير هذا العميل تلقائيًا، وإذا كان النموذج يحتاج عقدًا أو عرض سعر ستختاره من نفس العميل.")
        hint.setProperty("hint", True); hint.setWordWrap(True)
        lay.addWidget(hint)
        search = QLineEdit()
        search.setPlaceholderText("بحث في النماذج...")
        search.setClearButtonEnabled(True)
        lay.addWidget(search)
        table = QTableWidget(0, 4, dlg)
        table.setHorizontalHeaderLabels(["النموذج", "النوع/التصنيف", "الحالة", "المسار"])
        table.verticalHeader().setVisible(False)
        table.setSelectionBehavior(QTableWidget.SelectRows)
        table.setEditTriggers(QTableWidget.NoEditTriggers)
        apply_column_weights(table, [34, 22, 12, 32], min_widths=[220, 130, 80, 220])
        lay.addWidget(table, 1)

        visible: list[dict] = []
        def refill():
            nonlocal visible
            q = (search.text() or "").strip()
            visible = [r for r in rows if not q or search_contains(
                r.get("name", "") + " " + r.get("kind_label", "") + " " + r.get("status", ""), q)]
            table.setRowCount(len(visible))
            for rr, item in enumerate(visible):
                vals = [item.get("name", ""), item.get("kind_label", ""),
                        item.get("status", ""), item.get("path", "")]
                for cc, val in enumerate(vals):
                    cell = QTableWidgetItem(str(val or ""))
                    cell.setTextAlignment(Qt.AlignCenter if cc in (1, 2) else Qt.AlignRight | Qt.AlignVCenter)
                    table.setItem(rr, cc, cell)
            if visible:
                table.setCurrentCell(0, 0)
        search.textChanged.connect(lambda *_: refill())
        refill()

        btns = QHBoxLayout(); btns.addStretch()
        cancel = QPushButton("✕ إلغاء"); cancel.setProperty("flat", True)
        ok = QPushButton("اختيار"); ok.setObjectName("btnPrimary")
        btns.addWidget(cancel); btns.addWidget(ok); lay.addLayout(btns)
        cancel.clicked.connect(dlg.reject); ok.clicked.connect(dlg.accept)
        table.itemDoubleClicked.connect(lambda *_: dlg.accept())
        if dlg.exec() != QDialog.Accepted or table.currentRow() < 0:
            return None
        if table.currentRow() >= len(visible):
            return None
        return visible[table.currentRow()]

    def _generate_customer_form(self):
        """من زر «اختيار نموذج» داخل ملف العميل.

        الحل الصحيح: لا نختار أول نموذج تلقائيًا، بل نعرض كل النماذج،
        ونمرر العميل الحالي لمحرك التعبئة حتى تقرأ الحقول بياناته مباشرة.
        """
        tpl = self._choose_customer_any_template()
        if not tpl:
            return
        try:
            if tpl.get("engine") == "forms":
                from services import form_service as fs
                from ui.word_forms_center import WordFormFillDialog
                needs = fs.document_fields_need(int(tpl["id"]))
                contract_id = None
                if needs.get("contract"):
                    contract_id = self._choose_contract_for_form()
                    if not contract_id:
                        return
                WordFormFillDialog(
                    int(tpl["id"]), self,
                    customer_id=int(self.customer.id),
                    contract_id=contract_id).exec()
            else:
                from ui.word_forms_center import OfficialTemplateFillDialog
                # قوالب العقود/عروض السعر الرسمية ستعرض فقط مصادر هذا العميل
                # داخل نافذة التعبئة، بدل كل عقود/عروض النظام.
                OfficialTemplateFillDialog(
                    tpl, self, customer_id=int(self.customer.id)).exec()
        except Exception as exc:
            style.error(self, str(exc))
            return
        self._dirty["overview"] = True
        self._sec_overview()


    def _open_overview_contract(self):
        row = self.overview_contracts_table.currentRow() if hasattr(self, "overview_contracts_table") else -1
        items = getattr(self, "_overview_contracts", [])
        if 0 <= row < len(items):
            self._open_hub(items[row]["id"])

    def _open_alert_contract(self, item):
        """النقر المزدوج على التنبيه يفتح العقد على الصفحة التي تعالجه."""
        cid = item.data(Qt.UserRole)
        if cid:
            self._open_hub(cid, item.data(Qt.UserRole + 1) or "dashboard")

    # ==================== 2) العقود ====================
    def _page_contracts(self) -> QWidget:
        """Master-Detail: قائمة عقود العميل + تفاصيل العقد المختار في نفس الشاشة."""
        page = QWidget()
        page.setObjectName("transparentHost")
        layout = QVBoxLayout(page)
        layout.setContentsMargins(0, 8, 0, 0)
        layout.setSpacing(8)

        splitter = QSplitter(Qt.Horizontal)
        splitter.setChildrenCollapsible(False)
        splitter.setHandleWidth(0)
        self.contracts_splitter = splitter

        # القائمة الجانبية لعقود العميل
        side = QFrame()
        self.contracts_side_panel = side
        side.setProperty("card", True)
        side.setMinimumWidth(270)
        side.setMaximumWidth(390)
        side_lay = QVBoxLayout(side)
        side_lay.setContentsMargins(12, 10, 12, 10)
        side_lay.setSpacing(8)

        side_title = QLabel("عقود العميل")
        side_title.setProperty("sectionTitle", True)
        side_lay.addWidget(side_title)

        bar = QVBoxLayout()
        bar.setSpacing(6)
        self.con_search = QLineEdit()
        self.con_search.setPlaceholderText("بحث باسم العقد أو رقمه...")
        self.con_search.setClearButtonEnabled(True)
        from ui.widgets import connect_debounced_text
        connect_debounced_text(self.con_search, self._sec_contracts, delay_ms=420)
        self.con_filter = QComboBox()
        self.con_filter.addItem("كل العقود", "all")
        self.con_filter.addItem("النشطة فقط", "active")
        self.con_filter.addItem("عليها متبقٍ", "remaining")
        self.con_filter.addItem("المغلقة والمنتهية", "closed")
        make_searchable(self.con_filter, "")
        self.con_filter.currentIndexChanged.connect(lambda: self._sec_contracts())
        self.con_summary = QLabel("")
        self.con_summary.setProperty("hint", True)
        self.con_summary.setWordWrap(True)
        bar.addWidget(self.con_search)
        bar.addWidget(self.con_filter)
        bar.addWidget(self.con_summary)
        side_lay.addLayout(bar)

        self.cons_table = _table(["العقد", "الحالة", "المتبقي", "تعديل"])
        apply_column_weights(self.cons_table, [46, 20, 34, 0],
                             min_widths=[118, 58, 76, 0],
                             content_cols=(3,))
        # عمود التعديل ثابت بعرض كافٍ — كان النص يُقطع "..." في اللوحة الضيقة
        from PySide6.QtWidgets import QHeaderView as _QHV
        self.cons_table.horizontalHeader().setSectionResizeMode(3, _QHV.Fixed)
        self.cons_table.setColumnWidth(3, 76)
        self.cons_table.doubleClicked.connect(self._open_contract)
        self.cons_table.itemSelectionChanged.connect(self._load_selected_contract_detail)
        side_lay.addWidget(self.cons_table, 1)

        actions = QHBoxLayout()
        actions.setSpacing(6)
        # V3.25: حُذف زر «خيارات العقود» بأمر المستخدم.
        actions.addStretch()
        side_lay.addLayout(actions)
        splitter.addWidget(side)

        # تفاصيل العقد المختار: مركز العقد مبسّط ومضمّن بلا زر رجوع داخلي
        detail_host = QFrame()
        detail_host.setProperty("card", True)
        detail_lay = QVBoxLayout(detail_host)
        detail_lay.setContentsMargins(0, 0, 0, 0)
        detail_lay.setSpacing(0)
        from ui.contract_hub import ContractHubPage
        self.contract_detail = ContractHubPage(self, embedded=True)
        self.contract_detail.data_changed.connect(self._contract_detail_changed)
        detail_lay.addWidget(self.contract_detail, 1)
        self.no_contract_lbl = QLabel("اختر عقدًا من القائمة لعرض تفاصيله هنا.")
        self.no_contract_lbl.setAlignment(Qt.AlignCenter)
        self.no_contract_lbl.setProperty("hint", True)
        detail_lay.addWidget(self.no_contract_lbl)
        self.contract_detail.setVisible(False)
        splitter.addWidget(detail_host)
        splitter.setSizes([360, 910])
        try:
            splitter.handle(1).setEnabled(False)
        except Exception:
            pass
        QTimer.singleShot(0, self._apply_responsive_layout)
        layout.addWidget(splitter, 1)
        return page

    def _contract_detail_changed(self):
        cid = getattr(getattr(self, "contract_detail", None), "contract_id", None)
        self.refresh()
        if cid and hasattr(self, "contract_detail"):
            # V6.3: نحافظ على الشاشة/التاب الحالي بعد أي حركة داخل مركز
            # العقد — كان reload الافتراضي يعيد المستخدم لأول صفحة.
            keep = "dashboard"
            try:
                keep = self.contract_detail._current_key() or "dashboard"
            except Exception:
                keep = "dashboard"
            try:
                self.contract_detail.load_contract(cid, open_page=keep)
            except Exception:
                pass
        self.data_changed.emit()


    def _customer_more_menu(self):
        from PySide6.QtGui import QCursor
        from PySide6.QtWidgets import QMenu
        menu = QMenu(self)
        act_contracts = menu.addAction("عقود العميل")
        act_comments = menu.addAction("مركز التعليقات")
        act_files = menu.addAction("الملفات والمستندات")
        chosen = menu.exec(QCursor.pos())
        if chosen is act_contracts:
            self.nav.select("contracts")
        elif chosen is act_comments:
            self._open_comments_center()
        elif chosen is act_files:
            self.nav.select("overview")
            self._open_archive_folder()

    def _sec_contracts(self):
        if not self._ctx:
            return
        # V3.29: كتم إشارات التحديد أثناء إعادة البناء — تفريغ التحديد
        # العابر كان يُظهر نافذة «اختر عقدًا» في منتصف التحديث.
        _blocked = self.cons_table.blockSignals(True)
        try:
            self._sec_contracts_inner()
        finally:
            self.cons_table.blockSignals(_blocked)

    def _sec_contracts_inner(self):
        # V3.29: حفظ العقد المعروض قبل إعادة البناء (كل تحديث).
        try:
            _keep_id = getattr(getattr(self, "contract_detail", None),
                               "contract_id", None)
            if not _keep_id:
                _cur_row = self.cons_table.currentRow()
                _vis = getattr(self, "_visible_contracts", [])
                _keep_id = (_vis[_cur_row]["id"]
                            if 0 <= _cur_row < len(_vis) else None)
        except Exception:
            _keep_id = None
        query = self.con_search.text().strip()
        key = self.con_filter.currentData()
        items = list(self._ctx.get("contracts", []))
        if query:
            items = [c for c in items if query in (c["name"] or "")
                     or query in (c["project_name"] or "")
                     or query in (c["contract_number"] or "")]
        if key == "active":
            from services import ui_data_service as _ui_status
            items = [c for c in items
                     if _ui_status.normalize_contract_status(c.get("status")) == "نشط"]
        elif key == "remaining":
            items = [c for c in items if c["remaining"] > 0.001]
        elif key == "closed":
            from services import ui_data_service as _ui_status
            items = [c for c in items
                     if _ui_status.normalize_contract_status(c.get("status"))
                     in ("مغلق", "منتهي", "ملغى")]
        self._visible_contracts = items

        rows, colors = [], {}
        total = collected = 0.0
        for r, c in enumerate(items):
            name = c["name"] or "(بلا اسم)"
            from services import ui_data_service as _ui_status
            display_status = _ui_status.normalize_contract_status(c.get("status"))
            rows.append([name, display_status, f"{c['remaining']:,.3f}"])
            colors[(r, 1)] = STATUS_COLORS.get(display_status, style.TEXT)
            if c["remaining"] > 0.001:
                colors[(r, 2)] = (style.MONEY_OVERDUE if c.get("has_overdue")
                                  else style.MONEY_REMAIN)
            if c["status"] != "ملغى":
                total += c["current"]
                collected += c["collected"]
        _fill(self.cons_table, rows, colors=colors, money_cols=(2,))
        # كود العقد في tooltip فقط · وسبب الأحمر مكتوب على الخلية
        for r, c in enumerate(items):
            item = self.cons_table.item(r, 0)
            if item:
                item.setToolTip(
                    f"{(getattr(self.customer, 'name', '') or '').strip()} — {c['contract_number']}"
                    + (f" · مشروع: {c['project_name']}"
                       if c["project_name"] else ""))
            remain_cell = self.cons_table.item(r, 2)
            if remain_cell and c.get("has_overdue"):
                remain_cell.setToolTip(
                    f"عليه دفعة متأخرة منذ {c['overdue_days']} يومًا "
                    f"({c.get('overdue_title') or 'دفعة مجدولة'})")
        # زر تعديل أمام كل عقد — يفتح نافذة العقد نفسها التي كانت
        # بنود القائمة الثلاثة تفتحها (كانت تختلف في التركيز فقط).
        for r, c in enumerate(items):
            btn = QPushButton("✎ تعديل")
            btn.setProperty("flat", True)
            # V4.0: النقر على الزر لا ينقل التحديد/العرض — العرض بالنقر
            # على الصف فقط (الفوكس كان يسحب التحديد تلقائيًا).
            btn.setFocusPolicy(Qt.NoFocus)
            btn.setMinimumWidth(64)
            # V2.41/#1: حشوة الثيم العامة (8px) أطول من الصف (34px) فتُخفي
            # النص — حشوة مدمجة لزر الخلية فقط (عرض hint ≈ 60 ≤ 88).
            btn.setStyleSheet("QPushButton { padding: 2px 8px; }")
            btn.setToolTip(f"تعديل {c['name'] or c['contract_number']}")
            btn.clicked.connect(
                lambda _checked=False, row=r: self._edit_contract_row(row))
            self.cons_table.setCellWidget(r, 3, btn)
        self.con_summary.setText(
            f"المعروض: {len(items)} عقد · المتبقي {total - collected:,.3f}")
        if items:
            # V3.29: استعادة العقد المعروض (كان يقفز لأول صف بعد أي تحديث).
            _keep_row = next(
                (i for i, c in enumerate(items) if c["id"] == _keep_id), None)
            if _keep_row is not None:
                self.cons_table.setCurrentCell(_keep_row, 0)
            else:
                current = self.cons_table.currentRow()
                if current < 0 or current >= len(items):
                    self.cons_table.setCurrentCell(0, 0)
            self._load_selected_contract_detail(silent=True)
        elif hasattr(self, "contract_detail"):
            self.contract_detail.setVisible(False)
            self.no_contract_lbl.setVisible(True)

    def _load_selected_contract_detail(self, silent: bool = False):
        con = self._selected_contract(show_message=not silent)
        if not con or not hasattr(self, "contract_detail"):
            return
        self.no_contract_lbl.setVisible(False)
        self.contract_detail.setVisible(True)
        if getattr(self.contract_detail, "contract_id", None) != con["id"]:
            self.contract_detail.load_contract(con["id"])
        else:
            # نفس العقد المختار: أعد تحميل الأرقام من القاعدة بعد أي سند/تعديل.
            self.contract_detail.refresh(only_current=False)

    def _selected_contract(self, show_message: bool = True):
        row = self.cons_table.currentRow()
        items = getattr(self, "_visible_contracts", [])
        if row < 0 or row >= len(items):
            if show_message:
                style.info(self, "اختر عقدًا من القائمة أولاً.")
            return None
        return items[row]

    def _open_contract(self):
        # في تصميم Master-Detail لا ننتقل لشاشة منفصلة؛ نعرض التفاصيل يمين القائمة.
        self._load_selected_contract_detail()

    def _edit_contract_row(self, row: int):
        """زر تعديل الصف — يفتح نافذة العقد (بيانات + قيمة + دفعات)."""
        items = getattr(self, "_visible_contracts", [])
        if row < 0 or row >= len(items):
            return
        from services import contract_service as _cs
        try:
            contract = _cs.get_contract(int(items[row]["id"]))
        except Exception:
            contract = None
        if contract is None:
            style.error(self, "تعذر فتح العقد المحدد.")
            return
        win = self.window()
        if hasattr(win, 'open_contract_page'):
            win.open_contract_page(
                contract=contract,
                on_done=lambda accepted: self.refresh() if accepted else None)
        else:
            from ui.contracts import ContractDialog
            dlg = ContractDialog(self, contract)
            if dlg.exec() == QDialog.Accepted:
                try:
                    self.refresh()
                except Exception:
                    pass
            try:
                self._load_selected_contract_detail(silent=True)
            except Exception:
                pass

    def _open_hub(self, contract_id: int, open_page: str = "dashboard"):
        """عرض تفاصيل العقد داخل ملف العميل نفسه، بلا نافذة أو انتقال لشاشة منفصلة."""
        self.show_contract_detail(contract_id)


    # ==================== 4) الملفات ====================
    def _go_comments(self):
        """فتح صفحة التعليقات من سطر «آخر تعليق»."""
        self.nav.select("overview")
        self._switch_page("overview")
        try:
            self.comments_search.setFocus()
        except Exception:
            pass

    def _quick_comment(self):
        """تعليق سريع للكتابة فقط؛ العرض الكامل في مركز التعليقات."""
        from services import comment_service as cmt
        dlg = QDialog(self)
        dlg.setWindowTitle("تعليق سريع")
        dlg.setLayoutDirection(Qt.RightToLeft)
        dlg.resize(460, 300)
        lay = QVBoxLayout(dlg)
        lay.setContentsMargins(16, 14, 16, 14)
        lay.setSpacing(8)
        lay.addWidget(QLabel("اكتب تعليقًا سريعًا على العميل أو العقد الحالي:"))
        contract_box = QComboBox(dlg)
        contract_box.addItem("على العميل فقط", None)
        make_searchable(contract_box, "")
        current_id = self._current_context_contract_id()
        for con in self._ctx.get("contracts", []):
            _nm, _no = con.get("name") or "", (con.get("contract_number") or "")
            _core = f"{_no} · {_nm}" if (_no and _nm) else (_nm or _no or "عقد")
            contract_box.addItem(_core, con.get("id"))
        if current_id:
            idx = contract_box.findData(current_id)
            if idx >= 0:
                contract_box.setCurrentIndex(idx)
        lay.addWidget(contract_box)
        edit = QTextEdit(dlg)
        edit.setPlaceholderText("مثال: تم التواصل مع العميل اليوم...")
        edit.setFixedHeight(120)
        lay.addWidget(edit)
        row = QHBoxLayout(); row.addStretch()
        center_btn = QPushButton("📂 فتح مركز التعليقات", dlg)
        center_btn.setProperty("flat", True)
        cancel = QPushButton("✕ إلغاء", dlg)
        cancel.setProperty("flat", True)
        save = QPushButton("💾 حفظ التعليق", dlg)
        save.setObjectName("btnPrimary")
        row.addWidget(center_btn); row.addWidget(cancel); row.addWidget(save)
        lay.addLayout(row)
        center_btn.clicked.connect(lambda: (dlg.reject(), self._open_comments_center()))
        cancel.clicked.connect(dlg.reject)
        def _save():
            try:
                cmt.add_comment(self.customer.id, edit.toPlainText(), contract_box.currentData())
            except (ValidationError, DatabaseError) as exc:
                style.error(dlg, str(exc))
                return
            dlg.accept()
            style.toast(self, "تمت إضافة التعليق")
            try:
                self._fill_last_comment()
            except Exception:
                pass
        save.clicked.connect(_save)
        dlg.exec()

    def _fill_last_comment(self):
        """سطر «آخر تعليق» في نظرة عامة · ينقل لصفحة التعليقات بنقرة."""
        lbl = getattr(self, "last_comment_lbl", None)
        if lbl is None:
            return
        from services import feature_service as _feat
        if not _feat.enabled("comments"):
            lbl.setVisible(False)
            return
        from services import comment_service as cmt
        row = cmt.last_comment(self.customer.id)
        if not row:
            lbl.setText("لا توجد تعليقات على هذا العميل بعد، "
                        "اضغط لإضافة أول تعليق")
        else:
            body = (row["body"] or "").replace("\n", " ")
            if len(body) > 90:
                body = body[:90] + "…"
            head = "آخر تعليق"
            if row.get("pinned"):
                head = "تعليق مثبّت"
            who = row["author"] or "غير معروف"
            when = (row["created_at"] or "")[:16]
            lbl.setText(f"{head} · {who} · {when}\n{body}")
        lbl.setVisible(True)

    # ==================== ملفات وتعليقات ومهام: صفحة واحدة بلا تبويبات زائدة ====================
    def _section_card(self, title: str, widget: QWidget) -> QFrame:
        card = QFrame()
        card.setProperty("card", True)
        lay = QVBoxLayout(card)
        lay.setContentsMargins(12, 10, 12, 12)
        lay.setSpacing(8)
        lbl = QLabel(title)
        lbl.setProperty("sectionTitle", True)
        lay.addWidget(lbl)
        lay.addWidget(widget)
        return card

    def _comments_filter_contract_id(self):
        """فلتر التعليقات الجانبي: None=كل العقود، 0=غير محدد، id=عقد."""
        w = getattr(self, "comments_filter", None)
        return w.currentData() if w is not None else None

    def _refresh_comments_filter(self):
        if not hasattr(self, "comments_filter"):
            return
        current = self.comments_filter.currentData()
        self.comments_filter.blockSignals(True)
        self.comments_filter.clear()
        self.comments_filter.addItem("كل العقود", None)
        self.comments_filter.addItem("غير محدد", 0)
        for c in self._ctx.get("contracts", []):
            self.comments_filter.addItem(c["name"] or "عقد", c["id"])
        idx = self.comments_filter.findData(current)
        self.comments_filter.setCurrentIndex(idx if idx >= 0 else 0)
        self.comments_filter.blockSignals(False)

    # ==================== التعليقات ====================
    def _page_comments(self) -> QWidget:
        """تعليقات العميل: ذاكرة العمل اليومية عليه (من كلّمه ومتى وماذا)."""
        page = QWidget()
        page.setObjectName("transparentHost")
        layout = QVBoxLayout(page)
        layout.setContentsMargins(0, 8, 0, 0)
        layout.setSpacing(8)

        self.comments_summary = QLabel("")
        self.comments_summary.setProperty("sectionTitle", True)
        self.comments_summary.setWordWrap(True)
        layout.addWidget(self.comments_summary)

        bar = QHBoxLayout()
        bar.setSpacing(6)
        self.comments_filter = QComboBox()
        self.comments_filter.setToolTip("فلتر سريع للتعليقات: كل العقود، بلا عقد محدد، أو عقد بعينه")
        self.comments_filter.setMinimumWidth(130)
        self.comments_filter.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        make_searchable(self.comments_filter, "")
        self.comments_filter.currentIndexChanged.connect(
            lambda *_: self._sec_comments())
        self.comments_search = QLineEdit()
        self.comments_search.setPlaceholderText("ابحث في التعليقات...")
        self.comments_search.setMinimumWidth(120)
        self.comments_search.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        from ui.widgets import connect_debounced_text
        connect_debounced_text(self.comments_search, self._sec_comments, delay_ms=420)
        bar.addWidget(self.comments_filter, 1)
        bar.addWidget(self.comments_search, 1)
        layout.addLayout(bar)

        # صندوق الكتابة: اختيار العقد أعلى العمود ثم نص التعليق وزر إرسال صغير
        box = QFrame()
        box.setProperty("card", True)
        box_l = QVBoxLayout(box)
        box_l.setContentsMargins(12, 8, 12, 8)
        box_l.setSpacing(6)
        contract_lbl = QLabel("يخص العقد:")
        contract_lbl.setStyleSheet("background: transparent; border: none; font-weight: 700;")
        box_l.addWidget(contract_lbl)
        self.comment_contract = QComboBox()
        self.comment_contract.setMinimumWidth(0)
        make_searchable(self.comment_contract, "")
        box_l.addWidget(self.comment_contract)
        self.comment_edit = QTextEdit()
        self.comment_edit.setPlaceholderText(
            "اكتب ما دار مع العميل اليوم · مثال: كلّمته ووعد بالسداد الخميس...")
        self.comment_edit.setFixedHeight(76)
        box_l.addWidget(self.comment_edit)
        send_row = QHBoxLayout()
        send_row.setContentsMargins(0, 0, 0, 0)
        send_row.addStretch()
        send_btn = QPushButton("➤")
        send_btn.setObjectName("btnPrimary")
        send_btn.setToolTip("إرسال التعليق")
        send_btn.setMinimumWidth(46)
        send_btn.setMaximumWidth(56)
        send_btn.clicked.connect(self._add_comment)
        send_row.addWidget(send_btn)
        box_l.addLayout(send_row)
        layout.addWidget(box)

        # فقاعات مؤرخة: (الاسم · التاريخ) ثم النص · المثبّت بخلفية كهرمانية
        self.comments_list = QListWidget()
        self.comments_list.setObjectName("commentsList")
        self.comments_list.setSpacing(6)
        self.comments_list.setSelectionMode(QListWidget.SingleSelection)
        self.comments_list.setWordWrap(True)
        self.comments_list.setUniformItemSizes(False)
        self.comments_list.setMinimumHeight(260)
        self.comments_list.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.comments_list.setContextMenuPolicy(Qt.CustomContextMenu)
        self.comments_list.customContextMenuRequested.connect(
            self._comments_menu)
        self.comments_list.itemDoubleClicked.connect(
            lambda _i: self._edit_comment())
        layout.addWidget(self.comments_list, 1)

        hint = QLabel("زر الفأرة الأيمن: تثبيت/حذف · التعديل للمدير فقط")
        hint.setProperty("hint", True)
        layout.addWidget(hint)
        return page

    def _open_comments_center(self):
        """فتح مركز التعليقات الموحد مفلترًا على هذا العميل."""
        try:
            from ui.widgets import find_host
            main = find_host(self, "open_comments_center")
            if main is not None and self.customer:
                main.open_comments_center(self.customer.id, None)
                return
        except Exception:
            pass
        style.info(self, "مركز التعليقات الموحد متاح من القائمة الجانبية: التعليقات.")

    def _sec_comments(self):
        """تعبئة فقاعات التعليقات + قائمة العقود + سطر الملخص."""
        from services import comment_service as cmt
        self._refresh_comments_filter()
        filter_id = self._comments_filter_contract_id()
        # عرض أحدث 100 تعليق فقط يحافظ على سرعة ملف العميل بعد استيراد
        # قواعد قديمة بها تعليقات كثيرة، والبحث ما زال يجلب نتائج أقدم عند الحاجة.
        _comments_limit = 100
        rows = cmt.list_comments(
            self.customer.id, self.comments_search.text(),
            contract_id=filter_id, limit=_comments_limit)
        self._comment_rows = rows
        # قائمة ربط التعليق الجديد بالعقد (مستقلة عن الفلتر)
        current = self.comment_contract.currentData()
        self.comment_contract.blockSignals(True)
        self.comment_contract.clear()
        self.comment_contract.addItem("غير محدد", None)
        for c in self._ctx.get("contracts", []):
            self.comment_contract.addItem(c["name"] or "عقد", c["id"])
        idx = self.comment_contract.findData(current)
        if idx >= 0:
            self.comment_contract.setCurrentIndex(idx)
        self.comment_contract.blockSignals(False)

        theme = style.theme()
        self.comments_list.clear()
        for row in rows:
            item = QListWidgetItem()
            widget = self._comment_bubble(row, theme)
            self.comments_list.addItem(item)
            self.comments_list.setItemWidget(item, widget)
        if len(rows) >= _comments_limit:
            self.comments_list.addItem(
                f"تم عرض أحدث {_comments_limit} تعليق فقط — استخدم البحث للوصول لتعليق أقدم.")
        self._relayout_comments()
        QTimer.singleShot(0, self._relayout_comments)
        QTimer.singleShot(80, self._relayout_comments)

        total = len(rows) if filter_id is not None else cmt.comments_count(self.customer.id)
        pinned = sum(1 for x in rows if x.get("pinned"))
        scope_txt = self.comments_filter.currentText() if hasattr(self, "comments_filter") else "كل العقود"
        text = f"التعليقات ({total}) · {scope_txt}"
        if pinned:
            text += f" · مثبّت: {pinned}"
        if self.comments_search.text().strip():
            text += f" · نتائج البحث: {len(rows)}"
        self.comments_summary.setText(text)

    def _relayout_comments(self):
        """ضبط ارتفاع فقاعات التعليقات مع منع تمدد تعليق كلمة واحدة كشريط طويل.

        عنصر القائمة يأخذ عرض القائمة كاملًا، لكن الفقاعة الداخلية نفسها تبقى
        بعرض مناسب ومقروء؛ القصير لا يتمدد، والطويل يلتف داخل حد أقصى واضح.
        """
        lst = getattr(self, "comments_list", None)
        if lst is None or not _qt_is_valid(lst):
            return
        viewport = lst.viewport()
        if viewport is None or not _qt_is_valid(viewport):
            return
        # العنصر بعرض الفيوبورت كاملًا (موضع عنصر القائمة يساري دائمًا)،
        # والفقاعة تلتصق بيمينه عبر الـ stretch + هامش اليمين الداخلي.
        width = max(260, viewport.width() - 8)
        bubble_max = max(300, min(760, width - 16))
        bubble_min = max(300, bubble_max - 12)
        for i in range(lst.count()):
            item = lst.item(i)
            widget = lst.itemWidget(item)
            if widget is None:
                continue
            widget.setFixedWidth(width)
            card = widget.findChild(QFrame, "commentBubbleCard")
            calc_height = 58
            if card is not None:
                card.setFixedWidth(bubble_max)
                inner_w = max(220, bubble_max - 30)
                body_h = meta_h = contract_h = 0
                for lbl_name in ("commentBubbleContract", "commentBubbleMeta"):
                    lbl = card.findChild(QLabel, lbl_name)
                    if lbl is not None:
                        lbl.setMinimumWidth(inner_w)
                        lbl.setMaximumWidth(inner_w)
                        lbl.setWordWrap(True)
                        rect = lbl.fontMetrics().boundingRect(
                            QRect(0, 0, inner_w, 10000),
                            Qt.TextWordWrap | Qt.AlignRight,
                            lbl.text() or " ")
                        wanted = max(lbl.minimumHeight(), rect.height() + 8)
                        lbl.setMinimumHeight(wanted)
                        lbl.updateGeometry()
                        if lbl_name == "commentBubbleContract":
                            contract_h = wanted
                        else:
                            meta_h = wanted
                body = card.findChild(QTextEdit, "commentBubbleBody")
                if body is not None:
                    body.setFixedWidth(inner_w)
                    # ممنوع استدعاء adjustSize() هنا: Qt يُسقط بعده textWidth
                    # إلى عرض المحتوى فيلتف النص بعرض ضيق يسار الفقاعة.
                    # الارتفاع يُحسب بمقياس الخط، وعرض النص يُثبَّت أخيرًا.
                    rect = body.fontMetrics().boundingRect(
                        QRect(0, 0, max(80, inner_w - 16), 10000),
                        Qt.TextWordWrap | Qt.AlignRight,
                        body.toPlainText() or " ")
                    body_h = max(38, rect.height() + 18)
                    body.setFixedHeight(body_h)
                    body.document().setTextWidth(max(80, inner_w - 6))
                    body.updateGeometry()
                # 16 هوامش داخلية + 5 مسافات بين السطور + احتياط يمنع قص آخر سطر/آخر تعليق.
                calc_height = max(58, body_h + meta_h + contract_h + 38)
            widget.adjustSize()
            if widget.layout() is not None:
                widget.layout().activate()
            height = max(widget.sizeHint().height(),
                         widget.minimumSizeHint().height(), calc_height, 58)
            item.setSizeHint(QSize(width, height + 20))

    def resizeEvent(self, event):        # noqa: N802 (Qt)
        """إعادة حساب ارتفاع الفقاعات وتكييف الأعمدة مع حجم الشاشة."""
        try:
            super().resizeEvent(event)
            self._apply_responsive_layout()
            self._relayout_comments()
        except Exception:
            pass

    def _apply_responsive_layout(self):
        """تكيف ملف العميل مع الشاشات المختلفة.

        يقلل عرض الأعمدة الثابتة تدريجيًا بدل خروج المحتوى خارج الشاشة.
        في العرض الضيق جدًا نُخفي عمود الفلاتر فقط لأنه قابل للتعويض
        من قوائم البحث/التابات، ونترك التعليقات أو تفاصيل العقد قابلة للقراءة.
        """
        try:
            w = max(0, int(self.width()))
            side = getattr(self, "contracts_side_panel", None)
            if side is not None:
                # V4.5.09: لوحة «عقود العميل» عمود ضيق ثابت — كانت تتوسع
                # حتى 670 فأكلت مساحة تفاصيل العقد.
                if w >= 1350:
                    side.setMinimumWidth(330); side.setMaximumWidth(380)
                elif w >= 1050:
                    side.setMinimumWidth(300); side.setMaximumWidth(345)
                else:
                    side.setMinimumWidth(270); side.setMaximumWidth(310)
            sp = getattr(self, "contracts_splitter", None)
            if sp is not None and sp.count() >= 2:
                first = 380 if w >= 1350 else 350 if w >= 1050 else 310
                if sum(sp.sizes()) <= 0:
                    sp.setSizes([first, max(520, w - first)])

            ctx = getattr(self, "notes_context_panel", None)
            if ctx is not None:
                show_ctx = w >= 980
                ctx.setVisible(show_ctx)
                if show_ctx:
                    ctx.setMinimumWidth(210 if w < 1250 else 230)
                    ctx.setMaximumWidth(250 if w < 1250 else 300)
            comments = getattr(self, "notes_comments_panel", None)
            if comments is not None:
                if w >= 1250:
                    comments.setMinimumWidth(300); comments.setMaximumWidth(380)
                else:
                    comments.setMinimumWidth(245); comments.setMaximumWidth(300)
        except Exception:
            pass

    def _comment_bubble(self, row: dict, theme: dict) -> QWidget:
        """فقاعة تعليق: سطر (الكاتب · التاريخ · العقد) ثم النص."""
        wrapper = QWidget()
        wrapper.setObjectName("commentBubbleWrapper")
        # نثبت اتجاه الحاوية أفقيًا حتى لا تعكس RTL ترتيب QHBoxLayout؛
        # النص نفسه يبقى RTL داخل الفقاعة. هذا يضع الفقاعة عند يمين القائمة.
        wrapper.setLayoutDirection(Qt.LeftToRight)
        wrapper.setStyleSheet("#commentBubbleWrapper { background: transparent; border: none; }")
        host = QHBoxLayout(wrapper)
        host.setContentsMargins(0, 0, 8, 0)
        host.setSpacing(0)

        box = QFrame(wrapper)
        box.setObjectName("commentBubbleCard")
        pinned = bool(row.get("pinned"))
        bg = "rgba(217,119,6,0.10)" if pinned else theme["SURFACE_2"]
        border = ("rgba(217,119,6,0.45)" if pinned
                  else theme["BORDER"])
        box.setStyleSheet(
            f"#commentBubbleCard {{ background: {bg}; border: 1.5px solid {border};"
            " border-radius: 10px; }"
            "#commentBubbleCard QLabel { background: transparent; border: none; }")
        box.setMinimumWidth(280)
        box.setMaximumWidth(760)
        box.setMinimumHeight(58)
        box.setSizePolicy(QSizePolicy.Maximum, QSizePolicy.Minimum)
        col = QVBoxLayout(box)
        col.setContentsMargins(12, 8, 12, 8)
        col.setSpacing(5)

        head = QHBoxLayout()
        head.setSpacing(8)
        who = row.get("author") or row.get("created_by") or "غير معروف"
        when = (row.get("created_at") or "")[:16]
        meta = QLabel(f"{who}  ·  {when}")
        meta.setObjectName("commentBubbleMeta")
        meta.setWordWrap(True)
        meta.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
        meta.setStyleSheet(
            f"color: {theme['TEXT_600']}; font-size: 11px; font-weight: 700;")
        head.addWidget(meta)
        if pinned:
            tag = QLabel("مثبّت")
            tag.setStyleSheet(
                f"color: {theme['WARNING_700']}; font-weight: 800;"
                " font-size: 11px;")
            head.addWidget(tag)
        if (row.get("edited_at") or "").strip():
            editor = row.get("editor") or "مدير"
            edited = QLabel(f"عُدّل بواسطة {editor}")
            edited.setStyleSheet(
                f"color: {theme['TEXT_400']}; font-size: 10.5px;")
            edited.setToolTip(f"وقت التعديل: {(row.get('edited_at') or '')[:16]}")
            head.addWidget(edited)
        head.addStretch()
        col.addLayout(head)
        if row.get("contract_label"):
            ctr = QLabel(row["contract_label"])
            ctr.setObjectName("commentBubbleContract")
            ctr.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
            ctr.setWordWrap(True)
            ctr.setStyleSheet(
                f"color: {theme['BRAND_700']}; font-size: 11px;"
                " font-weight: 700;")
            col.addWidget(ctr)

        body = QTextEdit()
        body.setObjectName("commentBubbleBody")
        body.setReadOnly(True)
        body.setAcceptRichText(False)
        body.setFrameShape(QFrame.NoFrame)
        body.setLineWrapMode(QTextEdit.WidgetWidth)
        body.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        body.setVerticalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        body.setLayoutDirection(Qt.RightToLeft)
        opt = QTextOption(Qt.AlignRight | Qt.AlignAbsolute)
        opt.setTextDirection(Qt.RightToLeft)
        body.document().setDefaultTextOption(opt)
        body.setPlainText(row.get("body") or "")
        # setPlainText يعيد تنسيق الفقرة أحيانًا؛ نحدد المحاذاة بعد النص
        # حتى لا تظهر الكلمة العربية في الجهة اليسرى داخل الفقاعة.
        body.selectAll()
        # AlignAbsolute إجباري: بدونه تُقرأ AlignRight كـ«النهاية» فتظهر يسارًا.
        body.setAlignment(Qt.AlignRight | Qt.AlignTop | Qt.AlignAbsolute)
        cursor = body.textCursor()
        cursor.clearSelection()
        body.setTextCursor(cursor)
        body.setTextInteractionFlags(Qt.TextSelectableByMouse)
        body.setMinimumHeight(34)
        body.setStyleSheet(
            f"QTextEdit#commentBubbleBody {{ color: {theme['TEXT_900']}; "
            "font-size: 12.5px; background: transparent; border: none; "
            "padding: 0px; margin: 0px; }")
        body.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        col.addWidget(body)
        host.addStretch()
        host.addWidget(box, 0, Qt.AlignRight | Qt.AlignTop)
        wrapper.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Minimum)
        return wrapper

    def _selected_comment(self) -> dict | None:
        row = self.comments_list.currentRow()
        rows = getattr(self, "_comment_rows", [])
        if row < 0 or row >= len(rows):
            style.info(self, "اختر تعليقًا من القائمة أولاً.")
            return None
        return rows[row]

    def _add_comment(self):
        from services import comment_service as cmt
        text = self.comment_edit.toPlainText()
        try:
            cmt.add_comment(
                self.customer.id, text,
                self.comment_contract.currentData())
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
            return
        self.comment_edit.clear()
        style.toast(self, "تمت إضافة التعليق")
        self._sec_comments()
        self._fill_last_comment()

    def _edit_comment(self):
        from services import comment_service as cmt
        row = self._selected_comment()
        if not row:
            return
        if not cmt.can_edit(row):
            style.error(self, "تعديل التعليقات من صلاحيات المدير فقط.")
            return
        from PySide6.QtWidgets import QInputDialog
        text, ok = QInputDialog.getMultiLineText(
            self, "تعديل التعليق", "نص التعليق:", row["body"] or "")
        if not ok:
            return
        try:
            cmt.update_comment(row["id"], text)
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
            return
        style.toast(self, "تم تعديل التعليق")
        self._sec_comments()
        self._fill_last_comment()

    def _delete_comment(self):
        from services import comment_service as cmt
        row = self._selected_comment()
        if not row:
            return
        preview = (row["body"] or "")[:60]
        if not style.confirm(self, f"حذف التعليق؟\n\n«{preview}»",
                             "حذف تعليق"):
            return
        try:
            cmt.delete_comment(row["id"])
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
            return
        style.toast(self, "تم حذف التعليق")
        self._sec_comments()
        self._fill_last_comment()

    def _pin_comment(self):
        from services import comment_service as cmt
        row = self._selected_comment()
        if not row:
            return
        try:
            pinned = cmt.toggle_pin(row["id"])
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
            return
        style.toast(self, "تم التثبيت" if pinned else "أُلغي التثبيت")
        self._sec_comments()

    def _comments_menu(self, pos):
        from PySide6.QtWidgets import QMenu
        from services import comment_service as cmt
        item = self.comments_list.itemAt(pos)
        if item is None:
            return
        row = self.comments_list.row(item)
        self.comments_list.setCurrentRow(row)
        data = getattr(self, "_comment_rows", [])[row]
        menu = QMenu(self)
        act_edit = menu.addAction("تعديل التعليق")
        act_edit.setEnabled(cmt.can_edit(data))
        if not cmt.can_edit(data):
            act_edit.setText("تعديل التعليق (مدير فقط)")
        act_pin = menu.addAction("إلغاء التثبيت" if data.get("pinned")
                                 else "تثبيت في الأعلى")
        act_pin.setEnabled(cmt.can_pin())
        if not cmt.can_pin():
            act_pin.setText(act_pin.text() + " (مدير)")
        menu.addSeparator()
        act_del = menu.addAction("حذف التعليق")
        act_del.setEnabled(cmt.can_delete(data))
        chosen = menu.exec(self.comments_list.viewport().mapToGlobal(pos))
        if chosen is act_edit:
            self._edit_comment()
        elif chosen is act_pin:
            self._pin_comment()
        elif chosen is act_del:
            self._delete_comment()

    def _add_file(self):
        paths, _ = QFileDialog.getOpenFileNames(
            self, "إضافة ملفات إلى أرشيف العميل", "",
            "كل الملفات (*);;PDF (*.pdf);;صور (*.png *.jpg *.jpeg)")
        if not paths:
            return
        added = 0
        for p in paths:
            try:
                archive_service.save_to_archive(self.customer, p)
                added += 1
            except OSError:
                pass
        if added:
            self._dirty["overview"] = True
            try:
                self._refresh_share()
            except Exception:
                pass
            style.info(self, f"تمت إضافة {added} ملف إلى الأرشيف.", "تم")
        else:
            style.error(self, "تعذر إضافة الملفات.")

    def _open_archive_folder(self):
        folder = archive_service.get_customer_folder(self.customer)
        if not _open_externally(folder):
            style.error(self, "تعذر فتح مجلد أرشيف العميل على الشير.\nتأكد من صلاحيات المستخدم ومسار الشبكة:\n" + folder)

    # ---------- مجلد الشبكة ----------
    def _refresh_share(self):
        from services import folder_service
        path = (self.customer.folder_path or "").strip()
        if not path:
            self.share_path.setText("غير مضبوط، اضغط «تعيين / تغيير» لربط "
                                    "مجلد المهندس على الشبكة")
            self.share_open_btn.setEnabled(False)
            if hasattr(self, "share_clear_btn"):
                self.share_clear_btn.setEnabled(False)
            return
        self.share_open_btn.setEnabled(True)
        if hasattr(self, "share_clear_btn"):
            self.share_clear_btn.setEnabled(True)
        state = ""
        try:
            st = folder_service.check_customer_folder(self.customer.id)
            if st.get("available") is False:
                state = "  ⚠ غير متاح حاليًا (تحقق من اتصال الشبكة)"
            elif st.get("has_update"):
                state = "  🔴 يوجد تحديث جديد"
        except Exception:
            pass
        self.share_path.setText(path + state)

    def _open_share(self):
        from services import folder_service
        path = (self.customer.folder_path or "").strip()
        if not folder_service.open_folder(path):
            style.error(self, "تعذر فتح المجلد:\n" + path +
                        "\n\nتأكد أن جهاز الشبكة متصل، وأن المسار يفتح "
                        "من مستكشف ويندوز بنفسه.")
            return
        try:
            folder_service.mark_folder_seen(self.customer.id)
        except Exception:
            pass
        self._refresh_share()

    def _clear_share(self):
        """مسح مسار مجلد الشبكة من العميل دون حذف ملفات من القرص/الشير."""
        path = (self.customer.folder_path or "").strip()
        if not path:
            self._refresh_share()
            return
        if not style.confirm(
                self,
                "حذف مسار مجلد الشبكة من بطاقة هذا العميل؟\n\n"
                f"المسار الحالي:\n{path}\n\n"
                "لن يتم حذف أي ملف من الجهاز أو الشبكة؛ سيتم فقط إلغاء الربط.",
                "حذف مسار الشبكة"):
            return
        try:
            from services import customer_service as _cs
            self.customer.folder_path = ""
            _cs.update_customer(self.customer)
        except Exception as exc:
            style.error(self, f"تعذر حذف المسار:\n{exc}")
            return
        self._refresh_share()
        style.toast(self, "تم حذف مسار مجلد الشبكة من العميل")

    def _set_share(self):
        from services import customer_service as _cs
        path = QFileDialog.getExistingDirectory(
            self, "اختر مجلد العميل على الشبكة",
            (self.customer.folder_path or "").strip())
        if not path:
            return
        try:
            # طبّع الصيغة (//PC/شير ← \\PC\\شير) قبل التخزين
            from services.folder_service import normalize_share_path
            self.customer.folder_path = normalize_share_path(path)
            _cs.update_customer(self.customer)
        except Exception as exc:
            style.error(self, f"تعذر حفظ المسار:\n{exc}")
            return
        self._refresh_share()

    # ==================== 5) المهام والمتابعة ====================
    # ==================== إجراءات عامة ====================
    def _edit_customer(self):
        from ui.customers import CustomerDialog
        from services import customer_service as _cs
        dlg = CustomerDialog(self, self.customer)
        if dlg.exec() == QDialog.Accepted:
            updated = _cs.get_customer(self.customer.id)
            if updated:
                self.customer = updated
            self.setWindowTitle(f"ملف العميل · {self.customer.name}")
            self.refresh()

    def _whatsapp(self):
        from services.extras_service import open_whatsapp
        phone = (self.customer.phone or "").strip()
        if not phone:
            style.info(self, "لا يوجد رقم هاتف مسجل لهذا العميل.")
            return
        totals = self._ctx["totals"]
        msg = (f"السادة / {self.customer.name} المحترمين\n"
               f"تحية طيبة وبعد،\n"
               f"إجمالي التعاملات: {totals['current']:,.3f}\n"
               f"المسدد: {totals['collected']:,.3f}\n"
               f"المتبقي: {totals['remaining']:,.3f}\n"
               "وتفضلوا بقبول فائق الاحترام.")
        if not open_whatsapp(phone, msg):
            style.error(self, "تعذر فتح واتساب، تأكد من تثبيته أو من "
                              "صحة رقم الهاتف.")

    def _quick_voucher(self, vtype: str):
        from ui.actions import open_voucher
        # إذا كان عقد محدد ظاهرًا في ملف العميل، يُربط السند به مباشرة
        # حتى يؤثر فورًا على ملخص العقد والتحصيل.
        contract_id = None
        try:
            detail = getattr(self, "contract_detail", None)
            if detail is not None and detail.isVisible():
                contract_id = getattr(detail, "contract_id", None)
        except Exception:
            contract_id = None
        open_voucher(self, vtype, customer_id=self.customer.id,
                     contract_id=contract_id,
                     on_saved=self.refresh)

    def _new_contract(self):
        from ui.actions import open_contract
        open_contract(self, customer_id=self.customer.id, on_saved=self.refresh)

    def _customer_statement(self):
        """كشف حساب العميل: كشوف كل عقوده في ملف PDF واحد."""
        contracts = self._ctx.get("contracts", [])
        if not contracts:
            style.info(self, "لا توجد عقود لهذا العميل بعد.")
            return
        if len(contracts) == 1:
            self._visible_contracts = contracts
            self.cons_table.setCurrentCell(0, 0)
            con = contracts[0]
            import tempfile
            from reports.statement_pdf import generate_statement_pdf
            from ui.pdf_preview import PdfPreviewDialog, make_temp_pdf_path
            try:
                path = os.path.join(tempfile.gettempdir(),
                                    f"statement_{con['contract_number']}.pdf")
                generate_statement_pdf(con["id"], path)
                PdfPreviewDialog(self, path, "كشف حساب العقد",
                             os.path.basename(path)).exec()
            except Exception as exc:
                style.error(self, f"تعذر إنشاء كشف الحساب:\n{exc}")
            return
        # أكثر من عقد: كشف لكل عقد في مجلد واحد
        self._batch_print(statements_only=True)

    def _batch_print(self, statements_only: bool = False):
        import re as _re
        from services.batch_print_service import batch_export
        from services import invoice_service
        items = []
        contracts = contract_service.list_contracts(customer_id=self.customer.id)
        for c in contracts:
            items.append({"kind": "statement", "contract_id": c.id,
                          "contract_number": c.contract_number,
                          "label": f"كشف {c.contract_number}"})
        from services import feature_service as _feat13inv2
        if not statements_only:
            contract_ids = {c.id for c in contracts}
            for v in lc.list_vouchers():
                if v.get("contract_id") in contract_ids or (
                        v.get("party_type") == "customer"
                        and v.get("party_id") == self.customer.id):
                    items.append({"kind": "voucher", "voucher": v,
                                  "label": v["voucher_number"]})
            _invs13 = (invoice_service.list_invoices(
                customer_id=self.customer.id)
                if _feat13inv2.enabled("invoices") else [])
            for inv in _invs13:   # V4.5.13: مفتاح الفواتير يخفي صفوفها
                items.append({"kind": "invoice", "invoice": inv,
                              "label": inv.invoice_number})
        if not items:
            style.info(self, f"لا توجد مستندات للعميل «{self.customer.name}».")
            return
        folder = QFileDialog.getExistingDirectory(
            self, f"اختر مجلد حفظ مستندات {self.customer.name}")
        if not folder:
            return
        safe = _re.sub(r'[\\/:*?"<>|]', "_", self.customer.name)[:40]
        out_dir = os.path.join(folder, f"مستندات_{safe}")
        done, failed = batch_export(items, out_dir)
        msg = f"تم توليد {len(done)} مستندًا في:\n{out_dir}"
        if failed:
            msg += f"\n\nفشل: {len(failed)} · {', '.join(failed[:5])}"
        style.info(self, msg, "الطباعة الدفعية")
        _open_externally(out_dir)


class CustomerArchiveDialog(QDialog):
    """غلاف رفيع لملف العميل · يُستخدم عند الفتح من نافذة منبثقة.

    كل المنطق في CustomerFileWidget؛ هذا الصنف يوفّر نافذة فقط ويمرّر
    أي وصول (سمات/دوال) إلى الويدجت للحفاظ على الـ API القديمة.
    """

    PAGES = CustomerFileWidget.PAGES

    def __init__(self, parent, customer: Customer,
                 open_page: str = "overview"):
        super().__init__(parent)
        style.ensure_light_background(self)
        self.setLayoutDirection(Qt.RightToLeft)
        self.setWindowTitle(f"ملف العميل · {customer.name}")
        style.fit_window(self, 1150, 760, min_w=900, min_h=600)
        style.center_on_screen(self)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        self.widget = CustomerFileWidget(self, customer, open_page)
        self.widget.back_requested.connect(self.accept)
        layout.addWidget(self.widget)

    def __getattr__(self, name):
        """تمرير أي سمة غير موجودة إلى الويدجت (API واحدة للوضعين)."""
        widget = self.__dict__.get("widget")
        if widget is None:
            raise AttributeError(name)
        return getattr(widget, name)
