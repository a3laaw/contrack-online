# -*- coding: utf-8 -*-
"""اختبار الدفعة 7: قالب القوائم (سندات القبض والصرف) — §8/§10."""
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
from services import lifecycle_service as lc  # noqa: E402
from ui import style  # noqa: E402
from ui.vouchers import VouchersPage  # noqa: E402

HEADS = ["الرقم", "التاريخ", "الطرف", "العقد", "البيان", "المبلغ",
         "الحالة"]
vid1 = lc.add_voucher("receipt", "2026-03-01", "عميل نقدي", "نقدًا",
                      "", 1500.0, "تحصيل تجربة")
vid2 = lc.add_voucher("payment", "2026-03-02", "مورد تجربة", "نقدًا",
                      "مصروفات", 750.0, "صرف تجربة")
lc.cancel_voucher(vid2, "إلغاء تجربة")

print("=== 1. القبض: الرأس والشارة ===")
vr = VouchersPage("receipt")
vr.refresh()
app.processEvents()
check("العنوان", vr.title_lbl.text() == "سندات القبض"
      and vr.title_lbl.property("pageTitle") is True)
check("الوصف", vr.desc_lbl.property("pageDesc") is True
      and len(vr.desc_lbl.text()) > 10)
check("شارة قبض خضراء", vr.type_badge.text() == "📥 قبض"
      and "rgba(" in vr.type_badge.styleSheet(),
      vr.type_badge.text())
heads = [vr.table.horizontalHeaderItem(i).text() for i in range(7)]
check("الأعمدة السبعة محفوظة", heads == HEADS, heads)

print("=== 2. القبض: الأدوات ===")
texts = [b.text() for b in vr.findChildren(QPushButton)]
for want in ("🖨 طباعة", "✕ إلغاء", "＋ سند قبض جديد"):
    check(f"زر: {want}", want in texts, texts)
# تعديل/تعديل البيان حصريان حسب الصلاحية (منطق قائم)
has_edit = "✎ تعديل" in texts
has_desc = "📝 تعديل البيان" in texts
check("حصري التعديل", has_edit != has_desc, texts)
tips = [b.toolTip() for b in vr.findChildren(QPushButton)
        if b.text() in ("🖨 طباعة", "✎ تعديل", "📝 تعديل البيان",
                        "✕ إلغاء", "＋ سند قبض جديد")]
check("تلميحات الإجراءات",
      len(tips) == 4 and all(len(x) > 5 for x in tips), tips)
exc = [b for b in vr.findChildren(QPushButton)
       if b.objectName() == "iconBtn" and b.text() == "📤"]
check("زر Excel أيقونة", len(exc) == 1 and len(exc[0].toolTip()) > 5)
add = next(b for b in vr.findChildren(QPushButton)
           if b.text() == "＋ سند قبض جديد" and b.objectName() == "btnReceipt")
check("زر الإضافة (قبض/أخضر)", add.objectName() == "btnReceipt")

print("=== 3. القبض: الحالات والفراغ ===")
st = vr.table.item(0, 6)
check("سارٍ بالأخضر", st.text() == "سارٍ" and st.foreground().color()
      .name().upper() == style.OK_GREEN.upper(),
      (st.text(), st.foreground().color().name()))
vr2 = VouchersPage("receipt")
vr2.search.setText("لا-يوجد-مطابق-ب7")
vr2.refresh()
app.processEvents()
eb = [b for b in vr2.findChildren(QPushButton)
      if b.text() == "＋ سند قبض جديد"
      and b.objectName() not in ("btnReceipt", "btnDangerSoft")]
in_top = vr2._can_add
lvl_ok = ((eb[0].objectName() != "btnPrimary") if in_top
          else (eb[0].objectName() == "btnPrimary")) if eb else False
check("زر الفراغ (ثانوي مع العلوي)", len(eb) == 1 and lvl_ok,
      [(b.objectName(), b.property("flat")) for b in eb])

print("=== 4. الصرف: الرأس والشارة والأدوات ===")
vp = VouchersPage("payment")
vp.refresh()
app.processEvents()
check("العنوان والوصف", vp.title_lbl.text() == "سندات الصرف"
      and vp.desc_lbl.property("pageDesc") is True
      and len(vp.desc_lbl.text()) > 10)
check("شارة صرف حمراء", vp.type_badge.text() == "📤 صرف"
      and "rgba(" in vp.type_badge.styleSheet(),
      vp.type_badge.text())
heads = [vp.table.horizontalHeaderItem(i).text() for i in range(7)]
check("الأعمدة السبعة محفوظة", heads == HEADS, heads)
texts = [b.text() for b in vp.findChildren(QPushButton)]
check("زر الصرف المجمع", "＋ سند صرف مجمع" in texts, texts)
cancel = next(b for b in vp.findChildren(QPushButton)
              if b.text() == "✕ إلغاء")
check("زر الإلغاء (خطر)", cancel.property("danger") is True
      and len(cancel.toolTip()) > 5)

print("=== 5. الصرف: الحالات والفراغ ===")
st = vp.table.item(0, 6)
check("ملغى بالأحمر", st.text() == "ملغى" and st.foreground().color()
      .name().upper() == style.RED.upper(),
      (st.text(), st.foreground().color().name()))
vp2 = VouchersPage("payment")
vp2.search.setText("لا-يوجد-مطابق-ب7")
vp2.refresh()
app.processEvents()
eb = [b for b in vp2.findChildren(QPushButton)
      if b.text() == "＋ سند صرف جديد"
      and b.objectName() not in ("btnReceipt", "btnDangerSoft")]
in_top = vp2._can_add
lvl_ok = ((eb[0].objectName() != "btnPrimary") if in_top
          else (eb[0].objectName() == "btnPrimary")) if eb else False
check("زر الفراغ (ثانوي مع العلوي)", len(eb) == 1 and lvl_ok)
check("البحث والترقيم", vp.search.placeholderText().startswith("🔍")
      and vp.pager is not None)

print(f"\nالنتيجة: {passed} ناجح / {failed} فاشل")
sys.exit(1 if failed else 0)
