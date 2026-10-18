# -*- coding: utf-8 -*-
"""منطق كشف الحساب بصيغة مدين / دائن · الرصيد محسوب دائمًا من البيانات.

المنطق المحاسبي:
- قيمة العقد   → مدين  (مبلغ مستحق على العميل)
- كل فاتورة    → دائن  (تخصم من المستحق)
- الرصيد       → مدين تراكمي - دائن تراكمي = المتبقي
"""
from database.database import get_connection
from services import contract_service, customer_service
from services.customer_service import ValidationError


def build_statement(contract_id: int) -> dict:
    """يبني كشف الحساب: جدول الحركة بأعمدة مدين/دائن/رصيد + الإجماليات."""
    contract = contract_service.get_contract(contract_id)
    if not contract:
        raise ValidationError("العقد غير موجود.")
    customer = customer_service.get_customer(contract.customer_id)
    if not customer:
        raise ValidationError("العميل غير موجود.")

    with get_connection() as conn:
        invoice_rows = conn.execute(
            "SELECT invoice_number, invoice_date, description, amount "
            "FROM invoices WHERE contract_id=? ORDER BY invoice_date, id",
            (contract_id,),
        ).fetchall()
        receipt_rows = conn.execute(
            "SELECT voucher_number, vdate, description, amount "
            "FROM vouchers WHERE contract_id=? AND vtype='receipt' AND cancelled=0 "
            "ORDER BY vdate, id", (contract_id,),
        ).fetchall()
        addendum_rows = conn.execute(
            "SELECT addendum_number, addendum_type, adate, reason, "
            "amount_add, amount_deduct "
            "FROM addendums WHERE contract_id=? AND status='معتمد' "
            "ORDER BY adate, id", (contract_id,),
        ).fetchall()

    rows = []
    balance = 0.0

    # قيمة العقد: مدين
    balance += contract.amount
    rows.append({
        "date": contract.contract_date,
        "description": "قيمة العقد",
        "ref": contract.contract_number,
        "debit": contract.amount,
        "credit": 0.0,
        "balance": balance,
    })

    net_addendums = 0.0
    movements = []  # (تاريخ، وصف، مرجع، مدين، دائن)
    for a in addendum_rows:
        net = float(a["amount_add"]) - float(a["amount_deduct"])
        if abs(net) < 0.001:
            continue
        atype = a["addendum_type"] or "أمر تغييري"
        desc = f"{atype}: {a['reason'] or ''}".strip().rstrip(":")
        if net > 0:
            movements.append((a["adate"], desc, a["addendum_number"],
                              net, 0.0))
        else:
            movements.append((a["adate"], desc, a["addendum_number"],
                              0.0, -net))
        net_addendums += net
    inv_total = sum(float(i["amount"]) for i in invoice_rows)
    rec_total = sum(float(r["amount"]) for r in receipt_rows)
    for inv in invoice_rows:
        # V3.14: الفاتورة مطالبة توثيقية — تُعرض للعلم ولا تخفض المديونية.
        # المديونية يخفضها التحصيل فقط (توحيدًا مع المستحقات/الملف/المركز).
        movements.append((inv["invoice_date"],
                          f"فاتورة (للعلم): {inv['description'] or 'فاتورة'} · {float(inv['amount']):,.3f}",
                          inv["invoice_number"], 0.0, 0.0))
    for rec in receipt_rows:
        movements.append((rec["vdate"], rec["description"] or "سند قبض",
                          rec["voucher_number"], 0.0, float(rec["amount"])))
    # عقد الإشراف: أشهر التمديد المستحقة تظهر كحركة مدينة تلقائية
    sup_extension = 0.0
    from services.supervision_service import supervision_status
    sup = supervision_status(contract_id)
    if sup and sup["extension_value"] > 0.001:
        sup_extension = sup["extension_value"]
        m = sup["billable_extension"]
        m_txt = ("شهر واحد" if m == 1 else "شهران" if m == 2
                 else f"{m:g} شهر")
        movements.append((
            sup["base_end"],
            f"تمديد إشراف · {m_txt} ({sup['monthly']:,.3f} للشهر)"
            + (f" · بعد إلغاء {sup['waived_months']:g} شهر"
               if sup["waived_months"] else ""),
            "تمديد", sup_extension, 0.0))

    movements.sort(key=lambda x: (x[0], x[2]))
    for mdate, mdesc, mref, debit, credit in movements:
        balance += debit - credit
        rows.append({
            "date": mdate,
            "description": mdesc,
            "ref": mref,
            "debit": debit,
            "credit": credit,
            "balance": balance,
        })

    current_value = contract.amount + net_addendums + sup_extension
    total_deducts = sum(r["credit"] for r in rows
                        if r["credit"] and r["ref"].startswith("ADD-"))
    # V3.14: القاعدة الموحدة — المتبقي = القيمة الحالية − المحصّل فقط.
    # الفواتير محايدة (للعلم)، والحسميات محسوبة مرة واحدة داخل القيمة.
    total_invoiced = inv_total
    total_debit = (contract.amount + sup_extension + sum(
        r["debit"] for r in rows if r["ref"].startswith("ADD-")))
    total_credit = rec_total + total_deducts
    return {
        "customer": customer,
        "contract": contract,
        "rows": rows,
        "contract_amount": current_value,      # القيمة الحالية بالملحقات
        "original_amount": contract.amount,
        "net_addendums": net_addendums,
        "sup_extension": sup_extension,        # مديونية تمديد الإشراف
        "total_invoiced": total_invoiced,
        "total_debit": total_debit,
        "total_credit": total_credit,
        "remaining": current_value - rec_total,
    }


def build_customer_statement(customer_id: int, contract_id: int | None = None,
                             date_from: str = "", date_to: str = "") -> dict:
    """كشف العميل الشامل: كل عقوده (أو عقد مفلتر) في حركة مستمرة واحدة.

    - يُبنى كل عقد بذات منطق build_statement (قاعدة «الأكبر» داخل كل عقد).
    - تُدمج الحركات زمنيًا برصيد جارٍ واحد + عمود العقد.
    - فلتر التاريخ: ما قبله يتحول لـ«رصيد أول الفترة» لكل عقد.
    - صفوف kind: move / opening / subtotal / total (الأخيرة للعرض فقط).
    """
    customer = customer_service.get_customer(customer_id)
    if not customer:
        raise ValidationError("العميل غير موجود.")
    if contract_id:
        contract = contract_service.get_contract(contract_id)
        if not contract or contract.customer_id != customer_id:
            raise ValidationError("العقد غير موجود لهذا العميل.")
        contracts = [contract]
    else:
        contracts = sorted(
            contract_service.list_contracts(customer_id=customer_id),
            key=lambda c: ((c.contract_date or ""), c.id))
        # V3.6: الملغاة والمسودات خارج الموحّد — قيمتها دين وهمي يضخم
        # المتبقي (مطابقة لتقرير المستحقات الذي لا يُظهرها). الحالة في
        # عمود contracts.status وليست في كائن العقد.
        with get_connection() as conn:
            _status = {r["id"]: (r["status"] or "") for r in conn.execute(
                "SELECT id, status FROM contracts WHERE customer_id=?",
                (customer_id,)).fetchall()}
        contracts = [c for c in contracts
                     if (_status.get(c.id) or "")
                     not in ("ملغى", "ملغي", "مسودة")]
    if not contracts:
        raise ValidationError("لا توجد عقود لهذا العميل.")

    per_contract = []  # (contract, statement, opening, shown_rows)
    for c in contracts:
        st = build_statement(c.id)
        rows = [dict(r, contract_id=c.id, contract_number=c.contract_number,
                     kind="move") for r in st["rows"]]
        if date_from:
            before = [r for r in rows if (r["date"] or "") < date_from]
            shown = [r for r in rows
                     if (r["date"] or "") >= date_from
                     and (not date_to or (r["date"] or "") <= date_to)]
            opening = before[-1]["balance"] if before else 0.0
        else:
            shown = [r for r in rows
                     if not date_to or (r["date"] or "") <= date_to]
            opening = 0.0
        per_contract.append((c, st, opening, shown))

    total_opening = sum(o for _, _, o, _ in per_contract)
    merged = [r for _, _, _, shown in per_contract for r in shown]
    merged.sort(key=lambda r: ((r["date"] or ""), r["contract_number"],
                               r["ref"] or ""))

    rows: list[dict] = []
    balance = total_opening
    if date_from or abs(total_opening) > 0.0005:
        rows.append({
            "date": date_from or (merged[0]["date"] if merged else ""),
            "description": "رصيد أول الفترة",
            "ref": "", "contract_id": None, "contract_number": "",
            "debit": total_opening if total_opening > 0 else 0.0,
            "credit": -total_opening if total_opening < 0 else 0.0,
            "balance": total_opening, "kind": "opening",
        })
        balance = total_opening
    for r in merged:
        balance += (r["debit"] or 0) - (r["credit"] or 0)
        r["balance"] = balance
        rows.append(r)

    summaries = {}
    for c, st, opening, shown in per_contract:
        d = sum(r["debit"] or 0 for r in shown)
        cr = sum(r["credit"] or 0 for r in shown)
        closing = opening + d - cr
        summaries[c.id] = {"contract": c, "opening": opening,
                           "debit": d, "credit": cr, "closing": closing}
        rows.append({
            "date": "", "description": f"إجمالي عقد {c.contract_number}",
            "ref": "", "contract_id": c.id, "contract_number": c.contract_number,
            "debit": d, "credit": cr, "balance": closing, "kind": "subtotal",
        })

    total_debit = sum(s["debit"] for s in summaries.values())
    total_credit = sum(s["credit"] for s in summaries.values())
    remaining = balance
    rows.append({
        "date": "", "description": "الإجمالي العام",
        "ref": "", "contract_id": None, "contract_number": "",
        "debit": total_debit, "credit": total_credit,
        "balance": remaining, "kind": "total",
    })
    return {
        "customer": customer,
        "contracts": contracts,
        "contract": contracts[0] if contract_id else None,
        "rows": rows,
        "total_debit": total_debit,
        "total_credit": total_credit,
        "remaining": remaining,
        "opening": total_opening,
        "contracts_count": len(contracts),
        "date_from": date_from, "date_to": date_to,
        "per_contract": summaries,
    }


def build_subcontractor_statement(sub_id: int,
                                 date_from: str = "",
                                 date_to: str = "") -> dict:
    """كشف مقاول الباطن: عقود باطنه (مدين) + سندات صرفه (دائن) برصيد جارٍ.

    نفس شكل كشف العميل الشامل: rows برصيد جارٍ + افتتاحية عند فلتر
    التاريخ + إجمالي — فتعمل نفس شاشة العرض والتصدير دون منطق جديد.
    العقود الملغاة خارج الكشف (مطابق لإجماليات شجرة الباطن).
    """
    from services import lifecycle_service as lc
    from services.extras_service import subcontractor_payments
    sub = lc.get_subcontractor(sub_id)
    if not sub:
        raise ValidationError("المقاول غير موجود.")
    tree = [s for s in lc.subcontractors_tree() if s["id"] == sub_id]
    contracts = [c for c in (tree[0]["contracts"] if tree else [])
                 if c.get("status") != "ملغى"]

    moves: list[dict] = []
    for c in contracts:
        desc = c.get("description") or c.get("contract_name") or ""
        moves.append({
            "date": c.get("start_date") or "",
            "description": (f"عقد باطن {c.get('contract_number')} · {desc}"
                            if desc else f"عقد باطن {c.get('contract_number')}"),
            "ref": c.get("contract_number") or "",
            "contract_id": c.get("contract_id"),
            "contract_number": c.get("contract_number") or "",
            "debit": float(c.get("amount") or 0),
            "credit": 0.0, "kind": "move",
        })
    for v in subcontractor_payments(sub_id):
        moves.append({
            "date": v.get("vdate") or "",
            "description": (v.get("description") or
                            f"سند صرف {v.get('voucher_number')}"),
            "ref": v.get("voucher_number") or "",
            "contract_id": None,
            "contract_number": v.get("contract_number") or "",
            "debit": 0.0,
            "credit": float(v.get("amount") or 0), "kind": "move",
        })

    if date_from:
        before = [r for r in moves if (r["date"] or "") < date_from]
        shown = [r for r in moves
                 if (r["date"] or "") >= date_from
                 and (not date_to or (r["date"] or "") <= date_to)]
        opening = (sum(r["debit"] or 0 for r in before)
                   - sum(r["credit"] or 0 for r in before))
    else:
        shown = [r for r in moves
                 if not date_to or (r["date"] or "") <= date_to]
        opening = 0.0
    shown.sort(key=lambda r: ((r["date"] or ""), r["ref"] or ""))

    rows: list[dict] = []
    balance = opening
    if date_from or abs(opening) > 0.0005:
        rows.append({
            "date": date_from or (shown[0]["date"] if shown else ""),
            "description": "رصيد أول الفترة",
            "ref": "", "contract_id": None, "contract_number": "",
            "debit": opening if opening > 0 else 0.0,
            "credit": -opening if opening < 0 else 0.0,
            "balance": opening, "kind": "opening",
        })
    for r in shown:
        balance += (r["debit"] or 0) - (r["credit"] or 0)
        r["balance"] = balance
        rows.append(r)

    total_debit = sum(r["debit"] or 0 for r in shown)
    total_credit = sum(r["credit"] or 0 for r in shown)
    rows.append({
        "date": "", "description": "الإجمالي العام",
        "ref": "", "contract_id": None, "contract_number": "",
        "debit": total_debit, "credit": total_credit,
        "balance": balance, "kind": "total",
    })
    return {
        "sub": sub,
        "contracts": contracts,
        "contract": None,
        "rows": rows,
        "total_debit": total_debit,
        "total_credit": total_credit,
        "remaining": balance,
        "opening": opening,
        "contracts_count": len(contracts),
        "date_from": date_from, "date_to": date_to,
    }
