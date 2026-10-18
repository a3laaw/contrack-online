import { NextRequest } from "next/server";
import { authGuard } from "@/lib/api-utils";

type P = { params: Promise<{ id: string }> };

/** طباعة الفاتورة PDF — مؤجلة لمرحلة المطبوعات */
export async function GET(req: NextRequest, { params }: P) {
  await authGuard(req, "screen_invoices");
  await params;
  return Response.json({ error: "سيُفعَّل لاحقًا" }, { status: 501 });
}
