# -*- coding: utf-8 -*-
"""اختبار الدفعة 13: مركز العقد + البحث الشامل + الإعدادات وسير النوع — §10/§11."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from PySide6.QtCore import Qt  # noqa: E402
from PySide6.QtWidgets import QApplication, QPushButton  # noqa: E402

passed = failed = 0


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ✅ {name}")
    else:
        failed += 1
        print(f"  ❌ {name} {extra}")


app = QApplication.instance() or QApplication([])
from database.database import init_db  # noqa: E402

init_db()
from database.models import Contract, Customer  # noqa: E402
from services import contract_service, customer_service  # noqa: E402
from ui.contract_hub import ContractHubPage  # noqa: E402
from ui.global_search import GlobalSearchDialog  # noqa: E402
from ui.settings import SettingsPage  # noqa: E402
from ui.type_workflow import TypeWorkflowDialog  # noqa: E402

cid = customer_service.add_customer(Customer(
    customer_code="C-B13", name="عميل بحث ب13", phone="9013"))
con_id = contract_service.add_contract(Contract(
    contract_number="CON-B13", customer_id=cid,
    contract_date="2026-01-01", description="عقد ب13",
    amount=50000.0, contract_type="مقاولة عامة"))

print("=== 1. مركز العقد: الرموز ===")
hub = ContractHubPage()
hub.load_contract(con_id)
app.processEvents()
check("أيقونة الرأس", hub.header._icon_lbl.text() == "▤")
texts = [b.text() for b in hub.findChildren(QPushButton)]
for want in ("◉ ملف العميل", "☰ إجراءات العقد",
             "＋ عقد إضافي / أمر تغييري", "＋ سند قبض", "＋ سند صرف",
             "✔ اعتماد", "✕ إلغاء المحدد"):
    check(f"زر: {want}", want in texts)
check("زر التصفية", hub.settle_btn.text() == "✔ تصفية وإغلاق العقد")
check("إلغاء التمديد", hub.sup_waive_btn.text() == "✕ إلغاء أشهر تمديد (مدير)")
exc = [b for b in hub.findChildren(QPushButton)
       if b.objectName() == "iconBtn" and b.text() == "📤"]
check("أيقونتا Excel", len(exc) == 2, len(exc))
acts = [a.text() for a in hub.contract_actions_menu.actions()
        if not a.isSeparator()]
check("قائمة الإجراءات الخمسة بلا سندات مكررة (V6.4)",
      acts == ["✎ تعديل البيانات", "▦ كشف حساب", "▤ اختيار نموذج",
               "✖ إلغاء أشهر تمديد", "✔ تصفية وإغلاق"], acts)
by_text = {b.text(): b for b in hub.findChildren(QPushButton)}
check("أزرار السندات: صرف رئيسي · قبض أخضر",
      by_text["＋ سند صرف"].objectName() == "btnPrimary"
      and by_text["＋ سند قبض"].objectName() == "btnReceipt"
      and by_text["＋ عقد إضافي / أمر تغييري"].objectName() == "btnPrimary"
      and by_text["← رجوع"].objectName() != "btnPrimary")
descs = [w for w in hub.findChildren(object)
         if hasattr(w, "property")
         and w.property("pageDesc") is True]
check("وصف قسم واحد على الأقل", len(descs) >= 1, len(descs))

print("=== 2. البحث الشامل ===")
dlg = GlobalSearchDialog()
check("العنوان", dlg.title_lbl.text() == "⌕ بحث شامل"
      and dlg.title_lbl.property("sectionTitle") is True)
check("العنصر النائب", dlg.search.placeholderText().startswith("⌕"))
dlg.search.setText("عميل بحث ب13")
dlg._do_search()
app.processEvents()
items = [dlg.results_list.item(i).text()
         for i in range(dlg.results_list.count())]
check("أيقونات آمنة", any(t.startswith("◉") for t in items)
      and not any("👥" in t or "📑" in t for t in items), items)
heads = [dlg.results_list.item(i)
         for i in range(dlg.results_list.count())
         if dlg.results_list.item(i).data(Qt.UserRole) is None]
check("رؤوس التجميع", len(heads) >= 1
      and all(h.flags() == Qt.NoItemFlags for h in heads))

print("=== 3. الإعدادات ===")
pg = SettingsPage()
pg.show()
pg.refresh()
app.processEvents()
tabs = [pg.tabs.tabText(i) for i in range(pg.tabs.count())]
check("التبويبات الثمانية", tabs == [
    "⌂  بيانات الشركة", "▤  الطباعة والعرض",
    "◆  الأمان والمستخدمون", "☰  أنواع العقود",
    "§  حسابات المصروفات", "⇄  مراحل المتابعة",
    "◷  جدول الزيارات", "⊞  البيانات والنسخ الاحتياطي"], tabs)
bad = [t for t in tabs if any(ord(c) > 0xFFFF for c in t)]
check("لا إيموجي في التبويبات", bad == [], bad)
descs = [w for w in pg.findChildren(object)
         if hasattr(w, "property")
         and w.property("pageDesc") is True]
check("وصف الإعدادات", len(descs) == 1 and len(descs[0].text()) > 10)
saves = [b for b in pg.findChildren(QPushButton)
         if b.text() == "💾 حفظ الإعدادات"]
check("حفظ الإعدادات رئيسي",
      len(saves) >= 1
      and all(b.objectName() == "btnPrimary" for b in saves))
hs = [b for b in pg.findChildren(QPushButton)
      if b.text() == "💾 حفظ الساعات"]
check("حفظ الساعات رئيسي", len(hs) == 1
      and hs[0].objectName() == "btnPrimary")
try:
    dev = pg._tab_developer()
    dtexts = [b.text() for b in dev.findChildren(QPushButton)]
    check("أزرار المطور", "✚ تهيئة العقود القديمة الآن" in dtexts
          and "🗑 سجل الحذف" in dtexts, dtexts)
except Exception as exc:
    check("أزرار المطور", False, repr(exc))

print("=== 4. سير النوع ===")
tw = TypeWorkflowDialog(None, "مقاولة عامة")
app.processEvents()
ttexts = {b.text(): b for b in tw.findChildren(QPushButton)}
check("إضافة دفعة", "＋ إضافة دفعة" in ttexts
      and ttexts["＋ إضافة دفعة"].objectName() == "btnPrimary"
      and len(ttexts["＋ إضافة دفعة"].toolTip()) > 5)
check("✎ تعديل المحدد", "✎ تعديل المحدد" in ttexts
      and ttexts["✎ تعديل المحدد"].property("flat") is True
      and len(ttexts["✎ تعديل المحدد"].toolTip()) > 5)
heads = [tw.pay_table.horizontalHeaderItem(i).text() for i in range(7)]
check("أعمدة الدفعات السبع",
      heads == ["رقم", "الدفعة", "القيمة", "النوع", "المراحل",
                "المرحلة المُحفِّزة", "بعد (يوم)"], heads)

print(f"\nالنتيجة: {passed} ناجح / {failed} فاشل")
sys.exit(1 if failed else 0)
