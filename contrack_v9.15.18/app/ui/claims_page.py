# -*- coding: utf-8 -*-
"""V4.47: المطالبات المالية — مطالبتنا على العميل ومطالبات المقاولين.

تابان + فلاتر حالة + بحث · ترحيل الحالات بزر واحد · تصدير/طباعة ·
تنبيه المتأخر (معتمدة تجاوزت استحقاقها).
"""
from PySide6.QtCore import QDate, Qt
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (QComboBox, QDateEdit, QDialog, QDialogButtonBox,
                               QFormLayout, QHBoxLayout, QLabel, QLineEdit,
                               QPushButton, QVBoxLayout, QWidget)

from services import claims_service as cl
from services import contract_service, lifecycle_service as lc
from services.customer_service import ValidationError
from ui import style
from ui.design_system import Colors, Dimensions, Fonts, Styles
from ui.archive import _table
from ui.widgets import (SafeDoubleSpinBox, SegmentedTabs,
                        apply_column_weights, export_table_excel,
                        size_buttons)

HEADS_OUT = ["المطالبة", "العقد / العميل", "الدفعة المرتبطة", "المبلغ",
             "الاستحقاق", "الحالة", "سند التحصيل", "ملاحظات"]
HEADS_IN = ["المطالبة", "المقاول / العقد", "الدفعة المرتبطة", "المبلغ",
            "الاستحقاق", "الحالة", "سند الدفع", "ملاحظات"]
OVERDUE_RED = "#B91C1C"


class ClaimDialog(QDialog):
    """إضافة/تعديل مطالبة — العقد ثم الدفعة المرتبطة ثم المبلغ."""

    def __init__(self, parent, direction: str, claim: dict | None = None):
        super().__init__(parent)
        self.direction = direction
        self.claim = claim or {}
        is_new = not self.claim.get("id")
        style.setup_dialog(
            self,
            "مطالبة جديدة" if is_new else f"تعديل {self.claim.get('claim_number', '')}",
            "بيانات المطالبة والعقد والمبلغ",
            icon="📝", color=style.INFO,
            size_ratio=0.50, min_w=480, max_w=900)
        lay = self.body_layout
        form = QFormLayout()
        lay.addLayout(form)
        self.contract = QComboBox()
        self.contract.setEditable(True)
        for c in contract_service.list_contracts():
            _cid = getattr(c, "id", 0)
            _num = getattr(c, "contract_number", "") or ""
            _who = (getattr(c, "customer_name", "")
                    or getattr(c, "contract_name", "") or "")
            self.contract.addItem(f"{_num} — {_who}", int(_cid))
        self.contract.currentIndexChanged.connect(
            self._on_contract_changed)
        form.addRow("العقد", self.contract)
        if direction == cl.DIR_IN:
            self.sub = QComboBox()
            self.sub.currentIndexChanged.connect(self._reload_lines)
            form.addRow("عقد الباطن", self.sub)
        self.line = QComboBox()
        form.addRow("الدفعة المرتبطة", self.line)
        self.title = QLineEdit()
        form.addRow("العنوان", self.title)
        self.amount = SafeDoubleSpinBox()
        self.amount.setRange(0.001, 1e12)
        self.amount.setDecimals(3)
        self.amount.setGroupSeparatorShown(True)
        form.addRow("المبلغ", self.amount)
        self.due = QDateEdit()
        self.due.setCalendarPopup(True)
        self.due.setDisplayFormat("yyyy-MM-dd")
        self.due.setDate(QDate.currentDate().addDays(30))
        form.addRow("الاستحقاق", self.due)
        self.voucher = QLineEdit()
        self.voucher.setPlaceholderText("رقم سند التحصيل/الدفع (اختياري)")
        form.addRow("مرجع السند", self.voucher)
        self.notes = QLineEdit()
        form.addRow("ملاحظات", self.notes)
        if not is_new:
            st = QLabel(self.claim.get("status_label", ""))
            st.setStyleSheet("font-weight: 800;")
            form.addRow("الحالة", st)
            self.contract.setEnabled(False)
            if direction == cl.DIR_IN:
                self.sub.setEnabled(False)
            self.line.setEnabled(False)
        btns = QDialogButtonBox(QDialogButtonBox.Save
                                | QDialogButtonBox.Cancel)
        btns.button(QDialogButtonBox.Save).setText("💾 حفظ")
        btns.button(QDialogButtonBox.Cancel).setText("✕ إلغاء")
        btns.accepted.connect(self._save)
        btns.rejected.connect(self.reject)
        lay.addWidget(btns)
        self._reload_subs()
        if not is_new:
            idx = self.contract.findData(int(self.claim["contract_id"]))
            self.contract.setCurrentIndex(idx if idx >= 0 else 0)
            self._reload_subs()
            if direction == cl.DIR_IN and self.claim.get("sub_contract_id"):
                i2 = self.sub.findData(int(self.claim["sub_contract_id"]))
                self.sub.setCurrentIndex(i2 if i2 >= 0 else 0)
            self._reload_lines()
            lid = (self.claim.get("cust_line_id")
                   or self.claim.get("sub_line_id"))
            if lid:
                i3 = self.line.findData(int(lid))
                self.line.setCurrentIndex(i3 if i3 >= 0 else 0)
            self.title.setText(self.claim.get("title", ""))
            self.amount.setValue(float(self.claim.get("amount") or 0))
            if (self.claim.get("due_date") or "")[:10]:
                self.due.setDate(QDate.fromString(
                    self.claim["due_date"][:10], "yyyy-MM-dd"))
            self.voucher.setText(self.claim.get("voucher_ref", ""))
            self.notes.setText((self.claim.get("notes", "") or "")
                               .split("\n")[0])
        else:
            self._reload_lines()

    def _cid(self):
        return self.contract.currentData()

    def _on_contract_changed(self):
        self._reload_subs()
        self._reload_lines()

    def _reload_subs(self):
        if self.direction != cl.DIR_IN:
            return
        self.sub.blockSignals(True)
        self.sub.clear()
        if self._cid():
            for sc in lc.list_sub_contracts(int(self._cid())):
                self.sub.addItem(
                    f"{sc.get('sub_name', '')} #{sc['id']}", int(sc["id"]))
        self.sub.blockSignals(False)

    def _reload_lines(self):
        self.line.clear()
        self.line.addItem("— بلا ربط —", None)
        if not self._cid():
            return
        if self.direction == cl.DIR_OUT:
            for x in lc.contract_payment_plan(int(self._cid())):
                self.line.addItem(
                    f"{x.get('title', '')} · "
                    f"{float(x.get('amount') or 0):,.3f}", int(x["id"]))
        else:
            scid = self.sub.currentData()
            if scid:
                for x in lc.sub_payment_plan(int(scid)):
                    self.line.addItem(
                        f"{x.get('title', '')} · "
                        f"{float(x.get('amount') or 0):,.3f}", int(x["id"]))

    def _save(self):
        if not self._cid():
            style.error(self, "اختر العقد أولًا.")
            return
        try:
            if not self.claim.get("id"):
                kw: dict = {}
                if self.direction == cl.DIR_OUT:
                    kw["cust_line_id"] = self.line.currentData()
                else:
                    if not self.sub.currentData():
                        style.error(self, "اختر عقد الباطن أولًا.")
                        return
                    kw["sub_contract_id"] = self.sub.currentData()
                    kw["sub_line_id"] = self.line.currentData()
                cl.add_claim(
                    self.direction, int(self._cid()),
                    self.title.text(),
                    float(self.amount.value()),
                    self.due.date().toString("yyyy-MM-dd"),
                    notes=self.notes.text().strip(), **kw)
                style.toast(self, "سُجّلت المطالبة")
            else:
                cl.update_claim(
                    int(self.claim["id"]), title=self.title.text(),
                    amount=float(self.amount.value()),
                    due_date=self.due.date().toString("yyyy-MM-dd"),
                    voucher_ref=self.voucher.text(),
                    notes=self.notes.text().strip())
                style.toast(self, "حُفظ التعديل")
            self.accept()
        except (ValidationError, Exception) as exc:
            style.error(self, str(exc))


class ClaimsPage(QWidget):
    """صفحة المطالبات المالية بتابيها."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setLayoutDirection(Qt.RightToLeft)
        self._rows: list[dict] = []
        root = QVBoxLayout(self)
        root.setContentsMargins(12, 8, 12, 8)
        root.setSpacing(8)

        top = QHBoxLayout()
        title = QLabel("🧾 المطالبات المالية")
        title.setProperty("pageTitle", True)
        top.addWidget(title)
        top.addStretch()
        self.overdue_lbl = QLabel("")
        self.overdue_lbl.setStyleSheet(
            f"color: {OVERDUE_RED}; font-weight: 800;")
        top.addWidget(self.overdue_lbl)
        self.totals = QLabel("")
        self.totals.setProperty("hint", True)
        top.addWidget(self.totals)
        self.export_btn = QPushButton("📤 تصدير")
        self.export_btn.setProperty("flat", True)
        self.export_btn.clicked.connect(self._export_excel)
        self.print_btn = QPushButton("🖨 طباعة")
        self.print_btn.setProperty("flat", True)
        self.print_btn.clicked.connect(self._print_pdf)
        size_buttons([self.export_btn, self.print_btn],
                     min_w=130, uniform=False)
        top.addWidget(self.export_btn)
        top.addWidget(self.print_btn)
        root.addLayout(top)

        bar = QHBoxLayout()
        self.dir_tabs = SegmentedTabs()
        self.dir_tabs.addItem("📤 مطالبتنا على العملاء", cl.DIR_OUT)
        self.dir_tabs.addItem("📥 مطالبات المقاولين علينا", cl.DIR_IN)
        self.dir_tabs.currentIndexChanged.connect(
            lambda _i: self._rebuild_status())
        bar.addWidget(self.dir_tabs)
        self.status = SegmentedTabs()
        self.status.currentIndexChanged.connect(lambda _i: self._render())
        bar.addWidget(self.status)
        self.search = QLineEdit()
        self.search.setPlaceholderText("🔍 بحث برقم / عنوان / عقد / اسم...")
        self.search.setClearButtonEnabled(True)
        self.search.setMinimumWidth(220)
        self.search.textChanged.connect(lambda _t: self._render())
        bar.addWidget(self.search)
        bar.addStretch()
        root.addLayout(bar)

        self.table = _table(HEADS_OUT)
        self.table.cellDoubleClicked.connect(self._open_row)
        self.table.setContextMenuPolicy(Qt.CustomContextMenu)
        self.table.customContextMenuRequested.connect(self._ctx_menu)
        root.addWidget(self.table, 1)

        acts = QHBoxLayout()
        self.postpone_btn = QPushButton("⏳ إرجاء")
        self.postpone_btn.clicked.connect(self._postpone)
        self.cancel_btn = QPushButton("✕ إلغاء المطالبة")
        self.cancel_btn.setProperty("flat", True)
        self.cancel_btn.clicked.connect(self._cancel_claim)
        acts.addWidget(self.postpone_btn)
        acts.addWidget(self.cancel_btn)
        acts.addStretch()
        root.addLayout(acts)
        self._rebuild_status()

    # ---------- تحميل وعرض ----------
    def _direction(self) -> str:
        return self.dir_tabs.currentData() or cl.DIR_OUT

    def _rebuild_status(self):
        d = self._direction()
        keep = (self.status.currentData()
                if getattr(self, "_status_built", False) else "all")
        # إعادة بناء التابات (SegmentedTabs بلا مسح — نستبدل القطعة)
        parent = self.status.parentWidget()
        lay = parent.layout() if parent else None
        idx = lay.indexOf(self.status) if lay else -1
        self.status.setParent(None)
        self.status.deleteLater()
        self.status = SegmentedTabs()
        self.status.currentIndexChanged.connect(lambda _i: self._render())
        if lay is not None and idx >= 0:
            lay.insertWidget(idx, self.status)
        self.status.addItem("الكل", "all")
        for s in cl.NEXT[d]:
            self.status.addItem(cl.STATUS_LABEL[s], s)
        self.status.addItem("⚠ المتأخر", "overdue")
        self._status_built = True
        if self.status.findData(keep) >= 0:
            self.status.setCurrentData(keep)
        self.table.setHorizontalHeaderLabels(
            HEADS_OUT if d == cl.DIR_OUT else HEADS_IN)
        self.refresh()

    def refresh(self):
        try:
            self._rows = cl.list_claims(
                direction=self._direction(), search=self.search.text())
        except Exception:
            self._rows = []
        t = cl.totals(direction=self._direction())
        verb = "محصّل" if self._direction() == cl.DIR_OUT else "مدفوع"
        self.totals.setText(
            f"{t['count']} مطالبات · المفتوح {t['open_amount']:,.3f} · "
            f"{verb} {t['done_amount']:,.3f}")
        if t["overdue_count"]:
            self.overdue_lbl.setText(
                f"⚠ {t['overdue_count']} متأخرة · "
                f"{t['overdue_amount']:,.3f}")
        else:
            self.overdue_lbl.setText("")
        self._render()

    def _filtered(self) -> list[dict]:
        f = self.status.currentData() or "all"
        if f == "all":
            return self._rows
        if f == "overdue":
            return [r for r in self._rows if r["overdue"]]
        return [r for r in self._rows if r["status"] == f]

    def _render(self):
        shown = self._filtered()
        self._shown = shown
        d = self._direction()
        self.table.setRowCount(len(shown))
        for r, x in enumerate(shown):
            if d == cl.DIR_OUT:
                who = (f"{x.get('contract_number', '')} / "
                       f"{x.get('customer_name', '')}")
                line = x.get("cust_line_title") or "—"
            else:
                who = (f"{x.get('sub_name', '')} / "
                       f"{x.get('contract_number', '')}")
                line = x.get("sub_line_title") or "—"
            # تاريخ الاستحقاق أو الإرجاء
            due = (x.get("due_date") or "")[:10] or "—"
            if x["status"] == "postponed" and x.get("postponed_until"):
                due = f"⏳ {x['postponed_until'][:10]}"
            # حالة العرض
            display_status = cl.STATUS_DISPLAY.get(x["status"], x["status"])
            if x["overdue"] and x["status"] not in ("collected", "paid", "cancelled"):
                display_status = f"⚠️ متأخرة"
            vals = [f"{x.get('claim_number', '')} · "
                    f"{x.get('title', '')}", who, line,
                    f"{float(x.get('amount') or 0):,.3f}",
                    due,
                    display_status,
                    x.get("voucher_ref") or "—",
                    ((x.get("notes") or "").split("\n")[0])[:60]]
            _is_done = x["status"] in ("collected", "paid")
            _is_cancelled = x["status"] in ("refused", "cancelled")
            _is_postponed = x["status"] == "postponed"
            for c, v in enumerate(vals):
                from PySide6.QtWidgets import QTableWidgetItem
                cell = QTableWidgetItem(str(v))
                cell.setTextAlignment(Qt.AlignCenter)
                if _is_done:
                    cell.setBackground(QColor("#ECFDF5"))
                    cell.setForeground(QColor("#065F46"))
                elif _is_cancelled:
                    cell.setBackground(QColor("#FEF2F2"))
                    cell.setForeground(QColor("#991B1B"))
                elif _is_postponed:
                    cell.setBackground(QColor("#FFFBEB"))
                    cell.setForeground(QColor("#92400E"))
                elif x["overdue"]:
                    cell.setForeground(QColor(OVERDUE_RED))
                if c == 7 and x.get("notes"):
                    cell.setToolTip(str(x["notes"]))
                self.table.setItem(r, c, cell)
        apply_column_weights(self.table, [10, 22, 18, 10, 10, 14, 8, 8])

    def _selected(self) -> dict | None:
        r = self.table.currentRow()
        shown = getattr(self, "_shown", []) or []
        if 0 <= r < len(shown):
            return shown[r]
        return None

    def _ctx_menu(self, pos):
        from PySide6.QtWidgets import QMenu
        sel = self._selected()
        if not sel:
            return
        menu = QMenu(self)
        act_edit = menu.addAction("✏️ تعديل")
        menu.addSeparator()
        act_postpone = menu.addAction("⏳ إرجاء")
        act_cancel = menu.addAction("✕ إلغاء")
        chosen = menu.exec(self.table.viewport().mapToGlobal(pos))
        if not chosen:
            return
        if chosen == act_edit:
            self._open_row(self.table.currentRow(), 0)
        elif chosen == act_postpone:
            self._postpone()
        elif chosen == act_cancel:
            self._cancel_claim()

    # ---------- إجراءات ----------
    def _open_row(self, row: int, _col: int):
        shown = getattr(self, "_shown", []) or []
        if not (0 <= row < len(shown)):
            return
        full = cl.get_claim(shown[row]["id"]) or shown[row]
        if ClaimDialog(self, self._direction(), full).exec():
            self.refresh()

    def _postpone(self):
        """إرجاء المطالبة مع تاريخ يدوي."""
        sel = self._selected()
        if sel is None:
            style.error(self, "حدد مطالبة من الجدول أولًا.")
            return
        if sel["status"] in ("collected", "paid", "cancelled"):
            style.error(self, "المطالبة في حالة نهائية — لا يمكن إرجاؤها.")
            return
        # حوار الإرجاء
        dlg = QDialog(self)
        dlg.setWindowTitle("⏳ إرجاء المطالبة")
        dlg.setLayoutDirection(Qt.RightToLeft)
        dlg.setMinimumWidth(350)
        lay = QVBoxLayout(dlg)
        form = QFormLayout()
        lay.addLayout(form)
        form.addRow("المطالبة:", QLabel(sel.get("claim_number", "")))
        form.addRow("العنوان:", QLabel(sel.get("title", "")))
        postpone_date = QDateEdit()
        postpone_date.setCalendarPopup(True)
        postpone_date.setDisplayFormat("yyyy-MM-dd")
        postpone_date.setDate(QDate.currentDate().addDays(10))
        form.addRow("تاريخ الإرجاء:", postpone_date)
        reason = QLineEdit()
        reason.setPlaceholderText("سبب الإرجاء (مثال: العميل وعد بالدفع)")
        form.addRow("السبب:", reason)
        btns = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        btns.button(QDialogButtonBox.Ok).setText("⏳ إرجاء")
        btns.button(QDialogButtonBox.Cancel).setText("✕ إلغاء")
        btns.accepted.connect(dlg.accept)
        btns.rejected.connect(dlg.reject)
        lay.addWidget(btns)
        if not dlg.exec():
            return
        try:
            cl.set_status(int(sel["id"]), "postponed",
                          note=reason.text().strip(),
                          postponed_until=postpone_date.date().toString("yyyy-MM-dd"))
            # إنشاء مهمة تلقائية في شاشة المهام
            try:
                from services import task_service as _ts
                _due = postpone_date.date().toString("yyyy-MM-dd") + " 09:00"
                _amt = float(sel.get("amount") or 0)
                _dir = ("مطالبتنا على العميل" if sel.get("direction") == "out"
                        else "مطالبة المقاول علينا")
                _ts.add_task(
                    title=f"\u23f3 مطالبة مرجأة: {sel.get('claim_number', '') or sel.get('title', '')}",
                    due_at=_due,
                    details=f"{_dir}\nالعنوان: {sel.get('title', '')}\nالمبلغ: {_amt:,.3f} د.ك\nالسبب: {reason.text().strip()}",
                    source="إرجاء",
                    task_type="موعد",
                )
            except Exception as _task_err:
                import logging
                logging.getLogger("claims").warning("task create failed: %s", _task_err)
            style.toast(self, "تم إرجاء المطالبة + مهمة تلقائية في المهام")
            self.refresh()
        except (ValidationError, Exception) as exc:
            style.error(self, str(exc))

    def _cancel_claim(self):
        """إلغاء المطالبة."""
        sel = self._selected()
        if sel is None:
            style.error(self, "حدد مطالبة من الجدول أولًا.")
            return
        if sel["status"] in ("collected", "paid", "cancelled"):
            style.error(self, "المطالبة في حالة نهائية بالفعل.")
            return
        if not style.confirm(self, "هل تريد إلغاء هذه المطالبة؟"):
            return
        try:
            cl.set_status(int(sel["id"]), "cancelled")
            style.toast(self, "تم إلغاء المطالبة")
            self.refresh()
        except (ValidationError, Exception) as exc:
            style.error(self, str(exc))

    # ---------- تصدير وطباعة ----------
    def _sheet_data(self) -> dict:
        filt = self._filtered()
        d = self._direction()
        heads = HEADS_OUT if d == cl.DIR_OUT else HEADS_IN
        rows = []
        for x in filt:
            who = ((f"{x.get('contract_number', '')} / "
                    f"{x.get('customer_name', '')}")
                   if d == cl.DIR_OUT else
                   (f"{x.get('sub_name', '')} / "
                    f"{x.get('contract_number', '')}"))
            line = (x.get("cust_line_title") or x.get("sub_line_title")
                    or "—")
            rows.append([f"{x.get('claim_number', '')} · "
                         f"{x.get('title', '')}", who, line,
                         float(x.get("amount") or 0),
                         (x.get("due_date") or "")[:10] or "—",
                         ("متأخرة! " if x["overdue"] else "")
                         + (x.get("status_label") or ""),
                         x.get("voucher_ref") or "—",
                         ((x.get("notes") or "").split("\n")[0])[:80]])
        rows.append(["", "", "الإجمالي",
                     round(sum(float(x.get("amount") or 0)
                               for x in filt), 3),
                     "", "", "", ""])
        name = ("مطالبتنا على العملاء" if d == cl.DIR_OUT
                else "مطالبات المقاولين علينا")
        return {"name": name, "heads": heads, "rows": rows,
                "number_cols": [3]}

    def _export_excel(self):
        if not self._filtered():
            style.info(self, "لا توجد مطالبات للتصدير.")
            return
        sh = self._sheet_data()
        export_table_excel(self, sh["name"], sh["heads"], sh["rows"],
                           "claims", number_cols=sh["number_cols"])

    def _print_pdf(self):
        import os
        from PySide6.QtWidgets import QFileDialog
        if not self._filtered():
            style.info(self, "لا توجد بيانات للطباعة.")
            return
        sh = self._sheet_data()
        default = os.path.join(os.path.expanduser("~"), "claims.pdf")
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
