# -*- coding: utf-8 -*-
"""اختبار الدفعة 6: قالب القوائم (العملاء + مقاولو الباطن) — §8/§10."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

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
from services import lifecycle_service as lc  # noqa: E402
from services import ui_data_service as ui_data  # noqa: E402
from ui import style  # noqa: E402
from ui.dealings import DealingsPage  # noqa: E402
from ui.subcontractors import SubcontractorsPage  # noqa: E402

print("=== 1. المقاولون: الرأس والأدوات ===")
sp = SubcontractorsPage()
check("وصف الصفحة", sp.desc_lbl.property("pageDesc") is True
      and len(sp.desc_lbl.text()) > 10, sp.desc_lbl.text())
heads = [sp.tree.headerItem().text(i) for i in range(sp.tree.columnCount())]
check("الأعمدة الخمسة محفوظة",
      heads == ["المقاول / العقد", "القيمة", "المنصرف له", "المتبقي له",
                "الحالة"], heads)
excels = [b for b in sp.findChildren(QPushButton)
          if b.objectName() == "iconBtn" and b.text() == "📤"]
check("زر Excel أيقونة", len(excels) == 1, len(excels))
check("تلميح Excel", bool(excels) and len(excels[0].toolTip()) > 5)

print("=== 2. المقاولون: ألوان الحالات الأربع ===")
cid = customer_service.add_customer(Customer(
    customer_code="C-B6", name="عميل ب6", phone="9001"))
con_id = contract_service.add_contract(Contract(
    contract_number="CON-B6", customer_id=cid,
    contract_date="2026-01-01", description="عقد ب6",
    amount=100000.0, contract_type="مقاولة عامة"))
pid = ui_data.contract_project_id(con_id)
sub_id = lc.add_subcontractor("S-B6", "مقاول ب6", "", "", "كهرباء", "")
statuses = ["نشط", "متوقف", "منتهي", "ملغى"]
for i, st in enumerate(statuses):
    sc_id = lc.add_sub_contract(sub_id, con_id, pid, 5000.0 + i,
                                "2026-01-01", "2026-12-31", f"بند {st}")
    row = next(c for c in lc.subcontractors_tree()[0]["contracts"]
               if c["id"] == sc_id)
    lc.update_sub_contract(sc_id, row["amount"], "2026-01-01",
                           "2026-12-31", row.get("description") or "",
                           st, "", 0.0)
sp.refresh()
app.processEvents()
got = {}
top = sp.tree.topLevelItem(0)
for i in range(top.childCount()):
    ch = top.child(i)
    got[ch.text(4)] = ch.foreground(4).color().name().upper()
for st in statuses:
    want = style.STATUS_COLORS.get(st, style.STATUS_DEFAULT).upper()
    check(f"لون الحالة: {st}", got.get(st) == want, (got.get(st), want))

print("=== 3. المقاولون: الإجراءات + الفراغ ===")
texts = [b.text() for b in sp.findChildren(QPushButton)]
check("زر السجل المالي", "▦ السجل المالي" in texts, texts)
check("زرا الإنشاء (مقاول + عقد باطن)", "＋ مقاول جديد" in texts
      and "＋ عقد باطن جديد" in texts, texts)
check("لا أزرار تعديل/حذف على الصفحة (من قائمة الصف)",
      not any(t in texts for t in ("✎ تعديل", "🗑 حذف المحدد")), texts)
check("لا زر صرف مكرر (الصرف من أزرار السندات)",
      "📤 سند صرف للمقاول" not in texts, texts)
tips = [b.toolTip() for b in sp.findChildren(QPushButton)
        if b.text() in ("＋ مقاول جديد", "＋ عقد باطن جديد",
                        "▦ السجل المالي")]
check("تلميحات الإجراءات", len(tips) == 3 and all(len(x) > 5 for x in tips),
      tips)
sp2 = SubcontractorsPage()
sp2.search.setText("لا-يوجد-مطابق-ب6")
sp2.refresh()
app.processEvents()
eb = [b for b in sp2.findChildren(QPushButton) if b.text() == "✕ مسح البحث"]
check("زر الفراغ ثانوي",
      len(eb) == 1 and eb[0].objectName() != "btnPrimary"
      and eb[0].property("flat") is True)
sp.show()
app.processEvents()
prims = [b for b in sp.findChildren(QPushButton)
         if b.objectName() == "btnPrimary" and b.isVisibleTo(sp)]
check("الزر الرئيسي الوحيد هو إنشاء عقد الباطن",
      len(prims) == 1 and prims[0].text() == "＋ عقد باطن جديد",
      [b.text() for b in prims])
check("الوصف يوجّه للإنشاء من هنا أو من العقد",
      "الإنشاء من هنا" in sp.desc_lbl.text()
      and "عقد العميل" in sp.desc_lbl.text(), sp.desc_lbl.text())

print("=== 4. العملاء: شريط التحديد ===")
dp = DealingsPage()
dp.refresh()
app.processEvents()
heads = [dp.tree.headerItem().text(i) for i in range(dp.tree.columnCount())]
check("الأعمدة الستة محفوظة",
      heads == ["العميل", "الهاتف", "العقود", "القيمة", "المحصّل",
                "المتبقي"], heads)
want = {"file": "📁 فتح الملف", "contract": "📑 عقد جديد",
        "receipt": "📥 قبض", "payment": "📤 صرف",
        "statement": "📊 كشف حساب", "more": "⋯ إجراءات أخرى"}
btns = {k: dp.sel_bar.button(k) for k in want}
check("النصوص الستة بالأيقونات",
      all(b is not None and b.text() == t
          for (k, t), b in zip(want.items(), btns.values())),
      [b.text() if b else None for b in btns.values()])
check("التلميحات الستة",
      all(b is not None and len(b.toolTip()) > 5
          for b in btns.values()))
check("الشريط مخفي قبل التحديد", dp.sel_bar_host.isHidden())
dp.tree.setCurrentItem(dp.tree.topLevelItem(0))
app.processEvents()
check("الشريط يظهر باسم المحدد", not dp.sel_bar_host.isHidden()
      and "عميل ب6" in dp.sel_name_lbl.text(),
      dp.sel_name_lbl.text())
check("زر الملف (عميل)", btns["file"].text() == "📁 فتح الملف"
      and "العميل" in btns["file"].toolTip(),
      (btns["file"].text(), btns["file"].toolTip()))

print("=== 5. العملاء: الفراغ + الرئيسي الواحد ===")
dp2 = DealingsPage()
dp2.search.setText("لا-يوجد-مطابق-ب6")
dp2.refresh()
app.processEvents()
eb = [b for b in dp2.findChildren(QPushButton) if b.text() == "✕ مسح البحث"]
check("زر الفراغ ثانوي",
      len(eb) == 1 and eb[0].objectName() != "btnPrimary"
      and eb[0].property("flat") is True)
dp.show()
app.processEvents()
prims = [b for b in dp.findChildren(QPushButton)
         if b.objectName() == "btnPrimary" and b.isVisibleTo(dp)]
check("زر رئيسي ظاهر واحد", len(prims) == 1
      and prims[0].text() == "＋ جديد", [b.text() for b in prims])
check("البحث والشرائح والترقيم",
      dp.search.placeholderText().startswith("ابحث بالاسم")
      and dp.chips.current() == "all" and dp.pager is not None)

print(f"\nالنتيجة: {passed} ناجح / {failed} فاشل")
sys.exit(1 if failed else 0)
