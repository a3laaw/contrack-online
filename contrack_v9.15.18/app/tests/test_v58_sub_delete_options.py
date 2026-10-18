# -*- coding: utf-8 -*-
"""V5.8: حذف بيانات المقاول بخيارات — عقد باطن وحده · سند وحده · السجل بعد إفراغه.

المقصود: لا «حذف المقاول كامل» كخيار وحيد، بل نفس أسلوب العميل:
  * عقد/عقود باطن تُحذف منفردة (وسجل المقاول يبقى).
  * سند/سندات تُحذف منفردة (المطور حذف نهائي · غيره إلغاء موثّق).
  * سجل المقاول يُرفض حذفه ما دام عليه عقد أو سند.
"""
import os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ["HOME"] = tempfile.mkdtemp()
import database.database as db
_t = tempfile.mkdtemp(prefix="v58_")
db.DATA_DIR = _t
db.DB_PATH = os.path.join(_t, "t.sqlite")
db.init_db()

from PySide6.QtWidgets import QApplication
from PySide6.QtCore import Qt
app = QApplication.instance() or QApplication(sys.argv)
from ui import style
for _n in ("info", "error", "toast", "success", "warning"):
    setattr(style, _n, lambda *a, **k: None)
style.confirm = lambda *a, **k: True
style.require_admin = lambda *a, **k: True

from database.models import Contract, Customer
from services import auth_service, contract_service as ks, customer_service as cs
from services import lifecycle_service as lc
from services import sub_delete_service as sds
import ui.sub_delete_dialog as usd

auth_service._current["role"] = auth_service.ROLE_DEVELOPER
PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


cust = cs.add_customer(Customer(customer_code="C-58", name="عميل V5.8",
                                phone="90000581"))
kid = ks.add_contract(Contract(contract_number="CON-58", customer_id=cust,
                               contract_date="2026-10-06", contract_type="",
                               description="", amount=20000.0))
for _d, _p in (("أعمال الهيكل", 6000.0), ("أعمال الصحي", 4000.0),
               ("أعمال الكهرباء", 5000.0), ("أعمال اللياسة", 5000.0)):
    lc.add_boq_item(kid, _d, 1, "", _p)
_boq = lc.list_boq(kid)
sub_id = lc.add_subcontractor("SUB-58", "مقاول V5.8", phone="90000582")
SC1 = lc.add_sub_contract(sub_id, kid, None, 6000.0, boq_item_ids=[_boq[0]["id"]])
SC2 = lc.add_sub_contract(sub_id, kid, None, 4000.0, boq_item_ids=[_boq[1]["id"]])


def _voucher(amount, sc_id, sub, num, cancelled=0):
    with db.get_connection() as conn:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(vouchers)")}
        _has_cancel = "cancelled" in cols
        cur = conn.execute(
            "INSERT INTO vouchers (voucher_number, vtype, vdate, party_type, "
            "party_id, amount, contract_id, sub_contract_id"
            + (", cancelled" if _has_cancel else "") + ") "
            "VALUES (?,?,?,?,?,?,?,?" + (",?" if _has_cancel else "") + ")",
            (num, "payment", "2026-10-06", "subcontractor", int(sub),
             float(amount), int(kid), int(sc_id), int(cancelled)))
        return int(cur.lastrowid)


V1 = _voucher(2000.0, SC1, sub_id, "V-5801")
V2 = _voucher(500.0, SC2, sub_id, "V-5802")
V3 = _voucher(1200.0, SC1, sub_id, "V-5803")

print("=== V5.8.1 معاينة الخيارات (overview) ===")
ov = sds.overview(sub_id)
check("عقدان باطن ظاهران", len(ov["contracts"]) == 2, ov["summary"])
check("ثلاثة سندات ظاهرة", len(ov["vouchers"]) == 3, ov["summary"])
check("ملخص المبالغ: قيمة العقود 10,000 · سندات فعّالة 3,700",
      ov["summary"]["contracts_value"] == 10000.0
      and ov["summary"]["vouchers_total"] == 3700.0, ov["summary"])
check("كلاهما ممنوع الحذف الآن (سند سارٍ على كل عقد)",
      all(not c["can_delete"] for c in ov["contracts"]),
      [(c["id"], c["block_reason"]) for c in ov["contracts"]])
check("سجل المقاول ممنوع حذفه الآن",
      not ov["can_delete_record"] and "سند" in ov["record_block"],
      ov["record_block"])

print("=== V5.8.2 حذف سند وحده: لا يُحذف عقد ولا سجل ===")
res = sds.delete_vouchers([V2], "سند مكرر — تصحيح")
check("المطور ⇒ حذف نهائي", res["mode"] == "delete" and res["deleted"] == 1, res)
ov = sds.overview(sub_id)
check("عدد السندات صار 2", len(ov["vouchers"]) == 2, len(ov["vouchers"]))
check("مازال العقدان موجودين", len(ov["contracts"]) == 2)
check("سجل المقاول باقٍ", bool(ov["subcontractor"]))
with db.get_connection() as conn:
    _gone = conn.execute("SELECT COUNT(*) FROM vouchers WHERE id=?", (V2,)).fetchone()[0]
check("السند المحدد فقط اختفى", _gone == 0)

print("=== V5.8.3 حذف عقد باطن وحده (بعد تحريره من السندات السارية) ===")
V5 = _voucher(250.0, SC2, sub_id, "V-5805")   # شاهد: سند العقد الآخر لا يُمسّ
try:
    sds.delete_contracts([SC1], "خطأ تسجيل")
    _blocked = False
except Exception:
    _blocked = True
# سند سارٍ على SC1 ⇒ الحذف يُرفض ويُرجع خطأ واضحًا لا استثناءً
res = sds.delete_contracts([SC1], "خطأ تسجيل")
check("يُرفض حذف عقد عليه سند سارٍ (خطأ مفصّل)",
      res["deleted"] == 0 and res["errors"]
      and "سندات" in res["errors"][0]["msg"], res)
res_v = sds.delete_vouchers([V1, V3], "حذف سندي العقد قبل حذفه")
check("حُذف السندان السارّان على هذا العقد أولًا",
      res_v["deleted"] == 2, res_v)
res = sds.delete_contracts([SC1], "خطأ تسجيل")
check("حُذف عقد الباطن المحدد وحده", res["deleted"] == 1, res)
ov = sds.overview(sub_id)
check("بقي عقد واحد + سجل المقاول",
      len(ov["contracts"]) == 1 and bool(ov["subcontractor"]),
      [c["id"] for c in ov["contracts"]])
check("بنود عقد العميل لم تُمس",
      len(lc.list_boq(kid)) == 4, len(lc.list_boq(kid)))
check("سند العقد الآخر باقٍ ولم يُمسّ",
      any(v["id"] == V5 for v in ov["vouchers"]), ov["summary"])
check("عقد الباطن الآخر باقٍ", [c["id"] for c in ov["contracts"]] == [SC2],
      [c["id"] for c in ov["contracts"]])

print("=== V5.8.4 رفض حذف السجل ما دام مرتبطًا ===")
try:
    sds.delete_record(sub_id, "تنظيف")
    _err = ""
except Exception as exc:
    _err = str(exc)
check("رسالة رفض واضحة تعرض المتبقي",
      "لا يمكن حذف سجل المقاول" in _err and "عقد باطن" in _err, _err)

print("=== V5.8.5 غير المطور: السند يُلغى ولا يُمحى ===")
auth_service._current["role"] = auth_service.ROLE_SECRETARY
ov = sds.overview(sub_id)
_live = [v for v in ov["vouchers"] if not v["cancelled"]][0]
res = sds.delete_vouchers([_live["id"]], "إلغاء بلا حساب مطوّر")
check("الوضع = إلغاء", res["mode"] == "cancel" and res["cancelled"] == 1, res)
with db.get_connection() as conn:
    _row = conn.execute("SELECT cancelled FROM vouchers WHERE id=?",
                        (_live["id"],)).fetchone()
check("السند باقٍ في السجل باسم ملغى", _row[0] == 1)
check("can_hard_delete_vouchers يعكس الدور",
      sds.can_hard_delete_vouchers() is False)
auth_service._current["role"] = auth_service.ROLE_DEVELOPER

print("=== V5.8.6 إفراغ ثم حذف السجل ===")
auth_service._current["role"] = auth_service.ROLE_DEVELOPER
res = sds.delete_contracts([SC2], "إفراغ قبل حذف السجل")
check("حُذف العقد الثاني", res["deleted"] == 1, res)
ov = sds.overview(sub_id)
check("يبقى السند (ملغى) بعد حذف عقده — لا يُمحى مع العقد",
      len(ov["vouchers"]) == 1 and ov["vouchers"][0]["cancelled"] == 1,
      ov["summary"])
_rest = [v["id"] for v in ov["vouchers"]]
if _rest:
    sds.delete_vouchers(_rest, "إفراغ قبل حذف السجل")
ov = sds.overview(sub_id)
check("لا عقود ولا سندات ⇒ السجل قابل للحذف",
      ov["can_delete_record"], ov["record_block"])
check("حذف السجل ينجح", sds.delete_record(sub_id, "تنظيف بيانات تجريبية")["deleted"] == 1)
ov = sds.overview(sub_id)
check("سجل المقاول اختفى", not ov["subcontractor"])
check("عقد العميل وبنوده سليمة",
      len(lc.list_boq(kid)) == 4
      and ks.get_contract(kid) is not None)

print("=== V5.8.7 شاشة الخيارات (واجهة) ===")
sub2 = lc.add_subcontractor("SUB-58B", "مقاول واجهة", phone="90000583")
SC3 = lc.add_sub_contract(sub2, kid, None, 5000.0, boq_item_ids=[_boq[2]["id"]])
V4 = _voucher(300.0, SC3, sub2, "V-5804")
dlg = usd.SubDeleteDialog(None, sub2)
check("ثلاثة تابات: عقود / سندات / السجل", dlg.tabs.count() == 3
      and "عقود" in dlg.tabs.tabText(0) and "سندات" in dlg.tabs.tabText(1)
      and "سجل" in dlg.tabs.tabText(2),
      [dlg.tabs.tabText(i) for i in range(3)])
check("عدّادات التابات صحيحة",
      "(1)" in dlg.tabs.tabText(0) and "(1)" in dlg.tabs.tabText(1),
      [dlg.tabs.tabText(i) for i in range(3)])
check("صف العقد معروض بالعميل والقيمة",
      dlg.c_table.rowCount() == 1
      and "CON-58" in dlg.c_table.item(0, 1).text()
      and "5,000.000" in dlg.c_table.item(0, 3).text(),
      [dlg.c_table.item(0, c).text() for c in range(8)])
check("صف السند معروض بالرقم والنوع",
      dlg.v_table.rowCount() == 1
      and dlg.v_table.item(0, 1).text() == "V-5804",
      [dlg.v_table.item(0, c).text() for c in range(7)])
check("زر السندات = حذف نهائي (مطور)",
      "حذف" in dlg.b_v.text() and "نهائي" in dlg.b_v.text(), dlg.b_v.text())
check("تاب السجل يشرح المنع الآن", "لا يمكن حذف سجل المقاول" in dlg.r_state.text(),
      dlg.r_state.text())
check("زر حذف السجل معطّل الآن", not dlg.b_r.isEnabled())
# حذف العقد من الواجهة (السند مُلغى أولًا حتى يُسمح)
sds.delete_vouchers([V4], "إلغاء قبل الحذف من الواجهة")
dlg._reload()
dlg.c_table.item(0, 0).setCheckState(Qt.Checked)
dlg._del_contracts()
check("الواجهة حذفت العقد المحدد", sds.overview(sub2)["summary"]["contracts"] == 0)
dlg._reload()
check("تاب السجل صار متاحًا بعد الإفراغ", dlg.b_r.isEnabled()
      and "فارغ" in dlg.r_state.text(), dlg.r_state.text())
dlg.close()

print(f"\n== النتيجة: {PASS}/{PASS + FAIL} ==")
sys.exit(1 if FAIL else 0)
