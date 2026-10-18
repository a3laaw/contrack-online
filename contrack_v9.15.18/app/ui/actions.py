# -*- coding: utf-8 -*-
"""أوامر واجهة موحّدة.

الهدف: أي زر في أي شاشة يستدعي نفس مسار الواجهة لنفس العملية،
بدل تكرار فتح النوافذ وتعبئة البيانات في أكثر من ملف.
"""
from __future__ import annotations

from typing import Callable

from PySide6.QtWidgets import QDialog, QWidget


def open_voucher(parent: QWidget, vtype: str,
                 customer_id: int | None = None,
                 contract_id: int | None = None,
                 on_saved: Callable[[], None] | None = None,
                 subcontractor_id: int | None = None,
                 sub_contract_id: int | None = None) -> bool:
    """فتح سند قبض/صرف من مسار واحد مع تعبئة السياق اختياريًا.

    V5.4: ``subcontractor_id`` / ``sub_contract_id`` لفتح سند على مقاول
    باطن من الزر الأيمن في شجرة المقاولين (يُعبَّأ الطرف وعقد الباطن).
    """
    from services import auth_service as _auth
    from ui import style
    from ui.vouchers import VoucherDialog

    perm = "action_add_receipt" if vtype == "receipt" else "action_add_payment"
    if not _auth.has_permission(perm):
        style.info(parent, "إنشاء هذا النوع من السندات غير متاح لحسابك.")
        return False

    kwargs = {"preset_contract_id": contract_id} if contract_id else {}
    if subcontractor_id:
        kwargs["preset_subcontractor_id"] = int(subcontractor_id)
    if sub_contract_id:
        kwargs["preset_sub_contract_id"] = int(sub_contract_id)
    dlg = VoucherDialog(parent, vtype, **kwargs)
    if customer_id and not contract_id and not subcontractor_id:
        try:
            dlg.party_kind.setCurrentIndex(0)   # عميل
            dlg._reload_parties()
            dlg.party.select_data(customer_id)
        except Exception:
            pass
    if dlg.exec() == QDialog.Accepted:
        if on_saved:
            on_saved()
        return True
    return False


def open_contract(parent: QWidget, customer_id: int | None = None,
                  on_saved: Callable[[], None] | None = None) -> bool:
    """فتح صفحة عقد (إنشاء) — صفحة كاملة بدل Dialog."""
    from services import customer_service
    if not customer_service.count_customers():
        from ui import style
        style.info(parent, "أضف عميلًا أولاً.")
        return False
    win = parent.window()
    if hasattr(win, 'open_contract_page'):
        win.open_contract_page(customer_id=customer_id, on_done=lambda accepted: on_saved() if accepted and on_saved else None)
        return True
    # Fallback للنظام القديم
    from ui.contracts import ContractDialog
    dlg = ContractDialog(parent)
    if customer_id:
        try:
            dlg.customer.select_data(customer_id)
        except Exception:
            pass
    if dlg.exec() == QDialog.Accepted:
        if on_saved:
            on_saved()
        return True
    return False
