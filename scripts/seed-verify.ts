/**
 * زرع بيانات تحقق محلية (SQLite) — لأغراض فحص التخطيط فقط، لا علاقة له بالإنتاج.
 * تشغيل: DATABASE_URL="file:./db/verify.db" bun scripts/seed-verify.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const T = "2026-10-21"; // اليوم
const D = (offset: number) => {
  const d = new Date(`${T}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

async function main() {
  // تنظيف كامل (ترتيب الأبناء قبل الآباء)
  await db.$transaction([
    db.transferOpAlloc.deleteMany(), db.gatewayFeeVoucher.deleteMany(), db.gatewayOp.deleteMany(),
    db.bankLine.deleteMany(), db.otherCompanyTransfer.deleteMany(), db.otherCompanyOpening.deleteMany(),
    db.subPaymentSource.deleteMany(), db.subPaymentPlanItem.deleteMany(), db.subContractItem.deleteMany(),
    db.subContract.deleteMany(), db.subcontractor.deleteMany(),
    db.voucherPaymentLink.deleteMany(), db.claim.deleteMany(), db.addendumItem.deleteMany(), db.addendum.deleteMany(),
    db.paymentPlanItem.deleteMany(), db.boqItem.deleteMany(), db.contractStage.deleteMany(),
    db.voucher.deleteMany(), db.contractAttachment.deleteMany(), db.invoice.deleteMany(),
    db.contractEvent.deleteMany(), db.stageNote.deleteMany(), db.txMessage.deleteMany(), db.comment.deleteMany(),
    db.task.deleteMany(), db.visit.deleteMany(), db.visitStaff.deleteMany(),
    db.contractComponent.deleteMany(), db.entityBackup.deleteMany(), db.stageMove.deleteMany(),
    db.appNotification.deleteMany(), db.transactionParticipant.deleteMany(), db.dismissedAlert.deleteMany(),
    db.contractGroupItem.deleteMany(), db.contractGroup.deleteMany(),
    db.typePaymentStage.deleteMany(), db.typePaymentTemplate.deleteMany(), db.typeBundleComponent.deleteMany(),
    db.contractType.deleteMany(), db.contractScope.deleteMany(), db.workflowStage.deleteMany(),
    db.auditLog.deleteMany(), db.journalEntry.deleteMany(), db.matchAlias.deleteMany(), db.numberSequence.deleteMany(),
    db.userPermission.deleteMany(), db.contract.deleteMany(), db.customer.deleteMany(),
    db.employee.deleteMany(), db.expenseAccount.deleteMany(), db.paymentMethod.deleteMany(),
    db.gatewayProfile.deleteMany(), db.formField.deleteMany(), db.formDocument.deleteMany(),
    db.formTemplate.deleteMany(), db.formCategory.deleteMany(),
    db.setting.deleteMany(), db.user.deleteMany(),
  ]);

  // ===== إعدادات ومستخدمون ومرجعيات =====
  await db.setting.create({ data: { id: 1, companyName: "مؤسسة البناء الحديث للتجارة والمقاولات", companyPhone: "+965 22334455", currency: "د.ك" } });
  await db.user.create({ data: { id: 1, username: "developer", passwordHash: "x", salt: "x", role: "developer", fullName: "المطور", jobTitle: "مدير النظام" } });
  await db.user.create({ data: { id: 2, username: "raheem", passwordHash: "x", salt: "x", role: "admin", fullName: "رشدي لبافة", jobTitle: "مدير الحسابات" } });
  await db.paymentMethod.createMany({ data: [
    { name: "نقدي", feeType: "amount", feeValue: "0" },
    { name: "تحويل بنكي", feeType: "amount", feeValue: "0.150" },
    { name: "KNET", feeType: "amount", feeValue: "0.100" },
  ]});
  const accMain = await db.expenseAccount.create({ data: { name: "مصروفات عامة", fullPath: "مصروفات عامة" } });
  await db.expenseAccount.create({ data: { name: "كهرباء ومياه", fullPath: "مصروفات عامة/كهرباء ومياه", parentId: accMain.id } });
  await db.expenseAccount.create({ data: { name: "عهدة عامة", fullPath: "عهدة عامة", accountKind: "advance", allowPosting: false } });
  await db.expenseAccount.create({ data: { name: "رواتب", fullPath: "رواتب" } });

  await db.contractType.createMany({ data: [
    { name: "اشراف شهري", notes: "إشراف هندسي شهري على المشاريع", isSupervision: true, pricingMode: "unit", unitLabel: "شهر", unitPrice: "450" },
    { name: "تشطيبات", notes: "أعمال تشطيب وتجهيز داخلي", pricingMode: "lump" },
  ]});

  // ===== العملاء والعقود =====
  const customers = await Promise.all([
    db.customer.create({ data: { customerCode: "CUS-0001", name: "شركة الوفاء للتجارة", phone: "+965 99112233", governorate: "العاصمة", area: "الشامية", address: "شارع العراق، مجمع الوفاء" } }),
    db.customer.create({ data: { customerCode: "CUS-0002", name: "عبدالله ناصر المطر", phone: "+965 94455667", governorate: "حولي", area: "السالمية", address: "قطعة 12، شارع المغرب" } }),
    db.customer.create({ data: { customerCode: "CUS-0003", name: "مجموعة الأفق العقارية", phone: "+965 97788990", governorate: "الفروانية", area: "الفروانية", address: "السوق المغطى، الدور الثاني" } }),
    db.customer.create({ data: { customerCode: "CUS-0004", name: "فهد سليمان الدوسري", phone: "+965 90011223", governorate: "الأحمدي", area: "الفحيحيل", address: "قطعة 45، شارع الخليج" } }),
    db.customer.create({ data: { customerCode: "CUS-0005", name: "مؤسسة النخيل للمقاولات", phone: "+965 98223344", governorate: "الجهراء", area: "الجهراء", address: "المنطقة الصناعية" } }),
    db.customer.create({ data: { customerCode: "CUS-0006", name: "ماجد علي الشمري", phone: "+965 95566778", governorate: "مبارك الكبير", area: "المسيلة", address: "قطعة 8، شارع 12" } }),
  ]);
  const C = customers.map((c) => c.id);

  const contractData = [
    { contractNumber: "CON-0001", contractName: "إشراف هندسي على مجمع الوفاء التجاري", customerId: C[0], contractDate: D(-300), signDate: D(-295), startDate: D(-290), endDate: D(-60), amount: "5400", contractType: "اشراف شهري", status: "نشط", supStartDate: D(-290), supMonths: 12, supMonthly: "450" },
    { contractNumber: "CON-0002", contractName: "تشطيب فيلا السالمية — المرحلة الثانية", customerId: C[1], contractDate: D(-180), signDate: D(-178), startDate: D(-170), endDate: D(-30), amount: "18500", contractType: "تشطيبات", status: "نشط" },
    { contractNumber: "CON-0003", contractName: "صيانة دورية لمبنى الأفق — عقد سنوي", customerId: C[2], contractDate: D(-120), signDate: D(-118), startDate: D(-110), amount: "7800", contractType: "اشراف شهري", status: "نشط", supStartDate: D(-110), supMonths: 6, supMonthly: "1300" },
    { contractNumber: "CON-0004", contractName: "توريد وتركيب واجهات زجاجية", customerId: C[3], contractDate: D(-90), signDate: D(-88), startDate: D(-80), amount: "9250", contractType: "تشطيبات", status: "نشط" },
    { contractNumber: "CON-0005", contractName: "تجهيز مخزن النخيل — بند إضافي", customerId: C[4], contractDate: D(-40), amount: "3500", status: "مسودة" },
    { contractNumber: "CON-0006", contractName: "تعديلات مكاتب مجموعة الأفق", customerId: C[2], contractDate: D(-250), signDate: D(-248), startDate: D(-240), endDate: D(-120), amount: "6100", contractType: "تشطيبات", status: "منتهي" },
  ];
  const contracts = [];
  for (const cd of contractData) contracts.push(await db.contract.create({ data: cd }));
  const [K1, K2, K3, K4] = contracts.map((c) => c.id);

  // مراحل العقد 1 (إشراف) والعقد 2 (إنشائية بثلاث مراحل)
  const stSup = await db.contractStage.create({ data: { contractId: K1, name: "بدء الإشراف", level: 1, sortOrder: 1, startDate: D(-290), endDate: D(-290), isSupervision: true, supStart: D(-290), supEnd: D(75), supMonthly: "450", payKind: "", payPct: "0" } });
  const st1 = await db.contractStage.create({ data: { contractId: K2, name: "أعمال الحفر والأساسات", level: 1, sortOrder: 1, expectedDays: 20, startDate: D(-170), endDate: D(-150), payKind: "achieve", payPct: "30" } });
  const st2 = await db.contractStage.create({ data: { contractId: K2, name: "الهيكل الخرساني", level: 1, sortOrder: 2, expectedDays: 45, startDate: D(-150), payKind: "achieve", payPct: "40" } });
  const st3 = await db.contractStage.create({ data: { contractId: K2, name: "التشطيبات النهائية", level: 1, sortOrder: 3, expectedDays: 60, payKind: "final", payPct: "30" } });

  // خطة دفعات: مستحقة سابقة + مستحقة اليوم + قادمة
  await db.paymentPlanItem.createMany({ data: [
    { contractId: K1, title: "دفعة إشراف — الشهر 1", dueDate: D(-260), amount: "450", sortOrder: 1, triggeredAt: D(-260), stageId: stSup.id },
    { contractId: K1, title: "دفعة إشراف — الشهر 8", dueDate: D(-50), amount: "450", sortOrder: 2, triggeredAt: D(-50), stageId: stSup.id },
    { contractId: K1, title: "دفعة إشراف — الشهر 9", dueDate: D(-20), amount: "450", sortOrder: 3, triggeredAt: D(-20), stageId: stSup.id },
    { contractId: K2, title: "دفعة الأساسات 30%", dueDate: D(-150), amount: "5550", sortOrder: 1, triggeredAt: D(-150), stageId: st1.id },
    { contractId: K2, title: "دفعة الهيكل 40%", dueDate: T, amount: "7400", sortOrder: 2, stageId: st2.id },
    { contractId: K2, title: "دفعة التسليم النهائي 30%", dueDate: D(45), amount: "5550", sortOrder: 3, stageId: st3.id },
    { contractId: K3, title: "دفعة إشراف 1", dueDate: D(-80), amount: "1300", sortOrder: 1, triggeredAt: D(-80) },
    { contractId: K3, title: "دفعة إشراف 2", dueDate: D(-50), amount: "1300", sortOrder: 2, triggeredAt: D(-50) },
    { contractId: K3, title: "دفعة إشراف 3", dueDate: D(-20), amount: "1300", sortOrder: 3, triggeredAt: D(-20) },
    { contractId: K4, title: "مقدم توريد 25%", dueDate: D(-78), amount: "2312.5", sortOrder: 1, triggeredAt: D(-78) },
    { contractId: K4, title: "دفعة التركيب 50%", dueDate: D(10), amount: "4625", sortOrder: 2 },
    { contractId: K4, title: "دفعة الإغلاق 25%", dueDate: D(40), amount: "2312.5", sortOrder: 3 },
  ]});

  // ===== السندات (قبض على العقود + صرف على الباطن + مصروفات) =====
  await db.voucher.createMany({ data: [
    { voucherNumber: "RV-0001", vtype: "receipt", vdate: D(-150), party: "شركة الوفاء للتجارة", partyType: "customer", partyId: C[0], method: "تحويل بنكي", amount: "1350", contractId: K1, description: "دفعة إشراف شهر 1-3" },
    { voucherNumber: "RV-0002", vtype: "receipt", vdate: D(-149), amount: "5550", party: "عبدالله ناصر المطر", partyType: "customer", partyId: C[1], method: "KNET", contractId: K2, description: "دفعة الأساسات 30%" },
    { voucherNumber: "RV-0003", vtype: "receipt", vdate: D(-48), amount: "1300", party: "مجموعة الأفق العقارية", partyType: "customer", partyId: C[2], method: "نقدي", contractId: K3, description: "دفعة إشراف 1" },
    { voucherNumber: "RV-0004", vtype: "receipt", vdate: D(-77), amount: "2312.5", party: "فهد سليمان الدوسري", partyType: "customer", partyId: C[3], method: "تحويل بنكي", contractId: K4, description: "مقدم توريد 25%" },
    { voucherNumber: "PV-0001", vtype: "payment", vdate: D(-140), party: "امير المصري", partyType: "subcontractor", method: "تحويل بنكي", amount: "1000", contractId: K2, description: "صرف على أعمال الحفر" },
    { voucherNumber: "PV-0002", vtype: "payment", vdate: D(-60), party: "امير المصري", partyType: "subcontractor", method: "نقدي", amount: "250", contractId: K2, description: "صرف على أعمال الحفر" },
    { voucherNumber: "PV-0003", vtype: "payment", vdate: D(-30), party: "مصروفات تشغيلية", method: "نقدي", amount: "85.5", expenseAccountId: accMain.id, description: "مياه وكهرباء الموقع" },
  ]});

  // ===== الباطن =====
  const sub1 = await db.subcontractor.create({ data: { subCode: "SUBC-0001", name: "امير المصري", phone: "+965 91122334", activity: "أعمال مدنية" } });
  const sub2 = await db.subcontractor.create({ data: { subCode: "SUBC-0002", name: "مقاول كهرباء", phone: "+965 93344556", activity: "كهرباء" } });
  const sc1 = await db.subContract.create({ data: { subcontractorId: sub1.id, contractId: K2, description: "أعمال الحفر والأساسات", amount: "18250", status: "نشط", startDate: D(-165) } });
  await db.subContractItem.createMany({ data: [
    { subContractId: sc1.id, sourceKind: "manual", qty: "1", unitPrice: "3200", amount: "3200" },
    { subContractId: sc1.id, sourceKind: "manual", qty: "1", unitPrice: "15050", amount: "15050" },
  ]});
  await db.subPaymentPlanItem.createMany({ data: [
    { subContractId: sc1.id, title: "دفعة باطن 1 — عند انتهاء الحفر", dueDate: D(-150), amount: "10000", sortOrder: 1, triggeredAt: D(-150) },
    { subContractId: sc1.id, title: "دفعة باطن 2 — عند صب الهيكل", dueDate: D(20), amount: "8250", sortOrder: 2 },
  ]});
  const sc2 = await db.subContract.create({ data: { subcontractorId: sub2.id, contractId: K4, description: "تمديدات كهرباء الواجهات", amount: "3100", status: "نشط", startDate: D(-75) } });
  await db.subPaymentPlanItem.createMany({ data: [
    { subContractId: sc2.id, title: "دفعة كهرباء 50%", dueDate: D(-20), amount: "1550", sortOrder: 1, triggeredAt: D(-20) },
  ]});

  // ===== البوابة والشركة الأخرى =====
  await db.gatewayProfile.create({ data: { name: "KNET الرئيسي", bankAccount: "بنك بيت التمويل — جاري 001122", methods: "KNET", lagDays: 1, feeFixed: "0.100" } });
  await db.gatewayOp.createMany({ data: [
    { gateway: "KNET الرئيسي", opDate: D(-2), phone: "99112233", amount: "450", ref: "KW0090121", status: "mine", receiptNo: "RV-0005", customer: "شركة الوفاء للتجارة", distributed: true, distributedAt: D(-1), gwPaid: 1, gwPaidDate: D(-1), effectiveDate: D(-1) },
    { gateway: "KNET الرئيسي", opDate: D(-1), phone: "94455667", amount: "1200", ref: "KW0090188", status: "mine", receiptNo: "RV-0006", customer: "عبدالله ناصر المطر", gwPaid: 0 },
    { gateway: "KNET الرئيسي", opDate: D(-1), phone: "90011223", amount: "310.5", ref: "KW0090201", status: "unmarked" },
  ]});
  await db.otherCompanyOpening.create({ data: { amount: "250", note: "رصيد افتتاحي للشركة الأخرى" } });
  await db.otherCompanyTransfer.createMany({ data: [
    { tdate: D(-2), amount: "405", ref: "TR-0001", method: "تحويل بنكي", notes: "تسديد صافي عمولة الأسبوع" },
    { tdate: D(-9), amount: "612.25", ref: "TR-0002", method: "تحويل بنكي" },
    { tdate: D(-16), amount: "590", ref: "TR-0003", method: "KNET" },
  ]});
  await db.bankLine.createMany({ data: [
    { bankAccount: "بنك بيت التمويل — جاري 001122", cdate: D(-1), amount: "1200", descr: "إيداع KNET KW0090188" },
    { bankAccount: "بنك بيت التمويل — جاري 001122", cdate: D(-2), amount: "450", descr: "إيداع KNET KW0090121" },
    { bankAccount: "بنك بيت التمويل — جاري 001122", cdate: D(-30), amount: "-85.5", descr: "مصروف موقع" },
  ]});

  // ===== رسائل وإشعارات وملاحظات =====
  await db.txMessage.createMany({ data: [
    { contractId: K2, username: "raheem", body: "الرجاء تحديث نسبة إنجاز الهيكل الخرساني قبل زيارة الأسبوع القادم." },
    { contractId: K2, username: "developer", body: "تم — سأرفع التقرير مساء اليوم." },
  ]});
  await db.appNotification.createMany({ data: [
    { userId: 1, transactionType: "contract", transactionId: K2, type: "new_message", text: "رسالة جديدة على عقد تشطيب فيلا السالمية من رشدي لبافة", isRead: false },
    { userId: 1, transactionType: "contract", transactionId: K3, type: "stage_change", text: "العقد CON-0003 — دفعة إشراف 3 أصبحت مستحقة", isRead: false },
  ]});
  await db.contractEvent.createMany({ data: [
    { contractId: K2, eventType: "إنشاء العقد", username: "developer", description: "" },
    { contractId: K2, eventType: "بدء مرحلة", username: "developer", description: "الهيكل الخرساني" },
  ]});

  const counts = {
    users: await db.user.count(), customers: await db.customer.count(), contracts: await db.contract.count(),
    stages: await db.contractStage.count(), plan: await db.paymentPlanItem.count(), vouchers: await db.voucher.count(),
    subs: await db.subContract.count(), ops: await db.gatewayOp.count(), transfers: await db.otherCompanyTransfer.count(),
  };
  console.log("✓ زرعت البيانات:", JSON.stringify(counts));
}

main()
  .catch((e) => { console.error("✗", e); process.exit(1); })
  .finally(() => db.$disconnect());
