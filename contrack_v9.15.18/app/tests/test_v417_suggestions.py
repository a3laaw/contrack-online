# -*- coding: utf-8 -*-
"""V4.17: اقتراح توزيع جاهز عند الاستيراد — يُراجَع ثم يُعتمد بـ ◆ توزيع.

يغطي: المطابق ← شركتنا · سابقة الهاتف (إجماع/تعارض) · عميل معروف ·
الغامض ← الأخرى · المقفل يُتخطى · شارة ✨ + مسحها بالنقر ·
الاقتراح مرحلة بلا أثر حتى التوزيع.
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

from database import database  # noqa: E402

database.init_db()

from database.models import Customer  # noqa: E402
from services import customer_service  # noqa: E402
from services import gateway_service as gw  # noqa: E402
from services import settlement_service as st  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS " + name)
    else:
        FAIL += 1
        print("  FAIL " + name + (" | " + str(detail) if detail else ""))


G = "Hesabe"
D = "2026-09-20"
st.save_profile(None, G, "بنك H", "KNET", 1, 0.150)
customer_service.add_customer(Customer(
    customer_code="C-SG", name="عميلنا", phone="99110011"))


def _row(phone, amount, ref, status):
    return {"date": D, "phone": phone, "amount": amount, "ref": ref,
            "status": status, "customer": "", "receipt_no": "",
            "note": ""}


print("=== 1. محرك الاقتراح ===")
st.save_gateway_ops(G, [_row("94440001", 100.0, "OLD-O", "other"),
                        _row("94440002", 50.0, "OLD-M", "mine"),
                        _row("94440003", 10.0, "OLD-X1", "mine"),
                        _row("94440003", 20.0, "OLD-X2", "other")], "h.csv")
st.distribute_rows(G, [(D, "94440001", 100.0, "OLD-O"),
                       (D, "94440002", 50.0, "OLD-M"),
                       (D, "94440003", 10.0, "OLD-X1"),
                       (D, "94440003", 20.0, "OLD-X2")])
rows = [_row("94440001", 5.0, "N1", "unmarked"),
        _row("94440002", 5.0, "N2", "unmarked"),
        _row("94440003", 5.0, "N3", "unmarked"),
        _row("99110011", 5.0, "N4", "unmarked"),
        _row("90000009", 5.0, "N5", "unmarked"),
        _row("95550000", 5.0, "N6", "mine")]
cnt = st.suggest_row_classes(G, rows)
check("سابقة أخرى", rows[0]["status"] == "other"
      and rows[0]["_suggest_reason"] == "سابقة: شركة أخرى", rows[0])
check("سابقة شركتنا", rows[1]["status"] == "mine"
      and rows[1]["_suggest_reason"] == "سابقة: شركتنا", rows[1])
check("تعارض ← غير مصنّف", rows[2]["status"] == "unmarked"
      and rows[2].get("_conflict") and not rows[2].get("_suggested"),
      rows[2])
check("عميل معروف ← شركتنا", rows[3]["status"] == "mine"
      and rows[3]["_suggest_reason"] == "عميل معروف", rows[3])
check("غامض ← الأخرى", rows[4]["status"] == "other"
      and rows[4]["_suggest_reason"] == "بلا سابقة", rows[4])
check("مطابق ← شركتنا", rows[5]["status"] == "mine"
      and rows[5]["_suggest_reason"] == "مطابق", rows[5])
check("العدّاد", cnt == {"mine": 3, "other": 2, "unmarked": 1,
                         "conflict": 1}, cnt)

print("=== 2. المقفل يُتخطى ===")
locked = [_row("94440001", 5.0, "L1", "unmarked"),
          _row("90000009", 5.0, "L2", "unmarked"),
          _row("90000009", 6.0, "L3", "unmarked")]
locked[0]["distributed"] = True
locked[1]["paid_before"] = "#9"
locked[2]["manual"] = True
st.suggest_row_classes(G, locked)
check("لا شارة على المقفل",
      not any(r.get("_suggested") or r.get("_conflict")
              for r in locked), locked)

print("=== 3. دورة الواجهة ===")
from PySide6.QtWidgets import QApplication  # noqa: E402
from ui.gateway_page import GatewayPage  # noqa: E402

app = QApplication.instance() or QApplication([])
pg = GatewayPage()
pg._reload_profiles()
pg.gw_combo.setCurrentIndex(pg.gw_combo.findData(G))
csv_path = os.path.join(_tmpdir, "sg.csv")
with open(csv_path, "w", encoding="utf-8") as fh:
    fh.write("phone,amount,date,ref,customer\n"
             "94440001,70.0,2026-09-20,W1,س\n"
             "94440003,30.0,2026-09-20,W2,ص\n")
check("استيراد صفين", pg.import_file(csv_path) == 2)
app.processEvents()
check("الأول مقترح للأخرى (سابقة)",
      pg.table.item(0, 6).text() == "🏢 شركة أخرى"
      and "✨ مقترح: سابقة: شركة أخرى" in pg.table.item(0, 10).text(),
      pg.table.item(0, 10).text())
check("الثاني متعارض بلا اقتراح",
      pg.table.item(1, 6).text() == "⚪ غير مصنّف"
      and "⚠️ سوابق متعارضة" in pg.table.item(1, 10).text(),
      pg.table.item(1, 10).text())
check("بلا أثر قبل التوزيع",
      abs(st.other_dues_total() - 119.7) < 0.001,
      st.other_dues_total())
pg._on_cell(0, 6)  # أخرى ← بدون (قرار المستخدم)
check("النقر يمسح الشارة",
      pg.table.item(0, 6).text() == "⚪ غير مصنّف"
      and "✨" not in pg.table.item(0, 10).text(),
      pg.table.item(0, 10).text())

print("")
print("V4.17 suggestions: " + str(PASS) + " passed, " +
      str(FAIL) + " failed")
sys.exit(1 if FAIL else 0)
