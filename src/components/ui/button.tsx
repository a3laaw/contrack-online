import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        /* هوية NOVA: ظل الشعلة أسفل الزر الرئيسي يختفي عند الضغط (توقيع لمسي — PROJECT-LOG §2-2) */
        default:
          "bg-primary text-primary-foreground shadow-[0_3px_0_0_var(--brand-flame)] hover:bg-primary/90 active:translate-y-[2px] active:shadow-none",
        destructive:
          "bg-destructive text-white shadow-[0_3px_0_0_#7F1D1D] hover:bg-destructive/90 active:translate-y-[2px] active:shadow-none focus-visible:ring-destructive/20",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground",
        /* الزر الثانوي: سطح ورقي دافئ + نص الشعلة المقروء + ظل شعلة أخف (قرار D-003) */
        secondary:
          "bg-secondary text-brand-flame-ink shadow-[0_2px_0_0_var(--brand-flame)] hover:bg-secondary/80 active:translate-y-[2px] active:shadow-none",
        ghost:
          "hover:bg-accent hover:text-accent-foreground",
        /* الروابط أزرق ملكي معتمد (#2563EB) — لا روابط برتقالية (قاعدة §2-3) */
        link: "text-status-info underline-offset-4 hover:text-status-info/80 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
