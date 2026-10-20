import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { featureOn, jsonError } from "@/lib/api-utils";
import { getSessionUser } from "@/lib/auth";

import { buildImportTemplateBuffer } from "@/lib/import/template";
import { isImportSheet } from "@/lib/import/sheets";

/** حارس المطور — المعالج أداة مطور (تاب «الترحيل والاستيراد» developerOnly) */
async function developerGuard(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return { response: NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 }) };
  if (user.role !== "developer") {
    return { response: NextResponse.json({ error: "معالج الاستيراد للمطور فقط" }, { status: 403 }) };
  }
  return { user };
}

/** GET /api/import/template?sheet=<اسم الورقة الحرفي> — قالب كامل أو ورقة واحدة (xlsx) */
export async function GET(req: NextRequest) {
  const guard = await developerGuard(req);
  if ("response" in guard) return guard.response;
  if (!(await featureOn("import_old"))) {
    return jsonError("ميزة «استيراد البيانات القديمة» معطّلة", 403);
  }

  const sheet = (req.nextUrl.searchParams.get("sheet") || "").trim();
  if (sheet && !isImportSheet(sheet)) {
    return jsonError("ورقة غير معروفة — الأوراق الثماني فقط لها قوالب", 400);
  }

  const types = await db.contractType.findMany({ select: { name: true, active: true } });
  const knownTypes = types.map((t) => t.name).filter((n) => n && n !== "غير محدد");

  const { buffer, filename } = await buildImportTemplateBuffer({ sheet: sheet || undefined, knownTypes });
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="template.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
