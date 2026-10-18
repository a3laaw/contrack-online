# -*- coding: utf-8 -*-
"""V4.5.06: محرر دفعات عقد الباطن المشترك.

نفس الوظائف تُستخدم من مكانين:
  • التاب الموحد في مركز العقد (أزرار سياقية فوق الجدول).
  • خطوة الدفعات داخل حوار إنشاء عقد المقاول.

القواعد المالية مصدرها خدمات lifecycle فقط — لا منطق جديد هنا:
  • كل سطر دفعة يُربط بدفعة من دفعات عقد العميل (V6.1: إلزامي — 1:1).
  • التوزيع يستخدم lc.distribute_sub_plan كما هو.
"""
from PySide6.QtCore import QDate, Qt
from PySide6.QtWidgets import (
    QDateEdit, QDialog, QFormLayout, QHBoxLayout, QLabel, QLineEdit,
    QPushButton, QVBoxLayout,
)

from services.db_facade_service import DatabaseError
from services import lifecycle_service as lc
from services.customer_service import ValidationError
from ui import style
from ui.widgets import SearchableComboBox, SafeDoubleSpinBox


class SubPlanLineDialog(QDialog):
    """V6.1: دفعة مقاول مربوطة بدفعة عميل — عقد العميل هو الأساس.

    • «دفعة العميل» إلزامية، والربط يتم تلقائيًا (1:1) — بلا زر مصادر.
    • «الاستحقاق» يُقرأ من دفعة العميل: مقفول، لا كتابة يدوية.
    • «المرحلة» تأتي من دفعة العميل نفسها.
    """

    def __init__(self, parent, contract_id, line=None, sources=None,
                 title: str = "دفعة مقاول"):
        super().__init__(parent)
        self.setWindowTitle(title)
        self.setLayoutDirection(Qt.RightToLeft)
        self.setMinimumWidth(470)
        self._contract_id = int(contract_id) if contract_id else None
        self._stages = self._load_stages(self._contract_id)
        self._lines = self._load_client_lines(self._contract_id)
        self._sources = [int(x) for x in (sources or [])]

        form = QFormLayout(self)
        form.setSpacing(9)
        self.title = QLineEdit()
        self.title.setPlaceholderText("عنوان الدفعة")
        form.addRow("الدفعة", self.title)

        self.payment = SearchableComboBox(open_on_click=True)
        self.payment.setToolTip("دفعة عقد العميل المقابلة — إلزامية")
        self.payment.set_items([(self._line_label(x), int(x["id"]))
                                for x in self._lines], auto_select=False)
        self.payment.selection_changed.connect(self._on_payment_changed)
        form.addRow("دفعة العميل", self.payment)

        self.stage_lbl = QLabel("—")
        self.stage_lbl.setProperty("hint", True)
        form.addRow("المرحلة", self.stage_lbl)

        self.due_lbl = QLabel("—")
        self.due_lbl.setProperty("hint", True)
        self.due_lbl.setToolTip("يأتي من دفعة العميل تلقائيًا — لا كتابة يدوية")
        form.addRow("الاستحقاق", self.due_lbl)

        self.amount = SafeDoubleSpinBox()
        self.amount.setRange(0.001, 1e9)
        self.amount.setDecimals(3)
        self.amount.setGroupSeparatorShown(True)
        form.addRow("المبلغ", self.amount)

        row = QHBoxLayout()
        ok = QPushButton("💾 حفظ")
        ok.setObjectName("btnPrimary")
        ok.clicked.connect(self.accept)
        cancel = QPushButton("✕ إلغاء")
        cancel.setProperty("flat", True)
        cancel.clicked.connect(self.reject)
        row.addStretch()
        row.addWidget(ok)
        row.addWidget(cancel)
        form.addRow(row)

        if line:
            self.title.setText(line.get("title") or "")
            self.amount.setValue(float(line.get("amount") or 0))
        if self._sources:
            idx = self.payment.findData(int(self._sources[0]))
            if idx >= 0:
                self.payment.setCurrentIndex(idx)
        self._refresh_labels(autofill_title=False)

    # ---------------- مساعدات ----------------
    def _load_stages(self, cid) -> dict:
        if not cid:
            return {}
        try:
            from database.database import get_connection
            with get_connection() as conn:
                return {int(r["id"]): (r["name"] or "")
                        for r in conn.execute(
                            "SELECT id, name FROM contract_stages "
                            "WHERE contract_id=?", (int(cid),)).fetchall()}
        except Exception:
            return {}

    def _load_client_lines(self, cid) -> list[dict]:
        if not cid:
            return []
        try:
            return [dict(x) for x in lc.contract_payment_plan(int(cid))]
        except Exception:
            return []

    def _line_label(self, ln) -> str:
        try:
            amt = float(ln.get("amount") or 0)
            rem = float(ln.get("remaining") or 0)
        except Exception:
            amt = rem = 0.0
        tag = "محصّلة" if rem <= 0.001 else f"متبقٍ {rem:,.3f}"
        return f"{ln.get('title') or 'دفعة'} · {amt:,.3f} · {tag}"

    def _payment_row(self, pid):
        for ln in self._lines:
            if int(ln["id"]) == int(pid or 0):
                return ln
        return None

    def _on_payment_changed(self):
        self._refresh_labels(autofill_title=True)

    def _refresh_labels(self, autofill_title: bool = True):
        ln = self._payment_row(self.payment.selected_data())
        if not ln:
            self.stage_lbl.setText("—")
            self.due_lbl.setText("—")
            return
        self.stage_lbl.setText(
            self._stages.get(int(ln.get("stage_id") or 0)) or "—")
        self.due_lbl.setText((ln.get("due_date") or "")[:10] or "—")
        if autofill_title and not self.title.text().strip():
            self.title.setText((ln.get("title") or "").strip())

    def values(self):
        ln = self._payment_row(self.payment.selected_data()) or {}
        stage_id = ln.get("stage_id")
        return (self.title.text().strip(),
                (ln.get("due_date") or "")[:10],
                float(self.amount.value()),
                int(stage_id) if stage_id else None)

    def sources(self):
        pid = self.payment.selected_data()
        return [int(pid)] if pid else []


def _parent_contract_id(sc_id: int) -> int | None:
    sc = lc.get_sub_contract(int(sc_id)) or {}
    return int(sc["contract_id"]) if sc.get("contract_id") else None


def line_values(sc_id: int, lid: int) -> dict | None:
    for ln in lc.sub_payment_plan(int(sc_id)):
        if int(ln["id"]) == int(lid):
            return dict(ln)
    return None


def add_line(parent, sc_id: int, contract_id=None) -> bool:
    """إضافة سطر دفعة — المصادر إلزامية (V4.5.03) قبل الحفظ."""
    cid = int(contract_id) if contract_id else _parent_contract_id(sc_id)
    if not cid:
        style.error(parent, "عقد العميل الأب غير معروف.")
        return False
    try:
        _clines = lc.contract_payment_plan(cid)
    except Exception:
        _clines = []
    if not _clines:
        style.error(parent, "لا توجد دفعات عميل للربط — "
                            "أنشئ خطة دفعات العميل أولًا.")
        return False
    dlg = SubPlanLineDialog(parent, cid, title="إضافة دفعة مقاول")
    if dlg.exec() != QDialog.Accepted:
        return False
    title, due, amount, stage_id = dlg.values()
    if not title:
        style.error(parent, "عنوان الدفعة مطلوب.")
        return False
    if amount <= 0:
        style.error(parent, "مبلغ الدفعة يجب أن يكون أكبر من صفر.")
        return False
    srcs = dlg.sources()
    if not srcs:
        style.error(parent, "أُلغيت الإضافة: كل دفعة باطن لازم تتربط "
                            "بدفعة عميل واحدة على الأقل.")
        return False
    try:
        lid = lc.add_sub_plan_line(sc_id, title, due, amount, stage_id)
    except (ValidationError, DatabaseError) as exc:
        style.error(parent, str(exc))
        return False
    try:
        lc.set_sub_line_sources(lid, srcs)
    except (ValidationError, DatabaseError) as exc:
        try:
            lc.delete_sub_plan_line(lid)
        except Exception:
            pass
        style.error(parent, str(exc))
        return False
    style.toast(parent, "أُضيفت الدفعة بمصادرها")
    return True


def edit_line(parent, sc_id: int, lid: int, contract_id=None) -> bool:
    cid = int(contract_id) if contract_id else _parent_contract_id(sc_id)
    line = line_values(sc_id, lid)
    if not line:
        style.error(parent, "لم يُعثر على سطر الدفعة.")
        return False
    try:
        cur_srcs = [s["id"] for s in lc.get_sub_line_sources(lid)]
    except Exception:
        cur_srcs = []
    dlg = SubPlanLineDialog(parent, cid, line=line,
                            sources=cur_srcs, title="تعديل دفعة مقاول")
    if dlg.exec() != QDialog.Accepted:
        return False
    title, due, amount, stage_id = dlg.values()
    try:
        lc.update_sub_plan_line(lid, title, due, amount, stage_id)
    except (ValidationError, DatabaseError) as exc:
        style.error(parent, str(exc))
        return False
    srcs = dlg.sources()
    if srcs and sorted(srcs) != sorted(cur_srcs):
        try:
            lc.set_sub_line_sources(lid, srcs)
        except (ValidationError, DatabaseError) as exc:
            style.error(parent, str(exc))
            return False
    style.toast(parent, "حُفظ التعديل")
    return True


def delete_line(parent, sc_id: int, lid: int) -> bool:
    if not style.confirm(parent, "حذف سطر الدفعة؟", "سيُحذف السطر نهائيًا"):
        return False
    try:
        lc.delete_sub_plan_line(lid)
    except (ValidationError, DatabaseError) as exc:
        style.error(parent, str(exc))
        return False
    style.toast(parent, "حُذف السطر")
    return True


def distribute(parent, sc_id: int) -> bool:
    if not style.confirm(
            parent, "توزيع القيمة على المراحل الرئيسية؟",
            "يمسح السطور غير المفعّلة وينشئ دفعة مع كل مرحلة رئيسية "
            "بنسبة دفعة العميل + ربط المصدر تلقائيًا."):
        return False
    try:
        n = lc.distribute_sub_plan(sc_id)
    except (ValidationError, DatabaseError) as exc:
        style.error(parent, str(exc))
        return False
    style.toast(parent, "تم التوزيع: " + str(n) + " دفعات")
    return True


