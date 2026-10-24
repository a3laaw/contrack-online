"use client";

/**
 * المستخدم — صفحة كاملة (بدل نافذة إضافة/تعديل المستخدم السابقة — 5 حقول):
 * نفس الحقول كلها ونفس الحفظ والتحقق والـpayload والـinvalidations والـtoasts حرفيًا.
 * تُفتح من شاشة المستخدمين («مستخدم جديد»/«تعديل») — بلا مسار جديد،
 * تُعرض مكان الشاشة المستدعية (استبدال في نفس المستوى) وتُركَّب عند الفتح فقط.
 */

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiPatch, apiPost } from "./api";
import type { UserListItem } from "./contrack-types";
import { ASSIGNABLE_ROLES, errMessage } from "./contrack-types";

const ROLE_OPTIONS = ASSIGNABLE_ROLES;

interface UserEditPageProps {
  /** مستخدم للتعديل — null لإضافة مستخدم جديد */
  editing: UserListItem | null;
  onAuthError: () => void;
  /** العودة لشاشة المستخدمين — تُستدعى بعد الحفظ أو عند الإلغاء */
  onClose: () => void;
}

export function UserEditPage({ editing, onAuthError, onClose }: UserEditPageProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // الصفحة تُركَّب عند الفتح فقط — التهيئة مباشرة (نفس تهيئة openAdd/openEdit السابقتين)
  const [username, setUsername] = React.useState(editing?.username ?? "");
  const [fullName, setFullName] = React.useState(editing?.fullName ?? "");
  const [password, setPassword] = React.useState("");
  const [role, setRole] = React.useState(editing?.role ?? "secretary");
  const [active, setActive] = React.useState(editing?.active ?? true);

  // ===== نفس حفظ النافذة السابقة حرفيًا (نفس الـpayload والـinvalidations والـtoasts) =====
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!username.trim()) throw new ApiError("اسم المستخدم مطلوب", 400);
      if (editing) {
        const body: Record<string, unknown> = {
          fullName: fullName.trim(),
          role,
          active,
        };
        if (password) body.password = password;
        return apiPatch<{ user: UserListItem }>(`/api/users/${editing.id}`, body);
      }
      if (!password) throw new ApiError("كلمة المرور مطلوبة", 400);
      return apiPost<{ user: UserListItem }>("/api/users", {
        username: username.trim(),
        fullName: fullName.trim(),
        password,
        role,
      });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast({ title: editing ? "تم التعديل" : "تمت الإضافة", description: `المستخدم «${res.user.username}»` });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر حفظ المستخدم", description: errMessage(e) });
    },
  });

  return (
    <div className="space-y-4">
      {/* ===== رأس الصفحة ===== */}
      <div>
        <p className="text-xs text-muted-foreground">الإعدادات ← المستخدمون والصلاحيات</p>
        <h1 className="text-xl font-bold">{editing ? `تعديل المستخدم — ${editing.username}` : "مستخدم جديد"}</h1>
        <p className="text-sm text-muted-foreground">
          {editing ? "اترك كلمة المرور فارغة للإبقاء على الحالية" : "الدور يحدد الصلاحيات الافتراضية"}
        </p>
      </div>

      {/* ===== الحقول — نفس حقول النافذة السابقة كلها (5) ===== */}
      <Card>
        <CardContent className="p-4 md:p-6">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="u-username" className="text-xs">
                اسم المستخدم *
              </Label>
              <Input
                id="u-username"
                className="h-9"
                dir="ltr"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={!!editing}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-full" className="text-xs">
                الاسم الكامل
              </Label>
              <Input id="u-full" className="h-9" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-pass" className="text-xs">
                كلمة المرور {editing ? "(اختياري)" : "*"}
              </Label>
              <Input
                id="u-pass"
                className="h-9"
                dir="ltr"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">الدور</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {editing && (
              <div className="flex items-center justify-between rounded-lg border p-3 md:col-span-2 lg:col-span-2">
                <span className="text-sm font-medium">الحساب مفعّل</span>
                <Switch checked={active} onCheckedChange={setActive} />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ===== شريط الإجراءات السفلي — حفظ أساسي واحد + إلغاء outline ===== */}
      <div className="sticky bottom-0 z-30">
        <Card className="border bg-background/95 shadow-sm backdrop-blur">
          <CardContent className="flex items-center justify-end gap-2 p-2">
            <Button variant="outline" className="h-9" onClick={onClose} disabled={saveMutation.isPending}>
              إلغاء
            </Button>
            <Button className="h-9" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              {saveMutation.isPending ? "جارٍ الحفظ…" : "حفظ"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
