"use client";

/**
 * كشف المقاول الموحّد (Task 63) — جدول واحد مشترك بين ملف العميل وصفحة المقاول:
 * لكل عقد باطن: بنوده كاملة (وصف/وحدة/كمية/سعر/قيمة) وفوقها/تحتها جدول الدفعات
 * الموحّد (دفعات العميل مقابل دفعات المقاول على نفس السطر).
 * · منطق الحساب لا يمسّه هذا المكوّن — يستقبل الأرقام جاهزة من الـ API
 *   (نفس أرقام pay-view حرفيًا: المستحق/المسدد/المتبقي/بانتظار التحصيل)
 * · مقاول ثانٍ = كتلة ثانية مستقلة من نفس المكوّن.
 */

import * as React from "react";
import { Banknote, ListTree, PackageOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatKWD } from "@/lib/format";
import { PayBlockCard, UnifiedPayTable } from "./pay-tables";
import type { PayViewLine, PayViewSubLine, SubLedgerItem } from "./contrack-types";

export function SubcontractorLedger({
  name,
  subCode,
  amount,
  status,
  items,
  itemsTotal,
  clientLines,
  subLines,
  planTotal,
  paid,
  waiting,
  currency = "د.ك",
  manager = false,
  onPay,
  onManageItems,
}: {
  name: string;
  subCode: string;
  amount: number;
  status: string;
  items: SubLedgerItem[];
  itemsTotal: number;
  clientLines: PayViewLine[];
  subLines: PayViewSubLine[];
  planTotal: number;
  paid: number;
  waiting: number;
  currency?: string;
  manager?: boolean;
  onPay?: () => void;
  onManageItems?: () => void;
}) {
  const cur = currency;
  return (
    <PayBlockCard
      title={`${name}${subCode ? ` (${subCode})` : ""} · قيمة العقد ${formatKWD(amount)} ${cur}${status ? ` · ${status}` : ""}`}
      titleTone={status === "ملغى" ? "text-status-danger" : ""}
      action={
        <>
          {onManageItems && (
            <Button variant="outline" size="sm" className="h-8 gap-1" onClick={onManageItems} title="فتح تفاصيل العقد الباطن — إدارة البنود وخطة الدفعات">
              <ListTree className="size-3.5" />
              البنود والتفاصيل
            </Button>
          )}
          {manager && onPay && status !== "ملغى" && (
            <Button size="sm" className="h-8 gap-1" onClick={onPay} title="صرف لمقاول الباطن — تختار الدفعة المستحقة بنفسك من داخل السند">
              <Banknote className="size-3.5" />
              ＋ سند صرف
            </Button>
          )}
        </>
      }
    >
      {/* ===== جدول البنود (مشترك — نفس البيانات في ملف العميل وصفحة المقاول) ===== */}
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          لا بنود على هذا العقد الباطن بعد — تُدار من «البنود والتفاصيل».
        </p>
      ) : (
        <>
          {/* جدول — الحاسوب */}
          <Card className="hidden overflow-hidden md:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="w-10 text-center">#</TableHead>
                  <TableHead>البند</TableHead>
                  <TableHead className="w-20">الوحدة</TableHead>
                  <TableHead className="w-24 text-end">الكمية</TableHead>
                  <TableHead className="w-28 text-end">سعر الوحدة</TableHead>
                  <TableHead className="w-28 text-end">القيمة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it, i) => (
                  <TableRow key={it.id}>
                    <TableCell className="text-center text-muted-foreground tabular-nums" dir="ltr">{i + 1}</TableCell>
                    <TableCell className="font-medium">{it.description}</TableCell>
                    <TableCell className="text-muted-foreground">{it.unit || "—"}</TableCell>
                    <TableCell className="text-end tabular-nums" dir="ltr">{formatKWD(it.qty)}</TableCell>
                    <TableCell className="text-end tabular-nums" dir="ltr">{formatKWD(it.unitPrice)}</TableCell>
                    <TableCell className="text-end font-bold tabular-nums" dir="ltr">{formatKWD(it.amount)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/40 font-medium hover:bg-muted/40">
                  <TableCell colSpan={5} className="text-xs">إجمالي البنود ({items.length} بندًا)</TableCell>
                  <TableCell className="text-end text-xs tabular-nums" dir="ltr">{formatKWD(itemsTotal)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Card>

          {/* بطاقات — الموبايل */}
          <div className="space-y-1.5 md:hidden">
            {items.map((it, i) => (
              <div key={it.id} className="rounded-md border px-2.5 py-2 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{it.description}</span>
                  <span className="shrink-0 font-bold tabular-nums" dir="ltr">{formatKWD(it.amount)}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
                  <span className="tabular-nums" dir="ltr">#{i + 1}</span>
                  {it.unit ? <span>{it.unit}</span> : null}
                  <span className="tabular-nums" dir="ltr">كمية: {formatKWD(it.qty)}</span>
                  <span className="tabular-nums" dir="ltr">سعر: {formatKWD(it.unitPrice)}</span>
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between rounded-md bg-muted/40 px-2.5 py-1.5 text-xs font-medium">
              <span>إجمالي البنود ({items.length} بندًا)</span>
              <span className="tabular-nums" dir="ltr">{formatKWD(itemsTotal)}</span>
            </div>
          </div>
        </>
      )}

      {/* ===== جدول الدفعات الموحّد (دفعات العميل مقابل دفعات المقاول) ===== */}
      <p className="pt-1 text-xs font-semibold text-muted-foreground">
        <PackageOpen className="mb-0.5 inline size-3.5" /> الدفعات الموحّدة — دفعات العميل مقابل دفعات المقاول
      </p>
      {clientLines.length === 0 && subLines.length === 0 ? (
        <p className="text-xs text-muted-foreground">لا خطة دفعات على هذا العقد الباطن — تُدار من «البنود والتفاصيل».</p>
      ) : (
        <>
          <UnifiedPayTable clientLines={clientLines} subLines={subLines} />
          <p className="text-xs text-muted-foreground">
            الإجمالي {formatKWD(planTotal)} {cur} · مسدَّد {formatKWD(paid)} · متبقٍ {formatKWD(Math.max(0, planTotal - paid))}
            {waiting > 0 ? ` · بانتظار تحصيل العميل ${formatKWD(waiting)}` : ""}
          </p>
        </>
      )}
    </PayBlockCard>
  );
}
