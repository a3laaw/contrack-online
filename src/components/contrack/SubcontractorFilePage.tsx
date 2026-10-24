"use client";

/**
 * صفحة المقاول الكاملة (Task 63 — أعاد تصميمها Task 92 بطلب المستخدم):
 * شريط علوي مثبت (رجوع + اسم المقاول + زر تصدير/طباعة) + إجماليات، ثم تخطيط
 * master-detail مثل ملف العميل تمامًا: جانب فيه عقوده الباطنة **بأسماء العملاء**،
 * واختيار عقد يعرض كشفه الموحّد (SubcontractorLedger — نفس المكوّن حرفيًا المعروض
 * في ملف العميل) بدل التكديس العمودي القديم. وزر تصدير لكل العقود أو العقد المختار:
 * Excel (CSV بترميز UTF-8-BOM يفتح في Excel مباشرة) + طباعة HTML نظيفة.
 * البيانات من مصدرها (/api/subcontractors/[id]/ledger بنفس منطق pay-view).
 */

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  FileSpreadsheet,
  HardHat,
  MoreVertical,
  Phone,
  Printer,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, apiGet } from "./api";
import { errMessage, isManagerRole } from "./contrack-types";
import type { SubcontractorLedgerBlock, SubcontractorLedgerResponse, User } from "./contrack-types";
import { formatKWD, statusBadgeClass } from "@/lib/format";
import { printElement } from "@/lib/print-html";
import { SubcontractorLedger } from "./SubcontractorLedger";
import { SubContractDialog } from "./SubContractDialog";
import { VoucherPage } from "./VoucherPage";

interface SubcontractorFilePageProps {
  subcontractorId: number;
  user: User;
  onAuthError: () => void;
  onClose: () => void;
}

export function SubcontractorFilePage({ subcontractorId, user, onAuthError, onClose }: SubcontractorFilePageProps) {
  const qc = useQueryClient();
  const manager = isManagerRole(user.role);

  const ledgerQuery = useQuery<SubcontractorLedgerResponse>({
    queryKey: ["subcontractor-ledger", subcontractorId],
    queryFn: () => apiGet<SubcontractorLedgerResponse>(`/api/subcontractors/${subcontractorId}/ledger`),
  });

  React.useEffect(() => {
    const e = ledgerQuery.error;
    if (e instanceof ApiError && e.status === 401) onAuthError();
  }, [ledgerQuery.error, onAuthError]);

  // تفاصيل/إدارة عقد باطن (البنود وخطة الدفعات) — الحوار المعتمد نفسه
  const [openSubId, setOpenSubId] = React.useState<number | null>(null);
  // الصرف على الباطن — صفحة سند كاملة
  const [payPage, setPayPage] = React.useState<{ subContractId: number; subLabel?: string } | null>(null);
  // العقد الباطن المختار في تخطيط master-detail (Task 92)
  const [selectedId, setSelectedId] = React.useState<number | null>(null);

  const invalidateLedger = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["subcontractor-ledger", subcontractorId] });
    qc.invalidateQueries({ queryKey: ["sub-contracts"] });
    qc.invalidateQueries({ queryKey: ["subcontractors"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  }, [qc, subcontractorId]);

  const d = ledgerQuery.data;

  // اختيار أول عقد تلقائيًا — والبقاء على المختار عند التحديث، والانتقال للأول إن حُذف
  React.useEffect(() => {
    if (!d) return;
    if (selectedId == null || !d.blocks.some((b) => b.id === selectedId)) {
      setSelectedId(d.blocks[0]?.id ?? null);
    }
  }, [d, selectedId]);

  if (payPage) {
    return (
      <VoucherPage
        user={user}
        onAuthError={onAuthError}
        mode="payment"
        preset={{ vtype: "payment", subMode: true, subContractId: payPage.subContractId }}
        onSaved={() => {
          invalidateLedger();
          setPayPage(null);
        }}
        onCancel={() => setPayPage(null)}
      />
    );
  }

  const blocks = d?.blocks ?? [];
  const sel = blocks.find((b) => b.id === selectedId) ?? null;

  // ==================== التصدير: Excel (CSV) وطباعة HTML — كل العقود أو العقد المختار ====================
  const csvEscape = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const downloadCsv = (scope: "all" | "one") => {
    if (!d) return;
    const list = scope === "all" ? blocks : sel ? [sel] : [];
    if (list.length === 0) return;
    const lines: string[] = [];
    lines.push(`كشف المقاول — ${d.item.name}${d.item.subCode ? ` (${d.item.subCode})` : ""}`);
    lines.push("");
    // البنود
    lines.push("القسم,العقد,العميل,البند,الوحدة,الكمية,سعر الوحدة,القيمة");
    for (const b of list) {
      if (b.items.length === 0) {
        lines.push(["بنود", b.contractNumber, b.customerName, "لا بنود", "", "", "", ""].map(csvEscape).join(","));
      }
      for (const it of b.items) {
        lines.push(
          ["بنود", b.contractNumber, b.customerName, it.description, it.unit, it.qty, it.unitPrice, it.amount]
            .map(csvEscape)
            .join(",")
        );
      }
    }
    lines.push("");
    // خطة الدفعات
    lines.push("القسم,العقد,العميل,الدفعة,الاستحقاق,المبلغ,المسدد,المتبقي,الحالة");
    for (const b of list) {
      const lines2 = b.plan?.lines ?? [];
      if (lines2.length === 0) {
        lines.push(["دفعات", b.contractNumber, b.customerName, "لا دفعات", "", "", "", "", ""].map(csvEscape).join(","));
      }
      for (const pl of lines2) {
        lines.push(
          ["دفعات", b.contractNumber, b.customerName, pl.title, pl.dueDate, pl.amountN, pl.covered, pl.remaining, pl.stateLabel || pl.state]
            .map(csvEscape)
            .join(",")
        );
      }
    }
    const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv; charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `كشف-المقاول-${d.item.subCode || d.item.name}-${scope === "all" ? "كل-العقود" : "عقد-مختار"}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const htmlEscape = (v: string | number) =>
    String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const blockPrintHtml = (b: SubcontractorLedgerBlock) => {
    const itemsRows = b.items
      .map(
        (it, i) =>
          `<tr><td>${i + 1}</td><td>${htmlEscape(it.description)}</td><td>${htmlEscape(it.unit)}</td><td>${it.qty}</td><td>${formatKWD(it.unitPrice)}</td><td>${formatKWD(it.amount)}</td></tr>`
      )
      .join("");
    const payRows = (b.plan?.lines ?? [])
      .map(
        (pl) =>
          `<tr><td>${htmlEscape(pl.title)}</td><td>${htmlEscape(pl.dueDate)}</td><td>${formatKWD(pl.amountN)}</td><td>${formatKWD(pl.covered)}</td><td>${formatKWD(pl.remaining)}</td><td>${htmlEscape(pl.stateLabel || pl.state)}</td></tr>`
      )
      .join("");
    return `
    <div style="margin-bottom:22px">
      <h3 style="margin:0 0 4px;font-size:14px">العقد ${htmlEscape(b.contractNumber)} — عميل: ${htmlEscape(b.customerName)} — الحالة: ${htmlEscape(b.status || "—")}</h3>
      <p style="margin:0 0 8px;font-size:11px;color:#555">قيمة العقد ${formatKWD(b.amount)} · المنصرف ${formatKWD(b.paid)} · المتبقي ${formatKWD(b.remaining)}${b.waiting > 0 ? ` · بانتظار تحصيل العميل ${formatKWD(b.waiting)}` : ""}</p>
      <h4 style="margin:8px 0 4px;font-size:12px">البنود (${b.items.length})</h4>
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead><tr><th style="border:1px solid #999;padding:3px">م</th><th style="border:1px solid #999;padding:3px">البند</th><th style="border:1px solid #999;padding:3px">الوحدة</th><th style="border:1px solid #999;padding:3px">الكمية</th><th style="border:1px solid #999;padding:3px">السعر</th><th style="border:1px solid #999;padding:3px">القيمة</th></tr></thead>
        <tbody>${itemsRows || `<tr><td colspan="6" style="border:1px solid #999;padding:4px;text-align:center">لا بنود</td></tr>`}</tbody>
      </table>
      <h4 style="margin:10px 0 4px;font-size:12px">خطة الدفعات</h4>
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead><tr><th style="border:1px solid #999;padding:3px">الدفعة</th><th style="border:1px solid #999;padding:3px">الاستحقاق</th><th style="border:1px solid #999;padding:3px">المبلغ</th><th style="border:1px solid #999;padding:3px">المسدد</th><th style="border:1px solid #999;padding:3px">المتبقي</th><th style="border:1px solid #999;padding:3px">الحالة</th></tr></thead>
        <tbody>${payRows || `<tr><td colspan="6" style="border:1px solid #999;padding:4px;text-align:center">لا دفعات</td></tr>`}</tbody>
      </table>
    </div>`;
  };

  const printScope = (scope: "all" | "one") => {
    if (!d) return;
    const list = scope === "all" ? blocks : sel ? [sel] : [];
    if (list.length === 0) return;
    const html = `<div class="print-sheet" style="font-family:Tahoma,Arial,sans-serif;direction:rtl;padding:14px;color:#111">
      <h2 style="margin:0 0 2px;font-size:16px">كشف المقاول — ${htmlEscape(d.item.name)}${d.item.subCode ? ` (${htmlEscape(d.item.subCode)})` : ""}</h2>
      <p style="margin:0 0 14px;font-size:11px;color:#555">طباعة بتاريخ ${new Date().toLocaleDateString("ar-KW")} — ${scope === "all" ? `كل العقود (${blocks.length})` : "العقد المختار"} · ConTrack V9.15</p>
      ${list.map(blockPrintHtml).join("")}
    </div>`;
    const holder = document.createElement("div");
    holder.innerHTML = html;
    const sheet = holder.firstElementChild as HTMLElement;
    printElement(sheet);
  };

  return (
    <div className="space-y-3">
      {/* ===== الشريط العلوي المثبت: رجوع + اسم المقاول + التصدير/الطباعة (Task 92) ===== */}
      <div className="sticky top-0 z-30 -mx-4 border-b bg-background/95 px-4 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={onClose} aria-label="عودة لمقاولي الباطن">
            <ArrowRight className="size-4" />
            رجوع
          </Button>
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden>
              <HardHat className="size-4" />
            </div>
            <h1 className="flex flex-wrap items-center gap-1.5 truncate text-base font-bold">
              {d ? d.item.name : "…"}
              {d?.item.subCode ? (
                <span className="text-xs font-normal text-muted-foreground" dir="ltr">
                  {d.item.subCode}
                </span>
              ) : null}
            </h1>
            {d?.item.activity ? <Badge variant="outline" className="hidden sm:inline-flex">{d.item.activity}</Badge> : null}
            {d?.item.phone ? (
              <Badge variant="outline" className="hidden gap-1 md:inline-flex" dir="ltr">
                <Phone className="size-3" />
                {d.item.phone}
              </Badge>
            ) : null}
          </div>
          <div className="ms-auto flex items-center gap-2">
            {/* زر التصدير — لكل العقود أو العقد المختار (Excel + طباعة) */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="h-9 gap-1.5" disabled={blocks.length === 0} title="تصدير كل العقود أو العقد المختار">
                  <FileSpreadsheet className="size-4" />
                  تصدير / طباعة
                  <MoreVertical className="size-3 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Excel</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => downloadCsv("all")}>
                  <FileSpreadsheet className="size-4" />
                  تصدير كل العقود ({blocks.length})
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => downloadCsv("one")} disabled={!sel}>
                  <FileSpreadsheet className="size-4" />
                  تصدير العقد المختار{sel ? ` — ${sel.contractNumber}` : ""}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>🖨 طباعة</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => printScope("all")}>
                  <Printer className="size-4" />
                  طباعة كل العقود
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => printScope("one")} disabled={!sel}>
                  <Printer className="size-4" />
                  طباعة العقد المختار{sel ? ` — ${sel.contractNumber}` : ""}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* الإجماليات */}
      {d && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <FinCell label="عقود باطنة" value={String(d.totals.contractsCount)} hint={`نشطة: ${d.totals.activeCount}`} />
          <FinCell label="إجمالي القيمة" value={formatKWD(d.totals.totalAmount)} />
          <FinCell label="المنصرف (مسدَّد)" value={formatKWD(d.totals.totalPaid)} tone="text-status-done" />
          <FinCell label="المتبقي" value={formatKWD(d.totals.totalRemaining)} tone="text-status-warn" />
          <FinCell
            label="بانتظار تحصيل العميل"
            value={formatKWD(d.totals.totalWaiting)}
            tone={d.totals.totalWaiting > 0 ? "text-status-info" : ""}
            hideZero
          />
        </div>
      )}

      {ledgerQuery.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : ledgerQuery.error ? (
        <Card>
          <CardContent className="p-4 text-center text-sm text-destructive">تعذر تحميل كشف المقاول — {errMessage(ledgerQuery.error)}</CardContent>
        </Card>
      ) : d && blocks.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            لا عقود باطنة لهذا المقاول — تُنشأ من داخل تفاصيل عقد العميل («مقاولو الباطن»).
          </CardContent>
        </Card>
      ) : (
        d &&
        blocks.length > 0 && (
          /* ===== تخطيط master-detail مثل ملف العميل: جانب العقود (بأسماء العملاء) + كشف العقد المختار ===== */
          <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[290px_minmax(0,1fr)]">
            {/* جانب العقود */}
            <Card className="lg:sticky lg:top-0">
              <CardContent className="p-2">
                <h3 className="px-2 pb-1.5 pt-1 text-xs font-bold text-muted-foreground">
                  عقوده الباطنة ({blocks.length}) — انقر عقدًا لعرض كشفه
                </h3>
                <ul className="space-y-1">
                  {blocks.map((b) => {
                    const active = b.id === selectedId;
                    return (
                      <li key={b.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(b.id)}
                          aria-pressed={active}
                          title={`${b.contractNumber} — ${b.customerName}`}
                          className={`w-full rounded-md border p-2 text-start transition-colors ${
                            active ? "border-primary bg-primary-soft" : "border-border bg-background hover:bg-secondary"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-bold" dir="ltr">
                              {b.contractNumber}
                            </span>
                            <Badge className={`text-[10px] ${statusBadgeClass(b.status || "")}`}>{b.status || "—"}</Badge>
                          </div>
                          <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span className="truncate">👤 {b.customerName}</span>
                            <span className="shrink-0 font-bold tabular-nums text-foreground" dir="ltr">
                              {formatKWD(b.amount)}
                            </span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>

            {/* كشف العقد المختار — نفس المكوّن المعروض في ملف العميل حرفيًا */}
            <div className="min-w-0 space-y-1.5">
              {sel ? (
                <>
                  <div className="flex flex-wrap items-center gap-2 px-1 text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground" dir="ltr">
                      {sel.contractNumber}
                    </span>
                    <span>· عميل العقد: {sel.customerName}</span>
                    {sel.startDate ? <span dir="ltr">· {sel.startDate}{sel.endDate ? ` ← ${sel.endDate}` : ""}</span> : null}
                  </div>
                  <SubcontractorLedger
                    name={d.item.name}
                    subCode={d.item.subCode}
                    amount={sel.amount}
                    status={sel.status}
                    items={sel.items}
                    itemsTotal={sel.itemsTotal}
                    clientLines={sel.clientLines}
                    subLines={sel.plan?.lines ?? []}
                    planTotal={sel.plan?.planTotal ?? 0}
                    paid={sel.paid}
                    waiting={sel.waiting}
                    manager={manager}
                    onPay={() => setPayPage({ subContractId: sel.id, subLabel: `${d.item.name} — ${sel.contractNumber}` })}
                    onManageItems={() => setOpenSubId(sel.id)}
                  />
                </>
              ) : (
                <Card>
                  <CardContent className="p-8 text-center text-sm text-muted-foreground">اختر عقدًا من الجانب لعرض كشفه.</CardContent>
                </Card>
              )}
            </div>
          </div>
        )
      )}

      {/* إدارة البنود وخطة الدفعات — الحوار المعتمد نفسه (تعديل البنود يبقى من هنا) */}
      <SubContractDialog
        subContractId={openSubId}
        onOpenChange={(o) => {
          if (!o) {
            setOpenSubId(null);
            invalidateLedger();
          }
        }}
        user={user}
        onAuthError={onAuthError}
        onPay={() => {
          const id = openSubId;
          setOpenSubId(null);
          if (id !== null) setPayPage({ subContractId: id });
        }}
      />
    </div>
  );
}

/** خلية إجماليات صغيرة في ترويسة الصفحة */
function FinCell({ label, value, hint, tone, hideZero }: { label: string; value: string; hint?: string; tone?: string; hideZero?: boolean }) {
  const zero = value === "0.000" || value === "0";
  return (
    <Card className="gap-0.5 p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`text-base font-bold tabular-nums ${tone || ""}`} dir="ltr">
        {hideZero && zero ? "—" : value}
      </div>
      {hint ? <div className="text-[10px] text-muted-foreground">{hint}</div> : null}
    </Card>
  );
}
