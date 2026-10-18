"""V3.8 — الحزمة 2: تبويبات تقارير العهد الأربعة + العهد المعلقة.

تغطية: مجمع (عمود عهدة + مجاميع فرعية)، أرصدة (ألوان)، كشف موظف،
معلقة (أقدم تسليم + أيام + عتبة)، مطابقة متقاطعة مع الأستاذ،
دخانيات PDF/Excel، زر التقارير في شاشة التصفيات.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import database.database as db  # noqa: E402
import services.lifecycle_service as lc  # noqa: E402

db.init_db()

from PySide6.QtWidgets import QApplication  # noqa: E402

QApplication.instance() or QApplication([])


_SEED_IDS: tuple = ()


def _seed():
    global _SEED_IDS
    if _SEED_IDS:
        return _SEED_IDS
    from services import auth_service
    from services import expense_account_service as ea
    auth_service.has_permission = lambda *a, **k: True  # noqa: E731
    auth_service.is_admin = lambda: True  # noqa: E731
    root = ea.add_account("العهد", None, allow_posting=False)
    a1 = ea.add_account("عهدة أحمد", root, account_kind="advance")
    a2 = ea.add_account("عهدة سارة", root, account_kind="advance")
    a3 = ea.add_account("عهدة خالد", root, account_kind="advance")
    exp = ea.add_account("مواد", None, allow_posting=True)
    assert a1 and a2 and a3 and exp

    def _line(vd, amt, desc):
        return {"vdate": vd, "expense_account_id": exp, "party": "مورد",
                "expense_customer_id": None, "project_id": None,
                "contract_id": None, "amount": amt,
                "description": desc}

    # أحمد: تسليم قديم + تسليم حديث + تصفية جزئية → معلقة
    lc.add_voucher("payment", "2026-01-05", "أحمد", "نقدًا",
                   "عهدة أحمد", 1000.0, "عهد: تسليم",
                   custody_account_id=a1)
    lc.add_voucher("payment", "2026-09-01", "أحمد", "نقدًا",
                   "عهدة أحمد", 500.0, "عهد: تسليم",
                   custody_account_id=a1)
    lc.add_custody_settlement("2026-09-02", a1,
                              [_line("2026-09-02", 900.0, "مواد")],
                              "تصفية أحمد")
    # سارة: تسليم + تصفية كاملة → رصيد صفر (ليست معلقة)
    lc.add_voucher("payment", "2026-09-03", "سارة", "نقدًا",
                   "عهدة سارة", 700.0, "عهد: تسليم",
                   custody_account_id=a2)
    lc.add_custody_settlement("2026-09-04", a2,
                              [_line("2026-09-04", 700.0, "أجور")],
                              "تصفية سارة")
    # خالد: منصرف يفوق المسلَّم → رصيد سالب (تنبيه أحمر)
    lc.add_voucher("payment", "2026-09-05", "خالد", "نقدًا",
                   "عهدة خالد", 500.0, "عهد: تسليم",
                   custody_account_id=a3)
    lc.add_custody_settlement("2026-09-06", a3,
                              [_line("2026-09-06", 800.0, "طوارئ")],
                              "تصفية خالد")
    _SEED_IDS = (a1, a2, a3)
    return _SEED_IDS


def _dlg(account_id=None):
    from PySide6.QtCore import QDate
    from ui.custody_center import SettlementsReportDialog
    d = SettlementsReportDialog(None, account_id)
    d.d1.setDate(QDate(2026, 1, 1))
    d.d2.setDate(QDate.currentDate())
    d.refresh()
    return d


def test_summary_six_heads_and_subtotals():
    _seed()
    d = _dlg()
    heads = [d.table.horizontalHeaderItem(i).text()
             for i in range(d.table.columnCount())]
    assert heads == ["المرجع", "التاريخ", "العهدة", "البنود",
                     "الإجمالي", "البيان"], heads
    # 3 تصفيات × (سطر + بند) + 3 سطور مجاميع = 9
    assert d.table.rowCount() == 9, d.table.rowCount()
    texts = [d.table.item(r, 0).text() for r in range(9)]
    assert sum(t.startswith("إجمالي:") for t in texts) == 3, texts
    assert d._data["count"] == 3
    assert round(d._data["total"], 3) == 2400.0


def test_summary_single_account_no_subtotals():
    a1, _a2, _a3 = _seed()
    d = _dlg(a1)
    # تصفية + بند فقط = 2 (بلا مجاميع فرعية)
    assert d.table.rowCount() == 2, d.table.rowCount()
    assert len(d._rows_export()) == 2


def test_summary_details_off_counts_rows():
    _seed()
    d = _dlg()
    d.details.setChecked(False)
    # 3 تصفيات + 3 مجاميع = 6
    assert d.table.rowCount() == 6, d.table.rowCount()
    assert len(d._rows_export()) == 6


def test_balances_tab_matches_service():
    _seed()
    d = _dlg()
    rows = lc.custody_balances()
    assert d.btable.rowCount() == len(rows) == 3
    exp = {r["account_id"]: r for r in rows}
    for i in range(3):
        name = d.btable.item(i, 0).text()
        rid = {v["account"]: k for k, v in exp.items()}[name]
        bal = float(d.btable.item(i, 3).text().replace(",", ""))
        assert abs(bal - exp[rid]["balance"]) < 0.01, (name, bal)


def test_balances_colors_negative_and_zero():
    _seed()
    d = _dlg()
    fg = {}
    for i in range(d.btable.rowCount()):
        name = d.btable.item(i, 0).text()
        fg[name.split("/")[-1].strip()] = (
            d.btable.item(i, 3).foreground().color().name())
    assert fg.get("عهدة خالد") == "#991b1b", fg  # سالب → أحمر
    assert fg.get("عهدة سارة") == "#64748b", fg  # صفر → رمادي
    # أحمد موجب → اللون الافتراضي
    assert fg.get("عهدة أحمد") not in ("#991b1b", "#64748b"), fg


def test_employee_tab_matches_ledger():
    a1, _a2, _a3 = _seed()
    d = _dlg()
    i = d.eaccount.findData(a1)
    assert i >= 0
    d.eaccount.setCurrentIndex(i)
    d._refresh_employee()
    lg = lc.custody_ledger(a1, "", "")
    assert d.etable.rowCount() == len(lg["rows"]), (
        d.etable.rowCount(), len(lg["rows"]))
    t = lg["totals"]
    assert f"{float(t['balance']):,.3f}" in d.etotal.text()
    # المطابقة مع الأرصدة لنفس الحساب
    b = [x for x in lc.custody_balances() if x["account_id"] == a1][0]
    assert abs(float(t["balance"]) - b["balance"]) < 0.01


def test_open_items_service_and_days():
    from datetime import date
    a1, _a2, _a3 = _seed()
    rows = lc.custody_open_items()
    ids = {r["account_id"] for r in rows}
    assert a1 in ids and len(rows) == 1, rows  # سارة صفر وخالد سالب
    r = rows[0]
    assert r["oldest"] == "2026-01-05", r
    assert r["days"] == (date.today() -
                         date(2026, 1, 5)).days, r
    assert abs(r["balance"] - 600.0) < 0.01
    assert r["handovers"] == 2


def test_open_tab_and_threshold():
    a1, _a2, _a3 = _seed()
    d = _dlg()
    d.ospin.setValue(0)  # بلا حد
    assert d.otable.rowCount() == 1
    assert a1 == d._odata[0]["account_id"]
    d.ospin.setValue(3650)  # عتبة مستحيلة → فارغ
    assert d.otable.rowCount() == 0
    assert d._odata == []


def test_crosscheck_totals_consistent():
    _seed()
    d = _dlg()
    bals = lc.custody_balances()
    th = sum(b["handed"] for b in bals)
    ts = sum(b["spent"] for b in bals)
    assert f"{th - ts:,.3f}" in d.btotal.text()
    # مجمع التصفيات = مجموع المُنفَق عبر الحسابات
    assert abs(d._data["total"] - ts) < 0.01


def test_pdf_generators_smoke():
    import tempfile
    _seed()
    d = _dlg()
    from reports.tabular_pdf import generate_table_pdf
    tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    tmp.close()
    generate_table_pdf("أرصدة العهد", d.BAL_HEADS, [44, 22, 22, 24, 16,
                                                    18],
                       d._balances_export(), tmp.name,
                       totals_row=["الإجمالي", 1, 2, 3, "", ""],
                       number_cols=[1, 2, 3])
    assert os.path.getsize(tmp.name) > 1000
    os.unlink(tmp.name)
    from reports.custody_pdf import generate_custody_ledger_pdf
    a1 = lc.custody_accounts()[0]["account_id"]
    lg = lc.custody_ledger(a1, "", "")
    tmp2 = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    tmp2.close()
    generate_custody_ledger_pdf(
        {"rows": lg["rows"], "totals": lg["totals"], "account_id": a1},
        tmp2.name, include_details=False)
    assert os.path.getsize(tmp2.name) > 1000
    os.unlink(tmp2.name)


def test_balances_excel_wiring():
    _seed()
    d = _dlg()
    import tempfile
    from PySide6.QtWidgets import QFileDialog
    from ui import style
    tmp = tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False)
    tmp.close()
    old_dlg = QFileDialog.getSaveFileName
    old_info = style.info
    QFileDialog.getSaveFileName = staticmethod(
        lambda *a, **k: (tmp.name, "xlsx"))
    style.info = lambda *a, **k: None
    try:
        import ui.invoices as inv
        old_open = inv.open_file_externally
        inv.open_file_externally = lambda *a, **k: None
        try:
            d._export_balances()
        finally:
            inv.open_file_externally = old_open
    finally:
        QFileDialog.getSaveFileName = old_dlg
        style.info = old_info
    assert os.path.getsize(tmp.name) > 1000
    os.unlink(tmp.name)


def test_settlements_page_has_reports_button():
    from ui.custody_settlements import CustodySettlementsPage
    from PySide6.QtWidgets import QPushButton
    pg = CustodySettlementsPage()
    btns = [b for b in pg.findChildren(QPushButton)
            if "التقارير" in b.text()]
    assert len(btns) == 1, [b.text() for b in
                            pg.findChildren(QPushButton)]
    assert btns[0].isEnabled()  # موجود ومفعّل


if __name__ == "__main__":
    import traceback
    fns = [(k, v) for k, v in sorted(globals().items())
           if k.startswith("test_") and callable(v)]
    fails = 0
    for name, fn in fns:
        try:
            fn()
            print(f"PASS {name}")
        except Exception:
            fails += 1
            print(f"FAIL {name}")
            traceback.print_exc()
    print(f"{len(fns) - fails}/{len(fns)} passed")
    os._exit(1 if fails else 0)
