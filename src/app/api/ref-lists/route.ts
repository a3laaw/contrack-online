import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { adminGuard, audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import { mapRefItem } from "@/lib/ref-lists-shared";

/**
 * القوائم المرجعية — إطار عام قابل للتوسعة (الجلسة 11):
 * الأوزان · المناطق · الوظائف · الأقسام · الإدارات — وأي قائمة يضيفها المالك («وغيرها»).
 * القراءة لأي مستخدم مسجّل (مرآة contract-types)، والكتابة للمدير (adminGuard).
 */

type RefListDef = { key: string; name: string; description: string };

/** القوائم المدمجة الافتراضية — تُبذر تلقائيًا عند أول قراءة إن غابت (لا تُحذف من الواجهة) */
const SYSTEM_LISTS: RefListDef[] = [
  { key: "weights", name: "الأوزان", description: "أوزان المعايير والتقييمات والنسب" },
  { key: "areas", name: "المناطق", description: "المحافظات والمناطق ومناطق العمل" },
  { key: "jobs", name: "الوظائف", description: "المسميات الوظيفية والأدوار الفنية" },
  { key: "departments", name: "الأقسام", description: "أقسام الشركة التشغيلية" },
  { key: "admins", name: "الإدارات", description: "الإدارات والإدارات العامة" },
];

/** بذر البداية للمناطق — المحافظات الست (بنود قابلة للتعديل والحذف كالبنود) */
const AREA_SEEDS = ["العاصمة", "حولي", "الفروانية", "الأحمدي", "الجهراء", "مبارك الكبير"];

/** ضمان وجود القوائم المدمجة — تُنشأ الناقصة فقط (بذر كسول لكل شركة من سياق الجلسة) */
async function ensureDefaults(): Promise<void> {
  const existing = await db.refList.findMany({
    where: { key: { in: SYSTEM_LISTS.map((s) => s.key) } },
    select: { id: true, key: true },
  });
  const have = new Set(existing.map((e) => e.key));
  for (const def of SYSTEM_LISTS) {
    if (have.has(def.key)) continue;
    const created = await db.refList.create({ data: { ...def, system: true } });
    if (def.key === "areas" && AREA_SEEDS.length > 0) {
      // createMany عبر الغلاف يحقن companyId لكل صف — البذر محصور بالشركة آليًا
      await db.refItem.createMany({
        data: AREA_SEEDS.map((name, i) => ({ listId: created.id, name, sortOrder: i + 1 })),
      });
    }
  }
}

/** GET — القوائم ببنودها وروابط مراحلها (بذر الافتراضي أولًا) */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;

  await ensureDefaults();

  const lists = await db.refList.findMany({
    // المدمجة أولًا بترتيب بذرها ثم المخصصة بأقدمها
    orderBy: [{ system: "desc" }, { id: "asc" }],
    include: {
      items: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        include: {
          stageLinks: {
            orderBy: { id: "asc" as const },
            include: { stage: { select: { stageName: true, transactionType: true } } },
          },
          // الهيكل التنظيمي — عدّاد الأبناء لشارة «عدد الأقسام/الوظائف» (org-structure-design D1)
          _count: { select: { children: true } },
        },
      },
    },
  });

  return ok({
    lists: lists.map((l) => ({
      id: l.id,
      key: l.key,
      name: l.name,
      description: l.description,
      system: l.system,
      active: l.active,
      items: l.items.map((it) => mapRefItem({ ...it, childrenCount: it._count.children })),
    })),
  });
}

/** POST — إنشاء قائمة مخصصة («وغيرها») — المفتاح مولَّد آليًا ولا يتغير بعدها */
export async function POST(req: NextRequest) {
  const guard = await adminGuard(req);
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name || "").trim();
  if (!name) return jsonError("اسم القائمة مطلوب");
  if (name.length > 60) return jsonError("اسم القائمة طويل جدًا (60 حرفًا كحد أقصى)");
  const description = String(body.description || "").trim().slice(0, 200);

  // الاسم فريد ضمن الشركة — لا قائمتان بنفس الاسم حتى لا يتراكب التحديد في الواجهة
  const dup = await db.refList.findFirst({ where: { name } });
  if (dup) return jsonError("توجد قائمة بهذا الاسم مسبقًا");

  const created = await db.refList.create({
    data: {
      key: `custom-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
      name,
      description,
      system: false,
    },
  });
  await audit(db, {
    username: guard.user.username,
    action: "إنشاء",
    entityType: "refList",
    entityId: created.id,
    entityName: name,
  });
  return ok(
    { list: { id: created.id, key: created.key, name: created.name, description: created.description, system: false, active: true, items: [] } },
    201
  );
}
