# -*- coding: utf-8 -*-
"""البحث الشامل الذكي · يبحث في كل كيانات النظام دفعة واحدة.

اكتب أي شيء: اسم عميل، رقم هاتف، رقم عقد/فاتورة/سند، اسم مشروع أو مقاول —
ويرجع النتائج مصنفة مع مرجع فتحها.
"""
from database.database import get_connection
from services.search_utils import like_param, sql_norm_expr


def _where(cols: list[str]) -> str:
    return " OR ".join(f"{sql_norm_expr(c)} LIKE ?" for c in cols)


def _params(q: str, n: int, limit: int) -> tuple:
    return tuple([like_param(q)] * n + [limit])


def global_search(query: str, limit_per_type: int = 8) -> list[dict]:
    """يرجع قائمة نتائج: {type, type_label, icon, id, title, subtitle}."""
    q = (query or "").strip()
    if len(q) < 2:
        return []
    results: list[dict] = []

    with get_connection() as conn:
        # ===== العملاء: اسم / رقم / هاتف / بريد / عنوان =====
        _cols = ["name", "customer_code", "phone", "email", "address", "address_governorate", "address_area"]
        rows = conn.execute(
            "SELECT id, customer_code, name, phone FROM customers "
            "WHERE " + _where(_cols) + " LIMIT ?",
            _params(q, len(_cols), limit_per_type)).fetchall()
        for r in rows:
            results.append({
                "type": "customer", "type_label": "عميل", "icon": "👥",
                "id": r["id"],
                "title": f"{r['name']} ({r['customer_code']})",
                "subtitle": f"هاتف: {r['phone']}" if r["phone"] else "",
            })

        # ===== العقود: رقم / اسم / وصف / عميل / هاتفه =====
        _cols = ["c.contract_number", "c.contract_name", "c.description", "cu.name", "cu.phone", "cu.customer_code"]
        rows = conn.execute(
            "SELECT c.id, c.contract_number, c.contract_name, "
            "c.amount + COALESCE((SELECT SUM(a.amount_add - a.amount_deduct) "
            "  FROM addendums a WHERE a.contract_id = c.id "
            "  AND a.status='معتمد'), 0) AS amount, "
            "cu.name AS customer_name FROM contracts c "
            "JOIN customers cu ON cu.id = c.customer_id "
            "WHERE " + _where(_cols) + " LIMIT ?",
            _params(q, len(_cols), limit_per_type)).fetchall()
        for r in rows:
            results.append({
                "type": "contract", "type_label": "عقد", "icon": "📑",
                "id": r["id"],
                "title": f"{r['contract_number']}"
                         + (f" · {r['contract_name']}" if r["contract_name"] else ""),
                "subtitle": f"{r['customer_name']} • {r['amount']:,.3f}",
            })

        # ===== المشاريع =====
        _cols = ["p.name", "p.project_code", "cu.name", "cu.phone"]
        rows = conn.execute(
            "SELECT p.id, p.project_code, p.name, cu.name AS customer_name "
            "FROM projects p LEFT JOIN customers cu ON cu.id = p.customer_id "
            "WHERE " + _where(_cols) + " LIMIT ?",
            _params(q, len(_cols), limit_per_type)).fetchall()
        for r in rows:
            results.append({
                "type": "project", "type_label": "مشروع", "icon": "🏗",
                "id": r["id"],
                "title": f"{r['project_code']} · {r['name']}",
                "subtitle": r["customer_name"] or "",
            })

        # ===== مقاولو الباطن =====
        _cols = ["name", "sub_code", "phone", "activity"]
        rows = conn.execute(
            "SELECT id, sub_code, name, phone, activity FROM subcontractors "
            "WHERE " + _where(_cols) + " LIMIT ?",
            _params(q, len(_cols), limit_per_type)).fetchall()
        for r in rows:
            sub = " • ".join(x for x in [r["activity"], r["phone"]] if x)
            results.append({
                "type": "subcontractor", "type_label": "مقاول باطن", "icon": "👷",
                "id": r["id"],
                "title": f"{r['name']} ({r['sub_code']})",
                "subtitle": sub,
            })

        # ===== السندات (قبض وصرف) =====
        _cols = ["v.voucher_number", "v.party", "v.description", "v.account", "v.expense_account_snapshot", "v.custody_account_snapshot", "c.contract_number", "c.contract_name"]
        rows = conn.execute(
            "SELECT v.id, v.voucher_number, v.vtype, v.party, v.amount, v.vdate "
            "FROM vouchers v "
            "LEFT JOIN contracts c ON c.id = v.contract_id "
            "WHERE " + _where(_cols) + " LIMIT ?",
            _params(q, len(_cols), limit_per_type)).fetchall()
        for r in rows:
            is_r = r["vtype"] == "receipt"
            results.append({
                "type": "voucher_receipt" if is_r else "voucher_payment",
                "type_label": "سند قبض" if is_r else "سند صرف",
                "icon": "📥" if is_r else "📤",
                "id": r["id"],
                "title": f"{r['voucher_number']} · {r['party']}",
                "subtitle": f"{r['amount']:,.3f} • {r['vdate']}",
            })

        # ===== الفواتير =====
        _cols = ["i.invoice_number", "cu.name", "cu.phone", "i.description"]
        rows = conn.execute(
            "SELECT i.id, i.invoice_number, i.amount, i.invoice_date, "
            "cu.name AS customer_name FROM invoices i "
            "JOIN customers cu ON cu.id = i.customer_id "
            "WHERE " + _where(_cols) + " LIMIT ?",
            _params(q, len(_cols), limit_per_type)).fetchall()
        for r in rows:
            results.append({
                "type": "invoice", "type_label": "فاتورة", "icon": "🧾",
                "id": r["id"],
                "title": f"{r['invoice_number']} · {r['customer_name']}",
                "subtitle": f"{r['amount']:,.3f} • {r['invoice_date']}",
            })

    return results
