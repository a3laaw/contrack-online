# -*- coding: utf-8 -*-
"""انحدار V2.44: مسار محلي على المضيف مقبول · قرص الشبكة المعيَّن مرفوض."""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

passed = failed = 0


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ✅ {name}")
    else:
        failed += 1
        print(f"  ❌ {name} {extra}")


from services import network_single_db_service as svc  # noqa: E402

print("=== 1. تصنيف المسارات ===")
check("UNC بشرطة لورا", svc.drive_kind("\\\\SERVER\\ConTrackData") == "unc")
check("UNC بشرطة لقدام", svc.drive_kind("//SERVER/ConTrackData") == "unc")
check("مسار نسبي", svc.drive_kind("data\\x") == "relative")
check("حرف قرص على غير ويندوز = unknown",
      svc.drive_kind("Z:\\Nope") == "unknown" or os.name == "nt")

print("=== 2. رفض قرص الشبكة المعيَّن ===")
_real_kind = svc.drive_kind
svc.drive_kind = lambda f: "remote"
try:
    r = svc.health_check("Z:\\ConTrackData")
    check("مرفوض مع ذكر السبب",
          not r.get("ok") and any(c["name"] == "نوع المسار" and not c["ok"]
                                  for c in r.get("checks", [])), r)
finally:
    svc.drive_kind = _real_kind

print("=== 3. رفض القرص القابل للإزالة ===")
svc.drive_kind = lambda f: "removable"
try:
    r = svc.health_check("E:\\ConTrackData")
    check("مرفوض", not r.get("ok"), r.get("ok"))
finally:
    svc.drive_kind = _real_kind

print("=== 4. قبول المسار المحلي الثابت (فحص كامل) ===")
tmp = tempfile.mkdtemp(prefix="cb44_")
svc.drive_kind = lambda f: "fixed"
try:
    r = svc.health_check(tmp)
    names = {c["name"]: c["ok"] for c in r.get("checks", [])}
    check("الفحص الكامل ناجح على مجلد محلي", r.get("ok") is True, names)
    check("نوع المسار مقبول", names.get("نوع المسار") is True, names)
    check("SQLite يعمل", names.get("SQLite shared DB") is True, names)
finally:
    svc.drive_kind = _real_kind
    import shutil
    shutil.rmtree(tmp, ignore_errors=True)

print(f"\nالنتيجة: {passed} ناجح / {failed} فاشل")
sys.exit(1 if failed else 0)
