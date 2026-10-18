# -*- coding: utf-8 -*-
"""V5.9: ① ملاحظات المرحلة (سبب التأخير/واقفة فين) · ② اسم حساب المصروف
النهائي فقط · ③ بداية الاحتساب النقدي (زر مؤقت) · ④ حاجز الفشل الصامت
للوضع المحلي.

الاختبارات هنا على قاعدة مؤقتة تمامًا — لا تمس أي بيانات حقيقية.
"""
import os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ["HOME"] = tempfile.mkdtemp()
import database.database as db
_t = tempfile.mkdtemp(prefix="v59_")
db.DATA_DIR = _t
db.DB_PATH = os.path.join(_t, "t.sqlite")
db.init_db()

from PySide6.QtWidgets import QApplication
app = QApplication.instance() or QApplication(sys.argv)
from ui import style
for _n in ("info", "error", "toast", "success", "warning"):
    setattr(style, _n, lambda *a, **k: None)
style.confirm = lambda *a, **k: True
style.require_admin = lambda *a, **k: True

from database.models import Contract, Customer
from services import auth_service, contract_service as ks, customer_service as cs
from services import workflow_service as wf
from services import expense_account_service as ea
from services import settings_service as ss
from services import lifecycle_service as lc
from services import report_service as rs

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


print("=" * 70)
print("① ملاحظات المرحلة")
print("=" * 70)
cust = cs.add_customer(Customer(customer_code="C-59", name="عميل V5.9",
                                phone="90000591"))
kid = ks.add_contract(Contract(contract_number="CON-59", customer_id=cust,
                               contract_date="2026-10-01", contract_type="",
                               description="", amount=9000.0))

nid = wf.add_stage_note(wf.TX_CONTRACT, kid, "واقف عند البلدية — بانتظار إطفاء")
check("الملاحظة تُحفظ وتُرجع رقمًا", isinstance(nid, int) and nid > 0, nid)
notes = wf.list_stage_notes(wf.TX_CONTRACT, kid)
check("الملاحظة في الجدول", len(notes) == 1 and notes[0]["note"].startswith("واقف"),
      notes)
check("الملاحظة مربوطة بالعقد والعميل",
      notes[0]["contract_id"] == kid and notes[0]["customer_id"] == cust,
      (notes[0]["contract_id"], notes[0]["customer_id"]))
last = wf.latest_stage_note(wf.TX_CONTRACT, kid) or {}
check("آخر ملاحظة تُقرأ (النوت الصغير)", last.get("note", "").startswith("واقف"))

hist = wf.get_stage_history(wf.TX_CONTRACT, kid)
note_rows = [h for h in hist if h.get("kind") == "note"]
check("الملاحظة تظهر في سجل المراحل", len(note_rows) == 1,
      [(h.get("stage_name"), h.get("note")) for h in hist])

with db.get_connection() as conn:
    crows = [dict(r) for r in conn.execute(
        "SELECT body, contract_id, source FROM customer_comments "
        "WHERE customer_id=?", (cust,)).fetchall()]
check("الملاحظة تظهر في تعليقات العميل",
      any("واقف عند البلدية" in (r["body"] or "") for r in crows), crows)
check("التعليق مربوط بالعقد",
      any(int(r["contract_id"] or 0) == kid for r in crows), crows)

rep = wf.execution_occupancy_report("all")
row = next((r for r in rep["rows"] if r["contract_id"] == kid), None)
check("التقرير يحمل آخر ملاحظة",
      bool(row) and (row.get("last_note") or "").startswith("واقف"),
      row.get("last_note") if row else "لا صف")

# ملاحظة ثانية على سند صرف مرتبط بالعقد
with db.get_connection() as conn:
    conn.execute("INSERT INTO vouchers (voucher_number, vtype, vdate, party, "
                 "party_type, party_id, amount, contract_id) "
                 "VALUES ('PV-59', 'payment', '2026-10-02', 'مصروف', "
                 "'customer', ?, 25, ?)", (cust, kid))
    vid = int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])
wf.add_stage_note(wf.TX_PAYMENT, vid, "متأخر لعدم وصول الفاتورة")
pv = wf.list_stage_notes(wf.TX_PAYMENT, vid)
check("ملاحظة السند تُحفظ وترث العقد/العميل",
      len(pv) == 1 and pv[0]["contract_id"] == kid and pv[0]["customer_id"] == cust,
      pv)
check("ملاحظة السند في سجل السند",
      any(h.get("kind") == "note" for h in
          wf.get_stage_history(wf.TX_PAYMENT, vid)))
try:
    wf.add_stage_note(wf.TX_CONTRACT, kid, "   ")
    check("الملاحظة الفارغة تُرفض", False)
except Exception:
    check("الملاحظة الفارغة تُرفض", True)
rec = wf.stage_notes_by_contract([kid])
check("آخر ملاحظة لكل عقد (دفعة واحدة)", kid in rec and "الفاتورة" in rec[kid]["note"],
      rec.get(kid))
check("عدّاد المراحل لم يتأثر بجدول الملاحظات",
      wf.stage_status(wf.TX_CONTRACT, kid) is not None)

print("=" * 70)
print("② اسم حساب المصروف = الابن فقط")
print("=" * 70)
ea.ensure_defaults(force=True)
items = ea.posting_items()                       # [(الاسم المعروض، المعرّف)]
rows = {r["id"]: r for r in ea.list_accounts(True, True)}
bad = []
for lbl, aid in items:
    r = rows.get(aid) or {}
    pid = int(r.get("parent_id") or 0)
    pname = (rows.get(pid) or {}).get("name") or ""
    if pid and pname and pname in lbl:
        bad.append((lbl, pname))
check("لا يظهر اسم الأب داخل اسم الحساب", not bad, bad[:3])
leaf_pairs = [(lbl, aid) for lbl, aid in items
              if (rows.get(aid) or {}).get("parent_id")]
check("حسابات الأبناء موجودة في القائمة", len(leaf_pairs) >= 5, len(leaf_pairs))
check("اسم العنصر = اسم الحساب نفسه (لا مسار مركّب)",
      all(lbl == (rows.get(aid) or {}).get("name") for lbl, aid in leaf_pairs),
      [(lbl, (rows.get(aid) or {}).get("name")) for lbl, aid in leaf_pairs[:3]])
fulls = [r["full_path"] for r in rows.values() if r.get("full_path")]
check("المسار الكامل ما زال محفوظًا في القاعدة",
      any(" / " in (f or "") for f in fulls),
      fulls[:3])

print("=" * 70)
print("③ بداية الاحتساب النقدي")
print("=" * 70)
with db.get_connection() as conn:
    for num, vtype, day, amt, meth in (
            ("RV-OLD", "receipt", "2026-09-20", 1000.0, "البنك"),
            ("RV-NEW", "receipt", "2026-10-04", 300.0, "البنك"),
            ("PV-NEW", "payment", "2026-10-05", 50.0, "الصندوق")):
        conn.execute("INSERT INTO vouchers (voucher_number, vtype, vdate, party, "
                     "method, amount) VALUES (?,?,?,?,?,?)",
                     (num, vtype, day, "طرف", meth, amt))
b1 = lc.cash_account_balances()
check("قبل الاستبعاد: البنك يجمع القديم", abs(b1["bank"] - 1300.0) < 0.001, b1)

st = ss.get_settings()
st.cash_start_date = "2026-10-01"
ss.save_settings(st)
check("القيمة تُحفظ وتُقرأ",
      ss.get_settings().cash_start_date == "2026-10-01")
b2 = lc.cash_account_balances()
check("بعد الاستبعاد: البنك من 2026-10-01 فقط", abs(b2["bank"] - 300.0) < 0.001, b2)
check("الصندوق: الخصم داخل الشهر فقط بلا القديم",
      abs((b1["cash"] - b2["cash"])) < 0.001, (b1["cash"], b2["cash"]))

d = rs.cash_flow_detail("", "")
check("الكشف التفصيلي يستبعد القديم",
      all((r.get("date") or "") >= "2026-10-01" for r in d["receipts"]),
      [r.get("date") for r in d["receipts"]])
check("رصيد البنك في الكشف من بداية الشهر",
      abs(float(d["totals"]["bank"]) - 300.0) < 0.001, d["totals"]["bank"])
check("بداية الاحتساب مُدرجة في نتيجة التقرير",
      d["totals"].get("cash_start_date") == "2026-10-01", d["totals"])

cr = rs.cash_flow_report("", "", "monthly")
labels = [r["label"] for r in cr["rows"]]
check("الملخص النقدي يبدأ من الشهر", all("سبتمبر" not in x for x in labels), labels)
check("لا سند قديم دخل المجاميع",
      abs(float(cr["totals"]["inflow"]) - 300.0) < 0.001, cr["totals"])

# حاجز التحويل الداخلي يرى الرصيد الجديد فقط
try:
    lc._ensure_transfer_source_balance("البنك", 500.0, "2026-10-05")
    check("تحويل أكبر من الرصيد المتاح يُرفض", False)
except Exception:
    check("تحويل أكبر من الرصيد المتاح يُرفض", True)
try:
    lc._ensure_transfer_source_balance("البنك", 100.0, "2026-10-05")
    check("تحويل داخل الرصيد يمر", True)
except Exception as exc:
    check("تحويل داخل الرصيد يمر", False, exc)

st = ss.get_settings()
st.cash_start_date = ""
ss.save_settings(st)
check("إلغاء الاستبعاد يرجّع كل الحركات",
      abs(lc.cash_account_balances()["bank"] - 1300.0) < 0.001,
      lc.cash_account_balances())

print("=" * 70)
print("④ حاجز الفشل الصامت (الوضع المحلي)")
print("=" * 70)
_cfg = os.path.join(tempfile.mkdtemp(), "network_folder.txt")
open(_cfg, "w", encoding="utf-8").write("//SRV/لا_يوجد/مجلد")
db._NET_CONFIG = _cfg
got = db._resolve_data_dir()
check("يهبط محليًا بلا حذف الإعداد",
      os.path.exists(_cfg) and db.is_local_fallback(), (os.path.exists(_cfg), got))
check("السبب محفوظ للعرض", bool(db.resolve_status().get("reason")),
      db.resolve_status())
check("الوضع المحلي العادي ليس «فشلًا صامتًا»",
      db._resolve_data_dir() is not None)
ok, _msg = db.recheck_configured_folder()
check("إعادة المحاولة تفشل بوضوح عندما الشير غائب", ok is False, _msg)

_good = tempfile.mkdtemp()
open(_cfg, "w", encoding="utf-8").write(_good)
check("مسار شير صالح يعمل", db._resolve_data_dir() == _good)
check("الحالة ترجع شبكة", db.resolve_status().get("mode") == "network",
      db.resolve_status())
ok2, msg2 = db.recheck_configured_folder()
check("إعادة المحاولة تنجح مع مجلد صالح", ok2 is True, msg2)

print("=" * 70)
print("⑤ الواجهة")
print("=" * 70)
import ui.followup as uf
import ui.reports_page as urp

dlg = uf.StageNoteDialog(None, wf.TX_CONTRACT, kid, "تجهيز المستندات")
dlg.editor.setPlainText("ملاحظة من النافذة")
dlg._save()
check("نافذة الملاحظة تحفظ",
      any(n["note"] == "ملاحظة من النافذة"
          for n in wf.list_stage_notes(wf.TX_CONTRACT, kid)))

panel = uf.FollowupPanel(None, transaction_type=wf.TX_CONTRACT,
                         transaction_id=kid, show_chat=False, show_history=True)
panel.refresh()
check("زر الملاحظة ظاهر في اللوحة", "ملاحظة" in panel.note_btn.text())
check("الشارة تحمل آخر ملاحظة",
      "ملاحظة من النافذة" in (panel.note_chip.text() or ""),
      panel.note_chip.text())
check("تلميح الشارة يحمل النص الكامل",
      "ملاحظة من النافذة" in (panel.note_chip.toolTip() or ""),
      panel.note_chip.toolTip())

bar = uf.StageBar(None, transaction_type=wf.TX_CONTRACT, transaction_id=kid,
                  show_chat=False, show_history=False)
bar.refresh()
check("الشريط المدمج فيه شارة وزر",
      bool(bar.note_chip.text()) and "ملاحظة" in bar.note_btn.text(),
      (bar.note_chip.text(), bar.note_btn.text()))

data = urp._data_execution("all")
check("تقرير مراحل التنفيذ فيه عمود «آخر ملاحظة»",
      data["heads"][-1] == "آخر ملاحظة", data["heads"])
check("صف العقد يحمل الملاحظة",
      any(any("ملاحظة من النافذة" in str(c) for c in row) for row in data["rows"]))

print("=" * 70)
print(f"V5.9: {PASS} ناجح · {FAIL} فاشل")
print("=" * 70)
sys.exit(1 if FAIL else 0)
