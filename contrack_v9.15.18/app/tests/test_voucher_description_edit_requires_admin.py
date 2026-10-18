# -*- coding: utf-8 -*-
"""حفظ تعديل بيان السند فقط يجب أن يمر عبر كلمة مرور/صلاحية المدير."""
import os
import sys
from pathlib import Path

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)


def main() -> None:
    src = Path("ui/vouchers.py").read_text(encoding="utf-8")
    needle = 'style.require_admin(self, "حفظ تعديل بيان السند فقط")'
    assert needle in src, "حفظ تعديل البيان فقط يجب أن يطلب اعتماد المدير بدون تمرير صلاحية تتجاوز الطلب"
    assert 'style.require_admin(self, "حفظ تعديل بيان السند فقط", perm=' not in src
    print("OK: حفظ تعديل بيان السند فقط يتطلب اعتماد المدير")


if __name__ == "__main__":
    main()
