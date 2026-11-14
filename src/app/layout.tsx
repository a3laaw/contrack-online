import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { AppDirectionProvider } from "@/components/app-direction-provider";

// الخط المعتمد: Cairo (قيد 6 من التوجيه)
// تعريف الخط في globals.css (@font-face محلي من public/fonts) بدل next/font/google
// لتفادي فشل بناء Vercel عند تعذر جلب Google Fonts من بيئة البناء.

export const metadata: Metadata = {
  title: "ConTrack — إدارة العقود والمحاسبة",
  description: "نظام إدارة العقود والمحاسبة أونلاين — عملاء، عقود، سندات، باطن، تقارير",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground font-sans">
        <AppDirectionProvider>
          {children}
          <Toaster />
        </AppDirectionProvider>
      </body>
    </html>
  );
}
