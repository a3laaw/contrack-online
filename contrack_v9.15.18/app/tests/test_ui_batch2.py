# -*- coding: utf-8 -*-
"""الدفعة 2 (الهيكل المشترك): طي الشريط + مسار التنقل — بلا مساس بالتنقل/الصلاحيات."""
import os
import re
import sys

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication, QLabel, QPushButton  # noqa: E402

from database import database  # noqa: E402
from services import auth_service, feature_service  # noqa: E402
from ui import style  # noqa: E402
from ui.main_window import MainWindow  # noqa: E402

PASS, FAIL = 0, 0


def check(label, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {label}")
    else:
        FAIL += 1
        print(f"  [FAIL] {label} {extra}")


def plain(lbl: QLabel) -> str:
    return re.sub(r"<[^>]*>", "", lbl.text()).strip()


def side_buttons(win: MainWindow):
    return [b for b in win._sidebar.findChildren(QPushButton) if b.text()]


def main() -> None:
    database.init_db()
    app = QApplication.instance() or QApplication([])
    app.setStyleSheet(style.apply_theme())
    _op, _of = auth_service.has_permission, feature_service.enabled
    auth_service.has_permission = lambda *a, **k: True
    feature_service.enabled = lambda *a, **k: True
    try:
        win = MainWindow()
        win.show()
        app.processEvents()

        print("=== 1. الوضع الافتراضي موسّع ===")
        check("زر الطي >>", win._sidebar_toggle.text() == ">>")
        check("عرض موسّع", win._sidebar.width() > 150, win._sidebar.width())
        check("المسار الرئيسية", plain(win.crumb_lbl) == "الرئيسية",
              win.crumb_lbl.text())
        check("نصوص الهوية ظاهرة",
              win.app_title_lbl.isVisible() and win.app_subtitle_lbl.isVisible())
        n_before = len(side_buttons(win))
        check("أزرار تنقل مبنية", n_before >= 8, n_before)

        print("=== 2. الطي ===")
        win._toggle_sidebar()
        app.processEvents()
        scale = getattr(win, "_sidebar_scale", 1.0)
        check("عرض مطوي 72", win._sidebar.width() == int(72 * scale),
              win._sidebar.width())
        check("زر التوسيع <<", win._sidebar_toggle.text() == "<<")
        check("نصوص الهوية مخفية",
              not win.app_title_lbl.isVisible()
              and not win.app_subtitle_lbl.isVisible())
        texts = [b.text() for b in side_buttons(win)]
        check("كل الأزرار أيقونة فقط", all("  " not in x for x in texts), texts)
        check("البحث ثابت في العلوي",
              win._search_btn.text() == "🔍 بحث شامل ..." and
              win._search_btn.isVisibleTo(win.top_bar))
        navs = side_buttons(win)
        check("تلميحات الأسماء", all(b.toolTip() for b in navs))
        check("خاصية collapsed", win._sidebar.property("collapsed") is True)
        check("عدد الأزرار ثابت", len(side_buttons(win)) == n_before)

        print("=== 3. تنقل أثناء الطي ===")
        win._go(4)
        app.processEvents()
        check("صفحة القبض", win.stack.currentIndex() == 4)
        check("مسار القبض", plain(win.crumb_lbl) == "المحاسبة › سندات القبض",
              win.crumb_lbl.text())
        check("الابن عريض بالخط", "<b>" in win.crumb_lbl.text())
        box = win._group_boxes["المحاسبة"]
        check("مجموعة المحاسبة مفتوحة", box.isVisible())
        kids = [b.text() for b in box.findChildren(QPushButton)]
        check("الأبناء أيقونات", all("  " not in x for x in kids), kids)
        win._toggle_group("المحاسبة", "💵")
        win._toggle_group("المحاسبة", "💵")
        app.processEvents()
        check("تبديل مجموعة مطوية يبقى أيقونة",
              win._group_btns["المحاسبة"].text() == "💵",
              win._group_btns["المحاسبة"].text())
        win._fit_sidebar_width()
        check("الملاءمة محجوبة مطويًا",
              win._sidebar.width() == int(72 * scale))

        print("=== 4. التوسيع يستعيد كل شيء ===")
        win._toggle_sidebar()
        app.processEvents()
        check("زر الطي >>", win._sidebar_toggle.text() == ">>")
        check("العرض عاد", win._sidebar.width() > 150, win._sidebar.width())
        check("البحث العلوي ثابت", win._search_btn.text() == "🔍 بحث شامل ...")
        names = [b.text() for b in side_buttons(win)]
        check("نص قبض عاد", any("سندات القبض" in x for x in names))
        check("سهم المجموعة ⌃ (مفتوحة)",
              win._group_btns["المحاسبة"].text().endswith("⌃"),
              win._group_btns["المحاسبة"].text())
        check("التلميحات المضافة مُسحت",
              all(not b.toolTip() for b in navs))
        check("خاصية collapsed زالت",
              win._sidebar.property("collapsed") is not True)

        print("=== 5. مسارات كل الصفحات ===")
        expect = {1: "العملاء", 2: "مركز النماذج", 3: "مقاولو الباطن",
                  4: "المحاسبة › سندات القبض", 5: "المحاسبة › سندات الصرف",
                  6: "المحاسبة › كشف الحساب", 7: "التقارير", 8: "الإعدادات",
                  11: "جدول الزيارات", 12: "التعليقات", 13: "المحاسبة › العهد",
                  15: "المحاسبة › تصفيات العهد"}
        for idx, want in expect.items():
            win._go(idx)
            app.processEvents()
            got = plain(win.crumb_lbl)
            check(f"مسار {idx}", got == want, got)
        win._go(0)
        app.processEvents()
        check("عودة الرئيسية", plain(win.crumb_lbl) == "الرئيسية")

        print("=== 6. مسار تقرير محدد ===")
        from ui.reports_page import visible_reports
        if visible_reports():
            win._navigate(1000)
            app.processEvents()
            got = plain(win.crumb_lbl)
            check("مسار تقرير", got.startswith("التقارير › "), got)
        else:
            check("مسار تقرير (لا تقارير)", True)

        print("=== 7. سلامة التنقل ===")
        win._go(4)
        app.processEvents()
        btn = win.nav_group.checkedButton()
        check("المحدد = المعروض",
              btn is not None and win.nav_group.id(btn) == 4)
        check("عدد الأزرار ثابت بعد كل شيء",
              len(side_buttons(win)) == n_before)
    finally:
        auth_service.has_permission = _op
        feature_service.enabled = _of
    print(f"\nالنتيجة: {PASS} ناجح / {FAIL} فاشل")
    app.quit()
    if FAIL:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
