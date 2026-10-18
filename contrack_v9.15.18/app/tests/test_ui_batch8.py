# -*- coding: utf-8 -*-
"""اختبار الدفعة 8: قالب القوائم (العهد وتصفية العهدة) — §8/§10."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from PySide6.QtWidgets import QApplication, QLabel, QPushButton  # noqa: E402

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
from services import expense_account_service as ea  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402
from ui.custody_center import CustodyCenterPage  # noqa: E402
from ui.widgets import MONEY_ALIGN  # noqa: E402

print("=== 1. الرأس والأعمدة ===")
pg = CustodyCenterPage()
check("العنوان", pg.title_lbl.text() == "كشف حساب العهدة"
      and pg.title_lbl.property("pageTitle") is True)
check("الوصف", pg.desc_lbl.property("pageDesc") is True
      and len(pg.desc_lbl.text()) > 10)
heads = [pg.table.horizontalHeaderItem(i).text() for i in range(8)]
check("الأعمدة الثمانية (مع العهدة)",
      heads == ["التاريخ", "المرجع", "العهدة", "البيان", "وارد",
                "منصرف", "الرصيد", "طباعة"], heads)

print("=== 2. الأزرار ===")
texts = [b.text() for b in pg.findChildren(QPushButton)]
for want in ("🤝 تسليم عهدة", "✅ تصفية عهدة",
             "🖨 نموذج تصفية فارغ", "⬇ نموذج Excel للموظف",
             "🔄 تحديث", "🖨 طباعة كشف الحساب"):
    check(f"زر: {want}", want in texts, texts)
tips = [b.toolTip() for b in pg.findChildren(QPushButton)
        if b.text() in ("🤝 تسليم عهدة", "✅ تصفية عهدة",
                        "🖨 نموذج تصفية فارغ",
                        "⬇ نموذج Excel للموظف", "🔄 تحديث",
                        "🖨 طباعة كشف الحساب", "📤")]
check("التلميحات السبعة",
      len(tips) == 7 and all(len(x) > 5 for x in tips), tips)
check("زر Excel أيقونة",
      pg.excel_btn.text() == "📤"
      and pg.excel_btn.objectName() == "iconBtn"
      and len(pg.excel_btn.toolTip()) > 5)
check("زر الطباعة ثانوي",
      pg.print_btn.objectName() != "btnPrimary"
      and pg.print_btn.property("flat") is True)
pg.show()
app.processEvents()
prims = [b for b in pg.findChildren(QPushButton)
         if b.objectName() == "btnPrimary" and b.isVisibleTo(pg)]
check("زر رئيسي ظاهر واحد", len(prims) == 1
      and prims[0].text() == "🤝 تسليم عهدة",
      [b.text() for b in prims])

print("=== 3. البطاقات والأرصدة ===")
labels = [w.text() for w in pg.findChildren(QLabel)]
for want in ("📥 إجمالي الوارد", "📤 إجمالي المنصرف",
             "💰 الرصيد الحالي"):
    check(f"بطاقة: {want}", want in labels)
root = ea.add_account("العهد", None, allow_posting=False)
acc = ea.add_account("عهدة أحمد", root, account_kind="advance")
exp = ea.add_account("وقود ومواصلات", None, allow_posting=True)
lc.add_voucher("payment", "2026-04-01", "أحمد", "نقدًا",
               "عهدة أحمد", 5000.0, "عهد: تسليم عهدة",
               custody_account_id=acc)
lc.add_custody_settlement("2026-04-05", acc, [{
    "vdate": "2026-04-05", "expense_account_id": exp,
    "party": "محطة وقود", "expense_customer_id": None,
    "project_id": None, "contract_id": None, "amount": 1200.0,
    "description": "بنزين"}], "تصفية تجربة")
pg._load_accounts()
pg.account.setCurrentIndex(pg.account.findData(acc))
pg.reload()
app.processEvents()
check("قيم البطاقات",
      pg.card_in[1].text() == "5,000.000"
      and pg.card_out[1].text() == "1,200.000"
      and pg.card_balance[1].text() == "3,800.000",
      (pg.card_in[1].text(), pg.card_out[1].text(),
       pg.card_balance[1].text()))

print("=== 4. الجدول والفراغ ===")
mains = [m for m in pg._visible if m.get("type") == "main"]
check("صفا الحركة", len(mains) == 2, len(mains))
align_ok = all(pg.table.item(0, c).textAlignment() == int(MONEY_ALIGN)
               for c in (4, 5, 6))
check("محاذاة الأرقام", align_ok)
check("عمود العهدة", pg.table.horizontalHeaderItem(2).text() == "العهدة"
      and "عهدة أحمد" in (pg.table.item(0, 2).text() or ""),
      pg.table.item(0, 2).text() if pg.table.item(0, 2) else None)
srow = next(i for i, m in enumerate(pg._visible)
            if m.get("item", {}).get("kind") == "settlement")
sref = pg._visible[srow]["item"].get("ref") or ""
_calls = []
pg._open_in_settlements = lambda ref: (_calls.append(ref), False)[1]
pg._cell_clicked(srow, 1)
app.processEvents()
check("النقر يفتح التصفية (بلا طي)",
      _calls == [sref] and not any(m.get("type") == "detail"
                                   for m in pg._visible), _calls)
pg2 = CustodyCenterPage()
pg2.search.setText("لا-يوجد-مطابق-ب8")
pg2.reload()
app.processEvents()
eb = [b for b in pg2.findChildren(QPushButton)
      if b.text() == "تسليم عهدة"]
check("زر الفراغ ثانوي",
      len(eb) == 1 and eb[0].objectName() != "btnPrimary"
      and eb[0].property("flat") is True)

print(f"\nالنتيجة: {passed} ناجح / {failed} فاشل")
sys.exit(1 if failed else 0)
