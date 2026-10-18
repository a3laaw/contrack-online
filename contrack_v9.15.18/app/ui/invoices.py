# -*- coding: utf-8 -*-
"""شاشة إدارة الفواتير · مع عرض المتبقي من العقد مباشرة عند الإدخال."""
import os
import subprocess
import sys
import tempfile

from PySide6.QtCore import QDate, Qt, Signal
from PySide6.QtWidgets import (
    QComboBox, QDateEdit, QDialog, QDoubleSpinBox, QFileDialog, QFormLayout,
    QFrame, QHBoxLayout, QHeaderView, QLabel, QLineEdit, QPushButton,
    QTableWidget, QTableWidgetItem, QTextEdit, QVBoxLayout, QWidget,
)

from services.db_facade_service import DatabaseError
from database.models import Invoice
from services import contract_service, customer_service, invoice_service, settings_service
from services.customer_service import ValidationError
from ui import style
from ui.widgets import required_label, SearchableComboBox, SafeDoubleSpinBox, SafeDateEdit


def open_file_externally(path: str) -> None:
    """فتح الملف/المجلد بالبرنامج الافتراضي مع دعم مسارات الشير."""
    try:
        from services.folder_service import open_path
        open_path(path)
    except Exception:
        pass  # الفتح التلقائي اختياري؛ الملف محفوظ على أي حال


class InvoiceDialog(QDialog):
    """نافذة إضافة / تعديل فاتورة مع ملخص مالي حي للعقد."""

    def __init__(self, parent=None, invoice: Invoice | None = None):
        super().__init__(parent)
        style.ensure_light_background(self)
        self.invoice = invoice
        self.setWindowTitle("تعديل فاتورة" if invoice else "إضافة فاتورة جديدة")
        self.setLayoutDirection(Qt.RightToLeft)
        self.setMinimumWidth(480)

        form = QFormLayout()
        form.setSpacing(10)

        self.number = QLineEdit()
        # حقل عميل قابل للبحث · اكتب جزءًا من الاسم أو الرقم
        self.customer = SearchableComboBox(
            search_only=True)
        self._customers = customer_service.list_customers()
        from ui.widgets import customer_items
        self.customer.set_items(customer_items(), auto_select=False)

        self.contract = SearchableComboBox(open_on_click=True)

        self.date = SafeDateEdit()
        self.date.setCalendarPopup(True)
        self.date.setDisplayFormat("yyyy-MM-dd")
        self.date.setDate(QDate.currentDate())

        self.description = QTextEdit()
        self.description.setFixedHeight(64)
        self.description.setPlaceholderText("مثال: الدفعة الأولى من قيمة العقد")
        self.amount = SafeDoubleSpinBox()
        self.amount.setDecimals(3)
        self.amount.setRange(0, 999_999_999)
        self.amount.setGroupSeparatorShown(True)
        self.notes = QTextEdit()
        self.notes.setFixedHeight(64)

        form.addRow(QLabel(required_label("رقم الفاتورة")), self.number)
        form.addRow(QLabel(required_label("العميل")), self.customer)
        form.addRow(QLabel(required_label("العقد")), self.contract)
        form.addRow(QLabel(required_label("التاريخ")), self.date)
        form.addRow("البيان", self.description)
        form.addRow(QLabel(required_label("المبلغ")), self.amount)
        form.addRow("ملاحظات", self.notes)

        # الملخص المالي الحي
        self.fin_box = QFrame()
        self.fin_box.setProperty("card", True)
        fin_layout = QVBoxLayout(self.fin_box)
        fin_layout.setContentsMargins(14, 10, 14, 10)
        self.lbl_contract_amount = QLabel("-")
        self.lbl_invoiced = QLabel("-")
        self.lbl_remaining = QLabel("-")
        for lbl, text in [(self.lbl_contract_amount, "قيمة العقد: "),
                          (self.lbl_invoiced, "إجمالي الفواتير السابقة: "),
                          (self.lbl_remaining, "المبلغ المتبقي: ")]:
            lbl.setText(text + "-")
        fin_layout.addWidget(self.lbl_contract_amount)
        fin_layout.addWidget(self.lbl_invoiced)
        fin_layout.addWidget(self.lbl_remaining)

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
        layout.addWidget(self.fin_box)
        layout.addLayout(buttons)

        self.customer.selection_changed.connect(self._reload_contracts)
        self.contract.selection_changed.connect(self._update_financials)

        if invoice:
            self.number.setText(invoice.invoice_number)
            self.customer.select_data(invoice.customer_id)
            self._reload_contracts()
            self.contract.select_data(invoice.contract_id)
            self.date.setDate(QDate.fromString(invoice.invoice_date, "yyyy-MM-dd"))
            self.description.setPlainText(invoice.description)
            self.amount.setValue(invoice.amount)
            self.notes.setPlainText(invoice.notes)
        else:
            self.number.setText(invoice_service.next_invoice_number())
            self._reload_contracts()

        self._update_financials()

    def _reload_contracts(self):
        cid = self.customer.selected_data()
        items = []
        if cid:
            from services import customer_service as _cs
            _cust = _cs.get_customer(cid)
            cust = (_cust.name if _cust else "").strip()
            for c in contract_service.list_contracts(customer_id=cid):
                cname = getattr(c, "contract_name", "") or c.description or ""
                core = f"{c.contract_number} · {cname}" if cname else c.contract_number
                display = f"{cust} — {core}" if cust else core
                items.append((display, c.id, c.contract_number))
        self.contract.set_items(items, auto_select=False)
        self._update_financials()

    def _update_financials(self):
        contract_id = self.contract.selected_data()
        currency = settings_service.get_settings().currency
        if not contract_id:
            self.lbl_contract_amount.setText("قيمة العقد: -")
            self.lbl_invoiced.setText("إجمالي الفواتير السابقة: -")
            self.lbl_remaining.setText("المبلغ المتبقي: -")
            return
        try:
            fin = invoice_service.contract_financials(
                contract_id,
                exclude_invoice_id=self.invoice.id if self.invoice else None)
        except (ValidationError, DatabaseError):
            return
        self.lbl_contract_amount.setText(
            f"قيمة العقد: {fin['contract_amount']:,.3f} {currency}")
        self.lbl_invoiced.setText(
            f"إجمالي الفواتير السابقة: {fin['total_invoiced']:,.3f} {currency}")
        self.lbl_remaining.setText(
            f"المبلغ المتبقي: {fin['remaining']:,.3f} {currency}")
        color = style.GREEN if fin["remaining"] > 0 else style.RED
        self.lbl_remaining.setStyleSheet(f"color: {color}; font-weight: bold;")

    def _save(self):
        from ui.widgets import RequiredValidator
        v = RequiredValidator(self)
        v.add(self.number, "رقم الفاتورة")
        v.add(self.customer, "العميل")
        v.add(self.contract, "العقد")
        v.add(self.amount, "المبلغ", min_value=0.001)
        if not v.validate():
            return
        data = Invoice(
            id=self.invoice.id if self.invoice else None,
            invoice_number=self.number.text(),
            customer_id=self.customer.selected_data(),
            contract_id=self.contract.selected_data(),
            invoice_date=self.date.date().toString("yyyy-MM-dd"),
            description=self.description.toPlainText(),
            amount=self.amount.value(),
            notes=self.notes.toPlainText(),
        )
        try:
            if self.invoice:
                invoice_service.update_invoice(data)
            else:
                invoice_service.add_invoice(data)
            self.accept()
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
