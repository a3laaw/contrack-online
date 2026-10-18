# -*- coding: utf-8 -*-
"""شاشة إدارة العملاء."""
import os

from PySide6.QtCore import Qt, Signal, QTimer
from PySide6.QtWidgets import (
    QDialog, QFileDialog, QFormLayout, QGridLayout, QHBoxLayout, QHeaderView, QLabel,
    QLineEdit, QPushButton, QTableWidget, QTableWidgetItem, QTextEdit,
    QVBoxLayout, QWidget,
)

from services.db_facade_service import DatabaseError
from database.models import Customer
from services import customer_service, contract_service, invoice_service
from services.customer_service import ValidationError
from ui import style
from ui.widgets import required_label


class CustomerDialog(QDialog):
    """نافذة إضافة / تعديل عميل."""

    def __init__(self, parent=None, customer: Customer | None = None):
        super().__init__(parent)
        self.customer = customer
        title = "تعديل عميل" if customer else "إضافة عميل جديد"
        style.setup_dialog(
            self, title,
            "بيانات العميل وموقع ملفاته على الشبكة",
            icon="👤", color=style.INFO, size_ratio=0.34,
            min_w=460, max_w=620)
        from PySide6.QtWidgets import QWidget as _QW
        form_host = _QW()
        form = QFormLayout(form_host)
        form.setContentsMargins(0, 0, 0, 0)
        form.setSpacing(10)

        self.code = QLineEdit()
        self.name = QLineEdit()
        self.phone = QLineEdit()
        self.address_governorate = QLineEdit()
        self.address_area = QLineEdit()
        self.address_block = QLineEdit()
        self.address_plot = QLineEdit()
        self.email = QLineEdit()
        # مجلد العميل على الشبكة المحلية
        self.folder = QLineEdit()
        self.folder.setPlaceholderText(r"مثال: \\SERVER\Projects\العميل أو D:\Projects\...")
        folder_btn = QPushButton("استعراض...")
        folder_btn.setProperty("flat", True)
        folder_btn.clicked.connect(self._pick_folder)
        folder_row = QHBoxLayout()
        folder_row.addWidget(self.folder, 1)
        folder_row.addWidget(folder_btn)
        self.notes = QTextEdit()
        self.notes.setFixedHeight(70)

        if customer:
            self.code.setText(customer.customer_code)
            self.name.setText(customer.name)
            self.phone.setText(customer.phone)
            self.address_governorate.setText(customer.address_governorate)
            self.address_area.setText(customer.address_area)
            self.address_block.setText(customer.address_block)
            self.address_plot.setText(customer.address_plot)
            # توافق مع العملاء القدامى الذين لديهم عنوان نصي فقط قبل فصل الخانات
            if customer.address and not any((customer.address_governorate, customer.address_area,
                                             customer.address_block, customer.address_plot)):
                parts = [p.strip() for p in customer.address.split(" - ")]
                if len(parts) >= 1: self.address_governorate.setText(parts[0])
                if len(parts) >= 2: self.address_area.setText(parts[1])
                if len(parts) >= 3: self.address_block.setText(parts[2].replace("قطعة", "").strip())
                if len(parts) >= 4: self.address_plot.setText(parts[3].replace("قسيمة", "").strip())
            self.email.setText(customer.email)
            self.folder.setText(customer.folder_path)
            self.notes.setPlainText(customer.notes)
        else:
            self.code.setText(customer_service.next_customer_code())

        form.addRow(QLabel(required_label("رقم العميل")), self.code)
        form.addRow(QLabel(required_label("اسم العميل")), self.name)
        form.addRow(QLabel(required_label("رقم الهاتف")), self.phone)
        address_host = QWidget()
        address_grid = QGridLayout(address_host)
        address_grid.setContentsMargins(0, 0, 0, 0)
        address_grid.setHorizontalSpacing(8)
        address_grid.setVerticalSpacing(6)
        address_grid.addWidget(QLabel("المحافظة"), 0, 0)
        address_grid.addWidget(self.address_governorate, 0, 1)
        address_grid.addWidget(QLabel("المنطقة"), 0, 2)
        address_grid.addWidget(self.address_area, 0, 3)
        address_grid.addWidget(QLabel("القطعة"), 1, 0)
        address_grid.addWidget(self.address_block, 1, 1)
        address_grid.addWidget(QLabel("القسيمة"), 1, 2)
        address_grid.addWidget(self.address_plot, 1, 3)
        form.addRow("العنوان", address_host)
        form.addRow("البريد الإلكتروني", self.email)
        form.addRow("📁 مجلد العميل (شبكة)", folder_row)
        form.addRow("ملاحظات", self.notes)

        self.body_layout.addWidget(form_host)
        style.dialog_buttons(self, "حفظ", on_save=self._save)

    def _pick_folder(self):
        from PySide6.QtWidgets import QFileDialog
        path = QFileDialog.getExistingDirectory(
            self, "اختر مجلد العميل على الشبكة", self.folder.text() or "")
        if path:
            self.folder.setText(path)

    def accept(self):  # noqa: N802
        """لا تغلق النافذة إلا بعد نجاح التحقق والحفظ."""
        self._save()

    def _save(self):
        from ui.widgets import required_label, RequiredValidator
        v = RequiredValidator(self)
        v.add(self.name, "اسم العميل")
        v.add(self.code, "رقم العميل")
        v.add(self.phone, "رقم الهاتف")
        if not v.validate():
            return
        data = Customer(
            id=self.customer.id if self.customer else None,
            customer_code=self.code.text(),
            name=self.name.text(),
            phone=self.phone.text(),
            address=customer_service.compose_address(
                self.address_governorate.text(), self.address_area.text(),
                self.address_block.text(), self.address_plot.text()),
            address_governorate=self.address_governorate.text(),
            address_area=self.address_area.text(),
            address_block=self.address_block.text(),
            address_plot=self.address_plot.text(),
            email=self.email.text(),
            notes=self.notes.toPlainText(),
            folder_path=self.folder.text(),
        )
        try:
            if self.customer:
                customer_service.update_customer(data)
            else:
                customer_service.add_customer(data)
            style.toast(self.parent() or self, "تم حفظ العميل")
            QDialog.accept(self)
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))


def batch_print_customer_documents(parent, cust):
    """طباعة دفعة واحدة: كل سندات وكشوف حساب العميل في مجلد واحد."""
    from services import lifecycle_service as lc
    from services.batch_print_service import batch_export
    items = []
    # كشوف حساب كل عقوده
    for c in contract_service.list_contracts(customer_id=cust.id):
        items.append({"kind": "statement", "contract_id": c.id,
                      "contract_number": c.contract_number,
                      "label": f"كشف {c.contract_number}"})
    # كل سنداته (قبض وصرف المرتبطة بعقوده)
    contract_ids = {c.id for c in
                    contract_service.list_contracts(customer_id=cust.id)}
    for v in lc.list_vouchers():
        if v.get("contract_id") in contract_ids or (
                v.get("party_type") == "customer"
                and v.get("party_id") == cust.id):
            items.append({"kind": "voucher", "voucher": v,
                          "label": v["voucher_number"]})
    # فواتيره القديمة إن وجدت
    from services import feature_service as _feat13c
    _inv13c = (invoice_service.list_invoices(customer_id=cust.id)
               if _feat13c.enabled("invoices") else [])
    for inv in _inv13c:
        items.append({"kind": "invoice", "invoice": inv,
                      "label": inv.invoice_number})
    if not items:
        style.info(parent, f"لا توجد مستندات للعميل «{cust.name}».")
        return
    folder = QFileDialog.getExistingDirectory(
        parent, f"اختر مجلد حفظ مستندات {cust.name}")
    if not folder:
        return
    import re as _re
    safe = _re.sub(r'[\\/:*?"<>|]', "_", cust.name)[:40]
    out_dir = os.path.join(folder, f"مستندات_{safe}")
    done, failed = batch_export(items, out_dir)
    msg = f"تم توليد {len(done)} مستندًا في:\n{out_dir}"
    if failed:
        msg += f"\n\nفشل: {len(failed)} · {', '.join(failed[:5])}"
    style.info(parent, msg, "الطباعة الدفعية")
    from ui.invoices import open_file_externally
