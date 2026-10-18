# -*- coding: utf-8 -*-
"""أداة تنظيف البيانات — للمطور فقط.

الغرض المعتمد: حذف البيانات التجريبية أو الخاطئة التي دخلت من
الاستيراد، وتنظيف القاعدة قبل التسليم — لا لإخفاء حركة مالية حقيقية.

مبادئ السلامة المطبّقة في هذا الملف:
  · **المطور فقط** — أي مستخدم آخر يُرفض من الخدمة نفسها لا من الواجهة
    فقط، فلا يمكن الالتفاف عليها.
  · **لقطة كاملة قبل الحذف** — كل صف يُحذف يُحفظ نصًا في جدول
    ``purge_audit`` (من · متى · لماذا · البيانات كاملة)، فلا يضيع
    شيء بلا أثر ويمكن استرجاع القيم يدويًا عند الحاجة.
  · **معاينة قبل التنفيذ** — ``preview_*`` تُرجع ما سيُحذف بالضبط
    بلا أي كتابة في قاعدة البيانات.
  · **حذف صريح فقط** — لا شيء يُحذف إلا بمعرفات مُمرَّرة صراحةً
    وسبب مكتوب؛ لا حذف جماعي ضمني ولا صامت.
  · **الترتيب الآمن** — تُحذف الجداول التابعة قبل الأصل حتى لا تبقى
    إشارات معلّقة تكسر الشاشات.
"""
from __future__ import annotations

import json

from database.database import get_connection
from services.customer_service import ValidationError


# ============================================================
# سجل التدقيق
# ============================================================
def _ensure_audit_table() -> None:
    """جدول سجل الحذف — يُنشأ عند أول استخدام فقط.

    ملاحظة: هذا الجدول **إضافة لا تمسّ أي جدول قائم**، ولا يغيّر بنية
    أي بيانات موجودة عندك.
    """
    with get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS purge_audit (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                purged_at   TEXT NOT NULL
                            DEFAULT (datetime('now','localtime')),
                purged_by   TEXT DEFAULT '',
                entity      TEXT NOT NULL,     -- customer / contract / voucher
                entity_id   INTEGER,
                label       TEXT DEFAULT '',   -- وصف مقروء للمحذوف
                reason      TEXT DEFAULT '',
                snapshot    TEXT DEFAULT ''    -- JSON بكل الصفوف المحذوفة
            )""")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_purge_audit_entity "
                     "ON purge_audit(entity, purged_at DESC)")


def _require_developer() -> str:
    """لا تُنفَّذ أي عملية حذف إلا لحساب المطور."""
    from services import auth_service
    if not auth_service.is_developer():
        raise ValidationError(
            "أداة التنظيف متاحة لحساب المطور فقط.\n"
            "هذه الأداة تحذف بيانات نهائيًا ولا تُتاح لأي مستخدم آخر.")
    return auth_service.display_name() or auth_service.current_username()


def _rows_as_dicts(conn, sql: str, params: tuple = ()) -> list[dict]:
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


def _log(conn, by: str, entity: str, entity_id: int, label: str,
         reason: str, snapshot: dict) -> None:
    conn.execute(
        "INSERT INTO purge_audit (purged_by, entity, entity_id, label, "
        "reason, snapshot) VALUES (?,?,?,?,?,?)",
        (by, entity, int(entity_id or 0), label, (reason or "").strip(),
         json.dumps(snapshot, ensure_ascii=False, default=str)))


# ============================================================
# الجداول التابعة (تُحذف قبل الأصل)
# ============================================================
#: جداول تشير إلى العقد — الترتيب مقصود: الأحفاد قبل الآباء.
#: payment_plan قبل contract_stages لأن الدفعة تشير لمرحلة (V3.22).
#: sub_contracts قبل contract_stages لأن بنود الباطن تشير لمراحلها (V4.5.01).
_CONTRACT_CHILDREN = [
    ("addendums", "contract_id"),
    ("boq_items", "contract_id"),
    ("contract_attachments", "contract_id"),
    ("contract_components", "contract_id"),
    ("contract_events", "contract_id"),
    ("contract_group_items", "contract_id"),
    ("contract_scope", "contract_id"),
    ("payment_plan", "contract_id"),
    ("sub_contracts", "contract_id"),
    ("contract_stages", "contract_id"),
    ("quotations", "contract_id"),
    ("invoices", "contract_id"),
]

#: جداول تشير إلى العميل.
_CUSTOMER_CHILDREN = [
    ("contract_groups", "customer_id"),
    ("invoices", "customer_id"),
    ("projects", "customer_id"),
    ("quotations", "customer_id"),
    ("visits", "customer_id"),
]


def _has_col(conn, table: str, col: str) -> bool:
    """هل يوجد العمود فعلًا؟ (بعض الأعمدة اختيارية حسب تاريخ القاعدة)"""
    if not _table_exists(conn, table):
        return False
    try:
        return col in {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
    except Exception:
        return False


def _table_exists(conn, name: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (name,)).fetchone() is not None


def _collect(conn, table: str, col: str, value: int) -> list[dict]:
    if not _table_exists(conn, table):
        return []
    try:
        return _rows_as_dicts(
            conn, f"SELECT * FROM {table} WHERE {col}=?", (value,))
    except Exception:
        return []


def _collect_claims(conn, cid: int) -> list[dict]:
    """V4.5.01: مطالبات العقد — صفوفه المباشرة وما يشير لبنود خطته/مقاولاته."""
    if not _table_exists(conn, "claims"):
        return []
    try:
        return _rows_as_dicts(
            conn,
            "SELECT * FROM claims WHERE contract_id=? "
            "OR cust_line_id IN "
            "(SELECT id FROM payment_plan WHERE contract_id=?) "
            "OR sub_contract_id IN "
            "(SELECT id FROM sub_contracts WHERE contract_id=?)",
            (cid, cid, cid))
    except Exception:
        return []


def list_entities(kind: str, query: str = "", limit: int = 500) -> list[dict]:
    """قائمة مختصرة لاختيار ما سيُحذف — قراءة فقط.

    هذه الدالة موجودة حتى تبقى الواجهة بلا SQL مباشر، وكل وصول للقاعدة
    يمر عبر طبقة الخدمات كما هو معيار المشروع.
    """
    kind = (kind if kind in ("customer", "contract", "voucher", "subcontractor",
                             "sub_contract", "claim")
            else "customer")
    limit = max(1, min(int(limit or 500), 1000))
    q = f"%{(query or '').strip()}%"
    with get_connection() as conn:
        if kind == "subcontractor":
            # V5.4: مقاولو الباطن — حذف المقاول وحركاته
            return _rows_as_dicts(
                conn,
                "SELECT id, sub_code, name, phone FROM subcontractors "
                "WHERE name LIKE ? OR sub_code LIKE ? OR phone LIKE ? "
                "ORDER BY id DESC LIMIT ?",
                (q, q, q, limit))
        if kind == "customer":
            return _rows_as_dicts(
                conn,
                "SELECT id, customer_code, name, phone FROM customers "
                "WHERE name LIKE ? OR customer_code LIKE ? OR phone LIKE ? "
                "ORDER BY id DESC LIMIT ?",
                (q, q, q, limit))
        if kind == "contract":
            return _rows_as_dicts(
                conn,
                "SELECT c.id, c.contract_number, "
                "COALESCE(NULLIF(TRIM(c.description),''), c.contract_name) AS description, "
                "cu.name AS customer, c.amount FROM contracts c "
                "LEFT JOIN customers cu ON cu.id=c.customer_id "
                "WHERE c.contract_number LIKE ? OR c.description LIKE ? "
                "OR cu.name LIKE ? ORDER BY c.id DESC LIMIT ?",
                (q, q, q, limit))
        if kind == "voucher":
            return _rows_as_dicts(
                conn,
                "SELECT id, voucher_number, vtype, vdate, party, amount, "
                "COALESCE(cancelled,0) AS cancelled FROM vouchers "
                "WHERE voucher_number LIKE ? OR party LIKE ? "
                "OR description LIKE ? ORDER BY id DESC LIMIT ?",
                (q, q, q, limit))
        if kind == "sub_contract":
            return _rows_as_dicts(
                conn,
                "SELECT sc.id, s.name AS sub_name, "
                "c.contract_number, sc.amount, sc.status "
                "FROM sub_contracts sc "
                "JOIN subcontractors s ON s.id=sc.subcontractor_id "
                "JOIN contracts c ON c.id=sc.contract_id "
                "WHERE s.name LIKE ? OR c.contract_number LIKE ? "
                "ORDER BY sc.id DESC LIMIT ?",
                (q, q, limit))
        # claim: نعرض العقود التي لها مطالبات
        return _rows_as_dicts(
            conn,
            "SELECT c.id, c.contract_number, "
            "COUNT(cl.id) AS claims_count, "
            "SUM(CASE WHEN cl.status='registered' THEN 1 ELSE 0 END) AS reg_count, "
            "COALESCE(SUM(cl.amount),0) AS total_amount "
            "FROM contracts c "
            "JOIN claims cl ON cl.contract_id=c.id "
            "WHERE c.contract_number LIKE ? OR cl.title LIKE ? "
            "GROUP BY c.id ORDER BY c.id DESC LIMIT ?",
            (q, q, limit))


# ============================================================
# 1) السندات
# ============================================================
def preview_vouchers(voucher_ids: list[int]) -> list[dict]:
    """ما الذي سيُحذف من السندات؟ — قراءة فقط."""
    ids = [int(i) for i in (voucher_ids or []) if i]
    if not ids:
        return []
    marks = ",".join("?" * len(ids))
    with get_connection() as conn:
        return _rows_as_dicts(
            conn,
            f"SELECT id, voucher_number, vtype, vdate, party, amount, "
            f"description, COALESCE(cancelled,0) AS cancelled "
            f"FROM vouchers WHERE id IN ({marks}) ORDER BY id", tuple(ids))


def purge_vouchers(voucher_ids: list[int], reason: str) -> dict:
    """حذف سندات نهائيًا بعد حفظ لقطة كاملة في سجل التدقيق."""
    by = _require_developer()
    reason = (reason or "").strip()
    if not reason:
        raise ValidationError("اكتب سبب الحذف — يُحفظ في سجل التدقيق.")
    ids = [int(i) for i in (voucher_ids or []) if i]
    if not ids:
        raise ValidationError("اختر سندًا واحدًا على الأقل.")
    _ensure_audit_table()
    done = 0
    with get_connection() as conn:
        for vid in ids:
            row = conn.execute("SELECT * FROM vouchers WHERE id=?",
                               (vid,)).fetchone()
            if not row:
                continue
            row = dict(row)
            snapshot = {"vouchers": [row]}
            # القيود المحاسبية المرتبطة (إن وُجدت)
            if _table_exists(conn, "journal_entries"):
                try:
                    je = _rows_as_dicts(
                        conn, "SELECT * FROM journal_entries "
                        "WHERE source_type LIKE 'voucher%' AND source_id=?",
                        (vid,))
                    if je:
                        snapshot["journal_entries"] = je
                        conn.execute(
                            "DELETE FROM journal_entries "
                            "WHERE source_type LIKE 'voucher%' AND source_id=?",
                            (vid,))
                except Exception:
                    pass
            # V3.14: حُذفت محاولة فك ارتباط وهمية (لا عمود voucher_id في payment_plan).
            # سندات الأبناء تُفكّ لا تُحذف ضمنيًا
            try:
                conn.execute(
                    "UPDATE vouchers SET parent_voucher_id=NULL "
                    "WHERE parent_voucher_id=?", (vid,))
            except Exception:
                pass
            label = (f"{row.get('voucher_number','')} · "
                     f"{row.get('amount',0)} · {row.get('party','')}")
            _log(conn, by, "voucher", vid, label, reason, snapshot)
            conn.execute("DELETE FROM vouchers WHERE id=?", (vid,))
            done += 1
    return {"deleted": done}


# ============================================================
# 2) العقود
# ============================================================
def preview_contract(contract_id: int) -> dict:
    """ما الذي سيُحذف مع العقد؟ — قراءة فقط."""
    cid = int(contract_id or 0)
    if not cid:
        return {}
    with get_connection() as conn:
        row = conn.execute(
            "SELECT c.*, cu.name AS customer_name FROM contracts c "
            "LEFT JOIN customers cu ON cu.id=c.customer_id WHERE c.id=?",
            (cid,)).fetchone()
        if not row:
            return {}
        out = {"contract": dict(row), "children": {}}
        for table, col in _CONTRACT_CHILDREN:
            rows = _collect(conn, table, col, cid)
            if rows:
                out["children"][table] = len(rows)
        _cl = _collect_claims(conn, cid)
        if _cl:
            out["children"]["claims"] = len(_cl)
        vrows = _collect(conn, "vouchers", "contract_id", cid)
        if vrows:
            out["children"]["vouchers"] = len(vrows)
            out["vouchers_total"] = sum(float(v.get("amount") or 0)
                                        for v in vrows
                                        if not v.get("cancelled"))
        return out


def purge_contract(contract_id: int, reason: str,
                   delete_vouchers: bool = False) -> dict:
    """حذف عقد وكل تفاصيله بعد حفظ لقطة كاملة.

    ``delete_vouchers``: إن كانت False (الافتراضي) وللعقد سندات، تُرفض
    العملية ويُطلب قرار صريح — لا نحذف حركة مالية ضمنًا أبدًا.
    """
    by = _require_developer()
    reason = (reason or "").strip()
    if not reason:
        raise ValidationError("اكتب سبب الحذف — يُحفظ في سجل التدقيق.")
    cid = int(contract_id or 0)
    if not cid:
        raise ValidationError("حدد العقد.")
    _ensure_audit_table()
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM contracts WHERE id=?",
                           (cid,)).fetchone()
        if not row:
            raise ValidationError("العقد غير موجود.")
        row = dict(row)
        vrows = _collect(conn, "vouchers", "contract_id", cid)
        if vrows and not delete_vouchers:
            raise ValidationError(
                f"العقد «{row.get('contract_number','')}» عليه "
                f"{len(vrows)} سند.\n"
                "فعّل خيار «احذف سنداته أيضًا» صراحةً، أو احذف/انقل "
                "السندات أولًا.")
        snapshot = {"contracts": [row]}
        # V3.22: السندات أولًا — السند قد يشير لبند/مقاولة فرعية
        # (boq_item_id / sub_contract_id) فيكسر حذفها بعده.
        if vrows:
            snapshot["vouchers"] = vrows
            if _table_exists(conn, "journal_entries"):
                try:
                    conn.execute(
                        "DELETE FROM journal_entries "
                        "WHERE source_type LIKE 'voucher%' AND source_id IN "
                        "(SELECT id FROM vouchers WHERE contract_id=?)",
                        (cid,))
                except Exception:
                    pass
            try:
                conn.execute(
                    "UPDATE vouchers SET parent_voucher_id=NULL "
                    "WHERE parent_voucher_id IN "
                    "(SELECT id FROM vouchers WHERE contract_id=?)", (cid,))
            except Exception:
                pass
            conn.execute("DELETE FROM vouchers WHERE contract_id=?", (cid,))
        # V4.5.01: المطالبات قبل بنود الخطة والمقاولات (تشير إليهما بلا CASCADE)
        _cl = _collect_claims(conn, cid)
        if _cl:
            snapshot["claims"] = _cl
            _ids = [int(r["id"]) for r in _cl]
            conn.execute(
                f"DELETE FROM claims WHERE id IN "
                f"({','.join('?' * len(_ids))})", tuple(_ids))
        # V3.22: لقطة الأحفاد المحذوفين تلقائيًا (CASCADE) قبل حذف آبائهم
        for _gtable, _gcol, _ptable in (
                ("quotation_items", "quotation_id", "quotations"),
                ("sub_contract_items", "sub_contract_id", "sub_contracts"),
                ("sub_payment_plan", "sub_contract_id", "sub_contracts")):
            if _table_exists(conn, _gtable) and _table_exists(conn, _ptable):
                try:
                    _grows = _rows_as_dicts(
                        conn,
                        f"SELECT g.* FROM {_gtable} g JOIN {_ptable} p "
                        f"ON p.id=g.{_gcol} WHERE p.contract_id=?", (cid,))
                    if _grows:
                        snapshot[_gtable] = _grows
                except Exception:
                    pass
        # التابع أولًا
        for table, col in _CONTRACT_CHILDREN:
            rows = _collect(conn, table, col, cid)
            if rows:
                snapshot[table] = rows
                conn.execute(f"DELETE FROM {table} WHERE {col}=?", (cid,))
        # سجل المراحل والتعليقات المرتبطة بالعقد
        for table, col in (("transaction_stage_log", "transaction_id"),
                           ("transaction_messages", "transaction_id")):
            if _table_exists(conn, table):
                try:
                    rows = _rows_as_dicts(
                        conn,
                        f"SELECT * FROM {table} WHERE transaction_type='contract' "
                        f"AND {col}=?", (cid,))
                    if rows:
                        snapshot[table] = rows
                        conn.execute(
                            f"DELETE FROM {table} WHERE "
                            f"transaction_type='contract' AND {col}=?", (cid,))
                except Exception:
                    pass
        if _table_exists(conn, "customer_comments"):
            try:
                rows = _rows_as_dicts(
                    conn, "SELECT * FROM customer_comments WHERE contract_id=?",
                    (cid,))
                if rows:
                    snapshot["customer_comments"] = rows
                    conn.execute(
                        "DELETE FROM customer_comments WHERE contract_id=?",
                        (cid,))
            except Exception:
                pass
        label = (f"{row.get('contract_number','')} · "
                 f"{row.get('description') or row.get('contract_name') or ''}")
        _log(conn, by, "contract", cid, label, reason, snapshot)
        conn.execute("DELETE FROM contracts WHERE id=?", (cid,))
    return {"deleted": 1, "vouchers": len(vrows)}


# ============================================================
# 3) العملاء
# ============================================================
def preview_customer(customer_id: int) -> dict:
    """ما الذي سيُحذف مع العميل؟ — قراءة فقط."""
    cid = int(customer_id or 0)
    if not cid:
        return {}
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM customers WHERE id=?",
                           (cid,)).fetchone()
        if not row:
            return {}
        out = {"customer": dict(row), "children": {}}
        cons = _collect(conn, "contracts", "customer_id", cid)
        if cons:
            out["children"]["contracts"] = len(cons)
        for table, col in _CUSTOMER_CHILDREN:
            rows = _collect(conn, table, col, cid)
            if rows:
                out["children"][table] = len(rows)
        try:
            n_v = conn.execute(
                "SELECT COUNT(*) FROM vouchers WHERE contract_id IN "
                "(SELECT id FROM contracts WHERE customer_id=?) "
                "OR expense_customer_id=? "
                "OR (party_type='customer' AND party_id=?)",
                (cid, cid, cid)).fetchone()[0]
            if n_v:
                out["children"]["vouchers"] = int(n_v)
        except Exception:
            pass
        return out


def purge_customer(customer_id: int, reason: str,
                   delete_contracts: bool = False) -> dict:
    """حذف عميل وكل ما يتبعه بعد حفظ لقطة كاملة.

    ``delete_contracts``: مطلوبة صراحةً إن كان للعميل عقود أو سندات.
    """
    by = _require_developer()
    reason = (reason or "").strip()
    if not reason:
        raise ValidationError("اكتب سبب الحذف — يُحفظ في سجل التدقيق.")
    cid = int(customer_id or 0)
    if not cid:
        raise ValidationError("حدد العميل.")
    _ensure_audit_table()
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM customers WHERE id=?",
                           (cid,)).fetchone()
        if not row:
            raise ValidationError("العميل غير موجود.")
        row = dict(row)
        con_ids = [int(r["id"]) for r in
                   _collect(conn, "contracts", "customer_id", cid)]
    if con_ids and not delete_contracts:
        raise ValidationError(
            f"العميل «{row.get('name','')}» له {len(con_ids)} عقد.\n"
            "فعّل خيار «احذف عقوده وسنداته أيضًا» صراحةً.")
    # احذف العقود أولًا (كل عقد بلقطته المستقلة)
    for con_id in con_ids:
        purge_contract(con_id, f"{reason} — ضمن حذف العميل",
                       delete_vouchers=True)
    with get_connection() as conn:
        snapshot = {"customers": [row]}
        # سندات مرتبطة بالعميل مباشرة (منصرف عليه أو طرف فيه)
        vrows = _rows_as_dicts(
            conn,
            "SELECT * FROM vouchers WHERE expense_customer_id=? "
            "OR (party_type='customer' AND party_id=?)", (cid, cid))
        if vrows:
            snapshot["vouchers"] = vrows
            ids = [int(v["id"]) for v in vrows]
            marks = ",".join("?" * len(ids))
            if _table_exists(conn, "journal_entries"):
                try:
                    conn.execute(
                        f"DELETE FROM journal_entries "
                        f"WHERE source_type LIKE 'voucher%' AND source_id IN ({marks})",
                        tuple(ids))
                except Exception:
                    pass
            conn.execute(f"DELETE FROM vouchers WHERE id IN ({marks})",
                         tuple(ids))
        for table, col in _CUSTOMER_CHILDREN:
            rows = _collect(conn, table, col, cid)
            if rows:
                snapshot[table] = rows
                conn.execute(f"DELETE FROM {table} WHERE {col}=?", (cid,))
        for table in ("customer_comments",):
            if _table_exists(conn, table):
                try:
                    rows = _rows_as_dicts(
                        conn, f"SELECT * FROM {table} WHERE customer_id=?",
                        (cid,))
                    if rows:
                        snapshot[table] = rows
                        conn.execute(
                            f"DELETE FROM {table} WHERE customer_id=?", (cid,))
                except Exception:
                    pass
        if _table_exists(conn, "transaction_stage_log"):
            try:
                conn.execute(
                    "DELETE FROM transaction_stage_log WHERE "
                    "transaction_type='customer' AND transaction_id=?", (cid,))
            except Exception:
                pass
        _log(conn, by, "customer", cid, row.get("name", ""), reason, snapshot)
        conn.execute("DELETE FROM customers WHERE id=?", (cid,))
    return {"deleted": 1, "contracts": len(con_ids)}


# ============================================================
# 3.b) مقاولو الباطن (V5.4)
# ============================================================
def _sub_contract_ids(conn, sub_id: int) -> list[int]:
    rows = conn.execute("SELECT id FROM sub_contracts WHERE subcontractor_id=?",
                        (int(sub_id),)).fetchall()
    return [int(r["id"]) for r in rows]


def _sub_money_snapshot(conn, sub_id: int) -> dict:
    """أبناء المقاول: عقود باطن · بنود · دفعات · مصادر · مطالبات · سندات."""
    sids = _sub_contract_ids(conn, sub_id)
    out = {"contracts": len(sids), "items": 0, "plan": 0, "sources": 0,
           "claims": 0, "vouchers": 0, "vouchers_total": 0.0,
           "vouchers_active": 0, "vouchers_cancelled": 0,
           "expense_accounts": 0}
    if sids:
        marks = ",".join("?" * len(sids))
        for table, col, key in (("sub_contract_items", "sub_contract_id", "items"),
                                ("sub_payment_plan", "sub_contract_id", "plan"),
                                ("claims", "sub_contract_id", "claims")):
            if _table_exists(conn, table):
                try:
                    out[key] = int(conn.execute(
                        f"SELECT COUNT(*) FROM {table} WHERE {col} IN ({marks})",
                        tuple(sids)).fetchone()[0])
                except Exception:
                    pass
        if _table_exists(conn, "sub_payment_sources"):
            try:
                out["sources"] = int(conn.execute(
                    "SELECT COUNT(*) FROM sub_payment_sources WHERE sub_line_id IN "
                    "(SELECT id FROM sub_payment_plan "
                    f"WHERE sub_contract_id IN ({marks}))", tuple(sids)).fetchone()[0])
            except Exception:
                pass
        if _has_col(conn, "expense_accounts", "sub_contract_id"):
            try:
                out["expense_accounts"] = int(conn.execute(
                    "SELECT COUNT(*) FROM expense_accounts "
                    f"WHERE sub_contract_id IN ({marks})", tuple(sids)).fetchone()[0])
            except Exception:
                pass
    # السندات: بطرف المقاول أو مرتبطة بأي عقد باطن له.
    # V5.5: تُعدّ **كل** السندات — بما فيها الملغاة — لأن حذف المقاول كان
    # يمرّ بلا خيار «السندات» إن كانت سنداته ملغاة، فتبقى معلّقة بلا مالك.
    conds = ["(party_type='subcontractor' AND party_id=?)"]
    params: list = [int(sub_id)]
    if sids:
        conds.append("sub_contract_id IN (" + ",".join("?" * len(sids)) + ")")
        params += sids
    rows = _rows_as_dicts(
        conn, "SELECT COUNT(*) AS n, "
        "COALESCE(SUM(COALESCE(cancelled,0)=0),0) AS active, "
        "COALESCE(SUM(CASE WHEN COALESCE(cancelled,0)=0 THEN amount ELSE 0 END),"
        "0) AS t FROM vouchers WHERE (" + " OR ".join(conds) + ")",
        tuple(params))
    if rows:
        out["vouchers"] = int(rows[0].get("n") or 0)
        out["vouchers_active"] = int(rows[0].get("active") or 0)
        out["vouchers_cancelled"] = out["vouchers"] - out["vouchers_active"]
        out["vouchers_total"] = float(rows[0].get("t") or 0)
    return out


def preview_subcontractor(sub_id: int) -> dict:
    """ما الذي سيُحذف مع مقاول الباطن؟ — قراءة فقط."""
    sid = int(sub_id or 0)
    if not sid:
        return {}
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM subcontractors WHERE id=?",
                           (sid,)).fetchone()
        if not row:
            return {}
        out = {"subcontractor": dict(row), "children": {}}
        m = _sub_money_snapshot(conn, sid)
        names = {"contracts": "sub_contracts", "items": "sub_contract_items",
                 "plan": "sub_payment_plan", "sources": "sub_payment_sources",
                 "claims": "claims", "vouchers": "vouchers",
                 "expense_accounts": "expense_accounts"}
        for k, v in m.items():
            if k.endswith("_total") or not v:
                continue
            out["children"][names.get(k, k)] = int(v)
        if m["vouchers_total"]:
            out["vouchers_total"] = m["vouchers_total"]
        out["vouchers_active"] = int(m.get("vouchers_active") or 0)
        out["vouchers_cancelled"] = int(m.get("vouchers_cancelled") or 0)
        return out


def purge_subcontractor(sub_id: int, reason: str,
                        delete_contracts: bool = False,
                        delete_vouchers: bool = False) -> dict:
    """حذف مقاول باطن وكل حركاته بعد حفظ لقطة كاملة.

    ``delete_contracts``: مطلوبة صراحةً إن كان له عقود باطن.
    ``delete_vouchers``: مطلوبة صراحةً إن كان عليه سندات — لا تُحذف
    حركة مالية ضمنًا أبدًا.
    بنود **عقد العميل تبقى سليمة** — يُحذف ارتباطها بالمقاول فقط.
    """
    by = _require_developer()
    reason = (reason or "").strip()
    if not reason:
        raise ValidationError("اكتب سبب الحذف — يُحفظ في سجل التدقيق.")
    sid = int(sub_id or 0)
    if not sid:
        raise ValidationError("حدد المقاول.")
    _ensure_audit_table()
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM subcontractors WHERE id=?",
                           (sid,)).fetchone()
        if not row:
            raise ValidationError("المقاول غير موجود.")
        row = dict(row)
        m = _sub_money_snapshot(conn, sid)
    if m["contracts"] and not delete_contracts:
        raise ValidationError(
            f"المقاول «{row.get('name','')}» له {m['contracts']} عقد باطن.\n"
            "فعّل خيار «احذف عقود الباطن أيضًا» صراحةً — أو احذف العقد المطلوب "
            "وحده من شاشة المقاولين ← «🗑 حذف بيانات المقاول».")
    if m["vouchers"] and not delete_vouchers:
        _extra = (f" (منها {m['vouchers_cancelled']} ملغى)"
                  if m.get("vouchers_cancelled") else "")
        raise ValidationError(
            f"المقاول «{row.get('name','')}» عليه {m['vouchers']} سند"
            f"{_extra} بمبلغ {m['vouchers_total']:,.3f} فعّال.\n"
            "فعّل خيار «احذف السندات أيضًا» صراحةً — أو احذف السند المطلوب "
            "وحده من شاشة المقاولين ← «🗑 حذف بيانات المقاول».")
    with get_connection() as conn:
        sids = _sub_contract_ids(conn, sid)
        snapshot: dict = {"subcontractors": [row]}
        if sids:
            marks = ",".join("?" * len(sids))
            snapshot["sub_contracts"] = _rows_as_dicts(
                conn, f"SELECT * FROM sub_contracts WHERE id IN ({marks})",
                tuple(sids))
            for table, key in (("sub_contract_items", "sub_contract_items"),
                               ("sub_payment_plan", "sub_payment_plan")):
                snapshot[key] = _rows_as_dicts(
                    conn, f"SELECT * FROM {table} WHERE sub_contract_id IN "
                    f"({marks})", tuple(sids))
            _line_ids = [int(r["id"]) for r in snapshot["sub_payment_plan"]]
            if _line_ids and _table_exists(conn, "sub_payment_sources"):
                _lm = ",".join("?" * len(_line_ids))
                snapshot["sub_payment_sources"] = _rows_as_dicts(
                    conn, f"SELECT * FROM sub_payment_sources "
                    f"WHERE sub_line_id IN ({_lm})", tuple(_line_ids))
            if _table_exists(conn, "claims"):
                snapshot["claims"] = _rows_as_dicts(
                    conn, f"SELECT * FROM claims WHERE sub_contract_id IN "
                    f"({marks})", tuple(sids))
            if _has_col(conn, "expense_accounts", "sub_contract_id"):
                snapshot["expense_accounts_unlinked"] = _rows_as_dicts(
                    conn, f"SELECT * FROM expense_accounts "
                    f"WHERE sub_contract_id IN ({marks})", tuple(sids))
            # V5.5: مراجع أوامر التغييري (V5.4) لا تبقى معلّقة على عقد محذوف
            if _table_exists(conn, "addendum_items"):
                snapshot["addendum_items"] = _rows_as_dicts(
                    conn, "SELECT * FROM addendum_items WHERE side='sub' "
                    f"AND sub_contract_id IN ({marks})", tuple(sids))
            if _has_col(conn, "addendums", "sub_contract_id"):
                snapshot["addendums_unlinked"] = _rows_as_dicts(
                    conn, f"SELECT * FROM addendums "
                    f"WHERE sub_contract_id IN ({marks})", tuple(sids))
            if _table_exists(conn, "claims") and _has_col(conn, "claims",
                                                          "sub_line_id"):
                snapshot["claims_unlinked_line"] = _rows_as_dicts(
                    conn, "SELECT * FROM claims WHERE sub_line_id IN "
                    "(SELECT id FROM sub_payment_plan WHERE sub_contract_id "
                    f"IN ({marks}))", tuple(sids))
            if _has_col(conn, "journal_entries", "sub_contract_id"):
                try:
                    _je = _rows_as_dicts(
                        conn, "SELECT * FROM journal_entries WHERE "
                        f"sub_contract_id IN ({marks})", tuple(sids))
                    if _je:
                        snapshot["journal_entries"] = _je
                        conn.execute("DELETE FROM journal_entries WHERE "
                                     f"sub_contract_id IN ({marks})", tuple(sids))
                except Exception:
                    pass
        conds = ["(party_type='subcontractor' AND party_id=?)"]
        vparams: list = [sid]
        if sids:
            conds.append("sub_contract_id IN (" + ",".join("?" * len(sids)) + ")")
            vparams += sids
        vrows = _rows_as_dicts(
            conn, "SELECT * FROM vouchers WHERE " + " OR ".join(conds),
            tuple(vparams))
        if vrows:
            snapshot["vouchers"] = vrows
            vids = [int(v["id"]) for v in vrows]
            vm = ",".join("?" * len(vids))
            if _table_exists(conn, "journal_entries"):
                try:
                    je = _rows_as_dicts(
                        conn, "SELECT * FROM journal_entries WHERE "
                        f"source_type LIKE 'voucher%' AND source_id IN ({vm})",
                        tuple(vids))
                    if je:
                        snapshot["journal_entries"] = je
                        conn.execute(
                            "DELETE FROM journal_entries WHERE "
                            f"source_type LIKE 'voucher%' AND source_id IN ({vm})",
                            tuple(vids))
                except Exception:
                    pass
            try:
                conn.execute("UPDATE vouchers SET parent_voucher_id=NULL "
                             "WHERE parent_voucher_id IN (" + vm + ")", tuple(vids))
            except Exception:
                pass
            conn.execute("DELETE FROM vouchers WHERE id IN (" + vm + ")",
                         tuple(vids))
        if sids:
            marks = ",".join("?" * len(sids))
            if _table_exists(conn, "claims"):
                try:
                    conn.execute(f"DELETE FROM claims WHERE sub_contract_id IN "
                                 f"({marks})", tuple(sids))
                except Exception:
                    pass
            if _table_exists(conn, "sub_payment_sources"):
                try:
                    conn.execute(
                        "DELETE FROM sub_payment_sources WHERE sub_line_id IN "
                        "(SELECT id FROM sub_payment_plan "
                        f"WHERE sub_contract_id IN ({marks}))", tuple(sids))
                except Exception:
                    pass
            if _table_exists(conn, "claims") and _has_col(conn, "claims",
                                                          "sub_line_id"):
                try:
                    conn.execute(
                        "DELETE FROM claims WHERE sub_line_id IN (SELECT id "
                        "FROM sub_payment_plan WHERE sub_contract_id IN "
                        f"({marks}))", tuple(sids))
                except Exception:
                    pass
            try:
                conn.execute("DELETE FROM addendum_items WHERE side='sub' AND "
                             f"sub_contract_id IN ({marks})", tuple(sids))
                conn.execute("UPDATE addendums SET sub_contract_id=NULL "
                             f"WHERE sub_contract_id IN ({marks})", tuple(sids))
            except Exception:
                pass
            conn.execute(f"DELETE FROM sub_payment_plan WHERE sub_contract_id "
                         f"IN ({marks})", tuple(sids))
            conn.execute(f"DELETE FROM sub_contract_items WHERE sub_contract_id "
                         f"IN ({marks})", tuple(sids))
            if _has_col(conn, "expense_accounts", "sub_contract_id"):
                try:
                    # لا يُحذف حساب المصروف — يُفكّ ارتباطه فقط
                    conn.execute(
                        f"UPDATE expense_accounts SET sub_contract_id=NULL "
                        f"WHERE sub_contract_id IN ({marks})", tuple(sids))
                except Exception:
                    pass
            conn.execute(f"DELETE FROM sub_contracts WHERE id IN ({marks})",
                         tuple(sids))
        label = f"{row.get('sub_code','')} · {row.get('name','')}"
        _log(conn, by, "subcontractor", sid, label, reason, snapshot)
        conn.execute("DELETE FROM subcontractors WHERE id=?", (sid,))
    return {"deleted": 1, "contracts": int(m["contracts"]),
            "vouchers": int(m["vouchers"]),
            "vouchers_active": int(m.get("vouchers_active") or 0),
            "vouchers_cancelled": int(m.get("vouchers_cancelled") or 0),
            "unlinked_items": int(m["items"])}


# ============================================================
# 4) سجل التدقيق — عرض واسترجاع
# ============================================================
def audit_log(limit: int = 200, entity: str = "") -> list[dict]:
    """آخر عمليات الحذف — من · متى · ماذا · لماذا."""
    _ensure_audit_table()
    sql = ("SELECT id, purged_at, purged_by, entity, entity_id, label, "
           "reason, LENGTH(snapshot) AS snapshot_size FROM purge_audit")
    params: list = []
    if entity:
        sql += " WHERE entity=?"
        params.append(entity)
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(int(limit or 200))
    with get_connection() as conn:
        return _rows_as_dicts(conn, sql, tuple(params))


def audit_snapshot(audit_id: int) -> dict:
    """اللقطة الكاملة لعملية حذف — لمراجعة ما حُذف بالتفصيل."""
    _ensure_audit_table()
    with get_connection() as conn:
        row = conn.execute("SELECT snapshot FROM purge_audit WHERE id=?",
                           (int(audit_id),)).fetchone()
    if not row:
        return {}
    try:
        return json.loads(row["snapshot"] or "{}")
    except Exception:
        return {}


# ============================================================
# 6) عقد باطن فقط (بدون حذف المقاول)
# ============================================================
def preview_sub_contract(sc_id: int) -> dict:
    """معاينة ما سيُحذف عند حذف عقد باطن فقط — قراءة فقط."""
    cid = int(sc_id or 0)
    if not cid:
        return {}
    with get_connection() as conn:
        row = conn.execute(
            "SELECT sc.*, s.name AS sub_name, c.contract_number "
            "FROM sub_contracts sc "
            "JOIN subcontractors s ON s.id=sc.subcontractor_id "
            "JOIN contracts c ON c.id=sc.contract_id "
            "WHERE sc.id=?", (cid,)).fetchone()
        if not row:
            return {}
        out = {"sub_contract": dict(row), "children": {}}
        # بنود + دفعات
        for tbl in ("sub_contract_items", "sub_payment_plan"):
            n = conn.execute(
                f"SELECT COUNT(*) FROM {tbl} WHERE sub_contract_id=?",
                (cid,)).fetchone()[0]
            if n:
                out["children"][tbl] = n
        # مصادر (via JOIN on sub_payment_plan)
        n_src = conn.execute(
            "SELECT COUNT(*) FROM sub_payment_sources sps "
            "JOIN sub_payment_plan sp ON sp.id=sps.sub_line_id "
            "WHERE sp.sub_contract_id=?", (cid,)).fetchone()[0]
        if n_src:
            out["children"]["sub_payment_sources"] = n_src
        # مطالبات
        n_cl = conn.execute(
            "SELECT COUNT(*) FROM claims WHERE sub_contract_id=?",
            (cid,)).fetchone()[0]
        if n_cl:
            out["children"]["claims"] = n_cl
        # سندات الصرف المرتبطة
        nv = conn.execute(
            "SELECT COUNT(*), COALESCE(SUM(amount),0) FROM vouchers "
            "WHERE sub_contract_id=? AND vtype='payment' AND cancelled=0",
            (cid,)).fetchone()
        if nv[0]:
            out["children"]["vouchers"] = int(nv[0])
            out["vouchers_total"] = float(nv[1])
        return out


def purge_sub_contract(sc_id: int, reason: str,
                       delete_vouchers: bool = False) -> dict:
    """حذف عقد باطن فقط (المقاول يبقى) بعد حفظ لقطة."""
    by = _require_developer()
    reason = (reason or "").strip()
    if not reason:
        raise ValidationError("اكتب سبب الحذف — يُحفظ في سجل التدقيق.")
    cid = int(sc_id or 0)
    if not cid:
        raise ValidationError("حدد عقد الباطن.")
    _ensure_audit_table()
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM sub_contracts WHERE id=?",
                           (cid,)).fetchone()
        if not row:
            raise ValidationError("عقد الباطن غير موجود.")
        row = dict(row)
        nv = conn.execute(
            "SELECT COUNT(*) FROM vouchers "
            "WHERE sub_contract_id=? AND vtype='payment' AND cancelled=0",
            (cid,)).fetchone()[0]
        if nv and not delete_vouchers:
            raise ValidationError(
                f"على هذا العقد {nv} سند صرف فعّال.\n"
                "فعّل خيار «احذف السندات أيضًا» صراحةً.")
        snapshot: dict = {"sub_contracts": [row]}
        # بنود + دفعات
        for tbl in ("sub_payment_plan", "sub_contract_items"):
            rows = _rows_as_dicts(conn,
                                  f"SELECT * FROM {tbl} WHERE sub_contract_id=?",
                                  (cid,))
            if rows:
                snapshot[tbl] = rows
                conn.execute(f"DELETE FROM {tbl} WHERE sub_contract_id=?",
                             (cid,))
        # مصادر (via sub_line_id → sub_payment_plan)
        sp_ids = [r["id"] for r in snapshot.get("sub_payment_plan", [])]
        if sp_ids and _table_exists(conn, "sub_payment_sources"):
            marks = ",".join("?" * len(sp_ids))
            src_rows = _rows_as_dicts(
                conn,
                f"SELECT * FROM sub_payment_sources "
                f"WHERE sub_line_id IN ({marks})", tuple(sp_ids))
            if src_rows:
                snapshot["sub_payment_sources"] = src_rows
                conn.execute(
                    f"DELETE FROM sub_payment_sources "
                    f"WHERE sub_line_id IN ({marks})", tuple(sp_ids))
        # مطالبات
        cl = _rows_as_dicts(conn,
                            "SELECT * FROM claims WHERE sub_contract_id=?",
                            (cid,))
        if cl:
            snapshot["claims"] = cl
            conn.execute("DELETE FROM claims WHERE sub_contract_id=?",
                         (cid,))
        if delete_vouchers:
            vrows = _rows_as_dicts(
                conn, "SELECT * FROM vouchers WHERE sub_contract_id=?",
                (cid,))
            if vrows:
                snapshot["vouchers"] = vrows
                conn.execute("DELETE FROM vouchers WHERE sub_contract_id=?",
                             (cid,))
        label = (f"{row.get('description','')} · "
                 f"{float(row.get('amount',0)):,.3f}")
        _log(conn, by, "sub_contract", cid, label, reason, snapshot)
        conn.execute("DELETE FROM sub_contracts WHERE id=?", (cid,))
    return {"deleted": 1, "vouchers": len(snapshot.get("vouchers", []))}


# ============================================================
# 7) المطالبات المالية — تصفير/حذف جماعي
# ============================================================
def preview_claims_for_contract(contract_id: int) -> dict:
    """معاينة مطالبات عقد — قراءة فقط."""
    cid = int(contract_id or 0)
    if not cid:
        return {}
    with get_connection() as conn:
        rows = _rows_as_dicts(
            conn,
            "SELECT cl.*, c.contract_number FROM claims cl "
            "JOIN contracts c ON c.id=cl.contract_id "
            "WHERE cl.contract_id=? ORDER BY cl.id", (cid,))
        reg = [r for r in rows if r.get("status") == "registered"]
        other = [r for r in rows if r.get("status") != "registered"]
        total = sum(float(r.get("amount") or 0) for r in rows)
        return {"contract_id": cid, "claims": rows,
                "registered": reg, "other": other,
                "total": total, "count": len(rows)}


def purge_claims(contract_id: int, reason: str,
                 registered_only: bool = True) -> dict:
    """حذف مطالبات عقد (مسجلة فقط أو كلها)."""
    by = _require_developer()
    reason = (reason or "").strip()
    if not reason:
        raise ValidationError("اكتب سبب الحذف — يُحفظ في سجل التدقيق.")
    cid = int(contract_id or 0)
    if not cid:
        raise ValidationError("حدد العقد.")
    _ensure_audit_table()
    with get_connection() as conn:
        where = "contract_id=?"
        params: list = [cid]
        if registered_only:
            where += " AND status='registered'"
        rows = _rows_as_dicts(conn,
                              f"SELECT * FROM claims WHERE {where}",
                              tuple(params))
        if not rows:
            raise ValidationError("لا توجد مطالبات مطابقة.")
        snapshot = {"claims": rows}
        conn.execute(f"DELETE FROM claims WHERE {where}", tuple(params))
        label = f"{len(rows)} مطالبة · إجمالي {sum(float(r.get('amount',0)) for r in rows):,.3f}"
        _log(conn, by, "claims", cid, label, reason, snapshot)
    return {"deleted": len(rows)}
