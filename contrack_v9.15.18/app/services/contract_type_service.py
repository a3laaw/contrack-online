# -*- coding: utf-8 -*-
"""أنواع العقود المعتمدة · تُدار من الإعدادات وتُختار عند إنشاء أي عقد.

كل نوع له مبلغ افتراضي يُملأ تلقائيًا في نافذة العقد (قابل للتعديل)،
حتى لا يُدخل السكرتير قيمة مختلفة في كل مرة لنفس نوع العمل.
"""
import time

from database.database import get_connection
from services.customer_service import ValidationError


# أنماط التسعير المعتمدة (النوع هو مصدر الحقيقة الوحيد)
MODE_LUMP = "lump"          # مبلغ مقطوع
MODE_UNIT = "unit"          # الكمية × سعر الوحدة (ومنه الإشراف: شهر × قيمة)
MODE_ITEMS = "items"        # بنود مقابل أسعار
MODE_BUNDLE = "bundle"      # V3.30: عقد شامل (مكوّنات نطاق اختيارية)
MODES = {
    MODE_LUMP: "مبلغ مقطوع",
    MODE_UNIT: "وحدة × سعر",
    MODE_ITEMS: "بنود مقابل أسعار",
    MODE_BUNDLE: "عقد شامل (مكوّنات)",
}

_CACHE_TTL = 30.0
_types_cache: dict[bool, tuple[float, list[dict]]] = {}


def clear_cache() -> None:
    _types_cache.clear()


def mode_label(mode: str) -> str:
    return MODES.get((mode or "").strip() or MODE_LUMP, MODES[MODE_LUMP])


def type_config(name: str) -> dict:
    # V2.48: تغليف بذاكرة البناء
    from services.qcache import memo
    return memo(("type_config", name),
                lambda: _type_config_impl(name))


def _type_config_impl(name: str) -> dict:
    """كل ما تحتاجه نافذة العقد عن النوع · مصدر واحد للحقيقة.

    يرجع: {mode, unit_label, unit_price, default_amount, is_supervision}
    ونوع غير موجود يرجع «مبلغ مقطوع» فارغًا (سلوك آمن).
    """
    empty = {"mode": MODE_LUMP, "unit_label": "", "unit_price": 0.0,
             "default_amount": 0.0, "is_supervision": False,
             "is_bundle": False, "manual_track": False}
    if not name:
        return empty
    with get_connection() as conn:
        row = conn.execute(
            "SELECT pricing_mode, unit_label, unit_price, default_amount, "
            "is_supervision, manual_track FROM contract_types WHERE name=?",
            (name,)).fetchone()
    if not row:
        return empty
    mode = (row["pricing_mode"] or "").strip()
    if mode not in MODES:
        mode = MODE_UNIT if float(row["unit_price"] or 0) > 0 else MODE_LUMP
    return {"mode": mode,
            "unit_label": (row["unit_label"] or "").strip(),
            "unit_price": float(row["unit_price"] or 0),
            "default_amount": float(row["default_amount"] or 0),
            "is_supervision": bool(row["is_supervision"]),
            "is_bundle": mode == MODE_BUNDLE,
            "manual_track": bool(row["manual_track"])}


def list_types(active_only: bool = True) -> list[dict]:
    """كل الأنواع مرتبة أبجديًا · مع كاش قصير مناسب للشبكة."""
    now = time.monotonic()
    key = bool(active_only)
    cached = _types_cache.get(key)
    if cached and now - cached[0] <= _CACHE_TTL:
        return [dict(r) for r in cached[1]]
    where = "WHERE t.active = 1" if active_only else ""
    with get_connection() as conn:
        rows = [dict(r) for r in conn.execute(f"""
            SELECT t.*,
                   (SELECT COUNT(*) FROM contracts c
                    WHERE c.contract_type = t.name) AS contracts_count
            FROM contract_types t
            {where}
            ORDER BY t.name
        """).fetchall()]
    _types_cache[key] = (now, [dict(r) for r in rows])
    return rows


def get_type(type_id: int) -> dict | None:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM contract_types WHERE id=?",
                           (type_id,)).fetchone()
    return dict(row) if row else None


def type_amount(name: str) -> float:
    """المبلغ الافتراضي لنوع بالاسم (صفر إن لم يوجد)."""
    if not name:
        return 0.0
    with get_connection() as conn:
        row = conn.execute(
            "SELECT default_amount FROM contract_types WHERE name=?",
            (name,)).fetchone()
    return float(row["default_amount"]) if row else 0.0


def _validate(name: str, amount: float) -> None:
    if not (name or "").strip():
        raise ValidationError("اسم نوع العقد مطلوب.")
    if amount < 0:
        raise ValidationError("المبلغ لا يمكن أن يكون سالبًا.")


def type_unit(name: str) -> dict:
    # V2.48: تغليف بذاكرة البناء
    from services.qcache import memo
    return memo(("type_unit", name),
                lambda: _type_unit_impl(name))


def _type_unit_impl(name: str) -> dict:
    """وحدة القياس وسعر الوحدة لنوع بالاسم.

    يرجع دائمًا قاموسًا: {"unit_label": str, "unit_price": float}
    ووحدة فارغة تعني «النوع يُسعَّر بمبلغ مقطوع» (الكمية 1).
    """
    empty = {"unit_label": "", "unit_price": 0.0}
    if not name:
        return empty
    with get_connection() as conn:
        row = conn.execute(
            "SELECT unit_label, unit_price FROM contract_types WHERE name=?",
            (name,)).fetchone()
    if not row:
        return empty
    return {"unit_label": (row["unit_label"] or "").strip(),
            "unit_price": float(row["unit_price"] or 0)}


def _clean_mode(mode: str, unit_price: float = 0.0) -> str:
    """نمط صالح دائمًا · وفارغ يعني: اشتقّه من سعر الوحدة (توافق خلفي)."""
    mode = (mode or "").strip()
    if mode in MODES:
        return mode
    return MODE_UNIT if float(unit_price or 0) > 0 else MODE_LUMP


def _validate_unit(unit_price: float) -> None:
    if unit_price is not None and float(unit_price) < 0:
        raise ValidationError("سعر الوحدة لا يمكن أن يكون سالبًا.")


def add_type(name: str, default_amount: float = 0.0,
             notes: str = "", unit_label: str = "",
             unit_price: float = 0.0, pricing_mode: str = "",
             is_supervision: bool = False,
             manual_track: bool = False) -> int:
    name = (name or "").strip()
    _validate(name, default_amount)
    _validate_unit(unit_price)
    # V3.30: الشامل حاوية نطاق — الإشراف مكوّن بداخله لا علامة نوع.
    if _clean_mode(pricing_mode, unit_price) == MODE_BUNDLE \
            and is_supervision:
        raise ValidationError(
            "النوع الشامل لا يكون إشرافيًا — أضف الإشراف مكوّنًا بداخله.")
    with get_connection() as conn:
        exists = conn.execute(
            "SELECT 1 FROM contract_types WHERE name=?", (name,)).fetchone()
        if exists:
            raise ValidationError(f"النوع «{name}» موجود بالفعل.")
        # الربط مع شجرة المراحل يتم صراحة من تبويب «مراحل المتابعة»
        # عبر زر «شجرة جديدة / ربط نوع عقد» حتى لا يأخذ النوع الجديد
        # شجرة النظام افتراضيًا دون قصد.
        cur = conn.execute(
            "INSERT INTO contract_types (name, default_amount, notes, "
            "unit_label, unit_price, pricing_mode, is_supervision, "
            "manual_track) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (name, float(default_amount), notes.strip(),
             (unit_label or "").strip(), float(unit_price or 0),
             _clean_mode(pricing_mode, unit_price),
             1 if is_supervision else 0, 1 if manual_track else 0))
        new_id = int(cur.lastrowid)
    clear_cache()
    return new_id


def update_type(type_id: int, name: str, default_amount: float,
                notes: str = "", unit_label: str = "",
                unit_price: float = 0.0, pricing_mode: str = "",
                is_supervision: bool = False,
                manual_track: bool = False) -> None:
    name = (name or "").strip()
    _validate(name, default_amount)
    _validate_unit(unit_price)
    if _clean_mode(pricing_mode, unit_price) == MODE_BUNDLE \
            and is_supervision:
        raise ValidationError(
            "النوع الشامل لا يكون إشرافيًا — أضف الإشراف مكوّنًا بداخله.")
    old = get_type(type_id)
    if not old:
        raise ValidationError("النوع غير موجود.")
    with get_connection() as conn:
        clash = conn.execute(
            "SELECT 1 FROM contract_types WHERE name=? AND id<>?",
            (name, type_id)).fetchone()
        if clash:
            raise ValidationError(f"النوع «{name}» موجود بالفعل.")
        conn.execute(
            "UPDATE contract_types SET name=?, default_amount=?, notes=?, "
            "unit_label=?, unit_price=?, pricing_mode=?, is_supervision=?, "
            "manual_track=? WHERE id=?",
            (name, float(default_amount), notes.strip(),
             (unit_label or "").strip(), float(unit_price or 0),
             _clean_mode(pricing_mode, unit_price),
             1 if is_supervision else 0, 1 if manual_track else 0,
             type_id))
        # تغيير الاسم ينعكس على العقود المرتبطة (الربط بالاسم)
        # وعلى قالب مراحل النوع كذلك
        if old["name"] != name:
            conn.execute(
                "UPDATE contracts SET contract_type=? WHERE contract_type=?",
                (name, old["name"]))
            conn.execute(
                "UPDATE workflow_stages SET contract_type=? "
                "WHERE transaction_type='contract' "
                "AND COALESCE(contract_type,'')=?",
                (name, old["name"]))
            conn.execute(
                "UPDATE type_payment_tpl SET contract_type=? "
                "WHERE contract_type=?", (name, old["name"]))
            conn.execute(
                "UPDATE type_bundle_components SET type_name=? "
                "WHERE type_name=?", (name, old["name"]))
    clear_cache()


def delete_type(type_id: int) -> None:
    """حذف نوع · يُرفض إن كان مستخدمًا في عقود قائمة."""
    t = get_type(type_id)
    if not t:
        raise ValidationError("النوع غير موجود.")
    with get_connection() as conn:
        used = conn.execute(
            "SELECT COUNT(*) FROM contracts WHERE contract_type=?",
            (t["name"],)).fetchone()[0]
        try:
            from services import auth_service as _auth
            dev = _auth.is_developer()
        except Exception:
            dev = False
        if used and not dev:
            raise ValidationError(
                f"لا يمكن حذف «{t['name']}» لأنه مستخدم في {used} عقد.\n"
                "يمكنك تعطيله بدل حذفه.")
        # قالب مراحل النوع غير المستخدم يُحذف معه (فك أي ربط دفعات)
        # وقالب دفعاته كذلك
        conn.execute(
            "DELETE FROM type_bundle_components WHERE type_name=?",
            (t["name"],))
        conn.execute(
            "DELETE FROM type_payment_tpl WHERE contract_type=?",
            (t["name"],))
        conn.execute(
            "UPDATE payment_plan SET stage_id=NULL WHERE stage_id IN ("
            "SELECT id FROM workflow_stages WHERE transaction_type="
            "'contract' AND COALESCE(contract_type,'')=?)",
            (t["name"],))
        conn.execute(
            "DELETE FROM workflow_stages WHERE transaction_type="
            "'contract' AND COALESCE(contract_type,'')=? "
            "AND id NOT IN (SELECT DISTINCT stage_id FROM "
            "transaction_stage_log WHERE stage_id IS NOT NULL)",
            (t["name"],))
        conn.execute("DELETE FROM contract_types WHERE id=?", (type_id,))
    clear_cache()


def set_active(type_id: int, active: bool) -> None:
    """تعطيل نوع: يختفي من قائمة العقود الجديدة ويبقى في التقارير."""
    with get_connection() as conn:
        conn.execute("UPDATE contract_types SET active=? WHERE id=?",
                     (1 if active else 0, type_id))
    clear_cache()


def types_report() -> dict:
    """تقرير أنواع العقود: لكل نوع عدد العقود وقيمتها والمحصّل والمتبقي.

    القيمة = الأصلية + الملحقات المعتمدة + تمديد الإشراف (قاعدة 35).
    """
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT COALESCE(NULLIF(c.contract_type,''), 'بلا نوع') AS type_name,
                   COUNT(*) AS contracts_count,
                   COALESCE(SUM(c.amount), 0)
                   + COALESCE(SUM((
                       SELECT COALESCE(SUM(a.amount_add - a.amount_deduct), 0)
                       FROM addendums a
                       WHERE a.contract_id = c.id AND a.status = 'معتمد'
                   )), 0) AS value,
                   COALESCE(SUM((
                       SELECT COALESCE(SUM(v.amount), 0) FROM vouchers v
                       WHERE v.contract_id = c.id
                         AND v.vtype = 'receipt' AND v.cancelled = 0
                   )), 0) AS collected
            FROM contracts c
            WHERE c.status != 'ملغى'
            GROUP BY type_name
            ORDER BY value DESC
        """).fetchall()

    # تمديد الإشراف لكل نوع (يُحسب في بايثون · تقويمي لا SQL)
    ext_by_type: dict[str, float] = {}
    try:
        from services.supervision_service import extensions_map
        with get_connection() as conn:
            type_of = {r["id"]: (r["t"] or "بلا نوع") for r in conn.execute(
                "SELECT id, COALESCE(NULLIF(contract_type,''),'بلا نوع') AS t "
                "FROM contracts WHERE status != 'ملغى'").fetchall()}
        for cid, info in extensions_map().items():
            name = type_of.get(cid)
            if name:
                ext_by_type[name] = (ext_by_type.get(name, 0.0)
                                     + float(info.get("extension_value", 0.0)))
    except Exception:
        ext_by_type = {}

    result = []
    for r in rows:
        value = float(r["value"]) + ext_by_type.get(r["type_name"], 0.0)
        collected = float(r["collected"])
        count = int(r["contracts_count"])
        result.append({
            "type_name": r["type_name"],
            "contracts_count": count,
            "value": value,
            "collected": collected,
            "remaining": value - collected,
            "average": value / count if count else 0.0,
            "default_amount": type_amount(r["type_name"]),
        })

    totals = {
        "count": sum(x["contracts_count"] for x in result),
        "value": sum(x["value"] for x in result),
        "collected": sum(x["collected"] for x in result),
        "remaining": sum(x["remaining"] for x in result),
    }
    return {"rows": result, "totals": totals}


UNSPECIFIED = "غير محدد"


def contracts_without_type() -> list[dict]:
    """العقود التي لا نوع لها (أو «غير محدد») · لأداة التحديد الجماعي."""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT c.id, c.contract_number, "
            "COALESCE(NULLIF(c.contract_name,''), c.description) AS name, "
            "c.amount, c.contract_date, c.status, cu.name AS customer_name "
            "FROM contracts c LEFT JOIN customers cu ON cu.id = c.customer_id "
            "WHERE COALESCE(c.contract_type,'') IN ('', ?) "
            "ORDER BY c.id DESC", (UNSPECIFIED,)).fetchall()
    return [dict(r) for r in rows]


def assign_type_bulk(contract_ids: list[int], type_name: str) -> int:
    """تحديد نوع واحد لمجموعة عقود دفعة واحدة. يرجع عدد العقود المعدّلة."""
    name = (type_name or "").strip()
    if not name:
        raise ValidationError("اختر نوع العقد أولاً.")
    ids = [int(i) for i in contract_ids if i]
    if not ids:
        raise ValidationError("اختر عقدًا واحدًا على الأقل.")
    with get_connection() as conn:
        exists = conn.execute(
            "SELECT 1 FROM contract_types WHERE name=?", (name,)).fetchone()
        if not exists:
            raise ValidationError(
                f"النوع «{name}» غير موجود في قائمة أنواع العقود.")
        marks = ",".join("?" * len(ids))
        cur = conn.execute(
            f"UPDATE contracts SET contract_type=? WHERE id IN ({marks})",
            [name] + ids)
        return cur.rowcount


# ============================================================
# V3.30: مكوّنات العقد الشامل (نطاق اختياري بلا أثر على الإجمالي)
# ============================================================
BUNDLE_KINDS = {
    "qty": "عدد × سعر مرجعي",
    "supervision": "إشراف (أشهر × شهري)",
    "items": "بنود بأسعار",
}


def bundle_kind_label(kind: str) -> str:
    return BUNDLE_KINDS.get((kind or "").strip(), "عدد × سعر مرجعي")


def list_bundle_components(type_name: str) -> list[dict]:
    """مكوّنات النوع الشامل مرتبة · فارغة لغير الشامل."""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT type_name, comp_key, label, kind, required, "
            "default_enabled, default_qty, unit_label, ref_price, "
            "default_months, default_monthly, sort_order "
            "FROM type_bundle_components WHERE type_name=? "
            "ORDER BY sort_order, id", (type_name,)).fetchall()
    return [dict(r) for r in rows]


def save_bundle_components(type_name: str, comps: list[dict]) -> int:
    """استبدال كامل لمكوّنات النوع (من الإعدادات) · يرجع عددها.

    comp: {comp_key?, label, kind, required, default_enabled,
           default_qty, unit_label, ref_price, default_months,
           default_monthly} — مفتاح فارغ يعني مكوّنًا جديدًا.
    الحذف مرفوض لمكوّن موسومة به مراحل قالب (أعد الوسم أولًا).
    """
    type_name = (type_name or "").strip()
    if not type_name:
        raise ValidationError("اختر نوع العقد أولاً.")
    clean = []
    for i, c in enumerate(comps or []):
        label = ((c.get("label") or "").strip())
        if not label:
            raise ValidationError("اسم المكوّن مطلوب.")
        kind = (c.get("kind") or "qty").strip()
        if kind not in BUNDLE_KINDS:
            raise ValidationError(f"نوع المكوّن «{label}» غير معروف.")
        if kind == "supervision" and int(c.get("default_months") or 0) <= 0:
            raise ValidationError(
                f"مكوّن الإشراف «{label}»: عدد الأشهر الافتراضي مطلوب.")
        clean.append({
            "comp_key": (c.get("comp_key") or "").strip(),
            "label": label, "kind": kind,
            "required": 1 if c.get("required") else 0,
            "default_enabled": 0 if c.get("default_enabled") is False
            or str(c.get("default_enabled", "1")) == "0" else 1,
            "default_qty": float(c.get("default_qty") or 1),
            "unit_label": (c.get("unit_label") or "").strip(),
            "ref_price": float(c.get("ref_price") or 0),
            "default_months": int(c.get("default_months") or 0),
            "default_monthly": float(c.get("default_monthly") or 0),
            "sort_order": i + 1,
        })
    with get_connection() as conn:
        old_keys = {r[0] for r in conn.execute(
            "SELECT comp_key FROM type_bundle_components "
            "WHERE type_name=?", (type_name,)).fetchall()}
        new_keys = {c["comp_key"] for c in clean if c["comp_key"]}
        for gone in sorted(old_keys - new_keys):
            used = conn.execute(
                "SELECT COUNT(*) FROM workflow_stages "
                "WHERE transaction_type='contract' "
                "AND COALESCE(contract_type,'')=? "
                "AND COALESCE(component_key,'')=?",
                (type_name, gone)).fetchone()[0]
            if used:
                raise ValidationError(
                    "المكوّن المحذوف موسومة به مراحل في القالب — "
                    "أعد وسمها أولًا.")
        conn.execute("DELETE FROM type_bundle_components "
                     "WHERE type_name=?", (type_name,))
        import uuid as _uuid
        for c in clean:
            if not c["comp_key"]:
                c["comp_key"] = f"m{_uuid.uuid4().hex[:10]}"
            conn.execute(
                "INSERT INTO type_bundle_components (type_name, comp_key, "
                "label, kind, required, default_enabled, default_qty, "
                "unit_label, ref_price, default_months, default_monthly, "
                "sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (type_name, c["comp_key"], c["label"], c["kind"],
                 c["required"], c["default_enabled"], c["default_qty"],
                 c["unit_label"], c["ref_price"], c["default_months"],
                 c["default_monthly"], c["sort_order"]))
    clear_cache()
    return len(clean)
