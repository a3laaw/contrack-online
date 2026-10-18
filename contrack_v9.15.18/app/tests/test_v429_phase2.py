# -*- coding: utf-8 -*-
"""V4.29 (مرحلة 2): المستحق وضع داخل الشركة الأخرى.

يغطي: 4 تبويبات · 3 أوضاع · المضمّن وفلاتره · توجيه زر التسديد ·
القفز لوضع المستحق · تصدير البنود · بلا تبويب/زر مستقل.
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
D1 = "2026-09-20"
st.save_profile(None, G, "بنك H", "KNET", 1, 0.150)
st.save_gateway_ops(G, [
    {"date": D1, "phone": "94440001", "amount": 100.0, "ref": "PA",
     "status": "other", "customer": "أ"},
    {"date": D1, "phone": "94440002", "amount": 50.0, "ref": "UB",
     "status": "other", "customer": "ب"},
    {"date": D1, "phone": "94440003", "amount": 70.0, "ref": "UM",
     "status": "mine", "customer": "ج"}], "f1.xlsx")
st.distribute_rows(G, [(D1, "94440001", 100.0, "PA"),
                       (D1, "94440002", 50.0, "UB"),
                       (D1, "94440003", 70.0, "UM")])
_ids = st.op_ids_for(G, [(D1, "94440001", 100.0, "PA")])
st.add_other_transfer("2026-09-21", 99.85, op_ids=_ids)

from PySide6.QtCore import Qt  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402
from ui.gateway_page import GatewayPage  # noqa: E402
from ui.other_company_page import OtherCompanyPage  # noqa: E402
from ui.payment_gateway_page import PaymentGatewayPage  # noqa: E402

app = QApplication.instance() or QApplication([])

print("=== 1. الحاوية والأوضاع ===")
mg = PaymentGatewayPage()
check("تبويبان بلا مطابقة (V4.40)",
      mg.stack.count() == 2 and mg.tabs.count() == 2
      and not hasattr(mg, "dues_tab")
      and not hasattr(mg, "ours_tab")
      and not hasattr(mg, "clear_tab"))
oc = OtherCompanyPage()
check("المبدّل ظاهر + الافتراضي المستحق",  # V4.40
      not oc.mode.isHidden()
      and oc.mode.currentData() == "due"
      and oc.table.isHidden() and not oc.dues_embed.isHidden()
      and [b.text() for b in oc.mode._buttons]
      == ["📌 المستحق", "✅ المسدد", "📊 التقرير", "الكشف المالي",
          "📅 التسوية اليومية"]
      and not hasattr(oc, "dues_btn"))

print("=== 2. المضمّن ===")
oc.mode.setCurrentData("due")
app.processEvents()
de = oc.dues_embed
check("التبديل للمستحق",
      oc.table.isHidden() and not de.isHidden()
      and oc.d1.isHidden() and oc.kind.isHidden()
      and oc.search.isHidden())
check("محتوى المضمّن وفلاتره",
      de.table.rowCount() == 1
      and de._shown[0]["ref"] == "UB"  # V4.41: بلا عمود مرجع
      and de.gw_combo.count() >= 1 and de.gw_combo2.count() == 3
      and de.all_btn.text() == "تحديد الكل"
      and de.none_btn.text() == "✕ إلغاء التحديد",
      de.table.rowCount())
check("دفع المضمّن مخفي (خارجي)",
      de.pay_btn.isHidden())

print("=== 3. توجيه التسديد ===")
check("المستحق بلا تحديد معطّل",
      not oc.pay_btn.isEnabled()
      and oc.pay_btn.text() == "💸 تسديد المحدد",
      oc.pay_btn.text())
de.table.item(0, 0).setCheckState(Qt.Checked)
app.processEvents()
check("التحديد يفعّل بعدّاد",
      oc.pay_btn.isEnabled()
      and oc.pay_btn.text() == "💸 تسديد المحدد (1 بند · 49.850 د.ك)",
      oc.pay_btn.text())
import ui.due_items_page as _dumod  # noqa: E402
import ui.other_company_page as _ocmod  # noqa: E402

captured: dict = {}


class _FakeDlg:
    def __init__(self, parent, amount_preset=0.0, op_ids=None):
        captured["preset"] = amount_preset
        captured["ops"] = list(op_ids or [])

    def exec(self):
        return 0


_orig_du = _dumod.TransferDialog
_dumod.TransferDialog = _FakeDlg
try:
    oc._open_transfer()
finally:
    _dumod.TransferDialog = _orig_du
check("المستحق يوجَّه للمضمّن",
      abs(captured.get("preset", 0) - 49.85) < 0.001
      and len(captured.get("ops", [])) == 1, str(captured))
oc.mode.setCurrentData("ledger")
app.processEvents()
check("العودة تفعّل الدفعة الحرة",
      oc.pay_btn.isEnabled()
      and oc.pay_btn.text() == "💸 دفعة على الحساب"
      and not oc.table.isHidden() and de.isHidden(),
      oc.pay_btn.text())
jb = next(j for j, x in enumerate(oc._shown)
          if x["kind"] == "due" and x.get("day") == D1)
oc.table.item(jb, 0).setCheckState(Qt.Checked)
app.processEvents()
_orig_oc = _ocmod.TransferDialog
_ocmod.TransferDialog = _FakeDlg
try:
    oc._open_transfer()
finally:
    _ocmod.TransferDialog = _orig_oc
check("الدفتر يوجَّه مربوطًا",
      abs(captured.get("preset", 0) - 49.85) < 0.001
      and len(captured.get("ops", [])) == 1, str(captured))

print("=== 4. القفز والتصدير ===")
gp = GatewayPage(on_show_tab=mg.show_tab)
gp._jump_to("other")
app.processEvents()
check("القفزة تهبط على المستحق",
      mg.stack.currentIndex() == 1
      and mg.other_tab.mode.currentData() == "due")
gp._jump_to("match")
app.processEvents()
check("قفزة التصنيف عادية", mg.stack.currentIndex() == 0)
oc.mode.setCurrentData("due")
app.processEvents()
got: dict = {}
_orig_xl = _ocmod.export_table_excel
_ocmod.export_table_excel = lambda *a, **k: got.update(
    {"title": a[1], "heads": a[2], "data": a[3]})
try:
    oc._export_dues()
finally:
    _ocmod.export_table_excel = _orig_xl
check("تصدير البنود",
      len(got.get("heads", [])) == 8
      and len(got.get("data", [])) == 1
      and got["data"][0][4] == 49.85, str(got.get("data")))

print(f"\nV4.29 phase2: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
