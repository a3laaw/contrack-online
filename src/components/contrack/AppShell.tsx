"use client";

import * as React from "react";
import { ChevronLeft, FileSignature, LogOut, Menu, PanelRightClose, PanelRightOpen, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { User } from "./contrack-types";
import { ROLE_LABEL, isManagerRole } from "./contrack-types";
import { useFeatureFlags } from "./FeatureFlagsProvider";
import { NotificationBell } from "./NotificationBell";
import { NAV_MODULES, findNavChild, type NavChild } from "./nav-structure";
import { permAllows, visibleChildren } from "./nav-perms";

interface AppShellProps {
  user: User;
  /** معرّف البند النشط (child.id) — يحدد الوحدة والبند المُبرز */
  activeNav: string;
  onSelectChild: (child: NavChild) => void;
  onLogout: () => void;
  onOpenSearch?: () => void;
  /** خريطة صلاحيات المستخدم (من /api/auth/me) — غير محمّلة = السماح مؤقتًا منعًا للوميض */
  perms?: Record<string, boolean> | null;
  /** G3 — فتح معاملة من إشعار (contract ⇒ تفاصيل العقد) */
  onOpenTransaction?: (transactionType: string, transactionId: number) => void;
  children?: React.ReactNode;
}

/**
 * الهيكل المعتمد (المرحلة 3): شريط علوي للوحدات الأربع + قائمة جانبية داخل كل وحدة
 * قابلة للطي إلى أيقونات + درج منزلق على الشاشات الصغيرة. بلا شريط سفلي.
 * بند 5 (المرحلة 2/ب): الفلترة بالصلاحيات visibleChildren نُقلت إلى nav-perms.ts النقي.
 */
export function AppShell({ user, activeNav, onSelectChild, onLogout, onOpenSearch, perms, onOpenTransaction, children }: AppShellProps) {
  const manager = isManagerRole(user.role);
  const { enabled: featureEnabled } = useFeatureFlags();
  const flagOn = React.useCallback((f: string) => featureEnabled(f), [featureEnabled]);
  // بند 5 (المرحلة 2/ب): إخفاء البنود حسب الصلاحيات — مرآة has_permission المكتبي:
  // الدور أولًا (المدير والمطور يريان كل شيء دائمًا) ثم الخريطة (الممنوع=false فقط يُخفى)
  // والمفتاح المجهول/الخريطة غير المحمّلة لا يقيّدان (لا وميض أخفاء قبل جلب /api/auth/me)
  const permOn = React.useCallback(
    (k: string) => permAllows(perms, k, manager),
    [perms, manager]
  );

  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);
  React.useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem("ctrk-sidebar-collapsed") === "1");
    } catch {
      /* التخزين غير متاح */
    }
  }, []);
  const toggleCollapsed = React.useCallback(() => {
    setCollapsed((prev) => {
      try {
        window.localStorage.setItem("ctrk-sidebar-collapsed", prev ? "0" : "1");
      } catch {
        /* تجاهل */
      }
      return !prev;
    });
  }, []);

  const active = findNavChild(activeNav);
  const activeModuleId = active?.module.id ?? "clients";

  // الوحدات ذات بنود مرئية فقط
  const modules = React.useMemo(
    () =>
      NAV_MODULES.map((m) => ({ module: m, children: visibleChildren(m, manager, flagOn, permOn) })).filter(
        (m) => m.children.length > 0
      ),
    [manager, flagOn, permOn]
  );

  const currentModule = modules.find((m) => m.module.id === activeModuleId) ?? modules[0];

  const pick = React.useCallback(
    (child: NavChild) => {
      onSelectChild(child);
      setDrawerOpen(false);
    },
    [onSelectChild]
  );

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* ===== الشريط العلوي: الوحدات الأربع ===== */}
      <header className="sticky top-0 z-40 border-b bg-card">
        <div className="flex h-14 items-center gap-2 px-3 lg:px-4">
          {/* زر الدرج — الشاشات الصغيرة */}
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden size-9 shrink-0"
            onClick={() => setDrawerOpen(true)}
            aria-label="فتح قائمة التنقل"
          >
            <Menu className="size-5" />
          </Button>

          {/* الشعار */}
          <button
            type="button"
            onClick={() => pick(currentModule.children[0])}
            className="flex items-center gap-2 shrink-0 rounded-md px-1 py-0.5"
            aria-label="ConTrack — الصفحة الأولى"
          >
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <FileSignature className="size-5" />
            </span>
            <span className="hidden sm:block text-base font-extrabold text-primary tracking-tight">ConTrack</span>
          </button>

          {/* الوحدات — الحاسوب */}
          <nav aria-label="الوحدات" className="hidden md:flex items-center gap-0.5 overflow-x-auto">
            {modules.map(({ module, children: kids }) => {
              const Icon = module.icon;
              const isActiveModule = module.id === activeModuleId;
              return (
                <button
                  key={module.id}
                  type="button"
                  // بند 5: أول بند مرئي بعد الفلترة — لا أول بند خام (قد يكون محجوبًا بالصلاحية)
                  onClick={() => kids[0] && pick(kids[0])}
                  aria-current={isActiveModule ? "page" : undefined}
                  className={cn(
                    "flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors",
                    isActiveModule
                      ? "bg-primary-soft text-primary-soft-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  )}
                >
                  <Icon className="size-4" />
                  {module.label}
                </button>
              );
            })}
          </nav>

          {/* البحث والإشعارات والمستخدم والخروج */}
          <div className="ms-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="size-9 text-muted-foreground"
              onClick={onOpenSearch}
              aria-label="بحث شامل (Ctrl+K)"
              title="بحث شامل (Ctrl+K)"
            >
              <Search className="size-4" />
            </Button>
            <NotificationBell onOpenTransaction={onOpenTransaction} />
            <div className="hidden sm:flex flex-col items-end leading-tight">
              <span className="text-sm font-medium">{user.fullName || user.username}</span>
              <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                {ROLE_LABEL[user.role] || user.role}
              </Badge>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-9 text-destructive hover:text-destructive"
              onClick={onLogout}
              aria-label="تسجيل الخروج"
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 w-full">
        {/* ===== القائمة الجانبية للوحدة — قابلة للطي إلى أيقونات (التقارير الـ11 منها كالمحاسبة) ===== */}
        <aside
          className={cn(
            "hidden lg:flex sticky top-14 h-[calc(100vh-3.5rem)] shrink-0 flex-col border-l bg-card transition-[width] duration-200",
            collapsed ? "w-14" : "w-56"
          )}
          aria-label={`أقسام ${currentModule.module.label}`}
        >
          <div className={cn("flex h-11 items-center justify-between border-b px-3", collapsed && "justify-center px-0")}>
            {!collapsed && (
              <span className="text-xs font-semibold text-muted-foreground">{currentModule.module.label}</span>
            )}
            <button
              type="button"
              onClick={toggleCollapsed}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary"
              aria-label={collapsed ? "توسيع القائمة الجانبية" : "طي القائمة الجانبية"}
              title={collapsed ? "توسيع" : "طي"}
            >
              {collapsed ? <PanelRightOpen className="size-4" /> : <PanelRightClose className="size-4" />}
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto p-2">
            <ul className="space-y-0.5">
              {currentModule.children.map((child) => {
                const Icon = child.icon;
                const isActive = child.id === activeNav;
                return (
                  <li key={child.id}>
                    <button
                      type="button"
                      onClick={() => pick(child)}
                      aria-current={isActive ? "page" : undefined}
                      title={child.label}
                      className={cn(
                        "flex min-h-9 w-full items-center gap-2 rounded-md text-sm font-medium transition-colors",
                        collapsed ? "justify-center px-0" : "px-3",
                        isActive
                          ? "bg-primary-soft text-primary-soft-foreground"
                          : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                      )}
                    >
                      <Icon className={cn("size-4 shrink-0", isActive && "text-primary")} />
                      {!collapsed && <span className="truncate">{child.label}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        </aside>

        {/* ===== المحتوى ===== */}
        <main className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-6xl space-y-4 px-3 py-4 sm:px-4">{children}</div>
        </main>
      </div>

      {/* التذييل — يلتصق بالأسفل وينزاح طبيعيًا عند طول المحتوى */}
      <footer className="mt-auto border-t bg-muted/40">
        <div className="px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] text-center text-xs text-muted-foreground">
          ConTrack V9.15 — إدارة العقود والمحاسبة
        </div>
      </footer>

      {/* ===== الدرج المنزلق — الشاشات الصغيرة ===== */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="right" className="w-72 overflow-y-auto p-0">
          <SheetHeader className="border-b">
            <SheetTitle className="flex items-center gap-2 text-base">
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <FileSignature className="size-4" />
              </span>
              ConTrack
            </SheetTitle>
          </SheetHeader>
          <nav aria-label="التنقل" className="p-2">
            {modules.map(({ module, children: kids }) => (
              <div key={module.id} className="mb-2">
                <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                  <module.icon className="size-3.5" />
                  {module.label}
                </div>
                <ul className="space-y-0.5">
                  {kids.map((child) => {
                    const Icon = child.icon;
                    const isActive = child.id === activeNav;
                    return (
                      <li key={child.id}>
                        <button
                          type="button"
                          onClick={() => pick(child)}
                          aria-current={isActive ? "page" : undefined}
                          className={cn(
                            "flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors",
                            isActive
                              ? "bg-primary-soft text-primary-soft-foreground"
                              : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                          )}
                        >
                          <Icon className={cn("size-4 shrink-0", isActive && "text-primary")} />
                          <span className="truncate">{child.label}</span>
                          {isActive && <ChevronLeft className="ms-auto size-3.5 shrink-0" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
          <div className="border-t p-3">
            <button
              type="button"
              onClick={() => {
                setDrawerOpen(false);
                onLogout();
              }}
              className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-sm font-medium text-destructive hover:bg-status-danger-bg"
            >
              <X className="size-4" />
              تسجيل الخروج
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
