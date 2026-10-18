// ============================================================
// ConTrack Online — بذور البيانات التجريبية (Phase 1)
// نفس خوارزمية auth_service.py: PBKDF2-HMAC-SHA256 (200000)
// ============================================================
import { PrismaClient } from "@prisma/client";
import { randomBytes, pbkdf2Sync } from "crypto";

const prisma = new PrismaClient();

function hashPassword(password: string, saltHex: string) {
  return pbkdf2Sync(password, Buffer.from(saltHex, "hex"), 200_000, 32, "sha256").toString("hex");
}
function makeUser(username: string, password: string, role: string, fullName: string, jobTitle: string) {
  const salt = randomBytes(16).toString("hex");
  return { username, salt, passwordHash: hashPassword(password, salt), role, fullName, jobTitle };
}
const D = (s: string) => new Date(s + "T12:00:00.000Z");

async function main() {
  console.log("🧹 تنظيف البيانات القديمة...");
  await prisma.$transaction([
    prisma.voucherPaymentLink.deleteMany(),
    prisma.voucher.deleteMany(),
    prisma.subPaymentSource.deleteMany(),
    prisma.subPaymentPlan.deleteMany(),
    prisma.subContractItem.deleteMany(),
    prisma.subContract.deleteMany(),
    prisma.subcontractor.deleteMany(),
    prisma.contractEvent.deleteMany(),
    prisma.paymentPlan.deleteMany(),
    prisma.boqItem.deleteMany(),
    prisma.contractStage.deleteMany(),
    prisma.contractComponent.deleteMany(),
    prisma.contract.deleteMany(),
    prisma.customer.deleteMany(),
    prisma.typePaymentStage.deleteMany(),
    prisma.typePaymentTpl.deleteMany(),
    prisma.typeBundleComponent.deleteMany(),
    prisma.workflowStage.deleteMany(),
    prisma.contractType.deleteMany(),
    prisma.expenseAccount.deleteMany(),
    prisma.employee.deleteMany(),
    prisma.paymentMethod.deleteMany(),
    prisma.numberSequence.deleteMany(),
    prisma.userPermission.deleteMany(),
    prisma.user.deleteMany(),
    prisma.settings.deleteMany(),
  ]);

  console.log("⚙️ الإعدادات والمستخدمون...");
  await prisma.settings.create({
    data: {
      companyName: "مؤسسة الإنشاءات المتقدمة",
      companyAddress: "الدور الثاني، مبنى 12، شارع Fahd Al-Salem، مدينة الكويت",
      companyPhone: "+965 2222 3333",
      companyEmail: "info@advanced-kw.com",
      headerTitle: "نظام إدارة العقود والمحاسبة",
      currency: "د.ك",
      openingBalanceBank: 12500,
      openingBalanceCash: 3000,
    },
  });
  await prisma.user.createMany({
    data: [
      makeUser("admin", "admin", "admin", "المدير العام", "مدير"),
      makeUser("secretary", "1234", "secretary", "سارة العجمي", "سكرتير"),
    ],
  });

  console.log("💳 طرق الدفع وشجرة الحسابات والموظفون...");
  await prisma.paymentMethod.createMany({
    data: [
      { name: "نقدًا", feeType: "amount", feeValue: 0 },
      { name: "تحويل بنكي", feeType: "amount", feeValue: 0.15 },
      { name: "KNET", feeType: "percent", feeValue: 1.5 },
      { name: "شيك", feeType: "amount", feeValue: 0 },
      { name: "أخرى", feeType: "amount", feeValue: 0 },
    ],
  });
  const expRoot = await prisma.expenseAccount.create({ data: { name: "مصروفات عامة", fullPath: "مصروفات عامة" } });
  const expGroups: Record<string, { id: number }> = {};
  for (const [i, g] of ["رواتب وأجور", "إيجارات", "وقود ومحروقات", "صيانة ونظافة", "رسوم حكومية"].entries()) {
    expGroups[g] = await prisma.expenseAccount.create({
      data: { parentId: expRoot.id, name: g, fullPath: `مصروفات عامة / ${g}`, sortOrder: i },
    });
  }
  const custodyRoot = await prisma.expenseAccount.create({
    data: { name: "عهد الموظفين", fullPath: "عهد الموظفين", accountKind: "advance" },
  });
  const custAhmad = await prisma.expenseAccount.create({
    data: { parentId: custodyRoot.id, name: "عهدة: أحمد الشمري", fullPath: "عهد الموظفين / عهدة: أحمد الشمري", accountKind: "advance" },
  });
  const empAhmad = await prisma.employee.create({ data: { name: "أحمد الشمري", phone: "99001122" } });
  await prisma.employee.create({ data: { name: "خالد المطيري", phone: "99334455" } });

  console.log("🌳 أنواع العقود وقالب المراحل والدفعات...");
  // — عقد صيانة سنوي
  const tMaint = await prisma.contractType.create({ data: { name: "عقد صيانة سنوي", defaultAmount: 4500, pricingMode: "lump" } });
  const ms1 = await prisma.workflowStage.create({ data: { transactionType: "contract", contractType: tMaint.name, stageName: "التعاقد والتوقيع", stageOrder: 1, payKind: "advance", paymentPct: 30, expectedDays: 0 } });
  const ms2 = await prisma.workflowStage.create({ data: { transactionType: "contract", contractType: tMaint.name, stageName: "التنفيذ الشهري", stageOrder: 2, payKind: "achieve", paymentPct: 40, expectedDays: 240 } });
  const ms3 = await prisma.workflowStage.create({ data: { transactionType: "contract", contractType: tMaint.name, stageName: "التسليم والإغلاق", stageOrder: 3, payKind: "final", paymentPct: 30, expectedDays: 365 } });
  const mp1 = await prisma.typePaymentTpl.create({ data: { contractType: tMaint.name, payNo: 1, title: "دفعة مقدمة", pct: 30, triggerStageId: ms1.id, daysOffset: 0 } });
  const mp2 = await prisma.typePaymentTpl.create({ data: { contractType: tMaint.name, payNo: 2, title: "دفعة وسط", pct: 40, triggerStageId: ms2.id, daysOffset: 120 } });
  const mp3 = await prisma.typePaymentTpl.create({ data: { contractType: tMaint.name, payNo: 3, title: "دفعة ختامية", pct: 30, triggerStageId: ms3.id, daysOffset: 300 } });
  await prisma.typePaymentStage.createMany({ data: [{ paymentId: mp1.id, stageId: ms1.id }, { paymentId: mp2.id, stageId: ms2.id }, { paymentId: mp3.id, stageId: ms3.id }] });

  // — إشراف هندسي
  const tSup = await prisma.contractType.create({ data: { name: "إشراف هندسي", defaultAmount: 4200, pricingMode: "unit", unitLabel: "شهر", unitPrice: 350, isSupervision: true } });
  const ss1 = await prisma.workflowStage.create({ data: { transactionType: "contract", contractType: tSup.name, stageName: "تعهد الإشراف", stageOrder: 1, isSupervision: true, payKind: "advance", paymentPct: 25 } });
  const ss2 = await prisma.workflowStage.create({ data: { transactionType: "contract", contractType: tSup.name, stageName: "الإشراف الميداني", stageOrder: 2, isSupervision: true, payKind: "achieve", paymentPct: 50, expectedDays: 180 } });
  const ss3 = await prisma.workflowStage.create({ data: { transactionType: "contract", contractType: tSup.name, stageName: "التقرير الختامي", stageOrder: 3, isSupervision: true, payKind: "final", paymentPct: 25, expectedDays: 365 } });
  const sp1 = await prisma.typePaymentTpl.create({ data: { contractType: tSup.name, payNo: 1, title: "اشتراك ربع سنوي أول", pct: 25, triggerStageId: ss1.id, daysOffset: 0 } });
  const sp2 = await prisma.typePaymentTpl.create({ data: { contractType: tSup.name, payNo: 2, title: "اشتراك ربع سنوي ثاني", pct: 25, triggerStageId: ss2.id, daysOffset: 90 } });
  const sp3 = await prisma.typePaymentTpl.create({ data: { contractType: tSup.name, payNo: 3, title: "اشتراك ربع سنوي ثالث", pct: 25, triggerStageId: ss2.id, daysOffset: 180 } });
  const sp4 = await prisma.typePaymentTpl.create({ data: { contractType: tSup.name, payNo: 4, title: "اشتراك ربع سنوي رابع", pct: 25, triggerStageId: ss3.id, daysOffset: 270 } });
  await prisma.typePaymentStage.createMany({ data: [{ paymentId: sp1.id, stageId: ss1.id }, { paymentId: sp2.id, stageId: ss2.id }, { paymentId: sp3.id, stageId: ss2.id }, { paymentId: sp4.id, stageId: ss3.id }] });

  // — عقد شامل (بنود)
  const tBundle = await prisma.contractType.create({ data: { name: "عقد شامل", defaultAmount: 18000, pricingMode: "items" } });
  const bs1 = await prisma.workflowStage.create({ data: { transactionType: "contract", contractType: tBundle.name, stageName: "التعاقد", stageOrder: 1, payKind: "advance", paymentPct: 20 } });
  const bs2 = await prisma.workflowStage.create({ data: { transactionType: "contract", contractType: tBundle.name, stageName: "الأعمال المدنية", stageOrder: 2, payKind: "achieve", paymentPct: 40, expectedDays: 120 } });
  const bs3 = await prisma.workflowStage.create({ data: { transactionType: "contract", contractType: tBundle.name, stageName: "التشطيبات", stageOrder: 3, payKind: "achieve", paymentPct: 30, expectedDays: 240 } });
  const bs4 = await prisma.workflowStage.create({ data: { transactionType: "contract", contractType: tBundle.name, stageName: "الاستلام النهائي", stageOrder: 4, payKind: "final", paymentPct: 10, expectedDays: 300 } });
  const bp1 = await prisma.typePaymentTpl.create({ data: { contractType: tBundle.name, payNo: 1, title: "دفعة مقدمة", pct: 20, triggerStageId: bs1.id } });
  const bp2 = await prisma.typePaymentTpl.create({ data: { contractType: tBundle.name, payNo: 2, title: "دفعة أعمال مدنية", pct: 40, triggerStageId: bs2.id } });
  const bp3 = await prisma.typePaymentTpl.create({ data: { contractType: tBundle.name, payNo: 3, title: "دفعة تشطيبات", pct: 30, triggerStageId: bs3.id } });
  const bp4 = await prisma.typePaymentTpl.create({ data: { contractType: tBundle.name, payNo: 4, title: "دفعة استلام", pct: 10, triggerStageId: bs4.id } });
  await prisma.typePaymentStage.createMany({ data: [{ paymentId: bp1.id, stageId: bs1.id }, { paymentId: bp2.id, stageId: bs2.id }, { paymentId: bp3.id, stageId: bs3.id }, { paymentId: bp4.id, stageId: bs4.id }] });

  console.log("👥 العملاء...");
  const c1 = await prisma.customer.create({ data: { customerCode: "CUS-0001", name: "شركة الأفق للتجارة العامة", phone: "24817777", address: "الشويخ الصناعية، قطعة 45", addressGovernorate: "العاصمة", addressArea: "الشويخ", createdBy: "admin" } });
  const c2 = await prisma.customer.create({ data: { customerCode: "CUS-0002", name: "دار الخليج العقارية", phone: "25302288", address: "برج الخليج، الدور 8، مدينة الكويت", addressGovernorate: "العاصمة", addressArea: "الديرة", createdBy: "admin" } });
  const c3 = await prisma.customer.create({ data: { customerCode: "CUS-0003", name: "مؤسسة النخبة للمقاولات", phone: "99556677", address: "حولي، شارع تونس", addressGovernorate: "حولي", addressArea: "حولي", createdBy: "admin" } });
  const c4 = await prisma.customer.create({ data: { customerCode: "CUS-0004", name: "شركة الواحة للخدمات", phone: "26614455", address: "الفروانية، مجمع الواحة", addressGovernorate: "الفروانية", createdBy: "admin" } });
  const c5 = await prisma.customer.create({ data: { customerCode: "CUS-0005", name: "مجموعة البحر الأزرق", phone: "94455667", address: "السالمية، بلوك 3", addressGovernorate: "حولي", createdBy: "admin" } });

  console.log("📄 العقود والمراحل والدفعات...");
  const seqContracts: number[] = [];

  // عقد 1: صيانة سنوية — شركة الأفق
  const contract1 = await prisma.contract.create({
    data: {
      contractNumber: "C-2025-0001", customerId: c1.id, contractName: "صيانة سنوية — مبنى الأفق",
      contractType: tMaint.name, contractDate: D("2025-01-15"), startDate: D("2025-01-15"), endDate: D("2026-01-14"),
      amount: 4500, description: "صيانة دورية شاملة لمبنى الإدارة", status: "نشط", createdBy: "admin",
      stages: {
        create: [
          { name: ms1.stageName, level: 1, payPct: 30, payKind: "advance", sortOrder: 1, startDate: D("2025-01-15"), endDate: D("2025-01-20") },
          { name: ms2.stageName, level: 1, payPct: 40, payKind: "achieve", sortOrder: 2, startDate: D("2025-01-21") },
          { name: ms3.stageName, level: 1, payPct: 30, payKind: "final", sortOrder: 3 },
        ],
      },
    },
  });
  seqContracts.push(contract1.id);
  const p1 = await prisma.paymentPlan.create({ data: { contractId: contract1.id, title: "دفعة مقدمة", dueDate: D("2025-01-15"), amount: 1350, sortOrder: 1, triggeredAt: D("2025-01-15") } });
  const p2 = await prisma.paymentPlan.create({ data: { contractId: contract1.id, title: "دفعة وسط", dueDate: D("2025-05-15"), amount: 1800, sortOrder: 2 } });
  await prisma.paymentPlan.create({ data: { contractId: contract1.id, title: "دفعة ختامية", dueDate: D("2025-11-15"), amount: 1350, sortOrder: 3 } });
  await prisma.contractEvent.createMany({ data: [
    { contractId: contract1.id, eventType: "إنشاء العقد", description: "تم إنشاء العقد من نوع عقد صيانة سنوي", username: "admin" },
  ]});

  // عقد 2: إشراف هندسي — دار الخليج
  const contract2 = await prisma.contract.create({
    data: {
      contractNumber: "C-2025-0002", customerId: c2.id, contractName: "إشراف هندسي — برج الخليج",
      contractType: tSup.name, contractDate: D("2025-02-01"), supStartDate: D("2025-02-01"),
      amount: 4200, qty: 12, unitPrice: 350, description: "إشراف على أعمال تركيب الواجهات", status: "نشط", createdBy: "admin",
      stages: {
        create: [
          { name: ss1.stageName, level: 1, payPct: 25, payKind: "advance", sortOrder: 1, isSupervision: true, supStart: D("2025-02-01"), supMonthly: 350, startDate: D("2025-02-01") },
          { name: ss2.stageName, level: 1, payPct: 50, payKind: "achieve", sortOrder: 2, isSupervision: true, supMonthly: 350 },
          { name: ss3.stageName, level: 1, payPct: 25, payKind: "final", sortOrder: 3, isSupervision: true, supMonthly: 350 },
        ],
      },
    },
  });
  seqContracts.push(contract2.id);
  const supP1 = await prisma.paymentPlan.create({ data: { contractId: contract2.id, title: "اشتراك ربع سنوي أول", dueDate: D("2025-02-01"), amount: 1050, sortOrder: 1, triggeredAt: D("2025-02-01") } });
  await prisma.paymentPlan.createMany({ data: [
    { contractId: contract2.id, title: "اشتراك ربع سنوي ثاني", dueDate: D("2025-05-01"), amount: 1050, sortOrder: 2 },
    { contractId: contract2.id, title: "اشتراك ربع سنوي ثالث", dueDate: D("2025-08-01"), amount: 1050, sortOrder: 3 },
    { contractId: contract2.id, title: "اشتراك ربع سنوي رابع", dueDate: D("2025-11-01"), amount: 1050, sortOrder: 4 },
  ]});
  await prisma.contractEvent.create({ data: { contractId: contract2.id, eventType: "إنشاء العقد", description: "إشراف هندسي 12 شهرًا × 350 د.ك", username: "admin" } });

  // عقد 3: شامل ببنود — مؤسسة النخبة
  const contract3 = await prisma.contract.create({
    data: {
      contractNumber: "C-2025-0003", customerId: c3.id, contractName: "تجهيز مقر المؤسسة",
      contractType: tBundle.name, contractDate: D("2025-03-10"), startDate: D("2025-03-15"),
      amount: 18000, description: "أعمال مدنية وتشطيبات لمقر جديد", status: "معتمد", createdBy: "admin",
      stages: {
        create: [
          { name: bs1.stageName, level: 1, payPct: 20, payKind: "advance", sortOrder: 1, startDate: D("2025-03-15"), endDate: D("2025-03-20") },
          { name: bs2.stageName, level: 1, payPct: 40, payKind: "achieve", sortOrder: 2, startDate: D("2025-03-21") },
          { name: bs3.stageName, level: 1, payPct: 30, payKind: "achieve", sortOrder: 3 },
          { name: bs4.stageName, level: 1, payPct: 10, payKind: "final", sortOrder: 4 },
        ],
      },
    },
  });
  seqContracts.push(contract3.id);
  const bStage = await prisma.contractStage.findFirst({ where: { contractId: contract3.id, name: "الأعمال المدنية" } });
  const bi1 = await prisma.boqItem.create({ data: { contractId: contract3.id, description: "أعمال حفر وأساسات", qty: 1, unit: "مقطوعية", unitPrice: 6000, stageId: bStage?.id } });
  await prisma.boqItem.create({ data: { contractId: contract3.id, description: "شبكة كهرباء وتكييف مركزي", qty: 1, unit: "مقطوعية", unitPrice: 7500 } });
  await prisma.boqItem.create({ data: { contractId: contract3.id, description: "دهانات وتشطيبات فاخرة", qty: 450, unit: "م²", unitPrice: 10 } });
  await prisma.paymentPlan.createMany({ data: [
    { contractId: contract3.id, title: "دفعة مقدمة", dueDate: D("2025-03-10"), amount: 3600, sortOrder: 1 },
    { contractId: contract3.id, title: "دفعة أعمال مدنية", dueDate: D("2025-07-10"), amount: 7200, sortOrder: 2 },
    { contractId: contract3.id, title: "دفعة تشطيبات", dueDate: D("2025-11-10"), amount: 5400, sortOrder: 3 },
    { contractId: contract3.id, title: "دفعة استلام", dueDate: D("2026-01-10"), amount: 1800, sortOrder: 4 },
  ]});

  // عقد 4: صيانة — الواحة (متوقف)
  const contract4 = await prisma.contract.create({
    data: {
      contractNumber: "C-2025-0004", customerId: c4.id, contractName: "صيانة مجمع الواحة",
      contractType: tMaint.name, contractDate: D("2024-11-01"), startDate: D("2024-11-01"), endDate: D("2025-10-31"),
      amount: 6000, status: "متوقف", statusReason: "انتظار موافقة العميل على الملحق الأول", createdBy: "admin",
      stages: {
        create: [
          { name: ms1.stageName, level: 1, payPct: 30, payKind: "advance", sortOrder: 1, startDate: D("2024-11-01"), endDate: D("2024-11-05") },
          { name: ms2.stageName, level: 1, payPct: 40, payKind: "achieve", sortOrder: 2, startDate: D("2024-11-06") },
          { name: ms3.stageName, level: 1, payPct: 30, payKind: "final", sortOrder: 3 },
        ],
      },
    },
  });
  seqContracts.push(contract4.id);
  const wp1 = await prisma.paymentPlan.create({ data: { contractId: contract4.id, title: "دفعة مقدمة", dueDate: D("2024-11-01"), amount: 1800, sortOrder: 1, triggeredAt: D("2024-11-01") } });
  await prisma.paymentPlan.create({ data: { contractId: contract4.id, title: "دفعة وسط", dueDate: D("2025-04-01"), amount: 2400, sortOrder: 2 } });
  await prisma.paymentPlan.create({ data: { contractId: contract4.id, title: "دفعة ختامية", dueDate: D("2025-09-01"), amount: 1800, sortOrder: 3 } });

  console.log("🧾 السندات...");
  const rv1 = await prisma.voucher.create({
    data: {
      voucherNumber: "RV-0001", vtype: "receipt", vdate: D("2025-01-15"), party: c1.name, partyType: "customer", partyId: c1.id,
      method: "نقدًا", account: "الصندوق", amount: 1350, description: "دفعة مقدمة — عقد C-2025-0001",
      contractId: contract1.id, createdBy: "admin",
    },
  });
  await prisma.voucherPaymentLink.create({ data: { voucherId: rv1.id, kind: "receipt", lineId: p1.id, amount: 1350 } });
  const rv2 = await prisma.voucher.create({
    data: {
      voucherNumber: "RV-0002", vtype: "receipt", vdate: D("2025-02-01"), party: c2.name, partyType: "customer", partyId: c2.id,
      method: "تحويل بنكي", account: "بنك الكويت الوطني", amount: 1050, description: "اشتراك ربع سنوي أول — عقد C-2025-0002",
      contractId: contract2.id, createdBy: "admin",
    },
  });
  await prisma.voucherPaymentLink.create({ data: { voucherId: rv2.id, kind: "receipt", lineId: supP1.id, amount: 1050 } });
  // سند رسوم التحويل البنكي المرتبط
  await prisma.voucher.create({
    data: {
      voucherNumber: "PV-0001", vtype: "payment", vdate: D("2025-02-01"), party: "بنك الكويت الوطني", partyType: "other",
      method: "نقدًا", account: "الصندوق", amount: 0.15, description: "رسوم تحويل بنكي — RV-0002",
      contractId: contract2.id, parentVoucherId: rv2.id, createdBy: "admin",
    },
  });
  await prisma.voucher.create({
    data: {
      voucherNumber: "PV-0002", vtype: "payment", vdate: D("2025-03-20"), party: "شركة الوقود الوطنية", partyType: "other",
      method: "نقدًا", account: "الصندوق", amount: 450, description: "وقود ومحروقات — مركبات الصيانة",
      expenseAccountId: expGroups["وقود ومحروقات"].id, createdBy: "admin",
    },
  });
  await prisma.voucher.create({
    data: {
      voucherNumber: "CV-0001", vtype: "custody_return", vdate: D("2025-04-05"), party: "أحمد الشمري", partyType: "other",
      method: "نقدًا", account: "الصندوق", amount: 300, advanceAmount: 300,
      description: "إرجاع جزئي من العهدة", custodyAccountId: custAhmad.id, advanceEmployeeId: empAhmad.id, createdBy: "admin",
    },
  });

  console.log("🔢 العدادات...");
  await prisma.numberSequence.createMany({ data: [
    { name: "vouchers", lastNo: 4 },
    { name: "customers", lastNo: 5 },
    { name: "contracts", lastNo: 4 },
    { name: "subcontractors", lastNo: 0 },
  ]});

  console.log("✅ تمت البذور بنجاح");
  console.log("   تسجيل الدخول: admin / admin  أو  secretary / 1234");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
