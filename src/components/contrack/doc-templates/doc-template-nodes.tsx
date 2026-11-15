"use client";

/**
 * كتل المصمم الموسومة — عُقد TipTap مخصصة تُصيَّر كبطاقات مرئية وقت التصميم (D11):
 *   clauseBlock بنود مرقمة · paymentsBlock دفعات من قالب النوع (D4 لا إدخال مزدوج)
 *   · boqBlock وثيقة BOQ جاهزة (D5) · itemsTable بنود العرض · partiesBlock أطراف
 *   · signatureBlock توقيعات — كل كتلة قابلة للإدراج/الحذف/السحب/الترتيب/التكرار.
 * في وضع القراءة (editable=false) تُصيَّر ثابتة بلا أدوات — وكتل الدفعات/BOQ تحافظ
 * على معاينتها الحية عبر نفس الاستعلامات.
 */

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Node, mergeAttributes, type Editor } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps, type ReactNodeViewProps } from "@tiptap/react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  FileSpreadsheet,
  GripVertical,
  ListOrdered,
  Loader2,
  Table2,
  Trash2,
  Users,
  Wallet,
  PenLine,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { boqApi } from "@/lib/boq-api";
import { apiGet } from "@/components/contrack/api";
import { BLOCK_TYPES, type ClauseAttr, type PartyAttr, type SignatureAttr } from "@/lib/doc-template-core";
import { errMessage } from "@/components/contrack/contrack-types";
import { formatKWD } from "@/lib/format";
import { StarterKit } from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { TextAlign } from "@tiptap/extension-text-align";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";

// ====================================================================
// عمليات الكتل العامة — أعلى/أسفل/تكرار (D11) — تعمل على أي أب (doc أو غيره)
// ====================================================================

function blockMeta(editor: Editor, getPos: () => number | undefined) {
  const pos = getPos();
  if (typeof pos !== "number" || pos < 0) return null;
  const $pos = editor.state.doc.resolve(pos);
  const parent = $pos.parent;
  const depth = $pos.depth;
  const parentStart = $pos.start(depth);
  let acc = parentStart;
  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i);
    if (acc === pos) return { pos, parent, depth, index: i, node: child };
    acc += child.nodeSize;
  }
  return null;
}

function moveBlockVertical(editor: Editor, getPos: () => number | undefined, dir: -1 | 1): boolean {
  const meta = blockMeta(editor, getPos);
  if (!meta) return false;
  const { pos, parent, index, node } = meta;
  if (dir === -1 && index === 0) return false;
  if (dir === 1 && index === parent.childCount - 1) return false;
  const other = parent.child(index + dir);
  const otherStart = dir === -1 ? pos - other.nodeSize : pos + node.nodeSize;
  const start = Math.min(pos, otherStart);
  const end = Math.max(pos + node.nodeSize, otherStart + other.nodeSize);
  const replacement = dir === -1 ? [node, other] : [other, node];
  editor.view.dispatch(editor.state.tr.replaceWith(start, end, replacement));
  return true;
}

function duplicateBlock(editor: Editor, getPos: () => number | undefined): boolean {
  const meta = blockMeta(editor, getPos);
  if (!meta) return false;
  return editor
    .chain()
    .focus()
    .insertContentAt(meta.pos + meta.node.nodeSize, meta.node.toJSON())
    .run();
}

// ====================================================================
// شريط أدوات الكتلة — مقبض سحب + أعلى/أسفل/تكرار/حذف (D11)
// ====================================================================

function BlockTools({ editor, getPos, deleteNode }: Pick<NodeViewProps, "editor" | "getPos" | "deleteNode">) {
  if (!editor.isEditable) return null;
  return (
    <span className="doc-block-tools" contentEditable={false} suppressContentEditableWarning>
      <span draggable data-drag-handle className="doc-drag-handle" title="اسحب لإعادة الترتيب">
        <GripVertical className="size-3.5 text-muted-foreground" aria-hidden />
      </span>
      <button type="button" className="doc-tool-btn" title="أعلى" aria-label="نقل الكتلة لأعلى"
        onClick={() => moveBlockVertical(editor, getPos, -1)}>
        <ArrowUp className="size-3.5" aria-hidden />
      </button>
      <button type="button" className="doc-tool-btn" title="أسفل" aria-label="نقل الكتلة لأسفل"
        onClick={() => moveBlockVertical(editor, getPos, 1)}>
        <ArrowDown className="size-3.5" aria-hidden />
      </button>
      <button type="button" className="doc-tool-btn" title="تكرار الكتلة" aria-label="تكرار الكتلة"
        onClick={() => duplicateBlock(editor, getPos)}>
        <Copy className="size-3.5" aria-hidden />
      </button>
      <button type="button" className="doc-tool-btn text-destructive" title="حذف الكتلة" aria-label="حذف الكتلة"
        onClick={() => deleteNode()}>
        <Trash2 className="size-3.5" aria-hidden />
      </button>
    </span>
  );
}

// ====================================================================
// 1) كتلة البنود (شروط وأحكام) — قائمة مرقمة بإضافة/حذف/ترتيب/تشديد
// ====================================================================

function ClauseBlockView(props: NodeViewProps) {
  const { node, editor, updateAttributes } = props;
  const clauses = ((node.attrs.clauses as ClauseAttr[] | undefined) ?? []).map((c) => ({ ...c }));
  const editable = editor.isEditable;
  const setClauses = (next: ClauseAttr[]) => updateAttributes({ clauses: next });

  const patch = (i: number, part: Partial<ClauseAttr>) => {
    const next = clauses.map((c, j) => (j === i ? { ...c, ...part } : c));
    setClauses(next);
  };

  return (
    <NodeViewWrapper className="doc-block" data-type="clause-block">
      <div className="doc-block-card">
        <div className="doc-block-title">
          <ListOrdered className="size-4 text-primary" aria-hidden />
          كتلة البنود (شروط وأحكام) — تُرقَّم آليًا
        </div>
        <BlockTools editor={editor} getPos={props.getPos} deleteNode={props.deleteNode} />
        {clauses.length === 0 && (
          <p className="py-2 text-center text-xs text-muted-foreground">لا بنود — أضف بندًا من الزر أدناه.</p>
        )}
        {editable ? (
          <div className="space-y-2">
            {clauses.map((c, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="pt-2 text-xs font-bold text-muted-foreground tabular-nums">{i + 1}.</span>
                <Textarea
                  value={c.text}
                  rows={2}
                  className="min-h-[38px] flex-1 bg-white text-sm"
                  onChange={(e) => patch(i, { text: e.target.value })}
                  aria-label={`نص البند ${i + 1}`}
                />
                <div className="flex flex-col gap-1">
                  <button type="button" className="doc-tool-btn static" title="تشديد" aria-label="تشديد البند"
                    onClick={() => patch(i, { bold: !c.bold })}>
                    <span className={c.bold ? "font-extrabold text-primary" : "font-semibold"}>ب</span>
                  </button>
                  <button type="button" className="doc-tool-btn static" title="حذف البند" aria-label={`حذف البند ${i + 1}`}
                    onClick={() => setClauses(clauses.filter((_, j) => j !== i))}>
                    <Trash2 className="size-3.5 text-destructive" aria-hidden />
                  </button>
                </div>
                <div className="flex flex-col gap-1">
                  <button type="button" className="doc-tool-btn static" title="أعلى" aria-label={`ترتيب البند ${i + 1} لأعلى`}
                    disabled={i === 0}
                    onClick={() => {
                      if (i === 0) return;
                      const next = [...clauses];
                      [next[i - 1], next[i]] = [next[i], next[i - 1]];
                      setClauses(next);
                    }}>
                    <ArrowUp className="size-3.5" aria-hidden />
                  </button>
                  <button type="button" className="doc-tool-btn static" title="أسفل" aria-label={`ترتيب البند ${i + 1} لأسفل`}
                    disabled={i === clauses.length - 1}
                    onClick={() => {
                      if (i === clauses.length - 1) return;
                      const next = [...clauses];
                      [next[i + 1], next[i]] = [next[i], next[i + 1]];
                      setClauses(next);
                    }}>
                    <ArrowDown className="size-3.5" aria-hidden />
                  </button>
                </div>
              </div>
            ))}
            <button type="button" className="inline-flex h-7 items-center gap-1 rounded-md border border-dashed px-2 text-xs text-muted-foreground hover:bg-background"
              onClick={() => setClauses([...clauses, { text: "بند جديد…" }])}>
              + إضافة بند
            </button>
          </div>
        ) : (
          <ol className="doc-clause-list">
            {clauses.map((c, i) => (
              <li key={i} className={c.bold ? "font-bold" : undefined}>{c.text}</li>
            ))}
          </ol>
        )}
      </div>
    </NodeViewWrapper>
  );
}

// ====================================================================
// 2) كتلة الدفعات — تقرأ حصرًا من قالب دفعات النوع المرتبط (D4 لا إدخال مزدوج)
// ====================================================================

interface TplItem {
  payNo: number;
  title: string;
  pct: number;
  amountFixed: number;
  triggerStageName?: string | null;
  daysOffset: number;
}

function PaymentsBlockView(props: NodeViewProps) {
  const { node, editor, updateAttributes } = props;
  const typeId = Number(node.attrs.contractTypeId) || null;
  const editable = editor.isEditable;
  const tplQuery = useQuery<{ type: { name?: string }; items: TplItem[] }>({
    queryKey: ["doc-tpl-payments", typeId],
    queryFn: () => apiGet<{ type: { name?: string }; items: TplItem[] }>(`/api/contract-types/${typeId}/template`),
    enabled: Boolean(typeId),
  });
  const items = tplQuery.data?.items ?? [];

  return (
    <NodeViewWrapper className="doc-block" data-type="payments-block">
      <div className="doc-block-card">
        <div className="doc-block-title">
          <Wallet className="size-4 text-primary" aria-hidden />
          كتلة الدفعات — من قالب دفعات نوع العقد (لا إدخال مزدوج)
        </div>
        <BlockTools editor={editor} getPos={props.getPos} deleteNode={props.deleteNode} />
        {editable && (
          <div className="mb-2 max-w-xs">
            <Label className="text-[10px] text-muted-foreground">نوع العقد المرتبط</Label>
            <ContractTypePicker
              value={typeId}
              onChange={(v) => updateAttributes({ contractTypeId: v })}
            />
          </div>
        )}
        {!typeId ? (
          <p className="py-2 text-center text-xs text-muted-foreground">
            اختر نوع العقد — سيُملأ هذا الجدول من قالب دفعات النوع عند التوليد.
          </p>
        ) : tplQuery.isLoading ? (
          <p className="flex items-center justify-center gap-1 py-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" aria-hidden /> جارٍ تحميل قالب الدفعات…
          </p>
        ) : items.length === 0 ? (
          <p className="py-2 text-center text-xs text-muted-foreground">
            نوع العقد لا يحتوي قالب دفعات — أضف دفعات للنوع من شاشة «الأنواع والمراحل والدفعات».
          </p>
        ) : (
          <table className="doc-preview-table">
            <thead>
              <tr>
                <th>اسم المرحلة</th>
                <th>الدفعة المستحقة</th>
                <th>مدة التنفيذ</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.payNo}>
                  <td>{t.title || t.triggerStageName || `دفعة ${t.payNo}`}</td>
                  <td>{t.pct > 0 ? `${t.pct}%` : t.amountFixed > 0 ? formatKWD(t.amountFixed) : "—"}</td>
                  <td>{t.daysOffset > 0 ? `${t.daysOffset} يوم` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </NodeViewWrapper>
  );
}

/** منتقي أنواع العقود المشترك داخل كتلة الدفعات */
function ContractTypePicker({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  const typesQuery = useQuery<{ types: Array<{ id: number; name: string }> }>({
    queryKey: ["contract-types"],
    queryFn: () => apiGet<{ types: Array<{ id: number; name: string }> }>("/api/contract-types"),
  });
  const types = typesQuery.data?.types ?? [];
  return (
    <Select
      value={value ? String(value) : ""}
      onValueChange={(v) => onChange(Number(v))}
    >
      <SelectTrigger className="h-8 bg-white text-xs" aria-label="نوع العقد المرتبط بالدفعات">
        <SelectValue placeholder="اختر نوع العقد…" />
      </SelectTrigger>
      <SelectContent>
        {types.map((t) => (
          <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ====================================================================
// 3) كتلة BOQ — وثيقة معتمدة (حالة ready حصرًا — D5) ونسخة عند التوليد لا مرجع
// ====================================================================

function BoqBlockView(props: NodeViewProps) {
  const { node, editor, updateAttributes } = props;
  const docId = Number(node.attrs.boqDocId) || null;
  const editable = editor.isEditable;
  const docsQuery = useQuery<{ docs: Array<{ id: number; name: string; projectName: string; status: string; itemCount: number; grandTotal: number }> }>({
    queryKey: ["boq-docs", "doc-templates"],
    queryFn: () => boqApi.docs(),
  });
  const readyDocs = (docsQuery.data?.docs ?? []).filter((d) => d.status === "ready");
  const selected = docId ? readyDocs.find((d) => d.id === docId) : undefined;

  return (
    <NodeViewWrapper className="doc-block" data-type="boq-block">
      <div className="doc-block-card">
        <div className="doc-block-title">
          <FileSpreadsheet className="size-4 text-primary" aria-hidden />
          كتلة BOQ — وثيقة «جاهزة للربط» حصرًا، وتُنسخ بنودها عند التوليد
        </div>
        <BlockTools editor={editor} getPos={props.getPos} deleteNode={props.deleteNode} />
        {editable && (
          <div className="mb-2 max-w-sm">
            <Select
              value={docId ? String(docId) : ""}
              onValueChange={(v) => updateAttributes({ boqDocId: Number(v) })}
            >
              <SelectTrigger className="h-8 bg-white text-xs" aria-label="وثيقة BOQ">
                <SelectValue placeholder="اختر وثيقة BOQ جاهزة…" />
              </SelectTrigger>
              <SelectContent>
                {readyDocs.length === 0 && (
                  <SelectItem value="none" disabled>لا وثائق جاهزة — جهّز وثيقة من «جدول الكميات BOQ»</SelectItem>
                )}
                {readyDocs.map((d) => (
                  <SelectItem key={d.id} value={String(d.id)}>
                    {d.name}{d.projectName ? ` — ${d.projectName}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {!docId ? (
          <p className="py-2 text-center text-xs text-muted-foreground">
            لم تُحدد وثيقة بعد — عند التوليد تُصيَّر أقسام الوثيقة وبنودها وإجمالياتها.
          </p>
        ) : selected ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="secondary" className="gap-1">
              <FileSpreadsheet className="size-3" aria-hidden /> {selected.name}
            </Badge>
            <span className="text-muted-foreground">{selected.itemCount} بند</span>
            <span className="font-semibold tabular-nums" dir="ltr">{formatKWD(selected.grandTotal)}</span>
          </div>
        ) : (
          <p className="py-2 text-center text-xs text-muted-foreground">
            الوثيقة المربوطة لم تعد جاهزة أو محذوفة — اختر وثيقة أخرى.
          </p>
        )}
      </div>
    </NodeViewWrapper>
  );
}

// ====================================================================
// 4) جدول بنود العرض — يُملأ من بنود عرض السعر عند «توليد المستند»
// ====================================================================

function ItemsTableView(props: NodeViewProps) {
  const { editor } = props;
  return (
    <NodeViewWrapper className="doc-block" data-type="items-table">
      <div className="doc-block-card">
        <div className="doc-block-title">
          <Table2 className="size-4 text-primary" aria-hidden />
          جدول بنود العرض السعري — يُملأ تلقائيًا من بنود العرض عند التوليد
        </div>
        <BlockTools editor={editor} getPos={props.getPos} deleteNode={props.deleteNode} />
        <table className="doc-preview-table opacity-80">
          <thead>
            <tr>
              <th>م</th>
              <th>البيان</th>
              <th>الوحدة</th>
              <th>الكمية</th>
              <th>سعر الوحدة</th>
              <th>الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={6} className="text-center text-muted-foreground">بيانات بنود العرض تُدرج لحظة التوليد</td>
            </tr>
          </tbody>
        </table>
      </div>
    </NodeViewWrapper>
  );
}

// ====================================================================
// 5) كتلة أطراف العقد — الطرف الأول/الثاني (اسم/ممثل/مدني/هاتف/بريد) + حقول ربط
// ====================================================================

const PARTY_FIELDS: Array<{ key: keyof PartyAttr; label: string }> = [
  { key: "role", label: "الصفة" },
  { key: "name", label: "الاسم / السادة" },
  { key: "rep", label: "الممثل" },
  { key: "civilId", label: "الرقم المدني" },
  { key: "phone", label: "الهاتف" },
  { key: "email", label: "البريد الإلكتروني" },
];

function PartyCard({
  party,
  editable,
  onChange,
  title,
}: {
  party: PartyAttr;
  editable: boolean;
  title: string;
  onChange?: (next: PartyAttr) => void;
}) {
  return (
    <div className="rounded-md border bg-white p-2.5">
      <p className="mb-1.5 text-[10px] font-bold text-muted-foreground">{title}</p>
      {editable ? (
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {PARTY_FIELDS.map((f) => (
            <div key={f.key} className="space-y-0.5">
              <Label className="text-[10px] text-muted-foreground">{f.label}</Label>
              <Input
                value={party[f.key]}
                className="h-7 bg-white text-xs"
                onChange={(e) => onChange?.({ ...party, [f.key]: e.target.value })}
                aria-label={`${f.label} — ${title}`}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-0.5 text-sm">
          <p className="font-bold underline">{party.name || "—"}</p>
          {party.rep && <p className="text-xs">الممثل: {party.rep}</p>}
          {party.civilId && <p className="text-xs">الرقم المدني: {party.civilId}</p>}
          {party.phone && <p className="text-xs">الهاتف: {party.phone}</p>}
          {party.email && <p className="text-xs">البريد: {party.email}</p>}
        </div>
      )}
    </div>
  );
}

function PartiesBlockView(props: NodeViewProps) {
  const { node, editor, updateAttributes } = props;
  const p1 = (node.attrs.p1 as PartyAttr | undefined) ?? { role: "الطرف الأول", name: "", rep: "", civilId: "", phone: "", email: "" };
  const p2 = (node.attrs.p2 as PartyAttr | undefined) ?? { role: "الطرف الثاني", name: "", rep: "", civilId: "", phone: "", email: "" };
  const editable = editor.isEditable;
  return (
    <NodeViewWrapper className="doc-block" data-type="parties-block">
      <div className="doc-block-card">
        <div className="doc-block-title">
          <Users className="size-4 text-primary" aria-hidden />
          كتلة أطراف العقد — حقول ربط {"{{...}}"} تُملأ عند التوليد
        </div>
        <BlockTools editor={editor} getPos={props.getPos} deleteNode={props.deleteNode} />
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <PartyCard title={editable ? "الطرف الأول" : p1.role || "الطرف الأول"} party={p1} editable={editable}
            onChange={(next) => updateAttributes({ p1: next })} />
          <PartyCard title={editable ? "الطرف الثاني" : p2.role || "الطرف الثاني"} party={p2} editable={editable}
            onChange={(next) => updateAttributes({ p2: next })} />
        </div>
      </div>
    </NodeViewWrapper>
  );
}

// ====================================================================
// 6) كتلة التوقيعات — حرر من نسختين + طرف أول/ثاني بمواضع الأختام
// ====================================================================

function SignatureBlockView(props: NodeViewProps) {
  const { node, editor, updateAttributes } = props;
  const attrs = (node.attrs as SignatureAttr | undefined) ?? { note: "", p1Role: "الطرف الأول", p2Role: "الطرف الثاني" };
  const editable = editor.isEditable;
  return (
    <NodeViewWrapper className="doc-block" data-type="signature-block">
      <div className="doc-block-card">
        <div className="doc-block-title">
          <PenLine className="size-4 text-primary" aria-hidden />
          كتلة التوقيعات والأختام
        </div>
        <BlockTools editor={editor} getPos={props.getPos} deleteNode={props.deleteNode} />
        {editable ? (
          <div className="space-y-2">
            <Textarea
              value={attrs.note}
              rows={2}
              className="bg-white text-sm"
              placeholder="نص النسخ (حرر هذا العقد من نسختين…)"
              onChange={(e) => updateAttributes({ note: e.target.value })}
              aria-label="نص النسخ"
            />
            <div className="grid grid-cols-2 gap-2">
              <Input value={attrs.p1Role} className="h-7 bg-white text-xs" placeholder="صفة الطرف الأول"
                onChange={(e) => updateAttributes({ p1Role: e.target.value })} aria-label="صفة الطرف الأول" />
              <Input value={attrs.p2Role} className="h-7 bg-white text-xs" placeholder="صفة الطرف الثاني"
                onChange={(e) => updateAttributes({ p2Role: e.target.value })} aria-label="صفة الطرف الثاني" />
            </div>
          </div>
        ) : (
          <div>
            {attrs.note && <p className="mb-4 text-sm">{attrs.note}</p>}
            <div className="grid grid-cols-2 gap-6 text-center text-sm">
              <div className="rounded-md border border-dashed px-2 pb-10 pt-3">
                <p className="font-bold">{attrs.p1Role || "الطرف الأول"}</p>
                <p className="mt-6 text-[10px] text-muted-foreground">الاسم والتوقيع والختم</p>
              </div>
              <div className="rounded-md border border-dashed px-2 pb-10 pt-3">
                <p className="font-bold">{attrs.p2Role || "الطرف الثاني"}</p>
                <p className="mt-6 text-[10px] text-muted-foreground">الاسم والتوقيع والختم</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

// ====================================================================
// تعريفات العُقد + تركيب الامتدادات
// ====================================================================

function makeBlockNode(
  name: string,
  tag: string,
  attrs: Record<string, unknown>,
  view: React.ComponentType<ReactNodeViewProps>
) {
  return Node.create({
    name,
    group: "block",
    atom: true,
    selectable: true,
    draggable: true,
    addAttributes() {
      const out: Record<string, { default: unknown }> = {};
      for (const [k, v] of Object.entries(attrs)) out[k] = { default: v };
      return out;
    },
    parseHTML() {
      return [{ tag: `div[data-type="${tag}"]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, { "data-type": tag })];
    },
    addNodeView() {
      return ReactNodeViewRenderer(view);
    },
  });
}

export const ClauseBlock = makeBlockNode("clauseBlock", "clause-block", { clauses: [] }, ClauseBlockView);
export const PaymentsBlock = makeBlockNode("paymentsBlock", "payments-block", { contractTypeId: null }, PaymentsBlockView);
export const BoqBlock = makeBlockNode("boqBlock", "boq-block", { boqDocId: null }, BoqBlockView);
export const ItemsTableBlock = makeBlockNode("itemsTable", "items-table", {}, ItemsTableView);
export const PartiesBlock = makeBlockNode("partiesBlock", "parties-block", { p1: null, p2: null }, PartiesBlockView);
export const SignatureBlock = makeBlockNode("signatureBlock", "signature-block", { note: "", p1Role: "الطرف الأول", p2Role: "الطرف الثاني" }, SignatureBlockView);

export function buildDocTemplateExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
    }),
    Placeholder.configure({
      placeholder: "ابدأ الكتابة هنا… أو أدرج كتلة من شريط الأدوات (بنود/دفعات/BOQ/جدول)",
    }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    TextStyle,
    Color,
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    ClauseBlock,
    PaymentsBlock,
    BoqBlock,
    ItemsTableBlock,
    PartiesBlock,
    SignatureBlock,
  ];
}

/** مزامنة نوع العقد في كل كتل الدفعات داخل المستند عند تغيير ربط القالب (D4) */
export function syncPaymentsBlocks(editor: Editor, contractTypeId: number | null) {
  const { tr, doc } = editor.state;
  let changed = false;
  doc.descendants((node, pos) => {
    if (node.type.name === "paymentsBlock") {
      const current = Number(node.attrs.contractTypeId) || null;
      if (current !== contractTypeId) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, contractTypeId });
        changed = true;
      }
    }
  });
  if (changed) editor.view.dispatch(tr);
}
