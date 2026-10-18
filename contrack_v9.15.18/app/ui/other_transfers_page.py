# -*- coding: utf-8 -*-
"""V4.43: تسديدات الشركة الأخرى — مجمعات التواريخ.

المستوى 1: التسديدات (تاريخ الإرسال من حسابي + تغطيته) ·
الضغط على تسديد ← عملياته مجموعة بتاريخ العملية.
"""
from PySide6.QtCore import QDate, Qt
from PySide6.QtGui import QColor, QFont
from PySide6.QtWidgets import (QDateEdit, QFrame, QHBoxLayout, QLabel,
                               QLineEdit, QPushButton, QVBoxLayout, QWidget)

from services import settlement_service as st
from ui import style
from ui.archive import _fill, _table
from ui.widgets import (SegmentedTabs, apply_column_weights, export_table_excel,
                        size_buttons)

HEADS = ["التسديد", "تاريخ الإرسال", "الطريقة", "المبلغ", "المربوط",
         "الباقي", "العمليات", "تواريخ العمليات", "الحالة"]
GROUP_HEADS = ["تاريخ العمليات", "عدد العمليات", "الصافي", "المدفوع"]
STATUS_LABEL = {"full": "🟢 مربوط كامل", "partial": "🟡 مربوط جزئي",
                "open": "🔵 على الحساب"}
STATUS_COLOR = {"full": "#166534", "partial": "#B45309",
                "open": "#1D4ED8"}


class OtherTransfersPage(QWidget):
    """شاشة تسديدات الشركة الأخرى — من تواريخ مفردة لمجموعات."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setLayoutDirection(Qt.RightToLeft)
        self._data: list[dict] = []
        self._sel: int | None = None
        root = QVBoxLayout(self)
        root.setContentsMargins(12, 8, 12, 8)
        root.setSpacing(8)

        top = QHBoxLayout()
        title = QLabel("💸 تسديدات الشركة الأخرى")
        title.setProperty("pageTitle", True)
        top.addWidget(title)
        top.addStretch()
        self.totals = QLabel("")
        self.totals.setProperty("hint", True)
        top.addWidget(self.totals)
        self.export_btn = QPushButton("📤 تصدير")
        self.export_btn.setProperty("flat", True)
        self.export_btn.setToolTip("تصدير التسديدات الظاهرة Excel")
        self.export_btn.clicked.connect(self._export_excel)
        self.print_btn = QPushButton("🖨 طباعة")
        self.print_btn.setProperty("flat", True)
        self.print_btn.setToolTip("طباعة التسديدات الظاهرة PDF")
        self.print_btn.clicked.connect(self._print_pdf)
        size_buttons([self.export_btn, self.print_btn],
                     min_w=130, uniform=False)
        top.addWidget(self.export_btn)
        top.addWidget(self.print_btn)
        root.addLayout(top)

        bar = QHBoxLayout()
        self.status = SegmentedTabs()
        self.status.addItem("الكل", "all")
        self.status.addItem("🟢 مربوط كامل", "full")
        self.status.addItem("🟡 جزئي", "partial")
        self.status.addItem("🔵 على الحساب", "open")
        self.status.currentIndexChanged.connect(lambda _i: self._render())
        bar.addWidget(self.status)
        bar.addWidget(QLabel("من:"))
        self.d1 = QDateEdit(QDate.currentDate().addMonths(-1))
        self.d1.setCalendarPopup(True)
        self.d1.dateChanged.connect(lambda _d: self.refresh())
        bar.addWidget(self.d1)
        bar.addWidget(QLabel("إلى:"))
        self.d2 = QDateEdit(QDate.currentDate())
        self.d2.setCalendarPopup(True)
        self.d2.dateChanged.connect(lambda _d: self.refresh())
        bar.addWidget(self.d2)
        self.search = QLineEdit()
        self.search.setPlaceholderText("🔍 بحث بطريقة / مرجع / تاريخ...")
        self.search.setClearButtonEnabled(True)
        self.search.setMinimumWidth(220)
        self.search.textChanged.connect(lambda _t: self._render())
        bar.addWidget(self.search)
        bar.addStretch()
        root.addLayout(bar)

        self.table = _table(HEADS)
        self.table.cellClicked.connect(self._on_row_click)
        self.table.cellDoubleClicked.connect(self._open_row)
        root.addWidget(self.table, 1)

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
        close = QPushButton("✕")
        close.setProperty("flat", True)
        close.setFixedWidth(36)
        close.clicked.connect(self._close_detail)
        dbar.addWidget(close)
        droot.addLayout(dbar)
        self.groups_table = _table(GROUP_HEADS)
        droot.addWidget(self.groups_table, 1)
        self.detail_box.setVisible(False)
        root.addWidget(self.detail_box, 1)
        self.refresh()

    # ---------- تحميل وعرض ----------
    def refresh(self):
        d1 = self.d1.date().toString("yyyy-MM-dd")
        d2 = self.d2.date().toString("yyyy-MM-dd")
        try:
            self._data = st.list_transfers_summary(d1, d2)
        except Exception:
            self._data = []
        if self._sel not in [t["id"] for t in self._data]:
            self._sel = None
        self._render()

    def _filtered(self) -> list[dict]:
        f = self.status.currentData()
        q = (self.search.text() or "").strip()
        out = []
        for t in self._data:
            if f != "all" and t["status"] != f:
                continue
            if q and q not in " ".join(
                    str(t.get(k) or "") for k in
                    ("method", "ref", "notes", "tdate", "dates_short",
                     "dates")) + f" ت{t['id']}":
                continue
            out.append(t)
        return out

    def _render(self):
        self.table.blockSignals(True)
        self.table.setColumnCount(len(HEADS))
        self.table.setHorizontalHeaderLabels(HEADS)
        filt = self._filtered()
        rows, colors = [], {}
        for t in filt:
            rows.append([
                f"ت{t['id']}", t["tdate"] or "—", t["method"] or "—",
                f"{t['amount']:,.3f}", f"{t['alloc']:,.3f}",
                f"{t['unalloc']:,.3f}",
                str(t["n_ops"]) if t["n_ops"] else "—",
                t["dates_short"] or "—",
                STATUS_LABEL.get(t["status"], "—")])
            i = len(rows) - 1
            colors[(i, 8)] = STATUS_COLOR.get(t["status"], "#64748B")
            colors[(i, 5)] = "#991B1B" if t["unalloc"] > 0.0005 \
                else "#166534"
        _ta = round(sum(t["amount"] for t in filt), 3)
        _tb = round(sum(t["alloc"] for t in filt), 3)
        _tc = round(sum(t["unalloc"] for t in filt), 3)
        _tlabel = "⚖️ الإجمالي" if not (self.search.text() or "").strip() \
            else "⚖️ إجمالي الظاهر"
        rows.append(["—", _tlabel, "", f"{_ta:,.3f}", f"{_tb:,.3f}",
                     f"{_tc:,.3f}", "", "", ""])
        colors[(len(rows) - 1, 5)] = "#991B1B" if _tc > 0.0005 \
            else "#166534"
        _fill(self.table, rows, colors=colors, money_cols=(3, 4, 5))
        _bold = QFont()
        _bold.setBold(True)
        for c in range(len(HEADS)):
            it = self.table.item(len(rows) - 1, c)
            if it is not None:
                it.setFont(_bold)
                it.setBackground(QColor("#EEF2FF"))
        self.table.blockSignals(False)
        apply_column_weights(self.table,
                             [8, 12, 12, 11, 11, 11, 8, 17, 10])
        self._shown = filt
        self.totals.setText(
            f"{len(filt)} تسديد · المبلغ {_ta:,.3f} · "
            f"المربوط {_tb:,.3f} · الباقي {_tc:,.3f} د.ك")
        self._render_detail()

    # ---------- التفصيل ----------
    def _on_row_click(self, row: int, _col: int):
        shown = getattr(self, "_shown", []) or []
        if not (0 <= row < len(shown)):
            return
        self._sel = shown[row]["id"]
        self._render_detail()

    def _close_detail(self):
        self._sel = None
        self.detail_box.setVisible(False)

    def _render_detail(self):
        if not self._sel:
            self.detail_box.setVisible(False)
            return
        try:
            cov = st.transfer_coverage(self._sel)
        except Exception:
            self.detail_box.setVisible(False)
            return
        t, groups, tt = cov["transfer"], cov["groups"], cov["totals"]
        if not t:
            self.detail_box.setVisible(False)
            return
        self.detail_info.setText(
            f"ت{t['id']} · {t['tdate'] or '—'} · {t['method'] or '—'} — "
            f"المبلغ: {tt['amount']:,.3f} · "
            f"المربوط: {tt['alloc']:,.3f} · "
            f"الباقي: {tt['unalloc']:,.3f} د.ك")
        rows = [[g["date"] or "—", str(g["n"]),
                 f"{g['net']:,.3f}", f"{g['paid']:,.3f}"]
                for g in groups]
        if groups:
            rows.append(["⚖️ الإجمالي", str(tt["n_ops"]),
                         f"{round(sum(g['net'] for g in groups), 3):,.3f}",
                         f"{tt['alloc']:,.3f}"])
        _fill(self.groups_table, rows, money_cols=(2, 3))
        if groups:
            _bold = QFont()
            _bold.setBold(True)
            for c in range(len(GROUP_HEADS)):
                it = self.groups_table.item(len(rows) - 1, c)
                if it is not None:
                    it.setFont(_bold)
                    it.setBackground(QColor("#EEF2FF"))
        apply_column_weights(self.groups_table, [30, 20, 25, 25])
        self.detail_box.setVisible(True)

    def _open_row(self, row: int, _col: int):
        shown = getattr(self, "_shown", []) or []
        if not (0 <= row < len(shown)):
            return
        from ui.other_company_page import TransferDetailDialog
        if TransferDetailDialog(self, shown[row]["id"]).exec():
            self.refresh()

    # ---------- تصدير وطباعة ----------
    def _sheet_data(self) -> dict:
        filt = self._filtered()
        rows = [[f"ت{t['id']}", t["tdate"] or "—", t["method"] or "—",
                 t["amount"], t["alloc"], t["unalloc"],
                 t["n_ops"] or "", t["dates_short"] or "",
                 STATUS_LABEL.get(t["status"], "")]
                for t in filt]
        rows.append(["", "الإجمالي", "",
                     round(sum(t["amount"] for t in filt), 3),
                     round(sum(t["alloc"] for t in filt), 3),
                     round(sum(t["unalloc"] for t in filt), 3), "", "", ""])
        return {"name": "تسديدات الشركة الأخرى", "heads": HEADS,
                "rows": rows, "number_cols": [3, 4, 5]}

    def _export_excel(self):
        sh = self._sheet_data()
        if not self._filtered():
            style.info(self, "لا توجد تسديدات للتصدير.")
            return
        export_table_excel(self, sh["name"], sh["heads"], sh["rows"],
                           "other_transfers",
                           number_cols=sh["number_cols"])

    def _print_pdf(self):
        import os
        from PySide6.QtWidgets import QFileDialog
        from ui.invoices import open_file_externally
        sh = self._sheet_data()
        if not self._filtered():
            style.info(self, "لا توجد بيانات للطباعة.")
            return
        default = os.path.join(os.path.expanduser("~"),
                               "other_transfers.pdf")
        path, _ = QFileDialog.getSaveFileName(
            self, "طباعة PDF", default, "PDF (*.pdf)")
        if not path:
            return
        try:
            from reports.tabular_pdf import generate_table_pdf
            _n = len(sh["heads"])
            generate_table_pdf(sh["name"], sh["heads"], [100.0 / _n] * _n,
                               sh["rows"], path,
                               number_cols=sh["number_cols"])
            style.info(self, "تمت الطباعة:" + chr(10) + path, "تم")
        except Exception:
            style.error(self, "تعذر إنشاء ملف الطباعة.")
            return
        try:
            open_file_externally(path)
        except Exception:
            pass
