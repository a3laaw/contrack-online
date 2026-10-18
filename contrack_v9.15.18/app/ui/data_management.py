# -*- coding: utf-8 -*-
"""V9.5.1: أداة إدارة البيانات — بحث + تقرير + حذف + موظفين + سجل."""

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QAbstractItemView, QComboBox, QDialog, QDoubleSpinBox,
    QFormLayout, QGroupBox, QHBoxLayout, QHeaderView, QLabel, QLineEdit,
    QPushButton, QSpinBox, QTableWidget, QTableWidgetItem, QTabWidget,
    QTextEdit, QVBoxLayout, QWidget, QInputDialog,
)

from services import lifecycle_service as lc
from services import cleanup_service as cs
from services import purge_service as ps
from services.customer_service import ValidationError
from ui import style
from ui.widgets import apply_column_weights

# ── ألوان ──────────────────────────────────────────────────────
_C = {
    "primary": "#1E40AF", "primary_light": "#EEF2FF",
    "danger": "#DC2626", "danger_light": "#FEF2F2",
    "success": "#059669", "success_light": "#ECFDF5",
    "warning": "#D97706", "warning_light": "#FFFBEB",
    "border": "#E2E8F0", "bg": "#F8FAFC",
}

# ── أدوات مساعدة ───────────────────────────────────────────────
def _btn(text, color, hover, slot=None):
    b = QPushButton(text)
    b.setStyleSheet(
        f"QPushButton {{ background: {color}; color: white; padding: 8px 16px;"
        f" border-radius: 6px; font-weight: bold; font-size: 13px; }}"
        f" QPushButton:hover {{ background: {hover}; }}")
    if slot:
        b.clicked.connect(slot)
    return b


def _ghost_btn(text, slot=None):
    b = QPushButton(text)
    b.setStyleSheet(
        "QPushButton { background: transparent; color: #374151; padding: 6px 12px;"
        " border: 1px solid #D1D5DB; border-radius: 6px; font-size: 12px; }"
        " QPushButton:hover { background: #F3F4F6; }")
    if slot:
        b.clicked.connect(slot)
    return b


def _make_table():
    t = QTableWidget()
    t.setEditTriggers(QAbstractItemView.NoEditTriggers)
    t.setSelectionBehavior(QAbstractItemView.SelectRows)
    t.setSelectionMode(QAbstractItemView.SingleSelection)
    t.verticalHeader().setVisible(False)
    t.setAlternatingRowColors(True)
    t.setStyleSheet(f"""
        QTableWidget {{
            border: 1px solid {_C['border']}; border-radius: 6px;
            gridline-color: {_C['border']};
        }}
        QHeaderView::section {{
            background: {_C['primary_light']}; padding: 8px;
            border: none; border-bottom: 2px solid {_C['primary']};
            font-weight: bold;
        }}
    """)
    return t


def _search_input(placeholder):
    le = QLineEdit()
    le.setPlaceholderText(placeholder)
    le.setStyleSheet(f"""
        QLineEdit {{
            padding: 10px 15px; border: 2px solid {_C['border']};
            border-radius: 8px; font-size: 14px;
        }}
        QLineEdit:focus {{ border-color: {_C['primary']}; }}
    """)
    return le


def _card_group(title):
    g = QGroupBox(title)
    g.setStyleSheet(f"QGroupBox {{ font-weight: bold; border: 1px solid {_C['border']};"
                    f" border-radius: 8px; margin-top: 10px; padding-top: 20px; }}")
    return g


# ═══════════════════════════════════════════════════════════════
# الرئيسية
# ═══════════════════════════════════════════════════════════════
class DataManagementDialog(QDialog):

    def __init__(self, parent=None):
        super().__init__(parent)
        style.ensure_light_background(self)
        self.setWindowTitle("🧹 إدارة البيانات")
        self.setLayoutDirection(Qt.RightToLeft)
        style.fit_window(self, 1200, 800, min_w=900, min_h=600)

        root = QVBoxLayout(self)
        root.setContentsMargins(16, 12, 16, 12)
        root.setSpacing(12)

        hdr = QHBoxLayout()
        title = QLabel("🧹 إدارة البيانات")
        title.setProperty("pageTitle", True)
        hdr.addWidget(title)
        hdr.addStretch()
        root.addLayout(hdr)

        self.tabs = QTabWidget()
        self.tabs.setStyleSheet("""
            QTabBar::tab {
                padding: 10px 20px; font-weight: bold;
                border: 1px solid #E2E8F0; border-bottom: none;
                border-top-left-radius: 8px; border-top-right-radius: 8px;
                margin-right: 2px; font-size: 13px;
            }
            QTabBar::tab:selected { background: #1E40AF; color: white; }
            QTabBar::tab:!selected { background: #F1F5F9; }
        """)

        self.tabs.addTab(self._tab_search(), "🔍 بحث شامل")
        self.tabs.addTab(self._tab_report(), "📊 تقرير البيانات")
        self.tabs.addTab(self._tab_delete(), "🗑️ حذف البيانات")
        self.tabs.addTab(self._tab_employees(), "👥 الموظفين")
        self.tabs.addTab(self._tab_audit(), "📝 سجل العمليات")

        root.addWidget(self.tabs)

    # ═══════════════════════════════════════════════════════════
    # تبويب 1: بحث شامل
    # ═══════════════════════════════════════════════════════════
    def _tab_search(self):
        w = QWidget()
        lay = QVBoxLayout(w)
        lay.setContentsMargins(12, 12, 12, 12)
        lay.setSpacing(10)

        # فلتر النوع
        filter_row = QHBoxLayout()
        self._type_filter = QComboBox()
        self._type_filter.addItems(["الكل", "العملاء", "المقاولون", "العقود", "السندات", "المطالبات"])
        self._type_filter.setStyleSheet(f"""
            QComboBox {{
                padding: 8px 12px; border: 2px solid {_C['border']};
                border-radius: 8px; font-size: 13px; min-width: 120px;
            }}
        """)
        filter_row.addWidget(self._type_filter)

        self._search_input = _search_input("🔍 ابحث بالاسم، الكود، رقم العقد، رقم الهاتف...")
        self._search_input.returnPressed.connect(self._do_search)
        filter_row.addWidget(self._search_input, 1)
        filter_row.addWidget(_btn("🔍 بحث", _C["primary"], "#1E3A8A", self._do_search))
        lay.addLayout(filter_row)

        # جدول النتائج
        self._result_table = _make_table()
        self._result_table.itemDoubleClicked.connect(self._show_detail)
        lay.addWidget(self._result_table, 1)

        # شريط معلومات
        self._search_info = QLabel("")
        self._search_info.setStyleSheet("color: #64748B; font-size: 12px;")
        lay.addWidget(self._search_info)

        return w

    def _do_search(self):
        q = self._search_input.text().strip()
        if not q:
            style.error(self, "اكتب نصًا للبحث.")
            return

        ftype = self._type_filter.currentText()
        type_map = {"الكل": "", "العملاء": "customer", "المقاولون": "subcontractor",
                    "العقود": "contract", "السندات": "voucher", "المطالبات": "claim"}

        try:
            results = cs.search_all(q)
        except Exception:
            results = {}

        t = self._result_table
        t.setRowCount(0)
        t.setColumnCount(5)
        t.setHorizontalHeaderLabels(["النوع", "المعرف", "الاسم/الرقم", "تفاصيل", ""])

        section_map = {"العملاء": "customer", "المقاولون": "subcontractor",
                       "العقود": "contract", "السندات": "voucher", "المطالبات": "claim"}

        r = 0
        for section, rows in results.items():
            stype = section_map.get(section, "")
            if ftype != "الكل" and stype != type_map[ftype]:
                continue
            for row in rows:
                t.setRowCount(r + 1)
                t.setItem(r, 0, QTableWidgetItem(section))
                t.setItem(r, 1, QTableWidgetItem(str(row.get("id", ""))))
                name = (row.get("name") or row.get("contract_number")
                        or row.get("voucher_number") or row.get("claim_number") or "")
                t.setItem(r, 2, QTableWidgetItem(name))
                detail = (row.get("phone") or row.get("customer")
                          or row.get("activity") or row.get("vtype")
                          or row.get("status") or "")
                t.setItem(r, 3, QTableWidgetItem(detail))
                btn = _ghost_btn("👁 تفاصيل")
                btn.clicked.connect(lambda _, s=stype, i=row.get("id"): self._open_detail(s, i))
                t.setCellWidget(r, 4, btn)
                t.item(r, 0).setData(Qt.UserRole, stype)
                t.item(r, 0).setData(Qt.UserRole + 1, row.get("id"))
                r += 1

        apply_column_weights(t, [12, 8, 30, 30, 20])
        self._search_info.setText(f"تم العثور على {r} نتيجة")

    def _show_detail(self, item):
        r = item.row()
        etype = self._result_table.item(r, 0).data(Qt.UserRole) or ""
        eid = self._result_table.item(r, 0).data(Qt.UserRole + 1)
        if etype and eid:
            self._open_detail(etype, int(eid))

    def _open_detail(self, etype, eid):
        if not etype or not eid:
            return
        try:
            details = cs.get_entity_details(etype, int(eid))
        except Exception:
            details = None
        if details:
            _show_detail_popup(self, etype, details)

    # ═══════════════════════════════════════════════════════════
    # تبويب 2: تقرير البيانات
    # ═══════════════════════════════════════════════════════════
    def _tab_report(self):
        w = QWidget()
        lay = QVBoxLayout(w)
        lay.setContentsMargins(12, 12, 12, 12)
        lay.setSpacing(10)

        bar = QHBoxLayout()
        bar.addWidget(_btn("🔄 تحديث", _C["primary"], "#1E3A8A", self._refresh_report))
        bar.addStretch()
        lay.addLayout(bar)

        self._report_text = QTextEdit()
        self._report_text.setReadOnly(True)
        self._report_text.setStyleSheet(
            "QTextEdit { font-family: 'Consolas', monospace;"
            " font-size: 13px; padding: 12px; border: 1px solid #E2E8F0;"
            " border-radius: 8px; background: #F8FAFC; }")
        lay.addWidget(self._report_text, 1)

        self._refresh_report()
        return w

    def _refresh_report(self):
        try:
            report = cs.get_full_report()
        except Exception as exc:
            self._report_text.setText(f"خطأ: {exc}")
            return

        lines = ["═══ التقرير الشامل لحالة البيانات ═══\n"]

        stats = report.get("stats", {})
        lines.append("📊 الإحصائيات:")
        lines.append(f"  العملاء: {stats.get('customers', 0)}")
        lines.append(f"  المقاولون: {stats.get('subcontractors', 0)}")
        lines.append(f"  العقود: {stats.get('contracts', 0)}")
        lines.append(f"  السندات: {stats.get('vouchers', 0)}")
        lines.append(f"  المطالبات: {stats.get('claims', 0)}")
        lines.append("")

        warnings = report.get("warnings", [])
        if warnings:
            lines.append("⚠️ تحذيرات:")
            for w in warnings:
                lines.append(f"  • {w}")
            lines.append("")

        details = report.get("details", {})
        if details:
            lines.append("📋 تفاصيل:")
            for k, v in details.items():
                lines.append(f"  {k}: {v}")

        self._report_text.setText("\n".join(lines))

    # ═══════════════════════════════════════════════════════════
    # تبويب 3: حذف البيانات
    # ═══════════════════════════════════════════════════════════
    def _tab_delete(self):
        w = QWidget()
        lay = QVBoxLayout(w)
        lay.setContentsMargins(12, 12, 12, 12)
        lay.setSpacing(14)

        lbl = QLabel("⚠️ الحذف المتسلسل: يحذف الكيان مع كل ما يتبعه.\nيُحفظ snapshot في السجل قبل كل حذف.")
        lbl.setStyleSheet(f"color: {_C['warning']}; font-weight: bold;")
        lbl.setWordWrap(True)
        lay.addWidget(lbl)

        # حذف عميل
        g1 = _card_group("👥 حذف عميل بالكامل")
        h1 = QHBoxLayout(g1)
        h1.addWidget(_btn("🗑 حذف عميل…", _C["danger"], "#B91C1C",
                          lambda: self._purge_entity("customer")))
        h1.addWidget(_ghost_btn("👁 معاينة", lambda: self._preview_purge("customer")))
        h1.addStretch()
        lay.addWidget(g1)

        # حذف عقد
        g2 = _card_group("📋 حذف عقد")
        h2 = QHBoxLayout(g2)
        h2.addWidget(_btn("🗑 حذف عقد…", _C["danger"], "#B91C1C",
                          lambda: self._purge_entity("contract")))
        h2.addWidget(_ghost_btn("👁 معاينة", lambda: self._preview_purge("contract")))
        h2.addStretch()
        lay.addWidget(g2)

        # حذف سندات
        g3 = _card_group("💰 حذف سندات")
        h3 = QHBoxLayout(g3)
        h3.addWidget(_btn("🗑 حذف سندات…", _C["danger"], "#B91C1C",
                          lambda: self._purge_entity("voucher")))
        h3.addStretch()
        lay.addWidget(g3)

        # حذف مقاول
        g4 = _card_group("👷 حذف مقاول باطن")
        h4 = QHBoxLayout(g4)
        h4.addWidget(_btn("🗑 حذف مقاول…", _C["danger"], "#B91C1C",
                          lambda: self._purge_entity("subcontractor")))
        h4.addWidget(_ghost_btn("👁 معاينة", lambda: self._preview_purge("subcontractor")))
        h4.addStretch()
        lay.addWidget(g4)

        # حذف مطالبات
        g5 = _card_group("📝 حذف مطالبات عقد")
        h5 = QHBoxLayout(g5)
        h5.addWidget(_btn("🗑 حذف مطالبات…", _C["danger"], "#B91C1C",
                          lambda: self._purge_entity("claims")))
        h5.addWidget(_ghost_btn("👁 معاينة", lambda: self._preview_purge("claims")))
        h5.addStretch()
        lay.addWidget(g5)

        # إعادة التعيين
        lay.addSpacing(20)
        reset_row = QHBoxLayout()
        reset_row.addStretch()
        reset_btn = _btn("⚠️ إعادة تعيين كاملة (حذف كل البيانات)",
                         "#7F1D1D", "#991B1B", self._full_reset)
        reset_btn.setStyleSheet(reset_btn.styleSheet() +
                                " QPushButton { font-size: 14px; padding: 12px 24px; }")
        reset_row.addWidget(reset_btn)
        lay.addLayout(reset_row)

        lay.addStretch()
        return w

    def _purge_entity(self, kind):
        try:
            from ui.purge_tool import PurgeDialog
            PurgeDialog(self, kind).exec()
        except Exception as exc:
            style.error(self, f"تعذر فتح أداة الحذف: {exc}")

    def _preview_purge(self, kind):
        try:
            from ui.purge_tool import PurgeDialog
            PurgeDialog(self, kind).exec()
        except Exception as exc:
            style.error(self, f"تعذر فتح المعاينة: {exc}")

    def _full_reset(self):
        if not style.confirm(self,
                "⚠️ تحذير: سيحذف هذا جميع البيانات نهائياً!\n"
                "العملاء، العقود، السندات، المقاولون، المطالبات — كل شيء.\n"
                "هل أنت متأكد؟"):
            return
        reason, ok = QInputDialog.getText(self, "سبب إعادة التعيين", "اكتب السبب:")
        if not ok or not reason.strip():
            return
        try:
            result = cs.full_reset(reason.strip())
            style.toast(self, f"تم حذف {sum(result.values())} سجل.")
        except Exception as exc:
            style.error(self, str(exc))

    # ═══════════════════════════════════════════════════════════
    # تبويب 4: الموظفين
    # ═══════════════════════════════════════════════════════════
    def _tab_employees(self):
        w = QWidget()
        lay = QVBoxLayout(w)
        lay.setContentsMargins(12, 12, 12, 12)
        lay.setSpacing(10)

        bar = QHBoxLayout()
        bar.addWidget(_btn("➕ إضافة موظف", _C["success"], "#047857", self._emp_add))
        bar.addWidget(_ghost_btn("✏️ تعديل المحدد", self._emp_edit))
        bar.addWidget(_btn("🗑 حذف المحدد", _C["danger"], "#B91C1C", self._emp_delete))
        bar.addWidget(_ghost_btn("⏸ تعطيل/تفعيل", self._emp_toggle))
        bar.addStretch()
        lay.addLayout(bar)

        self._emp_table = _make_table()
        self._emp_table.setColumnCount(6)
        self._emp_table.setHorizontalHeaderLabels(
            ["#", "الاسم", "الهاتف", "الملاحظات", "الرصيد", "الحالة"])
        self._emp_table.itemDoubleClicked.connect(self._emp_edit)
        lay.addWidget(self._emp_table, 1)

        self._emp_total = QLabel("")
        self._emp_total.setStyleSheet("font-weight: 800; color: #1E3A8A;")
        lay.addWidget(self._emp_total)

        self._refresh_employees()
        return w

    def _refresh_employees(self):
        try:
            emps = lc.list_employees(active_only=False)
        except Exception:
            emps = []
        try:
            balances = {int(b["employee_id"]): b for b in lc.employee_balances()}
        except Exception:
            balances = {}

        t = self._emp_table
        t.setRowCount(len(emps))
        total = 0.0
        for i, e in enumerate(emps):
            eid = int(e["id"])
            bal = balances.get(eid, {})
            remaining = float(bal.get("remaining") or 0)
            total += remaining
            status = "نشط" if e.get("active", 1) else "معطّل"
            t.setItem(i, 0, QTableWidgetItem(str(eid)))
            t.setItem(i, 1, QTableWidgetItem(e.get("name") or ""))
            t.setItem(i, 2, QTableWidgetItem(e.get("phone") or ""))
            t.setItem(i, 3, QTableWidgetItem(e.get("notes") or ""))
            t.setItem(i, 4, QTableWidgetItem(f"{remaining:,.3f}"))
            st = QTableWidgetItem(status)
            if not e.get("active", 1):
                st.setForeground(QColor("#9CA3AF"))
            t.setItem(i, 5, st)
        apply_column_weights(t, [6, 25, 15, 20, 15, 10])
        self._emp_total.setText(f"العدد: {len(emps)} · إجمالي الرصيد: {total:,.3f} د.ك")

    def _emp_add(self):
        if _EmployeeEditDialog(self).exec():
            self._refresh_employees()

    def _emp_edit(self, *_):
        r = self._emp_table.currentRow()
        if r < 0:
            style.info(self, "اختر موظفاً أولاً.")
            return
        eid = int(self._emp_table.item(r, 0).text())
        try:
            emp = lc.get_employee(eid)
        except Exception:
            emp = None
        if not emp:
            style.error(self, "الموظف غير موجود.")
            return
        if _EmployeeEditDialog(self, emp).exec():
            self._refresh_employees()

    def _emp_delete(self):
        r = self._emp_table.currentRow()
        if r < 0:
            style.info(self, "اختر موظفاً أولاً.")
            return
        eid = int(self._emp_table.item(r, 0).text())
        name = self._emp_table.item(r, 1).text()
        if not style.confirm(self, f"هل تريد حذف «{name}»؟\nلن يُحذف إذا كان له سلف نشطة."):
            return
        try:
            lc.delete_employee(eid)
            style.toast(self, f"تم حذف «{name}»")
            self._refresh_employees()
        except (ValidationError, Exception) as exc:
            style.error(self, str(exc))

    def _emp_toggle(self):
        r = self._emp_table.currentRow()
        if r < 0:
            return
        eid = int(self._emp_table.item(r, 0).text())
        try:
            emp = lc.get_employee(eid)
        except Exception:
            return
        if not emp:
            return
        new = not bool(emp.get("active", 1))
        lc.set_employee_active(eid, new)
        style.toast(self, f"{'تفعيل' if new else 'تعطيل'} «{emp['name']}»")
        self._refresh_employees()

    # ═══════════════════════════════════════════════════════════
    # تبويب 5: سجل العمليات
    # ═══════════════════════════════════════════════════════════
    def _tab_audit(self):
        w = QWidget()
        lay = QVBoxLayout(w)
        lay.setContentsMargins(12, 12, 12, 12)
        lay.setSpacing(10)

        bar = QHBoxLayout()
        bar.addWidget(_btn("🔄 تحديث", _C["primary"], "#1E3A8A", self._refresh_audit))
        bar.addStretch()
        lay.addLayout(bar)

        self._audit_table = _make_table()
        self._audit_table.setColumnCount(6)
        self._audit_table.setHorizontalHeaderLabels(
            ["#", "التاريخ", "المستخدم", "النوع", "الكيان", "السبب"])
        self._audit_table.itemDoubleClicked.connect(self._audit_snapshot)
        lay.addWidget(self._audit_table, 1)

        self._refresh_audit()
        return w

    def _refresh_audit(self):
        try:
            rows = ps.audit_log()
        except Exception:
            rows = []
        t = self._audit_table
        t.setRowCount(len(rows))
        for i, r in enumerate(rows):
            t.setItem(i, 0, QTableWidgetItem(str(r.get("id", ""))))
            t.setItem(i, 1, QTableWidgetItem(r.get("deleted_at") or ""))
            t.setItem(i, 2, QTableWidgetItem(r.get("deleted_by") or ""))
            t.setItem(i, 3, QTableWidgetItem(r.get("entity_type") or ""))
            t.setItem(i, 4, QTableWidgetItem(r.get("entity_label") or ""))
            t.setItem(i, 5, QTableWidgetItem(r.get("reason") or ""))
        apply_column_weights(t, [6, 18, 12, 12, 30, 22])

    def _audit_snapshot(self, item):
        r = item.row()
        aid = int(self._audit_table.item(r, 0).text())
        try:
            snap = ps.audit_snapshot(aid)
        except Exception:
            snap = None
        if snap:
            _show_detail_popup(self, "audit", snap)


# ═══════════════════════════════════════════════════════════════
# نافذة تعديل الموظف
# ═══════════════════════════════════════════════════════════════
class _EmployeeEditDialog(QDialog):

    def __init__(self, parent=None, emp=None):
        super().__init__(parent)
        self._emp = emp
        is_edit = emp is not None
        self.setWindowTitle("✏️ تعديل موظف" if is_edit else "➕ موظف جديد")
        self.setMinimumWidth(380)
        self.setLayoutDirection(Qt.RightToLeft)

        root = QVBoxLayout(self)
        form = QFormLayout()
        self.name = QLineEdit((emp or {}).get("name") or "")
        self.phone = QLineEdit((emp or {}).get("phone") or "")
        self.notes = QLineEdit((emp or {}).get("notes") or "")
        form.addRow("الاسم:*", self.name)
        form.addRow("الهاتف:", self.phone)
        form.addRow("الملاحظات:", self.notes)
        root.addLayout(form)

        bb = QHBoxLayout()
        bb.addStretch()
        bb.addWidget(_btn("💾 حفظ", _C["primary"], "#1E3A8A", self._save))
        bb.addWidget(_ghost_btn("إلغاء", self.reject))
        root.addLayout(bb)

    def _save(self):
        try:
            if self._emp:
                lc.update_employee(int(self._emp["id"]),
                                   self.name.text(), self.phone.text(), self.notes.text())
            else:
                lc.add_employee(self.name.text(), self.phone.text(), self.notes.text())
            self.accept()
        except (ValidationError, Exception) as exc:
            style.error(self, str(exc))


# ═══════════════════════════════════════════════════════════════
# نافذة التفاصيل
# ═══════════════════════════════════════════════════════════════
def _show_detail_popup(parent, etype, details):
    dlg = QDialog(parent)
    dlg.setWindowTitle(f"تفاصيل {etype}")
    dlg.setMinimumSize(500, 400)
    dlg.setLayoutDirection(Qt.RightToLeft)
    lay = QVBoxLayout(dlg)
    txt = QTextEdit()
    txt.setReadOnly(True)
    import json
    txt.setText(json.dumps(details, indent=2, ensure_ascii=False, default=str))
    lay.addWidget(txt)
    dlg.exec()
