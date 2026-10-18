# -*- coding: utf-8 -*-
"""شاشة «تصفيات العهد» (V3.7): كل التصفيات + لوحة عرض داخلية.

- الجدول العلوي: كل تصفيات الفترة (المرجع/التاريخ/العهدة/البنود/
  الإجمالي/البيان) مع فلاتر حساب/فترة/بحث.
- اللوحة السفلية: الضغط على تصفية يعرض العهدة المختارة (اسم العهدة
  + البيان + البنود + الموازنة) مع أزرار تعديل/طباعة/Excel.
- بلا طي/توسيع: العرض الداخلي هو البديل المعتمد.
"""
from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QAbstractItemView, QCheckBox, QComboBox, QHBoxLayout, QHeaderView,
    QLabel, QLineEdit, QMenu, QPushButton, QSplitter, QStackedWidget,
    QTableWidget, QTableWidgetItem, QVBoxLayout, QWidget,
)

from services import lifecycle_service as lc
from ui import style


class CustodySettlementsPage(QWidget):
    """قائمة تصفيات العهد مع لوحة العرض الداخلية."""

    data_changed = Signal()

    HEADS = ["المرجع", "التاريخ", "العهدة", "البنود", "الإجمالي",
             "البيان"]
    LINE_HEADS = ["رقم السند", "التاريخ", "حساب المصروف",
                  "الجهة/المورد", "العقد", "البيان", "المبلغ"]

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setLayoutDirection(Qt.RightToLeft)
        self._rows: list = []
        self._line_ids: list = []
        self._current_ref = ""

        lay = QVBoxLayout(self)
        lay.setContentsMargins(18, 14, 18, 14)
        lay.setSpacing(10)

        title = QLabel("تصفيات العهد")
        title.setProperty("pageTitle", True)
        lay.addWidget(title)
        desc = QLabel("كل تصفيات العهد — حدد تصفية لعرض بنودها بالأسفل · "
                      "الزر الأيمن لبقية الإجراءات")
        desc.setProperty("pageDesc", True)
        lay.addWidget(desc)

        filt = QHBoxLayout()
        self.account = QComboBox()
        self.account.setMinimumWidth(240)
        from ui.widgets import make_searchable
        make_searchable(self.account, "")
        self.account.currentIndexChanged.connect(self.reload)
        self.search = QLineEdit()
        self.search.setPlaceholderText("بحث بالمرجع أو العهدة أو البيان…")
        try:
            from ui.widgets import connect_debounced_text
            connect_debounced_text(self.search, self.reload, delay_ms=350)
        except Exception:
            self.search.textChanged.connect(lambda *_: self.reload())
        from PySide6.QtCore import QDate
        try:
            from ui.widgets import SafeDateEdit as _DE
        except Exception:
            from PySide6.QtWidgets import QDateEdit as _DE
        self.use_period = QCheckBox("فترة")
        self.use_period.toggled.connect(lambda *_: self.reload())
        self.date_from = _DE()
        self.date_from.setCalendarPopup(True)
        self.date_from.setDisplayFormat("yyyy-MM-dd")
        self.date_from.setDate(QDate.currentDate().addMonths(-12))
        self.date_to = _DE()
        self.date_to.setCalendarPopup(True)
        self.date_to.setDisplayFormat("yyyy-MM-dd")
        self.date_to.setDate(QDate.currentDate())
        self.date_from.dateChanged.connect(lambda *_: self.reload())
        self.date_to.dateChanged.connect(lambda *_: self.reload())
        refresh = QPushButton("🔄 تحديث")
        refresh.setProperty("flat", True)
        refresh.clicked.connect(self._refresh_all)
        reports = QPushButton("📊 التقارير")
        reports.setProperty("flat", True)
        reports.setToolTip("تقارير العهد الأربعة: المجمع والأرصدة والكشف والمعلقة")
        reports.clicked.connect(self._open_reports)
        filt.addWidget(QLabel("الحساب"))
        filt.addWidget(self.account, 1)
        filt.addWidget(QLabel("بحث"))
        filt.addWidget(self.search, 2)
        filt.addWidget(self.use_period)
        filt.addWidget(QLabel("من"))
        filt.addWidget(self.date_from)
        filt.addWidget(QLabel("إلى"))
        filt.addWidget(self.date_to)
        filt.addWidget(reports)
        filt.addWidget(refresh)
        lay.addLayout(filt)

        self.total_lbl = QLabel("")
        self.total_lbl.setStyleSheet("font-weight:800;")
        lay.addWidget(self.total_lbl)

        split = QSplitter(Qt.Vertical)
        self.table = QTableWidget(0, len(self.HEADS))
        self.table.setHorizontalHeaderLabels(self.HEADS)
        self.table.verticalHeader().setVisible(False)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.table.setAlternatingRowColors(True)
        self.table.setShowGrid(True)
        h = self.table.horizontalHeader()
        h.setSectionResizeMode(QHeaderView.Interactive)
        h.setSectionResizeMode(5, QHeaderView.Stretch)
        for i, w in enumerate([190, 100, 170, 70, 120, 320]):
            self.table.setColumnWidth(i, w)
        self.table.setContextMenuPolicy(Qt.CustomContextMenu)
        self.table.customContextMenuRequested.connect(self._menu_main)
        self.table.itemSelectionChanged.connect(self._on_select)
        split.addWidget(self.table)

        self.panel = QStackedWidget()
        empty = QLabel("← حدد تصفية من الجدول لعرض بنودها هنا")
        empty.setAlignment(Qt.AlignCenter)
        empty.setStyleSheet("color:#64748B; font-size:15px; padding:30px;")
        self.panel.addWidget(empty)
        self.panel.addWidget(self._build_view())
        split.addWidget(self.panel)
        split.setStretchFactor(0, 3)
        split.setStretchFactor(1, 2)
        lay.addWidget(split, 1)

        self._load_accounts()
        self.reload()

    # ---------- بناء لوحة العرض ----------
    def _build_view(self) -> QWidget:
        host = QWidget()
        lay = QVBoxLayout(host)
        lay.setContentsMargins(12, 8, 12, 8)
        lay.setSpacing(6)
        self.view_title = QLabel("")
        self.view_title.setStyleSheet(
            "font-size:16px; font-weight:900; color:#1E3A8A;")
        self.view_title.setWordWrap(True)
        lay.addWidget(self.view_title)
        self.view_sub = QLabel("")
        self.view_sub.setStyleSheet("color:#475569;")
        self.view_sub.setWordWrap(True)
        lay.addWidget(self.view_sub)
        self.lines = QTableWidget(0, len(self.LINE_HEADS))
        self.lines.setHorizontalHeaderLabels(self.LINE_HEADS)
        self.lines.verticalHeader().setVisible(False)
        self.lines.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.lines.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.lines.setSelectionMode(QAbstractItemView.SingleSelection)
        self.lines.setAlternatingRowColors(True)
        lh = self.lines.horizontalHeader()
        lh.setSectionResizeMode(QHeaderView.Interactive)
        lh.setSectionResizeMode(5, QHeaderView.Stretch)
        for i, w in enumerate([130, 100, 180, 150, 150, 280, 120]):
            self.lines.setColumnWidth(i, w)
        self.lines.setContextMenuPolicy(Qt.CustomContextMenu)
        self.lines.customContextMenuRequested.connect(self._menu_lines)
        lay.addWidget(self.lines, 1)
        bar = QHBoxLayout()
        self.view_total = QLabel("")
        self.view_total.setStyleSheet("font-weight:800;")
        bar.addWidget(self.view_total, 1)
        self.edit_btn = QPushButton("✎ تعديل التصفية")
        self.edit_btn.setProperty("flat", True)
        self.edit_btn.setToolTip("تعديل بنود التصفية (للمدير فقط)")
        self.edit_btn.clicked.connect(self._edit_current)
        self.print_btn = QPushButton("🖨 طباعة")
        self.print_btn.setProperty("flat", True)
        self.print_btn.clicked.connect(self._print_current)
        self.excel_btn = QPushButton("📤 Excel")
        self.excel_btn.setProperty("flat", True)
        self.excel_btn.setToolTip("تصدير التصفية المحددة إلى Excel")
        self.excel_btn.clicked.connect(self._excel_current)
        self.copy_btn = QPushButton("⧉ نسخ المرجع")
        self.copy_btn.setProperty("flat", True)
        self.copy_btn.clicked.connect(self._copy_ref)
        for b in (self.edit_btn, self.print_btn, self.excel_btn,
                  self.copy_btn):
            bar.addWidget(b)
        lay.addLayout(bar)
        return host

    # ---------- التحميل ----------
    def _load_accounts(self):
        cur = self.account.currentData()
        self.account.blockSignals(True)
        self.account.clear()
        self.account.addItem("كل الحسابات", None)
        try:
            accounts = lc.custody_accounts()
        except Exception:
            accounts = []
        for a in accounts:
            self.account.addItem(a.get("account") or "—",
                                 a.get("account_id"))
        if cur is not None:
            idx = self.account.findData(cur)
            if idx >= 0:
                self.account.setCurrentIndex(idx)
        self.account.blockSignals(False)

    def _period(self):
        if not self.use_period.isChecked():
            return "", ""
        return (self.date_from.date().toString("yyyy-MM-dd"),
                self.date_to.date().toString("yyyy-MM-dd"))

    def _refresh_all(self):
        self._load_accounts()
        self.reload()

    def _open_reports(self):
        """V3.9: قسم التقارير عند التضمين — والمنبثقة للاستخدام المستقل."""
        try:
            host = self.parentWidget()
            while host is not None and not hasattr(host, "show_section"):
                host = host.parentWidget()
            if host is not None:
                host.show_section("reports")
                return
        except Exception:
            pass
        try:
            from ui.custody_center import SettlementsReportDialog
            SettlementsReportDialog(
                self, self.account.currentData()).exec()
        except Exception as exc:
            style.error(self, f"تعذر فتح تقارير العهد: {exc}")

    def reload(self):
        try:
            from services import auth_service as _auth
            # إخفاء فقط: setVisible(True) المبكر يومض (اختبار عدم الوميض).
            if not _auth.is_admin():
                self.edit_btn.setVisible(False)
            else:
                self.edit_btn.setVisible(True)
        except Exception:
            pass
        d1, d2 = self._period()
        try:
            data = lc.settlements_summary(
                d1, d2, self.account.currentData())
            rows = data.get("rows") or []
        except Exception as exc:
            style.error(self, f"تعذر تحميل التصفيات: {exc}")
            rows = []
        q = (self.search.text() or "").strip()
        if q:
            from services.search_utils import contains as _contains
            kept = []
            for g in rows:
                hay = " ".join(str(g.get(k) or "") for k in (
                    "ref", "vdate", "custody_account", "description"))
                hay += " " + " ".join(
                    str(x.get("voucher_number") or "") for x in
                    g.get("details") or [])
                if _contains(hay, q):
                    kept.append(g)
            rows = kept
        self._rows = rows
        self.total_lbl.setText(
            f"التصفيات: {len(rows)} · الإجمالي: "
            f"{sum(float(g.get('total') or 0) for g in rows):,.3f} د.ك")
        self._fill()
        if self._current_ref and not any(
                (g.get("ref") or "") == self._current_ref for g in rows):
            self._clear_panel()

    def _fill(self):
        from ui.widgets import MONEY_ALIGN
        self.table.blockSignals(True)
        self.table.setRowCount(0)
        for g in self._rows:
            r = self.table.rowCount()
            self.table.insertRow(r)
            vals = [(g.get("ref") or "", Qt.AlignCenter, False),
                    (g.get("vdate") or "", Qt.AlignCenter, False),
                    (g.get("custody_account") or "—",
                     Qt.AlignRight | Qt.AlignVCenter, False),
                    (str(g.get("lines") or ""), Qt.AlignCenter, False),
                    (f"{float(g.get('total') or 0):,.3f}", MONEY_ALIGN,
                     True),
                    (g.get("description") or "",
                     Qt.AlignRight | Qt.AlignVCenter, False)]
            for c, (txt, al, bold) in enumerate(vals):
                it = QTableWidgetItem(str(txt))
                it.setTextAlignment(al)
                if bold:
                    f = it.font()
                    f.setBold(True)
                    it.setFont(f)
                self.table.setItem(r, c, it)
            self.table.setRowHeight(r, 30)
        self.table.blockSignals(False)
        if self._current_ref:
            self._reselect()

    # ---------- التحديد والعرض ----------
    def _on_select(self):
        rows = self.table.selectionModel().selectedRows()
        if not rows or rows[0].row() >= len(self._rows):
            return
        ref = (self._rows[rows[0].row()].get("ref") or "")
        if ref:
            self._show_settlement(ref)

    def _reselect(self):
        for i, g in enumerate(self._rows):
            if (g.get("ref") or "") == self._current_ref:
                self.table.selectRow(i)
                self.table.scrollToItem(self.table.item(i, 0))
                return True
        return False

    def select_settlement(self, ref: str) -> bool:
        """تحديد تصفية برمجيًا (للتنقل من الكشف) — يعيد النجاح."""
        ref = (ref or "").strip()
        if not ref:
            return False
        for i, g in enumerate(self._rows):
            if (g.get("ref") or "") == ref:
                self._current_ref = ref
                self.table.selectRow(i)
                self.table.scrollToItem(self.table.item(i, 0))
                self._show_settlement(ref)
                return True
        return False

    def _show_settlement(self, ref: str):
        try:
            data = lc.custody_settlement(ref)
        except Exception as exc:
            style.error(self, f"تعذر عرض التصفية: {exc}")
            return
        if not data:
            self._clear_panel()
            return
        self._current_ref = ref
        acc = data.get("custody_account") or "—"
        holder = (data.get("holder") or "").strip()
        who = f" · الموظف: {holder}" if holder else ""
        self.view_title.setText(f"🧾 {acc} · {ref}{who}")
        lines = [x for x in (data.get("lines") or [])
                 if not x.get("cancelled")]
        first_desc = ""
        for x in lines:
            if (x.get("description") or "").strip():
                first_desc = x["description"].strip()
                break
        self.view_sub.setText(
            f"التاريخ: {data.get('vdate') or '—'} · البنود: "
            f"{len(lines)} · المُسلَّم: "
            f"{float(data.get('handed') or 0):,.3f} · المُنفَق: "
            f"{float(data.get('spent') or 0):,.3f} · المتبقي لدى الموظف: "
            f"{float(data.get('balance') or 0):,.3f}"
            + (f" · البيان: {first_desc}" if first_desc else ""))
        from ui.widgets import MONEY_ALIGN
        self.lines.setRowCount(0)
        self._line_ids = []
        for x in lines:
            r = self.lines.rowCount()
            self.lines.insertRow(r)
            contract = (((x.get("contract_customer_name") or "").strip()
                         + " — ") if (x.get("contract_customer_name")
                                      or "").strip() else "")
            contract += (x.get("contract_number")
                         or x.get("contract_label") or "")
            vals = [(x.get("voucher_number") or "", Qt.AlignCenter),
                    (x.get("vdate") or "", Qt.AlignCenter),
                    (x.get("expense_account_snapshot")
                     or x.get("account") or "",
                     Qt.AlignRight | Qt.AlignVCenter),
                    (x.get("party") or "",
                     Qt.AlignRight | Qt.AlignVCenter),
                    (contract, Qt.AlignRight | Qt.AlignVCenter),
                    (x.get("description") or "",
                     Qt.AlignRight | Qt.AlignVCenter),
                    (f"{float(x.get('amount') or 0):,.3f}", MONEY_ALIGN)]
            for c, (txt, al) in enumerate(vals):
                it = QTableWidgetItem(str(txt))
                it.setTextAlignment(al)
                self.lines.setItem(r, c, it)
            self.lines.setRowHeight(r, 28)
            self._line_ids.append(x.get("id"))
        self.view_total.setText(
            f"إجمالي التصفية: {float(data.get('spent') or 0):,.3f} د.ك · "
            f"عدد البنود: {len(lines)}")
        self.panel.setCurrentIndex(1)

    def _clear_panel(self):
        self._current_ref = ""
        self._line_ids = []
        self.panel.setCurrentIndex(0)

    # ---------- إجراءات ----------
    def _edit_current(self):
        if not self._current_ref:
            style.info(self, "حدد تصفية من الجدول أولًا.")
            return
        try:
            from services import auth_service as _auth
            if not _auth.is_admin():
                style.toast(self, "تعديل التصفية للمدير فقط.")
                return
            from services import feature_service as _feat
            if not _feat.enabled("settle_edit"):
                style.info(self, "تعديل التصفية معطّل لهذا العميل.")
                return
        except Exception:
            pass
        try:
            from ui.custody_center import SettlementEditDialog
            if SettlementEditDialog(self, self._current_ref).exec():
                self.reload()
                self._show_settlement(self._current_ref)
                try:
                    self.data_changed.emit()
                except Exception:
                    pass
        except Exception as exc:
            style.error(self, f"تعذر تعديل التصفية: {exc}")

    def _print_current(self):
        if not self._current_ref:
            style.info(self, "حدد تصفية من الجدول أولًا.")
            return
        try:
            import tempfile
            from reports.custody_pdf import generate_custody_pdf
            tmp = tempfile.NamedTemporaryFile(suffix=".pdf",
                                              delete=False)
            tmp.close()
            data = lc.custody_settlement(self._current_ref)
            generate_custody_pdf(data, tmp.name)
            from ui.pdf_preview import PdfPreviewDialog
            PdfPreviewDialog(
                self, tmp.name, title="كشف تصفية عهدة",
                save_name=f"تصفية_عهدة_{self._current_ref}.pdf").exec()
        except Exception as exc:
            style.error(self, f"تعذر طباعة التصفية: {exc}")

    def _excel_current(self):
        if not self._current_ref:
            style.info(self, "حدد تصفية من الجدول أولًا.")
            return
        from PySide6.QtWidgets import QFileDialog
        import os
        default = os.path.join(os.path.expanduser("~"),
                               f"تصفية_عهدة_{self._current_ref}.xlsx")
        path, _ = QFileDialog.getSaveFileName(self, "حفظ التصفية",
                                              default, "Excel (*.xlsx)")
        if not path:
            return
        if not path.lower().endswith(".xlsx"):
            path += ".xlsx"
        try:
            from openpyxl import Workbook
            from openpyxl.styles import (Alignment, Font, PatternFill)
            data = lc.custody_settlement(self._current_ref)
            lines = [x for x in (data.get("lines") or [])
                     if not x.get("cancelled")]
            wb = Workbook()
            ws = wb.active
            ws.title = "التصفية"
            ws.sheet_view.rightToLeft = True
            ws.append(["تصفية عهدة", self._current_ref])
            ws.append(["العهدة", data.get("custody_account") or ""])
            ws.append(["التاريخ", data.get("vdate") or ""])
            ws.append([])
            ws.append(self.LINE_HEADS)
            for c in ws[5]:
                c.font = Font(bold=True, color="FFFFFF")
                c.fill = PatternFill("solid", fgColor="1E3A5F")
                c.alignment = Alignment(horizontal="center")
            for x in lines:
                ws.append([x.get("voucher_number"), x.get("vdate"),
                           x.get("expense_account_snapshot")
                           or x.get("account"), x.get("party"),
                           x.get("contract_number")
                           or x.get("contract_label"),
                           x.get("description"),
                           float(x.get("amount") or 0)])
            ws.append(["", "", "", "", "", "الإجمالي",
                       float(data.get("spent") or 0)])
            for col in range(1, 8):
                ws.column_dimensions[chr(64 + col)].width = (
                    34 if col == 6 else 20)
            wb.save(path)
            style.info(self, f"تم حفظ التصفية:\n{path}", "تم")
            try:
                from ui.invoices import open_file_externally
                open_file_externally(path)
            except Exception:
                pass
        except Exception as exc:
            style.error(self, f"تعذر تصدير Excel: {exc}")

    def _copy_ref(self):
        if not self._current_ref:
            return
        try:
            from PySide6.QtWidgets import QApplication
            QApplication.clipboard().setText(self._current_ref)
            style.toast(self, "تم نسخ المرجع.")
        except Exception:
            pass

    def _edit_line_voucher(self, voucher_id):
        try:
            from services import auth_service as _auth
            if not _auth.is_admin():
                style.toast(self, "تعديل السندات للمدير فقط.")
                return
        except Exception:
            pass
        try:
            v = lc.get_voucher(int(voucher_id))
            if not v:
                style.error(self, "السند غير موجود.")
                return
            from ui.vouchers import VoucherDialog
            from PySide6.QtWidgets import QDialog as _QD
            if VoucherDialog(self, "payment",
                             voucher=dict(v)).exec() == _QD.Accepted:
                self.reload()
                if self._current_ref:
                    self._show_settlement(self._current_ref)
                try:
                    self.data_changed.emit()
                except Exception:
                    pass
        except Exception as exc:
            style.error(self, f"تعذر تعديل السند: {exc}")

    # ---------- قوائم السياق ----------
    def _menu_main(self, pos):
        row = self.table.rowAt(pos.y())
        if row < 0 or row >= len(self._rows):
            return
        self.table.selectRow(row)
        ref = (self._rows[row].get("ref") or "")
        menu = QMenu(self)
        menu.setLayoutDirection(Qt.RightToLeft)
        try:
            from services import auth_service as _auth
            _admin = bool(_auth.is_admin())
        except Exception:
            _admin = False
        try:
            from services import feature_service as _feat
            _can_edit = _feat.enabled("settle_edit")
        except Exception:
            _can_edit = True
        a_view = menu.addAction("👁 عرض التصفية")
        a_view.triggered.connect(lambda *_: self._show_settlement(ref))
        if _admin and _can_edit:
            a_edit = menu.addAction("✎ تعديل التصفية")
            a_edit.triggered.connect(self._edit_current)
        a_print = menu.addAction("🖨 طباعة التصفية")
        a_print.triggered.connect(self._print_current)
        a_xls = menu.addAction("📤 تصدير Excel")
        a_xls.triggered.connect(self._excel_current)
        a_copy = menu.addAction("⧉ نسخ المرجع")
        a_copy.triggered.connect(self._copy_ref)
        menu.exec(self.table.viewport().mapToGlobal(pos))

    def _menu_lines(self, pos):
        row = self.lines.rowAt(pos.y())
        if row < 0 or row >= len(self._line_ids):
            return
        self.lines.selectRow(row)
        vid = self._line_ids[row]
        menu = QMenu(self)
        menu.setLayoutDirection(Qt.RightToLeft)
        try:
            from services import auth_service as _auth
            _admin = bool(_auth.is_admin())
        except Exception:
            _admin = False
        if _admin:
            a_edit = menu.addAction("✎ تعديل السند")
            a_edit.triggered.connect(
                lambda *_: self._edit_line_voucher(vid))
        else:
            _no = menu.addAction("تعديل السندات للمدير فقط")
            _no.setEnabled(False)
        menu.exec(self.lines.viewport().mapToGlobal(pos))
