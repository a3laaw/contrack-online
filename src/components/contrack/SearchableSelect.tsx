"use client";

// ===== قائمة منسدلة قابلة للبحث — بديل شفاف لـ Select عند القوائم الطويلة (العملاء، العقود…) =====
// - نفس مظهر SelectTrigger ومطابق له بصريًا (الحدود/الارتفاع/الظل/حالة focus)
// - بحث فوري بتطبيع عربي: تجاهل التشكيل والهمزات (أإآ→ا) والة→ه والى→ي والتطويل
// - تنقل بلوحة المفاتيح (أسهم/Enter/Esc) عبر cmdk، ودعم RTL كامل
// - واجهة مطابقة لـ Select: value + onValueChange ⇒ صفر تغيير في منطق الحفظ

import * as React from "react";
import { CheckIcon, ChevronDownIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

/** تطبيع نص عربي/لاتيني للمطابقة — يُستعمل للبحث فقط (لا يغيّر النص المعروض) */
export function normalizeArabic(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "") // التشكيل + الألف الخنجرية + التطويل
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

export interface SearchableOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** يظهر صف «جارٍ التحميل…» حين القائمة فارغة والتحميل جارٍ */
  loading?: boolean;
  loadingText?: string;
  /** زر مسح داخل المُطلِق للحقول الاختيارية (يستدعي onValueChange("")) */
  allowClear?: boolean;
  clearLabel?: string;
  disabled?: boolean;
  /** فئات المُطلِق نفسه — لضبط الارتفاع h-9/h-11 كما كان SelectTrigger */
  triggerClassName?: string;
  /** فئات الغلاف الخارجي */
  className?: string;
  id?: string;
  "aria-label"?: string;
}

export function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder = "اختر…",
  searchPlaceholder = "ابحث…",
  emptyText = "لا نتائج",
  loading = false,
  loadingText = "جارٍ التحميل…",
  allowClear = false,
  clearLabel = "مسح",
  disabled = false,
  triggerClassName,
  className,
  id,
  "aria-label": ariaLabel,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const listId = React.useId();

  // إعادة ضبط البحث عند كل فتح
  const handleOpenChange = React.useCallback((next: boolean) => {
    setOpen(next);
    if (next) setSearch("");
  }, []);

  const selected = React.useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value]
  );

  // تصفية محلية بتطبيع عربي — كل كلمات البحث يجب أن تظهر في التسمية
  const filtered = React.useMemo(() => {
    const q = normalizeArabic(search);
    if (!q) return options;
    const tokens = q.split(" ").filter(Boolean);
    return options.filter((o) => {
      const hay = normalizeArabic(o.label);
      return tokens.every((t) => hay.includes(t));
    });
  }, [options, search]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <div className={cn("relative w-full", className)}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-label={ariaLabel}
            disabled={disabled}
            data-placeholder={!selected}
            className={cn(
              "border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 h-9",
              triggerClassName
            )}
          >
            <span className="line-clamp-1 flex items-center gap-2 truncate text-start">
              {selected ? selected.label : placeholder}
            </span>
            <ChevronDownIcon className="size-4 opacity-50" />
          </button>
        </PopoverTrigger>
        {allowClear && !disabled && selected ? (
          <button
            type="button"
            aria-label={clearLabel}
            title={clearLabel}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onValueChange("");
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute inset-y-0 start-2 my-auto flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>
      <PopoverContent
        align="start"
        id={listId}
        className="w-(--radix-popover-trigger-width) p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={search}
            onValueChange={setSearch}
            autoFocus
          />
          <CommandList className="max-h-[240px]">
            {loading && options.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground" dir="rtl">
                {loadingText}
              </div>
            ) : filtered.length === 0 ? (
              <CommandEmpty>{emptyText}</CommandEmpty>
            ) : (
              <CommandGroup>
                {filtered.map((o) => (
                  <CommandItem
                    key={o.value}
                    value={o.value}
                    onSelect={() => {
                      onValueChange(o.value);
                      setOpen(false);
                    }}
                    className="cursor-pointer"
                  >
                    <CheckIcon
                      className={cn(
                        "size-4",
                        o.value === value ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="truncate">{o.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
