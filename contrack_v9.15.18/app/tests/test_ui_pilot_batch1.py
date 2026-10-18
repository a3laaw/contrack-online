# -*- coding: utf-8 -*-
"""الدفعة التجريبية 1 (V2.26): الرئيسية/العملاء/سند قبض — إثبات عدم التراجع."""
import os
import re
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database.database as db

_tmpdir = tempfile.mkdtemp()
db.DATA_DIR = _tmpdir
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")

from database.database import init_db  # noqa: E402

init_db()

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtWidgets import (QApplication, QLabel, QPushButton, QVBoxLayout,  # noqa: E402
                               QWidget)

app = QApplication.instance() or QApplication([])

from ui import style  # noqa: E402

app.setStyleSheet(style.apply_theme())

PASS, FAIL = 0, 0


def check(name: str, condition: bool, detail: str = ""):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


print("=== 1. التوكنز لم تتغير (النيلي ثابت) ===")
t = style.theme()
for key, val in [("ACCENT", "#4F46E5"), ("ACCENT_DARK", "#4338CA"),
                 ("BG", "#EEF2F7"), ("CARD", "#FFFFFF"),
                 ("BORDER", "#E3E9F2"), ("PRIMARY", "#1F2937"),
                 ("MUTED", "#64748B"), ("BRAND_600", "#4F46E5"),
                 ("BRAND_100", "#EEF0FF"), ("BRAND_50", "#F1F4FA"),
                 ("GREEN", "#16A34A"), ("RED", "#DC2626"),
                 ("WARNING", "#D97706")]:
    check(f"توكن {key}", t.get(key) == val, t.get(key))

print("=== 2. الأنماط التجريبية مقيدة بالخصائص ===")
block = style.pilot_styles(t)
selectors = [ln.strip() for ln in block.splitlines() if "{" in ln]
check("قواعد تجريبية موجودة", len(selectors) >= 2, selectors)
check("كل قاعدة مقيدة بخاصية",
      all("[" in s and "]" in s for s in selectors), selectors)
full_css = style.build_stylesheet()
check("الكتلة ملحقة بالثيم", "pilotSection" in full_css)
for sel in ["QPushButton#btnPrimary", "QTableWidget", "QPushButton#filterChip",
            "QLabel[statValue", "QFrame[card"]:
    check(f"قاعدة قائمة باقية: {sel}", sel in full_css)

print("=== 3. الرئيسية: الترتيب والمحتوى ===")
from ui.main_window import DashboardPage  # noqa: E402

dash = DashboardPage()
qb_texts = [b.text() for b in dash._quick_buttons]
check("أزرار سريعة كاملة",
      qb_texts[:4] == ["＋ تسجيل عميل", "＋ عقد جديد", "＋ سند قبض", "＋ سند صرف"],
      qb_texts)
# ترتيب المحتوى: المؤشرات ← التنبيهات ← الإجراءات
qa_card = dash._quick_buttons[0].parentWidget()
content = qa_card.parentWidget()
lay = content.layout()
order = {}
for i in range(lay.count()):
    w = lay.itemAt(i).widget()
    if w is qa_card:
        order["qa"] = i
    if w is dash.feed_card:
        order["feed"] = i
    if w is not None and any(v.parentWidget() is w or
                             v.parentWidget().parentWidget() is w
                             for v in dash._cards.values()):
        order["grid"] = i
check("الإجراءات بعد التنبيهات", order.get("qa", -1) > order.get("feed", 99),
      order)
check("المؤشرات أولًا", order.get("grid", 99) < order.get("feed", -1), order)
# بطاقات المؤشرات: التسمية فوق الرقم + الخاصية
ok = True
for key, value_lbl in dash._cards.items():
    card = value_lbl.parentWidget()
    if not card.property("metricCard"):
        ok = False
    cols = [l for l in card.findChildren(QVBoxLayout) if l.count() == 2]
    if not cols:
        ok = False
        continue
    first = cols[0].itemAt(0).widget()
    if not (isinstance(first, QLabel) and first.property("statLabel")):
        ok = False
check("بطاقات المؤشرات (تسمية←رقم + metricCard)", ok)
check("زر توسيع النشاط باقٍ", dash.activity_more.text() == "توسيع النشاط")
check("المهام الجانبية باقية", dash.tasks_panel is not None)

print("=== 4. العملاء: القالب والأعمدة ===")
from ui.dealings import DealingsPage  # noqa: E402

dp = DealingsPage()
heads = [dp.tree.headerItem().text(i) for i in range(dp.tree.columnCount())]
check("الأعمدة الستة محفوظة",
      heads == ["العميل", "الهاتف", "العقود", "القيمة", "المحصّل", "المتبقي"],
      heads)
check("وصف الصفحة", dp.desc_lbl.property("pageDesc") is True
      and len(dp.desc_lbl.text()) > 10)
check("البحث", dp.search.placeholderText().startswith("ابحث بالاسم"))
check("الشريحة الافتراضية", dp.chips.current() == "all")
# البريف: زر أساسي واحد «ظاهر» — شريط التحديد مخفي حتى يُحدد صف
primaries = [b for b in dp.findChildren(QPushButton)
             if b.objectName() == "btnPrimary" and b.isVisibleTo(dp)]
check("زر رئيسي ظاهر واحد (+ جديد)",
      len(primaries) == 1 and primaries[0].text() == "＋ جديد",
      [b.text() for b in primaries])
for name in ["📁 فتح الملف", "📑 عقد جديد", "📥 قبض", "📤 صرف",
             "📊 كشف حساب", "⋯ إجراءات أخرى"]:
    check(f"إجراء التحديد: {name}",
          dp.sel_bar.findChild(QPushButton, name) is not None
          or any(b.text() == name for b in dp.sel_bar.findChildren(QPushButton)))

print("=== 5. سند القبض: أقسام بلا مساس بالحقول ===")
from ui.vouchers import VoucherDialog  # noqa: E402

rec = VoucherDialog(None, "receipt")
heads_sec = [w for w in rec.findChildren(QLabel)
             if w.property("pilotSection")]
check("قسما القبض (مُدرج + مُنسَّق)",
      sorted(w.text() for w in heads_sec)
      == ["المبلغ وطريقة الدفع", "توزيع السندات"],
      [w.text() for w in heads_sec])
labels = set()
for w in rec.findChildren(QLabel):
    plain = re.sub(r"<[^>]*>", "", w.text()).replace("*", "").strip()
    if plain:
        labels.add(plain)
for must in ["بيانات السند", "الدافع", "العقد", "المبلغ", "البيان",
             "طريقة الدفع", "ملاحظات"]:
    check(f"حقل القبض: {must}", any(m in s for m in [must] for s in [must])
          and must in labels or any(must in s for s in labels), "")
saves = [b for b in rec.findChildren(QPushButton)
         if b.objectName() == "btnPrimary"]
check("حفظ واحد", len(saves) == 1 and saves[0].text() == "حفظ السند")
check("إلغاء ثانوي", any(b.text() == "إلغاء" and b.property("flat")
                         for b in rec.findChildren(QPushButton)))

print("=== 6. سند الصرف: صفر تأثر ===")
pay = VoucherDialog(None, "payment")
check("لا أقسام تجريبية في الصرف",
      not [w for w in pay.findChildren(QWidget)
           if w.property("pilotSection") or w.property("metricCard")])
plabels = set()
for w in pay.findChildren(QLabel):
    plain = re.sub(r"<[^>]*>", "", w.text()).replace("*", "").strip()
    if plain:
        plabels.add(plain)
for must in ["المستفيد", "حساب المصروف", "المبلغ", "طريقة الدفع"]:
    check(f"حقل الصرف: {must}", any(must in s for s in plabels))

print(f"\nالنتيجة: {PASS} ناجح / {FAIL} فاشل")
sys.exit(1 if FAIL else 0)
