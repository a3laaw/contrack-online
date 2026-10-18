# -*- coding: utf-8 -*-
"""V3.2 (و): حارس هوية الأزرار — كل فعل يبدأ بأيقونته المعتمدة."""
import glob
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ui.action_icons import ICONS, action_button, icon_for, label

PASS, FAIL = 0, 0


def check(name: str, condition: bool, detail: str = ""):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


print("=== سلامة السجل ===")
check("أيقونات فريدة وغير فارغة",
      len(set(ICONS.values())) == len(ICONS) and all(ICONS.values()))
check("الأفعال الأساسية مسجلة",
      all(k in ICONS for k in ("export_excel", "print", "download",
                               "save", "add", "edit", "delete", "cancel",
                               "refresh", "search", "import", "open")))
check("label يضيف الأيقونة",
      label("save", "حفظ") == "💾 حفظ")
check("label لا يكرر الأيقونة",
      label("save", "💾 حفظ") == "💾 حفظ")
check("فعل مجهول يُترك كما هو", label("nope", "زر") == "زر")
check("icon_for المجهول فارغ", icon_for("nope") == "")

print("=== فحص الأزرار في الكود ===")
#: كلمة → الأيقونة الواجبة في أول النص
RULES = [
    ("تصدير Excel", "📤"), ("طباعة", "🖨"),
    ("تصدير PDF", "⬇"), ("تنزيل", "⬇"),
    ("حفظ في ملف", "📁"), ("حفظ", "💾"),
    ("حذف", "🗑"), ("إلغاء", "✕"), ("إغلاق", "✕"),
    ("جديد", "＋"), ("جديدة", "＋"), ("إضافة", "＋"),
    ("تعديل", "✎"), ("استيراد", "📥"),
    ("تحديث", "🔄"), ("إعادة الفحص", "🔄"),
    ("إعادة المطابقة", "🔄"), ("مزامنة", "🔄"),
    ("بحث", "🔍"), ("تقرير مجمع", "📊"),
    ("الفروقات", "⚠️"), ("إصلاح", "🔧"),
]
SKIP_EXACT = {"تفعيل / تحديث", "✔ تصفية وإغلاق العقد",
              "↩ إعادة فتح", "⬇", "🔔", "→ رجوع للإعدادات"}
SKIP_START = ("🔔", "→")
pat = re.compile(r'QPushButton\("([^"\\]*)"(?:,[^)]*)?\)')
bad: list[str] = []
checked = 0
ui_dir = os.path.join(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__))), "ui")
special_open = ("فتح", "📂", ("التقرير",))
special_show = ("عرض", "🔍", ())
for path in sorted(glob.glob(os.path.join(ui_dir, "*.py"))):
    with open(path, encoding="utf-8") as fh:
        for lineno, line in enumerate(fh, 1):
            m = pat.search(line)
            if not m:
                continue
            s = m.group(1)
            checked += 1
            if not s or s in SKIP_EXACT or s.startswith(SKIP_START):
                continue
            want = ""
            for word, icon in RULES:
                if word in s:
                    want = icon
                    break
            if not want and "فتح" in s and "التقرير" not in s:
                want = "📂"
            if not want and ("عرض" in s or
                             ("فتح" in s and "التقرير" in s)):
                want = "🔍"
            if not want and s in ("▦", "⭳"):
                want = "📤"
            if want and not s.startswith(want):
                bad.append(f"{os.path.basename(path)}:{lineno}: {s!r} "
                           f"توقع {want}")
check(f"فحص {checked} زرًا نصيًا", True)
check("لا أزرار مخالفة للهوية", not bad,
      "; ".join(bad[:8]) + (f" (+{len(bad) - 8})" if len(bad) > 8 else ""))

print("=== تسميات ديناميكية (شرطية/قوائم) ===")
with open(os.path.join(ui_dir, "vouchers.py"), encoding="utf-8") as fh:
    _v = fh.read()
check("سندات الإنشاء ＋",
      '"＋ سند قبض جديد"' in _v and '"＋ سند صرف جديد"' in _v
      and '"＋ سند صرف مجمع"' in _v)
with open(os.path.join(ui_dir, "main_window.py"), encoding="utf-8") as fh:
    _m = fh.read()
check("الأزرار السريعة ＋",
      _m.count('"＋ تسجيل عميل"') == 2
      and _m.count('"＋ عقد جديد"') == 2)
from ui.widgets import level_for as _lv
check("التلوين يتجاهل ＋",
      _lv("＋ سند قبض") == "receipt"
      and _lv("＋ سند صرف") == "danger"
      and _lv("＋ عقد جديد") == "primary")

print("=== بناء زر بالمساعد ===")
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtWidgets import QApplication
_app = QApplication.instance() or QApplication([])
b = action_button("export_excel", "تصدير Excel", kind="primary")
check("نص موحد + primary",
      b.text() == "📤 تصدير Excel"
      and b.objectName() == "btnPrimary")
d = action_button("delete", "حذف المحدد", kind="danger")
check("خطر", d.text() == "🗑 حذف المحدد"
      and d.property("danger") is True)

print(f"\n{'='*40}\nالنتيجة: نجح {PASS} / فشل {FAIL}")
os._exit(1 if FAIL else 0)
