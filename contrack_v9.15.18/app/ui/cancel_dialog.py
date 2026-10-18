# -*- coding: utf-8 -*-
"""واجهة مستخدم موحدة للإلغاء والاسترجاع — V8.3

تتيح إلغاء أي حركة مالية بطريقة موحدة مع:
- سبب الإلغاء
- تأكيد العملية
- عرض سجل الإلغاءات
"""
from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QDialog, QFormLayout, QHBoxLayout, QLabel,
    QLineEdit, QPushButton, QTextEdit, QVBoxLayout,
)

from services.unified_cancel_service import (
    cancel_transaction, restore_transaction, archive_transaction,
    get_cancel_history, STATUSES
)
from services.customer_service import ValidationError
from ui.design_system import Colors, Dimensions, Fonts, Styles


class CancelDialog(QDialog):
    """حوار إلغاء موحد لأي حركة مالية."""

    def __init__(self, parent, entity_type: str, entity_id: int,
                 entity_name: str = "", action: str = "cancel"):
        """
        Args:
            parent: النافذة الأب
            entity_type: نوع الحركة (voucher, contract, claim, sub_contract, custody)
            entity_id: معرف الحركة
            entity_name: اسم الحركة (للعرض)
            action: نوع العملية (cancel, restore, archive)
        """
        super().__init__(parent)
        self.entity_type = entity_type
        self.entity_id = entity_id
        self.entity_name = entity_name
        self.action = action
        self.result_data = None

        self._setup_ui()

    def _setup_ui(self):
        """بناء الواجهة."""
        self.setLayoutDirection(Qt.RightToLeft)
        self.setMinimumWidth(500)

        # تحديد العنوان حسب العملية
        if self.action == "cancel":
            title = "إلغاء الحركة"
            icon = "❌"
            color = Colors.DANGER
            btn_text = "تأكيد الإلغاء"
            btn_style = Styles.button_danger()
        elif self.action == "restore":
            title = "استرجاع الحركة"
            icon = "♻️"
            color = Colors.SUCCESS
            btn_text = "تأكيد الاسترجاع"
            btn_style = Styles.button_success()
        elif self.action == "archive":
            title = "أرشفة الحركة"
            icon = "📦"
            color = Colors.INFO
            btn_text = "تأكيد الأرشفة"
            btn_style = Styles.button_primary()
        else:
            title = "عملية على الحركة"
            icon = "⚙️"
            color = Colors.PRIMARY
            btn_text = "تأكيد"
            btn_style = Styles.button_primary()

        self.setWindowTitle(title)
        self.setStyleSheet(f"QDialog {{ background: {Colors.BG}; }}")

        root = QVBoxLayout(self)
        root.setContentsMargins(20, 20, 20, 20)
        root.setSpacing(16)

        # العنوان
        header = QLabel(f"{icon} {title}")
        header.setStyleSheet(f"""
            font-size: {Fonts.TITLE}px;
            font-weight: {Fonts.WEIGHT_BOLD};
            color: {color};
            background: transparent;
        """)
        root.addWidget(header)

        # معلومات الحركة
        info_frame = QLabel(f"""
            <b>النوع:</b> {self._get_type_name()}<br>
            <b>المعرف:</b> {self.entity_id}<br>
            <b>الاسم:</b> {self.entity_name}
        """)
        info_frame.setStyleSheet(f"""
            background: {Colors.CARD};
            border: 1px solid {Colors.BORDER};
            border-radius: {Dimensions.RADIUS_MD}px;
            padding: 12px;
            font-size: {Fonts.BODY}px;
        """)
        info_frame.setTextFormat(Qt.RichText)
        root.addWidget(info_frame)

        # تحذير
        if self.action == "cancel":
            warning = QLabel("⚠️ هذا الإجراء لا يمكن التراجع عنه إلا بالاسترجاع اليدوي.")
            warning.setStyleSheet(Styles.warning_box())
            root.addWidget(warning)

        # سبب الإلغاء
        form = QFormLayout()
        form.setSpacing(10)

        self.reason_input = QTextEdit()
        self.reason_input.setPlaceholderText("سبب العملية (اختياري)...")
        self.reason_input.setFixedHeight(80)
        self.reason_input.setStyleSheet(Styles.input_field())
        form.addRow("السبب:", self.reason_input)

        root.addLayout(form)

        # أزرار
        btn_row = QHBoxLayout()
        btn_row.setSpacing(10)

        cancel_btn = QPushButton("إلغاء")
        cancel_btn.setStyleSheet(Styles.button_secondary())
        cancel_btn.clicked.connect(self.reject)
        btn_row.addWidget(cancel_btn)

        confirm_btn = QPushButton(btn_text)
        confirm_btn.setStyleSheet(btn_style)
        confirm_btn.clicked.connect(self._execute)
        btn_row.addWidget(confirm_btn)

        root.addLayout(btn_row)

    def _get_type_name(self) -> str:
        """الحصول على اسم نوع الحركة بالعربية."""
        type_names = {
            "voucher": "سند مالي",
            "contract": "عقد",
            "claim": "مطالبة مالية",
            "sub_contract": "عقد باطن",
            "custody": "عهدة",
        }
        return type_names.get(self.entity_type, self.entity_type)

    def _execute(self):
        """تنفيذ العملية."""
        reason = self.reason_input.toPlainText().strip()

        try:
            if self.action == "cancel":
                self.result_data = cancel_transaction(
                    self.entity_type, self.entity_id, reason)
            elif self.action == "restore":
                self.result_data = restore_transaction(
                    self.entity_type, self.entity_id, reason)
            elif self.action == "archive":
                self.result_data = archive_transaction(
                    self.entity_type, self.entity_id, reason)

            self.accept()
        except ValidationError as e:
            from ui import style
            style.error(self, str(e))
        except Exception as e:
            from ui import style
            style.error(self, f"خطأ غير متوقع: {e}")


class CancelHistoryDialog(QDialog):
    """حوار عرض سجل الإلغاءات."""

    def __init__(self, parent, entity_type: str = None, entity_id: int = None):
        super().__init__(parent)
        self.entity_type = entity_type
        self.entity_id = entity_id

        self._setup_ui()
        self._load_history()

    def _setup_ui(self):
        """بناء الواجهة."""
        self.setLayoutDirection(Qt.RightToLeft)
        self.setWindowTitle("سجل الإلغاءات")
        self.setMinimumSize(700, 500)

        root = QVBoxLayout(self)
        root.setContentsMargins(20, 20, 20, 20)
        root.setSpacing(16)

        # العنوان
        header = QLabel("📜 سجل الإلغاءات والاسترجاعات")
        header.setStyleSheet(f"""
            font-size: {Fonts.TITLE}px;
            font-weight: {Fonts.WEIGHT_BOLD};
            color: {Colors.TEXT};
        """)
        root.addWidget(header)

        # جدول السجل
        from PySide6.QtWidgets import QTableWidget, QTableWidgetItem, QHeaderView

        self.table = QTableWidget()
        self.table.setColumnCount(6)
        self.table.setHorizontalHeaderLabels([
            "التاريخ", "النوع", "المعرف", "العملية", "السبب", "المستخدم"
        ])
        self.table.setStyleSheet(Styles.table())
        self.table.verticalHeader().setVisible(False)
        self.table.setAlternatingRowColors(True)
        self.table.horizontalHeader().setStretchLastSection(True)
        root.addWidget(self.table, 1)

        # زر إغلاق
        close_btn = QPushButton("إغلاق")
        close_btn.setStyleSheet(Styles.button_secondary())
        close_btn.clicked.connect(self.close)

        btn_row = QHBoxLayout()
        btn_row.addStretch()
        btn_row.addWidget(close_btn)
        root.addLayout(btn_row)

    def _load_history(self):
        """تحميل سجل الإلغاءات."""
        from services.unified_cancel_service import get_cancel_history, get_all_cancellations

        if self.entity_type and self.entity_id:
            history = get_cancel_history(self.entity_type, self.entity_id)
        else:
            history = get_all_cancellations(100)

        self.table.setRowCount(len(history))

        action_names = {
            "cancel": "❌ إلغاء",
            "restore": "♻️ استرجاع",
            "archive": "📦 أرشفة",
        }

        for i, record in enumerate(history):
            self.table.setItem(i, 0, QTableWidgetItem(
                record.get("created_at", "")))
            self.table.setItem(i, 1, QTableWidgetItem(
                record.get("entity_type", "")))
            self.table.setItem(i, 2, QTableWidgetItem(
                str(record.get("entity_id", ""))))
            self.table.setItem(i, 3, QTableWidgetItem(
                action_names.get(record.get("action", ""), record.get("action", ""))))
            self.table.setItem(i, 4, QTableWidgetItem(
                record.get("reason", "")))
            self.table.setItem(i, 5, QTableWidgetItem(
                record.get("user_name", "")))

        self.table.resizeColumnsToContents()


# ============================================================
# دوال مساعدة للاستخدام السريع
# ============================================================
def cancel_voucher_dialog(parent, voucher_id: int, voucher_number: str = ""):
    """حوار إلغاء سند."""
    dlg = CancelDialog(parent, "voucher", voucher_id,
                       voucher_number or f"سند #{voucher_id}", "cancel")
    if dlg.exec() == QDialog.Accepted:
        return dlg.result_data
    return None


def restore_voucher_dialog(parent, voucher_id: int, voucher_number: str = ""):
    """حوار استرجاع سند."""
    dlg = CancelDialog(parent, "voucher", voucher_id,
                       voucher_number or f"سند #{voucher_id}", "restore")
    if dlg.exec() == QDialog.Accepted:
        return dlg.result_data
    return None


def cancel_contract_dialog(parent, contract_id: int, contract_number: str = ""):
    """حوار إلغاء عقد."""
    dlg = CancelDialog(parent, "contract", contract_id,
                       contract_number or f"عقد #{contract_id}", "cancel")
    if dlg.exec() == QDialog.Accepted:
        return dlg.result_data
    return None


def cancel_claim_dialog(parent, claim_id: int, claim_number: str = ""):
    """حوار إلغاء مطالبة."""
    dlg = CancelDialog(parent, "claim", claim_id,
                       claim_number or f"مطالبة #{claim_id}", "cancel")
    if dlg.exec() == QDialog.Accepted:
        return dlg.result_data
    return None


def show_cancel_history(parent, entity_type: str = None, entity_id: int = None):
    """عرض سجل الإلغاءات."""
    dlg = CancelHistoryDialog(parent, entity_type, entity_id)
    dlg.exec()
