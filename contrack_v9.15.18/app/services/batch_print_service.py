# -*- coding: utf-8 -*-
"""الطباعة الدفعية: توليد عدة مستندات PDF دفعة واحدة في مجلد واحد."""
import os
from datetime import datetime


def batch_export(items: list[dict], out_dir: str,
                 progress_cb=None) -> tuple[list[str], list[str]]:
    """توليد دفعة مستندات.

    items: [{kind: 'invoice'|'voucher'|'statement', ...بيانات كل نوع}]
    يرجع: (قائمة الملفات الناجحة، قائمة أسماء الفاشلة)
    """
    os.makedirs(out_dir, exist_ok=True)
    done, failed = [], []
    for i, item in enumerate(items):
        try:
            kind = item["kind"]
            if kind == "invoice":
                from reports.invoice_pdf import generate_invoice_pdf
                inv = item["invoice"]
                path = os.path.join(out_dir, f"فاتورة_{inv.invoice_number}.pdf")
                generate_invoice_pdf(inv, path)
            elif kind == "voucher":
                from reports.voucher_pdf import generate_voucher_pdf
                v = item["voucher"]
                title = "سند_قبض" if v["vtype"] == "receipt" else "سند_صرف"
                path = os.path.join(out_dir, f"{title}_{v['voucher_number']}.pdf")
                generate_voucher_pdf(v, path)
            elif kind == "statement":
                from reports.statement_pdf import generate_statement_pdf
                path = os.path.join(
                    out_dir, f"كشف_حساب_{item['contract_number']}.pdf")
                generate_statement_pdf(item["contract_id"], path)
            else:
                failed.append(str(item))
                continue
            done.append(path)
        except Exception:
            failed.append(item.get("label", str(i)))
        if progress_cb:
            progress_cb(i + 1, len(items))
    return done, failed
