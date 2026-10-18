# -*- coding: utf-8 -*-
"""خدمة التقارير · بيانات جاهزة لكل تقرير في مركز التقارير.

كل دالة ترجع البيانات محسوبة من الحركات (لا أرصدة مخزنة).
"""
from database.database import get_connection


# ============================================================
# 1) تقرير العملاء والأرصدة
# ============================================================
def contract_gaps_report() -> dict:
    """V3.2 (ج): العقود التي تختلف قيمتها عن مجموع خطتها/بنودها."""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT c.id, c.contract_number, c.contract_type, c.status, "
            "c.amount, cu.name AS customer_name, "
            "COALESCE((SELECT SUM(amount) FROM payment_plan "
            "WHERE contract_id=c.id), 0) AS plan_total, "
            "COALESCE((SELECT COUNT(*) FROM payment_plan "
            "WHERE contract_id=c.id), 0) AS plan_n, "
            "COALESCE((SELECT SUM(COALESCE(qty,1)*COALESCE(unit_price,0)) "
            "FROM boq_items WHERE contract_id=c.id "
            "AND COALESCE(deleted_addendum_id,0)=0), 0) AS items_total, "
            "COALESCE((SELECT COUNT(*) FROM boq_items "
            "WHERE contract_id=c.id "
            "AND COALESCE(deleted_addendum_id,0)=0), 0) AS items_n "
            "FROM contracts c LEFT JOIN customers cu "
            "ON cu.id=c.customer_id "
            "WHERE COALESCE(c.status,'') NOT IN ('ملغى', 'ملغي') "
            "ORDER BY c.id").fetchall()
    out = []
    for r in rows:
        amount = round(float(r["amount"] or 0), 3)
        plan = round(float(r["plan_total"] or 0), 3)
        items = round(float(r["items_total"] or 0), 3)
        gap_plan = round(plan - amount, 3) if r["plan_n"] else 0.0
        gap_items = round(items - amount, 3) if r["items_n"] else 0.0
        if abs(gap_plan) <= 0.001 and abs(gap_items) <= 0.001:
            continue
        out.append({"contract_id": r["id"],
                    "contract_number": r["contract_number"],
                    "customer_name": r["customer_name"] or "",
                    "contract_type": r["contract_type"] or "",
                    "status": r["status"] or "",
                    "amount": amount, "plan_total": plan,
                    "plan_n": r["plan_n"], "items_total": items,
                    "items_n": r["items_n"], "gap_plan": gap_plan,
                    "gap_items": gap_items})
    return {"rows": out, "count": len(out)}


def customers_balances(date_from: str = "", date_to: str = "") -> dict:
    """كل عميل: عدد عقوده، قيمتها الحالية (بالملحقات)، المحصّل، المتبقي.

    الفترة اختيارية: عند تحديدها تُحصر العقود بتاريخ إبرامها
    والتحصيلات بتاريخها داخل الفترة.
    """
    # الأداء: كانت الاستعلامات الفرعية المرتبطة تُعيد مسح جدول السندات
    # لكل عميل على حدة (O(عملاء × سندات)) — على 300 عميل و3500 سند كان
    # ذلك ~600ms محليًا وأضعافها على قاعدة الشبكة. أُعيدت الصياغة إلى
    # تجميعات مسبقة (CTE) تُحسب مرة واحدة ثم تُربط — نفس النتائج تمامًا.
    c_filter = " AND contract_date BETWEEN ? AND ?" if date_from else ""
    v_filter = " AND v.vdate BETWEEN ? AND ?" if date_from else ""
    d = [date_from, date_to]
    params: list = []
    if date_from:
        # ترتيب المعاملات حسب ورودها في الاستعلام أدناه:
        # con (contract_date) · rec_con · rec_party · pay_con
        # (addm بلا فلتر تاريخ لأنه يتبع حالة الاعتماد لا الفترة)
        params = d + d + d + d
    with get_connection() as conn:
        rows = conn.execute(f"""
            WITH con AS (
                SELECT customer_id,
                       COUNT(*) AS n,
                       COALESCE(SUM(amount), 0) AS val
                FROM contracts
                WHERE status != 'ملغى'{c_filter}
                GROUP BY customer_id),
            addm AS (
                SELECT c.customer_id,
                       SUM(a.amount_add - a.amount_deduct) AS net
                FROM addendums a
                JOIN contracts c ON c.id = a.contract_id
                WHERE a.status = 'معتمد'
                GROUP BY c.customer_id),
            rec_con AS (
                SELECT c.customer_id, SUM(v.amount) AS amt
                FROM vouchers v
                JOIN contracts c ON c.id = v.contract_id
                WHERE v.vtype = 'receipt' AND v.cancelled = 0{v_filter}
                GROUP BY c.customer_id),
            rec_party AS (
                SELECT v.party_id AS cid, SUM(v.amount) AS amt
                FROM vouchers v
                WHERE v.vtype = 'receipt' AND v.cancelled = 0
                  AND v.party_type = 'customer'
                  AND v.contract_id IS NULL{v_filter}
                GROUP BY v.party_id),
            pay_con AS (
                SELECT c.customer_id, SUM(v.amount) AS amt
                FROM vouchers v
                JOIN contracts c ON c.id = v.contract_id
                WHERE v.vtype = 'payment' AND v.cancelled = 0{v_filter}
                GROUP BY c.customer_id)
            SELECT cu.id, cu.customer_code, cu.name, cu.phone,
                   COALESCE(con.n, 0) AS contracts_count,
                   COALESCE(con.val, 0) AS contracts_value,
                   COALESCE(addm.net, 0) AS net_addendum,
                   COALESCE(rec_con.amt, 0)
                       + COALESCE(rec_party.amt, 0) AS collected,
                   COALESCE(pay_con.amt, 0) AS paid
            FROM customers cu
            LEFT JOIN con       ON con.customer_id = cu.id
            LEFT JOIN addm      ON addm.customer_id = cu.id
            LEFT JOIN rec_con   ON rec_con.customer_id = cu.id
            LEFT JOIN rec_party ON rec_party.cid = cu.id
            LEFT JOIN pay_con   ON pay_con.customer_id = cu.id
            ORDER BY cu.id
        """, params).fetchall()
    result = []
    totals = {"contracts": 0.0, "collected": 0.0, "paid": 0.0,
              "remaining": 0.0}
    for r in rows:
        addendum = 0.0 if date_from else float(r["net_addendum"])
        value = float(r["contracts_value"]) + addendum
        collected = float(r["collected"])
        paid = float(r["paid"])
        remaining = value - collected
        result.append({
            "code": r["customer_code"], "name": r["name"],
            "phone": r["phone"] or "", "contracts_count": r["contracts_count"],
            "contracts_value": value, "collected": collected,
            "paid": paid, "remaining": remaining,
        })
        totals["contracts"] += value
        totals["collected"] += collected
        totals["paid"] += paid
        totals["remaining"] += remaining
    return {"rows": result, "totals": totals}


# ============================================================
# 2) تقرير المستحقات · العقود التي عليها مبالغ متبقية
# ============================================================
def stage_dues(option: str = "all") -> dict:
    """V4.4: مستحقات العملاء بالمراحل — عميل × عقد × مرحلة.

    كل مرحلة مربوطة بدفعات: المستحق الآن (الصارم V4.3) والمتبقي
    والحالة (مستحقة/مسددة/غير مستحقة/لم تستحق بعد).
    عقد بلا خطة وله رصيد: صف واحد بمرحلة «—» والمستحق = كامل المتبقي.
    الحساب تجميعي (3 استعلامات) بنفس رياضيات overdue_plan_items حرفيًا.
    """
    from datetime import date as _date, datetime as _dt
    option = (option or "all").strip()
    empty = {"rows": [], "totals": {"n": 0, "due_now": 0.0,
                                    "remaining": 0.0, "overdue_n": 0}}
    with get_connection() as conn:
        contracts = {int(r["id"]): dict(r) for r in conn.execute(
            "SELECT c.id, c.contract_number, cu.name AS customer_name "
            "FROM contracts c JOIN customers cu ON cu.id = c.customer_id "
            "WHERE COALESCE(c.status,'') NOT IN ('مغلق','ملغى','ملغي','مسودة')"
            ).fetchall()}
        if not contracts:
            return empty
        cids = list(contracts)
        q = ",".join("?" for _ in cids)
        plan_rows = [dict(r) for r in conn.execute(
            "SELECT pp.*, COALESCE(cs.is_skipped,0) AS linked_stage_skipped, "
            "cs.name AS stage_name, COALESCE(cs.end_date,'') AS stage_end "
            "FROM payment_plan pp "
            "LEFT JOIN contract_stages cs ON cs.id = pp.stage_id "
            "WHERE pp.contract_id IN (" + q + ") "
            "ORDER BY pp.contract_id, pp.due_date, pp.sort_order",
            cids).fetchall()]
        collected_map = {int(r["contract_id"]): float(r["amt"] or 0)
                         for r in conn.execute(
            "SELECT contract_id, COALESCE(SUM(amount),0) AS amt FROM vouchers "
            "WHERE vtype='receipt' AND cancelled=0 "
            "AND (allocation IS NULL OR allocation='') "
            "AND contract_id IN (" + q + ") GROUP BY contract_id",
            cids).fetchall()}
    dues = {d["contract_number"]: float(d["remaining"])
            for d in dues_report("", "")["rows"]}
    today = _date.today()
    by_contract = {}
    for r in plan_rows:
        by_contract.setdefault(int(r["contract_id"]), []).append(r)
    rows = []
    for cid, con in contracts.items():
        items = by_contract.get(cid, [])
        if not items:
            rem = dues.get(con["contract_number"], 0.0)
            if rem > 0.001:
                rows.append({
                    "contract_id": cid, "contract": con["contract_number"],
                    "customer": con["customer_name"] or "", "stage": "—",
                    "ended": "—", "titles": "عقد بلا خطة دفعات",
                    "due": rem, "remaining": rem, "status": "مستحقة",
                    "overdue": True,
                })
            continue
        pool = collected_map.get(cid, 0.0)
        lines = []
        for it in items:
            amt = float(it["amount"] or 0)
            covered = min(pool, amt)
            pool -= covered
            remaining = amt - covered
            stage_linked = bool(it.get("stage_id"))
            triggered = bool((it.get("triggered_at") or "").strip())
            skipped = stage_linked and int(it.get("linked_stage_skipped") or 0)
            waiting = stage_linked and not triggered and remaining > 0.001
            try:
                due_d = _dt.strptime(it["due_date"], "%Y-%m-%d").date()
            except (ValueError, TypeError):
                due_d = today
            days_diff = (due_d - today).days
            strict = (not skipped and not waiting and remaining > 0.001
                      and days_diff <= 0)
            lines.append({
                "stage_id": it.get("stage_id"),
                "stage_name": it.get("stage_name") or "",
                "stage_end": (it.get("stage_end") or "")[:10],
                "title": it.get("title") or "دفعة",
                "remaining": remaining, "skipped": bool(skipped),
                "strict_due": remaining if strict else 0.0,
                "overdue": bool(strict and due_d < today),
            })
        groups = {}
        for ln in lines:
            groups.setdefault(ln["stage_id"], []).append(ln)
        for _sid, lst in groups.items():
            first = lst[0]
            skipped_g = any(l["skipped"] for l in lst)
            due = sum(l["strict_due"] for l in lst)
            rem = sum(l["remaining"] for l in lst if not l["skipped"])
            ended = first["stage_end"] if first["stage_id"] else ""
            if skipped_g:
                status = "غير مستحقة"
            elif due > 0.001 or (ended and rem > 0.001):
                status = "مستحقة"
            elif rem <= 0.001:
                status = "مسددة"
            else:
                status = "لم تستحق بعد"
            rows.append({
                "contract_id": cid, "contract": con["contract_number"],
                "customer": con["customer_name"] or "",
                "stage": first["stage_name"] or "—",
                "ended": ended or "—",
                "titles": "، ".join(l["title"] for l in lst),
                "due": due, "remaining": rem, "status": status,
                "overdue": any(l["overdue"] for l in lst),
            })
    if option == "due_only":
        rows = [r for r in rows if r["due"] > 0.001]
    elif option == "overdue_only":
        rows = [r for r in rows if r["overdue"]]
    rows.sort(key=lambda r: (
        0 if r["overdue"] else (1 if r["status"] == "مستحقة" else 2),
        -r["due"]))
    return {"rows": rows, "totals": {
        "n": len(rows),
        "due_now": sum(r["due"] for r in rows),
        "remaining": sum(r["remaining"] for r in rows),
        "overdue_n": sum(1 for r in rows if r["overdue"]),
    }}


def dues_board(option: str = "all") -> dict:
    """V4.3: لوحة مستحقات الباطن — سطور الصرف فقط.

    (كانت V4.2 موحدة عملاء + باطن؛ طرف العملاء انتقل إلى
    «العملاء والأرصدة» لإزالة التكرار — كل رقم في مكان واحد.)
    كل سطر: العقد/المقاول/المرحلة/الدفعة/الاستحقاق/المبلغ/
    المدفوع/المتبقي/الحالة/المصدر. العقود المغلقة والملغاة مستبعدة.
    بلا خطة باطن: سطر مشتق واحد (القيمة − المنصرف).
    """
    from services import lifecycle_service as lc
    option = (option or "all").strip()
    with get_connection() as conn:
        contracts = [dict(r) for r in conn.execute(
            "SELECT c.id, c.contract_number, c.contract_name, c.amount, "
            "cu.name AS customer_name FROM contracts c "
            "JOIN customers cu ON cu.id = c.customer_id "
            "WHERE COALESCE(c.status,'') NOT IN ('مغلق','ملغى','ملغي') "
            "ORDER BY c.id").fetchall()]
        subs = [dict(r) for r in conn.execute(
            "SELECT sc.id, sc.contract_id, sc.amount, sc.end_date, "
            "s.name AS sub_name FROM sub_contracts sc "
            "JOIN subcontractors s ON s.id = sc.subcontractor_id "
            "WHERE COALESCE(sc.status,'') NOT IN ('ملغى','ملغي')").fetchall()]
        sub_paid = {}
        if subs:
            q = ",".join("?" for _ in subs)
            for r in conn.execute(
                    "SELECT sub_contract_id, COALESCE(SUM(amount),0) AS paid "
                    "FROM vouchers WHERE sub_contract_id IN (" + q + ") "
                    "AND vtype='payment' AND cancelled=0 "
                    "AND (allocation IS NULL OR allocation = '') "
                    "GROUP BY sub_contract_id",
                    [s["id"] for s in subs]).fetchall():
                sub_paid[int(r["sub_contract_id"])] = float(r["paid"])
        line_sources = {}
        for r in conn.execute(
                "SELECT sps.sub_line_id, pp.title "
                "FROM sub_payment_sources sps "
                "JOIN payment_plan pp ON pp.id = sps.cust_line_id").fetchall():
            line_sources.setdefault(int(r["sub_line_id"]), []).append(
                r["title"] or "دفعة")
    cmap = {c["id"]: c for c in contracts}
    rows = []
    from datetime import date as _date
    today = _date.today()
    for s in subs:
        c = cmap.get(int(s["contract_id"]))
        if not c:
            continue
        lines = lc.sub_payment_plan(int(s["id"]))
        if not lines:
            paid = float(sub_paid.get(int(s["id"]), 0.0))
            amt = float(s["amount"] or 0)
            rem = max(0.0, amt - paid)
            due = (s["end_date"] or "")[:10]
            try:
                _d = _date.fromisoformat(due) if due else today
            except ValueError:
                _d = today
            if rem <= 0.001:
                st = "مدفوع"
            elif _d < today:
                st = "متأخر"
            elif (_d - today).days <= 7:
                st = "مستحق قريبًا"
            else:
                st = "لم يحل"
            rows.append({
                "side": "باطن", "direction": "صرف",
                "contract_id": c["id"],
                "contract": c["contract_number"],
                "party": s["sub_name"] or "",
                "stage": "—", "title": "مستحق عقد الباطن (مشتق)",
                "due": due or "—",
                "amount": amt, "paid": paid, "remaining": rem,
                "status": st, "source": "مشتق", "sources": "",
            })
            continue
        for it in lines:
            trig = (it.get("triggered_at") or "")[:10]
            rows.append({
                "side": "باطن", "direction": "صرف",
                "contract_id": c["id"],
                "contract": c["contract_number"],
                "party": s["sub_name"] or "",
                "stage": (it.get("stage_name") or "—") if it.get("stage_id")
                else "—",
                "title": it.get("title") or "",
                "due": (trig + " ✓") if trig else (it.get("due_date") or ""),
                "amount": float(it.get("amount") or 0),
                "paid": float(it.get("covered") or 0),
                "remaining": float(it.get("remaining") or 0),
                "status": it.get("status") or "",
                "source": ("مرحلة" if it.get("stage_id") else "أيام"),
                "sources": "، ".join(line_sources.get(int(it["id"]), [])),
            })

    def _due_now(r):
        return float(r["remaining"]) > 0.001 and r["status"] not in (
            "لم يحل", "بانتظار إنجاز المرحلة", "مرحلة متخطاة", "مدفوع")

    # V4.3: اللوحة باطن فقط — "customers" لم يعد لها سطور، و"subs" مرادف للكل.
    if option == "customers":
        rows = []
    elif option == "due_only":
        rows = [r for r in rows if _due_now(r)]
    elif option == "overdue_only":
        rows = [r for r in rows if r["status"] == "متأخر"]
    # المتأخر أولًا ثم الأكبر باقيًا
    rows.sort(key=lambda r: (0 if r["status"] == "متأخر" else 1,
                             -float(r["remaining"])))
    tot = {
        "n": len(rows),
        "sub_remaining": sum(float(r["remaining"]) for r in rows),
        "overdue_n": sum(1 for r in rows if r["status"] == "متأخر"),
    }
    return {"rows": rows, "totals": tot}


def dues_report(date_from: str = "", date_to: str = "") -> dict:
    """كل عقد عليه مبلغ متبقٍ: القيمة الحالية، المحصّل، المتبقي، آخر تحصيل.

    الفترة اختيارية: تُحصر العقود بتاريخ إبرامها داخل الفترة.
    """
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT c.id, c.contract_number,
                   -- contract_name مفروض بـ TRIGGER ليساوي نوع العقد،
                   -- فالوصف هو الاسم الحقيقي المعروض للمستخدم.
                   COALESCE(NULLIF(TRIM(c.description), ''),
                            NULLIF(TRIM(c.contract_name), ''),
                            c.contract_number) AS contract_name,
                   c.contract_type, c.status,
                   cu.name AS customer_name, c.amount,
                   COALESCE(a.net_addendum, 0) AS net_addendum,
                   COALESCE(v.collected, 0) AS collected,
                   v.last_receipt
            FROM contracts c
            JOIN customers cu ON cu.id = c.customer_id
            LEFT JOIN (SELECT contract_id,
                              SUM(amount_add - amount_deduct) AS net_addendum
                       FROM addendums WHERE status = 'معتمد'
                       GROUP BY contract_id) a ON a.contract_id = c.id
            LEFT JOIN (SELECT contract_id, SUM(amount) AS collected,
                              MAX(vdate) AS last_receipt
                       FROM vouchers WHERE vtype = 'receipt' AND cancelled = 0
                       GROUP BY contract_id) v ON v.contract_id = c.id
            WHERE c.status NOT IN ('ملغى', 'مسودة')
              AND (? = '' OR c.contract_date BETWEEN ? AND ?)
            ORDER BY cu.name, c.id
        """, (date_from, date_from or "0000", date_to or "9999")).fetchall()
    # مديونية تمديد الإشراف تدخل القيمة الحالية (قاعدة 35)
    try:
        from services.supervision_service import extensions_map
        ext_map = extensions_map()
    except Exception:
        ext_map = {}
    result = []
    totals = {"value": 0.0, "collected": 0.0, "remaining": 0.0}
    for r in rows:
        sup_ext = float(ext_map.get(r["id"], {}).get("extension_value", 0.0))
        value = float(r["amount"]) + float(r["net_addendum"]) + sup_ext
        collected = float(r["collected"])
        remaining = value - collected
        if remaining <= 0.001:
            continue
        result.append({
            "contract_number": r["contract_number"],
            "contract_name": r["contract_name"] or "",
            "customer_name": r["customer_name"],
            "value": value, "collected": collected, "remaining": remaining,
            "sup_extension": sup_ext,
            "last_receipt": r["last_receipt"] or "",
        })
        totals["value"] += value
        totals["collected"] += collected
        totals["remaining"] += remaining
    return {"rows": result, "totals": totals}


# ============================================================
# 3) تقرير الأقساط المتأخرة (خطط السداد)
# ============================================================
def overdue_installments(date_from: str = "", date_to: str = "",
                         strict: bool = False) -> dict:
    """الأقساط المتأخرة/المستحقة قريبًا · الفترة تُحصر بتاريخ الاستحقاق.

    strict=True (V4.3): «المستحق الآن» فقط — ما حلّ أجله فعلًا.
    """
    from services import lifecycle_service as lc
    rows = lc.overdue_plan_items(strict=strict)
    if date_from:
        rows = [r for r in rows
                if date_from <= (r.get("due_date") or "") <= date_to]
    total = sum(r["remaining"] for r in rows)
    return {"rows": rows, "total": total}


def due_now_by_contract(date_from: str = "", date_to: str = "") -> dict:
    """V4.3: «المستحق الآن» لكل عقد برقمه.

    القاعدة الصارمة: مجموع بواقي السطور التي حلّ أجلها فعلًا.
    عقد بلا خطة دفعات وله رصيد: المستحق الآن = كامل المتبقي.
    """
    dues = dues_report(date_from, date_to)["rows"]
    inst = overdue_installments(date_from, date_to, strict=True)["rows"]
    strict_sum = {}
    for r in inst:
        num = r["contract_number"]
        strict_sum[num] = strict_sum.get(num, 0.0) + float(r["remaining"])
    with get_connection() as conn:
        num2id = {r["contract_number"]: r["id"] for r in conn.execute(
            "SELECT id, contract_number FROM contracts")}
        planned = {r[0] for r in conn.execute(
            "SELECT DISTINCT contract_id FROM payment_plan")}
    out = {}
    for d in dues:
        num = d["contract_number"]
        if num2id.get(num) in planned:
            out[num] = strict_sum.get(num, 0.0)
        else:
            out[num] = float(d["remaining"])
    return out


def due_now_by_customer(date_from: str = "", date_to: str = "") -> dict:
    """V4.3: «المستحق الآن» لكل عميل باسمه (مجموع عقوده)."""
    dues = dues_report(date_from, date_to)["rows"]
    per_contract = due_now_by_contract(date_from, date_to)
    out = {}
    for d in dues:
        name = d["customer_name"]
        out[name] = out.get(name, 0.0) + per_contract.get(
            d["contract_number"], 0.0)
    return out


# ============================================================
# 4) تقرير العقود القاربة على الانتهاء
# ============================================================
def expiring_contracts(date_from: str = "", date_to: str = "") -> dict:
    """بدون فترة: حسب أيام التنبيه المضبوطة.
    مع فترة: كل عقد تاريخ انتهائه يقع داخل الفترة المحددة."""
    from services import lifecycle_service as lc
    if not date_from:
        return {"rows": lc.expiring_contracts()}
    from datetime import date, datetime
    today = date.today()
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT c.id, c.contract_number, c.contract_name, c.end_date, "
            "cu.name AS customer_name FROM contracts c "
            "JOIN customers cu ON cu.id = c.customer_id "
            "WHERE c.end_date != '' AND c.end_date BETWEEN ? AND ? "
            "AND c.status NOT IN ('مغلق','ملغى') ORDER BY c.end_date",
            (date_from, date_to)).fetchall()
    result = []
    for r in rows:
        try:
            end = datetime.strptime(r["end_date"], "%Y-%m-%d").date()
            remaining = (end - today).days
        except ValueError:
            remaining = 0
        result.append({**dict(r), "remaining": remaining})
    return {"rows": result}


# ============================================================
# تقرير المصروفات حسب شجرة الحسابات
# ============================================================
def expenses_report(date_from: str, date_to: str) -> dict:
    from services import lifecycle_service as _lc53
    _salf53 = _lc53.ensure_employee_advance_account()[1]
    date_from = date_from or "0000-01-01"
    date_to = date_to or "9999-12-31"
    with get_connection() as conn:
        rows = [dict(r) for r in conn.execute("""
            SELECT v.vdate, v.voucher_number, v.account,
                   COALESCE(NULLIF(v.expense_account_snapshot,''), v.account, '') AS acc_path,
                   v.party, ec.name AS expense_customer_name,
                   COALESCE(NULLIF(c.contract_name,''), c.description, c.contract_number, '') AS contract_label,
                   v.method, v.amount, v.description
            FROM vouchers v
            LEFT JOIN customers ec ON ec.id = v.expense_customer_id
            LEFT JOIN contracts c ON c.id = v.contract_id
            WHERE v.vtype='payment' AND v.cancelled=0 AND v.vdate BETWEEN ? AND ?
              AND COALESCE(v.party_type,'') <> 'partner'
              AND NOT (v.custody_account_id IS NOT NULL
                       AND COALESCE(v.expense_group_ref,'') = ''
                       AND COALESCE(v.notes,'') NOT LIKE '%تصفية عهدة من حساب:%'
                       AND COALESCE(v.notes,'') NOT LIKE '%إغلاق عهدة من حساب:%')
            UNION ALL
            SELECT v.vdate, v.voucher_number, v.account,
                   ? AS acc_path,
                   v.party, ec.name AS expense_customer_name,
                   '' AS contract_label,
                   v.method, -v.amount, v.description || ' (تخفيض السلفة)'
            FROM vouchers v
            LEFT JOIN customers ec ON ec.id = v.expense_customer_id
            WHERE v.vtype='custody_return' AND v.advance_employee_id IS NOT NULL
              AND v.cancelled=0 AND v.vdate BETWEEN ? AND ?
            UNION ALL
            SELECT v.vdate, v.voucher_number, v.account,
                   COALESCE(NULLIF(v.expense_account_snapshot,''), v.account, '') AS acc_path,
                   v.party, ec.name AS expense_customer_name,
                   '' AS contract_label,
                   v.method, v.amount, v.description
            FROM vouchers v
            LEFT JOIN customers ec ON ec.id = v.expense_customer_id
            WHERE v.vtype='salary_deduction'
              AND v.cancelled=0 AND v.vdate BETWEEN ? AND ?
            UNION ALL
            SELECT v.vdate, v.voucher_number, v.account,
                   ? AS acc_path,
                   v.party, ec.name AS expense_customer_name,
                   '' AS contract_label,
                   v.method, -v.amount, v.description || ' (تخفيض السلفة)'
            FROM vouchers v
            LEFT JOIN customers ec ON ec.id = v.expense_customer_id
            WHERE v.vtype='salary_deduction'
              AND v.cancelled=0 AND v.vdate BETWEEN ? AND ?
            ORDER BY vdate, voucher_number
        """, (date_from, date_to, _salf53, date_from, date_to,
              date_from, date_to, _salf53, date_from, date_to)).fetchall()]
    return {"rows": rows, "total": sum(float(r.get("amount") or 0) for r in rows)}


# ============================================================
# 5) تقرير السندات لفترة
# ============================================================
def vouchers_period(date_from: str, date_to: str,
                    vtype: str | None = None) -> dict:
    """كل السندات في الفترة · اختيارياً قبض فقط أو صرف فقط."""
    # اسم العقد يُعرض بجانب رقمه في التقرير؛ contract_name مفروض بـ
    # TRIGGER ليساوي نوع العقد، فالوصف هو الاسم الحقيقي.
    sql = ("SELECT v.voucher_number, v.vtype, v.vdate, v.party, v.method, "
           "v.amount, v.description, c.contract_number, "
           "COALESCE(v.party_type,'') AS party_type, v.custody_account_id, "
           "COALESCE(v.expense_group_ref,'') AS gref, "
           "COALESCE(v.notes,'') AS notes, "
           "COALESCE(NULLIF(TRIM(c.description),''), "
           "NULLIF(TRIM(c.contract_name),'')) AS contract_label "
           "FROM vouchers v LEFT JOIN contracts c ON c.id = v.contract_id "
           "WHERE v.vdate BETWEEN ? AND ? AND v.cancelled=0")
    params: list = [date_from, date_to]
    if vtype in ("receipt", "payment", "custody_return", "salary_deduction"):
        sql += " AND v.vtype = ?"
        params.append(vtype)
    sql += " ORDER BY v.vdate, v.id"
    with get_connection() as conn:
        rows = [dict(r) for r in conn.execute(sql, params).fetchall()]
    from services.lifecycle_service import is_settlement_voucher as _isv
    total_in = sum(r["amount"] for r in rows
                   if r["vtype"] == "receipt" and r["party_type"] != "partner")
    total_out = sum(r["amount"] for r in rows
                    if r["vtype"] == "payment" and r["party_type"] != "partner"
                    and not _isv(r))
    total_rec = sum(r["amount"] for r in rows
                    if r["vtype"] == "custody_return")
    return {"rows": rows, "total_in": total_in, "total_out": total_out,
            "recoveries": total_rec,
            "net": total_in - total_out + total_rec}


# ============================================================
# 6) تقرير مقاولي الباطن
# ============================================================
def subcontractors_report(subcontractor_id: int | None = None,
                          customer_id: int | None = None) -> dict:
    """كل مقاول: عدد عقود الباطن، إجماليها، المنصرف له، المتبقي له."""
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT s.id, s.sub_code, s.name, s.phone,
                   COALESCE(sc.cnt, 0) AS contracts_count,
                   COALESCE(sc.total, 0) AS contracts_value,
                   COALESCE(v.paid, 0) AS paid
            FROM subcontractors s
            LEFT JOIN (SELECT sc2.subcontractor_id, COUNT(*) AS cnt,
                              SUM(sc2.amount) AS total
                       FROM sub_contracts sc2
                       JOIN contracts c2 ON c2.id = sc2.contract_id
                       WHERE sc2.status != 'ملغى'
                         AND (? IS NULL OR c2.customer_id = ?)
                       GROUP BY sc2.subcontractor_id) sc
                   ON sc.subcontractor_id = s.id
            LEFT JOIN (SELECT v2.party_id, SUM(v2.amount) AS paid
                       FROM vouchers v2
                       LEFT JOIN contracts c3 ON c3.id = v2.contract_id
                       WHERE v2.vtype = 'payment' AND v2.cancelled = 0
                         AND v2.party_type = 'subcontractor'
                         AND (v2.contract_id IS NULL OR COALESCE(c3.status,'') != 'ملغى')
                         AND (? IS NULL OR c3.customer_id = ?)
                       GROUP BY v2.party_id) v ON v.party_id = s.id
            WHERE (? IS NULL OR s.id = ?)
            ORDER BY s.id
        """, (customer_id, customer_id, customer_id, customer_id,
              subcontractor_id, subcontractor_id)).fetchall()
    result = []
    totals = {"value": 0.0, "paid": 0.0, "remaining": 0.0}
    for r in rows:
        value, paid = float(r["contracts_value"]), float(r["paid"])
        result.append({
            "code": r["sub_code"], "name": r["name"],
            "phone": r["phone"] or "",
            "contracts_count": r["contracts_count"],
            "contracts_value": value, "paid": paid,
            "remaining": value - paid,
        })
        totals["value"] += value
        totals["paid"] += paid
        totals["remaining"] += value - paid
    return {"rows": result, "totals": totals}


# ============================================================
# 7) تقرير الربحية · لكل عقد/مشروع: الإيراد والتكلفة والربح
# ============================================================
def profitability_report(customer_id: int | None = None,
                         contract_id: int | None = None) -> dict:
    """لكل عقد: القيمة الحالية، المحصّل، المنصرف عليه، عقود الباطن، الربح.

    الربح الفعلي = كامل المحصّل − (المنصرف + التزامات عقود الباطن).
    قيمة العقد تُعرض كمرجع فقط ولا تُستخدم في حساب الربحية حتى لا يظهر
    ربح أقل عند وجود تحصيل أعلى من القيمة الأساسية/الأصلية.
    الفلترة: كل العقود، أو عقود عميل محدد، أو عقد/مشروع محدد.
    """
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT c.id, c.contract_number, c.contract_name, c.contract_type, c.status,
                   cu.name AS customer_name, c.amount,
                   COALESCE(a.net_addendum, 0) AS net_addendum,
                   COALESCE(vr.collected, 0) AS collected,
                   COALESCE(vp.paid, 0) AS paid,
                   COALESCE(vo.other_paid, 0) AS other_paid,
                   COALESCE(sc.subs_total, 0) AS subs_total
            FROM contracts c
            JOIN customers cu ON cu.id = c.customer_id
            LEFT JOIN (SELECT contract_id,
                              SUM(amount_add - amount_deduct) AS net_addendum
                       FROM addendums WHERE status = 'معتمد'
                       GROUP BY contract_id) a ON a.contract_id = c.id
            LEFT JOIN (SELECT contract_id, SUM(amount) AS collected
                       FROM vouchers WHERE vtype = 'receipt' AND cancelled = 0
                       GROUP BY contract_id) vr ON vr.contract_id = c.id
            LEFT JOIN (SELECT v.contract_id, SUM(v.amount) AS paid
                       FROM vouchers v LEFT JOIN expense_accounts ea
                         ON ea.id = v.expense_account_id
                       WHERE v.vtype = 'payment' AND v.cancelled = 0
                         AND COALESCE(ea.include_in_profitability, 1) = 1
                       GROUP BY v.contract_id) vp ON vp.contract_id = c.id
            LEFT JOIN (SELECT v.contract_id, SUM(v.amount) AS other_paid
                       FROM vouchers v LEFT JOIN expense_accounts ea
                         ON ea.id = v.expense_account_id
                       WHERE v.vtype = 'payment' AND v.cancelled = 0
                       AND COALESCE(v.party_type,'')!='subcontractor'
                         AND COALESCE(ea.include_in_profitability, 1) = 1
                       GROUP BY v.contract_id) vo ON vo.contract_id = c.id
            LEFT JOIN (SELECT contract_id, SUM(amount) AS subs_total
                       FROM sub_contracts WHERE status != 'ملغى'
                       GROUP BY contract_id) sc ON sc.contract_id = c.id
            WHERE c.status NOT IN ('ملغى', 'مسودة')
              AND (? IS NULL OR c.customer_id = ?)
              AND (? IS NULL OR c.id = ?)
            ORDER BY cu.name, c.id
        """, (customer_id, customer_id,
              contract_id, contract_id)).fetchall()
    result = []
    totals = {"value": 0.0, "collected": 0.0, "cost": 0.0, "profit": 0.0}
    for r in rows:
        value = float(r["amount"]) + float(r["net_addendum"])
        collected = float(r["collected"])
        paid = float(r["paid"])
        other_paid = float(r["other_paid"])
        subs = float(r["subs_total"])
        # المتوقع = إجمالي العقد - إجمالي عقود الباطن - المنصرف الآخر عليه.
        expected_cost = subs + other_paid
        expected_profit = value - expected_cost
        # الفعلي حتى الآن = إجمالي المحصل - إجمالي المنصرف الفعلي.
        actual_cost = paid
        actual_profit = collected - actual_cost
        margin = (actual_profit / collected * 100) if collected > 0.001 else 0.0
        result.append({
            "contract_number": r["contract_number"],
            "contract_name": r["contract_name"] or "",
            "contract_type": r["contract_type"] or "غير محدد",
            "customer_name": r["customer_name"],
            "value": value, "collected": collected,
            "subcontracts": subs, "other_expenses": other_paid,
            "cost": actual_cost, "profit": actual_profit,
            "expected_cost": expected_cost, "expected_profit": expected_profit,
            "actual_cost": actual_cost, "actual_profit": actual_profit,
            "margin": margin,
        })
        totals["value"] += value
        totals["collected"] += collected
        totals["cost"] += actual_cost
        totals["profit"] += actual_profit
        totals["expected_cost"] = totals.get("expected_cost", 0.0) + expected_cost
        totals["expected_profit"] = totals.get("expected_profit", 0.0) + expected_profit
    return {"rows": result, "totals": totals}


def prospects_report(date_from: str = "", date_to: str = "") -> dict:
    """العملاء غير الموقعين عقودًا · الفرص البيعية القادمة.

    كل عميل مسجل بالنظام وليس له أي عقد ساري أو سابق (العقود الملغاة
    لا تُحسب عقودًا) · مع بياناته وملاحظاته ومدة تسجيله.
    الفترة اختيارية: تحصر النتائج بتاريخ تسجيل العميل.
    """
    d_filter = " AND DATE(cu.created_at) BETWEEN ? AND ?" if date_from else ""
    params = [date_from, date_to] if date_from else []
    with get_connection() as conn:
        rows = conn.execute(f"""
            SELECT cu.id, cu.customer_code, cu.name, cu.phone, cu.address,
                   cu.email, cu.notes, DATE(cu.created_at) AS reg_date,
                   CAST(julianday('now') - julianday(cu.created_at)
                        AS INTEGER) AS days_since
            FROM customers cu
            WHERE NOT EXISTS (
                SELECT 1 FROM contracts c
                WHERE c.customer_id = cu.id AND c.status != 'ملغى')
            {d_filter}
            ORDER BY cu.created_at DESC
        """, params).fetchall()
    result = [dict(r) for r in rows]
    return {"rows": result, "count": len(result)}


def supervision_delays_report(only_unpaid: bool = False) -> dict:
    """تقرير تأخير الإشراف · عقود الإشراف التي تجاوزت مدتها الأساسية.

    كل عقد إشراف انتهت مدته المتعاقد عليها ولم يُغلق يدخل «التمديد»:
    كل شهر يبدأ ولو بيوم واحد يُحسب شهرًا كاملًا مديونية على العميل.
    التقرير يعرض: منذ متى تجاوز، كم شهر تمديد، قيمتها، والمسدَّد والمتبقي.

    only_unpaid=True: العقود التي عليها متبقٍ فقط (تُخفي المخالصة الكاملة).
    """
    from datetime import date as _date
    from services import supervision_service as sup
    from services.extras_service import contract_label, contract_labels

    with get_connection() as conn:
        rows = conn.execute(
            "SELECT c.id, COALESCE(cu.address,'') AS address, "
            "COALESCE(p.name,'') AS project_name, "
            "COALESCE(c.contract_name, c.description) AS title "
            "FROM contracts c JOIN customers cu ON cu.id = c.customer_id "
            "LEFT JOIN projects p ON p.id = c.project_id "
            "WHERE COALESCE(c.sup_start_date,'') != '' "
            "AND COALESCE(c.sup_months,0) > 0 "
            "AND COALESCE(c.sup_monthly,0) > 0 "
            "AND c.status NOT IN ('مغلق','ملغى')").fetchall()

    today = _date.today()
    result = []
    # V2.48: أسماء العقود دفعة واحدة بدل استعلام لكل صف
    _labels = contract_labels([r["id"] for r in rows])
    for r in rows:
        st = sup.supervision_status(r["id"])
        if not st or not st["in_extension"]:
            continue                      # ما زال داخل المدة الأساسية
        if only_unpaid and st["delay_months"] <= 0 and not st.get("waived_months"):
            continue      # لا تأخير ولا مدة ملغاة تستحق العرض
        try:
            base_end = _date.fromisoformat(st["base_end"])
            days_over = max(0, (today - base_end).days)
        except (ValueError, TypeError):
            days_over = 0
        result.append({
            "contract_id": r["id"],
            "contract_label": _labels.get(r["id"], ""),
            "customer_name": st["customer_name"],
            "sup_start": st["start"],            # بداية تعهد الإشراف
            "base_end": st["base_end"],
            "months": st["months"],              # مدة العقد الأساسي (أشهر)
            "monthly": st["monthly"],
            "days_over": days_over,
            "extension_months": st["billable_extension"],
            "waived_months": st["waived_months"],
            "waive_reason": st.get("waive_reason", ""),
            "extension_value": st["extension_value"],
            # المدفوع فعلًا من التمديد (مدة وقيمة)
            "paid_extension_months": st["paid_extension_months"],
            "paid_extension_value": st["paid_extension_value"],
            # عنوان الموقع: عنوان العميل، وإلا اسم المشروع، وإلا اسم العقد
            "address": (r["address"] or r["project_name"]
                        or r["title"] or ""),
            # نهاية المدة كاملة = التعهد + الأساسية + التمديد المدفوع
            "full_end": st["full_end"],
            # التأخير عن نهاية المدة كاملة (بالشهور وبالمبلغ)
            "delay_months": st["delay_months"],
            "delay_days": st["delay_days"],
            "delay_elapsed_months": st["delay_elapsed_months"],
            "delay_elapsed_days": st["delay_elapsed_days"],
            "delay_text": st["delay_text"],
            "delay_value": st["delay_value"],
            # (للاستخدام الداخلي) التمديد غير المسدد بالمنطق المالي
            "unpaid_extension_months": st["unpaid_extension_months"],
            "unpaid_extension_value": st["unpaid_extension_value"],
            "total_due": st["total_due"],
            "collected": st["collected"],
            "remaining": st["remaining"],
        })

    # V3.21: المراحل ذات الطابع الإشرافي — صفوف مدمجة مع العقود.
    with get_connection() as conn:
        try:
            _stages = conn.execute(
                "SELECT cs.id, c.contract_number FROM contract_stages cs "
                "JOIN contracts c ON c.id = cs.contract_id "
                "WHERE COALESCE(cs.is_supervision,0)=1 "
                "AND COALESCE(cs.sup_start,'') != '' "
                "AND COALESCE(cs.sup_end,'') != '' "
                "AND COALESCE(cs.sup_monthly,0) > 0 "
                "AND COALESCE(cs.is_skipped,0)=0 "
                "AND c.status NOT IN ('مغلق','ملغى')").fetchall()
        except Exception:
            _stages = []
    for _s in _stages:
        _st = sup.stage_supervision_status(_s["id"])
        if not _st or not _st["in_extension"]:
            continue
        if only_unpaid and _st["delay_months"] <= 0                 and not _st.get("waived_months"):
            continue
        try:
            _base = _date.fromisoformat(_st["base_end"])
            _over = max(0, (today - _base).days)
        except (ValueError, TypeError):
            _over = 0
        result.append({
            "contract_id": _st["contract_id"],
            "contract_label": _s["contract_number"],
            "customer_name": _st["customer_name"],
            "sup_start": _st["start"],
            "base_end": _st["base_end"],
            "months": _st["months"],
            "monthly": _st["monthly"],
            "days_over": _over,
            "extension_months": _st["billable_extension"],
            "waived_months": _st["waived_months"],
            "waive_reason": _st.get("waive_reason", ""),
            "extension_value": _st["extension_value"],
            "paid_extension_months": 0.0,
            "paid_extension_value": 0.0,
            "address": f"\U0001f441 {(_s['contract_number'] or '').strip()} "
                       f"— {(_st['stage_name'] or '').strip()}",
            "full_end": _st["full_end"],
            "delay_months": _st["delay_months"],
            "delay_days": _st["delay_days"],
            "delay_elapsed_months": _st["delay_elapsed_months"],
            "delay_elapsed_days": _st["delay_elapsed_days"],
            "delay_text": _st["delay_text"],
            "delay_value": _st["delay_value"],
            "unpaid_extension_months": _st["unpaid_extension_months"],
            "unpaid_extension_value": _st["unpaid_extension_value"],
            "total_due": _st["total_due"],
            "collected": 0.0,
            "remaining": _st["remaining"],
            "is_stage": True,
        })

    # الأعلى قيمة تأخير أولًا ثم الأطول تأخيرًا
    result.sort(key=lambda x: (-x["delay_value"], -x["delay_days"]))
    totals = {
        "extension_value": sum(x["extension_value"] for x in result),
        "total_due": sum(x["total_due"] for x in result),
        "collected": sum(x["collected"] for x in result),
        "remaining": sum(x["remaining"] for x in result),
        "months": sum(x["extension_months"] for x in result),
        "base_months": sum(x["months"] for x in result),
        "paid_extension_months": sum(x["paid_extension_months"]
                                     for x in result),
        "paid_extension_value": sum(x["paid_extension_value"]
                                    for x in result),
        "waived_months": sum(x["waived_months"] for x in result),
        "waived_value": sum(x["waived_months"] * x["monthly"] for x in result),
        "delay_months": sum(x["delay_months"] for x in result),
        "delay_days": sum(x["delay_days"] for x in result),
        "delay_value": sum(x["delay_value"] for x in result),
        "stage_count": sum(1 for x in result if x.get("is_stage")),
        "stage_delay_months": sum(x["delay_months"] for x in result
                                 if x.get("is_stage")),
        "stage_delay_value": sum(x["delay_value"] for x in result
                                if x.get("is_stage")),
    }
    return {"rows": result, "count": len(result), "totals": totals}


# ============================================================
# التقرير المالي (للمدير) · الداخل والخارج والرصيد
# ============================================================
def _period_key(day: str, group: str) -> tuple[str, str]:
    """مفتاح التجميع وعنوانه العربي حسب اليوم/الشهر/السنة."""
    y, m, d = (day.split("-") + ["", "", ""])[:3]
    months = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو",
              "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"]
    if group == "yearly":
        return y, f"سنة {y}"
    if group == "monthly":
        try:
            label = f"{months[int(m) - 1]} {y}"
        except (ValueError, IndexError):
            label = f"{y}-{m}"
        return f"{y}-{m}", label
    return day, day


def auto_group(date_from: str, date_to: str) -> str:
    """اختيار التجميع تلقائيًا حسب طول الفترة."""
    from datetime import date as _date
    try:
        d1 = _date.fromisoformat(date_from)
        d2 = _date.fromisoformat(date_to)
    except (ValueError, TypeError):
        return "monthly"
    days = (d2 - d1).days
    if days <= 62:
        return "daily"
    if days <= 730:
        return "monthly"
    return "yearly"


def _advance_settlement(conn, date_to: str = "") -> dict:
    """حالة السلف حتى نهاية الفترة (FIFO لكل موظف).

    يُرجع {رقم سند السلفة: المبلغ المُسترد منها}. الرد النقدي وخصم الراتب
    يُطفئان أقدم سلفة للموظف أولًا. السلفة المُسترَدة لا تُحسب مصروفًا.
    """
    end = date_to or "9999-12-31"
    adv = conn.execute(
        "SELECT id, vdate, amount, advance_employee_id FROM vouchers "
        "WHERE COALESCE(cancelled,0)=0 AND vtype='payment' "
        "AND COALESCE(advance_employee_id,0)<>0 AND vdate<=?", (end,)).fetchall()
    rets = conn.execute(
        "SELECT id, vdate, amount, advance_employee_id FROM vouchers "
        "WHERE COALESCE(cancelled,0)=0 AND vtype IN ('custody_return','salary_deduction') "
        "AND COALESCE(advance_employee_id,0)<>0 AND vdate<=?", (end,)).fetchall()
    events = [(r["vdate"] or "", 0, int(r["id"]), r) for r in adv]
    events += [(r["vdate"] or "", 1, int(r["id"]), r) for r in rets]
    events.sort(key=lambda e: (e[0], e[1], e[2]))
    queues: dict = {}
    settled: dict = {}
    for _d, kind, vid, r in events:
        emp = int(r["advance_employee_id"])
        if kind == 0:
            queues.setdefault(emp, []).append([vid, float(r["amount"] or 0)])
            settled[vid] = 0.0
            continue
        left = float(r["amount"] or 0)
        q = queues.get(emp, [])
        while left > 0.0005 and q:
            head = q[0]
            take = min(left, head[1])
            head[1] -= take
            left -= take
            settled[head[0]] = settled.get(head[0], 0.0) + take
            if head[1] <= 0.0005:
                q.pop(0)
    return {k: round(v, 3) for k, v in settled.items()}


def cash_flow_report(date_from: str = "", date_to: str = "",
                     group: str = "auto") -> dict:
    """التقرير المالي: الداخل والخارج والصافي والرصيد التراكمي لكل فترة.

    • الداخل  = سندات القبض السارية (بقيمتها الكاملة).
    • الخارج  = سندات الصرف السارية · **ومنها رسوم التحويل البنكي**
      التي يولّدها النظام تلقائيًا لكل سند قبض بتحويل بنكي.
    • الرصيد  = الرصيد الافتتاحي (الإعدادات) + صافي كل الحركة حتى نهاية
      الفترة · يُحسب دائمًا من الحركات ولا يُخزَّن (قاعدة 3).
    • حركات الشريك (تمويل/مسحوبات) خارج الداخل/الخارج وتدخل في الرصيد فقط.
    """
    from services import settings_service
    st = settings_service.get_settings()
    opening = float(getattr(st, "opening_balance", 0) or 0)
    opening_date = (getattr(st, "opening_balance_date", "") or "").strip()
    # V5.9: بداية الاحتساب النقدي (زر مؤقت في الإعدادات) — تحدّ الكشف
    # النقدي كله: الحركات الأقدم لا تدخل الرصيد ولا الداخل/الخارج.
    cash_start = (getattr(st, "cash_start_date", "") or "").strip()
    floor = cash_start or opening_date

    where = ["COALESCE(v.cancelled,0) = 0"]
    params: list = []
    if cash_start:
        where.append("v.vdate >= ?")
        params.append(cash_start)
    if date_from:
        where.append("v.vdate >= ?")
        params.append(date_from)
    if date_to:
        where.append("v.vdate <= ?")
        params.append(date_to)
    clause = " AND ".join(where)

    with get_connection() as conn:
        rows = conn.execute(
            f"SELECT v.id AS id, v.vdate AS d, v.vtype, v.amount, v.method, "
            f"COALESCE(v.party_type,'') AS party_type, "
            f"v.custody_account_id, COALESCE(v.expense_group_ref,'') AS gref, "
            f"COALESCE(v.advance_employee_id,0) AS advance_employee_id, "
            f"COALESCE(v.notes,'') AS notes FROM vouchers v "
            f"WHERE {clause} ORDER BY v.vdate", params).fetchall()
        # حالة السلف حتى نهاية الفترة: المُسترَد لا يُحسب مصروفًا
        adv_settled = _advance_settlement(conn, date_to)
        # الرصيد السابق للفترة (كل ما قبل بدايتها + الافتتاحي)
        before = 0.0
        if date_from:
            # V8.4: استبعاد سلف الموظفين من الرصيد السابق
            prev = conn.execute(
                "SELECT COALESCE(SUM(CASE WHEN vtype IN ('receipt','custody_return') THEN amount "
                "WHEN vtype='payment' THEN -amount ELSE 0 END),0) FROM vouchers "
                "WHERE COALESCE(cancelled,0)=0 AND vdate < ? "
                "AND (? = '' OR vdate >= ?) "
                "AND NOT (vtype='payment' AND custody_account_id IS NOT NULL "
                "AND COALESCE(expense_group_ref,'')<>'') "
                "AND NOT (vtype='payment' AND (COALESCE(notes,'') LIKE '%تصفية عهدة من حساب:%' "
                "OR COALESCE(notes,'') LIKE '%إغلاق عهدة من حساب:%')) "
                "AND NOT (vtype='receipt' AND (COALESCE(advance_employee_id,0)<>0 "
                "OR COALESCE(notes,'') LIKE 'رد سلفة%'))",
                (date_from, floor, floor)).fetchone()[0]
            before = float(prev or 0)

    group = group if group in ("daily", "monthly", "yearly") else \
        auto_group(date_from or "2000-01-01", date_to or "2100-01-01")

    buckets: dict[str, dict] = {}
    order: list[str] = []
    for r in rows:
        if r["vtype"] == "transfer":
            # الملخص بالفترات يقيس الداخل/الخارج وصافي النقد؛ التحويل الداخلي
            # حركة بين محافظ الشركة ولا يغير الإجمالي.
            continue
        if r["vtype"] == "payment":
            from services.lifecycle_service import is_settlement_voucher as _isv
            if _isv(r):
                # تصفية عهدة: توزيع داخلي بلا خروج نقدي جديد
                continue
        if r["vtype"] == "salary_deduction":
            # V4.54: الخصم من الراتب قيد استحقاق بلا حركة نقدية — خارج التقرير النقدي.
            continue
        key, label = _period_key(r["d"] or "", group)
        if key not in buckets:
            buckets[key] = {"key": key, "label": label, "inflow": 0.0,
                            "outflow": 0.0, "bank_fees": 0.0,
                            "recoveries": 0.0, "partner_net": 0.0,
                            "receipts_count": 0, "payments_count": 0}
            order.append(key)
        b = buckets[key]
        amount = float(r["amount"] or 0)
        if (r["party_type"] or "") == "partner":
            # جاري الشريك: خارج الداخل/الخارج · يدخل في الرصيد فقط.
            b["partner_net"] += amount if r["vtype"] == "receipt" else -amount
            continue
        if r["vtype"] == "receipt":
            # V8.5: رد سلفة — ليس إيراداً لكن يدخل الرصيد النقدي
            if r["advance_employee_id"] or (r["notes"] or "").startswith("رد سلفة"):
                continue  # لا يدخل الوارد ولا يغير الرصيد (حركة داخلية)
            b["inflow"] += amount
            b["receipts_count"] += 1
        elif r["vtype"] == "payment":
            if r["advance_employee_id"]:
                # السلفة: الخروج النقدي كامل، والمصروف هو الجزء غير المسترَد فقط
                _back = min(amount, adv_settled.get(int(r["id"]), 0.0))
                _exp = amount - _back
                b["adv_paid"] = b.get("adv_paid", 0.0) + amount
                b["adv_expense"] = b.get("adv_expense", 0.0) + _exp
                b["adv_returned"] = b.get("adv_returned", 0.0) + _back
                b["outflow"] += _exp
                if _exp > 0.0005:
                    b["payments_count"] += 1
                continue
            from services.lifecycle_service import BANK_FEE_MARK as _BFM
            from services.settlement_service import GATEWAY_FEE_MARK as _GFM
            b["outflow"] += amount
            b["payments_count"] += 1
            if _BFM in (r["notes"] or "") or _GFM in (r["notes"] or ""):
                b["bank_fees"] += amount
        elif r["vtype"] == "custody_return":
            if r["advance_employee_id"]:
                # رد السلفة: نقد يعود إلى المحفظة المستلمة، وليس استردادًا للمصروف
                b["adv_back"] = b.get("adv_back", 0.0) + amount
                continue
            # V4.54: المرتجع النقدي (عهدة) — نقد داخل خارج الوارد.
            b["recoveries"] += amount
        else:
            # التحويل الداخلي لا يغير إجمالي الرصيد ولا يدخل ضمن الداخل/الخارج.
            continue

    balance = opening + before
    result = []
    for key in sorted(order):
        b = buckets[key]
        # V8.5: السلف تؤثر في الرصيد النقدي لكن ليست إيراد/مصروف
        # أثر السلف على الرصيد = الخروج الكامل − الرد. المصروف محسوب في outflow، فنعكسه هنا.
        adv_adj = (-b.get("adv_paid", 0.0) + b.get("adv_back", 0.0)
                   + b.get("adv_expense", 0.0))
        # الصافي = التغير في الرصيد (افتتاحي + صافي = ختامي)
        b["net"] = b["inflow"] - b["outflow"] + b["recoveries"] + adv_adj
        balance += b["net"] + b.get("partner_net", 0)
        b["balance"] = balance
        b["advance_net"] = adv_adj
        result.append(b)

    totals = {
        "inflow": sum(b["inflow"] for b in result),
        "outflow": sum(b["outflow"] for b in result),
        "bank_fees": sum(b["bank_fees"] for b in result),
        "recoveries": sum(b["recoveries"] for b in result),
        "partner_net": sum(b.get("partner_net", 0) for b in result),
        "advance_out": sum(b.get("adv_expense", 0) for b in result),
        "advance_in": sum(b.get("adv_back", 0) for b in result),
        "advance_returned": sum(b.get("adv_returned", 0) for b in result),
        "opening": opening + before,
        "closing": balance,
    }
    # الصافي = مجموع صافي الفترات (يشمل أثر السلف، ويستثني جاري الشريك)
    totals["net"] = sum(b["net"] for b in result)
    return {"rows": result, "totals": totals, "group": group,
            "count": len(result)}


# ============================================================
# التقرير المالي التفصيلي: سند بسند (بالشكل الذي طلبه صاحب النظام)
# ============================================================
# البنك مقابل الصندوق: التصنيف بطريقة الدفع لا بنوع السند.
CASH_METHODS = ("نقد", "نقدًا", "نقدا", "صندوق", "الصندوق")      # الصندوق
BANK_METHODS = ("تحويل", "شيك", "KNET", "بنك", "البنك")  # البنك


def _wallet_of(method: str) -> str:
    """أي محفظة يمسّها السند: bank أو cash."""
    m = (method or "").strip()
    if any(k in m for k in BANK_METHODS):
        return "bank"
    if any(k in m for k in CASH_METHODS):
        return "cash"
    return "cash"      # «أخرى» وغير المحدد تُعامل نقدًا


def cash_flow_detail(date_from: str = "", date_to: str = "") -> dict:
    """كشف نقدي تفصيلي: كل سند في سطر، مقسومًا لوارد ومنصرف.

    الأعمدة لكل قسم: م · العميل · العقد · قيمة العقد · المبلغ · البيان
    ثم إجمالي كل قسم، ثم الصافي، ثم رصيدا **البنك** و**الصندوق**.

    قيمة العقد تُشتق من `lifecycle_service.contract_current_value`
    (القاعدة 35) فتشمل الملحقات المعتمدة وتمديد الإشراف.
    """
    from services import settings_service
    from services.lifecycle_service import (BANK_FEE_MARK,
                                            contract_current_value,
                                            is_settlement_voucher)
    from services.settlement_service import GATEWAY_FEE_MARK

    st = settings_service.get_settings()
    opening = float(getattr(st, "opening_balance", 0) or 0)
    opening_date = (getattr(st, "opening_balance_date", "") or "").strip()
    # V5.9: بداية الاحتساب النقدي — تُطبَّق على الكشف التفصيلي وأرصدة
    # البنك/الصندوق بلا حذف أي سند من القاعدة.
    cash_start = (getattr(st, "cash_start_date", "") or "").strip()
    floor = cash_start or opening_date

    where = ["COALESCE(v.cancelled,0) = 0"]
    params: list = []
    if cash_start:
        where.append("v.vdate >= ?")
        params.append(cash_start)
    if date_from:
        where.append("v.vdate >= ?")
        params.append(date_from)
    if date_to:
        where.append("v.vdate <= ?")
        params.append(date_to)
    clause = " AND ".join(where)

    with get_connection() as conn:
        rows = conn.execute(
            f"SELECT v.id, v.vdate, v.vtype, v.amount, v.method, v.account, "
            f"v.contract_id, v.party_type, v.party_id, "
            f"v.custody_account_id, COALESCE(v.expense_group_ref,'') AS gref, "
            f"COALESCE(v.advance_employee_id,0) AS advance_employee_id, "
            f"COALESCE(v.description,'') AS descr, "
            f"COALESCE(v.notes,'') AS notes, "
            f"COALESCE(c.contract_number,'') AS cnum, "
            f"COALESCE(c.contract_name, c.description, '') AS cname, "
            f"COALESCE(cu.name,'') AS cust_name, "
            f"COALESCE(s.name,'') AS sub_name, "
            f"COALESCE(cu.phone,'') AS cust_phone, "
            f"COALESCE(s.phone,'') AS sub_phone "
            f"FROM vouchers v "
            f"LEFT JOIN contracts c ON c.id = v.contract_id "
            f"LEFT JOIN customers cu ON cu.id = c.customer_id "
            f"LEFT JOIN subcontractors s ON s.id = v.party_id "
            f"  AND v.party_type = 'subcontractor' "
            f"WHERE {clause} ORDER BY v.vdate, v.id", params).fetchall()
        adv_settled = _advance_settlement(conn, date_to)

        # أرصدة ما قبل الفترة لكل محفظة · تُحسب فقط عند وجود تاريخ بداية
        # (بدونه كانت كل السندات تُحسب مرتين: قبل الفترة وداخلها)
        prev = []
        if date_from:
            # V8.4: استبعاد سلف الموظفين من الرصيد السابق
            prev = conn.execute(
                "SELECT vtype, COALESCE(method,'') AS method, COALESCE(account,'') AS account, "
                "COALESCE(SUM(amount),0) AS total FROM vouchers "
                "WHERE COALESCE(cancelled,0)=0 AND vdate < ? "
                "AND (? = '' OR vdate >= ?) "
                "AND NOT (vtype='payment' AND custody_account_id IS NOT NULL "
                "AND COALESCE(expense_group_ref,'')<>'') "
                "AND NOT (vtype='payment' AND (COALESCE(notes,'') LIKE '%تصفية عهدة من حساب:%' "
                "OR COALESCE(notes,'') LIKE '%إغلاق عهدة من حساب:%')) "
                "GROUP BY vtype, method, account",
                (date_from, floor, floor)).fetchall()

    before = {"bank": 0.0, "cash": 0.0}
    for r in prev:
        amt = float(r["total"] or 0)
        if r["vtype"] == "transfer":
            before[_wallet_of(r["method"])] -= amt
            before[_wallet_of(r["account"])] += amt
            continue
        w = _wallet_of(r["method"])
        if r["vtype"] in ("receipt", "custody_return"):
            before[w] += amt
        elif r["vtype"] == "payment":
            before[w] -= amt
        # salary_deduction بلا أثر نقدي · transfer عُولج أعلاه.

    # الأداء: تُحمَّل قيم كل العقود الواردة في السندات دفعة واحدة بدل
    # استعلامين واتصال لكل عقد (كان يصل لمئات الاستعلامات في التقرير).
    value_cache: dict[int, float] = {}
    try:
        from services.lifecycle_service import contract_values_map
        _ids = {int(r["contract_id"]) for r in rows
                if r["contract_id"]} | {int(r["contract_id"]) for r in prev
                                        if r["contract_id"]}
        value_cache = {cid: float(v.get("current", 0) or 0)
                       for cid, v in contract_values_map(_ids).items()}
    except Exception:
        value_cache = {}

    def _contract_value(cid) -> float:
        if not cid:
            return 0.0
        if cid not in value_cache:
            try:
                value_cache[cid] = float(
                    contract_current_value(cid).get("current", 0) or 0)
            except Exception:
                value_cache[cid] = 0.0
        return value_cache[cid]

    receipts, payments, transfers, partner_moves = [], [], [], []
    advance_returned: list = []   # رد السلف (نقدًا أو خصم راتب): لا يُحسب مصروفًا
    advance_excluded = 0.0        # الجزء المُسترَد من سلف الفترة
    adv_paid_sum = 0.0            # الخروج النقدي للسلف في الفترة
    adv_back_sum = 0.0            # الرد النقدي للسلف في الفترة
    adv_expense_sum = 0.0         # الجزء غير المسترَد (المصروف) من سلف الفترة
    recoveries: list = []
    fee_months: dict = {}
    custody_months: dict = {}
    wallet = {"bank": before["bank"], "cash": before["cash"]}
    for r in rows:
        amount = float(r["amount"] or 0)
        w = _wallet_of(r["method"])
        _is_settle = (r["vtype"] == "payment"
                       and is_settlement_voucher(r))
        party = (r["cust_name"] or r["sub_name"] or "").strip()
        contract = (r["cname"] or "").strip()
        note = (r["descr"] or r["notes"] or "").strip()
        if BANK_FEE_MARK in (r["notes"] or "") and not note:
            note = "رسوم تحويل بنكي"
        item = {
            "date": r["vdate"] or "",
            "party": party or "—",
            "contract": contract or "—",
            "phone": ((r["cust_phone"] or r["sub_phone"] or "").strip()
                      if r["vtype"] != "transfer" else ""),
            "contract_value": (_contract_value(r["contract_id"])
                               if r["contract_id"] else ""),
            "amount": amount,
            "method": (r["method"] or "").strip(),
            "note": note,
            "wallet": w,
        }
        if (r["party_type"] or "") == "partner":
            # جاري الشريك: أثر نقدي بلا وارد/منصرف.
            item["party"] = "الشريك"
            item["contract"] = "—"
            item["_in"] = (r["vtype"] == "receipt")
            partner_moves.append(item)
            wallet[w] += amount if r["vtype"] == "receipt" else -amount
            continue
        if r["vtype"] == "custody_return":
            if int(r["advance_employee_id"] or 0):
                # رد السلفة: نقد يعود إلى المحفظة المستلمة، وليس مصروفًا ولا إيرادًا
                item["party"] = "رد سلفة"
                item["note"] = "سلفة مسترجعة — غير محسوبة مصروفًا"
                advance_returned.append(item)
                adv_back_sum += amount
                wallet[w] += amount
                continue
            # V4.54: مرتجع نقدي (عهدة) — نقد داخل خارج الوارد.
            if item["party"] == "—":
                item["party"] = "مسترد"
            recoveries.append(item)
            wallet[w] += amount
            continue
        if r["vtype"] == "salary_deduction":
            if int(r["advance_employee_id"] or 0):
                # خصم سلفة من الراتب: استرجاع بلا نقد — يُذكر ولا يُحسب مصروفًا
                item["party"] = "خصم سلفة من الراتب"
                item["note"] = "سلفة مسترجعة بخصم الراتب — غير محسوبة مصروفًا"
                item["amount"] = amount
                advance_returned.append(item)
            continue
        if r["vtype"] == "receipt":
            if int(r["advance_employee_id"] or 0):
                # V8.5: رد سلفة — ليس إيراداً لكن يدخل الرصيد النقدي
                wallet[w] += amount
                continue
            receipts.append(item)
            wallet[w] += amount
        elif r["vtype"] == "transfer":
            item["party"] = "تحويل داخلي"
            item["contract"] = "—"
            item["from_account"] = (r["method"] or "").strip()
            item["to_account"] = (r["account"] or "").strip()
            item["from_wallet"] = _wallet_of(r["method"])    # V4.33: اتجاه التحويل
            item["to_wallet"] = _wallet_of(r["account"])
            item["note"] = note or "تحويل داخلي — لا يدخل ضمن المنصرف"
            transfers.append(item)
            wallet[_wallet_of(r["method"])] -= amount
            wallet[_wallet_of(r["account"])] += amount
        else:
            if _is_settle:
                # V4.54: بند التصفية لا يظهر في التقرير المالي
                # (تفاصيله في تقارير العهدة وتقرير المصروفات).
                continue
            # السلفة: الخروج النقدي كامل، والمصروف هو الجزء غير المسترَد فقط
            if int(r["advance_employee_id"] or 0):
                _back = min(amount, adv_settled.get(int(r["id"]), 0.0))
                _exp = amount - _back
                wallet[w] -= amount
                advance_excluded += _back
                adv_paid_sum += amount
                adv_expense_sum += _exp
                if _exp > 0.0005:
                    item["amount"] = _exp
                    if item["party"] == "—":
                        item["party"] = "سلفة موظف"
                    payments.append(item)
                continue
            if r["custody_account_id"] is not None:
                # V9.15: صرف العهد (تسليم) — يُجمَّع شهريًا في سطر واحد
                # مثل العمولات. الأثر النقدي يُحسب الآن بلا تكرار.
                wallet[w] -= amount
                _mk = (r["vdate"] or "")[:7]
                _cm = custody_months.setdefault(_mk, {"total": 0.0, "count": 0})
                _cm["total"] += amount
                _cm["count"] += 1
                continue
            if (BANK_FEE_MARK in (r["notes"] or "")
                    or GATEWAY_FEE_MARK in (r["notes"] or "")):
                # V4.54: العمولات تُجمَّع شهريًا — الأثر النقدي يُحسب الآن
                # والسطر المجمّع يُبنى بعد الحلقة بلا أثر مكرر.
                wallet[w] -= amount
                _mk = (r["vdate"] or "")[:7]
                _fm = fee_months.setdefault(_mk, {"total": 0.0, "count": 0})
                _fm["total"] += amount
                _fm["count"] += 1
                continue
            payments.append(item)
            wallet[w] -= amount

    # V4.54: سطر واحد مجمّع لكل شهر من العمولات البنكية.
    for _mk in sorted(fee_months):
        _fm = fee_months[_mk]
        _, _mlabel = _period_key(f"{_mk}-01", "monthly")
        payments.append({
            "date": _mlabel, "party": "عمولات بنكية", "contract": "—",
            "phone": "", "contract_value": "", "amount": _fm["total"],
            "method": "", "note": f"إجمالي {_fm['count']} عملية خلال {_mlabel}",
            "wallet": "", "fee_aggregate": True,
        })

    # V9.15: سطر واحد مجمّع لكل شهر لصرف العهد (تسليمات).
    for _mk in sorted(custody_months):
        _cm = custody_months[_mk]
        _, _mlabel = _period_key(f"{_mk}-01", "monthly")
        payments.append({
            "date": _mlabel, "party": "صرف عهد", "contract": "—",
            "phone": "", "contract_value": "", "amount": _cm["total"],
            "method": "", "note": f"إجمالي {_cm['count']} تسليم عهدة خلال {_mlabel}",
            "wallet": "", "custody_aggregate": True,
        })

    total_in = sum(i["amount"] for i in receipts)
    total_out = sum(i["amount"] for i in payments)
    total_rec = sum(i["amount"] for i in recoveries)
    # الرصيد الافتتاحي يُضاف للصندوق ما لم يُفصَّل (قرار موثَّق)
    opening_cash = float(getattr(st, "opening_balance_cash", None)
                         if getattr(st, "opening_balance_cash", None)
                         is not None else opening)
    opening_bank = float(getattr(st, "opening_balance_bank", 0) or 0)
    if not opening_bank and opening_cash == opening:
        pass
    bank = opening_bank + wallet["bank"]
    cash = opening_cash + wallet["cash"]
    from services.lifecycle_service import partner_balance as _ob
    try:
        _obal = float(_ob(date_to or ""))
    except Exception:
        _obal = 0.0
    return {
        "receipts": receipts,
        "payments": payments,
        "transfers": transfers,
        "partner_moves": partner_moves,
        "recoveries": recoveries,
        "advance_returned": advance_returned,
        "totals": {
            "in": total_in,
            "out": total_out,
            "recoveries": total_rec,
            "net": (total_in - total_out + total_rec
                    - adv_paid_sum + adv_back_sum + adv_expense_sum),
            "partner_net": sum(
                i["amount"] if i.get("_in") else -i["amount"]
                for i in partner_moves),
            "partner_balance": _obal,
            "advance_returned_total": round(sum(i["amount"] for i in advance_returned), 3),
            "advance_excluded": round(advance_excluded, 3),
            "bank": bank,
            "cash": cash,
            "closing": bank + cash,
            "opening": opening_bank + opening_cash,
            "cash_start_date": cash_start,
        },
    }

# ============================================================
# تقرير عام للعقود — واجهة بيانات للـ UI بدون SQL مباشر
# ============================================================
def contracts_overview(date_from: str = "", date_to: str = "") -> dict:
    """كل العقود النشطة بملخص محاسبي.

    مهم: قيمة العقد الحالية تُؤخذ من lifecycle_service.contract_current_value
    ولا تُحسب هنا من amount فقط، للحفاظ على مصدر الحقيقة المالي الواحد.
    """
    from services import lifecycle_service as lc
    c_filter = " AND c.contract_date BETWEEN ? AND ?" if date_from else ""
    params = [date_from, date_to] if date_from else []
    with get_connection() as conn:
        rows = conn.execute(f"""
            SELECT c.id, c.contract_number, c.contract_name,
                   cu.name AS customer_name,
                   c.contract_date, c.end_date, c.status
            FROM contracts c
            JOIN customers cu ON cu.id = c.customer_id
            WHERE c.status NOT IN ('ملغى','مسودة') {c_filter}
            ORDER BY c.contract_date DESC, c.id DESC
        """, params).fetchall()
    result = []
    totals = {"count": 0, "value": 0.0, "collected": 0.0, "remaining": 0.0}
    # الأداء: كانت القيمة والمحصّل يُقرآن بعقد-بعقد (استعلامات واتصالات
    # بعدد العقود). الآن تُجمَّع القيم والمحصّل دفعة واحدة.
    values = lc.contract_values_map([r["id"] for r in rows])
    with get_connection() as conn:
        collected_map = {int(x["contract_id"]): float(x["amt"] or 0)
                         for x in conn.execute(
                             "SELECT contract_id, COALESCE(SUM(amount),0) AS amt "
                             "FROM vouchers WHERE vtype='receipt' AND cancelled=0 "
                             "AND contract_id IS NOT NULL "
                             "GROUP BY contract_id").fetchall()}
    for r in rows:
        value = (values.get(int(r["id"])) or {}).get("current", 0.0)
        collected = collected_map.get(int(r["id"]), 0.0)
        remaining = value - collected
        # رقم العقد واسمه في خانة واحدة (اسم العقد الحقيقي هو الوصف؛
        # contract_name مفروض بـ TRIGGER ليساوي نوع العقد)
        _num = (r["contract_number"] or "").strip()
        _nm = (r["contract_name"] or "").strip()
        if _nm in ("غير محدد", _num, "-", "—"):
            _nm = ""
        _label = f"{_num} · {_nm}" if (_num and _nm) else (_num or _nm or "—")
        result.append([
            r["customer_name"], _label,
            r["contract_date"] or "", r["end_date"] or "—",
            r["status"] or "نشط", value, collected, remaining])
        totals["count"] += 1
        totals["value"] += value
        totals["collected"] += collected
        totals["remaining"] += remaining
    return {"rows": result, "totals": totals}


# ============================================================
# دفتر اليومية · كل القيود المحاسبية في الفترة
# ============================================================
def journal_report(date_from: str = "", date_to: str = "") -> dict:
    """قيود اليومية: التاريخ، البيان، المدين، الدائن، المبلغ.

    V3.14: القيود كانت تُكتب ولا تُقرأ — هذا التقرير يُحييها.
    القيود العكسية (إلغاءات) جزء من الدفتر ومميزة بعلامة.
    """
    with get_connection() as conn:
        rows = [dict(r) for r in conn.execute(
            """SELECT id, entry_date, description, debit_account,
                      credit_account, amount, contract_id, source_type, source_id
               FROM journal_entries
               WHERE (? = '' OR entry_date >= ?)
                 AND (? = '' OR entry_date <= ?)
               ORDER BY entry_date, id""",
            (date_from, date_from, date_to, date_to)).fetchall()]
    total = round(sum(float(r["amount"] or 0) for r in rows), 3)
    out = []
    for n, r in enumerate(rows, 1):
        rev = (r["source_type"] or "") == "voucher_cancel"
        out.append({
            "seq": n, "date": r["entry_date"] or "",
            "description": (r["description"] or "") + (" · (قيد عكسي)" if rev else ""),
            "debit_account": r["debit_account"] or "",
            "credit_account": r["credit_account"] or "",
            "amount": float(r["amount"] or 0), "is_reversal": rev,
        })
    reversals = sum(1 for r in out if r["is_reversal"])
    return {"rows": out,
            "totals": {"debit": total, "credit": total, "balanced": True,
                       "count": len(out), "reversals": reversals}}


# ============================================================
# V8.11: ملخص البوابة — T+1 والعمليات المعلقة
# ============================================================
def gateway_summary(date_from: str = "", date_to: str = "") -> dict:
    """ملخص عمليات البوابة: المحسوبة فعليًا (T+1 مستوفى) vs المعلقة.

    يُستخدم في التقرير المالي لعرض:
    - إجمالي البوابة في الفترة
    - منها: محسوبة فعليًا (effective_date مضى)
    - منها: في الانتظار (effective_date لم يحن بعد)
    """
    from datetime import date as _date
    today = _date.today().isoformat()
    with get_connection() as conn:
        # تأكد من وجود العمود
        _cols = {r[1] for r in conn.execute(
            "PRAGMA table_info(gateway_ops);")}
        has_ed = "effective_date" in _cols
        if not has_ed:
            return {"total": 0.0, "collected": 0.0, "pending": 0.0,
                    "count": 0, "collected_count": 0, "pending_count": 0,
                    "pending_items": []}

        where = ["status = 'mine'", "COALESCE(amount,0) > 0"]
        params: list = []
        if date_from:
            where.append("op_date >= ?")
            params.append(date_from)
        if date_to:
            where.append("op_date <= ?")
            params.append(date_to)
        clause = " AND ".join(where)

        rows = conn.execute(
            f"SELECT id, op_date, phone, amount, ref, customer, "
            f"COALESCE(effective_date,'') AS effective_date "
            f"FROM gateway_ops WHERE {clause} ORDER BY op_date",
            tuple(params)).fetchall()

    total = 0.0
    collected = 0.0
    pending = 0.0
    collected_n = 0
    pending_items = []
    for r in rows:
        amt = float(r["amount"] or 0)
        total += amt
        ed = (r["effective_date"] or "").strip()
        if not ed:
            # لا يوجد effective_date → اعتبره محسوب (قديم)
            collected += amt
            collected_n += 1
        elif ed <= today:
            collected += amt
            collected_n += 1
        else:
            pending += amt
            pending_items.append({
                "op_date": r["op_date"] or "",
                "effective_date": ed,
                "amount": amt,
                "customer": r["customer"] or "",
                "ref": r["ref"] or "",
                "phone": r["phone"] or "",
            })
    return {
        "total": round(total, 3),
        "collected": round(collected, 3),
        "pending": round(pending, 3),
        "count": len(rows),
        "collected_count": collected_n,
        "pending_count": len(pending_items),
        "pending_items": pending_items,
    }
