# -*- coding: utf-8 -*-
"""اختبار جدول الزيارات اليومي (الساعات × المهندسين).

يغطي: ساعات العمل من الإعدادات · الموظفون وهواتفهم (أعمدة
الجدول) · حجز الخانة لعميل بالبحث · الترحيل كمهمة تذكير بموعدها ·
رسائل تذكير الواتساب للمهندس والعميل · تصدير PDF · الصلاحية
والميزة وزر القائمة الجانبية.
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import database.database as db
_tmpdir = tempfile.mkdtemp()
db.DATA_DIR = _tmpdir
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")

from database import database
database.init_db()

from datetime import date

from PySide6.QtWidgets import QApplication, QPushButton
_app = QApplication.instance() or QApplication(sys.argv)
from ui import style
_app.setStyleSheet(style.apply_theme())

from services import (auth_service, customer_service, task_service,
                      visits_service as vs)
from database.models import Customer
from services.customer_service import ValidationError

PASS, FAIL = 0, 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


auth_service.ensure_default_user()
auth_service.set_current_user("admin")

print("=== 1. ساعات العمل ===")
cfg = vs.hours_config()
check("افتراضي 8-17 حصة ساعة", cfg["start"] == 8 and cfg["end"] == 17
      and cfg["slot"] == 60)
check("فترات اليوم 9", len(vs.hour_slots()) == 9)
vs.save_hours_config(9, 13, 30)
check("حفظ الساعات", vs.hours_config() == {"start": 9, "end": 13,
                                           "slot": 30})
check("فترات نصف ساعة", vs.hour_slots()[:3] ==
      ["09:00", "09:30", "10:00"])
try:
    vs.save_hours_config(17, 9, 60)
    check("رفض نهاية قبل البداية", False)
except Exception:
    check("رفض نهاية قبل البداية", True)
vs.save_hours_config(8, 17, 60)

print("\n=== 2. الموظفون (أعمدة الجدول) ===")
s1 = vs.add_staff("م. أحمد", "99887766")
s2 = vs.add_staff("م. سارة", "")
check("إضافة موظفين", s1 > 0 and s2 > 0)
try:
    vs.add_staff("م. أحمد")
    check("رفض الاسم المكرر", False)
except Exception:
    check("رفض الاسم المكرر", True)
check("الهاتف محفوظ", vs.list_staff()[0]["phone"] == "99887766")
vs.update_staff(s2, phone="55443322")
check("تعديل الهاتف", [s for s in vs.list_staff()
                       if s["id"] == s2][0]["phone"] == "55443322")

print("\n=== 3. حجز الخانات ===")
c1 = customer_service.add_customer(Customer(
    customer_code="V-001", name="عبدالله الرشيد", phone="66778899"))
c2 = customer_service.add_customer(Customer(
    customer_code="V-002", name="فيصل الدوسري", phone="55664433"))
day = date.today().isoformat()
vid = vs.set_visit(day, "09:00", s1, c1, "قياس الموقع", "admin")
check("حجز خانة", vid > 0)
v = vs.get_visit(day, "09:00", s1)
check("الخانة تحمل العميل والهاتفين",
      v["customer_name"] == "عبدالله الرشيد"
      and v["staff_phone"] == "99887766"
      and v["customer_phone"] == "66778899")
vs.set_visit(day, "09:00", s1, c2, "تغيير العميل")
check("نفس الخانة تستبدل العميل",
      vs.get_visit(day, "09:00", s1)["customer_name"] == "فيصل الدوسري")
vs.set_visit(day, "09:00", s1, c2, "ملاحظة محدثة")
check("تحديث الملاحظة", vs.get_visit(day, "09:00", s1)["note"]
      == "ملاحظة محدثة")
vs.set_visit(day, "11:00", s2, c2)
check("خانة أخرى لموظف آخر", len(vs.day_visits(day)) == 2)
vs.set_visit(day, "11:00", s2, None)
check("تفريغ خانة", vs.get_visit(day, "11:00", s2) is None)

print("\n=== 4. الترحيل كمهمة تذكير ===")
tid = vs.visit_to_task(day, "09:00", s1)
check("الزيارة صارت مهمة", tid > 0)
tasks = [t for t in task_service.list_tasks() if t["id"] == tid]
check("مهمة بموعد الزيارة بالساعة",
      tasks and tasks[0]["due_at"] == f"{day} 09:00"
      and tasks[0]["task_type"] == "موعد")
check("المهمة مربوطة بالعميل", tasks[0]["customer_id"] == c2)
try:
    vs.visit_to_task(day, "09:00", s1)
    check("رفض تكرار الترحيل", False)
except Exception:
    check("رفض تكرار الترحيل", True)

print("\n=== 5. رسائل التذكير ===")
v = vs.get_visit(day, "09:00", s1)
msg_eng = vs.reminder_message(v, True)
msg_cus = vs.reminder_message(v, False)
check("رسالة المهندس: العميل والساعة",
      "فيصل الدوسري" in msg_eng and "09:00" in msg_eng)
check("رسالة العميل: المهندس والساعة",
      "م. أحمد" in msg_cus and "09:00" in msg_cus)
try:
    vs.send_reminder(day, "10:00", s1, True)
    check("خانة فاضية: رسالة تُرفض", False)
except Exception:
    check("خانة فاضية: رسالة تُرفض", True)

print("\n=== 6. تصدير PDF ===")
out = tempfile.mktemp(suffix=".pdf")
vs.export_day_pdf(day, out)
check("PDF اليوم يتولد", os.path.getsize(out) > 5000)

print("\n=== 7. الواجهة والصلاحيات ===")
from ui.visits import VisitsPage
from PySide6.QtCore import QDate
vp = VisitsPage()
vp.resize(1200, 800)
vp._set_date(QDate.currentDate())
for _ in range(8):
    _app.processEvents()
check("الشبكة: 9 ساعة × 2 موظف", vp.table.rowCount() == 9
      and vp.table.columnCount() == 3)
cell = vp.table.item(1, 1)
check("الخلية تعرض العميل والمهمة", cell is not None
      and "فيصل" in cell.text() and "مهمة" in cell.text())
from services import feature_service, auth_service as _au
check("الميزة مفعلة افتراضيًا", feature_service.enabled("visits"))
check("الصلاحية في الكتالوج",
      "screen_visits" in _au.PERMISSIONS)
from ui.main_window import MainWindow, IDX_VISITS
w = MainWindow()
w.show()
for _ in range(12):
    _app.processEvents()
navs = [b.text().strip() for b in w.findChildren(QPushButton)
        if b.text().strip()]
check("زر القائمة الجانبية ظاهر", any("جدول الزيارات" in t for t in navs))
w._navigate(IDX_VISITS)
for _ in range(8):
    _app.processEvents()
check("الصفحة تعمل", isinstance(w.visits_page, VisitsPage))

print(f"\n{'='*40}\nالنتيجة: نجح {PASS} / فشل {FAIL}")
import os as _os
_os._exit(1 if FAIL else 0)
