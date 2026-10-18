#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
إعادة بناء كود ConTrack V9.15.18 من الأجزاء النصية (part_XX.txt).

الاستخدام:
    python3 rebuild_from_parts.py

- يقرأ فهرس 00_الفهرس_وتعليمات_إعادة_البناء.md ويستخرج جدول الملفات المتوقع.
- يمسح كل ملفات part_*.txt الموجودة في مجلد الرفع /home/z/my-project/upload.
- يستخرج محتوى كل ملف بين سطري:
      ===== BEGIN file: <path> [ (قطعة i من n)] =====
      ===== END <path> [ (قطعة i من n)] =====
- يجمع الملفات المقسّمة على أكثر من قطعة بالترتيب (قطعة 1، ثم 2 ...).
- يطابق عدد الأحرف مع جدول الفهرس ويختار الصيغة المطابقة تلقائيًا
  (مع/بدون \\r، مع/بدون سطر أخير فارغ، فاصل القطع '\\n' أو مباشر).
- يكتب الناتج داخل مجلد إعادة البناء (app/ ...) دون المساس بقواعد البيانات.

يمكن إعادة تشغيل هذا السكربت في أي وقت بعد رفع أجزاء إضافية؛
سيكتمل بناء بقية الملفات تلقائيًا دون حذف ما بُني سابقًا.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

UPLOAD_DIR = Path("/home/z/my-project/upload")
INDEX_FILE = UPLOAD_DIR / "00_الفهرس_وتعليمات_إعادة_البناء.md"
ROOT = Path(__file__).resolve().parent  # مجلد إعادة البناء

BEGIN_PREFIX = "===== BEGIN file: "
END_PREFIX = "===== END "
SUFFIX = " ====="
CHUNK_RE = re.compile(r"\s*\(قطعة (\d+) من (\d+)\)$")

# قاعدة البيانات وملفاتها الجانبية لا تُكتب أبدًا من هنا (كما في تعليمات الفهرس)
EXCLUDE_PATTERNS = (
    "app/data/database.sqlite",
    "app/data/database.sqlite-wal",
    "app/data/database.sqlite-shm",
    "app/database/contrack.db",
)


def parse_index() -> dict[str, dict]:
    """يستخرج جدول الملفات من الفهرس: path -> {size, chunks, parts}."""
    expected: dict[str, dict] = {}
    for raw in INDEX_FILE.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) != 4:
            continue
        path_cell, size_cell, chunks_cell, parts_cell = cells
        if not (path_cell.startswith("`") and path_cell.endswith("`")):
            continue
        if not (size_cell.replace(",", "").isdigit() and chunks_cell.isdigit()):
            continue
        try:
            parts = [int(p) for p in parts_cell.split(",")]
        except ValueError:
            continue
        expected[path_cell.strip("`")] = {
            "size": int(size_cell.replace(",", "")),
            "chunks": int(chunks_cell),
            "parts": parts,
        }
    return expected


def parse_part_file(fn: Path, blocks: dict[str, dict[int, str]]) -> None:
    """يستخرج كل الكتل من ملف جزء واحد ويضيفها إلى blocks[path][chunk_no]."""
    # newline='' يحافظ على '\r' داخل الأسطر كما هي (بدون ترجمة CRLF)
    with open(fn, "r", encoding="utf-8", newline="") as f:
        text = f.read()
    lines = text.split("\n")

    cur_path: str | None = None
    cur_chunk = 1
    cur_buf: list[str] = []

    for ln in lines:
        if cur_path is None:
            if ln.startswith(BEGIN_PREFIX) and ln.endswith(SUFFIX):
                inner = ln[len(BEGIN_PREFIX) : -len(SUFFIX)]
                m = CHUNK_RE.search(inner)
                if m:
                    cur_chunk = int(m.group(1))
                    inner = inner[: m.start()]
                else:
                    cur_chunk = 1
                cur_path = inner
                cur_buf = []
            # أي سطر آخر خارج كتلة يُتجاهل (ترويسة الجزء مثلًا)
        else:
            if ln.startswith(END_PREFIX) and ln.endswith(SUFFIX):
                inner = ln[len(END_PREFIX) : -len(SUFFIX)]
                m = CHUNK_RE.search(inner)
                if m:
                    inner = inner[: m.start()]
                if inner == cur_path:
                    blocks.setdefault(cur_path, {})[cur_chunk] = "\n".join(cur_buf)
                    cur_path = None
                    cur_buf = []
                    continue
            if ln.startswith(BEGIN_PREFIX) and ln.endswith(SUFFIX):
                print(f"WARN: BEGIN متداخل داخل كتلة {cur_path} في {fn.name} — يُعامل كمحتوى")
            cur_buf.append(ln)

    if cur_path is not None:
        print(f"WARN: كتلة غير مغلقة {cur_path} في {fn.name} — تم تجاهلها")


def candidate_variants(chunks: list[str]) -> list[str]:
    """توليد صيغ مرشّحة للمحتوى النهائي لمطابقة حجم الفهرس."""
    candidates = []
    for joiner in ("\n", ""):
        joined = joiner.join(chunks)
        candidates.append(joined)
        candidates.append(joined + "\n")
        if joined.endswith("\n"):
            candidates.append(joined[:-1])
    out, seen = [], set()
    for c in candidates:
        for v in (c, c.replace("\r\n", "\n")):
            if v not in seen:
                seen.add(v)
                out.append(v)
    return out


def main() -> int:
    if not INDEX_FILE.exists():
        print(f"ERROR: ملف الفهرس غير موجود: {INDEX_FILE}")
        return 1

    expected = parse_index()
    print(f"الفهرس: {len(expected)} ملفًا متوقعًا في الإصدار الكامل (25 جزءًا)")

    part_files = sorted(UPLOAD_DIR.glob("part_*.txt"))
    if not part_files:
        print("ERROR: لا توجد ملفات أجزاء part_*.txt في مجلد الرفع")
        return 1
    print(f"الأجزاء المتاحة: {', '.join(f.name for f in part_files)}")

    blocks: dict[str, dict[int, str]] = {}
    for fn in part_files:
        parse_part_file(fn, blocks)
    print(f"تم استخراج كتل لـ {len(blocks)} مسارًا فريدًا")

    # ---- تجميع وكتابة الملفات ----
    rebuilt_ok = 0
    rebuilt_mismatch: list[tuple[str, int, int]] = []  # path, actual, expected
    missing_chunks: list[str] = []

    for path, chunks in sorted(blocks.items()):
        if any(path.startswith(p) or path == p for p in EXCLUDE_PATTERNS):
            print(f"SKIP (قاعدة بيانات — لا تُنسخ): {path}")
            continue
        need = max(chunks.keys())
        have = sorted(k for k in chunks if chunks[k] is not None)
        if have != list(range(1, need + 1)):
            missing_chunks.append(f"{path} (القطع الموجودة: {have})")
            continue

        ordered = [chunks[i] for i in range(1, need + 1)]
        content = "\n".join(ordered)  # الافتراضي إن لم تطابق أي صيغة

        exp = expected.get(path)
        if exp is not None:
            matched = None
            for v in candidate_variants(ordered):
                if len(v) == exp["size"]:
                    matched = v
                    break
            if matched is not None:
                content = matched
                rebuilt_ok += 1
            else:
                rebuilt_mismatch.append((path, len(content), exp["size"]))
                print(
                    f"WARN: حجم غير مطابق {path}: فعلي={len(content)} "
                    f"متوقع={exp['size']} — تمت الكتابة بالصيغة الافتراضية"
                )

        out = ROOT / path
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(content.encode("utf-8"))

    # ---- مقارنة شاملة مع الفهرس ----
    available_parts = set()
    for fn in part_files:
        m = re.search(r"part_(\d+)", fn.name)
        if m:
            available_parts.add(int(m.group(1)))

    not_yet = []       # ملفات أجزاؤها غير مرفوعة بعد
    expected_now = 0   # ملفات يجب أن تكون قابلة للبناء بالأجزاء المتاحة
    for path, info in sorted(expected.items()):
        if any(p in available_parts for p in info["parts"]):
            expected_now += 1
        else:
            not_yet.append(path)

    built_paths = {
        p for p in blocks
        if not any(p.startswith(x) or p == x for x in EXCLUDE_PATTERNS)
        and sorted(k for k in blocks[p]) == list(range(1, max(blocks[p].keys()) + 1))
    }

    unexpected = sorted(set(built_paths) - set(expected))
    if unexpected:
        print("WARN: مسارات مبنية غير موجودة في جدول الفهرس:", unexpected)

    print()
    print("=" * 62)
    print("ملخص إعادة البناء")
    print("=" * 62)
    print(f"ملفات متوقعة في الإصدار الكامل      : {len(expected)}")
    print(f"ملفات يمكن بناؤها بالأجزاء المتاحة  : {expected_now}")
    print(f"ملفات بُنيت ومطابقة الحجم للفهرس    : {rebuilt_ok}")
    print(f"ملفات بُنيت بحجم غير مطابق          : {len(rebuilt_mismatch)}")
    print(f"ملفات ناقصة القطع                   : {len(missing_chunks)}")
    print(f"ملفات تنتظر أجزاء لم تُرفع بعد      : {len(not_yet)}")

    if missing_chunks:
        print("\n[!] ملفات ناقصة القطع:")
        for p in missing_chunks:
            print("  -", p)

    if not_yet:
        print("\n[i] ملفات تنتظر الأجزاء غير المرفوعة (نماذج):")
        for p in not_yet[:15]:
            info = expected[p]
            print(f"  - {p}  (الأجزاء: {','.join(f'{x:02d}' for x in info['parts'])})")
        if len(not_yet) > 15:
            print(f"  ... و{len(not_yet) - 15} ملفًا آخر")

    missing_parts = sorted(set(range(1, 26)) - available_parts)
    if missing_parts:
        print(
            "\n[i] أجزاء غير مرفوعة بعد: "
            + ", ".join(f"{p:02d}" for p in missing_parts)
        )
        print("    عند رفعها أعد تشغيل هذا السكربت لاكتمال البناء.")

    print()
    print(f"مجلد إعادة البناء: {ROOT}")
    ok = not rebuilt_mismatch and not missing_chunks
    print("الحالة: " + ("اكتمل البناء المتاح بنجاح ✔" if ok else "اكتمل مع ملاحظات — راجع أعلاه"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
