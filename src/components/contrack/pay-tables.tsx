"use client";

/**
 * جداول الدفعات المشتركة — مصدر واحد للحقيقة بين شاشة العقد وصفحة المقاول:
 * · PayBlockCard — غلاف كتلة دفعات (بلوك المكتبي _new_pay_block)
 * · UnifiedPayTable — دفعات العميل مقابل خطوط الباطن المرتبطة بها على نفس السطر
 *   (مرجع المكتبي: ui/sub_pay_blocks.build_unified_table V9.1 — كل خط باطن يُسند
 *   إلى أول دفعة عميل من مصادره، وخطوط بلا مصدر تُلحق أسفل الجدول)
 * · PlanTable — خطة دفعات عادية (عميل أو باطن)
 * انتقلت حرفيًا من ContractDetailView (Task 63) لتُشارك مع SubcontractorLedger.
 */

import * as React from "react";
import { Lock, Plus, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PAYMENT_STATUS_LABEL, fmtDate, formatKWD } from "@/lib/format";
import { StatusBadge } from "./StatusBadge";
import type { PayViewLine, PayViewSubLine } from "./contrack-types";

export function PayBlockCard({
  title,
  titleTone,
  action,
  children,
}: {
  title: string;
  titleTone?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className={`text-sm font-bold ${titleTone || ""}`}>{title}</h3>
        {action}
      </div>
      <div className="space-y-2">{children}</div>
    </Card>
  );
}

export function UnifiedPayTable({
  clientLines,
  subLines,
}: {
  clientLines: PayViewLine[];
  subLines: PayViewSubLine[];
}) {
  const order = new Map(clientLines.map((c, i) => [c.id, i] as const));
  const groups = new Map<number, PayViewSubLine[]>();
  const unassigned: PayViewSubLine[] = [];
  for (const sl of subLines) {
    const cands = (sl.sourceIds || []).filter((id) => order.has(id));
    if (cands.length === 0) {
      unassigned.push(sl);
      continue;
    }
    const parent = cands.reduce((a, b) =>
      (order.get(b) ?? Number.MAX_SAFE_INTEGER) < (order.get(a) ?? Number.MAX_SAFE_INTEGER) ? b : a
    );
    const arr = groups.get(parent);
    if (arr) arr.push(sl);
    else groups.set(parent, [sl]);
  }

  const cTot = clientLines.reduce((s, l) => s + (l.amountN || 0), 0);
  const cPaid = clientLines.reduce((s, l) => s + (l.covered || 0), 0);
  const sTot = subLines.reduce((s, l) => s + (l.amountN || 0), 0);
  const sPaid = subLines.reduce((s, l) => s + (l.covered || 0), 0);

  const rs = (n: number) => (n > 1 ? n : undefined);
  const clientCells = (l: PayViewLine, span: number) => (
    <>
      <TableCell rowSpan={rs(span)}>
        <div className="font-medium">{l.title}</div>
        {l.notes ? <div className="text-xs text-muted-foreground">{l.notes}</div> : null}
      </TableCell>
      <TableCell className="text-end font-bold tabular-nums" dir="ltr" rowSpan={rs(span)}>
        {formatKWD(l.amountN)}
      </TableCell>
      <TableCell className="text-end tabular-nums text-status-done" dir="ltr" rowSpan={rs(span)}>
        {formatKWD(l.covered)}
      </TableCell>
      <TableCell rowSpan={rs(span)}>
        <StatusBadge
          status={l.state}
          label={l.stateLabel || PAYMENT_STATUS_LABEL[l.state] || l.state}
          className="px-2 py-0.5 text-[11px]"
        />
      </TableCell>
    </>
  );
  const subCells = (l: PayViewSubLine) => (
    <>
      <TableCell>
        <span className="flex items-center gap-1.5 font-medium">
          {l.gated ? <Lock className="size-3 text-muted-foreground" aria-label="مقفلة بانتظار مصادرها" /> : null}
          {l.title}
        </span>
      </TableCell>
      <TableCell className="text-end tabular-nums" dir="ltr">
        {formatKWD(l.amountN)}
      </TableCell>
      <TableCell className="text-end tabular-nums text-status-done" dir="ltr">
        {formatKWD(l.covered)}
      </TableCell>
      <TableCell>
        <StatusBadge
          status={l.state}
          label={l.stateLabel || PAYMENT_STATUS_LABEL[l.state] || l.state}
          className="px-2 py-0.5 text-[11px]"
        />
      </TableCell>
    </>
  );
  const dashClient = (
    <TableCell colSpan={4} className="text-center text-muted-foreground">
      —
    </TableCell>
  );

  return (
    <>
      {/* جدول — الحاسوب */}
      <Card className="hidden overflow-hidden md:block">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead colSpan={4} className="text-center text-primary">
                دفعات العميل
              </TableHead>
              <TableHead colSpan={4} className="text-center">
                دفعات المقاول
              </TableHead>
            </TableRow>
            <TableRow>
              <TableHead>الدفعة</TableHead>
              <TableHead className="w-24 text-end">المبلغ</TableHead>
              <TableHead className="w-24 text-end">المسدّد</TableHead>
              <TableHead className="w-28">الحالة</TableHead>
              <TableHead>الدفعة</TableHead>
              <TableHead className="w-24 text-end">المبلغ</TableHead>
              <TableHead className="w-24 text-end">المسدّد</TableHead>
              <TableHead className="w-28">الحالة</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clientLines.map((cl) => {
              const subs = groups.get(cl.id) || [];
              if (subs.length === 0) {
                return (
                  <TableRow key={`c${cl.id}`}>
                    {clientCells(cl, 1)}
                    {dashClient}
                  </TableRow>
                );
              }
              return subs.map((sl, k) => (
                <TableRow key={`c${cl.id}s${sl.id}`}>
                  {k === 0 ? clientCells(cl, subs.length) : null}
                  {subCells(sl)}
                </TableRow>
              ));
            })}
            {unassigned.map((sl) => (
              <TableRow key={`u${sl.id}`}>
                {dashClient}
                {subCells(sl)}
              </TableRow>
            ))}
            {clientLines.length === 0 && subLines.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-6 text-center text-sm text-muted-foreground">
                  لا خطوط دفعات بعد.
                </TableCell>
              </TableRow>
            )}
            {(clientLines.length > 0 || subLines.length > 0) && (
              <TableRow className="bg-muted/40 font-medium hover:bg-muted/40">
                <TableCell colSpan={4} className="text-xs tabular-nums" dir="ltr">
                  عميل: الإجمالي {formatKWD(cTot)} · المسدّد {formatKWD(cPaid)}
                </TableCell>
                <TableCell colSpan={4} className="text-xs tabular-nums" dir="ltr">
                  مقاول: الإجمالي {formatKWD(sTot)} · المسدّد {formatKWD(sPaid)}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {/* بطاقات — الموبايل */}
      <div className="space-y-2 md:hidden">
        {clientLines.map((cl) => {
          const subs = groups.get(cl.id) || [];
          return (
            <Card key={`m${cl.id}`} className="gap-1 p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium">{cl.title}</span>
                <StatusBadge
                  status={cl.state}
                  label={cl.stateLabel || PAYMENT_STATUS_LABEL[cl.state] || cl.state}
                  className="px-2 py-0.5 text-[10px]"
                />
              </div>
              <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                <span className="tabular-nums" dir="ltr">
                  المبلغ: {formatKWD(cl.amountN)}
                </span>
                <span className="tabular-nums text-status-done" dir="ltr">
                  المسدّد: {formatKWD(cl.covered)}
                </span>
              </div>
              {subs.length > 0 && (
                <div className="mt-1 space-y-1 border-t pt-1.5">
                  {subs.map((sl) => (
                    <div
                      key={sl.id}
                      className="flex flex-wrap items-center justify-between gap-1.5 rounded-md border px-2 py-1 text-xs"
                    >
                      <span className="flex items-center gap-1 font-medium">
                        {sl.gated ? <Lock className="size-3 text-muted-foreground" /> : null}
                        {sl.title}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="tabular-nums" dir="ltr">
                          {formatKWD(sl.amountN)}
                        </span>
                        <StatusBadge
                          status={sl.state}
                          label={sl.stateLabel || PAYMENT_STATUS_LABEL[sl.state] || sl.state}
                          className="px-1.5 py-0 text-[10px]"
                        />
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
        {unassigned.map((sl) => (
          <Card key={`mu${sl.id}`} className="gap-1 p-3">
            <div className="flex items-start justify-between gap-2">
              <span className="flex items-center gap-1 font-medium">
                {sl.gated ? <Lock className="size-3 text-muted-foreground" /> : null}
                {sl.title}
              </span>
              <StatusBadge
                status={sl.state}
                label={sl.stateLabel || PAYMENT_STATUS_LABEL[sl.state] || sl.state}
                className="px-2 py-0.5 text-[10px]"
              />
            </div>
            <p className="text-[10px] text-muted-foreground">بلا دفعة عميل مرتبطة</p>
            <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
              <span className="tabular-nums" dir="ltr">
                المبلغ: {formatKWD(sl.amountN)}
              </span>
              <span className="tabular-nums text-status-done" dir="ltr">
                المسدّد: {formatKWD(sl.covered)}
              </span>
            </div>
          </Card>
        ))}
        {clientLines.length === 0 && subLines.length === 0 && (
          <Card>
            <CardContent className="p-4 text-center text-sm text-muted-foreground">
              لا خطوط دفعات بعد.
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}

export function PlanTable({
  lines,
  manager,
  onDelete,
  readOnly,
  onAdd,
}: {
  lines: { id: number; title: string; dueDate: string; amountN: number; covered: number; remaining: number; state: string; stateLabel?: string; notes?: string }[];
  manager: boolean;
  onDelete: (id: number) => void;
  readOnly?: boolean;
  onAdd?: () => void;
}) {
  return (
    <>
      {/* جدول — الحاسوب */}
      <Card className="hidden overflow-hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>العنوان</TableHead>
              <TableHead className="w-28">الاستحقاق</TableHead>
              <TableHead className="w-28 text-end">المبلغ</TableHead>
              <TableHead className="w-28 text-end">المغطى</TableHead>
              <TableHead className="w-28 text-end">المتبقي</TableHead>
              <TableHead className="w-32">الحالة</TableHead>
              {manager && !readOnly && <TableHead className="w-16 text-center">حذف</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((ln) => (
              <TableRow key={ln.id}>
                <TableCell>
                  <div className="font-medium">{ln.title}</div>
                  {ln.notes ? <div className="text-xs text-muted-foreground">{ln.notes}</div> : null}
                </TableCell>
                <TableCell dir="ltr" className="tabular-nums">{fmtDate(ln.dueDate)}</TableCell>
                <TableCell className="text-end font-bold tabular-nums" dir="ltr">{formatKWD(ln.amountN)}</TableCell>
                <TableCell className="text-end tabular-nums text-status-done" dir="ltr">{formatKWD(ln.covered)}</TableCell>
                <TableCell className="text-end tabular-nums" dir="ltr">{formatKWD(ln.remaining)}</TableCell>
                <TableCell>
                  <StatusBadge
                    status={ln.state}
                    label={ln.stateLabel || PAYMENT_STATUS_LABEL[ln.state] || ln.state}
                    className="px-2 py-0.5 text-[11px]"
                  />
                </TableCell>
                {manager && !readOnly && (
                  <TableCell className="text-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive hover:text-destructive"
                      onClick={() => onDelete(ln.id)}
                      aria-label="حذف الدفعة"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {lines.length === 0 && (
              <TableRow>
                <TableCell colSpan={manager && !readOnly ? 7 : 6} className="py-6 text-center text-sm text-muted-foreground">
                  لا دفعات في الخطة — المستحق هو كامل المتبقي من قيمة العقد.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {/* بطاقات — الموبايل */}
      <div className="space-y-2 md:hidden">
        {lines.map((ln) => (
          <Card key={ln.id} className="gap-1 p-3">
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium">{ln.title}</span>
              <StatusBadge
                status={ln.state}
                label={ln.stateLabel || PAYMENT_STATUS_LABEL[ln.state] || ln.state}
                className="px-2 py-0.5 text-[10px]"
              />
            </div>
            <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
              <span>الاستحقاق: {fmtDate(ln.dueDate)}</span>
              <span className="tabular-nums" dir="ltr">المبلغ: {formatKWD(ln.amountN)}</span>
              <span className="tabular-nums text-status-done" dir="ltr">المغطى: {formatKWD(ln.covered)}</span>
              <span className="tabular-nums" dir="ltr">المتبقي: {formatKWD(ln.remaining)}</span>
            </div>
            {ln.notes && <p className="text-xs text-muted-foreground">{ln.notes}</p>}
            {manager && !readOnly && (
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1 text-destructive hover:text-destructive"
                  onClick={() => onDelete(ln.id)}
                >
                  <Trash2 className="size-3.5" />
                  حذف
                </Button>
              </div>
            )}
          </Card>
        ))}
        {lines.length === 0 && (
          <Card>
            <CardContent className="p-4 text-center text-sm text-muted-foreground">
              لا دفعات في الخطة — المستحق هو كامل المتبقي من قيمة العقد.
            </CardContent>
          </Card>
        )}
      </div>
      {manager && !readOnly && onAdd && (
        <div className="flex justify-end">
          <Button size="sm" className="h-9 gap-1.5" onClick={onAdd}>
            <Plus className="size-4" />
            إضافة دفعة
          </Button>
        </div>
      )}
    </>
  );
}
