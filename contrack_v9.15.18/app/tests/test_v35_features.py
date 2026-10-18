# -*- coding: utf-8 -*-
"""V3.5 (يُحدَّث في V3.13): شاشة المزايا — الأعلام الجديدة وربطها الحقيقي.

V3.13: تقاعد علم settlements_report (حُذف زر التقرير المكرر).
1) الكتالوج: 9 أعلام جديدة بافتراضي ON وتبعيات سليمة.
2) التبعيات: إطفاء الأب يُعطّل الابن عبر enabled().
3) الربط: الإطفاء يُخفي الواجهة ويوقف الأثر.
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

db.DB_PATH = "/tmp/v35.sqlite"
for _s in ("", "-shm", "-wal"):
    if os.path.exists("/tmp/v35.sqlite" + _s):
        os.remove("/tmp/v35.sqlite" + _s)
db.init_db()

from PySide6.QtWidgets import QApplication, QPushButton  # noqa: E402

app = QApplication.instance() or QApplication([])

from services import auth_service  # noqa: E402
from services import feature_service as feat  # noqa: E402

NEW_KEYS = {"payment_gateway", "custody", "contract_gaps",
            "template_plan_mode", "settle_edit",
            "notif_cleanup", "amount_guard", "items_sync", "mode_banner"}


def _restore():
    feat.set_many({k: True for k in NEW_KEYS})
    feat.set_many({"payment_plan": True, "boq_items": True})


_restore()

print("=== 1. الكتالوج ===")
check("الأعلام التسعة موجودة", NEW_KEYS <= set(feat.FEATURES),
      NEW_KEYS - set(feat.FEATURES))
check("الافتراضي ON للكل",
      all(feat.FEATURES[k]["default"] is True for k in NEW_KEYS))
check("مفعّلة فعليًا",
      all(feat.enabled(k) is True for k in NEW_KEYS))
_groups = {v["group"] for v in feat.FEATURES.values()}
check("المجموعات معروفة",
      _groups <= {"الشاشات", "داخل العقد", "المالية", "التقارير",
                  "أدوات"}, _groups)
_bad = [(k, r) for k, v in feat.FEATURES.items()
        for r in v["requires"] if r not in feat.FEATURES]
check("كل التبعيات موجودة", not _bad, _bad)
_got = {k for items in feat.grouped().values() for k, _v in items}
check("grouped() يشمل الجديدة (تظهر في الشاشة)", NEW_KEYS <= _got)

print("=== 2. التبعيات ===")
feat.set_many({"custody": False})
check("إطفاء العهدة يُعطّل تعديل التصفية",
      feat.enabled("settle_edit") is False)
feat.set_many({"custody": True, "payment_plan": False})
check("إطفاء خطة الدفع يُعطّل وضع القالب",
      feat.enabled("template_plan_mode") is False)
check("إطفاء خطة الدفع يُعطّل المزامنة",
      feat.enabled("items_sync") is False)
_restore()
check("الاستعادة تُعيد الكل",
      all(feat.enabled(k) is True for k in NEW_KEYS))

print("=== 3. الربط: التنقل ===")
_op = auth_service.has_permission
_oa = auth_service.is_admin
auth_service.has_permission = lambda *a, **k: True  # noqa: E731
auth_service.is_admin = lambda: True  # noqa: E731
try:
    from ui.main_window import MainWindow

    feat.set_many({"payment_gateway": False, "custody": False})
    w = MainWindow()
    w.show()
    app.processEvents()
    _names = [b.text() for b in w.findChildren(QPushButton)]
    check("لا زر بوابة الدفع عند الإطفاء",
          not any("بوابة الدفع" in t for t in _names))
    check("لا زر عُهد عند الإطفاء",
          not any("العُهد" in t or "العهد والتصفيات" in t
                  for t in _names))
    _restore()

    print("=== 4. الربط: الجرس ===")
    w = MainWindow()
    feat.set_many({"notif_cleanup": False})
    _kinds = [k for k, _t, _d in w._notification_menu_items()]
    check("بند المسح غائب عند الإطفاء", "clear" not in _kinds, _kinds)
    feat.set_many({"notif_cleanup": True})
    _kinds2 = [k for k, _t, _d in w._notification_menu_items()]
    check("بند المسح حاضر عند التشغيل", "clear" in _kinds2, _kinds2)

    print("=== 5. الربط: العهدة والمركز ===")
    from ui.custody_center import CustodyCenterPage
    # V3.13: لا زر تقرير مكرر — التاب العلوي يكفي.
    pg = CustodyCenterPage()
    pg.show()
    app.processEvents()
    check("لا زر تقرير مكرر في الكشف", not hasattr(pg, "report_btn"))

    from ui.contract_hub import ContractHubPage
    feat.set_many({"contract_gaps": False})
    h = ContractHubPage()
    check("زر الفروقات غائب",
          "⚠️ الفروقات" not in [b.text()
                               for b in h.findChildren(QPushButton)])
    feat.set_many({"contract_gaps": True})
    h2 = ContractHubPage()
    check("زر الفروقات حاضر",
          "⚠️ الفروقات" in [b.text()
                            for b in h2.findChildren(QPushButton)])

    print("=== 6. الربط: حوار العقد ===")
    import services.contract_service as ct  # noqa: E402
    import services.customer_service as cs  # noqa: E402
    import services.workflow_service as wf  # noqa: E402
    from ui.contracts import ContractDialog  # noqa: E402

    import services.contract_type_service as cts  # noqa: E402
    cts.add_type("نوع قالب مزايا", manual_track=True)   # V4.5.13
    wf.add_stage("contract", "مرحلة مزايا",
                 contract_type="نوع قالب مزايا")
    cts.add_type("عام مزايا")
    wf.replace_contract_type_template("عام مزايا", mode="empty")
    cts.add_type("بنود قالب مزايا", pricing_mode=cts.MODE_ITEMS,
                 manual_track=True)   # V4.5.13
    wf.add_stage("contract", "م مزايا",
                 contract_type="بنود قالب مزايا")
    from database.models import Contract, Customer  # noqa: E402
    _cid = cs.add_customer(Customer(customer_code="C-V35",
                                    name="عميل مزايا", phone="9000"))
    _kid = ct.add_contract(Contract(
        contract_number="CON-V35", customer_id=_cid,
        contract_date="2026-01-01", description="عقد مزايا",
        amount=1000.0, contract_type="نوع قالب مزايا"))
    _kid2 = ct.add_contract(Contract(
        contract_number="CON-V35B", customer_id=_cid,
        contract_date="2026-01-01", description="عقد مزايا بلا قالب",
        amount=1000.0, contract_type="عام مزايا"))
    _kid3 = ct.add_contract(Contract(
        contract_number="CON-V35C", customer_id=_cid,
        contract_date="2026-01-01", description="عقد بنود بقالب",
        amount=1000.0, contract_type="بنود قالب مزايا"))

    feat.set_many({"template_plan_mode": False})
    d = ContractDialog(None, ct.get_contract(_kid))
    check("وضع القالب مطفأ = يدوي",
          d._plan_tpl_mode is False, d._plan_tpl_mode)
    feat.set_many({"template_plan_mode": True})
    d2 = ContractDialog(None, ct.get_contract(_kid))
    check("وضع القالب مفعّل = قالب",
          d2._plan_tpl_mode is True, d2._plan_tpl_mode)

    feat.set_many({"items_sync": False, "mode_banner": False})
    d3 = ContractDialog(None, ct.get_contract(_kid))
    d3.show()
    app.processEvents()
    check("الشارة مخفية", d3.mode_banner.isHidden() is True)
    # زر المزامنة داخل صندوق البنود — يُختبر بعقد بلا قالب (بنود ظاهرة)
    from PySide6.QtWidgets import QTableWidgetItem  # noqa: E402

    def _fill_sync(dlg):
        dlg.plan_table.setRowCount(1)
        dlg.plan_table.setItem(0, 3, QTableWidgetItem("1000"))
        dlg.items_table.setRowCount(1)
        dlg.items_table.setItem(0, 0, QTableWidgetItem("بند مزايا"))
        try:
            dlg._set_item_amount(0, 1000.0)
        except Exception:
            dlg.items_table.setItem(0, 1, QTableWidgetItem("1000"))
        app.processEvents()
        dlg._update_mode_banner()
        app.processEvents()

    # V3.11: القالب أولًا لحظة الفتح — نوع-البنود ذو القالب يُفتح مقطوعية.
    d0 = ContractDialog(None, ct.get_contract(_kid3))
    check("التوحيد عند الفتح: مقطوعية بلا قسم بنود",
          d0._mode == "lump" and d0._items_box.isHidden() is True,
          (d0._mode, d0._items_box.isHidden()))
    # الربط يُختبر بحالة مختلطة صريحة (الحشو الاصطناعي أصلًا).
    d3b = ContractDialog(None, ct.get_contract(_kid3))
    d3b.show()
    d3b._apply_mode("items", "", 0.0, False)
    _fill_sync(d3b)
    check("زر المزامنة مخفي", d3b.items_sync_btn.isHidden() is True)
    feat.set_many({"items_sync": True, "mode_banner": True})
    d4 = ContractDialog(None, ct.get_contract(_kid))
    d4.show()
    app.processEvents()
    check("الشارة ظاهرة", d4.mode_banner.isHidden() is False)
    d4b = ContractDialog(None, ct.get_contract(_kid3))
    d4b.show()
    d4b._apply_mode("items", "", 0.0, False)
    _fill_sync(d4b)
    check("زر المزامنة ظاهر", d4b.items_sync_btn.isHidden() is False,
          (d4b._plan_has_active_rows(), d4b._items_active()))

    print("=== 7. الربط: الحارس وتعديل التصفية ===")
    import ui.style as _style  # noqa: E402
    feat.set_many({"amount_guard": False})
    d5 = ContractDialog(None, ct.get_contract(_kid2))
    d5.show()
    app.processEvents()
    # عقد بلا قالب: لا خطة دفعات — الفرق عبر البنود
    d5.items_table.setRowCount(1)
    d5.items_table.setItem(0, 0, QTableWidgetItem("بند مزايا"))
    d5.items_table.setItem(0, 1, QTableWidgetItem("1000"))
    app.processEvents()
    d5._update_mode_banner()
    d5.amount.setValue(d5._items_total() + 500.0)  # فرق مؤكد
    _errs = []
    _oe = _style.error
    _style.error = lambda *a, **k: _errs.append(a[-1])  # noqa: E731
    try:
        d5._save()
    finally:
        _style.error = _oe
    check("المنع الصارم يعرض خطأ",
          bool(_errs) and "عدّل القيم" in str(_errs[-1]), _errs[-1:])
    feat.set_many({"amount_guard": True})

    feat.set_many({"settle_edit": False})
    _fake_ref = "PAY-GRP-TEST"  # البوابة ترفض قبل قراءة التصفية
    _infos = []
    _oi = _style.info
    _ow = getattr(_style, "warning", None)
    _style.info = lambda *a, **k: _infos.append(a[-1])  # noqa: E731
    if _ow is not None:
        _style.warning = lambda *a, **k: _infos.append(a[-1])  # noqa: E731
    try:
        pg3 = CustodyCenterPage()
        pg3.reload()
        pg3._visible = [{"type": "main",
                         "item": {"kind": "settlement",
                                  "ref": _fake_ref}}]
        pg3.table.setRowCount(1)
        pg3.table.blockSignals(True)
        pg3.table.setCurrentCell(0, 0)
        pg3.table.blockSignals(False)
        pg3._edit_selected()
    finally:
        _style.info = _oi
        if _ow is not None:
            _style.warning = _ow
    check("تعديل التصفية المعطّل يرفض برسالة",
          bool(_infos) and "معطّل" in str(_infos[-1]), _infos[-1:])
    _restore()
finally:
    auth_service.has_permission, auth_service.is_admin = _op, _oa
    _restore()

print(f"\nالنتيجة: نجح {passed} / فشل {failed}")
os._exit(1 if failed else 0)
