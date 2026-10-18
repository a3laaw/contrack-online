# -*- coding: utf-8 -*-
"""اسم المستخدم غير حساس لحالة الأحرف (كبير = صغير).

- الدخول بأي حالة أحرف ينجح مع كلمة المرور الصحيحة.
- الجلسة تُوحَّد للصيغة المخزنة مع الدور الصحيح (لا ترقية لمدير!).
- منع إنشاء مستخدم جديد يطابق اسمًا موجودًا باختلاف الحالة فقط.
"""
import os
import sys

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)

from database import database  # noqa: E402
from services import auth_service as au  # noqa: E402
from services.customer_service import ValidationError  # noqa: E402


def main():
    database.init_db()
    au.ensure_default_user()
    uid = None
    try:
        assert au.verify_login("ADMIN", "admin"), "دخول المدير بكبير"
        uid = au.add_user("CaseUser", "pw1234", au.ROLE_SECRETARY,
                          full_name="مستخدم حالة")
        for variant in ("CaseUser", "caseuser", "CASEUSER", "cAsEuSeR"):
            assert au.verify_login(variant, "pw1234"), f"دخول: {variant}"
        print("OK: الدخول ينجح بأي حالة أحرف")
        assert not au.verify_login("caseuser", "wrong"), \
            "كلمة خاطئة يجب أن ترفض"
        assert not au.verify_login("ghost", "pw1234"), \
            "اسم غير موجود يجب أن يرفض"
        print("OK: الكلمة الخاطئة والاسم الغريب مرفوضان")

        au.set_current_user("CASEUSER")
        assert au.current_username() == "CaseUser", au.current_username()
        assert au.current_role() == au.ROLE_SECRETARY, au.current_role()
        assert not au.is_admin(), "يجب ألا يترقى لمدير!"
        print("OK: الجلسة موحدة للصيغة المخزنة مع الدور الصحيح")

        u = au.get_user("cAsEuSeR")
        assert u and u["username"] == "CaseUser", u
        print("OK: جلب المستخدم غير حساس للحالة")

        for dup in ("caseuser", "CASEUSER"):
            try:
                au.add_user(dup, "pw1234", au.ROLE_SECRETARY)
            except ValidationError:
                pass
            else:
                raise AssertionError(f"تكرار مقبول خطأ: {dup}")
        print("OK: منع التكرار باختلاف الحالة فقط")

        # تغيير البيانات باسم حالي بحالة مختلفة + تصحيح حالة الاسم
        au.change_credentials("caseuser", "pw1234", "CaseUser", "pw5678",
                              "pw5678")
        assert au.verify_login("CASEUSER", "pw5678")
        print("OK: تغيير البيانات يعمل بأي حالة أحرف")
    finally:
        if uid:
            try:
                au.delete_user(uid)
            except Exception:
                pass
    print("PASS")


if __name__ == "__main__":
    main()
