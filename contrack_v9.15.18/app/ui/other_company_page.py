# -*- coding: utf-8 -*-
"""V4.8: مركز حساب الشركة الأخرى — كشف دفتري موحد + تسديد + افتتاحي.

V4.40: الثورة — 3 تبويبات (مستحق/مسدد/تقرير عمليات) · الكشف
والتسوية اليومية تحت ⋯ عرض متقدم · بلا تجميع بتاريخ الرفع.

V4.42: بلا زر ⋯ — تصدير/طباعة/افتتاحي أزرار مباشرة.
"""
from PySide6.QtCore import QDate, Qt
from PySide6.QtGui import QColor, QFont
from PySide6.QtWidgets import (QComboBox, QDateEdit, QDialog, QDialogButtonBox,
                               QDoubleSpinBox, QFormLayout, QFrame, QHBoxLayout,
                               QLabel, QLineEdit, QMessageBox, QPushButton,
                               QRadioButton, QVBoxLayout, QWidget)

from services import settlement_service as st
from ui import style
from ui.archive import _fill, _table
from ui.clearing_page import DayDetailDialog, TransferDialog
from ui.due_items_page import DueItemsPage, _collection_cell
from ui.due_items_page import HEADS as DUES_HEADS
from ui.due_items_page import PAID_HEADS as DUES_PAID_HEADS
from ui.widgets import (SegmentedTabs, apply_column_weights, export_table_excel,
                        size_buttons)

HEADS = ["✓", "التاريخ", "الحركة", "النوع", "مستحق لها (+)",
         "مسدد لها (−)", "الرصيد المتبقي"]
KIND_LABEL = {"due": "📌 مستحق", "pay": "💸 تسديد"}
KIND_COLORS = {"due": "#1D4ED8", "pay": "#166534"}
OPS_REP_HEADS = ["التاريخ", "العميل", "الهاتف", "البوابة", "الصافي",
                 "المدفوع", "المتبقي", "الحالة", "T+1"]
REP_STATUS = {"paid": "✅ مسدد", "partial": "🟡 جزئي",
              "unpaid": "📌 مستحق", "none": "—"}
REP_COLORS = {"paid": "#166534", "partial": "#B45309",
              "unpaid": "#1D4ED8", "none": "#64748B"}
OP_STATUS = {"paid": "✅ مسدد", "partial": "🟡 جزئي",
             "unpaid": "📌 مستحق", "due": "📌 مستحق", "na": "—"}
OP_COLORS = {"paid": "#166534", "partial": "#B45309",
             "unpaid": "#1D4ED8", "due": "#1D4ED8", "na": "#64748B"}
DAY_HEADS = ["اليوم", "العمليات", "الكامل", "العمولة", "الصافي",
             "المدفوع", "المتبقي", "الحالة"]
DAY_OP_HEADS = ["الاسم", "الهاتف", "المرجع", "البوابة", "الكامل",
                "الصافي", "المدفوع", "المتبقي", "الحالة"]


def _items(n: int) -> str:
    """صياغة عدد البنود عربيًا: بند / بندان / بنود / بندًا."""
    if n == 1:
        return "1 بند"
    if n == 2:
        return "بندان"
    if 3 <= n <= 10:
        return f"{n} بنود"
    return f"{n} بندًا"


def _sheet_name(name: str, used: set) -> str:
    """اسم ورقة إكسل آمن (بلا محظورات + ≤31 + فريد)."""
    bad = chr(92) + "/?*[]:"
    clean = "".join(c for c in (name or "ورقة")
                    if c not in bad).strip() or "ورقة"
    base = clean[:28]
    name, i = base, 2
    while name in used:
        name = (base[:25] + " (" + str(i) + ")")[:31]
        i += 1
    used.add(name)
    return name


class OpeningDialog(QDialog):
    """تعديل الرصيد الافتتاحي (مستحقات قبل النظام)."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("الرصيد الافتتاحي للشركة الأخرى")
        self.setLayoutDirection(Qt.RightToLeft)
        self.resize(360, 200)
        op = st.get_other_opening()
        root = QVBoxLayout(self)
        form = QFormLayout()
        self.amount = QDoubleSpinBox()
        self.amount.setRange(0, 10000000)
        self.amount.setDecimals(3)
        self.amount.setValue(op["amount"])
        form.addRow("المبلغ المستحق لها:", self.amount)
        self.note = QLineEdit(op["note"])
        self.note.setPlaceholderText("بيان (اختياري)")
        form.addRow("البيان:", self.note)
        root.addLayout(form)
        bb = QDialogButtonBox(QDialogButtonBox.Save |
                              QDialogButtonBox.Cancel)
        bb.button(QDialogButtonBox.Save).setText("💾 حفظ")
        bb.button(QDialogButtonBox.Cancel).setText("إلغاء")
        bb.accepted.connect(self._save)
        bb.rejected.connect(self.reject)
        root.addWidget(bb)

    def _save(self):
        try:
            st.set_other_opening(self.amount.value(), self.note.text())
        except ValueError as exc:
            style.error(self, str(exc))
            return
        style.success(self, "حُفظ الرصيد الافتتاحي ✅")
        self.accept()


class TransferDetailDialog(QDialog):
    """تفاصيل تسديد: بياناته + العمليات التي غطاها + حذف."""

    def __init__(self, parent, tid: int):
        super().__init__(parent)
        self._tid = tid
        t = st.get_transfer(tid) or {}
        self.setWindowTitle(f"تسديد #{tid}")
        self.setLayoutDirection(Qt.RightToLeft)
        self.resize(640, 440)
        root = QVBoxLayout(self)
        bits = [f"التاريخ: {t.get('tdate', '')}",
                f"المبلغ: {float(t.get('amount') or 0):,.3f} د.ك"]
        if t.get("ref"):
            bits.append(f"المرجع: {t['ref']}")
        if t.get("method"):
            bits.append(f"الطريقة: {t['method']}")
        if t.get("voucher_number"):
            bits.append(f"سند الصرف: {t['voucher_number']}")
        if t.get("notes"):
            bits.append(f"ملاحظات: {t['notes']}")
        info = QLabel(" · ".join(bits))
        info.setWordWrap(True)
        root.addWidget(info)
        stmt = st.transfer_statement(tid)
        ops = stmt["ops"]
        self._stmt = stmt
        root.addWidget(QLabel(f"العمليات المغطاة ({len(ops)}):"))
        tbl = _table(["التاريخ", "البوابة", "اسم العميل", "الهاتف",
                      "المغطى", "المرجع"])
        _fill(tbl, [[o["op_date"], o["gateway"], o["customer"] or "",
                     o["phone"],
                     f"{float(o.get('alloc') or 0):,.3f}",
                     o["ref"] or ""]
                    for o in ops], money_cols=(4,))
        apply_column_weights(tbl, [13, 13, 24, 15, 14, 21])
        root.addWidget(tbl, 1)
        bar = QHBoxLayout()
        bar.addStretch()
        if not t.get("voucher_id"):
            delete_btn = QPushButton("🗑 حذف التسديد")
            delete_btn.clicked.connect(self._delete)
            bar.addWidget(delete_btn)
        export_btn = QPushButton("📤 تصدير الكشف")
        export_btn.clicked.connect(self._export)
        bar.addWidget(export_btn)
        close_btn = QPushButton("✕ إغلاق")
        close_btn.clicked.connect(self.reject)
        bar.addWidget(close_btn)
        root.addLayout(bar)

    def _export(self):
        """تصدير كشف التسديد — جاهز للإرسال للشركة الأخرى."""
        stmt = getattr(self, "_stmt", None) \
            or st.transfer_statement(self._tid)
        t, ops = stmt["transfer"], stmt["ops"]
        if not ops:
            style.info(self, "لا توجد عمليات مغطاة بهذا التسديد.")
            return
        data = [[o["op_date"], o["customer"] or "", o["phone"],
                 round(float(o.get("alloc") or 0), 3), o["ref"] or ""]
                for o in ops]
        data.append(["", "", f"الإجمالي ({len(ops)} عملية)",
                     stmt["total"], ""])
        export_table_excel(
            self, f"كشف تسديد #{self._tid} — الشركة الأخرى "
                  f"({t.get('tdate', '')})",
            ["التاريخ", "اسم العميل", "الهاتف", "المبلغ", "المرجع"],
            data, f"other_payment_{self._tid}", number_cols=[3])

    def _delete(self):
        ans = QMessageBox.question(
            self, "حذف تسديد", "حذف هذا التسديد وفك ربط عملياته؟\n"
            "(ستعود عملياته «غير مسددة»)",
            QMessageBox.Yes | QMessageBox.No)
        if ans != QMessageBox.Yes:
            return
        try:
            st.delete_other_transfer(self._tid)
        except ValueError as exc:
            style.error(self, str(exc))
            return
        self.accept()


class OpPaymentsDialog(QDialog):
    """تسديدات عملية واحدة (V4.34) — ضغطتان على أي تسديد تفتح كشفه."""

    def __init__(self, parent, op: dict):
        super().__init__(parent)
        pays = op.get("payments") or []
        self.setWindowTitle(
            f"تسديدات العملية ({op.get('customer') or '—'} · "
            f"{float(op.get('amount') or 0):,.3f} د.ك)")
        self.setLayoutDirection(Qt.RightToLeft)
        self.resize(560, 300)
        root = QVBoxLayout(self)
        tbl = _table(["التسديد", "التاريخ", "المبلغ", "المرجع",
                      "سند الصرف"])
        _fill(tbl, [[f"ت#{p['transfer_id']}", p["tdate"],
                     f"{p['alloc']:,.3f}", p["ref"] or "—",
                     p["voucher_number"] or "—"]
                    for p in pays], money_cols=(2,))
        apply_column_weights(tbl, [12, 18, 18, 26, 26])
        tbl.cellDoubleClicked.connect(
            lambda r, _c: self._open(pays[r]["transfer_id"])
            if 0 <= r < len(pays) else None)
        root.addWidget(tbl, 1)
        close_btn = QPushButton("✕ إغلاق")
        close_btn.clicked.connect(self.reject)
        root.addWidget(close_btn)
        self._pays = pays

    def _open(self, tid: int):
        if TransferDetailDialog(self, tid).exec():
            self.accept()


class ExportDialog(QDialog):
    """اختيار نوع التصدير — المطابقة بفترة (افتراضيًا تواريخ الشاشة)."""

    def __init__(self, parent, d1: str, d2: str,
                 report_mode: bool = False):
        super().__init__(parent)
        self._first_kind = "ops" if report_mode else "ledger"
        self.setWindowTitle("📤 تصدير")
        self.setLayoutDirection(Qt.RightToLeft)
        self.resize(380, 240)
        root = QVBoxLayout(self)
        self.opt_ledger = QRadioButton(
            "📊 تقرير العمليات (كما في الشاشة)" if report_mode
            else "📄 الكشف الظاهر (كما في الشاشة)")
        self.opt_recon = QRadioButton("🧾 تقرير المطابقة للشركة الأخرى")
        self.opt_ledger.setChecked(True)
        root.addWidget(self.opt_ledger)
        root.addWidget(self.opt_recon)
        form = QFormLayout()
        self.d1 = QDateEdit(QDate.fromString(d1, "yyyy-MM-dd"))
        self.d1.setCalendarPopup(True)
        self.d1.setDisplayFormat("yyyy-MM-dd")
        self.d2 = QDateEdit(QDate.fromString(d2, "yyyy-MM-dd"))
        self.d2.setCalendarPopup(True)
        self.d2.setDisplayFormat("yyyy-MM-dd")
        form.addRow("من:", self.d1)
        form.addRow("إلى:", self.d2)
        root.addLayout(form)
        self.opt_recon.toggled.connect(lambda _c: self._toggle_dates())
        self._toggle_dates()
        bb = QDialogButtonBox(QDialogButtonBox.Save | QDialogButtonBox.Cancel)
        bb.button(QDialogButtonBox.Save).setText("📤 تصدير")
        bb.button(QDialogButtonBox.Cancel).setText("إلغاء")
        bb.accepted.connect(self.accept)
        bb.rejected.connect(self.reject)
        root.addWidget(bb)

    def _toggle_dates(self):
        on = self.opt_recon.isChecked()
        self.d1.setEnabled(on)
        self.d2.setEnabled(on)

    def choice(self) -> tuple:
        if self.opt_recon.isChecked():
            kind = "recon"
        else:
            kind = self._first_kind
        return (kind, self.d1.date().toString("yyyy-MM-dd"),
                self.d2.date().toString("yyyy-MM-dd"))


class OtherCompanyPage(QWidget):
    """كشف حساب دفتري للأخرى: مستحق/مسدد برصيد جارٍ + تسديد + تصدير."""

    def __init__(self, parent=None, embedded: bool = False):
        super().__init__(parent)
        self.setLayoutDirection(Qt.RightToLeft)
        self._ledger: dict = {"lines": []}
        self._items: list[dict] = []
        self._ops: list[dict] = []
        self._opening: dict = {"amount": 0.0, "note": ""}
        self._unalloc: float = 0.0
        self._shown_ops: list[dict] = []
        self._sel_day = None
        self._daily: dict = {"days": [], "transfers": []}
        self._detail_ops: list[dict] = []
        root = QVBoxLayout(self)
        root.setContentsMargins(12, 8, 12, 8)
        root.setSpacing(8)

        top = QHBoxLayout()
        title = QLabel("🏢 حساب الشركة الأخرى")
        title.setProperty("pageTitle", True)
        top.addWidget(title)
        if embedded:
            title.setVisible(False)
        top.addStretch()
        self.pay_btn = QPushButton("💸 دفعة على الحساب")
        self.pay_btn.setProperty("flat", True)
        self.pay_btn.setToolTip("تسديد غير مربوط ببنود (دفعة على الحساب)")
        self.pay_btn.clicked.connect(self._open_transfer)
        self.export_btn = QPushButton("📤 تصدير")
        self.export_btn.setProperty("flat", True)
        self.export_btn.setToolTip("تصدير التبويب الحالي Excel")
        self.export_btn.clicked.connect(self._open_export)
        self.print_btn = QPushButton("🖨 طباعة")
        self.print_btn.setProperty("flat", True)
        self.print_btn.setToolTip("طباعة التبويب الحالي PDF")
        self.print_btn.clicked.connect(self._print_current)
        self.opening_btn = QPushButton("⚙️ الرصيد الافتتاحي")
        self.opening_btn.setProperty("flat", True)
        self.opening_btn.setToolTip("تعديل الرصيد الافتتاحي للشركة الأخرى")
        self.opening_btn.clicked.connect(self._open_opening)
        size_buttons([self.pay_btn, self.export_btn, self.print_btn,
                      self.opening_btn], min_w=130, uniform=False)
        top.addWidget(self.pay_btn)
        top.addWidget(self.export_btn)
        top.addWidget(self.print_btn)
        top.addWidget(self.opening_btn)
        root.addLayout(top)

        cards = QHBoxLayout()
        cards.setSpacing(8)
        self._cards = {}
        for key, label, color in (
                ("dues", "📌 إجمالي المستحق لها", "#3730A3"),
                ("paid", "💸 إجمالي المسدد", "#166534"),
                ("remaining", "⚖️ المتبقي لها الآن", "#991B1B")):
            card = QFrame()
            card.setProperty("card", True)
            lay = QVBoxLayout(card)
            lay.setContentsMargins(10, 6, 10, 6)
            name = QLabel(label)
            name.setStyleSheet(f"font-weight: 700; color: {color};")
            val = QLabel("0.000")
            val.setStyleSheet("font-weight: 800; font-size: 16px;")
            lay.addWidget(name)
            lay.addWidget(val)
            cards.addWidget(card, 1)
            self._cards[key] = val
        root.addLayout(cards)
        # V4.5.13: مؤشر تلقائي «هل في عمولة أم لا» أسفل بطاقات الحساب
        self.fees_hint = QLabel("")
        self.fees_hint.setWordWrap(True)
        self.fees_hint.setVisible(False)
        root.addWidget(self.fees_hint)

        bar = QHBoxLayout()
        self.mode = SegmentedTabs()
        self.mode.addItem("📌 المستحق", "due")
        self.mode.addItem("✅ المسدد", "paid")
        self.mode.addItem("📊 التقرير", "ops")
        self.mode.addItem("الكشف المالي", "ledger")
        self.mode.addItem("📅 التسوية اليومية", "daily")
        self.mode.currentIndexChanged.connect(
            lambda _i: self._switch_mode())
        bar.addWidget(self.mode)
        self._lbl_from = QLabel("من:")
        bar.addWidget(self._lbl_from)
        self.d1 = QDateEdit(QDate.currentDate().addMonths(-1))
        self.d1.setCalendarPopup(True)
        self.d1.setDisplayFormat("yyyy-MM-dd")
        bar.addWidget(self.d1)
        self._lbl_to = QLabel("إلى:")
        bar.addWidget(self._lbl_to)
        self.d2 = QDateEdit(QDate.currentDate())
        self.d2.setCalendarPopup(True)
        self.d2.setDisplayFormat("yyyy-MM-dd")
        bar.addWidget(self.d2)
        self.kind = SegmentedTabs()
        self.kind.addItem("الكل", "all")
        self.kind.addItem("مستحق لها", "due")
        self.kind.addItem("مسدد لها", "pay")
        self.kind.currentIndexChanged.connect(lambda _i: self._render())
        bar.addWidget(self.kind)
        self.search = QLineEdit()
        self.search.setPlaceholderText("🔍 بحث في البيان...")
        self.search.setClearButtonEnabled(True)
        self.search.setMinimumWidth(200)
        self.search.textChanged.connect(lambda _t: self._render())
        bar.addWidget(self.search)
        bar.addStretch()
        root.addLayout(bar)
        self.d1.dateChanged.connect(lambda _d: self.refresh())
        self.d2.dateChanged.connect(lambda _d: self.refresh())

        self.table = _table(HEADS)
        self.table.cellDoubleClicked.connect(self._open_row)
        self.table.cellClicked.connect(self._on_table_click)
        self.table.itemChanged.connect(
            lambda _i: self._update_checked_total())
        root.addWidget(self.table, 1)
        self.dues_embed = DueItemsPage(embedded=True, pay_external=True,
                                       on_export=None)
        self.dues_embed.layout().setContentsMargins(0, 0, 0, 0)
        self.dues_embed.setVisible(False)
        self.dues_embed.table.itemChanged.connect(
            lambda _i: self._sync_dues_pay())
        root.addWidget(self.dues_embed, 1)
        self.detail_box = QFrame()
        self.detail_box.setProperty("card", True)
        droot = QVBoxLayout(self.detail_box)
        droot.setContentsMargins(10, 6, 10, 6)
        droot.setSpacing(6)
        dbar = QHBoxLayout()
        self.detail_info = QLabel("")
        self.detail_info.setWordWrap(True)
        self.detail_info.setStyleSheet("font-weight: 700;")
        dbar.addWidget(self.detail_info, 1)
        self.detail_close = QPushButton("✕")
        self.detail_close.setProperty("flat", True)
        self.detail_close.setToolTip("إغلاق التفاصيل")
        self.detail_close.clicked.connect(self._close_detail)
        dbar.addWidget(self.detail_close)
        droot.addLayout(dbar)
        self.ops_table = _table(DAY_OP_HEADS)
        droot.addWidget(self.ops_table, 1)
        self.detail_box.setVisible(False)
        root.addWidget(self.detail_box, 1)
        self.refresh()
        for i, b in enumerate(self.mode._buttons):
            if self.mode.itemData(i) in ("ledger", "daily"):
                b.setVisible(False)
        self.mode.setCurrentData("due")

    def _dates(self):
        return (self.d1.date().toString("yyyy-MM-dd"),
                self.d2.date().toString("yyyy-MM-dd"))

    def refresh(self):
        d1, d2 = self._dates()
        try:
            self._items = st.unpaid_other_items()
        except Exception:
            self._items = []
        try:
            self._ops = st.other_ops_status(d1, d2)
        except Exception:
            self._ops = []
        try:
            self._opening = st.get_other_opening()
        except Exception:
            self._opening = {"amount": 0.0, "note": ""}
        try:
            self._unalloc = st.unallocated_transfer_amount()
        except Exception:
            self._unalloc = 0.0
        self._ledger = st.other_ledger(d1, d2)
        try:
            self._daily = st.other_daily_settlement(d1, d2)
        except Exception:
            self._daily = {"days": [],
                           "totals": {"n": 0, "gross": 0.0, "fees": 0.0,
                                      "net": 0.0, "paid": 0.0,
                                      "remaining": 0.0},
                           "transfers": [], "transfers_total": 0.0}
        try:
            self.dues_embed.refresh()
        except Exception:
            pass
        bal = st.other_balance()
        self._cards["dues"].setText(f"{bal['dues']:,.3f}")
        self._cards["paid"].setText(f"{bal['paid']:,.3f}")
        self._cards["remaining"].setText(f"{bal['remaining']:,.3f}")
        color = "#991B1B" if bal["remaining"] > 0.001 else "#166534"
        self._cards["remaining"].setStyleSheet(
            f"font-weight: 800; font-size: 16px; color: {color};")
        # V4.5.13: هل في عمولة أم لا — فروقات ما بين الدفع والمستحق
        try:
            _fh = getattr(self, "fees_hint", None)
            if _fh is not None:
                _over = round(-float(bal["remaining"]), 3)
                if _over > 0.001:
                    _fh.setText(f"⚠️ فروقات عمولة (مدفوع فوق المستحق): "
                                f"{_over:,.3f} د.ك")
                    _fh.setStyleSheet(
                        "font-weight: 800; color: #B45309;")
                    _fh.setVisible(True)
                else:
                    _fh.setText("✅ لا فروقات عمولة — المدفوع لا يتجاوز "
                                "المستحق الصافي.")
                    _fh.setStyleSheet("font-weight: 700; color: #166534;")
                    _fh.setVisible(True)
        except Exception:
            pass
        self._render()

    def _filtered(self) -> list[dict]:
        mode = self.kind.currentData()
        q = (self.search.text() or "").strip()
        out = []
        for x in self._ledger.get("lines", []):
            if mode != "all" and x["kind"] != mode:
                continue
            if q and q not in x["text"]:
                continue
            out.append(x)
        return out

    def _render(self):
        """موجّه العرض: مستحق/مسدد/تقرير/دفتر/تسوية حسب المبدّل."""
        m = self.mode.currentData()
        if m == "due":
            self._render_due_tab()
        elif m == "paid":
            self._render_paid_tab()
        elif m == "ops":
            self._render_ops()
        elif m == "daily":
            self._render_daily()
        else:
            self._render_ledger()

    def _ledger_controls(self, visible: bool):
        for w in (self._lbl_from, self.d1, self._lbl_to, self.d2,
                  self.kind):
            w.setVisible(visible)

    def _render_due_tab(self):
        self._ledger_controls(False)
        self.search.setVisible(False)
        self.detail_box.setVisible(False)
        self.table.setVisible(False)
        self.pay_btn.setVisible(True)
        self.dues_embed.setVisible(True)
        self.dues_embed.view.setVisible(False)
        if self.dues_embed.view.currentData() != "due":
            self.dues_embed.view.setCurrentData("due")
        self._sync_dues_pay()

    def _render_paid_tab(self):
        self._ledger_controls(False)
        self.search.setVisible(False)
        self.detail_box.setVisible(False)
        self.table.setVisible(False)
        self.pay_btn.setVisible(False)
        self.dues_embed.setVisible(True)
        self.dues_embed.view.setVisible(False)
        if self.dues_embed.view.currentData() != "paid":
            self.dues_embed.view.setCurrentData("paid")

    def _sync_dues_pay(self):
        """زر التسديد في تبويب المستحق: يتبع تحديد المضمّن."""
        if self.mode.currentData() != "due":
            return
        ops = self.dues_embed._checked_ops()
        total = round(sum(r["amount"] for r in ops), 3)
        if ops:
            self.pay_btn.setEnabled(True)
            self.pay_btn.setText(
                f"💸 تسديد المحدد ({_items(len(ops))} · "
                f"{total:,.3f} د.ك)")
            self.pay_btn.setToolTip("تسديد البنود المعلَّمة في المستحق")
        else:
            self.pay_btn.setEnabled(False)
            self.pay_btn.setText("💸 تسديد المحدد")
            self.pay_btn.setToolTip("علّم بنودًا في المستحق أولًا")

    def _render_ledger(self):
        self._ledger_controls(True)
        self.kind.setVisible(True)
        self.pay_btn.setVisible(True)
        self.detail_box.setVisible(False)
        self.search.setVisible(True)
        self.search.setPlaceholderText("🔍 بحث في البيان...")
        self.table.setVisible(True)
        self.dues_embed.setVisible(False)
        self.table.setColumnCount(len(HEADS))
        self.table.setHorizontalHeaderLabels(HEADS)
        self.table.blockSignals(True)
        rows, colors = [], {}
        prior = self._ledger.get("prior", 0.0)
        show_prior = abs(prior) > 0.0005 \
            and self.kind.currentData() == "all" \
            and not (self.search.text() or "").strip()
        if show_prior:
            rows.append(["", "", "رصيد أول الفترة", "",
                         "", "", f"{prior:,.3f}"])
        filt = self._filtered()
        for x in filt:
            rows.append([
                "", x["date"], x["text"],
                KIND_LABEL.get(x["kind"], x["kind"]),
                f"{x['plus']:,.3f}" if x["plus"] else "—",
                f"{x['minus']:,.3f}" if x["minus"] else "—",
                f"{x['balance']:,.3f}"])
            i = len(rows) - 1
            colors[(i, 3)] = KIND_COLORS.get(x["kind"], style.TEXT)
            if x["balance"] < -0.001:
                colors[(i, 6)] = "#B45309"
        _fill(self.table, rows, money_cols=(4, 5, 6))
        base = 1 if show_prior else 0
        for j, x in enumerate(filt):
            it = self.table.item(base + j, 0)
            if it is None:
                continue
            if x["kind"] == "due" and self._line_unpaid(x):
                it.setFlags(it.flags() | Qt.ItemIsUserCheckable)
                it.setCheckState(Qt.Unchecked)
            else:
                it.setFlags(it.flags() & ~Qt.ItemIsUserCheckable)
        self.table.blockSignals(False)
        apply_column_weights(self.table, [5, 12, 40, 9, 11, 11, 12])
        self._shown = filt
        self._update_checked_total()

    # ---------- التسوية اليومية (V4.37) ----------
    def _filtered_daily(self) -> list[dict]:
        """أيام التسوية بعد بحث (يوم/اسم/هاتف/مرجع)."""
        q = (self.search.text() or "").strip()
        days = (self._daily or {}).get("days") or []
        if not q:
            return list(days)
        out = []
        for d in days:
            if q in (d["day"] or ""):
                out.append(d)
                continue
            if any(q in (o["customer"] or "")
                   or q in (o["phone"] or "")
                   or q in (o["ref"] or "") for o in d["ops"]):
                out.append(d)
        return out

    def _render_daily(self):
        """المستوى 1: أيام التسوية + الإجمالي."""
        self._ledger_controls(True)
        self.kind.setVisible(False)
        self.pay_btn.setVisible(False)
        self.search.setVisible(True)
        self.search.setPlaceholderText(
            "🔍 بحث بيوم / اسم / هاتف / مرجع...")
        self.table.setVisible(True)
        self.dues_embed.setVisible(False)
        self.table.setColumnCount(len(DAY_HEADS))
        self.table.setHorizontalHeaderLabels(DAY_HEADS)
        self.table.blockSignals(True)
        filt = self._filtered_daily()
        rows, colors = [], {}
        for d in filt:
            rows.append([
                d["day"] or "—", d["n"],
                f"{d['gross']:,.3f}", f"{d['fees']:,.3f}",
                f"{d['net']:,.3f}", f"{d['paid']:,.3f}",
                f"{d['remaining']:,.3f}",
                REP_STATUS.get(d["status"], "—")])
            i = len(rows) - 1
            colors[(i, 7)] = REP_COLORS.get(d["status"], "#64748B")
            colors[(i, 6)] = "#991B1B" if d["remaining"] > 0.0005 \
                else "#166534"
        if (self.search.text() or "").strip():
            _tlabel = "⚖️ إجمالي الظاهر"
            _tt = {k: round(sum(d[k] for d in filt), 3)
                   for k in ("gross", "fees", "net", "paid")}
            _tt["remaining"] = round(_tt["net"] - _tt["paid"], 3)
        else:
            _tlabel = "⚖️ الإجمالي"
            t = (self._daily or {}).get("totals") or {}
            _tt = {"gross": t.get("gross", 0), "fees": t.get("fees", 0),
                   "net": t.get("net", 0), "paid": t.get("paid", 0),
                   "remaining": t.get("remaining", 0)}
        rows.append(["—", _tlabel,
                     f"{_tt['gross']:,.3f}", f"{_tt['fees']:,.3f}",
                     f"{_tt['net']:,.3f}", f"{_tt['paid']:,.3f}",
                     f"{_tt['remaining']:,.3f}", ""])
        colors[(len(rows) - 1, 6)] = "#991B1B" \
            if _tt["remaining"] > 0.0005 else "#166534"
        _fill(self.table, rows, colors=colors,
              money_cols=(1, 2, 3, 4, 5, 6))
        _bold = QFont()
        _bold.setBold(True)
        for c in range(len(DAY_HEADS)):
            it = self.table.item(len(rows) - 1, c)
            if it is None:
                continue
            it.setFont(_bold)
            it.setBackground(QColor("#EEF2FF"))
        self.table.blockSignals(False)
        apply_column_weights(self.table,
                             [14, 10, 12, 12, 12, 12, 12, 6])
        self._shown = filt
        self._render_daily_detail()

    def _on_daily_click(self, row: int):
        """ضغطة على يوم ← عملياته أسفل الشاشة."""
        filt = self._filtered_daily()
        if not (0 <= row < len(filt)):
            return
        self._sel_day = filt[row]["day"]
        self._render_daily_detail()

    def _render_daily_detail(self):
        """المستوى 2: عمليات اليوم بالأسماء."""
        if self.mode.currentData() != "daily" or not self._sel_day:
            if self.mode.currentData() == "daily":
                self.detail_box.setVisible(False)
            return
        d = next((x for x in (self._daily or {}).get("days") or []
                  if x["day"] == self._sel_day), None)
        ops = (d or {}).get("ops") or []
        if not ops:
            self.detail_box.setVisible(False)
            return
        self.detail_info.setText(
            f"📅 {self._sel_day} — {len(ops)} عملية · "
            f"الكامل: {d['gross']:,.3f} · "
            f"العمولة: {d['fees']:,.3f} · "
            f"الصافي: {d['net']:,.3f} · "
            f"المدفوع: {d['paid']:,.3f} · "
            f"المتبقي: {d['remaining']:,.3f} د.ك")
        self.ops_table.setColumnCount(len(DAY_OP_HEADS))
        self.ops_table.setHorizontalHeaderLabels(DAY_OP_HEADS)
        rows, colors = [], {}
        for o in ops:
            rows.append([
                o["customer"] or "—", o["phone"] or "—",
                o["ref"] or "—", o["gateway"],
                f"{o['gross']:,.3f}", f"{o['net']:,.3f}",
                f"{o['paid']:,.3f}", f"{o['remaining']:,.3f}",
                OP_STATUS.get(o["pay_status"], "—")])
            i = len(rows) - 1
            colors[(i, 8)] = OP_COLORS.get(o["pay_status"], "#64748B")
            colors[(i, 7)] = "#991B1B" if o["remaining"] > 0.0005 \
                else "#166534"
        _fill(self.ops_table, rows, colors=colors,
              money_cols=(4, 5, 6, 7))
        apply_column_weights(self.ops_table,
                             [20, 12, 12, 10, 10, 10, 10, 10, 6])
        self._detail_ops = []
        self.detail_box.setVisible(True)

    def _daily_workbook_data(self) -> list[dict]:
        """مصنف التسوية اليومية: الأيام + ورقة كل يوم + التحويلات."""
        filt = self._filtered_daily()
        rows = [[d["day"] or "—", d["n"], d["gross"], d["fees"],
                 d["net"], d["paid"], d["remaining"],
                 REP_STATUS.get(d["status"], "")]
                for d in filt]
        _tt = {k: round(sum(d[k] for d in filt), 3)
               for k in ("gross", "fees", "net", "paid")}
        _tt["remaining"] = round(_tt["net"] - _tt["paid"], 3)
        _tt["n"] = sum(d["n"] for d in filt)
        d1, d2 = self._dates()
        rows.append(["—", f"الإجمالي ({d1} ← {d2})", _tt["gross"],
                     _tt["fees"], _tt["net"], _tt["paid"],
                     _tt["remaining"], ""])
        sheets = [{"name": "التسوية اليومية", "heads": DAY_HEADS,
                   "rows": rows, "number_cols": [1, 2, 3, 4, 5, 6],
                   "bold_rows": {len(rows) - 1}}]
        _used = {"التسوية اليومية", "التحويلات"}
        for d in filt:
            _orows = [[o["customer"] or "—", o["phone"] or "—",
                       o["ref"] or "—", o["gateway"], o["gross"],
                       o["net"], o["paid"], o["remaining"],
                       OP_STATUS.get(o["pay_status"], "—")]
                      for o in d["ops"]]
            _orows.append(["", f"الإجمالي ({d['n']} عملية)", "", "",
                           d["gross"], d["net"], d["paid"],
                           d["remaining"], ""])
            sheets.append({
                "name": _sheet_name("يوم " + (d["day"] or "—"), _used),
                "heads": DAY_OP_HEADS, "rows": _orows,
                "subtitle": f"تسوية يوم {d['day'] or '—'} — الشركة الأخرى",
                "number_cols": [4, 5, 6, 7],
                "bold_rows": {len(_orows) - 1},
                "widths": {0: 26}})
        _trs = (self._daily or {}).get("transfers") or []
        _trows = [[t["tdate"] or "—", t["id"], t["amount"],
                   t["ref"] or "—", t["method"] or "—",
                   t["notes"] or "—"]
                  for t in _trs]
        _trows.append(["", "الإجمالي",
                       (self._daily or {}).get("transfers_total", 0),
                       "", "", ""])
        sheets.append({"name": "التحويلات",
                       "heads": ["التاريخ", "التحويل", "المبلغ",
                                 "المرجع", "الطريقة", "ملاحظات"],
                       "rows": _trows, "number_cols": [1, 2],
                       "bold_rows": {len(_trows) - 1}})
        return sheets

    def _export_daily_workbook(self):
        """تصدير مصنف التسوية اليومية للفترة الظاهرة."""
        from PySide6.QtWidgets import QFileDialog
        sheets = self._daily_workbook_data()
        d1, d2 = self._dates()
        import os
        default = os.path.join(os.path.expanduser("~"),
                               f"daily_settlement_{d1}_{d2}.xlsx")
        path, _ = QFileDialog.getSaveFileName(
            self, "تصدير التسوية اليومية", default, "Excel (*.xlsx)")
        if not path:
            return
        try:
            from reports.tabular_pdf import generate_report_workbook
            generate_report_workbook(f"التسوية اليومية ({d1} ← {d2})",
                                     sheets, path)
            style.info(self, "تم التصدير:" + chr(10) + path, "تم")
        except Exception:
            style.error(self, "تعذر تصدير الملف.")
    def _switch_mode(self):
        self._render()

    def _filtered_ops(self) -> list[dict]:
        """عمليات التقرير بعد فلتر الحالة والبحث."""
        f = self.kind.currentData()
        q = (self.search.text() or "").strip()
        out = []
        for o in self._ops:
            if f == "due" and o["status"] not in ("due", "partial"):
                continue
            if f == "pay" and o["status"] != "paid":
                continue
            if q and q not in " ".join(str(o.get(k) or "") for k in
                                       ("customer", "phone", "ref",
                                        "date", "gateway", "tdate")):
                continue
            out.append(o)
        return out

    def _render_ops(self):
        """تقرير العمليات: كل عملية بحالتها + الإجمالي."""
        self._ledger_controls(True)
        self.kind.setVisible(True)
        self.pay_btn.setVisible(True)
        self.pay_btn.setEnabled(True)
        self.pay_btn.setText("💸 دفعة على الحساب")
        self.pay_btn.setToolTip("تسديد غير مربوط ببنود (دفعة على الحساب)")
        self.search.setVisible(True)
        self.search.setPlaceholderText("🔍 بحث في العمليات...")
        self.table.setVisible(True)
        self.dues_embed.setVisible(False)
        self.table.setColumnCount(len(OPS_REP_HEADS))
        self.table.setHorizontalHeaderLabels(OPS_REP_HEADS)
        self.table.blockSignals(True)
        filt = self._filtered_ops()
        rows, colors = [], {}
        for o in filt:
            _ed = o.get("effective_date") or ""
            _ed_label = f"→ {_ed}" if _ed else "—"
            rows.append([
                o["date"] or "—", o["customer"] or "—",
                o["phone"] or "—", o["gateway"],
                f"{o['net']:,.3f}", f"{o['paid']:,.3f}",
                f"{o['remaining']:,.3f}",
                OP_STATUS.get(o["status"], "—"), _ed_label])
            i = len(rows) - 1
            colors[(i, 7)] = OP_COLORS.get(o["status"], "#64748B")
            colors[(i, 6)] = "#991B1B" if o["remaining"] > 0.0005 \
                else "#166534"
        _op = round(float(self._opening.get("amount") or 0), 3)
        if abs(_op) > 0.0005:
            rows.append(["—", "📌 الرصيد الافتتاحي", "", "", "",
                         "", "", "", ""])
        _un = round(float(self._unalloc or 0), 3)
        if abs(_un) > 0.0005:
            rows.append(["—", "💸 دفعات على الحساب (غير مربوطة)", "", "",
                         "", "", "", "", ""])
        _tn = round(sum(o["net"] for o in filt), 3)
        _tp = round(sum(o["paid"] for o in filt), 3)
        _tr = round(sum(o["remaining"] for o in filt), 3)
        _tlabel = "⚖️ الإجمالي" if not (self.search.text() or "").strip() \
            else "⚖️ إجمالي الظاهر"
        rows.append(["—", _tlabel, "", "",
                     f"{_tn:,.3f}", f"{_tp:,.3f}", f"{_tr:,.3f}", "", ""])
        colors[(len(rows) - 1, 6)] = "#991B1B" if _tr > 0.0005 \
            else "#166534"
        _fill(self.table, rows, colors=colors, money_cols=(4, 5, 6))
        _bold = QFont()
        _bold.setBold(True)
        for r in range(len(filt), len(rows)):
            _bg = QColor("#EEF2FF") if r == len(rows) - 1 \
                else QColor("#F8FAFC")
            for c in range(len(OPS_REP_HEADS)):
                it = self.table.item(r, c)
                if it is None:
                    continue
                it.setFont(_bold)
                it.setBackground(_bg)
        self.table.blockSignals(False)
        apply_column_weights(self.table,
                             [11, 23, 13, 11, 11, 11, 11, 9, 12])
        self._shown = filt
        self._shown_ops = filt
        self.detail_box.setVisible(False)

    def _on_table_click(self, row: int, col: int):
        """ضغطة على صف ← تفاصيله (يوم/عملية) حسب التبويب."""
        if self.mode.currentData() == "daily":
            self._on_daily_click(row)

    def _close_detail(self):
        self._sel_day = None
        self.detail_box.setVisible(False)

    def _open_transfer(self):
        """تسديد ذكي: المستحق ← المحدد · الدفتر ← مربوط/حر · التقرير ← حر."""
        if self.mode.currentData() == "due":
            self._pay_dues_embedded()
            return
        ops = self._checked_ops() \
            if self.mode.currentData() == "ledger" else []
        ids = [int(r["id"]) for r in ops if r.get("id")]
        total = round(sum(r["amount"] for r in ops), 3)
        if TransferDialog(self, amount_preset=total,
                          op_ids=ids).exec():
            self.refresh()

    def _pay_dues_embedded(self):
        self.dues_embed._pay_selected()
        self.refresh()

    def _line_unpaid(self, line: dict) -> list[dict]:
        """بنود السطر المستحق غير المسددة (يوم + بوابة)."""
        return [r for r in self._items
                if r["gateway"] == (line.get("gateway") or "")
                and r["date"] == (line.get("day") or "")]

    def _checked_lines(self) -> list[dict]:
        shown = getattr(self, "_shown", []) or []
        if not shown:
            return []
        off = 1 if (self.table.rowCount() - len(shown)) == 1 else 0
        out = []
        for j in range(len(shown)):
            it = self.table.item(j + off, 0)
            if it is not None and it.checkState() == Qt.Checked:
                out.append(shown[j])
        return out

    def _checked_ops(self) -> list[dict]:
        ops = []
        for ln in self._checked_lines():
            ops.extend(self._line_unpaid(ln))
        return ops

    def _update_checked_total(self):
        """الزر الذكي يعكس التحديد: مربوط بعدّاد أو دفعة حرة."""
        ops = self._checked_ops()
        total = round(sum(r["amount"] for r in ops), 3)
        self.pay_btn.setEnabled(True)
        if ops:
            self.pay_btn.setText(
                f"💸 تسديد المحدد ({_items(len(ops))} · "
                f"{total:,.3f} د.ك)")
            self.pay_btn.setToolTip(
                "تسديد البنود المعلَّمة — كامل المتبقي أو جزء منه")
        else:
            self.pay_btn.setText("💸 دفعة على الحساب")
            self.pay_btn.setToolTip(
                "تسديد غير مربوط ببنود (دفعة على الحساب)")

    def _open_opening(self):
        if OpeningDialog(self).exec():
            self.refresh()

    def _open_row(self, row: int, col: int):
        if self.mode.currentData() == "ops":
            ops = getattr(self, "_shown_ops", []) or []
            if not (0 <= row < len(ops)):
                return
            try:
                pays = st.op_transfer_allocs(ops[row]["id"])
            except Exception:
                pays = []
            if not pays:
                style.info(self, "لا توجد تسديدات مربوطة بهذه العملية.")
            elif len(pays) == 1:
                if TransferDetailDialog(self, pays[0]["transfer_id"]).exec():
                    self.refresh()
            elif OpPaymentsDialog(
                    self, dict(ops[row], amount=ops[row]["gross"],
                               payments=pays)).exec():
                self.refresh()
        else:
            self._open_line(row, col)

    def _open_line(self, row: int, _col: int):
        rows = getattr(self, "_shown", [])
        has_prior = (self.table.rowCount() - len(rows)) == 1
        idx = row - 1 if has_prior else row
        if not (0 <= idx < len(rows)):
            return
        x = rows[idx]
        if x["kind"] == "pay" and x.get("tid"):
            if TransferDetailDialog(self, x["tid"]).exec():
                self.refresh()
        elif x["kind"] == "due" and x.get("gateway") and x.get("day"):
            try:
                day_rows = [r for r in st.daily_clearing(
                    x["day"], x["day"], x["gateway"]) if r["day"] == x["day"]]
            except Exception:
                day_rows = []
            if day_rows:
                DayDetailDialog(self, x["gateway"], x["day"],
                                day_rows[0]).exec()

    def _ledger_sheet_data(self) -> dict:
        """بيانات الكشف المالي — تُستخدم للتصدير والطباعة."""
        lg = self._ledger
        data = [["", "رصيد أول الفترة", "",
                 "", "", lg.get("prior", 0)]]
        for x in self._filtered():
            data.append([x["date"], x["text"],
                         KIND_LABEL.get(x["kind"], x["kind"]),
                         x["plus"] or "", x["minus"] or "", x["balance"]])
        data.append(["", "الإجمالي", "",
                     lg.get("total_plus", 0), lg.get("total_minus", 0),
                     lg.get("end", 0)])
        return {"name": "كشف حساب الشركة الأخرى", "heads": HEADS,
                "rows": data, "number_cols": [3, 4, 5]}

    def _export(self):
        sh = self._ledger_sheet_data()
        export_table_excel(self, sh["name"], sh["heads"], sh["rows"],
                           "other_company_ledger",
                           number_cols=sh["number_cols"])

    def _open_export(self):
        """تصدير موحد حسب التبويب."""
        if self.mode.currentData() == "due":
            self._export_dues()
            return
        if self.mode.currentData() == "paid":
            self._export_paid()
            return
        if self.mode.currentData() == "ops":
            d1, d2 = self._dates()
            dlg = ExportDialog(self, d1, d2, report_mode=True)
            if not dlg.exec():
                return
            kind, e1, e2 = dlg.choice()
            if kind == "recon":
                self._export_reconciliation(e1, e2)
            else:
                self._export_ops_workbook()
            return
        if self.mode.currentData() == "daily":
            self._export_daily_workbook()
            return
        d1, d2 = self._dates()
        dlg = ExportDialog(self, d1, d2)
        if not dlg.exec():
            return
        kind, e1, e2 = dlg.choice()
        if kind == "recon":
            self._export_reconciliation(e1, e2)
        else:
            self._export()

    def _ops_workbook_data(self) -> list[dict]:
        """بيانات مصنف تقرير العمليات — يتبع الفلتر الحالي."""
        filt = self._filtered_ops()
        rows = [[o["date"] or "—", o["customer"] or "—",
                 o["phone"] or "—", o["gateway"], o["net"], o["paid"],
                 o["remaining"], OP_STATUS.get(o["status"], ""),
                 o.get("effective_date") or "—"]
                for o in filt]
        _bold = set()
        _op = round(float(self._opening.get("amount") or 0), 3)
        if abs(_op) > 0.0005:
            rows.append(["", "الرصيد الافتتاحي", "", "", "", "", "",
                         "", ""])
            _bold.add(len(rows) - 1)
        _un = round(float(self._unalloc or 0), 3)
        if abs(_un) > 0.0005:
            rows.append(["", "دفعات على الحساب (غير مربوطة)", "", "", "",
                         "", "", "", ""])
            _bold.add(len(rows) - 1)
        _tn = round(sum(o["net"] for o in filt), 3)
        _tp = round(sum(o["paid"] for o in filt), 3)
        _tr = round(sum(o["remaining"] for o in filt), 3)
        rows.append(["", "الإجمالي", "", "", _tn, _tp, _tr, "", ""])
        _bold.add(len(rows) - 1)
        return [{"name": "العمليات", "heads": OPS_REP_HEADS,
                 "rows": rows, "number_cols": [4, 5, 6],
                 "bold_rows": _bold, "widths": {1: 28}}]

    def _export_ops_workbook(self):
        """تصدير مصنف تقرير العمليات."""
        import os
        from PySide6.QtWidgets import QFileDialog
        from ui.invoices import open_file_externally
        sheets = self._ops_workbook_data()
        default = os.path.join(os.path.expanduser("~"),
                               "other_ops_report.xlsx")
        path, _ = QFileDialog.getSaveFileName(
            self, "تصدير تقرير العمليات", default, "Excel (*.xlsx)")
        if not path:
            return
        try:
            from reports.tabular_pdf import generate_report_workbook
            generate_report_workbook("تقرير عمليات الشركة الأخرى",
                                     sheets, path)
            style.info(self, "تم التصدير:" + chr(10) + path, "تم")
        except Exception:
            style.error(self, "تعذر تصدير الملف.")
            return
        try:
            open_file_externally(path)
        except Exception:
            pass

    def _dues_sheet_data(self) -> dict:
        """بيانات المستحق للطباعة — أعمدة الشاشة والقيم المحسوبة."""
        rows = []
        for r in self.dues_embed._filtered():
            _net = round(float(r.get("total") or 0), 3)
            _paid = round(float(r.get("paid") or 0), 3)
            _gross = round(float(r.get("gross", r.get("total")) or 0), 3)
            rows.append([r["date"], r["gateway"], r["customer"] or "—",
                         r["phone"], _net, round(r["amount"], 3),
                         _paid if _paid else "", _collection_cell(r),
                         _gross])
        return {"name": "المستحق للدفع — الشركة الأخرى",
                "heads": DUES_HEADS[1:], "rows": rows,
                "number_cols": [4, 5, 6, 8]}

    def _paid_sheet_data(self) -> dict:
        """بيانات المسدد للطباعة — أعمدة الشاشة."""
        rows = [[r["date"], r["customer"] or "—", r["phone"],
                 r["gateway"], round(r["net"], 3), round(r["paid"], 3),
                 f"ت{r['transfer_id']}" if r["transfer_id"] else "—",
                 r["tdate"] or "—"]
                for r in self.dues_embed._filtered_paid()]
        return {"name": "المسدد — الشركة الأخرى",
                "heads": DUES_PAID_HEADS, "rows": rows,
                "number_cols": [4, 5]}

    def _print_current(self):
        """🖨 طباعة التبويب الحالي PDF — نفس محتوى الشاشة."""
        import os
        from PySide6.QtWidgets import QFileDialog
        from ui.invoices import open_file_externally
        _mode = self.mode.currentData()
        if _mode == "due":
            sh, stem = self._dues_sheet_data(), "other_dues"
        elif _mode == "paid":
            sh, stem = self._paid_sheet_data(), "other_paid"
        elif _mode == "ops":
            sh, stem = self._ops_workbook_data()[0], "other_ops_report"
            sh = dict(sh, name="تقرير عمليات الشركة الأخرى")
        elif _mode == "daily":
            sh, stem = self._daily_workbook_data()[0], "other_daily"
            sh = dict(sh, name="التسوية اليومية — الشركة الأخرى")
        else:
            sh, stem = self._ledger_sheet_data(), "other_company_ledger"
        if not sh["rows"]:
            style.info(self, "لا توجد بيانات للطباعة.")
            return
        default = os.path.join(os.path.expanduser("~"), f"{stem}.pdf")
        path, _ = QFileDialog.getSaveFileName(
            self, "طباعة PDF", default, "PDF (*.pdf)")
        if not path:
            return
        try:
            from reports.tabular_pdf import generate_table_pdf
            _n = len(sh["heads"])
            generate_table_pdf(sh["name"], sh["heads"], [100.0 / _n] * _n,
                               sh["rows"], path,
                               number_cols=sh.get("number_cols") or [])
            style.info(self, "تمت الطباعة:" + chr(10) + path, "تم")
        except Exception:
            style.error(self, "تعذر إنشاء ملف الطباعة.")
            return
        try:
            open_file_externally(path)
        except Exception:
            pass

    def _export_dues(self):
        rows = self.dues_embed._filtered()
        if not rows:
            style.info(self, "لا توجد بنود مستحقة للتصدير.")
            return
        data = [[r["date"], r["gateway"], r["customer"] or "—",
                 r["phone"], round(r["amount"], 3),
                 round(r.get("paid") or 0, 3),
                 _collection_cell(r),
                 r["ref"] or ""]
                for r in rows]
        export_table_excel(
            self, "المستحق للدفع — الشركة الأخرى",
            ["التاريخ", "البوابة", "العميل", "الهاتف", "المتبقي",
             "المدفوع", "التحصيل", "المرجع"], data, "other_dues",
            number_cols=[4, 5])

    def _export_paid(self):
        rows = self.dues_embed._filtered_paid()
        if not rows:
            style.info(self, "لا توجد بنود مسددة للتصدير.")
            return
        data = [[r["date"], r["customer"] or "—", r["phone"],
                 r["gateway"], round(r["net"], 3),
                 round(r["paid"], 3),
                 f"ت{r['transfer_id']}" if r["transfer_id"] else "",
                 r["tdate"] or "", r["ref"] or ""]
                for r in rows]
        export_table_excel(
            self, "المسدد — الشركة الأخرى",
            ["التاريخ", "العميل", "الهاتف", "البوابة", "الصافي",
             "المدفوع", "التسديد", "تاريخ التسديد", "المرجع"], data,
            "other_paid", number_cols=[4, 5])

    def _export_reconciliation(self, d1: str, d2: str):
        """تقرير المطابقة الخارجي — مبسط للشركة الأخرى (قراءة فقط)."""
        rep = st.other_external_report(d1, d2)
        if not rep["rows"]:
            style.info(self, "لا توجد عمليات «شركة أخرى» في هذه الفترة.")
            return
        heads = ["التاريخ", "الاسم", "المبلغ", "الحالة",
                 "تحصيل البوابة", "تاريخ التحصيل"]
        data = [[o["date"], o["customer"] or "—", o["amount"],
                 "سُدّد" if o["paid"] else "مستحق",
                 "محوَّل" if o.get("gw") == 1
                 else ("غير محوَّل" if o.get("gw") == 0 else "—"),
                 o.get("gw_date") or "—"]
                for o in rep["rows"]]
        data.append(["", "رسوم البوابة المخصومة", -rep["fees"], "", "", ""])
        data.append(["", f"الصافي المستحق ({len(rep['rows'])} عملية)",
                     rep["net"], "", "", ""])
        data.append(["", "المحوَّل من البوابة", rep["transferred"],
                     "", "", ""])
        data.append(["", "بانتظار التحصيل (خارج المستحق)", rep["pending"],
                     "", "", ""])
        data.append(["", "المسدد خلال الفترة", rep["paid"], "", "", ""])
        data.append(["", "المتبقي التراكمي", rep["remaining"], "", "", ""])
        export_table_excel(
            self, f"تقرير مطابقة الشركة الأخرى ({d1} ← {d2})", heads,
            data, f"reconciliation_{d1}_{d2}", number_cols=[2])
