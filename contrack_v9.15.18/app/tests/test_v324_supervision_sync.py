# -*- coding: utf-8 -*-
"""V3.24: تطبيق الطابع الإشرافي للقالب على العقود القائمة."""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database.database as db

_tmpdir = tempfile.mkdtemp()
db.DATA_DIR = _tmpdir
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")
db.init_db()

from database.models import Contract, Customer  # noqa: E402
from services import contract_service as ks  # noqa: E402
from services import contract_type_service as cts  # noqa: E402
from services import customer_service as cs  # noqa: E402
from services import supervision_service as sup  # noqa: E402
from services import workflow_service as wf  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


# شجرة بلا طابع أولًا (تحاكي الماضي) ثم يُعلَّم القالب
cts.add_type("مزامنة")
_main = wf.add_stage(wf.TX_CONTRACT, "التنفيذ", contract_type="مزامنة")
_s1 = wf.add_stage(wf.TX_CONTRACT, "زيارات", contract_type="مزامنة",
                   parent_id=_main)
_s2 = wf.add_stage(wf.TX_CONTRACT, "تقارير", contract_type="مزامنة",
                   parent_id=_main)
wf.add_stage(wf.TX_CONTRACT, "توريد", contract_type="مزامنة",
             parent_id=_main)


def _mk(code, name, phone, ctype="مزامنة"):
    c = cs.add_customer(Customer(customer_code=code, name=name, phone=phone))
    k = ks.add_contract(Contract(contract_number=f"K-{code}",
                                 customer_id=c,
                                 contract_date="2026-01-01",
                                 description="عقد", amount=50000.0,
                                 contract_type=ctype))
    wf.on_contract_signed(k)
    return k


k_old = _mk("C-241", "عميل قديم", "55241222")
k_can = _mk("C-242", "عميل ملغي", "55242222")
k_other = _mk("C-243", "عميل نوع آخر", "55243222", ctype="نوع آخر")
with db.get_connection() as _c:
    _c.execute("UPDATE contracts SET status='ملغى' WHERE id=?", (k_can,))
    # تقدم فعلي على العقد القديم يجب حفظه
    _c.execute("UPDATE contract_stages SET start_date='2026-01-01',"
               " end_date='2026-02-01', closed_by='م. أحمد'"
               " WHERE contract_id=? AND name='زيارات'", (k_old,))
    _c.execute("UPDATE contract_stages SET sup_monthly=777"
               " WHERE contract_id=? AND name='تقارير'", (k_old,))
    _tid = _c.execute("SELECT id FROM contract_stages WHERE contract_id=?"
                      " AND name='توريد'", (k_old,)).fetchone()[0]
# وسم يدوي سابق يجب ألا يُمحى
sup.setup_stage_supervision(_tid, "2026-03-01", 500.0)
# الآن يُعلَّم القالب (تحاكي تعديل الإعدادات اليوم)
wf.update_stage(_s1, is_supervision=True, sup_monthly=2000.0)
wf.update_stage(_s2, is_supervision=True, sup_monthly=1000.0)

print("=== 1. المعاينة ===")
pv = wf.preview_supervision_sync("مزامنة")
check("عقد واحد يحتاج", pv["contracts_count"] == 1, str(pv))
check("مرحلتان تُوسمان", pv["matched"] == 2, str(pv["matched"]))
check("الملغي متخطى", pv["skipped_cancelled"] == 1)
check("القالب بلا طابع ← صفر",
      wf.preview_supervision_sync("نوع آخر")["contracts_count"] == 0)
# مرحلة يدوية ليست في القالب لا تظهر
check("اليدوية خارج القالب لا تُحسب",
      all("توريد" not in c["stages"] for c in pv["contracts"]))

print("=== 2. التطبيق ===")
rep = wf.apply_supervision_sync("مزامنة")
check("النتيجة", rep["contracts"] == 1 and rep["stages"] == 2, str(rep))
with db.get_connection() as _c2:
    _rows = {r["name"]: (r["is_supervision"], r["sup_monthly"],
                         r["start_date"], r["end_date"], r["closed_by"])
             for r in _c2.execute(
                 "SELECT name, is_supervision, sup_monthly, start_date,"
                 " end_date, closed_by FROM contract_stages"
                 " WHERE contract_id=?", (k_old,)).fetchall()}
    _ev = _c2.execute("SELECT COUNT(*) FROM contract_events"
                      " WHERE contract_id=? AND event_type LIKE '%طابع%'",
                      (k_old,)).fetchone()[0]
    _can_rows = _c2.execute("SELECT COUNT(*) FROM contract_stages"
                            " WHERE contract_id=? AND is_supervision=1",
                            (k_can,)).fetchone()[0]
    _other_rows = _c2.execute("SELECT COUNT(*) FROM contract_stages"
                              " WHERE contract_id=?", (k_other,)).fetchone()[0]
check("الطابع + قيمة القالب", _rows["زيارات"][:2] == (1, 2000.0),
      str(_rows["زيارات"]))
check("التقدم محفوظ", _rows["زيارات"][2:] == ("2026-01-01", "2026-02-01",
                                              "م. أحمد"),
      str(_rows["زيارات"]))
check("القيمة اليدوية لا تُكتب فوقها", _rows["تقارير"][:2] == (1, 777.0),
      str(_rows["تقارير"]))
check("الوسم اليدوي باقٍ", _rows["توريد"][:2] == (1, 500.0),
      str(_rows["توريد"]))
check("حدث في السجل", _ev >= 1, str(_ev))
check("الملغي والنوع الآخر سليمان", _can_rows == 0 and _other_rows == 0,
      f"{_can_rows}/{_other_rows}")
check("التطبيق الثاني لا يكرر",
      wf.apply_supervision_sync("مزامنة")["stages"] == 0)

print("=== 3. زر الإعدادات ===")
from ui.settings import SettingsPage  # noqa: E402

check("المعالج موجود", hasattr(SettingsPage, "_wf_sup_sync"))

print(f"\nالنتيجة: {PASS} ناجح / {FAIL} فاشل")
sys.exit(1 if FAIL else 0)
