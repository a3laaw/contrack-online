'use client'

// ============================================================
// تبويب «جدول الكميات BOQ» في الإعدادات — وثائق مستقلة تُبنى قبل العقد
// (قرار المالك 2026-11: «بنود العقد حاجة والـBOQ حاجة تانية»).
// المرحلة أ — docs/boq-doc-design.md:
//   قائمة وثائق → تفاصيل الوثيقة بشجرة أقسام قابلة للطي (مشتقة من
//   divisionCode — نفس هوية محلل الاستيراد) + إضافة يدوية لقسم/بند +
//   استيراد إكسل بنفس المحلل المعاير (معاينة ثم تنفيذ — إلحاق لا استبدال).
//   حالة الوثيقة: مسودة | جاهزة للربط (الربط بنسخ بنود العقد — المرحلة ب).
// ============================================================
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight, Building2, ChevronDown, ClipboardList, FileSpreadsheet, FolderKanban,
  Layers, Loader2, Pencil, Plus, Trash2, Upload, UserCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { ApiError } from '../api'
import { boqApi } from '@/lib/boq-api'
import { formatKWD, round3 } from '@/lib/format'
import type { BoqDocDTO, BoqDocItemDTO } from '@/lib/boq-types'
import { BoqDocImportDialog } from './boq-doc-import-dialog'

// وحدات مقترحة (نص حر — الوحدات المستوردة تبقى كما وردت حرفياً)
const UNIT_SUGGESTIONS = ['م²', 'م³', 'م.ط', 'عدد', 'قطعة', 'يوم', 'شهر', 'L.S.', 'نسبة'] as const

interface SectionGroup {
  key: string // divisionCode أو '_' للبنود بلا قسم
  code: string
  name: string
  items: BoqDocItemDTO[]
  total: number
}

/** الشجرة مشتقة من هوية القسم — بترتيب إدخال البنود (sortOrder) */
function groupSections(items: BoqDocItemDTO[]): SectionGroup[] {
  const map = new Map<string, SectionGroup>()
  for (const it of items) {
    const key = it.divisionCode || '_'
    const g = map.get(key) ?? { key, code: it.divisionCode, name: it.divisionName, items: [], total: 0 }
    if (!g.name && it.divisionName) g.name = it.divisionName
    g.items.push(it)
    g.total = round3(g.total + it.total)
    map.set(key, g)
  }
  return [...map.values()]
}

export function BoqDocsTab() {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  return selectedId == null ? <DocsList onOpen={setSelectedId} /> : <DocDetail docId={selectedId} onBack={() => setSelectedId(null)} />
}

// ---------- أدوات مشتقات الشجرة ----------

/** الافتراضي عند أول عرض: فتح الكل للوثائق الصغيرة — طي للكبيرة (ملفات BOQ 18+ قسماً) */
function defaultOpenKeys(items: BoqDocItemDTO[]): Set<string> {
  const keys = groupSections(items).map((g) => g.key)
  return items.length <= 60 ? new Set(keys) : new Set([keys[0]])
}

// ============================================================
// قائمة الوثائق
// ============================================================
function DocsList({ onOpen }: { onOpen: (id: number) => void }) {
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<BoqDocDTO | null>(null)
  const [deleting, setDeleting] = useState<BoqDocDTO | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['boq-docs'],
    queryFn: () => boqApi.docs(),
  })
  const docs = useMemo(() => data?.docs ?? [], [data])

  const deleteMutation = useMutation({
    mutationFn: (id: number) => boqApi.deleteDoc(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['boq-docs'] })
      setDeleting(null)
      toast.success('تم حذف وثيقة BOQ وبنودها')
    },
    onError: (e: Error) => toast.error(e instanceof ApiError ? e.message : e.message),
  })

  const statusBadge = (s: BoqDocDTO['status']) =>
    s === 'ready' ? (
      <Badge className="bg-emerald-700 text-white whitespace-nowrap">جاهزة للربط</Badge>
    ) : (
      <Badge variant="outline" className="text-amber-700 border-amber-300 dark:text-amber-400 dark:border-amber-800 whitespace-nowrap">مسودة</Badge>
    )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="secondary" className="numeric">{docs.length} وثيقة</Badge>
          <span className="text-muted-foreground text-xs hidden sm:inline">
            وثائق تُبنى قبل العقد — وعند إنشاء العقد تُربط بها وتُنسخ بنودها
          </span>
        </div>
        <Button className="h-11 gap-2 font-semibold" onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden />
          وثيقة BOQ جديدة
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 text-destructive px-4 py-3 text-sm">
          تعذر تحميل الوثائق: {(error as Error).message}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-52 rounded-xl" />
        </div>
      ) : docs.length === 0 ? (
        <div className="py-12 text-center">
          <FileSpreadsheet className="size-8 mx-auto mb-2 opacity-40" aria-hidden />
          <p className="text-sm text-muted-foreground mb-4">لا توجد وثائق BOQ — أنشئ أول وثيقة جدول كميات</p>
          <Button variant="outline" className="h-11 gap-2" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            إنشاء أول وثيقة
          </Button>
        </div>
      ) : (
        <>
          {/* سطح المكتب — جدول */}
          <div className="hidden md:block rounded-xl border overflow-hidden">
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead className="text-start">الوثيقة</TableHead>
                    <TableHead className="text-start">المشروع</TableHead>
                    <TableHead className="text-start">المالك</TableHead>
                    <TableHead className="text-start">الحالة</TableHead>
                    <TableHead className="text-start">البنود</TableHead>
                    <TableHead className="text-start">الإجمالي</TableHead>
                    <TableHead className="text-start">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {docs.map((d) => (
                    <TableRow
                      key={d.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => onOpen(d.id)}
                    >
                      <TableCell className="font-semibold">
                        <button type="button" className="text-start hover:underline" onClick={(e) => { e.stopPropagation(); onOpen(d.id) }}>
                          {d.name}
                        </button>
                      </TableCell>
                      <TableCell className="text-muted-foreground max-w-48">
                        <span className="block truncate">{d.projectName || '—'}</span>
                      </TableCell>
                      <TableCell className="text-muted-foreground max-w-36">
                        <span className="block truncate">{d.clientName || '—'}</span>
                      </TableCell>
                      <TableCell>{statusBadge(d.status)}</TableCell>
                      <TableCell className="numeric">{d.itemCount}</TableCell>
                      <TableCell className="font-semibold numeric" dir="ltr">{formatKWD(d.grandTotal)}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5">
                          <Button
                            size="icon" variant="ghost" className="h-9 w-9"
                            onClick={() => setEditing(d)}
                            aria-label={`تعديل بيانات الوثيقة ${d.name}`}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            size="icon" variant="ghost" className="h-9 w-9 text-destructive hover:text-destructive"
                            onClick={() => setDeleting(d)}
                            aria-label={`حذف الوثيقة ${d.name}`}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* الجوال — بطاقات */}
          <div className="md:hidden space-y-3">
            {docs.map((d) => (
              <Card key={d.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => onOpen(d.id)}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold leading-snug">{d.name}</h3>
                    {statusBadge(d.status)}
                  </div>
                  {d.projectName && <p className="text-xs text-muted-foreground flex items-center gap-1.5"><FolderKanban className="size-3.5" aria-hidden />{d.projectName}</p>}
                  {d.clientName && <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Building2 className="size-3.5" aria-hidden />{d.clientName}</p>}
                  <div className="flex items-center justify-between text-sm pt-1 border-t">
                    <span className="text-muted-foreground numeric">{d.itemCount} بند</span>
                    <span className="font-bold numeric" dir="ltr">{formatKWD(d.grandTotal)}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      <DocMetaDialog
        open={creating || editing != null}
        doc={editing}
        onOpenChange={(o) => { if (!o) { setCreating(false); setEditing(null) } }}
      />
      <AlertDialog open={deleting != null} onOpenChange={(o) => { if (!o) setDeleting(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف وثيقة BOQ؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيُحذف «{deleting?.name}» مع {deleting?.itemCount ?? 0} بنداً — لا يمكن التراجع.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => deleting && deleteMutation.mutate(deleting.id)}
            >
              حذف نهائي
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ============================================================
// حوار بيانات الوثيقة (إنشاء/تعديل) — النموذج يُعاد تركيبه عند كل فتح
// (القيم الأولية من props بلا useEffect — قاعدة react-hooks)
// ============================================================
function DocMetaDialog({
  open, doc, onOpenChange,
}: {
  open: boolean
  doc: BoqDocDTO | null // null = إنشاء
  onOpenChange: (o: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open && <DocMetaForm key={doc?.id ?? 'new'} doc={doc} onOpenChange={onOpenChange} />}
      </DialogContent>
    </Dialog>
  )
}

function DocMetaForm({
  doc, onOpenChange,
}: {
  doc: BoqDocDTO | null
  onOpenChange: (o: boolean) => void
}) {
  const qc = useQueryClient()
  const [name, setName] = useState(doc?.name ?? '')
  const [projectName, setProjectName] = useState(doc?.projectName ?? '')
  const [clientName, setClientName] = useState(doc?.clientName ?? '')
  const [consultantName, setConsultantName] = useState(doc?.consultantName ?? '')
  const [notes, setNotes] = useState(doc?.notes ?? '')

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = { name, projectName, clientName, consultantName, notes }
      return doc ? boqApi.updateDoc(doc.id, payload) : boqApi.createDoc(payload)
    },
    onSuccess: (_data, _v) => {
      qc.invalidateQueries({ queryKey: ['boq-docs'] })
      if (doc) qc.invalidateQueries({ queryKey: ['boq-doc', doc.id] })
      toast.success(doc ? 'تم تحديث بيانات الوثيقة' : 'تم إنشاء وثيقة BOQ — أضف بنودها أو استورد ملفاً')
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e instanceof ApiError ? e.message : e.message),
  })

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <FileSpreadsheet className="size-5 text-emerald-700 dark:text-emerald-400" aria-hidden />
          {doc ? 'تعديل بيانات الوثيقة' : 'وثيقة BOQ جديدة'}
        </DialogTitle>
        <DialogDescription>
          وثيقة جدول كميات مستقلة تُبنى قبل العقد — ثم تُربط بالعقد وتُنسخ بنودها عند التعاقد.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3.5 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="boq-doc-name">اسم الوثيقة *</Label>
            <Input id="boq-doc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="BOQ مستوصف صباح السالم" className="h-11" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="boq-doc-project">اسم المشروع</Label>
              <Input id="boq-doc-project" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="مستوصف صباح السالم الجنوبي" className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="boq-doc-client">المالك / الجهة</Label>
              <Input id="boq-doc-client" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="وزارة الصحة" className="h-11" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="boq-doc-consultant">الاستشاري</Label>
            <Input id="boq-doc-consultant" value={consultantName} onChange={(e) => setConsultantName(e.target.value)} placeholder="سور" className="h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="boq-doc-notes">ملاحظات</Label>
            <Input id="boq-doc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اختياري" className="h-11" />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" disabled={saveMutation.isPending} onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button
            className="h-11 gap-2 font-semibold"
            disabled={saveMutation.isPending || !name.trim()}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {doc ? 'حفظ التعديلات' : 'إنشاء الوثيقة'}
          </Button>
        </DialogFooter>
    </>
  )
}

// ============================================================
// تفاصيل الوثيقة — الشجرة + الإدخال اليدوي + الاستيراد
// ============================================================
function DocDetail({ docId, onBack }: { docId: number; onBack: () => void }) {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [itemDialog, setItemDialog] = useState<{ mode: 'add'; sectionKey?: string } | { mode: 'edit'; item: BoqDocItemDTO } | null>(null)
  const [deletingItem, setDeletingItem] = useState<BoqDocItemDTO | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [metaOpen, setMetaOpen] = useState(false)
  const [confirmDeleteDoc, setConfirmDeleteDoc] = useState(false)
  // الشجرة: الفتح المشتق — ما لم يعدّل المستخدم الطي يدوياً (null = الافتراضي)
  const [userOpenSections, setUserOpenSections] = useState<Set<string> | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['boq-doc', docId],
    queryFn: () => boqApi.doc(docId),
  })
  const items = useMemo(() => data?.items ?? [], [data])
  const q = search.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      q
        ? items.filter(
            (i) =>
              i.description.toLowerCase().includes(q) ||
              (i.itemNo ?? '').toLowerCase().includes(q) ||
              (i.divisionName ?? '').toLowerCase().includes(q) ||
              i.unit.toLowerCase().includes(q),
          )
        : items,
    [items, q],
  )
  const sections = useMemo(() => groupSections(filtered), [filtered])
  const grandTotal = useMemo(() => round3(filtered.reduce((s, i) => s + i.total, 0)), [filtered])
  const defaultOpen = useMemo(() => defaultOpenKeys(items), [items])
  const openSections = userOpenSections ?? defaultOpen

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['boq-doc', docId] })
    qc.invalidateQueries({ queryKey: ['boq-docs'] })
  }

  const toggleSection = (key: string) =>
    setUserOpenSections((prev) => {
      const base = new Set(prev ?? defaultOpen)
      if (base.has(key)) base.delete(key)
      else base.add(key)
      return base
    })

  const statusMutation = useMutation({
    mutationFn: (status: 'draft' | 'ready') => boqApi.updateDoc(docId, { status }),
    onSuccess: (d) => {
      invalidate()
      toast.success(d.status === 'ready' ? 'الوثيقة الآن «جاهزة للربط» — ستظهر عند إنشاء العقد' : 'أُعيدت الوثيقة إلى «مسودة»')
    },
    onError: (e: Error) => toast.error(e instanceof ApiError ? e.message : e.message),
  })

  const deleteDocMutation = useMutation({
    mutationFn: () => boqApi.deleteDoc(docId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['boq-docs'] })
      toast.success('تم حذف وثيقة BOQ وبنودها')
      onBack()
    },
    onError: (e: Error) => toast.error(e instanceof ApiError ? e.message : e.message),
  })

  const deleteItemMutation = useMutation({
    mutationFn: (id: number) => boqApi.deleteDocItem(id),
    onSuccess: () => {
      invalidate()
      setDeletingItem(null)
      toast.success('تم حذف البند من الوثيقة')
    },
    onError: (e: Error) => toast.error(e instanceof ApiError ? e.message : e.message),
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-11 w-36 rounded-lg" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="space-y-4">
        <Button variant="outline" className="h-11 gap-2" onClick={onBack}>
          <ArrowRight className="size-4" aria-hidden />
          كل الوثائق
        </Button>
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 text-destructive px-4 py-3 text-sm">
          تعذر تحميل الوثيقة: {(error as Error)?.message ?? 'غير موجودة'}
        </div>
      </div>
    )
  }

  const isReady = data.status === 'ready'

  return (
    <div className="space-y-4">
      <Button variant="ghost" className="h-10 gap-2 -ms-2" onClick={onBack}>
        <ArrowRight className="size-4" aria-hidden />
        كل الوثائق
      </Button>

      {/* ترويسة الوثيقة */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold leading-snug">{data.name}</h2>
                {isReady ? (
                  <Badge className="bg-emerald-700 text-white">جاهزة للربط</Badge>
                ) : (
                  <Badge variant="outline" className="text-amber-700 border-amber-300 dark:text-amber-400 dark:border-amber-800">مسودة</Badge>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-muted-foreground">
                {data.projectName && <span className="flex items-center gap-1"><FolderKanban className="size-3.5" aria-hidden />{data.projectName}</span>}
                {data.clientName && <span className="flex items-center gap-1"><Building2 className="size-3.5" aria-hidden />{data.clientName}</span>}
                {data.consultantName && <span className="flex items-center gap-1"><UserCheck className="size-3.5" aria-hidden />{data.consultantName}</span>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant={isReady ? 'outline' : 'default'}
                className={isReady ? 'h-10' : 'h-10 bg-emerald-700 hover:bg-emerald-800 text-white'}
                disabled={statusMutation.isPending}
                onClick={() => statusMutation.mutate(isReady ? 'draft' : 'ready')}
              >
                {statusMutation.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {isReady ? 'إرجاع لمسودة' : 'تعيين جاهزة للربط'}
              </Button>
              <Button variant="outline" className="h-10 gap-2" onClick={() => setMetaOpen(true)}>
                <Pencil className="size-4" aria-hidden />
                تعديل البيانات
              </Button>
              <Button variant="ghost" className="h-10 gap-2 text-destructive hover:text-destructive" onClick={() => setConfirmDeleteDoc(true)}>
                <Trash2 className="size-4" aria-hidden />
                حذف
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 pt-1">
            <div className="rounded-lg border p-2.5 text-center">
              <p className="text-xs text-muted-foreground">الأقسام</p>
              <p className="text-base font-bold numeric">{groupSections(items).length}</p>
            </div>
            <div className="rounded-lg border p-2.5 text-center">
              <p className="text-xs text-muted-foreground">البنود</p>
              <p className="text-base font-bold numeric">{data.itemCount}</p>
            </div>
            <div className="rounded-lg border p-2.5 text-center">
              <p className="text-xs text-muted-foreground">الإجمالي</p>
              <p className="text-base font-bold numeric" dir="ltr">{formatKWD(data.grandTotal)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* شريط الأدوات */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full sm:w-64">
          <ClipboardList className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث في بنود الوثيقة…"
            className="h-11 ps-9"
            aria-label="بحث في بنود وثيقة BOQ"
          />
        </div>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2 sm:flex-none">
          <Button className="h-11 gap-2 font-semibold" onClick={() => setItemDialog({ mode: 'add' })}>
            <Plus className="size-4" aria-hidden />
            إضافة بند
          </Button>
          <Button variant="outline" className="h-11 gap-2" onClick={() => setImportOpen(true)}>
            <Upload className="size-4" aria-hidden />
            استيراد ملف BOQ
          </Button>
        </div>
      </div>

      {/* الشجرة */}
      {items.length === 0 ? (
        <div className="py-12 text-center">
          <Layers className="size-8 mx-auto mb-2 opacity-40" aria-hidden />
          <p className="text-sm text-muted-foreground mb-4">لا توجد بنود — أضف بنداً يدوياً أو استورد ملف BOQ</p>
          <div className="flex items-center justify-center gap-2">
            <Button variant="outline" className="h-11 gap-2" onClick={() => setItemDialog({ mode: 'add' })}>
              <Plus className="size-4" aria-hidden />
              إضافة أول بند
            </Button>
            <Button variant="outline" className="h-11 gap-2" onClick={() => setImportOpen(true)}>
              <Upload className="size-4" aria-hidden />
              استيراد ملف
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {sections.map((g) => {
            const open = openSections.has(g.key)
            return (
              <div key={g.key} className="rounded-xl border overflow-hidden">
                {/* رأس القسم — قابل للطي */}
                <button
                  type="button"
                  className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-muted/50 transition-colors text-start"
                  onClick={() => toggleSection(g.key)}
                  aria-expanded={open}
                >
                  <ChevronDown
                    className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? '' : '-rotate-90'}`}
                    aria-hidden
                  />
                  {g.code ? (
                    <Badge variant="secondary" className="numeric shrink-0" dir="ltr">{g.code}</Badge>
                  ) : (
                    <Badge variant="outline" className="shrink-0 text-muted-foreground">بلا قسم</Badge>
                  )}
                  <span className="font-semibold text-sm truncate flex-1">{g.name || '—'}</span>
                  <span className="text-xs text-muted-foreground shrink-0 numeric">{g.items.length} بند</span>
                  <span className="text-sm font-bold numeric shrink-0" dir="ltr">{formatKWD(g.total)}</span>
                </button>

                {/* بنود القسم */}
                {open && (
                  <div className="border-t">
                    {/* سطح المكتب */}
                    <div className="hidden md:block max-h-80 overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/40">
                            <TableHead className="text-start h-9">رقم البند</TableHead>
                            <TableHead className="text-start h-9">الوصف</TableHead>
                            <TableHead className="text-start h-9">الكمية</TableHead>
                            <TableHead className="text-start h-9">الوحدة</TableHead>
                            <TableHead className="text-start h-9">سعر الوحدة</TableHead>
                            <TableHead className="text-start h-9">الإجمالي</TableHead>
                            <TableHead className="text-start h-9">إجراءات</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {g.items.map((it) => (
                            <TableRow key={it.id}>
                              <TableCell className="numeric whitespace-nowrap text-muted-foreground" dir="ltr">{it.itemNo || '—'}</TableCell>
                              <TableCell className="font-semibold max-w-80">
                                <span className="block truncate" title={it.description}>{it.description}</span>
                              </TableCell>
                              <TableCell className="numeric">{it.qty}</TableCell>
                              <TableCell>{it.unit || '—'}</TableCell>
                              <TableCell className="numeric" dir="ltr">{formatKWD(it.unitPrice)}</TableCell>
                              <TableCell className="font-semibold numeric" dir="ltr">{formatKWD(it.total)}</TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1.5">
                                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setItemDialog({ mode: 'edit', item: it })} aria-label={`تعديل البند ${it.description}`}>
                                    <Pencil className="size-3.5" />
                                  </Button>
                                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeletingItem(it)} aria-label={`حذف البند ${it.description}`}>
                                    <Trash2 className="size-3.5" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    {/* الجوال */}
                    <div className="md:hidden divide-y">
                      {g.items.map((it) => (
                        <div key={it.id} className="px-3 py-2.5 space-y-1.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {it.itemNo && <span className="numeric text-xs text-muted-foreground shrink-0" dir="ltr">{it.itemNo}</span>}
                              <span className="text-sm font-semibold leading-snug line-clamp-2">{it.description}</span>
                            </div>
                            <span className="text-sm font-bold numeric shrink-0" dir="ltr">{formatKWD(it.total)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs text-muted-foreground numeric">{it.qty} {it.unit || ''} × {formatKWD(it.unitPrice)}</span>
                            <div className="flex items-center gap-1">
                              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setItemDialog({ mode: 'edit', item: it })} aria-label={`تعديل البند ${it.description}`}>
                                <Pencil className="size-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeletingItem(it)} aria-label={`حذف البند ${it.description}`}>
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          {q && (
            <p className="text-xs text-muted-foreground text-center">
              نتائج البحث: {filtered.length} بنداً — الإجمالي {formatKWD(grandTotal)}
            </p>
          )}
        </div>
      )}

      {/* حوارات */}
      <DocItemDialog
        open={itemDialog != null}
        docId={docId}
        sections={groupSections(items)}
        editing={itemDialog?.mode === 'edit' ? itemDialog.item : null}
        presetSectionKey={itemDialog?.mode === 'add' ? itemDialog.sectionKey : undefined}
        onOpenChange={(o) => { if (!o) setItemDialog(null) }}
      />
      <BoqDocImportDialog
        docId={docId}
        docName={data.name}
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => {
          invalidate()
          setUserOpenSections(null) // أعِد الافتراضي المشتق بعد الاستيراد
        }}
      />
      <DocMetaDialog open={metaOpen} doc={data} onOpenChange={setMetaOpen} />
      <AlertDialog open={confirmDeleteDoc} onOpenChange={setConfirmDeleteDoc}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف وثيقة BOQ؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيُحذف «{data.name}» مع {data.itemCount} بنداً — لا يمكن التراجع.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => deleteDocMutation.mutate()}>
              حذف نهائي
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={deletingItem != null} onOpenChange={(o) => { if (!o) setDeletingItem(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف البند؟</AlertDialogTitle>
            <AlertDialogDescription>
              «{deletingItem?.description}» — إن كان آخر بند في قسمه فسيُسقط القسم من الشجرة تلقائياً.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => deletingItem && deleteItemMutation.mutate(deletingItem.id)}>
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ============================================================
// حوار بند (إضافة/تعديل) — باختيار القسم من الشجرة أو قسم جديد
// النموذج يُعاد تركيبه عند كل فتح (القيم الأولية من props — بلا useEffect)
// ============================================================
function DocItemDialog({
  open, docId, sections, editing, presetSectionKey, onOpenChange,
}: {
  open: boolean
  docId: number
  sections: SectionGroup[]
  editing: BoqDocItemDTO | null
  presetSectionKey?: string
  onOpenChange: (o: boolean) => void
}) {
  const formKey = editing ? `edit-${editing.id}` : `add-${presetSectionKey ?? 'none'}`
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[92vh] overflow-y-auto">
        {open && <DocItemForm key={formKey} docId={docId} sections={sections} editing={editing} presetSectionKey={presetSectionKey} onOpenChange={onOpenChange} />}
      </DialogContent>
    </Dialog>
  )
}

function DocItemForm({
  docId, sections, editing, presetSectionKey, onOpenChange,
}: {
  docId: number
  sections: SectionGroup[]
  editing: BoqDocItemDTO | null
  presetSectionKey?: string
  onOpenChange: (o: boolean) => void
}) {
  const qc = useQueryClient()
  const [itemNo, setItemNo] = useState(editing?.itemNo ?? '')
  const [divisionKey, setDivisionKey] = useState<string>(
    editing ? editing.divisionCode || 'none' : presetSectionKey && presetSectionKey !== '_' ? presetSectionKey : 'none',
  ) // مفتاح القسم المختار أو 'new' أو 'none'
  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')
  const [description, setDescription] = useState(editing?.description ?? '')
  const [qty, setQty] = useState(editing ? String(editing.qty) : '1')
  const [unit, setUnit] = useState(editing?.unit ?? '')
  const [unitPrice, setUnitPrice] = useState(editing ? String(editing.unitPrice) : '0')

  const nQty = Number(qty) || 0
  const nPrice = Number(unitPrice) || 0
  const liveTotal = round3(nQty * nPrice)

  const saveMutation = useMutation({
    mutationFn: () => {
      const isNone = divisionKey === 'none'
      const isNew = divisionKey === 'new'
      const picked = sections.find((g) => g.key === divisionKey)
      const payload = {
        itemNo: itemNo.trim(),
        divisionCode: isNone ? '' : isNew ? newCode.trim() : picked?.code ?? '',
        divisionName: isNone ? '' : isNew ? newName.trim() : picked?.name ?? '',
        description: description.trim(),
        qty: nQty || 1,
        unit: unit.trim(),
        unitPrice: nPrice,
      }
      return editing ? boqApi.updateDocItem(editing.id, payload) : boqApi.addDocItem(docId, payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['boq-doc', docId] })
      qc.invalidateQueries({ queryKey: ['boq-docs'] })
      toast.success(editing ? 'تم تحديث البند' : 'تم إضافة البند للوثيقة')
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e instanceof ApiError ? e.message : e.message),
  })

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editing ? 'تعديل بند' : 'إضافة بند'}</DialogTitle>
        <DialogDescription>
          البند يقع في شجرته حسب القسم — اختر قسماً قائماً أو أنشئ جديداً أو اتركه بلا قسم.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3.5 py-1">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="boq-item-no">رقم البند</Label>
            <Input id="boq-item-no" value={itemNo} onChange={(e) => setItemNo(e.target.value)} placeholder="03.30.01" className="h-11" dir="ltr" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="boq-item-division">القسم</Label>
            <Select value={divisionKey} onValueChange={setDivisionKey}>
              <SelectTrigger id="boq-item-division" className="h-11">
                <SelectValue placeholder="اختر القسم" />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                <SelectItem value="none">بلا قسم</SelectItem>
                {sections.filter((g) => g.code).map((g) => (
                  <SelectItem key={g.key} value={g.key}>
                    <span className="numeric me-1.5" dir="ltr">{g.code}</span>{g.name}
                  </SelectItem>
                ))}
                <SelectItem value="new">✚ قسم جديد…</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {divisionKey === 'new' && (
          <div className="grid grid-cols-2 gap-3 rounded-lg border p-3 bg-muted/30">
            <div className="space-y-1.5">
              <Label htmlFor="boq-new-div-code">رقم القسم الجديد</Label>
              <Input id="boq-new-div-code" value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="09" className="h-11" dir="ltr" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="boq-new-div-name">اسم القسم الجديد</Label>
              <Input id="boq-new-div-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="FINISHES" className="h-11" />
            </div>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="boq-item-desc">وصف البند *</Label>
          <Input id="boq-item-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="توريد وتركيب…" className="h-11" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="boq-item-qty">الكمية</Label>
            <Input id="boq-item-qty" type="number" min="0" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} className="h-11 numeric" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="boq-item-unit">الوحدة</Label>
            <Input id="boq-item-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="م² / عدد / L.S." className="h-11" list="boq-unit-suggestions" />
            <datalist id="boq-unit-suggestions">
              {UNIT_SUGGESTIONS.map((u) => <option key={u} value={u} />)}
            </datalist>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="boq-item-price">سعر الوحدة</Label>
            <Input id="boq-item-price" type="number" min="0" step="0.001" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} className="h-11 numeric" />
          </div>
        </div>
        <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2">
          <span className="text-sm text-muted-foreground">الإجمالي (كمية × سعر)</span>
          <span className="text-base font-bold numeric" dir="ltr">{formatKWD(liveTotal)}</span>
        </div>
      </div>
      <DialogFooter className="gap-2">
        <Button variant="outline" className="h-11" disabled={saveMutation.isPending} onClick={() => onOpenChange(false)}>إلغاء</Button>
        <Button
          className="h-11 gap-2 font-semibold"
          disabled={saveMutation.isPending || !description.trim() || (divisionKey === 'new' && !newCode.trim())}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {editing ? 'حفظ التعديلات' : 'إضافة البند'}
        </Button>
      </DialogFooter>
    </>
  )
}
