import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authGuard, jsonError, ok, audit } from "@/lib/api-utils";
import { intOr } from "@/lib/contrack-server";
import { GatewayError, canonPhone, normalizeName, saveAlias } from "@/lib/gateway-server";

function err(e: unknown) {
  if (e instanceof GatewayError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return jsonError("حدث خطأ غير متوقع", 500);
}

/** GET: الروابط المحفوظة (هاتف/اسم الملف ← عميل) مع اسم العميل */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_gateway");
  if ("response" in guard) return guard.response;
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") || "").trim().toLowerCase();
  const rows = await db.matchAlias.findMany({ orderBy: [{ id: "desc" }] });
  const ids = [...new Set(rows.map((r) => r.customerId).filter(Boolean))];
  const customers = ids.length
    ? await db.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, phone: true } })
    : [];
  const byId = new Map(customers.map((c) => [c.id, c]));
  const aliases = rows
    .filter((r) => !q || r.filePhone.includes(q) || r.fileName.includes(q))
    .map((r) => ({
      id: r.id,
      filePhone: r.filePhone,
      fileName: r.fileName,
      customerId: r.customerId,
      customer: byId.get(r.customerId)?.name || "",
      customerPhone: byId.get(r.customerId)?.phone || "",
      createdAt: r.createdAt,
    }));
  return ok({ aliases });
}

/** POST: حفظ رابط يدوي (يتعلمه النظام للملفات القادمة) */
export async function POST(req: NextRequest) {
  const guard = await authGuard(req, "screen_gateway");
  if ("response" in guard) return guard.response;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const customerId = intOr(body.customerId, 0);
    if (!customerId) return jsonError("اختر عميلًا صحيحًا للرابط.");
    const cust = await db.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!cust) return jsonError("العميل غير موجود.", 404);
    const filePhone = canonPhone(String(body.filePhone || ""));
    const fileName = normalizeName(String(body.fileName || ""));
    if (!filePhone && !fileName) return jsonError("هوية الملف (هاتف أو اسم) إلزامية.");
    await saveAlias(filePhone, fileName, customerId);
    await audit(db, {
      username: guard.user.username,
      action: "gateway_alias_save",
      entityType: "match_aliases",
      entityId: customerId,
      entityName: `${filePhone} / ${fileName}`,
    });
    return ok({ saved: true, filePhone, fileName, customerId }, 201);
  } catch (e) {
    return err(e);
  }
}

/** DELETE: ?id= أو ?filePhone= (يحذف كل روابط الهاتف) أو ?filePhone=&fileName= */
export async function DELETE(req: NextRequest) {
  const guard = await authGuard(req, "screen_gateway");
  if ("response" in guard) return guard.response;
  const sp = req.nextUrl.searchParams;
  const id = intOr(sp.get("id"), 0);
  const filePhone = canonPhone(sp.get("filePhone") || "");
  const fileName = normalizeName(sp.get("fileName") || "");
  try {
    if (id) {
      const row = await db.matchAlias.findUnique({ where: { id } });
      if (!row) return jsonError("الرابط غير موجود", 404);
      await db.matchAlias.delete({ where: { id } });
    } else if (filePhone && fileName) {
      await db.matchAlias.delete({ where: { filePhone_fileName: { filePhone, fileName } } });
    } else if (filePhone) {
      const n = await db.matchAlias.deleteMany({ where: { filePhone } });
      await audit(db, {
        username: guard.user.username,
        action: "gateway_alias_delete",
        entityType: "match_aliases",
        entityName: filePhone,
        newStatus: String(n.count),
      });
      return ok({ deleted: n.count });
    } else {
      return jsonError("حدد ?id= أو ?filePhone= (و?fileName= اختياريًا).");
    }
    await audit(db, {
      username: guard.user.username,
      action: "gateway_alias_delete",
      entityType: "match_aliases",
      entityId: id,
      entityName: `${filePhone} / ${fileName}`,
    });
    return ok({ deleted: 1 });
  } catch (e) {
    return err(e);
  }
}

export const dynamic = "force-dynamic";
