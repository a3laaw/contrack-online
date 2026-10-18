# -*- coding: utf-8 -*-
"""V4.5.07/08 + V6.4: تاب «الدفعات والمقاولون».

يغطي:
  ① التنقل: تاب واحد «الدفعات والمقاولون» بلا تابات قديمة.
  ② جدولان متوازيان (V6.4: 5 أعمدة متطابقة) مع صف أفقي ممتد باسم
    العميل/المقاول أعلى مراحله — كل دفعة مقابل نظيرتها على نفس الصف.
  ③ الحالات صريحة (مدفوع/مستحقة/انتظار/جزئي أو متأخر).
  ④ بلا أزرار دفعات/تعديل/حذف/توزيع/مصادر — وفوق كل جدول زر سنده:
    «＋ سند قبض» فوق العميل و«＋ سند صرف» فوق المقاولين (V6.4).
  ⑤ لا قسم بنود في التاب (البنود تُدخل مع عقد العميل وتُربط عند الإنشاء).
  ⑥ التحفيز الفوري: إنهاء مرحلة يدويًا يظهر في الجدولين مباشرة (V4.5.05).
  ⑦ صفحة «مقاولو الباطن»: زر إنشاء عقد الباطن موجود فيها.
"""
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import database.database as db  # noqa: E402

if os.path.isdir("data"):
    import shutil  # noqa: E402
    shutil.rmtree("data")
db.init_db()

from PySide6.QtCore import Qt  # noqa: E402
from database.database import get_connection  # noqa: E402
from database.models import Contract, Customer  # noqa: E402
from services import contract_service as cs  # noqa: E402
from services import customer_service, workflow_service as wf  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS " + name)
    else:
        FAIL += 1
        print("  FAIL " + name + (" | " + str(detail) if detail else ""))


TODAY = date.today().isoformat()
cust = customer_service.add_customer(
    Customer(customer_code="C-V7", name="عميل العرض", phone="90007"))
s1 = wf.add_stage("contract", "مرحلة أ", contract_type="TV7")
s2 = wf.add_stage("contract", "مرحلة ب", contract_type="TV7")
with get_connection() as c:
    for i, s in ((1, s1), (2, s2)):
        c.execute(
            "INSERT INTO type_payment_tpl (contract_type, pay_no, title, pct,"
            " amount_fixed, trigger_stage_id) VALUES (?,?,?,?,?,?)",
            ("TV7", i, f"دفعة {i}", 0, 100.0, s))
    c.execute("INSERT INTO subcontractors (sub_code, name, phone)"
              " VALUES (?,?,?)", ("S-V7", "مقاول العرض", "1"))
    sub_id = c.execute("SELECT id FROM subcontractors WHERE sub_code=?",
                       ("S-V7",)).fetchone()["id"]

k = cs.add_contract(Contract(
    contract_number="CON-V7", customer_id=cust,
    contract_date="2026-01-01", contract_type="TV7",
    description="x", amount=200.0), manual_path=True)
b1 = lc.add_boq_item(k, "بند الألف", 1, "", 60.0)
b2 = lc.add_boq_item(k, "بند الباء", 1, "", 60.0)
b3 = lc.add_boq_item(k, "بند غير موزّع", 1, "", 80.0)
sub = lc.add_sub_contract(sub_id, k, None, 200.0, TODAY, TODAY, "باطن",
                          boq_item_ids=[b1, b2])
lc.distribute_sub_plan(sub)

from PySide6.QtCore import QPoint  # noqa: E402
from PySide6.QtWidgets import QApplication, QLabel, QPushButton  # noqa: E402
from ui import style  # noqa: E402
from ui.contract_hub import ContractHubPage  # noqa: E402

app = QApplication.instance() or QApplication([])
hub = ContractHubPage()
hub.load_contract(k)
app.processEvents()

print("=== 1. التنقل ===")
check("التابات: مراحل/ملخص/دفعات/ملاحق",
      sorted(hub._page_index.keys()) == ["addendums", "info", "pay", "stages"],
      sorted(hub._page_index.keys()))
check("عنوان التاب الموحد",
      hub.nav.buttons["pay"].text() == "الدفعات والمقاولون")
hub.open_page = None
hub._switch_page("pay")
app.processEvents()
check("التاب يُفتح", hub._current_key() == "pay")

print("=== 2. الجدول الموحّد: صف لكل دفعة (العميل ⇄ المقاول) — V6.5 ===")
check("كتلة واحدة لكل مقاول على العقد",
      len(hub._pay_blocks) >= 1
      and all(b["table"] is not None for b in hub._pay_blocks),
      len(hub._pay_blocks))
ct = st = hub.pay_tables[0]          # V6.5: جدول واحد يجمع الطرفين
check("الجدول الموحّد 9 أعمدة (المرحلة + 4 عميل + 4 مقاول)",
      ct.columnCount() == 9, ct.columnCount())
check("صف رؤوس المجموعات: العميل (span 5) + المقاول (span 4)",
      ct.columnSpan(0, 0) == 5 and ct.columnSpan(0, 5) == 4,
      (ct.columnSpan(0, 0), ct.columnSpan(0, 5)))
check("رأس مجموعة العميل يحمل اسم العميل",
      "عميل العرض" in ct.item(0, 0).text(), ct.item(0, 0).text())
check("رأس مجموعة المقاول يحمل اسم المقاول",
      "مقاول العرض" in ct.item(0, 5).text(), ct.item(0, 5).text())
_uni_heads = [ct.item(1, c).text() for c in range(ct.columnCount())]
check("رؤوس الأعمدة: المرحلة + (الدفعة/المبلغ/المسدّد/الحالة) × 2",
      _uni_heads == ["المرحلة", "الدفعة", "المبلغ", "المسدّد", "الحالة",
                     "الدفعة", "المبلغ", "المسدّد", "الحالة"], _uni_heads)
check("لا عمود «تحصيل العميل» ولا تاريخ استحقاق في أي مكان",
      "تحصيل العميل" not in _uni_heads and "الاستحقاق" not in _uni_heads)
check("صفا الدفعتين + رأس المجموعات + رأس العناوين + الإجمالي = 5 صفوف",
      ct.rowCount() == 5, ct.rowCount())
check("صف الإجمالي مدمج في أول عمودين",
      ct.columnSpan(ct.rowCount() - 1, 0) == 2
      and ct.item(ct.rowCount() - 1, 0).text() == "الإجمالي",
      (ct.columnSpan(ct.rowCount() - 1, 0),
       ct.item(ct.rowCount() - 1, 0).text()))
check("كل صف: دفعة العميل مقابل دفعة المقاول على نفس السطر",
      all(ct.item(r, 0) is not None and ct.item(r, 0).text().strip()
          and ct.item(r, 5) is not None for r in (2, 3)))
check("تذييل العميل يعرض الإجمالي والمسدَّد والمتبقي",
      "الإجمالي 200.000" in hub.client_foot_lbl.text()
      and "مسدَّد" in hub.client_foot_lbl.text(),
      hub.client_foot_lbl.text())
check("تذييل المقاولين موجز (إجمالي/مسدَّد/متبقٍ)",
      "الإجمالي 200.000" in hub.sub_foot_lbl.text()
      and "مسدَّد" in hub.sub_foot_lbl.text()
      and "بنود موزّعة" not in hub.sub_foot_lbl.text(),
      hub.sub_foot_lbl.text())
hub.show()
hub.resize(1700, 820)
app.processEvents()
hub._pay_relayout()
app.processEvents()
_cw = hub.pay_tables[0].viewport().width()
check("الجدول يأخذ عرض الصفحة كاملًا", _cw > 600, _cw)
check("حدود الأعمدة الدنيا محترمة (لا انضغاط)",
      all(hub.pay_tables[0].horizontalHeader().sectionSize(i) >= m
          for i, m in enumerate([120, 56, 64, 64, 56, 56, 64, 64, 56])),
      [hub.pay_tables[0].horizontalHeader().sectionSize(i)
       for i in range(9)])
# V6.4/V6.5: فوق كل كتلة زر سنده، والقبض في الشريط العلوي
_pay_btn = next((b for b in hub.findChildren(QPushButton)
                 if b.text() == "＋ سند صرف"), None)
_rec_btn = next((b for b in hub.findChildren(QPushButton)
                 if b.text() == "＋ سند قبض"), None)
check("زر «＋ سند صرف» في رأس كتلة المقاول",
      _pay_btn is not None
      and _pay_btn.mapTo(hub, QPoint(0, 0)).y() > 0
      and _pay_btn.mapTo(hub, QPoint(0, 0)).y()
      < ct.mapTo(hub, QPoint(0, 0)).y(),
      None if _pay_btn is None else
      (_pay_btn.mapTo(hub, QPoint(0, 0)).y(), ct.mapTo(hub, QPoint(0, 0)).y()))
check("زر «＋ سند قبض» في الشريط العلوي قبل الكتل",
      _rec_btn is not None
      and _rec_btn.mapTo(hub, QPoint(0, 0)).y() > 0
      and _rec_btn.mapTo(hub, QPoint(0, 0)).y()
      < ct.mapTo(hub, QPoint(0, 0)).y(),
      None if _rec_btn is None else
      (_rec_btn.mapTo(hub, QPoint(0, 0)).y(), ct.mapTo(hub, QPoint(0, 0)).y()))

print("=== 3. الحالات صريحة (V6.5: «انتظار») ===")
check("دفعة عميل غير مستحقة = «انتظار»", ct.item(2, 4).text() == "انتظار",
      ct.item(2, 4).text())
check("دفعة المقاول المقابلة = «انتظار» في نفس السطر",
      ct.item(2, 8).text() == "انتظار", ct.item(2, 8).text())
check("ملخص التاب موجز وبسطرين قصيرين",
      "لنا:" in hub.pay_sum_lbl.text()
      and "عليهم (مقاولون):" in hub.pay_sum_lbl.text()
      and len(hub.pay_sum_lbl.text()) < 160, hub.pay_sum_lbl.text())

print("=== 4. عرض فقط — لا أزرار إجراءات ===")
texts = [b.text() for b in hub.findChildren(QPushButton)]
for gone in ("＋ دفعة مقاول", "✎ تعديل الدفعة", "🗑 حذف الدفعة",
             "⚖ وزّع على المراحل", "🔗 مصادر الدفعة",
             "✎ بيانات عقد الباطن", "⬆ صرف للمقاول", "📂 سندات المقاول",
             "＋ إضافة بند", "🗑 حذف المحدد"):
    check(f"لا زر: {gone}", gone not in texts)
check("لا زر «＋ عقد باطن جديد» في التاب (انتقل لصفحة مقاولو الباطن)",
      "＋ عقد باطن جديد" not in texts)
check("زر «＋ سند قبض» فوق جدول العميل", "＋ سند قبض" in texts)
check("زر «＋ سند صرف» فوق جدول المقاولين", "＋ سند صرف" in texts)
exp = [b for b in hub.findChildren(QPushButton)
       if b.objectName() == "iconBtn" and b.text() == "📤"]
check("أيقونتا Excel (ملاحق + دفعات)", len(exp) == 2, len(exp))
from PySide6.QtWidgets import QAbstractItemView  # noqa: E402
check("لا تحرير مباشر في الجدولين (NoEditTriggers)",
      ct.editTriggers() == QAbstractItemView.NoEditTriggers
      and st.editTriggers() == QAbstractItemView.NoEditTriggers)

print("=== 5. بنود كل مقاول: جدول منفصل أسفل دفعاته (عرض فقط) ===")
# V6.4/V6.5 (طلب المستخدم): جدول بنود عقد الباطن أسفل جدول كل مقاول
_its = getattr(hub, "items_tables", [])
check("لكل مقاول جدول بنود أسفل جدوله الموحّد",
      len(_its) == len(hub.pay_tables) and len(_its) >= 1,
      (len(_its), len(hub.pay_tables)))
if _its:
    _ih = [ _its[0].horizontalHeaderItem(i).text()
            for i in range(_its[0].columnCount())]
    check("أعمدة جدول البنود", _ih == ["البند", "الوحدة", "الكمية", "سعر الوحدة",
                                       "الإجمالي"], _ih)
    check("بنود المقاول معروضة بالوصف والكمية",
          _its[0].rowCount() >= 1 and _its[0].item(0, 0) is not None
          and bool(_its[0].item(0, 0).text().strip()),
          _its[0].rowCount())
    from PySide6.QtWidgets import QAbstractItemView as _AIV
    check("جدول البنود للعرض فقط (NoEditTriggers)",
          _its[0].editTriggers() == _AIV.NoEditTriggers)
check("لا أزرار إضافة/حذف بنود",
      all(t not in [b.text() for b in hub.findChildren(QPushButton)]
          for t in ("＋ إضافة بند", "🗑 حذف المحدد")))

print("=== 6. التحفيز الفوري (V4.5.05) ===")
# V6.4/V6.5: الكتل تُعاد بناؤها مع كل تحديث ⇒ نأخذ مراجع جديدة
ct = st = hub.pay_tables[0]
with get_connection() as c:
    S1 = c.execute("SELECT id FROM contract_stages WHERE contract_id=? "
                   "ORDER BY id LIMIT 1", (k,)).fetchone()["id"]
wf.manual_close_stage(k, S1)
hub._dirty["pay"] = True
hub.refresh()
app.processEvents()
ct = st = hub.pay_tables[0]
r1 = next(r for r in range(ct.rowCount())
          if ct.item(r, 1) is not None and "دفعة 1" in ct.item(r, 1).text())
check("دفعة العميل صارت مستحقة", ct.item(r1, 4).text() in ("مستحقة", "مستحقّة"),
      ct.item(r1, 4).text())
check("ودفعة المقاول المقابلة في نفس السطر صارت مستحقة",
      ct.item(r1, 8).text() in ("مستحقة", "مستحقّة"), ct.item(r1, 8).text())
check("الملخص يعكس التحفيز",
      "لنا: مستحق 100.000" in hub.pay_sum_lbl.text(),
      hub.pay_sum_lbl.text())

print("=== 7. صفحة مقاولو الباطن ===")
from ui.subcontractors import SubcontractorsPage  # noqa: E402
page = SubcontractorsPage()
page.refresh()
page.show()
app.processEvents()
ptexts = [b.text() for b in page.findChildren(QPushButton)]
check("زر إنشاء عقد الباطن رجع", "＋ عقد باطن جديد" in ptexts, ptexts)
check("زر مقاول جديد موجود", "＋ مقاول جديد" in ptexts, ptexts)
check("لا زر صرف مكرر", "📤 سند صرف للمقاول" not in ptexts, ptexts)
check("السجل المالي موجود", "▦ السجل المالي" in ptexts, ptexts)
check("قائمة الصف فيها تعديل عقد الباطن",
      hasattr(page, "_edit") and hasattr(page, "_link")
      and hasattr(page, "_add"))

print("=== 8. لوحة «عقود العميل» الجانبية ضيقة ===")
from ui.archive import CustomerFileWidget  # noqa: E402
cf = CustomerFileWidget(customer=customer_service.get_customer(cust),
                        embedded=True)
cf.resize(1440, 830)
cf.show()
cf.load_customer(customer_service.get_customer(cust), open_page="contracts")
app.processEvents()
side = getattr(cf, "contracts_side_panel", None)
sp = getattr(cf, "contracts_splitter", None)
check("لوحة عقود العميل موجودة", side is not None)
if side is not None:
    side_width = sp.sizes()[0] if sp is not None and sp.count() > 1 else 0
    check("عرض لوحة عقود العميل ≤ 400 على شاشة عريضة",
          side.maximumWidth() <= 400 and (side_width <= 400),
          (side.maximumWidth(), side_width))
    check("تفاصيل العقد تأخذ المساحة الأكبر",
          side_width < (sp.sizes()[1] if sp is not None else 0),
          sp.sizes() if sp is not None else None)

print("=== 9. V6.3: وضوح الجداول عند الضيق + البقاء في نفس التاب ===")
# ① ضيق النافذة ⇒ الجدولان فوق بعض بعرض كامل كي لا يُقطع النص
hub.resize(1000, 820)
app.processEvents()
hub._pay_relayout()
app.processEvents()
check("نافذة ضيقة: الجدول يبقى بعرض الصفحة بلا ضغط (لا تراكب)",
      bool(hub._pay_stacked)
      and hub.pay_tables[0].viewport().width() > 500,
      (hub._pay_stacked, hub.pay_tables[0].viewport().width()))
hub.resize(1288, 820)      # مقاس شاشة المستخدم الفعلي
app.processEvents()
hub._pay_relayout()
app.processEvents()
check("مقاس المستخدم (1288): عرض مريح للجدول",
      not hub._pay_stacked and hub.pay_tables[0].viewport().width() > 800,
      (hub._pay_stacked, hub.pay_tables[0].viewport().width()))
_hh = hub.pay_tables[0].horizontalHeader()
_mins = [120, 56, 64, 64, 56, 56, 64, 64, 56]
_sizes = [_hh.sectionSize(i) for i in range(9)]
check("أعمدة الجدول الموحّد بلا انضغاط — كل عمود ≥ حدّه الأدنى",
      all(_sizes[i] >= _mins[i] for i in range(9)), _sizes)
hub.resize(1700, 820)
app.processEvents()
hub._pay_relayout()
app.processEvents()

# ② أي حركة داخل مركز العقد تبقى في نفس التاب (لا ترجع لأول مسار)
cf.contract_detail.load_contract(k, open_page="pay")
app.processEvents()
check("تحميل مباشر على تاب الدفعات", cf.contract_detail._current_key() == "pay",
      cf.contract_detail._current_key())
cf.contract_detail.data_changed.emit()      # نفس ما يحدث بعد أي حركة
app.processEvents()
check("بعد أي حركة: يبقى على تاب الدفعات (لا يرجع لأول مسار)",
      cf.contract_detail._current_key() == "pay",
      cf.contract_detail._current_key())

# ③ تاب المسار اليدوي يبقى مفتوحًا بعد التحديث
# نضيف مجموعتين رئيستين (level=0) ليكون في المسار اليدوي تابان فعليان
with get_connection() as c:
    for _i, _n in ((9, "المجموعة الأولى"), (10, "المجموعة الثانية")):
        c.execute(
            "INSERT INTO contract_stages (contract_id, name, level, sort_order)"
            " VALUES (?,?,0,?)", (k, _n, _i))
_pf = hub.followup_panel
_pf.refresh()
app.processEvents()
_n_tabs = _pf.manual_tabs.count()
check("المسار اليدوي: تابان للمجموعتين", _n_tabs >= 2, _n_tabs)
try:
    _pf.manual_tabs.setCurrentIndex(1)
    _pf.refresh()
    app.processEvents()
    check("بعد التحديث: يبقى على نفس تاب المسار (لا يرجع لأول مسار)",
          _pf.manual_tabs.currentIndex() == 1,
          _pf.manual_tabs.currentIndex())
except Exception as _exc:
    check("بعد التحديث: يبقى على نفس تاب المسار (لا يرجع لأول مسار)",
          False, repr(_exc))

print(f"\nV4.5.07 pay view: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
