"use client";

/**
 * SubsidiariesLedger.tsx — تاب «الذمم الفرعية» في دليل الحسابات (البند الثالث NOVA).
 * صف لكل عقد: حسابا الذمم (1121xxxx) وWIP (1125xxxx) بأكوادهما الحتمية وأرصدتهما
 * من الأستاذ + المفوتر/المحصّل/المستحق من الفواتير + زر ضمان حسابات كل العقود.
 * docs/subsidiary-wip-design.md §3
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Network, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { formatKWD } from "@/lib/format";

import { ApiError, apiGet, apiPost } from "./api";

interface SubAccountInfo {
  code: string;
  name: string;
  exists: boolean;
  active: boolean;
  balance: number | null;
}

interface SubsidiaryRow {
  contractId: number;
  contractNumber: string;
  contractName: string;
  customerName: string;
  status: string;
  amount: number;
  ar: SubAccountInfo;
  wip: SubAccountInfo;
  billed: number;
  settled: number;
  outstanding: number;
  provisioned: boolean;
}

interface SubsidiariesResponse {
  rows: SubsidiaryRow[];
  wipControlCode: string;
}

export default function SubsidiariesLedger() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const query = useQuery<SubsidiariesResponse, Error>({
    queryKey: ["accounts-subsidiaries"],
    queryFn: async () => apiGet<SubsidiariesResponse>("/api/accounts/subsidiaries"),
  });

  const backfillMutation = useMutation({
    mutationFn: async () =>
      apiPost<{ contracts: number; accountsCreated: number; wipControlCreated: boolean }>(
        "/api/accounts/subsidiaries",
        {}
      ),
    onSuccess: (res) => {
      toast({
        title: "تم ضمان الحسابات الفرعية",
        description: `العقود: ${res.contracts} — حسابات أُنشئت: ${res.accountsCreated}${res.wipControlCreated ? " — وأُنشئ حساب التحكم 1125 (WIP)" : ""}`,
      });
      qc.invalidateQueries({ queryKey: ["accounts-subsidiaries"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (e: ApiError) => {
      toast({ title: "تعذّر ضمان الحسابات", description: e.message, variant: "destructive" });
    },
  });

  const rows = query.data?.rows ?? [];
  const provisioned = rows.filter((r) => r.provisioned).length;
  const totalOutstanding = rows.reduce((s, r) => s + r.outstanding, 0);
  const totalWip = rows.reduce((s, r) => s + (r.wip.balance ?? 0), 0);

  const accCell = (acc: SubAccountInfo) => (
    <div className="flex items-center gap-1.5">
      <span className="font-mono text-xs">{acc.code}</span>
      {!acc.exists ? (
        <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-muted-foreground">غير مُنشأ</Badge>
      ) : !acc.active ? (
        <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-status-warn">معطّل</Badge>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-2 py-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="h-6">
              <Network className="me-1 size-3.5" />
              {rows.length} عقدًا — محجوز {provisioned}
            </Badge>
            <Badge variant="outline" className="h-6">إجمالي المستحق: {formatKWD(totalOutstanding)} د.ك</Badge>
            <Badge variant="outline" className="h-6">رصيد WIP: {formatKWD(totalWip)} د.ك</Badge>
            <span className="hidden text-muted-foreground lg:inline">
              الذمم تُرحَّل آليًا على فرعي العقد منذ الجسر — فواتير ما قبله تبقى على الحساب الأب 1121.
            </span>
          </div>
          <Button
            size="sm"
            className="h-9 gap-1.5"
            disabled={backfillMutation.isPending || query.isLoading}
            onClick={() => backfillMutation.mutate()}
          >
            <RefreshCw className="size-4" />
            {backfillMutation.isPending ? "جارٍ الضمان…" : "ضمان حسابات كل العقود"}
          </Button>
        </CardContent>
      </Card>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-44">العقد</TableHead>
              <TableHead className="min-w-32">العميل</TableHead>
              <TableHead className="w-32">حساب الذمم</TableHead>
              <TableHead className="w-28 text-start">رصيده</TableHead>
              <TableHead className="w-32">حساب WIP</TableHead>
              <TableHead className="w-28 text-start">رصيده</TableHead>
              <TableHead className="w-24 text-start">مفوتر</TableHead>
              <TableHead className="w-24 text-start">محصّل</TableHead>
              <TableHead className="w-24 text-start">المستحق</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading ? (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                  جارٍ التحميل…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                  لا عقود بعد — أنشئ عقدًا وستُحجز حساباته الفرعية آليًا.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.contractId}>
                  <TableCell>
                    <div className="font-medium">{r.contractName || `عقد ${r.contractNumber}`}</div>
                    <div className="font-mono text-xs text-muted-foreground">{r.contractNumber}</div>
                  </TableCell>
                  <TableCell className="text-sm">{r.customerName || "—"}</TableCell>
                  <TableCell>{accCell(r.ar)}</TableCell>
                  <TableCell className="text-sm tabular-nums">
                    {r.ar.balance === null ? "—" : formatKWD(r.ar.balance)}
                  </TableCell>
                  <TableCell>{accCell(r.wip)}</TableCell>
                  <TableCell className="text-sm tabular-nums">
                    {r.wip.balance === null ? "—" : formatKWD(r.wip.balance)}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">{formatKWD(r.billed)}</TableCell>
                  <TableCell className="text-sm tabular-nums">{formatKWD(r.settled)}</TableCell>
                  <TableCell className="text-sm font-medium tabular-nums">{formatKWD(r.outstanding)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
