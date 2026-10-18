# -*- coding: utf-8 -*-
"""اختبار الصلاحيات الدقيقة لكل مستخدم (Granular Permissions).

يغطي:
  • سلامة كتالوج الصلاحيات (مفاتيح فريدة ومجموعات معروفة).
  • افتراضيات الأدوار: المدير/المطور = الكل · السكرتير = العمل اليومي
    (نفس سلوك النظام قبل الميزة: التقارير المالية والتعديل والإلغاء
    والحذف مقفولة).
  • حفظ/قراءة/تصفير تخصيص موظف (user_permissions).
  • has_permission للجلسة الحالية مع تبديل المستخدم.
  • التقارير المرئية لكل مستخدم (visible_reports).
  • حارس التنقل: صفحة لا يملكها المستخدم لا تُفتح (PAGE_PERMS).
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# قاعدة بيانات مؤقتة للاختبار
import database.database as db
_tmpdir = tempfile.mkdtemp()
db.DATA_DIR = _tmpdir
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")

from database.database import init_db
from services import auth_service

PASS, FAIL = 0, 0


def check(name: str, condition: bool, detail: str = ""):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


print("=== تهيئة قاعدة البيانات ===")
init_db()
auth_service.ensure_default_user()
check("إنشاء الجداول والمستخدم الافتراضي", True)

print("\n=== 1. سلامة كتالوج الصلاحيات ===")
P = auth_service.PERMISSIONS
check("الكتالوج غير فارغ", len(P) >= 20, f"got {len(P)}")
check("المفاتيح فريدة", len(P) == len(set(P)))
groups = {spec["group"] for spec in P.values()}
check("ثلاث مجموعات فقط: شاشات/تقارير/إجراءات",
      groups == {"الشاشات", "التقارير", "الإجراءات"}, f"got {groups}")
check("كل صلاحية لها اسم ووصف ومجموعة",
      all(spec.get("name") and spec.get("desc") and spec.get("group")
          for spec in P.values()))
# كل مفاتيح التقارير موجودة في الكتالوج
for k in ("rep_customers", "rep_supervision_delay", "rep_subcontractors",
          "rep_customer_profitability", "rep_expenses", "rep_vouchers", "rep_contracts",
          "rep_cashflow", "rep_leads", "rep_execution", "rep_journal"):
    check(f"تأشيرة تقرير: {k}", k in P)

print("\n=== 2. افتراضيات الأدوار ===")
admin_defs = auth_service.role_perm_defaults(auth_service.ROLE_ADMIN)
dev_defs = auth_service.role_perm_defaults(auth_service.ROLE_DEVELOPER)
sec_defs = auth_service.role_perm_defaults(auth_service.ROLE_SECRETARY)
check("المدير: كل الصلاحيات", all(admin_defs.values()))
check("المطور: كل الصلاحيات", all(dev_defs.values()))
# السكرتير: العمل اليومي = نفس سلوك النظام القديم بالضبط
check("السكرتير يرى شاشة العملاء", sec_defs["screen_customers"])
check("السكرتير يرى سندات القبض والصرف",
      sec_defs["screen_receipts"] and sec_defs["screen_payments"])
check("السكرتير ينشئ السندات",
      sec_defs["action_add_receipt"] and sec_defs["action_add_payment"])
check("السكرتير يرى تعديل السندات مع اعتماد المدير", sec_defs["action_edit_voucher"])
check("تعديل بيان السند فقط مسار احتياطي غير مكرر افتراضيًا", not sec_defs["action_edit_voucher_description"])
check("السكرتير ممنوع من إلغاء السندات",
      not sec_defs["action_cancel_voucher"])
check("السكرتير ممنوع من الحذف", not sec_defs["action_delete"])
check("السكرتير ممنوع من تغيير حالة العقد",
      not sec_defs["action_change_status"])
check("السكرتير ممنوع من رؤية الربحية",
      not sec_defs["action_view_financial"])
check("السكرتير ممنوع من تقرير العملاء والأرصدة",
      not sec_defs["rep_customers"])
check("السكرتير ممنوع من حركة السندات", not sec_defs["rep_vouchers"])
check("السكرتير ممنوع من التقرير المالي", not sec_defs["rep_cashflow"])
check("السكرتير ممنوع من ربحية العميل", not sec_defs["rep_customer_profitability"])
check("السكرتير يرى تقرير العقود", sec_defs["rep_contracts"])
check("السكرتير يرى تقرير تأخير الإشراف",
      sec_defs["rep_supervision_delay"])
check("السكرتير يرى لوحة مستحقات الباطن",
      sec_defs["rep_dues_board"])
check("السكرتير يطبع كشف الحساب", sec_defs["action_print_statement"])
check("السكرتير يرسل واتساب", sec_defs["action_whatsapp"])

print("\n=== 3. إنشاء مستخدمين ===")
sec_id = auth_service.add_user("ahmed", "1234",
                               auth_service.ROLE_SECRETARY,
                               full_name="أحمد السكرتير")
sec_user = auth_service.get_user("ahmed")
check("إنشاء سكرتير", sec_id > 0 and sec_user is not None)
check("دوره سكرتير", auth_service.user_role(sec_id) == "secretary")
check("لا تخصيص محفوظ بعد", not auth_service.user_is_customized(sec_id))

print("\n=== 4. has_permission حسب المستخدم الحالي ===")
# المدير الافتراضي (admin) — لم نسجل دخوله: الدور الافتراضي مدير
check("المدير: صلاحية أي شيء", auth_service.has_permission("rep_cashflow")
      and auth_service.has_permission("action_delete"))

# تسجيل دخول السكرتير
auth_service.set_current_user("ahmed")
check("السكرتير: ممنوع التقرير المالي",
      not auth_service.has_permission("rep_cashflow"))
check("السكرتير: يرى شاشة التقارير",
      auth_service.has_permission("screen_reports"))
check("السكرتير: ممنوع إلغاء السندات",
      not auth_service.has_permission("action_cancel_voucher"))
check("مفتاح غير معروف لا يقيّد (توافق قديم)",
      auth_service.has_permission("key_not_in_catalog"))

# العودة للمدير
auth_service.set_current_user("admin")
check("العودة للمدير: كل الصلاحيات",
      auth_service.has_permission("rep_cashflow"))

print("\n=== 5. حفظ وقراءة تخصيص موظف ===")
# منح السكرتير تقرير العملاء والأرصدة ومنعه من شاشة مقاولي الباطن
custom = dict(sec_defs)
custom["rep_customers"] = True
custom["screen_subcontractors"] = False
custom["action_cancel_voucher"] = True
auth_service.set_user_perms(sec_id, custom)
check("التخصيص محفوظ", auth_service.user_is_customized(sec_id))
loaded = auth_service.get_user_perms(sec_id, "secretary")
check("قراءة المنح: تقرير العملاء والأرصدة", loaded["rep_customers"])
check("قراءة المنع: شاشة مقاولي الباطن",
      not loaded["screen_subcontractors"])
check("قراءة المنح: إلغاء السندات", loaded["action_cancel_voucher"])
check("باقي التأشيرات كما هي", loaded["rep_leads"]
      and loaded["screen_customers"])

# التخصيص يسري على الجلسة فورًا بعد الدخول
auth_service.set_current_user("ahmed")
check("السكرتير المخصص: صار يرى تقرير العملاء والأرصدة",
      auth_service.has_permission("rep_customers"))
check("السكرتير المخصص: صار يلغي السندات",
      auth_service.has_permission("action_cancel_voucher"))
check("السكرتير المخصص: ممنوع من شاشة مقاولي الباطن",
      not auth_service.has_permission("screen_subcontractors"))

print("\n=== 6. التقارير المرئية لكل مستخدم ===")
from ui.reports_page import visible_reports, _REPORTS


def report_keys():
    return {r["key"] for r in visible_reports()}


auth_service.set_current_user("admin")
admin_keys = report_keys()
check("المدير يرى التقارير الأحد عشر",
      admin_keys == {"rep_customers",
                     "rep_supervision_delay",
                     "rep_subcontractors", "rep_dues_board",
                     "rep_expenses", "rep_vouchers", "rep_contracts", "rep_cashflow",
                     "rep_leads", "rep_execution", "rep_journal"},
      f"got {admin_keys}")
auth_service.set_current_user("ahmed")
sec_keys = report_keys()
check("السكرتير المخصص يرى تقرير العملاء والأرصدة", "rep_customers" in sec_keys)
check("السكرتير المخصص لا يزال ممنوعًا من التقرير المالي",
      "rep_cashflow" not in sec_keys)

# تصفير التخصيص يعيد افتراضيات الدور
auth_service.reset_user_perms(sec_id)
check("التصفير: لا تخصيص محفوظ",
      not auth_service.user_is_customized(sec_id))
auth_service.set_current_user("ahmed")
sec_keys2 = report_keys()
check("بعد التصفير: لا تقرير عملاء وأرصدة", "rep_customers" not in sec_keys2)
check("بعد التصفير: يرى 6 تقارير (الافتراضية للأدوار)",
      len(sec_keys2) == 6, f"got {len(sec_keys2)}: {sec_keys2}")

print("\n=== 7. حارس التنقل (PAGE_PERMS) ===")
from ui.main_window import PAGE_PERMS, IDX_REPORTS, IDX_SETTINGS, IDX_SUBS, IDX_GATEWAY, IDX_CLAIMS
# صفحات محروسة بالصلاحيات فقط؛ الرئيسية لا تحتاج مفتاح صلاحية مستقل.
check("كل صفحة لها مفتاح صلاحية", len(PAGE_PERMS) == 14,  # V4.47
      str(len(PAGE_PERMS)))
check("كل مفاتيح الحارس موجودة في الكتالوج",
      all(v in P for v in PAGE_PERMS.values()))
check("صفحة التقارير ← screen_reports",
      PAGE_PERMS[IDX_REPORTS] == "screen_reports")
check("صفحة مطابقة البوابة ← screen_gateway",  # V3.27
      PAGE_PERMS[IDX_GATEWAY] == "screen_gateway")
check("صفحة المطالبات ← screen_claims",  # V4.47
      PAGE_PERMS[IDX_CLAIMS] == "screen_claims")


print("\n=== 8. بوابة require_admin تحترم التأشيرة ===")
from PySide6.QtWidgets import QApplication, QDialog
_app = QApplication.instance() or QApplication(sys.argv)
from ui import style
# سكرتير بلا تأشيرة إلغاء: البوابة تفتح نافذة كلمة المرور — نختبر
# فقط مسار «صاحب التأشيرة يمر بلا نافذة» حتى لا يعلق الاختبار
auth_service.set_current_user("admin")
check("require_admin للمدير: يمر مباشرة",
      style.require_admin(None, "اختبار", perm="action_delete"))
# سكرتير مُنح التأشيرة يمر مباشرة بلا نافذة
auth_service.set_user_perms(sec_id, {**sec_defs,
                                     "action_delete": True})
auth_service.set_current_user("ahmed")
check("require_admin لصاحب التأشيرة: يمر بلا نافذة",
      style.require_admin(None, "اختبار", perm="action_delete"))
auth_service.reset_user_perms(sec_id)

print("\n=== 9. نافذة صلاحيات الموظف (بناء + تأشير) ===")
from PySide6.QtCore import Qt
from ui.settings import UserPermsDialog
auth_service.set_current_user("admin")
sec_user = auth_service.get_user("ahmed")
dlg = UserPermsDialog(sec_user)
boxes = dlg._boxes
check("عدد التأشيرات = عدد الكتالوج", len(boxes) == len(P))
check("افتراضي الدور: التأشيرات معطلة",
      not any(cb.isEnabled() for cb in boxes.values()))
dlg.mode.setCurrentIndex(1)   # تخصيص
check("وضع التخصيص: التأشيرات مفعلة مع تعطيل البيان فقط عند وجود تعديل كامل",
      all(cb.isEnabled() or k == "action_edit_voucher_description"
          for k, cb in boxes.items()))
check("التأشيرات الابتدائية = افتراضيات الدور",
      all(boxes[k].isChecked() == bool(sec_defs[k]) for k in boxes))
boxes["rep_cashflow"].setChecked(True)
boxes["screen_customers"].setChecked(False)
dlg._save()
check("الحفظ من النافذة قَبِل", dlg.result() == QDialog.Accepted)
check("التخصيص من النافذة محفوظ", auth_service.user_is_customized(sec_id))
loaded2 = auth_service.get_user_perms(sec_id, "secretary")
check("منح التقرير المالي من النافذة", loaded2["rep_cashflow"])
check("منع شاشة العملاء من النافذة", not loaded2["screen_customers"])
auth_service.reset_user_perms(sec_id)
check("تصفير نهائي", not auth_service.user_is_customized(sec_id))

print("\n=== 10. حراسة المداخل المباشرة (بحث شامل · أنشطة · جرس) ===")
# سكرتير ممنوع من شاشة العملاء والإعدادات: المسارات التي تفتح
# الشاشات مباشرة (بلا زر تنقل) يجب أن تُحرس هي الأخرى.
auth_service.set_user_perms(
    sec_id, {**sec_defs, "screen_customers": False,
             "screen_settings": False, "screen_subcontractors": False})
auth_service.set_current_user("ahmed")
from ui.main_window import MainWindow, IDX_SETTINGS
w = MainWindow()

# 1) ملف العميل: الحارس يمنع قبل أي بحث أو بناء صفحة
w.open_customer_page(1)
check("فتح ملف العميل محجوب", w.customer_file_page is None)

# 2) الأنشطة من الرئيسية: مركز العقد محجوب — مركز العقد صفحة داخلية
# الآن (ContractHubPage) فالمسبار يرصد استدعاء load_contract
opened = []
import ui.contract_hub as _ch
from ui.main_window import IDX_CONTRACT_HUB
_real_load = _ch.ContractHubPage.load_contract


def _probe_load(self, contract_id, open_page="dashboard"):
    opened.append(contract_id)


_ch.ContractHubPage.load_contract = _probe_load
w._open_activity_source(7, 0)
check("مركز العقد من أنشطة الرئيسية محجوب", not opened)

# 3) البحث الشامل: كل الأنواع المحجوبة لا تفتح شيئًا
w._open_search_result("customer", 1)
check("نتيجة بحث العميل محجوبة",
      not opened and w.customer_file_page is None)
w._open_search_result("contract", 1)
w._open_search_result("invoice", 1)
w._open_search_result("subcontractor", 1)
check("نتائج بحث العقد/الفاتورة/المقاول محجوبة", not opened)

# 4) الإعدادات من شارة المستخدم محجوبة
w._open_settings_security()
check("الإعدادات من شارة المستخدم محجوبة",
      w.stack.currentIndex() != IDX_SETTINGS)

# 5) جرس المتابعة: معاملة عقد محجوبة
w._open_notification_target({"transaction_type": "contract",
                             "transaction_id": 1})
check("معاملة العقد من الجرس محجوبة", not opened)

# عودة الصلاحيات: التحقق من المنح نفسه تم في الأقسام السابقة، ونتجنب فتح مركز عقد فعليًا داخل اختبار الصلاحيات حتى لا تعلق واجهة Qt في بيئة offscreen.
_ch.ContractHubPage.load_contract = _real_load
auth_service.reset_user_perms(sec_id)

print(f"\n{'='*40}\nالنتيجة: نجح {PASS} / فشل {FAIL}")
import os as _os
_os._exit(1 if FAIL else 0)
