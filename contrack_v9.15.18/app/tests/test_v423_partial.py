# -*- coding: utf-8 -*-
"""V4.23: تسديد جزئي — المبلغ حر ≤ المتبقي والباقي يظل مستحقًا.

يغطي: جزئي + بقاء البند بمتبقي · رفض التجاوز · إكمال
الدفعة · الكشف بالمغطى · حذف الجزئي يعيد المتبقي · منع
إرجاع المدفوع جزئيًا · شاشة المستحق (متبقي/مدفوع).
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


def raises_valueerror(fn):
    try:
        fn()
    except ValueError:
        return True
    return False


G = "Hesabe"
st.save_profile(None, G, "بنك H", "KNET", 1, 0.150)
st.save_gateway_ops(G, [
    {"date": "2026-09-10", "phone": "94440001", "amount": 100.0,
     "ref": "PA", "status": "other"},
    {"date": "2026-09-20", "phone": "94440002", "amount": 50.0,
     "ref": "UB", "status": "other"}], "f.csv")
st.distribute_rows(G, [("2026-09-10", "94440001", 100.0, "PA"),
                       ("2026-09-20", "94440002", 50.0, "UB")])
_ids = st.op_ids_for(G, [("2026-09-10", "94440001", 100.0, "PA")])

print("=== 1. دفعة جزئية ===")
t1 = st.add_other_transfer("2026-09-21", 40.0, op_ids=_ids)
check("جزئي برقم", t1 > 0, t1)
dues = {r["ref"]: r for r in st.unpaid_other_items()}
check("البند باقٍ بمتبقي 59.85 ومدفوع 40",
      dues.get("PA", {}).get("amount") == 59.85
      and dues.get("PA", {}).get("paid") == 40.0, str(dues.get("PA")))
check("ليس مسددًا بالكامل",
      ("2026-09-10", "94440001", 100.0, "PA")
      not in st.paid_lookup(G))
# V4.5.13: الدفع فوق الصافي مقبول — الفارق يُحمَّل كفروقات عمولة
_tov = st.add_other_transfer("2026-09-21", 70.0, op_ids=_ids)
check("التجاوز مقبول (دفع كامل)", _tov > 0, _tov)
_bal_ov = st.other_balance()   # المستحق 149.70 · مدفوع 110 ⇒ 39.70
check("الفارق 10.15 = فروقات عمولة",
      abs(49.85 - _bal_ov["remaining"] - 10.15) < 0.001, _bal_ov)
st.delete_other_transfer(_tov)
_back = {r["ref"]: r for r in st.unpaid_other_items()}
check("بعد الإلغاء: PA بمتبقي 59.85 ومدفوع 40",
      _back.get("PA", {}).get("amount") == 59.85
      and _back.get("PA", {}).get("paid") == 40.0, _back.get("PA"))

print("=== 2. إكمال الدفعة ===")
t2 = st.add_other_transfer("2026-09-22", 59.85, op_ids=_ids)
check("إكمال برقم", t2 > 0, t2)
check("غادر المستحق",
      "PA" not in {r["ref"] for r in st.unpaid_other_items()})
check("شارة المسدد بالتكميل",
      st.paid_lookup(G).get(
          ("2026-09-10", "94440001", 100.0, "PA"), (0,))[0] == t2)

print("=== 3. الكشف بالمغطى ===")
s1 = st.transfer_statement(t1)
check("كشف الجزئي (40)",
      len(s1["ops"]) == 1 and s1["ops"][0]["alloc"] == 40.0
      and s1["total"] == 40.0, str(s1["total"]))
led = st.other_ledger("2026-09-01", "2026-09-30")
pl = [x for x in led["lines"] if x["kind"] == "pay"
      and x["tid"] == t1][0]
check("سطر الدفتر بالمغطى", "(40.000)" in pl["text"], pl["text"])

print("=== 4. حذف الجزئي والإرجاع ===")
st.delete_other_transfer(t1)
dues2 = {r["ref"]: r for r in st.unpaid_other_items()}
check("عاد بمتبقي 40 ومدفوع 59.85",
      dues2.get("PA", {}).get("amount") == 40.0
      and dues2.get("PA", {}).get("paid") == 59.85, str(dues2.get("PA")))
check("إرجاع المدفوع جزئيًا مرفوض",
      st.undistribute_rows(
          G, [("2026-09-10", "94440001", 100.0, "PA")])
      == {"ok": 0, "paid_skipped": 1})

print("=== 5. الشاشة والحوار ===")
from PySide6.QtWidgets import QApplication  # noqa: E402
from ui.clearing_page import TransferDialog  # noqa: E402
from ui.due_items_page import DueItemsPage  # noqa: E402

app = QApplication.instance() or QApplication([])
dp = DueItemsPage()
check("المتبقي/المدفوع ظاهران",
      dp.table.rowCount() == 2
      and dp.table.item(0, 6).text() == "40.000"
      and dp.table.item(0, 7).text() == "59.850"
      and dp.table.item(1, 7).text() == "—",
      dp.table.rowCount())
dlg = TransferDialog(None, amount_preset=40.0, op_ids=_ids)
check("المبلغ حر بالقيمة المقترحة",
      dlg.amount.isEnabled() and dlg.amount.value() == 40.0)

print("")
print("V4.23 partial-pay: " + str(PASS) + " passed, " +
      str(FAIL) + " failed")
sys.exit(1 if FAIL else 0)
