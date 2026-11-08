"use client";

/**
 * BalancesSection.tsx — قسم «الأرصدة والتقارير» لموديول المخازن (§7):
 * مصفوفة الأرصدة الاشتقاقية (صنف×مستودع) بشارة الحد الأدنى + كشف حركة صنف
 * + تقرير انحراف المواد على بنود العقد (درس G1 المحقق — FK حقيقي).
 */

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Boxes, TrendingUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, apiGet } from "../api";
import { cn } from "@/lib/utils";
import { SearchableSelect } from "../SearchableSelect";
import { fmtMoney, fmtNum, fmtQty } from "../WarehousesView";

interface Props {
  onAuthError: () => void;
}

// ==================== أنواع ====================

interface BalanceRow {
  itemId: number;
  warehouseId: number;
  qty: number;
  value: number;
  wac: number;
  itemName: string;
  unit: string;
  category: string;
  minQty: number;
  warehouseName: string;
  belowMin: boolean;
}

interface MovementRow {
  date: string;
  docId: number;
  docNumber: string;
  kind: string;
  kindLabel: string;
  warehouseId: number;
  warehouseName: string;
  direction: "in" | "out";
  qty: number;
  snapUnitCost: number;
  amount: number;
  contractNumber: string;
  party: string;
  note: string;
  balanceQty: number;
  balanceValue: number;
  wac: number;
}

interface DeviationRow {
  boqItemId: number;
  description: string;
  unit: string;
  contractQty: number;
  contractValue: number;
  issuedQty: number;
  issuedValue: number;
  remainingQty: number;
  overQty: number;
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn("px-3 py-2 text-start text-[11px] font-semibold text-muted-foreground", className)}>{children}</th>;
}

function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn("px-3 py-2 text-[13px]", className)}>{children}</td>;
}

// ==================== القسم ====================

export function BalancesSection({ onAuthError }: Props) {
  const [asOf, setAsOf] = React.useState("");
  const [fWarehouse, setFWarehouse] = React.useState("all");
  const [search, setSearch] = React.useState("");

  const warehousesQuery = useQuery<{ warehouses: { id: number; name: string }[] }>({
    queryKey: ["warehouses", "warehouses"],
    queryFn: () => apiGet<{ warehouses: { id: number; name: string }[] }>("/api/warehouses/warehouses"),
  });
  const warehouses = warehousesQuery.data?.warehouses ?? [];

  const balParams = new URLSearchParams();
  if (asOf) balParams.set("asOf", asOf);
  const balancesQuery = useQuery<{ balances: BalanceRow[]; totals: { qty: number; value: number } }>({
    queryKey: ["warehouses", "balances", asOf],
    queryFn: () => apiGet<{ balances: BalanceRow[]; totals: { qty: number; value: number } }>(`/api/warehouses/balances?${balParams.toString()}`),
  });

  const allBalances = balancesQuery.data?.balances ?? [];
  const balances = allBalances.filter(
    (b) =>
      (fWarehouse === "all" || String(b.warehouseId) === fWarehouse) &&
      (!search.trim() || b.itemName.includes(search.trim()))
  );

  const [ledgerTarget, setLedgerTarget] = React.useState<{ itemId: number; itemName: string; warehouseId: number | null } | null>(null);

  return (
    <div className="space-y-4">
      {/* الأرصدة */}
      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Boxes className="size-4 text-primary/70" />
            الأرصدة الاشتقاقية
          </h2>
          <Input
            className="h-8 w-40 text-xs"
            placeholder="بحث بالصنف…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="بحث بالصنف"
          />
          <WhPicker value={fWarehouse} onValueChange={setFWarehouse} warehouses={warehouses} />
          <div className="ms-auto flex items-center gap-2">
            <Label className="text-[11px] text-muted-foreground">حتى تاريخ</Label>
            <Input type="date" className="h-8 w-36 text-xs" value={asOf} onChange={(e) => setAsOf(e.target.value)} aria-label="حتى تاريخ" />
          </div>
        </div>

        {balancesQuery.data && (
          <div className="mb-3 flex flex-wrap gap-3 rounded-md border bg-muted/30 p-3 text-[13px]">
            <span>
              إجمالي الكمية: <b className="tabular-nums">{fmtQty(balancesQuery.data.totals.qty)}</b>
            </span>
            <span>
              إجمالي القيمة: <b className="tabular-nums">{fmtMoney(balancesQuery.data.totals.value)}</b>
            </span>
            <span className="text-muted-foreground">الأرصدة محسوبة من الأسطر لحظة السؤال — لا جدول أرصدة (G9)</span>
          </div>
        )}

        {balancesQuery.isLoading ? (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="mb-2 h-9 w-full" />)
        ) : balances.length === 0 ? (
          <div className="py-10 text-center">
            <Boxes className="mx-auto size-8 text-muted-foreground/50" />
            <p className="mt-2 text-sm font-medium">لا أرصدة</p>
            <p className="text-xs text-muted-foreground">أدخل أذون إدخال لتظهر الأرصدة هنا تلقائيًا</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="border-b">
                  <Th>الصنف</Th>
                  <Th>المستودع</Th>
                  <Th>الكمية</Th>
                  <Th>الحد الأدنى</Th>
                  <Th>المتوسط المرجحي</Th>
                  <Th>القيمة</Th>
                  <Th className="w-24">حركة</Th>
                </tr>
              </thead>
              <tbody>
                {balances.map((b) => (
                  <tr key={`${b.itemId}-${b.warehouseId}`} className="border-b last:border-0 hover:bg-muted/40">
                    <Td>
                      <span className="font-medium">{b.itemName}</span>
                      {b.unit && <span className="text-muted-foreground"> ({b.unit})</span>}
                      {b.category && <span className="block text-[11px] text-muted-foreground">{b.category}</span>}
                    </Td>
                    <Td className="text-muted-foreground">{b.warehouseName}</Td>
                    <Td className="tabular-nums font-medium">{fmtQty(b.qty)}</Td>
                    <Td className="tabular-nums text-muted-foreground">{b.minQty > 0 ? fmtQty(b.minQty) : "—"}</Td>
                    <Td className="tabular-nums">{fmtMoney(b.wac)}</Td>
                    <Td className="tabular-nums font-medium">{fmtMoney(b.value)}</Td>
                    <Td>
                      <div className="flex items-center gap-1">
                        {b.belowMin && (
                          <Badge className="h-5 bg-status-warn-bg px-1.5 text-[10px] text-status-warn" title={`الحد الأدنى ${b.minQty}`}>
                            تحت الحد الأدنى
                          </Badge>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 text-xs"
                          onClick={() => setLedgerTarget({ itemId: b.itemId, itemName: b.itemName, warehouseId: b.warehouseId })}
                        >
                          كشف الحركة
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* انحراف المواد على بنود العقد */}
      <DeviationCard />

      {/* كشف الحركة */}
      {ledgerTarget && (
        <MovementLedgerDialog
          target={ledgerTarget}
          warehouses={warehouses}
          onAuthError={onAuthError}
          onClose={() => setLedgerTarget(null)}
        />
      )}
    </div>
  );
}

/** منتقي مستودع صغير */
function WhPicker({
  value,
  onValueChange,
  warehouses,
}: {
  value: string;
  onValueChange: (v: string) => void;
  warehouses: { id: number; name: string }[];
}) {
  return (
    <select
      className="h-8 rounded-md border bg-background px-2 text-xs"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      aria-label="المستودع"
    >
      <option value="all">كل المستودعات</option>
      {warehouses.map((w) => (
        <option key={w.id} value={String(w.id)}>
          {w.name}
        </option>
      ))}
    </select>
  );
}

// ==================== كشف حركة الصنف ====================

function MovementLedgerDialog({
  target,
  warehouses,
  onAuthError,
  onClose,
}: {
  target: { itemId: number; itemName: string; warehouseId: number | null };
  warehouses: { id: number; name: string }[];
  onAuthError: () => void;
  onClose: () => void;
}) {
  const [whId, setWhId] = React.useState(target.warehouseId ? String(target.warehouseId) : "all");
  React.useEffect(() => {
    setWhId(target.warehouseId ? String(target.warehouseId) : "all");
  }, [target]);

  const params = new URLSearchParams({ itemId: String(target.itemId) });
  if (whId !== "all") params.set("warehouseId", whId);
  const q = useQuery<{ item: { id: number; name: string; unit: string }; movements: MovementRow[] }>({
    queryKey: ["warehouses", "movements", target.itemId, whId],
    queryFn: () =>
      apiGet<{ item: { id: number; name: string; unit: string }; movements: MovementRow[] }>(
        `/api/warehouses/movements?${params.toString()}`
      ),
  });

  const rows = q.data?.movements ?? [];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>كشف حركة: {target.itemName}</DialogTitle>
          <DialogDescription>كل الحركات المرحّلة بالترتيب الزمني — والرصيد الجاري مشتق بتراكمها (لا مصدر ثانٍ)</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Label className="text-[11px] text-muted-foreground">المستودع</Label>
          <select
            className="h-8 rounded-md border bg-background px-2 text-xs"
            value={whId}
            onChange={(e) => setWhId(e.target.value)}
            aria-label="مستودع كشف الحركة"
          >
            <option value="all">الكل</option>
            {warehouses.map((w) => (
              <option key={w.id} value={String(w.id)}>
                {w.name}
              </option>
            ))}
          </select>
        </div>

        {q.isLoading ? (
          [0, 1, 2].map((i) => <Skeleton key={i} className="mb-2 h-8 w-full" />)
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">لا حركات بالفلاتر الحالية</p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full min-w-[640px]">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b">
                  <Th>التاريخ</Th>
                  <Th>الإذن</Th>
                  <Th>المستودع</Th>
                  <Th>الاتجاه</Th>
                  <Th>الكمية</Th>
                  <Th>الرصيد الجاري</Th>
                  <Th>العقد/الطرف</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m, i) => (
                  <tr key={`${m.docId}-${i}`} className="border-b last:border-0">
                    <Td className="tabular-nums text-muted-foreground">{m.date}</Td>
                    <Td>
                      <span className="font-medium tabular-nums">{m.docNumber}</span>
                      <span className="block text-[10px] text-muted-foreground">{m.kindLabel}</span>
                    </Td>
                    <Td className="text-muted-foreground">{m.warehouseName}</Td>
                    <Td>
                      {m.direction === "in" ? (
                        <span className="flex items-center gap-1 text-status-done">
                          <ArrowDown className="size-3" />
                          وارد
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-status-warn">
                          <ArrowUp className="size-3" />
                          منصرف
                        </span>
                      )}
                    </Td>
                    <Td className="tabular-nums">
                      {m.direction === "in" ? "+" : "−"}
                      {fmtQty(m.qty)}
                    </Td>
                    <Td className="tabular-nums">
                      {fmtQty(m.balanceQty)}
                      <span className="block text-[10px] text-muted-foreground">بقيمة {fmtMoney(m.balanceValue)}</span>
                    </Td>
                    <Td className="text-muted-foreground">{m.contractNumber || m.party || "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ==================== انحراف المواد على بنود العقد (G1) ====================

function DeviationCard() {
  const [contractId, setContractId] = React.useState("");

  const contractsQuery = useQuery<{ contracts: { id: number; contractNumber: string; contractName: string; status: string }[] }>({
    queryKey: ["wh-contracts-deviation"],
    queryFn: () => apiGet<{ contracts: { id: number; contractNumber: string; contractName: string; status: string }[] }>("/api/contracts"),
  });
  const contracts = (contractsQuery.data?.contracts ?? []).filter((c) => c.status !== "ملغى" && c.status !== "مسودة");

  const q = useQuery<{
    contract: { id: number; contractNumber: string; contractName: string; status: string };
    rows: DeviationRow[];
    summary: { totalContractValue: number; totalIssuedValue: number; returnQty: number; returnValue: number; netIssuedValue: number };
  }>({
    queryKey: ["warehouses", "deviation", contractId],
    queryFn: () => apiGet(`/api/warehouses/deviation?contractId=${contractId}`),
    enabled: !!contractId,
  });

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <TrendingUp className="size-4 text-primary/70" />
          انحراف المواد على بنود العقد
        </h2>
        <div className="w-72">
          <SearchableSelect
            value={contractId}
            onValueChange={setContractId}
            options={contracts.map((c) => ({ value: String(c.id), label: `${c.contractNumber}${c.contractName ? ` — ${c.contractName}` : ""}` }))}
            placeholder="اختر عقدًا…"
          />
        </div>
      </div>

      {!contractId ? (
        <p className="py-6 text-center text-sm text-muted-foreground">اختر عقدًا لعرض التعاقدي مقابل المنصرف من المخازن على كل بند</p>
      ) : q.isLoading ? (
        [0, 1, 2].map((i) => <Skeleton key={i} className="mb-2 h-8 w-full" />)
      ) : !q.data || q.data.rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">العقد بلا بنود كميات</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3 rounded-md border bg-muted/30 p-3 text-[13px]">
            <span>
              التعاقدي: <b className="tabular-nums">{fmtMoney(q.data.summary.totalContractValue)}</b>
            </span>
            <span>
              المصروف من المخازن: <b className="tabular-nums">{fmtMoney(q.data.summary.totalIssuedValue)}</b>
            </span>
            <span className="text-status-done">
              مرتجع: <b className="tabular-nums">{fmtQty(q.data.summary.returnQty)}</b> بقيمة {fmtMoney(q.data.summary.returnValue)}
            </span>
            <span>
              الصافي: <b className="tabular-nums">{fmtMoney(q.data.summary.netIssuedValue)}</b>
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="border-b">
                  <Th>البند</Th>
                  <Th>تعاقدي</Th>
                  <Th>مصروف</Th>
                  <Th>المتبقي</Th>
                  <Th>قيمة تعاقدية</Th>
                  <Th>قيمة مصروفة</Th>
                </tr>
              </thead>
              <tbody>
                {q.data.rows.map((r) => (
                  <tr key={r.boqItemId} className="border-b last:border-0 hover:bg-muted/40">
                    <Td className="font-medium">
                      {r.description}
                      {r.unit && <span className="text-muted-foreground"> ({r.unit})</span>}
                    </Td>
                    <Td className="tabular-nums">{fmtQty(r.contractQty)}</Td>
                    <Td className="tabular-nums">{fmtQty(r.issuedQty)}</Td>
                    <Td>
                      <span className={cn("tabular-nums", r.remainingQty < 0 ? "font-bold text-status-danger" : "")}>
                        {fmtQty(r.remainingQty)}
                      </span>
                      {r.overQty > 0 && (
                        <Badge className="ms-1.5 h-5 bg-status-danger-bg px-1.5 text-[10px] text-status-danger">
                          تجاوز {fmtNum(r.overQty)}
                        </Badge>
                      )}
                    </Td>
                    <Td className="tabular-nums text-muted-foreground">{fmtMoney(r.contractValue)}</Td>
                    <Td className="tabular-nums font-medium">{fmtMoney(r.issuedValue)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}
