# -*- coding: utf-8 -*-
"""اختبار الدفعة 11: مركز التقارير (تجميع + توحيد) — §10."""
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
from database.models import Contract, Customer  # noqa: E402
from services import contract_service, customer_service  # noqa: E402
from ui.reports_page import ReportsPage, visible_reports  # noqa: E402

cid = customer_service.add_customer(Customer(
    customer_code="C-B11", name="عميل ب11", phone="9011"))
contract_service.add_contract(Contract(
    contract_number="CON-B11", customer_id=cid,
    contract_date="2026-01-01", description="عقد ب11",
    amount=50000.0, contract_type="مقاولة عامة"))

print("=== 1. البطاقات والتجميع ===")
pg = ReportsPage()
vis = visible_reports()
check("تقارير ظاهرة", len(vis) >= 5, len(vis))
titles = [w.text() for w in pg._cards_holder.findChildren(QLabel)
          if w.property("sectionTitle")]
check("قسم التقارير العامة", "التقارير العامة" in titles, titles)
mods = {r.get("module") or "" for r in vis}
check("عدد الأقسام", len(titles) == len(mods), (titles, mods))
opens = [b for b in pg._cards_holder.findChildren(QPushButton)
         if b.text() == "🔍 فتح التقرير"]
check("بطاقة لكل تقرير", len(opens) == len(vis),
      (len(opens), len(vis)))
check("تلميحات الفتح", all(len(b.toolTip()) > 5 for b in opens))
descs = [w.text() for w in pg._cards_holder.findChildren(QLabel)
         if w.property("pageDesc")]
check("وصف البطاقات", all(r["desc"] in descs for r in vis))

print("=== 2. التنقل بالفهرس ===")
pg.open_report(0)
app.processEvents()
check("فتح الأول", pg.stack.currentIndex() == 1
      and vis[0]["name"] in pg.view.title_lbl.text(),
      pg.view.title_lbl.text())
check("وصف العرض", pg.view.desc_lbl.text() == vis[0]["desc"])
pg.show_cards()
app.processEvents()
check("رجوع للبطاقات", pg.stack.currentIndex() == 0)
last = len(vis) - 1
pg.open_report(last)
app.processEvents()
check("فتح الأخير", vis[last]["name"] in pg.view.title_lbl.text(),
      pg.view.title_lbl.text())
pg.show_cards()
pg.open_report(999)
check("فهرس خارج النطاق", pg.stack.currentIndex() == 0)
pg.modules_refreshed()
app.processEvents()
opens = [b for b in pg._cards_holder.findChildren(QPushButton)
         if b.text() == "🔍 فتح التقرير"]
check("تحديث المديولات", len(opens) == len(visible_reports()))

print("=== 3. أدوات العرض ===")
check("زر Excel أيقونة", pg.view.xls_btn.text() == "📤"
      and pg.view.xls_btn.objectName() == "iconBtn"
      and len(pg.view.xls_btn.toolTip()) > 5)
check("زر PDF أيقونة", pg.view.pdf_btn.text() == "🖨"
      and pg.view.pdf_btn.objectName() == "iconBtn"
      and len(pg.view.pdf_btn.toolTip()) > 5)
check("زر العرض رئيسي", pg.view.apply_btn.text() == "🔍 عرض التقرير"
      and pg.view.apply_btn.objectName() == "btnPrimary"
      and len(pg.view.apply_btn.toolTip()) > 5)
check("فلتر الفترة", pg.view.period_combo.count() == 7
      and pg.view.period_combo.itemText(0) == "كل الفترات")

print("=== 4. فتح كل التقارير ===")
ok, names = True, []
for i, r in enumerate(visible_reports()):
    try:
        pg.open_report(i)
        app.processEvents()
        assert r["name"] in pg.view.title_lbl.text()
        names.append(r["short"] if "short" in r else r["name"])
    except Exception as exc:  # noqa: BLE001
        ok = False
        names.append(f"{r['name']}: {exc}")
        break
pg.show_cards()
check("كل التقارير تُفتح", ok, names)
pg.refresh()
check("تحديث بلا تقرير", pg.stack.currentIndex() == 0)
check("تحديث مع تقرير", (pg.open_report(0), pg.refresh(),
                         vis[0]["name"] in pg.view.title_lbl.text())[2])

print(f"\nالنتيجة: {passed} ناجح / {failed} فاشل")
sys.exit(1 if failed else 0)
