# -*- coding: utf-8 -*-
"""V3.9 — الدفعة 2 (يُحدَّث في V3.12): صفحة «العهد» الموحدة + الرابط العميق.

V3.12: التنقل العلوي (تابات) بدل الجانبي + زر جانبي واحد «💰 العهد».
تغطية: التابات الثلاثة، البناء الكسول للتقارير، مزامنة الحساب،
الرابط العميق عبر النافذة الرئيسية، وبقاء الأغلفة القديمة عاملة.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import database.database as db  # noqa: E402
import services.lifecycle_service as lc  # noqa: E402

db.init_db()

from PySide6.QtWidgets import QApplication  # noqa: E402

app = QApplication.instance() or QApplication([])

from services import auth_service  # noqa: E402

_op, _oa = auth_service.has_permission, auth_service.is_admin
auth_service.has_permission = lambda *a, **k: True  # noqa: E731
auth_service.is_admin = lambda: True  # noqa: E731

_SEED_IDS: tuple = ()


def _seed():
    global _SEED_IDS
    if _SEED_IDS:
        return _SEED_IDS
    from services import expense_account_service as ea
    root = ea.add_account("العهد", None, allow_posting=False)
    a1 = ea.add_account("عهدة أحمد", root, account_kind="advance")
    a2 = ea.add_account("عهدة سارة", root, account_kind="advance")
    exp = ea.add_account("مواد", None, allow_posting=True)
    assert a1 and a2 and exp

    def _line(vd, amt, desc):
        return {"vdate": vd, "expense_account_id": exp, "party": "مورد",
                "expense_customer_id": None, "project_id": None,
                "contract_id": None, "amount": amt,
                "description": desc}

    lc.add_voucher("payment", "2026-09-01", "أحمد", "نقدًا",
                   "عهدة أحمد", 1500.0, "عهد: تسليم",
                   custody_account_id=a1)
    lc.add_custody_settlement("2026-09-02", a1,
                              [_line("2026-09-02", 900.0, "مواد")],
                              "تصفية أحمد")
    lc.add_voucher("payment", "2026-09-03", "سارة", "نقدًا",
                   "عهدة سارة", 700.0, "عهد: تسليم",
                   custody_account_id=a2)
    lc.add_custody_settlement("2026-09-04", a2,
                              [_line("2026-09-04", 700.0, "أجور")],
                              "تصفية سارة")
    _SEED_IDS = (a1, a2)
    return _SEED_IDS


def _page():
    from ui.custody_center import CustodyUnifiedPage
    return CustodyUnifiedPage()


def test_sections_and_top_tabs():
    _seed()
    pg = _page()
    labels = [pg.tabs.tabText(i) for i in range(pg.tabs.count())]
    assert labels == ["🧾  الكشف والحركات", "📑  التصفيات"], labels
    assert not hasattr(pg, "nav") and not hasattr(pg, "stack")
    assert pg._reports is None  # التقارير كسول — غير مبني بعد
    assert pg.tabs.currentWidget() is pg.ledger
    assert pg.tabs.currentIndex() == 0


def test_show_section_switches_and_builds_reports():
    _seed()
    pg = _page()
    pg.show_section("settlements")
    assert pg.tabs.currentIndex() == 1
    assert pg.tabs.currentWidget() is pg.settlements
    assert pg.settlements.table.rowCount() == 2, \
        pg.settlements.table.rowCount()
    pg.show_section("reports")
    assert pg.tabs.count() == 3
    assert pg.tabs.tabText(2) == "📊  التقارير"
    assert pg._reports is not None
    assert pg._reports.tabs.count() == 7  # V9.15: + تفصيلي + شهري + كشف عهدة
    pg.show_section("ledger")
    assert pg.tabs.currentWidget() is pg.ledger
    assert pg.ledger.table.rowCount() > 0


def test_embedded_report_button_switches_section():
    _seed()
    pg = _page()
    # V3.13: زر تقرير الكشف حُذف (التاب العلوي يكفي) — يبقى زر التصفيات.
    assert not hasattr(pg.ledger, "report_btn")
    pg.show_section("settlements")
    pg.settlements._open_reports()
    assert pg.tabs.currentWidget() is pg.reports


def test_account_sync_across_sections():
    a1, a2 = _seed()
    pg = _page()
    i = pg.ledger.account.findData(a2)
    assert i >= 0
    pg.ledger.account.setCurrentIndex(i)
    assert pg.settlements.account.currentData() == a2
    _ = pg.reports  # بناء التقارير يرث الفلتر الحالي
    assert pg.reports.account.currentData() == a2
    assert pg.reports.eaccount.currentData() == a2
    # والاتجاه العكسي
    j = pg.settlements.account.findData(a1)
    pg.settlements.account.setCurrentIndex(j)
    assert pg.ledger.account.currentData() == a1
    assert pg.reports.eaccount.currentData() == a1


def test_deep_link_via_main_window():
    _seed()
    from ui.main_window import (IDX_CUSTODY, IDX_SETTLEMENTS, MainWindow)
    w = MainWindow()
    names = [b.text() for b in w.findChildren(
        __import__("PySide6.QtWidgets", fromlist=["QPushButton"])
        .QPushButton)]
    assert any("💰  العهد" in t for t in names), names
    assert not any("📑  تصفيات العهد" in t for t in names), names
    assert w.nav_group.button(IDX_SETTLEMENTS) is None
    w._go(IDX_SETTLEMENTS)
    app.processEvents()
    assert w.stack.currentWidget() is w.custody_page
    assert w.custody_page.tabs.currentWidget() is \
        w.custody_page.settlements
    assert "تصفيات العهد" in w.crumb_lbl.text(), w.crumb_lbl.text()
    # والزر الأصلي يفتح الكشف
    w._go(IDX_CUSTODY)
    app.processEvents()
    assert w.stack.currentWidget() is w.custody_page


def test_settlements_property_and_open_in_settlements():
    _seed()
    from ui.main_window import MainWindow
    w = MainWindow()
    assert w.settlements_page is w.custody_page.settlements
    ref = w.settlements_page.table.item(0, 0).text()
    ok = w.custody_page.ledger._open_in_settlements(ref)
    assert ok is True
    assert w.settlements_page._current_ref == ref
    assert w.custody_page.tabs.currentWidget() is \
        w.custody_page.settlements


def test_legacy_wrappers_still_work():
    _seed()
    from ui.custody_center import CustodyCenterPage, \
        SettlementsReportDialog
    pg = CustodyCenterPage()
    heads = [pg.table.horizontalHeaderItem(i).text()
             for i in range(pg.table.columnCount())]
    assert "العهدة" in heads, heads
    dlg = SettlementsReportDialog(None)
    assert dlg.tabs.count() == 7  # V9.15: + تفصيلي + شهري + كشف عهدة
    assert dlg.table.columnCount() == 6


def test_refresh_runs_clean():
    _seed()
    pg = _page()
    pg.refresh()
    pg.show_section("settlements")
    pg.refresh()
    pg.show_section("reports")
    pg.refresh()


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
    auth_service.has_permission, auth_service.is_admin = _op, _oa
    print(f"{len(fns) - fails}/{len(fns)} passed")
    os._exit(1 if fails else 0)
