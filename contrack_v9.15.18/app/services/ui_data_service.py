# -*- coding: utf-8 -*-
"""واجهات بيانات صغيرة تستعملها شاشات Qt بدل أي SQL مباشر داخل ui/.

هذا الملف يبقى داخل services لذلك يسمح له بالتعامل مع قاعدة البيانات، بينما
تبقى ملفات ui طبقة عرض فقط تستدعي خدمات جاهزة.
"""
from database.database import get_connection


def normalize_contract_status(status: str | None) -> str:
    """توحيد حالات عقود قديمة/مستوردة لا تستخدم قاموس الحالات الحالي."""
    txt = (status or "").strip()
    if not txt:
        return "نشط"
    legacy = {"معطل": "متوقف", "معطلة": "متوقف", "موقوف": "متوقف", "موقوفة": "متوقف"}
    return legacy.get(txt, txt)


def contract_status(contract_id: int) -> str:
    # V2.48: تغليف بذاكرة البناء
    from services.qcache import memo
    return memo(("contract_status", contract_id),
                lambda: _contract_status_impl(contract_id))


def _contract_status_impl(contract_id: int) -> str:
    with get_connection() as conn:
        row = conn.execute("SELECT status FROM contracts WHERE id=?", (contract_id,)).fetchone()
    return normalize_contract_status(row["status"] if row else "")


def contract_project_id(contract_id: int):
    with get_connection() as conn:
        row = conn.execute("SELECT project_id FROM contracts WHERE id=?", (contract_id,)).fetchone()
    return row["project_id"] if row else None


def contract_customer_id(contract_id: int):
    with get_connection() as conn:
        row = conn.execute("SELECT customer_id FROM contracts WHERE id=?", (contract_id,)).fetchone()
    return row["customer_id"] if row else None


def contract_receipts_total(contract_id: int) -> float:
    with get_connection() as conn:
        return float(conn.execute(
            "SELECT COALESCE(SUM(amount),0) FROM vouchers "
            "WHERE contract_id=? AND vtype='receipt' AND cancelled=0",
            (contract_id,)).fetchone()[0])


def purge_unlinked_boq_items(contract_id: int) -> None:
    """حذف بنود BOQ غير المرتبطة بحركات عند إعادة حفظ بنود العقد."""
    with get_connection() as conn:
        conn.execute(
            "DELETE FROM boq_items WHERE contract_id=? AND id NOT IN "
            "(SELECT COALESCE(boq_item_id,0) FROM vouchers "
            " WHERE boq_item_id IS NOT NULL "
            " UNION SELECT boq_item_id FROM sub_contract_items)",
            (contract_id,))


def clear_supervision_fields(contract_id: int) -> None:
    with get_connection() as conn:
        conn.execute(
            "UPDATE contracts SET sup_start_date='', "
            "sup_months=0, sup_monthly=0, sup_waived_months=0 "
            "WHERE id=?", (contract_id,))


def dealings_financial_maps() -> dict:
    """خرائط مساعدة للشاشة الشجرية بدون SQL داخل ui.

    القيمة الحالية نفسها يجب أن تأتي من lifecycle_service.contract_current_value.
    """
    with get_connection() as conn:
        statuses = {r["id"]: (r["status"] or "نشط") for r in conn.execute(
            "SELECT id, status FROM contracts").fetchall()}
        collected_map = {r["contract_id"]: float(r["s"] or 0) for r in conn.execute(
            "SELECT contract_id, SUM(amount) AS s FROM vouchers "
            "WHERE vtype='receipt' AND cancelled=0 AND contract_id IS NOT NULL "
            "GROUP BY contract_id").fetchall()}
        addendums_map: dict[int, list] = {}
        for r in conn.execute(
                "SELECT * FROM addendums WHERE status='معتمد' ORDER BY id").fetchall():
            addendums_map.setdefault(r["contract_id"], []).append(dict(r))
    return {"statuses": statuses, "collected_map": collected_map,
            "addendums_map": addendums_map}


def dashboard_counts() -> dict:
    with get_connection() as conn:
        return {
            "projects": conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0],
            "vouchers": conn.execute("SELECT COUNT(*) FROM vouchers").fetchone()[0],
        }


def paused_contracts() -> list[dict]:
    with get_connection() as conn:
        return [dict(r) for r in conn.execute(
            "SELECT c.contract_number, cu.name FROM contracts c "
            "JOIN customers cu ON cu.id = c.customer_id "
            "WHERE c.status = 'متوقف'").fetchall()]


def first_contract_id_for_project(project_id: int):
    with get_connection() as conn:
        row = conn.execute("SELECT id FROM contracts WHERE project_id=? LIMIT 1", (project_id,)).fetchone()
    return row["id"] if row else None


def set_payment_method_active(method_id: int, active: bool) -> None:
    with get_connection() as conn:
        conn.execute("UPDATE payment_methods SET is_active=? WHERE id=?",
                     (1 if active else 0, method_id))
    try:
        from services import settings_service
        settings_service.clear_cache()
    except Exception:
        pass


def sub_contract_exists_for_contract(contract_id: int) -> bool:
    with get_connection() as conn:
        return conn.execute(
            "SELECT id FROM sub_contracts WHERE contract_id = ?",
            (contract_id,)).fetchone() is not None


def sub_contract_duplicate(subcontractor_id: int, contract_id: int) -> bool:
    with get_connection() as conn:
        return conn.execute(
            "SELECT id FROM sub_contracts WHERE subcontractor_id = ? AND contract_id = ?",
            (subcontractor_id, contract_id)).fetchone() is not None


def subcontractor_contract_items(subcontractor_id: int) -> list[tuple]:
    with get_connection() as conn:
        # V3.20: الاستثناء — المقاول المستثنى يرى كل عقود كل العملاء.
        try:
            flag = conn.execute(
                "SELECT show_all_contracts FROM subcontractors WHERE id=?",
                (subcontractor_id,)).fetchone()
            if flag and flag[0]:
                rows = conn.execute(
                    "SELECT DISTINCT c.id, c.contract_number, "
                    "c.contract_name, c.description, "
                    "cu.name AS customer_name FROM contracts c "
                    "JOIN customers cu ON cu.id = c.customer_id "
                    "ORDER BY c.id DESC").fetchall()
                return [_contract_row_to_item(r) for r in rows]
        except Exception:
            pass
        rows = conn.execute(
            "SELECT DISTINCT c.id, c.contract_number, "
            "c.contract_name, c.description, "
            "cu.name AS customer_name FROM sub_contracts sc "
            "JOIN contracts c ON c.id = sc.contract_id "
            "JOIN customers cu ON cu.id = c.customer_id "
            "WHERE sc.subcontractor_id=? AND sc.status != 'ملغى' "
            "ORDER BY c.id DESC", (subcontractor_id,)).fetchall()
    return [_contract_row_to_item(r) for r in rows]


def _contract_row_to_item(r) -> tuple:
    cname = r["contract_name"] or r["description"] or ""
    core = (f"{r['contract_number']} · {cname}" if cname else r["contract_number"])
    cust = (r["customer_name"] or "").strip()
    display = f"{cust} — {core}" if cust else core
    return (display, r["id"], r["customer_name"])
