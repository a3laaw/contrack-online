import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, moduleGuard, ok, parseDay, todayStr } from "@/lib/api-utils";
import { intOr } from "@/lib/contrack-server";
import { nextRevNo, revisionKpis, validateRevisionInput } from "@/lib/consulting-revision-core";

/**
 * مراجعات المخططات (docs/revisions-ipc-design.md §1.3) — بند 1 من خريطة NOVA:
 * قرار المالك المُحدّث (2026-11-16): الهدف مشروع استشاري إلزامي — بلا عقود (نشاط مستقل خالص)،
 * وrevNo يُرقَّم لكل (مشروع، عنوان).
 * GET: الدورات مجمعة (عنوان ثم revNo تنازليًا) بفلتر مشروع اختياري + ملخص اشتقاقي
 * POST: إنشاء دورة جديدة — revNo آلي لكل (مشروع، عنوان) + تدقيق
 * الحرس: screen_consulting ⇐ moduleGuard("consulting") — نمط summary حرفيًا
 */

export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_consulting");
  if ("response" in guard) return guard.response;
  const mg = await moduleGuard(guard.user.companyId, "consulting", "الاستشارات الهندسية");
  if (mg) return mg;

  const consultingProjectId = intOr(req.nextUrl.searchParams.get("consultingProjectId"), 0);
  const rows = await db.consultingRevision.findMany({
    where: {
      ...(consultingProjectId ? { consultingProjectId } : {}),
    },
    orderBy: [{ title: "asc" }, { revNo: "desc" }],
    take: 2000,
    select: {
      id: true, consultingProjectId: true, title: true, revNo: true, status: true,
      engineerId: true, submittedAt: true, decidedAt: true, decidedBy: true,
      decisionNote: true, notes: true, createdAt: true,
      engineer: { select: { name: true } },
      consultingProject: { select: { projectNumber: true, name: true } },
    },
  });

  const revisions = rows.map((r) => ({
    id: r.id,
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
  const consultingProjectId = intOr(body.consultingProjectId, 0);
  if (!consultingProjectId)
    return jsonError("اختيار المشروع الاستشاري مطلوب — الاستشارات نشاط مستقل بلا عقود");

  const input = validateRevisionInput(body);
  if (!input.ok) return jsonError(input.error);

  const [project, engineer] = await Promise.all([
    db.consultingProject.findUnique({
      where: { id: consultingProjectId },
      select: { id: true, projectNumber: true, name: true },
    }),
    input.value.engineerId
      ? db.engineer.findUnique({ where: { id: input.value.engineerId }, select: { id: true, name: true } })
      : Promise.resolve(null),
  ]);
  if (!project) return jsonError("المشروع الاستشاري غير موجود", 404);
  if (input.value.engineerId && !engineer) return jsonError("المهندس غير موجود", 404);

  const where = { title: input.value.title, consultingProjectId };
  const existing = await db.consultingRevision.findMany({ where, select: { revNo: true } });
  const revNo = nextRevNo(existing.map((r) => r.revNo));
  const submittedAt = parseDay(input.value.submittedAt) || todayStr();
  const targetLabel = `${project.projectNumber} — ${project.name}`;

  const created = await db.$transaction(async (tx) => {
    const row = await tx.consultingRevision.create({
      data: {
        consultingProjectId,
        title: input.value.title,
        revNo,
        engineerId: input.value.engineerId,
        submittedAt,
        notes: input.value.notes,
        createdBy: guard.user.username,
      },
    });
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
        consultingProjectId: created.consultingProjectId,
        title: created.title,
        revNo: created.revNo,
        status: created.status,
      },
    },
    201
  );
}
