# -*- coding: utf-8 -*-
"""V4.53: صفحة سلف الموظفين — صرف/رد/خصم + كشف لكل موظف."""
from PySide6.QtCore import QDate, Qt
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QCheckBox, QComboBox, QDateEdit, QDialog, QDialogButtonBox,
    QDoubleSpinBox, QFormLayout, QHBoxLayout, QLabel, QLineEdit,
    QPushButton, QTableWidget, QTableWidgetItem, QVBoxLayout, QWidget,
)

from services import lifecycle_service as lc
from ui import style
from ui.archive import _fill
from ui.widgets import export_table_excel

HEADS = ["التاريخ", "المرجع", "الحركة", "البيان", "سلفة (+)",
         "استرداد (−)", "المتبقي"]


class EmployeeDialog(QDialog):
    """موظف جديد (أو عرض بيانات)."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("➕ موظف جديد")
        self.setMinimumWidth(340)
        self._saved_id: int | None = None
        root = QVBoxLayout(self)
        form = QFormLayout()
        self.name = QLineEdit()
        self.phone = QLineEdit()
        self.notes = QLineEdit()
        form.addRow("الاسم:*", self.name)
        form.addRow("الهاتف:", self.phone)
        form.addRow("ملاحظات:", self.notes)
        root.addLayout(form)
        bb = QDialogButtonBox(QDialogButtonBox.Save | QDialogButtonBox.Cancel)
        bb.accepted.connect(self._save)
        bb.rejected.connect(self.reject)
        root.addWidget(bb)

    def _save(self):
        try:
            self._saved_id = lc.add_employee(
                self.name.text(), self.phone.text(), self.notes.text())
        except Exception as exc:
            style.error(self, str(exc))
            return
        self.accept()


class _MoveDialog(QDialog):
    """قاعدة نوافذ الحركات الثلاث (المبلغ بسقف المتبقي للاسترداد)."""

    title = "حركة"
    needs_method = True

    def __init__(self, parent=None, employee_id: int | None = None):
        super().__init__(parent)
        self.setWindowTitle(self.title)
        self.setMinimumWidth(360)
        self._saved_id: int | None = None
        root = QVBoxLayout(self)
        form = QFormLayout()
        self.employee = QComboBox()
        try:
            _emps = lc.list_employees()
        except Exception:
            _emps = []
        for e in _emps:
            self.employee.addItem(
                f"{e.get('name') or ''}"
                + (f" — {e.get('phone')}" if e.get("phone") else ""),
                int(e["id"]))
        if employee_id:
            _i = self.employee.findData(int(employee_id))
            if _i >= 0:
                self.employee.setCurrentIndex(_i)
        self.balance_lbl = QLabel("")
        self.balance_lbl.setStyleSheet("font-weight: 800; color: #1E3A8A;")
        self.amount = QDoubleSpinBox()
        self.amount.setRange(0, 10000000)
        self.amount.setDecimals(3)
        self.date = QDateEdit()
        self.date.setCalendarPopup(True)
        self.date.setDisplayFormat("yyyy-MM-dd")
        self.date.setDate(QDate.currentDate())
        self.method = QComboBox()
        self.method.addItems(["الصندوق", "البنك"])
        self.notes = QLineEdit()
        self.notes.setPlaceholderText("ملاحظات (اختياري)")
        form.addRow("الموظف:", self.employee)
        form.addRow("", self.balance_lbl)
        form.addRow("المبلغ:", self.amount)
        form.addRow("التاريخ:", self.date)
        if self.needs_method:
            form.addRow("الطريقة:" if self.is_advance else "إلى:",
                        self.method)
        form.addRow("ملاحظات:", self.notes)
        root.addLayout(form)
        self.employee.currentIndexChanged.connect(self._refresh_max)
        self._refresh_max()
        bb = QDialogButtonBox(QDialogButtonBox.Save | QDialogButtonBox.Cancel)
        bb.accepted.connect(self._save)
        bb.rejected.connect(self.reject)
        root.addWidget(bb)

    is_advance = False

    def _refresh_max(self):
        try:
            _bal = lc.employee_balance(int(self.employee.currentData() or 0))
        except Exception:
            _bal = 0.0
        self.balance_lbl.setText(f"المتبقي الحالي: {_bal:,.3f} د.ك")
        if not self.is_advance:
            self.amount.setMaximum(max(_bal, 0.0))
            if self.amount.value() <= 0 or self.amount.value() > _bal:
                self.amount.setValue(max(_bal, 0.0))

    def _save(self):
        raise NotImplementedError


class AdvanceDialog(_MoveDialog):
    title = "💸 سلفة جديدة"
    is_advance = True

    def _save(self):
        try:
            self._saved_id = lc.add_employee_advance(
                self.date.date().toString("yyyy-MM-dd"),
                int(self.employee.currentData() or 0),
                self.amount.value(), self.method.currentText(),
                self.notes.text().strip())
        except Exception as exc:
            style.error(self, str(exc))
            return
        style.success(self, "سُجّلت السلفة ✅")
        self.accept()


class CashReturnDialog(_MoveDialog):
    title = "↩ رد سلفة نقدًا"

    def _save(self):
        try:
            self._saved_id = lc.add_advance_cash_return(
                self.date.date().toString("yyyy-MM-dd"),
                int(self.employee.currentData() or 0),
                self.amount.value(), self.method.currentText(),
                self.notes.text().strip())
        except Exception as exc:
            style.error(self, str(exc))
            return
        style.success(self, "سُجّل الرد ✅ (يخفض المصروف)")
        self.accept()


class DeductDialog(_MoveDialog):
    title = "✂ خصم سلفة من راتب"
    needs_method = False

    def _save(self):
        try:
            self._saved_id = lc.add_salary_deduction(
                self.date.date().toString("yyyy-MM-dd"),
                int(self.employee.currentData() or 0),
                self.amount.value(), self.notes.text().strip())
        except Exception as exc:
            style.error(self, str(exc))
            return
        style.success(self, "سُجّل الخصم ✅ (رواتب/تخفيض سلفة)")
        self.accept()


class AdvancesPage(QWidget):
    """صفحة سلف الموظفين: الأرصدة + الحركات + الكشف."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setLayoutDirection(Qt.RightToLeft)
        lay = QVBoxLayout(self)
        title = QLabel("👥 سلف الموظفين")
        title.setProperty("pageTitle", True)
        lay.addWidget(title)
        desc = QLabel("صرف السلف واستردادها (رد نقدي أو خصم راتب) — "
                      "الاسترداد يخفض المصروف ولا يمس الإيرادات")
        desc.setProperty("pageDesc", True)
        lay.addWidget(desc)

        top = QHBoxLayout()
        self.employee = QComboBox()
        self.employee.setMinimumWidth(240)
        try:
            from ui.widgets import make_searchable
            make_searchable(self.employee, "")
        except Exception:
            pass
        self.employee.currentIndexChanged.connect(self.reload)
        self.new_emp_btn = QPushButton("➕ موظف")
        self.new_emp_btn.setToolTip("إضافة موظف جديد")
        self.new_emp_btn.clicked.connect(self._new_employee)
        self.adv_btn = QPushButton("＋ سلفة جديدة")
        self.adv_btn.setObjectName("btnPrimary")
        self.adv_btn.clicked.connect(self._advance)
        self.ret_btn = QPushButton("↩ رد نقدي")
        self.ret_btn.setProperty("flat", True)
        self.ret_btn.clicked.connect(self._cash_return)
        self.ded_btn = QPushButton("✂ خصم من راتب")
        self.ded_btn.setProperty("flat", True)
        self.ded_btn.clicked.connect(self._deduct)
        # V8.4: زر استعادة سلفة ملغاة
        self.restore_btn = QPushButton("♻️ استعادة سلفة")
        self.restore_btn.setProperty("flat", True)
        self.restore_btn.clicked.connect(self._restore_advance)
        top.addWidget(QLabel("الموظف"))
        top.addWidget(self.employee, 1)
        top.addWidget(self.new_emp_btn)
        top.addStretch()
        top.addWidget(self.restore_btn)
        top.addWidget(self.ded_btn)
        top.addWidget(self.ret_btn)
        top.addWidget(self.adv_btn)
        lay.addLayout(top)

        cards = QHBoxLayout()
        self.card_a = self._card("💸 إجمالي المسلَّم", "#FEF3C7", "#92400E")
        self.card_r = self._card("↩ المسترد + المخصوم", "#DCFCE7", "#166534")
        self.card_b = self._card("💰 المتبقي", "#DBEAFE", "#1E3A8A")
        cards.addWidget(self.card_a[0])
        cards.addWidget(self.card_r[0])
        cards.addWidget(self.card_b[0])
        lay.addLayout(cards)

        tools = QHBoxLayout()
        tools.addStretch()
        self.stmt_btn = QPushButton("📋 كشف حساب")
        self.stmt_btn.setProperty("flat", True)
        self.stmt_btn.clicked.connect(self._show_statement)
        self.summary_btn = QPushButton("📊 تقرير مجمع")
        self.summary_btn.setProperty("flat", True)
        self.summary_btn.clicked.connect(self._show_summary)
        self.xls_btn = QPushButton("📤 تصدير Excel")
        self.xls_btn.setProperty("flat", True)
        self.xls_btn.clicked.connect(self._export_excel)
        self.pdf_btn = QPushButton("🖨 طباعة PDF")
        self.pdf_btn.setProperty("flat", True)
        self.pdf_btn.clicked.connect(self._print_pdf)
        tools.addWidget(self.stmt_btn)
        tools.addWidget(self.summary_btn)
        tools.addWidget(self.xls_btn)
        tools.addWidget(self.pdf_btn)
        lay.addLayout(tools)

        self.table = QTableWidget(0, len(HEADS))
        self.table.setHorizontalHeaderLabels(HEADS)
        self.table.verticalHeader().setVisible(False)
        try:
            self.table.horizontalHeader().setStretchLastSection(True)
        except Exception:
            pass
        lay.addWidget(self.table, 1)
        self._load_employees()
        self.reload()

    def _card(self, caption, bg, fg):
        from PySide6.QtWidgets import QFrame
        f = QFrame()
        f.setStyleSheet(f"background: {bg}; border-radius: 10px;")
        v = QVBoxLayout(f)
        v.setContentsMargins(12, 8, 12, 8)
        c = QLabel(caption)
        c.setStyleSheet(f"color: {fg}; font-weight: 700;")
        n = QLabel("0.000")
        n.setStyleSheet(f"color: {fg}; font-weight: 900; font-size: 17px;")
        v.addWidget(c)
        v.addWidget(n)
        return f, n

    def _load_employees(self, select_id: int | None = None):
        cur = select_id or self.employee.currentData()
        self.employee.blockSignals(True)
        self.employee.clear()
        try:
            emps = lc.list_employees()
        except Exception:
            emps = []
        for e in emps:
            self.employee.addItem(e.get("name") or "", int(e["id"]))
        if cur:
            _i = self.employee.findData(int(cur))
            if _i >= 0:
                self.employee.setCurrentIndex(_i)
        self.employee.blockSignals(False)

    def _current_id(self) -> int | None:
        try:
            return int(self.employee.currentData() or 0) or None
        except Exception:
            return None

    def reload(self):
        eid = self._current_id()
        if not eid:
            for _c in (self.card_a, self.card_r, self.card_b):
                _c[1].setText("0.000")
            _fill(self.table, [])
            return
        try:
            bals = {b["employee_id"]: b for b in lc.employee_balances()}
            b = bals.get(eid, {})
            _a = float(b.get("advanced") or 0)
            _out = float(b.get("recovered") or 0) + float(b.get("deducted") or 0)
            self.card_a[1].setText(f"{_a:,.3f}")
            self.card_r[1].setText(f"{_out:,.3f}")
            self.card_b[1].setText(f"{float(b.get('balance') or 0):,.3f}")
            led = lc.employee_ledger(eid)
            rows = [[i["vdate"], i["ref"], i["label"], i["description"],
                     f"{i['in']:,.3f}" if i["in"] else "—",
                     f"{i['out']:,.3f}" if i["out"] else "—",
                     f"{i['balance']:,.3f}"] for i in led["rows"]]
            _fill(self.table, rows, money_cols=(4, 5, 6))
        except Exception as exc:
            style.error(self, f"تعذر تحميل الكشف: {exc}")

    def _new_employee(self):
        dlg = EmployeeDialog(self)
        if dlg.exec() == QDialog.Accepted:
            self._load_employees(select_id=dlg._saved_id)
            self.reload()

    def _run_move(self, cls):
        if not self._current_id() and cls is not AdvanceDialog:
            style.info(self, "أضف موظفًا أولًا.")
            return
        dlg = cls(self, employee_id=self._current_id())
        if dlg.exec() == QDialog.Accepted:
            self.reload()

    def _advance(self):
        self._run_move(AdvanceDialog)

    def _cash_return(self):
        self._run_move(CashReturnDialog)

    def _deduct(self):
        self._run_move(DeductDialog)

    def _restore_advance(self):
        """V8.4: استعادة سلفة موظف ملغاة."""
        eid = self._current_id()
        if not eid:
            style.info(self, "اختر موظفًا أولًا.")
            return
        # البحث عن السندات الملغاة لهذا الموظف
        try:
            from services import lifecycle_service as lc
            with lc.get_connection() as conn:
                cancelled = conn.execute(
                    "SELECT id, voucher_number, vdate, amount "
                    "FROM vouchers "
                    "WHERE advance_employee_id=? AND cancelled=1 "
                    "ORDER BY vdate DESC LIMIT 20",
                    (eid,)).fetchall()
        except Exception:
            cancelled = []
        if not cancelled:
            style.info(self, "لا توجد سلف ملغاة لهذا الموظف.")
            return
        # اختيار السلفة المراد استعادتها
        from PySide6.QtWidgets import QInputDialog
        items = [f"{r['voucher_number']} — {r['vdate']} — {r['amount']:,.3f} د.ك"
                 for r in cancelled]
        item, ok = QInputDialog.getItem(
            self, "استعادة سلفة", "اختر السلفة المراد استعادتها:", items, 0, False)
        if not ok:
            return
        idx = items.index(item)
        vid = int(cancelled[idx]["id"])
        # تأكيد الاستعادة
        from PySide6.QtWidgets import QMessageBox
        reply = QMessageBox.question(
            self, "تأكيد الاستعادة",
            f"هل تريد استعادة السلفة {cancelled[idx]['voucher_number']}؟\n\n"
            f"المبلغ: {cancelled[idx]['amount']:,.3f} د.ك",
            QMessageBox.Yes | QMessageBox.No, QMessageBox.No)
        if reply != QMessageBox.Yes:
            return
        try:
            from services.unified_cancel_service import restore_transaction
            restore_transaction("voucher", vid, reason="استعادة سلفة موظف")
            style.success(self, "تمت استعادة السلفة ✅")
            self.reload()
        except Exception as exc:
            style.error(self, str(exc))

    def _sheet(self):
        eid = self._current_id()
        try:
            _emp = lc.get_employee(eid) if eid else {}
        except Exception:
            _emp = {}
        led = lc.employee_ledger(eid) if eid else {"rows": []}
        rows = [[i["vdate"], i["ref"], i["label"], i["description"],
                 i["in"] or "", i["out"] or "", i["balance"]]
                for i in led["rows"]]
        return {"name": f"كشف سلفة — {(_emp or {}).get('name') or ''}",
                "heads": HEADS, "rows": rows,
                "number_cols": [4, 5, 6]}

    def _show_statement(self):
        """كشف حساب فردي للموظف المختار."""
        emp_id = self._current_id()
        if not emp_id:
            style.info(self, "اختر موظف أولًا.")
            return
        from PySide6.QtWidgets import QDialog, QVBoxLayout as VL, QLabel
        dlg = QDialog(self)
        emp_name = self.employee.currentText().strip()
        dlg.setWindowTitle(f"📋 كشف سلف — {emp_name}")
        dlg.setLayoutDirection(Qt.RightToLeft)
        dlg.setMinimumSize(700, 450)
        lay = VL(dlg)
        lay.setSpacing(8)

        header = QLabel(f"📋 كشف حساب سلف — {emp_name}")
        header.setStyleSheet("font-size: 14px; font-weight: 800;")
        lay.addWidget(header)

        from services import lifecycle_service as lc
        ledger = lc.employee_ledger(emp_id)
        rows = ledger.get("rows", [])
        balance = ledger.get("balance", 0.0)

        tbl = QTableWidget(len(rows), 5)
        tbl.setHorizontalHeaderLabels(
            ["التاريخ", "النوع", "البيان", "المبلغ", "الرصيد"])
        tbl.verticalHeader().setVisible(False)
        tbl.setEditTriggers(QTableWidget.NoEditTriggers)
        tbl.setAlternatingRowColors(True)
        tbl.horizontalHeader().setStretchLastSection(True)
        from ui.widgets import MONEY_ALIGN
        for i, r in enumerate(rows):
            vals = [
                r.get("date", ""),
                r.get("kind_label", ""),
                r.get("description", ""),
                f"{float(r.get('amount') or 0):,.3f}",
                f"{float(r.get('balance') or 0):,.3f}",
            ]
            for c, v in enumerate(vals):
                it = QTableWidgetItem(str(v))
                if c in (3, 4):
                    it.setTextAlignment(MONEY_ALIGN)
                else:
                    it.setTextAlignment(Qt.AlignCenter)
                # لون الرصيد
                if c == 4:
                    bal_val = float(r.get("balance") or 0)
                    if bal_val > 0.001:
                        it.setForeground(QColor("#DC2626"))
                    elif bal_val < -0.001:
                        it.setForeground(QColor("#059669"))
                tbl.setItem(i, c, it)
        lay.addWidget(tbl, 1)

        bal_lbl = QLabel(f"💰 الرصيد الحالي: {balance:,.3f} د.ك")
        bal_lbl.setStyleSheet(
            f"font-weight: 800; font-size: 13px; color: "
            f"{'#DC2626' if balance > 0.001 else '#059669'};")
        lay.addWidget(bal_lbl)

        close = QPushButton("✕ إغلاق")
        close.setProperty("flat", True)
        close.clicked.connect(dlg.reject)
        btns = QHBoxLayout()
        btns.addStretch()
        btns.addWidget(close)
        lay.addLayout(btns)
        dlg.exec()

    def _show_summary(self):
        """تقرير مجمع — أرصدة كل الموظفين."""
        from PySide6.QtWidgets import QDialog, QVBoxLayout as VL, QLabel
        dlg = QDialog(self)
        dlg.setWindowTitle("📊 تقرير مجمع — سلف الموظفين")
        dlg.setLayoutDirection(Qt.RightToLeft)
        dlg.setMinimumSize(650, 400)
        lay = VL(dlg)
        lay.setSpacing(8)

        header = QLabel("📊 تقرير مجمع — أرصدة سلف الموظفين")
        header.setStyleSheet("font-size: 14px; font-weight: 800;")
        lay.addWidget(header)

        from services import lifecycle_service as lc
        bals = lc.employee_balances()
        tbl = QTableWidget(len(bals), 5)
        tbl.setHorizontalHeaderLabels(
            ["#", "الموظف", "المسلَّم", "المسترد+المخصوم", "المتبقي"])
        tbl.verticalHeader().setVisible(False)
        tbl.setEditTriggers(QTableWidget.NoEditTriggers)
        tbl.setAlternatingRowColors(True)
        tbl.horizontalHeader().setStretchLastSection(True)
        from ui.widgets import MONEY_ALIGN
        total_adv = 0.0
        total_rec = 0.0
        total_bal = 0.0
        for i, b in enumerate(bals):
            adv = float(b.get("advanced") or 0)
            rec = float(b.get("recovered") or 0) + float(b.get("deducted") or 0)
            bal = float(b.get("balance") or 0)
            total_adv += adv
            total_rec += rec
            total_bal += bal
            vals = [
                str(i + 1),
                b.get("employee", ""),
                f"{adv:,.3f}",
                f"{rec:,.3f}",
                f"{bal:,.3f}",
            ]
            for c, v in enumerate(vals):
                it = QTableWidgetItem(str(v))
                if c >= 2:
                    it.setTextAlignment(MONEY_ALIGN)
                else:
                    it.setTextAlignment(Qt.AlignCenter)
                if c == 4:
                    if bal > 0.001:
                        it.setForeground(QColor("#DC2626"))
                tbl.setItem(i, c, it)
        lay.addWidget(tbl, 1)

        totals = QLabel(
            f"الإجمالي: مسلّم {total_adv:,.3f} · مسترد {total_rec:,.3f} · متبقي {total_bal:,.3f} د.ك")
        totals.setStyleSheet("font-weight: 800; font-size: 12px;")
        lay.addWidget(totals)

        close = QPushButton("✕ إغلاق")
        close.setProperty("flat", True)
        close.clicked.connect(dlg.reject)
        btns = QHBoxLayout()
        btns.addStretch()
        btns.addWidget(close)
        lay.addLayout(btns)
        dlg.exec()

    def _export_excel(self):
        sh = self._sheet()
        if not sh["rows"]:
            style.info(self, "لا توجد حركات للتصدير.")
            return
        export_table_excel(self, sh["name"], sh["heads"], sh["rows"],
                           "advance_statement",
                           number_cols=sh["number_cols"])

    def _print_pdf(self):
        import os
        from PySide6.QtWidgets import QFileDialog
        sh = self._sheet()
        if not sh["rows"]:
            style.info(self, "لا توجد حركات للطباعة.")
            return
        default = os.path.join(os.path.expanduser("~"),
                               "advance_statement.pdf")
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
            from ui.invoices import open_file_externally
            open_file_externally(path)
        except Exception:
            pass
