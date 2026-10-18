# -*- coding: utf-8 -*-
"""الاستيراد يقبل العميل/العقد الموجودين في النظام دون تكرارهما في ورقة العملاء."""
import os
import sys
from datetime import date
from pathlib import Path
from tempfile import NamedTemporaryFile

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)

from openpyxl import Workbook  # noqa: E402
from database import database  # noqa: E402
from database.models import Customer, Contract  # noqa: E402
from services import customer_service as customers  # noqa: E402
from services import contract_service as contracts  # noqa: E402
from services import import_service  # noqa: E402


def _sheet(wb, name, headers):
    ws = wb.create_sheet(name)
    ws.append(headers)
    return ws


def main() -> None:
    database.init_db()
    cid = customers.add_customer(Customer(
        customer_code=customers.next_customer_code(), name="خليل رمضان السعيدي", phone="55001122"))
    contracts.add_contract(Contract(
        contract_number=contracts.next_contract_number(), customer_id=cid,
        contract_date=date.today().isoformat(), description="عقد تصميم", amount=100,
        contract_type="تصميم"))

    wb = Workbook()
    wb.remove(wb.active)
    _sheet(wb, "العملاء", [c[0] for c in import_service.SHEETS["العملاء"]["columns"]])
    _sheet(wb, "العقود", [c[0] for c in import_service.SHEETS["العقود"]["columns"]])
    pay = _sheet(wb, "سندات القبض", [c[0] for c in import_service.SHEETS["سندات القبض"]["columns"]])
    # نكتب الاسم بصورة مكافئة عربيًا للتأكد من تحمل الياء/الألف المقصورة والمسافات.
    pay.append(["RV-OLD-X", "خليل رمضان السعيدى  ", "عقد تصميم", 50, date.today().isoformat(), "دفعة", "نقدًا", ""])
    for name in ["مقاولو الباطن", "عقود الإشراف", "عقود الباطن", "سندات الصرف", "الدفعات"]:
        _sheet(wb, name, [c[0] for c in import_service.SHEETS[name]["columns"]])

    with NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        path = tmp.name
    try:
        wb.save(path)
        parsed = import_service.parse_excel(path)
        assert not parsed["errors"], parsed["errors"]
        stats = import_service.execute_import(parsed)
        assert stats["payments"] == 1
    finally:
        try:
            Path(path).unlink()
        except OSError:
            pass
    print("OK: الاستيراد يقبل العميل والعقد الموجودين في النظام")


if __name__ == "__main__":
    main()
