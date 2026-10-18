# -*- coding: utf-8 -*-
"""V4.33: رقم الصفحة فوق شريط الفوتر لا عليه (جداول + كشف عهدة).

يغطي: قياس ارتفاع الصورة (مع سقف 30مم) · الرقم فوق الصورة في كل صفحة ·
المحتوى والملاحظة فوق الشريط · انحدار بلا صورة (الرقم 8مم كما كان).
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

from services import settings_service as st  # noqa: E402
from reports.pdf_utils import footer_image_height  # noqa: E402
from reports.tabular_pdf import generate_table_pdf  # noqa: E402
from reports.custody_pdf import generate_custody_pdf  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS " + name)
    else:
        FAIL += 1
        print("  FAIL " + name + (" | " + str(detail) if detail else ""))


MM = 2.834645669


def _band_png(path, w, h, color=(30, 58, 95)):
    """شريط PNG بلون واحد — كاتب مضمّن بلا اعتماديات."""
    import struct
    import zlib
    row = b"\x00" + bytes(color) * w
    raw = row * h
    def _chunk(typ, data):
        c = struct.pack(">I", len(data)) + typ + data
        return c + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)
    png = (b"\x89PNG\r\n\x1a\n"
           + _chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
           + _chunk(b"IDAT", zlib.compress(bytes(raw)))
           + _chunk(b"IEND", b""))
    with open(path, "wb") as fh:
        fh.write(png)
    return path


def _set_footer(path):
    s = st.get_settings()
    s.footer_image = path
    st.save_settings(s)
    st._settings_cache = None


def _page_info(pdf_path):
    """(عدد الصفحات، [لكل صفحة: (أعلى الصورة من الأسفل، شذرات النص)])."""
    import pymupdf
    doc = pymupdf.open(pdf_path)
    out = []
    for page in doc:
        W, H = page.rect.width, page.rect.height
        img_top = 0.0
        for img in page.get_images(full=True):
            bb = page.get_image_bbox(img[7])
            img_top = max(img_top, (H - bb.y0) / MM)
        spans = []
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                for sp in line.get("spans", []):
                    b = sp["bbox"]
                    spans.append({"t": sp["text"],
                                  "bot": (H - b[3]) / MM,
                                  "xc": ((b[0] + b[2]) / 2 - W / 2) / MM})
        out.append({"img_top": img_top, "spans": spans})
    doc.close()
    return len(out), out


def _is_ar(ch):
    o = ord(ch)
    return (0x0600 <= o <= 0x06FF or 0xFB50 <= o <= 0xFDFF
            or 0xFE70 <= o <= 0xFEFF)


def _number_span(pg):
    # «صفحة رقم X من Y» — تختلف صورة الاستخراج حسب الخط المضمّن
    # (حروف أصلية معكوسة أو أشكال عرض U+FE70…U+FEFF) فيُطبّع قبل المطابقة.
    import unicodedata
    for s in pg["spans"]:
        t = unicodedata.normalize("NFKC", s["t"])
        if (abs(s["xc"]) < 25
                and ("رقم" in t or "مقر" in t)
                and ("صفحة" in t or "ةحفص" in t)
                and any(ch.isdigit() for ch in t)):
            return s
    return None


TALL = _band_png(os.path.join(_tmpdir, "tall.png"), 1200, 180)
SHORT = _band_png(os.path.join(_tmpdir, "short.png"), 1200, 60)

print("=== 1. قياس ارتفاع الصورة ===")
check("الطويلة تُسقف 30مم", abs(footer_image_height(297 * MM, TALL) / MM - 30) < 0.5,
      footer_image_height(297 * MM, TALL) / MM)
check("القصيرة بنسبة العرض ≈14.9مم",
      abs(footer_image_height(297 * MM, SHORT) / MM - 14.85) < 0.6,
      footer_image_height(297 * MM, SHORT) / MM)

print("=== 2. جدول متعدد الصفحات مع فوتر طويل ===")
_set_footer(TALL)
_heads = ["م", "التاريخ", "العميل", "العقد", "الهاتف", "المبلغ", "البيان"]
_rows = [[n, "2026-09-01", "عميل", "عقد", "55000000", 100.0 + n, "بيان"]
         for n in range(1, 41)]
_p1 = os.path.join(_tmpdir, "t.pdf")
generate_table_pdf("التقرير المالي", _heads, [7, 22, 28, 28, 16, 16, 64],
                   _rows, _p1, totals_row=["الإجمالي", "", "", "", "", 1000.0, ""],
                   footer_note="ملاحظة أسفل الجدول")
_n1, _pgs1 = _page_info(_p1)
check("تولّد ≥ صفحتين", _n1 >= 2, _n1)
_ok_img = all(p["img_top"] > 28 for p in _pgs1)
check("شريط الفوتر 30مم في كل صفحة", _ok_img,
      [round(p["img_top"], 1) for p in _pgs1])
_nums = [_number_span(p) for p in _pgs1]
check("رقم الصفحة موجود ممركزًا في كل صفحة", all(_nums),
      [round(n["bot"], 1) if n else None for n in _nums])
_above = all(n and n["bot"] > p["img_top"] + 1 for n, p in zip(_nums, _pgs1))
check("الرقم فوق الشريط (+1مم على الأقل)", _above,
      [(round(n["bot"], 1), round(p["img_top"], 1)) if n else None
       for n, p in zip(_nums, _pgs1)])
_low = [s for p in _pgs1 for s in p["spans"]
        if s["bot"] < p["img_top"] - 2]
check("لا نص إطلاقًا داخل الشريط (محتوى/ملاحظة/إجمالي)", not _low,
      [(s["t"][:12], round(s["bot"], 1)) for s in _low[:3]])

print("=== 3. انحدار الجدول بلا صورة ===")
_set_footer("")
_p2 = os.path.join(_tmpdir, "t2.pdf")
generate_table_pdf("التقرير المالي", _heads, [7, 22, 28, 28, 16, 16, 64],
                   _rows[:8], _p2, totals_row=["الإجمالي", "", "", "", "", 100.0, ""],
                   footer_note="ملاحظة")
_n2, _pgs2 = _page_info(_p2)
check("صفحة واحدة بلا شريط", _n2 == 1 and _pgs2[0]["img_top"] == 0,
      (_n2, _pgs2[0]["img_top"]))
_n2s = _number_span(_pgs2[0])
check("الرقم 8مم كما كان", _n2s and abs(_n2s["bot"] - 8) < 3,
      round(_n2s["bot"], 1) if _n2s else None)

print("=== 4. كشف عهدة مع فوتر ===")
_set_footer(TALL)
_data = {"group_ref": "G-1", "handed": 1000.0, "spent": 600.0,
         "balance": 400.0, "cancelled_count": 0,
         "lines": [{"vdate": "2026-09-05", "party": "مورد",
                    "description": "بند %d" % n, "amount": 100.0 + n,
                    "account": "مواد", "cancelled": False}
                   for n in range(1, 6)]}
_p3 = os.path.join(_tmpdir, "c.pdf")
generate_custody_pdf(_data, _p3)
_n3, _pgs3 = _page_info(_p3)
check("شريط الفوتر في الكشف", _pgs3[0]["img_top"] > 28,
      round(_pgs3[0]["img_top"], 1))
_n3s = _number_span(_pgs3[0])
check("رقم الصفحة فوق الشريط",
      _n3s and _n3s["bot"] > _pgs3[0]["img_top"] + 1,
      round(_n3s["bot"], 1) if _n3s else None)
_low3 = [s for s in _pgs3[0]["spans"]
         if s["bot"] < _pgs3[0]["img_top"] - 2]
check("لا نص داخل الشريط", not _low3,
      [(s["t"][:12], round(s["bot"], 1)) for s in _low3[:3]])

print("=== 5. انحدار العهدة بلا صورة ===")
_set_footer("")
_p4 = os.path.join(_tmpdir, "c2.pdf")
generate_custody_pdf(_data, _p4)
_n4, _pgs4 = _page_info(_p4)
_n4s = _number_span(_pgs4[0])
check("الرقم 8مم كما كان", _n4s and abs(_n4s["bot"] - 8) < 3,
      round(_n4s["bot"], 1) if _n4s else None)

_set_footer("")
print("")
print("V4.33 pdf-footer: " + str(PASS) + " passed, " +
      str(FAIL) + " failed")
sys.exit(1 if FAIL else 0)
