# -*- coding: utf-8 -*-
"""اختبار الدفعة 12: التعليقات + المهام + الزيارات — §10."""
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
from database.models import Customer  # noqa: E402
from services import comment_center_service as ccs  # noqa: E402
from services import customer_service, task_service  # noqa: E402
from services import visits_service as vs  # noqa: E402
from ui import style  # noqa: E402
from ui.comments_center import CommentsCenterPage  # noqa: E402
from ui.tasks import TasksPage  # noqa: E402
from ui.visits import VisitsPage  # noqa: E402

cid = customer_service.add_customer(Customer(
    customer_code="C-B12", name="عميل ب12", phone="9012"))

print("=== 1. التعليقات: الرأس والأزرار ===")
cc = CommentsCenterPage()
check("العنوان", cc.title_lbl.text() == "مركز التعليقات"
      and cc.title_lbl.property("pageTitle") is True)
check("الوصف", cc.desc_lbl.property("pageDesc") is True
      and len(cc.desc_lbl.text()) > 10)
heads = [cc.table.horizontalHeaderItem(i).text() for i in range(8)]
check("الأعمدة الثمانية محفوظة",
      heads == ["التاريخ", "العميل", "العقد", "النوع", "الأولوية",
                "الحالة", "متابعة", "التعليق"], heads)
adds = [b for b in cc.findChildren(QPushButton)
        if b.text() == "＋ تعليق جديد"
        and b.objectName() == "btnPrimary"]
check("زر الإضافة", len(adds) == 1
      and adds[0].objectName() == "btnPrimary"
      and len(adds[0].toolTip()) > 5)
texts = [b.text() for b in cc.findChildren(QPushButton)]
for want in ("✔ تعليم تم", "↩ إعادة فتح", "✕ إلغاء/إخفاء"):
    check(f"زر: {want}", want in texts, texts)
by_text = {b.text(): b for b in cc.findChildren(QPushButton)}
check("مستويات الإجراءات",
      by_text["✔ تعليم تم"].objectName() == "btnReceipt"
      and by_text["↩ إعادة فتح"].property("flat") is True
      and by_text["✕ إلغاء/إخفاء"].property("danger") is True)
tips = [by_text[w].toolTip() for w in
        ("✔ تعليم تم", "↩ إعادة فتح", "✕ إلغاء/إخفاء")]
check("تلميحات الإجراءات", all(len(x) > 5 for x in tips), tips)

print("=== 2. التعليقات: الألوان والفراغ ===")
for i, (st, pr) in enumerate([("مفتوح", "عادي"), ("تم", "مهم"),
                              ("مؤجل", "عاجل"), ("ملغى", "عادي")]):
    ccs.add_comment(cid, f"تعليق ب12-{i}", None, "عام", pr, "",
                    "", st)
cc.refresh()
app.processEvents()
rows = {cc.table.item(r, 7).text(): r
        for r in range(cc.table.rowCount())}
want_st = {"مفتوح": style.INFO, "تم": style.OK_GREEN,
           "مؤجل": style.WARN, "ملغى": style.DANGER}
ok = True
for i, st in enumerate(["مفتوح", "تم", "مؤجل", "ملغى"]):
    r = rows.get(f"تعليق ب12-{i}")
    got = cc.table.item(r, 5).foreground().color().name().upper() \
        if r is not None else None
    ok &= (r is not None and cc.table.item(r, 5).text() == st
           and got == want_st[st].upper())
check("ألوان الحالات الأربع", ok)
want_pr = {"عادي": style.MUTED, "مهم": style.WARN,
           "عاجل": style.DANGER}
ok = True
for i, pr in enumerate(["عادي", "مهم", "عاجل", "عادي"]):
    r = rows.get(f"تعليق ب12-{i}")
    got = cc.table.item(r, 4).foreground().color().name().upper() \
        if r is not None else None
    ok &= (r is not None and got == want_pr[pr].upper())
check("ألوان الأولويات", ok)
check("الملخص", "الإجمالي: 4" in cc.summary.text()
      and "عاجل: 1" in cc.summary.text(), cc.summary.text())
cc2 = CommentsCenterPage()
cc2.search.setText("لا-يوجد-مطابق-ب12")
cc2.refresh()
app.processEvents()
eb = [b for b in cc2.findChildren(QPushButton)
      if b.text() == "✕ مسح البحث"]
check("زر الفراغ (بحث) ثانوي",
      len(eb) == 1 and eb[0].objectName() != "btnPrimary"
      and eb[0].property("flat") is True)

print("=== 3. المهام: كاملة ومضغوطة ===")
task_service.add_task("مهمة مستقبلية", "2027-06-01 10:00", "", 30)
task_service.add_task("مهمة متأخرة", "2026-01-01 09:00", "", 30)
tid = task_service.add_task("مهمة منجزة", "2026-02-01 09:00", "", 30)
task_service.complete_task(tid)
tp = TasksPage()
tp.show_done.setChecked(True)
tp.refresh()
app.processEvents()
check("وصف المهام", tp.desc_lbl.property("pageDesc") is True
      and len(tp.desc_lbl.text()) > 10)
adds = [b for b in tp.findChildren(QPushButton)
        if b.text() == "＋ مهمة جديدة"]
check("زر الإضافة + تلميح", len(adds) == 1
      and adds[0].objectName() == "btnPrimary"
      and len(adds[0].toolTip()) > 5)
rows = {tp.table.item(r, 0).text(): r
        for r in range(tp.table.rowCount())}
ok = (tp.table.item(rows["مهمة مستقبلية"], 3).foreground()
      .color().name().upper() == style.INFO.upper()
      and tp.table.item(rows["مهمة منجزة"], 3).foreground()
      .color().name().upper() == style.OK_GREEN.upper()
      and tp.table.item(rows["مهمة متأخرة"], 3).foreground()
      .color().name().upper() == style.theme()["RED"].upper())
check("ألوان حالات المهام", ok)
check("ملخص المهام", "مهام مفتوحة: 2" in tp.summary_lbl.text()
      and "متأخرة: 1" in tp.summary_lbl.text(),
      tp.summary_lbl.text())
cp = TasksPage(compact=True)
cp.refresh()
app.processEvents()
check("المضغوط: 3 أعمدة ونصوص",
      [cp.table.horizontalHeaderItem(i).text() for i in range(3)]
      == ["المهمة", "الموعد", "المتبقي"]
      and any(b.text() == "+ جديدة"
              for b in cp.findChildren(QPushButton))
      and not hasattr(cp, "desc_lbl"))
check("المضغوط: بلا رئيسي",
      all(b.objectName() != "btnPrimary"
          for b in cp.findChildren(QPushButton)))

print("=== 4. الزيارات ===")
sid = vs.add_staff("م أحمد", "9021")
slots = vs.hour_slots()
from PySide6.QtCore import QDate as _QD
vs.set_visit(_QD.currentDate().toString("yyyy-MM-dd"), slots[0], sid, cid,
             "قياس", "اختبار")
vp = VisitsPage()
vp.refresh()
app.processEvents()
texts = [b.text() for b in vp.findChildren(QPushButton)]
for want in ("◷ اليوم", "⬇ تصدير PDF", "➤ ترحيل كمهام"):
    check(f"زر: {want}", want in texts, texts)
tips = [b.toolTip() for b in vp.findChildren(QPushButton)
        if b.text() in ("◷ اليوم", "⬇ تصدير PDF",
                        "➤ ترحيل كمهام")]
check("تلميحات الزيارات",
      len(tips) == 3 and all(len(x) > 5 for x in tips), tips)
check("رأس الجدول", vp.table.horizontalHeaderItem(0).text() == "الساعة"
      and vp.table.horizontalHeaderItem(1).text() == "م أحمد")
cell = vp.table.item(0, 1)
check("خلية الزيارة", cell is not None and "عميل ب12" in cell.text()
      and "قياس" in cell.text() and len(cell.toolTip()) > 5,
      cell.text() if cell else None)
check("التلميح الإرشادي", "نقرة مزدوجة" in vp.hint.text())

print(f"\nالنتيجة: {passed} ناجح / {failed} فاشل")
sys.exit(1 if failed else 0)
