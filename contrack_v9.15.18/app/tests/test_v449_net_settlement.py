# -*- coding: utf-8 -*-
"""V4.49: التسوية على الصافي + صدق القديم + بلا تمرير أفقي.

يغطي: بنود المستحق صافية · رفض دفع الإجمالي (زيادة العمولة) ·
التوزيع الصافي بمتبقي 0.000 تمامًا · الصفوف القديمة (إجمالي) تبقى
-0.150 صادقة بحالة مسدد · المسدد-صافيًا يدخل تبويب المسدد ·
تقرير العمليات 8 أعمدة بلا التسديد · الحارس يتجاوز جداول الأوزان.
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

from database.database import get_connection  # noqa: E402
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
st.save_profile(None, G, "بنك H", "KNET", 1, 0.150)
st.save_gateway_ops(G, [
    {"date": "2026-09-10", "phone": "95550001", "amount": 100.0,
     "ref": "RA", "status": "other"},
    {"date": "2026-09-20", "phone": "95550002", "amount": 50.0,
     "ref": "RB", "status": "other"}], "f.csv")
st.distribute_rows(G, [("2026-09-10", "95550001", 100.0, "RA"),
                       ("2026-09-20", "95550002", 50.0, "RB")])
_ids = st.op_ids_for(G, [("2026-09-10", "95550001", 100.0, "RA"),
                         ("2026-09-20", "95550002", 50.0, "RB")])

print("=== 1. البنود صافية ===")
dues = {r["ref"]: r for r in st.unpaid_other_items()}
check("RA المتبقي/الأصل = الصافي",
      dues["RA"]["amount"] == 99.85
      and dues["RA"]["total"] == 99.85, dues["RA"])
check("RB المتبقي = 49.85", dues["RB"]["amount"] == 49.85)

print("=== 2. الدفع الكامل مسموح والفارق عمولة (V4.5.13) ===")
_tov = st.add_other_transfer("2026-09-21", 100.0, op_ids=[_ids[0]])
check("دفع الإجمالي مقبول بلا رفض", _tov > 0, _tov)
# المستحق الكلي 149.70؛ دفع 100 لإحدى العمليتين ⇒ المتبقي 49.70 والفارق
# عن الصافي (49.85) = 0.150 عمولة البوابة
_bal_ov = st.other_balance()
check("الفارق = عمولة البوابة 0.150",
      abs(49.85 - _bal_ov["remaining"] - 0.150) < 0.001, _bal_ov)
st.delete_other_transfer(_tov)
_back = {r["ref"]: r for r in st.unpaid_other_items()}
check("بعد إلغاء الزيادة: RA صافٍ 99.85",
      _back.get("RA", {}).get("amount") == 99.85, _back.get("RA"))

print("=== 3. تسديد صافٍ بمتبقي صفري ===")
t1 = st.add_other_transfer("2026-09-21", 99.85, op_ids=[_ids[0]])
check("تسديد برقم", t1 > 0)
ops = {o["ref"]: o for o in
       st.other_ops_status("2026-09-01", "2026-09-30")}
check("المتبقي 0.000 تمامًا والحالة مسدد",
      ops["RA"]["remaining"] == 0.0
      and ops["RA"]["status"] == "paid", ops["RA"])
check("غادر المستحق",
      "RA" not in {r["ref"] for r in st.unpaid_other_items()})
paid = {o["ref"]: o for o in st.paid_other_items()}
check("دخل المسدد بالصافي",
      paid["RA"]["paid"] == 99.85
      and paid["RA"]["transfer_id"] == t1, paid["RA"])

print("=== 4. جزئي ثم إكمال ===")
t2 = st.add_other_transfer("2026-09-22", 20.0, op_ids=[_ids[1]])
check("جزئي برقم", t2 > 0)
dues2 = {r["ref"]: r for r in st.unpaid_other_items()}
check("متبقي الجزئي = 29.85",
      dues2["RB"]["amount"] == 29.85
      and dues2["RB"]["paid"] == 20.0, dues2["RB"])
st.add_other_transfer("2026-09-23", 29.85, op_ids=[_ids[1]])
ops2 = {o["ref"]: o for o in
        st.other_ops_status("2026-09-01", "2026-09-30")}
check("اكتمال الجزئي → 0.000 مسدد",
      ops2["RB"]["remaining"] == 0.0
      and ops2["RB"]["status"] == "paid", ops2["RB"])
bal = st.other_balance()
check("الميزان صفري",
      bal["dues"] == 149.7 and bal["paid"] == 149.7
      and bal["remaining"] == 0.0, bal)

print("=== 5. القديم (إجمالي) يبقى صادقًا ===")
st.save_gateway_ops(G, [
    {"date": "2026-09-25", "phone": "95550003", "amount": 100.0,
     "ref": "RC", "status": "other"}], "g.csv")
st.distribute_rows(G, [("2026-09-25", "95550003", 100.0, "RC")])
_rc = st.op_ids_for(G, [("2026-09-25", "95550003", 100.0, "RC")])[0]
with get_connection() as conn:  # محاكاة بيانات ما قبل V4.49
    _cur = conn.execute(
        "INSERT INTO other_company_transfers (tdate, amount) "
        "VALUES ('2026-09-26', 100.0)")
    _lt = int(_cur.lastrowid)
    conn.execute("INSERT INTO transfer_op_allocs (transfer_id, op_id, amount)"
                 " VALUES (?,?,?)", (_lt, _rc, 100.0))
    conn.execute("UPDATE gateway_ops SET paid_transfer_id=? WHERE id=?",
                 (_lt, _rc))
ops3 = {o["ref"]: o for o in
        st.other_ops_status("2026-09-01", "2026-09-30")}
check("القديم −0.150 صادق وبحالة مسدد",
      ops3["RC"]["remaining"] == -0.15
      and ops3["RC"]["status"] == "paid", ops3["RC"])
check("القديم خارج المستحق",
      "RC" not in {r["ref"] for r in st.unpaid_other_items()})

print("=== 6. تقرير العمليات 8 أعمدة ===")
from PySide6.QtWidgets import QApplication, QWidget, QVBoxLayout  # noqa: E402
from PySide6.QtWidgets import QTableWidget  # noqa: E402
from ui.other_company_page import OPS_REP_HEADS, OtherCompanyPage  # noqa: E402

app = QApplication.instance() or QApplication([])
check("العناوين 8 بلا التسديد",
      len(OPS_REP_HEADS) == 8 and "التسديد" not in OPS_REP_HEADS,
      OPS_REP_HEADS)
oc = OtherCompanyPage()
oc.mode.setCurrentData("ops")
app.processEvents()
check("الجدول 8 أعمدة والحالة@7",
      oc.table.columnCount() == 8
      and oc.table.horizontalHeaderItem(7).text() == "الحالة")
_wb = oc._ops_workbook_data()
check("المصنف 8 أعمدة",
      len(_wb[0]["heads"]) == 8
      and all(len(r) == 8 for r in _wb[0]["rows"]))

print("=== 7. الحارس مقابل الأوزان ===")
from ui.archive import _fill, _table  # noqa: E402
from ui.due_items_page import HEADS  # noqa: E402
from ui.style import guard_table_sections  # noqa: E402
from ui.widgets import apply_column_weights  # noqa: E402

st.save_gateway_ops(G, [
    {"date": "2026-09-27", "phone": "95550004", "amount": 70.0,
     "ref": "RD", "status": "other"}], "h.csv")
st.distribute_rows(G, [("2026-09-27", "95550004", 70.0, "RD")])
w = QWidget()
w.resize(1500, 700)
t = _table(HEADS)
_fill(t, [["", "2026-09-27", G, "عميل", "95550004",
           "69.850", "69.850", "—", "✅", "70.000"] for _ in range(12)])
lay = QVBoxLayout(w)
lay.addWidget(t)
apply_column_weights(t, [4, 10, 10, 17, 11, 10, 10, 9, 11, 8])
w.show()
app.processEvents()
app.processEvents()
guard_table_sections(w)
app.processEvents()
app.processEvents()
check("المُدار بالأوزان يُتجاوز (حد 26)",
      t.horizontalHeader().minimumSectionSize() == 26,
      t.horizontalHeader().minimumSectionSize())
check("بلا تمرير أفقي بعد الحارس",
      t.horizontalScrollBar().maximum() == 0,
      t.horizontalScrollBar().maximum())
plain = QTableWidget()
lay.addWidget(plain)
guard_table_sections(w)
check("غير المُدار ما زال محميًا (80)",
      plain.horizontalHeader().minimumSectionSize() == 80)

print("")
print(f"V4.49 net-settlement: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
