# -*- coding: utf-8 -*-
"""شجرة حسابات المصروفات القابلة للإدارة من الإعدادات."""
from __future__ import annotations

import time

from database.database import get_connection
from services.customer_service import ValidationError

DEFAULT_TREE = {
    "مصروفات تشغيلية": ["بنزين / وقود", "صيانة سيارات", "كهرباء وماء", "اتصالات وإنترنت"],
    "مصروفات إدارية": ["رواتب", "سلف موظفين / قرض راتب", "إيجارات", "قرطاسية"],
    "مصروفات مشاريع": ["عمالة موقع", "مواد بناء", "رسوم بلدية", "مخططات واعتمادات"],
    "مصروفات تسويق ومبيعات": ["إعلانات", "عمولات", "ضيافة عملاء"],
    "مصروفات حكومية ورسوم": ["رسوم حكومية", "طوابع ومعاملات"],
    "مصروفات بنكية": ["عمولات بنكية"],
}
CUSTODY_PARENT = "العُهد"
CUSTODY_DEFAULT = "عهدة عامة"

LEGACY_ACCOUNTS = [
    "مصروفات تشغيلية", "مصروفات إدارية", "مصروفات تسويق ومبيعات",
    "مصروفات صيانة", "مصروفات حكومية ورسوم", "مصروف / تكلفة المشروع",
    "بنزين / وقود", "سلف موظفين / قرض راتب",
]

_CACHE_TTL = 30.0
_accounts_cache: dict[tuple[bool, bool], tuple[float, list[dict]]] = {}
# طوابع لتفادي تكرار عمل ثقيل على القاعدة المشتركة عبر الشبكة
_paths_checked_at: float = 0.0
_defaults_done: bool = False
_defaults_ready = False


def clear_cache() -> None:
    """مسح الكاش — ويعيد أيضًا ضبط طوابع المسارات حتى يظهر أي تعديل فورًا."""
    global _paths_checked_at
    _accounts_cache.clear()
    _paths_checked_at = 0.0


def _norm_name(text: str) -> str:
    n = (text or "").strip().lower()
    for a, b in (("أ", "ا"), ("إ", "ا"), ("آ", "ا"), ("ة", "ه"), ("ى", "ي")):
        n = n.replace(a, b)
    return " ".join(n.split())


def _is_custody_like(text: str) -> bool:
    """يمسك العهد المكتوبة قديمًا كنص حر أو كمصروف مستورد."""
    n = _norm_name(text)
    return "عهد" in n


def ensure_defaults(force: bool = False) -> None:
    """إنشاء الحسابات الافتراضية وترحيل أسماء الحسابات القديمة غير المعروفة.

    تُنفَّذ مرة واحدة لكل تشغيل (ما لم تُطلب بالقوة) — كانت تُعاد في كل
    استدعاء لحساب واحد فتُكلّف عشرات الاستعلامات على الشبكة.
    """
    global _defaults_done
    if _defaults_done and not force:
        return
    with get_connection() as conn:
        cnt = conn.execute("SELECT COUNT(*) FROM expense_accounts").fetchone()[0]
        if cnt == 0:
            order = 0
            for parent, children in DEFAULT_TREE.items():
                order += 1
                pid = _insert(conn, parent, None, allow_posting=0, sort_order=order)
                for child in children:
                    order += 1
                    _insert(conn, child, pid, allow_posting=1, sort_order=order)
        # أي حسابات قديمة مستخدمة في السندات ولم تدخل الشجرة نضعها تحت مستوردة.
        import_parent = _find_by_path_conn(conn, "حسابات مستوردة / غير مصنفة")
        for name in LEGACY_ACCOUNTS:
            if not _find_by_name_conn(conn, name):
                if import_parent is None:
                    import_parent = _insert(conn, "حسابات مستوردة / غير مصنفة", None, allow_posting=0, sort_order=9000)
                _insert(conn, name, import_parent, allow_posting=1, sort_order=9001)
        custody_parent = _find_by_name_conn(conn, CUSTODY_PARENT)
        if custody_parent is None:
            custody_parent = _insert(conn, CUSTODY_PARENT, None, allow_posting=0,
                                     include_in_profitability=0,
                                     account_kind="advance", sort_order=8000)
        else:
            custody_parent = int(custody_parent["id"])
        if not conn.execute("SELECT 1 FROM expense_accounts WHERE parent_id=? AND name=?", (custody_parent, CUSTODY_DEFAULT)).fetchone():
            _insert(conn, CUSTODY_DEFAULT, custody_parent, allow_posting=1,
                    include_in_profitability=0, account_kind="advance",
                    sort_order=8001)
        # أي حساب قديم اسمه/مساره عهدة لا يجوز أن يظهر كمصروف؛
        # نعيد تصنيفه كعهدة حتى لو كان مستوردًا كنص حر سابقًا.
        for old in conn.execute("SELECT id,name,full_path FROM expense_accounts").fetchall():
            if int(old["id"]) != int(custody_parent) and _is_custody_like((old["full_path"] or old["name"] or "")):
                conn.execute("UPDATE expense_accounts SET account_kind='advance', include_in_profitability=0 WHERE id=?", (old["id"],))
        for r in conn.execute("SELECT DISTINCT account FROM vouchers WHERE vtype='payment' AND COALESCE(account,'')<>''").fetchall():
            name = (r["account"] or "").strip()
            if not name or _find_by_name_conn(conn, name):
                continue
            if _is_custody_like(name):
                _insert(conn, name, custody_parent, allow_posting=1,
                        include_in_profitability=0, account_kind="advance",
                        sort_order=8002)
                continue
            if import_parent is None:
                import_parent = _insert(conn, "حسابات مستوردة / غير مصنفة", None, allow_posting=0, sort_order=9000)
            _insert(conn, name, import_parent, allow_posting=1, sort_order=9002)
    _defaults_done = True


def _insert(conn, name: str, parent_id: int | None, allow_posting: int = 1,
            include_in_profitability: int = 1, account_kind: str = "expense",
            sort_order: int = 0) -> int:
    cur = conn.execute(
        "INSERT INTO expense_accounts (parent_id,name,is_active,allow_posting,include_in_profitability,account_kind,sort_order) "
        "VALUES (?,?,?,?,?,?,?)",
        (parent_id, name.strip(), 1, allow_posting, include_in_profitability, account_kind, sort_order))
    return int(cur.lastrowid)


def _find_by_name_conn(conn, name: str):
    return conn.execute("SELECT id FROM expense_accounts WHERE name=? LIMIT 1", (name.strip(),)).fetchone()


def _find_by_path_conn(conn, path: str):
    row = conn.execute("SELECT id FROM expense_accounts WHERE full_path=? LIMIT 1", (path.strip(),)).fetchone()
    return int(row["id"]) if row else None


def _full_path(conn, account_id: int) -> str:
    parts = []
    cur = conn.execute("SELECT id,parent_id,name FROM expense_accounts WHERE id=?", (account_id,)).fetchone()
    while cur:
        parts.append(cur["name"])
        pid = cur["parent_id"]
        cur = conn.execute("SELECT id,parent_id,name FROM expense_accounts WHERE id=?", (pid,)).fetchone() if pid else None
    return " / ".join(reversed(parts))


def refresh_paths(force: bool = False) -> None:
    """تحديث المسار الكامل لكل حساب — **لا يكتب إلا عند التغيّر فعلًا**.

    الأداء (مهم على القاعدة المشتركة عبر الشبكة):
      · كانت الدالة تعيد كتابة كل صفوف الجدول في كل استدعاء، وتقرأ
        كل سلسلة الآباء بصفّ مستقل لكل حساب — ما يعني عشرات
        الاستعلامات وعشرات عمليات الكتابة (fsync) لمجرد قراءة حساب
        واحد. على مجلد شبكة كل عملية كتابة = رحلة ذهاب وإياب.
      · الآن: قراءة واحدة للجدول كله، وحساب المسارات في الذاكرة،
        وكتابة الصفوف المختلفة فقط (غالبًا صفر) ضمن معاملة واحدة.
    """
    now = time.monotonic()
    global _paths_checked_at
    if not force and _paths_checked_at and (now - _paths_checked_at) <= _CACHE_TTL:
        return
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, parent_id, name, COALESCE(full_path,'') AS full_path "
            "FROM expense_accounts").fetchall()
        info = {int(r["id"]): (r["parent_id"], r["name"], r["full_path"])
                for r in rows}

        cache: dict[int, str] = {}

        def path_of(aid: int) -> str:
            if aid in cache:
                return cache[aid]
            parts, seen, cur = [], set(), aid
            while cur and cur in info and cur not in seen:
                seen.add(cur)
                parent, name, _old = info[cur]
                parts.append(name)
                cur = int(parent) if parent else None
            val = " / ".join(reversed(parts))
            cache[aid] = val
            return val

        changed = [(path_of(aid), aid) for aid, (_p, _n, old_path) in info.items()
                   if path_of(aid) != old_path]
        for val, aid in changed:
            conn.execute("UPDATE expense_accounts SET full_path=? WHERE id=?",
                         (val, aid))
    if changed:
        _accounts_cache.clear()
    _paths_checked_at = now


def list_accounts(active_only: bool = False, posting_only: bool = False) -> list[dict]:
    key = (bool(active_only), bool(posting_only))
    now = time.monotonic()
    cached = _accounts_cache.get(key)
    if cached and now - cached[0] <= _CACHE_TTL:
        return [dict(r) for r in cached[1]]
    ensure_defaults(); refresh_paths()
    sql = "SELECT * FROM expense_accounts WHERE 1=1"
    params = []
    if active_only:
        sql += " AND is_active=1"
    if posting_only:
        sql += " AND allow_posting=1"
    sql += " ORDER BY COALESCE(parent_id,id), sort_order, name"
    with get_connection() as conn:
        rows = [dict(r) for r in conn.execute(sql, params).fetchall()]
    _accounts_cache[key] = (now, [dict(r) for r in rows])
    return rows


def posting_items() -> list[tuple[str, int]]:
    """حسابات المصروف النهائية فقط؛ لا تشمل حسابات العهد حتى لو كانت قديمة/مستوردة.

    V5.9: يُعرض **اسم الحساب النهائي (الابن) فقط** بدل المسار الكامل
    «مصروفات تشغيلية / بنزين / وقود» — بناءً على طلب المستخدم.
    المسار الكامل يبقى محفوظًا في القاعدة وفي التقارير بلا أي تغيير.
    """
    return [(r["name"] or r["full_path"] or "", r["id"])
            for r in list_accounts(True, True)
            if (r.get("account_kind") or "expense") == "expense"
            and not _is_custody_like(r.get("full_path") or r.get("name") or "")]


def custody_items(active_only: bool = True) -> list[tuple[str, int]]:
    """حسابات العهد الثابتة لاستخدامها في إغلاق العهدة."""
    rows = list_accounts(active_only, True)
    return [(r["full_path"] or r["name"], r["id"])
            for r in rows if ((r.get("account_kind") or "") == "advance"
                              or _is_custody_like(r.get("full_path") or r.get("name") or ""))
            and r.get("parent_id")]


def get_account(account_id: int | None) -> dict | None:
    if not account_id:
        return None
    ensure_defaults(); refresh_paths()
    with get_connection() as conn:
        r = conn.execute("SELECT * FROM expense_accounts WHERE id=?", (account_id,)).fetchone()
        return dict(r) if r else None


def add_account(name: str, parent_id: int | None = None, allow_posting: bool = True,
                include_in_profitability: bool = True, account_kind: str = "expense") -> int:
    name = (name or "").strip()
    if not name:
        raise ValidationError("اسم الحساب مطلوب.")
    with get_connection() as conn:
        if parent_id:
            parent = conn.execute("SELECT parent_id FROM expense_accounts WHERE id=?", (parent_id,)).fetchone()
            if not parent:
                raise ValidationError("الحساب الأب غير موجود.")
            if parent["parent_id"]:
                raise ValidationError("الشجرة مستويان فقط: أب ثم ابن. لا يمكن إضافة ابن تحت ابن.")
        if conn.execute("SELECT 1 FROM expense_accounts WHERE COALESCE(parent_id,0)=COALESCE(?,0) AND name=?", (parent_id, name)).fetchone():
            raise ValidationError("يوجد حساب بنفس الاسم تحت نفس الأب.")
        aid = _insert(conn, name, parent_id, int(allow_posting), int(include_in_profitability), account_kind)
    clear_cache()
    refresh_paths(force=True)
    return aid


def update_account(account_id: int, name: str, parent_id: int | None,
                   is_active: bool, allow_posting: bool,
                   include_in_profitability: bool, account_kind: str = "expense") -> None:
    name = (name or "").strip()
    if not name:
        raise ValidationError("اسم الحساب مطلوب.")
    if parent_id == account_id:
        raise ValidationError("لا يمكن جعل الحساب أبًا لنفسه.")
    with get_connection() as conn:
        if parent_id:
            parent = conn.execute("SELECT parent_id FROM expense_accounts WHERE id=?", (parent_id,)).fetchone()
            if not parent:
                raise ValidationError("الحساب الأب غير موجود.")
            if parent["parent_id"]:
                raise ValidationError("الشجرة مستويان فقط: أب ثم ابن. لا يمكن نقل حساب تحت ابن.")
            if conn.execute("SELECT 1 FROM expense_accounts WHERE parent_id=?", (account_id,)).fetchone():
                raise ValidationError("الحساب الأب لا يمكن جعله ابنًا وفيه أبناء.")
        conn.execute("UPDATE expense_accounts SET name=?, parent_id=?, is_active=?, allow_posting=?, include_in_profitability=?, account_kind=?, updated_at=datetime('now','localtime') WHERE id=?",
                     (name, parent_id, int(is_active), int(allow_posting), int(include_in_profitability), account_kind, account_id))
    clear_cache()
    refresh_paths(force=True)


def toggle_active(account_id: int) -> None:
    with get_connection() as conn:
        conn.execute("UPDATE expense_accounts SET is_active=CASE WHEN is_active=1 THEN 0 ELSE 1 END WHERE id=?", (account_id,))
    clear_cache()


def account_snapshot(account_id: int | None, fallback: str = "") -> tuple[int | None, str, bool]:
    acc = get_account(account_id)
    if not acc:
        return None, fallback or "مصروف / تكلفة المشروع", True
    if (acc.get("account_kind") or "expense") != "expense" or _is_custody_like(acc.get("full_path") or acc.get("name") or ""):
        raise ValidationError("حساب العهدة لا يجوز استخدامه كحساب مصروف. اختر حساب مصروف فعلي.")
    return int(acc["id"]), acc.get("full_path") or acc["name"], bool(acc.get("include_in_profitability", 1))
