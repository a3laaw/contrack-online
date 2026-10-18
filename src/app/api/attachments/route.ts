import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { audit, authGuard, jsonError, ok } from "@/lib/api-utils";
import { nowStamp } from "@/lib/visits-server";

/** مجلد التخزين الفعلي للمرفقات (كالمصدر: data/attachments/C<contract>_<stamp>_<name>) */
const ATTACH_DIR = path.join(process.cwd(), "db", "attachments");

/** الامتدادات المسموحة حرفيًا حسب تعليمات المرحلة (يشمل txt) */
const ALLOWED_EXTENSIONS = ["pdf", "jpg", "jpeg", "png", "doc", "docx", "xls", "xlsx", "txt"] as const;

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain; charset=utf-8",
};

function safeName(fileName: string): string {
  const base = path.basename(String(fileName || "").trim()).replace(/[\r\n\t"]/g, "_");
  return base.slice(0, 180);
}

function extOf(fileName: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(fileName || ""));
  return m ? m[1].toLowerCase() : "";
}

/** تنزيل ملف مرفق — GET ?id=&download=1 */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;

  const sp = req.nextUrl.searchParams;
  const id = Number(sp.get("id")) || 0;
  const contractId = Number(sp.get("contractId")) || 0;

  // ===== تنزيل ملف بالمعرف =====
  if (id) {
    const row = await db.contractAttachment.findUnique({ where: { id } });
    if (!row) return jsonError("المرفق غير موجود", 404);
    if (!fs.existsSync(row.storedPath)) return jsonError("الملف غير موجود على القرص", 404);

    const buf = fs.readFileSync(row.storedPath);
    const ext = extOf(row.fileName);
    const contentType = CONTENT_TYPES[ext] || "application/octet-stream";
    const encoded = encodeURIComponent(row.fileName);

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buf.length),
        "Content-Disposition": `attachment; filename="file_${row.id}.${ext || "bin"}"; filename*=UTF-8''${encoded}`,
        "Cache-Control": "no-store",
      },
    });
  }

  // ===== قائمة مرفقات كل عقود عميل (ملف العميل) — customerId =====
  const customerId = Number(sp.get("customerId")) || 0;
  if (customerId) {
    const customer = await db.customer.findUnique({ where: { id: customerId } });
    if (!customer) return jsonError("العميل غير موجود", 404);
    const contracts = await db.contract.findMany({
      where: { customerId },
      select: { id: true, contractNumber: true, contractName: true },
      orderBy: { id: "desc" },
    });
    const byId = new Map(contracts.map((c) => [c.id, c]));
    const rows = await db.contractAttachment.findMany({
      where: { contractId: { in: contracts.map((c) => c.id) } },
      orderBy: { id: "desc" },
    });
    return ok({
      attachments: rows.map((r) => {
        let sizeBytes = 0;
        try {
          sizeBytes = fs.statSync(r.storedPath).size;
        } catch {
          sizeBytes = 0;
        }
        const c = byId.get(r.contractId);
        return {
          id: r.id,
          contractId: r.contractId,
          contractNumber: c?.contractNumber || "",
          contractName: c?.contractName || "",
          fileName: r.fileName,
          addedAt: r.addedAt,
          sizeBytes,
        };
      }),
    });
  }

  // ===== قائمة مرفقات عقد =====
  if (!contractId) return jsonError("حدد contractId للقائمة أو id مع download=1 للتنزيل أو customerId لمرفقات عميل");

  const contract = await db.contract.findUnique({ where: { id: contractId } });
  if (!contract) return jsonError("العقد غير موجود", 404);

  const rows = await db.contractAttachment.findMany({
    where: { contractId },
    orderBy: { id: "desc" },
  });

  return ok({
    attachments: rows.map((r) => {
      let sizeBytes = 0;
      try {
        sizeBytes = fs.statSync(r.storedPath).size;
      } catch {
        sizeBytes = 0;
      }
      return {
        id: r.id,
        contractId: r.contractId,
        fileName: r.fileName,
        addedAt: r.addedAt,
        sizeBytes,
      };
    }),
  });
}

/** رفع مرفق عقد — {contractId, fileName, dataBase64} */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const contractId = Number(body.contractId) || 0;
  if (!contractId) return jsonError("العقد مطلوب للمرفق");
  const contract = await db.contract.findUnique({ where: { id: contractId } });
  if (!contract) return jsonError("العقد غير موجود", 404);

  const fileName = safeName(String(body.fileName || ""));
  if (!fileName) return jsonError("اسم الملف مطلوب");

  const ext = extOf(fileName);
  if (!ALLOWED_EXTENSIONS.includes(ext as (typeof ALLOWED_EXTENSIONS)[number])) {
    return jsonError("نوع الملف غير مسموح");
  }

  const b64 = String(body.dataBase64 || "").replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  if (!b64) return jsonError("محتوى الملف مطلوب");
  const buf = Buffer.from(b64, "base64");
  if (buf.length === 0) return jsonError("محتوى الملف غير صالح");

  fs.mkdirSync(ATTACH_DIR, { recursive: true });
  const stamp = Date.now();
  const storedPath = path.join(ATTACH_DIR, `C${contractId}_${stamp}_${fileName}`);
  fs.writeFileSync(storedPath, buf);

  try {
    const created = await db.$transaction(async (tx) => {
      const row = await tx.contractAttachment.create({
        data: {
          contractId,
          fileName,
          storedPath,
          addedAt: nowStamp(),
        },
      });
      await tx.contractEvent.create({
        data: {
          contractId,
          eventType: "إضافة مرفق",
          description: `إضافة مرفق «${fileName}» (${buf.length} بايت)`,
          username: guard.user.username,
        },
      });
      await audit(tx, {
        username: guard.user.username,
        action: "إضافة مرفق",
        entityType: "contract_attachment",
        entityId: row.id,
        entityName: `${contract.contractNumber} — ${fileName}`,
      });
      return row;
    });

    return ok({ attachment: { id: created.id, contractId, fileName: created.fileName, addedAt: created.addedAt, sizeBytes: buf.length } }, 201);
  } catch (e) {
    // فشل التخزين في القاعدة ⇒ لا نترك ملفًا يتيمًا على القرص
    try {
      fs.unlinkSync(storedPath);
    } catch {
      /* تجاهل */
    }
    console.error("فشل رفع مرفق:", e);
    return jsonError("تعذر حفظ المرفق، حاول مجددًا", 500);
  }
}

/** حذف مرفق — ?id= يحذف الملف الفعلي من القرص والصف من القاعدة */
export async function DELETE(req: NextRequest) {
  const guard = await authGuard(req);
  if ("response" in guard) return guard.response;

  const id = Number(req.nextUrl.searchParams.get("id")) || 0;
  if (!id) return jsonError("معرف المرفق مطلوب");

  const row = await db.contractAttachment.findUnique({ where: { id } });
  if (!row) return jsonError("المرفق غير موجود", 404);

  // حذف الملف الفعلي (كالمصدر extras_service.py:198–211)
  try {
    if (fs.existsSync(row.storedPath)) fs.unlinkSync(row.storedPath);
  } catch (e) {
    console.error("تعذر حذف ملف المرفق من القرص:", e);
  }

  await db.$transaction(async (tx) => {
    await tx.contractAttachment.delete({ where: { id } });
    await tx.contractEvent.create({
      data: {
        contractId: row.contractId,
        eventType: "حذف مرفق",
        description: `حذف مرفق «${row.fileName}»`,
        username: guard.user.username,
      },
    });
    await audit(tx, {
      username: guard.user.username,
      action: "حذف مرفق",
      entityType: "contract_attachment",
      entityId: id,
      entityName: row.fileName,
    });
  });

  return ok({ deleted: true });
}
