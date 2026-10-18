# -*- coding: utf-8 -*-
"""شاشة الإعدادات · منظمة بتبويبات: الشركة | المظهر | الأمان | النسخ الاحتياطي."""
import os
import shutil
from datetime import datetime

from PySide6.QtCore import QDate, Qt, Signal
from ui.widgets import SafeDateEdit, make_searchable
from PySide6.QtGui import QColor, QPixmap
from PySide6.QtWidgets import (
    QCheckBox, QComboBox, QDialog, QFileDialog, QFormLayout, QFrame,
    QGridLayout, QHBoxLayout, QHeaderView, QInputDialog, QLabel, QLineEdit,
    QMessageBox, QPushButton, QScrollArea, QSpinBox,
    QListWidget, QListWidgetItem, QTableWidget, QTableWidgetItem, QTabWidget, QVBoxLayout, QWidget,
)

from services.db_facade_service import DatabaseError, backup_db, restore_db, BASE_DIR
from database.models import Settings
from ui.widgets import flow_host as _flow
from services import auth_service, backup_service, settings_service
from services.customer_service import ValidationError
from ui import style
from ui.widgets import SafeDoubleSpinBox, SafeSpinBox

LOGO_DIR = os.path.join(BASE_DIR, "assets", "logo")


class ChangePasswordDialog(QDialog):
    """نافذة تغيير اسم المستخدم وكلمة المرور."""

    def __init__(self, parent=None):
        super().__init__(parent)
        style.ensure_light_background(self)
        self.setWindowTitle("تغيير بيانات الدخول")
        self.setLayoutDirection(Qt.RightToLeft)
        self.setMinimumWidth(380)

        form = QFormLayout()
        form.setSpacing(10)

        self.current_password = QLineEdit()
        self.current_password.setEchoMode(QLineEdit.Password)
        self._current_username = auth_service.current_username() or auth_service.get_username()
        self.new_username = QLineEdit()
        self.new_username.setText(self._current_username)
        if not auth_service.is_admin():
            self.new_username.setReadOnly(True)
            self.new_username.setToolTip("السكرتير يغيّر كلمة مروره فقط؛ تغيير اسم الدخول للمدير.")
        self.new_password = QLineEdit()
        self.new_password.setEchoMode(QLineEdit.Password)
        self.confirm_password = QLineEdit()
        self.confirm_password.setEchoMode(QLineEdit.Password)

        form.addRow("كلمة المرور الحالية *", self.current_password)
        form.addRow("اسم المستخدم" if not auth_service.is_admin() else "اسم المستخدم الجديد *", self.new_username)
        form.addRow("كلمة المرور الجديدة *", self.new_password)
        form.addRow("تأكيد كلمة المرور *", self.confirm_password)

        buttons = QHBoxLayout()
        save_btn = QPushButton("💾 حفظ")
        save_btn.setObjectName("btnPrimary")
        cancel_btn = QPushButton("✕ إلغاء")
        cancel_btn.setProperty("flat", True)
        save_btn.clicked.connect(self._save)
        cancel_btn.clicked.connect(self.reject)
        buttons.addStretch()
        buttons.addWidget(save_btn)
        buttons.addWidget(cancel_btn)

        layout = QVBoxLayout(self)
        layout.addLayout(form)
        layout.addLayout(buttons)

    def _save(self):
        from ui.widgets import RequiredValidator
        v = RequiredValidator(self)
        v.add(self.current_password, "كلمة المرور الحالية")
        v.add(self.new_username, "اسم المستخدم الجديد")
        v.add(self.new_password, "كلمة المرور الجديدة")
        v.add(self.confirm_password, "تأكيد كلمة المرور")
        if not v.validate():
            return
        try:
            auth_service.change_credentials(
                self._current_username,
                self.current_password.text(),
                self.new_username.text() if auth_service.is_admin() else self._current_username,
                self.new_password.text(),
                self.confirm_password.text(),
            )
            new_name = self.new_username.text().strip() if auth_service.is_admin() else self._current_username
            if new_name and new_name != self._current_username:
                auth_service.set_current_user(new_name)
            style.info(self, "تم تغيير بيانات الدخول بنجاح.\n"
                       "استخدمها في تسجيل الدخول القادم.", "تم")
            self.accept()
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))


def _card() -> tuple[QFrame, QVBoxLayout]:
    frame = QFrame()
    frame.setProperty("card", True)
    layout = QVBoxLayout(frame)
    layout.setContentsMargins(14, 12, 14, 12)
    layout.setSpacing(8)
    return frame, layout


# ============================================================
# إدارة طرق الدفع ورسومها
# ============================================================
class PaymentMethodsDialog(QDialog):
    """نافذة إدارة طرق الدفع (نقد · تحويل · KNET · شيك · أخرى).

    لكل طريقة اسم + نوع الرسوم (مبلغ مقطوع أو نسبة %) + قيمة الرسوم.
    """

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("طرق الدفع والرسوم")
        self.setLayoutDirection(Qt.RightToLeft)
        self.setMinimumWidth(560)
        style.setup_dialog(self, "طرق الدفع والرسوم",
                           "كل طريقة دفع يمكن أن يخصم عليها رسم تلقائي "
                           "عند إنشاء سند قبض بها", "💳",
                           min_w=560, max_w=720)
        self._build()
        self._reload()

    def _build(self):
        lay = self.body_layout
        self.table = QTableWidget(0, 4)
        self.table.setHorizontalHeaderLabels(
            ["الطريقة", "نوع الرسوم", "القيمة", "الحالة"])
        self.table.verticalHeader().setVisible(False)
        self.table.setSelectionBehavior(QTableWidget.SelectRows)
        self.table.setEditTriggers(QTableWidget.NoEditTriggers)
        h = self.table.horizontalHeader()
        h.setSectionResizeMode(0, QHeaderView.Stretch)
        h.setSectionResizeMode(1, QHeaderView.ResizeToContents)
        h.setSectionResizeMode(2, QHeaderView.ResizeToContents)
        h.setSectionResizeMode(3, QHeaderView.ResizeToContents)
        lay.addWidget(self.table)

        row = QHBoxLayout()
        add_btn = QPushButton("＋ إضافة طريقة")
        add_btn.setObjectName("btnPrimary")
        add_btn.clicked.connect(self._add)
        edit_btn = QPushButton("✎ تعديل")
        edit_btn.clicked.connect(self._edit)
        toggle_btn = QPushButton("تفعيل/إيقاف")
        toggle_btn.clicked.connect(self._toggle)
        del_btn = QPushButton("🗑 حذف")
        del_btn.setProperty("flat", True)
        del_btn.clicked.connect(self._delete)
        for b in (add_btn, edit_btn, toggle_btn, del_btn):
            b.setCursor(Qt.PointingHandCursor)
            row.addWidget(b)
        row.addStretch()
        lay.addLayout(row)
        style.dialog_buttons(self, "إغلاق", on_save=self.accept)

    def _reload(self):
        from services import settings_service as _ss
        methods = _ss.list_payment_methods(active_only=False)
        self.table.setRowCount(len(methods))
        self._ids = []
        for r, m in enumerate(methods):
            self._ids.append(m["id"])
            fee_type = "نسبة %" if m["fee_type"] == "percent" else "مبلغ"
            value = (f"{m['fee_value']:g} %"
                     if m["fee_type"] == "percent"
                     else f"{m['fee_value']:,.3f}")
            cells = [m["name"], fee_type, value,
                     "مفعّلة" if m["is_active"] else "موقوفة"]
            for c, txt in enumerate(cells):
                item = QTableWidgetItem(str(txt))
                if c == 3:
                    from PySide6.QtGui import QColor as _QC
                    item.setForeground(
                        _QC(style.GREEN_DEEP if m["is_active"]
                            else style.MUTED))
                self.table.setItem(r, c, item)

    def _selected_id(self):
        row = self.table.currentRow()
        if row < 0 or row >= len(getattr(self, "_ids", [])):
            style.info(self, "اختر طريقة من الجدول أولًا.")
            return None
        return self._ids[row]

    def _prompt_method(self, name="", fee_type="amount", fee_value=0.0):
        """نافذة إدخال بسيطة لطريقة دفع. ترجع (name, fee_type, fee_value)."""
        dlg = QDialog(self)
        dlg.setWindowTitle("بيانات طريقة الدفع")
        dlg.setLayoutDirection(Qt.RightToLeft)
        form = QFormLayout(dlg)
        name_edit = QLineEdit(name)
        type_combo = QComboBox()
        type_combo.addItem("مبلغ مقطوع (د.ك)", "amount")
        type_combo.addItem("نسبة مئوية (%)", "percent")
        idx = 0 if fee_type == "amount" else 1
        type_combo.setCurrentIndex(idx)
        make_searchable(type_combo, "")
        val_spin = SafeDoubleSpinBox()
        val_spin.setRange(0, 1e9)
        val_spin.setDecimals(3)
        val_spin.setValue(float(fee_value or 0))
        form.addRow("اسم الطريقة", name_edit)
        form.addRow("نوع الرسوم", type_combo)
        form.addRow("القيمة", val_spin)
        btns = QHBoxLayout()
        ok = QPushButton("💾 حفظ")
        ok.setObjectName("btnPrimary")
        cancel = QPushButton("✕ إلغاء")
        cancel.setProperty("flat", True)
        ok.clicked.connect(dlg.accept)
        cancel.clicked.connect(dlg.reject)
        btns.addStretch()
        btns.addWidget(cancel)
        btns.addWidget(ok)
        form.addRow(btns)
        if dlg.exec() != QDialog.Accepted:
            return None
        nm = name_edit.text().strip()
        if not nm:
            style.error(self, "اكتب اسمًا لطريقة الدفع.")
            return None
        return (nm, type_combo.currentData(),
                float(val_spin.value()))

    def _add(self):
        data = self._prompt_method()
        if not data:
            return
        try:
            from services import settings_service as _ss
            _ss.add_payment_method(*data)
            self._reload()
        except ValidationError as e:
            style.error(self, str(e))

    def _edit(self):
        mid = self._selected_id()
        if mid is None:
            return
        from services import settings_service as _ss
        all_methods = {m["id"]: m for m in _ss.list_payment_methods(False)}
        m = all_methods.get(mid)
        if not m:
            return
        data = self._prompt_method(m["name"], m["fee_type"], m["fee_value"])
        if not data:
            return
        try:
            _ss.update_payment_method(mid, *data)
            self._reload()
        except ValidationError as e:
            style.error(self, str(e))

    def _toggle(self):
        mid = self._selected_id()
        if mid is None:
            return
        from services import settings_service as _ss
        all_methods = {m["id"]: m for m in _ss.list_payment_methods(False)}
        m = all_methods.get(mid)
        if not m:
            return
        from services import ui_data_service as ui_data
        ui_data.set_payment_method_active(mid, not m["is_active"])
        self._reload()

    def _delete(self):
        mid = self._selected_id()
        if mid is None:
            return
        if not style.confirm(self, "حذف طريقة الدفع دي؟\n"
                             "السندات القديمة المرتبطة بيها ما تتأثرش."):
            return
        from services import settings_service as _ss
        _ss.delete_payment_method(mid)
        self._reload()


# ============================================================
# صلاحيات الموظف الدقيقة (Granular Permissions)
# ============================================================
class UserPermsDialog(QDialog):
    """نافذة «صلاحيات الموظف»: يؤشّر المدير لكل موظف ما يراه من
    الشاشات وما يفعله من الإجراءات — بدل الصلاحيات المجمّعة حسب
    الدور فقط.
    """

    def __init__(self, user: dict, parent=None):
        super().__init__(parent)
        self.user = user
        uid = int(user.get("id") or 0)
        self._uid = uid
        self._customized = auth_service.user_is_customized(uid)
        self._perms = auth_service.get_user_perms(
            uid, user.get("role", ""))
        who = (user.get("full_name") or "").strip() or user.get("username", "")
        job = (user.get("job_title") or "").strip()
        sub = who + (f" · {job}" if job else "")
        style.setup_dialog(self, "صلاحيات الموظف", sub, "🔐",
                           size_ratio=0.68, min_w=900, max_w=1120)
        self.setMinimumSize(900, 720)
        self.resize(max(self.width(), 980), max(self.height(), 760))
        lay = self.body_layout

        hint = QLabel(
            "أشّر ما يظهر لهذا الموظف من الشاشات والتقارير وما يستطيع "
            "فعله من إجراءات. التأشيرات الفارغة تعني افتراضيات دوره "
            "(العمل اليومي).")
        hint.setWordWrap(True)
        hint.setMinimumWidth(0)
        hint.setProperty("hint", True)
        lay.addWidget(hint)

        mode_host, mode_row = _flow(spacing=8)
        mode_row.addWidget(QLabel("نطاق الصلاحيات:"))
        self.mode = QComboBox()
        self.mode.addItem("افتراضي الدور (العمل اليومي)", "role")
        self.mode.addItem("تخصيص صلاحيات الموظف", "custom")
        make_searchable(self.mode, "")
        self.mode.currentIndexChanged.connect(self._mode_changed)
        mode_row.addWidget(self.mode)
        self.all_btn = QPushButton("تحديد الكل")
        self.all_btn.setProperty("flat", True)
        self.all_btn.clicked.connect(lambda: self._set_all(True))
        self.none_btn = QPushButton("✕ إلغاء الكل")
        self.none_btn.setProperty("flat", True)
        self.none_btn.clicked.connect(lambda: self._set_all(False))
        mode_row.addWidget(self.all_btn)
        mode_row.addWidget(self.none_btn)
        lay.addWidget(mode_host)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.NoFrame)
        scroll.setObjectName("transparentHost")
        holder = QWidget()
        holder.setObjectName("transparentHost")
        col = QVBoxLayout(holder)
        col.setContentsMargins(0, 0, 0, 0)
        col.setSpacing(12)
        self._boxes: dict[str, QCheckBox] = {}
        for group, items in auth_service.perm_catalog().items():
            gtitle = QLabel(group)
            gtitle.setProperty("sectionTitle", True)
            col.addWidget(gtitle)
            grid_host = QWidget()
            grid_host.setObjectName("transparentHost")
            grid = QGridLayout(grid_host)
            grid.setContentsMargins(8, 0, 8, 0)
            grid.setHorizontalSpacing(18)
            grid.setVerticalSpacing(8)
            half = (len(items) + 1) // 2
            for i, (key, spec) in enumerate(items):
                cb = QCheckBox(spec["name"])
                cb.setToolTip(spec.get("desc", ""))
                cb.setChecked(bool(self._perms.get(key)))
                cb.setMinimumWidth(0)
                self._boxes[key] = cb
                grid.addWidget(cb, i % half, i // half)
            col.addWidget(grid_host)
        self._link_voucher_edit_permissions()
        col.addStretch()
        scroll.setWidget(holder)
        scroll.setMinimumHeight(560)
        lay.addWidget(scroll, 1)

        btns_host, btns = _flow(spacing=8)
        save_btn = QPushButton("💾 حفظ الصلاحيات")
        save_btn.setObjectName("btnPrimary")
        save_btn.clicked.connect(self._save)
        cancel_btn = QPushButton("✕ إلغاء")
        cancel_btn.setProperty("flat", True)
        cancel_btn.clicked.connect(self.reject)
        btns.addWidget(save_btn)
        btns.addWidget(cancel_btn)
        lay.addWidget(btns_host)

        self.mode.setCurrentIndex(1 if self._customized else 0)
        self._mode_changed()

    def _link_voucher_edit_permissions(self):
        """صلاحية تعديل البيان فقط لا تظهر كاختيار مكرر عند السماح بتعديل السند كاملًا."""
        full = self._boxes.get("action_edit_voucher")
        desc = self._boxes.get("action_edit_voucher_description")
        if not full or not desc:
            return

        def sync(_=None):
            if full.isChecked():
                desc.blockSignals(True)
                desc.setChecked(False)
                desc.setEnabled(False)
                desc.setToolTip("غير مطلوب عند السماح بتعديل السند كاملًا؛ حفظ التعديل الكامل يتطلب اعتماد المدير.")
                desc.blockSignals(False)
            else:
                desc.setEnabled(self.mode.currentData() == "custom")
                desc.setToolTip("مسار احتياطي لتعديل البيان فقط إذا مُنع تعديل السند الكامل؛ والحفظ يتطلب اعتماد المدير.")
        full.toggled.connect(sync)
        sync()

    def _mode_changed(self):
        custom = self.mode.currentData() == "custom"
        for cb in self._boxes.values():
            cb.setEnabled(custom)
        # بعد تفعيل/تعطيل كل الخانات، طبّق قاعدة عدم تكرار تعديل السند/تعديل البيان فقط.
        full = self._boxes.get("action_edit_voucher")
        desc = self._boxes.get("action_edit_voucher_description")
        if full is not None and desc is not None and full.isChecked():
            desc.setChecked(False)
            desc.setEnabled(False)
        self.all_btn.setEnabled(custom)
        self.none_btn.setEnabled(custom)

    def _set_all(self, value: bool):
        if self.mode.currentData() != "custom":
            return
        for cb in self._boxes.values():
            cb.setChecked(value)
        full = self._boxes.get("action_edit_voucher")
        desc = self._boxes.get("action_edit_voucher_description")
        if value and full is not None and desc is not None and full.isChecked():
            desc.setChecked(False)
            desc.setEnabled(False)

    def _save(self):
        try:
            if self.mode.currentData() == "custom":
                perms = {k: cb.isChecked() for k, cb in self._boxes.items()}
                auth_service.set_user_perms(self._uid, perms)
            else:
                auth_service.reset_user_perms(self._uid)
        except DatabaseError as exc:
            style.error(self, str(exc))
            return
        self.accept()


class SettingsPage(QWidget):
    """شاشة الإعدادات · تبويبات: الشركة | الطباعة | الأمان | النسخ الاحتياطي."""

    settings_changed = Signal()
    db_restored = Signal()
    user_identity_changed = Signal()
    modules_changed = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("page")
        self._logo_path = ""
        self._theme = "light"
        self._build()

    def _build(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(16, 10, 16, 10)
        root.setSpacing(10)

        title = QLabel("الإعدادات")
        title.setProperty("pageTitle", True)
        root.addWidget(title)
        desc = QLabel("بيانات الشركة والطباعة والمستخدمون والأنواع والمراحل والنسخ — تُحفظ كل مجموعة من زرها")
        desc.setProperty("pageDesc", True)
        root.addWidget(desc)

        self.tabs = QTabWidget()
        from services import auth_service

        def _scrollable(widget: QWidget) -> QWidget:
            from PySide6.QtWidgets import QVBoxLayout as _QVB
            area = QScrollArea()
            area.setWidgetResizable(True)
            area.setFrameShape(QFrame.NoFrame)
            area.setObjectName("transparentHost")
            area.viewport().setObjectName("transparentHost")
            area.setHorizontalScrollBarPolicy(Qt.ScrollBarAsNeeded)
            footer = None
            for cand in widget.findChildren(QWidget):
                if getattr(cand, "_is_save_row", False):
                    footer = cand
                    break
            if footer is not None:
                parent_layout = (footer.parentWidget().layout()
                                 if footer.parentWidget() is not None else None)
                if parent_layout is not None:
                    parent_layout.removeWidget(footer)
                footer.setParent(None)
            area.setWidget(widget)
            if footer is None:
                return area
            host = QWidget()
            host.setObjectName("transparentHost")
            box = _QVB(host)
            box.setContentsMargins(0, 0, 0, 0)
            box.setSpacing(8)
            box.addWidget(area, 1)
            footer.setParent(host)
            box.addWidget(footer)
            return host

        if auth_service.is_admin():
            self.tabs.addTab(_scrollable(self._tab_company()), "⌂  بيانات الشركة")
        # السكرتير يرى من الإعدادات فقط ما طلبته الإدارة:
        # الطباعة والعرض + تغيير كلمة مرور حسابه. باقي التبويبات للمدير.
        self.tabs.addTab(_scrollable(self._tab_appearance()),
                         "▤  الطباعة والعرض")
        self.tabs.addTab(_scrollable(self._tab_security_users()),
                         "◆  كلمة المرور" if not auth_service.is_admin() else "◆  الأمان والمستخدمون")
        if auth_service.is_admin():
            self.tabs.addTab(_scrollable(self._tab_contract_types()),
                             "☰  أنواع العقود")
            self.tabs.addTab(_scrollable(self._tab_expense_accounts()),
                             "§  حسابات المصروفات")
        if auth_service.is_admin():
            # مراحل المتابعة أصبحت جزءًا أساسيًا من النظام ولا تُخفى بسبب
            # feature_flags قديمة مستعادة من Backup سابق.
            self.tabs.addTab(_scrollable(self._tab_workflow()),
                             "⇄  مراحل المتابعة")
            self.tabs.addTab(_scrollable(self._tab_visits()),
                             "◷  جدول الزيارات")
            self.tabs.addTab(_scrollable(self._tab_backup()),
                             "⊞  البيانات والنسخ الاحتياطي")
        if auth_service.is_developer():
            self.tabs.addTab(_scrollable(self._tab_developer()),
                             "⚙  أدوات المطور")
        root.addWidget(self.tabs, 1)

        from PySide6.QtWidgets import QPushButton as _QPB
        from ui.widgets import size_buttons as _size_btns
        _size_btns([b for b in self.findChildren(_QPB) if b.text().strip()],
                   uniform=False)

    def _tab_company(self) -> QWidget:
        page = QWidget()
        outer = QVBoxLayout(page)
        outer.setContentsMargins(0, 12, 0, 0)

        card, layout = _card()

        hint = QLabel("تظهر هذه البيانات في ترويسة الفواتير وكشوف الحساب.")
        hint.setProperty("hint", True)
        layout.addWidget(hint)

        form = QFormLayout()
        form.setSpacing(12)
        form.setLabelAlignment(Qt.AlignRight)

        self.name = QLineEdit()
        self.address = QLineEdit()
        self.phone = QLineEdit()
        self.email = QLineEdit()
        self.currency = QLineEdit()
        self.currency.setPlaceholderText("د.ك")
        self.currency.setFixedWidth(140)
        self.manager_phone = QLineEdit()
        self.manager_phone.setPlaceholderText(
            "رقم واتساب المدير · لإرسال ملخصات المهام (مثال: 99887766)")

        form.addRow("اسم الشركة", self.name)
        form.addRow("العنوان", self.address)
        form.addRow("الهاتف", self.phone)
        form.addRow("البريد الإلكتروني", self.email)
        form.addRow("العملة", self.currency)
        form.addRow("واتساب المدير", self.manager_phone)
        if auth_service.is_admin():
            self.header_title = QLineEdit()
            self.header_title.setPlaceholderText("نظام إدارة العقود والمحاسبة")
            self.header_title.setToolTip(
                "يظهر كنص هيدر في أعلى شاشات النظام ويُستخدم كعنوان افتراضي في المطبوعات عند الحاجة")
            form.addRow("نص هيدر النظام", self.header_title)

            logo_row_host, logo_row = _flow(spacing=8)
            logo_row.setSpacing(12)
            self.logo_preview = QLabel("لا يوجد شعار")
            self.logo_preview.setFixedSize(84, 84)
            self.logo_preview.setAlignment(Qt.AlignCenter)
            self.logo_preview.setStyleSheet(
                f"border: 2px dashed {style.BORDER}; border-radius: 10px;"
                f"color: {style.MUTED}; background: {style.READONLY_BG}; font-size: 9.3px;")
            pick_logo = QPushButton("اختيار شعار...")
            pick_logo.setProperty("flat", True)
            clear_logo = QPushButton("إزالة")
            clear_logo.setProperty("flat", True)
            pick_logo.clicked.connect(self._pick_logo)
            clear_logo.clicked.connect(self._clear_logo)
            logo_row.addWidget(self.logo_preview)
            logo_row.addWidget(pick_logo)
            logo_row.addWidget(clear_logo)
            form.addRow("شعار الشركة", logo_row_host)

        self.bank_fee = SafeDoubleSpinBox()
        self.bank_fee.setDecimals(3)
        self.bank_fee.setRange(0, 100)
        self.bank_fee.setFixedWidth(140)
        self.bank_fee.setToolTip(
            "يُنشئ النظام سند صرف بهذه القيمة تلقائيًا مع كل سند قبض "
            "بتحويل بنكي · ويُلغى معه إن أُلغي")
        self.opening_balance_bank = SafeDoubleSpinBox()
        self.opening_balance_bank.setDecimals(3)
        self.opening_balance_bank.setRange(-999_999_999, 999_999_999)
        self.opening_balance_bank.setGroupSeparatorShown(True)
        self.opening_balance_bank.setFixedWidth(180)
        self.opening_balance_cash = SafeDoubleSpinBox()
        self.opening_balance_cash.setDecimals(3)
        self.opening_balance_cash.setRange(-999_999_999, 999_999_999)
        self.opening_balance_cash.setGroupSeparatorShown(True)
        self.opening_balance_cash.setFixedWidth(180)
        # توافق مع كود قديم داخل نفس الصفحة: الإجمالي = بنك + صندوق عند الحفظ.
        self.opening_balance = self.opening_balance_cash
        self.opening_balance_date = SafeDateEdit()
        self.opening_balance_date.setCalendarPopup(True)
        self.opening_balance_date.setDisplayFormat("yyyy-MM-dd")
        self.opening_balance_date.setMinimumDate(QDate(1900, 1, 1))
        self.opening_balance_date.setSpecialValueText("غير محدد")
        self.opening_balance_date.setDate(
            self.opening_balance_date.minimumDate())
        self.opening_balance_date.setFixedWidth(180)
        # رسوم التحويل البنكي تُدار فقط من زر «إدارة طرق الدفع والرسوم».
        self.bank_fee.setVisible(False)
        # V6.4 (طلب المستخدم): «رصيد أول المدة» للمطور فقط — لا يظهر حتى
        # للمدير. الحقول تُنشأ دائمًا وتُحمَّل من القاعدة وتُحفظ كما هي، فلا
        # يتصفّر شيء عند حفظ المدير، وتبقى قيمها تغذّي التقارير المطبوعة
        # ومنع التحويل الداخلي من حساب رصيده غير كافٍ.
        self._opening_visible = bool(auth_service.is_developer())
        if self._opening_visible:
            _ob_row_host = QWidget()
            _ob_row = QHBoxLayout(_ob_row_host)
            _ob_row.setContentsMargins(0, 0, 0, 0)
            _ob_row.setSpacing(10)
            _ob_row.addWidget(self.opening_balance_bank)
            _ob_row.addWidget(self.opening_balance_cash)
            _ob_row.addWidget(self.opening_balance_date)
            _ob_row.addStretch()
            form.addRow("◆ رصيد أول المدة (بنك · صندوق · تاريخ)",
                        _ob_row_host)
            _cf_hint = QLabel(
                "الرصيد الافتتاحي للتقارير المالية ولمنع التحويل الداخلي من "
                "حساب رصيده غير كافٍ — يظهر للمطور فقط.")
            _cf_hint.setProperty("hint", True)
            _cf_hint.setWordWrap(True)
            form.addRow("", _cf_hint)
        else:
            for _w in (self.opening_balance_bank, self.opening_balance_cash,
                       self.opening_balance_date):
                _w.setVisible(False)

        layout.addLayout(form)

        # ===== V5.9: بداية الاحتساب النقدي (زر مؤقت) =====
        # يُستبعد ما قبل التاريخ من تقارير وأرصدة البنك/الصندوق ومن منع
        # التحويل الداخلي — بلا حذف أي سند من القاعدة.
        cash_host, cash_row = _flow(spacing=8)
        self.cash_start_lbl = QLabel("")
        self.cash_start_lbl.setWordWrap(True)
        cash_row.addWidget(self.cash_start_lbl)
        self.btn_cash_start = QPushButton("🧹 ابدأ الاحتساب من 2026-10-01 (مؤقت)")
        self.btn_cash_start.setToolTip(
            "استبعاد الحركات الأقدم من حسابات البنك والصندوق والتقارير النقدية — "
            "السندات نفسها لا تُحذف ولا تُعدّل، والزر قابل للإلغاء في أي وقت")
        self.btn_cash_start.clicked.connect(self._set_cash_start)
        cash_row.addWidget(self.btn_cash_start)
        self.btn_cash_clear = QPushButton("✕ إلغاء الاستبعاد")
        self.btn_cash_clear.setProperty("flat", True)
        self.btn_cash_clear.clicked.connect(self._clear_cash_start)
        cash_row.addWidget(self.btn_cash_clear)
        layout.addWidget(cash_host)
        self._refresh_cash_start_lbl()

        # ===== V6.2: بوابة «العميل حصّل مقابلها» قبل الصرف للمقاولين =====
        from services import voucher_payment_link_service as _vpl62
        self.sub_gate_check = QCheckBox(
            "لا يُصرف للمقاول إلا بعد تحصيل دفعة العميل المقابلة")
        self.sub_gate_check.setToolTip(
            "عند التفعيل: تُعرض دفعة المقاول في سند الصرف باهتة وغير قابلة "
            "للاختيار حتى تُحصَّل دفعة العميل المقابلة لها، مع بيان السبب.\n"
            "عند الإيقاف: كل الدفعات المستحقة متاحة للصرف.")
        self.sub_gate_check.setChecked(_vpl62.gate_enabled())
        self.sub_gate_check.toggled.connect(self._toggle_sub_gate)
        layout.addWidget(self.sub_gate_check)

        pay_row_host, pay_row = _flow(spacing=8)
        self.btn_pay_methods = QPushButton("إدارة طرق الدفع والرسوم")
        self.btn_pay_methods.setObjectName("btnPrimary")
        self.btn_pay_methods.setCursor(Qt.PointingHandCursor)
        self.btn_pay_methods.clicked.connect(self.open_pay_methods)
        pay_row.addWidget(self.btn_pay_methods)
        layout.addWidget(pay_row_host)

        layout.addWidget(self._save_row())
        outer.addWidget(card)
        outer.addStretch()
        return page

    def _refresh_app_icon_preview(self):
        pix = style.icon_pixmap(72, self)
        if pix.isNull():
            self.app_icon_preview.setText("لا توجد أيقونة")
        else:
            self.app_icon_preview.setText("")
            self.app_icon_preview.setPixmap(pix)

    def _pick_app_icon(self):
        from services import icon_service
        path, _ = QFileDialog.getOpenFileName(
            self, "اختر صورة الأيقونة", "",
            "الصور (*.png *.jpg *.jpeg *.bmp *.ico *.webp)")
        if not path:
            return
        try:
            msg = icon_service.install_icon(path)
        except icon_service.IconError as exc:
            style.error(self, str(exc))
            return
        self._apply_new_icon()
        style.success(self, msg)

    def _reset_app_icon(self):
        from services import icon_service
        try:
            msg = icon_service.restore_default()
        except icon_service.IconError as exc:
            style.error(self, str(exc))
            return
        self._apply_new_icon()
        style.success(self, msg)

    def _apply_new_icon(self):
        from PySide6.QtWidgets import QApplication
        new_icon = style.app_icon()
        app = QApplication.instance()
        if app is not None and not new_icon.isNull():
            app.setWindowIcon(new_icon)
            for win in app.topLevelWidgets():
                try:
                    win.setWindowIcon(new_icon)
                except Exception:
                    pass
        self._refresh_app_icon_preview()

    def _print_identity_card(self, save_title: str = "حفظ هوية المطبوعات") -> QFrame:
        """كارت رفع الهيدر والفوتر والختم وموضع الختم — متاح للمدير."""
        print_card, print_layout = _card()
        print_title = QLabel("هوية المطبوعات: الهيدر والفوتر والختم")
        print_title.setProperty("sectionTitle", True)
        print_layout.addWidget(print_title)
        hint = QLabel(
            "ارفع الهيدر والفوتر والتوقيع والختم وحدد موضع الختم.")
        hint.setWordWrap(True)
        hint.setMinimumWidth(0)
        hint.setProperty("hint", True)
        print_layout.addWidget(hint)

        form = QFormLayout()
        form.setSpacing(10)
        form.setLabelAlignment(Qt.AlignRight)

        self.header_image = QLineEdit()
        self.header_image.setPlaceholderText(
            "(اختياري) صورة ترويسة تُطبع أعلى كل المستندات · يُفضل عرض A4")
        header_pick = QPushButton("استعراض...")
        header_pick.setProperty("flat", True)
        header_clear = QPushButton("مسح")
        header_clear.setProperty("flat", True)
        header_clear.setFixedWidth(64)
        header_pick.clicked.connect(lambda: self._pick_print_image(self.header_image))
        header_clear.clicked.connect(lambda: self.header_image.clear())
        header_row_host, header_row = _flow(spacing=8)
        header_row.addWidget(self.header_image)
        header_row.addWidget(header_pick)
        header_row.addWidget(header_clear)
        form.addRow("صورة الهيدر", header_row_host)

        self.footer_image = QLineEdit()
        self.footer_image.setPlaceholderText(
            "(اختياري) صورة تذييل تُطبع أسفل كل المستندات")
        footer_pick = QPushButton("استعراض...")
        footer_pick.setProperty("flat", True)
        footer_clear = QPushButton("مسح")
        footer_clear.setProperty("flat", True)
        footer_clear.setFixedWidth(64)
        footer_pick.clicked.connect(lambda: self._pick_print_image(self.footer_image))
        footer_clear.clicked.connect(lambda: self.footer_image.clear())
        footer_row_host, footer_row = _flow(spacing=8)
        footer_row.addWidget(self.footer_image)
        footer_row.addWidget(footer_pick)
        footer_row.addWidget(footer_clear)
        form.addRow("صورة الفوتر", footer_row_host)

        self.signature_image = QLineEdit()
        self.signature_image.setPlaceholderText(
            "(اختياري) صورة توقيع تُطبع تلقائيًا في خانة المحاسب بالسندات")
        sig_pick = QPushButton("استعراض...")
        sig_pick.setProperty("flat", True)
        sig_clear = QPushButton("مسح")
        sig_clear.setProperty("flat", True)
        sig_clear.setFixedWidth(64)
        sig_pick.clicked.connect(lambda: self._pick_print_image(self.signature_image))
        sig_clear.clicked.connect(lambda: self.signature_image.clear())
        sig_row_host, sig_row = _flow(spacing=8)
        sig_row.addWidget(self.signature_image)
        sig_row.addWidget(sig_pick)
        sig_row.addWidget(sig_clear)
        form.addRow("التوقيع", sig_row_host)

        self.stamp_image = QLineEdit()
        self.stamp_image.setPlaceholderText(
            "(اختياري) صورة الختم · PNG بخلفية شفافة أفضل")
        stamp_pick = QPushButton("استعراض...")
        stamp_pick.setProperty("flat", True)
        stamp_clear = QPushButton("مسح")
        stamp_clear.setProperty("flat", True)
        stamp_clear.setFixedWidth(64)
        stamp_pick.clicked.connect(lambda: self._pick_print_image(self.stamp_image))
        stamp_clear.clicked.connect(lambda: self.stamp_image.clear())
        stamp_row_host, stamp_row = _flow(spacing=8)
        stamp_row.addWidget(self.stamp_image)
        stamp_row.addWidget(stamp_pick)
        stamp_row.addWidget(stamp_clear)
        form.addRow("صورة الختم", stamp_row_host)

        pos_host, pos_row = _flow(spacing=8)
        self.stamp_x_mm = SafeDoubleSpinBox()
        self.stamp_x_mm.setDecimals(1)
        self.stamp_x_mm.setRange(-100, 100)
        self.stamp_x_mm.setSuffix(" مم")
        self.stamp_x_mm.setFixedWidth(115)
        self.stamp_x_mm.setToolTip("تحريك أفقي من مكان الختم الافتراضي: موجب = يمين، سالب = يسار، 0 = الافتراضي")
        self.stamp_y_mm = SafeDoubleSpinBox()
        self.stamp_y_mm.setDecimals(1)
        self.stamp_y_mm.setRange(-100, 100)
        self.stamp_y_mm.setSuffix(" مم")
        self.stamp_y_mm.setFixedWidth(115)
        self.stamp_y_mm.setToolTip("تحريك رأسي من مكان الختم الافتراضي: موجب = أعلى، سالب = أسفل، 0 = الافتراضي")
        self.stamp_size_mm = SafeDoubleSpinBox()
        self.stamp_size_mm.setDecimals(1)
        self.stamp_size_mm.setRange(0, 90)
        self.stamp_size_mm.setSuffix(" مم")
        self.stamp_size_mm.setFixedWidth(115)
        self.stamp_size_mm.setToolTip("حجم الختم · 0 = حجم كل مستند الافتراضي")
        reset_pos = QPushButton("الافتراضي")
        reset_pos.setProperty("flat", True)
        reset_pos.clicked.connect(lambda: (self.stamp_x_mm.setValue(0),
                                           self.stamp_y_mm.setValue(0),
                                           self.stamp_size_mm.setValue(0)))
        pos_row.addWidget(QLabel("يمين/يسار"))
        pos_row.addWidget(self.stamp_x_mm)
        pos_row.addWidget(QLabel("أعلى/أسفل"))
        pos_row.addWidget(self.stamp_y_mm)
        pos_row.addWidget(QLabel("الحجم"))
        pos_row.addWidget(self.stamp_size_mm)
        pos_row.addWidget(reset_pos)
        form.addRow("مكان الختم", pos_host)

        stamp_hint = QLabel("اترك موضع الختم 0 لاستخدام المكان الافتراضي.")
        stamp_hint.setWordWrap(True)
        stamp_hint.setMinimumWidth(0)
        stamp_hint.setProperty("hint", True)
        form.addRow("", stamp_hint)

        host = QWidget()
        host.setObjectName("transparentHost")
        host.setLayout(form)
        print_layout.addWidget(host)
        save_imgs = QPushButton(save_title)
        save_imgs.setObjectName("btnPrimary")
        save_imgs.clicked.connect(self._save)
        imgs_row_host, imgs_row = _flow(spacing=8)
        imgs_row.addWidget(save_imgs)
        print_layout.addWidget(imgs_row_host)
        return print_card

    def _tab_appearance(self) -> QWidget:
        page = QWidget()
        outer = QVBoxLayout(page)
        outer.setContentsMargins(0, 12, 0, 0)
        outer.setSpacing(12)

        outer.addWidget(self._print_identity_card())

        card, layout = _card()
        section = QLabel("خيارات الطباعة والعرض")
        section.setProperty("sectionTitle", True)
        layout.addWidget(section)
        hint = QLabel("إعدادات الطباعة هنا؛ تبويب المطور للترخيص والترحيل.")
        hint.setWordWrap(True)
        hint.setMinimumWidth(0)
        hint.setProperty("hint", True)
        layout.addWidget(hint)

        self.economy_check = QCheckBox("🖨 وضع الطباعة الاقتصادي")
        layout.addWidget(self.economy_check)
        economy_hint = QLabel(
            "طباعة أبيض وأسود لتوفير الحبر.")
        economy_hint.setWordWrap(True)
        economy_hint.setMinimumWidth(0)
        economy_hint.setProperty("hint", True)
        layout.addWidget(economy_hint)

        self.fast_mode_check = QCheckBox("⚡ الوضع السريع")
        layout.addWidget(self.fast_mode_check)
        fast_hint = QLabel("يسرّع الأجهزة القديمة بإيقاف ظلال البطاقات. يُطبق بعد إعادة التشغيل.")
        fast_hint.setWordWrap(True)
        fast_hint.setMinimumWidth(0)
        fast_hint.setProperty("hint", True)
        layout.addWidget(fast_hint)

        layout.addWidget(self._save_row())
        outer.addWidget(card)
        outer.addStretch()
        return page

    def _open_print_images(self):
        # توافق مع أي أزرار/اختصارات قديمة: افتح تبويب الطباعة والعرض مباشرة.
        for i in range(self.tabs.count()):
            if "الطباعة" in self.tabs.tabText(i):
                self.tabs.setCurrentIndex(i)
                break

    def open_pay_methods(self):
        dlg = PaymentMethodsDialog(self)
        dlg.exec()

    def _network_card(self) -> QFrame:
        net_card, net_layout = _card()
        section3 = QLabel("العمل على شبكة محلية (عدة أجهزة)")
        section3.setProperty("sectionTitle", True)
        net_layout.addWidget(section3)
        from services.db_facade_service import network_mode, DATA_DIR as _DD
        net_hint = QLabel("اختر مجلد بيانات مشترك لكل الأجهزة ثم أعد تشغيل البرنامج.")
        net_hint.setProperty("hint", True)
        net_hint.setWordWrap(True)
        net_layout.addWidget(net_hint)
        if network_mode():
            status_lbl = QLabel("وضع الشبكة مفعّل · البيانات في: " + _DD)
            status_lbl.setStyleSheet(
                f"font-weight: 700; color: {style.OK_GREEN};")
        else:
            status_lbl = QLabel(
                "الوضع الحالي: قاعدة بيانات محلية على هذا الجهاز")
            status_lbl.setStyleSheet(f"font-weight: 700; color: {style.NEUTRAL};")
        net_layout.addWidget(status_lbl)
        net_row_host, net_row = _flow(spacing=8)
        net_row.addWidget(QLabel("المجلد المشترك:"))
        self.network_folder = QLineEdit()
        self.network_folder.setPlaceholderText(
            r"(فارغ = قاعدة هذا الجهاز)  شبكة: \\SERVER\ConTrackData · مضيف: C:\ConTrackData")
        try:
            import os as _os
            from services.db_facade_service import _NET_CONFIG
            if _os.path.exists(_NET_CONFIG):
                with open(_NET_CONFIG, encoding="utf-8-sig") as _fh:
                    self.network_folder.setText(_fh.read().strip())
        except OSError:
            pass
        net_pick = QPushButton("استعراض...")
        net_pick.setProperty("flat", True)
        net_pick.clicked.connect(self._pick_network_folder)
        net_apply = QPushButton("تفعيل / تحديث")
        net_apply.setObjectName("btnPrimary")
        net_apply.clicked.connect(self._apply_network_folder)
        net_clear = QPushButton("🗑 حذف المسار / محلي")
        net_clear.setObjectName("btnDangerSoft")
        net_clear.setToolTip("يمسح مسار قاعدة الشبكة من هذا الجهاز فقط ويرجع للقاعدة المحلية")
        net_clear.clicked.connect(self._clear_network_folder)
        net_row.addWidget(self.network_folder)
        net_row.addWidget(net_pick)
        net_row.addWidget(net_apply)
        net_row.addWidget(net_clear)
        net_layout.addWidget(net_row_host)
        return net_card

    def _migrate_legacy_stages(self):
        """زر أدوات المطور: تهيئة القواعد القديمة لمراحل التنفيذ."""
        from services import workflow_service as _wf
        if not style.confirm(
                self,
                "تهيئة مراحل التنفيذ للعقود القديمة؟\n\n"
                "· مراحل العقود المسطحة القديمة تُستبدل بشجرة مراحل "
                "التنفيذ (سجل حركة الكانبان القديم يُحذف).\n"
                "· كل عقد يوضع في مرحلة مناسبة بحسب تاريخه.\n"
                "· العملاء بلا عقود يدخلون مرحلة «غير متعاقد».\n\n"
                "آمن للتكرار — ما تمت تهيئته لا يُلمس. تابع؟",
                "تهيئة مراحل التنفيذ"):
            return
        try:
            res = _wf.migrate_legacy_stages()
        except Exception as exc:
            style.error(self, f"تعذرت التهيئة: {exc}")
            return
        parts = []
        if res.get("stages_reset"):
            parts.append("استُبدلت مراحل العقود القديمة بشجرة التنفيذ")
        if res.get("contracts"):
            parts.append(f"هُيّئ {res['contracts']} عقدًا")
        if res.get("customers"):
            parts.append(f"دخل {res['customers']} عميلًا مرحلة «غير متعاقد»")
        style.info(self, "\n".join(parts) or "كل شيء مهيّأ بالفعل — لا "
                     "شيء ناقص ✓", "تهيئة مراحل التنفيذ")
        try:
            self.settings_changed.emit()
        except Exception:
            pass

    def _dev_scroll(self, widget: QWidget) -> QWidget:
        area = QScrollArea()
        area.setWidgetResizable(True)
        area.setFrameShape(QFrame.NoFrame)
        area.setObjectName("transparentHost")
        area.viewport().setObjectName("transparentHost")
        area.setWidget(widget)
        return area

    def _tab_developer(self) -> QWidget:
        """أدوات المطور منظمة في تابات داخلية بدل صفحة طويلة."""
        page = QWidget()
        outer = QVBoxLayout(page)
        outer.setContentsMargins(0, 12, 0, 0)
        outer.setSpacing(12)

        warn = QLabel("⚠ أدوات المطور فقط.")
        warn.setWordWrap(True)
        warn.setStyleSheet(
            f"background: rgba(245,158,11,0.12); color: {style.AMBER_TEXT};"
            " border: 1.5px solid rgba(245,158,11,0.45);"
            " border-radius: 10px; padding: 8px 14px; font-weight: 700;")
        outer.addWidget(warn)

        dev_tabs = QTabWidget()
        dev_tabs.setLayoutDirection(Qt.RightToLeft)
        outer.addWidget(dev_tabs, 1)

        # ===== تاب المزايا =====
        from services import feature_service as _feat
        mods_page = QWidget()
        mods_layout = QVBoxLayout(mods_page)
        mods_layout.setContentsMargins(0, 12, 0, 0)
        mods_layout.setSpacing(12)
        mod_card, mod_layout = _card()
        mod_title = QLabel("مزايا النظام (ما يظهر لهذا العميل)")
        mod_title.setProperty("sectionTitle", True)
        mod_layout.addWidget(mod_title)
        mod_hint = QLabel("اختر المزايا الظاهرة للعميل. البيانات لا تُحذف.")
        mod_hint.setProperty("hint", True)
        mod_hint.setWordWrap(True)
        mod_layout.addWidget(mod_hint)
        from PySide6.QtWidgets import QCheckBox as _QCBm, QGridLayout as _QGm
        self.feature_boxes: dict[str, _QCBm] = {}
        grid = _QGm()
        grid.setHorizontalSpacing(18)
        grid.setVerticalSpacing(4)
        row = 0
        for group_name, items in _feat.grouped().items():
            head = QLabel(group_name)
            head.setStyleSheet("font-weight: 800; padding-top: 8px;")
            grid.addWidget(head, row, 0, 1, 2)
            row += 1
            for key, spec in items:
                box = _QCBm(spec["name"])
                box.setToolTip(spec["desc"])
                text = spec["desc"]
                if spec.get("requires"):
                    names = " · ".join(
                        _feat.FEATURES[r]["name"] for r in spec["requires"]
                        if r in _feat.FEATURES)
                    text = f"{text}\nيحتاج: {names}"
                    box.setToolTip(f'{spec["desc"]}\nيحتاج: {names}')
                box.toggled.connect(self._features_changed)
                self.feature_boxes[key] = box
                grid.addWidget(box, row, 0)
                desc = QLabel(text)
                desc.setProperty("hint", True)
                desc.setWordWrap(True)
                desc.setMinimumWidth(0)
                grid.addWidget(desc, row, 1)
                row += 1
        grid.setColumnStretch(0, 0)
        grid.setColumnStretch(1, 1)
        mod_layout.addLayout(grid)
        self.mod_state_lbl = QLabel("")
        self.mod_state_lbl.setWordWrap(True)
        self.mod_state_lbl.setStyleSheet("font-weight: 700; padding-top: 6px;")
        mod_layout.addWidget(self.mod_state_lbl)
        mod_save = QPushButton("💾 حفظ مزايا النظام")
        mod_save.setObjectName("btnPrimary")
        mod_save.clicked.connect(self._save_modules)
        mod_row_host, mod_row = _flow(spacing=8)
        mod_row.addWidget(mod_save)
        mod_layout.addWidget(mod_row_host)
        mods_layout.addWidget(mod_card)
        mods_layout.addStretch()
        dev_tabs.addTab(self._dev_scroll(mods_page), "المزايا")

        # ===== تاب الهوية والترخيص =====
        identity_page = QWidget()
        identity_layout = QVBoxLayout(identity_page)
        identity_layout.setContentsMargins(0, 12, 0, 0)
        identity_layout.setSpacing(12)
        id_card, id_layout = _card()
        id_title = QLabel("هوية النظام والترخيص")
        id_title.setProperty("sectionTitle", True)
        id_layout.addWidget(id_title)
        id_form = QFormLayout()
        id_form.setSpacing(10)
        self.app_name_edit = QLineEdit()
        self.app_name_edit.setPlaceholderText("ConTrack")
        self.app_name_edit.setToolTip(
            "يظهر في عنوان النافذة وشاشة الدخول والقائمة الجانبية")
        id_form.addRow("اسم النظام", self.app_name_edit)
        users_row_host, users_row = _flow(spacing=8)
        self.max_users_spin = SafeSpinBox()
        self.max_users_spin.setRange(0, 500)
        self.max_users_spin.setFixedWidth(110)
        self.max_users_spin.setToolTip("0 = بلا حد")
        self.users_count_lbl = QLabel("")
        self.users_count_lbl.setProperty("hint", True)
        users_row.addWidget(self.max_users_spin)
        users_row.addWidget(QLabel("مستخدم (0 = بلا حد)"))
        users_row.addWidget(self.users_count_lbl)
        id_form.addRow("الحد الأقصى للمستخدمين", users_row_host)
        id_host = QWidget()
        id_host.setObjectName("transparentHost")
        id_host.setLayout(id_form)
        id_layout.addWidget(id_host)
        apply_id = QPushButton("💾 حفظ هوية النظام")
        apply_id.setObjectName("btnPrimary")
        apply_id.clicked.connect(self._save_developer_identity)
        id_row_host, id_row = _flow(spacing=8)
        id_row.addWidget(apply_id)
        id_layout.addWidget(id_row_host)
        identity_layout.addWidget(id_card)

        brand_card, brand_layout = _card()
        brand_title = QLabel("أيقونة البرنامج")
        brand_title.setProperty("sectionTitle", True)
        brand_layout.addWidget(brand_title)
        icon_row_host, icon_row = _flow(spacing=8)
        icon_row.setSpacing(12)
        icon_label = QLabel("أيقونة البرنامج:")
        self.app_icon_preview = QLabel()
        self.app_icon_preview.setFixedSize(84, 84)
        self.app_icon_preview.setAlignment(Qt.AlignCenter)
        self.app_icon_preview.setStyleSheet(
            f"border: 2px dashed {style.BORDER}; border-radius: 10px;"
            f"color: {style.MUTED}; background: {style.READONLY_BG}; font-size: 9.3px;")
        self._refresh_app_icon_preview()
        pick_icon = QPushButton("تغيير الأيقونة...")
        pick_icon.setProperty("flat", True)
        pick_icon.setToolTip("اختر صورة (PNG/JPG) · تُستخدم لنوافذ البرنامج "
                             "ولاختصار سطح المكتب")
        pick_icon.clicked.connect(self._pick_app_icon)
        reset_icon = QPushButton("الأصلية")
        reset_icon.setProperty("flat", True)
        reset_icon.setToolTip("استعادة أيقونة النظام الافتراضية")
        reset_icon.clicked.connect(self._reset_app_icon)
        icon_hint = QLabel("صورة مربّعة 256×256 أو أكبر · تُحوَّل تلقائيًا "
                           "لكل المقاسات المطلوبة")
        icon_hint.setProperty("hint", True)
        icon_hint.setWordWrap(True)
        icon_row.addWidget(icon_label)
        icon_row.addWidget(self.app_icon_preview)
        icon_row.addWidget(pick_icon)
        icon_row.addWidget(reset_icon)
        icon_row.addWidget(icon_hint)
        brand_layout.addWidget(icon_row_host)
        identity_layout.addWidget(brand_card)
        identity_layout.addStretch()
        dev_tabs.addTab(self._dev_scroll(identity_page), "الهوية والترخيص")

        # ===== تاب الترحيل =====
        migration_page = QWidget()
        migration_layout = QVBoxLayout(migration_page)
        migration_layout.setContentsMargins(0, 12, 0, 0)
        migration_layout.setSpacing(12)
        mig_card, mig_layout = _card()
        mig_title = QLabel("تهيئة مراحل التنفيذ للعقود القديمة")
        mig_title.setProperty("sectionTitle", True)
        mig_layout.addWidget(mig_title)
        mig_hint = QLabel("ترقية مراحل العقود القديمة إلى شجرة تنفيذ.")
        mig_hint.setProperty("hint", True)
        mig_hint.setWordWrap(True)
        mig_layout.addWidget(mig_hint)
        mig_row_host, mig_row = _flow(spacing=8)
        mig_btn = QPushButton("✚ تهيئة العقود القديمة الآن")
        mig_btn.clicked.connect(self._migrate_legacy_stages)
        mig_row.addWidget(mig_btn)
        mig_layout.addWidget(mig_row_host)
        migration_layout.addWidget(mig_card)

        import_card, import_layout = _card()
        import_title = QLabel("استيراد البيانات القديمة (Excel)")
        import_title.setProperty("sectionTitle", True)
        import_layout.addWidget(import_title)
        import_hint = QLabel(
            "نزّل القالب، املأه، ثم افحصه قبل الاستيراد.")
        import_hint.setProperty("hint", True)
        # V4.5.13: مفتاح «استيراد البيانات القديمة» يخفي المعالج كاملًا
        from services import feature_service as _feat13i
        if not _feat13i.enabled("import_old"):
            import_card.setVisible(False)
        import_hint.setWordWrap(True)
        import_layout.addWidget(import_hint)
        import_row_host, import_row = _flow(spacing=8)
        import_btn = QPushButton("📥 فتح معالج الاستيراد")
        import_btn.clicked.connect(self._open_import_wizard)
        import_row.addWidget(import_btn)
        import_layout.addWidget(import_row_host)
        migration_layout.addWidget(import_card)
        migration_layout.addStretch()
        dev_tabs.addTab(self._dev_scroll(migration_page), "الترحيل والاستيراد")

        # ===== تاب الشبكة والنسخ =====
        data_page = QWidget()
        data_layout = QVBoxLayout(data_page)
        data_layout.setContentsMargins(0, 12, 0, 0)
        data_layout.setSpacing(12)
        # V4.5.13: مفتاحا «مجلد الشبكة» و«النسخة الاحتياطية الكاملة» يعملان فعليًا
        from services import feature_service as _feat13b
        if _feat13b.enabled("network_folder"):
            data_layout.addWidget(self._network_card())
        if _feat13b.enabled("full_backup"):
            data_layout.addWidget(self._full_backup_card())
        data_layout.addStretch()
        dev_tabs.addTab(self._dev_scroll(data_page), "الشبكة والنسخ")

        # ===== تاب تنظيف البيانات =====
        purge_page = QWidget()
        purge_layout = QVBoxLayout(purge_page)
        purge_layout.setContentsMargins(0, 12, 0, 0)
        purge_layout.setSpacing(12)
        purge_layout.addWidget(self._purge_card())
        purge_layout.addStretch()
        dev_tabs.addTab(self._dev_scroll(purge_page), "✱ تنظيف البيانات")

        self._refresh_developer_tab()
        return page

    def _purge_card(self) -> QWidget:
        """أداة حذف البيانات التجريبية/الخاطئة — للمطور فقط."""
        card, layout = _card()
        title = QLabel("🧹 تنظيف البيانات (حذف نهائي)")
        title.setProperty("sectionTitle", True)
        layout.addWidget(title)

        warn = QLabel(
            "⚠ <b>هذه الأداة تحذف البيانات نهائيًا</b> — خُصِّصت للبيانات "
            "التجريبية أو الخاطئة من الاستيراد وتنظيف النظام قبل التسليم.<br>"
            "• تُحفظ <b>لقطة كاملة</b> لكل ما يُحذف في سجل التدقيق "
            "(من · متى · لماذا · البيانات كاملة).<br>"
            "• <b>خذ نسخة احتياطية قبل الاستخدام</b> — الحذف لا يُستعاد "
            "تلقائيًا من داخل البرنامج.<br>"
            "• لا تستخدمها لإخفاء حركة مالية حقيقية؛ للسند الخاطئ "
            "استخدم «إلغاء السند» فيبقى الأثر سليمًا.")
        warn.setWordWrap(True)
        warn.setStyleSheet(
            "background: rgba(239,68,68,0.10); color: #991B1B;"
            " border: 1.5px solid rgba(239,68,68,0.45);"
            " border-radius: 10px; padding: 10px 14px;")
        layout.addWidget(warn)

        row = QHBoxLayout()
        btn_cust = QPushButton("🗑 حذف عميل بالكامل…")
        btn_cust.clicked.connect(lambda: self._purge_pick("customer"))
        btn_con = QPushButton("🗑 حذف عقد…")
        btn_con.clicked.connect(lambda: self._purge_pick("contract"))
        btn_vou = QPushButton("🗑 حذف سندات…")
        btn_vou.clicked.connect(lambda: self._purge_pick("voucher"))
        btn_sub = QPushButton("🗑 حذف مقاول باطن… (مع عقوده وسنداته)")
        btn_sub.clicked.connect(lambda: self._purge_pick("subcontractor"))
        btn_log = QPushButton("🗑 سجل الحذف")
        btn_log.clicked.connect(self._purge_show_log)
        for b in (btn_cust, btn_con, btn_vou, btn_sub):
            b.setProperty("danger", True)
        row.addWidget(btn_cust)
        row.addWidget(btn_con)
        row.addWidget(btn_vou)
        row.addWidget(btn_sub)
        row.addStretch()
        row.addWidget(btn_log)
        layout.addLayout(row)

        # V8.7.10: أداة إدارة البيانات الموحدة
        row2 = QHBoxLayout()
        btn_cleanup = QPushButton("🧹 إدارة البيانات (بحث + تقرير + حذف + موظفين)")
        btn_cleanup.setStyleSheet(
            "QPushButton { background: #1E40AF; color: white; padding: 10px 20px;"
            " border-radius: 8px; font-weight: bold; font-size: 13px; }"
            " QPushButton:hover { background: #1E3A8A; }")
        btn_cleanup.clicked.connect(self._open_cleanup_tool)
        row2.addWidget(btn_cleanup)
        row2.addStretch()
        layout.addLayout(row2)

        return card

    def _purge_pick(self, kind: str):
        """فتح نافذة الاختيار والحذف."""
        from ui.purge_tool import PurgeDialog
        try:
            PurgeDialog(self, kind).exec()
        except Exception as exc:
            style.error(self, f"تعذر فتح أداة التنظيف: {exc}")

    def _purge_show_log(self):
        from ui.data_management import DataManagementDialog
        try:
            dlg = DataManagementDialog(self)
            dlg.tabs.setCurrentIndex(4)  # تبويب السجل
            dlg.exec()
        except Exception as exc:
            style.error(self, f"تعذر فتح سجل الحذف: {exc}")

    def _open_cleanup_tool(self):
        """فتح أداة إدارة البيانات الموحدة V8.7.10."""
        from ui.data_management import DataManagementDialog
        try:
            DataManagementDialog(self).exec()
        except Exception as exc:
            style.error(self, f"تعذر فتح أداة إدارة البيانات: {exc}")

    # ── V6.7: الدوال القديمة أُزيلت — كل شيء عبر _purge_pick الآن ──

    def _refresh_developer_tab(self):
        from services import auth_service, settings_service
        s = settings_service.get_settings()
        self.app_name_edit.setText(getattr(s, "app_name", "") or "ConTrack")
        self.max_users_spin.setValue(auth_service.max_users())
        self.users_count_lbl.setText(
            f"(المستخدمون حاليًا: {auth_service.active_users_count()})")

    def _save_developer_identity(self):
        from services import auth_service, settings_service
        name = (self.app_name_edit.text() or "").strip() or "ConTrack"
        limit = int(self.max_users_spin.value())
        current = auth_service.active_users_count()
        if limit and limit < current:
            style.error(self, f"عدد المستخدمين الحالي {current} أكبر من الحد "
                              f"المطلوب {limit}.\nاحذف مستخدمين أولًا.")
            return
        try:
            s = settings_service.get_settings()
            s.app_name = name
            settings_service.save_settings(s)
            auth_service.set_max_users(limit)
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
            return
        self._apply_app_name_now(name)
        self._refresh_developer_tab()
        style.toast(self, "تم الحفظ.")

    @staticmethod
    def _apply_app_name_now(name: str) -> None:
        try:
            from PySide6.QtWidgets import QApplication
            app = QApplication.instance()
            if app is not None:
                app.setApplicationName(name)
                app.setApplicationDisplayName(name)
                for w in app.topLevelWidgets():
                    try:
                        if w.objectName() == "MainWindow" or \
                                type(w).__name__ == "MainWindow":
                            w.setWindowTitle(name)
                    except Exception:
                        pass
        except Exception:
            pass

    def _tab_security_users(self) -> QWidget:
        from services import auth_service
        page = QWidget()
        outer = QVBoxLayout(page)
        outer.setContentsMargins(0, 12, 0, 0)
        outer.setSpacing(12)
        outer.addWidget(self._security_card())
        if auth_service.is_admin():
            outer.addWidget(self._users_card())
        outer.addStretch()
        return page

    def _full_backup_card(self) -> QFrame:
        from PySide6.QtWidgets import QCheckBox, QHeaderView, QTableWidget, QTableWidgetItem
        from services import full_backup_service as fbs
        card, layout = _card()
        title = QLabel("النسخة الاحتياطية الكاملة")
        title.setProperty("sectionTitle", True)
        layout.addWidget(title)
        hint = QLabel("نسخ احتياطي تلقائي للبيانات والملفات.")
        hint.setProperty("hint", True)
        hint.setWordWrap(True)
        layout.addWidget(hint)

        cfg = fbs.get_config()
        form = QFormLayout()
        form.setSpacing(10)
        self.fb_enabled = QCheckBox("تفعيل النسخة الكاملة التلقائية")
        self.fb_enabled.setChecked(cfg["enabled"])
        from PySide6.QtWidgets import QComboBox as _QCB
        self.fb_weekday = _QCB()
        make_searchable(self.fb_weekday, "")
        for _wd in fbs.WEEKDAY_ORDER:
            self.fb_weekday.addItem(f"كل يوم {fbs.WEEKDAYS[_wd]}", _wd)
        self.fb_weekday.addItem("بالمدة بالأيام (بلا يوم محدد)",
                                fbs.BY_INTERVAL)
        _idx = self.fb_weekday.findData(cfg["weekday"])
        self.fb_weekday.setCurrentIndex(_idx if _idx >= 0 else 0)
        self.fb_weekday.currentIndexChanged.connect(self._fb_mode_changed)
        self.fb_days = SafeSpinBox()
        self.fb_days.setRange(1, 90)
        self.fb_days.setSuffix(" يوم")
        self.fb_days.setValue(cfg["interval_days"])
        self.fb_keep_weekly = SafeSpinBox()
        self.fb_keep_weekly.setRange(1, 52)
        self.fb_keep_weekly.setSuffix(" نسخة")
        self.fb_keep_weekly.setValue(cfg["keep_weekly"])
        self.fb_keep_monthly = SafeSpinBox()
        self.fb_keep_monthly.setRange(0, 36)
        self.fb_keep_monthly.setSuffix(" شهر")
        self.fb_keep_monthly.setValue(cfg["keep_monthly"])
        self.fb_folder = QLineEdit(cfg["folder"])
        self.fb_folder.setPlaceholderText(
            r"اتركه فارغًا للحفظ في data\full_backups · أو اختر قرصًا خارجيًا")
        pick = QPushButton("استعراض...")
        pick.setProperty("flat", True)
        pick.clicked.connect(self._fb_pick_folder)
        folder_row_host, folder_row = _flow(spacing=8)
        folder_row.addWidget(self.fb_folder)
        folder_row.addWidget(pick)
        form.addRow(self.fb_enabled)
        form.addRow("موعد النسخة", self.fb_weekday)
        self.fb_days_label = QLabel("تتكرر كل")
        form.addRow(self.fb_days_label, self.fb_days)
        form.addRow("يُحتفظ بـ", self.fb_keep_weekly)
        form.addRow("نسخ شهرية بعيدة", self.fb_keep_monthly)
        form.addRow("مجلد الحفظ", folder_row_host)
        layout.addLayout(form)

        self.fb_status = QLabel("")
        self.fb_status.setProperty("hint", True)
        self.fb_status.setWordWrap(True)
        layout.addWidget(self.fb_status)

        self.fb_table = QTableWidget(0, 4)
        self.fb_table.setHorizontalHeaderLabels(
            ["النسخة", "النوع", "الحجم", "التاريخ"])
        _fh = self.fb_table.horizontalHeader()
        _fh.setSectionResizeMode(QHeaderView.Stretch)
        _fh.setStretchLastSection(False)
        self.fb_table.verticalHeader().setVisible(False)
        self.fb_table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.fb_table.setSelectionBehavior(QTableWidget.SelectRows)
        self.fb_table.setSelectionMode(QTableWidget.SingleSelection)
        self.fb_table.setAlternatingRowColors(True)
        self.fb_table.setMinimumHeight(160)
        layout.addWidget(self.fb_table)

        row = QHBoxLayout()
        row.setSpacing(6)
        save_btn = QPushButton("💾 حفظ الإعدادات")
        save_btn.setObjectName("btnPrimary")
        save_btn.clicked.connect(self._fb_save)
        now_btn = QPushButton("إنشاء نسخة كاملة الآن")
        now_btn.clicked.connect(self._fb_run_now)
        open_btn = QPushButton("📂 فتح مجلد النسخ")
        open_btn.setProperty("flat", True)
        open_btn.clicked.connect(self._fb_open_folder)
        restore_btn = QPushButton("استعادة كاملة من الجدول")
        restore_btn.setToolTip("يستعيد النسخة الكاملة المحددة في الجدول: قاعدة البيانات + الملفات")
        restore_btn.setProperty("danger", True)
        restore_btn.clicked.connect(self._fb_restore)
        self.fb_restore_btn = restore_btn
        self.fb_table.doubleClicked.connect(lambda *_: self._fb_restore())
        for b in (save_btn, now_btn, open_btn, restore_btn):
            row.addWidget(b)
        row.addStretch()
        layout.addLayout(row)

        self._fb_mode_changed()
        self._fb_refresh()
        return card

    def _fb_mode_changed(self):
        from services import full_backup_service as fbs
        by_interval = self.fb_weekday.currentData() == fbs.BY_INTERVAL
        self.fb_days.setVisible(by_interval)
        self.fb_days_label.setVisible(by_interval)

    def _fb_pick_folder(self):
        path = QFileDialog.getExistingDirectory(
            self, "اختر مجلد حفظ النسخ الكاملة", self.fb_folder.text() or "")
        if path:
            self.fb_folder.setText(path)

    def _fb_refresh(self):
        from PySide6.QtWidgets import QTableWidgetItem
        from services import full_backup_service as fbs
        cfg = fbs.get_config()
        self._fb_items = fbs.list_backups(self.fb_folder.text() or cfg["folder"])
        self.fb_table.setRowCount(len(self._fb_items))
        total = 0
        for r, item in enumerate(self._fb_items):
            total += item["size"]
            cells = [item["name"], item["kind"],
                     fbs.format_size(item["size"]),
                     item["created"].strftime("%Y-%m-%d %H:%M")]
            for c, val in enumerate(cells):
                cell = QTableWidgetItem(str(val))
                cell.setData(Qt.UserRole, item["path"])
                if c:
                    cell.setTextAlignment(Qt.AlignCenter)
                self.fb_table.setItem(r, c, cell)
        from ui.widgets import sync_header_alignment
        sync_header_alignment(self.fb_table)
        if self._fb_items and self.fb_table.currentRow() < 0:
            # اختيار أحدث نسخة تلقائيًا يوضح للمستخدم أن زر الاستعادة يعمل
            # على صف محدد، مع بقاء نافذة التأكيد قبل أي كتابة على البيانات.
            self.fb_table.setCurrentCell(0, 0)
            self.fb_table.selectRow(0)
        last = cfg["last"] or "لم تُنشأ بعد"
        weekly = sum(1 for i in self._fb_items if i["kind"] == "أسبوعية")
        monthly = len(self._fb_items) - weekly
        self.fb_status.setText(
            f"آخر نسخة كاملة: {last} · {fbs.next_run_text(cfg)}\n"
            f"المحفوظ الآن: {weekly} أسبوعية و{monthly} شهرية · "
            f"إجمالي الحجم: {fbs.format_size(total)}")

    def _fb_save(self):
        from services import full_backup_service as fbs
        try:
            fbs.save_config(self.fb_enabled.isChecked(), self.fb_days.value(),
                            self.fb_keep_weekly.value(),
                            self.fb_keep_monthly.value(),
                            self.fb_folder.text(),
                            weekday=self.fb_weekday.currentData())
            removed = fbs.cleanup(self.fb_folder.text())
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
            return
        self._fb_refresh()
        msg = "تم حفظ إعدادات النسخة الكاملة."
        if removed:
            msg += f"\nحُذفت {len(removed)} نسخة زائدة عن الحد."
        style.info(self, msg, "تم")

    def _fb_run_now(self):
        from services import full_backup_service as fbs
        from PySide6.QtWidgets import QApplication
        try:
            QApplication.setOverrideCursor(Qt.WaitCursor)
            result = fbs.run_if_due(force=True)
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
            return
        finally:
            QApplication.restoreOverrideCursor()
        self._fb_refresh()
        removed = result.get("removed") or []
        msg = (f"تم إنشاء نسخة كاملة ({result['kind']}):\n"
               f"{result['files']} ملف · {fbs.format_size(result['size'])}\n"
               f"{result['path']}")
        if removed:
            msg += f"\n\nحُذفت الأقدم: {', '.join(removed)}"
        style.info(self, msg, "تمت النسخة الكاملة")

    def _fb_open_folder(self):
        from services import full_backup_service as fbs
        from ui.invoices import open_file_externally
        open_file_externally(fbs.get_dir(self.fb_folder.text()))

    def _fb_choose_backup_from_dialog(self, items: list[dict]) -> dict | None:
        """اختيار نسخة عند الضغط على الاستعادة بدون تحديد صف."""
        from services import full_backup_service as fbs
        dlg = QDialog(self)
        dlg.setWindowTitle("اختيار نسخة للاستعادة")
        dlg.setLayoutDirection(Qt.RightToLeft)
        dlg.resize(760, 380)
        root = QVBoxLayout(dlg)
        note = QLabel("اختر النسخة الكاملة التي تريد استعادتها. لن تتم الاستعادة إلا بعد تأكيد إضافي وصلاحية المدير.")
        note.setProperty("hint", True)
        note.setWordWrap(True)
        root.addWidget(note)
        table = QTableWidget(len(items), 4, dlg)
        table.setHorizontalHeaderLabels(["النسخة", "النوع", "الحجم", "التاريخ"])
        table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        table.verticalHeader().setVisible(False)
        table.setSelectionBehavior(QTableWidget.SelectRows)
        table.setSelectionMode(QTableWidget.SingleSelection)
        table.setEditTriggers(QTableWidget.NoEditTriggers)
        for r, item in enumerate(items):
            vals = [item["name"], item["kind"], fbs.format_size(item["size"]),
                    item["created"].strftime("%Y-%m-%d %H:%M")]
            for c, val in enumerate(vals):
                cell = QTableWidgetItem(str(val))
                if c:
                    cell.setTextAlignment(Qt.AlignCenter)
                table.setItem(r, c, cell)
        if items:
            table.setCurrentCell(0, 0)
            table.selectRow(0)
        root.addWidget(table, 1)
        row = QHBoxLayout()
        row.addStretch()
        ok = QPushButton("اختيار هذه النسخة")
        ok.setObjectName("btnPrimary")
        cancel = QPushButton("✕ إلغاء")
        cancel.setProperty("flat", True)
        row.addWidget(ok)
        row.addWidget(cancel)
        root.addLayout(row)
        ok.clicked.connect(dlg.accept)
        cancel.clicked.connect(dlg.reject)
        table.doubleClicked.connect(lambda *_: dlg.accept())
        if dlg.exec() != QDialog.Accepted or table.currentRow() < 0:
            return None
        return items[table.currentRow()]

    def _fb_restore(self):
        from services import full_backup_service as fbs
        row = self.fb_table.currentRow()
        items = getattr(self, "_fb_items", [])
        if not items:
            style.info(self, "لا توجد نسخ كاملة محفوظة للاستعادة.")
            return
        if row < 0 or row >= len(items):
            item = self._fb_choose_backup_from_dialog(items)
            if item is None:
                return
        else:
            item = items[row]
        try:
            details = fbs.inspect_backup(item["path"])
        except ValidationError as exc:
            style.error(self, str(exc))
            return
        if not style.confirm(
                self,
                f"استعادة «{item['name']}»؟\n\n"
                f"ستُستبدل قاعدة البيانات الحالية و{details['archive']} ملف "
                f"أرشيف و{details['attachments']} مرفق عقد.\n"
                "تُؤخذ نسخة أمان تلقائية من الوضع الحالي قبل الاستعادة.\n\n"
                "أغلق البرنامج بعد الاستعادة وأعد تشغيله.",
                "تأكيد الاستعادة الكاملة"):
            return
        if not style.require_admin(self, "استعادة نسخة كاملة"):
            return
        try:
            result = fbs.restore_backup(item["path"])
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
            return
        self._fb_refresh()
        self.db_restored.emit()
        style.info(self, "تمت الاستعادة الكاملة.\n"
                         f"نسخة الأمان قبل الاستعادة:\n"
                         f"{result.get('safety_copy') or 'تعذر إنشاؤها'}\n\n"
                         "أعد تشغيل البرنامج الآن.", "تمت الاستعادة")

    def _tab_expense_accounts(self) -> QWidget:
        """إدارة حسابات المصروفات بشكل أب ← أبناء فقط.

        الشكل القديم كان جدول مسارات كامل وقد يشتت المستخدم. هنا الأب في
        قائمة جانبية، وبمجرد الضغط عليه تظهر أبناؤه فقط في القائمة المقابلة.
        """
        page = QWidget(); lay = QVBoxLayout(page); lay.setSpacing(10)
        card, box = _card()
        title = QLabel("شجرة حسابات المصروفات")
        title.setProperty("sectionTitle", True)
        hint = QLabel("اختر الحساب الأب من القائمة الجانبية؛ تظهر الحسابات الأبناء المقابلة له فقط. سند الصرف يستخدم الأبناء فقط.")
        hint.setWordWrap(True); hint.setProperty("hint", True)
        box.addWidget(title); box.addWidget(hint)

        lists = QHBoxLayout(); lists.setSpacing(10)
        parent_col = QVBoxLayout(); child_col = QVBoxLayout()
        ptitle = QLabel("الحسابات الأب")
        ptitle.setProperty("sectionTitle", True)
        ctitle = QLabel("الأبناء التابعة للحساب المحدد")
        ctitle.setProperty("sectionTitle", True)
        self.exp_parent_list = QListWidget()
        self.exp_parent_list.setMinimumWidth(260)
        self.exp_parent_list.currentRowChanged.connect(lambda *_: self._expense_children_reload())
        self.exp_child_table = QTableWidget(0, 5)
        self.exp_child_table.setHorizontalHeaderLabels(["الحساب الابن", "نشط", "في السند", "يدخل الربحية", "النوع"])
        self.exp_child_table.verticalHeader().setVisible(False)
        self.exp_child_table.setSelectionBehavior(QTableWidget.SelectRows)
        self.exp_child_table.setSelectionMode(QTableWidget.SingleSelection)
        self.exp_child_table.setEditTriggers(QTableWidget.NoEditTriggers)
        h = self.exp_child_table.horizontalHeader(); h.setSectionResizeMode(0, QHeaderView.Stretch)
        for i in range(1, 5): h.setSectionResizeMode(i, QHeaderView.ResizeToContents)
        parent_col.addWidget(ptitle); parent_col.addWidget(self.exp_parent_list, 1)
        child_col.addWidget(ctitle); child_col.addWidget(self.exp_child_table, 1)
        lists.addLayout(parent_col, 1); lists.addLayout(child_col, 3)
        box.addLayout(lists, 1)

        row = QHBoxLayout()
        add_parent = QPushButton("＋ إضافة حساب أب")
        add_child = QPushButton("＋ إضافة حساب ابن")
        edit = QPushButton("✎ تعديل المحدد")
        toggle = QPushButton("تفعيل/إيقاف المحدد")
        for b in (add_parent, add_child, edit, toggle):
            b.setCursor(Qt.PointingHandCursor); row.addWidget(b)
        row.addStretch(); box.addLayout(row)
        add_parent.clicked.connect(lambda: self._expense_account_add(parent=False))
        add_child.clicked.connect(lambda: self._expense_account_add(parent=True))
        edit.clicked.connect(self._expense_account_edit)
        toggle.clicked.connect(self._expense_account_toggle)
        lay.addWidget(card); lay.addStretch()
        self._expense_accounts_reload()
        return page

    def _expense_accounts_reload(self):
        from services import expense_account_service as ea
        rows = ea.list_accounts(active_only=False, posting_only=False)
        self._exp_acc_rows = rows
        self._exp_parents = [r for r in rows if not r.get('parent_id')]
        cur_parent_id = None
        try:
            item = self.exp_parent_list.currentItem()
            cur_parent_id = item.data(Qt.UserRole) if item else None
        except Exception:
            cur_parent_id = None
        self.exp_parent_list.blockSignals(True)
        self.exp_parent_list.clear()
        for acc in self._exp_parents:
            text = acc['name'] + ("  · موقوف" if not acc.get('is_active') else "")
            it = QListWidgetItem(text)
            it.setData(Qt.UserRole, acc['id'])
            self.exp_parent_list.addItem(it)
        row = 0
        if cur_parent_id is not None:
            for i, acc in enumerate(self._exp_parents):
                if acc['id'] == cur_parent_id:
                    row = i; break
        if self.exp_parent_list.count():
            self.exp_parent_list.setCurrentRow(row)
        self.exp_parent_list.blockSignals(False)
        self._expense_children_reload()

    def _current_exp_parent(self):
        item = self.exp_parent_list.currentItem()
        if not item:
            return None
        pid = item.data(Qt.UserRole)
        return next((r for r in getattr(self, '_exp_parents', []) if r['id'] == pid), None)

    def _expense_children_reload(self):
        parent = self._current_exp_parent()
        pid = parent['id'] if parent else None
        children = [r for r in getattr(self, '_exp_acc_rows', []) if r.get('parent_id') == pid]
        self._exp_children = children
        self.exp_child_table.setRowCount(len(children))
        for r, acc in enumerate(children):
            vals = [acc['name'],
                    'نعم' if acc.get('is_active') else 'لا',
                    'نعم' if acc.get('allow_posting') else 'لا',
                    'نعم' if acc.get('include_in_profitability') else 'لا',
                    acc.get('account_kind') or 'expense']
            for c, v in enumerate(vals):
                it = QTableWidgetItem(str(v)); it.setTextAlignment(Qt.AlignCenter)
                self.exp_child_table.setItem(r, c, it)
        from ui.widgets import sync_header_alignment
        sync_header_alignment(self.exp_child_table)

    def _selected_expense_account(self):
        row = self.exp_child_table.currentRow()
        if 0 <= row < len(getattr(self, '_exp_children', [])):
            return self._exp_children[row]
        parent = self._current_exp_parent()
        if parent:
            return parent
        style.info(self, "اختر حسابًا من القائمة أولًا.")
        return None

    def _expense_account_prompt(self, acc=None, parent_required=False):
        from services import expense_account_service as ea
        rows = ea.list_accounts(False, False)
        parents = [r for r in rows if not r.get('parent_id')]
        dlg = QDialog(self); dlg.setWindowTitle("حساب مصروف"); dlg.setLayoutDirection(Qt.RightToLeft)
        form = QFormLayout(dlg)
        name = QLineEdit((acc or {}).get('name', ''))
        parent = QComboBox(); parent.addItem("— حساب أب —", None)
        make_searchable(parent, "")
        for r in parents:
            if acc and r['id'] == acc['id']: continue
            parent.addItem(r['name'], r['id'])
        if acc and acc.get('parent_id'):
            idx = parent.findData(acc.get('parent_id')); parent.setCurrentIndex(idx if idx >= 0 else 0)
        elif parent_required and self._current_exp_parent():
            idx = parent.findData(self._current_exp_parent()['id']); parent.setCurrentIndex(idx if idx >= 0 else 0)
        active = QCheckBox("نشط"); active.setChecked(bool((acc or {}).get('is_active', 1)))
        posting = QCheckBox("يستخدم في سند الصرف")
        posting.setChecked(bool((acc or {}).get('allow_posting', 1 if parent_required else 0)))
        profit = QCheckBox("يدخل في الربحية عند ربطه بعقد/مشروع"); profit.setChecked(bool((acc or {}).get('include_in_profitability', 1)))
        kind = QComboBox(); kind.addItems(["expense", "advance", "asset"])
        make_searchable(kind, "")
        if acc:
            kind.setCurrentText(acc.get('account_kind') or 'expense')
        elif parent_required and self._current_exp_parent():
            kind.setCurrentText(self._current_exp_parent().get('account_kind') or 'expense')
        form.addRow("اسم الحساب", name); form.addRow("الحساب الأب", parent)
        form.addRow("", active); form.addRow("", posting); form.addRow("", profit); form.addRow("النوع", kind)
        buttons = QHBoxLayout(); ok = QPushButton("💾 حفظ"); ok.setObjectName("btnPrimary"); cancel = QPushButton("✕ إلغاء"); cancel.setProperty("flat", True)
        ok.clicked.connect(dlg.accept); cancel.clicked.connect(dlg.reject); buttons.addStretch(); buttons.addWidget(cancel); buttons.addWidget(ok); form.addRow(buttons)
        if dlg.exec() != QDialog.Accepted: return None
        if parent_required and parent.currentData() is None:
            style.error(self, "الحساب الابن يجب أن يكون تابعًا لحساب أب.")
            return None
        _kind = kind.currentText()
        if _kind not in ("expense", "advance", "asset"):
            style.error(self, "نوع الحساب غير صحيح — اختر من القائمة.")
            return None
        return dict(name=name.text().strip(), parent_id=parent.currentData(), is_active=active.isChecked(), allow_posting=posting.isChecked(), include_in_profitability=profit.isChecked(), account_kind=kind.currentText())

    def _expense_account_add(self, parent=False):
        try:
            from services import expense_account_service as ea
            if parent and not self._current_exp_parent():
                style.info(self, "اختر الحساب الأب أولاً ثم أضف الابن.")
                return
            vals = self._expense_account_prompt(parent_required=parent)
            if not vals: return
            ea.add_account(vals['name'], vals['parent_id'], vals['allow_posting'], vals['include_in_profitability'], vals['account_kind'])
            self._expense_accounts_reload(); style.toast(self, "تم إضافة الحساب")
        except Exception as exc:
            style.error(self, str(exc))

    def _expense_account_edit(self):
        acc = self._selected_expense_account()
        if not acc: return
        try:
            from services import expense_account_service as ea
            vals = self._expense_account_prompt(acc=acc)
            if not vals: return
            ea.update_account(acc['id'], vals['name'], vals['parent_id'], vals['is_active'], vals['allow_posting'], vals['include_in_profitability'], vals['account_kind'])
            self._expense_accounts_reload(); style.toast(self, "تم تعديل الحساب")
        except Exception as exc:
            style.error(self, str(exc))

    def _expense_account_toggle(self):
        acc = self._selected_expense_account()
        if not acc: return
        from services import expense_account_service as ea
        ea.toggle_active(acc['id']); self._expense_accounts_reload()

    def _tab_contract_types(self) -> QWidget:
        page = QWidget()
        outer = QVBoxLayout(page)
        outer.setContentsMargins(0, 12, 0, 0)
        outer.setSpacing(12)

        card, layout = _card()
        section = QLabel("أنواع العقود والمبالغ")
        section.setProperty("sectionTitle", True)
        layout.addWidget(section)
        hint = QLabel("نوع العقد يحدد طريقة التسعير للعقود الجديدة فقط.")
        hint.setProperty("hint", True)
        hint.setWordWrap(True)
        layout.addWidget(hint)

        from ui.widgets import flow_host as _fh_ct
        add_host, add_row = _fh_ct(spacing=8)
        add_row.setSpacing(8)
        self.ct_name = QLineEdit()
        self.ct_name.setPlaceholderText("اسم النوع (مثال: بناء فيلا)")
        self.ct_amount = SafeDoubleSpinBox()
        self.ct_amount.setDecimals(3)
        self.ct_amount.setRange(0, 999_999_999)
        self.ct_amount.setGroupSeparatorShown(True)
        self.ct_amount.setMinimumWidth(150)
        from PySide6.QtWidgets import QComboBox as _QCBm, QCheckBox as _QCBx
        from services import contract_type_service as _cts_m
        self.ct_mode = _QCBm(self)
        make_searchable(self.ct_mode, "")
        for _k, _v in _cts_m.MODES.items():
            self.ct_mode.addItem(_v, _k)
        self.ct_mode.setMinimumWidth(140)
        from services import feature_service as _feat_ct
        self.ct_sup = _QCBx("إشرافي", self)
        if not _feat_ct.enabled("supervision"):   # V4.5.13: لا وميض
            self.ct_sup.setVisible(False)
        self.ct_sup.setToolTip("عقد إشراف هندسي: تاريخ تعهد + تمديد تلقائي")
        self.ct_manual = _QCBx("🔧 مسار يدوي", self)
        self.ct_manual.setToolTip("عقود هذا النوع تعمل بالمسار اليدوي: "
                                  "تعليم حر للمراحل من تابات المراحل")
        self.ct_unit = QLineEdit(self)
        self.ct_unit.setPlaceholderText("وحدة القياس (واجهة · دور · متر)")
        self.ct_unit.setMaximumWidth(190)
        self.ct_unit_price = SafeDoubleSpinBox(self)
        self.ct_unit_price.setDecimals(3)
        self.ct_unit_price.setRange(0, 999_999_999)
        self.ct_unit_price.setGroupSeparatorShown(True)
        self.ct_unit_price.setMinimumWidth(130)
        self.ct_notes = QLineEdit()
        self.ct_notes.setPlaceholderText("ملاحظات (اختياري)")
        ct_add_btn = QPushButton("＋ إضافة نوع")
        ct_add_btn.setObjectName("btnPrimary")
        ct_add_btn.clicked.connect(self._ct_add)
        add_row.addWidget(QLabel("النوع:"))
        add_row.addWidget(self.ct_name)
        add_row.addWidget(QLabel("النمط:"))
        add_row.addWidget(self.ct_mode)
        add_row.addWidget(QLabel("المبلغ:"))
        add_row.addWidget(self.ct_amount)
        add_row.addWidget(QLabel("الوحدة:"))
        add_row.addWidget(self.ct_unit)
        add_row.addWidget(QLabel("سعر الوحدة:"))
        add_row.addWidget(self.ct_unit_price)
        add_row.addWidget(self.ct_sup)
        add_row.addWidget(self.ct_manual)
        add_row.addWidget(self.ct_notes)
        add_row.addWidget(ct_add_btn)
        layout.addWidget(add_host)

        self.ct_table = QTableWidget(0, 9)
        self.ct_table.setHorizontalHeaderLabels(
            ["النوع", "نمط التسعير", "المبلغ الافتراضي", "وحدة القياس",
             "سعر الوحدة", "عدد العقود", "الحالة", "المسار", "ملاحظات"])
        from ui.widgets import apply_column_weights
        apply_column_weights(self.ct_table, [19, 13, 12, 10, 11, 9, 9, 8, 9],
                             min_widths=[110, 92, 92, 78, 88, 68, 62, 70, 82])
        self.ct_table.setHorizontalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        self.ct_table.verticalHeader().setVisible(False)
        self.ct_table.setSelectionBehavior(QTableWidget.SelectRows)
        self.ct_table.setSelectionMode(QTableWidget.SingleSelection)
        self.ct_table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.ct_table.setAlternatingRowColors(True)
        self.ct_table.setMinimumHeight(220)
        layout.addWidget(self.ct_table, 1)

        actions_host, actions = _flow(spacing=8)
        edit_btn = QPushButton("✎ تعديل المحدد")
        edit_btn.setProperty("flat", True)
        edit_btn.clicked.connect(self._ct_edit)
        toggle_btn = QPushButton("تفعيل / تعطيل")
        toggle_btn.setProperty("flat", True)
        toggle_btn.clicked.connect(self._ct_toggle)
        from ui.widgets import attach_row_menu
        attach_row_menu(self.ct_table, lambda: [
            ("ربط مراحل ودفعات هذا النوع", self._ct_workflow),
            ("تعديل المحدد", self._ct_edit),
            ("تفعيل / تعطيل", self._ct_toggle),
            None,
            ("حذف نوع العقد", self._ct_delete, True),
        ])
        bulk_btn = QPushButton("تحديد نوع العقود القديمة")
        bulk_btn.setToolTip("العقود المنشأة قبل تفعيل أنواع العقود تأخذ "
                            "«غير محدد» · من هنا تحدد نوعها دفعة واحدة")
        bulk_btn.clicked.connect(self._ct_bulk_assign)
        setup_template_btn = QPushButton("قالب تأسيس الأنواع والمراحل")
        setup_template_btn.setProperty("flat", True)
        setup_template_btn.setToolTip("تنزيل قالب Excel لتأسيس أنواع العقود ومراحلها ودفعاتها")
        setup_template_btn.clicked.connect(self._ct_download_types_setup_template)
        setup_upload_btn = QPushButton("رفع الأنواع والمراحل")
        setup_upload_btn.setProperty("flat", True)
        setup_upload_btn.setToolTip("رفع قالب تأسيس أنواع العقود والمراحل والدفعات")
        setup_upload_btn.clicked.connect(self._ct_upload_types_setup_template)
        fix_unspecified_btn = QPushButton("🔧 إصلاح عقود غير محدد")
        fix_unspecified_btn.setProperty("flat", True)
        fix_unspecified_btn.setToolTip("فتح شاشة مراجعة وإصلاح العقود التي دخلت بنوع غير محدد")
        fix_unspecified_btn.clicked.connect(self._ct_open_fix_unspecified)
        wf_btn = QPushButton("ربط مراحل ودفعات هذا النوع")
        wf_btn.setObjectName("btnPrimary")
        wf_btn.setToolTip("نقطة الدخول الرئيسية: مراحل هذا النوع ودفعاته "
                          "— كل عقد جديد منه يبدأ جاهزًا بالكامل")
        wf_btn.clicked.connect(self._ct_workflow)
        # V3.30: مكوّنات العقد الشامل (للنوع الشامل فقط)
        bundle_btn = QPushButton("🧩 مكوّنات الشامل")
        bundle_btn.setProperty("flat", True)
        bundle_btn.setToolTip("تعريف مكوّنات النطاق للنوع الشامل المحدد: "
                              "عدد×سعر · إشراف · بنود")
        bundle_btn.clicked.connect(self._ct_bundle)
        actions.addWidget(wf_btn)
        actions.addWidget(edit_btn)
        actions.addWidget(bundle_btn)
        actions.addWidget(toggle_btn)
        actions.addWidget(bulk_btn)
        actions.addWidget(setup_template_btn)
        actions.addWidget(setup_upload_btn)
        actions.addWidget(fix_unspecified_btn)
        layout.addWidget(actions_host)

        outer.addWidget(card)
        self._ct_refresh()
        return page

    def _ct_download_types_setup_template(self):
        """تنزيل قالب تأسيس أنواع العقود والمراحل والدفعات من تبويب الأنواع."""
        try:
            from services.types_setup_service import TEMPLATE_FILENAME, generate_types_template
            default = os.path.join(os.path.expanduser("~"), TEMPLATE_FILENAME)
            path, _ = QFileDialog.getSaveFileName(
                self, "حفظ قالب تأسيس الأنواع والمراحل", default,
                "Excel (*.xlsx)")
            if not path:
                return
            if not path.lower().endswith(".xlsx"):
                path += ".xlsx"
            generate_types_template(path)
            style.info(self, f"تم إنشاء القالب:\n{path}", "تم")
        except Exception as exc:
            style.error(self, f"تعذر إنشاء القالب:\n{exc}")

    def _ct_upload_types_setup_template(self):
        """رفع قالب التأسيس من تبويب أنواع العقود."""
        path, _ = QFileDialog.getOpenFileName(
            self, "اختيار ملف تأسيس الأنواع والمراحل", "", "Excel (*.xlsx)")
        if not path:
            return
        try:
            from services.types_setup_service import TemplateError, read_template, execute_template
            parsed = read_template(path)
            if parsed.get("errors"):
                style.error(self, "لا يمكن الرفع قبل تصحيح الأخطاء:\n\n" +
                            "\n".join(parsed["errors"][:25]))
                return
            res = execute_template(parsed)
            parts = [
                f"أنواع أضيفت: {res.get('types_added', 0)} · متخطاة: {res.get('types_skipped', 0)}",
                f"مراحل أضيفت: {res.get('stages_added', 0)} · متخطاة: {res.get('stages_skipped', 0)}",
                f"دفعات أضيفت: {res.get('payments_added', 0)} · متخطاة: {res.get('payments_skipped', 0)}",
                f"دفعات بدون مرحلة: {res.get('payments_no_stage', 0)}",
            ]
            if parsed.get("warnings"):
                parts.append("\nتنبيهات:\n" + "\n".join(parsed["warnings"][:15]))
            if res.get("problems"):
                parts.append("\nملاحظات التنفيذ:\n" + "\n".join(res["problems"][:15]))
            style.info(self, "\n".join(parts), "نتيجة الرفع")
            self._ct_refresh()
            self.settings_changed.emit()
        except TemplateError as exc:
            style.error(self, str(exc))
        except Exception as exc:
            style.error(self, f"تعذر رفع القالب:\n{exc}")

    def _ct_open_fix_unspecified(self):
        """فتح شاشة المراجعة الآمنة لإصلاح عقود «غير محدد»."""
        try:
            from ui.fix_unspecified import FixUnspecifiedDialog
            dlg = FixUnspecifiedDialog(self)
            if dlg.exec() == QDialog.Accepted:
                self._ct_refresh()
                self.settings_changed.emit()
        except Exception as exc:
            style.error(self, f"تعذر فتح شاشة الإصلاح:\n{exc}")

    def _ct_workflow(self):
        """فتح صفحة ربط مراحل ودفعات النوع المحدد (المدخل الرئيسي)."""
        row = self.ct_table.currentRow()
        types = []
        try:
            from services import contract_type_service as _cts
            types = _cts.list_types(active_only=False)
        except Exception:
            pass
        if row < 0 or row >= len(types):
            style.info(self, "اختر نوع عقد من الجدول أولاً.")
            return
        from ui.widgets import find_host
        main = find_host(self, "open_type_workflow")
        if main is not None:
            main.open_type_workflow(types[row]["name"])
            return
        from ui.type_workflow import TypeWorkflowDialog
        TypeWorkflowDialog(self, types[row]["name"]).exec()

    def _features_changed(self):
        from services import feature_service as _feat
        boxes = getattr(self, "feature_boxes", {})
        if not boxes:
            return
        if not hasattr(self, "_auto_off"):
            self._auto_off = set()
        for _round in range(3):
            for key, box in boxes.items():
                requires = _feat.FEATURES[key].get("requires", [])
                parents_on = all(boxes[r].isChecked() for r in requires
                                 if r in boxes)
                box.setEnabled(parents_on)
                if not parents_on and box.isChecked():
                    box.blockSignals(True)
                    box.setChecked(False)
                    box.blockSignals(False)
                    self._auto_off.add(key)
                elif parents_on and key in self._auto_off:
                    box.blockSignals(True)
                    box.setChecked(True)
                    box.blockSignals(False)
                    self._auto_off.discard(key)
        off = [_feat.FEATURES[k]["name"] for k, b in boxes.items()
               if not b.isChecked()]
        theme = style.theme()
        if off:
            self.mod_state_lbl.setText(
                f"سيُخفى عن العميل ({len(off)}): " + " · ".join(off))
            self.mod_state_lbl.setStyleSheet(
                f"font-weight: 700; color: {theme['WARNING_700']};")
        else:
            self.mod_state_lbl.setText("كل المزايا ستظهر للعميل")
            self.mod_state_lbl.setStyleSheet(
                f"font-weight: 700; color: {theme['SUCCESS_700']};")

    def _save_modules(self):
        from services import feature_service as _feat
        boxes = getattr(self, "feature_boxes", {})
        try:
            _feat.set_many({k: b.isChecked() for k, b in boxes.items()})
            from services import settings_service as _sv
            _sv.set_modules(cashflow=_feat.enabled("cashflow"),
                            bank_fee=_feat.enabled("bank_fee"))
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
            return
        style.toast(self, "تم حفظ مزايا النظام")
        self.modules_changed.emit()

    def _ct_bulk_assign(self):
        from PySide6.QtWidgets import QAbstractItemView, QComboBox, QDialog, QListWidget, QListWidgetItem, QVBoxLayout
        from services import contract_type_service as cts
        rows = cts.contracts_without_type()
        if not rows:
            style.info(self, "كل العقود لها نوع محدد بالفعل ✔")
            return
        types = [t["name"] for t in cts.list_types()
                 if t["name"] != cts.UNSPECIFIED]
        if not types:
            style.info(self, "أضف نوع عقد واحدًا على الأقل أولاً.")
            return

        dlg = QDialog(self)
        dlg.setWindowTitle("تحديد نوع العقود القديمة")
        dlg.setLayoutDirection(Qt.RightToLeft)
        dlg.resize(680, 520)
        layout = QVBoxLayout(dlg)
        layout.setContentsMargins(18, 16, 18, 16)
        layout.setSpacing(10)
        hint = QLabel(f"عدد العقود بلا نوع: {len(rows)}، اختر العقود "
                      "(بالضغط مع Ctrl لاختيار أكثر من عقد) ثم النوع.")
        hint.setProperty("hint", True)
        hint.setWordWrap(True)
        layout.addWidget(hint)

        lst = QListWidget()
        lst.setSelectionMode(QAbstractItemView.ExtendedSelection)
        for r in rows:
            name = r["name"] or "(بلا اسم)"
            item = QListWidgetItem(
                f"{name}  ·  {r['customer_name'] or 'بلا عميل'}  ·  "
                f"{float(r['amount'] or 0):,.3f}")
            item.setToolTip(r["contract_number"])
            item.setData(Qt.UserRole, r["id"])
            lst.addItem(item)
        layout.addWidget(lst, 1)

        row = QHBoxLayout()
        all_btn = QPushButton("تحديد الكل")
        all_btn.setProperty("flat", True)
        all_btn.clicked.connect(lst.selectAll)
        type_combo = QComboBox()
        type_combo.addItems(types)
        make_searchable(type_combo, "")
        row.addWidget(all_btn)
        row.addWidget(QLabel("النوع:"))
        row.addWidget(type_combo, 1)
        layout.addLayout(row)

        buttons = QHBoxLayout()
        ok = QPushButton("تطبيق")
        ok.setObjectName("btnPrimary")
        cancel = QPushButton("✕ إلغاء")
        cancel.setProperty("flat", True)
        ok.clicked.connect(dlg.accept)
        cancel.clicked.connect(dlg.reject)
        buttons.addStretch()
        buttons.addWidget(ok)
        buttons.addWidget(cancel)
        layout.addLayout(buttons)

        if dlg.exec() != QDialog.Accepted:
            return
        ids = [i.data(Qt.UserRole) for i in lst.selectedItems()]
        if not ids:
            style.info(self, "لم تختر أي عقد.")
            return
        try:
            n = cts.assign_type_bulk(ids, type_combo.currentText())
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
            return
        self._ct_refresh()
        style.info(self, f"تم تحديد النوع «{type_combo.currentText()}» "
                         f"لعدد {n} عقد.", "تم")

    def _ct_refresh(self):
        from services import contract_type_service as cts
        self._ct_rows = cts.list_types(active_only=False)
        self.ct_table.setRowCount(len(self._ct_rows))
        for r, t in enumerate(self._ct_rows):
            _unit = (t.get("unit_label") or "").strip()
            _uprice = float(t.get("unit_price") or 0)
            from services import contract_type_service as _ctsl
            _mode = _ctsl.mode_label(t.get("pricing_mode") or "")
            if t.get("is_supervision"):
                _mode += " (إشرافي)"
            cells = [t["name"], _mode, f"{float(t['default_amount']):,.3f}",
                     _unit or "—",
                     f"{_uprice:,.3f}" if _uprice else "—",
                     str(t["contracts_count"]),
                     "مفعّل" if t["active"] else "معطّل",
                     "🔧 يدوي" if t.get("manual_track") else "تلقائي",
                     t["notes"] or ""]
            for c, text in enumerate(cells):
                item = QTableWidgetItem(text)
                if c in (1, 2, 3, 4, 5, 6, 7):
                    item.setTextAlignment(Qt.AlignCenter)
                if c == 6 and not t["active"]:
                    item.setForeground(QColor(style.MUTED))
                self.ct_table.setItem(r, c, item)
        from ui.widgets import sync_header_alignment
        sync_header_alignment(self.ct_table)

    def _ct_selected(self):
        row = self.ct_table.currentRow()
        if row < 0 or row >= len(getattr(self, "_ct_rows", [])):
            style.info(self, "اختر نوعًا من الجدول أولاً.")
            return None
        return self._ct_rows[row]

    def _ct_add(self):
        from services import contract_type_service as cts
        new_type_name = self.ct_name.text().strip()
        try:
            cts.add_type(new_type_name, self.ct_amount.value(),
                         self.ct_notes.text(),
                         unit_label=self.ct_unit.text(),
                         unit_price=self.ct_unit_price.value(),
                         pricing_mode=self.ct_mode.currentData(),
                         is_supervision=self.ct_sup.isChecked(),
                         manual_track=self.ct_manual.isChecked())
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
            return
        self.ct_name.clear()
        self.ct_amount.setValue(0)
        self.ct_unit.clear()
        self.ct_unit_price.setValue(0)
        self.ct_sup.setChecked(False)
        self.ct_manual.setChecked(False)
        self.ct_mode.setCurrentIndex(0)
        self.ct_notes.clear()
        self._ct_refresh()
        if hasattr(self, "wf_scope"):
            self._wf_refresh_tree_list(select=new_type_name)

    def _ct_edit(self):
        t = self._ct_selected()
        if not t:
            return
        from services import contract_type_service as cts
        dlg = _ContractTypeDialog(self, t)
        if dlg.exec() != QDialog.Accepted:
            return
        try:
            cts.update_type(t["id"], dlg.name.text(), dlg.amount.value(),
                            dlg.notes.text(),
                            unit_label=dlg.unit.text(),
                            unit_price=dlg.unit_price.value(),
                            pricing_mode=dlg.mode.currentData(),
                            is_supervision=dlg.sup.isChecked(),
                            manual_track=dlg.manual.isChecked())
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
            return
        self._ct_refresh()

    def _ct_bundle(self):
        """V3.30: حوار مكوّنات النوع الشامل المحدد."""
        t = self._ct_selected()
        if not t:
            return
        from services import contract_type_service as cts
        if cts.type_config(t["name"])["mode"] != cts.MODE_BUNDLE:
            style.info(self, "المكوّنات للأنواع الشاملة فقط — غيّر نمط "
                             "التسعير إلى «عقد شامل» أولاً.")
            return
        dlg = _BundleComponentsDialog(self, t["name"])
        dlg.exec()

    def _ct_toggle(self):
        t = self._ct_selected()
        if not t:
            return
        from services import contract_type_service as cts
        cts.set_active(t["id"], not t["active"])
        self._ct_refresh()

    def _ct_delete(self):
        t = self._ct_selected()
        if not t:
            return
        if not style.confirm(self, f"حذف نوع العقد «{t['name']}»؟"):
            return
        from services import contract_type_service as cts
        try:
            cts.delete_type(t["id"])
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
            return
        self._ct_refresh()

    def _security_card(self) -> QFrame:
        card, layout = _card()
        section = QLabel("بيانات تسجيل الدخول")
        section.setProperty("sectionTitle", True)
        layout.addWidget(section)
        self.user_lbl = QLabel("")
        self.user_lbl.setStyleSheet(
            f"color: {style.ACCENT}; font-weight: 700; font-size: 12.8px;"
            "background: transparent;")
        layout.addWidget(self.user_lbl)
        hint = QLabel("تسجيل الدخول مطلوب عند تشغيل البرنامج.")
        hint.setProperty("hint", True)
        layout.addWidget(hint)
        row = QHBoxLayout()
        change_pass_btn = QPushButton("تغيير اسم المستخدم / كلمة المرور")
        change_pass_btn.clicked.connect(self._change_password)
        row.addWidget(change_pass_btn)
        row.addStretch()
        layout.addLayout(row)
        return card

    def _users_card(self) -> QFrame:
        from PySide6.QtWidgets import QComboBox, QHeaderView, QTableWidget, QTableWidgetItem
        from services import auth_service
        card, layout = _card()
        users_title = QLabel("المستخدمون والصلاحيات")
        users_title.setProperty("sectionTitle", True)
        layout.addWidget(users_title)
        hint = QLabel("يمكن للمدير تخصيص صلاحيات كل موظف.")
        hint.setWordWrap(True)
        hint.setMinimumWidth(0)
        hint.setProperty("hint", True)
        layout.addWidget(hint)

        self.users_table = QTableWidget(0, 4)
        self.users_table.setHorizontalHeaderLabels(
            ["اسم الموظف", "اسم الدخول", "الدور", "تاريخ الإنشاء"])
        _uh = self.users_table.horizontalHeader()
        _uh.setSectionResizeMode(QHeaderView.Stretch)
        _uh.setStretchLastSection(False)
        self.users_table.setHorizontalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        self.users_table.verticalHeader().setVisible(False)
        self.users_table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.users_table.setSelectionBehavior(QTableWidget.SelectRows)
        layout.addWidget(self.users_table, 1)

        btns_host, btns = _flow(spacing=8)
        add_btn = QPushButton("＋ مستخدم جديد")
        add_btn.setObjectName("btnPrimary")
        ident_btn = QPushButton("✎ تعديل بيانات الموظف")
        ident_btn.setProperty("flat", True)
        reset_btn = QPushButton("🔑 إعادة تعيين كلمة المرور")
        reset_btn.setProperty("flat", True)

        from services import feature_service as _featp
        _perms_feature = _featp.enabled("user_permissions")

        def _refresh_users():
            self._users = auth_service.list_users()
            self.users_table.setRowCount(len(self._users))
            for r, u in enumerate(self._users):
                job = (u.get("job_title") or "").strip()
                display = (u.get("full_name") or "").strip() or "—"
                if job and display != "—":
                    display = f"{display} · {job}"
                for col, val in enumerate([
                        display, u["username"],
                        auth_service.ROLE_LABELS.get(u["role"], u["role"]),
                        (u["created_at"] or "")[:16]]):
                    item = QTableWidgetItem(str(val))
                    item.setTextAlignment(Qt.AlignCenter)
                    self.users_table.setItem(r, col, item)
            from ui.widgets import sync_header_alignment
            sync_header_alignment(self.users_table)
        self._refresh_users_table = _refresh_users

        def _selected_user():
            row = self.users_table.currentRow()
            if row < 0 or row >= len(self._users):
                style.info(self, "اختر مستخدمًا من الجدول أولاً.")
                return None
            return self._users[row]

        def _add_user():
            dlg = QDialog(self)
            dlg.setWindowTitle("مستخدم جديد")
            dlg.setLayoutDirection(Qt.RightToLeft)
            dlg.setMinimumWidth(380)
            form = QFormLayout(dlg)
            form.setSpacing(10)
            fname = QLineEdit()
            fname.setPlaceholderText("اسم الموظف الذي سيستخدم الحساب")
            jtitle = QLineEdit()
            jtitle.setPlaceholderText("المسمى الوظيفي (اختياري)")
            uname = QLineEdit()
            pwd = QLineEdit(); pwd.setEchoMode(QLineEdit.Password)
            pwd2 = QLineEdit(); pwd2.setEchoMode(QLineEdit.Password)
            role = QComboBox()
            role.addItem("سكرتير · العمل اليومي", auth_service.ROLE_SECRETARY)
            role.addItem("مدير · كل الصلاحيات", auth_service.ROLE_ADMIN)
            make_searchable(role, "")
            form.addRow("اسم الموظف *", fname)
            form.addRow("المسمى الوظيفي", jtitle)
            form.addRow("اسم الدخول *", uname)
            form.addRow("كلمة المرور *", pwd)
            form.addRow("تأكيد كلمة المرور *", pwd2)
            form.addRow("الدور *", role)
            bl = QHBoxLayout()
            ok = QPushButton("＋ إضافة"); ok.setObjectName("btnPrimary")
            cancel = QPushButton("✕ إلغاء"); cancel.setProperty("flat", True)
            cancel.clicked.connect(dlg.reject)

            def _save():
                if pwd.text() != pwd2.text():
                    style.error(dlg, "تأكيد كلمة المرور غير مطابق.")
                    return
                if not fname.text().strip():
                    style.error(dlg, "اسم الموظف مطلوب.")
                    return
                try:
                    auth_service.add_user(uname.text(), pwd.text(),
                                          role.currentData(),
                                          full_name=fname.text(),
                                          job_title=jtitle.text())
                    dlg.accept()
                except (ValidationError, DatabaseError) as exc:
                    style.error(dlg, str(exc))
            ok.clicked.connect(_save)
            bl.addStretch(); bl.addWidget(ok); bl.addWidget(cancel)
            form.addRow(bl)
            if dlg.exec() == QDialog.Accepted:
                _refresh_users()
                self.user_identity_changed.emit()
                style.toast(self, "تم إضافة المستخدم.")

        def _reset_pwd():
            u = _selected_user()
            if not u:
                return
            from PySide6.QtWidgets import QInputDialog
            pwd, ok = QInputDialog.getText(
                self, "كلمة مرور جديدة",
                f"كلمة المرور الجديدة للمستخدم «{u['username']}»:",
                QLineEdit.Password)
            if not ok or not pwd:
                return
            try:
                auth_service.reset_user_password(u["id"], pwd)
                style.toast(self, "تم تغيير كلمة المرور.")
            except (ValidationError, DatabaseError) as exc:
                style.error(self, str(exc))

        def _del_user():
            u = _selected_user()
            if not u:
                return
            if u["username"] == auth_service.current_username():
                style.error(self, "لا يمكنك حذف المستخدم الذي تعمل به الآن.")
                return
            if not style.confirm(self,
                                 f"حذف المستخدم «{u['username']}»؟"):
                return
            try:
                auth_service.delete_user(u["id"])
                _refresh_users()
            except (ValidationError, DatabaseError) as exc:
                style.error(self, str(exc))

        def _edit_identity():
            u = _selected_user()
            if not u:
                return
            from PySide6.QtWidgets import QInputDialog
            name, ok = QInputDialog.getText(
                self, "بيانات الموظف",
                f"اسم الموظف صاحب الحساب «{u['username']}»:",
                QLineEdit.Normal, u.get("full_name") or "")
            if not ok:
                return
            job, ok2 = QInputDialog.getText(
                self, "بيانات الموظف", "المسمى الوظيفي (اختياري):",
                QLineEdit.Normal, u.get("job_title") or "")
            if not ok2:
                return
            try:
                auth_service.set_user_identity(u["id"], name, job)
            except (ValidationError, DatabaseError) as exc:
                style.error(self, str(exc))
                return
            _refresh_users()
            self.user_identity_changed.emit()
            style.toast(self, "تم حفظ بيانات الموظف.")

        def _edit_perms():
            u = _selected_user()
            if not u:
                return
            if u.get("role") != auth_service.ROLE_SECRETARY:
                style.info(
                    self,
                    "المدير والمطور يملكان كل الصلاحيات دائمًا — "
                    "لا يحتاجان تخصيصًا.")
                return
            dlg = UserPermsDialog(u, self)
            if dlg.exec() == QDialog.Accepted:
                _refresh_users()
                style.toast(self, "تم حفظ صلاحيات الموظف.")

        add_btn.clicked.connect(_add_user)
        ident_btn.clicked.connect(_edit_identity)
        reset_btn.clicked.connect(_reset_pwd)
        from ui.widgets import attach_row_menu
        _menu_items = [
            ("تعديل بيانات الموظف", _edit_identity),
            ("إعادة تعيين كلمة المرور", _reset_pwd),
        ]
        if _perms_feature:
            _menu_items.insert(1, ("صلاحيات الموظف", _edit_perms))
        _menu_items.append(None)
        _menu_items.append(("حذف المستخدم", _del_user, True))
        attach_row_menu(self.users_table, lambda: list(_menu_items))
        btns.addWidget(add_btn)
        btns.addWidget(ident_btn)
        if _perms_feature:
            perms_btn = QPushButton("صلاحيات الموظف")
            perms_btn.setProperty("flat", True)
            perms_btn.clicked.connect(_edit_perms)
            btns.addWidget(perms_btn)
        btns.addWidget(reset_btn)
        layout.addWidget(btns_host)
        _refresh_users()
        return card

    def _tab_workflow(self) -> QWidget:
        """مراحل المتابعة والتنفيذ — شجرية للعقود (رئيسية/فرعية)."""
        from PySide6.QtWidgets import (QComboBox as _QCb,
                                       QTableWidget as _QTw,
                                       QTableWidgetItem as _QTi,
                                       QHeaderView as _QHv,
                                       QDialog as _QDlg,
                                       QFormLayout as _QForm,
                                       QDialogButtonBox as _QBB)
        from services import workflow_service as _wf
        from ui.widgets import (apply_column_weights, sync_header_alignment,
                                attach_row_menu, SafeSpinBox as _QSpin)
        page = QWidget()
        outer = QVBoxLayout(page)
        outer.setContentsMargins(0, 12, 0, 0)
        outer.setSpacing(12)

        card, layout = _card()
        title = QLabel("مراحل المتابعة والتنفيذ")
        title.setProperty("sectionTitle", True)
        layout.addWidget(title)
        hint = QLabel("كل نوع عقد له شجرة مستقلة تُنسخ للعقود الجديدة.")
        hint.setWordWrap(True)
        hint.setMinimumWidth(0)
        hint.setProperty("hint", True)
        layout.addWidget(hint)

        pick_host, pick_row = _flow(spacing=8)
        pick_row.addWidget(QLabel("نوع المعاملة:"))
        self.wf_type = _QCb()
        make_searchable(self.wf_type, "")
        for key, label in _wf.TX_TYPES.items():
            self.wf_type.addItem(label, key)
        self.wf_type.currentIndexChanged.connect(self._wf_type_changed)
        pick_row.addWidget(self.wf_type)
        # قائمة الأشجار: كل شجرة مرتبطة بنوع عقد بالاسم نفسه
        pick_row.addWidget(QLabel("قائمة الأشجار:"))
        self.wf_scope = _QCb()
        make_searchable(self.wf_scope, "")
        self.wf_scope.setMinimumWidth(260)
        self.wf_scope.setToolTip("كل نوع عقد له شجرة مستقلة.")
        self._wf_refresh_tree_list()
        self.wf_scope.currentIndexChanged.connect(self._wf_reload)
        pick_row.addWidget(self.wf_scope, 1)
        self.wf_new_tree_btn = QPushButton("＋ شجرة جديدة / ربط نوع عقد")
        self.wf_new_tree_btn.setObjectName("btnPrimary")
        self.wf_new_tree_btn.setToolTip(
            "اختر نوع عقد، ثم أنشئ له شجرة فارغة أو افتراضية أو منسوخة")
        self.wf_new_tree_btn.clicked.connect(self._wf_new_contract_tree)
        pick_row.addWidget(self.wf_new_tree_btn)
        self.wf_template_btn = QPushButton("⬇ تحميل نموذج رفع الشجرة")
        self.wf_template_btn.setProperty("flat", True)
        self.wf_template_btn.setToolTip("إنشاء ملف Excel فارغ لتعبئة شجرة مراحل العقود ورفعها")
        self.wf_template_btn.clicked.connect(self._wf_download_stage_tree_template)
        pick_row.addWidget(self.wf_template_btn)
        self.wf_import_btn = QPushButton("رفع شجرة النوع المحدد")
        self.wf_import_btn.setObjectName("btnPrimary")
        self.wf_import_btn.setToolTip("استبدال شجرة النوع المحدد فقط")
        self.wf_import_btn.clicked.connect(self._wf_import_stage_tree_file)
        pick_row.addWidget(self.wf_import_btn)
        layout.addWidget(pick_host)

        self.wf_table = _QTw(0, 5)
        self.wf_table.setHorizontalHeaderLabels(
            ["#", "المرحلة", "الأيام المتوقعة", "اللون", "مرّت بها"])
        self.wf_table.verticalHeader().setVisible(False)
        self.wf_table.setSelectionBehavior(_QTw.SelectRows)
        self.wf_table.setEditTriggers(_QTw.NoEditTriggers)
        self.wf_table.horizontalHeader().setSectionResizeMode(
            1, _QHv.Stretch)
        apply_column_weights(self.wf_table, [7, 56, 16, 10, 11],
                             min_widths=[40, 180, 90, 60, 80])
        self.wf_table.setMinimumHeight(240)
        self.wf_table.doubleClicked.connect(lambda *_: self._wf_edit())
        attach_row_menu(self.wf_table, lambda: [
            ("تعديل المرحلة", self._wf_edit),
            ("تحريك لأعلى", lambda: self._wf_move(-1)),
            ("تحريك لأسفل", lambda: self._wf_move(1)),
            None,
            ("حذف المرحلة", self._wf_delete, True),
        ])
        layout.addWidget(self.wf_table)
        sync_header_alignment(self.wf_table)

        add_host, add_row = _flow(spacing=8)
        self.wf_name = QLineEdit()
        self.wf_name.setPlaceholderText("اسم المرحلة الجديدة...")
        add_row.addWidget(QLabel("مرحلة جديدة:"))
        add_row.addWidget(self.wf_name)
        self.wf_days = _QSpin()
        self.wf_days.setRange(0, 999)
        self.wf_days.setValue(0)
        add_row.addWidget(QLabel("الأيام المتوقعة:"))
        add_row.addWidget(self.wf_days)
        self.wf_color = _QCb()
        make_searchable(self.wf_color, "")
        for key, label in (("neutral", "رمادي · محايد"),
                           ("warn", "كهرماني · انتظار"),
                           ("info", "أزرق · جارٍ"),
                           ("purple", "بنفسجي · مرحلة خاصة"),
                           ("done", "أخضر · مكتمل"),
                           ("danger", "أحمر · متعثّر")):
            self.wf_color.addItem(label, key)
        add_row.addWidget(QLabel("اللون:"))
        add_row.addWidget(self.wf_color)
        self.wf_add_main = QPushButton("＋ إضافة رئيسية")
        self.wf_add_main.setObjectName("btnPrimary")
        self.wf_add_main.setToolTip("مرحلة رئيسية تضم مراحل فرعية "
                                    "(مثال: أعمال التنفيذ)")
        self.wf_add_main.clicked.connect(lambda: self._wf_add(main=True))
        add_row.addWidget(self.wf_add_main)
        self.wf_add_sub = QPushButton("＋ إضافة فرعية تحت المحدد")
        self.wf_add_sub.setToolTip("تُضاف تحت المرحلة الرئيسية المحددة "
                                   "في الجدول — مع مدتها المتوقعة")
        self.wf_add_sub.clicked.connect(lambda: self._wf_add(main=False))
        add_row.addWidget(self.wf_add_sub)
        layout.addWidget(add_host)

        act_host, act_row = _flow(spacing=8)
        up_btn = QPushButton("تحريك لأعلى")
        up_btn.setProperty("flat", True)
        up_btn.clicked.connect(lambda: self._wf_move(-1))
        down_btn = QPushButton("تحريك لأسفل")
        down_btn.setProperty("flat", True)
        down_btn.clicked.connect(lambda: self._wf_move(1))
        edit_btn = QPushButton("✎ تعديل المرحلة")
        edit_btn.setProperty("flat", True)
        edit_btn.clicked.connect(self._wf_edit)
        restore_stages = QPushButton("استعادة المراحل الافتراضية")
        restore_stages.setProperty("flat", True)
        restore_stages.clicked.connect(self._wf_restore)
        # V3.24: تطبيق الطابع الإشرافي للقالب على العقود القائمة
        self.wf_sup_sync_btn = QPushButton("👁 تطبيق الطابع على العقود القائمة")
        self.wf_sup_sync_btn.setToolTip(
            "مطابقة بالاسم داخل هذا النوع — يضيف الطابع فقط ولا يمسّ "
            "أي تقدم أو تواريخ · مع معاينة قبل التنفيذ")
        self.wf_sup_sync_btn.clicked.connect(self._wf_sup_sync)
        for b in (edit_btn, up_btn, down_btn, restore_stages):
            act_row.addWidget(b)
        act_row.addWidget(self.wf_sup_sync_btn)
        layout.addWidget(act_host)

        self.wf_state = QLabel("")
        self.wf_state.setWordWrap(True)
        self.wf_state.setProperty("hint", True)
        layout.addWidget(self.wf_state)

        outer.addWidget(card)

        outer.addStretch()
        self._wf_reload()
        return page

    def _wf_refresh_tree_list(self, select: str = ""):
        """تحديث قائمة الأشجار مع إظهار الربط والعدد بوضوح."""
        if not hasattr(self, "wf_scope"):
            return
        from services import workflow_service as _wf
        old = select or (self.wf_scope.currentData() or "")
        self.wf_scope.blockSignals(True)
        self.wf_scope.clear()
        try:
            trees = _wf.list_contract_stage_trees(active_only=True)
        except Exception:
            trees = []
        for t in trees:
            # اسم الشجرة = نوع العقد، فلا نكرر الاسم الطويل داخل القائمة.
            # التفاصيل تبقى في Tooltip حتى لا يصبح الاختيار بعرض الشاشة.
            label = f"{t['contract_type']}"
            details = (f"نوع العقد: {t['contract_type']}\n"
                       f"عدد المراحل: {t['stage_count']}\n"
                       f"عدد العقود: {t['contracts_count']}")
            self.wf_scope.addItem(label, t["contract_type"])
            self.wf_scope.setItemData(self.wf_scope.count() - 1, details,
                                      Qt.ToolTipRole)
        if old:
            idx = self.wf_scope.findData(old)
            if idx >= 0:
                self.wf_scope.setCurrentIndex(idx)
        self.wf_scope.blockSignals(False)

    def _wf_new_contract_tree(self):
        """زر إنشاء شجرة مراحل جديدة وربطها بنوع عقد."""
        from PySide6.QtWidgets import (QDialog as _QDlg, QFormLayout as _QForm,
                                       QComboBox as _QCb,
                                       QDialogButtonBox as _QBB)
        from services import contract_type_service as _cts
        from services import workflow_service as _wf
        types = [t["name"] for t in _cts.list_types(active_only=True)]
        if not types:
            style.info(self, "أنشئ نوع عقد أولًا من تبويب «أنواع العقود».")
            return
        dlg = _QDlg(self)
        dlg.setWindowTitle("شجرة جديدة / ربط نوع عقد")
        dlg.setLayoutDirection(Qt.RightToLeft)
        form = _QForm(dlg)
        form.setSpacing(10)
        target_cb = _QCb(); target_cb.addItems(types)
        make_searchable(target_cb, "")
        cur = self._wf_current_scope()
        if cur in types:
            target_cb.setCurrentText(cur)
        mode_cb = _QCb()
        make_searchable(mode_cb, "")
        mode_cb.addItem("شجرة فارغة — سأضيف مراحلها بنفسي", "empty")
        mode_cb.addItem("شجرة افتراضية مستقلة لهذا النوع", "default")
        mode_cb.addItem("نسخة من شجرة نوع آخر", "copy")
        source_cb = _QCb()
        make_searchable(source_cb, "")
        source_lbl = QLabel("نسخ من:")
        for t in types:
            source_cb.addItem(t, t)
        def _sync_source():
            target = target_cb.currentText()
            cur_src = source_cb.currentText()
            source_cb.blockSignals(True)
            source_cb.clear()
            for t in types:
                if t != target:
                    source_cb.addItem(t, t)
            if cur_src and cur_src != target:
                idx = source_cb.findText(cur_src)
                if idx >= 0:
                    source_cb.setCurrentIndex(idx)
            is_copy = mode_cb.currentData() == "copy"
            source_cb.setEnabled(is_copy)
            source_cb.setVisible(is_copy)
            source_lbl.setVisible(is_copy)
            source_cb.blockSignals(False)
        target_cb.currentTextChanged.connect(lambda *_: _sync_source())
        mode_cb.currentIndexChanged.connect(lambda *_: _sync_source())
        _sync_source()
        note = QLabel("سيتم ربط الشجرة بنوع العقد المحدد فقط.")
        note.setProperty("hint", True); note.setWordWrap(True)
        form.addRow("نوع العقد المرتبط:", target_cb)
        form.addRow("طريقة إنشاء الشجرة:", mode_cb)
        form.addRow(source_lbl, source_cb)
        form.addRow(note)
        bb = _QBB(_QBB.Save | _QBB.Cancel)
        bb.button(_QBB.Save).setText("إنشاء/ربط")
        bb.button(_QBB.Cancel).setText("إلغاء")
        bb.accepted.connect(dlg.accept); bb.rejected.connect(dlg.reject)
        form.addRow(bb)
        if dlg.exec() != _QDlg.Accepted:
            return
        target = target_cb.currentText()
        mode = mode_cb.currentData()
        source = source_cb.currentText() if mode == "copy" else ""
        if target not in types:
            style.error(self, "اختر نوع العقد المرتبط من القائمة.")
            return
        if mode == "copy" and source not in types:
            style.error(self, "اختر الشجرة المصدر من القائمة.")
            return
        existing = _wf.get_stages(_wf.TX_CONTRACT, target)
        if existing and not style.confirm(
                self,
                f"نوع العقد «{target}» له شجرة حالية ({len(existing)} مرحلة).\n\n"
                "هل تريد استبدالها بشجرة جديدة؟\n"
                "لن تتأثر العقود القديمة التي سبق إنشاؤها لأنها تملك Snapshot مستقل.",
                "استبدال شجرة مراحل"):
            return
        try:
            res = _wf.replace_contract_type_template(target, mode, source)
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
            return
        self._wf_refresh_tree_list(select=target)
        self._wf_reload()
        if mode == "empty":
            msg = f"تم إنشاء شجرة فارغة وربطها بنوع العقد «{target}». أضف مراحلها الآن."
        elif mode == "default":
            msg = f"تم إنشاء شجرة افتراضية مستقلة لنوع «{target}» بعدد {res['stages']} مرحلة."
        else:
            msg = f"تم نسخ {res['stages']} مرحلة و {res['payments']} دفعة من «{source}» إلى «{target}»."
        style.success(self, msg)

    def _wf_download_stage_tree_template(self):
        """تحميل نموذج Excel لرفع شجرة المراحل."""
        from services import workflow_service as _wf
        default = os.path.join(os.path.expanduser("~"), "نموذج_رفع_شجرة_المراحل_والدفعات.xlsx")
        path, _ = QFileDialog.getSaveFileName(
            self, "حفظ نموذج رفع شجرة المراحل", default,
            "Excel Files (*.xlsx)")
        if not path:
            return
        if not path.lower().endswith(".xlsx"):
            path += ".xlsx"
        try:
            _wf.generate_stage_tree_template(path)
        except Exception as exc:
            style.error(self, str(exc))
            return
        style.success(self, f"تم إنشاء نموذج رفع شجرة المراحل:\n{path}")

    def _wf_import_stage_tree_file(self):
        """رفع شجرة مراحل العقود من ملف Excel."""
        from services import workflow_service as _wf
        path, _ = QFileDialog.getOpenFileName(
            self, "اختيار ملف شجرة المراحل", os.path.expanduser("~"),
            "Excel Files (*.xlsx)")
        if not path:
            return
        try:
            preview = _wf.read_stage_tree_file(path)
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
            return
        selected_type = self._wf_current_scope()
        file_types = list(preview.get("types") or [])
        if self._wf_current_type() == _wf.TX_CONTRACT:
            if not selected_type:
                style.error(self, "اختر شجرة/نوع عقد أولًا.")
                return
            if file_types != [selected_type]:
                style.error(
                    self,
                    "رفع الشجرة أصبح مخصصًا للنوع المحدد فقط.\n"
                    f"النوع المحدد: {selected_type}\n"
                    f"الأنواع الموجودة في الملف: {', '.join(file_types) if file_types else 'لا يوجد'}\n\n"
                    "الأفضل فتح نافذة «ربط مراحل ودفعات هذا النوع» واستخدام زر رفع شجرة هذا النوع."
                )
                return
        types = "، ".join(file_types)
        msg = (
            f"سيتم رفع شجرة مراحل واستبدال شجرة النوع المحدد فقط:\n{types}\n\n"
            f"عدد الصفوف: {preview.get('row_count', 0)}\n"
            f"الرئيسيات: {preview.get('main_count', 0)}\n"
            f"الفرعيات: {preview.get('sub_count', 0)}\n"
            f"مراحل مباشرة بدون فرعيات: {preview.get('direct_count', 0)}\n"
            f"دفعات مرتبطة/يدوية: {preview.get('payment_count', 0)}\n\n"
            "العقود القديمة التي سبق إنشاؤها لا تتأثر. هل تريد المتابعة؟")
        if not style.confirm(self, msg, "تأكيد رفع شجرة المراحل"):
            return
        try:
            res = _wf.import_stage_tree_file(path, replace=True)
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
            return
        select = selected_type or (res.get("types") or [""])[0]
        self._wf_refresh_tree_list(select=select)
        self._wf_reload()
        style.success(
            self,
            f"تم رفع شجرة المراحل والدفعات بنجاح.\n"
            f"تم حذف/استبدال: {res.get('removed', 0)} مرحلة قديمة.\n"
            f"تمت إضافة: {res.get('added', 0)} مرحلة جديدة.\n"
            f"تمت إضافة: {res.get('payments_added', 0)} دفعة من القالب.")

    def _wf_current_type(self) -> str:
        return self.wf_type.currentData() or ""

    def _wf_current_scope(self) -> str:
        """قالب المراحل = نوع العقد المحدد (المراحل لا تكون إلا لنوع)."""
        if self._wf_current_type() != "contract":
            return ""
        return self.wf_scope.currentData() or ""

    def _wf_is_tree_type(self) -> bool:
        return self._wf_current_type() in ("contract", "customer")

    def _wf_type_changed(self):
        """نوع المعاملة تغيّر — قالب المراحل يظهر للعقود فقط."""
        is_contract = self._wf_current_type() == "contract"
        self.wf_scope.setVisible(is_contract)
        if hasattr(self, "wf_new_tree_btn"):
            self.wf_new_tree_btn.setVisible(is_contract)
        if hasattr(self, "wf_template_btn"):
            self.wf_template_btn.setVisible(is_contract)
        if hasattr(self, "wf_import_btn"):
            self.wf_import_btn.setVisible(is_contract)
        self._wf_reload()

    def _wf_copy_to_type(self):
        from services import workflow_service as _wf
        scope = self._wf_current_scope()
        if not scope:
            style.info(self, "لا توجد أنواع عقود بعد — أنشئ نوعًا من "
                             "تبويب «أنواع العقود» أولاً (يُزرع له "
                             "قالب مراحل تلقائيًا).")
            return
        if not style.confirm(
                self, f"استعادة الشجرة الافتراضية لمراحل نوع "
                      f"«{scope}»؟\n\nمتاح فقط إن كانت مراحله "
                      "محذوفة بالكامل — وعدّل بعدها الأيام والنسب "
                      "والفروع كما يناسبك.",
                "استعادة المراحل الافتراضية"):
            return
        try:
            added = _wf.restore_default_for_type(scope)
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
            return
        self._wf_reload()
        style.toast(self, f"تم زرع {added} مرحلة افتراضية لقالب "
                          f"«{scope}»")

    def _wf_clone_from_type(self):
        from services import workflow_service as _wf
        try:
            from services import contract_type_service as _cts
            target = self._wf_current_scope()
            types = [t["name"] for t in _cts.list_types(active_only=True)
                     if t["name"] != target]
        except Exception:
            types = []
            target = ""
        if not target:
            style.info(self, "اختر نوع العقد/النموذج الهدف أولًا.")
            return
        if not types:
            style.info(self, "لا يوجد نوع آخر يمكن النسخ منه.")
            return
        source, ok = QInputDialog.getItem(
            self, "نسخ شجرة مراحل", f"انسخ شجرة مراحل ودفعات إلى «{target}» من:",
            types, 0, False)
        if not ok or not source:
            return
        if not style.confirm(
                self,
                f"سيتم نسخ شجرة مراحل ودفعات «{source}» إلى «{target}».\n\n"
                "النسخ مسموح فقط إذا كان النوع الهدف فارغًا حتى لا تختلط الأشجار. متابعة؟",
                "تأكيد نسخ الشجرة"):
            return
        try:
            res = _wf.copy_contract_type_template(source, target)
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
            return
        self._wf_reload()
        style.success(self,
                      f"تم نسخ {res['stages']} مرحلة و {res['payments']} دفعة "
                      f"من «{source}» إلى «{target}».")

    def _wf_reload(self):
        """عرض شجري: رئيسية بخط عريض وفرعية بتحوّط تحتها."""
        from PySide6.QtWidgets import QTableWidgetItem as _QTi
        from PySide6.QtGui import QFont
        from services import workflow_service as _wf
        from ui.widgets import sync_header_alignment
        tx = self._wf_current_type()
        scope = self._wf_current_scope()
        if tx == _wf.TX_CONTRACT:
            self._wf_refresh_tree_list(select=scope)
            scope = self._wf_current_scope()
        tree = _wf.stage_tree(tx, scope)
        rows: list[dict] = []          # صفوف العرض: [{stage, level}]
        for m in tree:
            rows.append({"stage": m, "level": 0})
            for sub in m["children"]:
                rows.append({"stage": sub, "level": 1})
        self._wf_rows = rows
        self.wf_table.setRowCount(len(rows))
        bold = QFont()
        bold.setBold(True)
        # الأداء: كان يُنفَّذ استعلام واتصال مستقل لكل صف مرحلة.
        # الآن تُجلب عدادات الاستخدام دفعة واحدة قبل الحلقة.
        try:
            _usage = _wf.stage_usage_map()
        except Exception:
            _usage = {}
        for r, item_row in enumerate(rows):
            st = item_row["stage"]
            used = _usage.get(int(st["id"]), 0)
            name = st["stage_name"]
            if item_row["level"] == 1:
                name = "      └ " + name
            locked = int(st.get("is_pre_contract") or 0)
            if locked:
                name += "  🔒"
            sup = int(st.get("is_supervision") or 0)
            if sup:
                name += "  👁"
            cells = [str(r + 1), name,
                     str(st.get("expected_days") or 0) or "—",
                     "", str(used)]
            for col, text in enumerate(cells):
                item = _QTi(text)
                item.setTextAlignment(Qt.AlignCenter)
                if col == 1:
                    item.setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
                    if item_row["level"] == 0:
                        item.setFont(bold)
                    _tips = []
                    if locked:
                        _tips.append("مرحلة نظام مقفولة — لا تُحذف")
                    if sup:
                        _tips.append("مرحلة إشرافية 👁 — ترثها العقود الجديدة")
                    if _tips:
                        item.setToolTip(" · ".join(_tips))
                if col == 2 and item_row["level"] == 0 and st["children"]:
                    item.setText("—")
                if col == 3:
                    from PySide6.QtGui import QColor
                    item.setText("●")
                    item.setForeground(QColor(st["color"]))
                self.wf_table.setItem(r, col, item)
        sync_header_alignment(self.wf_table)
        n_steps = len(_wf.stage_path(tx, scope))
        if not rows and scope:
            state_txt = (f"نوع العقد «{scope}» له شجرة فارغة. "
                         "عقود هذا النوع لن تأخذ مراحل حتى تضيف مراحل أو تستعيد الافتراضية.")
        elif not scope:
            state_txt = ("لا توجد أنواع عقود — أنشئ نوعًا من تبويب «أنواع العقود» "
                         "ثم اضغط «شجرة جديدة / ربط نوع عقد» هنا.")
        else:
            state_txt = (
                f"نوع العقد «{scope}»: {len(tree)} رئيسية · {n_steps} خطوة تنفيذ · "
                "أي عقد جديد من هذا النوع سينسخ هذه الشجرة فقط.")
        self.wf_state.setText(state_txt if rows or scope else
                              "لا مراحل لهذا النوع · اضغط «شجرة جديدة / ربط نوع عقد» أو أضف مرحلة.")
        # الأزرار الشجرية تظهر لأنواع الشجرة فقط
        is_tree = self._wf_is_tree_type()
        self.wf_add_main.setVisible(is_tree)
        self.wf_add_sub.setVisible(is_tree)
        if not is_tree:
            self.wf_add_main.setText("إضافة مرحلة")
        else:
            self.wf_add_main.setText("إضافة رئيسية")

    def _wf_selected(self):
        rows = getattr(self, "_wf_rows", [])
        row = self.wf_table.currentRow()
        if row < 0 or row >= len(rows):
            return None
        return rows[row]["stage"]

    def _wf_add(self, main: bool = True):
        from services import workflow_service as _wf
        name = self.wf_name.text().strip()
        if not name:
            style.info(self, "اكتب اسم المرحلة أولاً.")
            return
        tx = self._wf_current_type()
        parent_id = None
        if self._wf_is_tree_type():
            if not main:
                sel = self._wf_selected()
                if not sel or sel.get("parent_id"):
                    style.info(self, "حدد مرحلة **رئيسية** في الجدول "
                                     "أولاً ثم أضف الفرعية تحتها.")
                    return
                parent_id = sel["id"]
        else:
            main = False          # الأنواع المسطحة: مرحلة عادية
        try:
            _wf.add_stage(tx, name, _wf.stage_color(self.wf_color.currentData()),
                          parent_id=parent_id,
                          expected_days=self.wf_days.value(),
                          contract_type=self._wf_current_scope(),
                          payment_pct=0.0, pay_kind="")
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
            return
        self.wf_name.clear()
        self.wf_days.setValue(0)
        self._wf_reload()
        style.toast(self, "تمت إضافة المرحلة — محفوظة فورًا")

    def _wf_edit(self):
        from PySide6.QtWidgets import (QDialog as _QDlg, QFormLayout as _QForm,
                                       QDialogButtonBox as _QBB,
                                       QCheckBox as _QChk,
                                       QDoubleSpinBox as _QDS)
        from ui.widgets import SafeSpinBox as _QSpin
        from services import workflow_service as _wf
        st = self._wf_selected()
        if not st:
            style.info(self, "اختر مرحلة من الجدول أولاً.")
            return
        dlg = _QDlg(self)
        dlg.setWindowTitle("تعديل المرحلة")
        dlg.setLayoutDirection(Qt.RightToLeft)
        form = _QForm(dlg)
        name = QLineEdit(st["stage_name"])
        days = _QSpin()
        days.setRange(0, 999)
        days.setValue(int(st.get("expected_days") or 0))
        form.addRow("اسم المرحلة:", name)
        form.addRow("الأيام المتوقعة:", days)
        # V3.23: الطابع الإشرافي في القالب (لمراحل العقود فقط)
        sup_flag = sup_m = None
        if self._wf_current_type() == _wf.TX_CONTRACT:
            sup_flag = _QChk("مرحلة إشرافية 👁 — ترثها العقود الجديدة")
            sup_flag.setChecked(bool(st.get("is_supervision")))
            sup_m = _QDS()
            sup_m.setRange(0, 10000000)
            sup_m.setDecimals(3)
            sup_m.setSuffix(" د.ك/شهر")
            sup_m.setValue(float(st.get("sup_monthly") or 0))
            sup_m.setEnabled(sup_flag.isChecked())
            sup_flag.toggled.connect(sup_m.setEnabled)
            form.addRow(sup_flag)
            form.addRow("قيمة الشهر الافتراضية:", sup_m)
        # V3.30: وسم المرحلة بمكوّن الشامل (للعقود الشاملة فقط)
        comp_box = None
        if self._wf_current_type() == _wf.TX_CONTRACT:
            try:
                from services import contract_type_service as _cts_b
                _scope = self._wf_current_scope()
                if _cts_b.type_config(_scope).get("is_bundle"):
                    from PySide6.QtWidgets import QComboBox as _QCBc
                    comp_box = _QCBc()
                    comp_box.addItem("أساسية — تُبنى دائمًا", "")
                    for _c in _cts_b.list_bundle_components(_scope):
                        comp_box.addItem(_c["label"], _c["comp_key"])
                    _ci = comp_box.findData(
                        (st.get("component_key") or "").strip())
                    comp_box.setCurrentIndex(_ci if _ci >= 0 else 0)
                    comp_box.setToolTip("مرحلة المكوّن المطفأ لا تُبنى في "
                                        "مسار العقد")
                    form.addRow("مكوّن الشامل:", comp_box)
            except Exception:
                comp_box = None
        if int(st.get("is_pre_contract") or 0):
            note = QLabel("مرحلة نظام مقفولة — يمكن تعديل اسمها ومدتها "
                          "ولا يمكن حذفها.")
            note.setProperty("hint", True)
            note.setWordWrap(True)
            form.addRow(note)
        bb = _QBB(_QBB.Save | _QBB.Cancel)
        bb.button(_QBB.Save).setText("حفظ")
        bb.button(_QBB.Cancel).setText("إلغاء")
        bb.accepted.connect(dlg.accept)
        bb.rejected.connect(dlg.reject)
        form.addRow(bb)
        if dlg.exec() != _QDlg.Accepted or not name.text().strip():
            return
        try:
            _wf.update_stage(st["id"], stage_name=name.text().strip(),
                             expected_days=days.value(),
                             is_supervision=(sup_flag.isChecked()
                                             if sup_flag is not None else None),
                             sup_monthly=(sup_m.value()
                                          if sup_m is not None else None),
                             component_key=(comp_box.currentData()
                                            if comp_box is not None else None))
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
            return
        self._wf_reload()
        style.toast(self, "تم تعديل المرحلة")

    def _wf_sup_sync(self):
        """V3.24: تطبيق الطابع الإشرافي للقالب على العقود القائمة."""
        from PySide6.QtWidgets import (QDialog as _QDlg,
                                       QVBoxLayout as _QV, QLabel as _QLbl,
                                       QListWidget as _QLw,
                                       QHBoxLayout as _QH,
                                       QPushButton as _QPB)
        from services import workflow_service as _wf
        if self._wf_current_type() != _wf.TX_CONTRACT:
            style.info(self, "التطبيق الإشرافي لمراحل العقود فقط.")
            return
        scope = self._wf_current_scope()
        try:
            prev = _wf.preview_supervision_sync(scope)
        except Exception as exc:
            style.error(self, str(exc))
            return
        if not prev["template_count"]:
            style.info(self, "قالب هذا النوع بلا مراحل إشرافية — "
                             "علّمها أولًا من تعديل المرحلة.")
            return
        if not prev["contracts_count"]:
            style.info(self,
                       f"لا عقود تحتاج التطبيق "
                       f"(موسومة مسبقًا: {prev['already']} مرحلة).")
            return
        dlg = _QDlg(self)
        dlg.setWindowTitle("تطبيق الطابع الإشرافي على العقود القائمة")
        dlg.setLayoutDirection(Qt.RightToLeft)
        dlg.setMinimumWidth(480)
        lay = _QV(dlg)
        summ = _QLbl(
            f"النوع «{scope}» · "
            f"{prev['template_count']} مراحل إشرافية في القالب\n"
            f"سيُوسم {prev['matched']} مرحلة في "
            f"{prev['contracts_count']} عقدًا "
            f"(موسومة مسبقًا: {prev['already']} · "
            f"ملغاة متخطاة: {prev['skipped_cancelled']})\n"
            "لا يُمسّ أي تقدم أو تواريخ — إضافة فقط.")
        summ.setWordWrap(True)
        lay.addWidget(summ)
        lst = _QLw()
        for c in prev["contracts"]:
            lst.addItem(f"{c['contract_number']} — "
                        f"{', '.join(c['stages'])}")
        lay.addWidget(lst)
        row = _QH()
        lay.addLayout(row)
        ok = _QPB(f"👁 تطبيق على {prev['contracts_count']} عقدًا")
        ok.setObjectName("btnPrimary")
        ok.clicked.connect(dlg.accept)
        row.addWidget(ok)
        no = _QPB("✕ إلغاء")
        no.clicked.connect(dlg.reject)
        row.addWidget(no)
        if dlg.exec() != _QDlg.Accepted:
            return
        try:
            rep = _wf.apply_supervision_sync(scope)
        except Exception as exc:
            style.error(self, str(exc))
            return
        style.toast(self, f"تم: {rep['stages']} مرحلة في "
                          f"{rep['contracts']} عقدًا")

    def _wf_move(self, delta: int):
        """تحريك مرحلة: الرئيسية تنتقل بفروعها معًا، والفرعية بين
        أخواتها — ثم يُعاد ترقيم المسار كله."""
        from services import workflow_service as _wf
        rows = getattr(self, "_wf_rows", [])
        row = self.wf_table.currentRow()
        if row < 0 or row >= len(rows):
            style.info(self, "اختر مرحلة من الجدول أولاً.")
            return
        tx = self._wf_current_type()
        st = rows[row]["stage"]
        # كتل العرض: [رئيسية + أبناؤها] بترتيبها
        blocks: list[list[dict]] = []
        for item in rows:
            if item["level"] == 0:
                blocks.append([item["stage"]])
            else:
                blocks[-1].append(item["stage"])
        if st.get("parent_id"):
            # فرعية: بدّلها مع أختها المجاورة داخل الكتلة
            for blk in blocks:
                ids = [s["id"] for s in blk]
                if st["id"] in ids:
                    i = ids.index(st["id"])
                    j = i + delta
                    if j < 1 or j >= len(blk):
                        return          # أول/آخر فرعية — لا حركة
                    blk[i], blk[j] = blk[j], blk[i]
                    break
        else:
            # رئيسية: بدّل الكتلة كلها مع الكتلة المجاورة
            bi = next(i for i, blk in enumerate(blocks)
                      if blk[0]["id"] == st["id"])
            bj = bi + delta
            if bj < 0 or bj >= len(blocks):
                return
            blocks[bi], blocks[bj] = blocks[bj], blocks[bi]
        ordered = [s["id"] for blk in blocks for s in blk]
        _wf.reorder_stages(tx, ordered)
        self._wf_reload()
        # أعد تحديد المرحلة نفسها
        for r, item in enumerate(getattr(self, "_wf_rows", [])):
            if item["stage"]["id"] == st["id"]:
                self.wf_table.setCurrentCell(r, 0)
                break

    def _wf_delete(self):
        from services import workflow_service as _wf
        st = self._wf_selected()
        if not st:
            style.info(self, "اختر مرحلة من الجدول أولاً.")
            return
        if not style.confirm(
                self, f"حذف مرحلة «{st['stage_name']}» نهائيًا؟"):
            return
        try:
            _wf.delete_stage(st["id"])
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
            return
        self._wf_reload()
        style.toast(self, "تم حذف المرحلة")

    def _wf_restore(self):
        from services import workflow_service as _wf
        tx = self._wf_current_type()
        scope = self._wf_current_scope()
        if tx == _wf.TX_CONTRACT:
            if not scope:
                style.info(self, "اختر نوع العقد/النموذج أولًا.")
                return
            if _wf.get_stages(tx, scope):
                style.info(self, "هذا النوع له مراحل بالفعل · احذفها أولاً "
                                 "إن أردت استعادة الافتراضية.")
                return
            added = _wf.restore_default_for_type(scope)
        else:
            if _wf.get_stages(tx):
                style.info(self, "هذا النوع له مراحل بالفعل · احذفها أولاً "
                                 "إن أردت استعادة الافتراضية.")
                return
            added = _wf.restore_default_stages(tx)
        self._wf_reload()
        style.toast(self, f"استُعيدت {added} مرحلة")

    def _tab_visits(self) -> QWidget:
        """جدول الزيارات: ساعات العمل + الموظفون (المهندسون)
        وهواتفهم لرسائل التذكير."""
        from PySide6.QtWidgets import (QComboBox as _QCb,
                                       QTableWidget as _QTw,
                                       QTableWidgetItem as _QTi,
                                       QHeaderView as _QHv,
                                       QDialog as _QDlg,
                                       QFormLayout as _QForm,
                                       QDialogButtonBox as _QBB,
                                       QSpinBox as _QSpin)
        from services import visits_service as _vs
        page = QWidget()
        outer = QVBoxLayout(page)
        outer.setContentsMargins(0, 12, 0, 0)
        outer.setSpacing(12)

        # ---- ساعات العمل ----
        h_card, h_layout = _card()
        h_title = QLabel("ساعات عمل جدول الزيارات")
        h_title.setProperty("sectionTitle", True)
        h_layout.addWidget(h_title)
        h_hint = QLabel(
            "صفوف الجدول تُبنى من هذه الساعات — ومدة الحصة تحدد دقة "
            "المواعيد (30 دقيقة = نصف ساعة لكل خانة).")
        h_hint.setProperty("hint", True)
        h_hint.setWordWrap(True)
        h_layout.addWidget(h_hint)
        cfg = _vs.hours_config()
        h_row_host, h_row = _flow(spacing=10)
        self.vis_start = _QSpin()
        self.vis_start.setRange(0, 23)
        self.vis_start.setValue(cfg["start"])
        self.vis_end = _QSpin()
        self.vis_end.setRange(1, 24)
        self.vis_end.setValue(cfg["end"])
        self.vis_slot = _QCb()
        make_searchable(self.vis_slot, "")
        for m, lab in ((15, "15 دقيقة"), (20, "20 دقيقة"),
                       (30, "30 دقيقة"), (60, "ساعة"),
                       (90, "90 دقيقة"), (120, "ساعتان")):
            self.vis_slot.addItem(lab, m)
        idx = self.vis_slot.findData(cfg["slot"])
        if idx >= 0:
            self.vis_slot.setCurrentIndex(idx)
        h_row.addWidget(QLabel("من الساعة:"))
        h_row.addWidget(self.vis_start)
        h_row.addWidget(QLabel("إلى الساعة:"))
        h_row.addWidget(self.vis_end)
        h_row.addWidget(QLabel("مدة الحصة:"))
        h_row.addWidget(self.vis_slot)
        h_save = QPushButton("💾 حفظ الساعات")
        h_save.setObjectName("btnPrimary")
        h_save.clicked.connect(self._save_visits_hours)
        h_row.addWidget(h_save)
        h_layout.addWidget(h_row_host)
        outer.addWidget(h_card)

        # ---- الموظفون ----
        s_card, s_layout = _card()
        s_title = QLabel("الموظفون (أعمدة الجدول)")
        s_title.setProperty("sectionTitle", True)
        s_layout.addWidget(s_title)
        s_hint = QLabel(
            "أضف موظفي الزيارات وأرقام واتسابهم.")
        s_hint.setProperty("hint", True)
        s_hint.setWordWrap(True)
        s_layout.addWidget(s_hint)

        self.vis_table = _QTw(0, 3)
        self.vis_table.setHorizontalHeaderLabels(
            ["الموظف", "الهاتف", "زيارات مسجلة"])
        self.vis_table.verticalHeader().setVisible(False)
        self.vis_table.setSelectionBehavior(_QTw.SelectRows)
        self.vis_table.setEditTriggers(_QTw.NoEditTriggers)
        self.vis_table.horizontalHeader().setSectionResizeMode(
            0, _QHv.Stretch)
        self.vis_table.setMinimumHeight(180)
        from ui.widgets import sync_header_alignment, attach_row_menu
        self.vis_table.doubleClicked.connect(lambda *_: self._edit_visit_staff())
        attach_row_menu(self.vis_table, lambda: [
            ("تعديل الموظف", self._edit_visit_staff),
            None,
            ("حذف/تعطيل الموظف", self._del_visit_staff, True),
        ])
        s_layout.addWidget(self.vis_table)
        sync_header_alignment(self.vis_table)

        add_host, add_row = _flow(spacing=8)
        self.vis_name = QLineEdit()
        self.vis_name.setPlaceholderText("اسم المهندس/الموظف...")
        add_row.addWidget(QLabel("موظف جديد:"))
        add_row.addWidget(self.vis_name)
        self.vis_phone = QLineEdit()
        self.vis_phone.setPlaceholderText("الهاتف (99887766)")
        add_row.addWidget(self.vis_phone)
        add_btn = QPushButton("＋ إضافة موظف")
        add_btn.setObjectName("btnPrimary")
        add_btn.clicked.connect(self._add_visit_staff)
        add_row.addWidget(add_btn)
        s_layout.addWidget(add_host)
        outer.addWidget(s_card)
        outer.addStretch()
        self._reload_visit_staff()
        return page

    def _reload_visit_staff(self):
        from PySide6.QtWidgets import QTableWidgetItem as _QTi
        from services import visits_service as _vs
        staff = _vs.list_staff(active_only=False)
        self.vis_table.setRowCount(len(staff))
        for r, s in enumerate(staff):
            name = s["name"] + ("" if s["active"] else "  (معطّل)")
            cells = [name, s["phone"] or "—",
                     str(_vs.staff_usage(s["id"]))]
            for col, txt in enumerate(cells):
                item = _QTi(txt)
                item.setTextAlignment(Qt.AlignCenter)
                if col == 0:
                    item.setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
                self.vis_table.setItem(r, col, item)

    def _save_visits_hours(self):
        from services import visits_service as _vs
        try:
            _vs.save_hours_config(self.vis_start.value(),
                                  self.vis_end.value(),
                                  self.vis_slot.currentData())
        except Exception as exc:
            style.error(self, str(exc))
            return
        style.toast(self, "تم حفظ ساعات عمل جدول الزيارات")

    def _add_visit_staff(self):
        from services import visits_service as _vs
        try:
            _vs.add_staff(self.vis_name.text(), self.vis_phone.text())
        except Exception as exc:
            style.error(self, str(exc))
            return
        self.vis_name.clear()
        self.vis_phone.clear()
        self._reload_visit_staff()
        style.toast(self, "تمت إضافة الموظف")

    def _edit_visit_staff(self):
        from PySide6.QtWidgets import (QDialog as _QDlg, QFormLayout as _QForm,
                                       QDialogButtonBox as _QBB)
        from services import visits_service as _vs
        row = self.vis_table.currentRow()
        staff = _vs.list_staff(active_only=False)
        if row < 0 or row >= len(staff):
            style.info(self, "اختر موظفًا من الجدول أولًا.")
            return
        st = staff[row]
        dlg = _QDlg(self)
        dlg.setWindowTitle("تعديل موظف")
        dlg.setLayoutDirection(Qt.RightToLeft)
        form = _QForm(dlg)
        name = QLineEdit(st["name"])
        phone = QLineEdit(st["phone"] or "")
        form.addRow("الاسم:", name)
        form.addRow("الهاتف:", phone)
        bb = _QBB(_QBB.Save | _QBB.Cancel)
        bb.button(_QBB.Save).setText("حفظ")
        bb.button(_QBB.Cancel).setText("إلغاء")
        bb.accepted.connect(dlg.accept)
        bb.rejected.connect(dlg.reject)
        form.addRow(bb)
        if dlg.exec() != _QDlg.Accepted:
            return
        try:
            _vs.update_staff(st["id"], name.text(), phone.text())
        except Exception as exc:
            style.error(self, str(exc))
            return
        self._reload_visit_staff()
        style.toast(self, "تم تعديل الموظف")

    def _del_visit_staff(self):
        from services import visits_service as _vs
        row = self.vis_table.currentRow()
        staff = _vs.list_staff(active_only=False)
        if row < 0 or row >= len(staff):
            style.info(self, "اختر موظفًا من الجدول أولًا.")
            return
        st = staff[row]
        extra = ("\nله زيارات مسجلة — سيُعطَّل ويبقى في السجل."
                 if _vs.staff_usage(st["id"]) else "")
        if not style.confirm(self, f"حذف «{st['name']}» من جدول "
                                    f"الزيارات؟{extra}"):
            return
        _vs.delete_staff(st["id"])
        self._reload_visit_staff()
        style.toast(self, "تم")

    def _tab_backup(self) -> QWidget:
        page = QWidget()
        outer = QVBoxLayout(page)
        outer.setContentsMargins(0, 12, 0, 0)
        outer.setSpacing(14)

        auto_card, auto_layout = _card()
        section = QLabel("النسخ الاحتياطي التلقائي")
        section.setProperty("sectionTitle", True)
        auto_layout.addWidget(section)

        auto_row_host, auto_row = _flow(spacing=8)
        self.auto_enabled = QCheckBox("تفعيل النسخ التلقائي كل")
        self.auto_interval = SafeSpinBox()
        self.auto_interval.setRange(1, 168)
        self.auto_interval.setValue(24)
        self.auto_interval.setFixedWidth(90)
        auto_row.addWidget(self.auto_enabled)
        auto_row.addWidget(self.auto_interval)
        auto_row.addWidget(QLabel("ساعة"))
        backup_now_auto = QPushButton("إنشاء نسخة تلقائية الآن")
        backup_now_auto.setProperty("flat", True)
        backup_now_auto.setToolTip(
            "نسخة فورية داخل مجلد النسخ التلقائي المحدد بالأسفل")
        backup_now_auto.clicked.connect(self._auto_backup_now)
        auto_row.addWidget(backup_now_auto)
        auto_layout.addWidget(auto_row_host)

        self.last_backup_lbl = QLabel("")
        self.last_backup_lbl.setProperty("hint", True)
        auto_layout.addWidget(self.last_backup_lbl)

        folder_row_host, folder_row = _flow(spacing=8)
        folder_row.addWidget(QLabel("مجلد النسخ:"))
        self.backup_folder = QLineEdit()
        self.backup_folder.setPlaceholderText("(افتراضي: data/backups بجوار البرنامج)")
        pick_folder = QPushButton("استعراض...")
        pick_folder.setProperty("flat", True)
        pick_folder.clicked.connect(self._pick_backup_folder)
        folder_row.addWidget(self.backup_folder)
        folder_row.addWidget(pick_folder)
        auto_layout.addWidget(folder_row_host)

        alert_row_host, alert_row = _flow(spacing=8)
        alert_row.addWidget(QLabel("تنبيهات انتهاء العقود قبل (أيام):"))
        self.expiry_alerts = QLineEdit()
        self.expiry_alerts.setPlaceholderText("90,60,30,7")
        self.expiry_alerts.setFixedWidth(160)
        alert_hint = QLabel("افصل بين الأيام بفاصلة")
        alert_hint.setProperty("hint", True)
        alert_row.addWidget(self.expiry_alerts)
        alert_row.addWidget(alert_hint)
        auto_layout.addWidget(alert_row_host)

        coll_row_host, coll_row = _flow(spacing=8)
        coll_row.addWidget(QLabel("تنبيه تحصيل متأخر بعد:"))
        self.collection_days = SafeSpinBox()
        self.collection_days.setRange(7, 365)
        self.collection_days.setValue(30)
        self.collection_days.setSuffix(" يوم")
        self.collection_days.setFixedWidth(110)
        coll_hint = QLabel("بلا سند قبض على عقد عليه متبقٍ")
        coll_hint.setProperty("hint", True)
        coll_row.addWidget(self.collection_days)
        coll_row.addWidget(coll_hint)
        auto_layout.addWidget(coll_row_host)

        auto_layout.addWidget(self._save_row())
        outer.addWidget(auto_card)

        import_card, import_layout = _card()
        import_title = QLabel("استيراد البيانات القديمة (Excel)")
        import_title.setProperty("sectionTitle", True)
        import_layout.addWidget(import_title)
        import_hint = QLabel(
            "استيراد البيانات القديمة من قالب Excel بعد فحصه.")
        import_hint.setProperty("hint", True)
        # V4.5.13: نفس المفتاح في تاب النسخ/الصيانة
        from services import feature_service as _feat13j
        if not _feat13j.enabled("import_old"):
            import_card.setVisible(False)
        import_hint.setWordWrap(True)
        import_layout.addWidget(import_hint)
        import_row_host, import_row = _flow(spacing=8)
        import_btn = QPushButton("📥 فتح معالج الاستيراد")
        import_btn.clicked.connect(self._open_import_wizard)
        import_row.addWidget(import_btn)
        import_layout.addWidget(import_row_host)
        outer.addWidget(import_card)

        manual_card, manual_layout = _card()
        section2 = QLabel("النسخ اليدوي والاستعادة")
        section2.setProperty("sectionTitle", True)
        manual_layout.addWidget(section2)
        hint = QLabel("أدوات قاعدة البيانات فقط؛ لا تشمل ملفات الأرشيف أو المرفقات.")
        hint.setProperty("hint", True)
        manual_layout.addWidget(hint)

        manual_row_host, manual_row = _flow(spacing=8)
        backup_btn = QPushButton("نسخ قاعدة البيانات إلى ملف...")
        backup_btn.setToolTip(
            "يحفظ ملف SQLite لقاعدة البيانات فقط · لا يشمل ملفات الأرشيف أو المرفقات")
        restore_btn = QPushButton("استعادة قاعدة بيانات من ملف...")
        restore_btn.setToolTip(
            "استعادة ملف SQLite فقط. للاستعادة الشاملة استخدم جدول النسخ الكاملة بالأعلى.")
        restore_btn.setProperty("danger", True)
        backup_btn.clicked.connect(self._backup)
        restore_btn.clicked.connect(self._restore)
        manual_row.addWidget(backup_btn)
        manual_row.addWidget(restore_btn)
        manual_layout.addWidget(manual_row_host)
        outer.addWidget(manual_card)

        outer.addStretch()
        return page

    def _clear_network_folder(self):
        """حذف مسار قاعدة البيانات المشتركة والعودة للمحلي على هذا الجهاز فقط."""
        current = (self.network_folder.text() or "").strip()
        if not style.confirm(
                self,
                "حذف مسار قاعدة البيانات المشتركة من هذا الجهاز؟\n\n"
                + (f"المسار الحالي:\n{current}\n\n" if current else "")
                + "لن يتم حذف أي ملف من مجلد الشبكة، سيتم فقط إلغاء الربط والرجوع للقاعدة المحلية.",
                "حذف مسار الشبكة"):
            return
        try:
            from services.network_single_db_service import disable_shared_database
            disable_shared_database()
            self.network_folder.clear()
        except Exception as exc:
            style.error(self, f"تعذر حذف مسار الشبكة:\n{exc}")
            return
        style.info(self, "تم حذف مسار الشبكة من هذا الجهاز.\nالأفضل إعادة تشغيل البرنامج.", "وضع الشبكة")

    def _pick_network_folder(self):
        folder = QFileDialog.getExistingDirectory(
            self, "اختر المجلد المشترك على الشبكة")
        if folder:
            self.network_folder.setText(folder)

    def _apply_network_folder(self):
        import os as _os
        from services.db_facade_service import network_mode
        from services.network_single_db_service import (configure_shared_database,
                                                        disable_shared_database,
                                                        health_check)
        folder = self.network_folder.text().strip()
        if folder:
            check = health_check(folder)
            if not check.get("ok"):
                details = "\n".join(
                    f"- {c.get('name')}: {'OK' if c.get('ok') else 'FAIL'} {c.get('message') or ''}"
                    for c in check.get("checks", []))
                style.error(
                    self,
                    "لا يمكن استخدام مجلد الشبكة المحدد.\n\n"
                    f"المسار: {folder}\n\n{details}\n\n"
                    "لو الاختبار على نفس الجهاز فقط استخدم القاعدة المحلية ولا تفعل وضع الشبكة.\n"
                    "ولو شبكة حقيقية استخدم مسار UNC مثل:\n\\\\SERVER\\ConTrackData\n"
                    "أو على جهاز المضيف نفسه مسارًا محليًا مثل C:\\ConTrackData\n"
                    "وتأكد من صلاحيات Modify/Read/Write/Delete.")
                return
            if len(folder) >= 2 and folder[1] == ":":
                if not style.confirm(
                        self,
                        "كتبت مسارًا محليًا:\n"
                        f"{folder}\n\n"
                        "المسار المحلي يعمل فقط إذا كان هذا الجهاز هو المُضيف —\n"
                        "أي الجهاز الذي عليه المجلد المشترك لباقي الأجهزة.\n\n"
                        "هل هذا الجهاز هو المُضيف؟\n"
                        "(لو جهاز فرعي: ألغِ واستخدم عنوان الشبكة \\\\HOST\\...)",
                        "تأكيد جهاز المضيف"):
                    return
            if not style.confirm(
                    self,
                    "سيتم تفعيل قاعدة بيانات مشتركة في هذا المجلد:\n"
                    f"{folder}\n\n"
                    "تأكد أن هذا مجلد بيانات مشترك وليس مجلد البرنامج نفسه.\n"
                    "البرنامج يفضل أن يكون مثبتًا محليًا على كل جهاز، والبيانات فقط مشتركة. متابعة؟",
                    "تفعيل قاعدة الشبكة"):
                return
            try:
                configure_shared_database(folder)
            except Exception as exc:
                style.error(
                    self,
                    "تعذر تفعيل قاعدة الشبكة وتم الرجوع تلقائيًا للمحلي.\n\n"
                    f"{exc}\n\n"
                    "شغل NETWORK_REPAIR.bat من مجلد البرنامج وأرسل التقرير إذا استمرت المشكلة.")
                return
            style.info(self,
                       "تم تفعيل وضع الشبكة.\n\n"
                       "يمكنك المتابعة الآن، والأفضل إعادة تشغيل البرنامج للتأكد من تحميل كل الخدمات من المسار الجديد.\n"
                       "كرر نفس الخطوة على كل جهاز باستخدام نفس المجلد المشترك.",
                       "وضع الشبكة")
        else:
            if network_mode() and not style.confirm(
                    self,
                    "إلغاء وضع الشبكة والعودة للقاعدة المحلية على هذا "
                    "الجهاز؟\n(بيانات المجلد المشترك تبقى كما هي)"):
                return
            try:
                disable_shared_database()
            except OSError:
                pass
            style.info(self, "تم إلغاء وضع الشبكة. الأفضل إعادة تشغيل البرنامج.",
                       "وضع الشبكة")

    def _save_row(self) -> QWidget:
        wrapper = QWidget()
        wrapper.setObjectName("transparentHost")
        wrapper._is_save_row = True
        row = QHBoxLayout(wrapper)
        row.setContentsMargins(0, 6, 0, 0)
        save_btn = QPushButton("💾 حفظ الإعدادات")
        save_btn.setObjectName("btnPrimary")
        save_btn.clicked.connect(self._save)
        row.addStretch()
        row.addWidget(save_btn)
        return wrapper

    def refresh(self):
        s = settings_service.get_settings()
        if hasattr(self, "name"):
            self.name.setText(s.company_name)
            self.address.setText(s.company_address)
            self.phone.setText(s.company_phone)
            self.email.setText(s.company_email)
            self.currency.setText(s.currency)
            self.manager_phone.setText(getattr(s, "manager_phone", "") or "")
            self.bank_fee.setValue(float(getattr(s, "bank_fee_amount", 0.150) or 0))
        if hasattr(self, "header_title"):
            self.header_title.setText(getattr(s, "header_title", "") or "نظام إدارة العقود والمحاسبة")
        if getattr(self, "feature_boxes", None):
            from services import feature_service as _feat
            for key, box in self.feature_boxes.items():
                box.blockSignals(True)
                box.setChecked(_feat.raw_enabled(key))
                box.blockSignals(False)
            self._features_changed()
        if hasattr(self, "opening_balance_bank"):
            legacy_opening = float(getattr(s, "opening_balance", 0) or 0)
            bank_opening = float(getattr(s, "opening_balance_bank", 0) or 0)
            cash_opening = float(getattr(s, "opening_balance_cash", 0) or 0)
            if not bank_opening and not cash_opening and legacy_opening:
                cash_opening = legacy_opening
            self.opening_balance_bank.setValue(bank_opening)
            self.opening_balance_cash.setValue(cash_opening)
            _ob_date = (getattr(s, "opening_balance_date", "") or "").strip()
            if _ob_date:
                self.opening_balance_date.setDate(
                    QDate.fromString(_ob_date, "yyyy-MM-dd"))
            else:
                self.opening_balance_date.setDate(
                    self.opening_balance_date.minimumDate())
        self._logo_path = s.logo_path
        if hasattr(self, "header_image"):
            self.header_image.setText(s.header_image)
            self.footer_image.setText(s.footer_image)
            self.signature_image.setText(
                getattr(s, "signature_image", "") or "")
        if hasattr(self, "stamp_image"):
            self.stamp_image.setText(getattr(s, "stamp_image", "") or "")
        if hasattr(self, "stamp_x_mm"):
            self.stamp_x_mm.setValue(float(getattr(s, "stamp_x_mm", 0) or 0))
            self.stamp_y_mm.setValue(float(getattr(s, "stamp_y_mm", 0) or 0))
            self.stamp_size_mm.setValue(float(getattr(s, "stamp_size_mm", 0) or 0))
        if hasattr(self, "logo_preview"):
            self._update_logo_preview()
        if hasattr(self, "auto_enabled"):
            self.auto_enabled.setChecked(s.auto_backup_enabled)
            self.auto_interval.setValue(s.auto_backup_interval or 24)
            self.backup_folder.setText(s.auto_backup_folder)
            self.last_backup_lbl.setText(
                f"آخر نسخة تلقائية: {backup_service.last_backup_info()}")
        if hasattr(self, "_refresh_users_table"):
            self._refresh_users_table()
        if hasattr(self, "user_lbl"):
            self.user_lbl.setText(f"المستخدم الحالي: {auth_service.current_username() or auth_service.get_username()}")
        if hasattr(self, "economy_check"):
            self.economy_check.setChecked(
                bool(getattr(s, "print_economy", False)))
        if hasattr(self, "fast_mode_check"):
            from services import prefs_service as _pf
            self.fast_mode_check.setChecked(
                str(_pf.get_pref("ui_shadows", "1")) == "0")
        if hasattr(self, "expiry_alerts"):
            from services import lifecycle_service as lc
            self.expiry_alerts.setText(
                ",".join(str(d) for d in lc.get_expiry_alert_days()))
            self.collection_days.setValue(lc.get_collection_alert_days())

    # ===== V5.9: بداية الاحتساب النقدي =====
    def _refresh_cash_start_lbl(self):
        cur = settings_service.get_settings()
        d = (getattr(cur, "cash_start_date", "") or "").strip()
        if d:
            self.cash_start_lbl.setText(
                f"<b>بداية الاحتساب النقدي: {d}</b> — الحركات الأقدم مستبعدة "
                "من رصيد البنك/الصندوق (وما زالت في القاعدة والتقارير الأخرى).")
            self.btn_cash_start.setEnabled(False)
            self.btn_cash_clear.setEnabled(True)
        else:
            self.cash_start_lbl.setText(
                "الاحتساب النقدي يبدأ من أول حركة. لو أدخلت حركات قديمة "
                "وتريد تصفير أثرها على البنك/الصندوق استخدم الزر:")
            self.btn_cash_start.setEnabled(True)
            self.btn_cash_clear.setEnabled(False)

    def _set_cash_start(self):
        if not style.confirm(
                self,
                "سيبدأ احتساب البنك والصندوق من 2026-10-01:\n\n"
                "· الحركات الأقدم لن تدخل الرصيد ولا الكشف النقدي ولا منع "
                "التحويل الداخلي.\n"
                "· السندات نفسها لا تُحذف ولا تُعدّل — تبقى في القاعدة "
                "وفي تقارير العملاء والعقود.\n"
                "· قابل للإلغاء في أي وقت من «✕ إلغاء الاستبعاد».",
                "بداية الاحتساب النقدي (مؤقت)"):
            return
        cur = settings_service.get_settings()
        cur.cash_start_date = "2026-10-01"
        settings_service.save_settings(cur)
        self._refresh_cash_start_lbl()
        style.toast(self, "تم — الاحتساب النقدي يبدأ من 2026-10-01 ✅")

    def _clear_cash_start(self):
        cur = settings_service.get_settings()
        if not (getattr(cur, "cash_start_date", "") or "").strip():
            return
        if not style.confirm(self, "إلغاء استبعاد الحركات القديمة ورجوع "
                                   "الاحتساب لكل الحركات؟", "إلغاء الاستبعاد"):
            return
        cur.cash_start_date = ""
        settings_service.save_settings(cur)
        self._refresh_cash_start_lbl()
        style.toast(self, "تم إلغاء الاستبعاد — رجع الاحتساب لكل الحركات")

    def _toggle_sub_gate(self, checked: bool):
        """V6.2: تفعيل/إيقاف بوابة تحصيل العميل على دفعات المقاولين."""
        from services import voucher_payment_link_service as _vpl62
        try:
            _vpl62.set_gate(bool(checked))
            style.toast(
                self,
                "تم — دفعات المقاولين تُستحق بعد تحصيل دفعة العميل ✅"
                if checked else
                "تم — كل الدفعات المستحقة متاحة للصرف على المقاولين ✅")
        except Exception as exc:            # noqa: BLE001
            style.error(self, f"تعذّر حفظ الإعداد: {exc}")

    def _save(self):
        cur = settings_service.get_settings()
        if hasattr(self, "fast_mode_check"):
            from services import prefs_service as _pf
            _pf.set_pref("ui_shadows",
                         "0" if self.fast_mode_check.isChecked() else "1")
        has_backup_tab = hasattr(self, "auto_enabled")
        s = Settings(
            company_name=(self.name.text() if hasattr(self, "name") else cur.company_name),
            company_address=(self.address.text() if hasattr(self, "address") else cur.company_address),
            company_phone=(self.phone.text() if hasattr(self, "phone") else cur.company_phone),
            company_email=(self.email.text() if hasattr(self, "email") else cur.company_email),
            logo_path=(self._logo_path if hasattr(self, "logo_preview") else cur.logo_path),
            header_title=(self.header_title.text() if hasattr(self, "header_title")
                          else getattr(cur, "header_title", "نظام إدارة العقود والمحاسبة")),
            currency=(self.currency.text().strip() if hasattr(self, "currency") else cur.currency) or "د.ك",
            invoice_primary=getattr(cur, "invoice_primary", None)
                                 or style.DOC_PRIMARY_DEFAULT,
            invoice_accent=getattr(cur, "invoice_accent", None)
                                or style.DOC_ACCENT_DEFAULT,
            auto_backup_enabled=(self.auto_enabled.isChecked()
                                 if has_backup_tab
                                 else cur.auto_backup_enabled),
            auto_backup_interval=(self.auto_interval.value()
                                  if has_backup_tab
                                  else cur.auto_backup_interval),
            auto_backup_folder=(self.backup_folder.text()
                                if has_backup_tab
                                else cur.auto_backup_folder),
            ui_theme=self._theme,
            header_image=(self.header_image.text()
                          if hasattr(self, "header_image")
                          else cur.header_image),
            footer_image=(self.footer_image.text()
                          if hasattr(self, "footer_image")
                          else cur.footer_image),
            print_economy=(self.economy_check.isChecked()
                           if hasattr(self, "economy_check")
                           else bool(getattr(cur, "print_economy", False))),
            signature_image=(self.signature_image.text()
                             if hasattr(self, "signature_image")
                             else getattr(cur, "signature_image", "")),
            stamp_image=(self.stamp_image.text()
                         if hasattr(self, "stamp_image")
                         else getattr(cur, "stamp_image", "")),
            stamp_x_mm=(self.stamp_x_mm.value()
                        if hasattr(self, "stamp_x_mm")
                        else float(getattr(cur, "stamp_x_mm", 0) or 0)),
            stamp_y_mm=(self.stamp_y_mm.value()
                        if hasattr(self, "stamp_y_mm")
                        else float(getattr(cur, "stamp_y_mm", 0) or 0)),
            stamp_size_mm=(self.stamp_size_mm.value()
                           if hasattr(self, "stamp_size_mm")
                           else float(getattr(cur, "stamp_size_mm", 0) or 0)),
            manager_phone=(self.manager_phone.text() if hasattr(self, "manager_phone")
                           else getattr(cur, "manager_phone", "")),
            bank_fee_amount=(self.bank_fee.value() if hasattr(self, "bank_fee")
                             else float(getattr(cur, "bank_fee_amount", 0.150) or 0)),
            opening_balance=((self.opening_balance_bank.value() + self.opening_balance_cash.value())
                             if hasattr(self, "opening_balance_bank")
                             else float(getattr(cur, "opening_balance", 0) or 0)),
            opening_balance_bank=(self.opening_balance_bank.value()
                                  if hasattr(self, "opening_balance_bank")
                                  else float(getattr(cur, "opening_balance_bank", 0) or 0)),
            opening_balance_cash=(self.opening_balance_cash.value()
                                  if hasattr(self, "opening_balance_cash")
                                  else float(getattr(cur, "opening_balance_cash", 0) or 0)),
            cash_start_date=getattr(cur, "cash_start_date", ""),
            opening_balance_date=(("" if self.opening_balance_date.date()
                                   == self.opening_balance_date.minimumDate()
                                   else self.opening_balance_date.date().toString("yyyy-MM-dd"))
                                  if hasattr(self, "opening_balance_date")
                                  else getattr(cur, "opening_balance_date", "")),
            app_name=getattr(cur, "app_name", "ConTrack"),
            max_users=int(getattr(cur, "max_users", 0) or 0),
            desc_prefix_receipt=getattr(cur, "desc_prefix_receipt", ""),
            desc_prefix_supervision=getattr(cur, "desc_prefix_supervision", ""),
            desc_prefix_transfer=getattr(cur, "desc_prefix_transfer", ""),
            desc_prefix_custody=getattr(cur, "desc_prefix_custody", ""),
            desc_prefix_stage_note=getattr(cur, "desc_prefix_stage_note", ""),
        )
        try:
            settings_service.save_settings(s)
            if hasattr(self, "expiry_alerts"):
                from services import lifecycle_service as lc
                lc.save_expiry_alert_days(self.expiry_alerts.text())
                lc.save_collection_alert_days(self.collection_days.value())
            style.info(self, "تم حفظ الإعدادات بنجاح.", "تم")
            self.settings_changed.emit()
        except DatabaseError as exc:
            style.error(self, str(exc))

    def _update_logo_preview(self):
        if self._logo_path and os.path.exists(self._logo_path):
            pix = QPixmap(self._logo_path)
            if not pix.isNull():
                self.logo_preview.setPixmap(
                    pix.scaled(80, 80, Qt.KeepAspectRatio, Qt.SmoothTransformation))
                return
            style.error(self, "ملف الشعار تالف أو غير مدعوم، تم تجاهله.")
            self._logo_path = ""
        self.logo_preview.setPixmap(QPixmap())
        self.logo_preview.setText("لا يوجد شعار")

    def _remove_white_background_image(self, src: str, dest: str, threshold: int = 242) -> str:
        """تحويل الخلفية البيضاء/القريبة من البيضاء إلى شفافة وحفظ PNG."""
        try:
            from PIL import Image
        except Exception as exc:
            raise OSError("ميزة إزالة الخلفية تحتاج مكتبة Pillow ضمن الحزمة.") from exc
        img = Image.open(src).convert("RGBA")
        data = []
        for r, g, b, a in img.getdata():
            if r >= threshold and g >= threshold and b >= threshold:
                data.append((255, 255, 255, 0))
            else:
                data.append((r, g, b, a))
        img.putdata(data)
        os.makedirs(os.path.dirname(dest) or ".", exist_ok=True)
        img.save(dest, "PNG")
        return dest

    def _ask_remove_white_background(self, label: str) -> bool:
        msg = QMessageBox(self)
        msg.setIcon(QMessageBox.Question)
        msg.setWindowTitle("إزالة الخلفية البيضاء")
        msg.setText(f"هل تريد إزالة الخلفية البيضاء من صورة {label}؟")
        msg.setInformativeText(
            "اختر نعم إذا كانت الصورة تحتوي على مساحة بيضاء وتريدها شفافة في الطباعة.\n"
            "سيتم حفظ نسخة PNG شفافة واستخدامها بدل الصورة الأصلية.")
        yes = msg.addButton("نعم، إزالة الخلفية", QMessageBox.YesRole)
        no = msg.addButton("لا، استخدمها كما هي", QMessageBox.NoRole)
        msg.setDefaultButton(no)
        msg.exec()
        return msg.clickedButton() is yes

    # ======================================================================
    # ✅ التصحيح الجذري هنا: تحديد البادئة بناءً على الحقل المستهدف بدقة
    # ======================================================================
    def _pick_print_image(self, target: QLineEdit):
        """اختيار صورة هيدر/فوتر/توقيع/ختم ونسخها إلى مجلد الأصول بأسماء فريدة."""
        path, _ = QFileDialog.getOpenFileName(
            self, "اختيار صورة", "", "صور (*.png *.jpg *.jpeg *.bmp)")
        if not path:
            return
        pix = QPixmap(path)
        if pix.isNull():
            style.error(self, "تعذر قراءة ملف الصورة.")
            return
        try:
            os.makedirs(LOGO_DIR, exist_ok=True)
            
            # ✅ التصحيح: تحديد البادئة بناءً على الحقل المستهدف بدقة لمنع الكتابة فوق الملفات
            if target is self.header_image:
                prefix = "header"
            elif target is self.footer_image:
                prefix = "footer"
            elif target is self.signature_image:
                prefix = "signature"
            elif target is self.stamp_image:
                prefix = "stamp"
            else:
                prefix = "print_image" # احتياطي لأي حقل آخر
                
            ext = os.path.splitext(path)[1].lower()
            label = "الهيدر" if prefix == "header" else "الفوتر" if prefix == "footer" else "الصورة"
            remove_bg = prefix in ("header", "footer") and self._ask_remove_white_background(label)
            if remove_bg:
                dest = os.path.join(LOGO_DIR, f"{prefix}_transparent.png")
                self._remove_white_background_image(path, dest)
            else:
                dest = os.path.join(LOGO_DIR, f"{prefix}{ext}")
                shutil.copy2(path, dest)
            target.setText(dest)
            style.toast(self, "تم حفظ الصورة" + (" بدون خلفية بيضاء" if remove_bg else ""))
            
        except OSError as e:
            style.error(self, f"تعذر حفظ الصورة: {e}")
            target.setText(path)

    def _pick_logo(self):
        path, _ = QFileDialog.getOpenFileName(
            self, "اختيار الشعار", "", "صور (*.png *.jpg *.jpeg *.bmp)")
        if not path:
            return
        pix = QPixmap(path)
        if pix.isNull():
            style.error(self, "تعذر قراءة ملف الصورة. اختر ملف صورة صالحًا.")
            return
        try:
            os.makedirs(LOGO_DIR, exist_ok=True)
            ext = os.path.splitext(path)[1].lower()
            dest = os.path.join(LOGO_DIR, f"logo{ext}")
            shutil.copy2(path, dest)
            self._logo_path = dest
        except OSError:
            self._logo_path = path
        self._update_logo_preview()

    def _clear_logo(self):
        self._logo_path = ""
        self._update_logo_preview()

    def _change_password(self):
        if ChangePasswordDialog(self).exec() == QDialog.Accepted:
            self.user_lbl.setText(f"المستخدم الحالي: {auth_service.get_username()}")

    def _open_import_wizard(self):
        from ui.import_wizard import ImportWizardDialog
        dlg = ImportWizardDialog(self)
        if dlg.exec() == QDialog.Accepted:
            self.settings_changed.emit()

    def _pick_backup_folder(self):
        folder = QFileDialog.getExistingDirectory(
            self, "اختيار مجلد النسخ التلقائي")
        if folder:
            self.backup_folder.setText(folder)

    def _auto_backup_now(self):
        path = backup_service.run_auto_backup(force=True)
        if path:
            self.last_backup_lbl.setText(
                f"آخر نسخة تلقائية: {backup_service.last_backup_info()}")
            style.info(self, f"تم إنشاء النسخة التلقائية:\n{path}", "تم")
        else:
            style.error(self, "تعذر إنشاء النسخة التلقائية.")

    def _backup(self):
        stamp = datetime.now().strftime("%Y-%m-%d_%H%M")
        default = os.path.join(os.path.expanduser("~"), f"backup_{stamp}.sqlite")
        path, _ = QFileDialog.getSaveFileName(
            self, "حفظ النسخة الاحتياطية", default, "SQLite (*.sqlite *.db)")
        if not path:
            return
        try:
            backup_db(path)
            style.info(self, f"تم إنشاء النسخة الاحتياطية بنجاح:\n{path}", "تم")
        except DatabaseError as exc:
            style.error(self, str(exc))

    def _restore(self):
        path, _ = QFileDialog.getOpenFileName(
            self, "اختيار النسخة الاحتياطية", "", "SQLite (*.sqlite *.db);;كل الملفات (*)")
        if not path:
            return
        if not style.confirm(
                self,
                "سيتم استبدال البيانات الحالية بالكامل بالنسخة الاحتياطية.\n"
                "سيتم حفظ نسخة أمان من البيانات الحالية تلقائيًا.\n\n"
                "هل أنت متأكد من المتابعة؟", "استعادة نسخة احتياطية"):
            return
        try:
            from services.db_facade_service import schedule_restore_db
            pending = schedule_restore_db(path)
            style.info(
                self,
                "تم تجهيز الاستعادة بأمان ولن يتم تنفيذها والبرنامج مفتوح حتى لا يحدث تهنيج.\n\n"
                "أغلق البرنامج وافتح RUN.bat مرة أخرى، وسيتم تطبيق النسخة قبل الدخول.\n\n"
                f"ملف أمر الاستعادة:\n{pending}",
                "استعادة مؤجلة")
        except DatabaseError as exc:
            style.error(self, str(exc))


class _BundleComponentsDialog(QDialog):
    """V3.30: مكوّنات النوع الشامل — نطاق اختياري بلا أثر على الإجمالي."""

    def __init__(self, parent, type_name: str):
        super().__init__(parent)
        self._type_name = type_name
        body = style.setup_dialog(
            self, f"مكوّنات «{type_name}»",
            "كل مكوّن: اسم ونوع وافتراضيات · المراحل تُوسم بالمكوّن من "
            "«تعديل المرحلة» · المكوّن المطفأ عند الإنشاء تُحذف مراحله "
            "من مسار العقد ولا يغيّر الإجمالي",
            "🧩", min_w=660, max_w=860)
        from services import contract_type_service as cts
        self._rows: list[dict] = []
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        host = QWidget()
        host.setObjectName("transparentHost")
        self._list = QVBoxLayout(host)
        self._list.setSpacing(8)
        scroll.setWidget(host)
        scroll.setMinimumHeight(220)
        body.addWidget(scroll)
        add_btn = QPushButton("＋ مكوّن")
        add_btn.setProperty("flat", True)
        add_btn.clicked.connect(lambda: self._add_row({}))
        body.addWidget(add_btn)
        for c in cts.list_bundle_components(type_name):
            self._add_row(c)
        if not self._rows:
            self._add_row({})
        style.dialog_buttons(self, "حفظ", on_save=self._on_save)

    def _add_row(self, c: dict):
        from services import contract_type_service as cts
        frame = QFrame()
        frame.setProperty("card", True)
        grid = QGridLayout(frame)
        grid.setSpacing(6)
        key = (c.get("comp_key") or "").strip()
        name = QLineEdit(c.get("label") or "")
        name.setPlaceholderText("اسم المكوّن (واجهات · إشراف · كهرباء)")
        name.setMinimumWidth(130)
        kind = QComboBox()
        for _k, _v in cts.BUNDLE_KINDS.items():
            kind.addItem(_v, _k)
        _i = kind.findData((c.get("kind") or "qty").strip())
        kind.setCurrentIndex(_i if _i >= 0 else 0)
        req = QCheckBox("إلزامي")
        req.setChecked(bool(c.get("required")))
        req.setToolTip("الإلزامي مفعّل دائمًا ولا يمكن إطفاؤه عند الإنشاء")
        on = QCheckBox("مفعّل افتراضيًا")
        on.setChecked(bool(c.get("default_enabled", 1)))
        qty = SafeSpinBox()
        qty.setRange(1, 9999)
        qty.setValue(int(float(c.get("default_qty") or 1)))
        qty.setPrefix("العدد: ")
        unit = QLineEdit((c.get("unit_label") or "").strip())
        unit.setPlaceholderText("الوحدة")
        unit.setMaximumWidth(80)
        ref = SafeDoubleSpinBox()
        ref.setDecimals(3)
        ref.setRange(0, 999_999_999)
        ref.setValue(float(c.get("ref_price") or 0))
        ref.setPrefix("مرجعي: ")
        ref.setToolTip("سعر مرجعي للطباعة والأوامر التغييرية — لا يدخل الإجمالي")
        months = SafeSpinBox()
        months.setRange(0, 120)
        months.setValue(int(c.get("default_months") or 0))
        months.setPrefix("الأشهر: ")
        monthly = SafeDoubleSpinBox()
        monthly.setDecimals(3)
        monthly.setRange(0, 999_999_999)
        monthly.setValue(float(c.get("default_monthly") or 0))
        monthly.setPrefix("الشهري: ")
        monthly.setToolTip("قيمة شهر التمديد — لا تُضاف للإجمالي")
        rm = QPushButton("✕")
        rm.setProperty("flat", True)
        rm.setMaximumWidth(34)
        grid.addWidget(QLabel("المكوّن:"), 0, 0)
        grid.addWidget(name, 0, 1)
        grid.addWidget(QLabel("النوع:"), 0, 2)
        grid.addWidget(kind, 0, 3)
        grid.addWidget(req, 0, 4)
        grid.addWidget(on, 0, 5)
        grid.addWidget(rm, 0, 6)
        grid.addWidget(QLabel("عدد/وحدة:"), 1, 0)
        grid.addWidget(qty, 1, 1)
        grid.addWidget(unit, 1, 2)
        grid.addWidget(ref, 1, 3)
        grid.addWidget(QLabel("إشراف:"), 1, 4)
        grid.addWidget(months, 1, 5)
        grid.addWidget(monthly, 1, 6)
        row = {"frame": frame, "key": key, "name": name, "kind": kind,
               "req": req, "on": on, "qty": qty, "unit": unit,
               "ref": ref, "months": months, "monthly": monthly}
        rm.clicked.connect(lambda: self._remove_row(row))

        def _sync(_v=None):
            _k = kind.currentData()
            _is_qty = _k == "qty"
            _is_sup = _k == "supervision"
            for w in (qty, unit, ref):
                w.setVisible(_is_qty)
            for w in (months, monthly):
                w.setVisible(_is_sup)
            grid.itemAtPosition(1, 0).widget().setVisible(_is_qty)
            grid.itemAtPosition(1, 4).widget().setVisible(_is_sup)

        kind.currentIndexChanged.connect(_sync)
        _sync()
        self._rows.append(row)
        self._list.addWidget(frame)

    def _remove_row(self, row: dict):
        self._rows = [r for r in self._rows if r is not row]
        row["frame"].setParent(None)
        row["frame"].deleteLater()

    def _on_save(self):
        from services import contract_type_service as cts
        comps = []
        for r in self._rows:
            comps.append({
                "comp_key": r["key"], "label": r["name"].text(),
                "kind": r["kind"].currentData(),
                "required": r["req"].isChecked(),
                "default_enabled": r["on"].isChecked(),
                "default_qty": r["qty"].value(),
                "unit_label": r["unit"].text(),
                "ref_price": r["ref"].value(),
                "default_months": r["months"].value(),
                "default_monthly": r["monthly"].value()})
        try:
            n = cts.save_bundle_components(self._type_name, comps)
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
            return
        style.toast(self, f"حُفظت {n} مكوّنات للنوع «{self._type_name}»")
        self.accept()


class _ContractTypeDialog(QDialog):
    """تعديل نوع عقد: الاسم والمبلغ الافتراضي والملاحظات."""

    def __init__(self, parent, t: dict):
        super().__init__(parent)
        body = style.setup_dialog(
            self, "تعديل نوع العقد",
            "النمط يحدد شكل نافذة العقد · التغيير يسري على العقود الجديدة "
            "فقط ولا يعيد حساب أي عقد قائم",
            "📋", min_w=420, max_w=560)
        form = QFormLayout()
        form.setSpacing(10)
        self.name = QLineEdit(t["name"])
        self.amount = SafeDoubleSpinBox()
        self.amount.setDecimals(3)
        self.amount.setRange(0, 999_999_999)
        self.amount.setGroupSeparatorShown(True)
        self.amount.setValue(float(t["default_amount"] or 0))
        from PySide6.QtWidgets import QComboBox as _QCBm2, QCheckBox as _QCBx2
        from services import contract_type_service as _cts_d
        self.mode = _QCBm2()
        make_searchable(self.mode, "")
        for _k, _v in _cts_d.MODES.items():
            self.mode.addItem(_v, _k)
        _cur = _cts_d.type_config(t["name"])["mode"]
        _i = self.mode.findData(_cur)
        if _i >= 0:
            self.mode.setCurrentIndex(_i)
        self.sup = _QCBx2("عقد إشراف هندسي (تاريخ تعهد + تمديد تلقائي)")
        self.sup.setChecked(bool(t.get("is_supervision")))
        self.manual = _QCBx2("🔧 مسار يدوي (تعليم حر للمراحل)")
        self.manual.setChecked(bool(t.get("manual_track")))
        self.unit = QLineEdit((t.get("unit_label") or "").strip())
        self.unit.setPlaceholderText("واجهة · دور · متر (اتركه فارغًا "
                                     "للمبلغ المقطوع)")
        self.unit_price = SafeDoubleSpinBox()
        self.unit_price.setDecimals(3)
        self.unit_price.setRange(0, 999_999_999)
        self.unit_price.setGroupSeparatorShown(True)
        self.unit_price.setValue(float(t.get("unit_price") or 0))
        self.notes = QLineEdit(t["notes"] or "")
        form.addRow("اسم النوع", self.name)
        form.addRow("نمط التسعير", self.mode)
        form.addRow("", self.sup)
        form.addRow("", self.manual)
        form.addRow("المبلغ الافتراضي", self.amount)
        form.addRow("وحدة القياس", self.unit)
        form.addRow("سعر الوحدة الواحدة", self.unit_price)
        form.addRow("ملاحظات", self.notes)
        host = QWidget()
        host.setObjectName("transparentHost")
        host.setLayout(form)
        body.addWidget(host)
        style.dialog_buttons(self, "حفظ", on_save=self.accept)
