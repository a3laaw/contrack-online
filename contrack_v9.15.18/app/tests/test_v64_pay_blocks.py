# -*- coding: utf-8 -*-
"""V6.4/V6.5 (طلب المستخدم): الجدول الموحّد لكل مقاول + رصيد أول المدة للمطور.

① لكل مقاول على العقد **كتلة مستقلة** أسفل الأخرى (فاصل بينها).
② داخل كل كتلة **جدول واحد**: صف لكل دفعة يجمع
   — البنود والدفعات (الدفعة/البند)
   — أعمدة العميل (المبلغ/المسدَّد/الحالة)
   — أعمدة المقاول نفسه (المبلغ/المسدَّد/الحالة)
   أي: دفعة العميل مقابل نظيرتها للمقاول على نفس السطر (طلب المستخدم 2026-10-07).
③ صف **الإجمالي** داخل كل كتلة (عميل + مقاول) منفصلَين.
④ أسفل الجدول: **جدول بنود عقد الباطن** كجدول منفصل.
⑤ الدفعة التي تُغذّي أكثر من عقد باطن تُوسم «مشتركة» (تتكرر في كل كتلة).
⑥ دفعات العميل غير المرتبطة بأي مقاول لا تغيب: كتلة أخيرة لها.
⑦ زر «＋ سند صرف» في رأس كل كتلة يُعبّئ مقاولها وعقد باطنه تلقائيًا.
⑧ «رصيد أول المدة» في الإعدادات يظهر للمطور فقط (ولا يُصفَّر عند حفظ غيره).
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ["HOME"] = tempfile.mkdtemp()
import database.database as db  # noqa: E402

_t = tempfile.mkdtemp(prefix="v64blocks_")
db.DATA_DIR = _t
db.DB_PATH = os.path.join(_t, "t.sqlite")
db.init_db()

from PySide6.QtWidgets import QApplication, QPushButton, QLabel  # noqa: E402
app = QApplication.instance() or QApplication(sys.argv)
from PySide6.QtCore import Qt  # noqa: E402
from ui import style  # noqa: E402

for _n in ("info", "toast", "success", "warning", "error"):
    setattr(style, _n, lambda *a, **k: None)

from database.database import get_connection  # noqa: E402
from database.models import Contract, Customer  # noqa: E402
from services import auth_service  # noqa: E402
from services import contract_service as ks  # noqa: E402
from services import customer_service as cs  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402
from services import voucher_payment_link_service as vpl  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS " + name)
    else:
        FAIL += 1
        print("  FAIL " + name + (" | " + str(detail) if detail else ""))


auth_service._current["role"] = auth_service.ROLE_DEVELOPER

# ═══════════════ التهيئة: عقد بـ5 دفعات ومقاولين ═══════════════
cust = cs.add_customer(Customer(customer_code="C-V64", name="عميل الكتل",
                                phone="9006400"))
k = ks.add_contract(Contract(
    contract_number="CON-064", customer_id=cust, contract_date="2026-01-01",
    contract_type="", description="عقد الكتل", amount=10000.0),
    manual_path=True)
with get_connection() as c:
    c.execute("DELETE FROM payment_plan WHERE contract_id=?", (k,))
    for i, (t, d, a) in enumerate((
            ("الدفعة الأولى", "2026-01-01", 1000.0),
            ("الدفعة الثانية", "2026-02-01", 2000.0),
            ("الدفعة الثالثة", "2026-03-01", 2000.0),
            ("الدفعة الرابعة", "2026-04-01", 2000.0),
            ("الدفعة الخامسة", "2026-05-01", 3000.0)), 1):
        c.execute("INSERT INTO payment_plan (contract_id, title, due_date, "
                  "amount, sort_order) VALUES (?,?,?,?,?)", (k, t, d, a, i))
    for d_, q, up in (("أعمال الحفر", 120, 5.0), ("حديد التسليح", 4000, 0.25),
                      ("البلاط", 800, 0.5), ("الدهانات", 1, 700.0)):
        c.execute("INSERT INTO boq_items (contract_id, description, qty, unit,"
                  " unit_price) VALUES (?,?,?,?,?)", (k, d_, q, "م²", up))
    items = [int(r["id"]) for r in c.execute(
        "SELECT id FROM boq_items WHERE contract_id=? ORDER BY id", (k,))]
    for code, nm in (("S-A", "سمير"), ("S-B", "الصفوة")):
        c.execute("INSERT INTO subcontractors (sub_code, name, phone) "
                  "VALUES (?,?,?)", (code, nm, "1"))
with get_connection() as c:
    party = {r["name"]: int(r["id"]) for r in c.execute(
        "SELECT id, name FROM subcontractors")}

sub_a = lc.add_sub_contract(party["سمير"], k, None, 4000.0, "2026-01-01",
                            "2026-12-31", "سمير",
                            boq_item_ids=[items[0], items[1]])
lc.distribute_sub_plan(sub_a)
sub_b = lc.add_sub_contract(party["الصفوة"], k, None, 3000.0, "2026-01-01",
                            "2026-12-31", "الصفوة",
                            boq_item_ids=[items[2], items[3]])
lc.distribute_sub_plan(sub_b)

# نُعيد ترتيب المصادر لتطابق مثال المستخدم:
#   سمير  ⇒ دفعات العميل 1 و2   ·   الصفوة ⇒ دفعات العميل 3 و4
plan_no = {int(r["number"]): int(r["line_id"])
           for r in vpl.plan_rows("receipt", contract_id=k)}


def _set_sources(sub_id, mapping):
    """{رقم صف الباطن: [أرقام دفعات العميل]} — يضبط جدول المصادر مباشرة."""
    rows = lc.sub_payment_plan(sub_id)
    with get_connection() as c:
        c.execute("DELETE FROM sub_payment_sources WHERE sub_line_id IN "
                  "(SELECT id FROM sub_payment_plan WHERE sub_contract_id=?)",
                  (sub_id,))
        for i, ln in enumerate(rows, 1):
            for no in (mapping.get(i) or []):
                c.execute("INSERT OR IGNORE INTO sub_payment_sources "
                          "(sub_line_id, cust_line_id) VALUES (?,?)",
                          (int(ln["id"]), int(plan_no[no])))


_set_sources(sub_a, {1: [1], 2: [2]})
_set_sources(sub_b, {1: [3], 2: [4]})
print("مصادر سمير:", lc.sub_source_ids(sub_a))
print("مصادر الصفوة:", lc.sub_source_ids(sub_b))

from ui.contract_hub import ContractHubPage  # noqa: E402
hub = ContractHubPage()
hub.load_contract(k)
hub.open_page = None
hub.show()
hub.resize(1440, 900)
hub._switch_page("pay")
app.processEvents()
hub._pay_relayout()
app.processEvents()

print("=== 1. كتلة لكل مقاول أسفل الأخرى ===")
blocks = hub._pay_blocks
_cblocks = [b for b in blocks if "غير المرتبطة" not in (b["title"] or "")]
check("كتلتان للمقاولين (سمير · الصفوة) + كتلة للدفعة غير المرتبطة",
      len(_cblocks) == 2 and len(blocks) == 3,
      [b["title"] for b in blocks])
check("الكتل أسفل بعضها (كل كتلة تبدأ أسفل التي قبلها)",
      all(blocks[i + 1]["frame"].y() >= blocks[i]["frame"].y()
          for i in range(len(blocks) - 1)),
      [(b["frame"].y()) for b in blocks])
check("اسم المقاول في رأس كل كتلة",
      "سمير" in _cblocks[0]["label"].text()
      and "الصفوة" in _cblocks[1]["label"].text(),
      (_cblocks[0]["label"].text(), _cblocks[1]["label"].text()))

print("=== 2. جدول موحّد: صف لكل دفعة (العميل ⇄ المقاول) ===")


def _nums(tbl):
    """أرقام دفعات العميل في صفوف جدول موحّد (تُقرأ من عمود الدفعة)."""
    out = []
    for r in range(2, max(0, (tbl.rowCount() if tbl else 0) - 1)):
        txt = tbl.item(r, 0).text() if tbl.item(r, 0) else ""
        for ar, en in (("الدفعة الأولى", 1), ("الدفعة الثانية", 2),
                       ("الدفعة الثالثة", 3), ("الدفعة الرابعة", 4),
                       ("الدفعة الخامسة", 5)):
            if ar in txt:
                out.append(en)
    return out


check("كتلة سمير: دفعات العميل 1 و2 فقط",
      _nums(_cblocks[0]["table"]) == [1, 2], _nums(_cblocks[0]["table"]))
check("كتلة الصفوة: دفعات العميل 3 و4 فقط",
      _nums(_cblocks[1]["table"]) == [3, 4], _nums(_cblocks[1]["table"]))
check("كل جدول موحّد 8 أعمدة",
      all(b["table"].columnCount() == 8 for b in _cblocks))
check("رؤوس المجموعات: 2 + 3 + 3 (بنود/عميل/مقاول)",
      all(b["table"].columnSpan(0, 0) == 2
          and b["table"].columnSpan(0, 2) == 3
          and b["table"].columnSpan(0, 5) == 3 for b in _cblocks))
check("رأس مجموعة العميل يحمل اسم العميل",
      all("عميل الكتل" in b["table"].item(0, 2).text() for b in _cblocks),
      [_cblocks[0]["table"].item(0, 2).text()])
check("رأس مجموعة المقاول يحمل اسم المقاول",
      "سمير" in _cblocks[0]["table"].item(0, 5).text()
      and "الصفوة" in _cblocks[1]["table"].item(0, 5).text(),
      [_cblocks[0]["table"].item(0, 5).text(),
       _cblocks[1]["table"].item(0, 5).text()])

print("=== 3. صف الإجمالي داخل كل كتلة ===")
for _i, _b in enumerate(_cblocks):
    _t = _b["table"]
    _last = _t.rowCount() - 1
    check(f"كتلة {_i + 1}: صف إجمالي مدمج بعنوان «الإجمالي»",
          _t.item(_last, 0) is not None
          and _t.item(_last, 0).text() == "الإجمالي"
          and _t.columnSpan(_last, 0) == 2,
          (_t.item(_last, 0).text() if _t.item(_last, 0) else None,
           _t.columnSpan(_last, 0)))
_t0 = _cblocks[0]["table"]
check("إجمالي العميل في كتلة سمير = مجموع دفعاته المرتبطة (3,000)",
      _t0.item(_t0.rowCount() - 1, 2).text() == "3,000.000",
      _t0.item(_t0.rowCount() - 1, 2).text())
check("إجمالي سمير = قيمة عقد الباطن (4,000)",
      _t0.item(_t0.rowCount() - 1, 5).text() == "4,000.000",
      _t0.item(_t0.rowCount() - 1, 5).text())

print("=== 4. جدول بنود لكل مقاول أسفل جدوله ===")
check("جدولا بنود للمقاولين", len(hub.items_tables) == 2,
      len(hub.items_tables))
check("بنتا سمير مرتبطة به (حفر · حديد)",
      [hub.items_tables[0].item(r, 0).text()
       for r in range(hub.items_tables[0].rowCount())]
      == ["أعمال الحفر", "حديد التسليح"],
      [hub.items_tables[0].item(r, 0).text()
       for r in range(hub.items_tables[0].rowCount())])
check("بنتا الصفوة مرتبطة به (بلاط · دهانات)",
      [hub.items_tables[1].item(r, 0).text()
       for r in range(hub.items_tables[1].rowCount())]
      == ["البلاط", "الدهانات"],
      [hub.items_tables[1].item(r, 0).text()
       for r in range(hub.items_tables[1].rowCount())])
check("بنود سمير أسفل جدوله داخل نفس الكتلة",
      _cblocks[0]["body"].indexOf(hub.items_tables[0])
      > _cblocks[0]["body"].indexOf(_cblocks[0]["table"]),
      (_cblocks[0]["body"].indexOf(hub.items_tables[0]),
       _cblocks[0]["body"].indexOf(_cblocks[0]["table"])))

print("=== 5. «مشتركة» + دفعات العميل غير المرتبطة لا تغيب ===")
# نجعل الدفعة الأولى مشتركة (تُنسب لعقدَي الباطن) ثم نتحقق من الوسم
_rows_a = lc.sub_payment_plan(sub_a)
with get_connection() as c:
    c.execute("INSERT OR IGNORE INTO sub_payment_sources (sub_line_id, "
              "cust_line_id) VALUES (?,?)",
              (int(_rows_a[0]["id"]), int(plan_no[1])))
    c.execute("INSERT OR IGNORE INTO sub_payment_sources (sub_line_id, "
              "cust_line_id) VALUES (?,?)",
              (int(lc.sub_payment_plan(sub_b)[0]["id"]), int(plan_no[1])))
hub._dirty["pay"] = True
hub.refresh()
app.processEvents()
hub._pay_relayout()
app.processEvents()
_t = hub._pay_blocks[0]["table"]
_shared_rows = [r for r in range(2, _t.rowCount())
                if _t.item(r, 0) and "مشتركة" in _t.item(r, 0).text()]
check("الدفعة المشتركة تُوسم «مشتركة»", len(_shared_rows) >= 1,
      [_t.item(r, 0).text() for r in range(2, _t.rowCount())])
_marked = {}
for _b in hub._pay_blocks:
    _t2 = _b["table"]
    if _t2 is None or "غير المرتبطة" in (_b["title"] or ""):
        continue
    _marked[_b["title"][:12]] = [r for r in range(2, _t2.rowCount())
                                 if _t2.item(r, 0) and "مشتركة" in _t2.item(r, 0).text()]
check("الوسم يظهر في كل كتلة تشترك في نفس الدفعة",
      len(_marked) == 2 and all(len(v) >= 1 for v in _marked.values()),
      _marked)

# إزالة ربط الدفعة الثانية ⇒ تظهر في كتلة «غير المرتبطة»
with get_connection() as c:
    c.execute("DELETE FROM sub_payment_sources WHERE cust_line_id=?",
              (int(plan_no[2]),))
    c.execute("DELETE FROM sub_payment_sources WHERE cust_line_id=?",
              (int(plan_no[1]),))
hub.refresh()
app.processEvents()
hub._pay_relayout()
app.processEvents()
_free = [b for b in hub._pay_blocks if "غير المرتبطة" in (b["title"] or "")]
check("ظهرت كتلة «دفعات العميل غير المرتبطة بمقاول»", len(_free) == 1,
      [b["title"] for b in hub._pay_blocks])
if _free:
    check("الكتلة تحمل الدفعات غير المرتبطة (1 و2 و5)",
          _nums(_free[0]["table"]) == [1, 2, 5], _nums(_free[0]["table"]))
    check("أعمدة المقاول في الكتلة الحرة بلا بيانات («—»)",
          "غير مرتبط" in _free[0]["table"].item(0, 5).text(),
          _free[0]["table"].item(0, 5).text())
check("كتلة سمير تبقى بلا دفعات عميل مرتبطة (السطر بلا دفعة)",
      _nums([b for b in hub._pay_blocks if "سمير" in b["title"]][0]
            ["table"]) == [],
      _nums([b for b in hub._pay_blocks if "سمير" in b["title"]][0]["table"]))

print("=== 6. زر سند الصرف لكل مقاول يُعبّئ مقاوله ===")
import ui.actions as ui_actions  # noqa: E402
_calls = []
_orig_open = ui_actions.open_voucher
ui_actions.open_voucher = lambda parent, vtype, **kw: _calls.append(
    (vtype, kw))
try:
    for b in hub._pay_blocks:
        btn = next((x for x in b["frame"].findChildren(QPushButton)
                    if x.text() == "＋ سند صرف"), None)
        if btn is not None:
            btn.click()
    _pairs = {(c[1].get("subcontractor_id"), c[1].get("sub_contract_id"))
              for c in _calls if c[1].get("subcontractor_id")}
    check("أزرار الصرف عيّنت مقاوليها وعقودهم",
          len(_calls) == 2
          and _pairs == {(party["سمير"], sub_a), (party["الصفوة"], sub_b)},
          (len(_calls), _pairs))
    _free_btn = next((x for x in
                      [b for b in hub._pay_blocks
                       if "غير المرتبطة" in (b["title"] or "")][0]["frame"]
                      .findChildren(QPushButton)
                      if x.text() == "＋ سند صرف"), None)
    check("كتلة «غير المرتبطة» بلا زر صرف (لا مقاول لها)", _free_btn is None)
finally:
    ui_actions.open_voucher = _orig_open

print("=== 7. رصيد أول المدة للمطور فقط ===")
from ui.settings import SettingsPage  # noqa: E402
_pg = SettingsPage()
app.processEvents()
check("المطور يرى حقول رصيد أول المدة",
      all(w.isVisibleTo(_pg) for w in (_pg.opening_balance_bank,
                                       _pg.opening_balance_cash,
                                       _pg.opening_balance_date)))
_lbls = [l.text() for l in _pg.findChildren(QLabel)]
check("عنوان القسم ظاهر للمطور", any("رصيد أول المدة" in x for x in _lbls))
_pg.close()

auth_service._current["role"] = auth_service.ROLE_ADMIN
_pg2 = SettingsPage()
app.processEvents()
check("المدير لا يرى حقول رصيد أول المدة",
      all(w.isHidden() for w in (_pg2.opening_balance_bank,
                                 _pg2.opening_balance_cash,
                                 _pg2.opening_balance_date)))
_lbls2 = [l.text() for l in _pg2.findChildren(QLabel)]
check("لا عنوان «رصيد أول المدة» عند المدير",
      not any("رصيد أول المدة" in x for x in _lbls2))
from services import settings_service  # noqa: E402
_s = settings_service.get_settings()
_s.opening_balance_bank = 1234.0
_s.opening_balance_cash = 56.0
_s.opening_balance_date = "2026-01-01"
settings_service.save_settings(_s)
settings_service._settings_cache = None
_pg2.refresh()
app.processEvents()
check("القيم المخزنة تُحمَّل في الحقول ولو كانت مخفية",
      abs(_pg2.opening_balance_bank.value() - 1234.0) < 0.001
      and abs(_pg2.opening_balance_cash.value() - 56.0) < 0.001,
      (_pg2.opening_balance_bank.value(), _pg2.opening_balance_cash.value()))
_pg2._save()
settings_service._settings_cache = None
_s2 = settings_service.get_settings()
check("حفظ المدير لا يُصفّر رصيد أول المدة",
      abs(float(_s2.opening_balance_bank) - 1234.0) < 0.001
      and abs(float(_s2.opening_balance_cash) - 56.0) < 0.001,
      (_s2.opening_balance_bank, _s2.opening_balance_cash))
check("تاريخ رصيد أول المدة محفوظ كما هو",
      (getattr(_s2, "opening_balance_date", "") or "") == "2026-01-01",
      getattr(_s2, "opening_balance_date", ""))
_pg2.close()
auth_service._current["role"] = auth_service.ROLE_DEVELOPER

print()
print(f"V6.4 pay blocks: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
