"use client";

/**
 * مصمم القوالب — محرر وورد-مثل (TipTap) داخل النظام — docs/contract-template-design.md
 * D1 TipTap · D2 JSON · D6 موضع القوائم المرجعية · D11 حرية الكتل (سحب/أعلى-أسفل/تكرار/حذف)
 * حفظ عبر /api/doc-templates/[id] (PUT — adminGuard) + معاينة قراءة وطباعة (D7/D9).
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowRight,
  Bold,
  FileSignature,
  FileSpreadsheet,
  Italic,
  List,
  ListOrdered,
  Loader2,
  Palette,
  PenLine,
  Printer,
  Redo2,
  Save,
  Strikethrough,
  Table2,
  Trash2,
  Underline as UnderlineIcon,
  Undo2,
  Users,
  Wallet,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, apiPut } from "@/components/contrack/api";
import { errMessage } from "@/components/contrack/contrack-types";
import {
  buildDocTemplateExtensions,
  syncPaymentsBlocks,
} from "@/components/contrack/doc-templates/doc-template-nodes";
import { DocReadView, printDoc } from "@/components/contrack/doc-templates/doc-template-read";
import { KIND_LABEL, type DocTemplateFull, type DocTemplateKind } from "@/lib/doc-template-core";

interface EditorProps {
  templateId: number;
  onAuthError: () => void;
  onBack: () => void;
}

interface TspTypeLite {
  id: number;
  name: string;
}

function insertBlock(editor: Editor, node: object) {
  return editor.chain().focus().insertContent(node).run();
}

export function DocTemplateEditor({ templateId, onAuthError, onBack }: EditorProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [name, setName] = React.useState("");
  const [status, setStatus] = React.useState("مسودة");
  const [contractTypeId, setContractTypeId] = React.useState<number | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [previewTick, setPreviewTick] = React.useState(0);
  const loadedRef = React.useRef(false);

  const fullQuery = useQuery<{ template: DocTemplateFull }>({
    queryKey: ["doc-template", templateId],
    queryFn: () => apiGet<{ template: DocTemplateFull }>(`/api/doc-templates/${templateId}`),
  });
  const tpl = fullQuery.data?.template;

  const typesQuery = useQuery<{ types: TspTypeLite[] }>({
    queryKey: ["contract-types"],
    queryFn: () => apiGet<{ types: TspTypeLite[] }>("/api/contract-types"),
    enabled: tpl?.kind === "contract_type",
  });

  const editor = useEditor({
    extensions: buildDocTemplateExtensions(),
    content: "",
    immediatelyRender: false,
    editorProps: { attributes: { dir: "rtl", class: "doc-prose" } },
    onUpdate: () => setDirty(true),
  });

  // تحميل جسم القالب مرة واحدة عند وصول البيانات
  React.useEffect(() => {
    if (!tpl || !editor || loadedRef.current) return;
    loadedRef.current = true;
    setName(tpl.name);
    setStatus(tpl.status);
    setContractTypeId(tpl.contractTypeId);
    editor.commands.setContent(
      (tpl.contentJson && typeof tpl.contentJson === "object"
        ? (tpl.contentJson as object)
        : { type: "doc", content: [] }) as never,
      { emitUpdate: false }
    );
    // مزامنة كتل الدفعات بربط النوع عند التحميل (D4) — القوالب القديمة والجديدة
    if (tpl.contractTypeId) syncPaymentsBlocks(editor, tpl.contractTypeId);
    setDirty(false);
  }, [tpl, editor]);

  React.useEffect(() => {
    if (fullQuery.error instanceof ApiError && fullQuery.error.status === 401) onAuthError();
  }, [fullQuery.error, onAuthError]);

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiPut(`/api/doc-templates/${templateId}`, payload),
    onSuccess: () => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["doc-templates"] });
      qc.invalidateQueries({ queryKey: ["doc-template", templateId] });
      toast({ title: "تم حفظ القالب" });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر حفظ القالب", description: errMessage(e) });
    },
  });

  const save = React.useCallback(() => {
    if (!editor) return;
    saveMutation.mutate({
      name: name.trim() || "قالب بدون اسم",
      status,
      contractTypeId,
      contentJson: JSON.stringify(editor.getJSON()),
    });
  }, [editor, name, status, contractTypeId, saveMutation]);

  // Ctrl+S / Cmd+S
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const changeContractType = (v: string) => {
    const id = Number(v);
    setContractTypeId(id);
    if (editor) syncPaymentsBlocks(editor, id);
    setDirty(true);
  };

  const openPreview = () => {
    setPreviewTick((t) => t + 1);
    setPreviewOpen(true);
  };

  const blockBtn = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    active?: boolean,
    title?: string
  ) => (
    <button
      type="button"
      title={title ?? label}
      aria-label={title ?? label}
      aria-pressed={active}
      className={`doc-tb-btn ${active ? "doc-tb-btn-active" : ""}`}
      disabled={!editor}
      onClick={onClick}
    >
      {icon}
      <span className="hidden 2xl:inline">{label}</span>
    </button>
  );

  if (fullQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-[60vh] w-full" />
      </div>
    );
  }
  if (fullQuery.isError || !tpl) {
    return (
      <div className="space-y-3 py-8 text-center">
        <p className="text-sm text-muted-foreground">تعذر تحميل القالب — {errMessage(fullQuery.error)}</p>
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowRight className="size-4" aria-hidden /> رجوع للقائمة
        </Button>
      </div>
    );
  }

  const isTableActive = Boolean(editor?.isActive("table"));

  return (
    <div className="space-y-3">
      {/* رأس المصمم */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" className="h-8 gap-1" onClick={() => (dirty && !window.confirm("هناك تغييرات غير محفوظة — الرجوع دون حفظ؟")) || onBack()}>
          <ArrowRight className="size-4" aria-hidden />
          رجوع
        </Button>
        <Input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setDirty(true);
          }}
          className="h-8 w-52 text-sm font-semibold"
          aria-label="اسم القالب"
          placeholder="اسم القالب"
        />
        <Badge variant="secondary" className="gap-1 text-[10px]">
          <FileSignature className="size-3" aria-hidden />
          {KIND_LABEL[tpl.kind as DocTemplateKind]}
        </Badge>
        {tpl.kind === "contract_type" && (
          <div className="flex items-center gap-1">
            <Label className="text-xs text-muted-foreground">نوع العقد:</Label>
            <Select
              value={contractTypeId ? String(contractTypeId) : ""}
              onValueChange={changeContractType}
            >
              <SelectTrigger className="h-8 w-44 text-xs" aria-label="نوع العقد المرتبط">
                <SelectValue placeholder="اختر النوع…" />
              </SelectTrigger>
              <SelectContent>
                {(typesQuery.data?.types ?? []).map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <Select value={status} onValueChange={(v) => { setStatus(v); setDirty(true); }}>
          <SelectTrigger className="h-8 w-28 text-xs" aria-label="حالة القالب">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="مسودة">مسودة</SelectItem>
            <SelectItem value="معتمد">معتمد</SelectItem>
          </SelectContent>
        </Select>
        {dirty && <span className="text-[10px] text-amber-600">تغييرات غير محفوظة</span>}
        <div className="ms-auto flex items-center gap-1">
          <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={openPreview} disabled={!editor}>
            <Printer className="size-3.5" aria-hidden />
            معاينة وطباعة
          </Button>
          <Button size="sm" className="h-8 gap-1 text-xs" onClick={save} disabled={!editor || saveMutation.isPending}>
            {saveMutation.isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Save className="size-3.5" aria-hidden />
            )}
            حفظ
          </Button>
        </div>
      </div>

      {/* شريط الأدوات — سطر 1: تنسيق */}
      <div className="doc-toolbar">
        {blockBtn("تراجع", <Undo2 className="size-4" />, () => editor?.chain().focus().undo().run(), false, "تراجع")}
        {blockBtn("إعادة", <Redo2 className="size-4" />, () => editor?.chain().focus().redo().run(), false, "إعادة")}
        <span className="doc-tb-sep" />
        {blockBtn("عريض", <Bold className="size-4" />, () => editor?.chain().focus().toggleBold().run(), editor?.isActive("bold"))}
        {blockBtn("مائل", <Italic className="size-4" />, () => editor?.chain().focus().toggleItalic().run(), editor?.isActive("italic"))}
        {blockBtn("تسطير", <UnderlineIcon className="size-4" />, () => editor?.chain().focus().toggleUnderline().run(), editor?.isActive("underline"))}
        {blockBtn("مشطوب", <Strikethrough className="size-4" />, () => editor?.chain().focus().toggleStrike().run(), editor?.isActive("strike"))}
        <span className="doc-tb-sep" />
        {blockBtn("عنوان 1", <span className="text-xs font-extrabold">ع1</span>, () => editor?.chain().focus().toggleHeading({ level: 1 }).run(), editor?.isActive("heading", { level: 1 }))}
        {blockBtn("عنوان 2", <span className="text-xs font-extrabold">ع2</span>, () => editor?.chain().focus().toggleHeading({ level: 2 }).run(), editor?.isActive("heading", { level: 2 }))}
        {blockBtn("عنوان 3", <span className="text-xs font-extrabold">ع3</span>, () => editor?.chain().focus().toggleHeading({ level: 3 }).run(), editor?.isActive("heading", { level: 3 }))}
        <span className="doc-tb-sep" />
        {blockBtn("قائمة نقطية", <List className="size-4" />, () => editor?.chain().focus().toggleBulletList().run(), editor?.isActive("bulletList"))}
        {blockBtn("قائمة رقمية", <ListOrdered className="size-4" />, () => editor?.chain().focus().toggleOrderedList().run(), editor?.isActive("orderedList"))}
        <span className="doc-tb-sep" />
        {blockBtn("يمين", <AlignRight className="size-4" />, () => editor?.chain().focus().setTextAlign("right").run(), editor?.isActive({ textAlign: "right" }))}
        {blockBtn("وسط", <AlignCenter className="size-4" />, () => editor?.chain().focus().setTextAlign("center").run(), editor?.isActive({ textAlign: "center" }))}
        {blockBtn("يسار", <AlignLeft className="size-4" />, () => editor?.chain().focus().setTextAlign("left").run(), editor?.isActive({ textAlign: "left" }))}
        {blockBtn("ضبط", <AlignJustify className="size-4" />, () => editor?.chain().focus().setTextAlign("justify").run(), editor?.isActive({ textAlign: "justify" }))}
        <span className="doc-tb-sep" />
        {blockBtn("أحمر", <Palette className="size-4 text-red-600" />, () => editor?.chain().focus().setColor("#dc2626").run(), false, "لون العنوان الأحمر (ستايل العقود المرجعية)")}
        {blockBtn("أسود", <Palette className="size-4" />, () => editor?.chain().focus().unsetColor().run(), false, "إعادة اللون الأسود")}
      </div>

      {/* شريط الأدوات — سطر 2: إدراج الكتل والجداول (D11) */}
      <div className="doc-toolbar">
        <span className="text-[10px] font-bold text-muted-foreground">إدراج:</span>
        {blockBtn("بنود", <ListOrdered className="size-4" />, () => {
          if (!editor) return;
          insertBlock(editor, { type: "clauseBlock", attrs: { clauses: [{ text: "بند جديد…" }] } });
          setDirty(true);
        }, false, "كتلة بنود (شروط وأحكام) مرقمة")}
        {blockBtn("دفعات", <Wallet className="size-4" />, () => {
          if (!editor) return;
          insertBlock(editor, { type: "paymentsBlock", attrs: { contractTypeId: contractTypeId ?? (tpl.contractTypeId ?? null) } });
          setDirty(true);
        }, false, "كتلة الدفعات من قالب نوع العقد")}
        {blockBtn("BOQ", <FileSpreadsheet className="size-4" />, () => {
          if (!editor) return;
          insertBlock(editor, { type: "boqBlock", attrs: { boqDocId: null } });
          setDirty(true);
        }, false, "كتلة جدول الكميات BOQ")}
        {blockBtn("جدول العرض", <Table2 className="size-4" />, () => {
          if (!editor) return;
          insertBlock(editor, { type: "itemsTable" });
          setDirty(true);
        }, false, "جدول بنود العرض السعري (يُملأ عند التوليد)")}
        {blockBtn("أطراف", <Users className="size-4" />, () => {
          if (!editor) return;
          insertBlock(editor, { type: "partiesBlock" });
          setDirty(true);
        }, false, "كتلة أطراف العقد")}
        {blockBtn("توقيعات", <PenLine className="size-4" />, () => {
          if (!editor) return;
          insertBlock(editor, { type: "signatureBlock" });
          setDirty(true);
        }, false, "كتلة التوقيعات والأختام")}
        <span className="doc-tb-sep" />
        {blockBtn("جدول حر", <Table2 className="size-4" />, () => {
          editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
          setDirty(true);
        }, false, "جدول حر بأسلوب إكسل")}
        {isTableActive && (
          <>
            <span className="doc-tb-sep" />
            {blockBtn("صف+", <span className="text-[10px] font-bold">صف+</span>, () => editor?.chain().focus().addRowAfter().run(), false, "إضافة صف")}
            {blockBtn("صف−", <span className="text-[10px] font-bold">صف−</span>, () => editor?.chain().focus().deleteRow().run(), false, "حذف الصف")}
            {blockBtn("عمود+", <span className="text-[10px] font-bold">عمود+</span>, () => editor?.chain().focus().addColumnAfter().run(), false, "إضافة عمود")}
            {blockBtn("عمود−", <span className="text-[10px] font-bold">عمود−</span>, () => editor?.chain().focus().deleteColumn().run(), false, "حذف العمود")}
            {blockBtn("رأس", <span className="text-[10px] font-bold">رأس</span>, () => editor?.chain().focus().toggleHeaderRow().run(), false, "صف الرأس")}
            {blockBtn("دمج", <span className="text-[10px] font-bold">دمج</span>, () => editor?.chain().focus().mergeCells().run(), false, "دمج الخلايا")}
            {blockBtn("فصل", <span className="text-[10px] font-bold">فصل</span>, () => editor?.chain().focus().splitCell().run(), false, "فصل الخلايا")}
            {blockBtn("حذف الجدول", <Trash2 className="size-4" />, () => editor?.chain().focus().deleteTable().run(), false, "حذف الجدول")}
          </>
        )}
      </div>

      {/* ورقة المستند */}
      <div className="doc-sheet-wrap">
        <div className="doc-sheet" dir="rtl">
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* معاينة القراءة والطباعة */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[94vh] max-w-4xl overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>معاينة المستند — عرض القراءة</DialogTitle>
            <DialogDescription>
              هكذا يُطبع القالب — الترويسة من هوية المطبوعات (D9)، والكتل ببياناتها الحية.
            </DialogDescription>
          </DialogHeader>
          <div className="doc-print-area">
            <DocReadView key={previewTick} content={editor?.getJSON() ?? { type: "doc", content: [] }} />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPreviewOpen(false)}>إغلاق</Button>
            <Button size="sm" className="gap-1" onClick={printDoc}>
              <Printer className="size-4" aria-hidden />
              طباعة / PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

