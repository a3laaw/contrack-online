"use client";

/**
 * تاب «قواعد الترحيل» — قوالب القيد الآلي للسندات القابلة للضبط (Task 106).
 * لكل صنف سند: طرف المدين/الدائن الثابت (كود من الدليل أو فارغ = سياقي من السند)
 * + مفتاح التفعيل. القاعدة المعطلة ترجع كليًا للمنطق المدمج.
 * سلسلة الحسم عند النشر: اختيار السند الصريح → كود القاعدة → المدمج السياقي → التسوية.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, Loader2, RefreshCw, Save } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, apiPut } from "../api";
import { errMessage } from "../contrack-types";

interface PostingRuleRow {
  ruleKey: string;
  label: string;
  debitCode: string;
  debitName: string | null;
  creditCode: string;
  creditName: string | null;
  enabled: boolean;
  isSystem: boolean;
  fromCatalog: boolean;
}

interface PostingRulesResponse {
  rules: PostingRuleRow[];
  chart: { code: string; name: string }[];
}

interface PostingRulesTabProps {
  onAuthError: () => void;
}

interface DraftRule {
  debitCode: string;
  creditCode: string;
  enabled: boolean;
}

const GROUP_LABELS: Record<string, string> = {
  receipt: "القبض",
  payment: "الصرف",
  custody: "العهد والسلف",
  other: "أخرى",
};
const GROUP_ORDER = ["receipt", "payment", "custody", "other"] as const;

export function PostingRulesTab({ onAuthError }: PostingRulesTabProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const query = useQuery<PostingRulesResponse>({
    queryKey: ["posting-rules"],
    queryFn: () => apiGet<PostingRulesResponse>("/api/posting-rules"),
  });

  // المسودة المحلية — تُهيأ من الاستجابة وتُقارن بها لتفعيل الحفظ
  const [draft, setDraft] = React.useState<Record<string, DraftRule>>({});
  React.useEffect(() => {
    if (query.data?.rules) {
      const next: Record<string, DraftRule> = {};
      for (const r of query.data.rules) {
        next[r.ruleKey] = { debitCode: r.debitCode, creditCode: r.creditCode, enabled: r.enabled };
      }
      setDraft(next);
    }
  }, [query.data]);

  const fail = React.useCallback(
    (e: unknown, title: string) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title, description: errMessage(e) });
    },
    [onAuthError, toast]
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiPut<{ saved: number }>(
        "/api/posting-rules",
        { rules: Object.entries(draft).map(([ruleKey, d]) => ({ ruleKey, ...d })) }
      );
      return res;
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["posting-rules"] });
      toast({ title: "حُفظت قواعد الترحيل", description: `تُطبَّق على كل سند جديد (${res.saved} قاعدة)` });
    },
    onError: (e) => fail(e, "تعذر حفظ القواعد"),
  });

  const rules = query.data?.rules ?? [];
  const dirty = React.useMemo(() => {
    if (!query.data) return false;
    return rules.some((r) => {
      const d = draft[r.ruleKey];
      if (!d) return false;
      return d.debitCode !== r.debitCode || d.creditCode !== r.creditCode || d.enabled !== r.enabled;
    });
  }, [draft, query.data, rules]);

  const upd = (ruleKey: string, patch: Partial<DraftRule>) =>
    setDraft((prev) => ({ ...prev, [ruleKey]: { ...(prev[ruleKey] ?? { debitCode: "", creditCode: "", enabled: true }), ...patch } }));

  if (query.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <Card className="border-status-danger/40">
        <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">{errMessage(query.error)}</p>
          <Button variant="outline" size="sm" className="h-9" onClick={() => query.refetch()}>
            <RefreshCw className="size-4" /> إعادة المحاولة
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-bold">قواعد ترحيل السندات</h2>
        <Badge variant="secondary" className="text-[11px]">11 قاعدة</Badge>
        <div className="ms-auto flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => query.refetch()} disabled={query.isFetching}>
            <RefreshCw className={query.isFetching ? "size-4 animate-spin" : "size-4"} /> تحديث
          </Button>
          <Button size="sm" className="h-9 gap-1.5" disabled={!dirty || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            حفظ القواعد
          </Button>
        </div>
      </div>

      <Card className="border-status-info/30 bg-status-info-bg/40">
        <CardContent className="flex gap-2 p-3 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-status-info" />
          <p>
            كل سند جديد يولّد قيدًا متوازنًا آليًا وفق قاعدته: <b>اختيار السند الصريح</b> يتقدم دائمًا، ثم <b>الكود المثبَّت هنا</b>،
            ثم <b>المنطق المدمج</b> (نقد/بنك بالطريقة، إيرادات العقود/العملاء بالربط…). ترك الكود فارغًا = سياقي كما كان،
            وإيقاف القاعدة يلغي التثبيت كليًا. القيد يُنشر على حسابات الدليل الورقية النشطة حصرًا.
          </p>
        </CardContent>
      </Card>

      {GROUP_ORDER.map((group) => {
        const groupRules = rules.filter((r) => groupOf(r.ruleKey) === group);
        if (groupRules.length === 0) return null;
        return (
          <Card key={group} className="gap-3 p-4">
            <h3 className="text-sm font-bold text-primary">{GROUP_LABELS[group]}</h3>
            <div className="space-y-3">
              {groupRules.map((r) => {
                const d = draft[r.ruleKey] ?? { debitCode: r.debitCode, creditCode: r.creditCode, enabled: r.enabled };
                const def = RULE_DESCRIPTIONS[r.ruleKey] || "";
                return (
                  <div key={r.ruleKey} className={`rounded-lg border p-3 transition-opacity ${d.enabled ? "" : "opacity-60"}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{r.label}</span>
                      <span className="text-[11px] text-muted-foreground" dir="ltr">{r.ruleKey}</span>
                      {!d.enabled && <Badge className="bg-status-warn-bg text-status-warn">معطلة — المنطق المدمج</Badge>}
                      <div className="ms-auto flex items-center gap-1.5">
                        <Switch
                          id={`pr-${r.ruleKey}`}
                          checked={d.enabled}
                          onCheckedChange={(v) => upd(r.ruleKey, { enabled: v })}
                          aria-label={`تفعيل قاعدة ${r.label}`}
                        />
                        <Label htmlFor={`pr-${r.ruleKey}`} className="text-[11px] text-muted-foreground">مفعّلة</Label>
                      </div>
                    </div>
                    {def && <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{def}</p>}
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <RuleSideInput
                        id={`pr-${r.ruleKey}-dr`}
                        label="كود المدين (فارغ = سياقي)"
                        value={d.debitCode}
                        hint={d.debitCode ? r.debitName || "الكود غير موجود في الدليل" : "يُحسم من السند"}
                        editable={RULE_ADJUSTABLE[r.ruleKey]?.debit ?? false}
                        options={query.data?.chart ?? []}
                        onChange={(v) => upd(r.ruleKey, { debitCode: v })}
                      />
                      <RuleSideInput
                        id={`pr-${r.ruleKey}-cr`}
                        label="كود الدائن (فارغ = سياقي)"
                        value={d.creditCode}
                        hint={d.creditCode ? r.creditName || "الكود غير موجود في الدليل" : "يُحسم من السند"}
                        editable={RULE_ADJUSTABLE[r.ruleKey]?.credit ?? false}
                        options={query.data?.chart ?? []}
                        onChange={(v) => upd(r.ruleKey, { creditCode: v })}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/** حقل كود الطرف — قائمة اقتراحات من الدليل مع قبول كتابة الكود يدويًا */
function RuleSideInput({
  id,
  label,
  value,
  hint,
  editable,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  hint: string;
  editable: boolean;
  options: { code: string; name: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-[11px]">{label}</Label>
      <Input
        id={id}
        className="h-8 text-xs"
        dir="ltr"
        list={`${id}-options`}
        value={value}
        placeholder="— سياقي —"
        disabled={!editable}
        onChange={(e) => onChange(e.target.value.trim())}
      />
      <datalist id={`${id}-options`}>
        {options.map((o) => (
          <option key={o.code} value={o.code}>{`${o.code} — ${o.name}`}</option>
        ))}
      </datalist>
      <p className="truncate text-[10px] text-muted-foreground">{hint}</p>
    </div>
  );
}

/** المجموعة والقابلية للتثبيت — مرآة الكتالوج الخلفي (قيم ثابتة للعرض) */
function groupOf(ruleKey: string): string {
  if (ruleKey === "receipt") return "receipt";
  if (ruleKey.startsWith("payment_")) return "payment";
  if (ruleKey.startsWith("custody_")) return "custody";
  return "other";
}

const RULE_ADJUSTABLE: Record<string, { debit: boolean; credit: boolean }> = {
  receipt: { debit: true, credit: true },
  payment_expense: { debit: true, credit: false },
  payment_contract_due: { debit: true, credit: false },
  payment_subcontract: { debit: true, credit: false },
  payment_partner: { debit: true, credit: false },
  custody_handover: { debit: false, credit: false },
  custody_settlement: { debit: true, credit: false },
  custody_return: { debit: false, credit: false },
  salary_deduction: { debit: true, credit: true },
  transfer: { debit: false, credit: false },
  bank_fee: { debit: true, credit: false },
};

const RULE_DESCRIPTIONS: Record<string, string> = {
  receipt: "المدين: نقد/بنك بالطريقة — الدائن: إيرادات العقود إن رُبط بعقد وإلا العملاء.",
  payment_expense: "المدين: الحساب المختار بالسند — الدائن: نقد/بنك بالطريقة.",
  payment_contract_due: "صرف مرتبط بعقد عميل بلا حساب مختار — المدين الافتراضي الاحتياطي هنا.",
  payment_subcontract: "صرف على عقد باطن — المدين الافتراضي الاحتياطي هنا (مثل 5120).",
  payment_partner: "صرف لشريك — المدين الافتراضي جاري الشريك 3400.",
  custody_handover: "المدين: حساب العهدة المختار بالسند — الدائن: نقد/بنك. سياقي دائمًا.",
  custody_settlement: "المدين: مصروف بند التصفية — الدائن: حساب العهدة (بلا صرف نقدي جديد).",
  custody_return: "المدين: نقد/بنك — الدائن: حساب العهدة المختار. سياقي دائمًا.",
  salary_deduction: "المدين: رواتب وأجور 5210 — الدائن: عُهد وسلف الموظفين 1140.",
  transfer: "المدين: المستلَم إليه — الدائن: المُحوَّل منه — من السند نفسه. سياقي دائمًا.",
  bank_fee: "المدين: رسوم وعمولات بنكية 5260 — الدائن: حساب السند الأب.",
};
