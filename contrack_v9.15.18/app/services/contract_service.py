# -*- coding: utf-8 -*-
"""منطق الأعمال الخاص بالعقود · الرصيد يُحسب دائمًا من البيانات ولا يُخزَّن."""
import sqlite3

from database.database import get_connection, DatabaseError
from database.models import Contract
from services.search_utils import normalized_search_clause
from services.customer_service import ValidationError

_BASE_SQL = """
SELECT c.*, cu.name AS customer_name,
       COALESCE((SELECT SUM(i.amount) FROM invoices i WHERE i.contract_id = c.id), 0)
           AS total_invoiced
FROM contracts c
JOIN customers cu ON cu.id = c.customer_id
"""


def _row_to_contract(row) -> Contract:
    total = float(row["total_invoiced"] or 0)
    amount = float(row["amount"])
    keys = row.keys()
    return Contract(
        id=row["id"], contract_number=row["contract_number"],
        contract_name=display_contract_name(
            (row["contract_type"] if "contract_type" in keys else "") or ""),
        customer_id=row["customer_id"], contract_date=row["contract_date"],
        description=row["description"] or "", amount=amount,
        notes=row["notes"] or "", created_at=row["created_at"],
        contract_type=(row["contract_type"] if "contract_type" in keys
                       else "") or "",
        customer_name=row["customer_name"],
        total_invoiced=total, remaining=amount - total,
        sup_start_date=(row["sup_start_date"]
                        if "sup_start_date" in keys else "") or "",
        sup_months=int((row["sup_months"] if "sup_months" in keys
                        else 0) or 0),
        sup_monthly=float((row["sup_monthly"] if "sup_monthly" in keys
                           else 0) or 0),
        sup_discount=float((row["sup_discount"] if "sup_discount" in keys
                            else 0) or 0),
        sup_waived_months=float((row["sup_waived_months"]
                                 if "sup_waived_months" in keys else 0) or 0),
        created_by=(row["created_by"] if "created_by" in keys else "") or "",
        updated_at=(row["updated_at"] if "updated_at" in keys else "") or "",
        updated_by=(row["updated_by"] if "updated_by" in keys else "") or "",
        qty=float((row["qty"] if "qty" in keys else 1) or 1),
        unit_price=float((row["unit_price"] if "unit_price" in keys
                          else 0) or 0),
    )


def next_contract_number() -> str:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT contract_number FROM contracts "
            "WHERE contract_number LIKE 'CON-%' "
            "ORDER BY CAST(SUBSTR(contract_number, 5) AS INTEGER) DESC LIMIT 1"
        ).fetchone()
    num = 1
    if row:
        try:
            num = int(row["contract_number"].split("-")[1]) + 1
        except (IndexError, ValueError):
            with get_connection() as conn:
                num = conn.execute("SELECT COUNT(*) FROM contracts").fetchone()[0] + 1
    return f"CON-{num:04d}"


def _contracts_where(search: str = "",
                     customer_id: int | None = None) -> tuple[str, list]:
    """جملة WHERE ومعاملاتها للعقود (مشتركة بين العد والجلب)."""
    where, params = [], []
    if (search or "").strip():
        clause, p = normalized_search_clause(
            ["c.contract_number", "cu.name", "cu.phone", "cu.customer_code",
             "c.contract_name", "c.description"], search)
        where.append(clause)
        params += p
    if customer_id:
        where.append("c.customer_id = ?")
        params.append(customer_id)
    return ((" WHERE " + " AND ".join(where)) if where else ""), params


def list_contracts(search: str = "", customer_id: int | None = None,
                   limit: int | None = None,
                   offset: int = 0) -> list[Contract]:
    # V2.48: تغليف بذاكرة البناء
    from services.qcache import memo
    return memo(("list_contracts", search, customer_id, limit, offset),
                lambda: _list_contracts_impl(search, customer_id, limit, offset))


def _list_contracts_impl(search: str = "", customer_id: int | None = None,
                   limit: int | None = None,
                   offset: int = 0) -> list[Contract]:
    """قائمة العقود.

    limit/offset اختياريان: عند تمريرهما يتم الترقيم داخل قاعدة
    البيانات بدل جلب كل السجلات ثم تقطيعها. بدونهما السلوك كما كان.
    """
    where, params = _contracts_where(search, customer_id)
    sql = _BASE_SQL + where + " ORDER BY c.id DESC"
    if limit is not None:
        sql += " LIMIT ? OFFSET ?"
        params = params + [int(limit), int(offset or 0)]
    with get_connection() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [_row_to_contract(r) for r in rows]


def count_contracts_filtered(search: str = "",
                             customer_id: int | None = None) -> int:
    """عدد العقود المطابقة — لحساب الصفحات بلا جلب البيانات."""
    where, params = _contracts_where(search, customer_id)
    sql = ("SELECT COUNT(*) FROM contracts c "
           "LEFT JOIN customers cu ON cu.id = c.customer_id" + where)
    with get_connection() as conn:
        return int(conn.execute(sql, params).fetchone()[0])


def existing_active_contracts_for_customer_type(customer_id: int, contract_type: str,
                                                exclude_id: int | None = None) -> list[Contract]:
    """عقود نشطة/غير ملغاة لنفس العميل ونفس نوع العقد للتحذير قبل التكرار."""
    ctype = (contract_type or "").strip()
    if not customer_id or not ctype:
        return []
    sql = _BASE_SQL + (
        " WHERE c.customer_id=? AND COALESCE(c.contract_type,'')=? "
        "AND COALESCE(c.status,'')!='ملغى'"
    )
    params: list = [customer_id, ctype]
    if exclude_id:
        sql += " AND c.id<>?"
        params.append(exclude_id)
    sql += " ORDER BY c.id DESC"
    with get_connection() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [_row_to_contract(r) for r in rows]


def get_contract(contract_id: int) -> Contract | None:
    # V2.48: تغليف بذاكرة البناء (مركز العقد كان يقرأ نفس العقد 12 مرة)
    from services.qcache import memo
    return memo(("get_contract", contract_id),
                lambda: _get_contract_impl(contract_id))


def _get_contract_impl(contract_id: int) -> Contract | None:
    with get_connection() as conn:
        row = conn.execute(_BASE_SQL + " WHERE c.id = ?", (contract_id,)).fetchone()
    return _row_to_contract(row) if row else None




def display_contract_name(contract_type: str) -> str:
    """اسم العقد المعروض للمستخدم = نوع العقد المختار فقط."""
    name = (contract_type or "").strip()
    return name or "غير محدد"

def pricing(qty: float, unit_price: float, amount: float,
            unit_label: str = "") -> dict:
    """تفصيل تسعير العقد · يُحسب دائمًا ولا يُخزَّن (قاعدة 3).

    الإجمالي قبل الخصم = الكمية × سعر الوحدة
    الخصم = الإجمالي - القيمة الفعلية (سالب = زيادة على السعر)

    يرجع: {gross, discount, percent, is_discount, is_increase, has_qty, text}
    """
    qty = float(qty or 0)
    unit_price = float(unit_price or 0)
    amount = float(amount or 0)
    gross = round(qty * unit_price, 3)
    has_qty = qty > 0 and unit_price > 0
    diff = round(gross - amount, 3)
    percent = (abs(diff) / gross * 100) if (has_qty and gross > 0) else 0.0
    unit = (unit_label or "وحدة").strip()
    qty_text = f"{qty:g} {unit} × {unit_price:,.3f}"
    if not has_qty:
        text = ""
    elif abs(diff) < 0.001:
        text = f"{qty_text} = {gross:,.3f} د.ك"
    elif diff > 0:
        text = (f"{qty_text} = {gross:,.3f} · المخصوم "
                f"{diff:,.3f} د.ك ({percent:,.1f}%) · "
                f"الصافي {amount:,.3f} د.ك")
    else:
        text = (f"{qty_text} = {gross:,.3f} · زيادة "
                f"{abs(diff):,.3f} د.ك ({percent:,.1f}%) · "
                f"الصافي {amount:,.3f} د.ك")
    return {"gross": gross, "discount": max(diff, 0.0),
            "increase": max(-diff, 0.0), "diff": diff, "percent": percent,
            "is_discount": has_qty and diff > 0.001,
            "is_increase": has_qty and diff < -0.001,
            "has_qty": has_qty, "unit": unit, "text": text}


def contract_pricing(contract) -> dict:
    """تفصيل تسعير عقد جاهز · يقبل كائن Contract أو صفًا/قاموسًا."""
    def _get(key, default=None):
        if isinstance(contract, dict):
            return contract.get(key, default)
        try:
            return contract[key]           # sqlite3.Row
        except (TypeError, IndexError, KeyError):
            return getattr(contract, key, default)

    unit_label = ""
    try:
        from services import contract_type_service as cts
        unit_label = cts.type_unit(_get("contract_type", "") or "")[
            "unit_label"]
    except Exception:
        unit_label = ""
    return pricing(_get("qty", 1) or 1, _get("unit_price", 0) or 0,
                   _get("amount", 0) or 0, unit_label)


def items_total(contract_id: int) -> float:
    """مجموع بنود العقد (بنود الأعمال) · يُحسب ولا يُخزَّن."""
    if not contract_id:
        return 0.0
    with get_connection() as conn:
        row = conn.execute(
            "SELECT COALESCE(SUM(qty * unit_price), 0) AS t "
            "FROM boq_items WHERE contract_id=? "
            "AND COALESCE(deleted_addendum_id,0)=0", (contract_id,)).fetchone()
    return float(row["t"] or 0)


def items_count(contract_id: int) -> int:
    if not contract_id:
        return 0
    with get_connection() as conn:
        return int(conn.execute(
            "SELECT COUNT(*) FROM boq_items WHERE contract_id=? "
            "AND COALESCE(deleted_addendum_id,0)=0",
            (contract_id,)).fetchone()[0])


def get_contract_components(contract_id: int) -> list[dict]:
    """V3.30: لقطة مكوّنات العقد الشامل (فارغة لغير الشامل)."""
    if not contract_id:
        return []
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT contract_id, comp_key, label, kind, enabled, qty, "
            "months, monthly FROM contract_components "
            "WHERE contract_id=? ORDER BY id", (contract_id,)).fetchall()
    return [dict(r) for r in rows]


def save_contract_components(contract_id: int, comps: list[dict]) -> int:
    """V3.30: حفظ لقطة المكوّنات (استبدال كامل) · يرجع عددها.

    comp: {comp_key, label, kind, enabled, qty, months, monthly}.
    """
    with get_connection() as conn:
        conn.execute("DELETE FROM contract_components WHERE contract_id=?",
                     (contract_id,))
        n = 0
        for c in comps or []:
            _key = (c.get("comp_key") or "").strip()
            if not _key:
                continue
            conn.execute(
                "INSERT INTO contract_components (contract_id, comp_key, "
                "label, kind, enabled, qty, months, monthly) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (contract_id, _key, (c.get("label") or "").strip(),
                 (c.get("kind") or "qty").strip(),
                 1 if c.get("enabled") else 0,
                 float(c.get("qty") or 1), int(c.get("months") or 0),
                 float(c.get("monthly") or 0)))
            n += 1
    return n


def seed_contract_components(contract_id: int, type_name: str) -> int:
    """V3.30: تهيئة المكوّنات من افتراضيات النوع (عند غياب اللقطة)."""
    from services import contract_type_service as cts
    if get_contract_components(contract_id):
        return 0
    comps = []
    for t in cts.list_bundle_components(type_name):
        comps.append({
            "comp_key": t["comp_key"], "label": t["label"],
            "kind": t["kind"], "enabled": bool(t["default_enabled"]),
            "qty": float(t["default_qty"] or 1),
            "months": int(t["default_months"] or 0),
            "monthly": float(t["default_monthly"] or 0)})
    if not comps:
        return 0
    return save_contract_components(contract_id, comps)


def contract_mode(contract=None, type_name: str = "") -> str:
    """نمط تسعير العقد · مصدر القرار الوحيد في النظام.

    الترتيب مقصود: بيانات العقد نفسه تسبق إعدادات النوع، حتى لا يتغيّر
    سلوك أي عقد قائم عند تعديل نوعه في الإعدادات.
      1) عقد له تاريخ تعهد إشراف   ⟵ unit (إشراف · وحدته شهر)
      2) عقد له بنود مسجّلة        ⟵ items
      3) عقد له سعر وحدة محفوظ     ⟵ unit
      4) نمط نوعه من الإعدادات
      5) الافتراضي                 ⟵ lump
    """
    from services import contract_type_service as cts

    def _get(key, default=None):
        if contract is None:
            return default
        if isinstance(contract, dict):
            return contract.get(key, default)
        try:
            return contract[key]
        except (TypeError, IndexError, KeyError):
            return getattr(contract, key, default)

    if contract is not None:
        cid = _get("id")
        # V3.30: الشامل نمطه ثابت من نوعه (قد يحمل بنودًا وبيانات
        # إشراف معًا دون أن ينقلب لنمط آخر).
        _tn0 = type_name or (_get("contract_type", "") or "")
        if _tn0 and cts.type_config(_tn0).get("is_bundle"):
            return cts.MODE_BUNDLE
        if cid and items_count(int(cid)) > 0:
            return cts.MODE_ITEMS
        if str(_get("sup_start_date", "") or "").strip():
            return cts.MODE_UNIT
        if float(_get("unit_price", 0) or 0) > 0:
            return cts.MODE_UNIT
        type_name = type_name or (_get("contract_type", "") or "")
    return cts.type_config(type_name)["mode"]


def is_supervision_contract(contract=None, type_name: str = "") -> bool:
    """عقد إشراف: من بياناته أولًا، ثم من علامة نوعه."""
    from services import contract_type_service as cts

    def _get(key, default=None):
        if contract is None:
            return default
        if isinstance(contract, dict):
            return contract.get(key, default)
        try:
            return contract[key]
        except (TypeError, IndexError, KeyError):
            return getattr(contract, key, default)

    if contract is not None and str(_get("sup_start_date", "") or "").strip():
        return True
    name = type_name or (_get("contract_type", "") or "")
    return cts.type_config(name)["is_supervision"]


def _validate(contract: Contract) -> None:
    if not contract.contract_number.strip():
        raise ValidationError("رقم العقد مطلوب.")
    if not contract.customer_id:
        raise ValidationError("يجب اختيار العميل.")
    if not contract.contract_date.strip():
        raise ValidationError("تاريخ العقد مطلوب.")
    if contract.amount is None or contract.amount <= 0:
        raise ValidationError("قيمة العقد يجب أن تكون أكبر من صفر.")


def add_contract(contract: Contract,
                components: list[dict] | None = None,
                scope_stage_ids=None,
                manual_path: bool = False) -> int:
    """إنشاء عقد · components لقطة مكوّنات الشامل (تُحفظ قبل التوقيع
    حتى يُبنى المسار على المفعّل فقط) · scope_stage_ids نطاق V4.48
    (مراحل القالب المختارة — فارغ = الكل) · manual_path للمسار
    اليدوي (يُحفظ العلَم من نوع العقد — وخطة السداد تُبنى دائمًا).
    
    V8.3: يسجل قيد محاسبي عند إنشاء العقد.
    """
    _validate(contract)
    from services import auth_service
    username = auth_service.current_username() or ""
    # حماية من سباق الترقيم على القاعدة المشتركة: لو جهازان حصلا على نفس
    # CON قبل الحفظ، يعيد الثاني توليد رقم جديد ويكمل.
    for attempt in range(8):
        try:
            with get_connection() as conn:
                cur = conn.execute(
                    "INSERT INTO contracts (contract_number, contract_name, "
                    "customer_id, contract_date, description, amount, notes, "
                    "contract_type, created_by, qty, unit_price, "
                    "manual_path) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (contract.contract_number.strip(),
                     display_contract_name(getattr(contract, "contract_type", "") or ""),
                     contract.customer_id,
                     contract.contract_date, contract.description.strip(),
                     contract.amount, contract.notes.strip(),
                     ((getattr(contract, "contract_type", "") or "").strip()
                      or "غير محدد"),
                     username,
                     float(getattr(contract, "qty", 1) or 1),
                     float(getattr(contract, "unit_price", 0) or 0),
                     1 if manual_path else 0),
                )
                new_id = int(cur.lastrowid)
                
                # V8.3: تسجيل قيد محاسبي للعقد
                try:
                    conn.execute(
                        "INSERT INTO journal_entries "
                        "(entry_date, description, amount, "
                        "contract_id, source_type, source_id) "
                        "VALUES (?, ?, ?, ?, ?, ?)",
                        (contract.contract_date,
                         f"إنشاء العقد {contract.contract_number}",
                         float(contract.amount or 0),
                         new_id, "contract", new_id))
                except Exception:
                    pass  # جدول القيود قد لا يكون موجوداً بعد
            
            try:
                from services import lifecycle_service as _lc
                _lc.ensure_auto_project(new_id)
            except Exception:
                pass
            # V3.30: لقطة المكوّنات قبل التوقيع (المسار يُبنى عليها).
            try:
                if components:
                    save_contract_components(new_id, components)
                else:
                    seed_contract_components(
                        new_id,
                        ((getattr(contract, "contract_type", "") or "")
                         .strip() or "غير محدد"))
            except Exception:
                pass
            # V4.48: النطاق قبل التوقيع (المسار والدفعات يُبنيان عليه).
            try:
                if scope_stage_ids:
                    from services import workflow_service as _wf_sc
                    _wf_sc.set_contract_scope(new_id, scope_stage_ids)
            except Exception:
                pass
            try:
                from services import workflow_service as _wf
                _wf.on_contract_signed(
                    new_id,
                    customer_id=getattr(contract, "customer_id", None))
            except Exception:
                pass
            return new_id
        except sqlite3.IntegrityError as exc:
            msg = str(exc).lower()
            if "contract_number" in msg and attempt < 7:
                contract.contract_number = next_contract_number()
                continue
            raise ValidationError("رقم العقد مستخدم من قبل، اختر رقمًا آخر.") from exc
        except sqlite3.Error as exc:
            raise DatabaseError(f"خطأ في قاعدة البيانات: {exc}") from exc
    raise ValidationError("تعذر حجز رقم عقد غير مكرر، حاول مرة أخرى.")

def set_contract_type(contract_id: int, contract_type: str) -> None:
    """V2.50: تغيير نوع العقد فقط (للتراجع عند فشل النسخة الاحتياطية)."""
    with get_connection() as conn:
        conn.execute("UPDATE contracts SET contract_type=? WHERE id=?",
                     ((contract_type or "").strip(), contract_id))


def update_contract(contract: Contract) -> None:
    _validate(contract)
    if not contract.id:
        raise ValidationError("لم يتم تحديد العقد.")
    # منع تخفيض قيمة العقد لأقل من إجمالي الفواتير الصادرة
    current = get_contract(contract.id)
    if current and contract.amount < current.total_invoiced:
        raise ValidationError(
            f"لا يمكن تخفيض قيمة العقد إلى أقل من إجمالي الفواتير الصادرة "
            f"({current.total_invoiced:,.3f})."
        )
    from services import auth_service
    username = auth_service.current_username() or ""
    try:
        with get_connection() as conn:
            conn.execute(
                "UPDATE contracts SET contract_number=?, contract_name=?, "
                "customer_id=?, contract_date=?, "
                "description=?, amount=?, notes=?, contract_type=?, "
                "qty=?, unit_price=?, "
                "updated_at=datetime('now','localtime'), updated_by=? "
                "WHERE id=?",
                (contract.contract_number.strip(),
                 display_contract_name(getattr(contract, "contract_type", "") or ""),
                 contract.customer_id, contract.contract_date, contract.description.strip(),
                 contract.amount, contract.notes.strip(),
                 ((getattr(contract, "contract_type", "") or "").strip()
                  or "غير محدد"),
                 float(getattr(contract, "qty", 1) or 1),
                 float(getattr(contract, "unit_price", 0) or 0),
                 username, contract.id),
            )
    except sqlite3.IntegrityError as exc:
        raise ValidationError("رقم العقد مستخدم من قبل، اختر رقمًا آخر.") from exc
    except sqlite3.Error as exc:
        raise DatabaseError(f"خطأ في قاعدة البيانات: {exc}") from exc


def delete_contract(contract_id: int) -> None:
    """حذف عقد مع التحقق من جميع الارتباطات.
    
    V8.3: يتحقق من:
    - الفواتير
    - السندات المالية
    - المطالبات المالية
    - عقود الباطن
    - الدفعات
    - المراحل
    """
    with get_connection() as conn:
        # 1. التحقق من الفواتير
        invoices = conn.execute(
            "SELECT COUNT(*) FROM invoices WHERE contract_id=?", (contract_id,)
        ).fetchone()[0]
        if invoices:
            raise ValidationError(
                f"لا يمكن حذف العقد لأنه مرتبط بـ {invoices} فاتورة.\n"
                "احذف الفواتير المرتبطة أولاً."
            )
        
        # 2. V8.3: التحقق من السندات المالية
        vouchers = conn.execute(
            "SELECT COUNT(*) FROM vouchers WHERE contract_id=? "
            "AND COALESCE(cancelled,0)=0", (contract_id,)
        ).fetchone()[0]
        if vouchers:
            raise ValidationError(
                f"لا يمكن حذف العقد لأنه مرتبط بـ {vouchers} سند مالي ساري.\n"
                "ألغِ السندات المرتبطة أولًا ثم احذف العقد."
            )
        
        # 3. V8.3: التحقق من المطالبات المالية
        claims = conn.execute(
            "SELECT COUNT(*) FROM claims WHERE contract_id=? "
            "AND COALESCE(status,'') NOT IN ('ملغاة','مسجلة')", (contract_id,)
        ).fetchone()[0]
        if claims:
            raise ValidationError(
                f"لا يمكن حذف العقد لأنه مرتبط بـ {claims} مطالبة مالية سارية.\n"
                "ألغِ المطالبات المرتبطة أولًا ثم احذف العقد."
            )
        
        # 4. V8.3: التحقق من عقود الباطن
        sub_contracts = conn.execute(
            "SELECT COUNT(*) FROM sub_contracts WHERE contract_id=?", (contract_id,)
        ).fetchone()[0]
        if sub_contracts:
            raise ValidationError(
                f"لا يمكن حذف العقد لأنه مرتبط بـ {sub_contracts} عقد باطن.\n"
                "احذف عقود الباطن المرتبطة أولًا ثم احذف العقد."
            )
        
        # 5. V8.3: التحقق من الدفعات
        payments = conn.execute(
            "SELECT COUNT(*) FROM payment_plan WHERE contract_id=?", (contract_id,)
        ).fetchone()[0]
        if payments:
            raise ValidationError(
                f"لا يمكن حذف العقد لأنه مرتبط بـ {payments} دفعة في خطة السداد.\n"
                "احذف الدفعات المرتبطة أولًا ثم احذف العقد."
            )
        
        # 6. V8.3: التحقق من المراحل
        stages = conn.execute(
            "SELECT COUNT(*) FROM contract_stages WHERE contract_id=?", (contract_id,)
        ).fetchone()[0]
        if stages:
            raise ValidationError(
                f"لا يمكن حذف العقد لأنه مرتبط بـ {stages} مرحلة.\n"
                "احذف المراحل المرتبطة أولًا ثم احذف العقد."
            )
    
    try:
        with get_connection() as conn:
            # V8.3: حذف المراحل والدفعات أولاً
            conn.execute("DELETE FROM contract_stages WHERE contract_id=?", (contract_id,))
            conn.execute("DELETE FROM payment_plan WHERE contract_id=?", (contract_id,))
            
            # حذف العقد
            conn.execute("DELETE FROM contracts WHERE id=?", (contract_id,))
            
            # سجل التدقيق
            try:
                from services.lifecycle_service import log_event
                log_event(contract_id, "حذف عقد", "حذف نهائي للعقد وجميع مراحله ودفعاته")
            except Exception:
                pass
    except sqlite3.Error as exc:
        raise DatabaseError(f"خطأ في قاعدة البيانات: {exc}") from exc


def dashboard_stats() -> dict:
    with get_connection() as conn:
        customers = conn.execute("SELECT COUNT(*) FROM customers").fetchone()[0]
        contracts = conn.execute("SELECT COUNT(*) FROM contracts").fetchone()[0]
        total_contracts = conn.execute(
            "SELECT COALESCE(SUM(amount), 0) FROM contracts "
            "WHERE status NOT IN ('ملغى')").fetchone()[0]
        total_addendums = conn.execute(
            "SELECT COALESCE(SUM(a.amount_add - a.amount_deduct), 0) "
            "FROM addendums a JOIN contracts c ON c.id = a.contract_id "
            "WHERE a.status='معتمد' "
            "AND c.status NOT IN ('ملغى')").fetchone()[0]
        total_contracts = float(total_contracts) + float(total_addendums)
    # تمديد الإشراف المستحق يدخل إجمالي قيمة العقود (قاعدة 35)
    try:
        from services.supervision_service import extensions_map
        total_contracts += sum(float(v.get("extension_value", 0.0))
                               for v in extensions_map().values())
    except Exception:
        pass
    with get_connection() as conn:
        total_invoices = conn.execute(
            "SELECT COALESCE(SUM(amount), 0) FROM invoices").fetchone()[0]
    return {
        "customers": customers,
        "contracts": contracts,
        "total_contracts": float(total_contracts),
        "total_invoices": float(total_invoices),
        "total_remaining": float(total_contracts) - float(total_invoices),
    }
