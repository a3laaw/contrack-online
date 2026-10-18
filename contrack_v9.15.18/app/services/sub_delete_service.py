# -*- coding: utf-8 -*-
"""V5.8: حذف بيانات مقاول الباطن بخيارات — عقد · سند · السجل.

بدل «حذف المقاول كامل» فقط، تتيح هذه الخدمة:
    * حذف **عقد باطن** محدد (أو أكثر) وحده — بلا مساس بسجل المقاول
      ولا بعقوده الأخرى.
    * حذف **سند** محدد (أو أكثر) وحده — حذف نهائي لحساب المطور، وإلغاء
      موثّق لغيره (الحركة المالية لا تُمحى بلا حساب المطور).
    * حذف **سجل المقاول** نفسه — بعد إفراغه فقط؛ يُرفض ما دام عليه عقد
      أو سند (نفس قواعد حذف العميل: يُرفض ما دام مرتبطًا).

لا يمسّ هذا الملف بنود عقد **العميل** أبدًا — فقط ارتباط عقد الباطن.
"""
from __future__ import annotations

from services import addendum_service as _adx  # noqa: F401  (توافق الاستيراد)
from services import lifecycle_service as lc
from services import purge_service as pg
from services.customer_service import ValidationError
from database.database import get_connection


def is_developer() -> bool:
    from services import auth_service
    try:
        return bool(auth_service.is_developer())
    except Exception:
        return False


def _table_exists(conn, name: str) -> bool:
    return bool(conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (name,)).fetchone())


def _has_col(conn, table: str, col: str) -> bool:
    try:
        return col in {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
    except Exception:
        return False


def _vt_label(vtype: str) -> str:
    try:
        return lc.voucher_type_label(vtype) or (vtype or "")
    except Exception:
        return vtype or ""


def overview(sub_id: int) -> dict:
    """قراءة فقط: عقود المقاول وسنداته وحالة سجل المقاول."""
    sid = int(sub_id or 0)
    out: dict = {"subcontractor": {}, "contracts": [], "vouchers": [],
                 "summary": {"contracts": 0, "vouchers": 0, "vouchers_active": 0,
                             "vouchers_cancelled": 0, "vouchers_total": 0.0,
                             "contracts_value": 0.0},
                 "can_delete_record": False, "record_block": ""}
    if not sid:
        return out
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM subcontractors WHERE id=?",
                           (sid,)).fetchone()
        if row is None:
            return out
        srow = dict(row)
        out["subcontractor"] = srow
        scs = [dict(r) for r in conn.execute(
            "SELECT sc.*, COALESCE(k.contract_number,'') AS client_number, "
            "COALESCE(c.name,'') AS customer_name, "
            "COALESCE(k.status,'') AS client_status "
            "FROM sub_contracts sc "
            "LEFT JOIN contracts k ON k.id = sc.contract_id "
            "LEFT JOIN customers c ON c.id = k.customer_id "
            "WHERE sc.subcontractor_id=? ORDER BY sc.id", (sid,)).fetchall()]
        for sc in scs:
            scid = int(sc["id"])
            items = conn.execute(
                "SELECT COUNT(*) FROM sub_contract_items WHERE sub_contract_id=?",
                (scid,)).fetchone()[0]
            plan = 0
            if _table_exists(conn, "sub_payment_plan"):
                plan = conn.execute(
                    "SELECT COUNT(*) FROM sub_payment_plan "
                    "WHERE sub_contract_id=?", (scid,)).fetchone()[0]
            v_act = conn.execute(
                "SELECT COUNT(*) FROM vouchers WHERE sub_contract_id=? "
                "AND COALESCE(cancelled,0)=0", (scid,)).fetchone()[0]
            v_all = conn.execute(
                "SELECT COUNT(*) FROM vouchers WHERE sub_contract_id=?",
                (scid,)).fetchone()[0]
            claims = 0
            if _table_exists(conn, "claims"):
                claims = conn.execute(
                    "SELECT COUNT(*) FROM claims WHERE sub_contract_id=?",
                    (scid,)).fetchone()[0]
            sc.update({"items": int(items), "plan_rows": int(plan),
                       "vouchers_active": int(v_act), "vouchers": int(v_all),
                       "claims": int(claims)})
            # سبب منع حذف هذا العقد (نفس قواعد lifecycle.delete_sub_contract)
            blocks = []
            if v_act:
                blocks.append(f"{v_act} سند صرف سارٍ")
            if claims:
                blocks.append(f"{claims} مطالبة")
            sc["can_delete"] = not blocks
            sc["block_reason"] = (" · ".join(blocks))
            out["contracts"].append(sc)

        conds = ["(party_type='subcontractor' AND party_id=?)"]
        params: list = [sid]
        if scs:
            marks = ",".join("?" * len(scs))
            conds.append(f"sub_contract_id IN ({marks})")
            params += [int(s["id"]) for s in scs]
        vcols = {r[1] for r in conn.execute("PRAGMA table_info(vouchers)")}
        vsel = ("id, voucher_number, vtype, vdate, amount, "
                + ("COALESCE(cancelled,0)" if "cancelled" in vcols else "0")
                + " AS cancelled"
                + (", COALESCE(description,'') AS description"
                   if "description" in vcols else ", '' AS description")
                + (", sub_contract_id" if "sub_contract_id" in vcols
                   else ", NULL AS sub_contract_id"))
        vrows = [dict(r) for r in conn.execute(
            f"SELECT {vsel} FROM vouchers WHERE (" + " OR ".join(conds)
            + ") ORDER BY vdate, id", tuple(params)).fetchall()]
        sc_by_id = {int(s["id"]): s for s in scs}
        for v in vrows:
            scid = v.get("sub_contract_id")
            sc = sc_by_id.get(int(scid)) if scid else None
            v["type_label"] = _vt_label(v.get("vtype"))
            v["cancelled"] = int(v.get("cancelled") or 0)
            v["linked_contract"] = (sc.get("client_number") or "") if sc else ""
            v["linked_sub_contract"] = (int(scid) if scid else 0)
            out["vouchers"].append(v)

        s = out["summary"]
        s["contracts"] = len(scs)
        s["contracts_value"] = round(
            sum(float(x.get("amount") or 0) for x in scs), 3)
        s["vouchers"] = len(vrows)
        s["vouchers_active"] = sum(1 for v in vrows if not v["cancelled"])
        s["vouchers_cancelled"] = s["vouchers"] - s["vouchers_active"]
        s["vouchers_total"] = round(
            sum(float(v.get("amount") or 0) for v in vrows
                if not v["cancelled"]), 3)

    left = []
    if s["contracts"]:
        left.append(f"{s['contracts']} عقد باطن")
    if s["vouchers"]:
        left.append(f"{s['vouchers']} سند")
    if left:
        out["can_delete_record"] = False
        out["record_block"] = ("لا يمكن حذف سجل المقاول الآن — عليه "
                               + " و ".join(left)
                               + ". احذفها من هذه الشاشة أولًا.")
    else:
        out["can_delete_record"] = True
        out["record_block"] = ""
    return out


# ============================================================
# أفعال الحذف المنفصلة
# ============================================================
def delete_contracts(sub_contract_ids, reason: str = "") -> dict:
    """يحذف عقود باطن محددة فقط — بلا مساس بسجل المقاول أو بغيره."""
    ids = [int(x) for x in (sub_contract_ids or []) if int(x or 0)]
    if not ids:
        raise ValidationError("حدد عقد باطن واحدًا على الأقل.")
    done, errors = [], []
    for scid in ids:
        try:
            lc.delete_sub_contract(scid)
            done.append(scid)
        except ValidationError as exc:
            errors.append({"id": scid, "msg": str(exc)})
        except Exception as exc:                        # noqa: BLE001
            errors.append({"id": scid, "msg": f"تعذّر الحذف: {exc}"})
    return {"deleted": len(done), "ids": done, "errors": errors}


def can_hard_delete_vouchers() -> bool:
    return is_developer()


def delete_vouchers(voucher_ids, reason: str = "") -> dict:
    """يحذف/يلغي سندات محددة فقط.

    المطور: حذف نهائي موثّق في سجل التدقيق.
    غيره: إلغاء موثّق (الحركة تبقى في السجل ويُفتح ما عُلّق بها).
    """
    ids = [int(x) for x in (voucher_ids or []) if int(x or 0)]
    if not ids:
        raise ValidationError("حدد سندًا واحدًا على الأقل.")
    reason = (reason or "").strip()
    if not reason:
        raise ValidationError(
            "اكتب سبب الحذف/الإلغاء — يُحفظ في سجل التدقيق.")
    if can_hard_delete_vouchers():
        res = pg.purge_vouchers(ids, reason)
        return {"mode": "delete", "deleted": int(res.get("deleted") or 0),
                "ids": ids, "errors": []}
    done, errors = [], []
    for vid in ids:
        try:
            lc.cancel_voucher(vid, f"{reason} — إلغاء بدل حذف (بلا حساب مطوّر)")
            done.append(vid)
        except ValidationError as exc:
            errors.append({"id": vid, "msg": str(exc)})
        except Exception as exc:                        # noqa: BLE001
            errors.append({"id": vid, "msg": f"تعذّر الإلغاء: {exc}"})
    return {"mode": "cancel", "cancelled": len(done), "ids": done,
            "errors": errors}


def delete_record(sub_id: int, reason: str = "") -> dict:
    """يحذف سجل المقاول نفسه — بعد إفراغه من العقود والسندات."""
    sid = int(sub_id or 0)
    if not sid:
        raise ValidationError("حدد المقاول.")
    ov = overview(sid)
    if not ov.get("subcontractor"):
        raise ValidationError("المقاول غير موجود.")
    if not ov["can_delete_record"]:
        name = ov["subcontractor"].get("name", "")
        raise ValidationError(
            f"لا يمكن حذف سجل المقاول «{name}».\n{ov['record_block']}")
    reason = (reason or "").strip()
    if not reason:
        raise ValidationError("اكتب سبب الحذف — يُحفظ في سجل التدقيق.")
    res = pg.purge_subcontractor(sid, reason, delete_contracts=False,
                                 delete_vouchers=False)
    return {"deleted": int(res.get("deleted") or 0)}
