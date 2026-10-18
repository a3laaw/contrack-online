# -*- coding: utf-8 -*-
"""أداة تنظيف البيانات الشاملة — V8.1

تتيح البحث عن عميل/مقاول وعرض جميع معاملاته (سندات، عقود، مطالبات، ...)
مع قائمة اختيار للحذف مع تحذيرات الارتباط.

المبادئ:
  • لا مخلفات — كل ما يُحذف يُحذف بالكامل مع أحفاده
  • لا تكرار — لا تبويبات مكررة
  • بحث شامل — نص واحد يبحث في كل شيء
  • تحذيرات واضحة — "إذا حذفت هذا، ستحذف أيضًا..."
"""
from __future__ import annotations

import json
from typing import Any

from database.database import get_connection
from services.customer_service import ValidationError


# ============================================================
# مساعدات عامة
# ============================================================
def _rows(conn, sql: str, params: tuple = ()) -> list[dict]:
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


def _one(conn, sql: str, params: tuple = ()) -> dict | None:
    r = conn.execute(sql, params).fetchone()
    return dict(r) if r else None


def _has_col(conn, table: str, col: str) -> bool:
    try:
        return col in {r[1] for r in conn.execute(f"PRAGMA table_info([{table}])")}
    except Exception:
        return False


def _table_exists(conn, name: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone() is not None


# ============================================================
# البحث الشامل
# ============================================================
def search_all(query: str, limit: int = 200) -> dict[str, list[dict]]:
    """بحث واحد يجد كل شيء مرتبط بالنص."""
    q = f"%{(query or '').strip()}%"
    if not q.strip("%"):
        return {}
    result: dict[str, list[dict]] = {}
    with get_connection() as conn:
        # العملاء
        rows = _rows(conn,
            "SELECT id, customer_code, name, phone FROM customers "
            "WHERE name LIKE ? OR customer_code LIKE ? OR phone LIKE ? "
            "ORDER BY id DESC LIMIT ?", (q, q, q, limit))
        if rows:
            result["العملاء"] = rows

        # المقاولون
        rows = _rows(conn,
            "SELECT id, sub_code, name, phone, activity FROM subcontractors "
            "WHERE name LIKE ? OR sub_code LIKE ? OR phone LIKE ? OR activity LIKE ? "
            "ORDER BY id DESC LIMIT ?", (q, q, q, q, limit))
        if rows:
            result["المقاولون"] = rows

        # العقود
        rows = _rows(conn,
            "SELECT c.id, c.contract_number, "
            "COALESCE(NULLIF(TRIM(c.description),''), c.contract_name) AS name, "
            "cu.name AS customer, c.amount FROM contracts c "
            "LEFT JOIN customers cu ON cu.id=c.customer_id "
            "WHERE c.contract_number LIKE ? OR c.description LIKE ? "
            "OR c.contract_name LIKE ? OR cu.name LIKE ? "
            "ORDER BY c.id DESC LIMIT ?", (q, q, q, q, limit))
        if rows:
            result["العقود"] = rows

        # السندات
        rows = _rows(conn,
            "SELECT id, voucher_number, vtype, vdate, party, amount, "
            "COALESCE(cancelled,0) AS cancelled FROM vouchers "
            "WHERE voucher_number LIKE ? OR party LIKE ? OR description LIKE ? "
            "ORDER BY id DESC LIMIT ?", (q, q, q, limit))
        if rows:
            result["السندات"] = rows

        # المقاولون (بحث بالنشاط)
        rows2 = _rows(conn,
            "SELECT id, sub_code, name, phone FROM subcontractors "
            "WHERE activity LIKE ? ORDER BY id DESC LIMIT ?", (q, limit))
        if rows2:
            existing = {r["id"] for r in result.get("المقاولون", [])}
            new = [r for r in rows2 if r["id"] not in existing]
            if new:
                result.setdefault("المقاولون", []).extend(new)

    return result


# ============================================================
# بحث فردي لكل نوع
# ============================================================
def search_customers(query: str, limit: int = 200) -> list[dict]:
    """بحث في العملاء."""
    q = f"%{(query or '').strip()}%"
    if not q.strip("%"):
        return []
    with get_connection() as conn:
        return _rows(conn,
            "SELECT id, customer_code, name, phone FROM customers "
            "WHERE name LIKE ? OR customer_code LIKE ? OR phone LIKE ? "
            "ORDER BY id DESC LIMIT ?", (q, q, q, limit))


def search_subcontractors(query: str, limit: int = 200) -> list[dict]:
    """بحث في المقاولين."""
    q = f"%{(query or '').strip()}%"
    if not q.strip("%"):
        return []
    with get_connection() as conn:
        return _rows(conn,
            "SELECT id, sub_code, name, phone, activity FROM subcontractors "
            "WHERE name LIKE ? OR sub_code LIKE ? OR phone LIKE ? OR activity LIKE ? "
            "ORDER BY id DESC LIMIT ?", (q, q, q, q, limit))


def search_contracts(query: str, limit: int = 200) -> list[dict]:
    """بحث في العقود."""
    q = f"%{(query or '').strip()}%"
    if not q.strip("%"):
        return []
    with get_connection() as conn:
        return _rows(conn,
            "SELECT c.id, c.contract_number, "
            "COALESCE(NULLIF(TRIM(c.description),''), c.contract_name) AS name, "
            "cu.name AS customer, c.amount FROM contracts c "
            "LEFT JOIN customers cu ON cu.id=c.customer_id "
            "WHERE c.contract_number LIKE ? OR c.description LIKE ? "
            "OR c.contract_name LIKE ? OR cu.name LIKE ? "
            "ORDER BY c.id DESC LIMIT ?", (q, q, q, q, limit))


def search_vouchers(query: str, limit: int = 200) -> list[dict]:
    """بحث في السندات."""
    q = f"%{(query or '').strip()}%"
    if not q.strip("%"):
        return []
    with get_connection() as conn:
        return _rows(conn,
            "SELECT id, voucher_number, vtype, vdate AS voucher_date, "
            "party, amount, COALESCE(cancelled,0) AS cancelled FROM vouchers "
            "WHERE voucher_number LIKE ? OR party LIKE ? OR description LIKE ? "
            "ORDER BY id DESC LIMIT ?", (q, q, q, limit))


def get_entity_details(entity_type: str, entity_id: int) -> dict | None:
    """جلب تفاصيل كيان."""
    with get_connection() as conn:
        if entity_type == "customer":
            return _one(conn, "SELECT * FROM customers WHERE id=?", (entity_id,))
        elif entity_type == "subcontractor":
            return _one(conn, "SELECT * FROM subcontractors WHERE id=?", (entity_id,))
        elif entity_type == "contract":
            return _one(conn,
                "SELECT c.*, cu.name AS customer_name FROM contracts c "
                "LEFT JOIN customers cu ON cu.id=c.customer_id WHERE c.id=?",
                (entity_id,))
        elif entity_type == "voucher":
            return _one(conn, "SELECT * FROM vouchers WHERE id=?", (entity_id,))
        elif entity_type == "claim":
            if _table_exists(conn, "claims"):
                return _one(conn, "SELECT * FROM claims WHERE id=?", (entity_id,))
    return None


def get_full_report() -> dict:
    """تقرير شامل عن قاعدة البيانات."""
    report = {}
    with get_connection() as conn:
        # العملاء
        count = conn.execute("SELECT COUNT(*) FROM customers").fetchone()[0]
        report["العملاء"] = {"العدد": count}

        # المقاولين
        count = conn.execute("SELECT COUNT(*) FROM subcontractors").fetchone()[0]
        report["المقاولين"] = {"العدد": count}

        # العقود
        count = conn.execute("SELECT COUNT(*) FROM contracts").fetchone()[0]
        report["العقود"] = {"العدد": count}

        # السندات
        count = conn.execute("SELECT COUNT(*) FROM vouchers").fetchone()[0]
        report["السندات"] = {"العدد": count}

        # عقود الباطن
        if _table_exists(conn, "sub_contracts"):
            count = conn.execute("SELECT COUNT(*) FROM sub_contracts").fetchone()[0]
            report["عقود الباطن"] = {"العدد": count}

    return report


def delete_voucher(voucher_id: int, reason: str = "") -> int:
    """حذف سند."""
    vid = int(voucher_id)
    with get_connection() as conn:
        v = _one(conn, "SELECT * FROM vouchers WHERE id=?", (vid,))
        if not v:
            raise ValidationError("السند غير موجود.")
        conn.execute("DELETE FROM vouchers WHERE id=?", (vid,))
    return 1


def search_claims(query: str, limit: int = 200) -> list[dict]:
    """بحث في المطالبات المالية."""
    q = f"%{(query or '').strip()}%"
    if not q.strip("%"):
        return []
    with get_connection() as conn:
        if not _table_exists(conn, "claims"):
            return []
        return _rows(conn,
            "SELECT id, claim_number, contract_id, amount, status, "
            "due_date FROM claims "
            "WHERE claim_number LIKE ? OR status LIKE ? "
            "ORDER BY id DESC LIMIT ?", (q, q, limit))


def delete_claim(claim_id: int, reason: str = "") -> int:
    """حذف مطالبة مالية."""
    cid = int(claim_id)
    with get_connection() as conn:
        if not _table_exists(conn, "claims"):
            raise ValidationError("جدول المطالبات غير موجود.")
        c = _one(conn, "SELECT * FROM claims WHERE id=?", (cid,))
        if not c:
            raise ValidationError("المطالبة غير موجودة.")
        conn.execute("DELETE FROM claims WHERE id=?", (cid,))
    return 1


def delete_contract(contract_id: int, reason: str = "") -> int:
    """حذف عقد مع التحقق من الارتباطات."""
    from services.contract_service import delete_contract as _delete
    _delete(int(contract_id))
    return 1


# ============================================================
# تفاصيل العميل — كل ما يتعلق به
# ============================================================
def customer_details(customer_id: int) -> dict[str, Any]:
    """كل المعاملات المتعلقة بعميل."""
    cid = int(customer_id or 0)
    if not cid:
        return {}
    with get_connection() as conn:
        customer = _one(conn, "SELECT * FROM customers WHERE id=?", (cid,))
        if not customer:
            return {}

        out: dict[str, Any] = {"عميل": customer, "المرتبطة": {}}

        # العقود
        contracts = _rows(conn,
            "SELECT id, contract_number, description, amount, status "
            "FROM contracts WHERE customer_id=?", (cid,))
        if contracts:
            out["المرتبطة"]["العقود"] = contracts

        # السندات (عبر العقود أو مباشرة)
        con_ids = [c["id"] for c in contracts] if contracts else []
        vouchers = []
        if con_ids:
            marks = ",".join("?" * len(con_ids))
            vouchers = _rows(conn,
                f"SELECT id, voucher_number, vtype, vdate, party, amount, "
                f"COALESCE(cancelled,0) AS cancelled "
                f"FROM vouchers WHERE contract_id IN ({marks})", tuple(con_ids))
        # سندات مباشرة بالعميل
        direct_v = _rows(conn,
            "SELECT id, voucher_number, vtype, vdate, party, amount, "
            "COALESCE(cancelled,0) AS cancelled "
            "FROM vouchers WHERE expense_customer_id=? "
            "OR (party_type='customer' AND party_id=?)", (cid, cid))
        if direct_v:
            existing = {v["id"] for v in vouchers}
            vouchers.extend(v for v in direct_v if v["id"] not in existing)
        if vouchers:
            out["المرتبطة"]["السندات"] = vouchers

        # عروض الأسعار
        quotes = _rows(conn,
            "SELECT id, quote_number, qdate, status FROM quotations "
            "WHERE customer_id=?", (cid,))
        if quotes:
            out["المرتبطة"]["عروض_الأسعار"] = quotes

        # المشاريع
        projects = _rows(conn,
            "SELECT id, project_code, name, status FROM projects "
            "WHERE customer_id=?", (cid,))
        if projects:
            out["المرتبطة"]["المشاريع"] = projects

        # الزيارات
        visits = _rows(conn,
            "SELECT id, visit_date, hour_slot, note FROM visits "
            "WHERE customer_id=?", (cid,))
        if visits:
            out["المرتبطة"]["الزيارات"] = visits

        # المهام
        tasks = _rows(conn,
            "SELECT id, title, status, due_at FROM tasks "
            "WHERE customer_id=?", (cid,))
        if tasks:
            out["المرتبطة"]["المهام"] = tasks

        # التعليقات
        comments = _rows(conn,
            "SELECT id, body, created_at, kind FROM customer_comments "
            "WHERE customer_id=?", (cid,))
        if comments:
            out["المرتبطة"]["التعليقات"] = comments

        # المجموعات
        groups = _rows(conn,
            "SELECT id, group_number, group_name, status FROM contract_groups "
            "WHERE customer_id=?", (cid,))
        if groups:
            out["المرتبطة"]["مجموعات_العقود"] = groups

        # المطالبات (عبر العقود)
        if con_ids:
            marks = ",".join("?" * len(con_ids))
            claims = _rows(conn,
                f"SELECT id, claim_number, title, amount, status "
                f"FROM claims WHERE contract_id IN ({marks})", tuple(con_ids))
            if claims:
                out["المرتبطة"]["المطالبات"] = claims

        # الملحقات (عبر العقود)
        if con_ids:
            marks = ",".join("?" * len(con_ids))
            addendums = _rows(conn,
                f"SELECT id, addendum_number, reason, status "
                f"FROM addendums WHERE contract_id IN ({marks})", tuple(con_ids))
            if addendums:
                out["المرتبطة"]["الملحقات"] = addendums

        # حساب مجموعات العقود
        if groups:
            for g in groups:
                g["contracts_count"] = conn.execute(
                    "SELECT COUNT(*) FROM contract_group_items WHERE group_id=?",
                    (g["id"],)).fetchone()[0]

        # إحصائيات
        stats = {}
        for key, items in out["المرتبطة"].items():
            if isinstance(items, list):
                stats[key] = len(items)
        out["إحصائيات"] = stats

    return out


# ============================================================
# تفاصيل المقاول — كل ما يتعلق به
# ============================================================
def subcontractor_details(sub_id: int) -> dict[str, Any]:
    """كل المعاملات المتعلقة بمقاول باطن."""
    sid = int(sub_id or 0)
    if not sid:
        return {}
    with get_connection() as conn:
        sub = _one(conn, "SELECT * FROM subcontractors WHERE id=?", (sid,))
        if not sub:
            return {}

        out: dict[str, Any] = {"مقاول": sub, "المرتبطة": {}}

        # عقود الباطن
        sc_list = _rows(conn,
            "SELECT sc.*, c.contract_number, cu.name AS customer_name "
            "FROM sub_contracts sc "
            "JOIN contracts c ON c.id=sc.contract_id "
            "LEFT JOIN customers cu ON cu.id=c.customer_id "
            "WHERE sc.subcontractor_id=?", (sid,))
        if sc_list:
            out["المرتبطة"]["عقود_الباطن"] = sc_list

        sc_ids = [s["id"] for s in sc_list] if sc_list else []

        # بنود عقود الباطن
        if sc_ids:
            marks = ",".join("?" * len(sc_ids))
            items = _rows(conn,
                f"SELECT sci.*, boq.description AS boq_desc "
                f"FROM sub_contract_items sci "
                f"LEFT JOIN boq_items boq ON boq.id=sci.boq_item_id "
                f"WHERE sci.sub_contract_id IN ({marks})", tuple(sc_ids))
            if items:
                out["المرتبطة"]["بنود_الباطن"] = items

        # خطة سداد الباطن
        if sc_ids:
            marks = ",".join("?" * len(sc_ids))
            plan = _rows(conn,
                f"SELECT * FROM sub_payment_plan "
                f"WHERE sub_contract_id IN ({marks})", tuple(sc_ids))
            if plan:
                out["المرتبطة"]["خطة_سداد_الباطن"] = plan

        # مصادر الدفع
        if sc_ids:
            marks = ",".join("?" * len(sc_ids))
            sources = _rows(conn,
                f"SELECT sps.*, sp.title AS plan_title "
                f"FROM sub_payment_sources sps "
                f"JOIN sub_payment_plan sp ON sp.id=sps.sub_line_id "
                f"WHERE sp.sub_contract_id IN ({marks})", tuple(sc_ids))
            if sources:
                out["المرتبطة"]["مصادر_الدفع"] = sources

        # المطالبات
        if sc_ids:
            marks = ",".join("?" * len(sc_ids))
            claims = _rows(conn,
                f"SELECT * FROM claims WHERE sub_contract_id IN ({marks})",
                tuple(sc_ids))
            if claims:
                out["المرتبطة"]["المطالبات"] = claims

        # السندات
        vouchers = []
        if sc_ids:
            marks = ",".join("?" * len(sc_ids))
            vouchers = _rows(conn,
                f"SELECT id, voucher_number, vtype, vdate, party, amount, "
                f"COALESCE(cancelled,0) AS cancelled "
                f"FROM vouchers WHERE sub_contract_id IN ({marks})", tuple(sc_ids))
        # سندات مباشرة بالمقاول
        direct_v = _rows(conn,
            "SELECT id, voucher_number, vtype, vdate, party, amount, "
            "COALESCE(cancelled,0) AS cancelled "
            "FROM vouchers WHERE party_type='subcontractor' AND party_id=?",
            (sid,))
        if direct_v:
            existing = {v["id"] for v in vouchers}
            vouchers.extend(v for v in direct_v if v["id"] not in existing)
        if vouchers:
            out["المرتبطة"]["السندات"] = vouchers

        # الملحقات
        if sc_ids:
            marks = ",".join("?" * len(sc_ids))
            addendums = _rows(conn,
                f"SELECT * FROM addendums WHERE sub_contract_id IN ({marks})",
                tuple(sc_ids))
            if addendums:
                out["المرتبطة"]["الملحقات"] = addendums

        # إحصائيات
        stats = {}
        for key, items in out["المرتبطة"].items():
            if isinstance(items, list):
                stats[key] = len(items)
        out["إحصائيات"] = stats

    return out


# ============================================================
# معاينة ما سيُحذف (مع التحذيرات)
# ============================================================
def preview_delete_customer(customer_id: int) -> dict[str, Any]:
    """معاينة شاملة لما سيُحذف مع العميل."""
    data = customer_details(customer_id)
    if not data:
        return {"error": "العميل غير موجود"}

    warnings = []
    linked = data.get("المرتبطة", {})

    if linked.get("العقود"):
        warnings.append(f"⚠ سيتم حذف {len(linked['العقود'])} عقد بكل تفاصيلها")

    if linked.get("السندات"):
        total = sum(float(v.get("amount") or 0) for v in linked["السندات"])
        warnings.append(f"⚠ سيتم حذف {len(linked['السندات'])} سند (إجمالي {total:,.3f})")

    if linked.get("المطالبات"):
        warnings.append(f"⚠ سيتم حذف {len(linked['المطالبات'])} مطالبة مالية")

    if linked.get("الملحقات"):
        warnings.append(f"⚠ سيتم حذف {len(linked['الملحقات'])} ملحق")

    if linked.get("عروض_الأسعار"):
        warnings.append(f"⚠ سيتم حذف {len(linked['عروض_الأسعار'])} عرض سعر")

    if linked.get("المشاريع"):
        warnings.append(f"⚠ سيتم حذف {len(linked['المشاريع'])} مشروع")

    if linked.get("الزيارات"):
        warnings.append(f"⚠ سيتم حذف {len(linked['الزيارات'])} زيارة")

    if linked.get("المهام"):
        warnings.append(f"⚠ سيتم حذف {len(linked['المهام'])} مهمة")

    if linked.get("التعليقات"):
        warnings.append(f"⚠ سيتم حذف {len(linked['التعليقات'])} تعليق")

    if linked.get("مجموعات_العقود"):
        warnings.append(f"⚠ سيتم حذف {len(linked['مجموعات_العقود'])} مجموعة عقود")

    if not warnings:
        warnings.append("✅ لا توجد بيانات مرتبطة — الحذف آمن")

    return {
        "entity": data["عميل"],
        "linked": linked,
        "stats": data.get("إحصائيات", {}),
        "warnings": warnings,
        "total_items": sum(len(v) for v in linked.values() if isinstance(v, list))
    }


def preview_delete_subcontractor(sub_id: int) -> dict[str, Any]:
    """معاينة شاملة لما سيُحذف مع المقاول."""
    data = subcontractor_details(sub_id)
    if not data:
        return {"error": "المقاول غير موجود"}

    warnings = []
    linked = data.get("المرتبطة", {})

    if linked.get("عقود_الباطن"):
        warnings.append(f"⚠ سيتم حذف {len(linked['عقود_الباطن'])} عقد باطن")

    if linked.get("بنود_الباطن"):
        warnings.append(f"⚠ سيتم حذف {len(linked['بنود_الباطن'])} بند مرتبط")

    if linked.get("خطة_سداد_الباطن"):
        warnings.append(f"⚠ سيتم حذف {len(linked['خطة_سداد_الباطن'])} دفعة خطة")

    if linked.get("مصادر_الدفع"):
        warnings.append(f"⚠ سيتم حذف {len(linked['مصادر_الدفع'])} مصدر دفع")

    if linked.get("المطالبات"):
        warnings.append(f"⚠ سيتم حذف {len(linked['المطالبات'])} مطالبة مالية")

    if linked.get("السندات"):
        total = sum(float(v.get("amount") or 0) for v in linked["السندات"])
        active = sum(1 for v in linked["السندات"] if not v.get("cancelled"))
        warnings.append(f"⚠ سيتم حذف {len(linked['السندات'])} سند ({active} فعّال · إجمالي {total:,.3f})")

    if linked.get("الملحقات"):
        warnings.append(f"⚠ سيتم حذف {len(linked['الملحقات'])} ملحق")

    if not warnings:
        warnings.append("✅ لا توجد بيانات مرتبطة — الحذف آمن")

    return {
        "entity": data["مقاول"],
        "linked": linked,
        "stats": data.get("إحصائيات", {}),
        "warnings": warnings,
        "total_items": sum(len(v) for v in linked.values() if isinstance(v, list))
    }


# ============================================================
# الحذف الشامل
# ============================================================
def _ensure_audit() -> None:
    with get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS purge_audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                purged_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                purged_by TEXT DEFAULT '',
                entity TEXT NOT NULL,
                entity_id INTEGER,
                label TEXT DEFAULT '',
                reason TEXT DEFAULT '',
                snapshot TEXT DEFAULT ''
            )""")


def _log(conn, by: str, entity: str, eid: int, label: str,
         reason: str, snapshot: dict) -> None:
    conn.execute(
        "INSERT INTO purge_audit (purged_by, entity, entity_id, label, "
        "reason, snapshot) VALUES (?,?,?,?,?,?)",
        (by, entity, eid, label, reason,
         json.dumps(snapshot, ensure_ascii=False, default=str)))


def _require_dev() -> str:
    from services import auth_service
    if not auth_service.is_developer():
        raise ValidationError(
            "أداة التنظيف متاحة لحساب المطور فقط.\n"
            "هذه الأداة تحذف بيانات نهائيًا ولا تُتاح لأي مستخدم آخر.")
    return auth_service.display_name() or auth_service.current_username()


def delete_customer(customer_id: int, reason: str,
                    delete_contracts: bool = True,
                    delete_vouchers: bool = True) -> dict:
    """حذف عميل مع كل ما يتعلق به."""
    by = _require_dev()
    if not (reason or "").strip():
        raise ValidationError("اكتب سبب الحذف.")
    _ensure_audit()

    with get_connection() as conn:
        customer = _one(conn, "SELECT * FROM customers WHERE id=?", (customer_id,))
        if not customer:
            raise ValidationError("العميل غير موجود.")

        snapshot: dict = {"customers": [customer]}
        deleted_counts: dict[str, int] = {}

        # حذف العقود أولاً
        if delete_contracts:
            contracts = _rows(conn, "SELECT id FROM contracts WHERE customer_id=?",
                              (customer_id,))
            for c in contracts:
                _delete_contract_cascade(conn, c["id"], snapshot, by,
                                         f"{reason} — ضمن حذف العميل")

        # حذف السندات المباشرة
        if delete_vouchers:
            vrows = _rows(conn,
                "SELECT * FROM vouchers WHERE expense_customer_id=? "
                "OR (party_type='customer' AND party_id=?)", (customer_id, customer_id))
            if vrows:
                snapshot["vouchers_direct"] = vrows
                vids = [v["id"] for v in vrows]
                marks = ",".join("?" * len(vids))
                # حذف القيود المحاسبية
                if _table_exists(conn, "journal_entries"):
                    conn.execute(
                        f"DELETE FROM journal_entries WHERE "
                        f"source_type LIKE 'voucher%' AND source_id IN ({marks})",
                        tuple(vids))
                conn.execute(f"DELETE FROM vouchers WHERE id IN ({marks})",
                             tuple(vids))
                deleted_counts["سندات_مباشرة"] = len(vrows)

        # حذف التابعين
        for tbl, col, label in [
            ("contract_groups", "customer_id", "مجموعات"),
            ("invoices", "customer_id", "فواتير"),
            ("projects", "customer_id", "مشاريع"),
            ("quotations", "customer_id", "عروض"),
            ("visits", "customer_id", "زيارات"),
            ("tasks", "customer_id", "مهام"),
            ("customer_comments", "customer_id", "تعليقات"),
        ]:
            if _table_exists(conn, tbl):
                rows = _rows(conn, f"SELECT * FROM [{tbl}] WHERE [{col}]=?",
                             (customer_id,))
                if rows:
                    snapshot[tbl] = rows
                    conn.execute(f"DELETE FROM [{tbl}] WHERE [{col}]=?",
                                 (customer_id,))
                    deleted_counts[label] = len(rows)

        # حذف سجل المراحل
        if _table_exists(conn, "transaction_stage_log"):
            conn.execute(
                "DELETE FROM transaction_stage_log WHERE "
                "transaction_type='customer' AND transaction_id=?",
                (customer_id,))

        label = f"{customer.get('name', '')} ({customer.get('customer_code', '')})"
        _log(conn, by, "customer", customer_id, label, reason, snapshot)
        conn.execute("DELETE FROM customers WHERE id=?", (customer_id,))
        deleted_counts["العميل"] = 1

    return deleted_counts


def _delete_contract_cascade(conn, contract_id: int, snapshot: dict,
                              by: str, reason: str) -> None:
    """حذف عقد مع كل أحفاده."""
    cid = contract_id
    contract = _one(conn, "SELECT * FROM contracts WHERE id=?", (cid,))
    if not contract:
        return

    key = f"contract_{cid}"
    snapshot[key] = {"contract": contract, "children": {}}

    # السندات أولاً
    vrows = _rows(conn, "SELECT * FROM vouchers WHERE contract_id=?", (cid,))
    if vrows:
        snapshot[key]["children"]["vouchers"] = vrows
        vids = [v["id"] for v in vrows]
        marks = ",".join("?" * len(vids))
        if _table_exists(conn, "journal_entries"):
            conn.execute(
                f"DELETE FROM journal_entries WHERE "
                f"source_type LIKE 'voucher%' AND source_id IN ({marks})",
                tuple(vids))
        conn.execute(f"DELETE FROM vouchers WHERE id IN ({marks})", tuple(vids))

    # المطالبات
    claims = _rows(conn,
        "SELECT * FROM claims WHERE contract_id=? "
        "OR cust_line_id IN (SELECT id FROM payment_plan WHERE contract_id=?)",
        (cid, cid))
    if claims:
        snapshot[key]["children"]["claims"] = claims
        cids2 = [c["id"] for c in claims]
        marks = ",".join("?" * len(cids2))
        conn.execute(f"DELETE FROM claims WHERE id IN ({marks})", tuple(cids2))

    # عقود الباطن مع أحفادها
    subs = _rows(conn, "SELECT id FROM sub_contracts WHERE contract_id=?", (cid,))
    for s in subs:
        _delete_sub_contract_cascade(conn, s["id"], snapshot, by, reason)

    # التابعين الآخرين
    for tbl, col in [
        ("addendums", "contract_id"),
        ("boq_items", "contract_id"),
        ("contract_attachments", "contract_id"),
        ("contract_components", "contract_id"),
        ("contract_events", "contract_id"),
        ("contract_group_items", "contract_id"),
        ("contract_scope", "contract_id"),
        ("payment_plan", "contract_id"),
        ("contract_stages", "contract_id"),
        ("quotations", "contract_id"),
        ("invoices", "contract_id"),
    ]:
        if _table_exists(conn, tbl):
            rows = _rows(conn, f"SELECT * FROM [{tbl}] WHERE [{col}]=?", (cid,))
            if rows:
                snapshot[key]["children"][tbl] = rows
                conn.execute(f"DELETE FROM [{tbl}] WHERE [{col}]=?", (cid,))

    # سجل المراحل
    if _table_exists(conn, "transaction_stage_log"):
        conn.execute(
            "DELETE FROM transaction_stage_log WHERE "
            "transaction_type='contract' AND transaction_id=?", (cid,))

    conn.execute("DELETE FROM contracts WHERE id=?", (cid,))


def _delete_sub_contract_cascade(conn, sc_id: int, snapshot: dict,
                                  by: str, reason: str) -> None:
    """حذف عقد باطن مع كل أحفاده."""
    sc = _one(conn, "SELECT * FROM sub_contracts WHERE id=?", (sc_id,))
    if not sc:
        return

    key = f"sub_contract_{sc_id}"
    snapshot[key] = {"sub_contract": sc, "children": {}}

    # السندات
    vrows = _rows(conn, "SELECT * FROM vouchers WHERE sub_contract_id=?", (sc_id,))
    if vrows:
        snapshot[key]["children"]["vouchers"] = vrows
        vids = [v["id"] for v in vrows]
        marks = ",".join("?" * len(vids))
        if _table_exists(conn, "journal_entries"):
            conn.execute(
                f"DELETE FROM journal_entries WHERE "
                f"source_type LIKE 'voucher%' AND source_id IN ({marks})",
                tuple(vids))
        conn.execute(f"DELETE FROM vouchers WHERE id IN ({marks})", tuple(vids))

    # المطالبات
    claims = _rows(conn, "SELECT * FROM claims WHERE sub_contract_id=?", (sc_id,))
    if claims:
        snapshot[key]["children"]["claims"] = claims
        cids = [c["id"] for c in claims]
        marks = ",".join("?" * len(cids))
        conn.execute(f"DELETE FROM claims WHERE id IN ({marks})", tuple(cids))

    # الدفعات والمصادر
    plan = _rows(conn, "SELECT * FROM sub_payment_plan WHERE sub_contract_id=?",
                 (sc_id,))
    if plan:
        snapshot[key]["children"]["sub_payment_plan"] = plan
        pids = [p["id"] for p in plan]
        marks = ",".join("?" * len(pids))
        if _table_exists(conn, "sub_payment_sources"):
            conn.execute(
                f"DELETE FROM sub_payment_sources WHERE sub_line_id IN ({marks})",
                tuple(pids))
        conn.execute(f"DELETE FROM sub_payment_plan WHERE sub_contract_id=?",
                     (sc_id,))

    # البنود
    items = _rows(conn, "SELECT * FROM sub_contract_items WHERE sub_contract_id=?",
                  (sc_id,))
    if items:
        snapshot[key]["children"]["sub_contract_items"] = items
        conn.execute("DELETE FROM sub_contract_items WHERE sub_contract_id=?",
                     (sc_id,))

    # الملحقات
    if _table_exists(conn, "addendum_items"):
        ai = _rows(conn, "SELECT * FROM addendum_items WHERE side='sub' "
                   "AND sub_contract_id=?", (sc_id,))
        if ai:
            snapshot[key]["children"]["addendum_items"] = ai
            conn.execute("DELETE FROM addendum_items WHERE side='sub' "
                         "AND sub_contract_id=?", (sc_id,))

    if _has_col(conn, "addendums", "sub_contract_id"):
        conn.execute("UPDATE addendums SET sub_contract_id=NULL "
                     "WHERE sub_contract_id=?", (sc_id,))

    conn.execute("DELETE FROM sub_contracts WHERE id=?", (sc_id,))


def delete_subcontractor(sub_id: int, reason: str,
                          delete_contracts: bool = True,
                          delete_vouchers: bool = True) -> dict:
    """حذف مقاول مع كل ما يتعلق به."""
    by = _require_dev()
    if not (reason or "").strip():
        raise ValidationError("اكتب سبب الحذف.")
    _ensure_audit()

    with get_connection() as conn:
        sub = _one(conn, "SELECT * FROM subcontractors WHERE id=?", (sub_id,))
        if not sub:
            raise ValidationError("المقاول غير موجود.")

        snapshot: dict = {"subcontractors": [sub]}
        deleted_counts: dict[str, int] = {}

        # حذف عقود الباطن
        if delete_contracts:
            sc_list = _rows(conn, "SELECT id FROM sub_contracts WHERE subcontractor_id=?",
                            (sub_id,))
            for sc in sc_list:
                _delete_sub_contract_cascade(conn, sc["id"], snapshot, by,
                                             f"{reason} — ضمن حذف المقاول")
            deleted_counts["عقود_باطن"] = len(sc_list)

        # حذف السندات المباشرة
        if delete_vouchers:
            vrows = _rows(conn,
                "SELECT * FROM vouchers WHERE party_type='subcontractor' AND party_id=?",
                (sub_id,))
            if vrows:
                snapshot["vouchers_direct"] = vrows
                vids = [v["id"] for v in vrows]
                marks = ",".join("?" * len(vids))
                if _table_exists(conn, "journal_entries"):
                    conn.execute(
                        f"DELETE FROM journal_entries WHERE "
                        f"source_type LIKE 'voucher%' AND source_id IN ({marks})",
                        tuple(vids))
                conn.execute(f"DELETE FROM vouchers WHERE id IN ({marks})",
                             tuple(vids))
                deleted_counts["سندات_مباشرة"] = len(vrows)

        label = f"{sub.get('name', '')} ({sub.get('sub_code', '')})"
        _log(conn, by, "subcontractor", sub_id, label, reason, snapshot)
        conn.execute("DELETE FROM subcontractors WHERE id=?", (sub_id,))
        deleted_counts["المقاول"] = 1

    return deleted_counts


# ============================================================
# تقرير المطور الشامل
# ============================================================
def developer_report() -> dict[str, Any]:
    """تقرير شامل بكل أنواع البيانات في النظام."""
    report: dict[str, Any] = {}

    with get_connection() as conn:
        # الكيانات الرئيسية
        core = {}
        for tbl, label in [
            ("customers", "العملاء"), ("contracts", "العقود"),
            ("subcontractors", "مقاولو الباطن"), ("sub_contracts", "عقود الباطن"),
            ("vouchers", "السندات"), ("invoices", "الفواتير"),
            ("quotations", "عروض الأسعار"), ("projects", "المشاريع"),
            ("claims", "المطالبات المالية"), ("addendums", "الملحقات"),
            ("boq_items", "بنود الكميات"), ("payment_plan", "خطة السداد"),
            ("sub_payment_plan", "خطة سداد الباطن"),
            ("contract_stages", "مراحل العقد"), ("tasks", "المهام"),
            ("visits", "الزيارات"), ("customer_comments", "تعليقات العملاء"),
        ]:
            n = conn.execute(f"SELECT COUNT(*) FROM [{tbl}]").fetchone()[0]
            if n > 0:
                core[label] = {"table": tbl, "count": n}
        report["كيانات_رئيسية"] = core

        # السندات حسب النوع
        vou = {}
        for vtype, label in [("receipt", "قبض"), ("payment", "صرف"),
                              ("transfer", "تحويل")]:
            n = conn.execute("SELECT COUNT(*) FROM vouchers WHERE vtype=?",
                             (vtype,)).fetchone()[0]
            if n > 0:
                vou[label] = n
        report["سندات_حسب_النوع"] = vou

        # أنواع العقود
        types = _rows(conn, "SELECT id, name, manual_track, pricing_mode, "
                       "is_supervision, unit_label FROM contract_types")
        report["أنواع_العقود"] = types

        # مراحل العمل
        stages = _rows(conn, "SELECT id, transaction_type, stage_name, "
                        "stage_order, contract_type, is_supervision "
                        "FROM workflow_stages ORDER BY transaction_type, stage_order")
        report["مراحل_العمل"] = stages

        # حسابات المصروفات
        accts = _rows(conn, "SELECT id, parent_id, name, full_path, "
                       "account_kind, is_active FROM expense_accounts ORDER BY sort_order")
        report["حسابات_المصروفات"] = accts

        # طرق الدفع
        methods = _rows(conn, "SELECT id, name, fee_type, fee_value, "
                         "is_active FROM payment_methods")
        report["طرق_الدفع"] = methods

        # الإعدادات
        s = _one(conn, "SELECT company_name, currency, ui_theme FROM settings")
        report["الإعدادات"] = s

        # المستخدمون
        users = _rows(conn, "SELECT id, username, role, full_name FROM users")
        report["المستخدمون"] = users

        # البيانات المرجعية
        ref = {}
        for tbl, label in [
            ("contract_templates", "قوالب العقود"),
            ("contract_groups", "مجموعات العقود"),
            ("employees", "الموظفون"),
            ("visit_staff", "طاقم الزيارات"),
        ]:
            n = conn.execute(f"SELECT COUNT(*) FROM [{tbl}]").fetchone()[0]
            if n > 0:
                ref[label] = {"table": tbl, "count": n}
        report["بيانات_مرجعية"] = ref

        # إحصائيات عامة
        stats = {}
        for tbl, label in [
            ("contract_scope", "نطاقات مختارة"),
            ("contract_components", "مكونات عقود"),
            ("contract_events", "أحداث عقود"),
            ("contract_attachments", "مرفقات"),
            ("sub_contract_items", "بنود باطن"),
            ("sub_payment_sources", "مصادر دفع"),
            ("addendum_items", "بنود ملحقات"),
            ("stage_notes", "ملاحظات مراحل"),
            ("voucher_payment_links", "ربط سندات"),
            ("journal_entries", "قيود محاسبية"),
            ("notifications", "إشعارات"),
            ("transaction_messages", "رسائل معاملات"),
            ("transaction_stage_log", "سجل مراحل"),
            ("form_documents", "مستندات نماذج"),
            ("form_templates", "قوالب نماذج"),
        ]:
            n = conn.execute(f"SELECT COUNT(*) FROM [{tbl}]").fetchone()[0]
            if n > 0:
                stats[label] = n
        report["إحصائيات_عامة"] = stats

    return report


# ============================================================
# إعادة تعيين كاملة (مع تحذيرات)
# ============================================================
def full_reset(reason: str) -> dict[str, int]:
    """حذف كل البيانات ما عدا الإعدادات والمستخدمين."""
    by = _require_dev()
    if not (reason or "").strip():
        raise ValidationError("اكتب سبب إعادة التعيين.")
    _ensure_audit()

    # ترتيب الحذف: الأحفاد قبل الآباء
    _TABLES_ORDER = [
        # سجل المراحل والرسائل
        "transaction_stage_log", "transaction_messages", "transaction_visibility",
        # مصادر الدفع
        "sub_payment_sources",
        # بنود الملحقات
        "addendum_items",
        # المطالبات
        "claims",
        # سندات + قيود
        "journal_entries", "voucher_payment_links", "vouchers",
        # بنود الباطن + دفعات الباطن
        "sub_contract_items", "sub_payment_plan",
        # عقود الباطن
        "sub_contracts",
        # بنود عروض الأسعار
        "quotation_items",
        # ملحقات
        "addendums",
        # بنود الكميات + خطط السداد + مراحل العقد
        "boq_items", "payment_plan", "contract_stages",
        # مكونات/نطاق/أحداث/مرفقات العقد
        "contract_components", "contract_scope", "contract_events",
        "contract_attachments", "contract_group_items",
        # عروض الأسعار + فواتير + مشاريع
        "quotations", "invoices", "projects",
        # مجموعات العقود
        "contract_groups",
        # تعليقات + زيارات + مهام
        "customer_comments", "visits", "tasks",
        # العقود
        "contracts",
        # العملاء
        "customers",
        # المقاولون
        "subcontractors",
        # النماذج
        "form_documents", "form_fields", "form_templates", "form_categories",
        # ملاحظات
        "stage_notes",
        # إشعارات
        "notifications",
        # تسلسل الأرقام
        "number_sequences",
    ]

    deleted: dict[str, int] = {}
    snapshot: dict = {}

    with get_connection() as conn:
        # حفظ لقطة لكل جدول
        for tbl in _TABLES_ORDER:
            if _table_exists(conn, tbl):
                rows = _rows(conn, f"SELECT * FROM [{tbl}]")
                if rows:
                    snapshot[tbl] = len(rows)

        # الحذف
        for tbl in _TABLES_ORDER:
            if _table_exists(conn, tbl):
                n = conn.execute(f"SELECT COUNT(*) FROM [{tbl}]").fetchone()[0]
                if n > 0:
                    conn.execute(f"DELETE FROM [{tbl}]")
                    deleted[tbl] = n

    # تسجيل في سجل التدقيق
    with get_connection() as conn:
        _log(conn, by, "full_reset", 0,
             f"إعادة تعيين كاملة — {sum(deleted.values())} سجل",
             reason, snapshot)

    return deleted
