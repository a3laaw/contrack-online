'use client'

// ============================================================
// ConTrack Online — ملف العميل التفصيلي (Task 15-b — spec-8-f §4.2)
// «كل شيء عن العميل في شاشة واحدة»: رأس بيانات + 4 بطاقات ملخص + 6 تابات
// (العقود بأشرطة تقدم · السندات · الفواتير · التعليقات بحوار إضافة ·
//  الخط الزمني · المهام)
// يُفتح من: شاشة العملاء / البحث الشامل / لوحة المؤشرات عبر onNavigate
// ============================================================

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight, CalendarClock, CheckCircle2, Clock, FileText, Landmark,
  Loader2, Pencil, Phone, Pin, PinOff, Plus, Receipt, ReceiptText, Trash2, Undo2, User,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ApiError } from './api'
import { commentsApi, customerFileApi, tasksApi } from '@/lib/productivity-api'
import { formatDate, formatKWD, statusBadgeClass, voucherTypeBadgeClass, voucherTypeLabel } from '@/lib/format'
import type { SessionUser } from '@/lib/contrack-types'
import type { CommentDTO, CustomerFileDTO } from '@/lib/productivity-types'

export interface CustomerDetailViewProps {
  customerId: number
  user: SessionUser
  onBack?: () => void
  /** لفتح مركز العقد من تاب العقود (وُفِّر اختياريًا لسهولة الدمج) */
  onNavigate?: (view: { name: 'contract'; contractId: number }) => void
}

const isAdmin = (role: string) => role === 'admin' || role === 'developer'

/** أيقونة الحدث الزمني — كلمات مفتاحية مثل الأصل (archive.py س544-578) */
function eventIcon(eventType: string): string {
  if (eventType.includes('قبض')) return '📥'
  if (eventType.includes('صرف')) return '📤'
  if (eventType.includes('إلغاء')) return '❌'
  if (eventType.includes('إنشاء')) return '🟢'
  if (eventType.includes('اعتماد')) return '✅'
  if (eventType.includes('ملحق') || eventType.includes('أمر')) return '📎'
  if (eventType.includes('إيقاف') || eventType.includes('توقف')) return '⏸'
  if (eventType.includes('تفعيل') || eventType.includes('استرجاع')) return '▶'
  if (eventType.includes('إغلاق') || eventType.includes('مغلق')) return '🔒'
  if (eventType.includes('انتهاء') || eventType.includes('منتهي')) return '🏁'
  if (eventType.includes('باطن')) return '👷'
  if (eventType.includes('فاتورة')) return '🧾'
  if (eventType.includes('دفعة')) return '💳'
  if (eventType.includes('بند')) return '📐'
  if (eventType.includes('إشراف')) return '🏗'
  return '📌'
}

/** لون المتبقي: أخضر ≤ 0.001 — أحمر لو متأخر — كهرماني غير ذلك (archive.py س356-381) */
function remainingClass(summary: CustomerFileDTO['summary']): string {
  if (summary.remaining <= 0.001) return 'text-emerald-600 dark:text-emerald-300'
  if (summary.overdue.has) return 'text-red-600 dark:text-red-300'
  return 'text-amber-600 dark:text-amber-300'
}

export function CustomerDetailView({ customerId, user, onBack, onNavigate }: CustomerDetailViewProps) {
  const { data: file, isLoading, error } = useQuery({
    queryKey: ['customer-file', customerId],
    queryFn: () => customerFileApi.file(customerId),
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 rounded-xl" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  if (error || !file) {
    return (
      <div className="space-y-4">
        {onBack && (
          <Button variant="ghost" className="h-11 gap-2" onClick={onBack}>
            <ArrowRight className="size-4" aria-hidden /> رجوع
          </Button>
        )}
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 text-destructive px-4 py-3 text-sm">
          تعذر تحميل ملف العميل: {(error as Error | undefined)?.message ?? 'غير معروف'}
        </div>
      </div>
    )
  }

  const { customer, summary } = file

  return (
    <div className="space-y-4">
      {/* رأس بيانات العميل */}
      <Card>
        <CardContent className="p-4 sm:p-6 space-y-3">
          <div className="flex items-start gap-3">
            {onBack && (
              <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={onBack} aria-label="رجوع">
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg sm:text-xl font-extrabold truncate">{customer.name}</h2>
                <Badge variant="secondary" className="numeric">{customer.customerCode}</Badge>
                {customer.archived && (
                  <Badge className="bg-stone-200 text-stone-700 border border-stone-300 dark:bg-stone-800 dark:text-stone-300 dark:border-stone-700">
                    مؤرشف
                  </Badge>
                )}
                {summary.overdue.has && (
                  <TooltipProvider delayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge className="bg-red-100 text-red-800 border border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900 cursor-help">
                          🔴 متأخرات
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        على العميل {summary.overdue.count} قسط متأخر في {summary.overdue.contracts} عقد (أقصى تأخر {summary.overdue.maxDaysLate} يومًا)
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {customer.phone && (
                  <span className="inline-flex items-center gap-1 numeric" dir="ltr">
                    <Phone className="size-3" aria-hidden /> {customer.phone}
                  </span>
                )}
                {(customer.addressGovernorate || customer.addressArea || customer.address) && (
                  <span className="inline-flex items-center gap-1">
                    <Landmark className="size-3" aria-hidden />
                    {[customer.addressGovernorate, customer.addressArea, customer.address].filter(Boolean).join(' — ')}
                  </span>
                )}
                {customer.email && (
                  <span className="inline-flex items-center gap-1" dir="ltr">
                    <User className="size-3" aria-hidden /> {customer.email}
                  </span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 4 بطاقات الملخص */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard
          label="العقود"
          value={`${summary.contractsCount}`}
          hint={`نشط: ${summary.activeCount}`}
        />
        <SummaryCard
          label="القيمة الحالية"
          value={formatKWD(summary.currentTotal)}
          hint={`الخام: ${formatKWD(summary.totalRaw)}`}
          tone="text-teal-600 dark:text-teal-300"
        />
        <SummaryCard
          label="المحصّل"
          value={formatKWD(summary.collected)}
          tone="text-emerald-600 dark:text-emerald-300"
        />
        <SummaryCard
          label="المتبقي"
          value={formatKWD(summary.remaining)}
          tone={remainingClass(summary)}
        />
      </div>

      {/* التابات */}
      <Tabs defaultValue="contracts">
        <TabsList className="w-full flex flex-wrap h-auto gap-1">
          <TabsTrigger value="contracts">العقود ({file.contracts.length})</TabsTrigger>
          <TabsTrigger value="vouchers">السندات ({file.vouchers.length})</TabsTrigger>
          <TabsTrigger value="invoices">الفواتير ({file.invoices.length})</TabsTrigger>
          <TabsTrigger value="comments">التعليقات ({file.comments.length})</TabsTrigger>
          <TabsTrigger value="timeline">الخط الزمني</TabsTrigger>
          <TabsTrigger value="tasks">المهام ({file.tasks.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="contracts"><ContractsTab file={file} onNavigate={onNavigate} /></TabsContent>
        <TabsContent value="vouchers"><VouchersTab file={file} /></TabsContent>
        <TabsContent value="invoices"><InvoicesTab file={file} /></TabsContent>
        <TabsContent value="comments"><CommentsTab file={file} user={user} /></TabsContent>
        <TabsContent value="timeline"><TimelineTab file={file} /></TabsContent>
        <TabsContent value="tasks"><TasksTab file={file} /></TabsContent>
      </Tabs>
    </div>
  )
}

function SummaryCard({ label, value, hint, tone = 'text-foreground' }: {
  label: string
  value: string
  hint?: string
  tone?: string
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-lg sm:text-xl font-extrabold numeric mt-1 ${tone}`}>{value}</p>
        {hint && <p className="text-[11px] text-muted-foreground numeric mt-0.5">{hint}</p>}
      </CardContent>
    </Card>
  )
}

// ============================================================
// تاب العقود — بأشرطة تقدم
// ============================================================
function ContractsTab({ file, onNavigate }: {
  file: CustomerFileDTO
  onNavigate?: CustomerDetailViewProps['onNavigate']
}) {
  const { contracts } = file
  if (contracts.length === 0) {
    return <EmptyBox icon={FileText} text="لا عقود لهذا العميل بعد" />
  }
  return (
    <>
      {/* سطح المكتب */}
      <Card className="hidden md:block">
        <CardContent className="p-0">
          <div className="max-h-96 overflow-y-auto cmd-scroll">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">العقد</TableHead>
                  <TableHead className="text-start">الحالة</TableHead>
                  <TableHead className="text-start">القيمة الحالية</TableHead>
                  <TableHead className="text-start">المحصّل</TableHead>
                  <TableHead className="text-start">المتبقي</TableHead>
                  <TableHead className="text-start min-w-36">التقدم</TableHead>
                  <TableHead className="text-start">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contracts.map((k) => (
                  <TableRow key={k.id} className={k.hasOverdue ? 'bg-red-50/60 dark:bg-red-950/20' : ''}>
                    <TableCell>
                      <p className="font-semibold numeric" dir="ltr">{k.contractNumber}</p>
                      <p className="text-xs text-muted-foreground truncate max-w-52">
                        {k.contractName || '—'} · {k.contractDate}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge className={statusBadgeClass(k.status)}>{k.status}</Badge>
                      {k.hasOverdue && <span className="ms-1" title="عليه دفعة متأخرة">🔴</span>}
                    </TableCell>
                    <TableCell className="numeric font-semibold">{formatKWD(k.currentValue)}</TableCell>
                    <TableCell className="numeric text-emerald-700 dark:text-emerald-300">{formatKWD(k.collected)}</TableCell>
                    <TableCell className={`numeric font-bold ${k.remaining > 0.001 ? 'text-red-600 dark:text-red-300' : 'text-emerald-600 dark:text-emerald-300'}`}>
                      {formatKWD(k.remaining)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 flex-1 rounded-full bg-stone-200 dark:bg-stone-800 overflow-hidden" role="progressbar" aria-valuenow={k.progressPct} aria-valuemin={0} aria-valuemax={100}>
                          <div
                            className="h-full rounded-full bg-emerald-500"
                            style={{ width: `${k.progressPct}%` }}
                          />
                        </div>
                        <span className="text-xs numeric text-muted-foreground w-9">{k.progressPct}%</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {onNavigate && (
                        <Button size="sm" variant="outline" className="h-9 gap-1" onClick={() => onNavigate({ name: 'contract', contractId: k.id })}>
                          <FileText className="size-3.5" aria-hidden /> مركز العقد
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* الجوال */}
      <div className="md:hidden space-y-3">
        {contracts.map((k) => (
          <Card key={k.id} className={k.hasOverdue ? 'border-red-300 dark:border-red-900' : ''}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold numeric" dir="ltr">{k.contractNumber}</span>
                <Badge className={statusBadgeClass(k.status)}>{k.status}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{k.contractName || '—'} · {k.contractDate}</p>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div><span className="text-muted-foreground block">القيمة</span><span className="numeric font-semibold">{formatKWD(k.currentValue)}</span></div>
                <div><span className="text-muted-foreground block">المحصّل</span><span className="numeric text-emerald-700 dark:text-emerald-300">{formatKWD(k.collected)}</span></div>
                <div><span className="text-muted-foreground block">المتبقي</span><span className={`numeric font-bold ${k.remaining > 0.001 ? 'text-red-600 dark:text-red-300' : ''}`}>{formatKWD(k.remaining)}</span></div>
              </div>
              <div className="h-2.5 rounded-full bg-stone-200 dark:bg-stone-800 overflow-hidden" role="progressbar" aria-valuenow={k.progressPct} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${k.progressPct}%` }} />
              </div>
              {onNavigate && (
                <Button size="sm" variant="outline" className="h-10 w-full gap-1.5" onClick={() => onNavigate({ name: 'contract', contractId: k.id })}>
                  <FileText className="size-4" aria-hidden /> مركز العقد
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  )
}

// ============================================================
// تاب السندات
// ============================================================
function VouchersTab({ file }: { file: CustomerFileDTO }) {
  const { vouchers } = file
  if (vouchers.length === 0) return <EmptyBox icon={Receipt} text="لا سندات لهذا العميل" />
  return (
    <Card>
      <CardContent className="p-0">
        <div className="max-h-96 overflow-y-auto cmd-scroll">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start">السند</TableHead>
                <TableHead className="text-start">النوع</TableHead>
                <TableHead className="text-start">التاريخ</TableHead>
                <TableHead className="text-start">المبلغ</TableHead>
                <TableHead className="text-start">الطرف</TableHead>
                <TableHead className="text-start">العقد</TableHead>
                <TableHead className="text-start">الوصف</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vouchers.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-bold numeric" dir="ltr">{v.voucherNumber}</TableCell>
                  <TableCell>
                    <Badge className={voucherTypeBadgeClass(v.vtype)}>{voucherTypeLabel(v.vtype)}</Badge>
                    {v.cancelled && (
                      <Badge className="ms-1 bg-red-100 text-red-800 border border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900">ملغى</Badge>
                    )}
                  </TableCell>
                  <TableCell className="numeric" dir="ltr">{formatDate(v.vdate)}</TableCell>
                  <TableCell className="numeric font-semibold">{formatKWD(v.amount)}</TableCell>
                  <TableCell className="max-w-36"><span className="truncate block">{v.party || '—'}</span></TableCell>
                  <TableCell className="numeric" dir="ltr">{v.contractNumber ?? '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-44"><span className="truncate block">{v.description || '—'}</span></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

// ============================================================
// تاب الفواتير
// ============================================================
function InvoicesTab({ file }: { file: CustomerFileDTO }) {
  const { invoices } = file
  if (invoices.length === 0) return <EmptyBox icon={ReceiptText} text="لا فواتير لهذا العميل" />
  return (
    <Card>
      <CardContent className="p-0">
        <div className="max-h-96 overflow-y-auto cmd-scroll">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start">الفاتورة</TableHead>
                <TableHead className="text-start">التاريخ</TableHead>
                <TableHead className="text-start">المبلغ</TableHead>
                <TableHead className="text-start">العقد</TableHead>
                <TableHead className="text-start">الوصف</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-bold numeric" dir="ltr">{inv.invoiceNumber}</TableCell>
                  <TableCell className="numeric" dir="ltr">{formatDate(inv.invoiceDate)}</TableCell>
                  <TableCell className="numeric font-semibold">{formatKWD(inv.amount)}</TableCell>
                  <TableCell className="numeric" dir="ltr">{inv.contractNumber ?? '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-52"><span className="truncate block">{inv.description || '—'}</span></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

// ============================================================
// تاب التعليقات — فقاعات + حوار إضافة + تثبيت/تعديل (مدير) + حذف ناعم
// ============================================================
function CommentsTab({ file, user }: { file: CustomerFileDTO; user: SessionUser }) {
  const qc = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<CommentDTO | null>(null)
  const [deleting, setDeleting] = useState<CommentDTO | null>(null)

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['customer-file', file.customer.id] })
    qc.invalidateQueries({ queryKey: ['comments'] })
  }

  const pinMut = useMutation({
    mutationFn: (id: number) => commentsApi.togglePin(id),
    onSuccess: (r) => {
      invalidate()
      toast.success(r.pinned ? 'تم تثبيت التعليق' : 'أُلغي تثبيت التعليق')
    },
    onError: (e: Error) => toast.error(e instanceof ApiError ? e.message : e.message),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => commentsApi.remove(id),
    onSuccess: () => {
      invalidate()
      toast.success('حُذف التعليق (حذف ناعم — يبقى في قاعدة البيانات)')
      setDeleting(null)
    },
    onError: (e: Error) => toast.error(e instanceof ApiError ? e.message : e.message),
  })

  const isOwner = (c: CommentDTO) =>
    c.author === user.username || (user.fullName !== '' && c.author === user.fullName)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          فقاعات مؤرخة — التثبيت والتعديل للمدير فقط، والحذف للصاحب أو المدير (حذف ناعم)
        </p>
        <Button className="h-11 gap-2 font-semibold" onClick={() => setAddOpen(true)}>
          <Plus className="size-4" aria-hidden /> تعليق جديد
        </Button>
      </div>

      {file.comments.length === 0 ? (
        <EmptyBox icon={Pin} text="لا تعليقات على هذا العميل بعد" />
      ) : (
        <div className="space-y-3 max-h-96 overflow-y-auto cmd-scroll pe-1">
          {file.comments.map((c) => (
            <Card key={c.id} className={c.pinned ? 'border-amber-300 dark:border-amber-900' : ''}>
              <CardContent className="p-4 space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-bold">{c.author}</span>
                  <span className="text-muted-foreground numeric" dir="ltr">
                    <Clock className="inline size-3" aria-hidden /> {formatDate(c.createdAt)} {c.createdAt.slice(11, 16)}
                  </span>
                  {c.kind === 'تنبيه' && (
                    <Badge className="bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900">تنبيه</Badge>
                  )}
                  {c.kind === 'تلقائي' && <Badge variant="secondary">تلقائي</Badge>}
                  {c.priority !== 'عادي' && (
                    <Badge className={c.priority === 'عاجل'
                      ? 'bg-red-100 text-red-800 border border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900'
                      : 'bg-orange-100 text-orange-800 border border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-900'}>
                      {c.priority}
                    </Badge>
                  )}
                  {c.pinned && (
                    <Badge className="bg-stone-200 text-stone-700 border border-stone-300 dark:bg-stone-800 dark:text-stone-300 dark:border-stone-700">
                      <Pin className="size-3 me-1" aria-hidden /> مثبّت
                    </Badge>
                  )}
                  {c.contractNumber && (
                    <Badge variant="outline" className="numeric">{c.contractNumber}</Badge>
                  )}
                  {c.followupDate && (
                    <Badge variant="outline" className="gap-1">
                      <CalendarClock className="size-3" aria-hidden /> متابعة: {formatDate(c.followupDate)}
                    </Badge>
                  )}
                </div>
                <p className="text-sm whitespace-pre-wrap">{c.text}</p>
                <div className="flex items-center gap-1 pt-1">
                  {isAdmin(user.role) && (
                    <>
                      <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={() => pinMut.mutate(c.id)}>
                        {c.pinned ? <PinOff className="size-3.5" aria-hidden /> : <Pin className="size-3.5" aria-hidden />}
                        {c.pinned ? 'إلغاء التثبيت' : 'تثبيت'}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={() => setEditing(c)}>
                        <Pencil className="size-3.5" aria-hidden /> تعديل
                      </Button>
                    </>
                  )}
                  {(isAdmin(user.role) || isOwner(c)) && (
                    <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs text-destructive hover:text-destructive" onClick={() => setDeleting(c)}>
                      <Trash2 className="size-3.5" aria-hidden /> حذف
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CommentAddDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        customerId={file.customer.id}
        onSaved={invalidate}
      />

      <CommentEditDialog
        comment={editing}
        onClose={() => setEditing(null)}
        onSaved={invalidate}
      />

      <AlertDialog open={deleting != null} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف التعليق؟</AlertDialogTitle>
            <AlertDialogDescription>
              الحذف ناعم — يختفي من الشاشات ويبقى في قاعدة البيانات (لا حذف فيزيائي كأصل النظام).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleting && deleteMut.mutate(deleting.id)}
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function CommentAddDialog({ open, onOpenChange, customerId, onSaved }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  customerId: number
  onSaved: () => void
}) {
  const [text, setText] = useState('')
  const [kind, setKind] = useState('تعليق')
  const [priority, setPriority] = useState('عادي')
  const [followupDate, setFollowupDate] = useState('')
  const [initialized, setInitialized] = useState(false)

  if (open && !initialized) {
    setText('')
    setKind('تعليق')
    setPriority('عادي')
    setFollowupDate('')
    setInitialized(true)
  }
  if (!open && initialized) setInitialized(false)

  const mutation = useMutation({
    mutationFn: () =>
      commentsApi.create({
        customerId,
        text: text.trim(),
        kind: kind as 'تعليق' | 'تنبيه',
        priority: priority as 'عادي' | 'مهم' | 'عاجل',
        followupDate: followupDate || null,
      }),
    onSuccess: () => {
      onSaved()
      toast.success('أُضيف التعليق')
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e instanceof ApiError ? e.message : e.message),
  })

  function submit() {
    if (!text.trim()) {
      toast.error('نص التعليق إلزامي')
      return
    }
    if (text.trim().length > 2000) {
      toast.error('الحد الأقصى 2000 حرف')
      return
    }
    mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>تعليق جديد</DialogTitle>
          <DialogDescription>يُسجل باسمك من الجلسة — حد 2000 حرف</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="cm-text">النص *</Label>
            <Textarea id="cm-text" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="اكتب التعليق…" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>النوع</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger className="h-11 w-full" aria-label="نوع التعليق"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="تعليق">تعليق</SelectItem>
                  <SelectItem value="تنبيه">تنبيه</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>الأولوية</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="h-11 w-full" aria-label="أولوية التعليق"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="عادي">عادي</SelectItem>
                  <SelectItem value="مهم">مهم</SelectItem>
                  <SelectItem value="عاجل">عاجل</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cm-follow">تاريخ المتابعة (اختياري)</Label>
            <Input
              id="cm-follow" type="date" className="h-11 numeric text-start" dir="ltr"
              value={followupDate} onChange={(e) => setFollowupDate(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button className="h-11 gap-2" disabled={mutation.isPending} onClick={submit}>
            {mutation.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />} إضافة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CommentEditDialog({ comment, onClose, onSaved }: {
  comment: CommentDTO | null
  onClose: () => void
  onSaved: () => void
}) {
  const [text, setText] = useState('')
  const [priority, setPriority] = useState('عادي')
  const [followupDate, setFollowupDate] = useState('')
  const [initialized, setInitialized] = useState(false)

  const open = comment != null
  if (open && !initialized) {
    setText(comment.text)
    setPriority(comment.priority)
    setFollowupDate(comment.followupDate ?? '')
    setInitialized(true)
  }
  if (!open && initialized) setInitialized(false)

  const mutation = useMutation({
    mutationFn: () =>
      commentsApi.edit(comment!.id, {
        text: text.trim(),
        priority: priority as 'عادي' | 'مهم' | 'عاجل',
        followupDate: followupDate || null,
      }),
    onSuccess: () => {
      onSaved()
      toast.success('تم تعديل التعليق')
      onClose()
    },
    onError: (e: Error) => toast.error(e instanceof ApiError ? e.message : e.message),
  })

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>تعديل التعليق (مدير)</DialogTitle>
          <DialogDescription>بلا مهلة زمنية — كطلب النظام الأصلي</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="cme-text">النص *</Label>
            <Textarea id="cme-text" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>الأولوية</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="h-11 w-full" aria-label="أولوية التعليق"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="عادي">عادي</SelectItem>
                  <SelectItem value="مهم">مهم</SelectItem>
                  <SelectItem value="عاجل">عاجل</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cme-follow">تاريخ المتابعة</Label>
              <Input
                id="cme-follow" type="date" className="h-11 numeric text-start" dir="ltr"
                value={followupDate} onChange={(e) => setFollowupDate(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={onClose}>إلغاء</Button>
          <Button
            className="h-11 gap-2"
            disabled={mutation.isPending}
            onClick={() => {
              if (!text.trim()) {
                toast.error('نص التعليق إلزامي')
                return
              }
              mutation.mutate()
            }}
          >
            {mutation.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />} حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================
// تاب الخط الزمني — آخر 20 حدثًا بأيقونات
// ============================================================
function TimelineTab({ file }: { file: CustomerFileDTO }) {
  const events = file.timeline
  if (events.length === 0) return <EmptyBox icon={Clock} text="لا أحداث زمنية بعد" />
  return (
    <Card>
      <CardContent className="p-4">
        <ol className="relative space-y-4 border-s ps-5 max-h-96 overflow-y-auto cmd-scroll">
          {events.map((ev) => (
            <li key={ev.id} className="space-y-0.5">
              <span className="absolute -start-3 bg-card text-base leading-none" aria-hidden>{eventIcon(ev.eventType)}</span>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-bold">{ev.eventType}</span>
                <Badge variant="outline" className="numeric">{ev.contractNumber}</Badge>
                <span className="text-muted-foreground numeric" dir="ltr">
                  {formatDate(ev.eventTime)} {ev.eventTime.slice(11, 16)}
                </span>
                {ev.username && <span className="text-muted-foreground">— {ev.username}</span>}
              </div>
              {ev.description && <p className="text-sm text-muted-foreground">{ev.description}</p>}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}

// ============================================================
// تاب المهام — قائمة + إنجاز/إعادة فتح سريع
// ============================================================
function TasksTab({ file }: { file: CustomerFileDTO }) {
  const qc = useQueryClient()
  const tasks = file.tasks

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['customer-file', file.customer.id] })
    qc.invalidateQueries({ queryKey: ['tasks'] })
  }

  const completeMut = useMutation({
    mutationFn: (id: number) => tasksApi.complete(id),
    onSuccess: () => { invalidate(); toast.success('تم إنجاز المهمة') },
    onError: (e: Error) => toast.error(e instanceof ApiError ? e.message : e.message),
  })
  const reopenMut = useMutation({
    mutationFn: (id: number) => tasksApi.reopen(id),
    onSuccess: () => { invalidate(); toast.success('أُعيدت فتح المهمة') },
    onError: (e: Error) => toast.error(e instanceof ApiError ? e.message : e.message),
  })

  if (tasks.length === 0) return <EmptyBox icon={CheckCircle2} text="لا مهام مرتبطة بهذا العميل" />

  return (
    <div className="space-y-2 max-h-96 overflow-y-auto cmd-scroll">
      {tasks.map((t) => (
        <Card key={t.id} className={t.overdue ? 'border-red-300 dark:border-red-900' : ''}>
          <CardContent className="p-3 sm:p-4 flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-bold truncate ${t.overdue ? 'text-red-700 dark:text-red-300' : ''}`}>{t.title}</p>
              <p className="text-xs text-muted-foreground">
                {t.dueAt ? `${formatDate(t.dueAt)} ${t.dueAt.slice(11, 16)}` : 'بدون موعد'}
                {t.contractNumber ? ` · ${t.contractNumber}` : ''}
                {t.overdue ? ' · متأخرة' : ''}
              </p>
            </div>
            {t.status === 'مفتوحة' ? (
              <Badge variant="secondary">مفتوحة</Badge>
            ) : (
              <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900">منجزة</Badge>
            )}
            {t.status === 'مفتوحة' ? (
              <Button size="sm" variant="outline" className="h-9 gap-1" onClick={() => completeMut.mutate(t.id)}>
                <CheckCircle2 className="size-3.5 text-emerald-600" aria-hidden /> إنجاز
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="h-9 gap-1" onClick={() => reopenMut.mutate(t.id)}>
                <Undo2 className="size-3.5" aria-hidden /> إعادة فتح
              </Button>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function EmptyBox({ icon: Icon, text }: { icon: typeof FileText; text: string }) {
  return (
    <div className="py-12 text-center text-sm text-muted-foreground rounded-lg border border-dashed">
      <Icon className="size-8 mx-auto mb-2 opacity-40" aria-hidden />
      {text}
    </div>
  )
}
