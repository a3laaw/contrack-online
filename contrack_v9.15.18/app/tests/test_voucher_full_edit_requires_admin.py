# -*- coding: utf-8 -*-
"""حفظ تعديل السند الكامل يجب أن يتطلب اعتماد المدير."""
import os
import sys
from pathlib import Path

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)


def main() -> None:
    src = Path("ui/vouchers.py").read_text(encoding="utf-8")
    assert 'style.require_admin(self, "حفظ تعديل السند")' in src
    assert 'style.require_admin(self, "حفظ تعديل السند", perm=' not in src
    auth = Path("services/auth_service.py").read_text(encoding="utf-8")
    block_start = auth.index('"action_edit_voucher"')
    block = auth[block_start:auth.index('"action_edit_voucher_description"', block_start)]
    assert '"secretary": True' in block
    print("OK: تعديل السند الكامل متاح للسكرتير لكن حفظه يتطلب اعتماد المدير")


if __name__ == "__main__":
    main()
