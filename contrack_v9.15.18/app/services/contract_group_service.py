# -*- coding: utf-8 -*-
"""مجموعات العقود: ضم عدة عقود مستقلة في حزمة متابعة واحدة.

المجموعة لا تدمج العقود ماليًا ولا تغيّر نوعها؛ هي ربط تنظيمي فقط
حتى يمكن عمل تصميم + إشراف + كتاب بلدية كعقود مستقلة ثم عرضها كملف واحد.
"""
from database.database import get_connection
from services.customer_service import ValidationError


def next_group_number() -> str:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT group_number FROM contract_groups "
            "WHERE group_number LIKE 'GRP-%' "
            "ORDER BY CAST(SUBSTR(group_number, 5) AS INTEGER) DESC LIMIT 1"
        ).fetchone()
    if row:
        try:
            n = int(str(row["group_number"]).split("-")[1]) + 1
        except Exception:
            n = 1
    else:
        n = 1
    return f"GRP-{n:04d}"


def _validate_contracts(customer_id: int, contract_ids: list[int]) -> list[int]:
    ids = [int(x) for x in contract_ids if x]
    ids = list(dict.fromkeys(ids))
    if len(ids) < 2:
        raise ValidationError("اختر عقدين على الأقل للضم في مجموعة واحدة.")
    q = ",".join("?" for _ in ids)
    with get_connection() as conn:
        rows = conn.execute(
            f"SELECT id, customer_id, status FROM contracts WHERE id IN ({q})", ids
        ).fetchall()
    found = {int(r["id"]): r for r in rows}
    missing = [i for i in ids if i not in found]
    if missing:
        raise ValidationError("يوجد عقد غير موجود ضمن الاختيارات.")
    for r in rows:
        if int(r["customer_id"]) != int(customer_id):
            raise ValidationError("لا يمكن ضم عقود عملاء مختلفين في نفس المجموعة.")
        if (r["status"] or "") == "ملغى":
            raise ValidationError("لا يمكن ضم عقد ملغى داخل مجموعة جديدة.")
    return ids


def create_group(customer_id: int, group_name: str, contract_ids: list[int],
                 notes: str = "") -> int:
    name = (group_name or "").strip()
    if not name:
        raise ValidationError("اسم المجموعة مطلوب.")
    ids = _validate_contracts(customer_id, contract_ids)
    from services import auth_service
    username = auth_service.current_username() or ""
    number = next_group_number()
    for attempt in range(8):
        try:
            with get_connection() as conn:
                cur = conn.execute(
                    "INSERT INTO contract_groups "
                    "(group_number, customer_id, group_name, notes, created_by) "
                    "VALUES (?,?,?,?,?)",
                    (number, int(customer_id), name, (notes or "").strip(), username))
                gid = int(cur.lastrowid)
                conn.executemany(
                    "INSERT OR IGNORE INTO contract_group_items "
                    "(group_id, contract_id) VALUES (?,?)",
                    [(gid, cid) for cid in ids])
            return gid
        except Exception as exc:
            if "unique" in str(exc).lower() and "group_number" in str(exc).lower() and attempt < 7:
                number = next_group_number()
                continue
            raise
    raise ValidationError("تعذر إنشاء رقم مجموعة غير مكرر.")


def list_groups(customer_id: int | None = None, contract_id: int | None = None) -> list[dict]:
    """قائمة المجموعات مع ملخص مالي غير مكرر.

    الربحية هنا مثل تقرير الربحية: كامل المحصّل - التكلفة، والتكلفة =
    منصرف فعلي + باقي التزامات عقود الباطن. لا نجمع نفس العقد مرتين داخل
    المجموعة بسبب قيد UNIQUE(group_id, contract_id).
    """
    where = ["1=1"]
    params: list = []
    if customer_id is not None:
        where.append("g.customer_id=?")
        params.append(int(customer_id))
    if contract_id is not None:
        where.append("EXISTS (SELECT 1 FROM contract_group_items x WHERE x.group_id=g.id AND x.contract_id=?)")
        params.append(int(contract_id))
    sql = f"""
        SELECT g.*, cu.name AS customer_name,
               COUNT(i.contract_id) AS contracts_count
        FROM contract_groups g
        JOIN customers cu ON cu.id=g.customer_id
        LEFT JOIN contract_group_items i ON i.group_id=g.id
        WHERE {' AND '.join(where)}
        GROUP BY g.id
        ORDER BY g.id DESC
    """
    with get_connection() as conn:
        base_rows = [dict(r) for r in conn.execute(sql, params).fetchall()]
    if not base_rows:
        return []

    from services import lifecycle_service as lc
    out: list[dict] = []
    for g in base_rows:
        contracts = group_contracts(int(g["id"]))
        current_total = collected_total = paid_total = subs_total = cost_total = 0.0
        for c in contracts:
            if (c.get("status") or "") == "ملغى":
                continue
            cid = int(c["id"])
            try:
                current_total += float(lc.contract_current_value(cid)["current"])
            except Exception:
                current_total += float(c.get("amount") or 0)
            with get_connection() as conn:
                collected = float(conn.execute(
                    "SELECT COALESCE(SUM(amount),0) FROM vouchers "
                    "WHERE contract_id=? AND vtype='receipt' AND cancelled=0",
                    (cid,)).fetchone()[0])
                paid = float(conn.execute(
                    "SELECT COALESCE(SUM(amount),0) FROM vouchers "
                    "WHERE contract_id=? AND vtype='payment' AND cancelled=0",
                    (cid,)).fetchone()[0])
            subs = float(lc.total_sub_contracts(cid))
            cost = paid + max(0.0, subs - paid)
            collected_total += collected
            paid_total += paid
            subs_total += subs
            cost_total += cost
        profit = collected_total - cost_total
        g.update({
            "current_total": current_total,
            "original_total": current_total,  # توافق مع واجهة قديمة
            "collected_total": collected_total,
            "paid_total": paid_total,
            "subs_total": subs_total,
            "cost_total": cost_total,
            "profit_total": profit,
            "margin": (profit / collected_total * 100) if collected_total > 0.001 else 0.0,
        })
        out.append(g)
    return out


def group_contracts(group_id: int) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT c.id, c.contract_number, c.contract_name, c.contract_type,
                   c.status, c.amount, cu.name AS customer_name
            FROM contract_group_items i
            JOIN contracts c ON c.id=i.contract_id
            JOIN customers cu ON cu.id=c.customer_id
            WHERE i.group_id=?
            ORDER BY c.id
        """, (int(group_id),)).fetchall()
    return [dict(r) for r in rows]
