# -*- coding: utf-8 -*-
"""V3.27: بوابة الدفع مغلقة عن السكرتير (زر + دخول + تنبيهات)."""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import database.database as db

_tmpdir = tempfile.mkdtemp()
db.DATA_DIR = _tmpdir
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")
db.init_db()

from services import auth_service  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


from PySide6.QtWidgets import QApplication, QLabel, QPushButton  # noqa: E402

app = QApplication.instance() or QApplication([])
from ui.main_window import IDX_GATEWAY, PAGE_PERMS, MainWindow  # noqa: E402
import services.settlement_service as _st  # noqa: E402

print("=== 1. الصلاحية والخريطة ===")
auth_service._current["role"] = auth_service.ROLE_SECRETARY
auth_service._current_perms = {}
check("السكرتير ممنوع افتراضيًا",
      not auth_service.has_permission("screen_gateway"))
auth_service._current["role"] = auth_service.ROLE_ADMIN
auth_service._current_perms = {}
check("المدير مسموح", auth_service.has_permission("screen_gateway"))
check("الخريطة على المفتاح الجديد",
      PAGE_PERMS.get(IDX_GATEWAY) == "screen_gateway")

print("=== 2. السكرتير: بلا زر ولا دخول ولا تنبيه ===")
_real_late = _st.late_settlements
_st.late_settlements = lambda n=10: [{"gateway": "KNET", "day": "2026-01-01",
                                      "expect": 5.0,
                                      "settle_date": "2026-01-02"}]
try:
    auth_service._current["role"] = auth_service.ROLE_SECRETARY
    auth_service._current_perms = {}
    w = MainWindow()
    w.show()
    app.processEvents()
    _btns = [b.text() for b in w.findChildren(QPushButton)]
    check("لا زر بوابة في القائمة",
          not any("بوابة الدفع" in t for t in _btns))
    _before = w.stack.currentIndex()
    w._navigate(IDX_GATEWAY)
    app.processEvents()
    check("الدخول المباشر محجوب", w.stack.currentIndex() == _before,
          f"{_before}->{w.stack.currentIndex()}")
    w.dashboard.refresh()
    app.processEvents()
    _txts = ([x.text() for x in w.dashboard.findChildren(QLabel)]
             + [x.text() for x in w.dashboard.findChildren(QPushButton)])
    check("لا تنبيه تسوية", not any("تسوية بوابة" in t for t in _txts))
    # بلا close(): إغلاق النافذة يفتح حوار تأكيد يعلّق offscreen

    print("=== 3. المدير: زر ودخول وتنبيه ===")
    auth_service._current["role"] = auth_service.ROLE_ADMIN
    auth_service._current_perms = {}
    w2 = MainWindow()
    w2.show()
    app.processEvents()
    _btns2 = [b.text() for b in w2.findChildren(QPushButton)]
    check("زر البوابة موجود", any("بوابة الدفع" in t for t in _btns2))
    w2.dashboard.refresh()
    app.processEvents()
    _txts2 = ([x.text() for x in w2.dashboard.findChildren(QLabel)]
              + [x.text() for x in w2.dashboard.findChildren(QPushButton)])
    check("تنبيه التسوية ظاهر", any("تسوية بوابة" in t for t in _txts2))
    w2._navigate(IDX_GATEWAY)
    app.processEvents()
    check("الدخول مسموح", w2.stack.currentIndex() == IDX_GATEWAY,
          str(w2.stack.currentIndex()))
finally:
    _st.late_settlements = _real_late
    auth_service._current["role"] = auth_service.ROLE_ADMIN
    auth_service._current_perms = None

print(f"\nالنتيجة: {PASS} ناجح / {FAIL} فاشل")
sys.exit(1 if FAIL else 0)
