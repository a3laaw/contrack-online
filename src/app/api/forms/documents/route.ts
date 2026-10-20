import { NextRequest } from "next/server";
import { authGuard, ok } from "@/lib/api-utils";
import { listDocuments } from "@/lib/forms/forms-server";

/** سجل المستندات المولدة — مرآة list_documents (الأحدث أولًا) بفلاتر القالب/العميل */
export async function GET(req: NextRequest) {
  const guard = await authGuard(req, "screen_forms");
  if ("response" in guard) return guard.response;
  const sp = req.nextUrl.searchParams;
  const templateId = Number(sp.get("templateId") || 0);
  const customerId = Number(sp.get("customerId") || 0);
  const documents = await listDocuments({
    templateId: Number.isFinite(templateId) && templateId > 0 ? templateId : undefined,
    customerId: Number.isFinite(customerId) && customerId > 0 ? customerId : undefined,
  });
  return ok({ documents });
}
