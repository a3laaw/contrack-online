# -*- coding: utf-8 -*-
"""V4.16: التوزيع الصريح — تصنيف بلا أثر + اعتماد + قفل + تسديد محدد.

يغطي: التصنيف وحده لا ينشئ مستحقًا ولا تصفية · التوزيع ينشئهما ·
القفل عند التوزيع لا التصنيف · الإرجاع · رفض غير الموزَّع في الربط ·
قفل مبلغ المحدد · سطور التسديد المسمّاة · الترحيل · دورة الواجهة.
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
from services import gateway_service as gw  # noqa: E402
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
D = "2026-09-20"
st.save_profile(None, G, "بنك H", "KNET", 1, 0.150)


def _row(phone, amount, ref, status, cust=""):
    return {"date": D, "phone": phone, "amount": amount, "ref": ref,
            "status": status, "customer": cust, "receipt_no": "",
            "note": ""}


K1 = (D, "90000001", 100.0, "R1")
K2 = (D, "90000002", 50.0, "R2")
K3 = (D, "90000003", 30.0, "R3")

print("=== 1. التصنيف وحده بلا أثر حسابي ===")
check("تثبيت 3 (مرحلة مؤقتة)",
      st.save_gateway_ops(G, [_row("90000001", 100.0, "R1",
                                   gw.STATUS_OTHER, "فلان"),
                             _row("90000002", 50.0, "R2",
                                  gw.STATUS_MINE, "علان"),
                             _row("90000003", 30.0, "R3",
                                  gw.STATUS_UNMARKED, "ج")], "f.csv") == 3)
check("لا مستحق", st.other_dues_total() == 0.0, st.other_dues_total())
clr = st.daily_clearing("2026-09-01", "2026-09-30", G)
check("لا تصفية", all(r["g_mine"] == 0 and r["g_other"] == 0 for r in clr),
      str(clr))
rep = st.other_external_report("2026-09-01", "2026-09-30")
check("التقرير الخارجي فارغ", rep["rows"] == [] and rep["net"] == 0)

print("=== 2. التوزيع الصريح ينشئ الأثر ===")
res = st.distribute_rows(G, [K1, K2, K3])
check("عُدّادات 1/1/1 (المعلّق تُخطي)",
      res == {"mine": 1, "other": 1, "skipped": 1}, str(res))
check("المستحق = 100 − 0.150",
      abs(st.other_dues_total() - 99.85) < 0.001)
clr2 = [r for r in st.daily_clearing("2026-09-01", "2026-09-30", G)
        if r["day"] == D][0]
check("التصفية ترى شركتنا فقط",
      clr2["g_mine"] == 50.0 and clr2["g_other"] == 100.0, str(clr2))
rep2 = st.other_external_report("2026-09-01", "2026-09-30")
check("التقرير يرى الموزَّع",
      len(rep2["rows"]) == 1 and rep2["rows"][0]["customer"] == "فلان")

print("=== 3. القفل عند التوزيع لا التصنيف ===")
st.set_row_class(G, K3, gw.STATUS_OTHER)
check("حر قبل التوزيع", True)
st.set_row_class(G, K3, gw.STATUS_MINE)
st.set_row_class(G, K3, gw.STATUS_UNMARKED)
check("حرية كاملة (3 تبديلات)", True)
try:
    st.set_row_class(G, K1, gw.STATUS_MINE)
    check("الموزَّع مرفوض", False)
except ValueError as exc:
    check("الموزَّع مرفوض", "موز" in str(exc), str(exc))
res2 = st.distribute_rows(G, [K1])
check("إعادة التوزيع تُتخطى", res2["skipped"] == 1, str(res2))

print("=== 4. الإرجاع للتصنيف ===")
u = st.undistribute_rows(G, [K1])
check("أُرجع واحد", u == {"ok": 1, "paid_skipped": 0}, str(u))
check("المستحق سقط", st.other_dues_total() == 0.0)
st.set_row_class(G, K1, gw.STATUS_MINE)
check("حر بعد الإرجاع", True)
st.set_row_class(G, K1, gw.STATUS_OTHER)
st.distribute_rows(G, [K1])
check("أُعيد توزيعه", abs(st.other_dues_total() - 99.85) < 0.001)

print("=== 5. لا مسار يتجاوز التوزيع ===")
check("غير الموزَّع خارج الربط",
      st.op_ids_for(G, [K3]) == [], st.op_ids_for(G, [K3]))
with get_connection() as conn:
    _nid = conn.execute("SELECT id FROM gateway_ops WHERE ref='R3'"
                        ).fetchone()[0]
try:
    st.add_other_transfer("2026-09-21", 30.0, op_ids=[_nid])
    check("ربط غير الموزَّع مرفوض", False)
except ValueError as exc:
    check("ربط غير الموزَّع مرفوض", "موز" in str(exc), str(exc))

print("=== 6. قفل المبلغ والتسمية ===")
from PySide6.QtWidgets import QApplication  # noqa: E402

app = QApplication.instance() or QApplication([])
from ui.clearing_page import TransferDialog  # noqa: E402

ids = st.op_ids_for(G, [K1])
tid = st.add_other_transfer("2026-09-21", 99.85, ref="HV-1",
                            method="تحويل", op_ids=ids)
check("تسديد مربوط", tid > 0)
led = st.other_ledger("2026-09-01", "2026-09-30")
pay_lines = [x for x in led["lines"] if x["kind"] == "pay"]
check("سطر التسديد مسمّى",
      len(pay_lines) == 1 and "فلان" in pay_lines[0]["text"]
      and "99.850" in pay_lines[0]["text"], str(pay_lines))
t2 = st.add_other_transfer("2026-09-22", 5.0)
led2 = st.other_ledger("2026-09-01", "2026-09-30")
pl2 = [x for x in led2["lines"] if x["kind"] == "pay"
       and x["tid"] == t2][0]
check("غير المربوط بلا أسماء", "+" not in pl2["text"], pl2["text"])
dlg = TransferDialog(None, amount_preset=155.5, op_ids=[1, 2])
check("المحدد حر ≤ المجموع (جزئي مسموح)",
      dlg.amount.isEnabled() and dlg.amount.value() == 155.5)
dlg2 = TransferDialog(None)
check("على الحساب حر", dlg2.amount.isEnabled())
u2 = st.undistribute_rows(G, [K1])
check("إرجاع المسدد مرفوض (تُخطي)",
      u2 == {"ok": 0, "paid_skipped": 1}, str(u2))

print("=== 7. الترحيل (صفوف ما قبل V4.16) ===")
with get_connection() as conn:
    conn.execute("DELETE FROM schema_flags WHERE name='dist_migrated_v416'")
    conn.execute("INSERT INTO gateway_ops (gateway, op_date, phone, amount,"
                 " ref, status, customer, classified_manual, distributed) "
                 "VALUES ('T', '2026-09-10', '555', 200.0, 'LEG', 'other',"
                 " 'قديم', 1, 0)")
st.ensure_ops_table()
with get_connection() as conn:
    _d = conn.execute("SELECT COALESCE(distributed,0) FROM gateway_ops "
                      "WHERE ref='LEG'").fetchone()[0]
check("القديم المصنف صار موزَّعًا", _d == 1, _d)
check("داخل المستحق",
      abs(st.other_dues_total() - (99.85 + 200.0)) < 0.001,
      st.other_dues_total())

print("=== 8. دورة الواجهة ===")
from ui import style as _style  # noqa: E402
from ui.gateway_page import GatewayPage  # noqa: E402

pg = GatewayPage()
pg._reload_profiles()
pg.gw_combo.setCurrentIndex(pg.gw_combo.findData(G))
csv_path = os.path.join(_tmpdir, "dst.csv")
with open(csv_path, "w", encoding="utf-8") as fh:
    fh.write("phone,amount,date,ref,customer\n"
             "90000011,70.0,2026-09-20,W1,و\n"
             "90000012,20.0,2026-09-20,W2,ز\n")
check("استيراد صفين", pg.import_file(csv_path) == 2)
app.processEvents()
check("الاقتراح جاهز للصفين",
      pg.table.item(0, 6).text() == "🏢 شركة أخرى"
      and "✨ مقترح" in pg.table.item(0, 10).text()
      and pg.table.item(1, 6).text() == "🏢 شركة أخرى")
pg._on_cell(0, 6)
pg._on_cell(0, 6)
check("صنّف شركتنا", pg.table.item(0, 6).text() == "✅ شركتنا")
check("بلا أثر قبل التوزيع",
      abs(st.other_dues_total() - (99.85 + 200.0)) < 0.001)
pg.table.item(0, 0).setSelected(True)
_orig_ok = _style.success
_style.success = lambda *a, **k: None
try:
    pg._distribute()
finally:
    _style.success = _orig_ok
check("الموزَّع اختفى", pg.table.rowCount() == 1, pg.table.rowCount())
pg._on_cell(0, 6)
pg._on_cell(0, 6)
pg._on_cell(0, 6)
check("الثاني صار أخرى (قرار)",
      pg.table.item(0, 6).text() == "🏢 شركة أخرى"
      and "✨" not in pg.table.item(0, 10).text())
_style.success = lambda *a, **k: None
try:
    pg._distribute()
finally:
    _style.success = _orig_ok
check("الكل اختفى", pg.table.rowCount() == 0, pg.table.rowCount())
check("المستحق زاد 19.85",
      abs(st.other_dues_total() - (99.85 + 200.0 + 19.85)) < 0.001,
      st.other_dues_total())
check("شركتنا ترى الموزَّع",
      any(r["ref"] == "W1" for r in st.distributed_mine_rows()),
      str(st.distributed_mine_rows()))

print("=== 9. صفحتا الوجهة ===")
from PySide6.QtCore import Qt  # noqa: E402
from ui.other_company_page import OtherCompanyPage  # noqa: E402

# V4.34: غطاء شركتنا انتقل لنطاقها في التقرير (test_v434).
oc = OtherCompanyPage()
oc.mode.setCurrentData("ledger")  # V4.31: الافتراضي صار الكشوف
unpaid_refs = [r["ref"] for r in oc._items]
check("بنود غير مسددة تشمل W2",
      "W2" in unpaid_refs and "R1" not in unpaid_refs,
      str(unpaid_refs))
import ui.other_company_page as _ocmod  # noqa: E402

captured: dict = {}


class _FakeDlg:
    def __init__(self, parent, amount_preset=0.0, op_ids=None):
        captured["preset"] = amount_preset
        captured["ops"] = list(op_ids or [])

    def exec(self):
        return 0


wi = next(j for j, x in enumerate(oc._shown)
            if x["kind"] == "due" and x.get("day") == "2026-09-20"
            and x.get("gateway") == G)
off = 1 if (oc.table.rowCount() - len(oc._shown)) == 1 else 0
check("زر التسديد دفعة حرة قبل التحديد",
      oc.pay_btn.text() == "💸 دفعة على الحساب",
      oc.pay_btn.text())
oc.table.item(wi + off, 0).setCheckState(Qt.Checked)
app.processEvents()
check("التحديد يحوّله لمربوط",
      "💸 تسديد المحدد" in oc.pay_btn.text(),
      oc.pay_btn.text())
check("عدّاد المحدد", "19.850" in oc.pay_btn.text(),
      oc.pay_btn.text())
_orig_dlg = _ocmod.TransferDialog
_ocmod.TransferDialog = _FakeDlg
try:
    oc._open_transfer()
finally:
    _ocmod.TransferDialog = _orig_dlg
check("المحدد التقط 19.85 وعملية",
      abs(captured.get("preset", 0) - 19.85) < 0.001
      and len(captured.get("ops", [])) == 1, str(captured))

print("")
print("V4.16 distribution: " + str(PASS) + " passed, " +
      str(FAIL) + " failed")
sys.exit(1 if FAIL else 0)
