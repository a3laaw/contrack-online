# -*- coding: utf-8 -*-
"""منطق الأعمال الخاص بالفواتير · مع قاعدة منع تجاوز المتبقي من العقد."""
import sqlite3

from database.database import get_connection, DatabaseError
from database.models import Invoice
from services.search_utils import normalized_search_clause
from services.customer_service import ValidationError
from services import contract_service

_BASE_SQL = """
SELECT i.*, cu.name AS customer_name, c.contract_number
FROM invoices i
JOIN customers cu ON cu.id = i.customer_id
JOIN contracts c  ON c.id = i.contract_id
"""


def _row_to_invoice(row) -> Invoice:
    return Invoice(
        id=row["id"], invoice_number=row["invoice_number"],
        customer_id=row["customer_id"], contract_id=row["contract_id"],
        invoice_date=row["invoice_date"], description=row["description"] or "",
        amount=float(row["amount"]), notes=row["notes"] or "",
        created_at=row["created_at"], customer_name=row["customer_name"],
        contract_number=row["contract_number"],
    )


def next_invoice_number() -> str:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT invoice_number FROM invoices "
            "WHERE invoice_number LIKE 'INV-%' "
            "ORDER BY CAST(SUBSTR(invoice_number, 5) AS INTEGER) DESC LIMIT 1"
        ).fetchone()
    num = 1
    if row:
        try:
            num = int(row["invoice_number"].split("-")[1]) + 1
        except (IndexError, ValueError):
            with get_connection() as conn:
                num = conn.execute("SELECT COUNT(*) FROM invoices").fetchone()[0] + 1
    return f"INV-{num:04d}"


def list_invoices(search: str = "", customer_id: int | None = None,
                  contract_id: int | None = None) -> list[Invoice]:
    sql = _BASE_SQL
    where, params = [], []
    if search.strip():
        clause, p = normalized_search_clause(
            ["i.invoice_number", "cu.name", "c.contract_number", "cu.phone",
             "cu.customer_code", "i.description"], search)
        where.append(clause)
        params += p
    if customer_id:
        where.append("i.customer_id = ?")
        params.append(customer_id)
    if contract_id:
        where.append("i.contract_id = ?")
        params.append(contract_id)
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY i.id DESC"
    with get_connection() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [_row_to_invoice(r) for r in rows]


def get_invoice(invoice_id: int) -> Invoice | None:
    with get_connection() as conn:
        row = conn.execute(_BASE_SQL + " WHERE i.id = ?", (invoice_id,)).fetchone()
    return _row_to_invoice(row) if row else None


def contract_financials(contract_id: int, exclude_invoice_id: int | None = None) -> dict:
    """قيمة العقد + إجمالي الفواتير + المتبقي (مع إمكانية استثناء فاتورة عند التعديل)."""
    with get_connection() as conn:
        contract = conn.execute(
            "SELECT amount FROM contracts WHERE id=?", (contract_id,)).fetchone()
        if not contract:
            raise ValidationError("العقد غير موجود.")
        sql = "SELECT COALESCE(SUM(amount),0) FROM invoices WHERE contract_id=?"
        params: list = [contract_id]
        if exclude_invoice_id:
            sql += " AND id != ?"
            params.append(exclude_invoice_id)
        invoiced = conn.execute(sql, params).fetchone()[0]
    amount = float(contract["amount"])
    invoiced = float(invoiced)
    return {"contract_amount": amount, "total_invoiced": invoiced,
            "remaining": amount - invoiced}


def _validate(invoice: Invoice, exclude_invoice_id: int | None = None) -> None:
    if not invoice.invoice_number.strip():
        raise ValidationError("رقم الفاتورة مطلوب.")
    if not invoice.customer_id:
        raise ValidationError("يجب اختيار العميل.")
    if not invoice.contract_id:
        raise ValidationError("يجب اختيار العقد.")
    if not invoice.invoice_date.strip():
        raise ValidationError("تاريخ الفاتورة مطلوب.")
    if invoice.amount is None or invoice.amount <= 0:
        raise ValidationError("قيمة الفاتورة يجب أن تكون أكبر من صفر.")
    # التأكد أن العقد يخص نفس العميل
    contract = contract_service.get_contract(invoice.contract_id)
    if not contract:
        raise ValidationError("العقد غير موجود.")
    if contract.customer_id != invoice.customer_id:
        raise ValidationError("العقد المختار لا يخص هذا العميل.")
    # القاعدة الأهم: عدم تجاوز المتبقي
    fin = contract_financials(invoice.contract_id, exclude_invoice_id)
    if invoice.amount > fin["remaining"] + 1e-9:
        raise ValidationError(
            "قيمة الفاتورة تتجاوز المبلغ المتبقي من العقد.\n"
            f"المبلغ المتبقي: {fin['remaining']:,.3f}"
        )


def add_invoice(invoice: Invoice) -> int:
    _validate(invoice)
    for attempt in range(8):
        try:
            with get_connection() as conn:
                cur = conn.execute(
                    "INSERT INTO invoices (invoice_number, customer_id, contract_id, "
                    "invoice_date, description, amount, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (invoice.invoice_number.strip(), invoice.customer_id,
                     invoice.contract_id, invoice.invoice_date,
                     invoice.description.strip(), invoice.amount, invoice.notes.strip()),
                )
                return cur.lastrowid
        except sqlite3.IntegrityError as exc:
            if "invoice_number" in str(exc).lower() and attempt < 7:
                invoice.invoice_number = next_invoice_number()
                continue
            raise ValidationError("رقم الفاتورة مستخدم من قبل.") from exc
        except sqlite3.Error as exc:
            raise DatabaseError(f"خطأ في قاعدة البيانات: {exc}") from exc
    raise ValidationError("تعذر حجز رقم فاتورة غير مكرر، حاول مرة أخرى.")

def update_invoice(invoice: Invoice) -> None:
    if not invoice.id:
        raise ValidationError("لم يتم تحديد الفاتورة.")
    _validate(invoice, exclude_invoice_id=invoice.id)
    try:
        with get_connection() as conn:
            conn.execute(
                "UPDATE invoices SET invoice_number=?, customer_id=?, contract_id=?, "
                "invoice_date=?, description=?, amount=?, notes=? WHERE id=?",
                (invoice.invoice_number.strip(), invoice.customer_id,
                 invoice.contract_id, invoice.invoice_date,
                 invoice.description.strip(), invoice.amount,
                 invoice.notes.strip(), invoice.id),
            )
    except sqlite3.IntegrityError as exc:
        raise ValidationError("رقم الفاتورة مستخدم من قبل.") from exc
    except sqlite3.Error as exc:
        raise DatabaseError(f"خطأ في قاعدة البيانات: {exc}") from exc


def delete_invoice(invoice_id: int) -> None:
    try:
        with get_connection() as conn:
            conn.execute("DELETE FROM invoices WHERE id=?", (invoice_id,))
    except sqlite3.Error as exc:
        raise DatabaseError(f"خطأ في قاعدة البيانات: {exc}") from exc
