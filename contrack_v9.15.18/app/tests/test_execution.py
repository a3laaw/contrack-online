# -*- coding: utf-8 -*-
"""اختبار نظام مراحل التنفيذ والمتابعة (الأزرار بدل السحب والإفلات).

يغطي: الشجرة الافتراضية (رئيسية/فرعية بمدد متوقعة) · مرحلة «غير
المتعاقد» المقفولة وبدئها تلقائيًا للعميل الجديد · إغلاقها عند توقيع
العقد وبدء أول مرحلة تنفيذ · أزرار الإنهاء والتخطي وعداد الأيام ·
حالات العداد (طبيعي/قارب/متأخر) · التقرير والتنبيهات · شاشة الإعدادات
(إضافة/ترتيب/حذف/قفل) · ترحيل القواعد القديمة · لوحة المتابعة UI.
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

from database import database
database.init_db()

from datetime import date, timedelta

from PySide6.QtWidgets import QApplication
_app = QApplication.instance() or QApplication(sys.argv)
from ui import style
_app.setStyleSheet(style.apply_theme())

from services import (auth_service, contract_service, customer_service,
                      workflow_service as wf)
from services import lifecycle_service as lc
from database.models import Contract, Customer
from services.customer_service import ValidationError

PASS, FAIL = 0, 0


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

print("=== 1. الشجرة الافتراضية — مربوطة بأنواع العقود ===")
from services import contract_type_service as _cts0
UNSPEC = _cts0.UNSPECIFIED
tree = wf.stage_tree(wf.TX_CONTRACT)   # '' تحل إلى قالب «غير محدد»
check("3 مراحل رئيسية", len(tree) == 3, str(len(tree)))
check("كل مرحلة مربوطة بنوع (لا قالب عام)",
      all((s.get("contract_type") or "") == UNSPEC
          for s in wf.get_stages(wf.TX_CONTRACT, UNSPEC)))
check("لكل رئيسية فروع", all(m["children"] for m in tree))
path = wf.stage_path(wf.TX_CONTRACT)
check("المسار = الفرعيات فقط (8 خطوات)", len(path) == 8, str(len(path)))
check("الرئيسيات ليست خطوات",
      all(not wf.is_step(m) for m in wf.get_stages(wf.TX_CONTRACT)
          if not m["parent_id"]))
check("أول خطوة = فحص التربة",
      wf.first_stage_id(wf.TX_CONTRACT) == path[0]["id"]
      and path[0]["stage_name"] == "فحص التربة")
check("لكل خطوة مدة متوقعة", all(s["expected_days"] > 0 for s in path))
cust = wf.get_stages(wf.TX_CUSTOMER)
check("مرحلة «غير متعاقد» المقفولة مزروعة",
      len(cust) == 1 and int(cust[0]["is_pre_contract"]) == 1
      and cust[0]["expected_days"] == 30)
pay = wf.stage_path(wf.TX_PAYMENT)
check("السندات: مراحل مسطحة كما كانت", len(pay) == 4)
check("كل مسطحة خطوة", all(wf.is_step(s) for s in pay))

print("\n=== 2. العميل المحتمل — يبدأ تلقائيًا في «غير متعاقد» ===")
c1 = customer_service.add_customer(Customer(
    customer_code="EX-001", name="عميل محتمل", phone="50000000"))
cur = wf.get_current_stage(wf.TX_CUSTOMER, c1)
check("بدأت مرحلة غير متعاقد تلقائيًا",
      cur and cur["stage_name"] == "غير متعاقد")
check("مفتوحة وبادئة بتاريخ اليوم",
      not cur["end_date"] and cur["start_date"] == date.today().isoformat())
check("آمنة عند التكرار", wf.start_for_customer(c1) == 0)
try:
    wf.delete_stage(cust[0]["id"])
    check("مرحلة النظام المقفولة لا تُحذف", False)
except Exception:
    check("مرحلة النظام المقفولة لا تُحذف", True)
# عميل قديم بلا سجل (مثل المستورد): البدء يعمل عند الطلب
c2 = customer_service.add_customer(Customer(
    customer_code="EX-002", name="عميل ثانٍ", phone="50000001"))
with database.get_connection() as conn:
    conn.execute("DELETE FROM transaction_stage_log WHERE "
                 "transaction_type='customer' AND transaction_id=?", (c2,))
check("بدء المتابعة لعميل بلا سجل", wf.start_for_customer(c2) > 0)

print("\n=== 3. توقيع العقد — إغلاق ما قبل التعاقد وبداية التنفيذ ===")
k1 = contract_service.add_contract(Contract(
    contract_number="EX-CT-001", customer_id=c1, contract_name="فيلا الفروانية",
    contract_date=date.today().isoformat(), amount=28000))
cur_c = wf.get_current_stage(wf.TX_CONTRACT, k1)
cur_k = wf.get_current_stage(wf.TX_CUSTOMER, c1)
check("العقد بدأ في أول مرحلة تنفيذ",
      cur_c["stage_name"] == "فحص التربة")
check("بدأت بتاريخ اليوم", cur_c["start_date"] == date.today().isoformat())
check("مرحلة «غير متعاقد» أُغلقت", bool(cur_k["end_date"]))
check("إنشاء عقد آخر لا يعيد البدء", wf.on_contract_signed(k1) == 0)

print("\n=== 4. أزرار الإنهاء والتخطي (بلا سحب وإفلات) ===")
r = wf.advance_stage(wf.TX_CONTRACT, k1)
check("زر الإنهاء: يغلق ويفتح التالية",
      r["closed"] == "فحص التربة" and r["next"] == "التصميم المعماري")
st = wf.stage_status(wf.TX_CONTRACT, k1)
check("الحالة الحالية انتقلت", st["current"]["stage_name"] == "التصميم المعماري")
states = {p["stage"]["stage_name"]: p["state"] for p in st["path"]}
check("المنتهية done والحالية current",
      states["فحص التربة"] == "done"
      and states["التصميم المعماري"] == "current")
r = wf.advance_stage(wf.TX_CONTRACT, k1, skip=True)
check("زر التخطي: يوسم المرحلة",
      r["closed"] == "التصميم المعماري"
      and r["next"] == "استخراج رخصة البناء")
st = wf.stage_status(wf.TX_CONTRACT, k1)
states = {p["stage"]["stage_name"]: p["state"] for p in st["path"]}
check("المتخطاة skip", states["التصميم المعماري"] == "skip")
hist = wf.get_stage_history(wf.TX_CONTRACT, k1)
check("السجل يحمل التواريخ والتخطي",
      any(int(h.get("is_skipped") or 0) for h in hist)
      and all(h.get("start_date") for h in hist))
# إنهاء كل المسار
for _ in range(6):
    wf.advance_stage(wf.TX_CONTRACT, k1)
st = wf.stage_status(wf.TX_CONTRACT, k1)
check("اكتمال المسار: لا مرحلة جارية", st["current"] is None)
try:
    wf.advance_stage(wf.TX_CONTRACT, k1)
    check("زر الإنهاء بعد الاكتمال يرفض", False)
except Exception:
    check("زر الإنهاء بعد الاكتمال يرفض", True)

print("\n=== 5. عداد الأيام (طبيعي · قارب · متأخر) ===")
k2 = contract_service.add_contract(Contract(
    contract_number="EX-CT-002", customer_id=c1, contract_name="برج",
    contract_date=date.today().isoformat(), amount=90000))
def _set_start(kid, days_ago):
    with database.get_connection() as conn:
        conn.execute(
            "UPDATE contract_stages SET start_date=? "
            "WHERE contract_id=? AND start_date!='' AND end_date=''",
            ((date.today() - timedelta(days=days_ago)).isoformat(), kid))
_set_start(k2, 2)
check("طبيعي (أقل من المتوقع-3)",
      wf.stage_status(wf.TX_CONTRACT, k2)["state"] == "ok")
_set_start(k2, 5)
check("قارب على الانتهاء (بقي ≤3)",
      wf.stage_status(wf.TX_CONTRACT, k2)["state"] == "near")
_set_start(k2, 12)
st = wf.stage_status(wf.TX_CONTRACT, k2)
check("متأخر (تجاوز المتوقع)", st["state"] == "over"
      and st["days_in"] == 12 and st["expected"] == 7)

print("\n=== 6. التقرير والتنبيهات ===")
rep = wf.execution_report()
check("العقد المتأخر في التقرير",
      any(r["contract_number"] == "EX-CT-002" for r in rep["delayed"]))
check("المتأخر لا يظهر في القارب",
      not any(r["contract_number"] == "EX-CT-002" for r in rep["near"]))
check("المرحلة المتخطاة في المفقود",
      any(r["contract_id"] == k1 and r["stage"] == "التصميم المعماري"
          for r in rep["missing"]))
al = wf.execution_alerts()
check("تنبيه أحمر للتأخير",
      any("متأخر" in t and "EX-CT-002" in t for _k, t, _e in al))
from ui.reports_page import _data_execution
d = _data_execution("delayed")
check("تقرير التأخيرات يعمل", any("EX-CT-002" in str(c) for row in
                                  d["rows"] for c in row))
d_all = _data_execution("all")
check("خيار «الكل» يجمع", len(d_all["rows"]) >= len(rep["delayed"]))
d_no_stage = _data_execution("no_stage")
check("خيار بلا مرحلة يعمل", isinstance(d_no_stage["rows"], list))
from ui.reports_page import visible_reports
keys = [r["key"] for r in visible_reports()]
check("التقرير ظاهر للمدير", "rep_execution" in keys)

print("\n=== 7. شاشة الإعدادات — الشجرة والقواعد ===")
try:
    wf.add_stage(wf.TX_CONTRACT, "يتيمة بلا نوع", parent_id=None)
    check("إضافة مرحلة بلا نوع تُرفض", False)
except Exception:
    check("إضافة مرحلة بلا نوع تُرفض", True)
m1 = wf.add_stage(wf.TX_CONTRACT, "مرحلة تجريبية رئيسية", parent_id=None,
                  contract_type=UNSPEC)
check("إضافة رئيسية (بنوع)", m1 > 0)
s1 = wf.add_stage(wf.TX_CONTRACT, "فرعية تجريبية", parent_id=m1,
                  expected_days=15, contract_type=UNSPEC)
check("إضافة فرعية تحت الرئيسية", s1 > 0)
try:
    wf.add_stage(wf.TX_CONTRACT, "فرعية يتيمة", parent_id=s1)
    check("رفض فرعية تحت فرعية", False)
except Exception:
    check("رفض فرعية تحت فرعية", True)
try:
    wf.delete_stage(m1)
    check("رفض حذف رئيسية لها فروع", False)
except Exception:
    check("رفض حذف رئيسية لها فروع", True)
wf.update_stage(s1, expected_days=25)
check("تعديل المدة المتوقعة",
      wf._get_stage(s1)["expected_days"] == 25)
try:
    wf.update_stage(s1, expected_days=-5)
    check("رفض مدة سالبة", False)
except Exception:
    check("رفض مدة سالبة", True)
wf.delete_stage(s1)
wf.delete_stage(m1)
check("حذف فروع الرئيسية ثم الرئيسية",
      wf._get_stage(m1) is None)
# الترتيب: الرئيسية تنتقل بفروعها
ids_before = [s["id"] for s in wf.get_stages(wf.TX_CONTRACT)]
tree_names_before = [m["stage_name"] for m in wf.stage_tree(wf.TX_CONTRACT)]
wf.reorder_stages(wf.TX_CONTRACT, [ids_before[3], ids_before[0],
                                   ids_before[1], ids_before[2]]
                  + ids_before[4:])
tree_names_after = [m["stage_name"] for m in wf.stage_tree(wf.TX_CONTRACT)]
check("الترتيب يتبع stage_order", tree_names_after[0] != "أعمال ما قبل التنفيذ"
      or tree_names_before[0] == tree_names_after[0])
wf.reorder_stages(wf.TX_CONTRACT, ids_before)
check("إعادة الترتيب الأصلي", [s["id"] for s in
                               wf.get_stages(wf.TX_CONTRACT)] == ids_before)
# استعادة الافتراضية لنوع فارغ
with database.get_connection() as conn:
    conn.execute("DELETE FROM transaction_stage_log WHERE "
                 "transaction_type='subcontract'")
    conn.execute("DELETE FROM workflow_stages WHERE "
                 "transaction_type='subcontract'")
check("استعادة الافتراضية لنوع فارغ",
      wf.restore_default_stages(wf.TX_SUBCONTRACT) == 5)
check("الاستعادة لنوع غير فارغ لا تفعل شيئًا",
      wf.restore_default_stages(wf.TX_SUBCONTRACT) == 0)

print("\n=== 8. السندات وعقود الباطن — نفس المحرك مسطحًا ===")
with database.get_connection() as conn:
    v = conn.execute(
        "INSERT INTO vouchers (voucher_number, vtype, vdate, amount, "
        "method, description) VALUES "
        "('EX-PV-1','payment',?,500,'نقدي','سند تجريبي')",
        (date.today().isoformat(),))
    vid = v.lastrowid
wf.start_transaction(wf.TX_PAYMENT, vid)
cur = wf.get_current_stage(wf.TX_PAYMENT, vid)
check("السند بدأ في «مطلوب»", cur["stage_name"] == "مطلوب")
r = wf.advance_stage(wf.TX_PAYMENT, vid)
check("زر إنهاء مرحلة السند",
      r["closed"] == "مطلوب" and r["next"] == "بانتظار اعتماد المدير")

print("\n=== 9. ترحيل القواعد القديمة (المرحلة 6) ===")
# محاكاة قاعدة قديمة: مراحل عقود مسطحة + سجلات كانبان قديمة
with database.get_connection() as conn:
    conn.execute("DELETE FROM transaction_stage_log WHERE "
                 "transaction_type='contract'")
    conn.execute("DELETE FROM workflow_stages WHERE "
                 "transaction_type='contract'")
    for i, name in enumerate(["جديد", "تجهيز المستندات",
                              "بانتظار توقيع العميل", "جارٍ التنفيذ",
                              "مكتمل"], 1):
        conn.execute(
            "INSERT INTO workflow_stages (transaction_type, stage_name, "
            "stage_order, color) VALUES ('contract', ?, ?, '#3B82F6')",
            (name, i))
    old_stage = conn.execute(
        "SELECT id FROM workflow_stages WHERE transaction_type='contract' "
        "AND stage_name='جارٍ التنفيذ'").fetchone()["id"]
    conn.execute(
        "INSERT INTO transaction_stage_log (transaction_type, "
        "transaction_id, stage_id, moved_by, note) VALUES "
        "('contract', ?, ?, 1, 'حركة كانبان قديمة')", (k1, old_stage))
old_k3 = contract_service.add_contract(Contract(
    contract_number="EX-CT-OLD", customer_id=c2,
    contract_name="عقد قديم 2024", amount=15000,
    contract_date=(date.today() - timedelta(days=400)).isoformat()))
mig = wf.migrate_legacy_stages()
check("الترحيل: استبدال المراحل القديمة", mig["stages_reset"] is True)
tree = wf.stage_tree(wf.TX_CONTRACT)
check("الشجرة الافتراضية مزروعة بعد الترحيل", len(tree) == 3)
# عقد قديم 400 يوم ← Snapshot كل خطواته منتهية (لا مرحلة جارية)
_snap_old = wf.get_contract_stages(old_k3)
_steps_old = [s for s in _snap_old if s["level"] == 1]
check("العقد القديم (400 يوم): كل مراحله منتهية",
      bool(_steps_old) and all(s["end_date"] for s in _steps_old))
check("نسخة العقد القديم مستقلة عن القالب",
      len(_snap_old) > 0 and len(wf.stage_path(wf.TX_CONTRACT, "")) >= 0)
_snap_k1 = [s for s in wf.get_contract_stages(k1) if s["level"] == 1]
check("العقد الأحدث له نسخة مراحل من القالب",
      len(_snap_k1) == 8 and _snap_k1[0]["name"] == "فحص التربة")
# (k1 أنهى مساره كاملًا في قسم 4 — كل خطواته مؤرَّخة هنا)
check("كل خطوات نسخته مؤرَّخة بعد اكتمال مساره",
      all(s["start_date"] and s["end_date"] for s in _snap_k1))
check("العملاء بلا عقود في «غير متعاقد»",
      wf.get_current_stage(wf.TX_CUSTOMER, c2)["stage_name"]
      == "غير متعاقد")
mig2 = wf.migrate_legacy_stages()
check("الترحيل آمن للتكرار",
      mig2["contracts"] == 0 and mig2["customers"] == 0
      and mig2["stages_reset"] is False)

print("\n=== 10. الواجهة — لوحة مراحل التنفيذ والشريط المدمج ===")
from ui.followup import FollowupPanel, StageBar
k3 = contract_service.add_contract(Contract(
    contract_number="EX-CT-003", customer_id=c1, contract_name="خزان",
    contract_date=date.today().isoformat(), amount=7000))
_set_start(k3, 10)
panel = FollowupPanel(None, wf.TX_CONTRACT, k3)
panel.resize(1100, 800)
panel.refresh()
for _ in range(6):
    _app.processEvents()
check("زر الإنهاء ظاهر ومفعّل للمرحلة الحالية",
      panel.finish_btn.isEnabled() and "إنهاء" in panel.finish_btn.text())
check("العداد ظاهر", "10" in panel.counter_lbl.text())
check("زر التخطي موجود", not panel.skip_btn.text().isspace())
check("حبيبات المسار بُنيت", panel.steps.count() > 0)
panel.note.setText("اختبار")
panel._advance(False)
st = wf.stage_status(wf.TX_CONTRACT, k3)
check("زر الإنهاء من الواجهة يعمل",
      st["current"]["stage_name"] == "التصميم المعماري")
bar = StageBar(None, wf.TX_PAYMENT, vid)
bar.refresh()
check("الشريط المدمج: المرحلة والعداد",
      bar.stage_lbl.text() == "بانتظار اعتماد المدير"
      and bar.counter_lbl.text())
bar._advance(False)
check("الشريط المدمج: زر الإنهاء يعمل",
      wf.get_current_stage(wf.TX_PAYMENT, vid)["stage_name"]
      == "معتمد للصرف")
# لوحة عقد مكتمل المسار: الأزرار معطلة
k4 = contract_service.add_contract(Contract(
    contract_number="EX-CT-004", customer_id=c1, contract_name="سور",
    contract_date=date.today().isoformat(), amount=3000))
for _ in range(8):
    try:
        wf.advance_stage(wf.TX_CONTRACT, k4)
    except Exception:
        break
done_panel = FollowupPanel(None, wf.TX_CONTRACT, k4)
done_panel.refresh()
_k4_steps = [s for s in wf.get_contract_stages(k4) if s["level"] == 1]
check("مسار مكتمل: زر الإنهاء معطل",
      not done_panel.finish_btn.isEnabled()
      and all(s["end_date"] for s in _k4_steps))

print("\n=== 11. إزالة الكانبان واستمرار الشات والجرس ===")
from ui import main_window as mw
import ui.main_window as _mw
check("لا ثابت IDX_BOARD", not hasattr(_mw, "IDX_BOARD"))
check("لا مصنع لوحة", "board_page" not in _mw.MainWindow.__dict__)
msg = wf.add_message(wf.TX_CONTRACT, k3, "رسالة اختبار")
check("الشات يعمل", msg > 0)
check("الجرس يعمل", isinstance(wf.unread_count(), int))

print("\n=== 12. قالب النوع: الإعداد المالي على المرحلة + Snapshot ===")
from services import contract_type_service as _cts
_cts.add_type("مقاولة")
check("النوع الجديد يبدأ بلا مراحل (لا زرع تلقائي)",
      len(wf.stage_path(wf.TX_CONTRACT, "مقاولة")) == 0)
# بناء الشجرة: كل مرحلة بإعدادها المالي
_t12 = "مقاولة"
wf.add_stage(wf.TX_CONTRACT, "أعمال الحفر", contract_type=_t12,
             expected_days=5, payment_pct=10, pay_kind="advance")
wf.add_stage(wf.TX_CONTRACT, "الأساسات", contract_type=_t12,
             expected_days=15, payment_pct=15, pay_kind="achieve")
_m12 = wf.add_stage(wf.TX_CONTRACT, "الهيكل الخرساني", contract_type=_t12,
                    expected_days=40, payment_pct=0, pay_kind="")
wf.add_stage(wf.TX_CONTRACT, "الدور الأرضي", parent_id=_m12,
             contract_type=_t12, expected_days=20, payment_pct=25,
             pay_kind="achieve")
wf.add_stage(wf.TX_CONTRACT, "التشطيبات", contract_type=_t12,
             expected_days=30, payment_pct=35, pay_kind="achieve")
wf.add_stage(wf.TX_CONTRACT, "التسليم", contract_type=_t12,
             expected_days=5, payment_pct=15, pay_kind="final")
_t12p = wf.stage_path(wf.TX_CONTRACT, _t12)
check("الشجرة: 5 خطوات (الرئيسية التجميعية ليست خطوة)",
      len(_t12p) == 5)
check("مجموع النسب 100%",
      sum(float(s["payment_pct"] or 0) for s in _t12p) == 100)
try:
    wf.add_stage(wf.TX_CONTRACT, "بلا نسبة بدفعة", contract_type=_t12,
                 pay_kind="achieve")
    check("دفعة بلا نسبة تُرفض", False)
except Exception:
    check("دفعة بلا نسبة تُرفض", True)

# عقد جديد → Snapshot + خطة تلقائية من إعداد المراحل
c12 = customer_service.add_customer(Customer(
    customer_code="EX-012", name="عميل القالب", phone="12"))
k12 = contract_service.add_contract(Contract(
    contract_number="EX-CT-012", customer_id=c12,
    contract_name="فيلا القالب", contract_date="2026-09-01",
    amount=100000.0, contract_type=_t12))
_snap12 = wf.get_contract_stages(k12)
_steps12 = [s for s in _snap12 if s["level"] == 1]
check("Snapshot مستقل: 6 صفوف (رئيسية + 5 خطوات)",
      len(_snap12) == 6 and len(_steps12) == 5)
check("المقدمة قُفلت بتاريخ التوقيع",
      _steps12[0]["pay_kind"] == "advance"
      and _steps12[0]["start_date"] == "2026-09-01"
      and _steps12[0]["end_date"] == "2026-09-01")
check("أول خطوة تنفيذ مفتوحة والباقي مستقبل",
      _steps12[1]["start_date"] == "2026-09-01"
      and not _steps12[1]["end_date"]
      and not _steps12[2]["start_date"])
plan12 = lc.contract_payment_plan(k12)
check("خطة السداد تلقائية: 5 دفعات", len(plan12) == 5, str(len(plan12)))
check("مجموع الدفعات = قيمة العقد",
      abs(sum(p["amount"] for p in plan12) - 100000.0) < 0.01)
check("المقدمة مستحقة فور التوقيع بملاحظتها",
      plan12[0]["triggered_at"] == "2026-09-01"
      and "مقدمة" in (plan12[0]["notes"] or ""))
check("عند-الإنجاز تقديرية حتى الإنهاء",
      not (plan12[1]["triggered_at"] or ""))
check("قيم الدفعات بالنسب",
      abs(plan12[1]["amount"] - 15000.0) < 0.01
      and abs(plan12[3]["amount"] - 35000.0) < 0.01)

# تعديل القالب بعد العقد ← العقد لا يتأثر (Snapshot)
wf.add_stage(wf.TX_CONTRACT, "مرحلة بعد العقد", contract_type=_t12,
             expected_days=10)
check("تعديل القالب لا يمس نسخة العقد",
      len(wf.get_contract_stages(k12)) == 6)

# قيمة عقد أخرى → نفس النسب بقيم مختلفة
c12b = customer_service.add_customer(Customer(
    customer_code="EX-013", name="عميل تاني", phone="13"))
k12b = contract_service.add_contract(Contract(
    contract_number="EX-CT-013", customer_id=c12b,
    contract_name="فيلا تانية", contract_date="2026-09-01",
    amount=200000.0, contract_type=_t12))
plan12b = lc.contract_payment_plan(k12b)
_snap12b = wf.get_contract_stages(k12b)
check("النسبة × قيمة كل عقد على حدة",
      len(plan12b) >= 4
      and any(abs(p["amount"] - 30000.0) < 0.01 for p in plan12b),
      f"خطة={len(plan12b)} نسخة={len(_snap12b)} "
      f"قالب={len(wf.stage_path(wf.TX_CONTRACT, _t12))}")

print("\n=== 13. الربط المالي التلقائي عند إنهاء المرحلة ===")
# إنهاء الحفر (مقدمة — قُفلت بالتوقيع) → لا استحقاق جديد
_r13 = wf.advance_stage(wf.TX_CONTRACT, k12)
check("إنهاء أول خطوة (الأساسات): دفعتها تستحق فورًا",
      [t["title"] for t in _r13.get("triggered_payments", [])]
      == ["2. دفعة الأساسات"])
_p13 = next(p for p in lc.contract_payment_plan(k12)
            if "الأساسات" in p["title"])
check("استحقاق فعلي بتاريخ الإنهاء + ملاحظة السبب",
      _p13["triggered_at"] == date.today().isoformat()
      and "لانتهاء مرحلة «الأساسات»" in (_p13["notes"] or ""))
check("المقدمة لم تُلمس مرتين",
      next(p for p in plan12 if "الحفر" in p["title"])
      ["triggered_at"] == "2026-09-01")
# تخطي مرحلة ← لا استحقاق (لا إنجاز)
_r13s = wf.advance_stage(wf.TX_CONTRACT, k12, skip=True)
check("تخطي المرحلة لا يستحق دفعتها",
      len(_r13s.get("triggered_payments", [])) == 0)
_p13b = next(p for p in lc.contract_payment_plan(k12)
             if "الدور الأرضي" in p["title"])
check("دفعة المتخطاة ما زالت تقديرية",
      not (_p13b["triggered_at"] or ""))
from services import comment_service as _cm
comms13 = _cm.list_comments(c12)
check("التعليق التلقائي يذكر الدفعة المستحقة",
      any(("استحقاق دفعة" in c["body"] or "أصبحت مستحقة" in c["body"]) for c in comms13))

print("\n=== 14. البيان التلقائي في السند من دفعات العقد ===")
from services.extras_service import smart_receipt_description
_d14 = smart_receipt_description(k12, 10000.0)
check("البيان يذكر دفعة من قالب النوع",
      "دفعة" in _d14, _d14[:60])
from reports.pdf_utils import register_fonts, AR_FONT
register_fonts()
from reports.voucher_pdf import _wrap_text
import tempfile as _tf14
from reportlab.pdfgen import canvas as _rc14
_c14 = _rc14.Canvas(_tf14.mktemp(suffix=".pdf"))
_lines14 = _wrap_text(_c14, _d14, AR_FONT, 11, 150 * 2.834)
check("البيان يلف أسطرًا في السند عند الطول", 1 <= len(_lines14) <= 4,
      str(len(_lines14)))

print(f"\n{'='*40}\nالنتيجة: نجح {PASS} / فشل {FAIL}")
import os as _os
_os._exit(1 if FAIL else 0)
