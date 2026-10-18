# -*- coding: utf-8 -*-
"""V4.48: النطاق + التخطي والترتيب + الدورة التلقائية للمطالبات.

§1 النطاق خدميًا · §2 صندوق النطاق · §3 التخطي ورقم الإنهاء ·
§4 مطالبة تلقائية + تسديد تلقائي · §5 واجهة التحذير والشارات.
"""
import os
import sys
import tempfile
from datetime import date
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import database.database as db

_tmpdir = tempfile.mkdtemp(prefix="v448_")
db.DATA_DIR = _tmpdir
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")

from database import database  # noqa: E402

database.init_db()

from database.models import Contract, Customer  # noqa: E402
from services import auth_service  # noqa: E402
from services import claims_service as cl  # noqa: E402
from services import contract_service, customer_service  # noqa: E402
from services import contract_type_service as cts  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402
from services import workflow_service as wf  # noqa: E402
from ui import style  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


auth_service.ensure_default_user()
auth_service.set_current_user("admin")
TODAY = date.today().isoformat()
TPL = cts.UNSPECIFIED
tree = wf.stage_tree(wf.TX_CONTRACT, TPL)
KIDS = [c["id"] for m in tree for c in m["children"]]
M0_KIDS = [c["id"] for c in tree[0]["children"]]
M1_KIDS = [c["id"] for c in tree[1]["children"]]

c1 = customer_service.add_customer(Customer(
    customer_code="M48-001", name="عميل الدورة", phone="50000000"))


def _mk(num, amount=10000, scope=None):
    kw = {"scope_stage_ids": scope} if scope else {}
    return contract_service.add_contract(Contract(
        contract_number=f"M48-CT-{num:03d}", customer_id=c1,
        contract_name=f"عقد دورة {num}",
        contract_date=TODAY, amount=amount), **kw)


print("=== §1 النطاق خدميًا ===")
k1 = _mk(1, scope=M0_KIDS + M1_KIDS)
snap1 = wf.get_contract_stages(k1)
heads1 = sorted(s["name"] for s in snap1 if s["level"] == 0)
steps1 = [s for s in snap1 if s["level"] != 0]
check("النطاق: عنوانان فقط",
      heads1 == sorted([tree[0]["stage_name"], tree[1]["stage_name"]]),
      str(heads1))
check("النطاق: خطوات المختار فقط",
      len(steps1) == len(M0_KIDS + M1_KIDS), str(len(steps1)))
check("النطاق محفوظ ومقروء",
      wf.get_contract_scope(k1) == set(M0_KIDS + M1_KIDS))
k_lone = _mk(2, scope=[KIDS[0]])
snapL = wf.get_contract_stages(k_lone)
check("بند مفرد يضم أباه عنوانًا",
      len(snapL) == 2
      and sum(1 for s in snapL if s["level"] == 0) == 1
      and sum(1 for s in snapL if s["level"] != 0) == 1,
      str([(s["level"], s["name"]) for s in snapL]))
k_full = _mk(3)
check("بلا نطاق = القالب كاملًا",
      len([s for s in wf.get_contract_stages(k_full)
           if s["level"] != 0]) == len(KIDS))

print("\n=== §2 صندوق النطاق ===")
from PySide6.QtCore import Qt  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402

from ui.contracts import ContractDialog  # noqa: E402

app = QApplication.instance() or QApplication([])
dlg = ContractDialog()
dlg._load_scope_tree(TPL)
app.processEvents()
check("الصندوق ظهر بتصنيفات القالب",
      dlg._scope_box.isVisibleTo(dlg)
      and dlg.scope_tree.topLevelItemCount() == len(tree),
      str(dlg.scope_tree.topLevelItemCount()))
check("الكل معلّم افتراضيًا",
      len(dlg._scope_selection()) == len(KIDS),
      str(len(dlg._scope_selection())))
top0 = dlg.scope_tree.topLevelItem(0)
top0.setCheckState(0, Qt.Unchecked)
app.processEvents()
sel = dlg._scope_selection()
check("إلغاء تصنيف يستبعد بنوده",
      len(sel) == len(KIDS) - len(M0_KIDS)
      and not (set(sel) & set(M0_KIDS)), str(len(sel)))
check("العدّاد يحدّث", "2 تصنيف" in dlg.scope_count.text(),
      dlg.scope_count.text())
kid = dlg.scope_tree.topLevelItem(1).child(0)
kid.setCheckState(0, Qt.Unchecked)
app.processEvents()
check("الأب الجزئي يُحسب",
      dlg.scope_tree.topLevelItem(1).checkState(0)
      == Qt.PartiallyChecked)
dlg._load_scope_tree("نوع-وهمي-بلا-قالب-zzz")
check("بلا قالب = الصندوق مخفي", dlg._scope_box.isHidden())

print("\n=== §3 التخطي ورقم الإنهاء ===")
k4 = _mk(4)
wf.set_contract_manual_path(k4, True)
st4 = sorted(
    [s for s in wf.get_contract_stages(k4) if s["level"] != 0],
    key=lambda s: (s.get("sort_order") or 0, s.get("id") or 0))
prev = wf.manual_skip_preview(k4, st4[2]["id"])
check("معاينة التخطي تسمي الأسبق المفتوح",
      prev == [st4[0]["name"], st4[1]["name"]], str(prev))
check("الأول بلا تخطي", wf.manual_skip_preview(k4, st4[0]["id"]) == [])
wf.manual_close_stage(k4, st4[2]["id"], TODAY)
wf.manual_close_stage(k4, st4[0]["id"], "2020-01-01")
fo = wf.stage_finish_order(k4)
check("رقم الإنهاء بتسلسل التاريخ",
      fo.get(st4[0]["id"]) == 1 and fo.get(st4[2]["id"]) == 2,
      str(fo))

print("\n=== §4 الدورة التلقائية ===")
from database.database import get_connection  # noqa: E402

k5 = _mk(5, amount=10000)
st5 = sorted(
    [s for s in wf.get_contract_stages(k5) if s["level"] != 0],
    key=lambda s: (s.get("sort_order") or 0, s.get("id") or 0))
with get_connection() as conn:
    conn.execute(
        "INSERT INTO payment_plan (contract_id, title, due_date, amount,"
        " stage_id) VALUES (?,?,?,?,?)",
        (k5, "دفعة دورة", TODAY, 3000, st5[1]["id"]))
    conn.execute("DELETE FROM payment_plan WHERE contract_id=?"
                 " AND title LIKE 'دفعة كاملة%'", (k5,))
    ln = conn.execute(
        "SELECT id FROM payment_plan WHERE contract_id=? AND title=?",
        (k5, "دفعة دورة")).fetchone()
LN = int(ln["id"])
wf.set_contract_manual_path(k5, True)
wf.manual_close_stage(k5, st5[1]["id"], TODAY)
auto = [x for x in cl.list_claims(direction="out", contract_id=k5)
        if x.get("cust_line_id") == LN]
check("الاستحقاق ولّد مطالبة مسجلة",
      len(auto) == 1 and auto[0]["status"] == "registered"
      and "تلقائية" in auto[0]["title"], str(auto))
wf.manual_reopen_stage(k5, st5[1]["id"])
wf.manual_close_stage(k5, st5[1]["id"], TODAY)
auto2 = [x for x in cl.list_claims(contract_id=k5)
         if x.get("cust_line_id") == LN
         and x["status"] not in ("cancelled", "refused")]
check("لا ازدواج عند إعادة الإنهاء", len(auto2) == 1, str(len(auto2)))
AID = auto[0]["id"]
cl.set_status(AID, "sent")
cl.set_status(AID, "approved")
lc.add_voucher("receipt", TODAY, "", "نقدًا", "", 3000.0,
               "سداد الدورة", contract_id=k5, party_type="customer",
               party_id=c1)
got = cl.get_claim(AID)
check("السند المغطي حصّلها تلقائيًا",
      got["status"] == "collected" and bool(got["voucher_ref"]),
      f"{got['status']} ref={got['voucher_ref']}")
# شق المقاول
sub_id = lc.add_subcontractor("M48-S1", "مقاول الدورة", "50000001")
sc1 = lc.add_sub_contract(sub_id, k5, None, 8000)
SL = lc.add_sub_plan_line(sc1, "دفعة مقاول دورة", TODAY, 8000,
                          st5[2]["id"])
wf.manual_close_stage(k5, st5[2]["id"], TODAY)
sauto = [x for x in cl.list_claims(direction="in", contract_id=k5)
         if x.get("sub_line_id") == SL]
check("مطالبة مقاول تلقائية",
      len(sauto) == 1 and sauto[0]["status"] == "registered")
SID = sauto[0]["id"]
cl.set_status(SID, "in_review")
cl.set_status(SID, "approved")
lc.add_voucher("payment", TODAY, "", "نقدًا", "", 8000.0,
               "صرف الدورة", sub_contract_id=sc1,
               party_type="subcontractor", party_id=sub_id)
sgot = cl.get_claim(SID)
check("صرف الباطن سدّدها تلقائيًا",
      sgot["status"] == "paid" and bool(sgot["voucher_ref"]),
      f"{sgot['status']} ref={sgot['voucher_ref']}")

print("\n=== §5 واجهة التحذير والشارات ===")
from PySide6.QtWidgets import QCheckBox, QLabel  # noqa: E402

from ui.followup import FollowupPanel  # noqa: E402

k6 = _mk(6)
wf.set_contract_manual_path(k6, True)
with mock.patch.object(style, "confirm", return_value=True) as cf:
    panel = FollowupPanel(None, wf.TX_CONTRACT, k6)
    panel.refresh()
    app.processEvents()
    st6 = sorted(
        [s for s in wf.get_contract_stages(k6) if s["level"] != 0],
        key=lambda s: (s.get("sort_order") or 0, s.get("id") or 0))
    boxes = panel.manual_tabs.findChildren(QCheckBox)
    box3 = next(b for b in boxes
                if int(b.property("manualStageId")) == st6[2]["id"])
    box3.setChecked(True)
    app.processEvents()
    warned = any("تخط" in str(c.args[1] if len(c.args) > 1 else "")
                 for c in cf.call_args_list)
    check("التعليم المتخطي يُحذّر أولًا", warned,
          str([str(c)[:80] for c in cf.call_args_list]))
    labels = [w.text() for w in
              panel.manual_tabs.findChildren(QLabel)]
    check("شارة رقم الإنهاء ظاهرة",
          any("🏁 #1" in t for t in labels), str(labels)[:200])

print("")
print(f"V4.48 cycle: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
