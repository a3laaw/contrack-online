# -*- coding: utf-8 -*-
"""اختبار الدفعة 9: مركز العقد (تبويب الدفعات + التوحيد) — §10."""
import os
import sys

from PySide6.QtCore import Qt  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from PySide6.QtWidgets import (QApplication, QLabel,  # noqa: E402
                               QPushButton)

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
from ui.contract_hub import ContractHubPage, STATUS_COLORS  # noqa: E402
from ui.widgets import MONEY_ALIGN  # noqa: E402

cid = customer_service.add_customer(Customer(
    customer_code="C-B9", name="عميل ب9", phone="9009"))
con_id = contract_service.add_contract(Contract(
    contract_number="CON-B9", customer_id=cid,
    contract_date="2026-01-01", description="عقد ب9",
    amount=60000.0, contract_type="مقاولة عامة"))
lc.add_plan_item(con_id, "الدفعة الأولى", "2026-02-01", 20000.0)
lc.add_plan_item(con_id, "الدفعة الأخيرة", "2027-06-01", 40000.0)

print("=== 1. تبويب الدفعات والبنود الموحد (V4.5.06) ===")
hub = ContractHubPage()
hub.load_contract(con_id)
app.processEvents()
check("زر الدفعات في التنقل", hub.nav.buttons.get("pay") is not None
      and hub.nav.buttons["pay"].text() == "الدفعات والمقاولون")
check("لا تابات قديمة (خطة/مقارنة/باطن)",
      all(k not in hub.nav.buttons for k in ("plan", "compare", "subs")))
check("الافتراضي نظرة عامة", hub._current_key() == "info")
hub.load_contract(con_id, open_page="pay")
app.processEvents()
check("فتح الدفعات مباشرة", hub._current_key() == "pay")
# V6.5: جدول واحد لكل كتلة (البنود والدفعات + العميل + المقاول)
ct = hub.pay_tables[0]
heads = [ct.item(1, i).text() for i in range(ct.columnCount())]
check("رؤوس أعمدة الجدول الموحّد",
      heads == ["الدفعة", "البند", "المبلغ", "المسدَّد", "الحالة",
                "المبلغ", "المسدَّد", "الحالة"], heads)
check("رأس المجموعتين: العميل والمقاول",
      ct.columnSpan(0, 0) == 2 and ct.columnSpan(0, 2) == 3
      and ct.columnSpan(0, 5) == 3,
      (ct.columnSpan(0, 0), ct.columnSpan(0, 2), ct.columnSpan(0, 5)))
titles = [ct.item(r, 0).text() for r in range(2, ct.rowCount())]
check("صفا الخطة في الجدول",
      "الدفعة الأولى" in titles and "الدفعة الأخيرة" in titles, titles)
row0 = titles.index("الدفعة الأولى") + 2
check("محاذاة مالية",
      all(ct.item(row0, c).textAlignment()
          == int(Qt.AlignRight | Qt.AlignVCenter) for c in (2, 3, 5, 6)))
check("لون المتأخر", ct.item(row0, 4).text() == "متأخر"
      and ct.item(row0, 4).foreground().color().name()
      .upper() == style.DANGER.upper(),
      (ct.item(row0, 4).text(), ct.item(row0, 4).foreground().color().name()))
check("ملخص موحد", "لنا: مستحق" in hub.pay_sum_lbl.text()
      and "عليهم (مقاولون):" in hub.pay_sum_lbl.text(),
      hub.pay_sum_lbl.text())

print("=== 2. التوحيد: أزرار وقوائم ===")
texts = [b.text() for b in hub.findChildren(QPushButton)]
for want in ("☰ إجراءات العقد", "◉ ملف العميل",
             "＋ عقد إضافي / أمر تغييري",
             "＋ سند قبض", "＋ سند صرف"):   # V6.4
    check(f"زر: {want}", want in texts)
for gone in ("⬆ صرف للمقاول", "📂 سندات المقاول", "＋ إضافة بند",
             "🗑 حذف المحدد", "⚖ وزّع على المراحل", "🔗 مصادر الدفعة"):
    check(f"لا زر مكرر: {gone}", gone not in texts)
# زر التصفية موجود كخاصية لكنه غير مُلحق بالتخطيط (قائم) — النص والتلميح فقط
check("زر التصفية (خاصية)",
      hub.settle_btn.text() == "✔ تصفية وإغلاق العقد"
      and len(hub.settle_btn.toolTip()) > 5)
exc = [b for b in hub.findChildren(QPushButton)
       if b.objectName() == "iconBtn" and b.text() == "📤"]
check("أيقونتا Excel", len(exc) == 2, len(exc))
tips = [b.toolTip() for b in hub.findChildren(QPushButton)
        if b.text() in ("← رجوع", "تفاصيل أكثر", "✔ اعتماد",
                        "✕ إلغاء المحدد", "☰ إجراءات العقد",
                        "＋ سند قبض", "＋ سند صرف")]
check("التلميحات", len(tips) == 7 and all(len(x) > 3 for x in tips),
      tips)
acts = [a.text() for a in hub.contract_actions_menu.actions()
        if not a.isSeparator()]
check("قائمة الإجراءات الخمسة بلا سندات مكررة (V6.4)",
      acts == ["✎ تعديل البيانات", "▦ كشف حساب", "▤ اختيار نموذج",
               "✖ إلغاء أشهر تمديد", "✔ تصفية وإغلاق"], acts)

print("=== 3. الحالات والمحاذاة والسلوك ===")
sid = lc.add_subcontractor("S-B9", "مقاول ب9", "", "", "", "")
pid = ui_data.contract_project_id(con_id)
sc = lc.add_sub_contract(sid, con_id, pid, 10000.0,
                         "2026-01-01", "2026-12-31", "بند ب9")
row = next(c for c in lc.subcontractors_tree()[0]["contracts"]
           if c["id"] == sc)
lc.update_sub_contract(sc, row["amount"], "2026-01-01",
                       "2026-12-31", row.get("description") or "",
                       "متوقف", "", 0.0)
aid = lc.add_addendum(con_id, "2026-03-01", "سبب ب9", "", 5000.0,
                      0.0, addendum_type="أمر تغييري")
hub.refresh(only_current=False)
hub.load_contract(con_id, open_page="pay")
app.processEvents()
hub._refresh_section("pay")
hub._refresh_section("addendums")
app.processEvents()
# V6.5: كتلة المقاول تعرض اسمه وحالته بلونها في رأس الكتلة، والجدول
#       الموحّد يجمع دفعات العميل مقابل دفعاته
_blk = next((b for b in hub._pay_blocks
             if "مقاول ب9" in (b["title"] or "")), None)
check("كتلة الباطن ظهرت باسم المقاول", _blk is not None,
      [b["title"] for b in hub._pay_blocks])
if _blk is not None:
    _lbl = _blk["label"]
    check("حالة الباطن في رأس الكتلة بلونها",
          "متوقف" in _lbl.text()
          and STATUS_COLORS["متوقف"].upper() in _lbl.styleSheet().upper(),
          (_lbl.text(), _lbl.styleSheet()))
    _ut = _blk["table"]
    check("الجدول الموحّد للكتلة 8 أعمدة",
          _ut is not None and _ut.columnCount() == 8,
          None if _ut is None else _ut.columnCount())
    check("رأس مجموعة المقاول يحمل اسمه",
          _ut is not None and "مقاول ب9" in _ut.item(0, 5).text(),
          None if _ut is None else _ut.item(0, 5).text())
    check("أعمدة المبالغ محاذاة يمين في الجدول الموحّد",
          _ut is not None
          and all(_ut.item(r, c).textAlignment()
                  == int(Qt.AlignRight | Qt.AlignVCenter)
                  for r in range(2, _ut.rowCount())
                  for c in (2, 3, 5, 6)))
    check("بنود المقاول جدول منفصل أسفل جدوله",
          _blk is not None and _blk.get("items_table") is not None
          and _blk["body"].indexOf(_blk["items_table"])
          > _blk["body"].indexOf(_ut),
          None if _blk is None else _blk["items_table"] is not None)
# V5.4 ④: أُضيفت أعمدة «الجهة» و«بنود» و«مُنفَّذ» ⇒ أزاحت أرقام الأعمدة
got = hub.add_table.item(0, 10)
check("لون حالة الملحق", got.foreground().color().name().upper()
      == STATUS_COLORS.get(got.text(),
                           style.STATUS_DEFAULT).upper(),
      (got.text(), got.foreground().color().name()))
check("محاذاة الملحقات", all(
    hub.add_table.item(0, c).textAlignment() == int(MONEY_ALIGN)
    for c in (5, 6, 7)))
check("عمود الجهة معروض", hub.add_table.item(0, 2).text().startswith("👤"),
      hub.add_table.item(0, 2).text())
check("عمود البنود معروض", hub.add_table.item(0, 8).text().isdigit(),
      hub.add_table.item(0, 8).text())
hub.more_btn.setChecked(True)
app.processEvents()
check("طي التفاصيل", not hub.details_host.isHidden()
      and hub.more_btn.text() == "إخفاء التفاصيل")
hub.more_btn.setChecked(False)
app.processEvents()
check("فتح التفاصيل", hub.details_host.isHidden()
      and hub.more_btn.text() == "تفاصيل أكثر")

print(f"\nالنتيجة: {passed} ناجح / {failed} فاشل")
sys.exit(1 if failed else 0)
