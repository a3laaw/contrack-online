# -*- coding: utf-8 -*-
"""مديول «متابعة»: دورة حياة المعاملات + شات + تنبيهات.

**قرار تصميمي مهم — «مرحلة المتابعة» ليست «حالة العقد»:**
للعقد أصلًا حالة إدارية (مسودة · معتمد · نشط · مغلق · ملغى) يحكمها
`lifecycle_service`. مراحل المتابعة طبقة **تشغيلية** فوقها تجيب عن سؤال
مختلف: «مين ماسك المعاملة دلوقتي وإيه الخطوة الجاية؟». لذلك سُمّيت
المراحل بأسماء عمل (تجهيز المستندات · بانتظار توقيع العميل …) ولا تكرر
أسماء الحالات الإدارية أبدًا — تفاديًا للالتباس عند العميل.

قاعدة الصلاحيات: **المشاركة = الرؤية**
    · المدير (والمطوّر) يرى كل شيء بلا استثناء.
    · غيره يرى المعاملة فقط إن كان مشاركًا فيها، ويُضاف تلقائيًا
      بمجرد تفاعله (فتح تبويب المتابعة · رسالة · نقل مرحلة).
"""
from datetime import date, timedelta

from database.database import DatabaseError, get_connection
from services import auth_service

# ============================================================
# أنواع المعاملات التي لها دورة حياة
# ============================================================
TX_CONTRACT = "contract"
TX_PAYMENT = "payment"
TX_SUBCONTRACT = "subcontract"
TX_CUSTOMER = "customer"       # عميل محتمل — ما قبل التعاقد

TX_TYPES: dict[str, str] = {
    TX_CONTRACT: "عقد",
    TX_PAYMENT: "سند صرف",
    TX_SUBCONTRACT: "عقد باطن",
    TX_CUSTOMER: "عميل (ما قبل التعاقد)",
}

# المراحل الافتراضية — تُزرع مرة واحدة وتبقى **قابلة للتعديل والحذف**
# من شاشة الإعدادات. أسماؤها من واقع شغل المقاولات في الكويت.
DEFAULT_STAGES: dict[str, list[tuple[str, str]]] = {
    TX_PAYMENT: [
        ("مطلوب", "neutral"),
        ("بانتظار اعتماد المدير", "warn"),
        ("معتمد للصرف", "info"),
        ("تم الصرف", "done"),
    ],
    TX_SUBCONTRACT: [
        ("جديد", "neutral"),
        ("بانتظار عرض السعر", "warn"),
        ("تم التعاقد", "info"),
        ("جارٍ التنفيذ", "purple"),
        ("مكتمل", "done"),
    ],
}

# مراحل تنفيذ العقود — شجرية: رئيسية تضم فرعية، ولكل فرعية مدة
# متوقعة بالأيام (عداد المتابعة). المسار الخطي للتنفيذ = الفرعيات
# بالترتيب؛ الرئيسيات مجموعات بصرية للـ Stepper.
DEFAULT_EXEC_TREE: list[tuple[str, str, list[tuple[str, int]]]] = [
    ("أعمال ما قبل التنفيذ", "warn", [
        ("فحص التربة", 7),
        ("التصميم المعماري", 20),
        ("استخراج رخصة البناء", 30),
    ]),
    ("أعمال التنفيذ", "info", [
        ("أعمال الأساسات", 30),
        ("الهيكل والأعمدة", 45),
        ("المباني والتشطيبات", 60),
    ]),
    ("التسليم", "done", [
        ("التسليم الابتدائي", 7),
        ("التسليم النهائي", 14),
    ]),
]

# مراحل متابعة العميل المحتمل (قبل التعاقد) — «غير متعاقد» مرحلة
# افتراضية مقفولة لا تُحذف (تُزارع لكل عميل جديد تلقائيًا)
DEFAULT_CUSTOMER_STAGES: list[tuple[str, int, int]] = [
    # (الاسم، الأيام المتوقعة، is_pre_contract)
    ("غير متعاقد", 30, 1),
]

# للتوافق مع أدوات الفحص والدليل: مسار عقد التنفيذ مسطحًا
# طرق الدفعة على المرحلة (إعداد مالي لكل مرحلة في شجرتها)
PAY_KINDS = {
    "": "بدون دفعة",
    "achieve": "عند إنجاز المرحلة",
    "advance": "دفعة مقدمة عند التوقيع",
    "final": "دفعة ختامية",
    "days": "بعد أيام من التوقيع",
}

DEFAULT_STAGES[TX_CONTRACT] = [
    (sub, main_color) for main, main_color, subs in DEFAULT_EXEC_TREE
    for sub, _days in subs]


def stage_color(key: str) -> str:
    """لون المرحلة بدون أي اعتماد على مكتبات الواجهة داخل الخدمات.

    لا تستورد هذه الدالة أي وحدة عرض؛ نحتفظ بقيم ألوان بسيطة هنا كبيانات فقط
    حتى تبقى الخدمات قابلة للاختبار بلا فتح نوافذ.
    """
    colors = {
        "info": "#2563EB", "warn": "#D97706", "danger": "#DC2626",
        "ok": "#16A34A", "done": "#16A34A", "neutral": "#64748B",
        "gray": "#64748B", "blue": "#2563EB",
        "green": "#16A34A", "amber": "#D97706", "red": "#DC2626",
        "purple": "#7C3AED",
    }
    return colors.get(key, colors["info"])


NOTIF_STAGE = "stage_change"
NOTIF_MESSAGE = "new_message"


def type_label(transaction_type: str) -> str:
    return TX_TYPES.get(transaction_type, transaction_type)


# ============================================================
# زرع المراحل الافتراضية
# ============================================================
def _seed_flat_stages(conn, tx: str) -> int:
    """زرع المراحل المسطحة الافتراضية لنوع (سند صرف / عقد باطن)."""
    added = 0
    for order, (name, color) in enumerate(DEFAULT_STAGES.get(tx, []), 1):
        cur = conn.execute(
            "INSERT OR IGNORE INTO workflow_stages "
            "(transaction_type, stage_name, stage_order, color) "
            "VALUES (?, ?, ?, ?)",
            (tx, name, order, stage_color(color)))
        added += cur.rowcount or 0
    return added


def _seed_type_defaults(conn, contract_type: str) -> int:
    """زرع شجرة المراحل الافتراضية **لنوع عقد** — الرئيسيات والفرعيات
    بمدد متوقعة. عقد الإشراف يأخذ شجرة مختصرة: بداية الإشراف/إنهاء الإشراف."""
    try:
        from services import contract_type_service as _cts
        if _cts.type_config(contract_type).get("is_supervision"):
            main = conn.execute(
                "INSERT OR IGNORE INTO workflow_stages "
                "(transaction_type, stage_name, stage_order, color, parent_id, "
                "expected_days, contract_type, payment_pct) "
                "VALUES (?, ?, 1, ?, NULL, 0, ?, 0)",
                (TX_CONTRACT, "الإشراف", stage_color("info"), contract_type))
            mid = main.lastrowid
            added = main.rowcount or 0
            end_stage_id = None
            for order, name in enumerate(("بداية الإشراف", "إنهاء الإشراف"), 2):
                cur = conn.execute(
                    "INSERT OR IGNORE INTO workflow_stages "
                    "(transaction_type, stage_name, stage_order, color, parent_id, "
                    "expected_days, contract_type, payment_pct) "
                    "VALUES (?, ?, ?, ?, ?, 0, ?, 0)",
                    (TX_CONTRACT, name, order, stage_color("info"), mid,
                     contract_type))
                added += cur.rowcount or 0
                if name == "إنهاء الإشراف":
                    end_stage_id = cur.lastrowid
            if end_stage_id:
                pay = conn.execute(
                    "INSERT OR IGNORE INTO type_payment_tpl "
                    "(contract_type, pay_no, title, pct, amount_fixed, stage_id, "
                    "trigger_stage_id, days_offset) VALUES (?,?,?,?,?,?,?,0)",
                    (contract_type, 1, "كامل قيمة العقد", 100.0, 0.0,
                     end_stage_id, end_stage_id))
                pid = pay.lastrowid
                if pid:
                    conn.execute(
                        "INSERT OR IGNORE INTO type_payment_stages "
                        "(payment_id, stage_id) VALUES (?,?)",
                        (pid, end_stage_id))
            return added
    except Exception:
        pass
    added = 0
    order = 1
    for main, main_color, subs in DEFAULT_EXEC_TREE:
        cur = conn.execute(
            "INSERT OR IGNORE INTO workflow_stages "
            "(transaction_type, stage_name, stage_order, color, "
            "parent_id, expected_days, contract_type, payment_pct) "
            "VALUES (?, ?, ?, ?, NULL, 0, ?, 0)",
            (TX_CONTRACT, main, order, stage_color(main_color),
             contract_type))
        added += cur.rowcount or 0
        order += 1
        main_id = cur.lastrowid
        for sub, days in subs:
            cur = conn.execute(
                "INSERT OR IGNORE INTO workflow_stages "
                "(transaction_type, stage_name, stage_order, color, "
                "parent_id, expected_days, contract_type, payment_pct) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
                (TX_CONTRACT, sub, order, stage_color(main_color),
                 main_id, days, contract_type))
            added += cur.rowcount or 0
            order += 1
    return added


def _seed_customer_stages(conn) -> int:
    """زرع مرحلة «غير متعاقد» المقفولة للعملاء المحتملين."""
    added = 0
    for name, days, pre in DEFAULT_CUSTOMER_STAGES:
        cur = conn.execute(
            "INSERT OR IGNORE INTO workflow_stages "
            "(transaction_type, stage_name, stage_order, color, "
            "parent_id, expected_days, is_pre_contract) "
            "VALUES (?, ?, 1, ?, NULL, ?, ?)",
            (TX_CUSTOMER, name, stage_color("warn"), days, pre))
        added += cur.rowcount or 0
    return added


def _seed_type_stages(conn, tx: str) -> int:
    """زرع المراحل الافتراضية المناسبة لنوع معاملة."""
    if tx == TX_CONTRACT:
        # قالب «غير محدد» للعقود بلا نوع — الأنواع الأخرى تُزرع
        # قوالبها تلقائيًا لحظة إنشائها من شاشة أنواع العقود
        from services.contract_type_service import UNSPECIFIED
        return _seed_type_defaults(conn, UNSPECIFIED)
    if tx == TX_CUSTOMER:
        return _seed_customer_stages(conn)
    return _seed_flat_stages(conn, tx)


def ensure_default_stages() -> int:
    """زرع المراحل الافتراضية **مرة واحدة في عمر القاعدة** — لا تعود
    أبدًا بعدها مهما حذف المستخدم (علم دائم في جدول الإعدادات).

    كان الباج: الزرع يعود إذا وجد الجدول فارغًا — فتحذف شجرتك
    المخصصة وتعود الافتراضية بعد إعادة التشغيل.
    """
    added = 0
    with get_connection() as conn:
        try:
            flag = conn.execute(
                "SELECT stages_seeded FROM settings WHERE id=1"
            ).fetchone()
            done = bool(flag and int(flag[0] or 0))
        except Exception:
            done = False
        if done:
            return 0
        for tx in TX_TYPES:
            added += _seed_type_stages(conn, tx)
        conn.execute(
            "UPDATE settings SET stages_seeded=1 WHERE id=1")
    return added


def restore_default_for_type(contract_type: str) -> int:
    """استعادة شجرة المراحل الافتراضية لنوع عقد (فقط إن كان بلا
    مراحل) — وتُزرع تلقائيًا كذلك لحظة إنشاء أي نوع جديد."""
    contract_type = (contract_type or "").strip()
    if not contract_type:
        raise DatabaseError("اختر نوع العقد أولًا.")
    with get_connection() as conn:
        has_own = conn.execute(
            "SELECT 1 FROM workflow_stages WHERE transaction_type=? "
            "AND COALESCE(contract_type,'')=? LIMIT 1",
            (TX_CONTRACT, contract_type)).fetchone()
    if has_own:
        raise DatabaseError(
            f"نوع «{contract_type}» له مراحل بالفعل — عدّلها مباشرة "
            "أو احذفها كلها ثم استعد الافتراضية.")
    with get_connection() as conn:
        return _seed_type_defaults(conn, contract_type)


# توافق الاستدعاءات القديمة باسم الدالة السابق
copy_stages_to_type = restore_default_for_type


def copy_contract_type_template(source_type: str, target_type: str) -> dict:
    """نسخ شجرة مراحل + قالب دفعات من نوع عقد إلى نوع عقد آخر.

    لا يحذف شيئًا: يجب أن يكون النوع الهدف بلا مراحل وبلا دفعات حتى لا تختلط
    الأشجار أو تتكرر الروابط. يستخدم عند إنشاء نوع جديد مثل «تصميم» ثم ربطه
    بقالب مخصص مستقل عن «إشراف» أو غيره.
    """
    source = _stage_scope(source_type)
    target = _stage_scope(target_type)
    if not source or not target:
        raise DatabaseError("اختر نوع المصدر ونوع الهدف.")
    if source == target:
        raise DatabaseError("نوع المصدر ونوع الهدف نفسهما.")
    with get_connection() as conn:
        src = conn.execute(
            "SELECT * FROM workflow_stages WHERE transaction_type=? "
            "AND COALESCE(contract_type,'')=? ORDER BY stage_order, id",
            (TX_CONTRACT, source)).fetchall()
        if not src:
            raise DatabaseError(f"نوع «{source}» لا يحتوي شجرة مراحل لنسخها.")
        has_target = conn.execute(
            "SELECT 1 FROM workflow_stages WHERE transaction_type=? "
            "AND COALESCE(contract_type,'')=? LIMIT 1",
            (TX_CONTRACT, target)).fetchone()
        if has_target:
            raise DatabaseError(
                f"نوع «{target}» لديه شجرة مراحل بالفعل. حفاظًا على البيانات "
                "لا يتم الاستبدال تلقائيًا — احذف قالبه الفارغ أولًا إن أردت النسخ.")
        has_pay = conn.execute(
            "SELECT 1 FROM type_payment_tpl WHERE contract_type=? LIMIT 1",
            (target,)).fetchone()
        if has_pay:
            raise DatabaseError(
                f"نوع «{target}» لديه قالب دفعات بالفعل. لا يمكن الخلط بين قالبين.")

        id_map: dict[int, int] = {}
        copied_stages = 0
        for r in src:
            parent = id_map.get(int(r["parent_id"])) if r["parent_id"] else None
            cur = conn.execute(
                "INSERT INTO workflow_stages (transaction_type, stage_name, "
                "stage_order, color, parent_id, expected_days, is_pre_contract, "
                "contract_type, payment_pct, pay_kind, "
                "is_supervision, sup_monthly) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (TX_CONTRACT, r["stage_name"], int(r["stage_order"] or 0),
                 r["color"], parent, int(r["expected_days"] or 0),
                 int(r["is_pre_contract"] or 0), target,
                 float(r["payment_pct"] or 0), r["pay_kind"] or "",
                 int(r["is_supervision"] or 0),
                 float(r["sup_monthly"] or 0)))
            id_map[int(r["id"])] = int(cur.lastrowid)
            copied_stages += 1

        pays = conn.execute(
            "SELECT * FROM type_payment_tpl WHERE contract_type=? "
            "ORDER BY pay_no, id", (source,)).fetchall()
        copied_pays = 0
        for p in pays:
            old_stage = int(p["stage_id"]) if p["stage_id"] else None
            old_trig = int(p["trigger_stage_id"]) if p["trigger_stage_id"] else None
            new_stage = id_map.get(old_stage) if old_stage else None
            new_trig = id_map.get(old_trig) if old_trig else None
            cur = conn.execute(
                "INSERT INTO type_payment_tpl (contract_type, pay_no, title, "
                "pct, amount_fixed, stage_id, trigger_stage_id, days_offset) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (target, int(p["pay_no"] or 1), p["title"] or "",
                 float(p["pct"] or 0), float(p["amount_fixed"] or 0),
                 new_stage, new_trig, int(p["days_offset"] or 0)))
            new_pid = int(cur.lastrowid)
            links = conn.execute(
                "SELECT stage_id FROM type_payment_stages WHERE payment_id=?",
                (p["id"],)).fetchall()
            for link in links:
                nsid = id_map.get(int(link["stage_id"]))
                if nsid:
                    conn.execute(
                        "INSERT OR IGNORE INTO type_payment_stages "
                        "(payment_id, stage_id) VALUES (?,?)",
                        (new_pid, nsid))
            copied_pays += 1
    return {"stages": copied_stages, "payments": copied_pays,
            "source": source, "target": target}


def ensure_type_stage_template(contract_type: str) -> int:
    """اضمن أن نوع العقد له شجرة مستقلة؛ تُزرع الافتراضية إن كان فارغًا."""
    scope = _stage_scope(contract_type)
    if not scope:
        return 0
    with get_connection() as conn:
        exists = conn.execute(
            "SELECT 1 FROM workflow_stages WHERE transaction_type=? "
            "AND COALESCE(contract_type,'')=? LIMIT 1",
            (TX_CONTRACT, scope)).fetchone()
        if exists:
            return 0
        return _seed_type_defaults(conn, scope)


def ensure_all_contract_type_templates() -> int:
    """زرع شجرة مستقلة لأي نوع عقد نشط لا يملك قالب مراحل."""
    try:
        from services import contract_type_service as _cts
        names = [t["name"] for t in _cts.list_types(active_only=True)]
    except Exception:
        names = []
    total = 0
    for name in names:
        total += ensure_type_stage_template(name)
    return total



def list_contract_stage_trees(active_only: bool = True) -> list[dict]:
    """قائمة واضحة بكل أشجار مراحل العقود وربط كل شجرة بنوع العقد.

    في المخطط الحالي اسم الشجرة = اسم نوع العقد؛ أي أن الربط مباشر وصريح:
    عقد نوعه «تصميم» يأخذ شجرة «تصميم» فقط.
    """
    from services import contract_type_service as _cts
    types = _cts.list_types(active_only=active_only)
    out = []
    with get_connection() as conn:
        for t in types:
            name = t["name"]
            r = conn.execute(
                "SELECT COUNT(*) AS stages, "
                "COALESCE(SUM(CASE WHEN parent_id IS NOT NULL THEN 1 ELSE 0 END),0) AS subs, "
                "COALESCE(SUM(CASE WHEN COALESCE(pay_kind,'')<>'' THEN 1 ELSE 0 END),0) AS pays "
                "FROM workflow_stages WHERE transaction_type=? "
                "AND COALESCE(contract_type,'')=?",
                (TX_CONTRACT, _stage_scope(name))).fetchone()
            out.append({
                "tree_name": name,
                "contract_type": name,
                "stage_count": int(r["stages"] or 0),
                "sub_count": int(r["subs"] or 0),
                "payment_count": int(r["pays"] or 0),
                "contracts_count": int(t.get("contracts_count") or 0),
                "active": bool(t.get("active", 1)),
            })
    return out


def clear_contract_type_template(contract_type: str) -> int:
    """إفراغ شجرة مراحل نوع عقد فقط (لا يلمس العقود القديمة ولا حساباتها)."""
    scope = _stage_scope(contract_type)
    if not scope:
        raise DatabaseError("اختر نوع العقد أولًا.")
    with get_connection() as conn:
        ids = [int(r[0]) for r in conn.execute(
            "SELECT id FROM workflow_stages WHERE transaction_type=? "
            "AND COALESCE(contract_type,'')=?",
            (TX_CONTRACT, scope)).fetchall()]
        if not ids:
            return 0
        q = ",".join("?" for _ in ids)
        conn.execute(f"DELETE FROM type_payment_stages WHERE stage_id IN ({q})", ids)
        pay_ids = [int(r[0]) for r in conn.execute(
            "SELECT id FROM type_payment_tpl WHERE contract_type=?",
            (scope,)).fetchall()]
        if pay_ids:
            qp = ",".join("?" for _ in pay_ids)
            conn.execute(f"DELETE FROM type_payment_stages WHERE payment_id IN ({qp})", pay_ids)
        conn.execute("DELETE FROM type_payment_tpl WHERE contract_type=?", (scope,))
        # حذف الفروع ثم الرئيسيات احترامًا للـ FK الذاتي
        conn.execute(
            "DELETE FROM workflow_stages WHERE transaction_type=? "
            "AND COALESCE(contract_type,'')=? AND parent_id IS NOT NULL",
            (TX_CONTRACT, scope))
        conn.execute(
            "DELETE FROM workflow_stages WHERE transaction_type=? "
            "AND COALESCE(contract_type,'')=?",
            (TX_CONTRACT, scope))
    return len(ids)


def create_empty_contract_tree(contract_type: str, replace: bool = False) -> int:
    """إنشاء/ربط شجرة فارغة بنوع عقد؛ بعدها يضيف المستخدم مراحلها يدويًا."""
    scope = _stage_scope(contract_type)
    if not scope:
        raise DatabaseError("اختر نوع العقد أولًا.")
    if get_stages(TX_CONTRACT, scope):
        if not replace:
            raise DatabaseError(
                f"الشجرة «{scope}» موجودة بالفعل. اخترها من قائمة الأشجار "
                "أو وافق على استبدالها.")
        clear_contract_type_template(scope)
    return 0


def replace_contract_type_template(contract_type: str, mode: str = "empty",
                                   source_type: str = "") -> dict:
    """زر «شجرة جديدة»: يربط نوع العقد بشجرة فارغة/افتراضية/منسوخة."""
    target = _stage_scope(contract_type)
    if not target:
        raise DatabaseError("اختر نوع العقد الذي سترتبط به الشجرة.")
    mode = (mode or "empty").strip()
    removed = clear_contract_type_template(target)
    added = payments = 0
    if mode == "empty":
        pass
    elif mode == "default":
        added = restore_default_for_type(target)
    elif mode == "copy":
        res = copy_contract_type_template(source_type, target)
        added = int(res.get("stages") or 0)
        payments = int(res.get("payments") or 0)
    else:
        raise DatabaseError("نوع إنشاء الشجرة غير معروف.")
    return {"target": target, "removed": removed, "stages": added,
            "payments": payments, "mode": mode}




# ============================================================
# استيراد/تصدير شجرة مراحل العقود من Excel
# ============================================================
_STAGE_TREE_SHEET = "شجرة المراحل"
_STAGE_TREE_HEADERS = [
    "نوع العقد *", "المرحلة الرئيسية *", "المرحلة الفرعية",
    "الأيام المتوقعة", "اللون",
]
#: V3.23: عمودان اختياريان في قالب الشجرة — غيابهما لا يكسر الملفات القديمة.
_STAGE_TREE_HEADERS_XTRA = ["إشرافية؟", "قيمة الشهر"]
_STAGE_PAYMENT_SHEET = "الدفعات"
_STAGE_PAYMENT_HEADERS = [
    "نوع العقد *", "رقم الدفعة *", "اسم الدفعة", "طريقة القيمة",
    "النسبة %", "المبلغ اليدوي", "المراحل المرتبطة",
    "المرحلة المحفزة", "بعد (يوم)",
]
_STAGE_TREE_COLORS = {
    "": "info",
    "ازرق": "info", "أزرق": "info", "blue": "info", "info": "info",
    "رمادي": "neutral", "gray": "neutral", "grey": "neutral", "neutral": "neutral",
    "انتظار": "warn", "تحذير": "warn", "كهرماني": "warn", "warn": "warn", "amber": "warn",
    "اخضر": "done", "أخضر": "done", "done": "done", "green": "done",
    "احمر": "danger", "أحمر": "danger", "danger": "danger", "red": "danger",
    "بنفسجي": "purple", "purple": "purple",
}


def _stage_cell(v) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v == int(v):
        return str(int(v)).strip()
    return str(v).strip()


def _stage_days(v) -> int:
    txt = _stage_cell(v)
    if not txt:
        return 0
    try:
        n = int(float(txt.replace(",", "")))
    except Exception:
        raise DatabaseError(f"الأيام المتوقعة يجب أن تكون رقمًا صحيحًا: {txt}")
    if n < 0:
        raise DatabaseError("الأيام المتوقعة لا تكون سالبة.")
    return n


def _stage_yesno(v) -> int:
    """نعم/1/yes/✓ ← 1 · وغيرها ← 0."""
    t = _stage_cell(v).strip().casefold()
    return 1 if t in {"نعم", "ن", "1", "yes", "y", "true", "✓", "✔"} else 0


def _stage_money(v) -> float:
    txt = _stage_cell(v)
    if not txt:
        return 0.0
    try:
        n = float(txt.replace(",", ""))
    except Exception:
        raise DatabaseError(f"قيمة الشهر يجب أن تكون رقمًا: {txt}")
    if n < 0:
        raise DatabaseError("قيمة الشهر لا تكون سالبة.")
    return n


def _stage_color_key(v) -> str:
    txt = _stage_cell(v).replace("إ", "ا").replace("أ", "ا").replace("آ", "ا").strip()
    return _STAGE_TREE_COLORS.get(txt, "info")


def generate_stage_tree_template(out_path: str) -> str:
    """توليد نموذج Excel لرفع شجرة مراحل العقود.

    النموذج لا يحتوي أي نسب دفعات؛ فقط نوع العقد + رئيسية + فرعية + أيام.
    """
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    ws = wb.active
    ws.title = "اقرأني أولاً"
    ws.sheet_view.rightToLeft = True
    ws.column_dimensions["A"].width = 105
    notes = [
        "نموذج رفع شجرة مراحل العقود وربطها بالدفعات",
        "املأ ورقة «شجرة المراحل» وورقة «الدفعات» اختياريًا، ولا تغيّر أسماء الأعمدة.",
        "نوع العقد يجب أن يكون موجودًا مسبقًا في شاشة أنواع العقود.",
        "في شجرة المراحل: اكتب اسم المرحلة الرئيسية في كل صف، ولو لها مراحل فرعية اكتب الفرعية في عمود «المرحلة الفرعية».",
        "في ورقة الدفعات: المبالغ يدوية داخل القالب وليست ملزمة بأي مبلغ محفوظ في الإعدادات.",
        "طريقة القيمة في الدفعات: اكتب «نسبة» أو «مبلغ يدوي» أو «مرنة». لو اخترت مبلغًا يدويًا اكتب قيمته في عمود المبلغ اليدوي.",
        "المراحل المرتبطة: اكتب أسماء مراحل التنفيذ مفصولة بعلامة +. لو تركتها فارغة تصبح الدفعة يدوية/بالأيام.",
        "المرحلة المحفزة معناها: عند إنهائها فعليًا داخل العقد تصبح الدفعة مستحقة بتاريخ الإنهاء. إذا ربطت دفعة بأكثر من مرحلة اختر واحدة كمحفزة.",
        "عند الرفع سيتم استبدال شجرة ودفعات أنواع العقود الموجودة في الملف بعد تأكيدك، ولا تتأثر العقود القديمة التي سبق إنشاؤها لأنها تملك Snapshot مستقل.",
        "إشرافية؟: اكتب «نعم» للمرحلة ذات الطابع الإشرافي فترثها العقود الجديدة (قيمة الشهر: القيمة الافتراضية) — العمودان اختياريان.",
    ]
    for i, text in enumerate(notes, 1):
        c = ws.cell(i, 1, text)
        c.alignment = Alignment(horizontal="right", vertical="center", wrap_text=True)
        c.font = Font(bold=(i == 1), size=15 if i == 1 else 12, color="1E3A5F" if i == 1 else "243447")
        ws.row_dimensions[i].height = 28 if i == 1 else 24

    def _make_sheet(title: str, with_examples: bool = False):
        ws2 = wb.create_sheet(title)
        ws2.sheet_view.rightToLeft = True
        widths = [22, 32, 34, 16, 16, 14, 16]
        header_fill = PatternFill("solid", fgColor="1E3A5F")
        header_font = Font(bold=True, color="FFFFFF", size=12)
        example_font = Font(italic=True, color="64748B")
        thin = Side(style="thin", color="D9E2EC")
        border = Border(left=thin, right=thin, top=thin, bottom=thin)
        center = Alignment(horizontal="center", vertical="center", wrap_text=True)
        _all_heads = _STAGE_TREE_HEADERS + _STAGE_TREE_HEADERS_XTRA
        for col, head in enumerate(_all_heads, 1):
            cell = ws2.cell(1, col, head)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = center
            cell.border = border
            ws2.column_dimensions[get_column_letter(col)].width = widths[col-1]
        rows_to_style = 207
        if with_examples:
            examples = [
                ["تصميم", "أعمال ما قبل التنفيذ", "رفع مساحي", 3, "أزرق"],
                ["تصميم", "أعمال ما قبل التنفيذ", "مخطط معماري", 7, "أزرق"],
                ["تصميم", "الاعتمادات", "اعتماد العميل", 2, "انتظار"],
                ["إشراف", "الزيارات", "زيارة موقع", 1, "بنفسجي"],
                ["إشراف", "التسليم", "تقرير نهائي", 2, "أخضر"],
            ]
            for r, row in enumerate(examples, 2):
                for c, val in enumerate(row, 1):
                    cell = ws2.cell(r, c, val)
                    cell.font = example_font
                    cell.alignment = center
                    cell.border = border
        for r in range(2, rows_to_style):
            for c in range(1, len(_all_heads) + 1):
                ws2.cell(r, c).alignment = center
                ws2.cell(r, c).border = border
        ws2.freeze_panes = "A2"
        return ws2

    _make_sheet(_STAGE_TREE_SHEET, with_examples=False)

    # ورقة الدفعات المرتبطة بالمراحل — اختيارية عند الرفع.
    pay = wb.create_sheet(_STAGE_PAYMENT_SHEET)
    pay.sheet_view.rightToLeft = True
    widths = [22, 14, 26, 16, 12, 16, 42, 26, 12]
    header_fill = PatternFill("solid", fgColor="1E3A5F")
    header_font = Font(bold=True, color="FFFFFF", size=12)
    thin = Side(style="thin", color="D9E2EC")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    for col, head in enumerate(_STAGE_PAYMENT_HEADERS, 1):
        cell = pay.cell(1, col, head)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = center
        cell.border = border
        pay.column_dimensions[get_column_letter(col)].width = widths[col-1]
    for r in range(2, 207):
        for c in range(1, len(_STAGE_PAYMENT_HEADERS) + 1):
            pay.cell(r, c).alignment = center
            pay.cell(r, c).border = border
    pay.freeze_panes = "A2"

    _make_sheet("مثال", with_examples=True)
    ex = wb["مثال"]
    start = 9
    for col, head in enumerate(_STAGE_PAYMENT_HEADERS, 1):
        cell = ex.cell(start, col, head)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = center
        cell.border = border
        ex.column_dimensions[get_column_letter(col)].width = max(ex.column_dimensions[get_column_letter(col)].width or 0, widths[col-1])
    examples_pay = [
        ["تصميم", 1, "دفعة التوقيع", "مبلغ يدوي", "", 250.000, "", "", 0],
        ["تصميم", 2, "دفعة المخطط", "نسبة", 40, "", "رفع مساحي + مخطط معماري", "مخطط معماري", 10],
        ["تصميم", 3, "دفعة الاعتماد", "نسبة", 60, "", "اعتماد العميل", "اعتماد العميل", 12],
    ]
    for r, row in enumerate(examples_pay, start + 1):
        for c, val in enumerate(row, 1):
            cell = ex.cell(r, c, val)
            cell.alignment = center
            cell.border = border
    wb.save(out_path)
    return out_path

def _split_stage_names(txt: str) -> list[str]:
    raw = (txt or "").replace("،", "+").replace("|", "+").replace(";", "+")
    return [p.strip() for p in raw.split("+") if p.strip()]


def _value_method(txt: str) -> str:
    t = (txt or "").strip().replace("إ", "ا").replace("أ", "ا").replace("آ", "ا").lower()
    if not t:
        return "fixed"
    if "نسب" in t or t in {"pct", "percent", "%"}:
        return "pct"
    if "مرن" in t or "لاحق" in t or t in {"flex", "flexible"}:
        return "flex"
    return "fixed"


def _read_stage_payment_rows(wb, known_types: set[str], valid_steps: dict[str, set[str]]) -> list[dict]:
    """قراءة ورقة الدفعات الاختيارية من قالب الرفع."""
    if _STAGE_PAYMENT_SHEET not in wb.sheetnames:
        return []
    ws = wb[_STAGE_PAYMENT_SHEET]
    headers = [_stage_cell(ws.cell(1, c).value) for c in range(1, len(_STAGE_PAYMENT_HEADERS) + 1)]
    if headers != _STAGE_PAYMENT_HEADERS:
        raise DatabaseError("أعمدة ورقة الدفعات غير صحيحة. حمّل النموذج من النظام ولا تغيّر العناوين.")
    rows: list[dict] = []
    errors: list[str] = []
    used: set[tuple[str, int]] = set()
    for r in range(2, ws.max_row + 1):
        vals = [_stage_cell(ws.cell(r, c).value) for c in range(1, len(_STAGE_PAYMENT_HEADERS) + 1)]
        if not any(vals):
            continue
        ctype = vals[0]
        if r <= 5 and ctype in {"تصميم", "إشراف"} and ctype not in known_types:
            continue
        if not ctype:
            errors.append(f"صف دفعات {r}: نوع العقد مطلوب.")
            continue
        if ctype not in known_types:
            errors.append(f"صف دفعات {r}: نوع العقد «{ctype}» غير موجود في أنواع العقود.")
            continue
        try:
            pay_no = int(float(vals[1].replace(",", "")))
        except Exception:
            errors.append(f"صف دفعات {r}: رقم الدفعة مطلوب ورقم صحيح.")
            continue
        if (ctype, pay_no) in used:
            errors.append(f"صف دفعات {r}: رقم الدفعة {pay_no} مكرر لنوع «{ctype}».")
            continue
        used.add((ctype, pay_no))
        method = _value_method(vals[3])
        try:
            pct = float(vals[4].replace(",", "")) if vals[4] else 0.0
            fixed = float(vals[5].replace(",", "")) if vals[5] else 0.0
            days = int(float(vals[8].replace(",", ""))) if vals[8] else 0
        except Exception:
            errors.append(f"صف دفعات {r}: النسبة/المبلغ/الأيام يجب أن تكون أرقامًا.")
            continue
        if method == "pct":
            fixed = 0.0
            if pct <= 0 or pct > 100:
                errors.append(f"صف دفعات {r}: النسبة يجب أن تكون أكبر من صفر وحتى 100.")
                continue
        elif method == "fixed":
            pct = 0.0
            if fixed < 0:
                errors.append(f"صف دفعات {r}: المبلغ اليدوي لا يكون سالبًا.")
                continue
        else:
            pct = 0.0
            fixed = 0.0
        stage_names = _split_stage_names(vals[6])
        trigger_name = vals[7]
        valid = valid_steps.get(ctype, set())
        missing = [n for n in stage_names if n not in valid]
        if missing:
            errors.append(f"صف دفعات {r}: مراحل غير موجودة في شجرة نفس النوع: {', '.join(missing)}")
            continue
        if trigger_name and trigger_name not in stage_names:
            errors.append(f"صف دفعات {r}: المرحلة المحفزة يجب أن تكون ضمن المراحل المرتبطة.")
            continue
        if len(stage_names) > 1 and not trigger_name:
            errors.append(f"صف دفعات {r}: الدفعة المرتبطة بأكثر من مرحلة تحتاج مرحلة محفزة.")
            continue
        rows.append({"contract_type": ctype, "pay_no": pay_no,
                     "title": vals[2] or _payment_title(pay_no),
                     "pct": pct, "amount_fixed": fixed,
                     "stage_names": stage_names,
                     "trigger_name": trigger_name, "days_offset": days,
                     "row": r})
    if errors:
        raise DatabaseError("أخطاء في ورقة الدفعات:\n" + "\n".join(errors[:30]))
    return rows


def read_stage_tree_file(path: str) -> dict:
    """فحص ملف شجرة المراحل قبل الرفع وإرجاع ملخصه."""
    from openpyxl import load_workbook
    from services import contract_type_service as _cts

    wb = load_workbook(path, data_only=True)
    if _STAGE_TREE_SHEET not in wb.sheetnames:
        raise DatabaseError(f"الملف لا يحتوي ورقة «{_STAGE_TREE_SHEET}».")
    ws = wb[_STAGE_TREE_SHEET]
    headers = [_stage_cell(ws.cell(1, c).value) for c in range(1, len(_STAGE_TREE_HEADERS) + 1)]
    if headers != _STAGE_TREE_HEADERS:
        raise DatabaseError("أعمدة نموذج شجرة المراحل غير صحيحة. حمّل النموذج من النظام ولا تغيّر العناوين.")
    # V3.23: العمودان الإشرافيان اختياريان — الملفات القديمة (5 أعمدة) مقبولة.
    _sup_col = 6 if _stage_cell(ws.cell(1, 6).value) == "إشرافية؟" else 0
    _supm_col = 7 if _stage_cell(ws.cell(1, 7).value) == "قيمة الشهر" else 0
    known_types = {t["name"] for t in _cts.list_types(active_only=True)}
    rows: list[dict] = []
    errors: list[str] = []
    for r in range(2, ws.max_row + 1):
        ctype = _stage_cell(ws.cell(r, 1).value)
        main = _stage_cell(ws.cell(r, 2).value)
        sub = _stage_cell(ws.cell(r, 3).value)
        if not any([ctype, main, sub, _stage_cell(ws.cell(r, 4).value), _stage_cell(ws.cell(r, 5).value),
                       _stage_cell(ws.cell(r, 6).value) if _sup_col else "",
                       _stage_cell(ws.cell(r, 7).value) if _supm_col else ""]):
            continue
        if r <= 6 and ctype in {"تصميم", "إشراف"} and ctype not in known_types:
            # أمثلة النموذج تُتجاهل تلقائيًا إذا لم تكن هذه الأنواع موجودة.
            continue
        if not ctype:
            errors.append(f"صف {r}: نوع العقد مطلوب.")
            continue
        if ctype not in known_types:
            errors.append(f"صف {r}: نوع العقد «{ctype}» غير موجود في أنواع العقود.")
            continue
        if not main:
            errors.append(f"صف {r}: المرحلة الرئيسية مطلوبة.")
            continue
        try:
            days = _stage_days(ws.cell(r, 4).value)
        except DatabaseError as exc:
            errors.append(f"صف {r}: {exc}")
            continue
        try:
            sup_m = _stage_money(ws.cell(r, _supm_col).value) if _supm_col else 0.0
        except DatabaseError as exc:
            errors.append(f"صف {r}: {exc}")
            continue
        rows.append({
            "contract_type": ctype,
            "main": main,
            "sub": sub,
            "days": days,
            "color": stage_color(_stage_color_key(ws.cell(r, 5).value)),
            "sup": _stage_yesno(ws.cell(r, _sup_col).value) if _sup_col else 0,
            "sup_monthly": sup_m,
            "row": r,
        })
    if errors:
        raise DatabaseError("أخطاء في ملف شجرة المراحل:\n" + "\n".join(errors[:30]))
    if not rows:
        raise DatabaseError("لا توجد مراحل صالحة في الملف.")
    types = sorted({r["contract_type"] for r in rows})
    mains = len({(r["contract_type"], r["main"]) for r in rows})
    subs = sum(1 for r in rows if r["sub"])
    direct = sum(1 for r in rows if not r["sub"])
    valid_steps: dict[str, set[str]] = {}
    for rr in rows:
        valid_steps.setdefault(rr["contract_type"], set()).add(rr["sub"] or rr["main"])
    payment_rows = _read_stage_payment_rows(wb, known_types, valid_steps)
    return {"rows": rows, "payment_rows": payment_rows,
            "types": types, "main_count": mains,
            "sub_count": subs, "direct_count": direct,
            "payment_count": len(payment_rows),
            "row_count": len(rows)}


def import_stage_tree_file(path: str, replace: bool = True) -> dict:
    """رفع شجرة المراحل من Excel.

    replace=True يستبدل شجرة كل نوع عقد موجود في الملف. العقود القديمة لا تتأثر.
    """
    data = read_stage_tree_file(path)
    rows = data["rows"]
    payment_rows = data.get("payment_rows") or []
    by_type: dict[str, list[dict]] = {}
    for r in rows:
        by_type.setdefault(r["contract_type"], []).append(r)
    payments_by_type: dict[str, list[dict]] = {}
    for r in payment_rows:
        payments_by_type.setdefault(r["contract_type"], []).append(r)
    added = 0
    removed = 0
    payments_added = 0
    with get_connection() as conn:
        for ctype in by_type:
            if replace:
                # نفس منطق clear_contract_type_template لكن داخل نفس المعاملة.
                scope = _stage_scope(ctype)
                ids = [int(x[0]) for x in conn.execute(
                    "SELECT id FROM workflow_stages WHERE transaction_type=? AND COALESCE(contract_type,'')=?",
                    (TX_CONTRACT, scope)).fetchall()]
                removed += len(ids)
                if ids:
                    q = ",".join("?" for _ in ids)
                    conn.execute(f"DELETE FROM type_payment_stages WHERE stage_id IN ({q})", ids)
                    pay_ids = [int(x[0]) for x in conn.execute(
                        "SELECT id FROM type_payment_tpl WHERE contract_type=?", (scope,)).fetchall()]
                    if pay_ids:
                        qp = ",".join("?" for _ in pay_ids)
                        conn.execute(f"DELETE FROM type_payment_stages WHERE payment_id IN ({qp})", pay_ids)
                    conn.execute("DELETE FROM type_payment_tpl WHERE contract_type=?", (scope,))
                    conn.execute(
                        "DELETE FROM workflow_stages WHERE transaction_type=? AND COALESCE(contract_type,'')=? AND parent_id IS NOT NULL",
                        (TX_CONTRACT, scope))
                    conn.execute(
                        "DELETE FROM workflow_stages WHERE transaction_type=? AND COALESCE(contract_type,'')=?",
                        (TX_CONTRACT, scope))
            order = 1
            main_ids: dict[str, int] = {}
            step_ids: dict[str, int] = {}
            for r in by_type[ctype]:
                main = r["main"]
                if main not in main_ids:
                    # الرئيسية تأخذ الطابع من صفها المباشر فقط (بلا فرعية)
                    m_sup = r.get("sup", 0) if not r["sub"] else 0
                    m_sup_m = r.get("sup_monthly", 0.0) if not r["sub"] else 0.0
                    cur = conn.execute(
                        "INSERT INTO workflow_stages (transaction_type, stage_name, stage_order, color, parent_id, expected_days, contract_type, payment_pct, pay_kind, is_supervision, sup_monthly) "
                        "VALUES (?, ?, ?, ?, NULL, 0, ?, 0, '', ?, ?)",
                        (TX_CONTRACT, main, order, r["color"], ctype, m_sup, m_sup_m))
                    main_ids[main] = int(cur.lastrowid)
                    added += 1
                    order += 1
                elif not r["sub"]:
                    # صف مباشر لاحق لنفس الرئيسية: حدّث طابعها
                    conn.execute(
                        "UPDATE workflow_stages SET is_supervision=?, sup_monthly=? WHERE id=?",
                        (r.get("sup", 0), r.get("sup_monthly", 0.0), main_ids[main]))
                if r["sub"]:
                    cur2 = conn.execute(
                        "INSERT INTO workflow_stages (transaction_type, stage_name, stage_order, color, parent_id, expected_days, contract_type, payment_pct, pay_kind, is_supervision, sup_monthly) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, 0, '', ?, ?)",
                        (TX_CONTRACT, r["sub"], order, r["color"], main_ids[main], r["days"], ctype,
                         r.get("sup", 0), r.get("sup_monthly", 0.0)))
                    step_ids[r["sub"]] = int(cur2.lastrowid)
                    added += 1
                    order += 1
                else:
                    conn.execute(
                        "UPDATE workflow_stages SET expected_days=? WHERE id=?",
                        (r["days"], main_ids[main]))
                    step_ids[main] = main_ids[main]
            # إنشاء قالب الدفعات الاختياري بعد إنشاء مراحل النوع حتى يتم الربط بالمعرّفات الجديدة.
            for pay in payments_by_type.get(ctype, []):
                stage_ids = [step_ids[n] for n in pay.get("stage_names", []) if n in step_ids]
                trigger_id = step_ids.get(pay.get("trigger_name") or "")
                _validate_payment_stages(ctype, stage_ids, trigger_id)
                primary = stage_ids[0] if stage_ids else None
                curp = conn.execute(
                    "INSERT INTO type_payment_tpl (contract_type, pay_no, title, pct, amount_fixed, stage_id, trigger_stage_id, days_offset) "
                    "VALUES (?,?,?,?,?,?,?,?)",
                    (ctype, int(pay["pay_no"]), pay.get("title") or _payment_title(pay["pay_no"]),
                     float(pay.get("pct") or 0), float(pay.get("amount_fixed") or 0),
                     primary, trigger_id, int(pay.get("days_offset") or 0)))
                _set_payment_stages(conn, int(curp.lastrowid), stage_ids, ctype)
                payments_added += 1
    out = dict(data)
    out.pop("rows", None)
    out.update({"added": added, "removed": removed, "payments_added": payments_added, "replace": replace})
    return out


def restore_default_stages(transaction_type: str) -> int:
    """استعادة المراحل الافتراضية لنوع — فقط إن لم يكن له مراحل."""
    if transaction_type not in TX_TYPES:
        raise DatabaseError("نوع معاملة غير معروف.")
    if get_stages(transaction_type):
        return 0
    with get_connection() as conn:
        return _seed_type_stages(conn, transaction_type)


# ============================================================
# المراحل: قراءة وتعديل (شاشة الإعدادات · مدير فقط)
# ============================================================
def _stage_scope(contract_type: str) -> str:
    """نطاق قالب مراحل العقد: اسم النوع — والعقد بلا نوع يتبع قالب
    «غير محدد» (لا يوجد قالب عام بعد الآن)."""
    ctype = (contract_type or "").strip()
    if ctype:
        return ctype
    from services.contract_type_service import UNSPECIFIED
    return UNSPECIFIED


def get_stages(transaction_type: str,
               contract_type: str = "") -> list[dict]:
    """مراحل النوع — **كل مرحلة مربوطة بنوع عقد** (لا قالب عام).

    للعقود: قالب النوع المحدد؛ والعقد بلا نوع يتبع قالب «غير محدد».
    """
    if transaction_type == TX_CONTRACT:
        with get_connection() as conn:
            rows = conn.execute(
                "SELECT id, transaction_type, stage_name, stage_order, "
                "color, parent_id, expected_days, is_pre_contract, "
                "contract_type, payment_pct, pay_kind, "
                "COALESCE(is_supervision,0) AS is_supervision, "
                "COALESCE(sup_monthly,0) AS sup_monthly, "
                "COALESCE(component_key,'') AS component_key "
                "FROM workflow_stages WHERE transaction_type=? "
                "AND COALESCE(contract_type,'')=? "
                "ORDER BY stage_order, id",
                (transaction_type, _stage_scope(contract_type))).fetchall()
        return [dict(r) for r in rows]
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, transaction_type, stage_name, stage_order, color, "
            "parent_id, expected_days, is_pre_contract, "
            "contract_type, payment_pct, pay_kind, "
            "COALESCE(is_supervision,0) AS is_supervision, "
            "COALESCE(sup_monthly,0) AS sup_monthly, "
            "COALESCE(component_key,'') AS component_key "
            "FROM workflow_stages WHERE transaction_type=? "
            "AND COALESCE(contract_type,'')='' "
            "ORDER BY stage_order, id", (transaction_type,)).fetchall()
    return [dict(r) for r in rows]


def resolve_scope(transaction_type: str, transaction_id: int) -> str:
    """نطاق مراحل معاملة: نوع العقد (للعقود) أو '' لغيرها.

    العقد بلا نوع يتبع قالب «غير محدد»."""
    if transaction_type != TX_CONTRACT or not transaction_id:
        return ""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT contract_type FROM contracts WHERE id=?",
            (transaction_id,)).fetchone()
    return _stage_scope((row["contract_type"] or "") if row else "")


def is_step(stage: dict) -> bool:
    """هل المرحلة خطوة تنفيذ فعلية في المسار؟

    الرئيسية ذات أبناء مجرد عنوان مجموعة — الخطوات هي الفرعيات
    (وكل رئيسية بلا أبناء تُعامل كخطوة).
    """
    if not stage.get("parent_id"):
        subs = [s for s in get_stages(stage["transaction_type"],
                                      stage.get("contract_type") or "")
                if s.get("parent_id") == stage["id"]]
        return not subs
    return True


def stage_path(transaction_type: str, contract_type: str = "") -> list[dict]:
    """المسار الخطي للتنفيذ: الفرعيات (+ الرئيسيات بلا أبناء)
    بترتيبها — هذا ما يمشي عليه العقد زر «إنهاء المرحلة»."""
    stages = get_stages(transaction_type, contract_type)
    parents = {s["parent_id"] for s in stages if s.get("parent_id")}
    return [s for s in stages
            if s.get("parent_id") or s["id"] not in parents]


def stage_tree(transaction_type: str, contract_type: str = "") -> list[dict]:
    """الشجرة للعرض: [{مرحلة رئيسية، children: [فرعيات]}] بترتيبها."""
    stages = get_stages(transaction_type, contract_type)
    mains = [s for s in stages if not s.get("parent_id")]
    out = []
    for m in mains:
        node = dict(m)
        node["children"] = [s for s in stages
                            if s.get("parent_id") == m["id"]]
        out.append(node)
    return out


def first_stage_id(transaction_type: str, contract_type: str = "") -> int:
    path = stage_path(transaction_type, contract_type)
    return path[0]["id"] if path else 0


def add_stage(transaction_type: str, stage_name: str,
              color: str = "", parent_id: int | None = None,
              expected_days: int = 0, contract_type: str = "",
              payment_pct: float = 0.0, pay_kind: str = "",
              is_supervision: bool = False,
              sup_monthly: float = 0.0,
              component_key: str = "") -> int:
    name = (stage_name or "").strip()
    if not name:
        raise DatabaseError("اسم المرحلة مطلوب.")
    if transaction_type not in TX_TYPES:
        raise DatabaseError("نوع معاملة غير معروف.")
    if expected_days < 0:
        raise DatabaseError("الأيام المتوقعة لا تكون سالبة.")
    if payment_pct < 0 or payment_pct > 100:
        raise DatabaseError("نسبة الدفعة بين 0 و100 فقط.")
    if pay_kind not in PAY_KINDS:
        raise DatabaseError("طريقة دفعة غير معروفة.")
    if pay_kind and not (0 < float(payment_pct or 0) <= 100):
        raise DatabaseError("المرحلة ذات دفعة تتطلب نسبة أكبر من صفر.")
    if sup_monthly and float(sup_monthly) < 0:
        raise DatabaseError("قيمة شهر الإشراف لا تكون سالبة.")
    contract_type = (contract_type or "").strip()
    # المراحل ترتبط بأنواع العقود فقط — لا قالب عام
    if transaction_type == TX_CONTRACT and not contract_type:
        raise DatabaseError(
            "مراحل تنفيذ العقد تُربط بنوع عقد — اختر النوع من قائمة "
            "«قالب المراحل» أولاً.")
    with get_connection() as conn:
        exists = conn.execute(
            "SELECT 1 FROM workflow_stages WHERE transaction_type=? "
            "AND stage_name=? AND COALESCE(contract_type,'')=?",
            (transaction_type, name, contract_type)).fetchone()
        if exists:
            raise DatabaseError(f"المرحلة «{name}» موجودة بالفعل لهذا النوع.")
        # المرحلة الفرعية تُضاف تحت رئيسية من نفس النوع وبلا أب
        if parent_id:
            parent = conn.execute(
                "SELECT id, parent_id FROM workflow_stages WHERE id=? "
                "AND transaction_type=?",
                (parent_id, transaction_type)).fetchone()
            if parent is None or parent["parent_id"]:
                raise DatabaseError(
                    "المرحلة الفرعية تُضاف تحت مرحلة رئيسية من نفس "
                    "النوع.")
        if transaction_type == TX_CONTRACT:
            nxt = conn.execute(
                "SELECT COALESCE(MAX(stage_order),0)+1 FROM workflow_stages "
                "WHERE transaction_type=? AND COALESCE(contract_type,'')=?",
                (transaction_type, contract_type)).fetchone()[0]
        else:
            nxt = conn.execute(
                "SELECT COALESCE(MAX(stage_order),0)+1 FROM workflow_stages "
                "WHERE transaction_type=?", (transaction_type,)).fetchone()[0]
        cur = conn.execute(
            "INSERT INTO workflow_stages "
            "(transaction_type, stage_name, stage_order, color, "
            "parent_id, expected_days, contract_type, payment_pct, "
            "pay_kind, is_supervision, sup_monthly, component_key) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (transaction_type, name, nxt,
             color or stage_color("info"), parent_id, expected_days,
             contract_type, payment_pct, pay_kind,
             1 if is_supervision else 0, float(sup_monthly or 0),
             (component_key or "").strip()))
        return int(cur.lastrowid)


def update_stage(stage_id: int, stage_name: str | None = None,
                 color: str | None = None,
                 stage_order: int | None = None,
                 expected_days: int | None = None,
                 payment_pct: float | None = None,
                 pay_kind: str | None = None,
                 is_supervision: bool | None = None,
                 sup_monthly: float | None = None,
                 component_key: str | None = None) -> None:
    """تعديل مرحلة · `None` = لا تغيّر هذا الحقل (قاعدة 15)."""
    sets, params = [], []
    if stage_name is not None:
        name = stage_name.strip()
        if not name:
            raise DatabaseError("اسم المرحلة مطلوب.")
        sets.append("stage_name=?")
        params.append(name)
    if color is not None:
        sets.append("color=?")
        params.append(color)
    if stage_order is not None:
        sets.append("stage_order=?")
        params.append(int(stage_order))
    if expected_days is not None:
        if int(expected_days) < 0:
            raise DatabaseError("الأيام المتوقعة لا تكون سالبة.")
        sets.append("expected_days=?")
        params.append(int(expected_days))
    if payment_pct is not None:
        if float(payment_pct) < 0 or float(payment_pct) > 100:
            raise DatabaseError("نسبة الدفعة بين 0 و100 فقط.")
        sets.append("payment_pct=?")
        params.append(float(payment_pct))
    if pay_kind is not None:
        if pay_kind not in PAY_KINDS:
            raise DatabaseError("طريقة دفعة غير معروفة.")
        sets.append("pay_kind=?")
        params.append(pay_kind)
    if is_supervision is not None:
        sets.append("is_supervision=?")
        params.append(1 if is_supervision else 0)
    if sup_monthly is not None:
        if float(sup_monthly) < 0:
            raise DatabaseError("قيمة شهر الإشراف لا تكون سالبة.")
        sets.append("sup_monthly=?")
        params.append(float(sup_monthly))
    if component_key is not None:
        sets.append("component_key=?")
        params.append((component_key or "").strip())
    if not sets:
        return
    params.append(stage_id)
    with get_connection() as conn:
        conn.execute(
            f"UPDATE workflow_stages SET {', '.join(sets)} WHERE id=?",
            params)


def stage_usage(stage_id: int) -> int:
    """عدد المعاملات التي مرّت بهذه المرحلة."""
    with get_connection() as conn:
        return int(conn.execute(
            "SELECT COUNT(*) FROM transaction_stage_log WHERE stage_id=?",
            (stage_id,)).fetchone()[0])


def stage_usage_map() -> dict:
    """عدد الاستخدامات لكل المراحل دفعة واحدة {stage_id: count}.

    بديل مجمّع لـ ``stage_usage`` عند عرض جدول المراحل كاملًا —
    استعلام واحد بدل استعلام واتصال لكل صف (يظهر أثره على القاعدة
    المشتركة حيث كل اتصال رحلة شبكة).
    """
    with get_connection() as conn:
        return {int(r["stage_id"]): int(r["n"]) for r in conn.execute(
            "SELECT stage_id, COUNT(*) AS n FROM transaction_stage_log "
            "WHERE stage_id IS NOT NULL GROUP BY stage_id").fetchall()}


def _get_stage(stage_id: int) -> dict | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM workflow_stages WHERE id=?",
            (stage_id,)).fetchone()
    return dict(row) if row else None


def delete_stage(stage_id: int) -> None:
    """حذف مرحلة · يُمنع إن كانت مستعملة فعلًا (حفاظًا على السجل)
    أو مرحلة نظام مقفولة (ما قبل التعاقد) أو رئيسية لها فروع."""
    stage = _get_stage(stage_id)
    if stage and int(stage.get("is_pre_contract") or 0):
        raise DatabaseError(
            "مرحلة «غير متعاقد» افتراضية للنظام ولا تُحذف — عدّل اسمها "
            "أو مدتها كما يناسبك.")
    dev = False
    try:
        dev = auth_service.is_developer()
    except Exception:
        dev = False
    if stage:
        with get_connection() as conn:
            kids = conn.execute(
                "SELECT COUNT(*) FROM workflow_stages WHERE parent_id=?",
                (stage_id,)).fetchone()[0]
        if kids and not dev:
            raise DatabaseError(
                "هذه مرحلة رئيسية لها مراحل فرعية — احذف فروعها أولًا.")
    used = stage_usage(stage_id)
    if used and not dev:
        raise DatabaseError(
            f"لا يمكن حذف هذه المرحلة لأن {used} معاملة مرّت بها.\n"
            "غيّر اسمها أو رتّبها بدل حذفها.")
    with get_connection() as conn:
        conn.execute(
            "UPDATE payment_plan SET stage_id=NULL WHERE stage_id=?",
            (stage_id,))
        conn.execute("DELETE FROM workflow_stages WHERE id=?", (stage_id,))


def reorder_stages(transaction_type: str, ordered_ids: list[int]) -> None:
    """إعادة ترتيب المراحل بترتيب المعرفات المُمرَّر."""
    with get_connection() as conn:
        for order, sid in enumerate(ordered_ids, 1):
            conn.execute(
                "UPDATE workflow_stages SET stage_order=? "
                "WHERE id=? AND transaction_type=?",
                (order, sid, transaction_type))


# ============================================================
# الصلاحيات: المشاركة = الرؤية
# ============================================================
def _uid(user_id: int | None = None) -> int | None:
    """رقم المستخدم الحالي — أو None (بلا مستخدم: سجل بلا منفّذ)."""
    if user_id:
        return int(user_id)
    try:
        return auth_service.current_user_id() or None
    except Exception:
        return None


def can_user_view(user_id: int, transaction_type: str,
                  transaction_id: int) -> bool:
    """المدير يرى كل شيء · ومن يملك شاشة المعاملة يرى مسارها الفني للمتابعة."""
    try:
        if auth_service.is_admin() or auth_service.is_developer():
            return True
        if transaction_type == TX_CONTRACT and auth_service.has_permission("screen_contracts"):
            return True
        if transaction_type == TX_CUSTOMER and auth_service.has_permission("screen_customers"):
            return True
        if transaction_type == TX_SUBCONTRACT and auth_service.has_permission("screen_subcontractors"):
            return True
    except Exception:
        pass
    if not user_id:
        return False
    with get_connection() as conn:
        row = conn.execute(
            "SELECT 1 FROM transaction_visibility WHERE transaction_type=? "
            "AND transaction_id=? AND user_id=?",
            (transaction_type, transaction_id, user_id)).fetchone()
    return bool(row)


def auto_add_participant(user_id: int, transaction_type: str,
                         transaction_id: int) -> None:
    """أي تفاعل يجعل المستخدم مشاركًا — يُستدعى تلقائيًا."""
    if not user_id:
        return
    with get_connection() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO transaction_visibility "
            "(transaction_type, transaction_id, user_id) VALUES (?, ?, ?)",
            (transaction_type, transaction_id, user_id))


def participants(transaction_type: str, transaction_id: int) -> list[int]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT user_id FROM transaction_visibility "
            "WHERE transaction_type=? AND transaction_id=?",
            (transaction_type, transaction_id)).fetchall()
    return [int(r[0]) for r in rows if r[0]]


def _notify_targets(transaction_type: str, transaction_id: int,
                    exclude: int = 0) -> list[int]:
    """من يُشعَر: كل المشاركين + كل المديرين (لأنهم يرون كل شيء)."""
    ids = set(participants(transaction_type, transaction_id))
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id FROM users WHERE role IN ('admin','developer')"
        ).fetchall()
    ids.update(int(r[0]) for r in rows)
    ids.discard(int(exclude or 0))
    return sorted(ids)


def _push(user_ids: list[int], transaction_type: str, transaction_id: int,
          kind: str, text: str) -> None:
    if not user_ids:
        return
    with get_connection() as conn:
        conn.executemany(
            "INSERT INTO notifications (user_id, transaction_type, "
            "transaction_id, type, text) VALUES (?, ?, ?, ?, ?)",
            [(u, transaction_type, transaction_id, kind, text)
             for u in user_ids])


# ============================================================
# المراحل: الحالة والانتقال
# ============================================================


def _norm_stage_name(name: str) -> str:
    n = (name or "").strip().lower()
    for a, b in (("أ", "ا"), ("إ", "ا"), ("آ", "ا"), ("ة", "ه"), ("ى", "ي")):
        n = n.replace(a, b)
    return " ".join(n.split())


def _stage_has_any(text: str, words: tuple[str, ...]) -> bool:
    return any(w in text for w in words)


def _is_supervision_end_stage_name(name: str) -> bool:
    n = _norm_stage_name(name)
    return (_stage_has_any(n, ("انهاء", "انتهاء", "نهايه", "نهاية", "اغلاق", "اقفال", "ختم"))
            and _stage_has_any(n, ("اشراف", "تعهد الاشراف", "تعهد")))


def _contract_can_pledge(contract_id: int) -> bool:
    """V3.29: شرط التعهد العقدي نفسه — مدة وقيمة إشراف أكبر من صفر."""
    try:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT sup_months, sup_monthly FROM contracts WHERE id=?",
                (contract_id,)).fetchone()
        if not row:
            return False
        return (int(row["sup_months"] or 0) > 0
                and float(row["sup_monthly"] or 0) > 0)
    except Exception:
        return False


def _ensure_contract_stage_not_frozen(contract_id: int) -> None:
    """العقد الملغى يتجمد في المراحل: لا إنهاء، لا تخطي، لا نقل."""
    with get_connection() as conn:
        row = conn.execute("SELECT status FROM contracts WHERE id=?",
                           (contract_id,)).fetchone()
    if row and (row["status"] or "") == "ملغى":
        raise DatabaseError(
            "العقد ملغى ومجمّد: لا يمكن تغيير مراحل التنفيذ أو تحفيز دفعات جديدة.")

def _ensure_subcontract_stage_not_frozen(sub_contract_id: int) -> None:
    """عقد الباطن الملغى يتجمد في مراحله مثل العقد الرئيسي."""
    with get_connection() as conn:
        row = conn.execute("SELECT status FROM sub_contracts WHERE id=?",
                           (sub_contract_id,)).fetchone()
    if row and (row["status"] or "") == "ملغى":
        raise DatabaseError("عقد الباطن ملغى ومجمّد: لا يمكن تغيير مراحله.")


def _advance_contract_stage(contract_id: int, skip: bool = False,
                            note: str = "", user_id: int | None = None,
                            action_date: str | None = None
                            ) -> dict:
    """إنهاء/تخطي مرحلة على نسخة العقد + الاستحقاق المالي التلقائي."""
    if is_manual_path(contract_id):
        raise DatabaseError(
            "العقد على المسار اليدوي — الإنهاء من تبويب المسار اليدوي.")
    _ensure_contract_stage_not_frozen(contract_id)
    uid = _uid(user_id)
    who = auth_service.display_name()
    today = (action_date or date.today().isoformat()).strip()[:10]
    try:
        date.fromisoformat(today)
    except Exception:
        raise DatabaseError("تاريخ حركة المرحلة غير صحيح.")
    stages = get_contract_stages(contract_id)
    steps = [s for s in stages if s["level"] == 1]
    cur = next((s for s in steps
                if s["start_date"] and not s["end_date"]), None)
    if cur is None:
        raise DatabaseError(
            "لا مرحلة جارية لهذا العقد — أو لم يُنسخ له قالب مراحل.")
    idx = steps.index(cur)
    nxt = steps[idx + 1] if idx + 1 < len(steps) else None
    with get_connection() as conn:
        conn.execute(
            "UPDATE contract_stages SET end_date=?, is_skipped=?, "
            "closed_by=? WHERE id=?",
            (today, 1 if skip else 0, who, cur["id"]))
        if nxt is not None:
            conn.execute(
                "UPDATE contract_stages SET start_date=?, closed_by=? WHERE id=?",
                (today, who, nxt["id"]))
        # سجل تدقيق (يعمل معه الشات والإشعارات كالسابق)
        conn.execute(
            "INSERT INTO transaction_stage_log (transaction_type, "
            "transaction_id, stage_id, moved_by, note, start_date, "
            "end_date, is_skipped) VALUES (?,?,NULL,?,?,?,?,?)",
            (TX_CONTRACT, contract_id, uid,
             (note or "").strip() or cur["name"], today, today,
             1 if skip else 0))
    if not skip:
        # V3.29: التعهد العقدي القديم — يُتخطى للموسومة (محرك المراحل
        # الجديد) ولمن لا مدة له (كان يكسر الإنهاء كله بخطأ).
        if (_is_supervision_end_stage_name(cur["name"] or "")
                and not cur.get("is_supervision")
                and _contract_can_pledge(contract_id)):
            try:
                from services import supervision_service as _sup
                _sup.set_supervision_end_from_stage(contract_id, today)
            except Exception as exc:
                raise DatabaseError(str(exc))
    # الربط المالي التلقائي: إنهاء المرحلة يستحق دفعتها (لا التخطي)
    triggered = []
    skipped_payments = []
    # V4.2: دفعات الباطن المرتبطة بالمرحلة نفسها.
    triggered_sub = []
    # V4.6: دفعات الباطن المكتملة مصادرها من دفعات العميل.
    triggered_src = []
    if not skip:
        try:
            triggered = trigger_due_payments(
                contract_id, int(cur["id"]), today)
        except Exception:
            triggered = []
        try:
            triggered_sub = trigger_due_sub_payments(
                contract_id, int(cur["id"]), today)
        except Exception:
            triggered_sub = []
        try:
            triggered_src = trigger_linked_sub_payments(contract_id, today)
        except Exception:
            triggered_src = []
    else:
        try:
            skipped_payments = _mark_skipped_stage_payments(
                contract_id, int(cur["id"]), cur["name"], today)
        except Exception:
            skipped_payments = []
        try:
            _mark_skipped_sub_stage_payments(
                contract_id, int(cur["id"]), cur["name"], today)
        except Exception:
            pass
    verb = "تخطّى" if skip else "أنهى"
    _push(_notify_targets(TX_CONTRACT, contract_id, exclude=uid),
          TX_CONTRACT, contract_id, NOTIF_STAGE,
          f"{who} {verb} مرحلة «{cur['name']}»"
          + (f" وبدأت «{nxt['name']}»" if nxt else
             " — اكتمل مسار المراحل"))
    for t in triggered:
        if t.get("already_paid"):
            msg = (f"انتهت مرحلة «{cur['name']}» المرتبطة بدفعة "
                   f"«{t['title']}» المسددة مسبقًا")
        else:
            msg = (f"استحقت دفعة «{t['title']}» ({t.get('remaining', t['amount']):,.3f}) "
                   f"بإنهاء مرحلة «{cur['name']}»")
        _push(_notify_targets(TX_CONTRACT, contract_id, exclude=uid),
              TX_CONTRACT, contract_id, NOTIF_STAGE, msg)
    # V4.2: إشعارات دفعات الباطن المستحقة بالمرحلة نفسها.
    for t in triggered_sub:
        if t.get("already_paid"):
            continue
        _push(_notify_targets(TX_CONTRACT, contract_id, exclude=uid),
              TX_CONTRACT, contract_id, NOTIF_STAGE,
              f"استحقت دفعة باطن «{t['title']}» "
              f"({t.get('remaining', t['amount']):,.3f}) للمقاول "
              f"«{t.get('sub_name') or ''}» بإنهاء مرحلة «{cur['name']}»")
    # V4.6: إشعارات دفعات الباطن المكتملة مصادرها من دفعات العميل.
    for t in triggered_src:
        if t.get("already_paid"):
            continue
        _push(_notify_targets(TX_CONTRACT, contract_id, exclude=uid),
              TX_CONTRACT, contract_id, NOTIF_STAGE,
              f"استحقت دفعة باطن «{t['title']}» "
              f"({t.get('remaining', t['amount']):,.3f}) للمقاول "
              f"«{t.get('sub_name') or ''}» باكتمال مصادرها من دفعات العميل")
    # تعليق تلقائي بماذا تم
    with get_connection() as conn:
        row = conn.execute(
            "SELECT customer_id, contract_number FROM contracts "
            "WHERE id=?", (contract_id,)).fetchone()
    if row:
        note_txt = (f" · ملاحظة: {note.strip()}"
                    if (note or "").strip() else "")
        body = (f"{verb} {who} مرحلة «{cur['name']}» للعقد "
                f"{row['contract_number']} بتاريخ {today}"
                + (f" — وبدأت «{nxt['name']}»" if nxt else
                   " — اكتمل مسار المراحل") + note_txt)
        if triggered:
            due_items = [t for t in triggered if not t.get("already_paid")]
            paid_items = [t for t in triggered if t.get("already_paid")]
            if due_items:
                pays = " و".join(
                    f"«{t['title']}» ({t.get('remaining', t['amount']):,.3f})"
                    for t in due_items)
                body += (f" — استحقاق دفعة بناءً على المرحلة: {pays} "
                         f"أصبحت مستحقة بتاريخ {today}")
            if paid_items:
                pays = " و".join(f"«{t['title']}»" for t in paid_items)
                body += (f" — الدفعة المرتبطة بالمرحلة {pays} "
                         "كانت مسددة مسبقًا ولا توجد مطالبة جديدة")
        if skipped_payments:
            pays = " و".join(f"«{t['title']}»" for t in skipped_payments)
            body += (f" — الدفعة المرتبطة بالمرحلة {pays} "
                     "غير مستحقة لأن المرحلة تم تخطيها")
        _auto_comment(row["customer_id"], contract_id, body)
    return {"closed": cur["name"],
            "next": nxt["name"] if nxt else None,
            "triggered_payments": triggered,
            "skipped_payments": skipped_payments}


def revert_contract_stage(contract_id: int, reason: str = "",
                          user_id: int | None = None) -> dict:
    """تراجع مدير عن آخر انتقال مرحلة في عقد.

    يعيد المرحلة السابقة كمرحلة جارية، ويفتح المرحلة التي بدأت بعدها.
    أي دفعة استحقت تلقائيًا بسبب إغلاق المرحلة السابقة تُعاد إلى تقديرية
    فقط إذا لم توجد سندات قبض لاحقة على العقد؛ السندات المالية لا تُلغى هنا.
    """
    if is_manual_path(contract_id):
        raise DatabaseError(
            "العقد على المسار اليدوي — إعادة الفتح من تبويب المسار اليدوي.")
    _ensure_contract_stage_not_frozen(contract_id)
    uid = _uid(user_id)
    who = auth_service.display_name()
    today = date.today().isoformat()
    reason = (reason or "").strip()
    stages = [s for s in get_contract_stages(contract_id) if s["level"] == 1]
    if not stages:
        raise DatabaseError("لا توجد مراحل منسوخة لهذا العقد.")
    current = next((s for s in stages if s["start_date"] and not s["end_date"]), None)
    if current is not None:
        cur_idx = stages.index(current)
        if cur_idx <= 0:
            raise DatabaseError("العقد في أول مرحلة بالفعل — لا توجد مرحلة سابقة للتراجع إليها.")
        reopen = stages[cur_idx - 1]
        opened = current
    else:
        # لو اكتمل المسار ولا توجد مرحلة جارية، نعيد آخر مرحلة مغلقة.
        closed = [s for s in stages if s["start_date"] and s["end_date"]]
        if not closed:
            raise DatabaseError("لا توجد حركة مرحلة يمكن التراجع عنها.")
        reopen = closed[-1]
        opened = None
    reverted_payments = []
    kept_payments = []
    with get_connection() as conn:
        if opened is not None:
            conn.execute(
                "UPDATE contract_stages SET start_date='', end_date='', "
                "is_skipped=0, closed_by='' WHERE id=?",
                (opened["id"],))
        conn.execute(
            "UPDATE contract_stages SET end_date='', is_skipped=0, "
            "closed_by='' WHERE id=?", (reopen["id"],))
        _reverted_cust_ids = []   # V6.6: لتتبع المطالبات
        _reverted_sub_ids = []    # V6.6: لتتبع المطالبات
        # عكس الاستحقاق التلقائي المرتبط بهذه المرحلة إذا لم يصدر قبض بعده.
        pays = conn.execute(
            "SELECT id, title, amount, triggered_at FROM payment_plan "
            "WHERE contract_id=? AND stage_id=? "
            "AND COALESCE(triggered_at,'')<>''",
            (contract_id, reopen["id"])).fetchall()
        for p in pays:
            receipt = conn.execute(
                "SELECT 1 FROM vouchers WHERE contract_id=? AND vtype='receipt' "
                "AND cancelled=0 AND vdate>=? LIMIT 1",
                (contract_id, p["triggered_at"] or today)).fetchone()
            if receipt:
                kept_payments.append({"title": p["title"],
                                      "amount": float(p["amount"] or 0)})
                continue
            conn.execute(
                "UPDATE payment_plan SET triggered_at='', notes='' WHERE id=?",
                (p["id"],))
            _reverted_cust_ids.append(int(p["id"]))  # V6.6
            reverted_payments.append({"title": p["title"],
                                      "amount": float(p["amount"] or 0)})
        # V4.2: عكس تفعيل دفعات الباطن المرتبطة — ما لم يوجد صرف بعدها.
        _spays = conn.execute(
            "SELECT sp.id, sp.title, sp.amount, sp.triggered_at, "
            "sp.sub_contract_id FROM sub_payment_plan sp "
            "JOIN sub_contracts sc ON sc.id = sp.sub_contract_id "
            "WHERE sc.contract_id=? AND sp.stage_id=? "
            "AND COALESCE(sp.triggered_at,'')<>''",
            (contract_id, reopen["id"])).fetchall()
        _seen_sub = set()
        for p in _spays:
            _seen_sub.add(p["id"])
            _pv = conn.execute(
                "SELECT 1 FROM vouchers WHERE sub_contract_id=? "
                "AND vtype='payment' AND cancelled=0 AND vdate>=? LIMIT 1",
                (p["sub_contract_id"], p["triggered_at"] or today)).fetchone()
            if _pv:
                kept_payments.append({"title": "باطن: " + (p["title"] or ""),
                                      "amount": float(p["amount"] or 0)})
                continue
            conn.execute(
                "UPDATE sub_payment_plan SET triggered_at='', notes='' "
                "WHERE id=?", (p["id"],))
            _reverted_sub_ids.append(int(p["id"]))  # V6.6
            reverted_payments.append({"title": "باطن: " + (p["title"] or ""),
                                      "amount": float(p["amount"] or 0)})
        # V4.6: عكس دفعات الباطن المفعّلة بالمصادر إذا نقصت مصادرها —
        # ما لم يوجد صرف بعدها (نفس حارس الاحتفاظ).
        _srcpays = conn.execute(
            "SELECT sp.id, sp.title, sp.amount, sp.triggered_at, "
            "sp.sub_contract_id FROM sub_payment_plan sp "
            "JOIN sub_contracts sc ON sc.id = sp.sub_contract_id "
            "WHERE sc.contract_id=? AND COALESCE(sp.triggered_at,'')<>'' "
            "AND EXISTS (SELECT 1 FROM sub_payment_sources sps "
            "WHERE sps.sub_line_id = sp.id)",
            (contract_id,)).fetchall()
        for p in _srcpays:
            if p["id"] in _seen_sub:
                continue
            _incomplete = conn.execute(
                "SELECT 1 FROM sub_payment_sources sps "
                "JOIN payment_plan pp ON pp.id = sps.cust_line_id "
                "WHERE sps.sub_line_id=? "
                "AND COALESCE(pp.triggered_at,'')='' LIMIT 1",
                (p["id"],)).fetchone()
            if not _incomplete:
                continue
            _pv = conn.execute(
                "SELECT 1 FROM vouchers WHERE sub_contract_id=? "
                "AND vtype='payment' AND cancelled=0 AND vdate>=?",
                (p["sub_contract_id"], p["triggered_at"] or today)).fetchone()
            if _pv:
                kept_payments.append({"title": "باطن: " + (p["title"] or ""),
                                      "amount": float(p["amount"] or 0)})
                continue
            conn.execute(
                "UPDATE sub_payment_plan SET triggered_at='', notes='' "
                "WHERE id=?", (p["id"],))
            _reverted_sub_ids.append(int(p["id"]))  # V6.6
            reverted_payments.append({"title": "باطن: " + (p["title"] or ""),
                                      "amount": float(p["amount"] or 0)})

        # V9.5.3: فحص شامل — أي دفعة مستحقة مرحلتها لم تعد مكتملة تُمسح
        # (يحل مشكلة الدفعات من مراحل لاحقة تبقى مستحقة بعد التراجع)
        _completed_stage_ids = {
            int(s["id"]) for s in stages
            if s.get("end_date") and not s.get("is_skipped")
        }
        # دفعات العميل
        _all_triggered_cust = conn.execute(
            "SELECT id, title, amount, stage_id, triggered_at "
            "FROM payment_plan WHERE contract_id=? "
            "AND COALESCE(triggered_at,'')<>''",
            (contract_id,)).fetchall()
        for p in _all_triggered_cust:
            _pid = int(p["id"])
            if _pid in _reverted_cust_ids:
                continue  # تمت معالجته أعلاه
            _sid = p["stage_id"]
            if _sid and int(_sid) not in _completed_stage_ids:
                receipt = conn.execute(
                    "SELECT 1 FROM vouchers WHERE contract_id=? "
                    "AND vtype='receipt' AND cancelled=0 AND vdate>=? LIMIT 1",
                    (contract_id, p["triggered_at"] or today)).fetchone()
                if receipt:
                    kept_payments.append({"title": p["title"] or "",
                                          "amount": float(p["amount"] or 0)})
                    continue
                conn.execute(
                    "UPDATE payment_plan SET triggered_at='', notes='' "
                    "WHERE id=?", (_pid,))
                _reverted_cust_ids.append(_pid)
                reverted_payments.append({"title": p["title"] or "",
                                          "amount": float(p["amount"] or 0)})
        # دفعات المقاول
        _all_triggered_sub = conn.execute(
            "SELECT sp.id, sp.title, sp.amount, sp.stage_id, "
            "sp.triggered_at, sp.sub_contract_id "
            "FROM sub_payment_plan sp "
            "JOIN sub_contracts sc ON sc.id = sp.sub_contract_id "
            "WHERE sc.contract_id=? AND COALESCE(sp.triggered_at,'')<>''",
            (contract_id,)).fetchall()
        for p in _all_triggered_sub:
            _pid = int(p["id"])
            if _pid in _reverted_sub_ids:
                continue
            _sid = p["stage_id"]
            if _sid and int(_sid) not in _completed_stage_ids:
                _pv = conn.execute(
                    "SELECT 1 FROM vouchers WHERE sub_contract_id=? "
                    "AND vtype='payment' AND cancelled=0 AND vdate>=? LIMIT 1",
                    (p["sub_contract_id"], p["triggered_at"] or today)).fetchone()
                if _pv:
                    kept_payments.append({"title": "باطن: " + (p["title"] or ""),
                                          "amount": float(p["amount"] or 0)})
                    continue
                conn.execute(
                    "UPDATE sub_payment_plan SET triggered_at='', notes='' "
                    "WHERE id=?", (_pid,))
                _reverted_sub_ids.append(_pid)
                reverted_payments.append({"title": "باطن: " + (p["title"] or ""),
                                          "amount": float(p["amount"] or 0)})
        # V6.6 + V8.7.4: إلغاء المطالبات المرتبطة بالدفعات المُرجَعة
        # (جميع المطالبات غير النهائية: ليست collected/paid)
        _terminal = ("collected", "paid")
        for _lid in _reverted_cust_ids:
            try:
                for _c in conn.execute(
                        "SELECT id FROM claims WHERE cust_line_id=? "
                        "AND status NOT IN (?,?)",
                        (_lid, *_terminal)).fetchall():
                    conn.execute("DELETE FROM claims WHERE id=?",
                                 (_c["id"],))
            except Exception:
                pass
        for _sid in _reverted_sub_ids:
            try:
                for _c in conn.execute(
                        "SELECT id FROM claims WHERE sub_line_id=? "
                        "AND status NOT IN (?,?)",
                        (_sid, *_terminal)).fetchall():
                    conn.execute("DELETE FROM claims WHERE id=?",
                                 (_c["id"],))
            except Exception:
                pass
        conn.execute(
            "INSERT INTO transaction_stage_log (transaction_type, "
            "transaction_id, stage_id, moved_by, note, start_date, "
            "end_date, is_skipped) VALUES (?,?,NULL,?,?,?,?,0)",
            (TX_CONTRACT, contract_id, uid,
             "تراجع عن مرحلة" + (f" · {reason}" if reason else ""),
             today, today))
        row = conn.execute(
            "SELECT customer_id, contract_number FROM contracts WHERE id=?",
            (contract_id,)).fetchone()
    opened_name = opened["name"] if opened is not None else "نهاية المسار"
    body = (f"تراجع {who} عن المرحلة من «{opened_name}» إلى "
            f"«{reopen['name']}» للعقد {row['contract_number'] if row else contract_id} "
            f"بتاريخ {today}")
    if reason:
        body += f" · السبب: {reason}"
    if reverted_payments:
        names = " و".join(f"«{p['title']}»" for p in reverted_payments)
        body += f" · تم إرجاع استحقاق دفعة {names} لأنها لم تُحصّل بسند."
    if kept_payments:
        names = " و".join(f"«{p['title']}»" for p in kept_payments)
        body += f" · لم يتم تعديل دفعة {names} لوجود سند قبض بعد استحقاقها."
    if row:
        _auto_comment(row["customer_id"], contract_id, body)
    _push(_notify_targets(TX_CONTRACT, contract_id, exclude=uid),
          TX_CONTRACT, contract_id, NOTIF_STAGE,
          f"{who} تراجع عن المرحلة من «{opened_name}» إلى «{reopen['name']}»")
    return {"from": opened_name, "to": reopen["name"],
            "reverted_payments": reverted_payments,
            "kept_payments": kept_payments}


# ================================================================
# V4.45: المسار اليدوي — تشك-لست حر لكل تصنيف (مرحلة رئيسية).
# التصنيفات = عناوين النسخة (level=0) تلقائيًا، وعناصر كل تصنيف =
# خطواتها (أو العنوان نفسه إن لم يكن له خطوات).
# التعليم = إنهاء بنفس محرك التحفيز، وإلغاء التعليم = إعادة فتح
# بنفس ضوابط revert (السندات اللاحقة تُبقي الاستحقاق).
# ================================================================

def is_manual_path(contract_id: int) -> bool:
    """هل العقد على المسار اليدوي؟"""
    try:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT manual_path FROM contracts WHERE id=?",
                (contract_id,)).fetchone()
    except Exception:
        return False
    return bool(row and row["manual_path"])


def set_contract_manual_path(contract_id: int, manual: bool,
                             user_id: int | None = None) -> dict:
    """تبديل وضع المسار للعقد (يدوي/إجباري) مع سجل تدقيق.

    الرجوع للإجباري يستأنف المؤشر الخطي تلقائيًا: إن لم توجد مرحلة
    جارية تُفتتح أول مرحلة غير منهاة (الأقل ترتيبًا)، وإن اكتمل الكل
    فلا شيء يُستأنف (المسار مكتمل).
    """
    manual = bool(manual)
    _ensure_contract_stage_not_frozen(contract_id)
    uid = _uid(user_id)
    who = auth_service.display_name()
    today = date.today().isoformat()
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id FROM contracts WHERE id=?", (contract_id,)).fetchone()
        if row is None:
            raise DatabaseError("العقد غير موجود.")
        conn.execute("UPDATE contracts SET manual_path=? WHERE id=?",
                     (1 if manual else 0, contract_id))
        conn.execute(
            "INSERT INTO transaction_stage_log (transaction_type, "
            "transaction_id, stage_id, moved_by, note, start_date, "
            "end_date, is_skipped) VALUES (?,?,NULL,?,?,?,?,0)",
            (TX_CONTRACT, contract_id, uid,
             ("تحويل العقد إلى المسار اليدوي"
              if manual else "رجوع العقد إلى المسار الإجباري"),
             today, today))
    resumed = None
    if not manual:
        stages = [st for st in get_contract_stages(contract_id)
                  if st["level"] == 1]
        cur = next((st for st in stages
                    if st["start_date"] and not st["end_date"]), None)
        if cur is None:
            rest = sorted([st for st in stages if not st["end_date"]],
                          key=lambda st: (st.get("sort_order") or 0,
                                          st.get("id") or 0))
            if rest:
                first = rest[0]
                with get_connection() as conn:
                    conn.execute(
                        "UPDATE contract_stages SET start_date=?, "
                        "closed_by=? WHERE id=?",
                        (today, who, first["id"]))
                    conn.execute(
                        "INSERT INTO transaction_stage_log "
                        "(transaction_type, transaction_id, stage_id, "
                        "moved_by, note, start_date, end_date, is_skipped) "
                        "VALUES (?,?,NULL,?,?,?,?,0)",
                        (TX_CONTRACT, contract_id, uid,
                         f"استئناف المسار الإجباري من: "
                         f"{first['name']}", today, today))
                resumed = first["name"]
    return {"manual": manual, "resumed": resumed}


def manual_path_groups(contract_id: int) -> dict:
    """مجموعات المسار اليدوي: تصنيف لكل رئيسية + تقدمها والإجمالي."""
    stages = get_contract_stages(contract_id)
    # نسخة العقد: الرئيسية level=0 والخطوات level=1 (عكس شجرة القالب).
    mains = sorted([st for st in stages if (st.get("level") or 0) == 0],
                   key=lambda st: (st.get("sort_order") or 0,
                                   st.get("id") or 0))
    steps = sorted([st for st in stages if (st.get("level") or 0) != 0],
                   key=lambda st: (st.get("sort_order") or 0,
                                   st.get("id") or 0))
    if not mains:
        # احتياط: نسخة مسطحة بلا عناوين — تصنيف واحد يجمع الكل.
        mains = [{"name": "مراحل العقد"}]
        steps = [dict(st, parent_name="مراحل العقد") for st in steps]
    kids: dict[str, list] = {}
    for st in steps:
        kids.setdefault((st.get("parent_name") or "").strip(),
                        []).append(st)
    for _lst in kids.values():
        _lst.sort(key=lambda st: (st.get("sort_order") or 0,
                                  st.get("id") or 0))
    paymap: dict[int, dict] = {}
    with get_connection() as conn:
        for r in conn.execute(
                "SELECT stage_id, title, amount, triggered_at "
                "FROM payment_plan WHERE contract_id=? ORDER BY id",
                (contract_id,)).fetchall():
            if r["stage_id"] is not None and r["stage_id"] not in paymap:
                paymap[int(r["stage_id"])] = {
                    "title": r["title"] or "",
                    "amount": float(r["amount"] or 0),
                    "triggered": bool((r["triggered_at"] or "").strip())}
    groups = []
    done_total = 0
    total = 0
    for m in mains:
        items = kids.get((m.get("name") or "").strip()) or [m]
        rows = []
        done = 0
        for it in items:
            # V5.2: المجموعة الاحتياطية لعقد بلا مراحل فعلية لا تحمل معرّفًا —
            # كانت تُسقط الشاشة بـ KeyError عند فتح تبويب الدفعات.
            if it.get("id") is None:
                continue
            closed = bool((it.get("end_date") or "").strip())
            done += 1 if closed else 0
            rows.append({"id": int(it["id"]), "name": it.get("name") or "",
                         "closed": closed,
                         "skipped": bool(it.get("is_skipped")),
                         "closed_by": it.get("closed_by") or "",
                         "end_date": it.get("end_date") or "",
                         "level": int(it.get("level") or 1),
                         "pay": paymap.get(int(it["id"]))})
        groups.append({"main": m.get("name") or "", "items": rows,
                       "done": done, "total": len(rows)})
        done_total += done
        total += len(rows)
    pct = round(done_total * 100 / total) if total else 0
    return {"groups": groups, "done": done_total, "total": total,
            "pct": pct}


def _manual_stage_row(contract_id: int, stage_id: int) -> dict:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM contract_stages WHERE id=? AND contract_id=?",
            (stage_id, contract_id)).fetchone()
    if row is None:
        raise DatabaseError("المرحلة لا تتبع هذا العقد.")
    return dict(row)


def manual_close_stage(contract_id: int, stage_id: int,
                       action_date: str | None = None, note: str = "",
                       user_id: int | None = None) -> dict:
    """تعليم عنصر يدوي (إنهاء) بنفس محرك التحفيز الخطي."""
    if not is_manual_path(contract_id):
        raise DatabaseError(
            "العقد على المسار الإجباري — الإنهاء بالترتيب فقط.")
    _ensure_contract_stage_not_frozen(contract_id)
    st = _manual_stage_row(contract_id, stage_id)
    if (st.get("end_date") or "").strip():
        raise DatabaseError("المرحلة منهاة بالفعل.")
    uid = _uid(user_id)
    who = auth_service.display_name()
    today = (action_date or date.today().isoformat()).strip()[:10]
    try:
        date.fromisoformat(today)
    except Exception:
        raise DatabaseError("تاريخ حركة المرحلة غير صحيح.")
    with get_connection() as conn:
        conn.execute(
            "UPDATE contract_stages SET start_date=CASE "
            "WHEN COALESCE(start_date,'')='' THEN ? ELSE start_date END, "
            "end_date=?, is_skipped=0, closed_by=? WHERE id=?",
            (today, today, who, stage_id))
        conn.execute(
            "INSERT INTO transaction_stage_log (transaction_type, "
            "transaction_id, stage_id, moved_by, note, start_date, "
            "end_date, is_skipped) VALUES (?,?,NULL,?,?,?,?,0)",
            (TX_CONTRACT, contract_id, uid,
             (note or "").strip() or f"إغلاق يدوي: {st['name']}",
             today, today))
    if ((_is_supervision_end_stage_name(st["name"] or ""))
            and not st.get("is_supervision")
            and _contract_can_pledge(contract_id)):
        try:
            from services import supervision_service as _sup
            _sup.set_supervision_end_from_stage(contract_id, today)
        except Exception as exc:
            raise DatabaseError(str(exc))
    triggered = []
    triggered_sub = []
    triggered_src = []
    try:
        triggered = trigger_due_payments(contract_id, int(stage_id), today)
    except Exception:
        triggered = []
    try:
        triggered_sub = trigger_due_sub_payments(
            contract_id, int(stage_id), today)
    except Exception:
        triggered_sub = []
    try:
        triggered_src = trigger_linked_sub_payments(contract_id, today)
    except Exception:
        triggered_src = []
    with get_connection() as conn:
        _crow = conn.execute(
            "SELECT customer_id, contract_number FROM contracts WHERE id=?",
            (contract_id,)).fetchone()
    if _crow:
        # V4.5.03: تعليق تلقائي بنفس صيغة المسار الإجباري.
        _body = (f"أنهى {who} مرحلة «{st['name']}» (مسار يدوي) للعقد "
                 f"{_crow['contract_number']} بتاريخ {today}")
        if (note or "").strip():
            _body += f" · ملاحظة: {note.strip()}"
        _due_items = [t for t in triggered if not t.get("already_paid")]
        _paid_items = [t for t in triggered if t.get("already_paid")]
        if _due_items:
            _pays = " و".join(
                f"«{t['title']}» ({t.get('remaining', t['amount']):,.3f})"
                for t in _due_items)
            _body += (f" — استحقاق دفعة بناءً على المرحلة: {_pays} "
                      f"أصبحت مستحقة بتاريخ {today}")
        if _paid_items:
            _pays = " و".join(f"«{t['title']}»" for t in _paid_items)
            _body += (f" — الدفعة المرتبطة بالمرحلة {_pays} "
                      "كانت مسددة مسبقًا ولا توجد مطالبة جديدة")
        _auto_comment(_crow["customer_id"], contract_id, _body)
    return {"closed": st["name"], "triggered": triggered,
            "triggered_sub": triggered_sub,
            "triggered_src": triggered_src}


def manual_reopen_stage(contract_id: int, stage_id: int,
                        reason: str = "",
                        user_id: int | None = None) -> dict:
    """إلغاء تعليم عنصر يدوي بنفس ضوابط التراجع (السندات اللاحقة
    تُبقي الاستحقاق مستحقًا، وما عداها يعود تقديريًا)."""
    if not is_manual_path(contract_id):
        raise DatabaseError(
            "العقد على المسار الإجباري — التراجع بالترتيب فقط.")
    _ensure_contract_stage_not_frozen(contract_id)
    st = _manual_stage_row(contract_id, stage_id)
    if not (st.get("end_date") or "").strip():
        raise DatabaseError("المرحلة مفتوحة بالفعل.")
    uid = _uid(user_id)
    today = date.today().isoformat()
    reverted_payments = []
    kept_payments = []
    with get_connection() as conn:
        conn.execute(
            "UPDATE contract_stages SET end_date='', is_skipped=0, "
            "closed_by='' WHERE id=?", (stage_id,))
        pays = conn.execute(
            "SELECT id, title, amount, triggered_at FROM payment_plan "
            "WHERE contract_id=? AND stage_id=? "
            "AND COALESCE(triggered_at,'')<>''",
            (contract_id, stage_id)).fetchall()
        _reverted_cust_ids_mnl = []   # V8.7.8: لتتبع المطالبات
        _reverted_sub_ids_mnl = []    # V8.7.8: لتتبع المطالبات
        for p in pays:
            receipt = conn.execute(
                "SELECT 1 FROM vouchers WHERE contract_id=? "
                "AND vtype='receipt' AND cancelled=0 AND vdate>=? LIMIT 1",
                (contract_id, p["triggered_at"] or today)).fetchone()
            if receipt:
                kept_payments.append({"title": p["title"],
                                      "amount": float(p["amount"] or 0)})
                continue
            conn.execute(
                "UPDATE payment_plan SET triggered_at='', notes='' "
                "WHERE id=?", (p["id"],))
            _reverted_cust_ids_mnl.append(int(p["id"]))
            reverted_payments.append(
                {"title": p["title"], "amount": float(p["amount"] or 0)})
        _spays = conn.execute(
            "SELECT sp.id, sp.title, sp.amount, sp.triggered_at, "
            "sp.sub_contract_id FROM sub_payment_plan sp "
            "JOIN sub_contracts sc ON sc.id = sp.sub_contract_id "
            "WHERE sc.contract_id=? AND sp.stage_id=? "
            "AND COALESCE(sp.triggered_at,'')<>''",
            (contract_id, stage_id)).fetchall()
        _seen_sub = set()
        for p in _spays:
            _seen_sub.add(p["id"])
            _pv = conn.execute(
                "SELECT 1 FROM vouchers WHERE sub_contract_id=? "
                "AND vtype='payment' AND cancelled=0 AND vdate>=? LIMIT 1",
                (p["sub_contract_id"],
                 p["triggered_at"] or today)).fetchone()
            if _pv:
                kept_payments.append(
                    {"title": "باطن: " + (p["title"] or ""),
                     "amount": float(p["amount"] or 0)})
                continue
            conn.execute(
                "UPDATE sub_payment_plan SET triggered_at='', notes='' "
                "WHERE id=?", (p["id"],))
            _reverted_sub_ids_mnl.append(int(p["id"]))
            reverted_payments.append(
                {"title": "باطن: " + (p["title"] or ""),
                 "amount": float(p["amount"] or 0)})
        _srcpays = conn.execute(
            "SELECT sp.id, sp.title, sp.amount, sp.triggered_at, "
            "sp.sub_contract_id FROM sub_payment_plan sp "
            "JOIN sub_contracts sc ON sc.id = sp.sub_contract_id "
            "WHERE sc.contract_id=? AND COALESCE(sp.triggered_at,'')<>'' "
            "AND EXISTS (SELECT 1 FROM sub_payment_sources sps "
            "WHERE sps.sub_line_id = sp.id)",
            (contract_id,)).fetchall()
        for p in _srcpays:
            if p["id"] in _seen_sub:
                continue
            _incomplete = conn.execute(
                "SELECT 1 FROM sub_payment_sources sps "
                "JOIN payment_plan pp ON pp.id = sps.cust_line_id "
                "WHERE sps.sub_line_id=? "
                "AND COALESCE(pp.triggered_at,'')='' LIMIT 1",
                (p["id"],)).fetchone()
            if not _incomplete:
                continue
            _pv = conn.execute(
                "SELECT 1 FROM vouchers WHERE sub_contract_id=? "
                "AND vtype='payment' AND cancelled=0 AND vdate>=? LIMIT 1",
                (p["sub_contract_id"],
                 p["triggered_at"] or today)).fetchone()
            if _pv:
                kept_payments.append(
                    {"title": "باطن: " + (p["title"] or ""),
                     "amount": float(p["amount"] or 0)})
                continue
            conn.execute(
                "UPDATE sub_payment_plan SET triggered_at='', notes='' "
                "WHERE id=?", (p["id"],))
            _reverted_sub_ids_mnl.append(int(p["id"]))
            reverted_payments.append(
                {"title": "باطن: " + (p["title"] or ""),
                 "amount": float(p["amount"] or 0)})
        # V8.7.8: حذف المطالبات المرتبطة بالدفعات المُرجَعة
        _terminal = ("collected", "paid")
        for _lid in _reverted_cust_ids_mnl:
            try:
                for _c in conn.execute(
                        "SELECT id FROM claims WHERE cust_line_id=? "
                        "AND status NOT IN (?,?)",
                        (_lid, *_terminal)).fetchall():
                    conn.execute("DELETE FROM claims WHERE id=?",
                                 (_c["id"],))
            except Exception:
                pass
        for _sid in _reverted_sub_ids_mnl:
            try:
                for _c in conn.execute(
                        "SELECT id FROM claims WHERE sub_line_id=? "
                        "AND status NOT IN (?,?)",
                        (_sid, *_terminal)).fetchall():
                    conn.execute("DELETE FROM claims WHERE id=?",
                                 (_c["id"],))
            except Exception:
                pass
        conn.execute(
            "INSERT INTO transaction_stage_log (transaction_type, "
            "transaction_id, stage_id, moved_by, note, start_date, "
            "end_date, is_skipped) VALUES (?,?,NULL,?,?,?,?,0)",
            (TX_CONTRACT, contract_id, uid,
             "إعادة فتح يدوية: " + (st["name"] or "")
             + (f" · {reason.strip()}" if (reason or "").strip() else ""),
             today, today))
    with get_connection() as conn:
        _crow = conn.execute(
            "SELECT customer_id, contract_number FROM contracts WHERE id=?",
            (contract_id,)).fetchone()
    if _crow:
        # V4.5.03: تعليق تلقائي بنفس صيغة التراجع الإجباري.
        _who = auth_service.display_name()
        _body = (f"أعاد {_who} فتح مرحلة «{st['name']}» (مسار يدوي) "
                 f"للعقد {_crow['contract_number']} بتاريخ {today}")
        if (reason or "").strip():
            _body += f" · السبب: {reason.strip()}"
        if reverted_payments:
            _names = " و".join(f"«{p['title']}»" for p in reverted_payments)
            _body += (f" · تم إرجاع استحقاق دفعة {_names} لأنها لم تُحصّل "
                      "بسند.")
        if kept_payments:
            _names = " و".join(f"«{p['title']}»" for p in kept_payments)
            _body += (f" · لم يتم تعديل دفعة {_names} لوجود سند قبض بعد "
                      "استحقاقها.")
        _auto_comment(_crow["customer_id"], contract_id, _body)
    return {"reopened": st["name"], "reverted": reverted_payments,
            "kept": kept_payments}


def stage_finish_order(contract_id: int) -> dict[int, int]:
    """V4.48: رقم الإنهاء العرضي لكل خطوة منهاة (بتسلسل الإغلاق).

    محسوب من (تاريخ الإنهاء، المعرف) — لا يُخزَّن ولا يُعاد تسمية شيء.
    """
    steps = [st for st in get_contract_stages(contract_id)
             if int(st.get("level") or 0) != 0
             and (st.get("end_date") or "").strip()]
    steps.sort(key=lambda st: ((st.get("end_date") or "")[:10],
                               int(st.get("id") or 0)))
    return {int(st["id"]): i + 1 for i, st in enumerate(steps)}


def manual_skip_preview(contract_id: int, stage_id: int) -> list[str]:
    """V4.48: أسماء الخطوات المفتوحة الأسبق ترتيبًا من خطوة معينة.

    للتحذير قبل التعليم اليدوي («تخطي») — فارغ = لا تخطي.
    """
    steps = sorted(
        [st for st in get_contract_stages(contract_id)
         if int(st.get("level") or 0) != 0],
        key=lambda st: (st.get("sort_order") or 0, st.get("id") or 0))
    me = next((st for st in steps if int(st["id"]) == int(stage_id)), None)
    if me is None:
        return []
    my_ord = (me.get("sort_order") or 0, me.get("id") or 0)
    return [(st.get("name") or "") for st in steps
            if (st.get("sort_order") or 0, st.get("id") or 0) < my_ord
            and not (st.get("end_date") or "").strip()]


def _current_contract_stage(contract_id: int) -> dict | None:
    """المرحلة الجارية للعقد من نسخته (بدأت ولم تُقفل)."""
    for s in get_contract_stages(contract_id):
        if s["level"] == 1 and s["start_date"] and not s["end_date"]:
            return {"id": s["id"], "stage_name": s["name"],
                    "stage_order": s["sort_order"], "color": "",
                    "expected_days": s["expected_days"],
                    "is_pre_contract": 0, "moved_at": "",
                    "note": "", "start_date": s["start_date"],
                    "end_date": s["end_date"],
                    "is_skipped": s["is_skipped"],
                    "moved_by_name": s.get("closed_by") or "",
                    "pay_kind": s.get("pay_kind") or "",
                    "pay_pct": s.get("pay_pct") or 0}
    return None


def get_current_stage(transaction_type: str,
                      transaction_id: int) -> dict | None:
    if transaction_type == TX_CONTRACT:
        return _current_contract_stage(transaction_id)
    with get_connection() as conn:
        row = conn.execute(
            "SELECT s.id, s.stage_name, s.stage_order, s.color, "
            "s.expected_days, s.is_pre_contract, "
            "l.moved_at, l.note, l.start_date, l.end_date, l.is_skipped, "
            "COALESCE(NULLIF(TRIM(u.full_name),''), u.username, '') "
            "AS moved_by_name "
            "FROM transaction_stage_log l "
            "LEFT JOIN workflow_stages s ON s.id = l.stage_id "
            "LEFT JOIN users u ON u.id = l.moved_by "
            "WHERE l.transaction_type=? AND l.transaction_id=? "
            "ORDER BY l.id DESC LIMIT 1",
            (transaction_type, transaction_id)).fetchone()
    return dict(row) if row else None


def start_transaction(transaction_type: str, transaction_id: int,
                      user_id: int | None = None) -> int:
    """وضع المعاملة الجديدة في أول مرحلة وإضافة منشئها كمشارك.

    آمنة عند التكرار: لا تنشئ صفًا ثانيًا إن كانت المعاملة بدأت.
    """
    uid = _uid(user_id)
    current = get_current_stage(transaction_type, transaction_id)
    auto_add_participant(uid, transaction_type, transaction_id)
    if current:
        return 0
    sid = first_stage_id(
        transaction_type, resolve_scope(transaction_type, transaction_id))
    if not sid:
        return 0
    with get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO transaction_stage_log (transaction_type, "
            "transaction_id, stage_id, moved_by, note, start_date) "
            "VALUES (?, ?, ?, ?, 'بداية المتابعة', ?)",
            (transaction_type, transaction_id, sid, uid,
             date.today().isoformat()))
        return int(cur.lastrowid)


def move_to_stage(transaction_type: str, transaction_id: int,
                  stage_id: int, user_id: int | None = None,
                  note: str = "") -> int:
    """نقل المعاملة لمرحلة + إشعار كل من يراها."""
    uid = _uid(user_id)
    if transaction_type == TX_CONTRACT:
        _ensure_contract_stage_not_frozen(transaction_id)
    elif transaction_type == TX_SUBCONTRACT:
        _ensure_subcontract_stage_not_frozen(transaction_id)
    with get_connection() as conn:
        stage = conn.execute(
            "SELECT stage_name FROM workflow_stages WHERE id=? "
            "AND transaction_type=?", (stage_id, transaction_type)).fetchone()
    if stage is None:
        raise DatabaseError("المرحلة المطلوبة غير موجودة لهذا النوع.")
    auto_add_participant(uid, transaction_type, transaction_id)
    with get_connection() as conn:
        # إغلاق المرحلة الجارية (عداد الأيام) ثم فتح المرحلة الجديدة
        conn.execute(
            "UPDATE transaction_stage_log SET end_date=? "
            "WHERE transaction_type=? AND transaction_id=? "
            "AND (end_date IS NULL OR end_date='')",
            (date.today().isoformat(), transaction_type, transaction_id))
        cur = conn.execute(
            "INSERT INTO transaction_stage_log (transaction_type, "
            "transaction_id, stage_id, moved_by, note, start_date) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (transaction_type, transaction_id, stage_id, uid,
             (note or "").strip(), date.today().isoformat()))
        log_id = int(cur.lastrowid)
    who = auth_service.display_name()
    _push(_notify_targets(transaction_type, transaction_id, exclude=uid),
          transaction_type, transaction_id, NOTIF_STAGE,
          f"{who} نقل {type_label(transaction_type)} إلى مرحلة "
          f"«{stage['stage_name']}»")
    return log_id


# ============================================================
# V5.9: ملاحظات المرحلة — «سبب التأخير / واقفة فين»
# جداول مستقلة عن سجل الحركة حتى لا تؤثر على عدّادات المراحل.
# ============================================================
def _ensure_stage_notes(conn) -> None:
    conn.execute(
        "CREATE TABLE IF NOT EXISTS stage_notes ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "transaction_type TEXT NOT NULL, transaction_id INTEGER NOT NULL, "
        "contract_id INTEGER, customer_id INTEGER, "
        "stage_name TEXT DEFAULT '', note TEXT NOT NULL, "
        "created_by INTEGER, author TEXT DEFAULT '', "
        "created_at TEXT DEFAULT (datetime('now','localtime')))")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_stage_notes_tx "
                 "ON stage_notes(transaction_type, transaction_id, id)")


def _tx_context(transaction_type: str, transaction_id: int) -> dict:
    """سياق المعاملة: العقد والعميل والتسمية — لأجل الملاحظات والتعليقات."""
    ctx = {"contract_id": None, "customer_id": None, "label": ""}
    with get_connection() as conn:
        if transaction_type == TX_CONTRACT:
            r = conn.execute(
                "SELECT id, customer_id, contract_number FROM contracts "
                "WHERE id=?", (int(transaction_id),)).fetchone()
            if r:
                ctx.update(contract_id=int(r["id"]),
                           customer_id=int(r["customer_id"] or 0) or None,
                           label=r["contract_number"] or "")
        elif transaction_type == TX_PAYMENT:
            r = conn.execute(
                "SELECT id, voucher_number, vtype, contract_id, party_type, "
                "party_id, expense_customer_id FROM vouchers WHERE id=?",
                (int(transaction_id),)).fetchone()
            if r:
                ctx["label"] = r["voucher_number"] or ""
                if r["contract_id"]:
                    ctx["contract_id"] = int(r["contract_id"])
                    c = conn.execute(
                        "SELECT customer_id FROM contracts WHERE id=?",
                        (ctx["contract_id"],)).fetchone()
                    if c:
                        ctx["customer_id"] = int(c["customer_id"] or 0) or None
                if not ctx["customer_id"] and r["expense_customer_id"]:
                    ctx["customer_id"] = int(r["expense_customer_id"])
                if (not ctx["customer_id"]
                        and (r["party_type"] or "") == "customer"
                        and r["party_id"]):
                    ctx["customer_id"] = int(r["party_id"])
        elif transaction_type == TX_SUBCONTRACT:
            r = conn.execute(
                "SELECT id, contract_id FROM sub_contracts WHERE id=?",
                (int(transaction_id),)).fetchone()
            if r:
                ctx["label"] = f"عقد باطن #{int(r['id'])}"
                if r["contract_id"]:
                    ctx["contract_id"] = int(r["contract_id"])
                    c = conn.execute(
                        "SELECT customer_id, contract_number FROM contracts "
                        "WHERE id=?", (ctx["contract_id"],)).fetchone()
                    if c:
                        ctx["customer_id"] = int(c["customer_id"] or 0) or None
                        ctx["label"] = (f"عقد باطن داخل {c['contract_number']}"
                                        or ctx["label"])
        elif transaction_type == TX_CUSTOMER:
            r = conn.execute("SELECT id, name FROM customers WHERE id=?",
                             (int(transaction_id),)).fetchone()
            if r:
                ctx["customer_id"] = int(r["id"])
                ctx["label"] = r["name"] or ""
    return ctx


def _current_stage_name(transaction_type: str, transaction_id: int) -> str:
    try:
        cur = get_current_stage(transaction_type, transaction_id) or {}
        return (cur.get("stage_name") or cur.get("name") or "").strip()
    except Exception:
        return ""


def add_stage_note(transaction_type: str, transaction_id: int,
                   note: str, user_id: int | None = None) -> int:
    """إضافة ملاحظة على المعاملة بلا تغيير مرحلتها.

    · تُحفظ في stage_notes (تاريخ/وقت/كاتب).
    · تنزل تلقائيًا في تعليقات العميل وسجل العقد (مثل سبب التراجع).
    · تظهر في سجل المراحل وتقرير مراحل التنفيذ.
    """
    body = (note or "").strip()
    if not body:
        raise DatabaseError("اكتب نص الملاحظة أولًا.")
    if not transaction_type or not transaction_id:
        raise DatabaseError("تعذّر تحديد المعاملة المطلوبة للملاحظة.")
    uid = _uid(user_id)
    stage_name = _current_stage_name(transaction_type, transaction_id)
    ctx = _tx_context(transaction_type, transaction_id)
    who = ""
    try:
        who = auth_service.display_name() or ""
    except Exception:
        who = ""
    with get_connection() as conn:
        _ensure_stage_notes(conn)
        cur = conn.execute(
            "INSERT INTO stage_notes (transaction_type, transaction_id, "
            "contract_id, customer_id, stage_name, note, created_by, author) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (transaction_type, int(transaction_id), ctx["contract_id"],
             ctx["customer_id"], stage_name, body, uid, who))
        note_id = int(cur.lastrowid)
    if uid:
        auto_add_participant(uid, transaction_type, transaction_id)
    # تعليق العميل (وسجل العقد) — إثراء لا يعطّل الملاحظة إن فشل.
    if ctx["customer_id"]:
        try:
            from services import comment_service
            head = f"📝 [ملاحظة{' مرحلة «' + stage_name + '»' if stage_name else ''}]"
            comment_service.add_comment(
                ctx["customer_id"],
                f"{head} {body}" + (f" — {ctx['label']}" if ctx["label"] else ""),
                contract_id=ctx["contract_id"])
        except Exception:
            pass
    # إشعار المشاركين
    try:
        _push(_notify_targets(transaction_type, transaction_id, exclude=uid or 0),
              transaction_type, transaction_id, NOTIF_STAGE,
              f"📝 ملاحظة جديدة{' على مرحلة «' + stage_name + '»' if stage_name
                 else ''}: {body[:80]}")
    except Exception:
        pass
    return note_id


def list_stage_notes(transaction_type: str, transaction_id: int) -> list[dict]:
    """كل ملاحظات المعاملة — الأحدث آخرًا (ترتيب العرض في السجل)."""
    if not transaction_type or not transaction_id:
        return []
    with get_connection() as conn:
        _ensure_stage_notes(conn)
        rows = conn.execute(
            "SELECT id, transaction_type, transaction_id, contract_id, "
            "customer_id, stage_name, note, created_at, author, created_by "
            "FROM stage_notes WHERE transaction_type=? AND transaction_id=? "
            "ORDER BY id", (transaction_type, int(transaction_id))).fetchall()
    return [dict(r) for r in rows]


def latest_stage_note(transaction_type: str, transaction_id: int) -> dict | None:
    """آخر ملاحظة — لشارة «النوت الصغير» قدام المعاملة."""
    notes = list_stage_notes(transaction_type, transaction_id)
    return notes[-1] if notes else None


def stage_notes_by_contract(contract_ids: list[int]) -> dict:
    """آخر ملاحظة لكل عقد — دفعة واحدة لتقرير مراحل التنفيذ."""
    ids = [int(c) for c in (contract_ids or []) if c]
    if not ids:
        return {}
    q = ",".join("?" for _ in ids)
    out: dict[int, dict] = {}
    with get_connection() as conn:
        _ensure_stage_notes(conn)
        rows = conn.execute(
            f"SELECT contract_id, note, created_at, author, stage_name "
            f"FROM stage_notes WHERE contract_id IN ({q}) ORDER BY id",
            ids).fetchall()
    for r in rows:
        cid = int(r["contract_id"] or 0)
        if cid:
            out[cid] = {"note": r["note"] or "",
                        "at": r["created_at"] or "",
                        "by": r["author"] or "",
                        "stage_name": r["stage_name"] or ""}
    return out


def _note_history_entry(n: dict) -> dict:
    """تمثيل الملاحظة كسطر في سجل المراحل (تُعرض بجانب الحركات)."""
    return {
        "id": 0,
        "moved_at": n.get("created_at") or "",
        "note": n.get("note") or "",
        "start_date": "",
        "end_date": "",
        "is_skipped": 0,
        "stage_name": ("📝 ملاحظة" +
                       (f" — {n['stage_name']}" if n.get("stage_name") else "")),
        "color": "",
        "moved_by_name": n.get("author") or "",
        "kind": "note",
    }


def get_stage_history(transaction_type: str,
                      transaction_id: int) -> list[dict]:
    if transaction_type == TX_CONTRACT:
        rows = contract_stage_history(transaction_id)
    else:
        rows = _stage_history_rows(transaction_type, transaction_id)
    # V5.9: الملاحظات تظهر في السجل بجانب حركات المراحل.
    try:
        rows = list(rows) + [_note_history_entry(n) for n in
                             list_stage_notes(transaction_type, transaction_id)]
    except Exception:
        pass
    return rows


def _stage_history_rows(transaction_type: str,
                        transaction_id: int) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT l.id, l.moved_at, l.note, "
            "l.start_date, l.end_date, l.is_skipped, "
            "COALESCE(s.stage_name,'—') AS stage_name, "
            "s.color AS color, "
            "COALESCE(NULLIF(TRIM(u.full_name),''), u.username,'') AS moved_by_name "
            "FROM transaction_stage_log l "
            "LEFT JOIN workflow_stages s ON s.id = l.stage_id "
            "LEFT JOIN users u ON u.id = l.moved_by "
            "WHERE l.transaction_type=? AND l.transaction_id=? "
            "ORDER BY l.id", (transaction_type, transaction_id)).fetchall()
    return [dict(r) for r in rows]


# ============================================================
# الشات
# ============================================================
def add_message(transaction_type: str, transaction_id: int,
                message: str, user_id: int | None = None,
                attachment_path: str = "") -> int:
    body = (message or "").strip()
    if not body:
        raise DatabaseError("لا يمكن إرسال رسالة فارغة.")
    uid = _uid(user_id)
    auto_add_participant(uid, transaction_type, transaction_id)
    with get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO transaction_messages (transaction_type, "
            "transaction_id, user_id, message, attachment_path) "
            "VALUES (?, ?, ?, ?, ?)",
            (transaction_type, transaction_id, uid, body,
             attachment_path or ""))
        msg_id = int(cur.lastrowid)
    who = auth_service.display_name()
    preview = body if len(body) <= 60 else body[:57] + "..."
    _push(_notify_targets(transaction_type, transaction_id, exclude=uid),
          transaction_type, transaction_id, NOTIF_MESSAGE,
          f"رسالة جديدة من {who}: {preview}")
    return msg_id


def get_messages(transaction_type: str, transaction_id: int,
                 requesting_user_id: int | None = None) -> list[dict]:
    """رسائل المعاملة · تُرجع [] لمن لا يملك صلاحية الرؤية."""
    uid = _uid(requesting_user_id)
    if not can_user_view(uid, transaction_type, transaction_id):
        return []
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT m.id, m.message, m.attachment_path, m.created_at, "
            "m.user_id, COALESCE(NULLIF(TRIM(u.full_name),''), u.username,'') AS author "
            "FROM transaction_messages m "
            "LEFT JOIN users u ON u.id = m.user_id "
            "WHERE m.transaction_type=? AND m.transaction_id=? "
            "ORDER BY m.id", (transaction_type, transaction_id)).fetchall()
    return [dict(r) for r in rows]


# ============================================================
# التنبيهات
# ============================================================
def get_unread_notifications(user_id: int | None = None) -> list[dict]:
    uid = _uid(user_id)
    if not uid:
        return []
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, transaction_type, transaction_id, type, text, "
            "created_at FROM notifications WHERE user_id=? AND is_read=0 "
            "ORDER BY id DESC LIMIT 100", (uid,)).fetchall()
    return [dict(r) for r in rows]


def unread_count(user_id: int | None = None) -> int:
    uid = _uid(user_id)
    if not uid:
        return 0
    with get_connection() as conn:
        return int(conn.execute(
            "SELECT COUNT(*) FROM notifications WHERE user_id=? AND is_read=0",
            (uid,)).fetchone()[0])


def mark_read(notification_id: int) -> None:
    with get_connection() as conn:
        conn.execute("UPDATE notifications SET is_read=1 WHERE id=?",
                     (notification_id,))


def mark_all_read(user_id: int | None = None) -> int:
    uid = _uid(user_id)
    if not uid:
        return 0
    with get_connection() as conn:
        cur = conn.execute(
            "UPDATE notifications SET is_read=1 WHERE user_id=? AND is_read=0",
            (uid,))
        return int(cur.rowcount or 0)


def clear_all_notifications(user_id: int | None = None) -> int:
    """V9.15.5: مسح كل إشعارات المتابعة للمستخدم — المقروءة وغير المقروءة."""
    uid = _uid(user_id)
    if not uid:
        return 0
    with get_connection() as conn:
        cur = conn.execute("DELETE FROM notifications WHERE user_id=?", (uid,))
        return int(cur.rowcount or 0)


# V9.15.6: إخفاء التنبيهات النظامية (محسوبة من البيانات) لكل مستخدم.
# المفتاح = بصمة نص التنبيه، فإذا تغيّرت بياناته (مبلغ/تاريخ/حالة) يعود ظاهرًا.
def _ensure_dismissed_table(conn) -> None:
    conn.execute(
        "CREATE TABLE IF NOT EXISTS dismissed_alerts ("
        "user_id INTEGER NOT NULL, alert_key TEXT NOT NULL, "
        "created_at TEXT DEFAULT (datetime('now','localtime')), "
        "PRIMARY KEY (user_id, alert_key))")


def alert_key(text: str) -> str:
    import hashlib
    return hashlib.sha1((text or "").encode("utf-8")).hexdigest()


def dismissed_alert_keys(user_id: int | None = None) -> set:
    uid = _uid(user_id)
    if not uid:
        return set()
    with get_connection() as conn:
        _ensure_dismissed_table(conn)
        rows = conn.execute(
            "SELECT alert_key FROM dismissed_alerts WHERE user_id=?",
            (uid,)).fetchall()
    return {r[0] for r in rows}


def dismiss_alerts(texts, user_id: int | None = None) -> int:
    uid = _uid(user_id)
    if not uid:
        return 0
    keys = {alert_key(t) for t in texts if t}
    if not keys:
        return 0
    with get_connection() as conn:
        _ensure_dismissed_table(conn)
        conn.executemany(
            "INSERT OR IGNORE INTO dismissed_alerts (user_id, alert_key) "
            "VALUES (?, ?)", [(uid, k) for k in keys])
    return len(keys)


def restore_dismissed_alerts(user_id: int | None = None) -> int:
    uid = _uid(user_id)
    if not uid:
        return 0
    with get_connection() as conn:
        _ensure_dismissed_table(conn)
        cur = conn.execute(
            "DELETE FROM dismissed_alerts WHERE user_id=?", (uid,))
        return int(cur.rowcount or 0)


def clear_old_notifications(user_id: int | None = None,
                            days: int = 30) -> int:
    """V3.4: مسح إشعارات المتابعة المقروءة والأقدم من أيام (افتراضي 30).

    المقروءة تُمسح مهما كان عمرها · غير المقروءة تُمسح فقط إن تجاوزت
    المدة (تصفية القديمة العالقة).
    """
    uid = _uid(user_id)
    if not uid:
        return 0
    with get_connection() as conn:
        cur = conn.execute(
            "DELETE FROM notifications WHERE user_id=? AND "
            "(is_read=1 OR created_at < datetime('now','localtime',?))",
            (uid, f"-{int(days)} days"))
        return int(cur.rowcount or 0)

# ============================================================
# قالب دفعات نوع العقد — يُدار من الإعدادات ويسحبه العقد الجديد جاهزًا
# (كل دفعة برقمها ونسبتها ومرحلتها — مرحلة ↔ دفعة واحدة بلا تكرار)
# ============================================================
def _ensure_link_keyword_column(conn) -> None:
    """يضمن وجود عمود link_keyword في type_payment_tpl.

    العمود أُضيف مع «كلمة الربط» في قالب الأنواع، لكنه غير موجود في
    قواعد البيانات القديمة. بدون هذا الضمان يفشل استعلام type_payments
    بخطأ «no such column» فيتعطل توقيع العقد وتوليد خطة السداد.
    التعديل آمن: ALTER بإضافة عمود نصي فارغ لا يمس أي بيانات قائمة.
    """
    try:
        cols = {r[1] for r in conn.execute(
            "PRAGMA table_info(type_payment_tpl)")}
        if "link_keyword" not in cols:
            conn.execute("ALTER TABLE type_payment_tpl "
                         "ADD COLUMN link_keyword TEXT DEFAULT ''")
    except Exception:
        pass


def type_payments(contract_type: str) -> list[dict]:
    """قالب دفعات النوع بترتيب أرقام الدفعات — كل دفعة مع **مجموعة
    مراحلها** (دفعة واحدة تجمع مرحلتين أو أكثر · المرحلة ↔ دفعة
    واحدة)."""
    contract_type = _stage_scope(contract_type)
    with get_connection() as conn:
        _ensure_link_keyword_column(conn)
        rows = conn.execute(
            "SELECT p.id, p.contract_type, p.pay_no, p.title, p.pct, "
            "p.amount_fixed, p.stage_id, p.trigger_stage_id, "
            "p.days_offset, COALESCE(p.link_keyword,'') AS link_keyword "
            "FROM type_payment_tpl p "
            "WHERE p.contract_type=? ORDER BY p.pay_no, p.id",
            (contract_type,)).fetchall()
        stages = {}
        for r in conn.execute(
                "SELECT ps.payment_id, ps.stage_id, s.stage_name "
                "FROM type_payment_stages ps "
                "JOIN workflow_stages s ON s.id=ps.stage_id "
                "ORDER BY ps.id"):
            stages.setdefault(int(r["payment_id"]), []).append(
                {"id": int(r["stage_id"]),
                 "stage_name": r["stage_name"]})
    out = []
    for r in rows:
        d = dict(r)
        d["stages"] = stages.get(int(r["id"]), [])
        if not d["stages"] and d.get("stage_id"):
            d["stages"] = [{"id": int(d["stage_id"]),
                            "stage_name": stage_name_of(d["stage_id"])}]
        d["stage_name"] = " + ".join(s["stage_name"]
                                     for s in d["stages"]) or None
        d["stage_ids"] = [s["id"] for s in d["stages"]]
        trig = d.get("trigger_stage_id")
        d["trigger_name"] = stage_name_of(trig) if trig else None
        # النوع: إنجاز = تستحق عند إنهاء المرحلة المحفزة. بلا ربط مرحلة = تاريخ يدوي/أيام.
        d["kind"] = "إنجاز" if trig else "تاريخ يدوي"
        out.append(d)
    return out


def _validate_payment_stages(contract_type: str, stage_ids: list,
                             trigger_stage_id: int | None) -> None:
    """قواعد ربط دفعة بمراحله (معايير القبول):

    · الربط بخطوات تنفيذ فعلية فقط — ممنوع الرئيسية التجميعية.
    · المرحلة الواحدة تتبع دفعة واحدة فقط.
    · المرحلة المُحفِّزة يجب أن تكون من مراحل الدفعة نفسها.
    · بلا مراحل = دفعة بالأيام (لا مُحفِّز لها).
    """
    if not stage_ids and trigger_stage_id:
        raise DatabaseError(
            "المرحلة المُحفِّزة تُحدَّد فقط لدفعة مربوطة بمراحل — "
            "الدفعة الحرة تُستحق بأيامها من تاريخ التوقيع.")
    if len(stage_ids) > 1 and not trigger_stage_id:
        raise DatabaseError(
            "دفعة تجمع أكثر من مرحلة تتطلب تحديد «المرحلة المُحفِّزة» "
            "صراحةً — المرحلة التي إنهاؤها فعليًا يستحق الدفعة؛ باقي "
            "المراحل للتجميع والعرض فقط.")
    path = stage_path(TX_CONTRACT, contract_type)
    step_ids = {s["id"] for s in path}
    for sid in stage_ids:
        if sid not in step_ids:
            raise DatabaseError(
                "الربط يكون بخطوات تنفيذ فعلية فقط — لا بالمرحلة "
                "الرئيسية التجميعية.")
    if trigger_stage_id and trigger_stage_id not in stage_ids:
        raise DatabaseError(
            "المرحلة المُحفِّزة يجب أن تكون من مراحل هذه الدفعة "
            "نفسها.")


def _set_payment_stages(conn, payment_id: int, stage_ids: list,
                        contract_type: str) -> None:
    """ربط دفعة القالب بمجموعة مراحل — كل مرحلة تتبع دفعة واحدة
    فقط (تُرفض إن كانت مربوطة بدفعة أخرى)."""
    conn.execute("DELETE FROM type_payment_stages WHERE payment_id=?",
                 (payment_id,))
    for sid in (stage_ids or []):
        st = conn.execute(
            "SELECT contract_type, transaction_type FROM "
            "workflow_stages WHERE id=?", (int(sid),)).fetchone()
        if st is None or st["transaction_type"] != TX_CONTRACT \
                or (st["contract_type"] or "") != contract_type:
            raise DatabaseError(
                "المراحل المرتبطة يجب أن تكون من قالب مراحل هذا النوع.")
        dup = conn.execute(
            "SELECT p.pay_no FROM type_payment_stages ps "
            "JOIN type_payment_tpl p ON p.id=ps.payment_id "
            "WHERE ps.stage_id=? AND p.id<>?",
            (int(sid), payment_id)).fetchone()
        if dup:
            raise DatabaseError(
                f"مرحلة «{stage_name_of(sid)}» مربوطة بالفعل بالدفعة "
                f"رقم {dup['pay_no']} — كل مرحلة تتبع دفعة واحدة فقط.")
        conn.execute(
            "INSERT INTO type_payment_stages (payment_id, stage_id) "
            "VALUES (?,?)", (payment_id, int(sid)))


_PAY_ORDINAL_UNITS = {
    1: "الأولى", 2: "الثانية", 3: "الثالثة", 4: "الرابعة", 5: "الخامسة",
    6: "السادسة", 7: "السابعة", 8: "الثامنة", 9: "التاسعة",
}
_PAY_ORDINAL_TEENS = {
    10: "العاشرة", 11: "الحادية عشرة", 12: "الثانية عشرة", 13: "الثالثة عشرة",
    14: "الرابعة عشرة", 15: "الخامسة عشرة", 16: "السادسة عشرة",
    17: "السابعة عشرة", 18: "الثامنة عشرة", 19: "التاسعة عشرة",
}
_PAY_ORDINAL_TENS = {
    20: "العشرون", 30: "الثلاثون", 40: "الأربعون", 50: "الخمسون",
    60: "الستون", 70: "السبعون", 80: "الثمانون", 90: "التسعون",
}
_PAY_ORDINAL_COMPOUND_UNITS = dict(_PAY_ORDINAL_UNITS)
_PAY_ORDINAL_COMPOUND_UNITS[1] = "الحادية"


_AUTO_PAY_NAME_RE = None


def _plan_title_for(seq: int, row: dict) -> str:
    """V5.4 ⑦: عنوان الدفعة المحفوظ — الرقم في الاسم يتبع الترقيم الجديد.

    كان العنوان يُبنى «<رقم متسلسل>. <اسم القالب>» فيبقى اسم القالب برقمه
    القديم (مثال: اختيار 3 من 6 ⇒ «1. دفعة 1 · 2. دفعة 3 · 3. دفعة 6»).
    الآن: الاسم التلقائي «دفعة N» يُعاد بناؤه بالرقم الجديد، والاسم الذي
    كتبه المستخدم بنفسه يبقى كما هو ويأخذ الرقم الجديد فقط.
    """
    core = auto_pay_core(int(seq), row.get("title") or "")
    return f"{int(seq)}. {core}"


_AUTO_PAY_ORDINALS: tuple = ()


def _auto_pay_patterns():
    """أنماط أسماء الدفعات الآلية: دفعة N · الدفعة N · الدفعة <ترتيب عربي>."""
    global _AUTO_PAY_NAME_RE, _AUTO_PAY_ORDINALS
    if _AUTO_PAY_NAME_RE is None:
        import re as _re
        _AUTO_PAY_ORDINALS = tuple(
            dict.fromkeys(
                list(_PAY_ORDINAL_UNITS.values())
                + list(_PAY_ORDINAL_TEENS.values())))
        _words = "|".join(_re.escape(w) for w in _AUTO_PAY_ORDINALS)
        _AUTO_PAY_NAME_RE = _re.compile(
            r"^(?:الدفعة\s*(?:[0-9]+|" + _words + r")"
            r"|دفعة\s*[0-9]+"
            r"|الدفعة\s*(?:[0-9]+|" + _words + r"))$")
    return _AUTO_PAY_NAME_RE


def auto_pay_core(seq: int, title: str) -> str:
    """V5.6: اسم الدفعة الأساسي بلا رقم — الأسماء الآلية تُعاد بناؤها.

    يشمل الآن الأسماء العربية الترتيبية التي يستعملها القالب افتراضيًا
    («الدفعة الخامسة») — كانت لا تُعاد بناؤها فيبقى اسم مرحلة/دفعة
    **تم تجاهلها** في العقد اليدوي (مثال: اختيار 4 من 5 ⇒ «4. الدفعة
    الخامسة»). الآن تصبح «4. الدفعة الرابعة» ويبقى اسم المستخدم كما هو.
    """
    import re as _re
    raw = (title or "").strip()
    raw = _re.sub(r"^[0-9]+\s*[.\-–]\s*", "", raw).strip()
    if not raw:
        return _payment_title(int(seq))
    # اسم الأمان النظامي ليس اسمًا كتبه المستخدم ⇒ يُبنى من جديد
    if raw == "دفعة كاملة عند بداية التعاقد":
        return _payment_title(int(seq))
    if _auto_pay_patterns().match(raw):
        if raw.startswith("دفعة"):
            return f"دفعة {int(seq)}"
        return _payment_title(int(seq))          # الدفعة <ترتيب جديد>
    return raw


def _payment_title(pay_no: int) -> str:
    """اسم الدفعة المعروض تلقائيًا من رقمها."""
    n = int(pay_no or 1)
    if n in _PAY_ORDINAL_UNITS:
        word = _PAY_ORDINAL_UNITS[n]
    elif n in _PAY_ORDINAL_TEENS:
        word = _PAY_ORDINAL_TEENS[n]
    elif n in _PAY_ORDINAL_TENS:
        word = _PAY_ORDINAL_TENS[n]
    elif 20 < n < 100:
        word = f"{_PAY_ORDINAL_COMPOUND_UNITS.get(n % 10, str(n % 10))} و{_PAY_ORDINAL_TENS.get((n // 10) * 10, str((n // 10) * 10))}"
    else:
        word = str(n)
    return f"الدفعة {word}"


def add_type_payment(contract_type: str, pay_no: int, title: str,
                     pct: float, stage_id: int | list | None = None,
                     days_offset: int | None = None,
                     trigger_stage_id: int | None = None,
                     amount_fixed: float = 0.0) -> int:
    """إضافة دفعة لقالب النوع — الدفعة تجمع مرحلة أو أكثر معًا
    والمرحلة الواحدة تتبع دفعة واحدة فقط.

    · stage_id: مرحلة واحدة أو قائمة مراحل (أو None = دفعة بالأيام).
    · trigger_stage_id: المرحلة المُحفِّزة — إنهاؤها فعليًا هو ما
      يستحق الدفعة (تخضع للتحقق). مفروضة تلقائيًا لو مرحلة واحدة.
    · amount_fixed > 0: مبلغ ثابت بدل النسبة.
    · الاستحقاق الافتراضي (تقديري): أقصى تاريخ متوقع لمراحلها —
      ويُستبدل بتاريخ الإنهاء الفعلي للمُحفِّزة عند حدوثه.
    """
    contract_type = _stage_scope(contract_type)
    pay_no = int(pay_no or 1)
    title = (title or "").strip() or _payment_title(pay_no)
    pct = float(pct or 0)
    amount_fixed = float(amount_fixed or 0)
    stage_ids = ([int(stage_id)] if isinstance(stage_id, int)
                 else [int(s) for s in (stage_id or [])])
    if trigger_stage_id is None and len(stage_ids) == 1:
        trigger_stage_id = stage_ids[0]     # مرحلة واحدة = هي المُحفِّزة
    trigger_stage_id = (int(trigger_stage_id)
                        if trigger_stage_id else None)
    _validate_payment_stages(contract_type, stage_ids, trigger_stage_id)
    if days_offset is None:
        days_offset = (stage_cumulative_days(contract_type,
                                             trigger_stage_id)
                       if trigger_stage_id else
                       max((stage_cumulative_days(contract_type, s)
                            for s in stage_ids), default=0))
    days_offset = int(days_offset)
    if not contract_type:
        raise DatabaseError("اختر نوع العقد أولاً.")
    if amount_fixed > 0:
        pct = 0.0
    elif pct < 0 or pct > 100:
        raise DatabaseError("نسبة الدفعة بين 0 و100 فقط، أو حدد مبلغًا ثابتًا.")
    if days_offset < 0:
        raise DatabaseError("الاستحقاق لا يكون سالبًا.")
    with get_connection() as conn:
        dup_no = conn.execute(
            "SELECT 1 FROM type_payment_tpl WHERE contract_type=? "
            "AND pay_no=?", (contract_type, pay_no)).fetchone()
        if dup_no:
            raise DatabaseError(f"رقم الدفعة {pay_no} مستخدم — اختر "
                                "رقمًا آخر.")
        primary = stage_ids[0] if stage_ids else None
        cur = conn.execute(
            "INSERT INTO type_payment_tpl (contract_type, pay_no, title, "
            "pct, amount_fixed, stage_id, trigger_stage_id, days_offset) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (contract_type, pay_no, title, pct, amount_fixed, primary,
             trigger_stage_id, days_offset))
        pid = int(cur.lastrowid)
        _set_payment_stages(conn, pid, stage_ids, contract_type)
        return pid


def update_type_payment(item_id: int, pay_no: int | None = None,
                        title: str | None = None, pct: float | None = None,
                        stage_id: int | None = 0,
                        days_offset: int | None = None,
                        trigger_stage_id: int | None = None,
                        amount_fixed: float | None = None) -> None:
    """تعديل دفعة في القالب · `None` = لا تغيّر · stage_id=[] يفك الربط.

    trigger_stage_id: المرحلة المُحفِّزة (من مراحل الدفعة) — 0 تفكها."""
    sets, params = [], []
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM type_payment_tpl WHERE id=?",
                           (item_id,)).fetchone()
    if row is None:
        raise DatabaseError("الدفعة غير موجودة.")
    ctype = row["contract_type"]
    if pay_no is not None:
        with get_connection() as conn:
            dup = conn.execute(
                "SELECT 1 FROM type_payment_tpl WHERE contract_type=? "
                "AND pay_no=? AND id<>?", (ctype, int(pay_no),
                                           item_id)).fetchone()
        if dup:
            raise DatabaseError(f"رقم الدفعة {pay_no} مستخدم.")
        sets.append("pay_no=?")
        params.append(int(pay_no))
    if title is not None:
        sets.append("title=?")
        params.append((title or "").strip() or _payment_title(pay_no or row["pay_no"]))
    if pct is not None:
        if not (0 <= float(pct) <= 100):
            raise DatabaseError("نسبة الدفعة بين 0 و100 فقط.")
        sets.append("pct=?")
        params.append(float(pct))
    new_stage_ids = None
    if stage_id is not None:
        # مجموعة مراحل (دفعة تجمع مرحلتين أو أكثر) أو قائمة فاضية للفك
        if isinstance(stage_id, (list, tuple)):
            sids = [int(s) for s in stage_id if s]
        else:
            sids = [int(stage_id)] if stage_id else []
        new_stage_ids = sids
        primary = sids[0] if sids else None
        sets.append("stage_id=?")
        params.append(primary)
    if amount_fixed is not None:
        if float(amount_fixed) < 0:
            raise DatabaseError("المبلغ الثابت لا يكون سالبًا.")
        sets.append("amount_fixed=?")
        params.append(float(amount_fixed))
        if float(amount_fixed) > 0 and pct is None:
            sets.append("pct=?")
            params.append(0.0)
    if trigger_stage_id is not None:
        trig = int(trigger_stage_id) if trigger_stage_id else None
        sets.append("trigger_stage_id=?")
        params.append(trig)
    if days_offset is not None:
        if int(days_offset) < 0:
            raise DatabaseError("الاستحقاق لا يكون سالبًا.")
        sets.append("days_offset=?")
        params.append(int(days_offset))
    if not sets:
        return
    params.append(item_id)
    with get_connection() as conn:
        conn.execute(
            f"UPDATE type_payment_tpl SET {', '.join(sets)} WHERE id=?",
            params)
    # تطبيق المجموعة والتحقق الموحد (بعد الحفظ المبدئي للأعمدة)
    if new_stage_ids is None:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT stage_id FROM type_payment_tpl WHERE id=?",
                (item_id,)).fetchone()
        cur_ids = []
        if row and row["stage_id"]:
            with get_connection() as conn:
                cur_ids = [int(r["stage_id"]) for r in conn.execute(
                    "SELECT stage_id FROM type_payment_stages WHERE "
                    "payment_id=?", (item_id,))]
            new_stage_ids = cur_ids or ([int(row["stage_id"])]
                                        if row["stage_id"] else [])
        else:
            new_stage_ids = []
    with get_connection() as conn:
        row = conn.execute(
            "SELECT trigger_stage_id FROM type_payment_tpl WHERE id=?",
            (item_id,)).fetchone()
        trig = int(row["trigger_stage_id"]) if row and row["trigger_stage_id"] else None
    _validate_payment_stages(ctype, new_stage_ids, trig)
    if stage_id is not None:
        with get_connection() as conn:
            _set_payment_stages(conn, item_id, new_stage_ids, ctype)


def delete_type_payment(item_id: int) -> None:
    """حذف دفعة من قالب النوع مع حذف روابط المراحل التابعة أولًا."""
    with get_connection() as conn:
        conn.execute("DELETE FROM type_payment_stages WHERE payment_id=?",
                     (item_id,))
        conn.execute("DELETE FROM type_payment_tpl WHERE id=?", (item_id,))


def stage_cumulative_days(contract_type: str, stage_id: int) -> int:
    """كم يومًا من بداية العقد حتى اكتمال مرحلة (تراكمي) — قيمة
    مقترحة لاستحقاق الدفعة المرتبطة بها."""
    total = 0
    for s in stage_path(TX_CONTRACT, contract_type):
        total += int(s.get("expected_days") or 0)
        if s["id"] == stage_id:
            return total
    return 0


def type_payments_total_pct(contract_type: str) -> float:
    return round(sum(float(p["pct"] or 0)
                     for p in type_payments(contract_type)), 2)


# ============================================================
# نظام مراحل التنفيذ — أزرار بدل السحب والإفلات + عداد أيام
#
# · العميل المحتمل يبدأ تلقائيًا في مرحلة «غير متعاقد» المقفولة.
# · عند توقيع العقد تُغلق مرحلة ما قبل التعاقد ويبدأ أول مرحلة
#   تنفيذ للعقد بتاريخ اليوم.
# · الانتقال بزر «إنهاء المرحلة» (أو «تخطي») — بلا سحب وإفلات:
#   تُغلق الجارية (end_date + is_skipped) وتُفتح التالية (start_date).
# ============================================================
def _days_between(d1: str, d2: str) -> int:
    """فرق الأيام بين تاريخين ISO (d1 - d2) · 0 عند الفشل."""
    try:
        from datetime import datetime
        a = datetime.strptime(str(d1)[:10], "%Y-%m-%d")
        b = datetime.strptime(str(d2)[:10], "%Y-%m-%d")
        return (a - b).days
    except Exception:
        return 0


def start_for_customer(customer_id: int,
                       user_id: int | None = None) -> int:
    """بدء متابعة العميل المحتمل في مرحلة «غير متعاقد» تلقائيًا.

    تُستدعى عند إنشاء عميل جديد — آمنة عند التكرار.
    """
    current = get_current_stage(TX_CUSTOMER, customer_id)
    if current:
        return 0
    with get_connection() as conn:
        pre = conn.execute(
            "SELECT id FROM workflow_stages WHERE transaction_type=? "
            "AND is_pre_contract=1 ORDER BY stage_order LIMIT 1",
            (TX_CUSTOMER,)).fetchone()
    if not pre:
        return 0
    return _start_at(TX_CUSTOMER, customer_id, int(pre["id"]), user_id)


def _start_at(transaction_type: str, transaction_id: int, stage_id: int,
              user_id: int | None = None, start_day: str = "") -> int:
    """فتح مرحلة بعينها (تُستخدم داخليًا وفي الترحيل)."""
    uid = _uid(user_id)
    auto_add_participant(uid, transaction_type, transaction_id)
    with get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO transaction_stage_log (transaction_type, "
            "transaction_id, stage_id, moved_by, note, start_date) "
            "VALUES (?, ?, ?, ?, 'بداية المتابعة', ?)",
            (transaction_type, transaction_id, stage_id, uid,
             start_day or date.today().isoformat()))
        return int(cur.lastrowid)


def on_contract_signed(contract_id: int, customer_id: int | None = None,
                       user_id: int | None = None,
                       skip_payments: bool = False) -> int:
    """توقيع عقد (Template-Based): Snapshot كامل من قالب نوع العقد —
    شجرة مراحله بإعدادها المالي تُنسخ نسخة مستقلة للعقد (تعديل القالب
    لاحقًا لا يمس العقود القديمة)، وتتولد خطة السداد من إعداد المراحل:
    المقدمة تستحق فور التوقيع، وعند-الإنجاز تستحق بإنهاء مرحلتها."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT customer_id, contract_type, amount, "
            "COALESCE(NULLIF(start_date,''), NULLIF(contract_date,'')) "
            "AS d FROM contracts WHERE id=?", (contract_id,)).fetchone()
    if row is None:
        return 0
    customer_id = customer_id if customer_id is not None \
        else row["customer_id"]
    ctype = (row["contract_type"] or "").strip()
    amount = float(row["amount"] or 0)
    start_day = (row["d"] or date.today().isoformat())
    # 1) إغلاق مرحلة ما قبل التعاقد للعميل (إن كانت جارية)
    if customer_id:
        cur = get_current_stage(TX_CUSTOMER, customer_id)
        if cur and not (cur.get("end_date") or ""):
            with get_connection() as conn:
                conn.execute(
                    "UPDATE transaction_stage_log SET end_date=? "
                    "WHERE transaction_type=? AND transaction_id=? "
                    "AND (end_date IS NULL OR end_date='')",
                    (date.today().isoformat(), TX_CUSTOMER, customer_id))
    # 2) Snapshot: نسخ شجرة قالب النوع للعقد (مرة واحدة فقط)
    if get_contract_stages(contract_id):
        return 0
    _build_contract_snapshot(contract_id, ctype, start_day)
    # 3) توليد خطة السداد من قالب دفعات النوع أولًا؛ لأنه القالب
    #    الصريح الذي يديره المستخدم في «مراحل ودفعات نوع العقد».
    #    إن لم توجد دفعات صريحة، نُبقي دعم القالب القديم المعتمد على
    #    إعدادات الدفع داخل المراحل نفسها.
    payments = 0
    if not skip_payments:
        payments = _generate_type_payments_from_template(
            contract_id, ctype, amount, start_day)
        if payments == 0 and not type_payments(ctype):
            payments = _generate_payments_from_snapshot(
                contract_id, amount, start_day)
        if payments == 0:
            payments = _ensure_single_full_contract_payment(
                contract_id, amount, start_day)
    # 4) تعليق تلقائي في ملف العميل بماذا تم
    steps = [s for s in get_contract_stages(contract_id)
             if s["level"] == 1]
    first_open = next((s for s in steps
                       if s["start_date"] and not s["end_date"]), None)
    _auto_comment(
        customer_id, contract_id,
        "تم إنشاء العقد بنسخة قالب مراحله ودفعاته"
        + (f" — وبدأت مرحلة «{first_open['name']}»"
           if first_open else "")
        + (f" — وتولّدت خطة سداد من {payments} دفعة"
           if payments else "")
        + (" — بلا خطة سداد" if skip_payments else ""))
    return 1


def schedule_impact(contract_id: int) -> dict:
    """V2.50: أثر تغيير النوع قبل التنفيذ (للرسالة التأكيدية)."""
    with get_connection() as conn:
        plan = conn.execute(
            "SELECT COUNT(*) FROM payment_plan WHERE contract_id=?",
            (contract_id,)).fetchone()[0]
        stages = conn.execute(
            "SELECT COUNT(*) FROM contract_stages WHERE contract_id=?",
            (contract_id,)).fetchone()[0]
        vouchers = conn.execute(
            "SELECT COUNT(*) FROM vouchers WHERE contract_id=? "
            "AND COALESCE(cancelled,0)=0", (contract_id,)).fetchone()[0]
    return {"plan": plan, "stages": stages, "vouchers": vouchers}


def rebuild_contract_schedule(contract_id: int, old_type: str = "") -> dict:
    """V2.50 (البند 3): إعادة بناء المراحل والدفعات بعد تغيير النوع.

    يقرأ النوع الجديد من العقد نفسه. السندات لا تُحذف أبدًا (مربوطة
    برقم العقد وتبقى عليه) — تُحذف نسخة المراحل وخطة السداد فقط ثم
    تُبنى من قالب النوع الجديد. يرجع تقرير قبل/بعد.
    """
    with get_connection() as conn:
        c = conn.execute(
            "SELECT customer_id, contract_type, amount, "
            "COALESCE(NULLIF(start_date,''), NULLIF(contract_date,'')) AS d "
            "FROM contracts WHERE id=?", (contract_id,)).fetchone()
        if c is None:
            raise ValueError("العقد غير موجود.")
        old_plan = [dict(r) for r in conn.execute(
            "SELECT title, due_date, amount FROM payment_plan "
            "WHERE contract_id=? ORDER BY sort_order, id",
            (contract_id,)).fetchall()]
        old_stages = conn.execute(
            "SELECT COUNT(*) FROM contract_stages WHERE contract_id=?",
            (contract_id,)).fetchone()[0]
        vouchers = conn.execute(
            "SELECT COUNT(*) FROM vouchers WHERE contract_id=? "
            "AND COALESCE(cancelled,0)=0", (contract_id,)).fetchone()[0]
        conn.execute("DELETE FROM payment_plan WHERE contract_id=?",
                     (contract_id,))
        conn.execute("DELETE FROM contract_stages WHERE contract_id=?",
                     (contract_id,))
    new_type = (c["contract_type"] or "").strip()
    start_day = c["d"] or date.today().isoformat()
    # V3.30: النوع الجديد شامل بلا لقطة ← تهيئة من افتراضياته.
    try:
        from services import contract_service as _cs
        _cs.seed_contract_components(contract_id, new_type)
    except Exception:
        pass
    _build_contract_snapshot(contract_id, new_type, start_day)
    made = _generate_type_payments_from_template(
        contract_id, new_type, float(c["amount"] or 0), start_day)
    if made == 0 and not type_payments(new_type):
        made = _generate_payments_from_snapshot(
            contract_id, float(c["amount"] or 0), start_day)
    if made == 0:
        made = _ensure_single_full_contract_payment(
            contract_id, float(c["amount"] or 0), start_day)
    with get_connection() as conn:
        new_plan = [dict(r) for r in conn.execute(
            "SELECT title, due_date, amount FROM payment_plan "
            "WHERE contract_id=? ORDER BY sort_order, id",
            (contract_id,)).fetchall()]
        new_stages = conn.execute(
            "SELECT COUNT(*) FROM contract_stages WHERE contract_id=?",
            (contract_id,)).fetchone()[0]
    _auto_comment(
        c["customer_id"], contract_id,
        "أُعيد بناء المراحل والدفعات بعد تغيير النوع"
        + (f" من «{old_type}»" if (old_type or "").strip() else "")
        + f" إلى «{new_type}»: {new_stages} مرحلة و{len(new_plan)} دفعة"
        + f" — بقيت {vouchers} سندات مربوطة بالعقد")
    return {"old_type": (old_type or "").strip(), "new_type": new_type,
            "old_plan": old_plan, "new_plan": new_plan,
            "old_stages": old_stages, "new_stages": new_stages,
            "vouchers_kept": vouchers}


def _compute_plan_sync(contract_id: int,
                     amount: float | None = None) -> dict:
    """V3.11/دفعة 2: طور الحساب المشترك للمزامنة والمعاينة (قراءة فقط).

    يطابق الفعلي بالقالب (sort_order==pay_no، الأول يفوز) ويبني قائمة
    الإجراءات + محاكاة دقيقة للنتيجة — بلا أي كتابة. يرجع:
    {"rep": <نفس شكل تقرير sync مع after_* مُحاكاة ومفتاح "changed">,
     "actions": [("update"|"update_lite"|"insert"|"delete", params), ...],
     "customer_id": ...}
    """
    with get_connection() as conn:
        c = conn.execute(
            "SELECT customer_id, contract_type, amount, "
            "COALESCE(NULLIF(start_date,''), NULLIF(contract_date,'')) AS d "
            "FROM contracts WHERE id=?", (contract_id,)).fetchone()
        if c is None:
            raise ValueError("العقد غير موجود.")
        actual = [dict(r) for r in conn.execute(
            "SELECT * FROM payment_plan WHERE contract_id=? "
            "ORDER BY sort_order, id", (contract_id,)).fetchall()]
    ctype = (c["contract_type"] or "").strip()
    value = float(amount) if amount is not None else float(c["amount"] or 0)
    preview = type_payment_preview(ctype, value)
    before_n = len(actual)
    before_total = round(sum(float(r.get("amount") or 0) for r in actual), 3)
    rep: dict = {"status": "synced", "contract_id": contract_id,
                 "type": ctype, "before_count": before_n,
                 "before_total": before_total, "after_count": 0,
                 "after_total": 0.0, "updated": [], "inserted": [],
                 "deleted": [], "overridden_kept": [], "flexible_kept": [],
                 "triggered_kept": [], "renamed": [], "changed": False}
    actions: list = []
    comp = {"rep": rep, "actions": actions,
            "customer_id": c["customer_id"]}
    if not preview["payments"]:
        rep["status"] = "no_template"
        rep["after_count"] = before_n
        rep["after_total"] = before_total
        return comp
    start_day = c["d"] or date.today().isoformat()
    base = date.fromisoformat(start_day)
    stage_map = _template_to_contract_stage_map(contract_id, ctype)
    # V4.5.10: الترقيم المتسلسل بعد النطاق (1..n) — نفس قاعدة التوليد.
    _scoped = bool(get_contract_scope(contract_id))
    tpl_rows = renumber_plan_rows(preview["rows"],
                                  set(stage_map) if _scoped else None)
    # إعادة ترميز صفوف العقد القائمة إلى الترقيم الجديد حتى تُطابَق
    # صفوفها الحالية (عقود سبقت الترقيم: 1,2,4,5 ← 1,2,3,4) بلا حذف
    # أو إعادة إنشاء تحافظ على المعرّفات والمطالبات المرتبطة.
    _tpl_by_old = {int(k["tpl_pay_no"]): k for k in tpl_rows}
    _tpl_by_stage: dict[int, list] = {}
    for k in tpl_rows:
        _tt = k.get("trigger_stage_id")
        _sid = stage_map.get(int(_tt)) if _tt else None
        if _sid:
            _tpl_by_stage.setdefault(int(_sid), []).append(k)
    old_to_new: dict[int, int] = {}
    _taken: set[int] = set()
    for r in actual:
        k = _tpl_by_old.get(int(r.get("sort_order") or 0))
        if k is not None and int(k["pay_no"]) not in _taken:
            old_to_new[int(r["id"])] = int(k["pay_no"])
            _taken.add(int(k["pay_no"]))
    for r in actual:
        if int(r["id"]) in old_to_new:
            continue
        _sid = int(r.get("stage_id") or 0)
        if not _sid:
            continue
        for k in _tpl_by_stage.get(_sid, []):
            if int(k["pay_no"]) in _taken:
                continue
            old_to_new[int(r["id"])] = int(k["pay_no"])
            _taken.add(int(k["pay_no"]))
            break
    by_no: dict[int, list] = {}
    for r in actual:
        _no = old_to_new.get(int(r["id"]), int(r.get("sort_order") or 0))
        by_no.setdefault(int(_no), []).append(r)
    # محاكاة المبالغ النهائية لحساب after_* بدقة (المعاينة = التنفيذ).
    final: dict[int, float] = {
        int(r["id"]): round(float(r.get("amount") or 0), 3)
        for r in actual}
    _next_new = -1
    tpl_nos = {int(row["pay_no"]) for row in tpl_rows}
    for row in tpl_rows:
        no = int(row["pay_no"])
        pay_amount = round(float(row.get("amount") or 0), 3)
        cands = by_no.get(no, [])
        if pay_amount <= 0:
            # V5.6 ②: الصف المرن لا تُلمس مبالغه، لكن **اسمه الآلي** يُصحَّح
            # إن كان يحمل رقم دفعة متجاهَلة (4. الدفعة الخامسة ⇒ الرابعة)،
            # وأساس الاسم عنوان الصف الفعلي فلا يُدهس اسم كتبه المستخدم.
            if cands:
                _want_title = _plan_title_for(
                    no, {"title": (cands[0].get("title") or "")
                         or (row.get("title") or "")})
            for x in cands:
                if (x.get("title") or "").strip() != _want_title:
                    actions.append(("rename", (_want_title, int(x["id"]))))
                    rep["renamed"].append(int(x["id"]))
                    rep["changed"] = True
            rep["flexible_kept"].extend(x["id"] for x in cands)
            by_no[no] = []
            continue
        due = (base + timedelta(
            days=int(row.get("days_offset") or 0))).isoformat()
        trig = row.get("trigger_stage_id")
        snap = stage_map.get(int(trig)) if trig else None
        # V5.6 ②: أساس الاسم هو عنوان الصف **الفعلي** إن وُجد — فيُصحَّح
        # الاسم الآلي («الخامسة» ⇒ «الرابعة») ويبقى اسم المستخدم كما هو.
        title = _plan_title_for(
            no, {"title": (cands[0].get("title") if cands else "") or ""}
            if cands else row)
        if row.get("mode") == "percent":
            value_note = (f"نسبة {float(row.get('pct') or 0):g}% "
                          "من قيمة العقد")
        else:
            value_note = f"مبلغ يدوي {pay_amount:,.3f} د.ك"
        trig_name = (row.get("trigger_name") or row.get("stage_name")
                     or "—")
        if snap:
            note = (f"استحقاق تقديري — فعليًا عن مرحلة "
                    f"«{trig_name}» · {value_note}")
        else:
            note = (f"دفعة بالأيام — بعد {int(row.get('days_offset') or 0)} "
                    f"يومًا من التوقيع · {value_note}")
        if cands:
            first, *dups = cands
            if int(first.get("manual_amount") or 0):
                actions.append(
                    ("update_lite", (title, snap, no, first["id"])))
                rep["overridden_kept"].append(first["id"])
            elif (first.get("triggered_at") or ""):
                actions.append(
                    ("update_lite", (title, snap, no, first["id"])))
                rep["triggered_kept"].append(first["id"])
            else:
                actions.append(
                    ("update",
                     (title, due, pay_amount, no, snap, note,
                      first["id"])))
                rep["updated"].append(first["id"])
                if abs(final.get(int(first["id"]), 0.0)
                       - pay_amount) > 0.001:
                    rep["changed"] = True
                final[int(first["id"])] = pay_amount
            for d in dups:
                if (d.get("triggered_at") or ""):
                    rep["triggered_kept"].append(d["id"])
                else:
                    actions.append(("delete", (d["id"],)))
                    rep["deleted"].append(d["id"])
                    final.pop(int(d["id"]), None)
                    rep["changed"] = True
            by_no[no] = []
        else:
            actions.append(
                ("insert", (contract_id, title, due, pay_amount, no,
                            snap, note, "")))
            final[_next_new] = pay_amount
            _next_new -= 1
            rep["changed"] = True
    for no, rows_ in by_no.items():
        if no in tpl_nos:
            continue
        for r in rows_:
            if (r.get("triggered_at") or ""):
                rep["triggered_kept"].append(r["id"])
            else:
                actions.append(("delete", (r["id"],)))
                rep["deleted"].append(r["id"])
                final.pop(int(r["id"]), None)
                rep["changed"] = True
    rep["after_count"] = len(final)
    rep["after_total"] = round(sum(final.values()), 3)
    return comp


def sync_plan_from_template(contract_id: int) -> dict:
    """V3.11: مزامنة خطة سداد عقد من قالب دفعات نوعه.

    المصدر الوحيد هو معاينة القالب الموحدة (نفس ما تعرضه الشاشات).
    - صف قالب بمبلغ>0: تحديث الصف المطابق (sort_order==pay_no، الأول
      يفوز) أو إدخال الناقص. صفوف المبالغ اليدوية (manual_amount) تُحفَظ
      مبالغها (عنوان وربط مرحلة فقط)، وصفوف المرنة (مبلغ صفر) تُترَك.
    - الزوائد (مكرر sort_order أو خارج القالب): تُحذَف ما لم تكن مستحقة
      فعلًا (triggered_at) فتُترَك وتُذكَر في التقرير.
    - المراحل (contract_stages) لا تُمسّ — والسندات مربوطة برقم العقد
      لا بالصف (كسابقة إعادة البناء) فلا تتأثر.
    بلا قالب دفعات صريح: status=no_template وبلا أي تغيير.
    الحساب في _compute_plan_sync (مشترك مع preview_plan_sync).
    """
    comp = _compute_plan_sync(contract_id)
    rep = comp["rep"]
    if rep["status"] == "no_template":
        return rep
    with get_connection() as conn:
        for kind, params in comp["actions"]:
            if kind == "update":
                conn.execute(
                    "UPDATE payment_plan SET title=?, due_date=?, "
                    "amount=?, sort_order=?, stage_id=?, notes=? "
                    "WHERE id=?",
                    params)
            elif kind == "update_lite":
                conn.execute(
                    "UPDATE payment_plan SET title=?, stage_id=?, "
                    "sort_order=? WHERE id=?", params)
            elif kind == "rename":      # V5.6: تصحيح الاسم الآلي فقط
                conn.execute(
                    "UPDATE payment_plan SET title=? WHERE id=?", params)
            elif kind == "insert":
                cur = conn.execute(
                    "INSERT INTO payment_plan (contract_id, title, "
                    "due_date, amount, sort_order, stage_id, notes, "
                    "triggered_at, manual_amount) "
                    "VALUES (?,?,?,?,?,?,?,?,0)",
                    params)
                rep["inserted"].append(int(cur.lastrowid))
            elif kind == "delete":
                conn.execute("DELETE FROM payment_plan WHERE id=?",
                             params)
        after = conn.execute(
            "SELECT COUNT(*), COALESCE(SUM(amount),0) FROM payment_plan "
            "WHERE contract_id=?", (contract_id,)).fetchone()
    rep["after_count"] = int(after[0] or 0)
    rep["after_total"] = round(float(after[1] or 0), 3)
    try:
        _auto_comment(
            comp["customer_id"], contract_id,
            f"زُامنت خطة السداد من قالب «{rep['type']}»: قبل "
            f"{rep['before_count']} دفعات ({rep['before_total']:,.3f}) ← "
            f"بعد {rep['after_count']} دفعات ({rep['after_total']:,.3f})")
    except Exception:
        pass
    return rep


# ============================================================
# V3.24: تطبيق الطابع الإشرافي للقالب على العقود القائمة
# ============================================================
def _sup_template_map(contract_type: str) -> dict:
    """مراحل التنفيذ الإشرافية في قالب النوع {الاسم: (العلم، القيمة)}.

    الرئيسية التجميعية (لها أبناء) عنوان فقط — تُستبعد.
    """
    stages = get_stages(TX_CONTRACT, contract_type)
    parents = {s.get("parent_id") for s in stages if s.get("parent_id")}
    out = {}
    for s in stages:
        if s["id"] in parents:
            continue
        if int(s.get("is_supervision") or 0):
            name = (s["stage_name"] or "").strip()
            if name:
                out[name] = (1, float(s.get("sup_monthly") or 0))
    return out


def preview_supervision_sync(contract_type: str) -> dict:
    """معاينة تطبيق الطابع على عقود النوع — قراءة فقط."""
    scope = _stage_scope(contract_type)
    tpl = _sup_template_map(scope)
    rep = {"scope": scope, "template_count": len(tpl), "contracts": [],
           "contracts_count": 0, "matched": 0, "already": 0,
           "skipped_cancelled": 0}
    if not tpl:
        return rep
    with get_connection() as conn:
        cons = conn.execute(
            "SELECT id, contract_number, status, "
            "COALESCE(NULLIF(TRIM(contract_type),''), 'غير محدد') AS scope "
            "FROM contracts ORDER BY id").fetchall()
        for c in cons:
            if (c["scope"] or "") != scope:
                continue
            if (c["status"] or "") == "ملغى":
                rep["skipped_cancelled"] += 1
                continue
            rows = conn.execute(
                "SELECT name, COALESCE(is_supervision,0) AS sup "
                "FROM contract_stages WHERE contract_id=?", (c["id"],)).fetchall()
            new, old = [], 0
            for r in rows:
                n = (r["name"] or "").strip()
                if n not in tpl:
                    continue
                if int(r["sup"]):
                    old += 1
                else:
                    new.append(n)
            if new:
                rep["contracts"].append({
                    "id": int(c["id"]),
                    "contract_number": c["contract_number"] or "",
                    "stages": new})
                rep["matched"] += len(new)
            rep["already"] += old
    rep["contracts_count"] = len(rep["contracts"])
    return rep


def apply_supervision_sync(contract_type: str) -> dict:
    """تطبيق الطابع على عقود النوع — يضيف فقط ولا يمحو يدويًا.

    ينسخ العلم + قيمة الشهر الافتراضية (إن كانت قيمة المرحلة
    صفرًا) — ولا يمسّ أي تقدم أو تواريخ. الملغيّة تُتجاهل.
    """
    scope = _stage_scope(contract_type)
    tpl = _sup_template_map(scope)
    rep = {"scope": scope, "contracts": 0, "stages": 0,
           "skipped_cancelled": 0}
    if not tpl:
        return rep
    from services import lifecycle_service as lc
    with get_connection() as conn:
        cons = conn.execute(
            "SELECT id, status, "
            "COALESCE(NULLIF(TRIM(contract_type),''), 'غير محدد') AS scope "
            "FROM contracts ORDER BY id").fetchall()
        for c in cons:
            if (c["scope"] or "") != scope:
                continue
            if (c["status"] or "") == "ملغى":
                rep["skipped_cancelled"] += 1
                continue
            rows = conn.execute(
                "SELECT id, name, COALESCE(sup_monthly,0) AS m "
                "FROM contract_stages WHERE contract_id=? "
                "AND COALESCE(is_supervision,0)=0", (c["id"],)).fetchall()
            touched = []
            for r in rows:
                n = (r["name"] or "").strip()
                if n not in tpl:
                    continue
                _mv = tpl[n][1]
                if float(r["m"] or 0) > 0:
                    conn.execute(
                        "UPDATE contract_stages SET is_supervision=1 "
                        "WHERE id=?", (r["id"],))
                else:
                    conn.execute(
                        "UPDATE contract_stages SET is_supervision=1, "
                        "sup_monthly=? WHERE id=?", (_mv, r["id"]))
                touched.append(n)
            if touched:
                rep["contracts"] += 1
                rep["stages"] += len(touched)
                try:
                    lc.log_event(int(c["id"]), "تطبيق الطابع الإشرافي",
                                 f"من قالب «{scope}»: {', '.join(touched)}")
                except Exception:
                    pass
    return rep


# V3.28: سحب المراحل الناقصة من قالب النوع إلى نسخة العقد
# ================================================================
def template_has_supervision(contract_type: str) -> bool:
    """هل قالب النوع فيه مراحل إشرافية تنفيذية؟

    تُستخدم لتضييق ظهور زر الطابع: يُعرض فقط عند الحاجة.
    """
    try:
        return bool(_sup_template_map(_stage_scope(contract_type or "")))
    except Exception:
        return False


def _compute_missing_pull(contract_id: int) -> dict:
    """حساب دمج المراحل الناقصة — قراءة فقط (المعاينة والتنفيذ معًا).

    القواعد:
      • المطابقة بالاسم بعد التقليم (مثل مزامنة الطابع V3.24).
      • كل مرحلة قالب غائبة عن النسخة تُدرج بموضعها النسبي في القالب:
        قبل أول مرحلة لاحقة لها في القالب موجودة في النسخة، وإلا
        تُلحق بالنهاية (بترتيب القالب بين المُدرجات).
      • مراحل النسخة ذات الأسماء غير الموجودة في القالب (مُعادة تسمية
        أو محذوفة من القالب) تُترك في مواضعها ولا تُمس.
      • التثبيت بعد التقدم: مُدرجة كان موضعها عند الجارية أو قبلها
        تنتقل بعد الجارية مباشرة (تُذكر في clamped) — حتى لا تُدفن
        مرحلة مستقبلية خلف التقدم فلا تُفتح أبدًا.
      • لا مساس بأي تقدم أو تواريخ أو خطة دفع — إدخال صفوف فقط.
    """
    with get_connection() as conn:
        c = conn.execute(
            "SELECT contract_type FROM contracts WHERE id=?",
            (contract_id,)).fetchone()
    scope = _stage_scope((c["contract_type"] or "") if c else "")
    tpl = get_stages(TX_CONTRACT, scope)
    snap = get_contract_stages(contract_id)
    tpl_idx = {}
    for i, t in enumerate(tpl):
        tpl_idx.setdefault((t.get("stage_name") or "").strip(), i)
    snap_names = {(s["name"] or "").strip() for s in snap}
    # V3.30: الشامل — لا سحب لمراحل مكوّن مطفأ (فعّله أولًا).
    _enabled = _enabled_bundle_keys(contract_id, scope)

    def _tag_ok(t) -> bool:
        _ck = (t.get("component_key") or "").strip()
        return not _ck or _enabled is None or _ck in _enabled

    missing = [t for t in tpl
               if (t.get("stage_name") or "").strip() not in snap_names
               and _tag_ok(t)]
    mains = {s["id"]: s for s in tpl if not s.get("parent_id")}
    parents_with_kids = {s["parent_id"] for s in tpl
                         if s.get("parent_id")}

    def _snap_level(t):
        if t.get("parent_id"):
            _m = mains.get(t["parent_id"]) or {}
            return 1, (_m.get("stage_name") or "")
        if t["id"] in parents_with_kids:
            return 0, ""
        return 1, ""

    # الترتيب النهائي: النسخة + المُدرجات بمواضع القالب
    final = [{"kind": "old", "row": s,
              "tidx": tpl_idx.get((s["name"] or "").strip())}
             for s in snap]
    for t in missing:
        _ti = tpl.index(t)
        _pos = next(
            (i for i, e in enumerate(final)
             if e.get("tidx") is not None and e["tidx"] > _ti),
            len(final))
        final.insert(_pos, {"kind": "new", "tpl": t, "tidx": _ti,
                            "after": (final[_pos - 1]["row"]["name"]
                                      if _pos > 0 and
                                      final[_pos - 1]["kind"] == "old"
                                      else (final[_pos - 1]["tpl"]
                                            .get("stage_name", "")
                                            if _pos > 0 else "بداية المسار"))})
    # الجارية من النسخة (أول خطوة بدأت ولم تُقفل)
    cur_id = next(
        (e["row"]["id"] for e in final
         if e["kind"] == "old" and e["row"]["level"] == 1
         and e["row"]["start_date"] and not e["row"]["end_date"]),
        None)
    clamped = []
    if cur_id is not None:
        _ci = next(i for i, e in enumerate(final)
                   if e["kind"] == "old" and e["row"]["id"] == cur_id)
        _stuck = [e for e in final[:_ci + 1] if e["kind"] == "new"]
        if _stuck:
            final = [e for e in final if e not in _stuck]
            _ci = next(i for i, e in enumerate(final)
                       if e["kind"] == "old"
                       and e["row"]["id"] == cur_id)
            for j, e in enumerate(_stuck):
                final.insert(_ci + 1 + j, e)
            for e in _stuck:
                _nm = (e["tpl"].get("stage_name") or "").strip()
                clamped.append(_nm)
                e["after"] = next(
                    (x["row"]["name"] for x in reversed(final[:final.index(e)])
                     if x["kind"] == "old"),
                    next((x["tpl"].get("stage_name", "")
                          for x in reversed(final[:final.index(e)])
                          if x["kind"] == "new"), "بداية المسار"))
    cur_name = next(
        (e["row"]["name"] for e in final
         if e["kind"] == "old" and e["row"]["id"] == cur_id), None)
    new_steps = [e for e in final
                 if e["kind"] == "new" and _snap_level(e["tpl"])[0] == 1]
    reopen = cur_id is None and bool(new_steps)
    opener = new_steps[0] if reopen else None
    entries = []
    for e in final:
        if e["kind"] != "new":
            continue
        _t = e["tpl"]
        _lvl, _ = _snap_level(_t)
        entries.append({
            "name": (_t.get("stage_name") or "").strip(),
            "level": _lvl,
            "is_supervision": bool(_t.get("is_supervision")),
            "sup_monthly": float(_t.get("sup_monthly") or 0),
            "pay_pct": float(_t.get("payment_pct") or 0),
            "pay_kind": (_t.get("pay_kind") or "").strip(),
            "after": e.get("after") or "بداية المسار",
            "clamped": (_t.get("stage_name") or "").strip() in clamped,
        })
    return {"scope": scope, "snapshot_count": len(snap),
            "template_count": len(tpl), "current": cur_name,
            "missing": entries, "clamped": clamped, "reopen": reopen,
            "final": final, "opener": opener, "snap_level": _snap_level}


def preview_missing_stages(contract_id: int) -> dict:
    """V3.28: معاينة سحب المراحل الناقصة من القالب (قراءة فقط)."""
    comp = _compute_missing_pull(contract_id)
    return {"scope": comp["scope"],
            "snapshot_count": comp["snapshot_count"],
            "template_count": comp["template_count"],
            "current": comp["current"], "missing": comp["missing"],
            "clamped": comp["clamped"], "reopen": comp["reopen"]}


def pull_missing_stages(contract_id: int, user_id: int | None = None) -> dict:
    """V3.28: إدراج المراحل الناقصة من القالب في نسخة العقد.

    إدخال صفوف مستقبلية فقط (بلا start/end) — لا يمس أي تقدم أو تواريخ
    أو خطة دفع قائمة. عند اكتمال المسار سابقًا تُفتح أول مُدرجة
    (إعادة فتح) بتاريخ اليوم وتُسجل في الأحداث.
    """
    _ensure_contract_stage_not_frozen(contract_id)
    comp = _compute_missing_pull(contract_id)
    if not comp["missing"]:
        return {"inserted": [], "reopened": None, "scope": comp["scope"],
                "clamped": []}
    _lvl_of = comp["snap_level"]
    who = auth_service.display_name()
    today = date.today().isoformat()
    with get_connection() as conn:
        for e in comp["final"]:
            if e["kind"] != "new":
                continue
            _t = e["tpl"]
            _lvl, _pname = _lvl_of(_t)
            _cur = conn.execute(
                "INSERT INTO contract_stages (contract_id, name, level, "
                "parent_name, expected_days, pay_pct, pay_kind, "
                "sort_order, start_date, end_date, closed_by, "
                "is_supervision, sup_monthly) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (contract_id, (_t.get("stage_name") or "").strip(),
                 _lvl, _pname, int(_t.get("expected_days") or 0),
                 float(_t.get("payment_pct") or 0),
                 (_t.get("pay_kind") or "").strip(), 0, "", "", "",
                 1 if _t.get("is_supervision") else 0,
                 float(_t.get("sup_monthly") or 0)))
            e["new_id"] = _cur.lastrowid
        for i, e in enumerate(comp["final"], 1):
            _rid = (e["new_id"] if e["kind"] == "new"
                    else e["row"]["id"])
            conn.execute("UPDATE contract_stages SET sort_order=? "
                         "WHERE id=?", (i, _rid))
        reopened = None
        if comp["opener"] is not None:
            _op = comp["opener"]
            conn.execute("UPDATE contract_stages SET start_date=?, "
                         "closed_by=? WHERE id=?",
                         (today, who, _op["new_id"]))
            reopened = (_op["tpl"].get("stage_name") or "").strip()
    try:
        from services import lifecycle_service as lc
        lc.log_event(contract_id, "سحب مراحل من القالب",
                     f"من قالب «{comp['scope']}»: "
                     f"{', '.join(m['name'] for m in comp['missing'])}")
        if reopened:
            lc.log_event(contract_id, "إعادة فتح المسار",
                         f"على «{reopened}» بعد سحب مراحل من القالب")
    except Exception:
        pass
    return {"inserted": [m["name"] for m in comp["missing"]],
            "reopened": reopened, "scope": comp["scope"],
            "clamped": comp["clamped"]}


def preview_plan_sync(contract_id: int,
                      amount: float | None = None) -> dict:
    """V3.11/دفعة 2: معاينة المزامنة قبل الحفظ (قراءة فقط — بلا كتابة).

    نفس حساب sync_plan_from_template تمامًا (after_* مُحاكاة بدقة).
    amount اختياري لتقييم قيمة جديدة قبل حفظها. مفتاح "changed" يعني
    فرقًا ماديًا (عدد/مجموع/مبلغ) يستحق التأكيد والنسخة الاحتياطية.
    """
    comp = _compute_plan_sync(contract_id, amount=amount)
    rep = dict(comp["rep"])
    kinds = [k for k, _p in comp["actions"]]
    rep["inserted_count"] = sum(1 for k in kinds if k == "insert")
    rep["updated_count"] = sum(1 for k in kinds if k == "update")
    rep["deleted_count"] = sum(1 for k in kinds if k == "delete")
    return rep


def _enabled_bundle_keys(contract_id: int,
                         contract_type: str) -> set[str] | None:
    """V3.30: مفاتيح مكوّنات الشامل المفعّلة للعقد · None لغير الشامل.

    بلا لقطة (مسار قديم) ← افتراضيات النوع.
    """
    try:
        from services import contract_type_service as _cts
        if not _cts.type_config(contract_type).get("is_bundle"):
            return None
    except Exception:
        return None
    with get_connection() as conn:
        try:
            rows = conn.execute(
                "SELECT comp_key, enabled FROM contract_components "
                "WHERE contract_id=?", (contract_id,)).fetchall()
        except Exception:
            return None
    if not rows:
        try:
            return {t["comp_key"]
                    for t in _cts.list_bundle_components(contract_type)
                    if t.get("default_enabled")}
        except Exception:
            return None
    return {(r["comp_key"] or "").strip() for r in rows if r["enabled"]}


def set_contract_scope(contract_id: int, template_stage_ids) -> int:
    """V4.48: حفظ نطاق العقد (مراحل القالب المختارة) — يُحفظ قبل التوقيع.

    فارغ/None = القالب كاملًا (بلا تصفية). يُستخدم مرة واحدة عند الإنشاء؛
    التوسعة اللاحقة عبر «سحب الناقص من القالب» القائم.
    """
    want = sorted({int(x) for x in (template_stage_ids or []) if x})
    with get_connection() as conn:
        conn.execute("DELETE FROM contract_scope WHERE contract_id=?",
                     (contract_id,))
        for tid in want:
            conn.execute(
                "INSERT OR IGNORE INTO contract_scope (contract_id,"
                " template_stage_id) VALUES (?,?)", (contract_id, tid))
    return len(want)


def get_contract_scope(contract_id: int) -> set[int]:
    """V4.48: مراحل القالب المختارة للعقد (فارغ = الكل)."""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT template_stage_id FROM contract_scope WHERE contract_id=?",
            (contract_id,)).fetchall()
    return {int(r["template_stage_id"]) for r in rows}


def _scope_filter_stages(contract_id: int, stages: list) -> list:
    """V4.48: تصفية مراحل القالب على نطاق العقد + ضمّ الآباء تلقائيًا."""
    scope = get_contract_scope(contract_id)
    if not scope:
        return stages
    by_id = {s["id"]: s for s in stages}
    keep = set()
    for tid in scope:
        st = by_id.get(tid)
        if st is None:
            continue
        keep.add(tid)
        if st.get("parent_id"):
            keep.add(st["parent_id"])  # أب البند المفرد يُضم عنوانًا
    return [st for st in stages if st["id"] in keep]


def _build_contract_snapshot(contract_id: int, contract_type: str,
                             start_day: str) -> int:
    """نسخ شجرة قالب النوع إلى نسخة مستقلة للعقد (Snapshot).

    دفعات «مقدمة» تُقفل فور التوقيع (بدأت وانتهت يوم العقد) — وأول
    خطوة تنفيذ تبدأ بتاريخ العقد. بلا قالب ← لا نسخة."""
    stages = get_stages(TX_CONTRACT, contract_type)
    if not stages:
        return 0
    # V3.30: الشامل — مراحل المكوّنات المطفأة غائبة نهائيًا (لا تُبنى)،
    # والعنوان التجميعي الذي فقد كل أبنائه يُحذف ولا يتحول لخطوة.
    _enabled = _enabled_bundle_keys(contract_id, contract_type)
    if _enabled is not None:
        _grouping = {s["parent_id"] for s in stages
                     if s.get("parent_id")}
        stages = [s for s in stages
                  if not (s.get("component_key") or "").strip()
                  or (s.get("component_key") or "").strip() in _enabled]
        _kept_kids = {s["parent_id"] for s in stages
                      if s.get("parent_id")}
        stages = [s for s in stages
                  if s.get("parent_id") or s["id"] not in _grouping
                  or s["id"] in _kept_kids]
        if not stages:
            return 0
    stages = _scope_filter_stages(contract_id, stages)
    if not stages:
        return 0
    mains = {s["id"]: s for s in stages if not s.get("parent_id")}
    # الرئيسية التجميعية فقط عنوان مجموعة — والرئيسية بلا أبناء
    # والفرعية كلها خطوات تنفيذ فعلية (تمشي عليها الأزرار والدفعات)
    parents_with_kids = {s["parent_id"] for s in stages
                         if s.get("parent_id")}
    opened_by = auth_service.display_name()
    with get_connection() as conn:
        order = 0
        first_step_opened = False
        for s in stages:
            order += 1
            if s.get("parent_id"):
                level = 1
                parent_name = (mains.get(s["parent_id"]) or {}
                               ).get("stage_name", "")
            elif s["id"] in parents_with_kids:
                level = 0          # رئيسية تجميعية — عنوان فقط
                parent_name = ""
            else:
                level = 1          # رئيسية بلا أبناء = خطوة تنفيذ
                parent_name = ""
            kind = (s.get("pay_kind") or "").strip()
            start = end = ""
            if kind == "advance":
                start = end = start_day       # مقدمة: أُنجزت بالتوقيع
            elif level == 1 and not first_step_opened:
                start = start_day             # أول خطوة تبدأ فورًا
                first_step_opened = True
            conn.execute(
                "INSERT INTO contract_stages (contract_id, name, level, "
                "parent_name, expected_days, pay_pct, pay_kind, "
                "sort_order, start_date, end_date, closed_by, "
                "is_supervision, sup_monthly) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (contract_id, s["stage_name"], level, parent_name,
                 int(s.get("expected_days") or 0),
                 float(s.get("payment_pct") or 0), kind, order,
                 start, end, opened_by if (start and not end and level == 1) else "",
                 # V3.23: وراثة الطابع الإشرافي من قالب النوع
                 int(s.get("is_supervision") or 0),
                 float(s.get("sup_monthly") or 0)))
    return order


def get_contract_stages(contract_id: int) -> list[dict]:
    # V2.48: تغليف بذاكرة البناء
    from services.qcache import memo
    return memo(("get_contract_stages", contract_id),
                lambda: _get_contract_stages_impl(contract_id))


def _get_contract_stages_impl(contract_id: int) -> list[dict]:
    """نسخة العقد من المراحل (Snapshot) بترتيبها."""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM contract_stages WHERE contract_id=? "
            "ORDER BY sort_order, id", (contract_id,)).fetchall()
    return [dict(r) for r in rows]


def contract_stage_history(contract_id: int) -> list[dict]:
    """سجل مراحل العقد من نسخته: البداية/النهاية/التخطي/المُنهي."""
    rows = []
    for s in get_contract_stages(contract_id):
        if not s["start_date"] and not s["end_date"]:
            continue
        rows.append({"stage_name": s["name"],
                     "moved_at": s["end_date"] or s["start_date"],
                     "start_date": s["start_date"],
                     "end_date": s["end_date"],
                     "is_skipped": int(s["is_skipped"] or 0),
                     "moved_by_name": s.get("closed_by") or "",
                     "note": ""})
    return rows


def _generate_payments_from_snapshot(contract_id: int, amount: float,
                                     start_day: str) -> int:
    """توليد خطة السداد من إعداد مراحل نسخة العقد (مرة واحدة):

    · مقدمة (advance): تستحق فور التوقيع بملاحظة ذلك.
    · عند إنجاز/final: استحقاق تقديري عند التاريخ المتوقع لاكتمالها
      — يُستبدل بالفعلي عند إنهاء المرحلة.
    · أيام (days): بعد أيامها من التوقيع (لا تتأثر بالإنجاز).
    """
    with get_connection() as conn:
        has_plan = conn.execute(
            "SELECT 1 FROM payment_plan WHERE contract_id=? LIMIT 1",
            (contract_id,)).fetchone()
    if has_plan:
        return 0
    all_stages = get_contract_stages(contract_id)
    steps = [s for s in all_stages
             if s["level"] == 1 and (s["pay_kind"] or "").strip()]
    if not steps or amount <= 0:
        return 0
    base = date.fromisoformat(start_day)
    rows = []
    cum = 0
    no = 0
    for s in all_stages:
        if s["level"] != 1:
            continue
        cum += int(s["expected_days"] or 0)
        kind = (s["pay_kind"] or "").strip()
        if not kind:
            continue
        no += 1
        pay = round(amount * float(s["pay_pct"] or 0) / 100.0, 3)
        if pay <= 0:
            continue
        if kind == "days":
            due = (base + timedelta(
                days=int(s["expected_days"] or 0))).isoformat()
            note = (f"دفعة بالأيام — بعد {s['expected_days']} يومًا "
                    "من التوقيع")
            trig = ""
        elif kind == "advance":
            due = start_day
            note = "دفعة مقدمة عند توقيع العقد"
            trig = start_day
        else:                     # achieve / final — تقديري مبدئيًا
            due = (base + timedelta(days=cum)).isoformat()
            note = ""
            trig = ""
        rows.append((f"{no}. دفعة {s['name']}", due, pay, s["id"], note,
                     trig))
    if not rows:
        return 0
    with get_connection() as conn:
        for i, (title, due, pay, sid, note, trig) in enumerate(rows, 1):
            conn.execute(
                "INSERT INTO payment_plan (contract_id, title, due_date, "
                "amount, sort_order, stage_id, notes, triggered_at) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (contract_id, title, due, pay, i, sid, note, trig))
    return len(rows)


def stage_name_of(stage_id: int) -> str:
    if not stage_id:
        return "—"
    st = _get_stage(stage_id)
    return st["stage_name"] if st else "—"


def type_payment_preview(contract_type: str, amount: float = 0.0) -> dict:
    """معاينة موحدة لقالب دفعات النوع.

    تُستخدمها شاشة إنشاء العقد حتى لا يكون منطق المعاينة مختلفًا عن
    منطق إنشاء خطة السداد. المبالغ المكتوبة في القالب تُعامل كمرجع
    توزيع عند عدم وجود نسب، لأن قيمة العقد الفعلية تختلف حسب العميل.
    """
    contract_type = _stage_scope(contract_type)
    steps = stage_path(TX_CONTRACT, contract_type)
    payments = sorted(type_payments(contract_type),
                      key=lambda x: int(x["pay_no"]))
    amount = float(amount or 0)
    # المبلغ اليدوي في القالب هو قيمة افتراضية كما كتبها المستخدم،
    # وليس أساس توزيع على قيمة العقد. هذا يسمح لنفس شجرة نوع العقد أن
    # تُستخدم لعقود كثيرة تختلف مبالغ دفعاتها بلا تكرار شجرة جديدة.
    rows = []
    total_pct = 0.0
    fixed_sum = 0.0
    flexible_count = 0
    for idx, p in enumerate(payments):
        pct = float(p.get("pct") or 0)
        fixed = float(p.get("amount_fixed") or 0)
        ratio = 0.0
        if pct > 0:
            mode = "percent"
            mode_text = f"{pct:g}%"
            pay_amount = round(amount * pct / 100.0, 3) if amount > 0 else 0.0
            amount_text = f"{pay_amount:,.3f}" if amount > 0 else "—"
            total_pct += pct
        elif fixed > 0:
            mode = "fixed"
            mode_text = "مبلغ يدوي"
            pay_amount = round(fixed, 3)
            amount_text = f"{pay_amount:,.3f}"
            fixed_sum += fixed
        else:
            mode = "flexible"
            mode_text = "مرنة"
            pay_amount = 0.0
            amount_text = "تُحدد لاحقًا"
            flexible_count += 1
        auto_stage = (steps[idx] if idx < len(steps)
                      and len(payments) == len(steps) else None)
        stage_name = p.get("stage_name") or (
            auto_stage["stage_name"] if auto_stage else "دفعة بالأيام")
        trigger_name = p.get("trigger_name") or (
            auto_stage["stage_name"] if auto_stage else "")
        trigger_stage_id = int(p["trigger_stage_id"] or 0) if p.get("trigger_stage_id") else 0
        if not trigger_stage_id and auto_stage:
            trigger_stage_id = int(auto_stage["id"])
        days = int(p.get("days_offset") or 0)
        if auto_stage and not p.get("trigger_stage_id"):
            days = stage_cumulative_days(contract_type, auto_stage["id"])
        due_text = (f"عن مرحلة «{trigger_name}» · تقديريًا +{days} يوم"
                    if trigger_name else f"بعد {days} يوم من التوقيع")
        rows.append({
            "pay_no": int(p["pay_no"]), "title": p["title"],
            "stage_name": stage_name, "trigger_name": trigger_name,
            "trigger_stage_id": trigger_stage_id or None,
            "days_offset": days, "mode": mode, "mode_text": mode_text,
            "amount": pay_amount, "amount_text": amount_text,
            "pct": pct, "fixed_basis": fixed, "ratio": ratio,
            "mode": mode, "days_offset": days,
            "due_text": due_text,
        })
    return {"steps": steps, "payments": payments, "rows": rows,
            "total_pct": total_pct, "fixed_basis_sum": fixed_sum,
            "flexible_count": flexible_count}


def renumber_plan_rows(rows: list[dict],
                       keep_ids: set | None = None) -> list[dict]:
    """ترقيم متسلسل 1..n لدفعات القالب بعد ترشيح نطاق العقد (V4.5.10).

    المشكلة قبل V4.5.10: أرقام الدفعات تأتي من القالب (pay_no)؛ فإذا ألغى
    المستخدم اختيار مرحلة/تصنيف بقيت الأرقام بفجوة (1,2,4,5) في المعاينة
    وفي خطة العقد المحفوظة. الآن: الصفوف الباقية تُرقَّم 1..n بترتيب
    القالب، ويُحفظ الرقم الأصلي في ``tpl_pay_no`` للربط الداخلي.

    keep_ids: معرّفات مراحل القالب المسموح بها (None = القالب كاملًا).
    """
    out: list[dict] = []
    # None = القالب كاملًا · مجموعة فارغة = لا مراحل مختارة (تُستبعد الكل)
    want = None if keep_ids is None else {int(x) for x in keep_ids}
    seq = 0
    for row in rows or []:
        tt = row.get("trigger_stage_id")
        if want is not None and tt and int(tt) not in want:
            continue
        seq += 1
        item = dict(row)
        item["tpl_pay_no"] = int(item.get("pay_no") or 0)
        item["pay_no"] = seq
        out.append(item)
    return out


def scoped_plan_rows(contract_id: int, contract_type: str,
                     amount: float = 0.0) -> list[dict]:
    """دفعات القالب لعقد معيّن بعد النطاق وترقيمها المتسلسل (V4.5.10).

    نفس قاعدة التوليد: مرحلة خارج نسخة العقد (Stage Snapshot) تُستبعد.
    """
    preview = type_payment_preview(contract_type, amount)
    if not get_contract_scope(contract_id):
        return renumber_plan_rows(preview["rows"], None)
    keep = set(_template_to_contract_stage_map(contract_id, contract_type))
    return renumber_plan_rows(preview["rows"], keep)


def _template_to_contract_stage_map(contract_id: int,
                                    contract_type: str) -> dict[int, int]:
    """يربط معرف مرحلة القالب بمعرف نظيرتها في نسخة العقد.

    `type_payment_tpl.trigger_stage_id` يشير إلى `workflow_stages`، بينما
    `payment_plan.stage_id` يجب أن يشير إلى `contract_stages`. نحافظ على
    المطابقة بترتيب مسار التنفيذ نفسه الذي اُستخدم عند إنشاء Snapshot.
    """
    template_steps = stage_path(TX_CONTRACT, contract_type)
    contract_steps = [s for s in get_contract_stages(contract_id)
                      if int(s.get("level") or 0) == 1]
    mapping: dict[int, int] = {}
    # V4.48: ربط اسمي (لا موضعي) — النطاق/الحزم تُنقص النسخة فتُكسر
    # المطابقة الموضعية. الأسماء المكررة تُستهلك بالترتيب؛ والنسخة
    # الكاملة تُنتج نفس الربط القديم تمامًا.
    _pool: dict[str, list[int]] = {}
    for snap in contract_steps:
        _pool.setdefault((snap.get("name") or "").strip(), []).append(
            int(snap["id"]))
    for tpl in template_steps:
        _lst = _pool.get((tpl.get("stage_name") or "").strip()) or []
        if _lst:
            mapping[int(tpl["id"])] = _lst.pop(0)
    return mapping


def _generate_type_payments_from_template(contract_id: int, contract_type: str,
                                          amount: float,
                                          start_day: str) -> int:
    """توليد خطة السداد من نفس منطق المعاينة الموحد لقالب الدفعات."""
    if amount <= 0:
        return 0
    with get_connection() as conn:
        has_plan = conn.execute(
            "SELECT 1 FROM payment_plan WHERE contract_id=? LIMIT 1",
            (contract_id,)).fetchone()
    if has_plan:
        return 0
    preview = type_payment_preview(contract_type, amount)
    if not preview["payments"]:
        return 0
    base = date.fromisoformat(start_day)
    stage_map = _template_to_contract_stage_map(contract_id, contract_type)
    _scoped = bool(get_contract_scope(contract_id))
    rows = []
    # V4.5.10: الترقيم متسلسل 1..n على دفعات النطاق — كانت الأرقام تبقى
    # بأرقام القالب فيظهر 1,2,4,5 عند إلغاء اختيار مرحلة (فجوة في الرقم).
    # موضع الدفعة داخل النطاق هو رقمها، حتى لو كانت «مرنة» بلا مبلغ بعد.
    _seq = 0
    for row in preview["rows"]:
        # V4.48: دفعة مرحلة خارج النطاق لا تُخلق أصلًا (لا تتحول لأيام).
        _tt = row.get("trigger_stage_id")
        if _scoped and _tt and int(_tt) not in stage_map:
            continue
        _seq += 1
        pay_amount = float(row["amount"] or 0)
        if pay_amount <= 0:
            continue
        due = (base + timedelta(days=int(row["days_offset"] or 0))).isoformat()
        tpl_trig = row.get("trigger_stage_id")
        snap_trig = stage_map.get(int(tpl_trig)) if tpl_trig else None
        mode = row.get("mode")
        if mode == "percent":
            value_note = f"نسبة {float(row['pct'] or 0):g}% من قيمة العقد"
        elif mode == "fixed":
            value_note = f"مبلغ يدوي {pay_amount:,.3f} د.ك"
        else:
            value_note = "قيمة مرنة"
        if snap_trig:
            trig_name = row.get("trigger_name") or row.get("stage_name") or "—"
            note = f"استحقاق تقديري — فعليًا عن مرحلة «{trig_name}» · {value_note}"
        else:
            note = (f"دفعة بالأيام — بعد {int(row['days_offset'] or 0)} "
                    f"يومًا من التوقيع · {value_note}")
        rows.append((_plan_title_for(_seq, row), due,
                     pay_amount, _seq, snap_trig, note, ""))
    if not rows:
        return 0
    with get_connection() as conn:
        for title, due, pay, no, sid, note, trig in rows:
            conn.execute(
                "INSERT INTO payment_plan (contract_id, title, due_date, "
                "amount, sort_order, stage_id, notes, triggered_at) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (contract_id, title, due, pay, no, sid, note, trig))
    return len(rows)


def _generate_stage_payments(contract_id: int, contract_type: str,
                             amount: float, start_day: str) -> int:
    """توافق خلفي: الاسم القديم كان يولد من قالب دفعات النوع.

    التنفيذ الفعلي الآن في `_generate_type_payments_from_template` حتى
    تُربط الدفعات بمراحل نسخة العقد لا بمراحل القالب.
    """
    return _generate_type_payments_from_template(
        contract_id, contract_type, amount, start_day)


def _ensure_single_full_contract_payment(contract_id: int, amount: float,
                                         start_day: str) -> int:
    """خطة سداد آمنة لعقد يُحصّل مرة واحدة.

    إذا كان للعقد مسار مراحل ولا توجد له أي خطة سداد من قالب الدفعات أو
    من نسب المراحل، ننشئ دفعة كاملة بتاريخ بداية العقد ومربوطة بأول خطوة
    تنفيذية. بذلك لا نُجبر عقد الدفع الواحد على تقسيمات/نسب مراحل، وفي
    نفس الوقت تجد شاشات المراحل/الإيصالات دفعة العقد الكاملة الموجودة من
    بداية التعاقد.
    """
    if amount <= 0:
        return 0
    steps = [s for s in get_contract_stages(contract_id)
             if int(s.get("level") or 0) == 1]
    if not steps:
        return 0
    first_stage_id = int(steps[0]["id"])
    with get_connection() as conn:
        has_plan = conn.execute(
            "SELECT 1 FROM payment_plan WHERE contract_id=? LIMIT 1",
            (contract_id,)).fetchone()
        if has_plan:
            return 0
        conn.execute(
            "INSERT INTO payment_plan (contract_id, title, due_date, amount, "
            "sort_order, stage_id, notes, triggered_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (contract_id, "دفعة كاملة عند بداية التعاقد", start_day,
             round(float(amount), 3), 1, first_stage_id,
             "دفعة كاملة لعقد يُحصّل مرة واحدة — لا تقسيم على المراحل",
             start_day))
    return 1


def _mark_skipped_stage_payments(contract_id: int, stage_id: int, stage_name: str,
                                 skip_date: str) -> list[dict]:
    """دفعات المرحلة المتخطاة لا تُعرض كمطالبة؛ نسجل سبب عدم الاستحقاق."""
    skipped = []
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, title, amount, triggered_at FROM payment_plan "
            "WHERE contract_id=? AND stage_id=?",
            (contract_id, stage_id)).fetchall()
        for r in rows:
            if (r["triggered_at"] or "").strip():
                continue
            note = (f"غير مستحقة لأن مرحلة «{stage_name}» تم تخطيها "
                    f"بتاريخ {skip_date}")
            conn.execute("UPDATE payment_plan SET notes=? WHERE id=?",
                         (note, r["id"]))
            skipped.append({"title": r["title"],
                            "amount": float(r["amount"] or 0),
                            "skipped": True})
    return skipped


def _mark_skipped_sub_stage_payments(contract_id: int, stage_id: int,
                                      stage_name: str,
                                      skip_date: str) -> list[dict]:
    """V4.2: مرآة الباطن — دفعات المرحلة المتخطاة غير مستحقة (P1-1)."""
    skipped = []
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT sp.id, sp.title, sp.amount, sp.triggered_at "
            "FROM sub_payment_plan sp "
            "JOIN sub_contracts sc ON sc.id = sp.sub_contract_id "
            "WHERE sc.contract_id=? AND sp.stage_id=?",
            (contract_id, stage_id)).fetchall()
        for r in rows:
            if (r["triggered_at"] or "").strip():
                continue
            note = ("غير مستحقة لأن مرحلة «" + stage_name + "» تم تخطيها "
                    "بتاريخ " + skip_date)
            conn.execute("UPDATE sub_payment_plan SET notes=? WHERE id=?",
                         (note, r["id"]))
            skipped.append({"title": r["title"],
                            "amount": float(r["amount"] or 0),
                            "skipped": True})
    return skipped


def _fire_auto_claims(line_ids: list[int], kind: str) -> None:
    """V4.48: مطالبات تلقائية للدفعات المحركة — لا يعطل التحفيز أبدًا."""
    if not line_ids:
        return
    try:
        from services import claims_service as _clm
        for _tid in line_ids:
            try:
                if kind == "cust":
                    _clm.auto_claim_for_customer_line(int(_tid))
                else:
                    _clm.auto_claim_for_sub_line(int(_tid))
            except Exception:
                continue
    except Exception:
        pass


def trigger_linked_sub_payments(contract_id: int,
                                finish_date: str) -> list[dict]:
    """V4.6: استحقاق دفعات الباطن باكتمال مصادرها من دفعات العميل (AND).

    تُفحص سطور الباطن ذات المصادر غير المحركة: ما اكتملت كل مصادره
    (سطور عميل محركة) يُحرَّك بتاريخ الإنهاء وملاحظة المصادر.
    """
    triggered = []
    with get_connection() as conn:
        cands = conn.execute(
            "SELECT sp.id, sp.title, sp.amount, sp.sub_contract_id, "
            "s.name AS sub_name FROM sub_payment_plan sp "
            "JOIN sub_contracts sc ON sc.id = sp.sub_contract_id "
            "JOIN subcontractors s ON s.id = sc.subcontractor_id "
            "WHERE sc.contract_id=? AND COALESCE(sp.triggered_at,'')='' "
            "AND EXISTS (SELECT 1 FROM sub_payment_sources sps "
            "WHERE sps.sub_line_id = sp.id)",
            (contract_id,)).fetchall()
        if not cands:
            return []
        _pool_cache = {}

        def _remaining_for(sub_id, line_id, amt):
            if sub_id not in _pool_cache:
                paid = float(conn.execute(
                    "SELECT COALESCE(SUM(amount),0) FROM vouchers "
                    "WHERE sub_contract_id=? AND vtype='payment' "
                    "AND cancelled=0 "
                    "AND (allocation IS NULL OR allocation = '')",
                    (sub_id,)).fetchone()[0])
                lines = conn.execute(
                    "SELECT id, amount FROM sub_payment_plan "
                    "WHERE sub_contract_id=? ORDER BY due_date, sort_order",
                    (sub_id,)).fetchall()
                rem = {}
                pool = paid
                for pr in lines:
                    a = float(pr["amount"] or 0)
                    cov = min(pool, a)
                    pool -= cov
                    rem[int(pr["id"])] = max(0.0, a - cov)
                _pool_cache[sub_id] = rem
            return float(_pool_cache[sub_id].get(int(line_id), amt))

        tids: list[int] = []
        for r in cands:
            srcs = conn.execute(
                "SELECT pp.title, COALESCE(pp.triggered_at,'') AS trg "
                "FROM sub_payment_sources sps "
                "JOIN payment_plan pp ON pp.id = sps.cust_line_id "
                "WHERE sps.sub_line_id=?", (r["id"],)).fetchall()
            if not srcs:
                continue
            if any(not (s["trg"] or "").strip() for s in srcs):
                continue
            remaining = _remaining_for(int(r["sub_contract_id"]), r["id"],
                                       float(r["amount"] or 0))
            already_paid = remaining <= 0.001
            names = "، ".join("«" + (s["title"] or "دفعة") + "»"
                              for s in srcs)
            if already_paid:
                note = ("اكتملت مصادرها من عقد العميل (" + names + ") بتاريخ "
                        + finish_date + " والدفعة كانت مسددة مسبقًا")
            else:
                note = ("مستحقة لاكتمال مصادرها من عقد العميل (" + names
                        + ") بتاريخ " + finish_date)
            conn.execute(
                "UPDATE sub_payment_plan SET due_date=?, triggered_at=?, "
                "notes=? WHERE id=?",
                (finish_date, finish_date, note, r["id"]))
            triggered.append({"title": r["title"],
                              "amount": float(r["amount"]),
                              "due": finish_date,
                              "remaining": remaining,
                              "already_paid": already_paid,
                              "sub_name": r["sub_name"],
                              "sub_contract_id": int(r["sub_contract_id"]),
                              "via_sources": True})
            tids.append(int(r["id"]))
    _fire_auto_claims(tids, "sub")
    return triggered


def trigger_due_sub_payments(contract_id: int, stage_id: int,
                             finish_date: str) -> list[dict]:
    """V4.2: الربط المالي للباطن — إنهاء مرحلة الأب يستحق دفعاتها.

    مرآة trigger_due_payments على sub_payment_plan: التغطية من سندات
    الصرف المرتبطة بعقد الباطن (FIFO)، والملاحظة نفس الصيغة.

    V4.5.04: السطور المربوطة بمصادر تُستثنى — حوكمتها للمصادر فقط
    (trigger_linked_sub_payments) حتى لو أُغلقت مرحلتها أولًا.
    """
    triggered = []
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT sp.id, sp.title, sp.amount, sp.sub_contract_id, "
            "s.name AS sub_name FROM sub_payment_plan sp "
            "JOIN sub_contracts sc ON sc.id = sp.sub_contract_id "
            "JOIN subcontractors s ON s.id = sc.subcontractor_id "
            "WHERE sc.contract_id=? AND sp.stage_id=? "
            "AND COALESCE(sp.triggered_at,'')='' "
            "AND NOT EXISTS (SELECT 1 FROM sub_payment_sources sps "
            "WHERE sps.sub_line_id = sp.id)",
            (contract_id, stage_id)).fetchall()
        if not rows:
            return []
        st = conn.execute(
            "SELECT name FROM contract_stages WHERE id=?",
            (stage_id,)).fetchone()
        stage_name = st["name"] if st else "—"
        _pool_cache = {}

        def _remaining_for(sub_id, line_id, amt):
            if sub_id not in _pool_cache:
                paid = float(conn.execute(
                    "SELECT COALESCE(SUM(amount),0) FROM vouchers "
                    "WHERE sub_contract_id=? AND vtype='payment' "
                    "AND cancelled=0 "
                    "AND (allocation IS NULL OR allocation = '')",
                    (sub_id,)).fetchone()[0])
                lines = conn.execute(
                    "SELECT id, amount FROM sub_payment_plan "
                    "WHERE sub_contract_id=? ORDER BY due_date, sort_order",
                    (sub_id,)).fetchall()
                rem = {}
                pool = paid
                for pr in lines:
                    a = float(pr["amount"] or 0)
                    cov = min(pool, a)
                    pool -= cov
                    rem[int(pr["id"])] = max(0.0, a - cov)
                _pool_cache[sub_id] = rem
            return float(_pool_cache[sub_id].get(int(line_id), amt))

        tids: list[int] = []
        for r in rows:
            remaining = _remaining_for(int(r["sub_contract_id"]), r["id"],
                                       float(r["amount"] or 0))
            already_paid = remaining <= 0.001
            if already_paid:
                note = ("انتهت مرحلة «" + stage_name + "» بتاريخ "
                        + finish_date + " والدفعة كانت مسددة مسبقًا")
            else:
                note = ("مستحقة لانتهاء مرحلة «" + stage_name + "» بتاريخ "
                        + finish_date)
            conn.execute(
                "UPDATE sub_payment_plan SET due_date=?, triggered_at=?, "
                "notes=? WHERE id=?",
                (finish_date, finish_date, note, r["id"]))
            triggered.append({"title": r["title"],
                              "amount": float(r["amount"]),
                              "due": finish_date,
                              "remaining": remaining,
                              "already_paid": already_paid,
                              "sub_name": r["sub_name"],
                              "sub_contract_id": int(r["sub_contract_id"])})
            tids.append(int(r["id"]))
    _fire_auto_claims(tids, "sub")
    return triggered


def trigger_due_payments(contract_id: int, stage_id: int,
                         finish_date: str) -> list[dict]:
    """الربط المالي التلقائي عند إنهاء مرحلة على عقد.

    يبحث في خطة سداد هذا العقد عن الدفعة المرتبطة بهذه المرحلة
    (stage_id = معرف مرحلة نسخة العقد) ولم تستحق بعد. إذا كانت الدفعة
    مغطاة بسند قبض سابق فلا نكتب أنها «أصبحت مستحقة» حتى لا يظهر
    تعليق مضلل؛ نعلّمها فقط بأن مرحلتها انتهت وأنها كانت مسددة مسبقًا.
    """
    triggered = []
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT p.id, p.title, p.amount FROM payment_plan p "
            "WHERE p.contract_id=? AND p.stage_id=? "
            "AND COALESCE(p.triggered_at,'')=''",
            (contract_id, stage_id)).fetchall()
        if not rows:
            return []
        st = conn.execute(
            "SELECT name FROM contract_stages WHERE id=?",
            (stage_id,)).fetchone()
        stage_name = st["name"] if st else "—"

        # نفس قاعدة شاشة خطة السداد: سندات القبض غير الملغاة تُغطّي
        # الدفعات بالترتيب. لذلك نعرف قبل تغيير الاستحقاق هل الدفعة
        # كانت مدفوعة بالفعل أم ما زال لها مبلغ مطلوب.
        collected = float(conn.execute(
            "SELECT COALESCE(SUM(amount),0) FROM vouchers "
            "WHERE contract_id=? AND vtype='receipt' AND cancelled=0 "
            "AND (allocation IS NULL OR allocation = '')",
            (contract_id,)).fetchone()[0])
        plan_rows = conn.execute(
            "SELECT id, amount FROM payment_plan WHERE contract_id=? "
            "ORDER BY due_date, sort_order", (contract_id,)).fetchall()
        remaining_by_id = {}
        pool = collected
        for pr in plan_rows:
            amt = float(pr["amount"] or 0)
            covered = min(pool, amt)
            pool -= covered
            remaining_by_id[int(pr["id"])] = max(0.0, amt - covered)

        tids: list[int] = []
        for r in rows:
            remaining = float(remaining_by_id.get(int(r["id"]),
                                                float(r["amount"] or 0)))
            already_paid = remaining <= 0.001
            if already_paid:
                note = (f"انتهت مرحلة «{stage_name}» بتاريخ {finish_date} "
                        "والدفعة كانت مسددة مسبقًا")
            else:
                note = (f"مستحقة لانتهاء مرحلة «{stage_name}» بتاريخ "
                        f"{finish_date}")
            conn.execute(
                "UPDATE payment_plan SET due_date=?, triggered_at=?, "
                "notes=? WHERE id=?",
                (finish_date, finish_date, note, r["id"]))
            triggered.append({"title": r["title"],
                              "amount": float(r["amount"]),
                              "due": finish_date,
                              "remaining": remaining,
                              "already_paid": already_paid})
            tids.append(int(r["id"]))
    _fire_auto_claims(tids, "cust")
    return triggered


def _auto_comment(customer_id: int | None, contract_id: int | None,
                  body: str) -> None:
    """تعليق تلقائي في «تعليقات العميل» بماذا تم على المراحل."""
    if not customer_id or not (body or "").strip():
        return
    try:
        from services import comment_service
        comment_service.add_comment(
            customer_id, f"🤖 [متابعة تلقائية] {body}",
            contract_id=contract_id)
    except Exception:
        pass          # التعليق إثراء — لا يعطل حركة المراحل


# ---------- ربط الدفعات بالمراحل (بلا تكرار مرحلة) ----------
def link_plan_stage(item_id: int, stage_id: int | None) -> None:
    """ربط بند خطة سداد بمرحلة — المرحلة الواحدة يجوز ربطها ببند
    واحد فقط داخل العقد نفسه (عدم تكرار المرحلة في الدفعات)."""
    with get_connection() as conn:
        item = conn.execute(
            "SELECT id, contract_id FROM payment_plan WHERE id=?",
            (item_id,)).fetchone()
    if item is None:
        raise DatabaseError("بند الخطة غير موجود.")
    if stage_id:
        with get_connection() as conn:
            dup = conn.execute(
                "SELECT title FROM payment_plan WHERE contract_id=? "
                "AND stage_id=? AND id<>?",
                (item["contract_id"], stage_id, item_id)).fetchone()
            snap = conn.execute(
                "SELECT id FROM contract_stages WHERE id=? AND "
                "contract_id=?",
                (stage_id, item["contract_id"])).fetchone()
        if dup:
            raise DatabaseError(
                f"المرحلة مربوطة بالفعل بدفعة «{dup['title']}» — "
                "كل مرحلة تُربط بدفعة واحدة فقط (بلا تكرار).")
        if snap is None:
            raise DatabaseError(
                "المرحلة يجب أن تكون من مراحل هذا العقد نفسه.")
    with get_connection() as conn:
        conn.execute(
            "UPDATE payment_plan SET stage_id=? WHERE id=?",
            (stage_id, item_id))


def free_stages_for_plan(contract_id: int) -> list[dict]:
    """مراحل العقد (من نسخته) المتاحة للربط ببند جديد (غير المرتبطة)."""
    linked = set()
    with get_connection() as conn:
        for r in conn.execute(
                "SELECT stage_id FROM payment_plan WHERE contract_id=? "
                "AND stage_id IS NOT NULL", (contract_id,)):
            linked.add(int(r[0]))
    return [s for s in get_contract_stages(contract_id)
            if s["level"] == 1 and s["id"] not in linked]


def advance_stage(transaction_type: str, transaction_id: int,
                  skip: bool = False, note: str = "",
                  user_id: int | None = None,
                  action_date: str | None = None) -> dict:
    """إنهاء المرحلة الحالية والانتقال للتالية في المسار — بزر واحد.

    skip=True ⟵ تخطي (تُوسم المرحلة المغلقة is_skipped=1).
    يرجع {"closed": اسم المغلقة, "next": اسم التالية أو None}.
    """
    uid = _uid(user_id)
    if transaction_type == TX_CONTRACT:
        return _advance_contract_stage(
            transaction_id, skip=skip, note=note, user_id=user_id,
            action_date=action_date)
    if transaction_type == TX_SUBCONTRACT:
        _ensure_subcontract_stage_not_frozen(transaction_id)
    ctype = resolve_scope(transaction_type, transaction_id)
    path = stage_path(transaction_type, ctype)
    current = get_current_stage(transaction_type, transaction_id)
    if not current:
        raise DatabaseError("لم تبدأ المتابعة بعد لهذه المعاملة.")
    if not path:
        raise DatabaseError("لا مراحل معرّفة لهذا النوع.")
    if current.get("end_date"):
        raise DatabaseError(
            "اكتمل مسار المراحل لهذه المعاملة بالفعل — لا مرحلة جارية.")
    cur_id = int(current["id"])
    if cur_id not in [s["id"] for s in path]:
        # مرحلة خارج المسار (رئيسية) — ننقل لأول خطوة بعدها
        nxt = path[0]
    else:
        idx = [s["id"] for s in path].index(cur_id)
        if idx >= len(path) - 1:
            nxt = None          # آخر مرحلة — الإنهاء يغلقها فقط
        else:
            nxt = path[idx + 1]
    # إغلاق الجارية (is_skipped حسب الزر) ثم فتح التالية
    with get_connection() as conn:
        conn.execute(
            "UPDATE transaction_stage_log SET end_date=?, is_skipped=?, "
            "note=CASE WHEN ?<>'' THEN ? ELSE note END "
            "WHERE transaction_type=? AND transaction_id=? AND id="
            "(SELECT MAX(id) FROM transaction_stage_log "
            " WHERE transaction_type=? AND transaction_id=?)",
            (date.today().isoformat(), 1 if skip else 0,
             (note or "").strip(), (note or "").strip(),
             transaction_type, transaction_id,
             transaction_type, transaction_id))
    who = auth_service.display_name()
    verb = "تخطّى" if skip else "أنهى مرحلة"
    if nxt is not None:
        auto_add_participant(uid, transaction_type, transaction_id)
        with get_connection() as conn:
            conn.execute(
                "INSERT INTO transaction_stage_log (transaction_type, "
                "transaction_id, stage_id, moved_by, note, start_date) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (transaction_type, transaction_id, nxt["id"], uid,
                 (note or "").strip(), date.today().isoformat()))
        _push(_notify_targets(transaction_type, transaction_id,
                              exclude=uid),
              transaction_type, transaction_id, NOTIF_STAGE,
              f"{who} {verb} «{current['stage_name']}» وانتقل إلى "
              f"«{nxt['stage_name']}»")
    else:
        _push(_notify_targets(transaction_type, transaction_id,
                              exclude=uid),
              transaction_type, transaction_id, NOTIF_STAGE,
              f"{who} {verb} «{current['stage_name']}» — اكتمل المسار")
    # تعليق تلقائي في تعليقات العميل بماذا تم (للعقود) + الربط
    # المالي التلقائي: إنهاء المرحلة يستحق دفعتها المحفزة فورًا
    triggered = []
    if transaction_type == TX_CONTRACT and not skip:
        try:
            triggered = trigger_due_payments(
                transaction_id, int(current["id"]),
                date.today().isoformat())
        except Exception:
            triggered = []
    if transaction_type == TX_CONTRACT:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT customer_id, contract_number FROM contracts "
                "WHERE id=?", (transaction_id,)).fetchone()
        if row:
            note_txt = (f" · ملاحظة: {note.strip()}"
                        if (note or "").strip() else "")
            today_txt = date.today().isoformat()
            if skip:
                body = (f"تخطّى {who} مرحلة "
                        f"«{current['stage_name']}» للعقد "
                        f"{row['contract_number']} بتاريخ {today_txt}"
                        + (f" — وبدأت «{nxt['stage_name']}»"
                           if nxt is not None else
                           " — اكتمل مسار المراحل") + note_txt)
            elif nxt is not None:
                body = (f"أنهى {who} مرحلة «{current['stage_name']}» "
                        f"للعقد {row['contract_number']} بتاريخ "
                        f"{today_txt} — وبدأت مرحلة "
                        f"«{nxt['stage_name']}»{note_txt}")
            else:
                body = (f"أنهى {who} مرحلة "
                        f"«{current['stage_name']}» للعقد "
                        f"{row['contract_number']} بتاريخ "
                        f"{today_txt} — اكتمل مسار المراحل{note_txt}")
            if triggered:
                due_items = [t for t in triggered if not t.get("already_paid")]
                paid_items = [t for t in triggered if t.get("already_paid")]
                if due_items:
                    pays = " و".join(
                        f"«{t['title']}» ({t.get('remaining', t['amount']):,.3f})"
                        for t in due_items)
                    body += (f" — استحقاق دفعة بناءً على المرحلة: {pays} "
                             f"أصبحت مستحقة بتاريخ {today_txt}")
                if paid_items:
                    pays = " و".join(f"«{t['title']}»" for t in paid_items)
                    body += (f" — الدفعة المرتبطة بالمرحلة {pays} "
                             "كانت مسددة مسبقًا ولا توجد مطالبة جديدة")
            _auto_comment(row["customer_id"], transaction_id, body)
        # إشعار المشاركين بحالة الدفعات المرتبطة بالمرحلة
        for t in triggered:
            if t.get("already_paid"):
                msg = (f"انتهت مرحلة «{current['stage_name']}» المرتبطة "
                       f"بدفعة «{t['title']}» المسددة مسبقًا")
            else:
                msg = (f"استحقت دفعة «{t['title']}» "
                       f"({t.get('remaining', t['amount']):,.3f}) بإنهاء مرحلة "
                       f"«{current['stage_name']}»")
            _push(_notify_targets(transaction_type, transaction_id,
                                  exclude=uid),
                  transaction_type, transaction_id, NOTIF_STAGE, msg)
    return {"closed": current["stage_name"],
            "next": nxt["stage_name"] if nxt else None,
            "triggered_payments": triggered}


def _stage_dates(row: dict) -> tuple[str, int]:
    """(تاريخ البدء الفعلي، أيام المرحلة) لسجل مرحلة."""
    started = (row.get("start_date") or "") or         str(row.get("moved_at") or "")[:10]
    ended = (row.get("end_date") or "") or date.today().isoformat()
    return started, max(0, _days_between(ended, started))


def stage_status(transaction_type: str, transaction_id: int,
                 _stages: list[dict] | None = None) -> dict:
    """الحالة الكاملة لمسار معاملة.

    للعقود: من **نسخة العقد** (Snapshot) — مستقلة عن القالب.
    {current, days_in, expected, state(ok/near/over/done/none),
     path: [{stage, state(done/skip/current/future), days, expected}]}.
    """
    if transaction_type == TX_CONTRACT:
        return _contract_stage_status(transaction_id, _stages)
    path = stage_path(transaction_type,
                      resolve_scope(transaction_type, transaction_id))
    history = get_stage_history(transaction_type, transaction_id)
    # التاريخ يرجع stage_name لا id — نطابق بالاسم
    name_to_id = {s["stage_name"]: s["id"] for s in path}
    rows_by_stage: dict[int, list] = {}
    for h in history:
        sid = name_to_id.get(h.get("stage_name") or "")
        if sid:
            rows_by_stage.setdefault(sid, []).append(h)
    latest = history[-1] if history else None
    cur_sid = name_to_id.get((latest or {}).get("stage_name") or "")
    cur_open = bool(latest) and not (latest.get("end_date") or "")
    cur_idx = [s["id"] for s in path].index(cur_sid) \
        if cur_sid in [s["id"] for s in path] else -1

    out_path = []
    current_stage = None
    for i, s in enumerate(path):
        rows = rows_by_stage.get(s["id"], [])
        state_txt = "future"
        days = expected = 0
        start = end = ""
        if rows:
            row = rows[-1]
            start, days = _stage_dates(row)
            end = row.get("end_date") or ""
            expected = int(s.get("expected_days") or 0)
            if i < cur_idx or (i == cur_idx and not cur_open):
                state_txt = "skip" if int(row.get("is_skipped") or 0) \
                    else "done"
            elif i == cur_idx and cur_open:
                state_txt = "current"
                current_stage = dict(s)
                current_stage["days_in"] = days
        out_path.append({"stage": s, "state": state_txt, "days": days,
                         "expected": int(s.get("expected_days") or 0),
                         "start": start, "end": end})
    state = "done"
    if current_stage is not None:
        expected = int(current_stage.get("expected_days") or 0)
        days_in = int(current_stage.get("days_in") or 0)
        if expected and days_in > expected:
            state = "over"
        elif expected and days_in >= expected - 3:
            state = "near"
        else:
            state = "ok"
    elif not out_path:
        state = "none"
    elif latest is None:
        state = "none"
    return {"current": current_stage,
            "days_in": int((current_stage or {}).get("days_in") or 0),
            "expected": int((current_stage or {}).get("expected_days") or 0),
            "state": state, "path": out_path}


def _contract_stage_status(contract_id: int,
                           stages: list[dict] | None = None) -> dict:
    """حالة مسار عقد من نسخته المستقلة.

    ``stages`` اختيارية: تُمرَّر جاهزة عند معالجة عدة عقود دفعة واحدة
    لتفادي استعلام مستقل لكل عقد (انظر ``execution_report``).
    """
    if stages is None:
        stages = get_contract_stages(contract_id)
    if not stages:
        return {"current": None, "days_in": 0, "expected": 0,
                "state": "none", "path": []}
    out_path = []
    current_stage = None
    for s in stages:
        if s["level"] != 1:
            continue
        start = s["start_date"] or ""
        end = s["end_date"] or ""
        days = 0
        if start:
            days = max(0, _days_between(end or date.today().isoformat(),
                                        start))
        if start and not end:
            state_txt = "current"
            current_stage = dict(s)
            current_stage["stage_name"] = s["name"]   # توحيد المفتاح
            current_stage["days_in"] = days
            current_stage["expected_days"] = s["expected_days"]
        elif start and end:
            state_txt = "skip" if int(s["is_skipped"] or 0) else "done"
        else:
            state_txt = "future"
        out_path.append(
            {"stage": {"id": s["id"], "stage_name": s["name"],
                       "is_supervision": int(s.get("is_supervision") or 0),
                       "expected_days": s["expected_days"],
                       "pay_pct": s["pay_pct"],
                       "pay_kind": s["pay_kind"],
                       "stage_order": s["sort_order"],
                       "parent_name": s.get("parent_name") or "",
                       "transaction_type": TX_CONTRACT,
                       "color": ""},
             "state": state_txt, "days": days,
             "expected": int(s["expected_days"] or 0),
             "start": start, "end": end})
    state = "done"
    if current_stage is not None:
        expected = int(current_stage.get("expected_days") or 0)
        days_in = int(current_stage.get("days_in") or 0)
        if expected and days_in > expected:
            state = "over"
        elif expected and days_in >= expected - 3:
            state = "near"
        else:
            state = "ok"
    elif not out_path:
        state = "none"
    return {"current": current_stage,
            "days_in": int((current_stage or {}).get("days_in") or 0),
            "expected": int((current_stage or {}).get("expected_days") or 0),
            "state": state, "path": out_path}


# ============================================================
# تقارير المتابعة (التأخيرات · الاختناقات · المراحل المفقودة)
# ============================================================
def execution_filter_contract_types() -> list[str]:
    """أنواع العقود النشطة المتاحة كفلتر في تقرير مراحل التنفيذ."""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT DISTINCT COALESCE(NULLIF(TRIM(contract_type),''),'غير محدد') AS t "
            "FROM contracts WHERE COALESCE(status,'نشط') <> 'ملغى' "
            "ORDER BY t").fetchall()
    return [r["t"] for r in rows if (r["t"] or "").strip()]


def execution_filter_stage_names(contract_type: str | None = None) -> list[str]:
    """أسماء المراحل الجارية/المستخدمة كفلتر في تقرير مراحل التنفيذ."""
    ctype = (contract_type or "").strip()
    params = []
    where = "WHERE cs.level=1 AND COALESCE(c.status,'نشط') <> 'ملغى'"
    if ctype:
        where += " AND COALESCE(NULLIF(TRIM(c.contract_type),''),'غير محدد')=?"
        params.append(ctype)
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT cs.name AS n, MIN(cs.sort_order) AS ord FROM contract_stages cs "
            "JOIN contracts c ON c.id=cs.contract_id " + where +
            " GROUP BY cs.name ORDER BY ord, cs.name", params).fetchall()
    return [r["n"] for r in rows if (r["n"] or "").strip()]


def execution_report(user_id: int | None = None) -> dict:
    """تقرير مراحل التنفيذ: المتأخر · القارب على الانتهاء · المفقود.

    يرجع {"delayed": [...], "near": [...], "missing": [...]} — كل عنصر
    فيه العقد والعميل والمرحلة والأيام. المتابعة الإدارية للسندات
    وعقود الباطن تُدرج كذلك (مراحلها مسطحة لكن العداد يعمل).
    """
    out = {"delayed": [], "near": [], "missing": []}
    # الأداء: كانت الدالة تقرأ مراحل كل عقد باستعلام واتصال مستقلين
    # (700 عقد = 700 استعلام و700 اتصال) وهي تعمل في كل تحديث للشاشة
    # الرئيسية عبر execution_alerts. الآن: استعلامان فقط ثم تجميع في
    # الذاكرة — نفس النتائج تمامًا.
    with get_connection() as conn:
        contracts = conn.execute(
            "SELECT c.id, c.contract_number, c.customer_id, "
            "COALESCE(NULLIF(TRIM(c.contract_name),''), c.description) "
            "AS title, cu.name AS customer_name "
            "FROM contracts c LEFT JOIN customers cu "
            "ON cu.id = c.customer_id WHERE c.status <> 'ملغى'").fetchall()
        stages_by_contract: dict[int, list] = {}
        for r in conn.execute(
                "SELECT * FROM contract_stages ORDER BY contract_id, "
                "sort_order, id").fetchall():
            stages_by_contract.setdefault(
                int(r["contract_id"]), []).append(dict(r))
    for c in contracts:
        cid = int(c["id"])
        st = stage_status(TX_CONTRACT, cid,
                          stages_by_contract.get(cid, []))
        cur = st["current"]
        if cur is not None:
            row = {"contract_id": cid,
                   "contract_number": c["contract_number"],
                   "customer_name": c["customer_name"] or "—",
                   "title": c["title"] or "—",
                   "stage": cur["stage_name"],
                   "days": st["days_in"], "expected": st["expected"]}
            if st["state"] == "over":
                out["delayed"].append(row)
            elif st["state"] == "near":
                out["near"].append(row)
        # المراحل المفقودة: مرحلة وُسمت «تخطي» — تجاوزها العقد بلا
        # مرور بها (مثل فحص التربة) — تظهر هنا للمراجعة
        for p in st["path"]:
            if p["state"] == "skip":
                out["missing"].append(
                    {"contract_id": cid,
                     "contract_number": c["contract_number"],
                     "customer_name": c["customer_name"] or "—",
                     "stage": p["stage"]["stage_name"],
                     "detail": "تخطّاها بلا مرور",
                     "days": p["days"], "expected": p["expected"]})
    out["delayed"].sort(key=lambda r: -(r["days"] - r["expected"]))
    out["near"].sort(key=lambda r: r["expected"] - r["days"])
    return out


def execution_occupancy_report(option: str = "current",
                               contract_type: str | None = None,
                               stage_name: str | None = None) -> dict:
    """تقرير إشغال مراحل التنفيذ: كل العقود الموجودة الآن في كل مرحلة.

    بخلاف execution_report القديم الذي ركّز على المتأخر والقارب والمفقود،
    هذا التقرير يجيب عن سؤال المستخدم اليومي:
        المرحلة دي مين اللي فيها؟ وبقاله قد إيه؟

    option:
      current   = كل العقود ذات مرحلة جارية، سواء متأخرة أو لا
      delayed   = المتأخرة فقط
      near      = القريبة من نهاية مدتها
      ok        = التي ما زالت ضمن الوقت
      no_stage  = عقود لا تملك مرحلة جارية
      all       = كل ما سبق

    contract_type/stage_name فلاتر اختيارية؛ نوع العقد صار فلترًا بدل
    تكراره كعمود، وفلتر المرحلة يعمل على المرحلة الحالية.
    """
    option = option or "current"
    contract_type = (contract_type or "").strip()
    stage_name = (stage_name or "").strip()
    rows = []
    totals = {"current": 0, "ok": 0, "near": 0, "delayed": 0,
              "done": 0, "no_stage": 0}
    with get_connection() as conn:
        contracts = conn.execute(
            "SELECT c.id, c.contract_number, c.contract_type, c.customer_id, "
            "COALESCE(NULLIF(TRIM(c.contract_name),''), c.description) AS title, "
            "c.status, cu.name AS customer_name, cu.phone AS customer_phone "
            "FROM contracts c LEFT JOIN customers cu ON cu.id = c.customer_id "
            "WHERE COALESCE(c.status,'نشط') <> 'ملغى' "
            "ORDER BY c.id DESC").fetchall()
        # تحميل مراحل كل العقود دفعة واحدة بدل استعلام لكل عقد
        _stages_by_contract: dict[int, list] = {}
        for _r in conn.execute(
                "SELECT * FROM contract_stages "
                "ORDER BY contract_id, sort_order, id").fetchall():
            _stages_by_contract.setdefault(
                int(_r["contract_id"]), []).append(dict(_r))
    for c in contracts:
        ctype = (c["contract_type"] or "غير محدد").strip() or "غير محدد"
        if contract_type and ctype != contract_type:
            continue
        st = stage_status(TX_CONTRACT, int(c["id"]),
                          _stages_by_contract.get(int(c["id"]), []))
        cur = st.get("current")
        state = st.get("state") or "none"
        path = st.get("path") or []
        next_stage = "—"
        if cur:
            cur_id = int(cur.get("id") or 0)
            for i, item in enumerate(path):
                stage = item.get("stage") or {}
                if int(stage.get("id") or 0) == cur_id:
                    for nxt in path[i + 1:]:
                        if (nxt.get("state") or "") == "future":
                            next_stage = (nxt.get("stage") or {}).get("stage_name") or "—"
                            break
                    break
        if cur:
            days = int(st.get("days_in") or 0)
            expected = int(st.get("expected") or 0)
            over = max(0, days - expected) if expected else 0
            left = max(0, expected - days) if expected else 0
            if state == "over":
                label = f"متأخر {over} يوم"
                bucket = "delayed"
            elif state == "near":
                label = f"قارب · بقي {left} يوم"
                bucket = "near"
            else:
                label = f"ضمن الوقت · بقي {left} يوم" if expected else "جارٍ"
                bucket = "ok"
            totals["current"] += 1
            totals[bucket] += 1
            row = {
                "contract_id": int(c["id"]),
                "contract_number": c["contract_number"],
                "contract_title": c["title"] or "—",
                "contract_type": ctype,
                "customer_id": int(c["customer_id"] or 0),
                "customer_name": c["customer_name"] or "—",
                "customer_phone": c["customer_phone"] or "",
                "stage": cur.get("stage_name") or cur.get("name") or "—",
                "next_stage": next_stage,
                "parent_stage": cur.get("parent_name") or "",
                "start_date": cur.get("start_date") or "",
                "days_in": days,
                "expected": expected,
                "days_over": over,
                "days_left": left,
                "state": state,
                "status_label": label,
                "responsible": cur.get("moved_by_name") or cur.get("closed_by") or "—",
            }
            if option in ("all", "current", bucket):
                if not stage_name or row["stage"] == stage_name:
                    rows.append(row)
        else:
            # لا مرحلة جارية: إما المسار انتهى أو لا توجد مراحل أصلًا.
            has_path = bool(st.get("path"))
            bucket = "done" if has_path and state == "done" else "no_stage"
            totals[bucket] += 1
            row = {
                "contract_id": int(c["id"]),
                "contract_number": c["contract_number"],
                "contract_title": c["title"] or "—",
                "contract_type": ctype,
                "customer_id": int(c["customer_id"] or 0),
                "customer_name": c["customer_name"] or "—",
                "customer_phone": c["customer_phone"] or "",
                "stage": "—",
                "next_stage": "—",
                "parent_stage": "",
                "start_date": "",
                "days_in": 0,
                "expected": 0,
                "days_over": 0,
                "days_left": 0,
                "state": bucket,
                "status_label": "اكتمل مسار المراحل" if bucket == "done" else "لا توجد مرحلة جارية",
                "responsible": "—",
            }
            if option in ("all", bucket):
                if not stage_name or row["stage"] == stage_name:
                    rows.append(row)
    # V5.9: النوت الصغير — آخر ملاحظة على كل عقد تظهر قدامه في التقرير.
    try:
        _notes = stage_notes_by_contract([r["contract_id"] for r in rows])
    except Exception:
        _notes = {}
    for r in rows:
        _n = _notes.get(int(r["contract_id"])) or {}
        r["last_note"] = _n.get("note", "")
        r["last_note_at"] = _n.get("at", "")
        r["last_note_by"] = _n.get("by", "")
    # المرحلة ثم الأكثر بقاءً داخلها، حتى يظهر سؤال «مين في المرحلة دي» بوضوح.
    rows.sort(key=lambda r: (r["stage"], -int(r["days_in"] or 0), r["customer_name"]))
    return {"rows": rows, "totals": totals, "count": len(rows)}


def execution_alerts(limit: int = 25) -> list[tuple]:
    """تنبيهات الرئيسية: (اللون، النص، {age}) للتأخير والاقتراب."""
    rep = execution_report()
    out = []
    for r in rep["delayed"][:limit]:
        over = r["days"] - r["expected"]
        # age = أيام التجاوز (كال دفعات الخطة) — لا أيام المرحلة كلها
        out.append(("danger",
                    f"🏗 العقد {r['contract_number']} · {r['customer_name']} "
                    f"متأخر في «{r['stage']}»: {r['days']} يوم "
                    f"من أصل {r['expected']} (تجاوز {over} يوم)",
                    {"age": max(0, over)}))
    for r in rep["near"][:limit]:
        left = r["expected"] - r["days"]
        out.append(("warn",
                    f"🏗 العقد {r['contract_number']} · {r['customer_name']} "
                    f"قارب على نهاية «{r['stage']}»: بقي {left} يوم "
                    f"({r['days']} من {r['expected']})",
                    {"age": 0}))
    return out


# ============================================================
# ترحيل العقود القديمة إلى نظام مراحل التنفيذ (زر أدوات المطور)
# ============================================================
def migrate_legacy_stages(user_id: int | None = None) -> dict:
    """تهيئة القواعد القديمة لنظام مراحل التنفيذ:

    1. استبدال مراحل العقود المسطحة القديمة بالشجرة الافتراضية
       (سجلات الحركة القديمة تُحذف — كانت للوحة السحب والإفلات فقط).
    2. وضع كل عقد قائم في مرحلة مناسبة بحسب تاريخه:
       أقدم من 180 يومًا ← التسليم النهائي · أحدث ← الأساسات.
    3. زرع مرحلة «غير متعاقد» للعملاء بلا عقود + زرع مراحل النظام
       إن لم تكن مزروعة (قواعد أقدم من هذا التحديث).
    """
    from database.database import get_connection as _gc
    summary = {"contracts": 0, "customers": 0,
               "stages_reset": False}
    with _gc() as conn:
        old = conn.execute(
            "SELECT stage_name FROM workflow_stages "
            "WHERE transaction_type=? AND COALESCE(contract_type,'')=''",
            (TX_CONTRACT,)).fetchall()
        tree_names = {m for m, _c, _subs in DEFAULT_EXEC_TREE} | \
            {sub for _m, _c, subs in DEFAULT_EXEC_TREE
             for sub, _d in subs}
        has_tree = any(r["stage_name"] in tree_names for r in old)
        if old and not has_tree:
            # 1) حذف حركات العقود القديمة ثم المراحل المسطحة القديمة
            conn.execute(
                "DELETE FROM transaction_stage_log "
                "WHERE transaction_type=?", (TX_CONTRACT,))
            conn.execute(
                "DELETE FROM workflow_stages WHERE transaction_type=? "
                "AND COALESCE(contract_type,'')='' ", (TX_CONTRACT,))
            summary["stages_reset"] = True
            # 2) زرع الشجرة الافتراضية
            order = 1
            for main, main_color, subs in DEFAULT_EXEC_TREE:
                cur = conn.execute(
                    "INSERT INTO workflow_stages "
                    "(transaction_type, stage_name, stage_order, color, "
                    "parent_id, expected_days) VALUES (?, ?, ?, ?, NULL, 0)",
                    (TX_CONTRACT, main, order, stage_color(main_color)))
                order += 1
                main_id = int(cur.lastrowid)
                for sub, days in subs:
                    conn.execute(
                        "INSERT INTO workflow_stages "
                        "(transaction_type, stage_name, stage_order, "
                        "color, parent_id, expected_days) "
                        "VALUES (?, ?, ?, ?, ?, ?)",
                        (TX_CONTRACT, sub, order,
                         stage_color(main_color), main_id, days))
                    order += 1
    # (لا زرع تلقائي للأنواع — النوع يبدأ فاضي ويبنيه المستخدم.)
    # الاستثناء الوحيد: قالب «غير محدد» للعقود بلا نوع — يُزرع
    # الافتراضي إن لم يوجد قالب له بعد استبدال المسطح القديم.
    with _gc() as conn:
        from services.contract_type_service import UNSPECIFIED as _U
        has_unspec = conn.execute(
            "SELECT 1 FROM workflow_stages WHERE transaction_type=? "
            "AND COALESCE(contract_type,'')=? LIMIT 1",
            (TX_CONTRACT, _U)).fetchone()
        if not has_unspec:
            _seed_type_defaults(conn, _U)

        # إعادة ربط دفعات كانت مربوطة بمراحل القالب العام بأسمائها
        # في قالب نوع عقد كل عقد
        rows = conn.execute(
            "SELECT p.id AS pid, p.contract_id, p.stage_id, "
            "c.contract_type FROM payment_plan p "
            "JOIN contracts c ON c.id=p.contract_id "
            "JOIN workflow_stages g ON g.id=p.stage_id "
            "WHERE COALESCE(g.contract_type,'')=''").fetchall()
        for r in rows:
            scope = _stage_scope(r["contract_type"] or "")
            match = conn.execute(
                "SELECT id FROM workflow_stages WHERE transaction_type=? "
                "AND COALESCE(contract_type,'')=? AND stage_name="
                "(SELECT stage_name FROM workflow_stages WHERE id=?) "
                "LIMIT 1", (TX_CONTRACT, scope, r["stage_id"])).fetchone()
            if match:
                conn.execute(
                    "UPDATE payment_plan SET stage_id=? WHERE id=?",
                    (match["id"], r["pid"]))


    # نقل روابط المراحل القديمة (عمود stage_id) إلى جدول المجموعات —
    # ليصبح دفع القاعدة: الدفعة تجمع مرحلة أو أكثر
    with _gc() as conn:
        for r in conn.execute(
                "SELECT id, contract_type, stage_id FROM type_payment_tpl "
                "WHERE stage_id IS NOT NULL").fetchall():
            conn.execute(
                "INSERT OR IGNORE INTO type_payment_stages (payment_id, "
                "stage_id) VALUES (?,?)", (r["id"], r["stage_id"]))

    # تحويل نسب الدفعات القديمة (كانت على المراحل) إلى قوالب دفعات
    # الأنواع — كل مرحلة ذات نسبة تصبح دفعة برقم تسلسلي مربوطة بها
    with _gc() as conn:
        types = [r["name"] for r in conn.execute(
            "SELECT name FROM contract_types WHERE active=1").fetchall()]
        for tname in types:
            scope = _stage_scope(tname)
            has_tpl = conn.execute(
                "SELECT 1 FROM type_payment_tpl WHERE contract_type=? "
                "LIMIT 1", (scope,)).fetchone()
            if has_tpl:
                continue
            stages = conn.execute(
                "SELECT id, stage_name, expected_days, payment_pct "
                "FROM workflow_stages WHERE transaction_type='contract' "
                "AND COALESCE(contract_type,'')=? ORDER BY stage_order",
                (scope,)).fetchall()
            pay_no = 1
            for s in stages:
                pct = float(s["payment_pct"] or 0)
                if pct <= 0:
                    continue
                conn.execute(
                    "INSERT OR IGNORE INTO type_payment_tpl "
                    "(contract_type, pay_no, title, pct, stage_id, "
                    "days_offset) VALUES (?,?,?,?,?,?)",
                    (scope, pay_no, f"دفعة {s['stage_name']}", pct,
                     s["id"], stage_cumulative_days(scope, s["id"])))
                pay_no += 1

    # زرع مرحلة العميل المحتمل إن لم توجد
    with _gc() as conn:
        has_customer = conn.execute(
            "SELECT 1 FROM workflow_stages WHERE transaction_type=? "
            "AND is_pre_contract=1", (TX_CUSTOMER,)).fetchone()
        if not has_customer:
            for name, days, pre in DEFAULT_CUSTOMER_STAGES:
                conn.execute(
                    "INSERT OR IGNORE INTO workflow_stages "
                    "(transaction_type, stage_name, stage_order, color, "
                    "parent_id, expected_days, is_pre_contract) "
                    "VALUES (?, ?, 1, ?, NULL, ?, ?)",
                    (TX_CUSTOMER, name, stage_color("warn"), days, pre))
    # 3) Snapshot لكل عقد قائم بلا نسخة (بحسب تاريخ العقد):
    #    أقدم من 180 يومًا ← كل الخطوات منتهية (في آخرها) · أحدث ←
    #    الخطوة الأولى مفتوحة بتاريخ العقد
    with _gc() as conn:
        contracts = conn.execute(
            "SELECT c.id, c.contract_type, COALESCE(NULLIF(c.start_date,"
            "''), NULLIF(c.contract_date,'')) AS d, c.amount "
            "FROM contracts c WHERE c.status <> 'ملغى'").fetchall()
        for c in contracts:
            has_snap = conn.execute(
                "SELECT 1 FROM contract_stages WHERE contract_id=?",
                (c["id"],)).fetchone()
            if has_snap:
                continue
            ctype = _stage_scope(c["contract_type"] or "")
            start_day = (c["d"] or date.today().isoformat())
            age = _days_between(date.today().isoformat(), start_day)
            n = _build_contract_snapshot(int(c["id"]), ctype, start_day)
            if n == 0:
                continue
            steps = conn.execute(
                "SELECT id FROM contract_stages WHERE contract_id=? "
                "AND level=1 ORDER BY sort_order",
                (c["id"],)).fetchall()
            if age > 180:
                # عقد قديم: كل خطواته منتهية بتاريخ العقد
                for s in steps:
                    conn.execute(
                        "UPDATE contract_stages SET start_date=?, "
                        "end_date=?, closed_by='الترحيل' WHERE id=?",
                        (start_day, start_day, s["id"]))
            else:
                # عقد أحدث: كل ما قبل الأخيرة منتهية والأخيرة مفتوحة
                for s in steps[:-1]:
                    conn.execute(
                        "UPDATE contract_stages SET start_date=?, "
                        "end_date=?, closed_by='الترحيل' WHERE id=?",
                        (start_day, start_day, s["id"]))
                if steps:
                    conn.execute(
                        "UPDATE contract_stages SET start_date=? "
                        "WHERE id=?", (start_day, steps[-1]["id"]))
            # خطة السداد من قالب دفعات النوع (إن وجد)، وإلا من إعدادات
            # الدفع القديمة داخل المراحل نفسها.
            made = _generate_type_payments_from_template(
                int(c["id"]), ctype, float(c["amount"] or 0), start_day)
            if made == 0 and not type_payments(ctype):
                _generate_payments_from_snapshot(
                    int(c["id"]), float(c["amount"] or 0), start_day)
            summary["contracts"] += 1
        # العملاء بلا عقود ← مرحلة «غير متعاقد»
        customers = conn.execute(
            "SELECT cu.id, cu.created_at FROM customers cu "
            "WHERE NOT EXISTS (SELECT 1 FROM contracts c "
            " WHERE c.customer_id = cu.id AND c.status <> 'ملغى')"
        ).fetchall()
        pre = conn.execute(
            "SELECT id FROM workflow_stages WHERE transaction_type=? "
            "AND is_pre_contract=1 ORDER BY stage_order LIMIT 1",
            (TX_CUSTOMER,)).fetchone()
        if pre:
            for cu in customers:
                exists = conn.execute(
                    "SELECT 1 FROM transaction_stage_log "
                    "WHERE transaction_type=? AND transaction_id=?",
                    (TX_CUSTOMER, cu["id"])).fetchone()
                if exists:
                    continue
                conn.execute(
                    "INSERT INTO transaction_stage_log "
                    "(transaction_type, transaction_id, stage_id, "
                    "moved_by, note, start_date) "
                    "VALUES (?, ?, ?, ?, 'تهيئة العملاء المحتملين', ?)",
                    (TX_CUSTOMER, cu["id"], pre["id"], _uid(user_id),
                     str(cu["created_at"] or "")[:10]
                     or date.today().isoformat()))
                summary["customers"] += 1
    return summary
