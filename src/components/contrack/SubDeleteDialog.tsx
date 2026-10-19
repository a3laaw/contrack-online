"use client";

/**
 * V5.8 — «🗑 حذف بيانات المقاول — عقد · سند · السجل»
 * مطابق لنافذة المكتبي ui/sub_delete_dialog.py بالنصوص والخيارات حرفيًا:
 *   ① 📑 عقود الباطن  — علّم ✔ العقد/العقود ثم «احذف المحدد».
 *   ② 🧾 السندات       — علّم ✔ السند/السندات ثم حذف نهائي (المطور) أو إلغاء.
 *   ③ 👷 سجل المقاول   — لا يُحذف ما دام عليه عقد أو سند (نفس قواعد العميل).
 */

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError, apiGet, apiPost } from "./api";
import { errMessage } from "./contrack-types";

// ===== أنواع الرد — تطابق /api/sub-contracts/delete =====

interface SubDeleteContractRow {
  id: number;
  contractNumber: string;
  customerName: string;
  amount: number;
  status: string;
  items: number;
  planRows: number;
  vouchersActive: number;
  claims: number;
  canDelete: boolean;
  blockReason: string;
}

interface SubDeleteVoucherRow {
  id: number;
  voucherNumber: string;
  vtype: string;
  typeLabel: string;
  vdate: string;
  amount: number;
  cancelled: boolean;
  linkedContract: string;
  linkedSubContractId: number;
}

interface SubDeleteOverviewDTO {
  subcontractor: { id: number; subCode: string; name: string; phone: string; email: string; activity: string; notes: string } | null;
  contracts: SubDeleteContractRow[];
  vouchers: SubDeleteVoucherRow[];
  summary: { contracts: number; contractsValue: number; vouchers: number; vouchersActive: number; vouchersCancelled: number; vouchersTotal: number };
  canDeleteRecord: boolean;
  recordBlock: string;
  isDeveloper: boolean;
}

export type SubDeleteFocus = "contracts" | "vouchers" | "record";
export interface SubDeleteDoneInfo {
  action: SubDeleteFocus;
  deletedContractIds: number[];
}

interface SubDeleteDialogProps {
  subcontractorId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAuthError: () => void;
  onDone?: (info: SubDeleteDoneInfo) => void;
  focus?: SubDeleteFocus;
}

/** مثل _fmt المكتبي: f"{x:,.3f}" */
function fmt3(x: number | string | null | undefined): string {
  return Number(x || 0).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

const CONTRACT_BTN_TOOLTIP = "يحذف عقد الباطن المحدد فقط — بلا مساس بسجل المقاول ولا بسنداته الباقية";
const RECORD_NOTE_DEFAULT =
  "حذف السجل نفسه يكون بعد إفراغه من العقود والسندات — وبعدها لا يُستعاد. بنود عقد العميل والمالية مع المالك لا تُمسّ.";
const RECORD_NOTE_DEV_ONLY = "السجل فارغ — لكن حذف السجل نفسه يتاح لحساب المطور فقط (مثل أداة التنظيف).";

export function SubDeleteDialog({ subcontractorId, open, onOpenChange, onAuthError, onDone, focus = "contracts" }: SubDeleteDialogProps) {
  const [tab, setTab] = React.useState<SubDeleteFocus>(focus);
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState<{ text: string; bad: boolean }>({ text: "", bad: false });
  const [pickedContracts, setPickedContracts] = React.useState<Set<number>>(new Set());
  const [pickedVouchers, setPickedVouchers] = React.useState<Set<number>>(new Set());
  const [recordAck, setRecordAck] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [confirm, setConfirm] = React.useState<{ title: string; message: string; action: SubDeleteFocus } | null>(null);

  React.useEffect(() => {
    if (open) {
      setTab(focus);
      setNote({ text: "", bad: false });
      setPickedContracts(new Set());
      setPickedVouchers(new Set());
      setRecordAck(false);
    }
  }, [open, focus]);

  const ovQuery = useQuery<SubDeleteOverviewDTO>({
    queryKey: ["sub-delete", subcontractorId],
    queryFn: () => apiGet<SubDeleteOverviewDTO>(`/api/sub-contracts/delete?subcontractorId=${subcontractorId}`),
    enabled: open && subcontractorId !== null,
  });

  const ov = ovQuery.data;
  const sub = ov?.subcontractor ?? null;
  const isDeveloper = Boolean(ov?.isDeveloper);

  // كل إعادة تحميل تفرّغ التحديد (كـ_reload المكتبي) — وملاحظة النتيجة تبقى كالمكتبي
  React.useEffect(() => {
    if (ovQuery.data) {
      setPickedContracts(new Set());
      setPickedVouchers(new Set());
      setRecordAck(false);
    }
  }, [ovQuery.data]);

  React.useEffect(() => {
    const e = ovQuery.error;
    if (e instanceof ApiError && e.status === 401) onAuthError();
  }, [ovQuery.error, onAuthError]);

  const reload = async () => {
    await ovQuery.refetch();
  };

  const setChecked = (setter: React.Dispatch<React.SetStateAction<Set<number>>>, id: number, on: boolean) => {
    setter((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const pickContractIds = (rows: SubDeleteContractRow[]): number[] =>
    rows.filter((c) => pickedContracts.has(c.id) && c.canDelete).map((c) => c.id);
  const pickVoucherIds = (rows: SubDeleteVoucherRow[]): number[] =>
    rows.filter((v) => pickedVouchers.has(v.id) && !v.cancelled).map((v) => v.id);

  const errTail = (errors: { id: number; msg: string }[], label?: string): string =>
    (label === undefined ? "  ⚠ " : `  ⚠ ${label}: `) +
    errors
      .map((e) => `#${e.id}: ${(e.msg || "").split("\n")[0]}`)
      .join(" | ");

  const after = async (action: SubDeleteFocus, deletedContractIds: number[]) => {
    await reload();
    onDone?.({ action, deletedContractIds });
  };

  // ============ ① حذف العقود المحددة ============
  const runDeleteContracts = async (ids: number[]) => {
    setBusy(true);
    try {
      const res = await apiPost<{ deleted: number; ids: number[]; errors: { id: number; msg: string }[] }>(
        "/api/sub-contracts/delete",
        { action: "contracts", subcontractorId, subContractIds: ids, reason: reason.trim() }
      );
      let msg = `حُذف ${res.deleted} عقد باطن.`;
      let bad = false;
      if (res.errors?.length) {
        msg += errTail(res.errors);
        bad = true;
      }
      setNote({ text: msg, bad });
      await after("contracts", res.ids || []);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      setNote({ text: errMessage(e), bad: true });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  // ============ ② حذف/إلغاء السندات المحددة ============
  const runDeleteVouchers = async (ids: number[]) => {
    setBusy(true);
    try {
      const res = await apiPost<{ mode: "delete" | "cancel"; deleted?: number; cancelled?: number; errors: { id: number; msg: string }[] }>(
        "/api/sub-contracts/delete",
        { action: "vouchers", subcontractorId, voucherIds: ids, reason: reason.trim() }
      );
      let msg = res.mode === "delete" ? `حُذف ${res.deleted} سند نهائيًا.` : `أُلغي ${res.cancelled} سند (يبقى في السجل باسم ملغى).`;
      let bad = false;
      if (res.errors?.length) {
        msg += errTail(res.errors);
        bad = true;
      }
      setNote({ text: msg, bad });
      await after("vouchers", []);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      setNote({ text: errMessage(e), bad: true });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  // ============ ③ حذف سجل المقاول ============
  const runDeleteRecord = async () => {
    const name = sub?.name || "";
    setBusy(true);
    try {
      await apiPost("/api/sub-contracts/delete", { action: "record", subcontractorId, reason: reason.trim() });
      setNote({ text: `حُذف سجل المقاول «${name}».`, bad: false });
      await after("record", []);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      setNote({ text: errMessage(e), bad: true });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  // ============ أفعال التحقق ثم التأكيد (كالمكتبي) ============
  const delContracts = () => {
    if (!ov) return;
    const ids = pickContractIds(ov.contracts);
    if (!ids.length) {
      setNote({ text: "علّم ✔ على عقد باطن واحد على الأقل.", bad: true });
      return;
    }
    const names = ids
      .map((id) => {
        const c = ov.contracts.find((x) => x.id === id);
        return `#${id} (${c?.contractNumber || "—"})`;
      })
      .join(", ");
    setConfirm({
      title: "تأكيد حذف عقد/عقود الباطن",
      message: `حذف ${ids.length} عقد باطن: ${names}؟\n\nتُحذف بنود ارتباطه وخطة دفعاته — وأي سند **ملغى** يُفكّ عنه ويبقى في السجل. سجل المقاول وبقية عقوده وسنداته لا تُمسّ.`,
      action: "contracts",
    });
  };

  const delVouchers = () => {
    if (!ov) return;
    const ids = pickVoucherIds(ov.vouchers);
    if (!ids.length) {
      setNote({ text: "علّم ✔ على سند واحد على الأقل.", bad: true });
      return;
    }
    if (!reason.trim()) {
      setNote({ text: "اكتب سبب الحذف/الإلغاء أولًا.", bad: true });
      return;
    }
    const verb = isDeveloper ? "حذف" : "إلغاء";
    setConfirm({
      title: `تأكيد ${verb} السندات`,
      message: `${verb} ${ids.length} سند لمقاول «${sub?.name || ""}»؟\n\n${
        isDeveloper ? "حذف نهائي موثّق في سجل التدقيق — لا يُستعاد." : "إلغاء موثّق: الحركة تبقى في السجل باسم ملغى."
      }`,
      action: "vouchers",
    });
  };

  const delRecord = () => {
    if (!ov) return;
    if (!sub) {
      setNote({ text: "المقاول غير موجود.", bad: true });
      return;
    }
    if (!ov.canDeleteRecord) {
      setNote({ text: ov.recordBlock, bad: true });
      return;
    }
    if (!recordAck) {
      setNote({ text: "علّم مربع الإقرار بحذف السجل نهائيًا.", bad: true });
      return;
    }
    setConfirm({
      title: "تأكيد حذف سجل المقاول",
      message: `حذف سجل المقاول «${sub.name}» نهائيًا؟\n\nالاسم والهاتف والنشاط فقط — لا عقود ولا سندات متبقية.\nهذا الحذف لا يُستعاد (تُحفظ لقطة في سجل التدقيق).`,
      action: "record",
    });
  };

  const runConfirm = () => {
    if (!confirm) return;
    if (confirm.action === "contracts") void runDeleteContracts(pickContractIds(ov?.contracts || []));
    else if (confirm.action === "vouchers") void runDeleteVouchers(pickVoucherIds(ov?.vouchers || []));
    else void runDeleteRecord();
  };

  const canDeleteRecord = Boolean(ov?.canDeleteRecord) && isDeveloper;

  // ===== تلميحات التابات (كالمكتبي حرفيًا) =====
  let contractsHint = "";
  if (ov) {
    const blocked = ov.contracts.filter((c) => !c.canDelete);
    if (!ov.contracts.length) contractsHint = "لا عقود باطن لهذا المقاول.";
    else if (blocked.length > 0)
      contractsHint = `${ov.contracts.length} عقدًا · منها ${blocked.length} لا يمكن حذفه الآن (سند سارٍ أو مطالبة) — مرّر على ✔ لمعرفة السبب.`;
    else contractsHint = `${ov.contracts.length} عقدًا — علّم ✔ ما تريد حذفه.`;
  }
  const vouchersHint = isDeveloper
    ? "المطور: حذف نهائي موثّق في سجل التدقيق — علّم ✔ ما تريد حذفه."
    : "حسابك ليس حساب المطور: السندات تُلغى إلغاءً موثّقًا (تبقى في السجل ويُفتح ما عُلّق بها).";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>🗑 حذف بيانات المقاول — عقد · سند · السجل</DialogTitle>
            <DialogDescription className="sr-only">خيارات حذف مقاول الباطن: عقد · سند · السجل.</DialogDescription>
          </DialogHeader>

          {ovQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> جارٍ التحميل…
            </div>
          ) : ovQuery.isError || !ov ? (
            <p className="py-6 text-center text-sm text-destructive">{errMessage(ovQuery.error)}</p>
          ) : (
            <div className="space-y-3">
              {/* الرأس والملخص */}
              <div className="text-sm font-bold">{sub ? `👷 ${sub.name}  (${sub.subCode}) — حذف بخيارات: عقد · سند · السجل` : "المقاول غير موجود"}</div>
              {sub && (
                <div className="text-xs text-muted-foreground">
                  حالته: {ov.summary.contracts} عقد باطن ({fmt3(ov.summary.contractsValue)} د.ك)
                  {"  ·  "}
                  {ov.summary.vouchers} سند منها {ov.summary.vouchersActive} فعّال و{ov.summary.vouchersCancelled} ملغى — بمبلغ فعّال{" "}
                  {fmt3(ov.summary.vouchersTotal)} د.ك
                </div>
              )}

              {/* سبب الحذف */}
              <div className="flex items-center gap-2">
                <Label htmlFor="sub-del-reason" className="shrink-0 text-sm">
                  السبب
                </Label>
                <Input
                  id="sub-del-reason"
                  className="h-9"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="سبب الحذف — إلزامي لحذف/إلغاء السندات وحذف سجل المقاول"
                />
              </div>

              <Tabs value={tab} onValueChange={(v) => setTab(v as SubDeleteFocus)}>
                <TabsList className="flex h-auto w-full flex-nowrap justify-start gap-1 overflow-x-auto p-1">
                  <TabsTrigger value="contracts" className="shrink-0">
                    📑 عقود الباطن ({ov.contracts.length})
                  </TabsTrigger>
                  <TabsTrigger value="vouchers" className="shrink-0">
                    🧾 السندات ({ov.vouchers.length})
                  </TabsTrigger>
                  <TabsTrigger value="record" className="shrink-0">
                    👷 سجل المقاول
                  </TabsTrigger>
                </TabsList>

                {/* ===== ① عقود الباطن ===== */}
                <TabsContent value="contracts" className="mt-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">{contractsHint}</p>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-8 gap-1.5 border-0 bg-status-danger-bg text-status-danger hover:bg-status-danger-bg/80"
                      title={CONTRACT_BTN_TOOLTIP}
                      disabled={busy}
                      onClick={delContracts}
                    >
                      🗑 احذف العقود المحددة
                    </Button>
                  </div>
                  {ov.contracts.length === 0 ? (
                    <p className="rounded-md border p-4 text-center text-xs text-muted-foreground">لا عقود باطن لهذا المقاول.</p>
                  ) : (
                    <div className="max-h-72 overflow-y-auto rounded-lg border">
                      <Table>
                        <TableHeader className="sticky top-0 z-10 bg-muted">
                          <TableRow>
                            <TableHead className="w-10">✔</TableHead>
                            <TableHead>عقد الباطن</TableHead>
                            <TableHead>عقد العميل</TableHead>
                            <TableHead className="text-start">القيمة</TableHead>
                            <TableHead>الحالة</TableHead>
                            <TableHead className="text-center">بنود</TableHead>
                            <TableHead className="text-center">دفعات</TableHead>
                            <TableHead className="text-center">سندات سارية</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ov.contracts.map((c) => (
                            <TableRow key={c.id}>
                              <TableCell>
                                <span title={c.canDelete ? "" : `لا يمكن حذفه: ${c.blockReason}`} className="inline-flex">
                                  <Checkbox
                                    aria-label={`حذف عقد الباطن #${c.id}`}
                                    disabled={!c.canDelete || busy}
                                    checked={pickedContracts.has(c.id)}
                                    onCheckedChange={(on) => setChecked(setPickedContracts, c.id, on === true)}
                                  />
                                </span>
                              </TableCell>
                              <TableCell className="whitespace-nowrap tabular-nums" dir="ltr">
                                #{c.id} — {c.contractNumber || "—"}
                              </TableCell>
                              <TableCell>{c.customerName || "—"}</TableCell>
                              <TableCell className="text-end tabular-nums" dir="ltr">
                                {fmt3(c.amount)}
                              </TableCell>
                              <TableCell>{c.status || ""}</TableCell>
                              <TableCell className="text-center tabular-nums">{c.items}</TableCell>
                              <TableCell className="text-center tabular-nums">{c.planRows}</TableCell>
                              <TableCell className="text-center tabular-nums">{c.vouchersActive}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </TabsContent>

                {/* ===== ② السندات ===== */}
                <TabsContent value="vouchers" className="mt-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">{vouchersHint}</p>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-8 gap-1.5 border-0 bg-status-danger-bg text-status-danger hover:bg-status-danger-bg/80"
                      disabled={busy}
                      onClick={delVouchers}
                    >
                      {isDeveloper ? "🗑 احذف السندات المحددة نهائيًا" : "↩ ألغِ السندات المحددة"}
                    </Button>
                  </div>
                  {ov.vouchers.length === 0 ? (
                    <p className="rounded-md border p-4 text-center text-xs text-muted-foreground">لا سندات لهذا المقاول.</p>
                  ) : (
                    <div className="max-h-72 overflow-y-auto rounded-lg border">
                      <Table>
                        <TableHeader className="sticky top-0 z-10 bg-muted">
                          <TableRow>
                            <TableHead className="w-10">✔</TableHead>
                            <TableHead>رقم السند</TableHead>
                            <TableHead>النوع</TableHead>
                            <TableHead>التاريخ</TableHead>
                            <TableHead className="text-start">المبلغ</TableHead>
                            <TableHead>الحالة</TableHead>
                            <TableHead>عقد العميل المرتبط</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ov.vouchers.map((v) => (
                            <TableRow key={v.id}>
                              <TableCell>
                                <span title={v.cancelled ? "لا يمكن حذفه: ملغى بالفعل" : ""} className="inline-flex">
                                  <Checkbox
                                    aria-label={`حذف السند #${v.id}`}
                                    disabled={v.cancelled || busy}
                                    checked={pickedVouchers.has(v.id)}
                                    onCheckedChange={(on) => setChecked(setPickedVouchers, v.id, on === true)}
                                  />
                                </span>
                              </TableCell>
                              <TableCell className="whitespace-nowrap tabular-nums" dir="ltr">
                                {v.voucherNumber || `#${v.id}`}
                              </TableCell>
                              <TableCell>{v.typeLabel}</TableCell>
                              <TableCell className="whitespace-nowrap tabular-nums" dir="ltr">
                                {v.vdate || "—"}
                              </TableCell>
                              <TableCell className="text-end tabular-nums" dir="ltr">
                                {fmt3(v.amount)}
                              </TableCell>
                              <TableCell>{v.cancelled ? "ملغى" : "فعّال"}</TableCell>
                              <TableCell>{v.linkedContract || "—"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </TabsContent>

                {/* ===== ③ سجل المقاول ===== */}
                <TabsContent value="record" className="mt-3 space-y-3">
                  <div className={`text-sm font-bold ${ov.canDeleteRecord ? "text-status-done" : "text-status-warn"}`}>
                    {ov.recordBlock || "✅ السجل فارغ من العقود والسندات — يمكن حذفه."}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {ov.canDeleteRecord && !isDeveloper ? RECORD_NOTE_DEV_ONLY : RECORD_NOTE_DEFAULT}
                  </p>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox disabled={!canDeleteRecord || busy} checked={recordAck} onCheckedChange={(on) => setRecordAck(on === true)} />
                    أُقر بحذف سجل المقاول نهائيًا (لا يُستعاد)
                  </label>
                  <div className="flex justify-end">
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-8 gap-1.5 border-0 bg-status-danger-bg text-status-danger hover:bg-status-danger-bg/80"
                      disabled={!canDeleteRecord || busy}
                      onClick={delRecord}
                    >
                      🗑 احذف سجل المقاول
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>

              {/* سطر النتيجة */}
              {note.text && <p className={`text-xs ${note.bad ? "text-status-danger" : "text-muted-foreground"}`}>{note.text}</p>}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" className="h-9 gap-1.5" disabled={ovQuery.isFetching} onClick={() => void reload()}>
              <RefreshCw className={ovQuery.isFetching ? "size-4 animate-spin" : "size-4"} />
              🔄 تحديث
            </Button>
            <Button variant="ghost" size="sm" className="h-9" onClick={() => onOpenChange(false)}>
              ✕ إغلاق
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تأكيد الحذف (نظير style.confirm المكتبي) */}
      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line leading-6">{confirm?.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>تراجع</AlertDialogCancel>
            <AlertDialogAction
              className="border-0 bg-status-danger-bg text-status-danger hover:bg-status-danger-bg/80"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                runConfirm();
              }}
            >
              {busy ? "جارٍ التنفيذ…" : "تأكيد"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
