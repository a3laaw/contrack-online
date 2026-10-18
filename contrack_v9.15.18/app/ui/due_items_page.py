# -*- coding: utf-8 -*-
"""V4.20: شاشة التسديد — المستحق (غير المسدد) + المسدد (عملية-عملية)."""
from PySide6.QtCore import Qt
from PySide6.QtWidgets import (QAbstractItemView, QComboBox, QHBoxLayout,
                               QLabel, QLineEdit, QPushButton, QVBoxLayout,
                               QWidget)

from services import settlement_service as st
from ui import style
from ui.archive import _fill, _table
from ui.clearing_page import TransferDialog
from ui.widgets import (SegmentedTabs, apply_column_weights, size_buttons)

HEADS = ["✓", "التاريخ", "البوابة", "العميل", "الهاتف", "الصافي",
         "المتبقي", "المدفوع", "التحصيل", "إجمالي الملف"]
PAID_HEADS = ["التاريخ", "العميل", "الهاتف", "البوابة", "الصافي",
              "المدفوع", "التسديد", "تاريخ التسديد"]


def _collection_cell(r: dict) -> str:
    """V4.41: التحصيل محسوب من تاريخ العملية (ثاني يوم · نهاية
    الأسبوع ← الأحد) · المخزَّن المحصَّل يُعرض بتاريخه."""
    try:
        done, exp = st.collection_status(
            r.get("date") or "", None, r.get("gw_paid"),
            r.get("gw_paid_date") or "")
    except Exception:
        return "—"
    if done:
        return "✅ " + exp
    return "⏳ غير محصَّل"


def _collection_done(r: dict) -> bool:
    try:
        return st.collection_status(
            r.get("date") or "", None, r.get("gw_paid"),
            r.get("gw_paid_date") or "")[0]
    except Exception:
        return False


class DueItemsPage(QWidget):
    """بنود مستحقة للدفع: تعليم ✓ ثم تسديد المحدد بمبلغ مقفول."""

    def __init__(self, parent=None, embedded: bool = False,
                 pay_external: bool = False,
                 on_export=None):
        """pay_external: الدفع من زر خارجي (مضمّنة في حساب الأخرى).
        on_export: رد التصدير (زر 📤 يظهر عند توفره)."""
        super().__init__(parent)
        self.setLayoutDirection(Qt.RightToLeft)
        self._pay_external = pay_external
        self._on_export = on_export
        self._items: list[dict] = []
        self._paid: list[dict] = []
        self._fee_map: dict = {}
        root = QVBoxLayout(self)
        root.setContentsMargins(12, 8, 12, 8)
        root.setSpacing(8)

        top = QHBoxLayout()
        title = QLabel("💸 التسديد — الشركة الأخرى")
        title.setProperty("pageTitle", True)
        top.addWidget(title)
        if embedded:
            title.setVisible(False)
        top.addStretch()
        self.totals = QLabel("")
        self.totals.setProperty("hint", True)
        top.addWidget(self.totals)
        root.addLayout(top)

        hint = QLabel("📌 المستحق: علّم بنودًا ثم «تسديد المحدد» — "
                      "المكتمل يغادر تلقائيًا · ✅ المسدد: سجل المدفوع")
        hint.setProperty("hint", True)
        hint.setWordWrap(True)
        root.addWidget(hint)

        bar = QHBoxLayout()
        self.view = SegmentedTabs()
        self.view.addItem("📌 المستحق", "due")
        self.view.addItem("✅ المسدد", "paid")
        self.view.currentIndexChanged.connect(lambda _i: self._render())
        bar.addWidget(self.view)
        bar.addWidget(QLabel("البوابة:"))
        self.gw_combo = QComboBox()
        self.gw_combo.setMinimumWidth(150)
        self.gw_combo.currentIndexChanged.connect(lambda _i: self._render())
        bar.addWidget(self.gw_combo)
        self.search = QLineEdit()
        self.search.setPlaceholderText("بحث بعميل / هاتف...")
        self.search.setClearButtonEnabled(True)
        self.search.setMinimumWidth(220)
        self.search.textChanged.connect(lambda _t: self._render())
        bar.addWidget(self.search)
        self._gw2_lbl = QLabel("التحصيل:")
        bar.addWidget(self._gw2_lbl)
        self.gw_combo2 = QComboBox()
        self.gw_combo2.addItem("الكل", None)
        self.gw_combo2.addItem("✅ محصَّل", 1)
        self.gw_combo2.addItem("⏳ غير محصَّل", 0)
        self.gw_combo2.setMinimumWidth(120)
        self.gw_combo2.currentIndexChanged.connect(
            lambda _i: self._render())
        bar.addWidget(self.gw_combo2)
        bar.addStretch()
        root.addLayout(bar)

        self.table = _table(HEADS)
        self.table.setSelectionMode(QAbstractItemView.ExtendedSelection)
        self.table.itemChanged.connect(
            lambda _i: self._update_total())
        root.addWidget(self.table, 1)

        brow = QHBoxLayout()
        self.all_btn = QPushButton("تحديد الكل")
        self.all_btn.setProperty("flat", True)
        self.all_btn.clicked.connect(self._select_all)
        self.none_btn = QPushButton("✕ إلغاء التحديد")
        self.none_btn.setProperty("flat", True)
        self.none_btn.clicked.connect(self._select_none)
        size_buttons([self.all_btn, self.none_btn], min_w=110,
                     uniform=False)
        brow.addWidget(self.all_btn)
        brow.addWidget(self.none_btn)
        self.checked_lbl = QLabel("")
        self.checked_lbl.setProperty("hint", True)
        brow.addWidget(self.checked_lbl)
        brow.addStretch()
        self.pay_btn = QPushButton("＋ تسديد المحدد")
        self.pay_btn.setObjectName("btnPrimary")
        self.pay_btn.clicked.connect(self._pay_selected)
        self.pay_btn.setVisible(False)
        self.export_btn = QPushButton("📤 تصدير")
        self.export_btn.setProperty("flat", True)
        self.export_btn.clicked.connect(self._do_export)
        self.export_btn.setVisible(False)
        brow.addWidget(self.export_btn)
        brow.addWidget(self.pay_btn)
        root.addLayout(brow)
        self.refresh()

    def _reload_gateways(self):
        cur = self.gw_combo.currentData()
        self.gw_combo.blockSignals(True)
        self.gw_combo.clear()
        self.gw_combo.addItem("الكل", "")
        try:
            profiles = st.list_profiles()
        except Exception:
            profiles = []
        for p in profiles:
            self.gw_combo.addItem(p["name"], p["name"])
        if cur:
            i = self.gw_combo.findData(cur)
            self.gw_combo.setCurrentIndex(i if i >= 0 else 0)
        self.gw_combo.blockSignals(False)

    def refresh(self):
        self._reload_gateways()
        try:
            self._fee_map = st.gateway_fee_map()
        except Exception:
            self._fee_map = {}
        try:
            self._items = st.unpaid_other_items()
        except Exception:
            self._items = []
        try:
            self._paid = st.paid_other_items()
        except Exception:
            self._paid = []
        self._render()

    def _do_export(self):
        """تصدير التبويب الحالي عبر رد الأب."""
        if callable(self._on_export):
            self._on_export()

    def _filtered(self) -> list[dict]:
        gw = self.gw_combo.currentData() or ""
        q = (self.search.text() or "").strip()
        gf = self.gw_combo2.currentData()
        out = []
        for r in self._items:
            if gw and r["gateway"] != gw:
                continue
            if gf == 1 and not _collection_done(r):
                continue
            if gf == 0 and _collection_done(r):
                continue
            if q and q not in " ".join(str(r.get(k) or "") for k in
                                       ("customer", "phone", "ref",
                                        "date")):
                continue
            out.append(r)
        return out

    def _filtered_paid(self) -> list[dict]:
        gw = self.gw_combo.currentData() or ""
        q = (self.search.text() or "").strip()
        out = []
        for r in self._paid:
            if gw and r["gateway"] != gw:
                continue
            if q and q not in " ".join(str(r.get(k) or "") for k in
                                       ("customer", "phone", "ref",
                                        "date", "tdate")):
                continue
            out.append(r)
        return out

    def _render(self):
        paid = self.view.currentData() == "paid"
        self.gw_combo2.setVisible(not paid)
        self._gw2_lbl.setVisible(not paid)
        self.all_btn.setVisible(not paid)
        self.none_btn.setVisible(not paid)
        self.export_btn.setVisible(callable(self._on_export))
        if paid:
            self._render_paid()
        else:
            self._render_due()
        self._update_total()

    def _render_due(self):
        self.table.blockSignals(True)
        self.table.setColumnCount(len(HEADS))
        self.table.setHorizontalHeaderLabels(HEADS)
        filt = self._filtered()
        rows = []
        for r in filt:
            _net = round(float(r.get("total") or 0), 3)
            _gross = round(float(r.get("gross", r.get("total")) or 0), 3)
            rows.append(["", r["date"], r["gateway"],
                         r["customer"] or "—", r["phone"],
                         f"{_net:,.3f}", f"{r['amount']:,.3f}",
                         f"{r['paid']:,.3f}" if r.get("paid") else "—",
                         _collection_cell(r), f"{_gross:,.3f}"])
        _fill(self.table, rows, money_cols=(5, 6, 7, 9))
        for i in range(self.table.rowCount()):
            it = self.table.item(i, 0)
            if it is not None:
                it.setFlags(it.flags() | Qt.ItemIsUserCheckable)
                it.setCheckState(Qt.Unchecked)
        for i, r in enumerate(filt):
            _cc = self.table.item(i, 8)
            if _cc is not None:
                _cc.setToolTip(
                    "التحصيل المتوقع: تاريخ العملية + يوم · "
                    "خميس/جمعة/سبت ← الأحد التالي")
            if r.get("gw_token"):
                _ph = self.table.item(i, 4)
                if _ph is not None:
                    _ph.setToolTip("توكن Hesabe: " + r["gw_token"])
        self.table.blockSignals(False)
        apply_column_weights(
            self.table, [4, 10, 10, 17, 11, 10, 10, 9, 11, 8])
        self._shown = filt
        total = round(sum(r["amount"] for r in filt), 3)
        self.totals.setText(f"{len(filt)} بند · {total:,.3f} د.ك")

    def _render_paid(self):
        self.table.blockSignals(True)
        self.table.setColumnCount(len(PAID_HEADS))
        self.table.setHorizontalHeaderLabels(PAID_HEADS)
        filt = self._filtered_paid()
        _fill(self.table,
              [[r["date"], r["customer"] or "—", r["phone"],
                r["gateway"], f"{r['net']:,.3f}",
                f"{r['paid']:,.3f}",
                f"ت{r['transfer_id']}" if r["transfer_id"] else "—",
                r["tdate"] or "—"]
               for r in filt], money_cols=(4, 5))
        for i, r in enumerate(filt):
            if r.get("transfer_id"):
                _tr = self.table.item(i, 6)
                if _tr is not None:
                    _tr.setToolTip(
                        f"تسديد رقم {r['transfer_id']} بتاريخ "
                        f"{r['tdate'] or '—'}")
        self.table.blockSignals(False)
        apply_column_weights(
            self.table, [10, 20, 13, 12, 11, 11, 11, 12])
        self._shown = []
        total = round(sum(r["paid"] for r in filt), 3)
        self.totals.setText(f"{len(filt)} بند · {total:,.3f} د.ك")

    def _checked_ops(self) -> list[dict]:
        shown = getattr(self, "_shown", []) or []
        out = []
        for j in range(len(shown)):
            it = self.table.item(j, 0)
            if it is not None and it.checkState() == Qt.Checked:
                out.append(shown[j])
        return out

    def _update_total(self):
        ops = self._checked_ops()
        total = round(sum(r["amount"] for r in ops), 3)
        self.checked_lbl.setText(
            f"المحدد: {len(ops)} بند · {total:,.3f} د.ك"
            if ops else "")
        self.pay_btn.setVisible(bool(ops) and not self._pay_external)
        if ops:
            self.pay_btn.setText(f"＋ تسديد المحدد ({total:,.3f})")

    def _select_all(self):
        if self.view.currentData() == "paid":
            return
        self.table.blockSignals(True)
        for j in range(self.table.rowCount()):
            it = self.table.item(j, 0)
            if it is not None:
                it.setCheckState(Qt.Checked)
        self.table.blockSignals(False)
        self._update_total()

    def _select_none(self):
        if self.view.currentData() == "paid":
            return
        self.table.blockSignals(True)
        for j in range(self.table.rowCount()):
            it = self.table.item(j, 0)
            if it is not None:
                it.setCheckState(Qt.Unchecked)
        self.table.blockSignals(False)
        self._update_total()

    def _pay_selected(self):
        """تسديد المعلَّم — كامل المتبقي أو جزء منه."""
        ops = self._checked_ops()
        if not ops:
            style.info(self, "علّم ✓ على بنود أولًا.")
            return
        ids = [int(r["id"]) for r in ops if r.get("id")]
        if not ids:
            style.error(self, "البنود المعلَّمة لم تعد متاحة — حدّث العرض.")
            return
        total = round(sum(r["amount"] for r in ops), 3)
        if TransferDialog(self, amount_preset=total,
                          op_ids=ids).exec():
            self.refresh()
