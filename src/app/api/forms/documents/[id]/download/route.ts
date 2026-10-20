import { NextRequest } from "next/server";
import { authGuard, jsonError } from "@/lib/api-utils";
import { getDocumentBinary } from "@/lib/forms/forms-server";
import { docFileName, MSG_DOC_NOT_FOUND } from "@/lib/forms/forms-core";

type P = { params: Promise<{ id: string }> };

/** إعادة تحميل مستند مولد — docx binary بالاسم المكتبية safe_FD-XXXX.docx */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_forms");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) return jsonError("معرف غير صالح");
  const doc = await getDocumentBinary(id);
  if (!doc) return jsonError(MSG_DOC_NOT_FOUND, 404);
  const fileName = docFileName(doc.templateBaseName, doc.docNumber || `FD-${doc.id}`);
  return new Response(new Uint8Array(doc.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${fileName.replace(/[^\x20-\x7E]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}
