import "server-only";
import { db } from "@/lib/db";
import type { PrismaClient } from "@prisma/client";

/**
 * بذر البيانات المرجعية الافتراضية — مطابق لقيم المصدر (database.py:1532-1556
 * وأنواع العقود وشجرة الحسابات ومراحل التنفيذ من types_setup_service).
 * عديم الأثر التكراري: يبذر فقط الجداول الفارغة.
 */
export async function ensureSeedData(client?: PrismaClient): Promise<{ seeded: string[] }> {
  const d = client || db;
  const seeded: string[] = [];

  // ===== أساليب الدفع (كالمصدر حرفيًا) =====
  if ((await d.paymentMethod.count()) === 0) {
    await d.paymentMethod.createMany({
      data: [
        { name: "نقدًا", feeType: "amount", feeValue: 0, isActive: true },
        { name: "تحويل بنكي", feeType: "amount", feeValue: 0.15, isActive: true },
        { name: "KNET", feeType: "percent", feeValue: 1.5, isActive: true },
        { name: "شيك", feeType: "amount", feeValue: 0, isActive: true },
        { name: "أخرى", feeType: "amount", feeValue: 0, isActive: true },
      ],
    });
    seeded.push("payment_methods");
  }

  // ===== شجرة حسابات المصروفات والعُهد =====
  if ((await d.expenseAccount.count()) === 0) {
    const roots = [
      { name: "مصروفات عامة", kind: "expense", posting: false, children: ["إيجارات", "كهرباء وماء", "اتصالات وإنترنت", "صيانة", "وقود", "قرطاسية ومطبوعات"] },
      { name: "عمولات بنكية", kind: "expense", posting: true, children: [] as string[] },
      { name: "رواتب", kind: "expense", posting: true, children: ["سلف موظفين"] },
      { name: "العُهد", kind: "advance", posting: false, children: ["عهدة عامة"] },
    ];
    let order = 0;
    for (const r of roots) {
      const parent = await d.expenseAccount.create({
        data: {
          name: r.name,
          fullPath: r.name,
          accountKind: r.kind,
          allowPosting: r.posting,
          sortOrder: order++,
        },
      });
      let childOrder = 0;
      for (const c of r.children) {
        const child = await d.expenseAccount.create({
          data: {
            name: c,
            fullPath: `${r.name} / ${c}`,
            accountKind: r.kind,
            allowPosting: true,
            parentId: parent.id,
            sortOrder: childOrder++,
          },
        });
        await d.expenseAccount.update({ where: { id: child.id }, data: { fullPath: `${r.name} / ${c}` } });
      }
    }
    seeded.push("expense_accounts");
  }

  // ===== مراحل التنفيذ (قالب عام transactionType='contract') =====
  if ((await d.workflowStage.count()) === 0) {
    const stages: [string, number, number][] = [
      ["التعاقد والتوقيع", 1, 3],
      ["التصميم والمخططات", 2, 14],
      ["التراخيص والموافقات", 3, 21],
      ["الحفر والأساسات", 4, 20],
      ["الهيكل الإنشائي", 5, 45],
      ["أعمال البناء", 6, 40],
      ["التمديدات الكهربائية", 7, 15],
      ["التمديدات الصحية", 8, 15],
      ["أعمال التشطيبات", 9, 35],
      ["التسليم النهائي", 10, 5],
    ];
    await d.workflowStage.createMany({
      data: stages.map(([name, stageOrder, expectedDays]) => ({
        transactionType: "contract",
        stageName: name,
        stageOrder,
        expectedDays,
        color: "#3B82F6",
      })),
    });
    await d.workflowStage.createMany({
      data: [
        { transactionType: "payment", stageName: "مقدم تحت المراجعة", stageOrder: 1, expectedDays: 2, color: "#3B82F6" },
        { transactionType: "payment", stageName: "معتمد", stageOrder: 2, expectedDays: 1, color: "#3B82F6" },
        { transactionType: "payment", stageName: "مصروف", stageOrder: 3, expectedDays: 3, color: "#3B82F6" },
      ],
    });
    seeded.push("workflow_stages");
  }

  // ===== أنواع العقود الافتراضية =====
  if ((await d.contractType.count()) === 0) {
    const types: {
      name: string;
      defaultAmount: number;
      notes: string;
      isSupervision?: boolean;
      unitLabel?: string;
      unitPrice?: number;
      pricingMode?: string;
      pays?: [string, number][];
    }[] = [
      {
        name: "أعمال مدنية",
        defaultAmount: 25000,
        notes: "أعمال بناء وحفر وأساسات وهياكل إنشائية",
        pays: [["دفعة مقدمة", 30], ["دفعة أثناء التنفيذ", 40], ["دفعة التسليم", 30]],
      },
      {
        name: "أعمال تشطيبات",
        defaultAmount: 12000,
        notes: "تشطيبات داخلية وخارجية",
        pays: [["دفعة مقدمة", 40], ["دفعة التسليم", 60]],
      },
      {
        name: "أعمال كهربائية",
        defaultAmount: 8000,
        notes: "تمديدات كهربائية وإنارة",
        pays: [["دفعة مقدمة", 50], ["دفعة التسليم", 50]],
      },
      {
        name: "أعمال صحية",
        defaultAmount: 6000,
        notes: "تمديدات صحية وسباكة",
        pays: [["دفعة مقدمة", 50], ["دفعة التسليم", 50]],
      },
      {
        name: "إشراف هندسي",
        defaultAmount: 3000,
        notes: "إشراف هندسي شهري على المشاريع",
        isSupervision: true,
        pricingMode: "unit",
        unitLabel: "شهر",
        unitPrice: 500,
        pays: [["دفعة شهرية", 0]],
      },
      {
        name: "تصاميم هندسية",
        defaultAmount: 4500,
        notes: "مخططات وتصاميم معمارية وإنشائية",
        pays: [["دفعة مقدمة", 50], ["تسليم المخططات", 50]],
      },
    ];
    for (const t of types) {
      const created = await d.contractType.create({
        data: {
          name: t.name,
          defaultAmount: t.defaultAmount,
          notes: t.notes,
          isSupervision: Boolean(t.isSupervision),
          pricingMode: t.pricingMode || "lump",
          unitLabel: t.unitLabel || "",
          unitPrice: t.unitPrice || 0,
        },
      });
      if (t.pays && t.pays.length) {
        let payNo = 1;
        for (const [title, pct] of t.pays) {
          await d.typePaymentTemplate.create({
            data: { contractTypeId: created.id, payNo, title, pct },
          });
          payNo++;
        }
      }
    }
    seeded.push("contract_types");
  }

  return { seeded };
}
