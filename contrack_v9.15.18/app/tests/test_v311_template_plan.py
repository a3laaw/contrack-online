# -*- coding: utf-8 -*-
"""V3.11: توحيد خطة الدفعات من الإعدادات في تعديل العقد.

العرض الكامل/الإخفاء/المزامنة عند الحفظ/الحفظ المسمّى/الترتيب/التوحيد/فك الحبس.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

passed = failed = 0


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ✅ {name}")
    else:
        failed += 1
        print(f"  ❌ {name} {extra}")


import database.database as db  # noqa: E402

db.DB_PATH = "/tmp/v311.sqlite"
for _s in ("", "-shm", "-wal"):
    if os.path.exists("/tmp/v311.sqlite" + _s):
        os.remove("/tmp/v311.sqlite" + _s)
db.init_db()

from database.database import get_connection  # noqa: E402
from database.models import Contract, Customer  # noqa: E402
from services import contract_service, customer_service  # noqa: E402
from services import contract_type_service as cts  # noqa: E402
from services import feature_service as feat  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402
from services import workflow_service as wf  # noqa: E402
from services.backup_service import get_backup_dir  # noqa: E402

c = customer_service.add_customer(Customer(
    customer_code="C-311", name="عميل التوحيد", phone="91311001"))
cts.add_type("قالب 311", manual_track=True)   # V4.5.13: واجهة السحب لليدوي
cts.add_type("قالب 311ب", manual_track=True)
cts.add_type("بلا قالب 311")
cts.add_type("بنود 311", pricing_mode=cts.MODE_ITEMS)
wf.add_stage("contract", "مرحلة أولى", contract_type="قالب 311")
wf.add_stage("contract", "مرحلة ثانية", contract_type="قالب 311")
wf.add_stage("contract", "مرحلة وحيدة", contract_type="قالب 311ب")
with get_connection() as x:
    x.execute("INSERT INTO type_payment_tpl (contract_type, pay_no, title, pct)"
              " VALUES (?,?,?,?)", ("قالب 311", 1, "دفعة أولى", 60.0))
    x.execute("INSERT INTO type_payment_tpl (contract_type, pay_no, title, pct)"
              " VALUES (?,?,?,?)", ("قالب 311", 2, "دفعة ثانية", 40.0))
    x.execute("INSERT INTO type_payment_tpl (contract_type, pay_no, title)"
              " VALUES (?,?,?)", ("قالب 311", 3, "دفعة مرنة"))
    x.execute("INSERT INTO type_payment_tpl (contract_type, pay_no, title, pct)"
              " VALUES (?,?,?,?)", ("قالب 311ب", 1, "دفعة وحيدة", 100.0))
kc = contract_service.add_contract(Contract(
    contract_number="U-C", customer_id=c, contract_date="2026-09-01",
    description="ع", amount=1000.0, contract_type="قالب 311"))
kd = contract_service.add_contract(Contract(
    contract_number="U-D", customer_id=c, contract_date="2026-09-01",
    description="ع", amount=1000.0, contract_type="قالب 311"))
ki = contract_service.add_contract(Contract(
    contract_number="U-I", customer_id=c, contract_date="2026-09-01",
    description="ع", amount=500.0, contract_type="بنود 311"))
kn = contract_service.add_contract(Contract(
    contract_number="U-N", customer_id=c, contract_date="2026-09-01",
    description="ع", amount=300.0, contract_type="بلا قالب 311"))
kt = contract_service.add_contract(Contract(
    contract_number="U-T", customer_id=c, contract_date="2026-09-01",
    description="ع", amount=1000.0, contract_type="قالب 311"))
# kd: تباين قديم — يدوي + مثار + مرن + زائدة + مكرر
with get_connection() as x:
    _rows = x.execute("SELECT id, sort_order FROM payment_plan "
                      "WHERE contract_id=? ORDER BY sort_order, id",
                      (kd,)).fetchall()
    _by_no = {}
    for _r in _rows:
        _by_no.setdefault(int(_r["sort_order"]), []).append(int(_r["id"]))
    x.execute("UPDATE payment_plan SET amount=?, manual_amount=1 "
              "WHERE id=?", (550.0, _by_no[1][0]))
    x.execute("UPDATE payment_plan SET triggered_at=? WHERE id=?",
              ("2026-09-10", _by_no[2][0]))
    x.execute("INSERT INTO payment_plan (contract_id, title, due_date,"
              " amount, sort_order) VALUES (?,?,?,?,?)",
              (kd, "دفعة مرنة فعلية", "2026-10-01", 75.0, 3))
    x.execute("INSERT INTO payment_plan (contract_id, title, due_date,"
              " amount, sort_order) VALUES (?,?,?,?,?)",
              (kd, "دفعة زائدة", "2026-10-01", 100.0, 5))
    x.execute("INSERT INTO payment_plan (contract_id, title, due_date,"
              " amount, sort_order) VALUES (?,?,?,?,?)",
              (kd, "صف مكرر", "2026-10-01", 50.0, 1))
lc.add_boq_item(ki, "بند أصلي", 1, "", 500.0)

from PySide6.QtWidgets import QApplication  # noqa: E402
from PySide6.QtWidgets import QMessageBox as _QMB311  # noqa: E402
# V5.3: نافذة «فرق بين المبلغ والمجموع» تُغلق تلقائيًا بخيار «حفظ بالفرق»
# (نفس خيار المستخدم في الحالة الطبيعية) — بلا نوافذ مودالية في الفحص.
_QMB311.exec = lambda self: 0
_QMB311.clickedButton = lambda self: next(
    (b for b in self.buttons() if "حفظ بالفرق" in (b.text() or "")), None)
app = QApplication.instance() or QApplication([])
from ui.contracts import ContractDialog  # noqa: E402
import ui.style as _style  # noqa: E402

_orig_conf, _orig_info, _orig_err = (_style.confirm, _style.info,
                                     _style.error)
_bdir = get_backup_dir()
_before_files = set(os.listdir(_bdir)) if os.path.isdir(_bdir) else set()

print("=== 1. العرض الكامل للقالب رغم التباين ===")
dd = ContractDialog(None, contract_service.get_contract(kd))
app.processEvents()
# V5.3: التعديل يعرض دفعات العقد الفعلية (5 صفوف لهذا العقد المتضارب)
# بمبالغها الحقيقية بدل أرقام القالب — قرار صاحب النظام 2026-10-06.
_txts = [dd.plan_table.item(r, 3).text()
         for r in range(dd.plan_table.rowCount())]
check("5 صفوف فعلية بمبالغها (لا قالب)",
      dd.plan_table.rowCount() == 5
      and "550.000" in _txts and "400.000" in _txts
      and "75.000" in _txts and "100.000" in _txts and "50.000" in _txts,
      _txts)
check("بلا نص «الفعلي» مقصوص",
      not any("الفعلي" in t for t in _txts), _txts)
check("بلا فلترة قديمة",
      "محذوفة من الفعلي" not in dd.plan_auto_lbl.text())

print("=== 2. الإخفاء للقالب والظهور لليدوي ===")
check("القالب بلا أزرار",
      dd.plan_add_btn.isHidden() and dd.plan_del_btn.isHidden()
      and not hasattr(dd, "plan_unlock_btn"))
dn = ContractDialog(None, contract_service.get_contract(kn))
app.processEvents()
check("اليدوي بأزرار ظاهرة",
      dn._plan_tpl_mode is False
      and not dn.plan_add_btn.isHidden()
      and not dn.plan_del_btn.isHidden())

print("=== 3. تعديل الخلية يبقى + يُعلَّم يدويًا ===")
_conf_calls = []
_style.confirm = lambda *a, **k: (_conf_calls.append(1), True)[1]
try:
    dc = ContractDialog(None, contract_service.get_contract(kc))
    app.processEvents()
    dc.plan_table.item(0, 3).setText("500.000")
    app.processEvents()
    dc.plan_table.item(1, 3).setText("500.000")
    app.processEvents()
    dc._save()
    app.processEvents()
finally:
    _style.confirm = _orig_conf
with get_connection() as x:
    _flags = x.execute("SELECT amount, manual_amount FROM payment_plan "
                       "WHERE contract_id=? ORDER BY sort_order",
                       (kc,)).fetchall()
check("حُفظ 500/500",
      [float(r["amount"]) for r in _flags] == [500.0, 500.0],
      [float(r["amount"]) for r in _flags])
check("عُلّما يدويًا (خالفا القالب)",
      [int(r["manual_amount"]) for r in _flags] == [1, 1],
      [int(r["manual_amount"]) for r in _flags])
check("لا تأكيد (لا فرق مادي)", _conf_calls == [], _conf_calls)

print("=== 4. المزامنة عند الحفظ + الحفظ المسمّى ===")
_conf_texts, _infos = [], []
_style.confirm = lambda *a, **k: (_conf_texts.append(a[1] if len(a) > 1 else ""), True)[1]
_style.info = lambda *a, **k: _infos.append(a[1] if len(a) > 1 else "")
try:
    dd._save()
    app.processEvents()
finally:
    _style.confirm = _orig_conf
    _style.info = _orig_info
_after = sorted((int(r.get("sort_order") or 0), float(r["amount"]))
                for r in lc.contract_payment_plan(kd))
check("بعد: 550 يدوي + 400 مثارة + 75 مرنة",
      _after == [(1, 550.0), (2, 400.0), (3, 75.0)], _after)
check("التأكيد قبل/بعد",
      any("قبل:" in t and "بعد:" in t for t in _conf_texts))
check("التأكيد يسمّي المحفوظ",
      any("مستحقة فعلًا" in t and "يدوية" in t and "مرنة" in t
          for t in _conf_texts), _conf_texts)
check("التقرير يذكر النسخة",
      any("النسخة الاحتياطية" in t for t in _infos))

print("=== 5. الترتيب: الفشل لا يكتب شيئًا ===")
feat.set_many({"amount_guard": False})
_errs = []
_style.error = lambda *a, **k: _errs.append(a[-1])
try:
    dn5 = ContractDialog(None, contract_service.get_contract(kn))
    dn5.show()
    app.processEvents()
    from PySide6.QtWidgets import QTableWidgetItem as _QTI  # noqa: E402
    dn5.items_table.setRowCount(1)
    dn5.items_table.setItem(0, 0, _QTI("بند فرق"))
    dn5.items_table.setItem(0, 1, _QTI("1000"))
    app.processEvents()
    dn5.amount.setValue(1500.0)
    dn5._save()
    app.processEvents()
finally:
    _style.error = _orig_err
    feat.set_many({"amount_guard": True})
check("مُنع بخطأ", bool(_errs) and "عدّل القيم" in str(_errs[-1]),
      _errs[-1:])
check("القيمة والبنود والخطة لم تُمسّ",
      contract_service.get_contract(kn).amount == 300.0
      and contract_service.items_count(kn) == 0
      and lc.contract_payment_plan(kn) == [])

print("=== 6. التوحيد عند الفتح: القالب أولًا ===")
lc.add_boq_item(kc, "بند دخيل", 1, "", 50.0)
du = ContractDialog(None, contract_service.get_contract(kc))
app.processEvents()
check("قالب + بنود محفوظة ← مقطوعية",
      du._mode == "lump" and du._items_box.isHidden() is True,
      (du._mode, du._items_box.isHidden()))
check("الشارة مقطوعية القالب",
      "مبلغ مقطوع بخطة دفعات" in du.mode_banner.text(),
      du.mode_banner.text())
du.ctype.setCurrentIndex(du.ctype.findData("قالب 311"))
app.processEvents()
check("لمس النوع لا يقلب (ثبات)",
      du._mode == "lump" and du._items_box.isHidden() is True)
dn6 = ContractDialog(None, contract_service.get_contract(kn))
app.processEvents()
check("بلا قالب: الوضع الأصلي untouched",
      dn6._mode == contract_service.contract_mode(
          contract_service.get_contract(kn)), dn6._mode)

print("=== 7. فك حبس البند الأخير ===")
_conf2 = []
_style.confirm = lambda *a, **k: (_conf2.append(a[1] if len(a) > 1 else ""), True)[1]
try:
    di = ContractDialog(None, contract_service.get_contract(ki))
    app.processEvents()
    check("وضع البنود", di._mode == "items", di._mode)
    di.items_table.setRowCount(0)
    di._save()
    app.processEvents()
finally:
    _style.confirm = _orig_conf
check("تأكيد المسح ظهر",
      any("سيُمسح" in t for t in _conf2), _conf2)
check("مُسح البند", contract_service.items_count(ki) == 0)
lc.add_boq_item(ki, "بند راجع", 1, "", 500.0)
_style.confirm = lambda *a, **k: False
try:
    di2 = ContractDialog(None, contract_service.get_contract(ki))
    app.processEvents()
    di2.items_table.setRowCount(0)
    di2._save()
    app.processEvents()
finally:
    _style.confirm = _orig_conf
check("الرفض يُبقي البند", contract_service.items_count(ki) == 1)

print("=== 8. عقد جديد بلا بنود: خطأ لا تأكيد ===")
_errs2, _conf3 = [], []
_style.error = lambda *a, **k: _errs2.append(a[-1])
_style.confirm = lambda *a, **k: (_conf3.append(1), True)[1]
try:
    dnew = ContractDialog(None)
    app.processEvents()
    dnew.customer.select_data(c)
    dnew.ctype.setCurrentIndex(dnew.ctype.findData("بنود 311"))
    app.processEvents()
    dnew.amount.setValue(500.0)
    dnew._save()
    app.processEvents()
finally:
    _style.error = _orig_err
    _style.confirm = _orig_conf
check("خطأ «أضف بندًا»",
      bool(_errs2) and "أضف بندًا" in str(_errs2[-1]), _errs2[-1:])
check("بلا تأكيد", _conf3 == [])

print("=== 9. اليدوي يُحفظ بلا مزامنة ===")
_conf4 = []
_style.confirm = lambda *a, **k: (_conf4.append(1), True)[1]
try:
    dn9 = ContractDialog(None, contract_service.get_contract(kn))
    app.processEvents()
    dn9._save()
    app.processEvents()
finally:
    _style.confirm = _orig_conf
check("لا تأكيد إطلاقًا", _conf4 == [], _conf4)

print("=== 10. تغيير النوع: إعادة بناء لا مزامنة ===")
_conf5, _infos5 = [], []
_style.confirm = lambda *a, **k: (_conf5.append(a[1] if len(a) > 1 else ""), True)[1]
_style.info = lambda *a, **k: _infos5.append(a[1] if len(a) > 1 else "")
try:
    dt = ContractDialog(None, contract_service.get_contract(kt))
    app.processEvents()
    dt.ctype.setCurrentIndex(dt.ctype.findData("قالب 311ب"))
    app.processEvents()
    dt._save()
    app.processEvents()
finally:
    _style.confirm = _orig_conf
    _style.info = _orig_info
check("تأكيد إعادة البناء ظهر",
      any("سيُعاد بناء" in t for t in _conf5), _conf5)
check("لا تأكيد مزامنة",
      not any("تختلف عن قالب النوع" in t for t in _conf5))
_tplan = [float(r["amount"]) for r in lc.contract_payment_plan(kt)]
check("الخطة من القالب الجديد", _tplan == [1000.0], _tplan)

_new_files = ([f for f in (set(os.listdir(_bdir)) - _before_files)
               if f.startswith("pre_")] if os.path.isdir(_bdir) else [])
check("نسخ احتياطية للمزامنة وإعادة البناء",
      any(f.startswith("pre_plan_sync_") for f in _new_files)
      and any(f.startswith("pre_type_change_") for f in _new_files),
      _new_files)
for f in _new_files:
    os.remove(os.path.join(_bdir, f))

print(f"\nالنتيجة: نجح {passed} / فشل {failed}")
os._exit(1 if failed else 0)
