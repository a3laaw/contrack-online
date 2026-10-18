# -*- coding: utf-8 -*-
"""V4.20: شاشة التسديد — عملية-عملية (واحدة/اختياري/إجمالي).

يغطي: قائمة غير المسددة فقط · فلاتر البوابة والبحث · تعليم +
المتبقي/المدفوع · تسديد المحدد (كامل/جزئي) · المسدد يغادر · التبويب
الخامس + زر القفز من حساب الأخرى.
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import database.database as db

_tmpdir = tempfile.mkdtemp()
db.DATA_DIR = _tmpdir
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")

from database import database  # noqa: E402

database.init_db()

from services import settlement_service as st  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS " + name)
    else:
        FAIL += 1
        print("  FAIL " + name + (" | " + str(detail) if detail else ""))


G = "Hesabe"
T = "KNET"
st.save_profile(None, G, "بنك H", "KNET", 1, 0.150)
st.save_profile(None, T, "بنك K", "KNET", 1, 0.0)
st.save_gateway_ops(G, [
    {"date": "2026-09-10", "phone": "93330001", "amount": 100.0,
     "ref": "RA", "status": "other"},
    {"date": "2026-09-20", "phone": "93330002", "amount": 50.0,
     "ref": "RB", "status": "other"},
    {"date": "2026-09-20", "phone": "93330003", "amount": 70.0,
     "ref": "RM", "status": "mine"}], "f.csv")
st.save_gateway_ops(T, [
    {"date": "2026-09-20", "phone": "93330004", "amount": 30.0,
     "ref": "RC", "status": "other"}], "t.csv")
st.distribute_rows(G, [("2026-09-10", "93330001", 100.0, "RA"),
                       ("2026-09-20", "93330002", 50.0, "RB"),
                       ("2026-09-20", "93330003", 70.0, "RM")])
st.distribute_rows(T, [("2026-09-20", "93330004", 30.0, "RC")])
_ids = st.op_ids_for(G, [("2026-09-10", "93330001", 100.0, "RA")])
st.add_other_transfer("2026-09-21", 99.85, op_ids=_ids)

from PySide6.QtCore import Qt  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402
from ui.due_items_page import DueItemsPage  # noqa: E402
from ui.payment_gateway_page import PaymentGatewayPage  # noqa: E402

app = QApplication.instance() or QApplication([])

print("=== 1. قائمة غير المسددة فقط ===")
dp = DueItemsPage()
refs = [r["ref"] for r in dp._shown]  # V4.41: بلا عمود مرجع
check("غير المسدد فقط (RB + RC)",
      refs == ["RB", "RC"], refs)
check("الإجمالي 79.85 (صافي V4.49)",
      dp.totals.text() == "2 بند · 79.850 د.ك", dp.totals.text())

print("=== 2. الفلاتر ===")
dp.search.setText("RB")
app.processEvents()
check("البحث الفوري", dp.table.rowCount() == 1, dp.table.rowCount())
dp.search.clear()
dp.gw_combo.setCurrentIndex(dp.gw_combo.findData(T))
app.processEvents()
check("فلتر البوابة",
      dp.table.rowCount() == 1
      and dp._shown[0]["ref"] == "RC",
      dp.table.rowCount())
dp.gw_combo.setCurrentIndex(dp.gw_combo.findData(""))
app.processEvents()
check("عودة الكل", dp.table.rowCount() == 2, dp.table.rowCount())

print("=== 3. تعليم + تسديد ===")
check("زر التسديد مخفي ابتداءً", dp.pay_btn.isHidden())
dp.table.item(0, 0).setCheckState(Qt.Checked)
app.processEvents()
check("ظهر + عدّاد 49.85",
      not dp.pay_btn.isHidden()
      and "1 بند" in dp.checked_lbl.text()
      and "49.850" in dp.checked_lbl.text()
      and "49.850" in dp.pay_btn.text(),
      dp.checked_lbl.text() + " / " + dp.pay_btn.text())
import ui.due_items_page as _dpmod  # noqa: E402

captured: dict = {}


class _FakeDlg:
    def __init__(self, parent, amount_preset=0.0, op_ids=None):
        captured["preset"] = amount_preset
        captured["ops"] = list(op_ids or [])

    def exec(self):
        return 0


_orig = _dpmod.TransferDialog
_dpmod.TransferDialog = _FakeDlg
try:
    dp._pay_selected()
finally:
    _dpmod.TransferDialog = _orig
check("المحدد التقط 49.85 وعملية",
      abs(captured.get("preset", 0) - 49.85) < 0.001
      and len(captured.get("ops", [])) == 1, str(captured))
dp.table.item(0, 0).setCheckState(Qt.Unchecked)
app.processEvents()
check("اختفى بعد إلغاء التحديد", dp.pay_btn.isHidden())

print("=== 4. الكل + المغادرة بعد السداد ===")
dp._select_all()
check("تحديد الكل = 79.85",
      "2 بند" in dp.checked_lbl.text()
      and "79.850" in dp.checked_lbl.text(),
      dp.checked_lbl.text())


class _AcceptDlg(_FakeDlg):
    def exec(self):
        st.add_other_transfer("2026-09-22", captured.get("preset", 0),
                              op_ids=captured.get("ops", []))
        return 1


_dpmod.TransferDialog = _AcceptDlg
try:
    dp._select_none()
    dp.table.item(0, 0).setCheckState(Qt.Checked)
    dp._pay_selected()
finally:
    _dpmod.TransferDialog = _orig
app.processEvents()
refs2 = [r["ref"] for r in dp._shown]
check("المسدد غادر (بقي RC)", refs2 == ["RC"], refs2)

print("=== 5. المستحق وضع داخل الأخرى ===")
mg = PaymentGatewayPage()
check("تبويبا البوابة بلا مطابقة (V4.40)",
      mg.stack.count() == 2 and not hasattr(mg, "dues_tab")
      and not hasattr(mg, "ours_tab") and not hasattr(mg, "clear_tab"))
mg.show_tab("other", "due")
app.processEvents()
check("الهبوط على وضع المستحق",
      mg.stack.currentIndex() == 1
      and mg.other_tab.mode.currentData() == "due"
      and not mg.other_tab.dues_embed.isHidden()
      and mg.other_tab.table.isHidden())
mg.show_tab("other")
app.processEvents()
check("الوضع محفوظ بلا mode",
      mg.other_tab.mode.currentData() == "due",
      mg.other_tab.mode.currentData())

print("")
print("V4.20 dues-screen: " + str(PASS) + " passed, " +
      str(FAIL) + " failed")
sys.exit(1 if FAIL else 0)
