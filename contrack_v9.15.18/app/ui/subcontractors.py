# -*- coding: utf-8 -*-
"""مقاولو الباطن + ربطهم بالعقود والبنود."""
from PySide6.QtCore import QDate, Qt, Signal, QTimer
from PySide6.QtGui import QColor, QFont
from PySide6.QtWidgets import (
    QCheckBox, QDateEdit, QDialog, QDoubleSpinBox, QFormLayout, QHBoxLayout,
    QHeaderView, QLabel, QLineEdit, QListWidget, QListWidgetItem,
    QPushButton, QSplitter, QStyledItemDelegate, QTableWidget, QTableWidgetItem,
    QTextEdit, QTreeWidget, QTreeWidgetItem, QVBoxLayout,
    QWidget,
)

from services.db_facade_service import DatabaseError
from services import lifecycle_service as lc
from services import contract_service, auth_service
from services.customer_service import ValidationError
from ui import style
from ui.design_system import Colors, Dimensions, Fonts, Styles
from ui.style import soft_shadow
from ui.widgets import required_label, SearchableComboBox, SafeDoubleSpinBox, SafeDateEdit, make_searchable


class SubcontractorDialog(QDialog):
    """إضافة أو تعديل مقاول باطن."""

    def __init__(self, parent=None, sub: dict | None = None):
        super().__init__(parent)
        self._sub = sub or None
        style.setup_dialog(
            self, "تعديل مقاول باطن" if sub else "إضافة مقاول باطن",
            "بيانات المقاول ونشاطه · يُربط لاحقًا بالعقود",
            icon="👷", color=style.ICON_SUB, size_ratio=0.32,
            min_w=440, max_w=580)
        from PySide6.QtWidgets import QWidget as _QW
        form_host = _QW()
        form = QFormLayout(form_host)
        form.setContentsMargins(0, 0, 0, 0)
        form.setSpacing(10)
        self.code = QLineEdit(
            (sub or {}).get("sub_code") or lc.next_sub_code(_consume=False))
        self.name = QLineEdit()
        self.phone = QLineEdit()
        self.email = QLineEdit()
        self.activity = QLineEdit()
        self.activity.setPlaceholderText("كهرباء / تكييف / تشطيبات...")
        self.notes = QTextEdit()
        self.notes.setFixedHeight(60)
        # V3.20: استثناء إظهار كل العملاء/المشاريع في السندات
        self.show_all = QCheckBox(
            "استثناء: إظهار كل العملاء ومشاريعهم لهذا المقاول في السندات")
        if sub:
            self.show_all.setChecked(bool(sub.get("show_all_contracts")))

            self.name.setText(sub.get("name") or "")
            self.phone.setText(sub.get("phone") or "")
            self.email.setText(sub.get("email") or "")
            self.activity.setText(sub.get("activity") or "")
            self.notes.setPlainText(sub.get("notes") or "")
        form.addRow(QLabel(required_label("رقم المقاول")), self.code)
        form.addRow(QLabel(required_label("اسم المقاول")), self.name)
        form.addRow("الهاتف", self.phone)
        form.addRow("البريد الإلكتروني", self.email)
        form.addRow("نوع النشاط", self.activity)
        form.addRow("ملاحظات", self.notes)
        form.addRow(self.show_all)

        self.body_layout.addWidget(form_host)
        style.dialog_buttons(self, "حفظ", on_save=self._save)

    def accept(self):  # noqa: N802
        """لا تغلق النافذة إلا بعد نجاح التحقق والحفظ."""
        self._save()

    def _save(self):
        from ui.widgets import RequiredValidator
        v = RequiredValidator(self)
        v.add(self.code, "رقم المقاول")
        v.add(self.name, "اسم المقاول")
        if not v.validate():
            return
        try:
            if self._sub:
                lc.update_subcontractor(
                    self._sub["id"], code=self.code.text(),
                    name=self.name.text(), phone=self.phone.text(),
                    email=self.email.text(), activity=self.activity.text(),
                    notes=self.notes.toPlainText(),
                    show_all_contracts=self.show_all.isChecked())
            else:
                lc.add_subcontractor(
                    self.code.text(), self.name.text(), self.phone.text(),
                    self.email.text(), self.activity.text(),
                    self.notes.toPlainText(),
                    show_all_contracts=self.show_all.isChecked())
            style.toast(self.parent() or self, "تم حفظ المقاول")
            QDialog.accept(self)
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))


# -*- coding: utf-8 -*-
def _auto_title_fixed(seq: int, title: str) -> str:
    """V5.6 ②: يعيد بناء أسماء الدفعات الآلية بالرقم الجديد.

    يشمل «الدفعة <ترتيب عربي>» التي كان القالب يكتبها، فلا يبقى في الاسم
    أثر لدفعة **تم تجاهلها** في العقد اليدوي (4. الدفعة الخامسة ⇒
    4. الدفعة الرابعة)، ويبقى الاسم الذي كتبه المستخدم كما هو.
    """
    try:
        from services.workflow_service import _plan_title_for
        return _plan_title_for(int(seq), {"title": title or ""})
    except Exception:
        return (title or "").strip() or f"دفعة {int(seq)}"


def _client_state_cell(lines_map: dict, sources) -> tuple:
    """V6.1: خلية عمود «حالة دفعة العميل» بدل عمود «المصادر» المربك.

    تعرض هل دفعة العميل المقابلة محصّلة؟ — لأن دفعة المقاول تُستحق عند
    تحصيل دفعة العميل (عقد العميل هو الأساس).
    """
    srcs = [int(x) for x in (sources or [])]
    if not srcs:
        return ("⚠ بلا دفعة عميل", style.WARN,
                "صف قديم بلا ربط بدفعة عميل — احذفه وأضفه من "
                "«＋ إضافة دفعة» ليُربط بدفعة عميل.")
    names, ok = [], True
    for sid in srcs:
        ln = (lines_map or {}).get(sid) or {}
        names.append(ln.get("title") or str(sid))
        try:
            if float(ln.get("remaining") or 0) > 0.001:
                ok = False
        except Exception:
            ok = False
    tip = ("دفعة العميل: " + "، ".join(names)
           + (" — محصّلة بالكامل ⇒ الدفعة قابلة للاستحقاق" if ok
              else " — لم تُحصَّل بعد: تُستحق دفعة المقاول بعد تحصيلها"))
    return (("✓ محصّلة" if ok else "⏳ لم تُحصَّل"),
            (style.OK_GREEN if ok else style.WARN), tip)


def _plan_compare_text(value: float, total: float) -> tuple[str, str]:
    """V5.6 ③: سطر مقارنة «قيمة العقد مقابل مجموع الدفعات» — نص ولون.

    كان السطر داخل التلميح الرمادي ولا يظهر أصلًا إذا كانت قيمة عقد
    الباطن صفرًا. الآن له سطر مستقل ملوّن ظاهر دائمًا:
      · قيمة غير مكتوبة ⇒ ⚠ تذكير (كهرماني)
      · المجموع = القيمة ⇒ ✓ مطابق (أخضر)
      · غير ذلك ⇒ ⚠ الفرق: ±X (كهرماني)
    """
    v = round(float(value or 0), 3)
    t = round(float(total or 0), 3)
    if v <= 0:
        return (f"⚠ اكتب «قيمة عقد الباطن» — مجموع الدفعات الحالي: "
                f"{t:,.3f} د.ك", style.WARN)
    if abs(v - t) <= 0.001:
        return (f"✓ مجموع دفعات عقد الباطن يساوي قيمة العقد: {v:,.3f} د.ك",
                style.OK_GREEN)
    return (f"⚠ مجموع دفعات عقد الباطن: {t:,.3f} د.ك · قيمة العقد: "
            f"{v:,.3f} د.ك · الفرق: {t - v:+,.3f} د.ك", style.WARN)


class _SubContractItemsMixin:
    """V4.5.15: بنود عقد العميل في جدول واحد — الاختيار داخل الجدول نفسه.

    قرار صاحب النظام (2026-10-06):
      · صندوق «③ البنود المختارة» أُلغي نهائيًا، وانتقلت وظائفه كلها
        (العدّاد · المجموع · زر الإرجاع · التعليم) إلى جدول «بنود عقد
        العميل» نفسه.
      · عقد العميل من نوع «تلقائي» (قالب مراحل ودفعات) بلا بنود ⇒ يُخفى
        صندوق البنود كاملًا ويُكتفى بدفعات عقد الباطن.
    """

    _CHOSEN_TINT = "#E0E7FF"   # تمييز البند المعلَّم (نيلي فاتح — هوية البرنامج)
    _TAKEN_TINT = "#FEF3C7"    # بند مرتبط بمقاول آخر (كهرماني فاتح)

    # ================= V4.5.15: نوع العقد (تلقائي أم لا) =================
    def _client_contract_auto(self, cid=None) -> bool:
        """هل عقد العميل من النوع «تلقائي» (له قالب مراحل/دفعات)؟

        نفس قاعدة شاشة العقد `_auto_plan_ui`: ليس يدويًا وليس شاملًا
        وليس «غير محدد»، وله شجرة مراحل فعلية.
        """
        try:
            if cid is None:
                cid = self._items_contract_id()
            if not cid:
                return False
            from services import contract_service as _cs
            from services import contract_type_service as _cts
            from services import workflow_service as _wf
            from services.contract_type_service import UNSPECIFIED
            con = _cs.get_contract(int(cid))
            tname = (getattr(con, "contract_type", "") or "").strip()
            if not tname or tname == UNSPECIFIED:
                return False
            cfg = _cts.type_config(tname)
            if cfg.get("manual_track") or cfg.get("is_bundle"):
                return False
            return bool(_wf.get_stages(_wf.TX_CONTRACT, tname))
        except Exception:
            return False

    def _client_contract_templated(self, cid=None) -> bool:
        """V5.3: هل نوع عقد العميل له قالب مراحل/دفعات (تلقائي أو يدوي)؟

        شاشة العقد تُخفي «بنود العقد» لأي نوع له قالب — فلا وجود لبنود
        على العقد، فيُكتفى في شاشة عقد الباطن بدفعات عقد الباطن بدل
        جدول فارغ ونص إرشادي مضلِّل. الشامل (bundle) مستثنى.
        """
        try:
            if cid is None:
                cid = self._items_contract_id()
            if not cid:
                return False
            from services import contract_service as _cs
            from services import contract_type_service as _cts
            from services import workflow_service as _wf
            from services.contract_type_service import UNSPECIFIED
            con = _cs.get_contract(int(cid))
            tname = (getattr(con, "contract_type", "") or "").strip()
            if not tname or tname == UNSPECIFIED:
                return False
            if _cts.type_config(tname).get("is_bundle"):
                return False
            return bool(_wf.get_stages(_wf.TX_CONTRACT, tname))
        except Exception:
            return False

    def _client_contract_type_name(self, cid=None) -> str:
        """V8.1: يُرجع اسم نوع العقد (أو '' إن تعذّر)."""
        try:
            if cid is None:
                cid = self._items_contract_id()
            if not cid:
                return ""
            from services import contract_service as _cs
            con = _cs.get_contract(int(cid))
            return (getattr(con, "contract_type", "") or "").strip()
        except Exception:
            return ""

    # ================= V8.3: الشجرة والإنزال =================
    def _load_scope_tree(self, cid=None):
        """بناء جدول البنود/الدفعات من عقد العميل — v9.7 (QTableWidget)."""
        tbl = getattr(self, "scope_table", None)
        if tbl is None:
            return

        if cid is None:
            cid = self.contract.selected_data()
        cid = int(cid) if cid else None

        tbl.blockSignals(True)
        tbl.setRowCount(0)

        if not cid:
            tbl.blockSignals(False)
            return

        try:
            from database.database import get_connection
            with get_connection() as conn:
                stages = [dict(r) for r in conn.execute(
                    "SELECT * FROM contract_stages WHERE contract_id=? ORDER BY sort_order",
                    (cid,)).fetchall()]
                boq_items = [dict(r) for r in conn.execute(
                    "SELECT * FROM boq_items WHERE contract_id=? AND deleted_addendum_id IS NULL ORDER BY id",
                    (cid,)).fetchall()]
                plan_items = [dict(r) for r in conn.execute(
                    "SELECT pp.*, cs.name AS stage_name FROM payment_plan pp "
                    "LEFT JOIN contract_stages cs ON cs.id=pp.stage_id "
                    "WHERE pp.contract_id=? ORDER BY pp.sort_order",
                    (cid,)).fetchall()]
                linked_other = {}
                rows = conn.execute(
                    "SELECT si.boq_item_id, s.name FROM sub_contract_items si "
                    "JOIN sub_contracts sc ON sc.id=si.sub_contract_id "
                    "JOIN subcontractors s ON s.id=sc.subcontractor_id "
                    "WHERE sc.contract_id=? AND COALESCE(sc.status,'') <> 'ملغى'",
                    (cid,)).fetchall()
                for r in rows:
                    if r[0]:
                        linked_other[int(r[0])] = r[1] or ""
        except Exception:
            tbl.blockSignals(False)
            return

        self._linked_other = linked_other

        # بناء الجدول حسب نوع البيانات
        if boq_items:
            self._load_scope_table_boq(tbl, stages, boq_items, linked_other)
        elif plan_items:
            self._load_scope_table_plan(tbl, stages, plan_items)
        elif stages:
            self._load_scope_table_stages_only(tbl, stages)

        tbl.blockSignals(False)

    def _load_scope_table_boq(self, tbl, stages, boq_items, linked_other):
        """بناء جدول البنود مع تجميع تحت المراحل."""
        stage_map = {s["id"]: s for s in stages}
        by_stage: dict = {}
        for item in boq_items:
            sid = item.get("stage_id")
            by_stage.setdefault(sid, []).append(item)
        for sid, items in by_stage.items():
            stage = stage_map.get(sid, {})
            stage_name = stage.get("name", "بدون مرحلة")
            # صف الأب (المرحلة)
            r = tbl.rowCount()
            tbl.insertRow(r)
            chk = QTableWidgetItem()
            chk.setFlags(Qt.ItemIsUserCheckable | Qt.ItemIsEnabled)
            chk.setCheckState(Qt.Checked)
            chk.setData(Qt.UserRole, sid)
            chk.setData(Qt.UserRole + 1, True)  # is_parent
            tbl.setItem(r, 0, chk)
            name = QTableWidgetItem(stage_name)
            name.setFlags(Qt.ItemIsEnabled | Qt.ItemIsSelectable)
            tbl.setItem(r, 1, name)
            tbl.setItem(r, 2, QTableWidgetItem(""))
            tbl.setItem(r, 3, QTableWidgetItem(""))
            # صفوف الأبناء (البنود)
            for item in items:
                r = tbl.rowCount()
                tbl.insertRow(r)
                chk = QTableWidgetItem()
                chk.setFlags(Qt.ItemIsUserCheckable | Qt.ItemIsEnabled)
                chk.setCheckState(Qt.Checked)
                chk.setData(Qt.UserRole, item["id"])
                chk.setData(Qt.UserRole + 1, False)  # is_child
                chk.setData(Qt.UserRole + 2, sid)  # parent_id
                tbl.setItem(r, 0, chk)
                name = QTableWidgetItem("    " + (item.get("description") or ""))
                name.setFlags(Qt.ItemIsEnabled | Qt.ItemIsSelectable)
                tbl.setItem(r, 1, name)
                qty = QTableWidgetItem(str(item.get("quantity", "")))
                qty.setFlags(Qt.ItemIsEnabled | Qt.ItemIsSelectable)
                tbl.setItem(r, 2, qty)
                price = QTableWidgetItem(str(item.get("unit_price", "")))
                price.setFlags(Qt.ItemIsEnabled | Qt.ItemIsSelectable)
                tbl.setItem(r, 3, price)

    def _load_scope_table_plan(self, tbl, stages, plan_items):
        """بناء جدول الدفعات."""
        for item in plan_items:
            r = tbl.rowCount()
            tbl.insertRow(r)
            chk = QTableWidgetItem()
            chk.setFlags(Qt.ItemIsUserCheckable | Qt.ItemIsEnabled)
            chk.setCheckState(Qt.Checked)
            chk.setData(Qt.UserRole, item.get("id"))
            chk.setData(Qt.UserRole + 1, False)
            tbl.setItem(r, 0, chk)
            name = QTableWidgetItem(item.get("stage_name") or item.get("title") or "")
            name.setFlags(Qt.ItemIsEnabled | Qt.ItemIsSelectable)
            tbl.setItem(r, 1, name)
            tbl.setItem(r, 2, QTableWidgetItem(""))
            amt = QTableWidgetItem(str(item.get("amount", "")))
            amt.setFlags(Qt.ItemIsEnabled | Qt.ItemIsSelectable)
            tbl.setItem(r, 3, amt)

    def _load_scope_table_stages_only(self, tbl, stages):
        """بناء جدول المراحل فقط."""
        for stage in stages:
            r = tbl.rowCount()
            tbl.insertRow(r)
            chk = QTableWidgetItem()
            chk.setFlags(Qt.ItemIsUserCheckable | Qt.ItemIsEnabled)
            chk.setCheckState(Qt.Checked)
            chk.setData(Qt.UserRole, stage["id"])
            chk.setData(Qt.UserRole + 1, False)
            tbl.setItem(r, 0, chk)
            name = QTableWidgetItem(stage.get("name", ""))
            name.setFlags(Qt.ItemIsEnabled | Qt.ItemIsSelectable)
            tbl.setItem(r, 1, name)
            tbl.setItem(r, 2, QTableWidgetItem(""))
            tbl.setItem(r, 3, QTableWidgetItem(""))
    
    def _load_scope_tree_boq(self, tree, stages, boq_items, linked_other):
        """بناء شجرة البنود مجمعة تحت المراحل."""
        from PySide6.QtWidgets import QTreeWidgetItem as _QTWI
        from PySide6.QtCore import Qt as _Qt
        
        # تجميع البنود تحت مرحلتها
        stage_map = {int(s["id"]): s for s in stages}
        items_by_stage = {}
        items_no_stage = []
        
        for item in boq_items:
            sid = item.get("stage_id")
            if sid and int(sid) in stage_map:
                items_by_stage.setdefault(int(sid), []).append(item)
            else:
                items_no_stage.append(item)
        
        # إضافة المراحل الرئيسية وأبناؤها
        for stage in stages:
            sid = int(stage["id"])
            stage_items = items_by_stage.get(sid, [])
            
            if stage_items:
                mi = _QTWI(tree, [stage.get("name", "")])
                mi.setData(0, _Qt.UserRole, {"kind": "stage", "id": sid})
                mi.setFlags(mi.flags() | _Qt.ItemIsUserCheckable)
                mi.setCheckState(0, _Qt.Unchecked)
                
                for item in stage_items:
                    iid = int(item["id"])
                    taken = iid in linked_other
                    label = item.get("description", "")
                    if taken:
                        label += f" [{linked_other[iid]}]"
                    ki = _QTWI(mi, [label])
                    ki.setData(0, _Qt.UserRole, {"kind": "boq", "id": iid})
                    ki.setFlags(ki.flags() | _Qt.ItemIsUserCheckable)
                    ki.setCheckState(0, _Qt.Unchecked)
                    if taken:
                        ki.setDisabled(True)
                
                mi.setExpanded(True)
        
        # إضافة معالج لتحديث حالة الأبناء عند تحديد الأب
        tree.itemChanged.connect(self._on_scope_item_changed)
        
        # البنود بلا مرحلة تحت "بنود أخرى"
        if items_no_stage:
            mi = _QTWI(tree, ["بنود أخرى"])
            mi.setData(0, _Qt.UserRole, {"kind": "other"})
            mi.setFlags(mi.flags() | _Qt.ItemIsUserCheckable)
            mi.setCheckState(0, _Qt.Unchecked)
            
            for item in items_no_stage:
                iid = int(item["id"])
                taken = iid in linked_other
                label = item.get("description", "")
                if taken:
                    label += f" [{linked_other[iid]}]"
                ki = _QTWI(mi, [label])
                ki.setData(0, _Qt.UserRole, {"kind": "boq", "id": iid})
                ki.setFlags(ki.flags() | _Qt.ItemIsUserCheckable)
                ki.setCheckState(0, _Qt.Unchecked)
                if taken:
                    ki.setDisabled(True)
            
            mi.setExpanded(True)
    
    def _on_scope_item_changed(self, item, column):
        """تحديث حالة الأبناء عند تحديد الأب."""
        from PySide6.QtCore import Qt as _Qt
        
        # تجنب التكرار اللانهائي
        tree = item.treeWidget()
        if tree:
            tree.blockSignals(True)
        
        # إذا تغير الأب، حدّث كل الأبناء
        if item.childCount() > 0:
            state = item.checkState(0)
            for i in range(item.childCount()):
                child = item.child(i)
                if not child.isDisabled():
                    child.setCheckState(0, state)
        
        # إذا تغير الابن، حدّث الأب
        parent = item.parent()
        if parent:
            checked_count = 0
            total = parent.childCount()
            for i in range(total):
                if parent.child(i).checkState(0) == _Qt.Checked:
                    checked_count += 1
            
            if checked_count == 0:
                parent.setCheckState(0, _Qt.Unchecked)
            elif checked_count == total:
                parent.setCheckState(0, _Qt.Checked)
            else:
                parent.setCheckState(0, _Qt.PartiallyChecked)
        
        if tree:
            tree.blockSignals(False)
    
    def _load_scope_tree_stages_only(self, tree, stages):
        """بناء شجرة المراحل فقط (بدون بنود وبدون دفعات)."""
        from PySide6.QtWidgets import QTreeWidgetItem as _QTWI
        from PySide6.QtCore import Qt as _Qt
        
        for stage in stages:
            sid = int(stage["id"])
            mi = _QTWI(tree, [stage.get("name", "")])
            mi.setData(0, _Qt.UserRole, {"kind": "stage", "id": sid})
            mi.setFlags(mi.flags() | _Qt.ItemIsUserCheckable)
            mi.setCheckState(0, _Qt.Unchecked)
            mi.setExpanded(True)
    
    def _load_scope_tree_plan(self, tree, stages, plan_items):
        """بناء شجرة المراحل والدفعات."""
        from PySide6.QtWidgets import QTreeWidgetItem as _QTWI
        from PySide6.QtCore import Qt as _Qt
        
        # تجميع الدفعات تحت مرحلتها
        stage_map = {int(s["id"]): s for s in stages}
        plan_by_stage = {}
        plan_no_stage = []
        
        for item in plan_items:
            sid = item.get("stage_id")
            if sid and int(sid) in stage_map:
                plan_by_stage.setdefault(int(sid), []).append(item)
            else:
                plan_no_stage.append(item)
        
        # إضافة المراحل الرئيسية وأبناؤها
        for stage in stages:
            sid = int(stage["id"])
            stage_plans = plan_by_stage.get(sid, [])
            
            mi = _QTWI(tree, [stage.get("name", "")])
            mi.setData(0, _Qt.UserRole, {"kind": "stage", "id": sid})
            mi.setFlags(mi.flags() | _Qt.ItemIsUserCheckable)
            mi.setCheckState(0, _Qt.Unchecked)
            
            for item in stage_plans:
                pid = int(item["id"])
                label = f"{item.get('title', '')} — {item.get('due_date', '')}"
                ki = _QTWI(mi, [label])
                ki.setData(0, _Qt.UserRole, {"kind": "plan", "id": pid, "data": item})
                ki.setFlags(ki.flags() | _Qt.ItemIsUserCheckable)
                ki.setCheckState(0, _Qt.Unchecked)
            
            mi.setExpanded(True)
        
        # الدفعات بلا مرحلة
        if plan_no_stage:
            mi = _QTWI(tree, ["دفعات أخرى"])
            mi.setData(0, _Qt.UserRole, {"kind": "other"})
            mi.setFlags(mi.flags() | _Qt.ItemIsUserCheckable)
            mi.setCheckState(0, _Qt.Unchecked)
            
            for item in plan_no_stage:
                pid = int(item["id"])
                label = f"{item.get('title', '')} — {item.get('due_date', '')}"
                ki = _QTWI(mi, [label])
                ki.setData(0, _Qt.UserRole, {"kind": "plan", "id": pid, "data": item})
                ki.setFlags(ki.flags() | _Qt.ItemIsUserCheckable)
                ki.setCheckState(0, _Qt.Unchecked)
            
            mi.setExpanded(True)
    
    def _sync_scope_tree(self, item, _col):
        """مزامنة الأب/الأبناء في جدول النطاق (QTableWidget)."""
        from PySide6.QtCore import Qt as _Qt
        
        tbl = getattr(self, "scope_table", None)
        if tbl is None:
            return
        
        tbl.blockSignals(True)
        try:
            row = item.row()
            is_parent = item.data(_Qt.UserRole + 1)
            if is_parent:
                parent_id = item.data(_Qt.UserRole)
                _want = item.checkState()
                for r in range(tbl.rowCount()):
                    chk = tbl.item(r, 0)
                    if chk and chk.data(_Qt.UserRole + 2) == parent_id:
                        chk.setCheckState(_want)
            else:
                parent_id = item.data(_Qt.UserRole + 2)
                if parent_id:
                    states = set()
                    for r in range(tbl.rowCount()):
                        chk = tbl.item(r, 0)
                        if chk and chk.data(_Qt.UserRole + 2) == parent_id:
                            states.add(chk.checkState())
                    for r in range(tbl.rowCount()):
                        chk = tbl.item(r, 0)
                        if chk and chk.data(_Qt.UserRole) == parent_id and chk.data(_Qt.UserRole + 1):
                            if len(states) == 1:
                                chk.setCheckState(states.pop())
                            else:
                                chk.setCheckState(_Qt.PartiallyChecked)
                            break
        finally:
            tbl.blockSignals(False)
        
        self._update_scope_count()
    
    def _update_scope_count(self):
        """تحديث عداد المحدد في جدول النطاق."""
        from PySide6.QtCore import Qt as _Qt
        
        tbl = getattr(self, "scope_table", None)
        lbl = getattr(self, "scope_count_lbl", None)
        if tbl is None or lbl is None:
            return
        
        n_selected = 0
        for r in range(tbl.rowCount()):
            chk = tbl.item(r, 0)
            if chk and chk.checkState() == _Qt.Checked:
                n_selected += 1
        
        lbl.setText(f"المحدد: {n_selected}")
    
    def _scope_selection(self) -> list[dict]:
        """العناصر المحددة في جدول النطاق."""
        from PySide6.QtCore import Qt as _Qt
        
        tbl = getattr(self, "scope_table", None)
        if tbl is None:
            return []
        
        result = []
        for r in range(tbl.rowCount()):
            chk = tbl.item(r, 0)
            if chk and chk.checkState() == _Qt.Checked:
                sid = chk.data(_Qt.UserRole)
                is_parent = chk.data(_Qt.UserRole + 1)
                if sid is not None:
                    result.append({"id": sid, "is_parent": bool(is_parent)})
        
        return result
    
    def _pull_selected(self):
        """⬇ إنزال المحدد من الشجرة إلى جدول عقد الباطن — V8.3."""
        selected = self._scope_selection()
        if not selected:
            style.toast(self, "لم تحدد أي عنصر في الشجرة.")
            return
        
        # جمع IDs الموجودة مسبقاً
        existing_ids = {r.get("source_id") for r in self._pulled_rows if r.get("source_id")}
        
        added = 0
        for item in selected:
            kind = item.get("kind", "")
            item_id = item.get("id", 0)
            
            # تخطي الموجود مسبقاً
            if item_id in existing_ids:
                continue
            
            if kind == "boq":
                # بند من boq_items
                row = self._make_pulled_row_from_boq(item_id)
                if row:
                    self._pulled_rows.append(row)
                    added += 1
            elif kind == "plan":
                # دفعة من payment_plan
                data = item.get("data", {})
                row = self._make_pulled_row_from_plan(item_id, data)
                if row:
                    self._pulled_rows.append(row)
                    added += 1
        
        if added:
            style.toast(self, f"تم إنزال {added} عنصر جديد.")
        else:
            style.toast(self, "كل العناصر المحددة موجودة مسبقاً.")
        
        self._fill_pulled_table()
        self._refresh_pulled_totals()
    
    def _make_pulled_row_from_boq(self, boq_id):
        """إنشاء صف من بند boq_items."""
        from database.database import get_connection
        with get_connection() as conn:
            item = conn.execute(
                "SELECT * FROM boq_items WHERE id=?", (boq_id,)).fetchone()
        if not item:
            return None
        item = dict(item)
        return {
            "source_kind": "boq",
            "source_id": boq_id,
            "description": item.get("description", ""),
            "stage_name": "",
            "qty": float(item.get("qty") or 0),
            "unit_price": float(item.get("unit_price") or 0),
            "amount": float(item.get("qty") or 0) * float(item.get("unit_price") or 0),
            "client_amount": float(item.get("qty") or 0) * float(item.get("unit_price") or 0),
            "unit": item.get("unit", ""),
            "boq_item_id": boq_id,
        }
    
    def _make_pulled_row_from_plan(self, plan_id, data=None):
        """إنشاء صف من دفعة payment_plan."""
        if not data:
            from database.database import get_connection
            with get_connection() as conn:
                data = conn.execute(
                    "SELECT * FROM payment_plan WHERE id=?", (plan_id,)).fetchone()
            if not data:
                return None
            data = dict(data)
        
        return {
            "source_kind": "plan",
            "source_id": plan_id,
            "description": data.get("title", ""),
            "stage_name": data.get("stage_name", ""),
            "qty": 1,
            "unit_price": float(data.get("amount") or 0),
            "amount": float(data.get("amount") or 0),
            "client_amount": float(data.get("amount") or 0),
            "unit": "دفعة",
            "boq_item_id": None,
        }
    
    def _fill_pulled_table(self):
        """ملء جدول البنود المُنزَّلة."""
        from ui.widgets import MONEY_ALIGN, sync_header_alignment
        from PySide6.QtGui import QColor
        
        t = getattr(self, "pulled_table", None)
        if t is None:
            return
        
        t.blockSignals(True)
        t.setRowCount(len(self._pulled_rows))
        
        for r, row in enumerate(self._pulled_rows):
            # البند/الدفعة
            desc_item = QTableWidgetItem(row.get("description", ""))
            desc_item.setFlags(desc_item.flags() & ~Qt.ItemIsEditable)
            t.setItem(r, 0, desc_item)
            
            # المرحلة
            stage_item = QTableWidgetItem(row.get("stage_name", "—"))
            stage_item.setFlags(stage_item.flags() & ~Qt.ItemIsEditable)
            t.setItem(r, 1, stage_item)
            
            # الكمية
            qty_item = QTableWidgetItem(f"{row.get('qty', 0):,.3f}")
            qty_item.setTextAlignment(MONEY_ALIGN)
            qty_item.setData(Qt.UserRole, r)  # رقم الصف
            t.setItem(r, 2, qty_item)
            
            # السعر
            price_item = QTableWidgetItem(f"{row.get('unit_price', 0):,.3f}")
            price_item.setTextAlignment(MONEY_ALIGN)
            price_item.setData(Qt.UserRole, r)
            t.setItem(r, 3, price_item)
            
            # الإجمالي
            total_item = QTableWidgetItem(f"{row.get('amount', 0):,.3f}")
            total_item.setFlags(total_item.flags() & ~Qt.ItemIsEditable)
            total_item.setTextAlignment(MONEY_ALIGN)
            t.setItem(r, 4, total_item)
            
            # مبلغ عقد العميل
            client_item = QTableWidgetItem(f"{row.get('client_amount', 0):,.3f}")
            client_item.setFlags(client_item.flags() & ~Qt.ItemIsEditable)
            client_item.setTextAlignment(MONEY_ALIGN)
            t.setItem(r, 5, client_item)
            
            # زر حذف
            del_btn = QPushButton("🗑")
            del_btn.setProperty("flat", True)
            del_btn.clicked.connect(lambda _, row_idx=r: self._remove_pulled_row(row_idx))
            t.setCellWidget(r, 6, del_btn)
        
        t.blockSignals(False)
        sync_header_alignment(t)
    
    def _remove_pulled_row(self, row_idx):
        """حذف صف من الجدول المُنزَّل وإلغاء تحديده في الشجرة."""
        if 0 <= row_idx < len(self._pulled_rows):
            removed = self._pulled_rows.pop(row_idx)
            # إلغاء تحديد العنصر في الشجرة
            self._uncheck_tree_item(removed.get("source_id"))
            self._fill_pulled_table()
            self._refresh_pulled_totals()
    
    def _uncheck_tree_item(self, source_id):
        """إلغاء تحديد عنصر في جدول النطاق."""
        from PySide6.QtCore import Qt as _Qt
        
        tbl = getattr(self, "scope_table", None)
        if tbl is None or not source_id:
            return
        
        tbl.blockSignals(True)
        for r in range(tbl.rowCount()):
            chk = tbl.item(r, 0)
            if chk and chk.data(_Qt.UserRole) == source_id:
                chk.setCheckState(_Qt.Unchecked)
        tbl.blockSignals(False)
        self._update_scope_count()
    
    def _on_pulled_cell_changed(self, row, col):
        """تعديل الكمية أو السعر في الجدول المُنزَّل."""
        from ui.contracts import _normalize_amount_text
        
        if row < 0 or row >= len(self._pulled_rows):
            return
        
        t = getattr(self, "pulled_table", None)
        if t is None:
            return
        
        if col == 2:  # الكمية
            item = t.item(row, 2)
            if item:
                val = _normalize_amount_text(item.text())
                self._pulled_rows[row]["qty"] = val
        elif col == 3:  # السعر
            item = t.item(row, 3)
            if item:
                val = _normalize_amount_text(item.text())
                self._pulled_rows[row]["unit_price"] = val
        
        # إعادة حساب الإجمالي
        qty = float(self._pulled_rows[row].get("qty", 0) or 0)
        price = float(self._pulled_rows[row].get("unit_price", 0) or 0)
        self._pulled_rows[row]["amount"] = qty * price
        
        # تحديث خلية الإجمالي
        t.blockSignals(True)
        total_item = QTableWidgetItem(f"{qty * price:,.3f}")
        total_item.setFlags(total_item.flags() & ~Qt.ItemIsEditable)
        from ui.widgets import MONEY_ALIGN
        total_item.setTextAlignment(MONEY_ALIGN)
        t.setItem(row, 4, total_item)
        t.blockSignals(False)
        
        self._refresh_pulled_totals()
    
    def _refresh_pulled_totals(self):
        """تحديث مجموع الجدول المُنزَّل وقيمة عقد الباطن."""
        total = sum(r.get("amount", 0) for r in self._pulled_rows)
        
        lbl = getattr(self, "pulled_total_lbl", None)
        if lbl:
            lbl.setText(f"مجموع البنود المُنزَّلة: {total:,.3f} د.ك")
        
        # تحديث قيمة عقد الباطن تلقائياً
        amount_spin = getattr(self, "amount", None)
        if amount_spin and self._pulled_rows:
            amount_spin.setValue(total)
    
    def _selected_item_ids(self) -> list[int]:
        """توافق خلفي: معرفات البنود المحددة."""
        # V8.3: إذا كان هناك صفوف مُنزَّلة، نستخدمها
        if getattr(self, "_pulled_rows", None):
            return [r.get("boq_item_id") for r in self._pulled_rows 
                    if r.get("boq_item_id")]
        #否则 نستخدم النظام القديم
        return [i for i in self._chosen_ids if i in self._items_by_id]
    
    def _pulled_items_data(self) -> list[dict]:
        """بيانات البنود المُنزَّلة للحفظ."""
        return [{
            "source_kind": r.get("source_kind", ""),
            "source_id": r.get("source_id", 0),
            "boq_item_id": r.get("boq_item_id"),
            "qty": r.get("qty", 0),
            "unit_price": r.get("unit_price", 0),
            "amount": r.get("amount", 0),
        } for r in self._pulled_rows]
    
    def _set_scope_all(self, on: bool):
        """تحديد/إلغاء الكل في جدول النطاق."""
        from PySide6.QtCore import Qt as _Qt
        
        tbl = getattr(self, "scope_table", None)
        if tbl is None:
            return
        
        tbl.blockSignals(True)
        for r in range(tbl.rowCount()):
            chk = tbl.item(r, 0)
            if chk:
                chk.setCheckState(_Qt.Checked if on else _Qt.Unchecked)
        tbl.blockSignals(False)
        self._update_scope_count()

    def _apply_items_visibility(self, cid=None) -> bool:
        """V8.1: سياسة صندوق بنود عقد العميل.

        · عقد تلقائي (قالب مراحل/دفعات) **بلا بنود** ⇒ يُخفى الصندوق كاملًا
          ويُكتفى بدفعات عقد الباطن.
        · عقد يدوي له قالب ⇒ يبقى ظاهرًا (المستخدم يختار البنود يدويًا).
        · عقد تلقائي له بنود فعلية ⇒ يبقى ظاهرًا.
        · غير ذلك ⇒ ظاهر دائمًا.

        تُرجع: هل العقد له قالب (تلقائي أو يدوي)؟
        """
        auto = self._client_contract_auto(cid)
        templated = auto or self._client_contract_templated(cid)
        self._client_auto = auto
        # V8.1: يُخفى فقط للتلقائي بلا بنود — اليدوي يبقى ظاهر
        hide = bool(auto and not getattr(self, "_items", None))
        self._items_hidden = hide
        box = getattr(self, "items_box", None)
        if box is not None:
            box.setVisible(not hide)
        note = getattr(self, "items_hidden_note", None)
        if note is not None:
            note.setVisible(hide)
        pb = getattr(self, "plan_box", None)
        if pb is not None and hasattr(pb, 'title'):
            _t = pb.title()
            if hide and "③" in _t:
                pb.setTitle(_t.replace("③", "②", 1))
            elif (not hide) and "②" in _t:
                pb.setTitle(_t.replace("②", "③", 1))
        if hide:
            self._chosen_ids = []
        return templated

    # ================= جدول بنود عقد العميل =================
    def _fill_items_table(self):
        from ui.widgets import MONEY_ALIGN, sync_header_alignment
        from PySide6.QtGui import QColor
        t = self.items_table
        t.blockSignals(True)
        
        # V8.2: تغيير رؤوس الأعمدة حسب الوضع
        if getattr(self, "_is_plan_mode", False):
            t.setHorizontalHeaderLabels(
                ["✔", "الدفعة", "المرحلة", "الاستحقاق", "المبلغ", "ملاحظات"])
        else:
            t.setHorizontalHeaderLabels(
                ["✔", "البند", "الكمية", "الوحدة", "سعر الوحدة", "الإجمالي"])
        
        t.setRowCount(len(self._items))
        for r, it in enumerate(self._items):
            iid = int(it["id"])
            qty = float(it.get("qty") or 0)
            price = float(it.get("unit_price") or 0)
            total = float(it.get("total") or qty * price)
            taken = iid in self._linked_other
            chosen = (iid in self._chosen_ids) and not taken
            chk = QTableWidgetItem("")
            flags = (Qt.ItemIsUserCheckable | Qt.ItemIsEnabled
                     | Qt.ItemIsSelectable)
            chk.setFlags(flags)
            chk.setCheckState(Qt.Checked if chosen else Qt.Unchecked)
            chk.setData(Qt.UserRole, iid)
            if taken:
                chk.setFlags(Qt.ItemIsEnabled | Qt.ItemIsSelectable)
            t.setItem(r, 0, chk)
            
            # V8.2: عرض الدفعات بدل البنود في وضع الخطة
            if getattr(self, "_is_plan_mode", False):
                vals = [
                    it.get("description") or "",
                    it.get("stage_name") or "—",
                    it.get("due_date") or "—",
                    f"{total:,.3f}",
                    it.get("notes") or ""
                ]
            else:
                vals = [it.get("description") or "", f"{qty:,.3f}",
                        it.get("unit") or "—", f"{price:,.3f}", f"{total:,.3f}"]
            
            for c, v in enumerate(vals, start=1):
                cell = QTableWidgetItem(str(v))
                cell.setFlags(Qt.ItemIsEnabled | Qt.ItemIsSelectable)
                cell.setTextAlignment(MONEY_ALIGN if c in (3, 4, 5)
                                      else Qt.AlignCenter)
                cell.setData(Qt.UserRole, iid)
                if taken:
                    cell.setForeground(QColor(style.WARN))
                    _other = self._linked_other.get(iid, "")
                    if _other:
                        cell.setToolTip(f"مرتبط بمقاول آخر: {_other}")
                t.setItem(r, c, cell)
        t.blockSignals(False)
        sync_header_alignment(t)
        self._mark_chosen_rows()
        self._refresh_chosen_table()

    def _mark_row(self, r: int):
        """تمييز صف واحد حسب حالته (مختار / مقاول آخر / متاح)."""
        from PySide6.QtGui import QBrush, QColor
        t = self.items_table
        cell0 = t.item(r, 0)
        if cell0 is None:
            return
        iid = int(cell0.data(Qt.UserRole) or 0)
        chosen = iid in self._chosen_ids
        taken = iid in self._linked_other
        if taken:
            brush = QBrush(QColor(self._TAKEN_TINT))
        elif chosen:
            brush = QBrush(QColor(self._CHOSEN_TINT))
        else:
            brush = QBrush()
        for c in range(t.columnCount()):
            cell = t.item(r, c)
            if cell is None:
                continue
            cell.setBackground(brush)

    def _mark_chosen_rows(self):
        t = getattr(self, "items_table", None)
        if t is None:
            return
        for r in range(t.rowCount()):
            self._mark_row(r)

    def _fit_columns(self, table, desc_col: int = 1, first_ct: bool = True):
        """يوسّع عمود الوصف وضيّق الأرقام في جداول شاشة الباطن (V4.5.11)."""
        from PySide6.QtWidgets import QHeaderView
        try:
            h = table.horizontalHeader()
            if first_ct:
                h.setSectionResizeMode(0, QHeaderView.ResizeToContents)
            h.setSectionResizeMode(desc_col, QHeaderView.Stretch)
            for c in range(table.columnCount()):
                if c != desc_col and not (first_ct and c == 0):
                    h.setSectionResizeMode(c, QHeaderView.ResizeToContents)
        except Exception:
            pass

    def _on_item_toggled(self, item):
        if item is None or item.column() != 0:
            return
        iid = int(item.data(Qt.UserRole) or 0)
        if iid in self._linked_other:
            return
        if item.checkState() == Qt.Checked:
            if iid not in self._chosen_ids:
                self._chosen_ids.append(iid)
        elif iid in self._chosen_ids:
            self._chosen_ids.remove(iid)
        self._mark_row(item.row())
        self._refresh_sub_totals()
        self._refresh_chosen_table()

    def _refresh_chosen_table(self):
        """V6.6: تحديث جدول البنود المختارة."""
        ct = getattr(self, "chosen_table", None)
        if ct is None:
            return
        from ui.widgets import MONEY_ALIGN
        rows = [self._items_by_id[i] for i in self._chosen_ids
                if i in getattr(self, "_items_by_id", {})]
        ct.blockSignals(True)
        ct.setRowCount(len(rows))
        for r, it in enumerate(rows):
            qty = float(it.get("qty") or 0)
            price = float(it.get("unit_price") or 0)
            total = float(it.get("total") or qty * price)
            vals = [it.get("description") or "", f"{qty:,.3f}",
                    it.get("unit") or "—", f"{price:,.3f}", f"{total:,.3f}"]
            for c, v in enumerate(vals):
                cell = QTableWidgetItem(str(v))
                cell.setFlags(Qt.ItemIsEnabled | Qt.ItemIsSelectable)
                cell.setTextAlignment(MONEY_ALIGN if c in (3, 4) else Qt.AlignCenter)
                ct.setItem(r, c, cell)
        ct.blockSignals(False)

    def _refresh_plan_compare(self, total: float | None = None):
        """V5.6 ③: تحديث سطر المقارنة الملوّن تحت جدول الدفعات."""
        lbl = getattr(self, "plan_compare_lbl", None)
        if lbl is None:
            return
        if total is None:
            total = sum(float(x.get("amount") or 0) for x in self._plan_rows)
        try:
            value = float(self.amount.value() or 0)
        except Exception:
            value = 0.0
        txt, col = _plan_compare_text(value, total)
        lbl.setText(txt)
        lbl.setStyleSheet(f"font-weight: 800; color: {col}; padding: 4px 6px;")

    def _refresh_sub_totals(self):
        """عدّاد ومجموع المختار + مقارنته بقيمة عقد الباطن (كان في صندوق ③).
        
        V8.2: في وضع الخطة، يعرض عداد الدفعات المحددة.
        """
        _color = None      # V5.4 ⑤: لون سطر المقارنة
        rows = [self._items_by_id[i] for i in self._chosen_ids
                if i in getattr(self, "_items_by_id", {})]
        total = 0.0
        for it in rows:
            qty = float(it.get("qty") or 0)
            price = float(it.get("unit_price") or 0)
            total += float(it.get("total") or qty * price)
        self._chosen_total = total
        
        if getattr(self, "_items_hidden", False):
            txt = ("بلا بنود — عقد العميل من نوع تلقائي (يُكتفى بدفعات "
                   "عقد الباطن)"
                   if getattr(self, "_client_auto", False) else
                   "بلا بنود — نوع عقد العميل له قالب (يُكتفى بدفعات "
                   "عقد الباطن)")
        elif getattr(self, "_is_plan_mode", False):
            # V8.2: وضع الدفعات
            if not rows:
                txt = "لم تحدد أي دفعة — علّم الدفعات في الجدول العلوي"
            else:
                _all_total = 0.0
                for _it in (getattr(self, "_items", None) or []):
                    _q = float(_it.get("qty") or 0)
                    _p = float(_it.get("unit_price") or 0)
                    _all_total += float(_it.get("total") or _q * _p)
                txt = (f"مجموع دفعات العقد: {_all_total:,.3f} د.ك · "
                       f"المحدد: {len(rows)} دفعة · {total:,.3f} د.ك")
                try:
                    amt = float(self.amount.value() or 0)
                except Exception:
                    amt = 0.0
                if amt > 0:
                    diff = total - amt
                    txt += f" · قيمة عقد الباطن: {amt:,.3f} د.ك"
                    txt += (" · ✓ مطابق" if abs(diff) <= 0.001
                            else f" · ⚠ الفرق: {diff:+,.3f} د.ك")
                    _color = (style.OK_GREEN if abs(diff) <= 0.001
                              else style.WARN)
                else:
                    _color = None
        elif not getattr(self, "_items", None):
            txt = "لا بنود على عقد العميل"
        elif not rows:
            txt = "لم تُعلّم أي بند — يمكن الحفظ بلا بنود"
        else:
            # V5.4 ⑤: سطر مقارنة كامل مثل عقد العميل تمامًا
            # (مجموع البنود ← المختار ← قيمة عقد الباطن ← الفرق)
            _all_total = 0.0
            for _it in (getattr(self, "_items", None) or []):
                _q = float(_it.get("qty") or 0)
                _p = float(_it.get("unit_price") or 0)
                _all_total += float(_it.get("total") or _q * _p)
            txt = (f"مجموع بنود عقد العميل: {_all_total:,.3f} د.ك · "
                   f"المختار لهذا المقاول: {len(rows)} بند · {total:,.3f} د.ك")
            try:
                amt = float(self.amount.value() or 0)
            except Exception:
                amt = 0.0
            if amt > 0:
                # نفس إشارة شاشة عقد العميل: مجموع البنود − قيمة العقد
                diff = total - amt
                txt += f" · قيمة عقد الباطن: {amt:,.3f} د.ك"
                txt += (" · ✓ مطابق لقيمة عقد الباطن" if abs(diff) <= 0.001
                        else f" · ⚠ الفرق: {diff:+,.3f} د.ك")
                _color = (style.OK_GREEN if abs(diff) <= 0.001
                          else style.WARN)
            else:
                _color = None
        lbl = getattr(self, "items_total_lbl", None)
        if lbl is not None:
            lbl.setText(txt)
            try:
                if _color:
                    lbl.setStyleSheet(
                        "background: transparent; border: none; "
                        f"font-weight: 800; color: {_color};")
                else:
                    lbl.setStyleSheet(
                        "font-weight: 800;")
            except Exception:
                pass
        other = getattr(self, "chosen_total_lbl", None)
        if other is not None and other is not lbl:
            other.setText(txt)

    def _update_value_check(self):
        """(توافق خلفي) صار التحديث له موضعًا واحدًا: `_refresh_sub_totals`."""
        self._refresh_sub_totals()

    def _fill_chosen_table(self):
        """(توافق خلفي) لا جدول «مختار» منفصل — التحديث في جدول البنود."""
        self._fill_items_table()
        self._refresh_sub_totals()

    def _check_all(self, state: bool):
        if state:
            self._chosen_ids = [int(x["id"]) for x in self._items
                                if int(x["id"]) not in self._linked_other]
            skipped = len(self._items) - len(self._chosen_ids)
            if skipped:
                style.toast(self, f"استُثني {skipped} بندًا مرتبطًا بمقاول آخر.")
        else:
            self._chosen_ids = []
        self._fill_items_table()
        self._refresh_sub_totals()

    def _return_selected(self):
        """إلغاء تعليم البنود المحددة داخل جدول بنود عقد العميل."""
        t = self.items_table
        rows = {i.row() for i in t.selectedIndexes()}
        if not rows and t.currentRow() >= 0:
            rows = {t.currentRow()}
        ids = []
        for r in rows:
            cell = t.item(r, 0)
            if cell is not None:
                iid = int(cell.data(Qt.UserRole) or 0)
                if iid and iid not in self._linked_other:
                    ids.append(iid)
        if not ids:
            style.info(self, "حدّد بندًا من جدول «بنود عقد العميل» أولاً.")
            return
        t.blockSignals(True)
        try:
            for r in rows:
                cell = t.item(r, 0)
                if cell is not None and (cell.flags()
                                         & Qt.ItemIsUserCheckable):
                    cell.setCheckState(Qt.Unchecked)
        finally:
            t.blockSignals(False)
        self._chosen_ids = [i for i in self._chosen_ids if i not in ids]
        self._mark_chosen_rows()
        self._refresh_sub_totals()

    def _selected_item_ids(self) -> list[int]:
        return [i for i in self._chosen_ids if i in self._items_by_id]


class LinkSubContractDialog(_SubContractItemsMixin, QDialog):
    """V4.5.11: إنشاء عقد مقاول باطن في شاشة واحدة.

    V8.6: تصميم جديد — جدولين متقابلين (RTL):
    - الأيمن: بنود عقد العميل (شجرة checkbox + إنزال + تعديل كمية/سعر)
    - الأيسر: دفعات عقد الباطن (مستقلة)
    """

    # أعمدة الشجرة الموحدة
    COL_CHECK = 0; COL_DESC = 1; COL_QTY = 2; COL_PRICE = 3
    COL_TOTAL = 4; COL_CLIENT = 5; COL_STATUS = 6; COL_RETURN = 7
    _TREE_HEADERS = ["✔", "البند / الدفعة", "الكمية", "سعر المقاول",
                     "الإجمالي", "مبلغ العميل", "الحالة", "↩"]

    # حالات الصفوف
    STATE_AVAILABLE = 0    # غير معلَّم، للقراءة فقط
    STATE_SELECTED = 1     # معلَّم (بانتظار الإنزال)
    STATE_PULLED = 2       # مُنزَّل ✓ — checkbox مقفل، الكمية/سعر قابلان للتعديل
    STATE_LINKED = 3       # مرتبط بمقاول آخر — معطَّل

    class _PulledItemDelegate(QStyledItemDelegate):
        """يسمح بالتحرير فقط لعمودي الكمية والسعر في الصفوف المُنزَّلة."""

        def __init__(self, dialog, parent=None):
            super().__init__(parent)
            self._dlg = dialog

        def createEditor(self, parent, option, index):
            from ui.widgets import SafeDoubleSpinBox
            sp = SafeDoubleSpinBox(parent)
            sp.setRange(0, 1e9)
            sp.setDecimals(3)
            sp.setGroupSeparatorShown(True)
            return sp

        def setEditorData(self, editor, index):
            val = index.data(Qt.UserRole) or 0
            editor.setValue(float(val or 0))

        def setModelData(self, editor, model, index):
            val = editor.value()
            model.setData(index, val, Qt.UserRole)

        def updateEditorGeometry(self, editor, option, index):
            editor.setGeometry(option.rect)

        def paint(self, painter, option, index):
            # تلوين خلفية الصف المُنزَّل
            from PySide6.QtWidgets import QStyledItemDelegate as _Base
            _Base.paint(self, painter, option, index)

        def flags(self, index):
            # التحرير فقط لعمودي الكمية والسعر وللصفوف المُنزَّلة
            item = index.data(Qt.UserRole + 1)  # QTreeWidgetItem
            if item and item.data(0, Qt.UserRole + 2) == 2:  # STATE_PULLED
                col = index.column()
                if col in (2, 3):  # COL_QTY, COL_PRICE
                    return Qt.ItemIsEnabled | Qt.ItemIsSelectable | Qt.ItemIsEditable
            return Qt.ItemIsEnabled | Qt.ItemIsSelectable

    def __init__(self, parent=None, preset_contract_id: int | None = None,
                 preset_sub_id: int | None = None):
        super().__init__(parent)
        style.setup_dialog(
            self, "عقد مقاول باطن",
            "بيانات المقاول والبنود ودفعات العقد",
            icon="👷", color=style.ICON_SUB,
            size_ratio=0.88, min_w=960, max_w=1400,
            fullscreen=True)

        self._items: list[dict] = []
        self._items_by_id: dict[int, dict] = {}
        self._linked_other: dict[int, str] = {}
        self._chosen_ids: list[int] = []
        self._plan_rows: list[dict] = []
        self._plan_note: str = ""
        self._client_lines: dict = {}
        self._items_cid = None
        self._pulled_rows: list[dict] = []  # V8.3: الصفوف المُنزَّلة
        self._pulled_source_ids: set = set()  # V8.6: معرفات البنود المُنزَّلة

        # V8.6: استخدام body_layout من setup_dialog (لا تُنشئ تخطيط جديد!)
        lay = self.body_layout
        lay.setSpacing(10)

        # ================= ① بيانات عقد الباطن =================
        from PySide6.QtWidgets import QGridLayout, QGroupBox

        # ── نمط موحّد للحقول (مطابق لعقد العميل v9.7) ─────────────
        _FIELD_H = 28
        _FIELD_SS = (
            f"QLineEdit, QComboBox, QDateEdit, QDoubleSpinBox, QSpinBox {{"
            f" min-height: {_FIELD_H}px; max-height: {_FIELD_H}px;"
            f" padding: 3px 6px; font-size: 11px;"
            f" border: 0.5px solid #D1D5DB; border-radius: 6px;"
            f" background: #F9FAFB; color: #111827; }}"
            f" QLineEdit:focus, QComboBox:focus, QDateEdit:focus,"
            f" QDoubleSpinBox:focus, QSpinBox:focus {{"
            f" border-color: #2563EB; background: #FFFFFF; }}"
        )
        _LABEL_SS = (
            "QLabel { font-size: 10px; font-weight: 600;"
            " color: #9CA3AF; background: transparent; border: none; }"
        )
        _DESC_SS = (
            f"QTextEdit {{"
            f" min-height: 28px; max-height: 28px;"
            f" padding: 3px 6px; font-size: 11px;"
            f" border: 0.5px solid #D1D5DB; border-radius: 6px;"
            f" background: #F9FAFB; color: #111827; }}"
            f" QTextEdit:focus {{"
            f" border-color: #2563EB; background: #FFFFFF; }}"
        )

        # ── حاوية الحقول (بدون QGroupBox) ──────────────────────────
        from PySide6.QtWidgets import QFrame as _QF
        form_card = _QF()
        form_card.setStyleSheet(
            "QFrame { background: #FFFFFF; border: 0.5px solid #E5E7EB;"
            " border-radius: 8px; }")
        g = QGridLayout(form_card)
        g.setContentsMargins(6, 4, 6, 4)
        g.setHorizontalSpacing(6)
        g.setVerticalSpacing(4)

        self.sub = SearchableComboBox(search_only=True)
        self.sub.setStyleSheet(_FIELD_SS)
        new_sub_btn = QPushButton("＋ مقاول جديد")
        new_sub_btn.setProperty("flat", True)
        new_sub_btn.setVisible(
            auth_service.has_permission("action_add_subcontractor"))
        new_sub_btn.clicked.connect(self._new_sub)
        sub_wrap = QWidget()
        sub_row = QHBoxLayout(sub_wrap)
        sub_row.setContentsMargins(0, 0, 0, 0)
        sub_row.addWidget(self.sub, 1)
        sub_row.addWidget(new_sub_btn)

        self.customer = SearchableComboBox(search_only=True)
        self.customer.setStyleSheet(_FIELD_SS)
        self.contract = SearchableComboBox(open_on_click=True)
        self.contract.setStyleSheet(_FIELD_SS)
        self.amount = SafeDoubleSpinBox()
        self.amount.setStyleSheet(_FIELD_SS)
        self.amount.setRange(0, 1e9)
        self.amount.setDecimals(3)
        self.amount.setGroupSeparatorShown(True)
        self.amount.valueChanged.connect(lambda *_: self._update_value_check())
        self.amount.valueChanged.connect(
            lambda *_: self._refresh_plan_compare())
        self.start = SafeDateEdit()
        self.start.setStyleSheet(_FIELD_SS)
        self.start.setCalendarPopup(True)
        self.start.setDisplayFormat("yyyy-MM-dd")
        self.start.setDate(QDate.currentDate())
        self.end = SafeDateEdit()
        self.end.setStyleSheet(_FIELD_SS)
        self.end.setCalendarPopup(True)
        self.end.setDisplayFormat("yyyy-MM-dd")
        self.end.setDate(QDate.currentDate().addMonths(6))
        self.description = QTextEdit()
        self.description.setStyleSheet(_DESC_SS)
        self.remaining_lbl = QLabel("")
        self.remaining_lbl.setProperty("hint", True)

        def _lbl(text, required=False):
            l = QLabel(required_label(text) if required else text)
            l.setStyleSheet(_LABEL_SS)
            return l

        g.addWidget(_lbl("مقاول الباطن", True), 0, 0)
        g.addWidget(sub_wrap, 0, 1)
        g.addWidget(_lbl("العميل", True), 0, 2)
        g.addWidget(self.customer, 0, 3)
        g.addWidget(_lbl("العقد الرئيسي", True), 0, 4)
        g.addWidget(self.contract, 0, 5)
        g.addWidget(_lbl("قيمة عقد الباطن", True), 1, 0)
        g.addWidget(self.amount, 1, 1)
        g.addWidget(_lbl("تاريخ البداية"), 1, 2)
        g.addWidget(self.start, 1, 3)
        g.addWidget(_lbl("تاريخ النهاية"), 1, 4)
        g.addWidget(self.end, 1, 5)
        g.addWidget(self.remaining_lbl, 2, 0, 1, 6)
        g.addWidget(_lbl("الوصف"), 3, 0)
        g.addWidget(self.description, 3, 1, 1, 5)
        g.setColumnStretch(1, 3)
        g.setColumnStretch(3, 2)
        g.setColumnStretch(5, 3)
        lay.addWidget(form_card)

        # ================= V8.6: جدولين متقابلين (RTL) =================
        from PySide6.QtWidgets import QTreeWidget, QGroupBox, QSplitter, QStyledItemDelegate
        from PySide6.QtWidgets import QSizePolicy as _SP
        from ui.contracts import _PLAN_AMOUNT_HINT, _PlanAmountDelegate

        splitter = QSplitter(Qt.Horizontal)
        splitter.setChildrenCollapsible(False)

        # ── الأيمن: بنود عقد العميل (جدول مبسّط) ──
        right_box = QWidget()

        right_lay = QVBoxLayout(right_box)
        right_lay.setContentsMargins(0, 0, 0, 0)
        right_lay.setSpacing(4)

        # عنوان + أزرار
        scope_head = QHBoxLayout()
        scope_title = QLabel("🎯 بنود العميل")
        self._items_title_lbl = scope_title  # V9.15.10: عنوان الصندوق (QWidget هنا)
        scope_title.setStyleSheet(
            "font-weight: 700; background: transparent;"
            " border: none; color: #1F2937; font-size: 11px;")
        scope_head.addWidget(scope_title)
        scope_head.addStretch()
        b_all = QPushButton("✓ الكل")
        b_all.setProperty("flat", True)
        b_all.clicked.connect(lambda: self._set_scope_all(True))
        scope_head.addWidget(b_all)
        b_none = QPushButton("✕ لا شيء")
        b_none.setProperty("flat", True)
        b_none.clicked.connect(lambda: self._set_scope_all(False))
        scope_head.addWidget(b_none)
        pull_btn = QPushButton("⌡ ربط المحدد")
        pull_btn.setObjectName("btnPrimary")
        pull_btn.setProperty("compact", True)
        pull_btn.clicked.connect(self._pull_selected)
        scope_head.addWidget(pull_btn)
        right_lay.addLayout(scope_head)

        # جدول البنود (QTableWidget بديل scope_tree)
        self.scope_table = QTableWidget(0, 4)
        self.scope_table.setHorizontalHeaderLabels(
            ["✔", "البند/المرحلة", "الكمية", "السعر"])
        self.scope_table.verticalHeader().setVisible(False)
        self.scope_table.setSelectionBehavior(QTableWidget.SelectRows)
        self.scope_table.setSelectionMode(QTableWidget.MultiSelection)
        self.scope_table.setAlternatingRowColors(True)
        self.scope_table.itemChanged.connect(self._on_scope_item_changed)
        try:
            from ui.widgets import apply_column_weights
            apply_column_weights(self.scope_table,
                                 [8, 50, 21, 21],
                                 min_widths=[30, 120, 60, 60])
        except Exception:
            pass
        self.scope_table.setMinimumHeight(200)
        right_lay.addWidget(self.scope_table, 1)

        # شريط التنبيه
        self._scope_warn_lbl = QLabel("")
        self._scope_warn_lbl.setStyleSheet(
            "color: #92400E; background: #FEF3C7; padding: 4px 10px;"
            " border-radius: 6px; font-weight: 700;")
        self._scope_warn_lbl.setVisible(False)
        right_lay.addWidget(self._scope_warn_lbl)

        # ملخص
        scope_foot = QHBoxLayout()
        self.scope_count_lbl = QLabel("المحدد: 0 · المُنزَّل: 0")
        self.scope_count_lbl.setStyleSheet(
            "font-weight: 700; font-size: 11px;")
        scope_foot.addWidget(self.scope_count_lbl)
        self.pulled_total_lbl = QLabel("مجموع المُنزَّل: 0.000 د.ك")
        self.pulled_total_lbl.setStyleSheet(
            "font-weight: 700; font-size: 11px;")
        scope_foot.addWidget(self.pulled_total_lbl)
        scope_foot.addStretch()
        right_lay.addLayout(scope_foot)

        self.items_box = right_box
        self.items_hint = QLabel("")
        self.items_hint.setVisible(False)
        # توافق خلفي: scope_tree يشير إلى scope_table
        self.scope_tree = self.scope_table
        splitter.addWidget(right_box)

        # ── الأيسر: دفعات عقد الباطن ──
        left_box = QWidget()
        self.plan_box = left_box

        v3f = QVBoxLayout(left_box)
        self.plan_hint = QLabel("")
        self.plan_hint.setWordWrap(True)
        self.plan_hint.setProperty("hint", True)
        self.plan_hint.setVisible(False)
        v3f.addWidget(self.plan_hint)
        self.plan_table = QTableWidget(0, 7)
        self.plan_table.setHorizontalHeaderLabels(
            ["✔", "#", "الدفعة", "المرحلة", "قيمة الدفعة", "الاستحقاق",
             "حالة دفعة العميل"])
        self.plan_table.verticalHeader().setVisible(False)
        self.plan_table.setSelectionBehavior(QTableWidget.SelectRows)
        self.plan_table.setSelectionMode(QTableWidget.MultiSelection)
        self.plan_table.setAlternatingRowColors(True)


        self.plan_table.setEditTriggers(
            QTableWidget.DoubleClicked | QTableWidget.EditKeyPressed
            | QTableWidget.SelectedClicked)
        self.plan_table.setItemDelegateForColumn(
            4, _PlanAmountDelegate(self.plan_table))
        self.plan_table.itemChanged.connect(self._plan_amount_changed)
        self.plan_table.setMinimumHeight(150)
        v3f.addWidget(self.plan_table, 1)
        self.plan_compare_lbl = QLabel("")
        self.plan_compare_lbl.setWordWrap(True)
        v3f.addWidget(self.plan_compare_lbl)
        bar4 = QHBoxLayout()
        # V8.7.3: زر إرجاع المحدد بدل أزرار الحذف/إضافة/تعديل/توزيع
        p_return = QPushButton("↩ إرجاع المحدد")
        p_return.setObjectName("btnDangerGhost")
        p_return.setToolTip("إرجاع الدفعات المحددة إلى بنود عقد العميل")
        p_return.clicked.connect(self._plan_return_selected)
        bar4.addWidget(p_return)
        bar4.addStretch()
        v3f.addLayout(bar4)
        splitter.addWidget(left_box)

        # نسبة 56/44
        splitter.setStretchFactor(0, 56)
        splitter.setStretchFactor(1, 44)
        lay.addWidget(splitter, 1)

        # توافق خلفي: الجداول القديمة مخفية
        self.items_table = QTableWidget(0, 6)
        self.items_table.setVisible(False)
        self.chosen_table = QTableWidget(0, 5)
        self.chosen_table.setVisible(False)
        self.pulled_table = QTableWidget(0, 7)
        self.pulled_table.setVisible(False)
        self.chosen_total_lbl = QLabel("", self)  # V8.6: مستقل (لا يُكتب في scope_count)
        self.items_hidden_note = QLabel("")
        self.items_hidden_note.setVisible(False)

        # ================= شريط التنقل (أعلى) =================
        nav = QHBoxLayout()
        nav.setContentsMargins(0, 0, 0, 0)
        nav.setSpacing(6)
        self._save_btn = QPushButton("💾 حفظ")
        self._save_btn.setObjectName("btnPrimary")
        self._save_btn.setProperty("compact", True)
        self._save_btn.setMinimumHeight(28)
        self._save_btn.setMinimumWidth(80)
        self._save_btn.clicked.connect(self._save)
        cancel = QPushButton("✕ إلغاء")
        cancel.setProperty("flat", True)
        cancel.setProperty("compact", True)
        cancel.setMinimumHeight(28)
        cancel.setMinimumWidth(70)
        cancel.clicked.connect(self.reject)
        nav.addStretch()
        nav.addWidget(self._save_btn)
        nav.addWidget(cancel)
        lay.addLayout(nav)

        self._load_subs()
        self._load_customers()
        # V5.2: تعبئة المقاول تلقائيًا عند الفتح من الزر الأيمن/مركز العقد
        self._preset_sub_id = (int(preset_sub_id) if preset_sub_id else None)
        if self._preset_sub_id:
            self.sub.select_data(self._preset_sub_id)
        self.customer.selection_changed.connect(self._on_customer_changed)
        self.contract.selection_changed.connect(self._contract_changed)
        if preset_contract_id:
            self._preselect_contract(preset_contract_id)
        else:
            self.contract.set_items([], auto_select=False)

    # ================= تحميل القوائم =================
    def _load_subs(self):
        from ui.widgets import subcontractor_items
        self.sub.set_items(subcontractor_items(), auto_select=False)

    def _load_customers(self):
        from services import customer_service as cs
        self.customer.set_items([(c.name, c.id) for c in cs.list_customers()],
                                auto_select=False)

    def _on_customer_changed(self):
        customer_id = self.customer.selected_data()
        self.contract.clear()
        if not customer_id:
            self.contract.set_items([], auto_select=False)
            self.remaining_lbl.setText("")
            self._reload_items()
            self._build_plan_rows()
            return
        from services import contract_service
        contracts = contract_service.list_contracts(customer_id=customer_id)
        cust = self.customer.currentText().strip()
        rows = []
        for c in contracts:
            name = getattr(c, "contract_name", "") or c.description or ""
            core = name if name else c.contract_number
            rows.append((f"{cust} — {core}" if cust else core, c.id))
        self.contract.set_items(rows, auto_select=False)
        self._contract_changed()

    def _preselect_contract(self, contract_id):
        from services import ui_data_service as ui_data
        customer_id = ui_data.contract_customer_id(contract_id)
        if customer_id:
            self.customer.select_data(customer_id)
            QTimer.singleShot(50, lambda: self.contract.select_data(contract_id))

    def _new_sub(self):
        if not auth_service.has_permission("action_add_subcontractor"):
            style.toast(self, "إضافة مقاولي الباطن للمدير فقط.")
            return
        if SubcontractorDialog(self).exec() == QDialog.Accepted:
            self._load_subs()
            self.sub.setCurrentIndex(0)

    def _contract_changed(self):
        """تغيّر العقد ⇒ تحديث بياناته: البنود والدفعات ونصوص المتبقي."""
        # V8.6: مسح البيانات المُنزَّلة عند تغيير العقد
        self._pulled_rows.clear()
        self._pulled_source_ids.clear()
        self._selection_dirty = False
        self._scope_warn_lbl.setVisible(False)

        contract_id = self.contract.selected_data()
        if not contract_id:
            self.remaining_lbl.setText("")
            self._reload_items()
            self._build_plan_rows()
            self._load_scope_tree()
            return
        try:
            value = lc.contract_current_value(contract_id)
            subs = lc.total_sub_contracts(contract_id)
            self.remaining_lbl.setText(
                f"قيمة العقد: {value['current']:,.3f} | عقود الباطن الحالية: "
                f"{subs:,.3f} | المتبقي: {value['current'] - subs:,.3f}")
        except ValidationError:
            self.remaining_lbl.setText("")
        self._reload_items(contract_id)
        self._build_plan_rows(contract_id)

    def _items_contract_id(self):
        return self.contract.selected_data()

    # ================= ② + ③ البنود =================
    def _reload_items(self, cid=None):
        """يعبّئ جدول بنود عقد العميل (V4.5.15: بلا جدول مختار منفصل).
        
        V8.2: للعقود اليدوية (قالب مراحل/دفعات) بلا بنود، يعرض الدفعات/المراحل
        من payment_plan بدل الجدول الفارغ.
        """
        import logging
        _log = logging.getLogger("subcontractors.items")
        if cid is None:
            cid = self.contract.selected_data()
        cid = int(cid) if cid else None
        changed_contract = (getattr(self, "_items_cid", None) != cid)
        if changed_contract:
            self._chosen_ids = []
        self._items_cid = cid
        self._items = []
        self._items_by_id = {}
        self._linked_other = {}
        self._items_error = None  # V8.1: لحفظ رسالة الخطأ إن وُجد
        self._is_plan_mode = False  # V8.2: هل نعرض دفعات بدل بنود؟
        
        if cid:
            # ── قراءة البنود ──
            try:
                self._items = [dict(x) for x in lc.list_boq(cid)]
            except Exception as exc:
                _log.exception("list_boq failed for contract %s", cid)
                self._items = []
                self._items_error = str(exc)[:120]
            
            # V8.2: إذا لم توجد بنود في boq_items، نقرأ من payment_plan
            # (للعقود اليدوية فقط — التلقائي يبقى بلا بنود)
            if not self._items:
                try:
                    from database.database import get_connection
                    with get_connection() as conn:
                        # التحقق من نوع العقد
                        con = conn.execute(
                            "SELECT contract_type FROM contracts WHERE id=?",
                            (cid,)).fetchone()
                        if con:
                            ctype = (con[0] or "").strip()
                            # قراءة إعدادات النوع
                            type_row = conn.execute(
                                "SELECT manual_track FROM contract_types WHERE name=?",
                                (ctype,)).fetchone()
                            is_manual = bool(type_row and type_row[0])
                            
                            if is_manual:
                                # قراءة المراحل من payment_plan
                                plan_rows = conn.execute(
                                    "SELECT pp.*, cs.name AS stage_name "
                                    "FROM payment_plan pp "
                                    "LEFT JOIN contract_stages cs ON cs.id = pp.stage_id "
                                    "WHERE pp.contract_id=? "
                                    "ORDER BY pp.sort_order, pp.due_date",
                                    (cid,)).fetchall()
                                
                                if plan_rows:
                                    # تحويل المراحل إلى تنسيق البنود
                                    self._items = []
                                    for i, row in enumerate(plan_rows):
                                        r = dict(row)
                                        self._items.append({
                                            "id": r["id"],
                                            "description": r.get("title") or r.get("stage_name") or f"دفعة {i+1}",
                                            "title": r.get("title") or "",
                                            "stage_name": r.get("stage_name") or "",
                                            "qty": 1,
                                            "unit": "دفعة",
                                            "unit_price": float(r.get("amount") or 0),
                                            "total": float(r.get("amount") or 0),
                                            "stage_id": r.get("stage_id"),
                                            "due_date": r.get("due_date"),
                                            "notes": r.get("notes", ""),
                                            "_from_plan": True
                                        })
                                    self._is_plan_mode = True
                                    _log.info("Loaded %d payment plan items for manual contract %s",
                                             len(self._items), cid)
                except Exception as exc:
                    _log.exception("Failed to load payment_plan items for contract %s", cid)
                    # لا نغير _items_error هنا لأنها ليست خطأ حقيقي
            
            # ── قراءة البنود المرتبطة بمقاول آخر ──
            # V8.7.3: يشمل البنود الحقيقية (boq_item_id) والدفعات (source_id)
            self._linked_other = {}
            self._linked_other_sources = {}
            try:
                from database.database import get_connection
                with get_connection() as conn:
                    # البنود الحقيقية (boq_items)
                    rows = conn.execute(
                        "SELECT si.boq_item_id, s.name FROM sub_contract_items si "
                        "JOIN sub_contracts sc ON sc.id = si.sub_contract_id "
                        "JOIN subcontractors s ON s.id = sc.subcontractor_id "
                        "WHERE sc.contract_id=? AND si.boq_item_id IS NOT NULL "
                        "AND COALESCE(sc.status,'') <> 'ملغى'",
                        (cid,)).fetchall()
                    self._linked_other = {int(r[0]): (r[1] or "")
                                          for r in rows}
                    # الدفعات (source_id ل plan items)
                    rows2 = conn.execute(
                        "SELECT si.source_id, s.name FROM sub_contract_items si "
                        "JOIN sub_contracts sc ON sc.id = si.sub_contract_id "
                        "JOIN subcontractors s ON s.id = sc.subcontractor_id "
                        "WHERE sc.contract_id=? AND si.source_kind='plan' "
                        "AND si.source_id > 0 "
                        "AND COALESCE(sc.status,'') <> 'ملغى'",
                        (cid,)).fetchall()
                    self._linked_other_sources = {int(r[0]): (r[1] or "")
                                                  for r in rows2}
            except Exception as exc:
                _log.exception("linked_other query failed for contract %s", cid)
                self._linked_other = {}
                self._linked_other_sources = {}
        
        self._items_by_id = {int(x["id"]): x for x in self._items}
        if changed_contract:
            # V8.2: للدفعات، الافتراضي غير محدد (المستخدم يختار)
            if getattr(self, "_is_plan_mode", False):
                self._chosen_ids = []  # غير محدد افتراضيًا
            else:
                self._chosen_ids = [int(x["id"]) for x in self._items
                                    if int(x["id"]) not in self._linked_other]
        else:
            self._chosen_ids = [i for i in self._chosen_ids
                                if i in self._items_by_id]
        
        # V4.5.15: العقد التلقائي (قالب مراحل/دفعات) بلا بنود ⇒ يُخفى
        # صندوق البنود كاملًا ويُكتفى بدفعات عقد الباطن.
        _tpl15 = self._apply_items_visibility(cid)
        _type_name = self._client_contract_type_name(cid)
        
        if getattr(self, "_items_hidden", False):
            # V8.1: تلقائي بلا بنود ⇒ يُخفى
            _lbl = _type_name or "عقد العميل"
            self.items_hint.setText(
                f"عقد العميل من نوع «{_lbl}» (تلقائي) — البنود تُضاف "
                "تلقائيًا؛ يُكتفى بدفعات عقد الباطن أدناه.")
            self.items_hidden_note.setText(self.items_hint.text())
        elif getattr(self, "_is_plan_mode", False):
            # V8.2: يدوي له قالب بلا بنود ⇒ يعرض الدفعات للاختيار
            self.items_hint.setText(
                f"عقد العميل من نوع «{_type_name or 'يدوي'}» له قالب — "
                "علّم الدفعات/المراحل التي تعطيها لهذا المقاول "
                "(المحدد يظهر مميزًا وعدّاده أسفل الجدول).")
            # تحديث عنوان الصندوق
            box = getattr(self, "items_box", None)
            _box_title = ("② دفعات/مراحل عقد العميل — علّم الدفعات التي تعطيها لهذا المقاول")
            if box is not None:
                # V9.15.10: في شاشة الإنشاء الصندوق QWidget (لا يملك setTitle)
                # فيُحدَّث عنوانه المرئي بدلًا من ذلك؛ في التعديل QGroupBox.
                if hasattr(box, "setTitle"):
                    box.setTitle(_box_title)
                elif getattr(self, "_items_title_lbl", None) is not None:
                    self._items_title_lbl.setText(_box_title)
            # إخفاء جدول البنود المختارة (فارغ في هذه الحالة)
            ct = getattr(self, "chosen_table", None)
            if ct is not None:
                ct.setVisible(False)
            _chosen_lbl = getattr(self, "_chosen_lbl", None)
            if _chosen_lbl is not None:
                _chosen_lbl.setVisible(False)
        elif _tpl15:
            # V8.1: يدوي له قالب ⇒ يظهر ويختار يدويًا
            self.items_hint.setText(
                f"عقد العميل من نوع «{_type_name or 'يدوي'}» له قالب — "
                "اختر البنود التي تعطيها لهذا المقاول "
                "(المختار يظهر مميزًا وعدّاده أسفل الجدول).")
        elif self._items_error:
            # V8.1: خطأ في قراءة البنود
            self.items_hint.setText(
                f"⚠ تعذّر قراءة بنود عقد العميل: {self._items_error}")
        elif not self._items:
            self.items_hint.setText(
                "لا بنود على عقد العميل — يمكنك الحفظ بلا بنود. "
                "لإضافة بنود، افتح شاشة العقد الرئيسي واضفها في "
                "جدول «بنود العقد»." if cid else
                "اختر العقد الرئيسي أولًا لعرض بنوده.")
        elif self._items and len(self._chosen_ids) == 0 and self._linked_other:
            # V8.1: كل البنود عند مقاول آخر
            _names = sorted(set(self._linked_other.values()))
            _names_str = "، ".join(_names)
            self.items_hint.setText(
                f"⚠ كل بنود هذا العقد مرتبطة بمقاول آخر: {_names_str} — "
                "لا يمكن اختيار أي بند من هذه البنود.")
        else:
            self.items_hint.setText(
                "كل بنود العقد كما هي — علّم البند الذي تعطيه لهذا "
                "المقاول · البنود المرتبطة بمقاول آخر تبقى معطّلة بوسم "
                "المقاول · المختار يظهر مميزًا وعدّاده أسفل الجدول.")
        
        # V8.6: بناء الشجرة الموحدة بدلاً من الجدول القديم
        self._rebuild_unified_tree()
        self._refresh_sub_totals()


    # ================= V8.6: الشجرة الموحدة =================
    def _update_scope_warn(self):
        """شريط التنبيه في جدول النطاق: يظهر إذا كل بنود العقد عند مقاول آخر."""
        lbl = getattr(self, "_scope_warn_lbl", None)
        if lbl is None:
            return
        txt = ""
        items = getattr(self, "_items", []) or []
        linked = getattr(self, "_linked_other", {}) or {}
        if items and not getattr(self, "_is_plan_mode", False) and all(
                int(x["id"]) in linked for x in items):
            names = "، ".join(sorted(set(linked.values())))
            txt = f"⚠ كل بنود هذا العقد مرتبطة بمقاول آخر: {names}"
        lbl.setText(txt)
        lbl.setVisible(bool(txt))

    def _rebuild_unified_tree(self):
        """بناء جدول النطاق المسطّح (QTableWidget) من بنود/دفعات عقد العميل.

        V9.15.11: لا شجرة. صف مجموعة لكل مرحلة ثم بنودها (نفس شكل شاشة
        العقد الرئيسي). الحالة تُقرأ من: _pulled_source_ids (مُنزَّل ✓)،
        _linked_other (مرتبط بمقاول آخر: معطَّل) و_chosen_ids (دفعات مختارة).
        """
        from PySide6.QtCore import Qt as _Qt
        tbl = self.scope_table
        tbl.blockSignals(True)
        tbl.setRowCount(0)
        tbl.blockSignals(False)

        if not self._items:
            # لا بنود ولا دفعات: مراحل فقط إن وُجدت (كما كان)
            self._load_scope_tree(getattr(self, "_items_cid", None))
            self._update_scope_count()
            self._update_scope_warn()
            return

        tbl.blockSignals(True)
        try:
            is_plan = bool(getattr(self, "_is_plan_mode", False))
            stage_ids = set()
            for item in self._items:
                sid = item.get("stage_id")
                if sid:
                    stage_ids.add(int(sid))

            stages = {}
            if stage_ids:
                from database.database import get_connection
                with get_connection() as conn:
                    stages = {int(r["id"]): dict(r) for r in conn.execute(
                        "SELECT * FROM contract_stages WHERE id IN ("
                        + ",".join("?" * len(stage_ids)) + ")",
                        tuple(stage_ids)).fetchall()}

            items_by_stage = {}
            items_no_stage = []
            for item in self._items:
                sid = item.get("stage_id")
                if sid and int(sid) in stages:
                    items_by_stage.setdefault(int(sid), []).append(item)
                else:
                    items_no_stage.append(item)

            groups = []  # (group_chk, [child_chk, ...])
            ordered = sorted(stages, key=lambda k: (stages[k].get("sort_order") or 0, k))
            for sid in ordered:
                kids = items_by_stage.get(sid)
                if not kids:
                    continue
                st = stages[sid]
                pname = (st.get("parent_name") or "").strip()
                name = (st.get("name") or "").strip()
                label = f"{pname} › {name}" if pname and pname != name else (name or pname or "مرحلة")
                g_chk = self._add_scope_group_row(tbl, sid, label)
                kid_chks = [self._add_tree_item(tbl, it, is_plan, parent_sid=sid)
                            for it in kids]
                groups.append((g_chk, kid_chks))

            if items_no_stage:
                g_chk = self._add_scope_group_row(tbl, -1, "بنود أخرى")
                kid_chks = [self._add_tree_item(tbl, it, is_plan, parent_sid=-1)
                            for it in items_no_stage]
                groups.append((g_chk, kid_chks))

            # حالة كل مجموعة = حالة أبنائها المفعّلين
            for g_chk, kid_chks in groups:
                en = [c.checkState() for c in kid_chks
                      if c.flags() & _Qt.ItemIsEnabled]
                if not en or all(s == _Qt.Unchecked for s in en):
                    g_chk.setCheckState(_Qt.Unchecked)
                elif all(s == _Qt.Checked for s in en):
                    g_chk.setCheckState(_Qt.Checked)
                else:
                    g_chk.setCheckState(_Qt.PartiallyChecked)
        finally:
            tbl.blockSignals(False)
        self._update_scope_count()
        self._update_scope_warn()

    def _add_scope_group_row(self, tbl, sid, label):
        """صف مجموعة (مرحلة) في جدول النطاق — يُعلَّم UserRole+1 = True."""
        from PySide6.QtCore import Qt as _Qt
        from PySide6.QtGui import QColor, QFont
        r = tbl.rowCount()
        tbl.insertRow(r)
        chk = QTableWidgetItem()
        chk.setFlags(_Qt.ItemIsUserCheckable | _Qt.ItemIsEnabled)
        chk.setCheckState(_Qt.Unchecked)
        chk.setData(_Qt.UserRole, sid)
        chk.setData(_Qt.UserRole + 1, True)
        tbl.setItem(r, 0, chk)
        name = QTableWidgetItem(label)
        name.setFlags(_Qt.ItemIsEnabled | _Qt.ItemIsSelectable)
        f = QFont(name.font())
        f.setBold(True)
        name.setFont(f)
        name.setBackground(QColor("#EEF2FF"))
        tbl.setItem(r, 1, name)
        for c in (2, 3):
            cell = QTableWidgetItem("")
            cell.setBackground(QColor("#EEF2FF"))
            cell.setFlags(_Qt.ItemIsEnabled)
            tbl.setItem(r, c, cell)
        return chk

    def _add_tree_item(self, tbl, item, is_plan=False, parent_sid=None):
        """صف بند/دفعة في جدول النطاق مع حالته؛ يُعيد خانة الاختيار."""
        from PySide6.QtCore import Qt as _Qt
        from PySide6.QtGui import QColor
        iid = int(item["id"])
        taken = iid in self._linked_other
        taken_by_source = iid in getattr(self, "_linked_other_sources", {})
        is_pulled = iid in getattr(self, "_pulled_source_ids", set())

        label = item.get("description", "") or ""
        if is_plan:
            title = item.get("title", "") or item.get("description", "")
            stage = item.get("stage_name", "")
            if title and stage:
                label = f"{title} — {stage}"
            else:
                label = title or stage or f"دفعة {iid}"

        qty = float(item.get("qty") or 0)
        price = float(item.get("unit_price") or 0)
        total = float(item.get("total") or item.get("amount") or qty * price)

        r = tbl.rowCount()
        tbl.insertRow(r)
        chk = QTableWidgetItem()
        chk.setData(_Qt.UserRole, iid)
        chk.setData(_Qt.UserRole + 1, False)
        chk.setData(_Qt.UserRole + 2, parent_sid if parent_sid is not None else -1)
        name_txt = "    " + label
        name_color = None
        if taken or taken_by_source:
            # مرتبط بمقاول آخر: معطَّل (خانة ظاهرة لكن غير قابلة للتغيير)
            other = self._linked_other.get(iid) or self._linked_other_sources.get(iid, "")
            name_txt += f"  [{other}]"
            name_color = QColor("#6B7280")
            chk.setFlags(_Qt.ItemIsUserCheckable)
            chk.setCheckState(_Qt.Unchecked)
        elif is_pulled:
            name_txt += "  ✓ مُنزَّل"
            name_color = QColor("#059669")
            chk.setFlags(_Qt.ItemIsUserCheckable | _Qt.ItemIsEnabled)
            chk.setCheckState(_Qt.Checked)
        else:
            chk.setFlags(_Qt.ItemIsUserCheckable | _Qt.ItemIsEnabled)
            chosen = is_plan and iid in (getattr(self, "_chosen_ids", []) or [])
            chk.setCheckState(_Qt.Checked if chosen else _Qt.Unchecked)
        tbl.setItem(r, 0, chk)

        name = QTableWidgetItem(name_txt)
        name.setFlags(_Qt.ItemIsEnabled | _Qt.ItemIsSelectable)
        if name_color is not None:
            name.setForeground(name_color)
        tbl.setItem(r, 1, name)

        if is_plan:
            q_txt, p_txt = "", f"{total:,.3f}"
        else:
            q_txt, p_txt = f"{qty:,.3f}", f"{price:,.3f}"
        for c, txt in ((2, q_txt), (3, p_txt)):
            cell = QTableWidgetItem(txt)
            cell.setTextAlignment(_Qt.AlignCenter)
            cell.setFlags(_Qt.ItemIsEnabled | _Qt.ItemIsSelectable)
            if name_color is not None:
                cell.setForeground(name_color)
            tbl.setItem(r, c, cell)
        return chk

    def _on_tree_clicked(self, item, col):
        """النقر على عمود ↩ لإرجاع العنصر المُنزَّل."""
        if col == self.COL_RETURN:
            data = item.data(0, Qt.UserRole)
            if data:
                state = item.data(0, Qt.UserRole + 2)
                if state == self.STATE_PULLED:
                    self._uncheck_tree_item(data.get("id"))

    def _on_scope_item_changed(self, item):
        """توجيه تغييرات جدول النطاق: checkbox ← sync (V9.15.11: الأبناء المعطّلون لا يدخلون الحساب)."""
        from PySide6.QtCore import Qt as _Qt, QTimer
        if item is None or item.column() != 0:
            return
        tbl = self.scope_table
        tbl.blockSignals(True)
        try:
            is_parent = item.data(_Qt.UserRole + 1)
            if is_parent:
                parent_id = item.data(_Qt.UserRole)
                _want = item.checkState()
                for r in range(tbl.rowCount()):
                    chk = tbl.item(r, 0)
                    if (chk and chk.data(_Qt.UserRole + 2) == parent_id
                            and chk.flags() & _Qt.ItemIsEnabled):
                        chk.setCheckState(_want)
            else:
                parent_id = item.data(_Qt.UserRole + 2)
                if parent_id is not None:
                    states = set()
                    for r in range(tbl.rowCount()):
                        chk = tbl.item(r, 0)
                        if (chk and chk.data(_Qt.UserRole + 2) == parent_id
                                and chk.flags() & _Qt.ItemIsEnabled):
                            states.add(chk.checkState())
                    for r in range(tbl.rowCount()):
                        chk = tbl.item(r, 0)
                        if chk and chk.data(_Qt.UserRole) == parent_id and chk.data(_Qt.UserRole + 1):
                            if len(states) == 1:
                                chk.setCheckState(states.pop())
                            else:
                                chk.setCheckState(_Qt.PartiallyChecked)
                            break
        finally:
            tbl.blockSignals(False)
        self._update_scope_count()
        QTimer.singleShot(0, self._reconcile_pulled_checks)

    def _reconcile_pulled_checks(self):
        """بند مُنزَّل أُزيل تحديده ⇒ يُرجَع (كما كان زر ↩)."""
        from PySide6.QtCore import Qt as _Qt
        pulled = getattr(self, "_pulled_source_ids", set())
        if not pulled:
            return
        tbl = self.scope_table
        to_return = []
        for r in range(tbl.rowCount()):
            chk = tbl.item(r, 0)
            if chk is None or chk.data(_Qt.UserRole + 1):
                continue
            sid = chk.data(_Qt.UserRole)
            if sid in pulled and chk.checkState() != _Qt.Checked:
                to_return.append(int(sid))
        for sid in to_return:
            self._uncheck_tree_item(sid)

    def _on_tree_item_changed(self, item, col):
        """توجيه تغييرات الشجرة: checkbox ← sync، نص ← تحرير."""
        if col == self.COL_CHECK:
            self._sync_scope_tree(item, col)
        elif col in (self.COL_QTY, self.COL_PRICE):
            # تحرير من المفوّض
            data = item.data(0, Qt.UserRole)
            if not data:
                return
            state = item.data(0, Qt.UserRole + 2)
            if state != self.STATE_PULLED:
                return
            try:
                val = float(item.text(col).replace(",", "") or 0)
            except (ValueError, TypeError):
                return
            self._on_tree_cell_edited(item, col, val)

    def _sync_scope_tree(self, item, col):
        """مزامنة الأب/الأبناء في جدول النطاق (QTableWidget)."""
        if col != self.COL_CHECK:
            return
        tbl = self.scope_table
        tbl.blockSignals(True)
        try:
            row = item.row()
            is_parent = item.data(Qt.UserRole + 1)
            if is_parent:
                parent_id = item.data(Qt.UserRole)
                _want = item.checkState()
                for r in range(tbl.rowCount()):
                    chk = tbl.item(r, 0)
                    if chk and chk.data(Qt.UserRole + 2) == parent_id:
                        chk.setCheckState(_want)
            else:
                parent_id = item.data(Qt.UserRole + 2)
                if parent_id:
                    states = set()
                    for r in range(tbl.rowCount()):
                        chk = tbl.item(r, 0)
                        if chk and chk.data(Qt.UserRole + 2) == parent_id:
                            states.add(chk.checkState())
                    for r in range(tbl.rowCount()):
                        chk = tbl.item(r, 0)
                        if chk and chk.data(Qt.UserRole) == parent_id and chk.data(Qt.UserRole + 1):
                            if len(states) == 1:
                                chk.setCheckState(states.pop())
                            else:
                                chk.setCheckState(Qt.PartiallyChecked)
                            break
        finally:
            tbl.blockSignals(False)
        self._update_scope_count()
        self._update_scope_warn()

    def _pull_selected(self):
        """⬇ ربط المحدد من جدول النطاق إلى صفوف عقد الباطن (V9.15.11)."""
        selected = self._scope_selection()
        if not selected:
            style.toast(self, "لم تحدد أي عنصر في الجدول.")
            return

        kind = "plan" if getattr(self, "_is_plan_mode", False) else "boq"
        existing = self._pulled_source_ids
        linked = getattr(self, "_linked_other", {}) or {}
        added = 0
        for item in selected:
            if item.get("is_parent"):
                continue  # صف المرحلة ليس بندًا
            item_id = int(item.get("id") or 0)
            if not item_id or item_id not in self._items_by_id:
                continue
            if item_id in existing or item_id in linked:
                continue

            if kind == "boq":
                row = self._make_pulled_row_from_boq(item_id)
                if row:
                    self._pulled_rows.append(row)
                    self._pulled_source_ids.add(item_id)
                    added += 1
            else:
                row = self._make_pulled_row_from_plan(item_id, self._items_by_id.get(item_id, {}))
                if row:
                    self._pulled_rows.append(row)
                    self._pulled_source_ids.add(item_id)
                    added += 1
                    if item_id not in self._chosen_ids:
                        self._chosen_ids.append(item_id)

        if added:
            style.toast(self, f"تم ربط {added} عنصر جديد.")
        else:
            style.toast(self, "كل العناصر المحددة مرتبطة مسبقاً.")

        self._rebuild_unified_tree()
        self._refresh_pulled_totals()
        if getattr(self, "_is_plan_mode", False):
            self._build_plan_rows()

    def _set_scope_all(self, on: bool):
        """تحديد/إلغاء الكل في جدول النطاق (المعطّلون لا يتغيّرون)."""
        from PySide6.QtCore import Qt as _Qt, QTimer
        tbl = self.scope_table
        tbl.blockSignals(True)
        for r in range(tbl.rowCount()):
            chk = tbl.item(r, 0)
            if chk and chk.flags() & _Qt.ItemIsEnabled:
                chk.setCheckState(_Qt.Checked if on else _Qt.Unchecked)
        tbl.blockSignals(False)
        self._update_scope_count()
        QTimer.singleShot(0, self._reconcile_pulled_checks)

    def _uncheck_tree_item(self, source_id):
        """إلغاء تحديد عنصر وإرجاعه من المُنزَّل."""
        if source_id in self._pulled_source_ids:
            self._pulled_source_ids.discard(source_id)
            # إزالة من _pulled_rows
            self._pulled_rows = [r for r in self._pulled_rows
                                  if r.get("source_id") != source_id]
            # إزالة من _chosen_ids (وضع الخطة)
            if source_id in self._chosen_ids:
                self._chosen_ids.remove(source_id)
            self._rebuild_unified_tree()
            self._refresh_pulled_totals()
            if getattr(self, "_is_plan_mode", False):
                self._build_plan_rows()

    def _on_tree_cell_edited(self, item, col, val):
        """تحديث _pulled_rows عند تحرير الكمية/سعر في الشجرة."""
        data = item.data(0, Qt.UserRole)
        if not data:
            return
        source_id = data.get("id")
        for row in self._pulled_rows:
            if row.get("source_id") == source_id:
                if col == self.COL_QTY:
                    row["qty"] = float(val or 0)
                elif col == self.COL_PRICE:
                    row["unit_price"] = float(val or 0)
                row["amount"] = float(row.get("qty", 0) or 0) * float(row.get("unit_price", 0) or 0)
                # تحديث عمود الإجمالي
                item.setText(self.COL_TOTAL, f"{row['amount']:,.3f}")
                break
        self._refresh_pulled_totals()

    def _refresh_pulled_totals(self):
        """تحديث مجموع المُنزَّل وقيمة عقد الباطن."""
        total = sum(float(r.get("amount", 0) or 0) for r in self._pulled_rows)
        self.pulled_total_lbl.setText(f"مجموع المُنزَّل: {total:,.3f} د.ك")
        if self._pulled_rows:
            self.amount.setValue(total)

    def _pulled_items_data(self):
        """بيانات البنود المُنزَّلة للحفظ."""
        return [{
            "source_kind": r.get("source_kind", ""),
            "source_id": r.get("source_id", 0),
            "boq_item_id": r.get("boq_item_id"),
            "qty": r.get("qty", 0),
            "unit_price": r.get("unit_price", 0),
            "amount": r.get("amount", 0),
        } for r in self._pulled_rows]

    def _selected_item_ids(self):
        """توافق خلفي: معرفات البنود المحددة."""
        if self._pulled_rows:
            return [r.get("boq_item_id") for r in self._pulled_rows
                    if r.get("boq_item_id")]
        return [i for i in self._chosen_ids if i in self._items_by_id]

    def _fill_items_table(self):
        """V8.6: معطّلة — الشجرة الموحدة تحل محلها."""
        pass

    def _on_item_toggled(self, item):
        """V8.6: معطّلة — الشجرة الموحدة تحل محلها."""
        pass

    def _on_pulled_cell_changed(self, row, col):
        """V8.6: معطّلة — الشجرة الموحدة تحل محلها."""
        pass

    def _remove_pulled_row(self, row_idx):
        """V8.6: معطّلة — الإرجاع عبر زر ↩ في الشجرة."""
        pass

    def _fill_pulled_table(self):
        """V8.6: معطّلة — الشجرة الموحدة تحل محلها."""
        pass


    # ================= ③ الدفعات =================
    def _build_plan_rows(self, cid=None):
        """صفوف الدفعات = دفعات عقد العميل نفسها — والمبالغ فارغة يدويًا.
        
        V8.2: في وضع الخطة (الدفعات)، يبني الدفعات من العناصر المحددة فقط.
        """
        if cid is None:
            cid = self.contract.selected_data()
        self._plan_rows = []
        self._client_lines = {}
        if not cid:
            self._plan_note = "اختر عقد العميل لعرض دفعاته."
            self._fill_plan_table()
            return
        
        try:
            lines = [dict(x) for x in lc.contract_payment_plan(int(cid))]
        except Exception:
            lines = []
        self._client_lines = {int(x["id"]): x for x in lines}
        
        if not lines:
            self._plan_note = ("لا دفعات على عقد العميل — أضف صفوف الدفعات "
                               "يدويًا من «＋ إضافة دفعة».")
            self._fill_plan_table()
            return
        
        # V8.2: في وضع الخطة، نبني الدفعات من العناصر المحددة فقط
        if getattr(self, "_is_plan_mode", False):
            # فلترة الدفعات المحددة فقط
            selected_lines = []
            for ln in lines:
                if int(ln["id"]) in self._chosen_ids:
                    selected_lines.append(ln)
            
            if not selected_lines:
                self._plan_note = ("لم تحدد أي دفعة — علّم الدفعات في الجدول العلوي "
                                   "ثم اضغط «⚖ توزيع تلقائي» أو اكتب القيم يدويًا.")
                self._fill_plan_table()
                return
            
            for i, ln in enumerate(selected_lines, 1):
                skipped = int(ln.get("linked_stage_skipped") or 0)
                # استخدام الدالة الآلية لتوليد العنوان بالعربية
                try:
                    from services.workflow_service import _plan_title_for
                    _title = _plan_title_for(i, {"title": f"دفعة {i}"})
                except Exception:
                    _title = f"الدفعة {i}"
                self._plan_rows.append({
                    "title": _title,
                    "stage_id": None if skipped else ln.get("stage_id"),
                    "stage_name": ln.get("stage_name") or "",
                    "due": (ln.get("due_date") or "")[:10],
                    "amount": 0.0,
                    "sources": [int(ln["id"])],
                })
            
            note = ("الدفعات المحددة ظاهرة أدناه — اكتب قيمة كل دفعة في خانة "
                    "«قيمة الدفعة»، أو اضغط «⚖ توزيع تلقائي» ليقسّم قيمة عقد "
                    "الباطن عليها بنسب دفعات العميل.")
        else:
            # الوضع العادي: كل الدفعات
            for i, ln in enumerate(lines, 1):
                skipped = int(ln.get("linked_stage_skipped") or 0)
                # استخدام الدالة الآلية لتوليد العنوان بالعربية
                try:
                    from services.workflow_service import _plan_title_for
                    _title = _plan_title_for(i, {"title": f"دفعة {i}"})
                except Exception:
                    _title = f"الدفعة {i}"
                self._plan_rows.append({
                    "title": _title,
                    "stage_id": None if skipped else ln.get("stage_id"),
                    "stage_name": ln.get("stage_name") or "",
                    "due": (ln.get("due_date") or "")[:10],
                    "amount": 0.0,
                    "sources": [int(ln["id"])],
                })
            note = ("دفعات عقد العميل ظاهرة أدناه — اكتب قيمة كل دفعة في خانة "
                    "«قيمة الدفعة»، أو اضغط «⚖ توزيع تلقائي» ليقسّم قيمة عقد "
                    "الباطن عليها بنسب دفعات العميل.")
        
        missing = lc.sub_plan_autolink_guard(int(cid))
        if missing:
            note = "⚠ " + " · ".join(missing) + "\n" + note
        self._plan_note = note
        self._fill_plan_table()

    def _fill_plan_table(self):
        from ui.contracts import _PLAN_AMOUNT_HINT, _paint_amount_hint
        from ui.widgets import MONEY_ALIGN, sync_header_alignment
        t = self.plan_table
        t.blockSignals(True)
        t.setRowCount(len(self._plan_rows))
        for r, row in enumerate(self._plan_rows):
            amt = float(row.get("amount") or 0)
            _txt, _col, _tip = _client_state_cell(
                self._client_lines, row.get("sources"))
            # Column 0: checkbox
            chk = QTableWidgetItem()
            chk.setFlags(Qt.ItemIsEnabled | Qt.ItemIsSelectable
                         | Qt.ItemIsUserCheckable)
            chk.setCheckState(Qt.Unchecked)
            chk.setTextAlignment(Qt.AlignCenter)
            t.setItem(r, 0, chk)
            # Columns 1-6: data
            vals = [str(r + 1), row.get("title") or "",
                    row.get("stage_name") or "—", "", row.get("due") or "",
                    _txt]
            for c, v in enumerate(vals):
                col = c + 1  # shift by 1
                if c == 3:  # amount column
                    cell = QTableWidgetItem("")
                    cell.setFlags(Qt.ItemIsEnabled | Qt.ItemIsSelectable
                                  | Qt.ItemIsEditable)
                    cell.setTextAlignment(MONEY_ALIGN)
                    if amt > 0:
                        cell.setText(f"{amt:,.3f}")
                        cell.setForeground(QColor(
                            getattr(style, "TEXT", "") or "#1F2937"))
                    else:
                        cell.setText(_PLAN_AMOUNT_HINT)
                        _paint_amount_hint(cell)
                else:
                    cell = QTableWidgetItem(str(v))
                    cell.setFlags(Qt.ItemIsEnabled | Qt.ItemIsSelectable)
                    cell.setTextAlignment(Qt.AlignCenter)
                    if c == 5:
                        cell.setForeground(QColor(_col))
                        cell.setToolTip(_tip)
                t.setItem(r, col, cell)
        t.blockSignals(False)
        sync_header_alignment(t)
        self._fit_columns(t, 1)
        self._refresh_plan_totals()

    def _refresh_plan_totals(self):
        total = sum(float(x.get("amount") or 0) for x in self._plan_rows)
        empty = sum(1 for x in self._plan_rows
                    if float(x.get("amount") or 0) <= 0)
        parts = [f"مجموع الدفعات: {total:,.3f} د.ك · عدد الدفعات: "
                 f"{len(self._plan_rows)}"]
        if empty:
            parts.append(f"⚠ {empty} دفعة بلا قيمة")
        self.plan_hint.setText(
            (self._plan_note + "\n" if self._plan_note else "") + " · ".join(parts))
        self._refresh_plan_compare(total)

    def _plan_amount_changed(self, item):
        """V4.5.11: خانة قيمة الدفعة — أرقام فقط و«تُحدد لاحقًا» إرشادية."""
        from ui.contracts import _PLAN_AMOUNT_HINT, _normalize_amount_text
        from ui.contracts import _paint_amount_hint
        if item is None or item.column() != 4:
            return
        r = item.row()
        if r < 0 or r >= len(self._plan_rows):
            return
        raw = _normalize_amount_text(item.text())
        if _PLAN_AMOUNT_HINT in str(item.text() or ""):
            raw = ""
        val = None
        if raw:
            try:
                val = float(raw)
            except Exception:
                val = None
        self.plan_table.blockSignals(True)
        try:
            if val is None:
                cur = float(self._plan_rows[r].get("amount") or 0)
                if raw and cur > 0:
                    item.setText(f"{cur:,.3f}")
                else:
                    item.setText(_PLAN_AMOUNT_HINT)
                    _paint_amount_hint(item)
            elif val <= 0:
                self._plan_rows[r]["amount"] = 0.0
                item.setText(_PLAN_AMOUNT_HINT)
                _paint_amount_hint(item)
            else:
                self._plan_rows[r]["amount"] = round(val, 3)
                item.setText(f"{val:,.3f}")
                item.setForeground(QColor(getattr(style, "TEXT", "") or "#1F2937"))
        finally:
            self.plan_table.blockSignals(False)
        self._refresh_plan_totals()

    def _plan_selected(self):
        r = self.plan_table.currentRow()
        if r < 0 or r >= len(self._plan_rows):
            return None
        return r

    def _contract_stages(self, cid):
        try:
            from database.database import get_connection
            with get_connection() as conn:
                return [dict(r) for r in conn.execute(
                    "SELECT id, name, is_skipped, end_date, level, "
                    "parent_name FROM contract_stages WHERE contract_id=? "
                    "ORDER BY sort_order, id", (int(cid),)).fetchall()]
        except Exception:
            return []

    def _stage_name(self, cid, stage_id):
        if not stage_id:
            return "—"
        for s in self._contract_stages(cid):
            if int(s["id"]) == int(stage_id):
                return s["name"]
        return "—"

    def _plan_add(self):
        from ui.sub_plan_editor import SubPlanLineDialog
        cid = self.contract.selected_data()
        dlg = SubPlanLineDialog(self, cid, title="إضافة دفعة مقاول")
        if dlg.exec() != QDialog.Accepted:
            return
        title, due, amount, stage_id = dlg.values()
        if not title or amount <= 0:
            style.error(self, "عنوان الدفعة ومبلغها مطلوبان.")
            return
        self._plan_rows.append({
            "title": title, "due": due, "amount": amount,
            "stage_id": stage_id, "sources": dlg.sources(),
            "stage_name": self._stage_name(cid, stage_id)})
        self._fill_plan_table()

    def _plan_edit(self):
        r = self._plan_selected()
        if r is None:
            style.info(self, "اختر سطرًا من الجدول أولاً.")
            return
        from ui.sub_plan_editor import SubPlanLineDialog
        cid = self.contract.selected_data()
        row = self._plan_rows[r]
        dlg = SubPlanLineDialog(
            self, cid,
            line={"title": row.get("title"), "due_date": row.get("due"),
                  "amount": row.get("amount") or 1,
                  "stage_id": row.get("stage_id")},
            sources=row.get("sources") or [], title="تعديل دفعة مقاول")
        if dlg.exec() != QDialog.Accepted:
            return
        title, due, amount, stage_id = dlg.values()
        row.update({"title": title, "due": due, "amount": amount,
                    "stage_id": stage_id, "sources": dlg.sources(),
                    "stage_name": self._stage_name(cid, stage_id)})
        self._fill_plan_table()

    def _plan_del(self):
        r = self._plan_selected()
        if r is None:
            style.info(self, "اختر سطرًا من الجدول أولاً.")
            return
        self._plan_rows.pop(r)
        self._fill_plan_table()

    def _plan_return_selected(self):
        """V8.7.8: إرجاع الدفعات المحددة بالتشيك بوكس."""
        t = self.plan_table
        selected_rows = []
        for r in range(t.rowCount()):
            chk = t.item(r, 0)
            if chk and chk.checkState() == Qt.Checked:
                selected_rows.append(r)
        selected_rows.sort(reverse=True)
        if not selected_rows:
            style.info(self, "اختر دفعة من الجدول (✔) لإرجاعها.")
            return

        # جمع الـ source_ids للدفعات المحددة
        sources_to_return = []
        for r in selected_rows:
            if r < len(self._plan_rows):
                row = self._plan_rows[r]
                for sid in row.get("sources", []):
                    sources_to_return.append(sid)

        # إرجاع من pulled
        for sid in sources_to_return:
            if sid in self._pulled_source_ids:
                self._pulled_source_ids.discard(sid)
                self._pulled_rows = [r for r in self._pulled_rows
                                      if r.get("source_id") != sid]
            if sid in self._chosen_ids:
                self._chosen_ids.remove(sid)

        # حذف الصفوف
        for r in selected_rows:
            if r < len(self._plan_rows):
                self._plan_rows.pop(r)

        self._fill_plan_table()
        self._rebuild_unified_tree()
        self._refresh_pulled_totals()
        style.toast(self, f"تم إرجاع {len(selected_rows)} دفعة.")

    def _plan_distribute(self):
        """⚖ توزيع تلقائي: يملأ المبالغ بنسبة دفعات العميل (اختياري)."""
        cid = self.contract.selected_data()
        if not cid:
            style.info(self, "اختر عقد العميل أولاً.")
            return
        try:
            total = float(self.amount.value() or 0)
        except Exception:
            total = 0.0
        if total <= 0:
            # V5.6: مساعدة صريحة — يمكن اعتماد مجموع دفعات العميل قيمةً
            _ct = 0.0
            try:
                _ct = round(sum(float(x.get("amount") or 0)
                                for x in (self._client_lines or {}).values()), 3)
            except Exception:
                _ct = 0.0
            if _ct > 0 and style.confirm(
                    self,
                    "قيمة عقد الباطن غير مكتوبة.\n\nهل أستخدم مجموع "
                    f"دفعات عقد العميل ({_ct:,.3f} د.ك) قيمةً لعقد الباطن "
                    "ثم أوزّع الدفعات؟", "توزيع تلقائي"):
                self.amount.setValue(_ct)
                total = _ct
            else:
                style.info(
                    self, "اكتب «قيمة عقد الباطن» أولًا ليتم التوزيع "
                    + ("(أو وافق على استخدام مجموع دفعات العميل)."
                       if _ct > 0 else
                       "(لا مبالغ مكتوبة على دفعات العميل بعد)."))
                return
        try:
            _boq = self._selected_item_ids() or None
            rows = [dict(x) for x in lc.sub_plan_preview(
                int(cid), total, self.end.date().toString("yyyy-MM-dd"),
                boq_item_ids=_boq)]
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
            return
        if not rows:
            style.info(self, "لا توجد دفعات على عقد العميل — "
                             "أضف خطة دفعات العميل أولًا.")
            return
        if self._plan_rows and not style.confirm(
                self, "سيُعاد بناء صفوف الدفعات بالتوزيع التلقائي ويُلغى "
                      "تعديلك الحالي — متابعة؟", "توزيع تلقائي"):
            return
        self._plan_rows = []
        for x in rows:
            self._plan_rows.append({
                "id": None, "title": x.get("title") or "دفعة",
                "due": x.get("due") or "",
                "amount": float(x.get("amount") or 0),
                "stage_id": x.get("stage_id"),
                "stage_name": self._stage_name(cid, x.get("stage_id")),
                "sources": [int(s2) for s2 in (x.get("sources") or [])]})
        self._fill_plan_table()

    # ================= الحفظ =================
    def accept(self):  # noqa: N802
        """لا تغلق النافذة إلا بعد نجاح التحقق والحفظ."""
        self._save()

    def _validate(self) -> bool:
        from ui.widgets import RequiredValidator
        v = RequiredValidator(self)
        v.add(self.sub, "مقاول الباطن")
        v.add(self.customer, "العميل")
        v.add(self.contract, "العقد الرئيسي")
        v.add(self.amount, "قيمة عقد الباطن", min_value=0.001)
        if not v.validate():
            return False
        for i, row in enumerate(self._plan_rows, 1):
            name = row.get("title") or f"دفعة {i}"
            if not (row.get("sources") or []):
                style.error(self, f"الدفعة «{name}» بلا دفعة عميل — "
                                  "احذفها وأضفها من «＋ إضافة دفعة».")
                return False
            if float(row.get("amount") or 0) <= 0:
                style.error(self, f"الدفعة «{name}» بلا قيمة — اكتب قيمتها "
                                  "في خانة «قيمة الدفعة» أو احذف صفها.")
                return False
        return True

    def _save(self):
        if not self._validate():
            return
        sub_id = self.sub.selected_data()
        contract_id = self.contract.selected_data()

        from services import ui_data_service as ui_data
        from ui import style as _style

        # V2.50: تعدد المقاولين مسموح — نفس العقد يقبل أكثر من مقاول.
        # يبقى المنع فقط لتكرار (نفس المقاول + نفس العقد).
        if ui_data.sub_contract_duplicate(sub_id, contract_id):
            if not _style.confirm(
                    self,
                    "هذا المقاول لديه عقد آخر مع نفس العميل.\n"
                    "هل تريد إضافة عقد باطن جديد للمقاول؟",
                    "إنشاء عقد باطن جديد"):
                return
        # تحذير (لا منع) عند تجاوز مجموع المقاولين قيمة العقد
        try:
            _val = lc.contract_current_value(contract_id)
            _subs = lc.total_sub_contracts(contract_id)
            _new_total = _subs + self.amount.value()
            if _new_total > _val["current"] + 1e-9:
                if not _style.confirm(
                        self,
                        "⚠️ مجموع عقود الباطن "
                        f"({_new_total:,.3f}) سيتجاوز قيمة العقد ("
                        f"{_val['current']:,.3f}).\nهل تريد المتابعة؟",
                        "تجاوز قيمة العقد"):
                    return
        except ValidationError:
            pass

        project_id = ui_data.contract_project_id(contract_id)
        sid = None
        try:
            # V8.3: تحديد ما إذا كان هناك بنود مُنزَّلة
            pulled_data = self._pulled_items_data() if getattr(self, "_pulled_rows", None) else None
            
            sid = lc.add_sub_contract(
                sub_id, contract_id, project_id, self.amount.value(),
                self.start.date().toString("yyyy-MM-dd"),
                self.end.date().toString("yyyy-MM-dd"),
                self.description.toPlainText(),
                boq_item_ids=self._selected_item_ids())
            
            # V8.3: حفظ البنود المُنزَّلة مع البيانات الكاملة
            if pulled_data:
                lc.set_sub_contract_items(int(sid), pulled_items=pulled_data)
            
            _n_lines = 0
            for row in self._plan_rows:
                lid = lc.add_sub_plan_line(
                    int(sid), row.get("title") or "دفعة",
                    row.get("due") or "", float(row.get("amount") or 0),
                    row.get("stage_id"))
                lc.set_sub_line_sources(lid, row.get("sources") or [])
                _n_lines += 1
            if _n_lines:
                try:
                    from services.lifecycle_service import log_event
                    log_event(int(contract_id), "خطة دفعات باطن",
                              f"إنشاء عقد المقاول · {_n_lines} دفعات "
                              "ومصادرها")
                except Exception:
                    pass
            _n_items = len(pulled_data) if pulled_data else len(self._selected_item_ids())
            _style.success(
                self, "تم إضافة عقد الباطن بنجاح"
                + (f" · {_n_items} بنود · "
                   f"{_n_lines} دفعات مربوطة بمصادرها" if _n_lines else
                   " (بلا خطة دفعات)"))
            QDialog.accept(self)
        except (ValidationError, DatabaseError) as exc:
            # فشل جزئي: نظّف المتبقي حتى لا يبقى عقد بلا خطة أو سطور يتيمة.
            if sid:
                try:
                    for ln in lc.sub_payment_plan(int(sid)):
                        lc.delete_sub_plan_line(int(ln["id"]))
                except Exception:
                    pass
                try:
                    lc.delete_sub_contract(int(sid))
                except Exception:
                    pass
            _style.error(self, str(exc))


class EditSubContractDialog(_SubContractItemsMixin, QDialog):
    """V4.5.11: تعديل عقد باطن — شاشة واحدة بنفس ترتيب شاشة الإنشاء.

    ① بيانات العقد · ② بنود عقد العميل (التعليم داخل الجدول) ·
    ③ دفعات عقد الباطن (المبالغ تُعدَّل مباشرة) — بلا صندوق «بنود مختارة».
    """

    def __init__(self, parent, sub_contract: dict):
        super().__init__(parent)
        self.sc = sub_contract
        self.sub_id = int(sub_contract["id"])
        self.contract_id = int(sub_contract.get("contract_id") or 0)
        if not self.contract_id:                 # حماية عند قدوم صف ناقص
            _row = lc.get_sub_contract(self.sub_id) or {}
            self.contract_id = int(_row.get("contract_id") or 0)
        self.setWindowTitle(f"تعديل عقد الباطن · {sub_contract['sub_name']} — V8.1")
        self.setLayoutDirection(Qt.RightToLeft)
        self.setMinimumSize(960, 680)
        self.resize(1160, 840)

        self._items: list[dict] = []
        self._items_by_id: dict[int, dict] = {}
        self._linked_other: dict[int, str] = {}
        self._chosen_ids: list[int] = []
        self._plan_note = ""

        root = QVBoxLayout(self)
        root.setSpacing(8)
        from PySide6.QtWidgets import QScrollArea
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        page = QWidget()
        lay = QVBoxLayout(page)
        lay.setSpacing(10)
        scroll.setWidget(page)
        root.addWidget(scroll, 1)

        from PySide6.QtWidgets import QGridLayout, QGroupBox
        box1 = QGroupBox("① بيانات عقد الباطن")
        g = QGridLayout(box1)
        g.setHorizontalSpacing(10)
        g.setVerticalSpacing(7)
        info = QLabel(f"المقاول: {sub_contract['sub_name']} · العقد الرئيسي: "
                      f"{sub_contract['contract_number']}")
        info.setProperty("hint", True)
        try:
            from services import workflow_service as _wf
            from ui.followup import StageBar
            stage_bar = (StageBar(self, "subcontract", self.sub_id)
                         if _wf.get_stages("subcontract") else None)
        except Exception:
            stage_bar = None
        self.amount = SafeDoubleSpinBox()
        self.amount.setRange(0, 1e9)
        self.amount.setDecimals(3)
        self.amount.setGroupSeparatorShown(True)
        self.amount.setValue(float(sub_contract["amount"]))
        self.amount.valueChanged.connect(lambda *_: self._update_value_check())
        self.amount.valueChanged.connect(
            lambda *_: self._refresh_plan_compare())
        self.start = SafeDateEdit()
        self.start.setCalendarPopup(True)
        self.start.setDisplayFormat("yyyy-MM-dd")
        self.start.setDate(
            QDate.fromString(sub_contract.get("start_date") or "", "yyyy-MM-dd")
            if sub_contract.get("start_date") else QDate.currentDate())
        self.end = SafeDateEdit()
        self.end.setCalendarPopup(True)
        self.end.setDisplayFormat("yyyy-MM-dd")
        self.end.setDate(
            QDate.fromString(sub_contract.get("end_date") or "", "yyyy-MM-dd")
            if sub_contract.get("end_date") else QDate.currentDate().addMonths(6))
        self.description = QTextEdit()
        self.description.setFixedHeight(56)
        self.description.setPlainText(sub_contract.get("description") or "")
        from PySide6.QtWidgets import QComboBox
        self.status = QComboBox()
        make_searchable(self.status, "")
        self.status.addItems(["نشط", "متوقف", "منتهي", "ملغى"])
        self.status.setCurrentText(sub_contract.get("status") or "نشط")
        self.cancel_close_amount = SafeDoubleSpinBox()
        self.cancel_close_amount.setRange(0, 1e9)
        self.cancel_close_amount.setDecimals(3)
        self.cancel_close_amount.setGroupSeparatorShown(True)
        self.cancel_close_amount.setValue(
            float(sub_contract.get("cancel_close_amount") or 0))
        self.cancel_reason = QTextEdit()
        self.cancel_reason.setFixedHeight(60)
        self.cancel_reason.setPlaceholderText(
            "سبب إلغاء عقد الباطن / التوضيح للتدقيق...")
        self.cancel_reason.setPlainText(sub_contract.get("cancel_reason") or "")
        self.status.currentTextChanged.connect(self._toggle_cancel_rows)

        g.addWidget(info, 0, 0, 1, 6)
        if stage_bar is not None:
            g.addWidget(stage_bar, 1, 0, 1, 6)
        g.addWidget(QLabel(required_label("قيمة العقد")), 2, 0)
        g.addWidget(self.amount, 2, 1)
        g.addWidget(QLabel("الحالة"), 2, 2)
        g.addWidget(self.status, 2, 3)
        g.addWidget(QLabel("تاريخ البداية"), 3, 0)
        g.addWidget(self.start, 3, 1)
        g.addWidget(QLabel("تاريخ النهاية"), 3, 2)
        g.addWidget(self.end, 3, 3)
        g.addWidget(QLabel("الوصف"), 4, 0)
        g.addWidget(self.description, 4, 1, 1, 5)
        self.cancel_close_label = QLabel("مبلغ إغلاق الإلغاء")
        self.cancel_reason_label = QLabel("سبب الإلغاء")
        g.addWidget(self.cancel_close_label, 5, 0)
        g.addWidget(self.cancel_close_amount, 5, 1)
        g.addWidget(self.cancel_reason_label, 5, 2)
        g.addWidget(self.cancel_reason, 5, 3, 1, 3)
        self._toggle_cancel_rows(self.status.currentText())
        g.setColumnStretch(1, 2)
        g.setColumnStretch(3, 3)
        lay.addWidget(box1)

        # ================= ② بنود عقد العميل (V4.5.15) =================
        # صندوق واحد: كل بنود العقد كما هي + التعليم داخل الجدول نفسه.
        # يُخفى كاملًا إذا كان عقد العميل من نوع «تلقائي» (قالب مراحل).
        box2 = QGroupBox(
            "② بنود عقد العميل — علّم البند الذي تعطيه لهذا المقاول")
        v2 = QVBoxLayout(box2)
        self.items_hint = QLabel("اختر عقد العميل أولًا لعرض بنوده.")
        self.items_hint.setWordWrap(True)
        self.items_hint.setProperty("hint", True)
        self.items_hint.setVisible(False)  # V8.3: إخفاء — النص واضح
        v2.addWidget(self.items_hint)
        self.items_table = QTableWidget(0, 6)
        self.items_table.setHorizontalHeaderLabels(
            ["✔", "البند", "الكمية", "الوحدة", "سعر الوحدة", "الإجمالي"])
        self.items_table.verticalHeader().setVisible(False)
        self.items_table.setSelectionBehavior(QTableWidget.SelectRows)
        self.items_table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.items_table.setAlternatingRowColors(True)
        self.items_table.setMinimumHeight(150)
        self.items_table.itemChanged.connect(self._on_item_toggled)
        v2.addWidget(self.items_table)
        bar2 = QHBoxLayout()
        self.items_total_lbl = QLabel("")
        self.items_total_lbl.setStyleSheet("font-weight: 800;")
        self.items_total_lbl.setWordWrap(True)
        # توافق خلفي: الاسم القديم يشير لنفس التسمية (كان في صندوق ③)
        self.chosen_total_lbl = self.items_total_lbl
        b_all = QPushButton("✔ تحديد الكل")
        b_all.setProperty("flat", True)
        b_all.clicked.connect(lambda: self._check_all(True))
        b_none = QPushButton("✕ إلغاء الكل")
        b_none.setProperty("flat", True)
        b_none.clicked.connect(lambda: self._check_all(False))
        bar2.addWidget(self.items_total_lbl)
        bar2.addStretch()
        bar2.addWidget(b_all)
        bar2.addWidget(b_none)
        v2.addLayout(bar2)
        # V6.6: جدول البنود المختارة
        self.chosen_table = QTableWidget(0, 5)
        self.chosen_table.setHorizontalHeaderLabels(
            ["البند", "الكمية", "الوحدة", "سعر الوحدة", "الإجمالي"])
        self.chosen_table.verticalHeader().setVisible(False)
        self.chosen_table.setSelectionBehavior(QTableWidget.SelectRows)
        self.chosen_table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.chosen_table.setAlternatingRowColors(True)
        self.chosen_table.setMinimumHeight(60)
        self.chosen_table.setMaximumHeight(140)
        _chosen_lbl = QLabel("▼ البنود المختارة لهذا المقاول:")
        _chosen_lbl.setProperty("hint", True)
        v2.addWidget(_chosen_lbl)
        v2.addWidget(self.chosen_table)
        self.items_box = box2
        lay.addWidget(box2)

        # V5.3: إن خُفي صندوق البنود (نوع له قالب) يبقى التنبيه ظاهرًا فوق
        # صندوق الدفعات، ويُعاد ترقيم صندوق الدفعات إلى «②» بلا فراغ.
        self.items_hidden_note = QLabel("")
        self.items_hidden_note.setWordWrap(True)
        self.items_hidden_note.setProperty("hint", True)
        self.items_hidden_note.setVisible(False)
        lay.addWidget(self.items_hidden_note)

        box3e = QGroupBox("③ دفعات عقد الباطن — المبالغ تُعدَّل مباشرة")
        self.plan_box = box3e
        v3e = QVBoxLayout(box3e)
        self.plan_hint = QLabel("")
        self.plan_hint.setWordWrap(True)
        self.plan_hint.setProperty("hint", True)
        self.plan_hint.setVisible(False)  # V8.3: إخفاء — معلومة تقنية
        v3e.addWidget(self.plan_hint)
        from ui.contracts import _PlanAmountDelegate
        self.plan_table = QTableWidget(0, 7)
        self.plan_table.setHorizontalHeaderLabels(
            ["✔", "#", "الدفعة", "المرحلة", "قيمة الدفعة", "الاستحقاق",
             "حالة دفعة العميل"])
        self.plan_table.verticalHeader().setVisible(False)
        self.plan_table.setSelectionBehavior(QTableWidget.SelectRows)
        self.plan_table.setSelectionMode(QTableWidget.SingleSelection)
        self.plan_table.setAlternatingRowColors(True)
        self.plan_table.setEditTriggers(
            QTableWidget.DoubleClicked | QTableWidget.EditKeyPressed
            | QTableWidget.SelectedClicked)
        self.plan_table.setItemDelegateForColumn(
            3, _PlanAmountDelegate(self.plan_table))
        self.plan_table.itemChanged.connect(self._plan_amount_changed)
        self.plan_table.setMinimumHeight(150)
        v3e.addWidget(self.plan_table)
        # V5.6 ③: سطر المقارنة نفسه في حوار التعديل
        self.plan_compare_lbl = QLabel("")
        self.plan_compare_lbl.setWordWrap(True)
        v3e.addWidget(self.plan_compare_lbl)
        bar4 = QHBoxLayout()
        # V8.7.3: زر إرجاع المحدد فقط
        p_return = QPushButton("↩ إرجاع المحدد")
        p_return.setObjectName("btnDangerGhost")
        p_return.setToolTip("إرجاع الدفعات المحددة إلى بنود عقد العميل")
        p_return.clicked.connect(self._plan_return_selected)
        bar4.addWidget(p_return)
        bar4.addStretch()
        v3e.addLayout(bar4)
        lay.addWidget(box3e, 1)

        nav = QHBoxLayout()
        save = QPushButton("💾 حفظ التعديلات")
        save.setObjectName("btnPrimary")
        cancel = QPushButton("✕ إلغاء")
        cancel.setProperty("flat", True)
        save.clicked.connect(self._save)
        cancel.clicked.connect(self.reject)
        nav.addStretch()
        nav.addWidget(save)
        nav.addWidget(cancel)
        root.addLayout(nav)

        self._reload_items()
        self._reload_plan()

    # ================= البنود (نفس منطق شاشة الإنشاء) =================
    def _items_contract_id(self):
        return self.contract_id

    def _reload_items(self):
        import logging
        _log = logging.getLogger("subcontractors.items")
        self._items = []
        self._items_by_id = {}
        self._linked_other = {}
        self._chosen_ids = []
        self._items_error = None
        try:
            self._items = [dict(x) for x in lc.list_boq(self.contract_id)]
        except Exception as exc:
            _log.exception("list_boq failed for contract %s", self.contract_id)
            self._items_error = str(exc)[:120]
        self._items_by_id = {int(x["id"]): x for x in self._items}
        try:
            from database.database import get_connection
            with get_connection() as conn:
                for r in conn.execute(
                        "SELECT si.boq_item_id, s.name FROM sub_contract_items si "
                        "JOIN sub_contracts sc ON sc.id = si.sub_contract_id "
                        "JOIN subcontractors s ON s.id = sc.subcontractor_id "
                        "WHERE sc.contract_id=? AND si.sub_contract_id<>? "
                        "AND COALESCE(sc.status,'') <> 'ملغى'",
                        (self.contract_id, self.sub_id)).fetchall():
                    self._linked_other[int(r[0])] = r[1] or ""
                for r in conn.execute(
                        "SELECT boq_item_id FROM sub_contract_items "
                        "WHERE sub_contract_id=?", (self.sub_id,)).fetchall():
                    bid = int(r[0])
                    if bid in self._items_by_id:
                        self._chosen_ids.append(bid)
        except Exception as exc:
            _log.exception("linked_other query failed for contract %s", self.contract_id)
        # V4.5.15: نفس قاعدة الإنشاء — التلقائي يُخفي صندوق البنود.
        _tpl15e = self._apply_items_visibility(self.contract_id)
        _type_name = self._client_contract_type_name(self.contract_id)
        if getattr(self, "_items_hidden", False):
            # V8.1: تلقائي بلا بنود ⇒ يُخفى
            _lbl = _type_name or "عقد العميل"
            self.items_hint.setText(
                f"عقد العميل من نوع «{_lbl}» (تلقائي) — البنود تُضاف "
                "تلقائيًا؛ يُكتفى بدفعات عقد الباطن أدناه.")
            self.items_hidden_note.setText(self.items_hint.text())
        elif _tpl15e:
            # V8.1: يدوي له قالب ⇒ يظهر ويختار يدويًا
            self.items_hint.setText(
                f"عقد العميل من نوع «{_type_name or 'يدوي'}» له قالب — "
                "اختر البنود التي يغطيها هذا المقاول.")
        elif self._items_error:
            self.items_hint.setText(
                f"⚠ تعذّر قراءة بنود عقد العميل: {self._items_error}")
        elif not self._items:
            self.items_hint.setText(
                "لا بنود على عقد العميل — يمكنك الحفظ بلا بنود. "
                "لإضافة بنود، افتح شاشة العقد الرئيسي واضفها في "
                "جدول «بنود العقد».")
        elif self._items and len(self._chosen_ids) == 0 and self._linked_other:
            _names = sorted(set(self._linked_other.values()))
            _names_str = "، ".join(_names)
            self.items_hint.setText(
                f"⚠ كل بنود هذا العقد مرتبطة بمقاول آخر: {_names_str} — "
                "لا يمكن اختيار أي بند من هذه البنود.")
        else:
            self.items_hint.setText(
                "كل بنود العقد كما هي — علّم البند الذي يغطيه هذا المقاول · "
                "البنود المرتبطة بمقاول آخر تبقى معطّلة بوسم المقاول.")
        self._fill_items_table()
        self._refresh_sub_totals()

    # ================= الدفعات =================
    def _reload_plan(self):
        self._deleted_ids: list[int] = []
        rows = []
        try:
            rows = [dict(x) for x in lc.sub_payment_plan(self.sub_id)]
        except Exception:
            rows = []
        self._src_titles = {}
        self._plan_rows = []
        for _i, r in enumerate(rows, 1):
            # الرقم من sort_order المحفوظ (ترتيب القراءة قد يختلف)
            _seq = int(r.get("sort_order") or 0) or _i
            r["title"] = _auto_title_fixed(_seq, r.get("title") or "")
        for r in rows:
            src_ids = []
            try:
                for src in lc.get_sub_line_sources(int(r["id"])):
                    src_ids.append(int(src["id"]))
                    self._src_titles[int(src["id"])] = src.get("title") or ""
            except Exception:
                src_ids = []
            self._plan_rows.append({
                "id": int(r["id"]),
                "title": r.get("title") or "",
                "stage_id": r.get("stage_id"),
                "stage_name": r.get("stage_name") or "",
                "due": (r.get("due_date") or "")[:10],
                "amount": float(r.get("amount") or 0),
                "sources": src_ids,
                "status": r.get("status") or "",
            })
        if not self._plan_rows:
            self._plan_note = ("لا توجد دفعات محفوظة لهذا العقد — يمكنك "
                               "إضافة دفعات من شاشة العقد الرئيسي.")
        else:
            self._plan_note = ("دفعات عقد الباطن — عدّل القيمة مباشرة في خانة "
                               "«قيمة الدفعة»، وأي تغيير يُطبَّق عند الحفظ.")
        self._fill_plan_table()

    def _fill_plan_table(self):
        from ui.contracts import _PLAN_AMOUNT_HINT, _paint_amount_hint
        from ui.widgets import MONEY_ALIGN, sync_header_alignment
        t = self.plan_table
        t.blockSignals(True)
        t.setRowCount(len(self._plan_rows))
        for r, row in enumerate(self._plan_rows):
            amt = float(row.get("amount") or 0)
            _txt, _col, _tip = _client_state_cell(
                self._client_lines_map(), row.get("sources"))
            # Column 0: checkbox (V8.8)
            chk = QTableWidgetItem()
            chk.setFlags(Qt.ItemIsEnabled | Qt.ItemIsSelectable
                         | Qt.ItemIsUserCheckable)
            chk.setCheckState(Qt.Unchecked)
            chk.setTextAlignment(Qt.AlignCenter)
            t.setItem(r, 0, chk)
            # Columns 1-6: data
            vals = [str(r + 1), row.get("title") or "",
                    row.get("stage_name") or "—", "", row.get("due") or "",
                    _txt]
            for c, v in enumerate(vals):
                col = c + 1  # shift by 1
                if c == 3:
                    cell = QTableWidgetItem("")
                    cell.setFlags(Qt.ItemIsEnabled | Qt.ItemIsSelectable
                                  | Qt.ItemIsEditable)
                    cell.setTextAlignment(MONEY_ALIGN)
                    if amt > 0:
                        cell.setText(f"{amt:,.3f}")
                        cell.setForeground(QColor(
                            getattr(style, "TEXT", "") or "#1F2937"))
                    else:
                        cell.setText(_PLAN_AMOUNT_HINT)
                        _paint_amount_hint(cell)
                else:
                    cell = QTableWidgetItem(str(v))
                    cell.setFlags(Qt.ItemIsEnabled | Qt.ItemIsSelectable)
                    cell.setTextAlignment(Qt.AlignCenter)
                    if c == 5:
                        cell.setForeground(QColor(_col))
                        cell.setToolTip(_tip)
                t.setItem(r, col, cell)
        t.blockSignals(False)
        sync_header_alignment(t)
        self._fit_columns(t, 1)
        self._refresh_plan_totals()

    def _client_lines_map(self) -> dict:
        """دفعات عقد العميل بمعرّفاتها — لحالة التحصيل (V6.1)."""
        cache = getattr(self, "_clines_map", None)
        if cache is None:
            cache = {}
            try:
                for ln in lc.contract_payment_plan(self.contract_id):
                    cache[int(ln["id"])] = dict(ln)
            except Exception:
                pass
            self._clines_map = cache
        return cache

    def _source_title(self, line_id: int) -> str:
        """عنوان دفعة العميل المصدر (من المحمّل، وإلا من خطة العقد)."""
        cache = getattr(self, "_src_titles", None)
        if cache is None:
            cache = {}
            try:
                for ln in lc.contract_payment_plan(self.contract_id):
                    cache[int(ln["id"])] = ln.get("title") or ""
            except Exception:
                pass
            self._src_titles = cache
        if int(line_id) not in cache:
            try:
                for ln in lc.contract_payment_plan(self.contract_id):
                    cache[int(ln["id"])] = ln.get("title") or ""
            except Exception:
                pass
        return cache.get(int(line_id)) or str(line_id)

    def _refresh_plan_totals(self):
        total = sum(float(x.get("amount") or 0) for x in self._plan_rows)
        empty = sum(1 for x in self._plan_rows
                    if float(x.get("amount") or 0) <= 0)
        parts = [f"مجموع الدفعات: {total:,.3f} د.ك · عدد الدفعات: "
                 f"{len(self._plan_rows)}"]
        if empty:
            parts.append(f"⚠ {empty} دفعة بلا قيمة")
        try:
            amt = float(self.amount.value() or 0)
        except Exception:
            amt = 0.0
        self.plan_hint.setText(
            (self._plan_note + "\n" if self._plan_note else "") + " · ".join(parts))
        self._refresh_plan_compare(total)

    def _plan_amount_changed(self, item):
        from ui.contracts import _PLAN_AMOUNT_HINT, _normalize_amount_text
        from ui.contracts import _paint_amount_hint
        if item is None or item.column() != 4:  # V8.8: shifted +1 for checkbox
            return
        r = item.row()
        if r < 0 or r >= len(self._plan_rows):
            return
        raw = _normalize_amount_text(item.text())
        if _PLAN_AMOUNT_HINT in str(item.text() or ""):
            raw = ""
        val = None
        if raw:
            try:
                val = float(raw)
            except Exception:
                val = None
        self.plan_table.blockSignals(True)
        try:
            if val is None:
                cur = float(self._plan_rows[r].get("amount") or 0)
                if raw and cur > 0:
                    item.setText(f"{cur:,.3f}")
                else:
                    item.setText(_PLAN_AMOUNT_HINT)
                    _paint_amount_hint(item)
            elif val <= 0:
                self._plan_rows[r]["amount"] = 0.0
                item.setText(_PLAN_AMOUNT_HINT)
                _paint_amount_hint(item)
            else:
                self._plan_rows[r]["amount"] = round(val, 3)
                item.setText(f"{val:,.3f}")
                item.setForeground(QColor(getattr(style, "TEXT", "") or "#1F2937"))
        finally:
            self.plan_table.blockSignals(False)
        self._refresh_plan_totals()

    def _plan_selected(self):
        r = self.plan_table.currentRow()
        if r < 0 or r >= len(self._plan_rows):
            return None
        return r

    def _contract_stages(self):
        try:
            from database.database import get_connection
            with get_connection() as conn:
                return [dict(r) for r in conn.execute(
                    "SELECT id, name, is_skipped, end_date, level, "
                    "parent_name FROM contract_stages WHERE contract_id=? "
                    "ORDER BY sort_order, id", (self.contract_id,)).fetchall()]
        except Exception:
            return []

    def _stage_name(self, stage_id):
        if not stage_id:
            return "—"
        for s in self._contract_stages():
            if int(s["id"]) == int(stage_id):
                return s["name"]
        return "—"

    def _plan_add(self):
        from ui.sub_plan_editor import SubPlanLineDialog
        dlg = SubPlanLineDialog(self, self.contract_id,
                                title="إضافة دفعة مقاول")
        if dlg.exec() != QDialog.Accepted:
            return
        title, due, amount, stage_id = dlg.values()
        if not title or amount <= 0:
            style.error(self, "عنوان الدفعة ومبلغها مطلوبان.")
            return
        self._plan_rows.append({
            "id": None, "title": title, "due": due, "amount": amount,
            "stage_id": stage_id, "sources": dlg.sources(),
            "stage_name": self._stage_name(stage_id)})
        self._fill_plan_table()

    def _plan_edit(self):
        r = self._plan_selected()
        if r is None:
            style.info(self, "اختر سطرًا من الجدول أولاً.")
            return
        from ui.sub_plan_editor import SubPlanLineDialog
        row = self._plan_rows[r]
        dlg = SubPlanLineDialog(
            self, self.contract_id,
            line={"title": row.get("title"), "due_date": row.get("due"),
                  "amount": row.get("amount") or 1,
                  "stage_id": row.get("stage_id")},
            sources=row.get("sources") or [], title="تعديل دفعة مقاول")
        if dlg.exec() != QDialog.Accepted:
            return
        title, due, amount, stage_id = dlg.values()
        row.update({"title": title, "due": due, "amount": amount,
                    "stage_id": stage_id, "sources": dlg.sources(),
                    "stage_name": self._stage_name(stage_id)})
        self._fill_plan_table()

    def _plan_del(self):
        r = self._plan_selected()
        if r is None:
            style.info(self, "اختر سطرًا من الجدول أولاً.")
            return
        row = self._plan_rows.pop(r)
        if row.get("id"):
            self._deleted_ids.append(int(row["id"]))
        self._fill_plan_table()

    def _plan_return_selected(self):
        """V8.7.3: إرجاع الدفعات المحددة."""
        t = self.plan_table
        selected_rows = sorted(set(idx.row() for idx in t.selectedIndexes()), reverse=True)
        if not selected_rows:
            style.info(self, "اختر دفعة من الجدول لإرجاعها.")
            return
        for r in selected_rows:
            if r < len(self._plan_rows):
                row = self._plan_rows[r]
                if row.get("id"):
                    self._deleted_ids.append(int(row["id"]))
                self._plan_rows.pop(r)
        self._fill_plan_table()
        style.toast(self, f"تم إرجاع {len(selected_rows)} دفعة.")

    def _plan_distribute(self):
        """⚖ توزيع تلقائي: يستبدل الصفوف بتوزيع دفعات العميل (يُطبَّق بالحفظ)."""
        try:
            total = float(self.amount.value() or 0)
        except Exception:
            total = 0.0
        if total <= 0:
            # V5.6: نفس الوجهة في حوار التعديل — رسالة أوضح
            style.info(self, "اكتب «قيمة عقد الباطن» أولًا ليتم التوزيع "
                             "بنسبة دفعات العميل.")
            return
        if self._plan_rows and not style.confirm(
                self, "سيُستبدل جدول الدفعات بالتوزيع التلقائي بنسبة دفعات "
                      "العميل (يُطبَّق عند الحفظ) — متابعة؟", "توزيع تلقائي"):
            return
        try:
            _boq = self._selected_item_ids() or None
            rows = [dict(x) for x in lc.sub_plan_preview(
                self.contract_id, total,
                self.end.date().toString("yyyy-MM-dd"),
                boq_item_ids=_boq)]
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
            return
        for row in self._plan_rows:
            if row.get("id"):
                self._deleted_ids.append(int(row["id"]))
        self._plan_rows = []
        for x in rows:
            self._plan_rows.append({
                "id": None, "title": x.get("title") or "دفعة",
                "due": x.get("due") or "", "amount": float(x.get("amount") or 0),
                "stage_id": x.get("stage_id"),
                "stage_name": self._stage_name(x.get("stage_id")),
                "sources": [int(s) for s in (x.get("sources") or [])]})
        self._fill_plan_table()

    # ================= الحفظ =================
    def _toggle_cancel_rows(self, txt: str):
        visible = (txt == "ملغى")
        self.cancel_close_label.setVisible(visible)
        self.cancel_close_amount.setVisible(visible)
        self.cancel_reason_label.setVisible(visible)
        self.cancel_reason.setVisible(visible)

    def accept(self):  # noqa: N802
        """لا تغلق النافذة إلا بعد نجاح التحقق والحفظ."""
        self._save()

    def _save(self):
        from ui.widgets import RequiredValidator
        v = RequiredValidator(self)
        v.add(self.amount, "قيمة العقد", min_value=0.001)
        if not v.validate():
            return
        if self.status.currentText() not in ("نشط", "متوقف", "منتهي", "ملغى"):
            style.error(self, "اختر حالة عقد الباطن من القائمة.")
            return
        for i, row in enumerate(self._plan_rows, 1):
            name = row.get("title") or f"دفعة {i}"
            if not (row.get("sources") or []):
                style.error(self, f"الدفعة «{name}» بلا دفعة عميل — "
                                  "احذفها وأضفها من «＋ إضافة دفعة».")
                return
            if float(row.get("amount") or 0) <= 0:
                style.error(self, f"الدفعة «{name}» بلا قيمة — اكتب قيمتها أو "
                                  "احذف صفها.")
                return
        try:
            lc.update_sub_contract(
                self.sub_id, self.amount.value(),
                self.start.date().toString("yyyy-MM-dd"),
                self.end.date().toString("yyyy-MM-dd"),
                self.description.toPlainText(), self.status.currentText(),
                self.cancel_reason.toPlainText(),
                self.cancel_close_amount.value())
            lc.set_sub_contract_items(self.sub_id, self._selected_item_ids())
            for lid in list(getattr(self, "_deleted_ids", [])):
                lc.delete_sub_plan_line(int(lid))
            self._deleted_ids = []
            for row in self._plan_rows:
                if row.get("id"):
                    lc.update_sub_plan_line(
                        int(row["id"]), row.get("title") or "دفعة",
                        row.get("due") or "", float(row.get("amount") or 0),
                        row.get("stage_id"))
                    lc.set_sub_line_sources(int(row["id"]),
                                            row.get("sources") or [])
                else:
                    lid = lc.add_sub_plan_line(
                        self.sub_id, row.get("title") or "دفعة",
                        row.get("due") or "", float(row.get("amount") or 0),
                        row.get("stage_id"))
                    lc.set_sub_line_sources(int(lid), row.get("sources") or [])
            try:
                from services.lifecycle_service import log_event
                log_event(self.contract_id, "تعديل عقد باطن",
                          f"تحديث بيانات وبنود ودفعات · {self.sub_id}")
            except Exception:
                pass
            style.toast(self.parent() or self, "تم حفظ عقد الباطن")
            QDialog.Accepted and QDialog.accept(self)
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))


class SourcePickerDialog(QDialog):
    """V4.6: اختيار دفعات العميل المصدر — تُستحق دفعة الباطن باكتمال كلها."""

    def __init__(self, parent, contract_id: int, checked_ids=None):
        super().__init__(parent)
        self.setWindowTitle("مصادر الدفعة من عقد العميل")
        self.setLayoutDirection(Qt.RightToLeft)
        self.setMinimumSize(520, 380)
        lay = QVBoxLayout(self)
        hint = QLabel("علّم دفعات العميل التي تموّل هذه الدفعة — تُستحق "
                      "باكتمال تحريك كل المصادر المعلمة.")
        hint.setWordWrap(True)
        hint.setProperty("hint", True)
        lay.addWidget(hint)
        self.list = QListWidget()
        lay.addWidget(self.list, 1)
        checked = {int(x) for x in (checked_ids or [])}
        for it in lc.contract_payment_plan(int(contract_id)):
            _tr = bool((it.get("triggered_at") or "").strip())
            mark = "  ✓ مستحقة" if _tr else "  ○ تقديرية"
            txt = ((it.get("title") or "دفعة") + " · "
                   + (it.get("due_date") or "") + " · "
                   + format(float(it.get("amount") or 0), ",.3f") + mark)
            item = QListWidgetItem(txt)
            item.setFlags(item.flags() | Qt.ItemIsUserCheckable)
            item.setCheckState(Qt.Checked
                               if int(it["id"]) in checked else Qt.Unchecked)
            item.setData(Qt.UserRole, int(it["id"]))
            self.list.addItem(item)
        if not self.list.count():
            self.list.addItem(QListWidgetItem("لا دفعات في عقد العميل."))
            self.list.item(0).setFlags(Qt.NoItemFlags)
        row = QHBoxLayout()
        row.addStretch()
        ok_btn = QPushButton("💾 حفظ")
        ok_btn.clicked.connect(self.accept)
        row.addWidget(ok_btn)
        no_btn = QPushButton("✕ إلغاء")
        no_btn.clicked.connect(self.reject)
        row.addWidget(no_btn)
        lay.addLayout(row)

    def selected_ids(self):
        out = []
        for i in range(self.list.count()):
            item = self.list.item(i)
            if item.flags() & Qt.ItemIsUserCheckable \
                    and item.checkState() == Qt.Checked:
                out.append(int(item.data(Qt.UserRole)))
        return out


class SubPlanDialog(QDialog):
    """V4.2 (P1-4): دفعات خطة عقد الباطن — يدوية أو مربوطة بمراحل الأب."""

    HEADS = ["الدفعة", "المرحلة", "الاستحقاق", "المبلغ", "المدفوع",
             "المتبقي", "الحالة", "تحصيل العميل"]

    def __init__(self, parent, sub_contract_id: int):
        super().__init__(parent)
        self.sc_id = int(sub_contract_id)
        self.setWindowTitle("دفعات خطة عقد الباطن")
        self.setLayoutDirection(Qt.RightToLeft)
        self.setMinimumSize(780, 440)
        lay = QVBoxLayout(self)
        self.info_lbl = QLabel()
        self.info_lbl.setWordWrap(True)
        self.info_lbl.setProperty("hint", True)
        lay.addWidget(self.info_lbl)
        self.table = QTableWidget()
        self.table.setColumnCount(len(self.HEADS))
        self.table.setHorizontalHeaderLabels(self.HEADS)
        self.table.horizontalHeader().setSectionResizeMode(
            QHeaderView.Stretch)
        self.table.setSelectionBehavior(QTableWidget.SelectRows)
        self.table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.table.itemSelectionChanged.connect(self._fill_from_row)
        lay.addWidget(self.table, 1)
        form = QFormLayout()
        lay.addLayout(form)
        self.title = QLineEdit()
        self.title.setPlaceholderText("عنوان الدفعة")
        form.addRow("الدفعة", self.title)
        self.payment = SearchableComboBox(open_on_click=True)
        self.payment.setToolTip("دفعة العميل")
        self.payment.selection_changed.connect(self._on_payment_changed)
        form.addRow("دفعة العميل", self.payment)
        self.stage_lbl = QLabel("—", self)
        self.stage_lbl.setProperty("hint", True)
        form.addRow("المرحلة", self.stage_lbl)
        self.due_lbl = QLabel("—", self)
        self.due_lbl.setProperty("hint", True)
        self.due_lbl.setToolTip("تلقائي")
        form.addRow("الاستحقاق", self.due_lbl)
        self._lines: list = []
        self._stages: dict = {}
        self.amount = SafeDoubleSpinBox()
        self.amount.setRange(0.001, 1e9)
        self.amount.setDecimals(3)
        self.amount.setGroupSeparatorShown(True)
        form.addRow("المبلغ", self.amount)
        row = QHBoxLayout()
        lay.addLayout(row)
        add_btn = QPushButton("＋ إضافة")
        add_btn.clicked.connect(self._add)
        row.addWidget(add_btn)
        upd_btn = QPushButton("✎ تعديل المحدد")
        upd_btn.clicked.connect(self._update)
        row.addWidget(upd_btn)
        del_btn = QPushButton("🗑 حذف المحدد")
        del_btn.clicked.connect(self._delete)
        row.addWidget(del_btn)
        dist_btn = QPushButton("⚖ توزيع تلقائي")
        dist_btn.setToolTip("صف لكل دفعة من دفعات عقد العميل — بنسب مبالغها "
                            "وبتاريخ استحقاقها (يمسح السطور غير المفعّلة)")
        dist_btn.clicked.connect(self._distribute)
        row.addWidget(dist_btn)
        row.addStretch()
        close_btn = QPushButton("✕ إغلاق")
        close_btn.clicked.connect(self.accept)
        row.addWidget(close_btn)
        self._reload()

    def _sc(self):
        return lc.get_sub_contract(self.sc_id) or {}

    def _reload(self):
        sc = self._sc()
        self._lines = self._client_lines(sc.get("contract_id"))
        self._stages = self._stage_names(sc.get("contract_id"))
        self.payment.set_items([(self._line_label(x), int(x["id"]))
                                for x in self._lines], auto_select=False)
        items = lc.sub_payment_plan(self.sc_id)
        self._items = items
        srcstat = lc.sub_sources_status(self.sc_id)
        self.table.setRowCount(len(items))
        for r, it in enumerate(items):
            _st = srcstat.get(int(it["id"]))
            if _st is None:
                _src_txt = "⚠ بلا دفعة عميل"
                _src_tip = ("صف قديم بلا ربط بدفعة عميل — استخدم «＋ إضافة» "
                            "لربطه، وإلا يستحق بمرحلته أو تاريخه")
            elif _st["ready"]:
                _src_txt = "✓ محصّلة"
                _src_tip = "دفعة العميل محصّلة — الدفعة قابلة للاستحقاق"
            else:
                _src_txt = "⏳ لم تُحصَّل"
                _src_tip = "تنتظر تحصيل: " + "، ".join(_st["pending"])
            vals = [it.get("title") or "",
                    it.get("stage_name") or "—",
                    (it.get("triggered_at") or "")[:10]
                    or (it.get("due_date") or ""),
                    format(float(it.get("amount") or 0), ",.3f"),
                    format(float(it.get("covered") or 0), ",.3f"),
                    format(float(it.get("remaining") or 0), ",.3f"),
                    it.get("status") or "",
                    _src_txt]
            for c, v in enumerate(vals):
                cell = QTableWidgetItem(str(v))
                if c >= 3:
                    cell.setTextAlignment(Qt.AlignCenter)
                if c == 7:
                    cell.setToolTip(_src_tip)
                self.table.setItem(r, c, cell)
        total = sum(float(i.get("amount") or 0) for i in items)
        self.info_lbl.setText(
            "المقاول: " + (sc.get("sub_name") or "") + " · العقد: "
            + (sc.get("contract_number") or "") + " · الخطة: "
            + format(total, ",.3f") + " من "
            + format(float(sc.get("amount") or 0), ",.3f"))

    def _selected_id(self):
        r = self.table.currentRow()
        if r < 0 or r >= len(getattr(self, "_items", [])):
            return None
        return int(self._items[r]["id"])

    def _fill_from_row(self):
        r = self.table.currentRow()
        if r < 0 or r >= len(getattr(self, "_items", [])):
            return
        it = self._items[r]
        self.title.setText(it.get("title") or "")
        self.amount.setValue(float(it.get("amount") or 0))
        if (it.get("due_date") or "")[:10]:
            self.due.setDate(
                QDate.fromString(it["due_date"][:10], "yyyy-MM-dd"))
        try:
            _srcs = [s["id"] for s in lc.get_sub_line_sources(int(it["id"]))]
        except Exception:
            _srcs = []
        idx = self.payment.findData(int(_srcs[0])) if _srcs else -1
        self.payment.setCurrentIndex(idx if idx >= 0 else -1)
        self._refresh_labels(autofill_title=False)

    # ---------------- مساعدات V6.1 ----------------
    def _client_lines(self, cid) -> list[dict]:
        if not cid:
            return []
        try:
            return [dict(x) for x in lc.contract_payment_plan(int(cid))]
        except Exception:
            return []

    def _stage_names(self, cid) -> dict:
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

    def _line_label(self, ln) -> str:
        try:
            amt = float(ln.get("amount") or 0)
            rem = float(ln.get("remaining") or 0)
        except Exception:
            amt = rem = 0.0
        tag = "محصّلة" if rem <= 0.001 else f"متبقٍ {rem:,.3f}"
        return f"{ln.get('title') or 'دفعة'} · {amt:,.3f} · {tag}"

    def _payment_row(self):
        pid = self.payment.selected_data()
        for ln in (self._lines or []):
            if int(ln["id"]) == int(pid or 0):
                return ln
        return None

    def _on_payment_changed(self):
        self._refresh_labels(autofill_title=True)

    def _refresh_labels(self, autofill_title: bool = True):
        ln = self._payment_row()
        if not ln:
            self.stage_lbl.setText("—")
            self.due_lbl.setText("—")
            return
        self.stage_lbl.setText(
            (self._stages or {}).get(int(ln.get("stage_id") or 0)) or "—")
        self.due_lbl.setText((ln.get("due_date") or "")[:10] or "—")
        if autofill_title and not self.title.text().strip():
            self.title.setText((ln.get("title") or "").strip())

    def _form(self):
        ln = self._payment_row() or {}
        sid = ln.get("stage_id")
        return (self.title.text().strip(),
                (ln.get("due_date") or "")[:10],
                float(self.amount.value()),
                int(sid) if sid else None)

    def _add(self):
        # V4.5.03: كل دفعة باطن لازم تتربط بدفعة عميل — الاختيار قبل الحفظ.
        title, due, amount, stage_id = self._form()
        if not title:
            style.error(self, "عنوان الدفعة مطلوب.")
            return
        if amount <= 0:
            style.error(self, "مبلغ الدفعة يجب أن يكون أكبر من صفر.")
            return
        sc = self._sc()
        if not sc.get("contract_id"):
            style.error(self, "عقد العميل الأب غير معروف.")
            return
        if not self._lines:
            style.error(self, "لا توجد دفعات في عقد العميل — "
                              "أنشئ خطة دفعات العميل أولًا.")
            return
        pid = self.payment.selected_data()
        if not pid:
            style.error(self, "اختر «دفعة العميل» — كل دفعة باطن مربوطة "
                              "بدفعة من عقد العميل.")
            return
        try:
            lid = lc.add_sub_plan_line(self.sc_id, title, due, amount,
                                       stage_id)
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
            return
        try:
            lc.set_sub_line_sources(lid, [int(pid)])
        except (ValidationError, DatabaseError) as exc:
            try:
                lc.delete_sub_plan_line(lid)
            except Exception:
                pass
            style.error(self, str(exc))
            return
        style.toast(self, "أُضيفت الدفعة وربطت بدفعة العميل")
        self._reload()

    def _update(self):
        lid = self._selected_id()
        if lid is None:
            style.error(self, "حدد سطرًا من الجدول أولًا.")
            return
        title, due, amount, stage_id = self._form()
        pid = self.payment.selected_data()
        if not pid:
            style.error(self, "اختر «دفعة العميل» أولًا.")
            return
        try:
            lc.update_sub_plan_line(lid, title, due, amount, stage_id)
            try:
                _cur = sorted(int(x["id"]) for x
                              in lc.get_sub_line_sources(lid))
            except Exception:
                _cur = []
            if _cur != [int(pid)]:
                lc.set_sub_line_sources(lid, [int(pid)])
            style.toast(self, "حُفظ التعديل")
            self._reload()
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))

    def _delete(self):
        lid = self._selected_id()
        if lid is None:
            style.error(self, "حدد سطرًا من الجدول أولًا.")
            return
        if not style.confirm(self, "حذف سطر الدفعة؟",
                             "سيُحذف السطر نهائيًا."):
            return
        try:
            lc.delete_sub_plan_line(lid)
            style.toast(self, "حُذف السطر")
            self._reload()
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))

    def _distribute(self):
        if not style.confirm(
                self, "توزيع القيمة على دفعات عقد العميل؟",
                "يمسح السطور غير المفعّلة ويُنشئ صفًا لكل دفعة من دفعات "
                "عقد العميل — بنسب مبالغها وبتاريخ استحقاقها."):
            return
        try:
            n = lc.distribute_sub_plan(self.sc_id)
            style.toast(self, "تم التوزيع: " + str(n) + " دفعات")
            self._reload()
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))

class SubcontractorsPage(QWidget):
    """صفحة مقاولي الباطن · جدول حديث بدل الشجرة."""
    data_changed = Signal()

    # الأنماط الموحّدة
    _FIELD_H = 28
    _FIELD_SS = (
        f"QLineEdit, QComboBox, QDateEdit, QDoubleSpinBox, QSpinBox {{"
        f" min-height: {_FIELD_H}px; max-height: {_FIELD_H}px;"
        f" padding: 3px 6px; font-size: 11px;"
        f" border: 0.5px solid #D1D5DB; border-radius: 6px;"
        f" background: #F9FAFB; color: #111827; }}"
    )

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("page")
        self._build()

    def _build(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 10, 16, 8)
        layout.setSpacing(8)

        # ── العنوان + شريط البحث ────────────────────────────────
        from ui.widgets import flow_host
        top_host, top = flow_host(spacing=7)
        title_col = QVBoxLayout()
        title_col.setSpacing(2)
        title = QLabel("مقاولو الباطن")
        title.setProperty("pageTitle", True)
        title_col.addWidget(title)
        self.desc_lbl = QLabel("مقاولوك وعقودهم ومستحقاتهم — انقر على مقاول لفتح ملفه")
        self.desc_lbl.setProperty("pageDesc", True)
        title_col.addWidget(self.desc_lbl)
        title_host = QWidget()
        title_host.setObjectName("transparentHost")
        title_host.setLayout(title_col)
        top.addWidget(title_host)

        # البحث + الأزرار
        self.search = QLineEdit(self)
        self.search.setPlaceholderText("🔍  ابحث باسم المقاول أو النشاط...")
        self.search.setMinimumWidth(170)
        self.search.setMaximumWidth(300)
        self.search.setStyleSheet(self._FIELD_SS)
        from ui.widgets import connect_debounced_text
        connect_debounced_text(self.search, self._search_changed, delay_ms=420)

        add_btn = QPushButton("＋ مقاول جديد", self)
        add_btn.setProperty("flat", True)
        add_btn.clicked.connect(self._add)

        link_btn = QPushButton("＋ عقد باطن جديد", self)
        link_btn.setObjectName("btnPrimary")
        link_btn.clicked.connect(self._link)

        self._can_add_sub = auth_service.has_permission("action_add_subcontractor")
        add_btn.setVisible(self._can_add_sub)
        link_btn.setVisible(self._can_add_sub)

        tools, tools_flow = flow_host(spacing=8)
        for _w in (self.search, add_btn, link_btn):
            tools_flow.addWidget(_w)
        top.addWidget(tools)
        layout.addWidget(top_host)

        # ── الجدول ──────────────────────────────────────────────
        self.table = QTableWidget(0, 6)
        self.table.setHorizontalHeaderLabels(
            ["#", "المقاول", "النشاط", "العقود", "الإجمالي", "المتبقي"])
        self.table.verticalHeader().setVisible(False)
        self.table.verticalHeader().setDefaultSectionSize(34)
        self.table.setSelectionBehavior(QTableWidget.SelectRows)
        self.table.setSelectionMode(QTableWidget.SingleSelection)
        self.table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.table.setAlternatingRowColors(True)
        self.table.itemDoubleClicked.connect(self._on_row_double_click)
        # V9.15.11: قائمة الزر الأيمن لصف المقاول
        self.table.setContextMenuPolicy(Qt.CustomContextMenu)
        self.table.customContextMenuRequested.connect(self._on_row_context_menu)

        from ui.widgets import apply_column_weights
        apply_column_weights(self.table, [5, 30, 20, 15, 15, 15],
                             min_widths=[40, 150, 100, 70, 90, 90])
        layout.addWidget(self.table, 1)

        # ── شريط سفلي ───────────────────────────────────────────
        bottom = QHBoxLayout()
        self.summary_lbl = QLabel("")
        self.summary_lbl.setProperty("hint", True)
        bottom.addWidget(self.summary_lbl)
        bottom.addStretch()

        from ui.widgets import PaginationBar
        self.pager = PaginationBar()
        self.pager.page_changed.connect(self.refresh)
        bottom.addWidget(self.pager)
        layout.addLayout(bottom)

        # تحميل البيانات
        self.refresh()

    def _search_changed(self):
        self.pager.reset()
        self.refresh()

    def refresh(self):
        """تحديث الجدول."""
        from PySide6.QtGui import QColor

        data = lc.subcontractors_tree(self.search.text())
        n_subs = len(data)
        total_remaining = sum(s["remaining"] for s in data)

        # تعبئة الجدول
        page_data = self.pager.slice(data)
        self.table.setRowCount(len(page_data))

        green = QColor(style.theme()["GREEN"])
        red = QColor(style.theme()["RED"])

        for r, s in enumerate(page_data):
            # #
            item = QTableWidgetItem(str(r + 1))
            item.setTextAlignment(Qt.AlignCenter)
            item.setData(Qt.UserRole, s["id"])  # حفظ معرف المقاول
            self.table.setItem(r, 0, item)

            # المقاول
            name = f"👷 {s['name']}  ({s['sub_code']})"
            if s.get("activity"):
                name += f"  ·  {s['activity']}"
            item = QTableWidgetItem(name)
            self.table.setItem(r, 1, item)

            # النشاط
            item = QTableWidgetItem(s.get("activity") or "—")
            item.setTextAlignment(Qt.AlignCenter)
            self.table.setItem(r, 2, item)

            # العقود
            item = QTableWidgetItem(f"{len(s['contracts'])} عقد")
            item.setTextAlignment(Qt.AlignCenter)
            self.table.setItem(r, 3, item)

            # الإجمالي
            item = QTableWidgetItem(f"{s['total']:,.3f}")
            item.setTextAlignment(Qt.AlignCenter)
            self.table.setItem(r, 4, item)

            # المتبقي
            item = QTableWidgetItem(f"{s['remaining']:,.3f}")
            item.setTextAlignment(Qt.AlignCenter)
            item.setForeground(red if s["remaining"] > 0.001 else green)
            self.table.setItem(r, 5, item)

        self.summary_lbl.setText(
            f"عدد المقاولين: {n_subs}   |   "
            f"إجمالي المتبقي لهم: {total_remaining:,.3f}")

    def _on_row_double_click(self, item):
        """فتح ملف المقاول عند النقر المزدوج."""
        row = item.row()
        id_item = self.table.item(row, 0)
        if id_item:
            sub_id = id_item.data(Qt.UserRole)
            if sub_id:
                main_win = self.window()
                if hasattr(main_win, 'open_subcontractor_profile'):
                    main_win.open_subcontractor_profile(sub_id)

    def _on_row_context_menu(self, pos):
        """قائمة الزر الأيمن لصف المقاول (V9.15.11)."""
        from ui.widgets import row_menu
        idx = self.table.indexAt(pos)
        if not idx.isValid():
            return
        id_item = self.table.item(idx.row(), 0)
        sid = id_item.data(Qt.UserRole) if id_item else None
        if not sid:
            return
        self.table.selectRow(idx.row())
        sid = int(sid)
        row_menu(self.table, [
            ("فتح ملف المقاول", lambda: self._menu_open_profile(sid)),
            ("عقد باطن جديد لهذا المقاول", lambda: self._menu_link(sid)),
            ("تعديل بيانات المقاول", lambda: self._menu_edit(sid)),
            None,
            ("سند صرف للمقاول", lambda: self._menu_pay(sid)),
        ], pos)

    def _menu_open_profile(self, sid: int):
        main_win = self.window()
        if hasattr(main_win, "open_subcontractor_profile"):
            main_win.open_subcontractor_profile(sid)

    def _menu_link(self, sid: int):
        from ui.subcontractors import LinkSubContractDialog
        main_win = self.window()
        done = lambda accepted: (self.refresh(), self.data_changed.emit()) if accepted else None
        if hasattr(main_win, "open_subcontract_page"):
            main_win.open_subcontract_page(sub_id=sid, on_done=done)
        elif LinkSubContractDialog(self, preset_sub_id=sid).exec() == QDialog.Accepted:
            self.refresh()
            self.data_changed.emit()

    def _menu_edit(self, sid: int):
        from services import lifecycle_service as lc
        sub = lc.get_subcontractor(sid)
        if not sub:
            style.error(self, "تعذر العثور على بيانات المقاول.")
            return
        if SubcontractorDialog(self, sub=sub).exec() == QDialog.Accepted:
            self.refresh()
            self.data_changed.emit()

    def _menu_pay(self, sid: int):
        from ui.actions import open_voucher
        open_voucher(self, "payment", subcontractor_id=sid,
                     on_saved=lambda: (self.refresh(), self.data_changed.emit()))

    def _selected_sub_id(self) -> int | None:
        """الحصول على معرف المقاول المحدد."""
        row = self.table.currentRow()
        if row >= 0:
            id_item = self.table.item(row, 0)
            if id_item:
                return id_item.data(Qt.UserRole)
        return None

    def _add(self):
        """إضافة مقاول جديد."""
        from ui.subcontractors import SubcontractorDialog
        if SubcontractorDialog(self).exec() == QDialog.Accepted:
            self.refresh()
            self.data_changed.emit()

    def _link(self):
        """إنشاء عقد باطن جديد."""
        from ui.subcontractors import LinkSubContractDialog
        main_win = self.window()
        if hasattr(main_win, 'open_subcontract_page'):
            main_win.open_subcontract_page(
                on_done=lambda accepted: (self.refresh(), self.data_changed.emit()) if accepted else None)
        else:
            if LinkSubContractDialog(self).exec() == QDialog.Accepted:
                self.refresh()
                self.data_changed.emit()

    def _search_changed(self):
        self.pager.reset()
        self.refresh()

class SubPaymentsDialog(QDialog):
    """سجل مدفوعات مقاول: كل سندات الصرف له."""

    def __init__(self, parent, sub: dict):
        super().__init__(parent)
        self.setWindowTitle(f"سجل مدفوعات · {sub['name']}")
        self.setLayoutDirection(Qt.RightToLeft)
        style.fit_window(self, 760, 520, min_w=700, min_h=440)
        from services.extras_service import subcontractor_payments
        rows = subcontractor_payments(sub["id"])

        layout = QVBoxLayout(self)
        head = QLabel(f"👷 {sub['name']} ({sub['sub_code']})")
        head.setStyleSheet("font-size: 14.4px; font-weight: 800;")
        layout.addWidget(head)

        table = QTableWidget(len(rows), 5)
        table.setHorizontalHeaderLabels(
            ["رقم السند", "التاريخ", "العقد", "طريقة الدفع", "المبلغ"])
        table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        table.verticalHeader().setVisible(False)
        table.setEditTriggers(QTableWidget.NoEditTriggers)
        table.setAlternatingRowColors(True)
        total = 0.0
        for r, v in enumerate(rows):
            contract = v["contract_number"] or "-"
            if v.get("contract_name"):
                contract += f" · {v['contract_name']}"
            values = [v["voucher_number"], v["vdate"], contract,
                      v["method"] or "-", f"{float(v['amount']):,.3f}"]
            for col, val in enumerate(values):
                item = QTableWidgetItem(str(val))
                item.setTextAlignment(Qt.AlignCenter)
                table.setItem(r, col, item)
            total += float(v["amount"])
        layout.addWidget(table, 1)

        footer = QLabel(f"عدد السندات: {len(rows)}   |   "
                        f"إجمالي المنصرف له: {total:,.3f}")
        footer.setStyleSheet("font-weight: 800;")
        layout.addWidget(footer)

        close_btn = QPushButton("✕ إغلاق")
        close_btn.setProperty("flat", True)
        close_btn.clicked.connect(self.reject)
        btns = QHBoxLayout()
        btns.addStretch()
        btns.addWidget(close_btn)
        layout.addLayout(btns)
