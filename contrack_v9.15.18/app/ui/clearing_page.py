# -*- coding: utf-8 -*-
"""لوحة مطابقة البنك اليومية + بنك غير مربوط."""
from PySide6.QtCore import QDate, Qt
from PySide6.QtWidgets import (QComboBox, QDateEdit, QDialog,
                               QDialogButtonBox, QFormLayout, QDoubleSpinBox,
                               QHBoxLayout, QInputDialog, QLabel, QLineEdit,
                               QMessageBox, QPushButton, QSpinBox,
                               QTableWidgetItem, QVBoxLayout, QWidget)

from services import settlement_service as st
from ui import style
from ui.archive import _fill, _table
from ui.widgets import (SegmentedTabs, apply_column_weights, export_table_excel,
                        more_menu_button, size_buttons)

STATUS_COLORS = {"done": "#16A34A", "pending": "#64748B",
                 "diff": "#D97706", "late": "#DC2626"}

HEADS = ["اليوم", "البوابة", "وارد السيستم", "وارد البوابة",
         "فرق التحصيل", "المتوقع بنكيًا", "تاريخ التسوية",
         "الوارد البنكي", "نصيبي", "نصيب الأخرى", "الحالة"]


class GatewayProfilesDialog(QDialog):
    """إعدادات البوابات: الحساب + التأخير + العمولة."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("إعدادات بوابات الدفع")
        self.setLayoutDirection(Qt.RightToLeft)
        self.resize(760, 380)
        root = QVBoxLayout(self)
        self.table = _table(["الاسم", "الحساب البنكي", "طرق الدفع",
                             "التأخير", "العمولة/عملية"])
        root.addWidget(self.table, 1)
        bar = QHBoxLayout()
        add_btn = QPushButton("＋ إضافة")
        add_btn.setObjectName("btnPrimary")
        add_btn.clicked.connect(lambda: self._edit(None))
        edit_btn = QPushButton("✎ تعديل")
        edit_btn.setProperty("flat", True)
        edit_btn.clicked.connect(self._on_edit)
        del_btn = QPushButton("🗑 حذف")
        del_btn.setProperty("flat", True)
        del_btn.clicked.connect(self._on_delete)
        size_buttons([add_btn, edit_btn, del_btn], min_w=110,
                     uniform=False)
        bar.addWidget(add_btn)
        bar.addWidget(edit_btn)
        bar.addWidget(del_btn)
        bar.addStretch()
        close_btn = QPushButton("✕ إغلاق")
        close_btn.clicked.connect(self.accept)
        bar.addWidget(close_btn)
        root.addLayout(bar)
        self._load()

    def _load(self):
        self._rows = st.list_profiles(active_only=False)
        _fill(self.table,
              [[p["name"], p["bank_account"] or "", p["methods"] or "",
                f"T+{p['lag_days']}", f"{float(p['fee_fixed']):,.3f}"]
               for p in self._rows])

    def _selected(self):
        r = self.table.currentRow()
        return self._rows[r] if 0 <= r < len(self._rows) else None

    def _on_edit(self):
        p = self._selected()
        if not p:
            style.info(self, "اختر بوابة أولًا.")
            return
        self._edit(p)

    def _on_delete(self):
        p = self._selected()
        if not p:
            style.info(self, "اختر بوابة أولًا.")
            return
        if style.confirm(self, f"حذف البوابة «{p['name']}»؟"):
            st.delete_profile(p["id"])
            self._load()

    def _edit(self, p: dict | None):
        dlg = QDialog(self)
        dlg.setWindowTitle("بيانات البوابة")
        dlg.setLayoutDirection(Qt.RightToLeft)
        form = QFormLayout(dlg)
        name = QLineEdit((p or {}).get("name", ""))
        bank = QLineEdit((p or {}).get("bank_account", ""))
        bank.setPlaceholderText("رقم/اسم الحساب في كشف البنك (اختياري)")
        methods = QLineEdit((p or {}).get("methods", "KNET"))
        methods.setPlaceholderText("كلمات طريقة الدفع مفصولة بفاصلة: KNET,رابط")
        methods.setToolTip("سندات السيستم التي تحتوي طريقتها إحدى هذه الكلمات تُحسب وارد هذه البوابة")
        lag = QSpinBox()
        lag.setRange(0, 10)
        lag.setValue(int((p or {}).get("lag_days", 1)))
        lag.setSuffix(" يوم عمل (T+N)")
        fee = QDoubleSpinBox()
        fee.setRange(0, 1000)
        fee.setDecimals(3)
        fee.setValue(float((p or {}).get("fee_fixed", 0)))
        fee.setSuffix(" للعملية")
        form.addRow("الاسم", name)
        form.addRow("الحساب البنكي", bank)
        form.addRow("طرق الدفع", methods)
        form.addRow("التأخير", lag)
        form.addRow("العمولة", fee)
        bb = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        bb.button(QDialogButtonBox.Ok).setText("حفظ")
        bb.button(QDialogButtonBox.Cancel).setText("إلغاء")
        bb.accepted.connect(dlg.accept)
        bb.rejected.connect(dlg.reject)
        form.addRow(bb)
        if dlg.exec() == QDialog.Accepted:
            st.save_profile((p or {}).get("id"), name.text(),
                            bank.text(), methods.text(), lag.value(),
                            fee.value())
            self._load()


class DayDetailDialog(QDialog):
    """تفاصيل يوم: عمليات البوابة + سندات السيستم."""

    def __init__(self, parent, gateway: str, day: str, row: dict):
        super().__init__(parent)
        self.setWindowTitle(f"تفاصيل {day} · {gateway}")
        self.setLayoutDirection(Qt.RightToLeft)
        self.resize(860, 520)
        root = QVBoxLayout(self)
        info = (f"وارد السيستم {row['sys']:,.3f} · وارد البوابة "
                f"{row['g_mine']:,.3f} · المتوقع بنكيًا "
                f"{row['expect']:,.3f} بتاريخ {row['settle_date'] or '—'} · "
                f"الوارد البنكي {row['bank_amount']:,.3f} "
                f"{row['bank_date'] or ''} {row['bank_descr'] or ''}".strip())
        lbl = QLabel(info)
        lbl.setWordWrap(True)
        root.addWidget(lbl)
        d = st.day_detail(gateway, day)
        root.addWidget(QLabel("عمليات البوابة:"))
        t1 = _table(["الهاتف", "المبلغ", "المرجع", "الحالة",
                     "سندنا", "العميل"])
        _fill(t1, [[o["phone"], f"{o['amount']:,.3f}", o["ref"],
                    {"mine": "✅ شركتنا", "diff": "⚪ غير مصنّف",
                     "other": "🏢 أخرى",
                     "unmarked": "⚪ غير مصنّف"}.get(
                         o["status"], o["status"]),
                    o["receipt_no"], o["customer"]] for o in d["ops"]],
              money_cols=(1,))
        root.addWidget(t1, 1)
        root.addWidget(QLabel("سندات السيستم:"))
        t2 = _table(["السند", "التاريخ", "الطريقة", "المبلغ", "البيان"])
        _fill(t2, [[v["voucher_number"], v["vdate"], v["method"],
                    f"{v['amount']:,.3f}", v["description"] or ""]
                   for v in d["vouchers"]], money_cols=(3,))
        root.addWidget(t2, 1)
        bb = QDialogButtonBox(QDialogButtonBox.Close)
        bb.button(QDialogButtonBox.Close).setText("إغلاق")
        bb.rejected.connect(self.reject)
        root.addWidget(bb)


class TransferDialog(QDialog):
    """V4.7/V4.8: تسديد للشركة الأخرى — ربط بعمليات + سند صرف اختياري."""

    def __init__(self, parent=None, amount_preset: float = 0.0,
                 op_ids: list | None = None):
        super().__init__(parent)
        self.setWindowTitle("💸 تسديد للشركة الأخرى")
        self.setLayoutDirection(Qt.RightToLeft)
        self.resize(420, 340)
        self._op_ids = [int(x) for x in (op_ids or [])]
        self._bal = st.other_balance()
        root = QVBoxLayout(self)
        info = QLabel(
            f"المستحق: {self._bal['dues']:,.3f} · "
            f"المسدد: {self._bal['paid']:,.3f} · "
            f"المتبقي: {self._bal['remaining']:,.3f} د.ك")
        info.setWordWrap(True)
        root.addWidget(info)
        if self._op_ids:
            link = QLabel(f"🔗 مرتبط بـ {len(self._op_ids)} عملية من المطابقة"
                          f" — ستُعلَّم «مسدد» وتُتجاهل عند إعادة الرفع.")
            link.setWordWrap(True)
            root.addWidget(link)
            try:
                _bd = st.linked_ops_breakdown(self._op_ids)
            except Exception:
                _bd = {}
            if _bd.get("n"):
                breakdown = QLabel(
                    f"📄 إجمالي الملف: {_bd['gross']:,.3f} · العمولة: "
                    f"{_bd['fee']:,.3f} · الصافي المستحق: "
                    f"{_bd['net']:,.3f} د.ك")
                breakdown.setWordWrap(True)
                breakdown.setStyleSheet("font-weight: 800;")
                root.addWidget(breakdown)
        form = QFormLayout()
        self.tdate = QDateEdit(QDate.currentDate())
        self.tdate.setCalendarPopup(True)
        self.tdate.setDisplayFormat("yyyy-MM-dd")
        form.addRow("التاريخ:", self.tdate)
        self.amount = QDoubleSpinBox()
        self.amount.setRange(0, 10000000)
        self.amount.setDecimals(3)
        if amount_preset > 0:
            self.amount.setValue(amount_preset)
        form.addRow("المبلغ:", self.amount)
        if self._op_ids:
            lock = QLabel(f"المحدد: {len(self._op_ids)} عملية — سدّد الكل "
                          f"أو جزءًا (المبلغ ≤ المجموع).")
            lock.setWordWrap(True)
            lock.setProperty("hint", True)
            root.addWidget(lock)
        else:
            info2 = QLabel("دفعة على الحساب (غير مربوطة ببنود).")
            info2.setProperty("hint", True)
            root.addWidget(info2)
        self.method = QComboBox()
        try:
            from services import settings_service as _ss
            methods = [m["name"] for m in _ss.list_payment_methods()]
        except Exception:
            methods = []
        for m in methods or ["تحويل بنكي", "نقدي", "شيك", "أخرى"]:
            self.method.addItem(m)
        form.addRow("الطريقة:", self.method)
        self.ref = QLineEdit()
        self.ref.setPlaceholderText("رقم الحوالة / المرجع")
        form.addRow("المرجع:", self.ref)
        self.notes = QLineEdit()
        form.addRow("ملاحظات:", self.notes)
        root.addLayout(form)
        # V4.5.13: أُلغيت «إنشاء سند صرف تلقائي» — التسديد بين الشركتين
        # تسوية حسابية لا إيراد ولا مصروف. وبقي مؤشر تلقائي يوضح الفارق بين
        # الدفع والمستحق (الفارق يمثل عمولة البوابة — أو «لا عمولة»).
        self.diff_hint = QLabel("")
        self.diff_hint.setWordWrap(True)
        self.diff_hint.setStyleSheet("font-weight: 800;")
        root.addWidget(self.diff_hint)
        self.after = QLabel("")
        root.addWidget(self.after)
        self.amount.valueChanged.connect(lambda _v: self._preview())
        bb = QDialogButtonBox(QDialogButtonBox.Save |
                              QDialogButtonBox.Cancel)
        bb.button(QDialogButtonBox.Save).setText("💾 حفظ")
        bb.button(QDialogButtonBox.Cancel).setText("إلغاء")
        bb.accepted.connect(self._save)
        bb.rejected.connect(self.reject)
        root.addWidget(bb)
        self._preview()

    def _preview(self):
        after = round(self._bal["remaining"] - self.amount.value(), 3)
        color = "#991B1B" if after < -0.001 else "#166534"
        warn = " ⚠️ يتجاوز المتبقي!" if after < -0.001 else ""
        self.after.setText(
            f"المتبقي بعد الحفظ: {after:,.3f} د.ك{warn}")
        self.after.setStyleSheet(f"color: {color}; font-weight: bold;")
        self._update_diff_hint()

    def _update_diff_hint(self):
        """V4.5.13: هل في عمولة أم لا — بمقارنة الدفع بالمستحق الصافي.

        المستحق للمحدد = الصافي (الإجمالي − عمولة البوابة). إن دفع المستخدم
        المبلغ كاملًا ظهر الفارق تلقائيًا = عمولة البوابة.
        """
        if not self._op_ids:
            self.diff_hint.setText("")
            self.diff_hint.setVisible(False)
            return
        try:
            _bd = st.linked_ops_breakdown(self._op_ids)
        except Exception:
            _bd = {}
        _gross = float(_bd.get("gross") or 0)
        _fee = float(_bd.get("fee") or 0)
        _net = float(_bd.get("net") or 0)
        _paid = round(float(self.amount.value() or 0), 3)
        _diff = round(_paid - _net, 3)
        _head = (f"الكامل: {_gross:,.3f} · العمولة: {_fee:,.3f} · "
                 f"المستحق (الصافي): {_net:,.3f} · المدفوع: {_paid:,.3f}")
        if _diff > 0.0005:
            txt = (f"{_head}\n⚠️ فارق: {_diff:,.3f} د.ك — يمثل عمولة "
                   f"البوابة (دفعت فوق المستحق الصافي).")
            col = "#B45309"
        elif _diff < -0.0005:
            txt = (f"{_head}\n🟡 متبقٍ من المستحق: {-_diff:,.3f} د.ك.")
            col = "#1D4ED8"
        else:
            txt = f"{_head}\n✅ لا فارق — بلا عمولة."
            col = "#166534"
        self.diff_hint.setText(txt)
        self.diff_hint.setStyleSheet(f"font-weight: 800; color: {col};")
        self.diff_hint.setVisible(True)

    def _save(self):
        try:
            # V4.5.13: بلا سند صرف — التسديد للأخرى تسوية حسابية فقط
            tid = st.add_other_transfer(
                self.tdate.date().toString("yyyy-MM-dd"),
                self.amount.value(), self.ref.text(), self.notes.text(),
                self.method.currentText(), self._op_ids)
        except ValueError as exc:
            style.error(self, str(exc))
            return
        new = st.other_balance()
        extra = ""
        # V4.5.13: بلا سندات — تُعرض فروقات العمولة (مدفوع فوق المستحق) فقط
        if new["remaining"] < -0.001:
            extra = (f"\n⚠️ فروقات عمولة (مدفوع فوق المستحق): "
                     f"{-new['remaining']:,.3f} د.ك")
        style.success(
            self, "سُجّل التسديد ✅" + extra + "\n"
            f"المتبقي الآن للأخرى: {new['remaining']:,.3f} د.ك")
        self.accept()


class ClearingPage(QWidget):
    """لوحة التصفية اليومية + البنك بلا ربط."""

    def __init__(self, parent=None, embedded: bool = False):
        super().__init__(parent)
        self.setLayoutDirection(Qt.RightToLeft)
        self._rows: list[dict] = []
        root = QVBoxLayout(self)
        root.setContentsMargins(12, 8, 12, 8)
        root.setSpacing(8)

        top = QHBoxLayout()
        title = QLabel("⚖️ تصفية بوابات الدفع مع البنك")
        title.setProperty("pageTitle", True)
        top.addWidget(title)
        if embedded:
            title.setVisible(False)
        top.addStretch()
        self.import_btn = QPushButton("📥 استيراد كشف بنك")
        self.import_btn.setObjectName("btnPrimary")
        self.import_btn.clicked.connect(self._import_bank)
        self.more_btn = more_menu_button(
            self, [("⚙ البوابات", self._open_profiles),
                   ("📤 تصدير", self._export)])
        size_buttons([self.import_btn, self.more_btn],
                     min_w=130, uniform=False)
        top.addWidget(self.import_btn)
        top.addWidget(self.more_btn)
        root.addLayout(top)

        bar = QHBoxLayout()
        bar.addWidget(QLabel("من:"))
        self.d1 = QDateEdit(QDate.currentDate().addMonths(-1))
        self.d1.setCalendarPopup(True)
        self.d1.setDisplayFormat("yyyy-MM-dd")
        bar.addWidget(self.d1)
        bar.addWidget(QLabel("إلى:"))
        self.d2 = QDateEdit(QDate.currentDate())
        self.d2.setCalendarPopup(True)
        self.d2.setDisplayFormat("yyyy-MM-dd")
        bar.addWidget(self.d2)
        bar.addWidget(QLabel("البوابة:"))
        self.gw_combo = QComboBox()
        self.gw_combo.setMinimumWidth(170)
        bar.addWidget(self.gw_combo)
        bar.addStretch()
        root.addLayout(bar)
        self.d1.dateChanged.connect(lambda _d: self.refresh())
        self.d2.dateChanged.connect(lambda _d: self.refresh())
        self.gw_combo.currentIndexChanged.connect(lambda _i: self.refresh())

        nav = QHBoxLayout()
        nav.addWidget(QLabel("العرض:"))
        self.views = SegmentedTabs()
        self.views.addItem("التصفية اليومية", "daily")
        self.views.addItem("بنك غير مربوط", "bank")
        self.views.currentIndexChanged.connect(lambda _i: self.refresh())
        nav.addWidget(self.views)
        nav.addStretch()
        nav.addWidget(QLabel("الحالة:"))
        self.status = SegmentedTabs()
        self.status.addItem("الكل", "all")
        self.status.addItem("✅ مكتمل", "done")
        self.status.addItem("⏳ منتظر", "pending")
        self.status.addItem("⚠️ فرق", "diff")
        self.status.addItem("❌ متأخر", "late")
        self.status.currentIndexChanged.connect(lambda _i: self._render())
        nav.addWidget(self.status)
        root.addLayout(nav)

        self.table = _table(HEADS)
        self.table.cellDoubleClicked.connect(self._open_detail)
        root.addWidget(self.table, 1)
        self._reload_gateways()
        self.refresh()

    def _reload_gateways(self):
        cur = self.gw_combo.currentData()
        self.gw_combo.blockSignals(True)
        self.gw_combo.clear()
        self.gw_combo.addItem("الكل", "")
        for p in st.list_profiles():
            self.gw_combo.addItem(p["name"], p["name"])
        if cur:
            i = self.gw_combo.findData(cur)
            self.gw_combo.setCurrentIndex(i if i >= 0 else 0)
        self.gw_combo.blockSignals(False)

    def _dates(self):
        return (self.d1.date().toString("yyyy-MM-dd"),
                self.d2.date().toString("yyyy-MM-dd"))

    def refresh(self):
        d1, d2 = self._dates()
        gw = self.gw_combo.currentData() or ""
        view = self.views.currentData()
        if view == "bank":
            self._rows = st.unmatched_bank(d1, d2, gw)
        else:
            self._rows = st.daily_clearing(d1, d2, gw)
        self._render()

    def _render(self):
        view = self.views.currentData()
        if view == "bank":
            self._render_bank()
        else:
            self._render_daily()
        self.status.setVisible(view == "daily")

    def _render_daily(self):
        mode = self.status.currentData()
        rows = [r for r in self._rows
                if mode == "all" or r["status"] == mode]
        self.table.setColumnCount(len(HEADS))
        self.table.setHorizontalHeaderLabels(HEADS)
        data, colors = [], {}
        for r in rows:
            data.append([r["day"], r["gateway"], f"{r['sys']:,.3f}",
                         f"{r['g_mine']:,.3f}", f"{r['gap']:,.3f}",
                         f"{r['expect']:,.3f}", r["settle_date"] or "",
                         f"{r['bank_amount']:,.3f}" if r["bank_amount"] else "",
                         f"{r['my_share']:,.3f}",
                         f"{r['other_share']:,.3f}",
                         st.STATUS_LABEL.get(r["status"], r["status"])])
            colors[(len(data) - 1, 10)] = STATUS_COLORS.get(
                r["status"], style.TEXT)
            if abs(r["gap"]) > 0.005:
                colors[(len(data) - 1, 4)] = "#D97706"
        _fill(self.table, data, colors=colors, money_cols=(2, 3, 4, 5, 7, 8, 9))
        apply_column_weights(self.table, [12, 12, 11, 11, 10, 11, 11, 11,
                                          11, 11, 14])
        self._daily = rows

    def _render_bank(self):
        heads = ["التاريخ", "المبلغ", "البيان"]
        self.table.setColumnCount(len(heads))
        self.table.setHorizontalHeaderLabels(heads)
        _fill(self.table, [[b["cdate"], f"{float(b['amount']):,.3f}",
                            b["descr"] or ""] for b in self._rows],
              money_cols=(1,))
        apply_column_weights(self.table, [25, 25, 80])
    def _open_detail(self, row: int, _col: int):
        if self.views.currentData() != "daily":
            return
        rows = getattr(self, "_daily", [])
        if not (0 <= row < len(rows)):
            return
        r = rows[row]
        DayDetailDialog(self, r["gateway"], r["day"], r).exec()

    def _open_profiles(self):
        GatewayProfilesDialog(self).exec()
        self._reload_gateways()
        self.refresh()

    def _import_bank(self):
        from PySide6.QtWidgets import QFileDialog
        path, _ = QFileDialog.getOpenFileName(
            self, "استيراد كشف البنك", "", "Excel/CSV (*.xlsx *.csv)")
        if not path:
            return
        try:
            lines = st.read_bank_file(path)
        except Exception as exc:
            style.error(self, f"تعذر قراءة الملف:\n{exc}")
            return
        if not lines:
            style.info(self, "لا توجد إيداعات في الملف.")
            return
        import os as _os
        batch = f"{_os.path.basename(path)}"
        n = st.save_bank_lines("", lines, batch)
        QMessageBox.information(
            self, "تم",
            f"قُرئ {len(lines)} إيداعًا · أُضيف {n} جديدًا "
            f"({len(lines) - n} مكررًا).")
        self.refresh()

    def import_bank_file(self, path: str,
                         bank_account: str = "") -> tuple[int, int]:
        """استيراد مباشر (للفحص الآلي) ← (المقروء، الجديد)."""
        lines = st.read_bank_file(path)
        import os as _os
        n = st.save_bank_lines(bank_account, lines,
                               _os.path.basename(path))
        self.refresh()
        return len(lines), n

    def _export(self):
        view = self.views.currentData()
        if view == "daily":
            mode = self.status.currentData()
            rows = [r for r in self._rows
                    if mode == "all" or r["status"] == mode]
            data = [[r["day"], r["gateway"], r["sys"], r["g_mine"],
                     r["gap"], r["expect"], r["settle_date"],
                     r["bank_amount"] or "", r["my_share"],
                     r["other_share"],
                     st.STATUS_LABEL.get(r["status"], r["status"])]
                    for r in rows]
            export_table_excel(self, "تصفية بوابات الدفع اليومية", HEADS,
                               data, "daily_clearing",
                               number_cols=[2, 3, 4, 5, 7, 8, 9])
        else:
            data = [[b["cdate"], float(b["amount"]), b["descr"] or ""]
                    for b in self._rows]
            export_table_excel(self, "حركات بنكية غير مربوطة",
                               ["التاريخ", "المبلغ", "البيان"], data,
                               "unmatched_bank", number_cols=[1])
