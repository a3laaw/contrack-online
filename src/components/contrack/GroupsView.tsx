'use client'

// ============================================================
// ConTrack Online — شاشة مجموعات العقود (Task 15-b — spec-8-f §6)
// ربط تنظيمي بلا دمج مالي: قائمة مجموعات + حوار إنشاء/إدارة (إضافة/إزالة
// عقود بالبحث) + بطاقات إجماليات
// الملخص حرفيًا من spec: cost = paid + max(0, subTotal − paid) · profit = collected − cost
// شروط العضوية المخففة: عقدين على الأقل عند الإنشاء — لا عقد ملغى — لا يلزم نفس العميل
// ============================================================

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  FolderPlus, Layers, Loader2, Pencil, Plus, Search, Settings2, Trash2, X,
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
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { api, ApiError } from './api'
import { groupsApi } from '@/lib/productivity-api'
import { formatKWD } from '@/lib/format'
import type { SessionUser } from '@/lib/contrack-types'
import type { ContractListItem } from '@/lib/contrack-types'
import type { GroupSummaryDTO } from '@/lib/productivity-types'

export interface GroupsViewProps {
  user: SessionUser
}

const isAdmin = (role: string) => role === 'admin' || role === 'developer'

export function GroupsView({ user }: GroupsViewProps) {
  const qc = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [managing, setManaging] = useState<GroupSummaryDTO | null>(null)
  const [renaming, setRenaming] = useState<GroupSummaryDTO | null>(null)
  const [deleting, setDeleting] = useState<GroupSummaryDTO | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['groups'],
    queryFn: () => groupsApi.list(),
  })

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['groups'] })
  }

  const deleteMut = useMutation({
    mutationFn: (id: number) => groupsApi.remove(id),
    onSuccess: () => {
      invalidate()
      toast.success('حُذفت المجموعة — العقود لم تُمس إطلاقًا')
      setDeleting(null)
    },
    onError: (e: Error) => toast.error(e instanceof ApiError ? e.message : e.message),
  })

  const totals = data?.totals ?? { groups: 0, contracts: 0, collected: 0, paid: 0, cost: 0, profit: 0 }
  const groups = data?.groups ?? []

  return (
    <div className="space-y-4">
      {/* بطاقات الإجماليات */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <TotalsCard label="المجموعات" value={`${totals.groups}`} hint={`${totals.contracts} عقد داخلها`} />
        <TotalsCard label="إجمالي المحصّل" value={formatKWD(totals.collected)} tone="text-emerald-600 dark:text-emerald-300" />
        <TotalsCard label="إجمالي التكلفة" value={formatKWD(totals.cost)} tone="text-amber-600 dark:text-amber-300" />
        <TotalsCard
          label="إجمالي الربح"
          value={formatKWD(totals.profit)}
          tone={totals.profit >= 0 ? 'text-teal-600 dark:text-teal-300' : 'text-red-600 dark:text-red-300'}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          ربط تنظيمي فقط — لا يدمج العقود ماليًا ولا يغير حساباتها (تصميم + إشراف + كتب بلدية كملف واحد)
        </p>
        <Button className="h-11 gap-2 font-semibold" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" aria-hidden /> مجموعة جديدة
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 text-destructive px-4 py-3 text-sm">
          تعذر تحميل المجموعات: {(error as Error).message}
        </div>
      )}

      {isLoading ? (
        <div className="grid md:grid-cols-2 gap-3">
          {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-56 rounded-xl" />)}
        </div>
      ) : groups.length === 0 ? (
        <div className="py-14 text-center text-sm text-muted-foreground rounded-lg border border-dashed">
          <Layers className="size-8 mx-auto mb-2 opacity-40" aria-hidden />
          لا مجموعات بعد — أنشئ مجموعة تضم عقدين على الأقل
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {groups.map((g) => (
            <Card key={g.id}>
              <CardContent className="p-4 sm:p-6 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-extrabold truncate">{g.name}</p>
                    <p className="text-xs text-muted-foreground numeric">{g.groupNumber} · {g.contractsCount} عقد · أنشأها {g.createdBy || '—'}</p>
                  </div>
                  <Badge
                    className={g.profit >= 0
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900'
                      : 'bg-red-100 text-red-800 border border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900'}
                  >
                    ربح {formatKWD(g.profit)}
                  </Badge>
                </div>

                {g.notes && <p className="text-xs text-muted-foreground line-clamp-2">{g.notes}</p>}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <MiniStat label="القيمة" value={formatKWD(g.currentTotal)} />
                  <MiniStat label="المحصّل" value={formatKWD(g.collected)} cls="text-emerald-700 dark:text-emerald-300" />
                  <MiniStat label="المدفوع" value={formatKWD(g.paid)} cls="text-amber-700 dark:text-amber-300" />
                  <MiniStat label="التكلفة" value={formatKWD(g.cost)} cls="text-orange-700 dark:text-orange-300" />
                </div>

                {/* شريط العقود */}
                <div className="flex flex-wrap gap-1.5">
                  {g.contracts.slice(0, 4).map((k) => (
                    <Badge key={k.id} variant="outline" className="numeric text-[10px]">
                      {k.contractNumber}
                    </Badge>
                  ))}
                  {g.contracts.length > 4 && (
                    <Badge variant="secondary" className="text-[10px]">+{g.contracts.length - 4}</Badge>
                  )}
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <Button size="sm" variant="outline" className="h-10 flex-1 gap-1.5" onClick={() => setManaging(g)}>
                    <Settings2 className="size-4" aria-hidden /> إدارة
                  </Button>
                  {isAdmin(user.role) && (
                    <>
                      <Button size="sm" variant="outline" className="h-10 gap-1.5" onClick={() => setRenaming(g)}>
                        <Pencil className="size-4" aria-hidden /> تعديل
                      </Button>
                      <Button size="sm" variant="outline" className="h-10 gap-1.5 text-destructive hover:text-destructive" onClick={() => setDeleting(g)}>
                        <Trash2 className="size-4" aria-hidden /> حذف
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* حوار الإنشاء */}
      <GroupCreateDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={invalidate} />

      {/* حوار الإدارة */}
      <GroupManageDialog
        group={managing}
        onClose={() => setManaging(null)}
        onSaved={invalidate}
        canRename={isAdmin(user.role)}
        onRename={(g) => { setManaging(null); setRenaming(g) }}
      />

      {/* حوار إعادة التسمية */}
      <GroupRenameDialog group={renaming} onClose={() => setRenaming(null)} onSaved={invalidate} />

      <AlertDialog open={deleting != null} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف المجموعة «{deleting?.name}»؟</AlertDialogTitle>
            <AlertDialogDescription>
              يُحذف الربط التنظيمي فقط — العقود نفسها وبطاقاتها وسنداتها لا تمس إطلاقًا.
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

function TotalsCard({ label, value, hint, tone = 'text-foreground' }: {
  label: string; value: string; hint?: string; tone?: string
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

function MiniStat({ label, value, cls = '' }: { label: string; value: string; cls?: string }) {
  return (
    <div className="rounded-lg border p-2">
      <span className="text-[10px] text-muted-foreground block">{label}</span>
      <span className={`numeric font-bold text-xs ${cls}`}>{value}</span>
    </div>
  )
}

// ------------------------------------------------------------
// اختيار العقود المشترك بين الإنشاء والإدارة (بحث + قائمة معالجات)
// ------------------------------------------------------------
function ContractPicker({
  selectedIds,
  onToggle,
  excludeIds = [],
  groupId,
}: {
  selectedIds: number[]
  onToggle?: (id: number) => void
  excludeIds?: number[]
  groupId?: number
}) {
  const [q, setQ] = useState('')
  const { data: contracts, isLoading } = useQuery({
    queryKey: ['contracts', q, '', ''],
    queryFn: () => api.contracts(q ? { q } : {}),
  })

  const options = useMemo<ContractListItem[]>(() => {
    let list = (contracts ?? []).filter((c) => c.status !== 'ملغى')
    if (groupId != null) list = list.filter((c) => !excludeIds.includes(c.id))
    return list.slice(0, 60)
  }, [contracts, excludeIds, groupId])

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" aria-hidden />
        <Input
          className="ps-9 h-11"
          placeholder="بحث برقم العقد أو الاسم أو العميل…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="بحث في العقود"
        />
      </div>
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
        </div>
      ) : options.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">لا عقود مطابقة (المستبعد الملغى والمضاف مسبقًا)</p>
      ) : (
        <div className="max-h-52 overflow-y-auto cmd-scroll rounded-lg border divide-y">
          {options.map((k) => {
            const picked = selectedIds.includes(k.id)
            return (
              <button
                key={k.id}
                type="button"
                onClick={() => onToggle?.(k.id)}
                className={`w-full text-start px-3 py-2.5 text-sm flex items-center justify-between gap-2 hover:bg-accent/50 transition-colors ${picked ? 'bg-primary/5' : ''}`}
                aria-pressed={picked}
              >
                <span className="min-w-0">
                  <span className="numeric font-bold text-xs" dir="ltr">{k.contractNumber}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {k.contractName || '—'} · {k.customer.name}
                  </span>
                </span>
                {picked && <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900 shrink-0">مختار</Badge>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------
// حوار إنشاء مجموعة
// ------------------------------------------------------------
function GroupCreateDialog({ open, onOpenChange, onSaved }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [picked, setPicked] = useState<number[]>([])
  const [initialized, setInitialized] = useState(false)

  if (open && !initialized) {
    setName('')
    setNotes('')
    setPicked([])
    setInitialized(true)
  }
  if (!open && initialized) setInitialized(false)

  const mutation = useMutation({
    mutationFn: () => groupsApi.create({ name: name.trim(), notes: notes.trim(), contractIds: picked }),
    onSuccess: (r) => {
      onSaved()
      toast.success(`أُنشئت المجموعة ${r.groupNumber}`)
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e instanceof ApiError ? e.message : e.message),
  })

  function submit() {
    if (!name.trim()) {
      toast.error('اسم المجموعة إلزامي')
      return
    }
    if (picked.length < 2) {
      toast.error('اختر عقدين على الأقل لإنشاء المجموعة')
      return
    }
    mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderPlus className="size-4 text-teal-600" aria-hidden /> مجموعة عقود جديدة
          </DialogTitle>
          <DialogDescription>
            يُرقَّمها النظام GRP-0001… — اشتراط عقدين على الأقل، ولا يُقبل عقد ملغى
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="g-name">اسم المجموعة *</Label>
            <Input id="g-name" className="h-11" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: مشروع الخيران — الحزمة الأولى" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g-notes">ملاحظات</Label>
            <Textarea id="g-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>العقود ({picked.length} مختارة)</Label>
              {picked.length > 0 && (
                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setPicked([])}>
                  <X className="size-3" aria-hidden /> تفريغ
                </Button>
              )}
            </div>
            {picked.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {picked.map((id) => (
                  <Badge key={id} variant="secondary" className="numeric">
                    # {id}
                    <button type="button" className="ms-1 text-muted-foreground hover:text-destructive" onClick={() => setPicked((p) => p.filter((x) => x !== id))} aria-label="إزالة من الاختيار">
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
            <ContractPicker
              selectedIds={picked}
              onToggle={(id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))}
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button className="h-11 gap-2" disabled={mutation.isPending} onClick={submit}>
            {mutation.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />} إنشاء المجموعة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------
// حوار إدارة مجموعة (إضافة/إزالة عقود)
// ------------------------------------------------------------
function GroupManageDialog({ group, onClose, onSaved, canRename, onRename }: {
  group: GroupSummaryDTO | null
  onClose: () => void
  onSaved: () => void
  canRename: boolean
  onRename: (g: GroupSummaryDTO) => void
}) {
  const open = group != null

  const addMut = useMutation({
    mutationFn: (contractId: number) => groupsApi.addContract(group!.id, contractId),
    onSuccess: () => {
      onSaved()
      toast.success('أُضيف العقد إلى المجموعة')
    },
    onError: (e: Error) => toast.error(e instanceof ApiError ? e.message : e.message),
  })

  const removeMut = useMutation({
    mutationFn: (contractId: number) => groupsApi.removeContract(group!.id, contractId),
    onSuccess: () => {
      onSaved()
      toast.success('أُزيل العقد من المجموعة')
    },
    onError: (e: Error) => toast.error(e instanceof ApiError ? e.message : e.message),
  })

  const memberIds = useMemo(() => (group?.contracts ?? []).map((k) => k.id), [group])

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="size-4 text-teal-600" aria-hidden />
            إدارة المجموعة — {group?.name}
          </DialogTitle>
          <DialogDescription className="numeric">
            {group?.groupNumber} · {group?.contractsCount} عقد — الإضافة والإزالة لا تمس حسابات أي عقد
          </DialogDescription>
        </DialogHeader>

        {group && (
          <div className="grid gap-5 py-1">
            {/* الأعضاء الحاليون */}
            <div className="space-y-2">
              <Label>عقود المجموعة ({group.contracts.length})</Label>
              {group.contracts.length === 0 ? (
                <p className="text-xs text-muted-foreground py-3 text-center border border-dashed rounded-lg">لا عقود في المجموعة</p>
              ) : (
                <div className="max-h-52 overflow-y-auto cmd-scroll rounded-lg border divide-y">
                  {group.contracts.map((k) => (
                    <div key={k.id} className="px-3 py-2.5 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="numeric font-bold text-xs" dir="ltr">{k.contractNumber}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {k.contractName || '—'} · {k.customerName} · {formatKWD(k.currentValue)}
                        </p>
                      </div>
                      <Button
                        size="sm" variant="ghost"
                        className="h-8 gap-1 text-xs text-destructive hover:text-destructive shrink-0"
                        onClick={() => removeMut.mutate(k.id)}
                      >
                        <X className="size-3.5" aria-hidden /> إزالة
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* إضافة عقد بالبحث */}
            <div className="space-y-2">
              <Label>إضافة عقد (المستبعد: الملغى والموجود مسبقًا)</Label>
              <ContractPicker
                selectedIds={[]}
                excludeIds={memberIds}
                groupId={group.id}
                onToggle={(id) => addMut.mutate(id)}
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {canRename && group && (
            <Button variant="outline" className="h-11 gap-2" onClick={() => onRename(group)}>
              <Pencil className="size-4" aria-hidden /> تعديل الاسم
            </Button>
          )}
          <Button className="h-11" onClick={onClose}>إغلاق</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------
// حوار إعادة تسمية (مدير فقط)
// ------------------------------------------------------------
function GroupRenameDialog({ group, onClose, onSaved }: {
  group: GroupSummaryDTO | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [initialized, setInitialized] = useState(false)

  const open = group != null
  if (open && !initialized) {
    setName(group.name)
    setNotes(group.notes)
    setInitialized(true)
  }
  if (!open && initialized) setInitialized(false)

  const mutation = useMutation({
    mutationFn: () => groupsApi.update(group!.id, { name: name.trim(), notes: notes.trim() }),
    onSuccess: () => {
      onSaved()
      toast.success('تم حفظ بيانات المجموعة')
      onClose()
    },
    onError: (e: Error) => toast.error(e instanceof ApiError ? e.message : e.message),
  })

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>تعديل بيانات المجموعة</DialogTitle>
          <DialogDescription className="numeric">{group?.groupNumber}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="gr-name">الاسم *</Label>
            <Input id="gr-name" className="h-11" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gr-notes">ملاحظات</Label>
            <Textarea id="gr-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={onClose}>إلغاء</Button>
          <Button
            className="h-11 gap-2"
            disabled={mutation.isPending}
            onClick={() => {
              if (!name.trim()) {
                toast.error('اسم المجموعة إلزامي')
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
