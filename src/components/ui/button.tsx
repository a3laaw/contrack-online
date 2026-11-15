import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        /* الهوية: الزر الرئيسي ذهبي بنص غامق دائمًا — hover برتقالي، وتركيز حلقة زرقاء 2px */
        default:
          "bg-primary text-primary-foreground shadow-xs hover:bg-brand-orange active:bg-brand-orange/95",
        destructive:
          "bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/30",
        /* الزر الثانوي: خلفية بيضاء وحد رمادي (قاعدة الهوية) */
        outline:
          "border border-border bg-card shadow-xs hover:bg-hover hover:text-foreground",
        secondary:
          "border border-border bg-card text-foreground shadow-xs hover:bg-hover",
        ghost:
          "hover:bg-hover hover:text-foreground",
        /* الروابط أزرق معلوماتي مقروء (#0678B4) — لا روابط ذهبية/برتقالية */
        link: "text-info-blue-text underline-offset-4 hover:text-info-blue-text/80 hover:underline",
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
