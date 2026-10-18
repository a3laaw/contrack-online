# -*- coding: utf-8 -*-
"""V2.07 بند 4: نموذج تصفية العهدة الفارغ 16 سطرًا في صفحة عمودية."""
import os
import sys
import tempfile

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)

from database import database  # noqa: E402
from reports.custody_pdf import generate_blank_custody_settlement_form  # noqa: E402


def main() -> None:
    try:
        from pypdf import PdfReader
    except ImportError:
        print("SKIP: pypdf غير مثبتة")
        return
    database.init_db()
    out = os.path.join(tempfile.mkdtemp(), "blank.pdf")
    generate_blank_custody_settlement_form(out)
    pg = PdfReader(out).pages[0]
    w, h = float(pg.mediabox.width), float(pg.mediabox.height)
    assert len(PdfReader(out).pages) == 1
    assert abs(w - 595.27) < 1 and abs(h - 841.89) < 1, (w, h)
    import re
    nums = sorted(set(int(x) for x in re.findall(
        r"(?<!\d)(\d{1,2})(?!\d)", pg.extract_text() or "")
        if 1 <= int(x) <= 16))
    assert nums == list(range(1, 17)), nums
    print("OK: نموذج فارغ عمودي بـ 16 سطرًا في صفحة واحدة")


if __name__ == "__main__":
    main()
