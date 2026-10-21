import { NextRequest } from "next/server";
import { authGuard, jsonError, ok } from "@/lib/api-utils";
import { getContractComponents, saveContractComponents, type ContractComponentDTO } from "@/lib/contract-components-server";

type P = { params: Promise<{ id: string }> };

/** GET — لقطة مكوّنات العقد (تُهيَّأ من افتراضيات النوع عند أول قراءة) */
export async function GET(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "screen_contracts");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  if (!Number.isFinite(contractId)) return jsonError("معرف غير صالح");
  const components = await getContractComponents(contractId);
  return ok({ components });
}

/** PUT — حفظ اللقطة (استبدال كامل) — تعديل العقد */
export async function PUT(req: NextRequest, { params }: P) {
  const guard = await authGuard(req, "action_edit_contract");
  if ("response" in guard) return guard.response;
  const { id: idStr } = await params;
  const contractId = Number(idStr);
  if (!Number.isFinite(contractId)) return jsonError("معرف غير صالح");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const raw = Array.isArray(body.components) ? body.components : [];
  const comps: ContractComponentDTO[] = raw.map((x) => {
    const c = x as Record<string, unknown>;
    return {
      compKey: String(c.compKey ?? ""),
      label: String(c.label ?? ""),
      kind: String(c.kind ?? "qty"),
      enabled: Boolean(c.enabled),
      qty: Number(c.qty ?? 1),
      months: Number(c.months ?? 0),
      monthly: Number(c.monthly ?? 0),
    };
  });
  const count = await saveContractComponents(contractId, comps);
  return ok({ count });
}
