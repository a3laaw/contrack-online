# -*- coding: utf-8 -*-
"""خدمة المصادقة: تسجيل الدخول وإدارة المستخدم وكلمة المرور.

كلمات المرور لا تُخزَّن نصًا أبدًا · تُخزَّن بتجزئة PBKDF2-SHA256 مع Salt عشوائي.
"""
import hashlib
import os
import sqlite3

from database.database import get_connection, DatabaseError
from services.customer_service import ValidationError

_ITERATIONS = 200_000

# بيانات الدخول الافتراضية عند أول تشغيل
DEFAULT_USERNAME = "admin"
DEFAULT_PASSWORD = "admin"


def _hash_password(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), _ITERATIONS
    ).hex()


def ensure_default_user() -> bool:
    """ينشئ المستخدم الافتراضي admin/admin عند أول تشغيل.
    يرجع True إذا أُنشئ الآن (أي أول تشغيل)."""
    try:
        with get_connection() as conn:
            count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            if count:
                return False
            salt = os.urandom(16).hex()
            conn.execute(
                "INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)",
                (DEFAULT_USERNAME, _hash_password(DEFAULT_PASSWORD, salt), salt),
            )
            return True
    except sqlite3.Error as exc:
        raise DatabaseError(f"خطأ في تهيئة المستخدم: {exc}") from exc


def verify_login(username: str, password: str) -> bool:
    """التحقق من اسم المستخدم وكلمة المرور."""
    username = (username or "").strip()
    if not username or not password:
        return False
    try:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT password_hash, salt FROM users "
                "WHERE username = ? COLLATE NOCASE",
                (username,),
            ).fetchone()
    except sqlite3.Error:
        return False
    if not row:
        return False
    return _hash_password(password, row["salt"]) == row["password_hash"]


def is_default_password(username: str) -> bool:
    """هل ما زال المستخدم على كلمة المرور الافتراضية؟ (للتنبيه)"""
    return verify_login(username, DEFAULT_PASSWORD)


def change_credentials(current_username: str, current_password: str,
                       new_username: str, new_password: str,
                       confirm_password: str) -> None:
    """تغيير اسم المستخدم و/أو كلمة المرور بعد التحقق من الحالية."""
    if not verify_login(current_username, current_password):
        raise ValidationError("كلمة المرور الحالية غير صحيحة.")
    new_username = (new_username or "").strip()
    if not new_username:
        raise ValidationError("اسم المستخدم الجديد مطلوب.")
    if len(new_username) < 3:
        raise ValidationError("اسم المستخدم يجب أن يكون 3 أحرف على الأقل.")
    with get_connection() as conn:
        cur = conn.execute(
            "SELECT id FROM users WHERE username=? COLLATE NOCASE",
            (current_username.strip(),)).fetchone()
        clash = conn.execute(
            "SELECT id FROM users WHERE username=? COLLATE NOCASE",
            (new_username,)).fetchone()
    if clash and (not cur or int(clash["id"]) != int(cur["id"])):
        raise ValidationError("اسم المستخدم مستخدم من قبل.")
    if not new_password:
        raise ValidationError("كلمة المرور الجديدة مطلوبة.")
    if len(new_password) < 4:
        raise ValidationError("كلمة المرور يجب أن تكون 4 أحرف على الأقل.")
    if new_password != confirm_password:
        raise ValidationError("تأكيد كلمة المرور غير مطابق.")
    salt = os.urandom(16).hex()
    try:
        with get_connection() as conn:
            conn.execute(
                "UPDATE users SET username=?, password_hash=?, salt=? "
                "WHERE username=? COLLATE NOCASE",
                (new_username, _hash_password(new_password, salt), salt,
                 current_username.strip()),
            )
    except sqlite3.IntegrityError as exc:
        raise ValidationError("اسم المستخدم مستخدم من قبل.") from exc
    except sqlite3.Error as exc:
        raise DatabaseError(f"خطأ في تحديث بيانات الدخول: {exc}") from exc


def get_username() -> str:
    """اسم المستخدم الحالي (أول مستخدم)."""
    try:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT username FROM users ORDER BY id LIMIT 1").fetchone()
        return row["username"] if row else DEFAULT_USERNAME
    except sqlite3.Error:
        return DEFAULT_USERNAME


# ============================================================
# الأدوار والصلاحيات
# ============================================================
ROLE_DEVELOPER = "developer"  # المطور · أدوات التركيب والتخصيص (لا تُسلَّم للعميل)
ROLE_ADMIN = "admin"        # مدير · كل الصلاحيات التشغيلية
ROLE_SECRETARY = "secretary"  # سكرتير · العمل اليومي فقط

ROLE_LABELS = {ROLE_DEVELOPER: "مطور", ROLE_ADMIN: "مدير",
               ROLE_SECRETARY: "سكرتير"}
# الأدوار التي يستطيع المدير إنشاءها (المطور لا يُنشأ من داخل النظام)
ASSIGNABLE_ROLES = (ROLE_ADMIN, ROLE_SECRETARY)

# المستخدم الحالي بعد تسجيل الدخول (يُضبط من شاشة الدخول)
_current = {"username": "", "role": ROLE_ADMIN}


def set_current_user(username: str) -> None:
    """تسجيل المستخدم الحالي بعد نجاح الدخول."""
    global _current_perms
    role = ROLE_ADMIN
    try:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT username, role FROM users "
                "WHERE username=? COLLATE NOCASE",
                (username,)).fetchone()
        if row:
            username = row["username"]
            if row["role"] in (ROLE_DEVELOPER, ROLE_ADMIN, ROLE_SECRETARY):
                role = row["role"]
    except sqlite3.Error:
        pass
    _current["username"] = username
    _current["role"] = role
    # صلاحيات الجلسة السابقة تُهمل وتُحمَّل عند أول سؤال عنها
    _current_perms = None


def current_username() -> str:
    return _current["username"]


def current_role() -> str:
    return _current["role"]


def is_admin() -> bool:
    # المطور يملك كل صلاحيات المدير وزيادة
    return _current["role"] in (ROLE_ADMIN, ROLE_DEVELOPER)


def is_developer() -> bool:
    """حساب المطور: يرى أدوات التركيب والتخصيص المخفية عن العميل."""
    return _current["role"] == ROLE_DEVELOPER


# ============================================================
# الصلاحيات الدقيقة لكل مستخدم (Granular Permissions)
# ============================================================
# المدير يفتح ملف الموظف من: الإعدادات ← الأمان والمستخدمون ←
# «صلاحيات الموظف»، ويؤشر له ما يراه من الشاشات وما يفعله من
# الإجراءات — بدل الصلاحيات المجمّعة حسب الدور فقط.
#   • المدير والمطور: كل الصلاحيات دائمًا (لا يمكن تقييدهما).
#   • السكرتير: يبدأ من افتراضيات دوره «العمل اليومي» — وهي نفس
#     سلوك النظام قبل هذه الميزة بالضبط — ويمكن للمدير منحه أو
#     منع أي بند عنه بندًا بندًا.
#   • التخصيص يُخزَّن كاملًا في جدول user_permissions، وحذفه يعيد
#     الموظف لافتراضيات دوره.
# كل مفتاح أدناه مربوط بنقطة منع فعلية في الواجهة (قائمة أو زر
# أو شاشة) — لا يوجد مفتاح بلا أثر (قاعدة: الفحص لا يكفي،
# يجب أن يكون منفَّذًا فعلًا).

PERMISSIONS: dict[str, dict] = {
    # ---------- الشاشات ----------
    "screen_customers": {
        "name": "شاشة العملاء والعقود",
        "desc": "قائمة العملاء والعقود وفتح ملفاتهم ومركز العقد",
        "group": "الشاشات", "secretary": True,
    },
    "screen_subcontractors": {
        "name": "شاشة مقاولي الباطن",
        "desc": "قائمة المقاولين وعقود الباطن",
        "group": "الشاشات", "secretary": True,
    },
    "screen_receipts": {
        "name": "شاشة سندات القبض",
        "desc": "قائمة سندات القبض وعرضها وطباعتها",
        "group": "الشاشات", "secretary": True,
    },
    "screen_payments": {
        "name": "شاشة سندات الصرف",
        "desc": "قائمة سندات الصرف وعرضها وطباعتها",
        "group": "الشاشات", "secretary": True,
    },
    "screen_visits": {
        "name": "جدول الزيارات اليومي",
        "desc": "شاشة مواعيد الزيارات: الساعات × المهندسين مع الترحيل "
                "كمهام وتذكير الواتساب وتصدير PDF",
        "group": "الشاشات", "secretary": True,
    },
    "screen_statement": {
        "name": "شاشة كشف الحساب",
        "desc": "كشف حساب العقد وتصديره",
        "group": "الشاشات", "secretary": True,
    },
    "screen_reports": {
        "name": "شاشة التقارير",
        "desc": "كل التقارير (كل تقرير له تأشيرة مستقلة أدناه)",
        "group": "الشاشات", "secretary": True,
    },
    "screen_followup": {
        "name": "لوحة المتابعة",
        "desc": "لوحة متابعة المعاملات بمراحلها",
        "group": "الشاشات", "secretary": True,
    },
    "screen_forms": {
        "name": "شاشة مركز النماذج",
        "desc": "مكتبة النماذج واستخدامها لإنشاء مستندات",
        "group": "الشاشات", "secretary": True,
    },
    "screen_settings": {
        "name": "شاشة الإعدادات المحدودة",
        "desc": "للسكرتير: الطباعة والعرض وتغيير كلمة مروره فقط؛ باقي الإعدادات للمدير",
        "group": "الشاشات", "secretary": True,
    },
    "screen_claims": {
        "name": "شاشة المطالبات المالية",
        "desc": "مطالبتنا على العملاء ومطالبات المقاولين علينا",
        "group": "الشاشات", "secretary": True,
    },
    "screen_gateway": {
        "name": "شاشة بوابة الدفع",
        "desc": "مطابقة بوابات الدفع والتصفية اليومية — للمدير فقط افتراضيًا",
        "group": "الشاشات", "secretary": False,
    },
    # ---------- التقارير (تأشيرة مستقلة لكل تقرير) ----------
    "rep_customers": {
        "name": "تقرير العملاء والأرصدة",
        "desc": "أرصدة العملاء وعقودهم ومستحقاتهم",
        "group": "التقارير", "secretary": False,
    },
    "rep_supervision_delay": {
        "name": "تقرير تأخير الإشراف",
        "desc": "تعهد الإشراف والتمديد والتأخير",
        "group": "التقارير", "secretary": True,
    },
    "rep_subcontractors": {
        "name": "تقرير مقاولي الباطن",
        "desc": "عقود الباطن والمنصرف والمتبقي لكل مقاول",
        "group": "التقارير", "secretary": True,
    },
    "rep_dues_board": {
        "name": "لوحة مستحقات الباطن",
        "desc": "سطور صرف الباطن مع المراحل المحركة",
        "group": "التقارير", "secretary": True,
    },
    "rep_customer_profitability": {
        "name": "ربحية العميل",
        "desc": "ربحية كل عميل مع كل عقوده والقيم الفعلية والمتوقعة",
        "group": "التقارير", "secretary": False,
    },
    "rep_expenses": {
        "name": "تقرير المصروفات",
        "desc": "مصروفات حسب الحساب الأب والفرعي والعميل والمشروع",
        "group": "التقارير", "secretary": False,
    },
    "rep_vouchers": {
        "name": "تقرير حركة السندات",
        "desc": "كل السندات في الفترة والوارد والمنصرف وصافي الحركة",
        "group": "التقارير", "secretary": False,
    },
    "rep_journal": {
        "name": "دفتر اليومية",
        "desc": "القيود المحاسبية مدين/دائن بما فيها العكسية",
        "group": "التقارير", "secretary": False,
    },
    "rep_contracts": {
        "name": "تقرير العقود",
        "desc": "كل العقود بقيمها وملخص الأنواع والعقود القاربة",
        "group": "التقارير", "secretary": True,
    },
    "rep_cashflow": {
        "name": "التقرير المالي",
        "desc": "الكشف النقدي التفصيلي والصافي وأرصدة البنك والصندوق",
        "group": "التقارير", "secretary": False,
    },
    "rep_leads": {
        "name": "تقرير الفرص البيعية",
        "desc": "العملاء بلا عقود بعد",
        "group": "التقارير", "secretary": True,
    },
    "rep_execution": {
        "name": "تقرير مراحل التنفيذ",
        "desc": "العقود المتأخرة في مراحلها · القاربة على الانتهاء · "
                "والمراحل المفقودة",
        "group": "التقارير", "secretary": True,
    },
    # ---------- الإجراءات ----------
    "action_add_receipt": {
        "name": "إنشاء سندات القبض",
        "desc": "زر «سند قبض جديد» في الشاشة ومركز العقد والرئيسية",
        "group": "الإجراءات", "secretary": True,
    },
    "action_add_payment": {
        "name": "إنشاء سندات الصرف",
        "desc": "زر «سند صرف جديد» في الشاشة ومركز العقد والرئيسية",
        "group": "الإجراءات", "secretary": True,
    },
    "action_add_subcontractor": {
        "name": "إضافة مقاول باطن",
        "desc": "زر إضافة مقاول باطن من الرئيسية أو شاشة مقاولي الباطن",
        "group": "الإجراءات", "secretary": False,
    },
    "action_edit_voucher": {
        "name": "تعديل السندات",
        "desc": "«تعديل السند» من قائمة الزر الأيمن للسند — الحفظ يتطلب اعتماد المدير",
        "group": "الإجراءات", "secretary": True,
    },
    "action_edit_voucher_description": {
        "name": "تعديل بيان السند فقط",
        "desc": "مسار احتياطي إذا مُنع تعديل السند الكامل؛ والحفظ يتطلب اعتماد المدير",
        "group": "الإجراءات", "secretary": False,
    },
    "action_cancel_voucher": {
        "name": "إلغاء السندات",
        "desc": "«إلغاء السند» — دون طلب كلمة مرور المدير",
        "group": "الإجراءات", "secretary": False,
    },
    "action_print_statement": {
        "name": "طباعة كشف الحساب",
        "desc": "معاينة وطباعة كشف حساب العقد PDF",
        "group": "الإجراءات", "secretary": True,
    },
    "action_view_financial": {
        "name": "رؤية الربحية والتكلفة",
        "desc": "أرقام الربحية في مركز العقد وعرض «ربحية العقود» في تقرير العقود",
        "group": "الإجراءات", "secretary": False,
    },
    "action_whatsapp": {
        "name": "إرسال رسائل واتساب",
        "desc": "أزرار إرسال السندات والكشوف عبر واتساب",
        "group": "الإجراءات", "secretary": True,
    },
    "action_delete": {
        "name": "حذف العملاء والعقود",
        "desc": "الحذف من قائمة الزر الأيمن — دون طلب كلمة مرور المدير",
        "group": "الإجراءات", "secretary": False,
    },
    "action_supervision_waive": {
        "name": "إلغاء أشهر تمديد الإشراف",
        "desc": "شطب أشهر التمديد من عقد الإشراف",
        "group": "الإجراءات", "secretary": False,
    },
    "action_form_design": {
        "name": "تصميم النماذج",
        "desc": "إنشاء النماذج وتعديل تصميمها واعتمادها",
        "group": "الإجراءات", "secretary": False,
    },
    "action_change_status": {
        "name": "تغيير حالة العقد",
        "desc": "إيقاف/إعادة تفعيل/إغلاق/إلغاء العقد",
        "group": "الإجراءات", "secretary": False,
    },
}

# ذاكرة صلاحيات الجلسة الحالية (تُحمَّل بعد الدخول عند أول سؤال)
_current_perms: dict[str, bool] | None = None


def role_perm_defaults(role: str) -> dict[str, bool]:
    """افتراضيات الصلاحيات لدور معيّن (المدير والمطور: الكل دائمًا)."""
    if role in (ROLE_ADMIN, ROLE_DEVELOPER):
        return {k: True for k in PERMISSIONS}
    return {k: bool(spec.get("secretary", True))
            for k, spec in PERMISSIONS.items()}


def perm_catalog() -> dict[str, list[tuple[str, dict]]]:
    """الصلاحيات مرتبة بمجموعاتها (لنافذة التأشير)."""
    out: dict[str, list[tuple[str, dict]]] = {}
    for key, spec in PERMISSIONS.items():
        out.setdefault(spec["group"], []).append((key, spec))
    return out


def user_role(user_id: int) -> str:
    """دور مستخدم برقمه."""
    try:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT role FROM users WHERE id=?",
                (user_id,)).fetchone()
        return (row["role"] if row else "") or ROLE_ADMIN
    except sqlite3.Error:
        return ROLE_ADMIN


def user_is_customized(user_id: int) -> bool:
    """هل للموظف تخصيص صلاحيات محفوظ؟"""
    try:
        with get_connection() as conn:
            n = conn.execute(
                "SELECT COUNT(*) AS n FROM user_permissions "
                "WHERE user_id=?", (user_id,)).fetchone()["n"]
        return int(n) > 0
    except sqlite3.Error:
        return False


def get_user_perms(user_id: int, role: str = "") -> dict[str, bool]:
    """خريطة صلاحيات موظف: تخصيصه المحفوظ، وإلا افتراضيات دوره."""
    if not role:
        role = user_role(user_id)
    perms = role_perm_defaults(role)
    try:
        with get_connection() as conn:
            rows = conn.execute(
                "SELECT perm_key, allowed FROM user_permissions "
                "WHERE user_id=?", (user_id,)).fetchall()
        for r in rows:
            if r["perm_key"] in PERMISSIONS:
                perms[r["perm_key"]] = bool(r["allowed"])
    except sqlite3.Error:
        pass
    return perms


def set_user_perms(user_id: int, perms: dict[str, bool]) -> None:
    """حفظ تخصيص صلاحيات موظف كاملًا (دفعة واحدة في معاملة واحدة)."""
    data = [(user_id, key, 1 if perms.get(key) else 0)
            for key in PERMISSIONS]
    try:
        with get_connection() as conn:
            conn.execute("DELETE FROM user_permissions WHERE user_id=?",
                         (user_id,))
            conn.executemany(
                "INSERT INTO user_permissions (user_id, perm_key, allowed) "
                "VALUES (?,?,?)", data)
    except sqlite3.Error as exc:
        raise DatabaseError(f"تعذر حفظ الصلاحيات: {exc}") from exc


def reset_user_perms(user_id: int) -> None:
    """حذف تخصيص الموظف — يعود لافتراضيات دوره."""
    try:
        with get_connection() as conn:
            conn.execute("DELETE FROM user_permissions WHERE user_id=?",
                         (user_id,))
    except sqlite3.Error:
        pass


def load_current_perms() -> None:
    """تحميل صلاحيات المستخدم الحالي في الذاكرة (تُستدعى بعد الدخول
    أو عند أول سؤال عن صلاحية)."""
    global _current_perms
    _current_perms = None
    try:
        uid = current_user_id()
        if uid and _current["role"] == ROLE_SECRETARY:
            _current_perms = get_user_perms(uid, _current["role"])
    except Exception:
        _current_perms = None


def has_permission(key: str) -> bool:
    """هل يملك المستخدم الحالي صلاحية معينة؟

    المدير والمطور: دائمًا نعم · السكرتير: تخصيصه المحفوظ وإلا
    افتراضيات دوره. المفاتيح غير المعروفة لا تقيّد شيئًا (توافق
    مع أي استدعاء قديم).
    """
    if _current["role"] in (ROLE_ADMIN, ROLE_DEVELOPER):
        return True
    if key not in PERMISSIONS:
        return True
    if _current_perms is None:
        load_current_perms()
    if _current_perms is not None:
        return bool(_current_perms.get(
            key, PERMISSIONS[key].get("secretary", True)))
    return bool(PERMISSIONS[key].get("secretary", True))


def admin_override(password: str) -> bool:
    """موافقة مدير مؤقتة: التحقق من كلمة مرور أي مستخدم مدير."""
    try:
        with get_connection() as conn:
            rows = conn.execute(
                "SELECT username FROM users WHERE role=?",
                (ROLE_ADMIN,)).fetchall()
    except sqlite3.Error:
        return False
    return any(verify_login(r["username"], password) for r in rows)


# ============================================================
# إدارة المستخدمين (للمدير)
# ============================================================
def list_users() -> list[dict]:
    """مستخدمو النظام · حساب المطور مخفي عن الجميع إلا المطور نفسه."""
    hide_dev = not is_developer()
    query = ("SELECT id, username, role, created_at, "
             "COALESCE(full_name,'') AS full_name, "
             "COALESCE(job_title,'') AS job_title FROM users")
    params: tuple = ()
    if hide_dev:
        query += " WHERE role != ?"
        params = (ROLE_DEVELOPER,)
    query += " ORDER BY id"
    with get_connection() as conn:
        rows = conn.execute(query, params).fetchall()
    return [dict(r) for r in rows]


def add_user(username: str, password: str, role: str,
             full_name: str = "", job_title: str = "") -> int:
    username = (username or "").strip()
    if len(username) < 3:
        raise ValidationError("اسم المستخدم يجب أن يكون 3 أحرف على الأقل.")
    if len(password or "") < 4:
        raise ValidationError("كلمة المرور يجب أن تكون 4 أحرف على الأقل.")
    if role not in ASSIGNABLE_ROLES:
        raise ValidationError("الدور غير صحيح.")
    # حد عدد المستخدمين الذي ضبطه المطور (لا يشمل حساب المطور نفسه)
    limit = max_users()
    if limit and active_users_count() >= limit:
        raise ValidationError(
            f"وصلت للحد الأقصى لعدد المستخدمين ({limit}).\n"
            "للزيادة تواصل مع مطوّر النظام.")
    salt = os.urandom(16).hex()
    try:
        with get_connection() as conn:
            cur = conn.execute(
                "INSERT INTO users (username, password_hash, salt, role, "
                "full_name, job_title) VALUES (?, ?, ?, ?, ?, ?)",
                (username, _hash_password(password, salt), salt, role,
                 (full_name or "").strip(), (job_title or "").strip()))
            dup = conn.execute(
                "SELECT id FROM users WHERE username=? COLLATE NOCASE "
                "AND id<>?",
                (username, cur.lastrowid)).fetchone()
            if dup:
                raise ValidationError("اسم المستخدم مستخدم من قبل.")
            return cur.lastrowid
    except sqlite3.IntegrityError:
        raise ValidationError("اسم المستخدم مستخدم من قبل.")
    except sqlite3.Error as exc:
        raise DatabaseError(f"خطأ في قاعدة البيانات: {exc}") from exc


def reset_user_password(user_id: int, new_password: str) -> None:
    if len(new_password or "") < 4:
        raise ValidationError("كلمة المرور يجب أن تكون 4 أحرف على الأقل.")
    salt = os.urandom(16).hex()
    with get_connection() as conn:
        conn.execute(
            "UPDATE users SET password_hash=?, salt=? WHERE id=?",
            (_hash_password(new_password, salt), salt, user_id))


def delete_user(user_id: int) -> None:
    """حذف مستخدم · يُمنع حذف آخر مدير في النظام."""
    with get_connection() as conn:
        row = conn.execute("SELECT role FROM users WHERE id=?",
                           (user_id,)).fetchone()
        if not row:
            return
        if row["role"] == ROLE_DEVELOPER and not is_developer():
            raise ValidationError("حساب المطور محمي ولا يمكن حذفه.")
        if row["role"] == ROLE_ADMIN:
            admins = conn.execute(
                "SELECT COUNT(*) FROM users WHERE role=?",
                (ROLE_ADMIN,)).fetchone()[0]
            if admins <= 1:
                raise ValidationError(
                    "لا يمكن حذف آخر مدير في النظام.")
        conn.execute("DELETE FROM users WHERE id=?", (user_id,))


# ============================================================
# حد عدد المستخدمين (يضبطه المطور من أدوات المطور)
# ============================================================
def active_users_count() -> int:
    """عدد مستخدمي العميل (بلا حساب المطور)."""
    with get_connection() as conn:
        return int(conn.execute(
            "SELECT COUNT(*) FROM users WHERE role != ?",
            (ROLE_DEVELOPER,)).fetchone()[0])


def max_users() -> int:
    """الحد الأقصى المسموح (0 = بلا حد)."""
    try:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT max_users FROM settings WHERE id=1").fetchone()
        return int(row["max_users"] or 0) if row else 0
    except Exception:
        return 0


def set_max_users(value: int) -> None:
    """ضبط الحد الأقصى · للمطور فقط."""
    value = max(0, int(value or 0))
    with get_connection() as conn:
        conn.execute("UPDATE settings SET max_users=? WHERE id=1", (value,))


DEV_PASSWORD_FILE = "كلمة_مرور_المطور.txt"


def _new_dev_password() -> str:
    """كلمة مرور عشوائية لحساب المطور.

    **لا تُكتب أي كلمة مرور داخل الكود**: العميل يستلم ملفات البرنامج،
    فأي كلمة مكتوبة فيها تعني أن أدوات المطور مفتوحة له. تُقرأ من متغير
    البيئة CONTRACK_DEV_PASSWORD إن وُجد (للتركيب الآلي)، وإلا تُولَّد
    عشوائيًا وتُكتب مرة واحدة في data/كلمة_مرور_المطور.txt ليأخذها
    المطوّر ثم يحذف الملف.
    """
    import secrets
    env = (os.environ.get("CONTRACK_DEV_PASSWORD") or "").strip()
    return env or secrets.token_urlsafe(9)


def _save_dev_password(username: str, password: str) -> str:
    from database.database import DATA_DIR
    path = os.path.join(DATA_DIR, DEV_PASSWORD_FILE)
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(
                "بيانات حساب المطور — لا تُسلَّم للعميل\n"
                "==========================================\n"
                f"اسم المستخدم: {username}\n"
                f"كلمة المرور : {password}\n\n"
                "• سجّل الدخول وغيّرها فورًا من الإعدادات.\n"
                "• ثم احذف هذا الملف قبل تسليم النسخة.\n")
    except OSError:
        return ""
    return path


def ensure_developer_user(username: str = "developer",
                          password: str | None = None) -> bool:
    """إنشاء حساب المطور مرة واحدة إن لم يوجد. يرجع True إن أُنشئ الآن.

    كلمة المرور عشوائية وتُحفظ في ملف داخل data/ ليقرأها المطوّر مرة
    واحدة — لا قيمة ثابتة في الكود (قاعدة 52).
    """
    with get_connection() as conn:
        row = conn.execute("SELECT 1 FROM users WHERE role=?",
                           (ROLE_DEVELOPER,)).fetchone()
        if row:
            return False
        pwd = password or _new_dev_password()
        salt = os.urandom(16).hex()
        conn.execute(
            "INSERT OR IGNORE INTO users (username, password_hash, salt, role) "
            "VALUES (?, ?, ?, ?)",
            (username, _hash_password(pwd, salt), salt, ROLE_DEVELOPER))
    _save_dev_password(username, pwd)
    return True




def reset_developer_password(username: str = "developer",
                             password: str | None = None) -> dict:
    """إعادة ضبط حساب المطور بعد استعادة Backup قديم.

    لا تحتاج معرفة كلمة المرور القديمة. تُستخدم بعد الاستعادة أو من
    RESET_DEVELOPER_PASSWORD.bat حتى لا يظل النظام مربوطًا بكلمة مطور
    مجهولة داخل نسخة احتياطية قديمة.
    """
    username = (username or "developer").strip() or "developer"
    pwd = password or _new_dev_password()
    salt = os.urandom(16).hex()
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id FROM users WHERE role=? ORDER BY id LIMIT 1",
            (ROLE_DEVELOPER,)).fetchone()
        if row:
            conn.execute(
                "UPDATE users SET username=?, password_hash=?, salt=?, role=? "
                "WHERE id=?",
                (username, _hash_password(pwd, salt), salt,
                 ROLE_DEVELOPER, int(row["id"])))
        else:
            conn.execute(
                "INSERT OR IGNORE INTO users (username, password_hash, salt, role) "
                "VALUES (?, ?, ?, ?)",
                (username, _hash_password(pwd, salt), salt, ROLE_DEVELOPER))
    path = _save_dev_password(username, pwd)
    return {"username": username, "password": pwd, "file": path}


def dev_password_file_exists() -> bool:
    """هل ما زال ملف كلمة مرور المطور موجودًا؟ (يجب حذفه قبل التسليم)"""
    from database.database import DATA_DIR
    return os.path.exists(os.path.join(DATA_DIR, DEV_PASSWORD_FILE))


# ============================================================
# اسم الموظف المرتبط بالحساب
# ============================================================
def get_user(username: str) -> dict | None:
    # V2.48: تغليف بذاكرة البناء
    from services.qcache import memo
    return memo(("get_user", username),
                lambda: _get_user_impl(username))


def _get_user_impl(username: str) -> dict | None:
    """بيانات مستخدم بالاسم · أو None إن لم يوجد."""
    try:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT id, username, role, COALESCE(full_name,'') AS full_name,"
                " COALESCE(job_title,'') AS job_title, created_at "
                "FROM users WHERE username=? COLLATE NOCASE",
                (username,)).fetchone()
        return dict(row) if row else None
    except sqlite3.Error:
        return None


def set_user_identity(user_id: int, full_name: str = "",
                      job_title: str = "") -> None:
    """ربط الحساب بموظف: اسمه ومسماه الوظيفي."""
    with get_connection() as conn:
        conn.execute(
            "UPDATE users SET full_name=?, job_title=? WHERE id=?",
            ((full_name or "").strip(), (job_title or "").strip(), user_id))


def display_name(username: str = "") -> str:
    """الاسم الذي يُعرض في الواجهة: اسم الموظف إن وُجد وإلا اسم الدخول."""
    name = (username or current_username() or "").strip()
    if not name:
        return "مستخدم"
    user = get_user(name)
    if user and (user.get("full_name") or "").strip():
        return user["full_name"].strip()
    return name


def current_job_title() -> str:
    user = get_user(current_username())
    return (user or {}).get("job_title", "") or ""


def current_user_id() -> int:
    """رقم المستخدم الحالي (0 إن لم يُسجَّل دخول) — يحتاجه مديول المتابعة."""
    user = get_user(current_username())
    return int((user or {}).get("id") or 0)
