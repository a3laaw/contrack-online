import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok, parseDay, todayStr } from "@/lib/api-utils";
import { intOr } from "@/lib/contrack-server";
import { nextRevNo, revisionKpis, validateRevisionInput } from "@/lib/consulting-revision-core";

/**
 * مراجعات المخططات (docs/revisions-ipc-design.md §1.3) — بند 1 من خريطة NOVA:
 * قرار المالك (docs/consulting-projects-design.md): الهدف مشروع استشاري أو عقد — واحد إلزامي،
 * وrevNo يُرقَّم لكل (هدف، عنوان).
 * GET: الدورات مجمعة (عنوان ثم revNo تنازليًا) بفلتر هدف اختياري + ملخص اشتقاقي
 * POST: إنشاء دورة جديدة — revNo آلي لكل (هدف، عنوان) + حدث عقد للمربوطة بعقد + تدقيق
 * الحرس: screen_consulting ⇐ moduleGuard("consulting") — نمط summary حرفيًا
 */

export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_consulting");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "consulting", "الاستشارات الهندسية");
  if (mg) return mg;

  const contractId = intOr(req.nextUrl.searchParams.get("contractId"), 0);
  const consultingProjectId = intOr(req.nextUrl.searchParams.get("consultingProjectId"), 0);
  const rows = await db.consultingRevision.findMany({
    where: {
      ...(contractId ? { contractId } : {}),
      ...(consultingProjectId ? { consultingProjectId } : {}),
    },
    orderBy: [{ title: "asc" }, { revNo: "desc" }],
    take: 2000,
    select: {
      id: true, contractId: true, consultingProjectId: true, title: true, revNo: true, status: true,
      engineerId: true, submittedAt: true, decidedAt: true, decidedBy: true,
      decisionNote: true, notes: true, createdAt: true,
      engineer: { select: { name: true } },
      consultingProject: { select: { projectNumber: true, name: true } },
      contract: {
        select: { contractNumber: true, contractName: true, customer: { select: { name: true } } },
      },
    },
  });

  const revisions = rows.map((r) => ({
    id: r.id,
    contractId: r.contractId,
    contractNumber: r.contract?.contractNumber || "",
    contractName: r.contract?.contractName || "",
    customerName: r.contract?.customer?.name || "",
    consultingProjectId: r.consultingProjectId,
    consultingProjectNumber: r.consultingProject?.projectNumber || "",
    consultingProjectName: r.consultingProject?.name || "",
    title: r.title,
    revNo: r.revNo,
    status: r.status,
    engineerId: r.engineerId,
    engineerName: r.engineer?.name ?? null,
    submittedAt: r.submittedAt,
    decidedAt: r.decidedAt,
    decidedBy: r.decidedBy,
    decisionNote: r.decisionNote,
    notes: r.notes,
    createdAt: r.createdAt,
  }));

  return ok({ revisions, summary: revisionKpis(rows) });
}

export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_consulting");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "consulting", "الاستشارات الهندسية");
  if (mg) return mg;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const contractId = intOr(body.contractId, 0);
  const consultingProjectId = intOr(body.consultingProjectId, 0);
  if (!contractId && !consultingProjectId)
    return jsonError("اختيار المشروع الاستشاري أو العقد مطلوب");
  if (contractId && consultingProjectId)
    return jsonError("اختر هدفًا واحدًا — المشروع الاستشاري أو العقد");

  const input = validateRevisionInput(body);
  if (!input.ok) return jsonError(input.error);

  const [contract, project, engineer] = await Promise.all([
    contractId
      ? db.contract.findUnique({
          where: { id: contractId },
          select: { id: true, contractNumber: true, contractName: true },
        })
      : Promise.resolve(null),
    consultingProjectId
      ? db.consultingProject.findUnique({
          where: { id: consultingProjectId },
          select: { id: true, projectNumber: true, name: true },
        })
      : Promise.resolve(null),
    input.value.engineerId
      ? db.engineer.findUnique({ where: { id: input.value.engineerId }, select: { id: true, name: true } })
      : Promise.resolve(null),
  ]);
  if (contractId && !contract) return jsonError("العقد غير موجود", 404);
  if (consultingProjectId && !project) return jsonError("المشروع الاستشاري غير موجود", 404);
  if (input.value.engineerId && !engineer) return jsonError("المهندس غير موجود", 404);

  const where: { title: string; contractId?: number; consultingProjectId?: number } = {
    title: input.value.title,
  };
  if (contractId) where.contractId = contractId;
  if (consultingProjectId) where.consultingProjectId = consultingProjectId;
  const existing = await db.consultingRevision.findMany({ where, select: { revNo: true } });
  const revNo = nextRevNo(existing.map((r) => r.revNo));
  const submittedAt = parseDay(input.value.submittedAt) || todayStr();
  const targetLabel = contract
    ? contract.contractNumber
    : `${project!.projectNumber} — ${project!.name}`;

  const created = await db.$transaction(async (tx) => {
    const row = await tx.consultingRevision.create({
      data: {
        contractId: contractId || null,
        consultingProjectId: consultingProjectId || null,
        title: input.value.title,
        revNo,
        engineerId: input.value.engineerId,
        submittedAt,
        notes: input.value.notes,
        createdBy: guard.user.username,
      },
    });
    // حدث العقد حصرًا للمراجعات المربوطة بعقد — مشاريع الاستشارات المستقلة بلا أحداث عقود
    if (contractId) {
      await tx.contractEvent.create({
        data: {
          contractId,
          eventType: "مراجعة مخطط",
          description: `رُفع الإصدار V${revNo} من «${input.value.title}» لمراجعة${engineer ? ` — بتحضير ${engineer.name}` : ""}`,
          username: guard.user.username,
        },
      });
    }
    await audit(tx, {
      username: guard.user.username,
      action: "إنشاء",
      entityType: "consulting_revision",
      entityId: row.id,
      entityName: `${targetLabel} · ${input.value.title} V${revNo}`,
    });
    return row;
  });

  return ok(
    {
      revision: {
        id: created.id,
        contractId: created.contractId,
        consultingProjectId: created.consultingProjectId,
        title: created.title,
        revNo: created.revNo,
        status: created.status,
      },
    },
    201
  );
}
